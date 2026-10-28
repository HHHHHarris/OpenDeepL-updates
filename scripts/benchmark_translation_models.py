#!/usr/bin/env python3
"""Isolated, resumable local translation benchmark; never touches port 18081.

Run one model at a time. New model weights require a completed verification JSON
with sha256 and size matching the file; this script never downloads weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence/model-comparison'
FIXTURES = ROOT / 'Tests/fixtures/model_benchmark.json'
LOCAL = Path(os.environ.get('OPENDEEPL_BENCH_DATA') or (Path.home() / 'Library/Application Support/OpenDeepL'))
NEW = LOCAL / 'models'
MODEL = {
    'hymt7b': (LOCAL / 'models/HY-MT2-7B-Q8_0.gguf', None),
    'hymt1b': (NEW / 'Hy-MT2-1.8B-Q8_0.gguf', EVIDENCE / 'hymt-verified.json'),
    'gemma4b': (NEW / 'translategemma-4b-it-Q8_0.gguf', EVIDENCE / 'gemma-verified.json'),
}
PORT = 18881
BASE = f'http://127.0.0.1:{PORT}'
SAMPLE = {'temperature': 0, 'top_k': 20, 'top_p': 0.6, 'repeat_penalty': 1.05, 'n_predict': 2048, 'stream': True, 'cache_prompt': False}
PLACEHOLDER = re.compile(r'\{\{[^{}]+\}\}|\$\{[^{}]+\}|\{[A-Za-z_][^{}]*\}|<(?:SKU_ID|AGENT_ID)>|%s')
NUMBER = re.compile(r'(?<![\w])\d+(?:[.,]\d+)?(?:[–-]\d+(?:[.,]\d+)?)?')
DOC_MARKER = re.compile(r'⟦OD\d{3}⟧')


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def verified_weight(model: str) -> dict:
    path, verification = MODEL[model]
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f'Weight absent: {path}')
    if verification is None:
        return {'path': str(path), 'size': path.stat().st_size, 'sha256': sha256_file(path), 'source': 'existing production weight'}
    if not verification.is_file():
        raise RuntimeError(f'No completed verification: {verification}')
    data = json.loads(verification.read_text())
    expected_hash = data.get('sha256') or data.get('actual_sha256')
    expected_size = data.get('size') or data.get('actual_size')
    if not expected_hash or not expected_size or not data.get('verified', False):
        raise RuntimeError(f'Incomplete verification: {verification}')
    actual_hash = sha256_file(path)
    if int(expected_size) != path.stat().st_size or expected_hash.lower() != actual_hash.lower():
        raise RuntimeError(f'Weight hash/size mismatch: {path}')
    return {'path': str(path), 'size': path.stat().st_size, 'sha256': actual_hash, 'source': str(verification)}


def gemma_prompt(source: str, target: str, body: str) -> str:
    """Exact text branch of official/embedded TranslateGemma GGUF template.

    The official Jinja template maps en/zh to English/Chinese and emits BOS,
    a user turn with this instruction, then an open model turn. llama.cpp adds
    the model BOS when tokenizing raw /completion, so omit it here (one BOS).
    """
    codes = {'en': 'English', 'zh': 'Chinese'}
    src, dst = codes[source], codes[target]
    return (f'<start_of_turn>user\nYou are a professional {src} ({source}) to '
            f'{dst} ({target}) translator. Your goal is to accurately convey the meaning and '
            f'nuances of the original {src} text while adhering to {dst} grammar, '
            f'vocabulary, and cultural sensitivities.\n'
            f'Produce only the {dst} translation, without any additional explanations or '
            f'commentary. Please translate the following {src} text into {dst}:\n\n\n'
            f'{body.strip()}<end_of_turn>\n<start_of_turn>model\n')


def conservative_checks(source: str, output: str) -> dict:
    """Alerts only; not an automatic quality/accuracy grade."""
    source_tokens = PLACEHOLDER.findall(source)
    missing_tokens = [token for token in source_tokens if token not in output]
    source_numbers = NUMBER.findall(source)
    missing_numbers = [number for number in source_numbers if number not in output]
    input_markers = DOC_MARKER.findall(source)
    output_markers = DOC_MARKER.findall(output)
    return {'missing_placeholders': missing_tokens, 'missing_number_strings': missing_numbers,
            'input_protocol_markers': input_markers,
            'output_protocol_markers': output_markers,
            'protocol_markers_exact_and_ordered': input_markers == output_markers,
            'paragraph_count_input': len(source.split('\n\n')),
            'paragraph_count_output': len(output.split('\n\n')),
            'empty_output': not output.strip(), 'manual_review_required': True}


def http_json(path: str, payload: dict | None = None, timeout: float = 30):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    request = urllib.request.Request(BASE + path, body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait_ready(process: subprocess.Popen, timeout: float = 240):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if process.poll() is not None:
            raise RuntimeError(f'isolated server exited with {process.returncode}')
        try:
            if http_json('/health', timeout=2).get('status') == 'ok':
                return time.monotonic() - start
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    raise TimeoutError('isolated server startup timed out')


def stream_completion(model: str, row: dict):
    if model == 'gemma4b':
        endpoint = '/completion'
        payload = {**SAMPLE, 'prompt': gemma_prompt(row['source'], row['target'], row['text'])}
    else:
        endpoint = '/v1/chat/completions'
        source, target = ('English' if row['source'] == 'en' else 'Chinese',
                          'Chinese' if row['target'] == 'zh' else 'English')
        payload = {'model': model, 'messages': [
            {'role': 'system', 'content': 'You are a translation engine. Translate the user text only; return only the translation.\n'
             f'Source language: {source}. Target language: {target}.\n'
             'Preferred tone: default. Preserve meaning, formatting, and proper nouns where appropriate.'},
            {'role': 'user', 'content': row['text']}],
            'temperature': 0, 'top_k': 20, 'top_p': .6, 'repeat_penalty': 1.05,
            'max_tokens': 2048, 'stream': True, 'stream_options': {'include_usage': True}}
    started = time.monotonic()
    req = urllib.request.Request(BASE + endpoint, json.dumps(payload, ensure_ascii=False).encode(),
                                 {'Content-Type': 'application/json'})
    chunks, first, finish, usage, timings = [], None, None, None, None
    with urllib.request.urlopen(req, timeout=300) as response:
        for raw in response:
            if not raw.startswith(b'data: '):
                continue
            value = raw[6:].strip()
            if value == b'[DONE]':
                break
            item = json.loads(value)
            if 'error' in item:
                raise RuntimeError(str(item['error']))
            if endpoint == '/completion':
                content = item.get('content') or ''
                if item.get('stop'):
                    finish = item.get('stop_type') or 'stop'
                timings = item.get('timings') or timings
            else:
                choices = item.get('choices') or []
                content = choices[0].get('delta', {}).get('content') or '' if choices else ''
                if choices and choices[0].get('finish_reason'):
                    finish = choices[0]['finish_reason']
                usage = item.get('usage') or usage
            if content:
                if first is None:
                    first = time.monotonic()
                chunks.append(content)
    ended = time.monotonic()
    generated = (usage or {}).get('completion_tokens') or (timings or {}).get('predicted_n')
    generation_duration = ended - (first or ended)
    return {'output': ''.join(chunks), 'ttft_s': None if first is None else round(first - started, 4),
            'total_s': round(ended - started, 4), 'generation_token_s': None if not generated or generation_duration <= 0 else round(generated / generation_duration, 3),
            'completion_tokens': generated, 'finish_reason': finish, 'usage': usage, 'timings': timings,
            'request': payload}


def rss_bytes(pid: int) -> int | None:
    # macOS ps rss is KiB; process RSS, deliberately not aggregate Metal/GPU occupancy.
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'rss='], text=True, capture_output=True)
    try:
        return int(result.stdout.strip()) * 1024
    except ValueError:
        return None


class RssSampler:
    """Sample only the benchmark child; this is not total unified-memory use."""

    def __init__(self, pid: int):
        self.pid = pid
        self.samples: list[int] = []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop_event.is_set():
            value = rss_bytes(self.pid)
            if value is not None:
                self.samples.append(value)
            self.stop_event.wait(.1)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=2)
        return max(self.samples, default=None)


def run(model: str, max_cases: int | None = None, run_tag: str = '', case_prefix: str = ''):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    weight = verified_weight(model)  # gate before launching any new weight
    path = Path(weight['path'])
    rows = json.loads(FIXTURES.read_text())
    if case_prefix:
        rows = [row for row in rows if row['id'].startswith(case_prefix)]
    if max_cases:
        rows = rows[:max_cases]
    if not rows:
        raise ValueError('No fixtures selected')
    if run_tag and not re.fullmatch(r'[a-z0-9-]+', run_tag):
        raise ValueError('run_tag must be lowercase letters, digits, or hyphens')
    suffix = f'-{run_tag}' if run_tag else ''
    log_path = EVIDENCE / f'benchmark-{model}{suffix}-server.log'
    output_path = EVIDENCE / f'benchmark-{model}{suffix}.json'
    if output_path.exists():
        raise RuntimeError(f'Output already exists (preserve evidence): {output_path}')
    # Refuse to attach to or kill someone else's process on this port.
    try:
        http_json('/health', timeout=1)
    except (OSError, ValueError):
        pass
    else:
        raise RuntimeError(f'Port {PORT} already occupied')
    cmd = ['/opt/homebrew/bin/llama-server', '--model', str(path), '--alias', model,
           '--host', '127.0.0.1', '--port', str(PORT), '--offline', '--no-webui',
           '--ctx-size', '8192', '--parallel', '1', '--gpu-layers', 'all', '--flash-attn', 'on',
           '--batch-size', '512', '--ubatch-size', '256', '--n-predict', '2048',
           '--temperature', '0', '--top-k', '20', '--top-p', '0.6', '--repeat-penalty', '1.05',
           '--cors-origins', 'localhost', '--no-cors-credentials']
    # This GGUF's official structured translation Jinja rejects llama-server's
    # generic startup parser probe; /completion below supplies its exact text
    # branch as a raw prompt. Preserve Jinja chat formatting for both Hy runs.
    cmd += ['--no-jinja' if model == 'gemma4b' else '--jinja']
    if model == 'hymt7b':
        cmd += ['--chat-template-file', str(LOCAL / 'runtime/hunyuan-translation.jinja'),
                '--override-kv', 'tokenizer.ggml.eos_token_id=int:127960']
    result = {'model': model, 'weight': weight, 'command': cmd, 'port': PORT,
              'fixture': str(FIXTURES), 'sampling': SAMPLE, 'results': [],
              'quality': 'manual_review_required', 'timing_note': 'TTFT includes HTTP/SSE overhead; token/s is completion tokens divided by time after first content chunk; RSS is ps process RSS, not total GPU use.'}
    with log_path.open('w') as log:
        process = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        sampler = RssSampler(process.pid)
        sampler.start()
        try:
            load_s = wait_ready(process)
            result['cold_load_s'] = round(load_s, 3)
            result['rss_after_load_bytes'] = rss_bytes(process.pid)
            warmup_row = rows[0]
            warmup = stream_completion(model, warmup_row)
            result['warmup'] = {'case_id': warmup_row['id'], **warmup}
            for index, row in enumerate(rows, 1):
                try:
                    measured = stream_completion(model, row)
                    measured.update({'id': row['id'], 'source': row['source'], 'target': row['target'],
                                     'category': row['category'], 'input': row['text'],
                                     'checks': conservative_checks(row['text'], measured['output']),
                                     'rss_bytes': rss_bytes(process.pid)})
                except Exception as exc:
                    measured = {'id': row['id'], 'source': row['source'], 'target': row['target'],
                                'category': row['category'], 'input': row['text'], 'error': str(exc),
                                'manual_review_required': True}
                result['results'].append(measured)
                output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
                print(f'{model} {index}/{len(rows)} {row["id"]}: {measured.get("total_s", "ERROR")}s', flush=True)
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()  # only this benchmark's child process
                process.wait(timeout=10)
                result['cleanup_warning'] = 'SIGTERM exceeded 30 seconds; benchmark child killed'
            result['peak_sampled_rss_bytes'] = sampler.stop()
            result['rss_sampling_interval_s'] = .1
            result['rss_note'] = 'Peak is sampled benchmark-server process RSS, including load and requests; not total Metal/unified-memory occupancy.'
            result['server_exit_code'] = process.poll()
            output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return output_path


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('model', choices=MODEL)
    parser.add_argument('--max-cases', type=int, help='development smoke run only')
    parser.add_argument('--run-tag', default='', help='unique evidence suffix; leaves earlier run intact')
    parser.add_argument('--case-prefix', default='', help='run only fixture IDs with this prefix')
    args = parser.parse_args()
    print(run(args.model, args.max_cases, args.run_tag, args.case_prefix))

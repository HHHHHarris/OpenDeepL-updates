"""Offline, cross-platform translation core and JSON-lines bridge.

No dependency, model weights, or outbound network access is installed here. The
inference peer is the app-owned router on 127.0.0.1:18082; the existing
127.0.0.1:18081 router is probed read-only to avoid known model overlap.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
import codecs
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
import threading
from typing import Callable, Iterable

BASE_URL = 'http://127.0.0.1:18081'
MODEL = 'hy-mt2-7b-q8_0'
FAST_MODEL = 'hy-mt2-1.8b-q8_0'
MODEL_ALIASES = {'quality': MODEL, 'fast': FAST_MODEL}
DUAL_BASE_URL = 'http://127.0.0.1:18082'
MAX_TEXT = 100_000
MAX_SSE_BYTES = 2_000_000
MAX_HISTORY = 200
MAC_LAUNCHER = Path.home() / 'Library/Application Support/LocalTranslation/local_translation.py'


class TranslationError(Exception):
    pass


class LocalEngineError(TranslationError):
    """Stable, content-free engine diagnostics; only transient I/O is retryable."""
    def __init__(self, message, code, retryable=False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class GlossaryEntry:
    source: str
    target: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    @classmethod
    def from_dict(cls, data: dict) -> 'GlossaryEntry':
        return cls(source=str(data['source']), target=str(data['target']), id=str(data.get('id') or uuid.uuid4()))


@dataclass(frozen=True)
class TranslationRequest:
    text: str
    sourceLanguage: str = 'auto'
    targetLanguage: str = 'Chinese'
    tone: str = 'default'
    glossary: tuple[GlossaryEntry, ...] = ()
    modelMode: str = 'quality'

    @classmethod
    def from_dict(cls, data: dict) -> 'TranslationRequest':
        glossary = tuple(GlossaryEntry.from_dict(item) for item in data.get('glossary', []))
        return cls(text=str(data['text']), sourceLanguage=str(data.get('sourceLanguage', 'auto')),
                   targetLanguage=str(data.get('targetLanguage', 'Chinese')),
                   tone=str(data.get('tone', 'default')), glossary=glossary,
                   modelMode=str(data.get('modelMode', 'quality')))


def build_messages(request: TranslationRequest) -> list[dict[str, str]]:
    if request.modelMode not in MODEL_ALIASES:
        raise TranslationError('Unknown local model mode.')
    if not request.text.strip():
        raise TranslationError('Translation text is empty.')
    if len(request.text) > MAX_TEXT:
        raise TranslationError('Translation text exceeds the local limit.')
    if any(len(x) > 100 for x in (request.sourceLanguage, request.targetLanguage, request.tone)):
        raise TranslationError('Language or tone field is too long.')
    if len(request.glossary) > 200:
        raise TranslationError('Too many glossary entries.')
    instructions = [
        'You are a translation engine. Translate the user text only; return only the translation.',
        f'Source language: {request.sourceLanguage}. Target language: {request.targetLanguage}.',
        f'Preferred tone: {request.tone}. Preserve meaning, formatting, and proper nouns where appropriate.',
    ]
    if request.glossary:
        instructions.append('Preferred terminology (apply when contextually appropriate):')
        instructions.extend(f'- {g.source[:200]} => {g.target[:200]}' for g in request.glossary)
    if '⟦OD' in request.text:
        instructions.append('Protected placeholders such as ⟦OD000⟧ are immutable data. '
                            'Copy every placeholder exactly once, character for character. '
                            'Translate only the surrounding text; never translate, remove, or duplicate a placeholder.')
    return [{'role': 'system', 'content': '\n'.join(instructions)},
            {'role': 'user', 'content': request.text}]


class SSEParser:
    """Incremental UTF-8 SSE parser; returns content deltas and checks [DONE]."""
    def __init__(self) -> None:
        self.decoder = codecs.getincrementaldecoder('utf-8')()
        self.line_buffer = ''
        self.event_lines: list[str] = []
        self.bytes_seen = 0
        self.done = False
        self.output: list[str] = []

    def feed(self, chunk: bytes) -> list[str]:
        self.bytes_seen += len(chunk)
        if self.bytes_seen > MAX_SSE_BYTES:
            raise TranslationError('Translation stream exceeded the local limit.')
        self.line_buffer += self.decoder.decode(chunk)
        deltas: list[str] = []
        while '\n' in self.line_buffer:
            line, self.line_buffer = self.line_buffer.split('\n', 1)
            line = line.rstrip('\r')
            if line == '':
                deltas.extend(self._finish_event())
            elif line.startswith('data:'):
                self.event_lines.append(line[5:].lstrip(' '))
        return deltas

    def _finish_event(self) -> list[str]:
        if not self.event_lines:
            return []
        raw = '\n'.join(self.event_lines)
        self.event_lines.clear()
        if raw == '[DONE]':
            self.done = True
            return []
        try:
            payload = json.loads(raw)
            if 'error' in payload:
                raise TranslationError('Local model returned an error.')
            deltas = []
            for choice in payload.get('choices', []):
                reason = choice.get('finish_reason')
                if reason not in (None, 'stop'):
                    raise TranslationError('Local model stopped before a complete translation.')
                content = choice.get('delta', {}).get('content')
                if isinstance(content, str) and content:
                    deltas.append(content)
                    self.output.append(content)
            return deltas
        except (ValueError, TypeError, AttributeError) as exc:
            raise TranslationError('Malformed local model stream.') from exc

    def finish(self) -> str:
        self.line_buffer += self.decoder.decode(b'', final=True)
        if self.line_buffer.strip():
            if self.line_buffer.endswith('\r'):
                self.line_buffer = self.line_buffer[:-1]
            if self.line_buffer.startswith('data:'):
                self.event_lines.append(self.line_buffer[5:].lstrip(' '))
        self._finish_event()
        if not self.done:
            raise TranslationError('Local model stream ended before completion.')
        return ''.join(self.output)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise TranslationError('Local endpoint redirected unexpectedly.')


class OfflineEngine:
    def __init__(self, launcher: Path | None = None, starter: Callable[[], None] | None = None):
        self.launcher = MAC_LAUNCHER if launcher is None else launcher
        self.starter = starter
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        self.base_url = BASE_URL

    def _open(self, path: str, data: bytes | None = None, timeout: int = 5):
        # path is internal, not caller-controlled. Redirects are denied.
        if path not in ('/v1/models', '/v1/chat/completions'):
            raise TranslationError('Invalid local endpoint.')
        headers = {'Content-Type': 'application/json'} if data is not None else {}
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers)
        try:
            return self.opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            raise LocalEngineError(f'Local model HTTP {exc.code}.', 'LOCAL_HTTP_ERROR',
                                   exc.code in (408, 429, 500, 502, 503, 504)) from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise LocalEngineError('Local model request timed out.', 'LOCAL_TIMEOUT', True) from exc
            raise LocalEngineError('Local model is offline.', 'LOCAL_CONNECTION', True) from exc
        except TimeoutError as exc:
            raise LocalEngineError('Local model request timed out.', 'LOCAL_TIMEOUT', True) from exc
        except (OSError, http.client.HTTPException) as exc:
            raise LocalEngineError('Local model connection interrupted.', 'LOCAL_CONNECTION', True) from exc

    def status(self) -> str:
        """Read-only router probe. Never invokes a launcher or loads model weights."""
        try:
            with self._open('/v1/models', timeout=2) as response:
                data = json.load(response)
            for item in data.get('data', []):
                if item.get('id') == MODEL:
                    raw = item.get('status')
                    if isinstance(raw, dict):
                        raw = raw.get('value')
                    return raw if raw in ('unloaded', 'sleeping', 'loading', 'loaded') else 'available'
            return 'offline'
        except (TranslationError, ValueError, KeyError, OSError, http.client.HTTPException):
            return 'offline'

    def _start_if_needed(self) -> None:
        if self.status() != 'offline':
            return
        if self.starter is not None:
            self.starter()
            if self.status() == 'offline':
                raise TranslationError('Local router did not become ready.')
            return
        if sys.platform == 'win32':
            configured = os.environ.get('OPENDEEPL_ENGINE_LAUNCHER')
            if configured:
                path = Path(configured).expanduser().resolve()
                if not path.is_file():
                    raise TranslationError('Configured local launcher is missing.')
                command = [sys.executable, str(path), 'start'] if path.suffix.lower() == '.py' else [str(path), 'start']
                try:
                    result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, timeout=150, check=False)
                except (subprocess.TimeoutExpired, OSError) as exc:
                    raise TranslationError('Configured local launcher failed.') from exc
                if result.returncode != 0 or self.status() == 'offline':
                    raise TranslationError('Configured local launcher did not become ready.')
                return
            raise TranslationError('Local translation router is offline.')
        if sys.platform != 'darwin' or not self.launcher.is_file():
            raise TranslationError('Local translation router is offline.')
        env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin', 'HOME': str(Path.home()),
               'LANG': 'en_US.UTF-8', 'TMPDIR': os.environ.get('TMPDIR', '/tmp')}
        try:
            # Existing launcher validates process ownership and lifecycle locking.
            result = subprocess.run(['/usr/bin/python3', str(self.launcher), 'start'],
                                    env=env, cwd=str(self.launcher.parent),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=150, check=False)
        except subprocess.TimeoutExpired as exc:
            raise TranslationError('Local router start timed out.') from exc
        except OSError as exc:
            raise TranslationError('Local router start failed.') from exc
        if result.returncode != 0:
            # A competing app may be starting the same managed router. Briefly
            # re-probe rather than launching or touching any foreign process.
            import time
            for _ in range(10):
                if self.status() != 'offline':
                    return
                time.sleep(.3)
            raise TranslationError('Local router start failed; see existing router log.')
        if self.status() == 'offline':
            raise TranslationError('Local router did not become ready.')

    def translate(self, request: TranslationRequest, on_delta: Callable[[str], None] | None = None) -> str:
        messages = build_messages(request)
        self._start_if_needed()
        body = json.dumps({'model': MODEL_ALIASES[request.modelMode], 'messages': messages,
                           'stream': True, 'temperature': 0}, ensure_ascii=False).encode('utf-8')
        parser = SSEParser()
        def checked_io(operation):
            try:
                return operation()
            except TimeoutError as exc:
                raise LocalEngineError('Local model request timed out.', 'LOCAL_TIMEOUT', True) from exc
            except (OSError, http.client.HTTPException) as exc:
                raise LocalEngineError('Local model connection interrupted.', 'LOCAL_STREAM_INTERRUPTED', True) from exc
            except UnicodeError as exc:
                raise LocalEngineError('Local model returned invalid text encoding.', 'LOCAL_STREAM_ENCODING') from exc
        with checked_io(lambda: self._open('/v1/chat/completions', body, timeout=150)) as response:
            while True:
                chunk = checked_io(lambda: response.read1(4096))
                if not chunk:
                    break
                for delta in checked_io(lambda: parser.feed(chunk)):
                    if on_delta:
                        # Callers own their callback failures; they are not model
                        # transport failures and must never trigger I/O retries.
                        on_delta(delta)
        return checked_io(parser.finish)


class DualModelEngine(OfflineEngine):
    """OpenDeepL-owned router. A file lock spans each complete inference stream.

    The original LocalTranslation router is read-only and never used for
    inference here. Its active 7B weight blocks a new load to avoid a known
    cross-app overlap. An external request after the check is outside our lock.
    """
    _thread_lock = threading.RLock()
    _depth = threading.local()

    def __init__(self):
        super().__init__()
        self.base_url = DUAL_BASE_URL

    @contextmanager
    def operation(self):
        from core.model_lifecycle import operation_lock
        with self._thread_lock:
            depth = getattr(self._depth, 'value', 0)
            if depth:
                self._depth.value += 1
                try:
                    yield
                finally:
                    self._depth.value -= 1
            else:
                with operation_lock():
                    self._depth.value = 1
                    self._depth.router_checked = False
                    try:
                        yield
                    finally:
                        self._depth.value = 0
                        self._depth.router_checked = False

    def model_status(self, mode='quality') -> str:
        if mode not in MODEL_ALIASES:
            raise TranslationError('Unknown local model mode.')
        try:
            with self._open('/v1/models', timeout=2) as response:
                data = json.load(response)
            for item in data.get('data', []):
                if item.get('id') == MODEL_ALIASES[mode]:
                    raw = item.get('status')
                    raw = raw.get('value') if isinstance(raw, dict) else raw
                    return raw if raw in ('unloaded', 'sleeping', 'loading', 'loaded') else 'available'
        except (TranslationError, ValueError, KeyError, OSError, http.client.HTTPException):
            pass
        return 'offline'

    def status(self) -> str:
        return self.model_status('quality')

    def _start_if_needed(self) -> None:
        if getattr(self._depth, 'router_checked', False):
            return
        app_root = Path(os.environ.get('OPENDEEPL_APP_ROOT') or Path(__file__).resolve().parents[1])
        script = app_root / 'platform' / ('windows_engine.py' if sys.platform == 'win32' else 'mac_engine.py')
        if sys.platform not in ('darwin', 'win32') or not script.is_file():
            raise LocalEngineError('OpenDeepL local router is unavailable.', 'LOCAL_ROUTER_OFFLINE')
        try:
            result = subprocess.run([sys.executable, str(script), 'start'], stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=150, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise LocalEngineError('OpenDeepL local router startup failed.', 'LOCAL_ROUTER_START') from exc
        if result.returncode or self.status() == 'offline':
            raise LocalEngineError('OpenDeepL local router startup failed.', 'LOCAL_ROUTER_START')
        self._depth.router_checked = True

    def _external_active(self) -> bool:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        try:
            with opener.open(BASE_URL + '/v1/models', timeout=2) as response:
                data = json.load(response)
            return any(item.get('id') == MODEL and
                       (item.get('status', {}).get('value') if isinstance(item.get('status'), dict)
                        else item.get('status')) in ('loaded', 'loading')
                       for item in data.get('data', []))
        except (OSError, ValueError, TranslationError):
            return False

    def translate(self, request: TranslationRequest, on_delta=None) -> str:
        # Validate before launcher, and reject absent fast weight before any
        # possible quality-model routing. No implicit fallback is permitted.
        build_messages(request)
        from core.model_lifecycle import model_available
        if not model_available(request.modelMode):
            raise LocalEngineError('Selected local model file is unavailable.', 'LOCAL_MODEL_MISSING')
        with self.operation():
            if self._external_active():
                raise LocalEngineError('Existing local translator is currently using its model.', 'LOCAL_OTHER_MODEL_ACTIVE')
            self._start_if_needed()
            if self.model_status(request.modelMode) == 'offline':
                raise LocalEngineError('Selected local model is not registered.', 'LOCAL_MODEL_UNAVAILABLE')
            return super().translate(request, on_delta)


def default_data_dir() -> Path:
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/OpenDeepL'
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA') or (Path.home() / 'AppData/Local')) / 'OpenDeepL'
    return Path(os.environ.get('XDG_DATA_HOME') or (Path.home() / '.local/share')) / 'OpenDeepL'


class LocalStore:
    def __init__(self, directory: Path | None = None):
        self.directory = default_data_dir() if directory is None else Path(directory)
        self.history_file = self.directory / 'history.json'
        self.glossary_file = self.directory / 'glossary.json'

    def _read(self, path: Path) -> list[dict]:
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            return data if isinstance(data, list) else []
        except FileNotFoundError:
            return []

    def _write(self, path: Path, records: list[dict]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix='.' + path.name + '-', dir=self.directory)
        try:
            if os.name != 'nt':
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as out:
                json.dump(records, out, ensure_ascii=False, indent=2)
                out.write('\n')
                out.flush()
                os.fsync(out.fileno())
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def history(self) -> list[dict]:
        return self._read(self.history_file)

    def add_history(self, request: TranslationRequest, translation: str) -> dict:
        item = {'id': str(uuid.uuid4()), 'source': request.text,
                'translation': translation, 'sourceLanguage': request.sourceLanguage,
                'targetLanguage': request.targetLanguage,
                'modelMode': request.modelMode, 'modelId': MODEL_ALIASES[request.modelMode],
                'date': datetime.now(timezone.utc).isoformat()}
        self._write(self.history_file, [item] + self.history()[:MAX_HISTORY - 1])
        return item

    def remove_history(self, item_id: str) -> None:
        self._write(self.history_file, [x for x in self.history() if x.get('id') != item_id])

    def clear_history(self) -> None:
        self._write(self.history_file, [])

    def glossary(self) -> list[dict]:
        return self._read(self.glossary_file)

    def save_glossary(self, entries: Iterable[GlossaryEntry]) -> None:
        self._write(self.glossary_file, [asdict(x) for x in entries])


def serve_stdio() -> None:
    """One JSON request per line; events are JSON lines. stderr has no user text."""
    engine = DualModelEngine()
    store = LocalStore()
    current_id: str | None = None
    def emit(value: dict) -> None:
        if current_id is not None:
            value = {'id': current_id, **value}
        print(json.dumps(value, ensure_ascii=False), flush=True)
    for line in sys.stdin:
        current_id = None
        try:
            payload = json.loads(line)
            current_id = str(payload['id']) if 'id' in payload else None
            action = payload['action']
            if action == 'health':
                # Import-time contract probe only: no router query, launch, or
                # weight access. Catches missing document dependencies early.
                from core import documents, document_batch
                emit({'type': 'ok', 'protocolVersion': 1,
                      'modelModes': list(MODEL_ALIASES)})
            elif action == 'status':
                emit({'type': 'status', 'status': engine.status()})
            elif action == 'translate':
                req = TranslationRequest.from_dict(payload['request'])
                answer = engine.translate(req, lambda delta: emit({'type': 'delta', 'text': delta}))
                item = store.add_history(req, answer)
                emit({'type': 'final', 'text': answer, 'historyId': item['id'],
                      'modelMode': req.modelMode, 'modelId': MODEL_ALIASES[req.modelMode]})
            elif action == 'translateDocument':
                from core.documents import translate_document
                try:
                    with engine.operation():
                        report = translate_document(payload['input'], payload['output'], payload.get('request'),
                                                    lambda progress: emit({'type': 'documentProgress', 'progress': progress}),
                                                    translator=engine, temporary_path=payload.get('temporary'))
                except Exception as exc:
                    # A document parser may raise an exception outside the stable
                    # TranslationError API. Still finish the JSON-line operation
                    # instead of making Electron report an unexplained process exit.
                    # Never echo exception details, which may contain document text.
                    if isinstance(exc, (TranslationError, ValueError, TypeError, KeyError, OSError)):
                        raise
                    raise TranslationError('Document processing failed unexpectedly (DOC_UNEXPECTED).') from exc
                emit({'type': 'documentFinal', 'report': report})
            elif action == 'translateDocumentBatch':
                from core.document_batch import translate_batch
                with engine.operation():
                    report = translate_batch(payload.get('jobs'), payload.get('request'), emit,
                                             translator=engine, temporary_path=payload.get('temporary'))
                emit({'type': 'documentBatchFinal', 'report': report})
            elif action == 'history':
                emit({'type': 'history', 'items': store.history()})
            elif action == 'removeHistory':
                store.remove_history(str(payload['id']))
                emit({'type': 'ok'})
            elif action == 'clearHistory':
                store.clear_history()
                emit({'type': 'ok'})
            elif action == 'glossary':
                emit({'type': 'glossary', 'items': store.glossary()})
            elif action == 'saveGlossary':
                store.save_glossary(GlossaryEntry.from_dict(x) for x in payload['items'])
                emit({'type': 'ok'})
            else:
                raise TranslationError('Unknown action.')
        except (TranslationError, ValueError, TypeError, KeyError, OSError) as exc:
            # Exception messages are deliberately fixed, without HTTP body or request text.
            message = str(exc) if isinstance(exc, TranslationError) else 'Invalid request or local data.'
            emit({'type': 'error', 'message': message,
                  **({'code': exc.code} if isinstance(exc, LocalEngineError) else {})})
        except Exception:
            # Unknown parser/library failures must also finish the protocol. Do
            # not export arbitrary exception text, traceback, or document bytes.
            emit({'type': 'error', 'message': 'Document processing failed unexpectedly (DOC_UNEXPECTED).'
                  if isinstance(payload, dict) and payload.get('action', '').startswith('translateDocument')
                  else 'Local processing failed unexpectedly (CORE_UNEXPECTED).'})


if __name__ == '__main__':
    # `python -m core.open_deepl_core` runs this module as __main__. Lazy
    # imports from core.documents must resolve the same TranslationError class;
    # otherwise document failures escape the protocol handler and exit Python.
    sys.modules['core.open_deepl_core'] = sys.modules[__name__]
    serve_stdio()

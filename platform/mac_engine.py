"""Private macOS router for OpenDeepL. Usage: python mac_engine.py start|status|stop."""
from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.environ.get('OPENDEEPL_CORE_ROOT') or str(Path(__file__).resolve().parents[1]))
from core.model_lifecycle import PORT, PRESET, RUNTIME, write_preset

PID = RUNTIME / 'dual-server.pid.json'
LOG = RUNTIME / 'dual-server.log'
LOCK = RUNTIME / 'dual-lifecycle.lock'


def _record():
    try:
        return json.loads(PID.read_text())
    except (OSError, ValueError):
        return None


def _owned_pid():
    record = _record()
    if not record:
        return None
    try:
        pid = int(record['pid'])
        if pid <= 0:
            return None
        cmd = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'args='], text=True,
                                      stderr=subprocess.DEVNULL, timeout=3)
        if str(PRESET) in cmd and f'--port {PORT}' in cmd and 'llama-server' in cmd:
            return pid
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        pass
    return None


def _models():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f'http://127.0.0.1:{PORT}/v1/models', timeout=2) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def _listener_pid():
    try:
        raw = subprocess.check_output(['/usr/sbin/lsof', '-nP', '-t',
                                       f'-iTCP@127.0.0.1:{PORT}', '-sTCP:LISTEN'],
                                      text=True, stderr=subprocess.DEVNULL, timeout=3)
        pids = {int(line) for line in raw.splitlines() if line.strip().isdigit()}
        return next(iter(pids)) if len(pids) == 1 else None
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None


def status():
    pid = _owned_pid()
    listener = _listener_pid()
    if listener is not None and listener != pid:
        return {'state': 'unmanaged-listener', 'listener_pid': listener, 'managed_pid': pid}
    data = _models() if pid and listener == pid else None
    if data:
        return {'state': 'ready', 'pid': pid, 'models': [item.get('id') for item in data.get('data', [])]}
    return {'state': 'starting' if pid else 'offline', 'pid': pid}


def start():
    before = status()
    if before['state'] == 'unmanaged-listener':
        raise RuntimeError(f'Port {PORT} belongs to another process; preserved.')
    if before['state'] == 'ready':
        return before
    if before['state'] == 'starting':
        raise RuntimeError('Own router is already starting.')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', PORT))
    binary = os.environ.get('OPENDEEPL_LLAMA_SERVER') or shutil.which('llama-server') or '/opt/homebrew/bin/llama-server'
    if not Path(binary).is_file():
        raise RuntimeError('Local llama-server binary missing.')
    write_preset()
    args = [binary, '--models-preset', str(PRESET), '--models-max', '1',
            '--host', '127.0.0.1', '--port', str(PORT), '--offline', '--no-webui',
            '--ctx-size', '8192', '--parallel', '1', '--gpu-layers', 'all',
            '--flash-attn', 'on', '--batch-size', '512', '--ubatch-size', '256',
            '--n-predict', '2048', '--jinja', '--temp', '0', '--top-k', '20',
            '--top-p', '0.6', '--repeat-penalty', '1.05', '--no-slots',
            '--cors-origins', 'localhost', '--no-cors-credentials',
            '--sleep-idle-seconds', '60', '--log-verbosity', '2']
    with LOG.open('ab', buffering=0) as log:
        os.chmod(LOG, 0o600)
        proc = subprocess.Popen(args, cwd=RUNTIME, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log, start_new_session=True)
    PID.write_text(json.dumps({'pid': proc.pid}), encoding='utf-8')
    os.chmod(PID, 0o600)
    for _ in range(600):
        if proc.poll() is not None:
            PID.unlink(missing_ok=True)
            raise RuntimeError('Own router exited during startup.')
        state = status()
        if state['state'] == 'ready':
            return state
        time.sleep(.2)
    raise RuntimeError('Own router startup timed out.')


def stop():
    pid = _owned_pid()
    if pid is None:
        return {'state': 'no-managed-process'}
    os.kill(pid, signal.SIGTERM)
    for _ in range(100):
        if _owned_pid() is None:
            PID.unlink(missing_ok=True)
            return {'state': 'stopped', 'pid': pid}
        time.sleep(.2)
    raise RuntimeError('Own router did not stop.')


def main():
    if sys.platform != 'darwin':
        return 2
    action = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if action not in ('start', 'status', 'stop'):
        return 2
    if action == 'status':
        print(json.dumps(status()))
        return 0
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with LOCK.open('a+b') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            print(json.dumps(start() if action == 'start' else stop()))
            return 0
        except (OSError, RuntimeError) as exc:
            print(str(exc), file=sys.stderr)
            return 1


if __name__ == '__main__':
    raise SystemExit(main())

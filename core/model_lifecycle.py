"""OpenDeepL-owned dual-model router configuration and operation mutex.

No weights are copied or downloaded. Both model defaults live under the
OpenDeepL data directory; explicit environment overrides may point elsewhere.
This module starts no external router.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

PORT = 18082
QUALITY_ALIAS = 'hy-mt2-7b-q8_0'
FAST_ALIAS = 'hy-mt2-1.8b-q8_0'
APP = (Path(os.environ.get('LOCALAPPDATA') or (Path.home() / 'AppData/Local')) / 'OpenDeepL'
       if sys.platform == 'win32' else Path.home() / 'Library/Application Support/OpenDeepL')
RUNTIME = APP / 'runtime'
PRESET = RUNTIME / 'dual-models.ini'
OPERATION_LOCK = RUNTIME / 'model-operation.lock'
CHECKSUM_RECEIPT = RUNTIME / 'model-checksums.json'
QUALITY = Path(os.environ.get('OPENDEEPL_QUALITY_MODEL') or APP / 'models/HY-MT2-7B-Q8_0.gguf')
FAST = Path(os.environ.get('OPENDEEPL_FAST_MODEL') or APP / 'models/Hy-MT2-1.8B-Q8_0.gguf')
TEMPLATE = Path(os.environ.get('OPENDEEPL_CHAT_TEMPLATE') or RUNTIME / 'hunyuan-translation.jinja')
EXPECTED_SIZE = {'quality': 7981928896, 'fast': 1908528192}
EXPECTED_SHA256 = {
    'quality': '58b3ad55dd6f6fa08c695cddc34fb5f8f708a844f78ae10508071914b0ed67c0',
    'fast': '5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4',
}


def model_path(mode: str) -> Path:
    if mode == 'quality':
        return QUALITY
    if mode == 'fast':
        return FAST
    raise ValueError('Unknown model mode')


def model_available(mode: str) -> bool:
    path = model_path(mode)
    try:
        return path.is_file() and path.stat().st_size == EXPECTED_SIZE[mode]
    except OSError:
        return False


def verify_weight(mode: str) -> None:
    if not model_available(mode):
        raise RuntimeError(f'{mode.title()} model file missing or size mismatch.')
    path = model_path(mode)
    stat = path.stat()
    identity = {'path': str(path.resolve()), 'size': stat.st_size,
                'mtime_ns': stat.st_mtime_ns, 'ctime_ns': stat.st_ctime_ns,
                'dev': stat.st_dev, 'ino': stat.st_ino}
    try:
        receipt = json.loads(CHECKSUM_RECEIPT.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        receipt = {}
    if (isinstance(receipt, dict) and
            receipt.get(mode) == {**identity, 'sha256': EXPECTED_SHA256[mode]}):
        return
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != EXPECTED_SHA256[mode]:
        raise RuntimeError(f'{mode.title()} model checksum mismatch.')
    # Detect replacement during the hash; neither publish a receipt nor load
    # weights if the inode or timestamp changed under us.
    after = path.stat()
    if (str(path.resolve()) != identity['path'] or after.st_size != stat.st_size or
            after.st_mtime_ns != stat.st_mtime_ns or after.st_ctime_ns != stat.st_ctime_ns or
            after.st_dev != stat.st_dev or after.st_ino != stat.st_ino):
        raise RuntimeError(f'{mode.title()} model changed during verification.')
    RUNTIME.mkdir(parents=True, exist_ok=True)
    receipt = receipt if isinstance(receipt, dict) else {}
    receipt[mode] = {**identity, 'sha256': EXPECTED_SHA256[mode]}
    fd, temporary = tempfile.mkstemp(prefix='.model-checksums-', dir=RUNTIME)
    try:
        if sys.platform != 'win32':
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(receipt, out, sort_keys=True)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, CHECKSUM_RECEIPT)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_preset() -> None:
    verify_weight('quality')
    if not TEMPLATE.is_file():
        raise RuntimeError('Quality model chat template missing.')
    RUNTIME.mkdir(parents=True, exist_ok=True)
    sections = [
        'version = 1',
        f'[{QUALITY_ALIAS}]',
        f'model = {QUALITY}',
        f'alias = {QUALITY_ALIAS}',
        'load-on-startup = false',
        f'chat-template-file = {TEMPLATE}',
        'override-kv = tokenizer.ggml.eos_token_id=int:127960',
    ]
    # Absence is represented honestly in inventory and translation errors. Do
    # not register a dangling fast preset that would trigger an upstream lookup.
    if model_available('fast'):
        verify_weight('fast')
        sections += ['', f'[{FAST_ALIAS}]', f'model = {FAST}',
                     f'alias = {FAST_ALIAS}', 'load-on-startup = false']
    temporary = PRESET.with_suffix('.ini.tmp')
    temporary.write_text('\n'.join(sections) + '\n', encoding='utf-8')
    os.replace(temporary, PRESET)


@contextmanager
def operation_lock():
    """Cross-process lock held through a complete model stream/document job."""
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with OPERATION_LOCK.open('a+b') as handle:
        if sys.platform == 'win32':
            import msvcrt
            handle.seek(0)
            handle.write(b'0')
            handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

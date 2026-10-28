#!/usr/bin/env python3
"""Read only AXSelectedText from the system-wide focused macOS element."""
import json
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 1:
        print(json.dumps({'error': 'unsupported', 'message': 'Run without arguments.'}))
        return 4
    helper = Path(__file__).resolve().with_name('selection-macos')
    if not helper.is_file():
        print(json.dumps({'error': 'unsupported', 'message': 'Build platform/selection-macos from SelectionMac.swift first.'}))
        return 4
    try:
        result = subprocess.run([str(helper)], stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False)
        payload = json.loads(result.stdout.decode('utf-8'))
        if not isinstance(payload, dict) or not ({'text', 'error'} & payload.keys()):
            raise ValueError('Invalid helper response')
        print(json.dumps(payload, ensure_ascii=False))
        return result.returncode
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'error': 'internal_error', 'message': f'Selection helper failed: {type(exc).__name__}'}))
        return 5


if __name__ == '__main__':
    raise SystemExit(main())

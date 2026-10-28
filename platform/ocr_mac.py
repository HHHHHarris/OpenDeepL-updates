#!/usr/bin/env python3
"""Apple Vision OCR; no remote service or model downloads."""
import json
from pathlib import Path
import subprocess
import sys
if len(sys.argv) != 2:
    raise SystemExit(2)
helper = Path(__file__).resolve().with_name('ocr-macos')
result = subprocess.run([str(helper), sys.argv[1]], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, timeout=25, check=False)
if result.returncode:
    raise SystemExit(1)
data = json.loads(result.stdout)
print(json.dumps({'text': str(data['text'])}, ensure_ascii=False))

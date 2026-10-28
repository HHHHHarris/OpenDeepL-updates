#!/bin/sh
set -eu
# Provisioning only: the runtime OCR helper never fetches weights or calls the network.
DEST=${OPENDEEPL_OCR_PYTHON_HOME:-"$HOME/Library/Application Support/OpenDeepL/python"}
PYTHON=${OPENDEEPL_BOOTSTRAP_PYTHON:-python3}
if [ ! -x "$DEST/bin/python" ]; then "$PYTHON" -m venv "$DEST"; fi
if [ -f /etc/ssl/cert.pem ]; then export PIP_CERT=/etc/ssl/cert.pem; fi
"$DEST/bin/python" -m pip install --disable-pip-version-check --no-input --index-url https://pypi.org/simple \
  'rapidocr-onnxruntime==1.4.4' 'onnxruntime==1.31.0' 'numpy==2.5.4' \
  'opencv-python==5.0.0.93' 'pyclipper==1.4.0' 'shapely==2.2.0' \
  'PyYAML==6.0.3' 'Pillow==13.0.0' 'six==1.17.0' 'tqdm==4.70.1' \
  'flatbuffers==25.12.19' 'packaging==26.3' 'protobuf==7.36.2'
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$DEST/bin/python" "$ROOT/platform/ocr_rapid.py" "$ROOT/Tests/fixtures/ocr-sample.png" >/dev/null
printf 'OCR Python: %s\n' "$DEST/bin/python"

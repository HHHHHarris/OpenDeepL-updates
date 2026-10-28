#!/bin/sh
set -eu
# Private runtime only; never installs into system Python or downloads model weights.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST=${OPENDEEPL_DOCUMENT_PYTHON_HOME:-"$HOME/Library/Application Support/OpenDeepL/python"}
PYTHON=${OPENDEEPL_BOOTSTRAP_PYTHON:-python3}
"$PYTHON" -m venv "$DEST"
if [ -f /etc/ssl/cert.pem ]; then
  export PIP_CERT=/etc/ssl/cert.pem
fi
"$DEST/bin/python" -m pip install --disable-pip-version-check --no-input --index-url https://pypi.org/simple 'PyMuPDF==1.28.2' 'lxml==6.1.3'
"$DEST/bin/python" -c 'import pymupdf; print("PyMuPDF", pymupdf.__version__)'
printf 'Document Python: %s\n' "$DEST/bin/python"

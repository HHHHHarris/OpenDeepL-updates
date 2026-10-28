#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
PYTHONPATH=. "${PYTHON:-python3}" -m unittest discover -s Tests -p 'test_core.py' -v

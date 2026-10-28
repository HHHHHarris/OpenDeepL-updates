#!/bin/sh
# One-time, project-only PEM identity. No Keychain or trust-store operations.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RCODESIGN=${OPENDEEPL_RCODESIGN:-$(command -v rcodesign || true)}
DIR="$HOME/Library/Application Support/OpenDeepL/build-signing"
[ "$(uname -s)" = Darwin ] || { echo 'macOS required' >&2; exit 2; }
[ -n "$RCODESIGN" ] && [ -x "$RCODESIGN" ] || { echo 'rcodesign is missing; set OPENDEEPL_RCODESIGN or add rcodesign 0.29.0 to PATH.' >&2; exit 2; }
umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
if [ -e "$DIR/local.crt" ] || [ -e "$DIR/local.key" ]; then
  [ -f "$DIR/local.crt" ] && [ -f "$DIR/local.key" ] || { echo 'Partial signing identity; inspect it before retrying.' >&2; exit 3; }
  echo 'Reusing existing OpenDeepL local identity.'
else
  "$RCODESIGN" generate-self-signed-certificate --config-file /dev/null \
    --profile apple-development --person-name 'OpenDeepL Local Build' \
    --validity-days 3650 --pem-filename "$DIR/local"
  chmod 600 "$DIR/local.crt" "$DIR/local.key"
  echo 'Created OpenDeepL local identity.'
fi
/usr/bin/openssl x509 -in "$DIR/local.crt" -noout -fingerprint -sha256

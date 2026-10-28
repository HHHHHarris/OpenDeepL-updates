#!/bin/sh
# Sign the entire nested app using one stable project-only PEM identity.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RCODESIGN=${OPENDEEPL_RCODESIGN:-$(command -v rcodesign || true)}
APP=${1:-}
[ -n "$APP" ] && [ -d "$APP/Contents" ] || { echo 'Usage: sign_macos.sh APP_BUNDLE' >&2; exit 2; }
[ -n "$RCODESIGN" ] && [ -x "$RCODESIGN" ] || { echo 'rcodesign is missing; set OPENDEEPL_RCODESIGN or add rcodesign 0.29.0 to PATH.' >&2; exit 2; }
SIGNING_DIR="$HOME/Library/Application Support/OpenDeepL/build-signing"
CERT=${OPENDEEPL_SIGNING_CERT:-"$SIGNING_DIR/local.crt"}
KEY=${OPENDEEPL_SIGNING_KEY:-"$SIGNING_DIR/local.key"}
[ -r "$CERT" ] && [ -r "$KEY" ] || { echo 'Local signing identity missing. Run scripts/setup_local_signing.sh.' >&2; exit 3; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/opendeepl-sign.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
HASH=$(/usr/bin/openssl x509 -in "$CERT" -noout -fingerprint -sha1 | sed 's/^.*=//; s/://g' | tr 'A-F' 'a-f')
[ "${#HASH}" -eq 40 ] || { echo 'Invalid signing certificate fingerprint.' >&2; exit 3; }
MAIN_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
HELPER="$APP/Contents/Helpers/OpenDeepLContextService.app"
[ -d "$HELPER" ] || { echo 'OpenDeepL context helper missing.' >&2; exit 3; }
HELPER_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$HELPER/Contents/Info.plist")
[ "$MAIN_ID" = org.opendeepl.desktop ] && [ "$HELPER_ID" = org.opendeepl.desktop.contextservice ] || { echo 'Unexpected bundle identifier.' >&2; exit 3; }
# A self-signed anchor is the certificate itself. Pin the anchor, not just the identifier.
/usr/bin/csreq -r "=identifier \"$MAIN_ID\" and anchor H\"$HASH\"" -b "$TMP/main.req"
/usr/bin/csreq -r "=identifier \"$HELPER_ID\" and anchor H\"$HASH\"" -b "$TMP/helper.req"
"$RCODESIGN" sign --config-file /dev/null --pem-file "$CERT" --pem-file "$KEY" \
  --timestamp-url none \
  --code-requirements-file "$TMP/main.req" \
  --code-requirements-file "Contents/Helpers/OpenDeepLContextService.app:$TMP/helper.req" \
  "$APP"
/usr/bin/codesign --verify --deep --strict "$APP"
/usr/bin/codesign --verify --strict "$HELPER"
echo "Signing certificate SHA-256: $(/usr/bin/openssl x509 -in "$CERT" -noout -fingerprint -sha256 | sed 's/^.*=//')"
/usr/bin/codesign -d -r- "$APP" 2>&1 | grep '^designated =>'
/usr/bin/codesign -d -r- "$HELPER" 2>&1 | grep '^designated =>'

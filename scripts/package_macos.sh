#!/bin/sh
# Package a verified staged App. Production signing/notarization is a separate gate.
set -eu
APP=${1:?Usage: package_macos.sh /absolute/OpenDeepL.app /absolute/output.dmg}
OUTPUT=${2:?Missing output DMG}
case "$APP:$OUTPUT" in /*:/*.dmg) ;; *) echo 'Use absolute App and .dmg paths.' >&2; exit 2;; esac
[ -d "$APP/Contents" ] || { echo 'Missing App bundle.' >&2; exit 2; }
[ ! -e "$OUTPUT" ] || { echo 'Output exists; preserve it or choose another name.' >&2; exit 2; }
ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
[ "$ID" = org.opendeepl.desktop ] || { echo 'Unexpected bundle identifier.' >&2; exit 2; }
/usr/bin/codesign --verify --deep --strict "$APP"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/OpenDeepL-dmg.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
/usr/bin/ditto "$APP" "$STAGE/OpenDeepL.app"
ln -s /Applications "$STAGE/Applications"
printf '%s\n' 'OpenDeepL' '' 'Drag OpenDeepL into Applications, then open it.' 'The first launch checks bundled components and guides model preparation.' 'Internet access is used for model downloads and optional application updates.' 'Translation and document processing use local models.' > "$STAGE/Read me.txt"
mkdir -p "$(dirname "$OUTPUT")"
/usr/bin/hdiutil create -volname OpenDeepL -srcfolder "$STAGE" -fs HFS+ -format UDZO "$OUTPUT"
/usr/bin/hdiutil verify "$OUTPUT"
printf 'Verified disk image: %s\n' "$OUTPUT"

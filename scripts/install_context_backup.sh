#!/bin/sh
# Build a UI-less Services provider inside an OpenDeepL bundle. This script
# never touches another app's Services or privacy settings.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
[ "$(uname -s)" = Darwin ] || { echo 'macOS required' >&2; exit 2; }
MODE=${1:-}
APP=${2:-}
[ -n "$APP" ] && [ -d "$APP/Contents" ] || { echo 'Usage: install_context_backup.sh build|register APP_BUNDLE' >&2; exit 2; }
HELPER="$APP/Contents/Helpers/OpenDeepLContextService.app"
case "$MODE" in
  build)
    [ -f "$ROOT/platform/ContextServiceMac.swift" ] || exit 2
    mkdir -p "$HELPER/Contents/MacOS"
    /usr/bin/swiftc -O -framework AppKit "$ROOT/platform/ContextServiceMac.swift" -o "$HELPER/Contents/MacOS/OpenDeepLContextService"
    PLIST="$HELPER/Contents/Info.plist"
    cat > "$PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.opendeepl.desktop.contextservice</string>
<key>CFBundleName</key><string>OpenDeepLContextService</string>
<key>CFBundleDisplayName</key><string>OpenDeepL 选中文本服务</string>
<key>CFBundleExecutable</key><string>OpenDeepLContextService</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSServices</key><array><dict>
<key>NSMenuItem</key><dict><key>default</key><string>用 OpenDeepL 翻译</string></dict>
<key>NSMessage</key><string>translateSelection</string>
<key>NSPortName</key><string>OpenDeepLContextService</string>
<key>NSRequiredContext</key><dict/>
<key>NSSendTypes</key><array><string>public.utf8-plain-text</string><string>NSStringPboardType</string></array>
</dict></array>
</dict></plist>
PLIST
    /usr/bin/plutil -lint "$PLIST" >/dev/null
    echo "Built helper: $HELPER (sign the containing app after this step)"
    ;;
  register)
    [ -x "$HELPER/Contents/MacOS/OpenDeepLContextService" ] || { echo 'Build helper first' >&2; exit 2; }
    LSREGISTER='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    "$LSREGISTER" -f "$HELPER"
    /usr/bin/swift -e 'import AppKit; NSUpdateDynamicServices()'
    echo 'Registered OpenDeepL selection Service; inspect the Services menu in a text-selection app.'
    ;;
  *) echo 'Usage: install_context_backup.sh build|register APP_BUNDLE' >&2; exit 2 ;;
esac

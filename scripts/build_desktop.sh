#!/bin/sh
# Native macOS bundle from the workspace-local pinned Electron binary.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
[ "$(uname -s)" = Darwin ] || { echo 'Run this builder on macOS.' >&2; exit 2; }
TEST_MODE=${OPENDEEPL_TEST_MODE:-0}
if [ "$TEST_MODE" = 1 ]; then
  case "$HOME" in /tmp/opendeepl-sign-rollback-*|/private/tmp/opendeepl-sign-rollback-*) ;;
    *) echo 'Signing rollback test mode requires an isolated temporary HOME.' >&2; exit 2 ;;
  esac
fi
[ -f "$ROOT/ui/index.html" ] || { echo 'Missing ui/index.html.' >&2; exit 2; }
SOURCE="$ROOT/node_modules/electron/dist/Electron.app"
[ -d "$SOURCE" ] || { echo 'Run npm ci first.' >&2; exit 2; }
MODE=install
if [ "${1:-}" = --output ]; then
  [ "$#" -eq 2 ] || { echo 'Usage: build_desktop.sh [--output /absolute/path/OpenDeepL.app]' >&2; exit 2; }
  DEST=$2
  MODE=output
elif [ "$#" -eq 0 ] && [ -n "${OPENDEEPL_DEST:-}" ]; then
  DEST=$OPENDEEPL_DEST
  MODE=output
elif [ "$#" -eq 0 ]; then
  DEST="$HOME/Applications/OpenDeepL.app"
else
  echo 'Usage: build_desktop.sh [--output /absolute/path/OpenDeepL.app]' >&2
  exit 2
fi
case "$DEST" in /*.app) ;; *) echo 'Destination must be an absolute .app path.' >&2; exit 2 ;; esac
if [ "$MODE" = output ] && [ "$DEST" = "$HOME/Applications/OpenDeepL.app" ]; then
  echo 'Use a separate staging path for --output.' >&2
  exit 3
fi
if [ "$MODE" = output ] && [ -e "$DEST" ]; then
  echo 'Output destination already exists; choose a fresh path.' >&2
  exit 3
fi
DEST_DIR=$(dirname "$DEST")
mkdir -p "$DEST_DIR"
STAGE="$DEST_DIR/.OpenDeepL.staging.$$.app"
[ ! -e "$STAGE" ] || { echo 'Staging path exists.' >&2; exit 3; }
BACKUP=''
NEW_MOVED=0
cleanup() {
  STATUS=$?
  trap - EXIT HUP INT TERM
  if [ "$STATUS" -ne 0 ] && [ "$MODE" = install ] && [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    if [ "$NEW_MOVED" -eq 1 ] && [ -d "$DEST" ]; then
      FAILED="${BACKUP%.app.rollback}.failed.app.rollback"
      if mv "$DEST" "$FAILED"; then
        echo "Failed new bundle retained for inspection: $FAILED" >&2
      else
        echo "Failed to move new bundle aside: $DEST" >&2
      fi
    fi
    if [ ! -e "$DEST" ]; then
      if mv "$BACKUP" "$DEST"; then
        if [ "$TEST_MODE" != 1 ]; then
          LSREGISTER='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
          "$LSREGISTER" -f "$DEST" || true
          if [ -d "$DEST/Contents/Helpers/OpenDeepLContextService.app" ]; then
            "$LSREGISTER" -f "$DEST/Contents/Helpers/OpenDeepLContextService.app" || true
          fi
          /usr/bin/swift -e 'import AppKit; NSUpdateDynamicServices()' >/dev/null 2>&1 || true
        fi
        echo "Restored previous App after failed install: $DEST" >&2
      else
        echo "Automatic restore failed; previous App remains at: $BACKUP" >&2
      fi
    else
      echo "Install failed; previous App remains at: $BACKUP" >&2
    fi
  fi
  rm -rf "$STAGE"
  exit "$STATUS"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
/usr/bin/ditto "$SOURCE" "$STAGE"
APPROOT="$STAGE/Contents/Resources/app"
mkdir -p "$APPROOT"
# Electron's distributed license notices accompany the staged application.
for NOTICE in LICENSE LICENSES.chromium.html; do
  if [ -f "$ROOT/node_modules/electron/dist/$NOTICE" ]; then
    cp "$ROOT/node_modules/electron/dist/$NOTICE" "$STAGE/Contents/Resources/$NOTICE"
  fi
done
for item in core electron ui platform assets; do
  if [ -d "$ROOT/$item" ]; then
    /usr/bin/ditto "$ROOT/$item" "$APPROOT/$item"
  fi
done
cp "$ROOT/package.json" "$APPROOT/package.json"
mkdir -p "$STAGE/Contents/Helpers"
/usr/bin/swiftc -O -framework AppKit -framework ApplicationServices "$ROOT/platform/DoubleCopyMac.swift" -o "$STAGE/Contents/Helpers/double-copy-macos"
/usr/bin/swiftc -O -framework AppKit -framework Vision "$ROOT/platform/SelectionMac.swift" -o "$APPROOT/platform/selection-macos"
/usr/bin/swiftc -O -framework AppKit -framework Vision "$ROOT/platform/OCRMac.swift" -o "$APPROOT/platform/ocr-macos"
"$ROOT/scripts/install_context_backup.sh" build "$STAGE"
find "$APPROOT" -type d -name __pycache__ -prune -exec rm -rf '{}' +
PLIST="$STAGE/Contents/Info.plist"
[ -f "$ROOT/assets/AppIcon.icns" ] || { echo "Missing assets/AppIcon.icns." >&2; exit 2; }
cp "$ROOT/assets/AppIcon.icns" "$STAGE/Contents/Resources/AppIcon.icns"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier org.opendeepl.desktop' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName OpenDeepL' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile AppIcon.icns' "$PLIST"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName OpenDeepL' "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string OpenDeepL' "$PLIST"
VERSION=$(cd "$ROOT" && node -p 'require("./package.json").version')
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
if [ -n "${OPENDEEPL_BUILD_TAG:-}" ]; then
  case "$OPENDEEPL_BUILD_TAG" in *[!A-Za-z0-9._-]*) echo 'Invalid OPENDEEPL_BUILD_TAG.' >&2; exit 2 ;; esac
  /usr/libexec/PlistBuddy -c "Add :OpenDeepLBuildTag string $OPENDEEPL_BUILD_TAG" "$PLIST"
fi
# Electron's packaged helper plists omit CFBundleExecutable. rcodesign's nested
# bundle sealing requires it, so complete only the staged copies before signing.
for HELPER_APP in "$STAGE"/Contents/Frameworks/Electron\ Helper*.app; do
  [ -d "$HELPER_APP" ] || continue
  HELPER_EXEC=$(basename "$HELPER_APP" .app)
  HELPER_PLIST="$HELPER_APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $HELPER_EXEC" "$HELPER_PLIST" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $HELPER_EXEC" "$HELPER_PLIST"
done
"$ROOT/scripts/sign_macos.sh" "$STAGE"

requirement() {
  /usr/bin/codesign -d -r- "$1" 2>&1 | sed -n 's/^designated => //p'
}
verify_two_way() {
  OLD=$1 NEW=$2 LABEL=$3
  OLD_REQ=$(requirement "$OLD")
  NEW_REQ=$(requirement "$NEW")
  [ -n "$OLD_REQ" ] && [ -n "$NEW_REQ" ] || { echo "Missing $LABEL designated requirement." >&2; exit 4; }
  case "$NEW_REQ" in *'certificate root = H"'*'"'*) ;; *) echo "New $LABEL requirement lacks certificate anchor." >&2; exit 4 ;; esac
  /usr/bin/codesign --verify --strict -R="$OLD_REQ" "$NEW" || { echo "New $LABEL fails old designated requirement." >&2; exit 4; }
  /usr/bin/codesign --verify --strict -R="$NEW_REQ" "$OLD" || { echo "Old $LABEL fails new designated requirement." >&2; exit 4; }
  echo "$LABEL designated requirements match both directions."
}
CURRENT="$HOME/Applications/OpenDeepL.app"
if [ -d "$CURRENT" ]; then
  CURRENT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CURRENT/Contents/Info.plist" 2>/dev/null || true)
  [ "$CURRENT_ID" = org.opendeepl.desktop ] || { echo 'Installed app has a different identifier.' >&2; exit 4; }
  CURRENT_REQ=$(requirement "$CURRENT")
  case "$CURRENT_REQ" in
    *'certificate root = H"'*)
      verify_two_way "$CURRENT" "$STAGE" 'outer app'
      verify_two_way "$CURRENT/Contents/Helpers/OpenDeepLContextService.app" "$STAGE/Contents/Helpers/OpenDeepLContextService.app" 'context helper'
      verify_two_way "$CURRENT/Contents/Helpers/double-copy-macos" "$STAGE/Contents/Helpers/double-copy-macos" 'double-copy native tool'
      ;;
    *) echo 'Existing app uses a different signing class; first certificate-signed install can require one privacy reauthorization.' ;;
  esac
fi
if [ "$MODE" = install ] && [ -e "$DEST" ]; then
  OLD_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist" 2>/dev/null || true)
  [ "$OLD_ID" = org.opendeepl.desktop ] || { echo 'Existing destination belongs to a different app.' >&2; exit 3; }
  if [ "$TEST_MODE" = 1 ]; then BACKUP_DIR="$HOME/rollback-evidence"
  else BACKUP_DIR="$ROOT/evidence/app-backups"; fi
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/OpenDeepL.backup.$(date +%Y%m%d-%H%M%S)-$$.app.rollback"
  if [ "$TEST_MODE" != 1 ]; then
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$DEST" || true
    if [ -d "$DEST/Contents/Helpers/OpenDeepLContextService.app" ]; then
      /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$DEST/Contents/Helpers/OpenDeepLContextService.app" || true
    fi
  fi
  mv "$DEST" "$BACKUP"
  echo "Previous own bundle: $BACKUP"
fi
mv "$STAGE" "$DEST"
NEW_MOVED=1
if [ "$MODE" = install ]; then
  if [ "$TEST_MODE" = 1 ]; then
    if [ "${OPENDEEPL_TEST_FAIL_REGISTER:-0}" = 1 ]; then
      echo 'Injected Services registration failure in isolated test mode.' >&2
      exit 97
    fi
  else
    "$ROOT/scripts/install_context_backup.sh" register "$DEST"
  fi
  echo "Installed: $DEST"
else
  echo "Staged and verified, not installed: $DEST"
fi
trap - EXIT HUP INT TERM

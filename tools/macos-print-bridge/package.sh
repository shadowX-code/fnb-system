#!/bin/sh
set -eu
# Build on Apple silicon with Apple Command Line Tools and the pinned build dependencies.
[ "$(uname -sm)" = "Darwin arm64" ]
"${FEEDX_BRIDGE_BUILD_PYTHON:-python3}" -c 'import sys; assert sys.version_info[:2] == (3, 13), "Build with supported Python 3.13"'
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$root/public/downloads}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
name='FeedX Print Bridge Staging'
mkdir "$work/payload"
# PyInstaller bundles Python, OpenSSL and certifi for the operator.
export PYINSTALLER_CONFIG_DIR="$work/cache"
"${FEEDX_BRIDGE_BUILD_PYTHON:-python3}" -m PyInstaller --noconfirm --windowed --onedir \
  --name "$name" --osx-bundle-identifier my.feedx.staging.print-bridge \
  --distpath "$work/payload" --workpath "$work/build" --specpath "$work" \
  "$root/tools/macos-print-bridge/setup_app.py"
app="$work/payload/$name.app"
# A separate executable lets LaunchServices open the GUI while launchd runs the worker.
cp "$app/Contents/MacOS/$name" "$app/Contents/MacOS/feedx-worker"
xcrun clang -mmacosx-version-min=12.0 -fobjc-arc -framework Foundation -framework IOBluetooth \
  "$root/tools/macos-print-bridge/D520RFCOMM.m" -o "$app/Contents/Resources/d520-rfcomm"
/usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' -c 'Add :LSMinimumSystemVersion string 12.0' \
  -c 'Add :NSBluetoothAlwaysUsageDescription string Connect to the selected FeedX label printer.' \
  -c 'Add :CFBundleURLTypes array' -c 'Add :CFBundleURLTypes:0 dict' \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLName string my.feedx.staging.print-bridge' \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' \
  -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string feedx-printer-staging' "$app/Contents/Info.plist"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/$name" --self-test
"$app/Contents/MacOS/feedx-worker" --self-test
# The PyInstaller onedir sibling is build output. Only the Finder app is installed.
rm -rf "$work/payload/$name"
pkgbuild --root "$work/payload" --install-location /Applications --identifier my.feedx.staging.print-bridge \
  --version 1.1.2 "$out/FeedX-Print-Bridge-Staging-macOS-arm64.pkg"

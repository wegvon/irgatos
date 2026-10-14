#!/usr/bin/env bash
# Compile src-tauri/macos/AppIcon.icon into the Assets.car that macOS 26 reads
# through CFBundleIconName. Only actool can produce that file, so this step is
# macOS-only; scripts/build-app-icons.py regenerates everything else anywhere.
#
# Run this after changing the icon and commit the result.
set -euo pipefail

cd "$(dirname "$0")/.."
ICON_SOURCE="src-tauri/macos/AppIcon.icon"
OUTPUT="src-tauri/macos/Assets.car"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "actool only exists on macOS; run this on the Mac that cuts the release." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -R "$ICON_SOURCE" "$WORK/AppIcon.icon"
xcrun actool "$WORK/AppIcon.icon" \
  --compile "$WORK/out" \
  --app-icon AppIcon \
  --include-all-app-icons \
  --platform macosx \
  --minimum-deployment-target 11.0 \
  --output-partial-info-plist "$WORK/partial.plist" \
  --errors --warnings

if [[ ! -f "$WORK/out/Assets.car" ]]; then
  echo "actool produced no Assets.car; inspect $WORK" >&2
  exit 1
fi

cp "$WORK/out/Assets.car" "$OUTPUT"
echo "wrote $OUTPUT ($(stat -f%z "$OUTPUT") bytes)"
assetutil --info "$OUTPUT" | grep -i -m 5 'Name\|SizeOnDisk' || true

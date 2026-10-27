#!/bin/bash
# Build this checkout and replace only the application bundle, never user data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Bu komut yalnızca macOS içindir." >&2
  exit 1
fi
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --build-only ) ]]; then
  echo "Kullanım: npm run update:local -- [--build-only]" >&2
  exit 1
fi

echo "Irgatos güncelleniyor. Bu pencereyi açık bırak."
mkdir -p target
BUILD_LOG="$ROOT/target/local-update-build.log"
for tool in node npm cargo rustc; do
  command -v "$tool" >/dev/null || { echo "Eksik araç: $tool" >&2; exit 1; }
done

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [[ -z "$SIGNING_IDENTITY" && -f "$HOME/.irgatos/macos-signing-identity" ]]; then
  SIGNING_IDENTITY="$(tr -d '\r\n' < "$HOME/.irgatos/macos-signing-identity")"
fi
if [[ -z "$SIGNING_IDENTITY" || "$SIGNING_IDENTITY" == - ]]; then
  echo "Kalıcı kod imzası bulunamadı. APPLE_SIGNING_IDENTITY ayarla veya yerel imza sertifikasını kur; geçici imza macOS izinlerini sıfırlar." >&2
  exit 1
fi
SIGNING_CONFIG="$(node -e 'process.stdout.write(JSON.stringify({bundle:{createUpdaterArtifacts:false,macOS:{signingIdentity:process.argv[1]}}}))' "$SIGNING_IDENTITY")"

# Reuse dependencies only when this helper has installed the exact lockfile.
LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d ' ' -f 1)"
STAMP=node_modules/.irgatos-local-lock
if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$LOCK_HASH" ]]; then
  echo "Gerekli bileşenler hazırlanıyor..."
  if ! npm ci > "$BUILD_LOG" 2>&1; then
    tail -n 20 "$BUILD_LOG"
    exit 1
  fi
  printf '%s\n' "$LOCK_HASH" > "$STAMP"
fi
npm run version:check >> "$BUILD_LOG" 2>&1
VERSION="$(node -p "require('./package.json').version")"
echo "Kurulacak sürüm: Irgatos $VERSION"
export CARGO_TARGET_DIR="$ROOT/target"
# Build for this Mac, independent of any default cross-compilation target.
HOST="$(rustc -vV | sed -n 's/^host: //p')"
[[ "$HOST" == *-apple-darwin ]] || exit 1
echo "Güncel uygulama hazırlanıyor. İlk sefer birkaç dakika sürebilir..."
if ! npm run tauri -- build --target "$HOST" --bundles app \
  --config "$SIGNING_CONFIG" \
  >> "$BUILD_LOG" 2>&1; then
  echo "Derleme tamamlanamadı. Kurulu uygulaman korundu. Ayrıntılar: $BUILD_LOG" >&2
  tail -n 20 "$BUILD_LOG"
  exit 1
fi

BUILT="$CARGO_TARGET_DIR/$HOST/release/bundle/macos/Irgatos.app"
ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUILT/Contents/Info.plist")
[[ "$ID" == com.irgatos.desktop ]] || { echo "Beklenmeyen uygulama kimliği: $ID" >&2; exit 1; }
codesign --verify --deep --strict "$BUILT"
SIGNING_DETAILS="$(codesign --display --verbose=2 -r- "$BUILT" 2>&1)"
if [[ "$SIGNING_DETAILS" == *"Signature=adhoc"* ]]; then
  echo "Derleme kalıcı sertifikayla imzalanmamış; kurulu uygulama korundu." >&2
  exit 1
fi
DEST=/Applications/Irgatos.app
if [[ -d "$DEST" ]]; then
  INSTALLED_SIGNATURE="$(codesign --display --verbose=2 -r- "$DEST" 2>&1)"
  if [[ "$INSTALLED_SIGNATURE" != *"Signature=adhoc"* ]]; then
    REQUIREMENT="$(printf '%s\n' "$INSTALLED_SIGNATURE" | sed -n -E 's/^(# )?designated => //p')"
    if [[ -z "$REQUIREMENT" ]] || ! codesign --verify --deep --strict -R "=$REQUIREMENT" "$BUILT"; then
      echo "Güncellemenin imza kimliği kurulu uygulamayla uyuşmuyor; kurulu uygulama korundu." >&2
      exit 1
    fi
  fi
fi
if [[ "${1:-}" == --build-only ]]; then
  echo "Derleme doğrulandı: $BUILT"
  exit 0
fi

if [[ ! -w /Applications ]]; then
  echo "/Applications yazılabilir değil. Hazır uygulama: $BUILT" >&2
  exit 1
fi
# Never terminate active agent sessions or terminals automatically.
if pgrep -f '/Irgatos[.]app/Contents/MacOS/' >/dev/null; then
  echo "Derleme hazır. Çalışmalarını kaydet ve Irgatos'u Cmd+Q ile kapat."
  if [[ ! -t 0 ]]; then
    echo "Kapattıktan sonra komutu Terminal'de yeniden çalıştır." >&2
    exit 1
  fi
  read -r -p "Kapattıktan sonra Enter'a bas: "
  if pgrep -f '/Irgatos[.]app/Contents/MacOS/' >/dev/null; then
    echo "Irgatos hâlâ açık. Kurulu uygulamaya dokunulmadı." >&2
    exit 1
  fi
fi
if [[ -e "$DEST" ]]; then
  OLD_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DEST/Contents/Info.plist")
  [[ "$OLD_ID" == com.irgatos.desktop ]] || exit 1
fi

# Every build bundle registers com.irgatos.desktop with Launch Services and
# stays registered after its worktree is deleted. Notification Center can then
# draw banners with a long-gone bundle's icon, so forget every registration
# outside /Applications and register the fresh install again.
refresh_launch_services() {
  local lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [[ -x "$lsregister" ]] || return 0
  "$lsregister" -dump 2>/dev/null | awk '
    function flush() { if (id == "com.irgatos.desktop" && path != "") print path; path = ""; id = "" }
    /^-----/ { flush(); next }
    /^path:/ { sub(/^path:[ \t]+/, ""); sub(/ \(0x[0-9a-f]+\)$/, ""); path = $0; next }
    /^identifier:/ { sub(/^identifier:[ \t]+/, ""); sub(/ \(0x[0-9a-f]+\)$/, ""); id = $0; next }
    END { flush() }
  ' | sort -u | while IFS= read -r registered; do
    [[ "$registered" == /Applications/* ]] && continue
    "$lsregister" -u "$registered" >/dev/null 2>&1 || true
  done
  "$lsregister" -f "$1" >/dev/null 2>&1 || true
}

STAGE="$(mktemp -d /Applications/.irgatos-update.XXXXXX)"
BACKUP=""
cleanup() {
  status=$?
  if [[ -n "$BACKUP" && ! -e "$DEST" && -d "$BACKUP" ]]; then
    mv "$BACKUP" "$DEST" || echo "Eski uygulama burada: $BACKUP" >&2
  fi
  rm -rf "$STAGE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ditto "$BUILT" "$STAGE/Irgatos.app"
codesign --verify --deep --strict "$STAGE/Irgatos.app"
if [[ -e "$DEST" ]]; then
  BACKUP="/Applications/Irgatos-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$DEST" "$BACKUP"
fi
mv "$STAGE/Irgatos.app" "$DEST"
refresh_launch_services "$DEST"
echo "Irgatos $VERSION kuruldu. Sohbetler ve ayarlar korundu."
[[ -z "$BACKUP" ]] || echo "Önceki uygulama: $BACKUP"
open "$DEST"

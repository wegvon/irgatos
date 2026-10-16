set -eu
umask 077
BASE="$HOME/.irgat-host"
ENTRY="$BASE/bin/irgat-host"
VERSION=@@VERSION@@
NODE_VERSION=@@NODE_VERSION@@
HOST_SHA256=@@HOST_SHA256@@
EXISTED=0
[ -x "$ENTRY" ] && EXISTED=1
FORCE_UPGRADE=${IRGAT_HOST_FORCE_UPGRADE:-0}
HOST_PORT=${IRGAT_HOST_PORT:-3774}

if [ ! -x "$ENTRY" ] || [ "$FORCE_UPGRADE" = 1 ]; then
  case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) echo 'Irgatos Host supports Linux and macOS.' >&2; exit 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) echo 'Unsupported host architecture.' >&2; exit 1 ;; esac
  case "$OS-$ARCH" in
@@NODE_SHA256@@
  esac
  NODE_STEM="node-v$NODE_VERSION-$OS-$ARCH"
  mkdir -p "$BASE/runtime" "$BASE/bin"
  TMP=$(mktemp -d "$BASE/runtime/.install.XXXXXXXX")
  trap 'rm -rf "$TMP"' EXIT
  trap 'exit 130' HUP INT TERM
  download() {
    if command -v curl >/dev/null 2>&1; then
      curl --proto '=https' --proto-redir '=https' -fLsS --connect-timeout 15 --max-time 180 "$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
      wget --https-only --timeout=180 -q -O "$2" "$1"
    else
      echo 'Install curl or wget on this host and reconnect.' >&2; exit 1
    fi
  }
  sha256() {
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$1" | awk '{print $1}'
    else
      echo 'Install shasum or sha256sum on this host and reconnect.' >&2; exit 1
    fi
  }
  decode() {
    if base64 -d </dev/null >/dev/null 2>&1; then base64 -d; else base64 -D; fi
  }
  # The Node runtime comes from nodejs.org with a pinned checksum; it is kept
  # so that later updates of the host only transfer the host code itself.
  NODE_ARCHIVE="$BASE/runtime/$NODE_STEM.tar.gz"
  if [ ! -f "$NODE_ARCHIVE" ] || [ "$(sha256 "$NODE_ARCHIVE")" != "$NODE_SHA256" ]; then
    download "https://nodejs.org/dist/v$NODE_VERSION/$NODE_STEM.tar.gz" "$TMP/node.tar.gz" \
      || { echo "Could not download Node.js $NODE_VERSION. This machine needs HTTPS access to nodejs.org." >&2; exit 1; }
    [ "$(sha256 "$TMP/node.tar.gz")" = "$NODE_SHA256" ] || { echo 'Node.js runtime checksum mismatch.' >&2; exit 1; }
    mv "$TMP/node.tar.gz" "$NODE_ARCHIVE"
  fi
  mkdir "$TMP/node" "$TMP/unpacked" "$TMP/unpacked/bin"
  tar -xzf "$NODE_ARCHIVE" -C "$TMP/node" "$NODE_STEM/bin/node" "$NODE_STEM/LICENSE"
  mv "$TMP/node/$NODE_STEM/bin/node" "$TMP/unpacked/bin/node"
  mv "$TMP/node/$NODE_STEM/LICENSE" "$TMP/unpacked/LICENSE"
  # The host code is the one built into this desktop app, sent over SSH.
  decode > "$TMP/unpacked/host.mjs" <<'IRGAT_HOST_BUNDLE'
@@HOST_BUNDLE@@
IRGAT_HOST_BUNDLE
  [ "$(sha256 "$TMP/unpacked/host.mjs")" = "$HOST_SHA256" ] || { echo 'Irgatos Host transfer was incomplete.' >&2; exit 1; }
  decode > "$TMP/unpacked/provider-guard.mjs" <<'IRGAT_HOST_BUNDLE'
@@PROVIDER_GUARD@@
IRGAT_HOST_BUNDLE
  printf '{"version":"%s","nodeVersion":"%s","target":"%s"}\n' "$VERSION" "$NODE_VERSION" "$OS-$ARCH" > "$TMP/unpacked/version.json"
  cat > "$TMP/unpacked/irgat-host" <<'SH'
#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/bin/node" "$DIR/host.mjs" "$@"
SH
  chmod 755 "$TMP/unpacked/irgat-host"
  [ "$("$TMP/unpacked/irgat-host" --version)" = "$VERSION" ] || { echo 'Irgatos Host version mismatch.' >&2; exit 1; }
  DEST="$BASE/runtime/$VERSION-$OS-$ARCH-$(basename "$TMP")"
  # Concurrent installations never replace a directory used by a running host.
  mv "$TMP/unpacked" "$DEST"
  [ "$("$DEST/irgat-host" --version)" = "$VERSION" ] || exit 1
  # Keep a real wrapper (rather than a symlink): it resolves the packaged Node
  # relative to the versioned executable, not this bin directory.
  printf '%s\n' "$DEST" > "$TMP/runtime-path"
  mv "$TMP/runtime-path" "$BASE/runtime-path"
  cat > "$TMP/launcher" <<'SH'
#!/bin/sh
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME=$(cat "$BASE/runtime-path")
exec "$RUNTIME/irgat-host" "$@"
SH
  chmod 700 "$TMP/launcher"
  mv "$TMP/launcher" "$ENTRY"
fi

if [ "$EXISTED" = 1 ] && [ "$FORCE_UPGRADE" = 1 ]; then
  "$ENTRY" service uninstall >/dev/null
fi
"$ENTRY" service install --port "$HOST_PORT" >/dev/null
"$ENTRY" connection-info

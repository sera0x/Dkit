#!/bin/sh
set -eu

REPO="${DKIT_REPO:-sera0x/Dkit}"
BUNDLE="dkit-cli"

fail() {
  echo "dkit: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not found on PATH"
}

need curl
need tar
need node

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 18 ] 2>/dev/null || fail "Node 18 or newer is required (found $(node -v 2>/dev/null || echo 'none'))"

version="${1:-}"
if [ -z "$version" ]; then
  echo "dkit: looking up the latest release..."
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  [ -n "$tag" ] || fail "couldn't determine the latest release; pass a version explicitly, e.g. install.sh v2.0.0"
else
  case "$version" in
    v*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
fi
ver="${tag#v}"

base_url="${DKIT_RELEASES_URL:-https://github.com/$REPO/releases/download/$tag}"

archive="${BUNDLE}-${ver}.tar.gz"

if [ -n "${DKIT_INSTALL_DIR:-}" ]; then
  root_dir="$DKIT_INSTALL_DIR/$BUNDLE"
  bin_dir="$DKIT_INSTALL_DIR/bin"
elif [ -n "${PREFIX:-}" ] && echo "$PREFIX" | grep -q com.termux; then
  root_dir="$PREFIX/lib/dkit-cli"
  bin_dir="$PREFIX/bin"
else
  root_dir="$HOME/.local/lib/dkit-cli"
  bin_dir="$HOME/.local/bin"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "dkit: downloading $archive ($tag)..."
curl -fL "$base_url/$archive" -o "$work/$archive" \
  || fail "download failed — check that $tag exists and has a $archive asset"
curl -fsSL "$base_url/checksums.txt" -o "$work/checksums.txt" \
  || fail "couldn't download checksums.txt for $tag"

echo "dkit: verifying checksum..."
expected=$(grep " $archive$" "$work/checksums.txt" | awk '{print $1}')
[ -n "$expected" ] || fail "no checksum entry found for $archive"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/$archive" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$work/$archive" | awk '{print $1}')
else
  fail "neither sha256sum nor shasum is available to verify the download"
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $archive — expected $expected, got $actual"

tar -xzf "$work/$archive" -C "$work"

mkdir -p "$(dirname "$root_dir")" "$bin_dir"
rm -rf "$root_dir"
mv "$work/$BUNDLE" "$root_dir"
chmod +x "$root_dir/bin/dkit.js"
ln -sfn "$root_dir/bin/dkit.js" "$bin_dir/dkit"

echo "dkit: installed $tag to $root_dir"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "dkit: $bin_dir is not on your PATH — add this to your shell profile:"
     echo "  export PATH=\"$bin_dir:\$PATH\"" ;;
esac

"$bin_dir/dkit" --version

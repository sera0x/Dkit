#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# package-release.sh — build the CLI tarball that install.sh downloads.
#
# Produces releases/dkit-cli-<version>.tar.gz containing a dkit-cli/ directory
# with bin/dkit.js (executable), lib/, templates/, package.json, README.md, and
# node_modules/ (production deps only, installed with `npm install --production`).
# The bundle is standalone: after install.sh unpacks it, `dkit --version` and
# every other command work on a machine with node but no npm and no network.
#
# Run from the project root:  bash scripts/package-release.sh [version]
#
# TODO — repo owner/name:
#   The project name is Dkit everywhere, but the URLs still point at
#   github.com/sera0x/Dkit until the new owner/repo is decided. Edit these when
#   it is:
#     - install.sh line 7:  REPO="${DKIT_REPO:-<new>/<repo>}"
#     - cli/package.json:   repository.url, homepage, bugs
#     - cli/README.md:      the two github.com links
#     - README.md:          clone URL + raw.githubusercontent.com install.sh URL
#     - website/src/components/sections/Footer.jsx: GitHub link
#     - website/src/pages/Docs.jsx: raw.githubusercontent.com install.sh URL
#     - website/public/llms.txt: Source link
#     - website/dist/:  rebuild the site after editing the source files above
#
# TODO — npm publish (not done this session):
#   The package is structured to publish (name: dkit-cli, bin: ./bin/dkit.js,
#   files: bin lib templates README.md). To publish:
#     cd cli && npm publish
#   Needs an npm token (NPM_TOKEN in env, or a .npmrc with //registry.npmjs.org/:_authToken).
#   Once published, `npm install -g dkit-cli` is the standard install path and the
#   curl|sh installer (install.sh) remains as an alternative that grabs the same
#   bundle from the GitHub release assets.
# -----------------------------------------------------------------------------
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$PROJECT_DIR/cli"
RELEASES_DIR="$PROJECT_DIR/releases"
VERSION="${1:-0.1.0}"
TAG="v$VERSION"
BUNDLE="dkit-cli"
ARCHIVE="$RELEASES_DIR/${BUNDLE}-${VERSION}.tar.gz"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "==> Packing CLI from $CLI_DIR (npm pack, no node_modules)"
cd "$CLI_DIR"
npm pack >/dev/null 2>&1
PKG_TGZ="$(ls -1 dkit-cli-*.tgz | head -1)"
echo "    produced: $PKG_TGZ"

echo "==> Unpacking into staging dir"
mkdir -p "$WORK/stage"
tar -xzf "$PKG_TGZ" -C "$WORK/stage"

# npm pack unpacks to a `package/` directory; install.sh expects the bundle
# directory to be named `dkit-cli/`.
if [ -d "$WORK/stage/package" ]; then
  mv "$WORK/stage/package" "$WORK/stage/$BUNDLE"
fi

echo "==> Installing production deps into the bundle"
# npm pack ships package.json but not node_modules. Install production deps
# into the bundle so the tarball is fully standalone (matches the install.sh
# doc comment: "The bundle (with its dependencies, so npm is not needed)").
cd "$WORK/stage/$BUNDLE"
npm install --production >/dev/null 2>&1
cd "$PROJECT_DIR"

echo "==> Ensuring bin/dkit.js is executable"
chmod +x "$WORK/stage/$BUNDLE/bin/dkit.js"

echo "==> Writing checksums.txt"
echo "# ${TAG}  (${BUNDLE} CLI bundle)" > "$RELEASES_DIR/checksums.txt"

echo "==> Packing archive"
tar -czf "$ARCHIVE" -C "$WORK/stage" "$BUNDLE"

echo "==> Computing final checksum"
(cd "$RELEASES_DIR" && sha256sum "$BUNDLE-${VERSION}.tar.gz") >> "$RELEASES_DIR/checksums.txt"

ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
CHECKSUM=$(awk '/ dkit-cli-'${VERSION}'.tar.gz$/ {print $1}' "$RELEASES_DIR/checksums.txt")
echo
echo "✅ Archive ready: $ARCHIVE ($ARCHIVE_SIZE)"
echo "   checksum: $CHECKSUM"
echo
echo "Next step: push $TAG to GitHub and upload $ARCHIVE + checksums.txt as"
echo "release assets, or point DKIT_RELEASES_URL at this directory for testing."

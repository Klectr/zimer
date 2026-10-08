#!/usr/bin/env bash
# Build a versioned Zimer release tarball — issue #340.
#
#   ./scripts/build-release.sh 1.2.3
#
# Verifies the VERSION file matches, then tars the runtime tree:
# site/, extension/, VERSION, LICENSE, README.md, CHANGELOG.md.
# Prints the tarball path and its sha256 for the release feed.
#
# Publishing (manual, on the VPS):
#   1. copy zimer-<v>.tgz and install.sh to /var/www/invoices/releases/
#   2. add { "version", "url", "sha256" } under releases["<major>"] in
#      /var/www/invoices/releases/feed.json
set -euo pipefail

VERSION="${1:?usage: build-release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILE_VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
[ "$FILE_VERSION" = "$VERSION" ] || {
  echo "error: VERSION file says $FILE_VERSION, asked for $VERSION" >&2
  exit 1
}

OUT="/tmp/zimer-$VERSION.tgz"
# Never ship site/data: the working copy's dev database and .token live
# there and must not end up in a public tarball.
tar czf "$OUT" -C "$ROOT" --exclude='site/data' \
  site extension VERSION LICENSE README.md CHANGELOG.md
echo "tarball: $OUT"
echo -n "sha256:  "
sha256sum "$OUT" | cut -d' ' -f1
echo "feed entry:"
printf '    "%s": { "version": "%s",\n' "${VERSION%%.*}" "$VERSION"
printf '      "url": "https://invoices.tristonarmstrong.com/releases/zimer-%s.tgz",\n' "$VERSION"
printf '      "sha256": "%s" }\n' "$(sha256sum "$OUT" | cut -d' ' -f1)"

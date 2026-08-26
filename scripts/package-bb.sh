#!/usr/bin/env bash
# Package the SWAO meshStack Building Block for catalog upload.
# Produces: ops/building-block/swao-bb-<version>.tar.gz
# Usage: bash scripts/package-bb.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION="$(node -p "require('${REPO_ROOT}/packages/swao/package.json').version")"
OUT_DIR="${REPO_ROOT}/ops/building-block"
TARBALL="${OUT_DIR}/swao-bb-${VERSION}.tar.gz"

echo "[bb] Version: ${VERSION}"
echo "[bb] Building tarball: ${TARBALL}"

cd "${REPO_ROOT}"
tar -czf "${TARBALL}" \
  -C ops/building-block \
  manifest.yaml \
  README.md

echo "[bb] Done: ${TARBALL}"
echo "[bb] Upload this file to the meshStack Developer Portal catalog."
echo "[bb] See ops/building-block/README.md for upload instructions."

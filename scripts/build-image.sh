#!/usr/bin/env bash
# Build the SWAO Docker image from the repo root.
# Usage: bash scripts/build-image.sh [tag]
# Default tag: accenture/swao:dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TAG="${1:-accenture/swao:dev}"

echo "[docker] Building ${TAG} from ${REPO_ROOT} ..."
docker build -t "${TAG}" "${REPO_ROOT}"
echo "[docker] Done. Image: ${TAG}"
echo "[docker] Run: docker run --rm -v \"\$(pwd)\":/workspace ${TAG} --help"

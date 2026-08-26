#!/usr/bin/env bash
# Local CI pre-flight check -- mirrors the steps in .github/workflows/ci.yml.
# Run from the repo root before pushing or submitting a PR.
# Exit code mirrors the first failing step.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SWAO_PKG="${REPO_ROOT}/packages/swao"

echo "[ci] Changing to packages/swao..."
cd "${SWAO_PKG}"

echo "[ci] typecheck..."
npm run typecheck

echo "[ci] lint..."
npm run lint

echo "[ci] test..."
npm run test

echo "[ci] tracker validate..."
SYNC_SCRIPT="${REPO_ROOT}/../swao-premium/docs/tracker/sync/sync.sh"
if [ -f "${SYNC_SCRIPT}" ]; then
  bash "${SYNC_SCRIPT}" validate
else
  echo "[ci] swao-premium not found at ${SYNC_SCRIPT} -- tracker validation skipped."
fi

echo "[ci] All checks passed."

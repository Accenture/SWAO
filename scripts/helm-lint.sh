#!/usr/bin/env bash
# Validate the SWAO Helm chart with helm lint.
# Requires: helm 3 installed and available on PATH.
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ops/helm/swao"

if ! command -v helm &>/dev/null; then
  echo "ERROR: helm not found on PATH. Install Helm 3: https://helm.sh/docs/intro/install/"
  exit 1
fi

echo "[helm-lint] Linting chart at: ${CHART_DIR}"
helm lint "${CHART_DIR}"
echo "[helm-lint] OK"

#!/usr/bin/env bash
# Demo dry-run: timed end-to-end run against Sovereign Health.
# Gate for SPEC SC-7: "End-to-end demo completes in < 5 minutes (timed dry-run, 3x)".
# Requires a configured LLM provider. Set SWAO_LLM_PROVIDER and the matching
# SWAO_CREDENTIAL_* env var, or configure credentials via 'swao credentials'.
# Usage: bash scripts/demo.sh
# Override timeout: SWAO_DEMO_TIMEOUT_SECS=120 bash scripts/demo.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/packages/swao/dist/index.js"
WORKSPACE="${REPO_ROOT}/examples/portfolio-workspace/portfolio"
TIMEOUT="${SWAO_DEMO_TIMEOUT_SECS:-300}"
APP="sovereign-health"

# Use SWAO_LLM_PROVIDER if already set; fall back to anthropic.
export SWAO_LLM_PROVIDER="${SWAO_LLM_PROVIDER:-anthropic}"

echo "[demo] Starting SWAO demo run against '${APP}' (provider: ${SWAO_LLM_PROVIDER}, timeout: ${TIMEOUT}s)"
echo "[demo] Workspace: ${WORKSPACE}"
echo ""

START=$(date +%s)

echo "[demo] Step 1/3 -- assess"
node "${CLI}" assess \
  --app "${APP}" \
  --workspace "${WORKSPACE}" \
  --passes inv,state,data,ctx,sbom,tf,egr,crypto \
  --no-crawl

echo ""
echo "[demo] Step 2/3 -- report"
node "${CLI}" report \
  --app "${APP}" \
  --workspace "${WORKSPACE}"

echo ""
echo "[demo] Step 3/3 -- challenge (Premium gate expected in Community)"
node "${CLI}" challenge \
  --agent grc-compliance-officer \
  --app "${APP}" \
  --workspace "${WORKSPACE}" \
  --report 2>&1 || true   # challenge is Premium-gated; non-zero is acceptable in Community

END=$(date +%s)
ELAPSED=$(( END - START ))

echo ""
echo "[demo] Elapsed: ${ELAPSED}s"

if [ "${ELAPSED}" -gt "${TIMEOUT}" ]; then
  echo "[demo] FAIL -- ${ELAPSED}s exceeded threshold of ${TIMEOUT}s"
  exit 1
fi

echo "[demo] OK -- ${ELAPSED}s (< ${TIMEOUT}s threshold)"

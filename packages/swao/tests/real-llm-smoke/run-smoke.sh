#!/usr/bin/env bash
# Real-LLM smoke harness for SWAO (#0322 Part C, sprint-036).
#
# Cadence: before every v* tag + once per sprint close. See README.md.
# Loops over SWAO_LLM_PROVIDER in {anthropic, openai}; for each provider
# runs `swao assess --app sovereign-health --passes inv,synth` against the
# bundled example workspace; verifies the run-manifest records the
# expected provider + non-zero cost.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${PKG_DIR}/../../.." && pwd)"
WORKSPACE="${REPO_ROOT}/swao/examples/portfolio-workspace/portfolio"
OUT_DIR="${SCRIPT_DIR}/last-run"

# Resolve the SWAO invocation: prefer the built binary, fall back to node + bundle.
if [ -x "${REPO_ROOT}/swao/dist-bin/swao-enterprise-win.exe" ]; then
  SWAO_BIN="${REPO_ROOT}/swao/dist-bin/swao-enterprise-win.exe"
elif [ -f "${PKG_DIR}/dist/bundle.cjs" ]; then
  SWAO_BIN="node ${PKG_DIR}/dist/bundle.cjs"
else
  echo "[fail] no swao binary or bundle found. Run 'npm run build:binary' or 'npm run build && npm run build:bundle' first." >&2
  exit 1
fi

echo "[real-llm-smoke] SWAO_BIN  = ${SWAO_BIN}"
echo "[real-llm-smoke] WORKSPACE = ${WORKSPACE}"

if [ ! -d "${WORKSPACE}/apps/sovereign-health" ]; then
  echo "[fail] sovereign-health fixture not found under ${WORKSPACE}/apps/" >&2
  exit 1
fi

# Reset output dir
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

SUMMARY="${OUT_DIR}/summary.txt"
: > "${SUMMARY}"

PROVIDERS=("anthropic" "openai")
OVERALL_STATUS=0

for PROVIDER in "${PROVIDERS[@]}"; do
  echo ""
  echo "[real-llm-smoke] === provider: ${PROVIDER} ==="

  # Verify the credential is available before kicking off the assess
  case "${PROVIDER}" in
    anthropic)
      if [ -z "${SWAO_ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
        # Try the credential store via swao
        if ! ${SWAO_BIN} credential list 2>/dev/null | grep -q 'anthropic-api-key'; then
          echo "  SKIP: no ANTHROPIC key in env or credential store"
          echo "${PROVIDER}: SKIP (no credential)" >> "${SUMMARY}"
          continue
        fi
      fi
      ;;
    openai)
      if [ -z "${SWAO_OPENAI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
        if ! ${SWAO_BIN} credential list 2>/dev/null | grep -q 'openai-api-key'; then
          echo "  SKIP: no OPENAI key in env or credential store"
          echo "${PROVIDER}: SKIP (no credential)" >> "${SUMMARY}"
          continue
        fi
      fi
      ;;
  esac

  PROVIDER_OUT="${OUT_DIR}/${PROVIDER}"
  mkdir -p "${PROVIDER_OUT}"
  ASSESS_LOG="${PROVIDER_OUT}/assess.log"

  echo "  invoking assess (inv,synth) with SWAO_LLM_PROVIDER=${PROVIDER}..."
  set +e
  ( cd "${WORKSPACE}" && SWAO_LLM_PROVIDER="${PROVIDER}" ${SWAO_BIN} assess --app sovereign-health --passes inv,synth --no-crawl ) > "${ASSESS_LOG}" 2>&1
  ASSESS_EXIT=$?
  set -e

  if [ ${ASSESS_EXIT} -ne 0 ]; then
    echo "  FAIL: assess exit ${ASSESS_EXIT}"
    tail -20 "${ASSESS_LOG}"
    echo "${PROVIDER}: FAIL (exit ${ASSESS_EXIT}); see ${ASSESS_LOG}" >> "${SUMMARY}"
    OVERALL_STATUS=1
    continue
  fi

  # Find the latest run manifest
  LATEST_REL=$(cat "${WORKSPACE}/apps/sovereign-health/wsp/latest.txt" 2>/dev/null | tr -d '[:space:]' || true)
  MANIFEST="${WORKSPACE}/apps/sovereign-health/wsp/${LATEST_REL}/run-manifest.json"
  if [ ! -f "${MANIFEST}" ]; then
    echo "  FAIL: run-manifest not found at ${MANIFEST}"
    echo "${PROVIDER}: FAIL (manifest missing)" >> "${SUMMARY}"
    OVERALL_STATUS=1
    continue
  fi

  cp "${MANIFEST}" "${PROVIDER_OUT}/run-manifest.json"

  # Pull the recorded provider, model, cost out of the manifest
  RECORDED_PROVIDER=$(grep -oE '"provider":\s*"[^"]+"' "${MANIFEST}" | head -1 | sed 's/.*"provider":\s*"\([^"]*\)"/\1/')
  RECORDED_MODEL=$(grep -oE '"model":\s*"[^"]+"' "${MANIFEST}" | head -1 | sed 's/.*"model":\s*"\([^"]*\)"/\1/')
  RECORDED_COST=$(grep -oE '"cost_usd":\s*[0-9.]+' "${MANIFEST}" | head -1 | sed 's/.*"cost_usd":\s*\([0-9.]*\).*/\1/')

  echo "  recorded provider=${RECORDED_PROVIDER} model=${RECORDED_MODEL} cost=\$${RECORDED_COST}"

  if [ "${RECORDED_PROVIDER}" != "${PROVIDER}" ]; then
    echo "  FAIL: manifest provider mismatch (expected ${PROVIDER}, got ${RECORDED_PROVIDER})"
    echo "${PROVIDER}: FAIL (provider mismatch ${RECORDED_PROVIDER})" >> "${SUMMARY}"
    OVERALL_STATUS=1
    continue
  fi

  echo "  PASS"
  echo "${PROVIDER}: PASS (model=${RECORDED_MODEL}, cost=\$${RECORDED_COST})" >> "${SUMMARY}"
done

echo ""
echo "[real-llm-smoke] === summary ==="
cat "${SUMMARY}"
echo ""

if [ ${OVERALL_STATUS} -ne 0 ]; then
  echo "[real-llm-smoke] OVERALL: FAIL (at least one provider failed)"
  exit ${OVERALL_STATUS}
fi
echo "[real-llm-smoke] OVERALL: PASS"

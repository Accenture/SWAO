#!/usr/bin/env bash
# Demo dry-run via Docker container.
# Requires: docker build -t accenture/swao:dev . (see scripts/build-image.sh, issue #0123)
# Usage: bash scripts/demo-docker.sh [workspace-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE="${1:-${REPO_ROOT}/examples/portfolio-workspace/portfolio}"
IMAGE="accenture/swao:dev"
TIMEOUT="${SWAO_DEMO_TIMEOUT_SECS:-300}"
APP="sovereign-health"

if ! docker image inspect "${IMAGE}" > /dev/null 2>&1; then
  echo "[demo-docker] ERROR: image '${IMAGE}' not found."
  echo "[demo-docker] Run: bash scripts/build-image.sh"
  echo "[demo-docker] (Requires Docker -- see issue #0123)"
  exit 1
fi

echo "[demo-docker] Starting SWAO demo via Docker image: ${IMAGE}"
echo "[demo-docker] Workspace: ${WORKSPACE}"
echo ""

PROVIDER="${SWAO_LLM_PROVIDER:-anthropic}"
DOCKER_RUN="docker run --rm -v ${WORKSPACE}:/workspace -e SWAO_LLM_PROVIDER=${PROVIDER} ${IMAGE}"

START=$(date +%s)

echo "[demo-docker] Step 1/2 -- assess"
${DOCKER_RUN} assess --app "${APP}" --passes inv,state,data,ctx,sbom,tf,egr,crypto --no-crawl

echo ""
echo "[demo-docker] Step 2/2 -- report"
${DOCKER_RUN} report --app "${APP}"

END=$(date +%s)
ELAPSED=$(( END - START ))

echo ""
echo "[demo-docker] Elapsed: ${ELAPSED}s"

if [ "${ELAPSED}" -gt "${TIMEOUT}" ]; then
  echo "[demo-docker] FAIL -- ${ELAPSED}s exceeded threshold of ${TIMEOUT}s"
  exit 1
fi

echo "[demo-docker] OK -- ${ELAPSED}s (< ${TIMEOUT}s threshold)"

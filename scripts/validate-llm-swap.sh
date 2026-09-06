#!/usr/bin/env bash
# Validate configured LLM providers for SWAO.
# Checks Anthropic if SWAO_CREDENTIAL_ANTHROPIC_API_KEY is set.
# Checks Ollama if localhost:11434 is reachable.
# CI-safe: exits 0 when no provider is accessible.
# Usage: bash scripts/validate-llm-swap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI="${REPO_ROOT}/packages/swao/dist/index.js"
WORKSPACE="${REPO_ROOT}/examples/portfolio-workspace/portfolio"

PASS=0
FAIL=0
SKIP=0

ok()   { echo "[ok]   $*"; }
fail() { echo "[fail] $*"; FAIL=$((FAIL + 1)); }
info() { echo "[info] $*"; }
skip() { echo "[skip] $*"; SKIP=$((SKIP + 1)); }

# ---------------------------------------------------------------------------
# Anthropic provider (only if credential is configured)
# ---------------------------------------------------------------------------
ANTHROPIC_KEY="${SWAO_CREDENTIAL_ANTHROPIC_API_KEY:-}"
if [ -z "${ANTHROPIC_KEY}" ]; then
  skip "Anthropic: SWAO_CREDENTIAL_ANTHROPIC_API_KEY not set"
else
  info "Checking Anthropic provider..."
  if SWAO_LLM_PROVIDER=anthropic node "${CLI}" assess \
      --app sovereign-health \
      --workspace "${WORKSPACE}" \
      --passes synth \
      --no-crawl \
      > /dev/null 2>&1; then
    ok "Anthropic provider: assessment exits 0"
    PASS=$((PASS + 1))
  else
    fail "Anthropic provider: assessment exited non-zero"
  fi
fi

# ---------------------------------------------------------------------------
# Ollama provider (only if localhost:11434 is reachable)
# ---------------------------------------------------------------------------
info "Checking Ollama availability at localhost:11434..."
if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
  info "Ollama reachable -- running provider check..."
  if SWAO_LLM_PROVIDER=ollama node "${CLI}" assess \
      --app sovereign-health \
      --workspace "${WORKSPACE}" \
      --passes synth \
      --no-crawl \
      > /dev/null 2>&1; then
    ok "Ollama provider: assessment exits 0"
    PASS=$((PASS + 1))
  else
    fail "Ollama provider: assessment exited non-zero"
  fi
else
  skip "Ollama: localhost:11434 not reachable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "LLM provider validation: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1

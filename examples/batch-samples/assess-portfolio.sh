#!/usr/bin/env bash
# ===========================================================
# SWAO -- assess N apps + emit portfolio BI bundle
#
# Edit the three variables below (or override at the shell)
# to match your engagement, then run this script. Halts on
# the first failure so partial bundles are not emitted silently.
# ===========================================================

set -euo pipefail

# --- Configuration ----------------------------------------
# Absolute path to the SWAO binary on this machine.
SWAO_BIN="${SWAO_BIN:-/c/Projects/accenture/swao/dist-bin/swao-enterprise-win.exe}"

# Absolute path to the operator workspace (where .swao.yml lives).
WORKSPACE="${WORKSPACE:-/c/swao-e2e}"

# Space-separated list of app ids under <WORKSPACE>/apps/.
# Match the directory names exactly; the script does not glob.
APP_LIST=(sovereign-health e2e-ct app-three app-four app-five)
# -----------------------------------------------------------

if [[ ! -f "$SWAO_BIN" ]]; then
  echo "[error] swao binary not found at $SWAO_BIN" >&2
  echo "        Edit SWAO_BIN at the top of this script (or export it)." >&2
  exit 1
fi

cd "$WORKSPACE" || {
  echo "[error] could not enter workspace at $WORKSPACE" >&2
  exit 1
}

echo
echo "=== Pre-flight environment check (doctor) ==="
"$SWAO_BIN" doctor || {
  echo
  echo "[error] doctor reported a failure -- fix the listed issue and re-run." >&2
  echo "        Most common: missing licence, no anthropic-api-key in keychain," >&2
  echo "        Chromium not installed (run: swao install-playwright)." >&2
  exit 1
}

# Assess each app sequentially. Failure on any assess halts the script.
for app in "${APP_LIST[@]}"; do
  echo
  echo "=== Assessing $app ==="
  "$SWAO_BIN" assess --app "$app" || {
    echo
    echo "[error] assess failed for $app -- aborting batch." >&2
    echo "        Inspect logs at $WORKSPACE/apps/$app/wsp/runs/<latest>/" >&2
    exit 1
  }
done

echo
echo "=== Emitting portfolio BI bundle (export --portfolio) ==="
"$SWAO_BIN" export --portfolio || {
  echo
  echo "[error] portfolio export failed." >&2
  echo "        Premium-tier licence required for --portfolio." >&2
  echo "        Check: swao license status" >&2
  exit 1
}

echo
echo "=== Batch complete ==="
"$SWAO_BIN" --version
echo
echo "Bundle paths printed above. Paste the portfolio bundle path"
echo "into PowerBI Desktop's SWAOPortfolioExportPath parameter,"
echo "or open the .pbit at:"
echo "  $WORKSPACE/wsp/templates/powerbi/swao-portfolio.pbit"

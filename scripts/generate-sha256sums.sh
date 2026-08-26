#!/usr/bin/env bash
# Generate dist-bin/SHA256SUMS from the binaries present in dist-bin/.
# Run from the swao/ package root after a release build.
#
# Usage:
#   bash scripts/generate-sha256sums.sh
#
# The script writes SHA256SUMS next to the binaries and prints the table so
# it can be pasted into RELEASES.md. Only files matching the known binary
# name patterns are included -- loose build artefacts are skipped.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_BIN="$SCRIPT_DIR/../dist-bin"

BINARIES=(
  swao-community-win.exe
  swao-consultant-win.exe
  swao-enterprise-win.exe
  swao-linux-x64
  swao-darwin-x64
  swao-darwin-arm64
)

cd "$DIST_BIN"

> SHA256SUMS

for bin in "${BINARIES[@]}"; do
  if [[ -f "$bin" ]]; then
    if command -v sha256sum &>/dev/null; then
      sha256sum "$bin" >> SHA256SUMS
    else
      # macOS fallback
      shasum -a 256 "$bin" >> SHA256SUMS
    fi
  else
    echo "[skip] $bin not found" >&2
  fi
done

echo "Written: $DIST_BIN/SHA256SUMS"
echo ""
cat SHA256SUMS

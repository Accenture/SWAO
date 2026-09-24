#!/usr/bin/env bash
# clean-dist-bin.sh -- remove stale binaries from dist-bin/ before a fresh release build.
#
# Usage:
#   bash scripts/clean-dist-bin.sh            # removes all binaries in swao/dist-bin/
#   bash scripts/clean-dist-bin.sh --dry-run  # list files that would be removed

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_BIN_DIR="$SCRIPT_DIR/../dist-bin"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ ! -d "$DIST_BIN_DIR" ]]; then
  echo "[info] dist-bin/ does not exist -- nothing to clean."
  exit 0
fi

FOUND=0
while IFS= read -r -d '' f; do
  FOUND=$((FOUND + 1))
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] would remove: $f"
  else
    rm -f "$f"
    echo "[removed] $f"
  fi
done < <(find "$DIST_BIN_DIR" -maxdepth 1 -type f \( -name "*.exe" -o -name "swao-*" \) -print0)

if [[ "$FOUND" -eq 0 ]]; then
  echo "[info] dist-bin/ is already clean (no binaries found)."
elif [[ "$DRY_RUN" == "false" ]]; then
  echo "[ok] Removed $FOUND binary file(s) from dist-bin/."
fi

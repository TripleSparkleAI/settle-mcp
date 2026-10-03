#!/usr/bin/env bash
# export_settle_mcp_repo.sh - make (or refresh) settle-mcp's own standalone LOCAL git repository from this folder.
#
# Like SETTLE and KANERVA, settle-mcp is built inside the dwarfstar repository and lives as a repository of its own.
# This script copies the package (without node_modules and without any .git) into DEST, then commits there with a
# provenance line naming the dwarfstar commit it came from. It never adds a remote and never pushes: creating the
# GitHub repository is the navigator's call (src/pkgrefs.js says "not published yet").
#
#   bash experiments/thermosim/settle-mcp/tools/export_settle_mcp_repo.sh            # DEST = ~/Code/TripleSparkle/_flows/settle-mcp-repo
#   DEST=/some/folder bash .../export_settle_mcp_repo.sh                              # somewhere else
#   bash .../export_settle_mcp_repo.sh --dry-run                                       # say what it would do
#
# The copy is rsync --delete with trailing slashes on both sides, so the export matches the package exactly and a
# re-run is free. The generated docs are copied as they are; the standalone repo has no site beside it, so its
# server serves them without rebuilding.
set -euo pipefail

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${DEST:-$HOME/Code/TripleSparkle/_flows/settle-mcp-repo}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -n "$DEST" ] || { echo "export: DEST is empty" >&2; exit 1; }
SRC_TOP="$(git -C "$PKG" rev-parse --show-toplevel)"
case "$(cd "$(dirname "$DEST")" 2>/dev/null && pwd)/$(basename "$DEST")/" in
  "$SRC_TOP"/*) echo "export: DEST ($DEST) is inside the source repository; that would nest a .git. Pick another folder." >&2; exit 1 ;;
esac
SHA="$(git -C "$PKG" rev-parse --short HEAD)"
DIRTY="$(git -C "$PKG" status --porcelain -- . | wc -l | tr -d ' ')"

echo "export: $PKG"
echo "    to: $DEST"
echo "  from: dwarfstar $SHA ($DIRTY uncommitted path(s) in the package)"
if [ "$DRY" = 1 ]; then
  echo "dry run: would run"
  echo "  mkdir -p $DEST"
  echo "  rsync -a --delete --exclude node_modules/ --exclude .git/ $PKG/ $DEST/"
  echo "  git -C $DEST init -b main   (only if it is not a repository yet)"
  echo "  git -C $DEST add --all && git -C $DEST commit   (no remote, no push)"
  exit 0
fi

mkdir -p "$DEST"
rsync -a --delete --exclude node_modules/ --exclude .git/ "$PKG/" "$DEST/"
if [ ! -d "$DEST/.git" ]; then
  git -C "$DEST" init -q -b main
fi
git -C "$DEST" add --all
if git -C "$DEST" diff --cached --quiet; then
  echo "export: nothing changed since the last export"
else
  git -C "$DEST" commit -q -F - <<MSG
settle-mcp: export from dwarfstar $SHA

Copied from experiments/thermosim/settle-mcp/ in the dwarfstar repository at commit $SHA by
tools/export_settle_mcp_repo.sh. The source of truth for the docs is the SETTLE site in that repository;
they are generated, never edited by hand.
MSG
  echo "export: committed $(git -C "$DEST" rev-parse --short HEAD) in $DEST"
fi
echo "remotes: $(git -C "$DEST" remote | wc -l | tr -d ' ') (none are added by this script)"

#!/usr/bin/env bash
# export_settle_mcp_repo.sh - settle-mcp's standalone repository. Since lane REPOSPUSH (2026-10-04) all seven SETTLE
# repositories come from one script, SETTLE/tools/export_settle_repos.sh; this one runs it for
# settle-mcp alone and passes every argument through (--dry-run, --push, DEST_ROOT=...).
#
#   bash SETTLE/settle-mcp/tools/export_settle_mcp_repo.sh            # -> SETTLE/REPOS/settle-mcp (gitignored)
#   bash SETTLE/settle-mcp/tools/export_settle_mcp_repo.sh --push     # also create PRIVATE and push
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/tools/export_settle_repos.sh" --only settle-mcp "$@"

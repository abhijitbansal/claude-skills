#!/usr/bin/env bash
# SessionStart: rebuild ~/.claude/prompt-craft/{registry,profile}.json when stale.
# Stale = missing registry | repo-root change | scan-signature change | claude
# --version change (version dimension skipped if claude is off PATH). Always exit 0.
set -uo pipefail

INPUT="$(cat)"
CWD="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("cwd", ""))
except Exception:
    print("")' 2>/dev/null)"
[ -n "$CWD" ] || CWD="$PWD"

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
CV="$(claude --version 2>/dev/null | head -n1 | tr -dc '0-9.' || true)"

ARGS=(--repo-root "$CWD")
[ -n "$CV" ] && ARGS+=(--claude-version "$CV")

verdict="$(/usr/bin/python3 "${SCRIPTS}/build_registry.py" --check "${ARGS[@]}" 2>/dev/null || echo stale)"
if [ "$verdict" = "stale" ]; then
  /usr/bin/python3 "${SCRIPTS}/build_registry.py" "${ARGS[@]}" >/dev/null 2>&1 || true
  /usr/bin/python3 "${SCRIPTS}/learn_history.py" >/dev/null 2>&1 || true
fi
exit 0

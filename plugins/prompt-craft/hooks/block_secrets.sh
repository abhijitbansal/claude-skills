#!/usr/bin/env bash
# PreToolUse guardrail (OPT-IN, off by default). Enable with
# PROMPT_CRAFT_BLOCK_SECRETS=1. Blocks Read/Edit/Write of secret-looking files:
# exit 2 stops the tool and the stderr message is fed back to Claude. Exit 0 allows.
# Scope: only the Read/Edit/Write file tools (see hooks.json matcher). It is an
# accident guard, not a sandbox: `cat .env` through Bash or a Grep over the
# file is not covered.
set -uo pipefail

[[ "${PROMPT_CRAFT_BLOCK_SECRETS:-0}" == "1" ]] || exit 0

INPUT="$(cat)"
FILE="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
except Exception:
    print("")' 2>/dev/null)"

[[ -n "$FILE" ]] || exit 0

base="$(basename "$FILE")"
# Checked-in templates hold placeholders, not secrets: allow them.
case "$base" in
  *.example | *.sample | *.template | *.dist)
    exit 0
    ;;
esac
# Conservative secret-name match to avoid false positives.
case "$base" in
  .env | .env.* | *.pem | *.key | id_rsa | id_dsa | id_ecdsa | id_ed25519 | credentials | .npmrc | .pypirc)
    echo "prompt-craft guardrail: refusing to access '${FILE}' (looks like a secret). Unset PROMPT_CRAFT_BLOCK_SECRETS to disable, or rename if this is a false positive." >&2
    exit 2
    ;;
esac
exit 0

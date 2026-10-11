#!/usr/bin/env bats

# The repo is public. Private project names (everything except Cubby, which
# AGENTS.md publishes on purpose) were scrubbed from the plugin catalog, the
# site docs and the archive in the 2026-10 catalog review; this guard keeps
# them out. docs/superpowers/ is historical planning material and exempt.

REPO="${BATS_TEST_DIRNAME}/../.."

@test "no private project names anywhere in the tracked tree" {
  run git -C "$REPO" grep -Iilw -E '(doc-scan|paperix|foundry|floorprint|sift|folix|memekit)' \
    -- . ':!docs/superpowers' ':!tests/bats/no_private_names.bats'
  if [ "$status" -eq 0 ]; then
    echo "private project names found in:"
    echo "$output"
    return 1
  fi
  [ "$status" -eq 1 ]
}

#!/usr/bin/env bats

# The repo is public. Private project names (everything except Cubby, which
# AGENTS.md publishes on purpose) were scrubbed from the plugin catalog, the
# site docs and the archive in the 2026-10 catalog review; this guard keeps
# them out. docs/superpowers/ is historical planning material and exempt.

REPO="${BATS_TEST_DIRNAME}/../.."

@test "no private project names in plugins, docs, archive, site, templates, tests or root docs" {
  run grep -rIEilw '(doc-scan|paperix|foundry|floorprint|sift)' \
    "${REPO}/plugins" "${REPO}/docs" "${REPO}/archive" "${REPO}/site" \
    "${REPO}/README.md" "${REPO}/AGENTS.md" "${REPO}/CLAUDE.md" "${REPO}/USAGE.md" \
    "${REPO}/templates" "${REPO}/tests" "${REPO}/setup" \
    --exclude-dir=superpowers --exclude-dir=node_modules --exclude-dir=.cache \
    --exclude=no_private_names.bats
  if [ "$status" -eq 0 ]; then
    echo "private project names found in:"
    echo "$output"
    return 1
  fi
  [ "$status" -eq 1 ]
}

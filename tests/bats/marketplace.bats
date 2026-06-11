#!/usr/bin/env bats

load helpers

REPO_ROOT="${BATS_TEST_DIRNAME}/../.."

@test "marketplace.json is valid JSON with required fields" {
  run python3 -c "
import json, sys
d = json.load(open('${REPO_ROOT}/.claude-plugin/marketplace.json'))
assert d['name'] == 'claude-skills', 'marketplace name'
assert d['owner']['name'], 'owner name'
assert len(d['plugins']) >= 3, 'expected >= 3 plugins'
for p in d['plugins']:
    assert p['name'] and p['source'] and p['description'], p
"
  [ "$status" -eq 0 ]
}

@test "every marketplace plugin source dir has a plugin.json naming it" {
  run python3 -c "
import json, os
root = '${REPO_ROOT}'
d = json.load(open(os.path.join(root, '.claude-plugin/marketplace.json')))
for p in d['plugins']:
    pj_path = os.path.join(root, p['source'], '.claude-plugin', 'plugin.json')
    pj = json.load(open(pj_path))
    assert pj['name'] == p['name'], f\"{pj_path}: {pj['name']} != {p['name']}\"
    assert pj['description'], pj_path
"
  [ "$status" -eq 0 ]
}

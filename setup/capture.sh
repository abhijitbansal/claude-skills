#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CLAUDE_SKILLS_HOME:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
# shellcheck source=_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_lib.sh"

TOML="${REPO_ROOT}/claude-setup.toml"

bold "1/4  Dotfiles"
[[ -f "${HOME}/CLAUDE.md" ]]              && cp "${HOME}/CLAUDE.md"              "${REPO_ROOT}/templates/home-CLAUDE.md"
[[ -f "${HOME}/.claude/settings.json" ]]  && cp "${HOME}/.claude/settings.json"  "${REPO_ROOT}/templates/user-settings.json"

write_section() {
  local section="$1" payload="$2"
  printf '%s' "${payload}" | uv run --quiet "${SCRIPT_DIR}/write_toml.py" "${TOML}" "${section}"
}

bold "2/4  Marketplaces"
MARKETS_JSON="${HOME}/.claude/plugins/known_marketplaces.json"
if [[ -f "${MARKETS_JSON}" ]]; then
  payload="$(python3 - "${MARKETS_JSON}" <<'PY'
import json, sys
src = sys.argv[1]
data = json.load(open(src))
out = []
for name, entry in sorted(data.items()):
    src = entry.get("source", {})
    if src.get("source") != "github":
        continue
    repo = src.get("repo")
    if repo:
        out.append({"name": name, "repo": repo})
print(json.dumps(out))
PY
)"
  write_section marketplaces "${payload}"
fi

bold "3/4  Plugins (user scope)"
INSTALLED_JSON="${HOME}/.claude/plugins/installed_plugins.json"
if [[ -f "${INSTALLED_JSON}" ]]; then
  payload="$(python3 - "${INSTALLED_JSON}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
out = []
for full, scopes in sorted(data.get("plugins", {}).items()):
    if not any(s.get("scope") == "user" for s in scopes):
        continue
    name, _, market = full.partition("@")
    out.append({"name": name, "marketplace": market})
print(json.dumps(out))
PY
)"
  write_section plugins "${payload}"
fi

bold "4/4  npx-skills"
LOCK="${HOME}/.agents/.skill-lock.json"
if [[ -f "${LOCK}" ]]; then
  payload="$(python3 - "${LOCK}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
out = []
for name, meta in sorted(data.get("skills", {}).items()):
    src = meta.get("source")
    if not src:
        continue
    out.append({"source": src, "name": name})
print(json.dumps(out))
PY
)"
  write_section skills "${payload}"
fi

bold "Done. Review with:  git -C \"${REPO_ROOT}\" diff"

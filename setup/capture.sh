#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CLAUDE_SKILLS_HOME:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
# shellcheck source=_lib.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_lib.sh"

TOML="${REPO_ROOT}/claude-setup.toml"

bold "1/4  Dotfiles"
# The templates land in a public repo. Settings keep only allowlisted keys and
# have ${HOME} rewritten to $HOME; both files are scanned for secret-like
# values first, and any hit stops the capture before anything is written.
python3 - "${HOME}/.claude/settings.json" "${REPO_ROOT}/templates/user-settings.json" \
  "${HOME}/CLAUDE.md" "${REPO_ROOT}/templates/home-CLAUDE.md" <<'PY'
import json, os, re, sys

settings_src, settings_out, md_src, md_out = sys.argv[1:5]
home = os.environ["HOME"].rstrip("/")

ALLOWED_KEYS = {
    "env", "permissions", "hooks", "statusLine", "enabledPlugins",
    "extraKnownMarketplaces", "model", "advisorModel", "effortLevel",
    "alwaysThinkingEnabled", "outputStyle", "includeGitInstructions",
    "awaySummaryEnabled", "autoUpdatesChannel", "tui", "showThinkingSummaries",
    "editorMode", "showTurnDuration", "teammateMode", "inputNeededNotifEnabled",
    "agentPushNotifEnabled", "skipAutoPermissionPrompt",
}
PATTERNS = {
    "github-token": r"\bgh[pousr]_[A-Za-z0-9]{36,}",
    "github-pat": r"\bgithub_pat_[A-Za-z0-9_]{22,}",
    "anthropic-key": r"\bsk-ant-[A-Za-z0-9_-]{20,}",
    "api-key": r"\bsk-[A-Za-z0-9]{32,}",
    "slack-token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
    "aws-access-key": r"\bAKIA[0-9A-Z]{16}\b",
    "private-key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
}
# Key names that end like a secret (GITHUB_TOKEN, authToken, ANTHROPIC_API_KEY);
# a suffix match keeps counts such as MAX_THINKING_TOKENS out.
SECRET_KEY_NAME = re.compile(r"(?i)(token|secret|passw(or)?d|api[_-]?key|credentials?)$")
hits = []

def scan_text(where, text):
    for name, pat in PATTERNS.items():
        if re.search(pat, text):
            hits.append(f"{where} ({name})")

def scan_tree(label, node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, str) and v and SECRET_KEY_NAME.search(k):
                hits.append(f"{label} {p} (secret-like key name)")
            scan_tree(label, v, p)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            scan_tree(label, v, f"{path}[{i}]")
    elif isinstance(node, str):
        scan_text(f"{label} {path}", node)

def normalise(node):
    if isinstance(node, dict):
        return {k: normalise(v) for k, v in node.items()}
    if isinstance(node, list):
        return [normalise(v) for v in node]
    if isinstance(node, str):
        return re.sub(re.escape(home) + r"(?=/|$|[\s\"'])", "$HOME", node)
    return node

settings = None
if os.path.isfile(settings_src):
    raw = json.load(open(settings_src))
    dropped = sorted(k for k in raw if k not in ALLOWED_KEYS)
    settings = normalise({k: v for k, v in raw.items() if k in ALLOWED_KEYS})
    scan_tree("~/.claude/settings.json", settings)
    if dropped:
        print(f"  → settings keys not captured: {', '.join(dropped)}")
md = None
if os.path.isfile(md_src):
    md = open(md_src).read()
    scan_text("~/CLAUDE.md", md)

if hits:
    print("  ✗ capture stopped: secret-like values found; nothing written:", file=sys.stderr)
    for h in hits:
        print(f"    - {h}", file=sys.stderr)
    sys.exit(3)
if settings is not None:
    with open(settings_out, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")
if md is not None:
    with open(md_out, "w") as f:
        f.write(md)
PY

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

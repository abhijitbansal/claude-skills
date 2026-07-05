#!/usr/bin/env bash
# Find the current git repo's .claude/linear.yml. Export LINEAR_PM_* env vars.
# Source this from any /linear-* command. Fails (returns/exits 1) if not
# inside a git repo, no linear.yml is found, or required keys are missing.

_linear_yaml_get_top() {
  # top-level scalar key, e.g. "team", "autonomy"
  local file="$1" key="$2"
  python3 - "${file}" "${key}" <<'PY'
import sys, re
try:
    import yaml
    data = yaml.safe_load(open(sys.argv[1]))
    val = (data or {}).get(sys.argv[2])
    if val is None or isinstance(val, (dict, list)): sys.exit(1)
    print(val); sys.exit(0)
except ImportError:
    pass
key = sys.argv[2]
with open(sys.argv[1]) as f:
    for line in f:
        m = re.match(rf"{re.escape(key)}\s*:\s*(.+?)\s*$", line)
        if m:
            val = re.sub(r"(^|\s+)#.*$", "", m.group(1)).strip()
            if not val: sys.exit(1)
            print(val.strip('"').strip("'")); sys.exit(0)
sys.exit(1)
PY
}

_linear_yaml_get_nested() {
  # two-level scalar key, e.g. "poll.enabled"
  # NOTE: don't name a local var "path" — zsh ties it to $PATH, breaking
  # command lookup (e.g. python3) for the rest of this function's scope.
  local file="$1" keypath="$2"
  local top="${keypath%%.*}" leaf="${keypath#*.}"
  python3 - "${file}" "${top}" "${leaf}" <<'PY'
import sys
try:
    import yaml  # PyYAML
except ImportError:
    import re
    file, top, leaf = sys.argv[1], sys.argv[2], sys.argv[3]
    section = None
    with open(file) as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line or line.lstrip().startswith("#"): continue
            if not line.startswith(" ") and line.endswith(":"):
                section = line[:-1].strip()
                continue
            m = re.match(r"\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$", line)
            if m and section == top and m.group(1) == leaf:
                val = re.sub(r"(^|\s+)#.*$", "", m.group(2)).strip()
                if not val: sys.exit(1)
                print(val.strip('"').strip("'"))
                sys.exit(0)
    sys.exit(1)
else:
    file, top, leaf = sys.argv[1], sys.argv[2], sys.argv[3]
    data = yaml.safe_load(open(file))
    val = (data or {}).get(top, {}).get(leaf)
    if val is None: sys.exit(1)
    print(val)
PY
}

_linear_yaml_get_list() {
  # top-level list key ("verify", "default_labels"): newline-separated items.
  # Handles inline [a, b], block "- a" lists, and an absent/empty key (no output).
  local file="$1" key="$2"
  python3 - "${file}" "${key}" <<'PY'
import sys, re
file, key = sys.argv[1], sys.argv[2]
def emit(items):
    for i in items:
        s = str(i).strip()
        if s: print(s)
    sys.exit(0)
try:
    import yaml
    data = yaml.safe_load(open(file)) or {}
    val = data.get(key)
    if val is None: sys.exit(0)
    emit(val if isinstance(val, list) else [val])
except ImportError:
    pass
in_list, items = False, []
with open(file) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line or line.lstrip().startswith("#"): continue
        m = re.match(rf"{re.escape(key)}\s*:\s*(.*)$", line)
        if m and not line.startswith(" "):
            rest = re.sub(r"(^|\s+)#.*$", "", m.group(1)).strip()
            if rest.startswith("["):
                inner = re.match(r"\[(.*?)\]", rest)
                body = inner.group(1) if inner else rest.strip("[]")
                emit([x.strip().strip('"').strip("'") for x in body.split(",")])
            if rest == "":
                in_list = True
                continue
            emit([rest.strip('"').strip("'")])
        elif in_list:
            lm = re.match(r"\s+-\s*(.+?)\s*$", line)
            if lm:
                item = re.sub(r"(^|\s+)#.*$", "", lm.group(1)).strip()
                items.append(item.strip('"').strip("'"))
            else:
                break
if items: emit(items)
sys.exit(0)
PY
}

# When LINEAR_PM_CONFIG_HELPERS_ONLY=1, expose the helper functions without
# running discovery or exports (used by tests).
if [[ "${LINEAR_PM_CONFIG_HELPERS_ONLY:-}" == "1" ]]; then
  # shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
  return 0 2>/dev/null || exit 0
fi

# shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "linear-pm: not inside a git repo" >&2; return 1 2>/dev/null || exit 1; }

LINEAR_YML="${REPO_ROOT}/.claude/linear.yml"
# shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
[[ -f "${LINEAR_YML}" ]] \
  || { echo "linear-pm: ${LINEAR_YML} not found. Run /linear-init first." >&2; return 1 2>/dev/null || exit 1; }

# shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
LINEAR_PM_TEAM="$(_linear_yaml_get_top "${LINEAR_YML}" team)" \
  || { echo "linear-pm: ${LINEAR_YML} missing required 'team:' key" >&2; return 1 2>/dev/null || exit 1; }
export LINEAR_PM_TEAM

# shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
LINEAR_PM_PROJECT="$(_linear_yaml_get_top "${LINEAR_YML}" project)" \
  || { echo "linear-pm: ${LINEAR_YML} missing required 'project:' key" >&2; return 1 2>/dev/null || exit 1; }
export LINEAR_PM_PROJECT

LINEAR_PM_BRANCH_PREFIX="$(_linear_yaml_get_top "${LINEAR_YML}" branch_prefix 2>/dev/null || true)"
LINEAR_PM_BRANCH_PREFIX="${LINEAR_PM_BRANCH_PREFIX:-agent/}"; export LINEAR_PM_BRANCH_PREFIX

LINEAR_PM_PR_TITLE_FORMAT="$(_linear_yaml_get_top "${LINEAR_YML}" pr_title_format 2>/dev/null || true)"
LINEAR_PM_PR_TITLE_FORMAT="${LINEAR_PM_PR_TITLE_FORMAT:-"{key}: {title}"}"; export LINEAR_PM_PR_TITLE_FORMAT

LINEAR_PM_AUTONOMY="$(_linear_yaml_get_top "${LINEAR_YML}" autonomy 2>/dev/null || true)"
LINEAR_PM_AUTONOMY="${LINEAR_PM_AUTONOMY:-review-only}"; export LINEAR_PM_AUTONOMY

LINEAR_PM_MAX_PR_LINES="$(_linear_yaml_get_top "${LINEAR_YML}" max_pr_lines 2>/dev/null || true)"
LINEAR_PM_MAX_PR_LINES="${LINEAR_PM_MAX_PR_LINES:-500}"; export LINEAR_PM_MAX_PR_LINES

LINEAR_PM_VERIFY="$(_linear_yaml_get_list "${LINEAR_YML}" verify 2>/dev/null || true)"; export LINEAR_PM_VERIFY
LINEAR_PM_DEFAULT_LABELS="$(_linear_yaml_get_list "${LINEAR_YML}" default_labels 2>/dev/null || true)"; export LINEAR_PM_DEFAULT_LABELS

LINEAR_PM_POLL_ENABLED="$(_linear_yaml_get_nested "${LINEAR_YML}" poll.enabled 2>/dev/null || true)"
LINEAR_PM_POLL_ENABLED="${LINEAR_PM_POLL_ENABLED:-false}"; export LINEAR_PM_POLL_ENABLED

LINEAR_PM_POLL_INTERVAL_MINUTES="$(_linear_yaml_get_nested "${LINEAR_YML}" poll.interval_minutes 2>/dev/null || true)"
LINEAR_PM_POLL_INTERVAL_MINUTES="${LINEAR_PM_POLL_INTERVAL_MINUTES:-15}"; export LINEAR_PM_POLL_INTERVAL_MINUTES

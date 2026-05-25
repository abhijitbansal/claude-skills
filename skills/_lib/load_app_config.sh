#!/usr/bin/env bash
# Walk up from $PWD to find .claude/app.yml. Export APP_* and LINEAR_* env vars.
# Source this file from any templated skill's script. Fails (returns 1) if no
# app.yml is found or required keys are missing.

_find_app_yml() {
  local dir
  dir="$(pwd -P)"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/.claude/app.yml" ]]; then
      printf '%s\n' "${dir}/.claude/app.yml"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
}

_yaml_get() {
  # naive YAML reader for two-level keys: "app.name", "linear.team_key", …
  local file="$1" path="$2"
  local top="${path%%.*}" leaf="${path#*.}"
  python3 - "${file}" "${top}" "${leaf}" <<'PY'
import sys
try:
    import yaml  # PyYAML
except ImportError:
    # fall back to a stdlib mini-parser sufficient for this schema
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
                print(m.group(2).strip().strip('"').strip("'"))
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

APP_YML="$(_find_app_yml)" || { echo "no .claude/app.yml found above $(pwd)" >&2; return 1 2>/dev/null || exit 1; }

export APP_NAME="$(_yaml_get "${APP_YML}" app.name)"
export APP_BUNDLE_ID="$(_yaml_get "${APP_YML}" app.bundle_id)"
export APP_SCHEME="$(_yaml_get "${APP_YML}" app.scheme)"
export APP_TEAM_ID="$(_yaml_get "${APP_YML}" app.team_id)"
export APP_URL_SCHEME="$(_yaml_get "${APP_YML}" app.url_scheme)"
APP_BUILD_SCRIPT="$(_yaml_get "${APP_YML}" app.build_script 2>/dev/null || true)"
export APP_BUILD_SCRIPT="${APP_BUILD_SCRIPT:-build.sh}"
APP_PREVIEW_ROOT="$(_yaml_get "${APP_YML}" app.preview_root 2>/dev/null || true)"
export APP_PREVIEW_ROOT="${APP_PREVIEW_ROOT:-${HOME}/${APP_NAME}Previews}"
export LINEAR_TEAM_KEY="$(_yaml_get "${APP_YML}" linear.team_key 2>/dev/null || true)"

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

_yaml_get_top() {
  # top-level scalar key, e.g. "schema_version"
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

_yaml_get_list() {
  # two-level list key ("targets.extensions") -> items space-separated.
  # Handles inline [a, b] and block "- a" lists; a bare scalar becomes one item.
  local file="$1" path="$2"
  local top="${path%%.*}" leaf="${path#*.}"
  python3 - "${file}" "${top}" "${leaf}" <<'PY'
import sys, re
file, top, leaf = sys.argv[1], sys.argv[2], sys.argv[3]
def emit(items):
    print(" ".join(str(i).strip() for i in items if str(i).strip()))
    sys.exit(0)
try:
    import yaml
    data = yaml.safe_load(open(file)) or {}
    val = (data.get(top) or {}).get(leaf)
    if val is None: sys.exit(1)
    if isinstance(val, list): emit(val)
    emit([val])
except ImportError:
    pass
section, in_list, items = None, False, []
with open(file) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line or line.lstrip().startswith("#"): continue
        if not line.startswith(" ") and line.rstrip().endswith(":") and not line.startswith("  "):
            if in_list and items: emit(items)
            section = line.rstrip()[:-1].strip(); in_list = False; continue
        m = re.match(r"\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line)
        if m and section == top:
            if in_list and items: emit(items)
            in_list = False
            if m.group(1) == leaf:
                rest = re.sub(r"(^|\s+)#.*$", "", m.group(2)).strip()
                if rest.startswith("["):
                    inner = re.match(r"\[(.*?)\]", rest)
                    body = inner.group(1) if inner else rest.strip("[]")
                    emit([x.strip().strip('"').strip("'") for x in body.split(",")])
                if rest == "":
                    in_list = True; continue
                emit([rest.strip('"').strip("'")])
        elif in_list:
            lm = re.match(r"\s+-\s*(.+?)\s*$", line)
            if lm:
                item = re.sub(r"(^|\s+)#.*$", "", lm.group(1)).strip()
                items.append(item.strip('"').strip("'"))
            else:
                if items: emit(items)
                in_list = False
if in_list and items: emit(items)
sys.exit(1)
PY
}

# When APP_CONFIG_HELPERS_ONLY=1, expose the helper functions without running
# discovery or exports (used by validate_app_config.sh and lint scripts).
if [[ "${APP_CONFIG_HELPERS_ONLY:-}" == "1" ]]; then
  # shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
  return 0 2>/dev/null || exit 0
fi

# shellcheck disable=SC2317  # return/exit pair is intentional: works whether sourced or exec'd
APP_YML="$(_find_app_yml)" || { echo "no .claude/app.yml found above $(pwd)" >&2; return 1 2>/dev/null || exit 1; }

APP_NAME="$(_yaml_get "${APP_YML}" app.name)";                     export APP_NAME
APP_BUNDLE_ID="$(_yaml_get "${APP_YML}" app.bundle_id)";           export APP_BUNDLE_ID
APP_SCHEME="$(_yaml_get "${APP_YML}" app.scheme)";                 export APP_SCHEME
APP_TEAM_ID="$(_yaml_get "${APP_YML}" app.team_id)";               export APP_TEAM_ID
APP_URL_SCHEME="$(_yaml_get "${APP_YML}" app.url_scheme)";         export APP_URL_SCHEME
APP_BUILD_SCRIPT="$(_yaml_get "${APP_YML}" app.build_script 2>/dev/null || true)"
APP_BUILD_SCRIPT="${APP_BUILD_SCRIPT:-build.sh}";                  export APP_BUILD_SCRIPT
APP_PREVIEW_ROOT="$(_yaml_get "${APP_YML}" app.preview_root 2>/dev/null || true)"
APP_PREVIEW_ROOT="${APP_PREVIEW_ROOT:-${HOME}/${APP_NAME}Previews}"; export APP_PREVIEW_ROOT
LINEAR_TEAM_KEY="$(_yaml_get "${APP_YML}" linear.team_key 2>/dev/null || true)"; export LINEAR_TEAM_KEY

# ---- schema v2 (all optional; defaults keep v1 files working) ----
APP_CONFIG_SCHEMA="$(_yaml_get_top "${APP_YML}" schema_version 2>/dev/null || true)"
APP_CONFIG_SCHEMA="${APP_CONFIG_SCHEMA:-1}";                        export APP_CONFIG_SCHEMA

APP_PLATFORMS="$(_yaml_get_list "${APP_YML}" app.platforms 2>/dev/null || true)"
APP_PLATFORMS="${APP_PLATFORMS:-ios}";                              export APP_PLATFORMS
APP_MIN_OS="$(_yaml_get "${APP_YML}" app.min_os 2>/dev/null || true)"; export APP_MIN_OS

TARGETS_EXTENSIONS="$(_yaml_get_list "${APP_YML}" targets.extensions 2>/dev/null || true)"; export TARGETS_EXTENSIONS
TARGETS_APP_GROUP="$(_yaml_get "${APP_YML}" targets.app_group 2>/dev/null || true)"; export TARGETS_APP_GROUP

RELEASE_ENCRYPTION_EXEMPT="$(_yaml_get "${APP_YML}" release.encryption_exempt 2>/dev/null || true)"
RELEASE_ENCRYPTION_EXEMPT="${RELEASE_ENCRYPTION_EXEMPT:-true}";     export RELEASE_ENCRYPTION_EXEMPT
RELEASE_EXPORT_METHOD="$(_yaml_get "${APP_YML}" release.export_method 2>/dev/null || true)"
RELEASE_EXPORT_METHOD="${RELEASE_EXPORT_METHOD:-app-store-connect}"; export RELEASE_EXPORT_METHOD
RELEASE_FONTS_EXPECTED="$(_yaml_get "${APP_YML}" release.fonts_expected 2>/dev/null || true)"
RELEASE_FONTS_EXPECTED="${RELEASE_FONTS_EXPECTED:-0}";              export RELEASE_FONTS_EXPECTED
RELEASE_REQUIRED_CAPABILITIES="$(_yaml_get_list "${APP_YML}" release.required_capabilities 2>/dev/null || true)"; export RELEASE_REQUIRED_CAPABILITIES
RELEASE_USAGE_STRINGS="$(_yaml_get_list "${APP_YML}" release.usage_strings 2>/dev/null || true)"; export RELEASE_USAGE_STRINGS
RELEASE_WHATSNEW_FILE="$(_yaml_get "${APP_YML}" release.whatsnew_file 2>/dev/null || true)"; export RELEASE_WHATSNEW_FILE
RELEASE_INAPP_CHANGELOG_FILE="$(_yaml_get "${APP_YML}" release.inapp_changelog_file 2>/dev/null || true)"; export RELEASE_INAPP_CHANGELOG_FILE
RELEASE_ASC_APP_ID="$(_yaml_get "${APP_YML}" release.asc_app_id 2>/dev/null || true)"; export RELEASE_ASC_APP_ID
RELEASE_TESTFLIGHT_BUMP="$(_yaml_get "${APP_YML}" release.testflight_bump 2>/dev/null || true)"
RELEASE_TESTFLIGHT_BUMP="${RELEASE_TESTFLIGHT_BUMP:-build}";        export RELEASE_TESTFLIGHT_BUMP
RELEASE_HOOKS_DIR="$(_yaml_get "${APP_YML}" release.hooks_dir 2>/dev/null || true)"
RELEASE_HOOKS_DIR="${RELEASE_HOOKS_DIR:-scripts/release-hooks}";    export RELEASE_HOOKS_DIR

SITE_REPO="$(_yaml_get "${APP_YML}" site.repo 2>/dev/null || true)"; export SITE_REPO
SITE_DIR="$(_yaml_get "${APP_YML}" site.dir 2>/dev/null || true)"
SITE_DIR="${SITE_DIR:-site}";                                       export SITE_DIR
SITE_DOMAIN="$(_yaml_get "${APP_YML}" site.domain 2>/dev/null || true)"; export SITE_DOMAIN
SITE_DEPLOY="$(_yaml_get "${APP_YML}" site.deploy 2>/dev/null || true)"
SITE_DEPLOY="${SITE_DEPLOY:-subtree-ssh}";                          export SITE_DEPLOY

CI_PROVIDER="$(_yaml_get "${APP_YML}" ci.provider 2>/dev/null || true)"
CI_PROVIDER="${CI_PROVIDER:-xcode-cloud}";                          export CI_PROVIDER
CI_POST_CLONE="$(_yaml_get "${APP_YML}" ci.post_clone 2>/dev/null || true)"
CI_POST_CLONE="${CI_POST_CLONE:-ci_scripts/ci_post_clone.sh}";      export CI_POST_CLONE

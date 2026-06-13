#!/usr/bin/env bash
#
# ios-dev: scaffold .claude/app.yml for the iOS app in the current repo.
#
# Detects what it can from an XcodeGen project.yml (preferred) or, failing
# that, from `xcodebuild -list` against an .xcodeproj/.xcworkspace. Writes
# .claude/app.yml at the repo root with detected values filled in and the
# rest left as TODO placeholders for the user to complete.
#
# Never clobbers an existing .claude/app.yml unless --force is passed.
#
# Usage:
#   init_app_config.sh [--force] [--dir <repo-root>]
#
# Output: prints the path written and a short summary of detected vs TODO
# fields on the last lines of stdout.

set -euo pipefail

FORCE=false
ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    --dir)   ROOT="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "[ios-init] Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve repo root: explicit --dir, else git toplevel, else CWD.
if [[ -z "$ROOT" ]]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
fi
[[ -d "$ROOT" ]] || { echo "[ios-init] Not a directory: $ROOT" >&2; exit 1; }

OUT="$ROOT/.claude/app.yml"
if [[ -f "$OUT" && "$FORCE" != true ]]; then
  echo "[ios-init] $OUT already exists. Re-run with --force to overwrite." >&2
  exit 3
fi

# Detection runs in python: it understands XcodeGen project.yml (with a
# stdlib fallback when PyYAML is missing) and can shell out to xcodebuild.
# We write to a temp file rather than $(...) around the heredoc — macOS's
# bash 3.2 mis-parses a here-document nested inside command substitution.
_DET_TMP="$(mktemp)"
ROOT="$ROOT" python3 - > "$_DET_TMP" <<'PY'
import json, os, re, subprocess, glob

root = os.environ["ROOT"]
out = {"name": "", "bundle_id": "", "scheme": "", "team_id": "",
       "url_scheme": "", "source": "none"}

def load_yaml(path):
    try:
        import yaml
        with open(path) as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        return None  # signal: use the regex fallback
    except Exception:
        return {}

pj = os.path.join(root, "project.yml")
if os.path.isfile(pj):
    out["source"] = "project.yml"
    data = load_yaml(pj)
    if data is not None:
        out["name"] = (data.get("name") or "").strip()
        targets = data.get("targets") or {}
        # Prefer an application target; else first target.
        app_target = None
        for tname, tdef in targets.items():
            ttype = (tdef or {}).get("type", "")
            if "application" in str(ttype):
                app_target = (tname, tdef); break
        if app_target is None and targets:
            first = next(iter(targets.items()))
            app_target = first
        if app_target:
            out["scheme"] = out["scheme"] or app_target[0]
            settings = ((app_target[1] or {}).get("settings") or {})
            base = settings.get("base", settings) or {}
            out["bundle_id"] = str(base.get("PRODUCT_BUNDLE_IDENTIFIER", "") or "")
            out["team_id"] = str(base.get("DEVELOPMENT_TEAM", "") or "")
    else:
        # Regex fallback for environments without PyYAML.
        txt = open(pj).read()
        m = re.search(r'^name:\s*(.+)$', txt, re.M)
        if m: out["name"] = m.group(1).strip().strip('"').strip("'")
        # First key under `targets:` is the scheme (skip blank/comment lines).
        m = re.search(r'^targets:\s*\n(?:\s*(?:#.*)?\n)*\s+([A-Za-z0-9_.\-]+):', txt, re.M)
        if m: out["scheme"] = m.group(1).strip()
        m = re.search(r'PRODUCT_BUNDLE_IDENTIFIER:\s*(.+)$', txt, re.M)
        if m: out["bundle_id"] = m.group(1).strip().strip('"').strip("'")
        m = re.search(r'DEVELOPMENT_TEAM:\s*(.+)$', txt, re.M)
        if m: out["team_id"] = m.group(1).strip().strip('"').strip("'")

# Fall back to xcodebuild for the scheme when project.yml didn't yield one.
if not out["scheme"]:
    proj = glob.glob(os.path.join(root, "*.xcworkspace")) or \
           glob.glob(os.path.join(root, "*.xcodeproj"))
    if proj:
        flag = "-workspace" if proj[0].endswith(".xcworkspace") else "-project"
        try:
            res = subprocess.run(
                ["xcodebuild", flag, proj[0], "-list", "-json"],
                capture_output=True, text=True, timeout=60)
            if res.returncode == 0:
                info = json.loads(res.stdout)
                schemes = (info.get("project") or info.get("workspace") or {}).get("schemes") or []
                if schemes:
                    out["scheme"] = schemes[0]
                    out["source"] = out["source"] if out["source"] != "none" else "xcodebuild"
        except Exception:
            pass

# Best-effort URL-scheme detection from any Info.plist in the repo.
for plist in glob.glob(os.path.join(root, "**", "Info.plist"), recursive=True):
    try:
        txt = open(plist, errors="ignore").read()
        m = re.search(r'<key>CFBundleURLSchemes</key>\s*<array>\s*<string>([^<]+)</string>', txt)
        if m:
            out["url_scheme"] = m.group(1).strip()
            break
    except Exception:
        pass

# Derive a default name from the directory if nothing was found.
if not out["name"]:
    out["name"] = os.path.basename(os.path.abspath(root))

print(json.dumps(out))
PY
DETECTED="$(cat "$_DET_TMP")"
rm -f "$_DET_TMP"

# Pull fields out of the JSON without assuming jq is installed.
get() { printf '%s' "$DETECTED" | python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }

NAME="$(get name)"
BUNDLE_ID="$(get bundle_id)"
SCHEME="$(get scheme)"
TEAM_ID="$(get team_id)"
URL_SCHEME="$(get url_scheme)"
SOURCE="$(get source)"

# Placeholders for anything we couldn't detect, so the file is obviously
# incomplete rather than silently wrong.
todo() { [[ -n "$1" ]] && printf '%s' "$1" || printf 'TODO'; }
NAME="$(todo "$NAME")"
BUNDLE_ID="$(todo "$BUNDLE_ID")"
SCHEME="$(todo "$SCHEME")"
TEAM_ID="$(todo "$TEAM_ID")"
[[ -z "$URL_SCHEME" ]] && URL_SCHEME="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"

mkdir -p "$ROOT/.claude"
cat > "$OUT" <<YAML
# Per-app config consumed by ios-dev skills (release, ios-build, app-preview).
# Generated by /ios-init from: ${SOURCE}. Replace any TODO with the real value.
schema_version: 1

app:
  name: ${NAME}
  bundle_id: ${BUNDLE_ID}
  scheme: ${SCHEME}
  team_id: ${TEAM_ID}
  url_scheme: ${URL_SCHEME}
  build_script: build.sh                # optional, default build.sh
  preview_root: ~/${NAME}Previews       # optional, default ~/<name>Previews

linear:
  team_key:                             # optional, for /linear-* commands
  agent_user_id:                        # optional, for /linear-pick assignment
YAML

echo "==> wrote $OUT (detected via: ${SOURCE})"
echo "    name=${NAME} bundle_id=${BUNDLE_ID} scheme=${SCHEME} team_id=${TEAM_ID} url_scheme=${URL_SCHEME}"
printf '%s\n' "$OUT"

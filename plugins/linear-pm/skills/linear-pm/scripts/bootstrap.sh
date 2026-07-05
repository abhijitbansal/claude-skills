#!/usr/bin/env bash
#
# linear-pm — bootstrap / prerequisite checker.
#
# Verifies everything /linear-* commands need before they're run. Does NOT
# install anything (so it can't surprise you with a brew install on the wrong
# machine) — just diagnoses and prints the exact command to fix each gap.
#
# Idempotent. Run any time you suspect setup drift.
#
# Exit codes:
#   0  — all checks passed, ready to use the /linear-* commands
#   1  — one or more checks failed; see [FAIL] / [WARN] entries above
#
# Usage:
#   ./.claude/skills/linear-pm/scripts/bootstrap.sh
#   ./.claude/skills/linear-pm/scripts/bootstrap.sh --quiet   # only print failures + summary

set -uo pipefail   # not -e; we want to keep going past failures and report all of them

QUIET=false
[[ "${1:-}" == "--quiet" ]] && QUIET=true

# --- colors (auto-disabled when not a TTY) ---
if [[ -t 1 ]]; then
  G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[1m"; X="\033[0m"
else
  G=""; Y=""; R=""; B=""; X=""
fi

PASS=0
FAIL=0
WARN=0

ok()   { ((PASS++)); $QUIET || printf "${G}[ OK ]${X} %s\n" "$1"; }
warn() { ((WARN++)); printf "${Y}[WARN]${X} %s\n" "$1"; [[ -n "${2:-}" ]] && printf "       → %s\n" "$2"; }
fail() { ((FAIL++)); printf "${R}[FAIL]${X} %s\n" "$1"; [[ -n "${2:-}" ]] && printf "       → %s\n" "$2"; }

# Resolve repo root from the invocation cwd (the repo this is being run
# against), not this script's own location — this script may be running from
# a plugin cache path (marketplace install) or a project-local copy, and
# either way the repo being checked is wherever the user is standing.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "bootstrap: not inside a git repo (run this from within the target repo)" >&2
  exit 1
fi
cd "$REPO_ROOT" || { echo "bootstrap: failed to cd into $REPO_ROOT" >&2; exit 1; }

$QUIET || printf "${B}linear-pm bootstrap${X} — checking prerequisites in %s\n\n" "$REPO_ROOT"

# --- 1. git installed ---
if command -v git >/dev/null 2>&1; then
  ok "git installed ($(git --version | awk '{print $3}'))"
else
  fail "git not installed" "Install Xcode Command Line Tools: xcode-select --install"
fi

# --- 2. inside a git repo ---
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  ok "inside a git repo ($(git rev-parse --show-toplevel))"
else
  fail "not inside a git repo" "cd into the Paperix repo before running this script"
fi

# --- 3. gh CLI installed ---
if command -v gh >/dev/null 2>&1; then
  ok "gh CLI installed ($(gh --version | head -1 | awk '{print $3}'))"
else
  fail "gh CLI not installed" "brew install gh"
fi

# --- 4. gh authenticated ---
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    GH_USER="$(gh api user --jq .login 2>/dev/null || echo unknown)"
    ok "gh authenticated (as $GH_USER)"
  else
    fail "gh not authenticated" "gh auth login   (choose GitHub.com, HTTPS, login with browser)"
  fi
else
  warn "gh auth check skipped (gh not installed)"
fi

# --- 5. linear.yml present ---
LINEAR_YML="$REPO_ROOT/.claude/linear.yml"
if [[ -f "$LINEAR_YML" ]]; then
  ok ".claude/linear.yml exists"
else
  fail ".claude/linear.yml missing" "Run /linear-init in Claude Code to create it"
fi

# --- 6. linear.yml has required keys ---
if [[ -f "$LINEAR_YML" ]]; then
  # Parse permissively — no yq dependency. Just grep for the top-level keys.
  has_team=$(grep -E '^team:[[:space:]]*[^[:space:]]' "$LINEAR_YML" 2>/dev/null | head -1)
  has_project=$(grep -E '^project:[[:space:]]*[^[:space:]]' "$LINEAR_YML" 2>/dev/null | head -1)

  if [[ -n "$has_team" ]]; then
    ok "linear.yml has \`team:\` ($(echo "$has_team" | awk '{print $2}'))"
  else
    fail "linear.yml missing required \`team:\` key" "Add: team: <your-linear-team-key>"
  fi

  if [[ -n "$has_project" ]]; then
    ok "linear.yml has \`project:\` ($(echo "$has_project" | awk '{print $2}'))"
  else
    fail "linear.yml missing required \`project:\` key" "Add: project: <your-linear-project-name>"
  fi

  # autonomy is optional but worth surfacing so the user knows the current mode
  autonomy=$(grep -E '^autonomy:[[:space:]]*[^[:space:]]' "$LINEAR_YML" 2>/dev/null | head -1 | awk '{print $2}')
  if [[ -n "$autonomy" ]]; then
    case "$autonomy" in
      disabled|review-only|allowed)
        ok "linear.yml \`autonomy:\` = $autonomy"
        ;;
      *)
        warn "linear.yml \`autonomy:\` = $autonomy (unrecognized)" \
             "Expected one of: disabled, review-only, allowed"
        ;;
    esac
  else
    warn "linear.yml has no \`autonomy:\` key (defaults to review-only)" \
         "Add explicitly if you intend disabled or allowed"
  fi
fi

# --- 7. helper scripts present (load-config, make-slug, parse-issue-key) ---
# These ship as siblings of this script (skills/linear-pm/scripts/), not as a
# per-repo copy — so this checks SCRIPT_DIR, not anything under REPO_ROOT.
missing_helpers=()
for helper in load-config.sh make-slug.sh parse-issue-key.sh; do
  [[ -f "$SCRIPT_DIR/$helper" ]] || missing_helpers+=("$helper")
done
if [[ ${#missing_helpers[@]} -eq 0 ]]; then
  ok "linear-pm helper scripts present (load-config, make-slug, parse-issue-key)"
else
  fail "linear-pm helper scripts missing: ${missing_helpers[*]}" \
       "These ship with the skill at skills/linear-pm/scripts/. Did the plugin install incompletely?"
fi

# --- 8. Linear MCP — informational only (cannot verify from shell) ---
$QUIET || {
  printf "\n${B}Cannot verify from shell:${X}\n"
  printf "  - Linear MCP server connection (configured in Claude Code, not via CLI)\n"
  printf "    If \`/linear-new\` errors with 'Linear MCP not available', add the\n"
  printf "    Linear connector in Claude Code's MCP settings.\n"
}

# --- summary ---
echo
if [[ $FAIL -eq 0 ]]; then
  printf "${G}${B}All %d checks passed%s${X}" "$PASS" "$([[ $WARN -gt 0 ]] && echo " ($WARN warning(s))")"
  echo
  $QUIET || {
    printf "\nNext steps:\n"
    printf "  • File a feature:    ${B}/linear-new \"<title>\"${X}\n"
    printf "  • Pick it up:        ${B}/linear-pick${X} (after adding agent-ready in Linear UI)\n"
    printf "  • See what's flying: ${B}/linear-status${X}\n"
    printf "  • Full guide:        ${B}.claude/skills/linear-pm/README.md${X}\n"
  }
  exit 0
else
  printf "${R}${B}%d check(s) failed${X}, %d passed%s\n" "$FAIL" "$PASS" "$([[ $WARN -gt 0 ]] && echo ", $WARN warning(s)")"
  printf "\nFix the ${R}[FAIL]${X} items above, then re-run this script.\n"
  exit 1
fi

#!/usr/bin/env bats

load helpers

setup() {
  # Resolve symlinks (macOS mktemp lands under /var, a symlink to /private/var)
  # so string comparisons against `git rev-parse --show-toplevel` (which
  # resolves symlinks) match.
  TMP="$(cd "$(mktemp -d)" && pwd -P)"
  REPO_ROOT="${BATS_TEST_DIRNAME}/../.."
  SCRIPTS="${REPO_ROOT}/plugins/linear-pm/skills/linear-pm/scripts"
}

teardown() { rm -rf "${TMP}"; }

write_linear_yml() {  # $1 = dir, $2... = extra lines appended after the required keys
  mkdir -p "$1/.claude"
  {
    echo "team: ABH"
    echo "project: Demo"
    shift
    for line in "$@"; do echo "$line"; done
  } > "$1/.claude/linear.yml"
}

init_repo() {  # $1 = dir
  git -C "$1" init -q
  git -C "$1" add -A
  git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
}

# --- load-config.sh ---

@test "load-config exports required keys and defaults" {
  write_linear_yml "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  source "${SCRIPTS}/load-config.sh"
  [ "${LINEAR_PM_TEAM}" = "ABH" ]
  [ "${LINEAR_PM_PROJECT}" = "Demo" ]
  [ "${LINEAR_PM_BRANCH_PREFIX}" = "agent/" ]
  [ "${LINEAR_PM_PR_TITLE_FORMAT}" = "{key}: {title}" ]
  [ "${LINEAR_PM_AUTONOMY}" = "review-only" ]
  [ "${LINEAR_PM_MAX_PR_LINES}" = "500" ]
  [ "${LINEAR_PM_VERIFY}" = "" ]
  [ "${LINEAR_PM_DEFAULT_LABELS}" = "" ]
  [ "${LINEAR_PM_POLL_ENABLED}" = "false" ]
  [ "${LINEAR_PM_POLL_INTERVAL_MINUTES}" = "15" ]
}

@test "load-config exports overridden keys, block lists, and nested poll settings" {
  write_linear_yml "${TMP}/repo" \
    "autonomy: allowed" \
    "branch_prefix: work/" \
    "max_pr_lines: 300" \
    "verify:" \
    "  - npm test" \
    "  - npm run lint" \
    "default_labels: [needs-triage, urgent]" \
    "poll:" \
    "  enabled: true" \
    "  interval_minutes: 10"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  source "${SCRIPTS}/load-config.sh"
  [ "${LINEAR_PM_AUTONOMY}" = "allowed" ]
  [ "${LINEAR_PM_BRANCH_PREFIX}" = "work/" ]
  [ "${LINEAR_PM_MAX_PR_LINES}" = "300" ]
  [ "${LINEAR_PM_VERIFY}" = "$(printf 'npm test\nnpm run lint')" ]
  [ "${LINEAR_PM_DEFAULT_LABELS}" = "$(printf 'needs-triage\nurgent')" ]
  [ "${LINEAR_PM_POLL_ENABLED}" = "true" ]
  [ "${LINEAR_PM_POLL_INTERVAL_MINUTES}" = "10" ]
}

@test "load-config errors when not inside a git repo" {
  cd "${TMP}"
  run bash -c "source '${SCRIPTS}/load-config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not inside a git repo"* ]]
}

@test "load-config errors when .claude/linear.yml is missing" {
  mkdir -p "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash -c "source '${SCRIPTS}/load-config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"linear.yml not found"* ]]
}

@test "load-config errors when 'team:' key is missing" {
  mkdir -p "${TMP}/repo/.claude"
  echo "project: Demo" > "${TMP}/repo/.claude/linear.yml"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash -c "source '${SCRIPTS}/load-config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required 'team:' key"* ]]
}

@test "load-config errors when 'project:' key is missing" {
  mkdir -p "${TMP}/repo/.claude"
  echo "team: ABH" > "${TMP}/repo/.claude/linear.yml"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash -c "source '${SCRIPTS}/load-config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing required 'project:' key"* ]]
}

@test "LINEAR_PM_CONFIG_HELPERS_ONLY=1 sources helpers without discovery" {
  cd "${TMP}"   # no linear.yml anywhere, no git repo
  LINEAR_PM_CONFIG_HELPERS_ONLY=1 source "${SCRIPTS}/load-config.sh"
  type _linear_yaml_get_top >/dev/null
  type _linear_yaml_get_nested >/dev/null
  type _linear_yaml_get_list >/dev/null
}

# --- make-slug.sh ---

@test "make-slug lowercases and hyphenates a normal title" {
  run bash "${SCRIPTS}/make-slug.sh" "Fix login crash on iPad"
  [ "$status" -eq 0 ]
  [ "$output" = "fix-login-crash-on-ipad" ]
}

@test "make-slug strips punctuation and collapses repeated separators" {
  run bash "${SCRIPTS}/make-slug.sh" "  Weird!!! Title... with -- symbols  "
  [ "$status" -eq 0 ]
  [ "$output" = "weird-title-with-symbols" ]
}

@test "make-slug falls back to 'issue' when title has no alphanumeric chars" {
  run bash "${SCRIPTS}/make-slug.sh" "???"
  [ "$status" -eq 0 ]
  [ "$output" = "issue" ]
}

@test "make-slug truncates to 50 chars" {
  run bash "${SCRIPTS}/make-slug.sh" "this title is intentionally extremely long so that it exceeds the fifty character cap by a comfortable margin"
  [ "$status" -eq 0 ]
  [ "${#output}" -le 50 ]
}

# --- parse-issue-key.sh ---

@test "parse-issue-key extracts the key from a prefixed branch name" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "agent/ABH-123-fix-login-crash"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-123" ]
}

@test "parse-issue-key extracts the key from a bare key" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "ABH-42"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-42" ]
}

@test "parse-issue-key prints nothing for a branch with no key" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "main"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

# --- bootstrap.sh ---

@test "bootstrap resolves REPO_ROOT to the invocation cwd, not the script's own location" {
  mkdir -p "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/bootstrap.sh"
  [[ "$output" == *"checking prerequisites in ${TMP}/repo"* ]]
}

@test "bootstrap finds all 3 helper scripts as siblings of itself" {
  mkdir -p "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/bootstrap.sh" --quiet
  [[ "$output" != *"helper scripts missing"* ]]
}

@test "bootstrap fails cleanly when not inside a git repo" {
  cd "${TMP}"
  run bash "${SCRIPTS}/bootstrap.sh" --quiet
  [ "$status" -eq 1 ]
  [[ "$output" == *"not inside a git repo"* ]]
}

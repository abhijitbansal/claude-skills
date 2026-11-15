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

# --- load-config.sh --print (CAT-88) ---
# Each Bash call is a fresh shell, so exports from a sourced loader are gone by
# the next call; --print lets a command read the values in the same call.

@test "load-config --print emits KEY=value lines including LINEAR_PM_AUTONOMY" {
  write_linear_yml "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/load-config.sh" --print
  [ "$status" -eq 0 ]
  [[ "$output" == *"LINEAR_PM_TEAM=ABH"* ]] || false
  [[ "$output" == *"LINEAR_PM_PROJECT=Demo"* ]] || false
  [[ "$output" == *"LINEAR_PM_AUTONOMY=review-only"* ]] || false
  [[ "$output" == *"LINEAR_PM_MAX_PR_LINES=500"* ]] || false
}

@test "load-config --print reports a configured autonomy value" {
  write_linear_yml "${TMP}/repo" "autonomy: allowed"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/load-config.sh" --print
  [ "$status" -eq 0 ]
  [[ "$output" == *"LINEAR_PM_AUTONOMY=allowed"* ]] || false
}

@test "load-config --print repeats list keys once per item" {
  write_linear_yml "${TMP}/repo" "verify:" "  - npm test" "  - npm run lint"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/load-config.sh" --print
  [ "$status" -eq 0 ]
  [[ "$output" == *"LINEAR_PM_VERIFY=npm test"* ]] || false
  [[ "$output" == *"LINEAR_PM_VERIFY=npm run lint"* ]] || false
}

@test "load-config --print works when sourced, in the same shell" {
  write_linear_yml "${TMP}/repo" "autonomy: disabled"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash -c "source '${SCRIPTS}/load-config.sh' --print"
  [ "$status" -eq 0 ]
  [[ "$output" == *"LINEAR_PM_AUTONOMY=disabled"* ]] || false
}

@test "load-config --print keeps the loader's error path (no linear.yml)" {
  mkdir -p "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/load-config.sh" --print
  [ "$status" -ne 0 ]
  [[ "$output" == *"linear.yml not found"* ]] || false
}

@test "load-config rejects an unknown flag and lists the accepted ones" {
  write_linear_yml "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/load-config.sh" --pritn
  [ "$status" -eq 2 ]
  [[ "$output" == *"--print"* ]] || false
}

@test "commands that read config tell the agent to source and print in one Bash call" {
  for c in linear-block linear-sync linear-new linear-status; do
    grep -q -- "--print" "${REPO_ROOT}/plugins/linear-pm/commands/${c}.md"
  done
}

# --- command docs (CAT-89 block half, CAT-91) ---

@test "linear-block removes agent-ready so a blocked issue is not picked again" {
  local f="${REPO_ROOT}/plugins/linear-pm/commands/linear-block.md"
  grep -q "Remove the \`agent-ready\` label" "$f"
}

@test "linear-sync never moves a Done or cancelled issue and only counts an OPEN PR" {
  local f="${REPO_ROOT}/plugins/linear-pm/commands/linear-sync.md"
  grep -q "Done" "$f"
  grep -q "never move" "$f"
  grep -q 'state=="OPEN"' "$f"
  grep -q 'parse-issue-key.sh" "\$BRANCH" "\$LINEAR_PM_TEAM"' "$f"
}

@test "linear-sync Done guard covers both Canceled spellings and the completed or canceled status type" {
  local f="${REPO_ROOT}/plugins/linear-pm/commands/linear-sync.md"
  grep -q "Canceled" "$f"
  grep -q "Cancelled" "$f"
  grep -qi "status type" "$f"
  grep -q "completed" "$f"
}

@test "linear-pm skill documents the MCP tool availability check and the 50-char slug" {
  local f="${REPO_ROOT}/plugins/linear-pm/skills/linear-pm/SKILL.md"
  grep -q "Linear MCP tools" "$f"
  grep -q "~50 chars" "$f"
  ! grep -q "~40 chars" "$f"
}

@test "linear-pm plugin has no stale 'polling agent' wording or private example keys" {
  run grep -rniE "polling agent|ABH|document-scanner" \
    "${REPO_ROOT}/plugins/linear-pm/skills" \
    "${REPO_ROOT}/plugins/linear-pm/commands/linear-block.md" \
    "${REPO_ROOT}/plugins/linear-pm/commands/linear-sync.md" \
    "${REPO_ROOT}/plugins/linear-pm/commands/linear-init.md" \
    "${REPO_ROOT}/plugins/linear-pm/commands/linear-new.md" \
    "${REPO_ROOT}/plugins/linear-pm/commands/linear-status.md"
  [ "$status" -eq 1 ]
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

# CAT-91: team-aware, case-insensitive parsing

@test "parse-issue-key with a team accepts a lowercase key after a user prefix" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "user/abh-123-title" "ABH"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-123" ]
}

@test "parse-issue-key with a team rejects non-team tokens like UTF-8" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "fix/UTF-8-bug" "ABH"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "parse-issue-key with a team takes the team's key even when another token comes first" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "fix/UTF-8-abh-7-bug" "ABH"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-7" ]
}

@test "parse-issue-key with a team does not match inside a longer word" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "fix/xabh-9-bug" "ABH"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "parse-issue-key reads the team from LINEAR_PM_TEAM when no second arg is given" {
  run env LINEAR_PM_TEAM=ABH bash "${SCRIPTS}/parse-issue-key.sh" "user/abh-123-title"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-123" ]
}

@test "parse-issue-key without a team keeps the uppercase-only behaviour" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "user/abh-123-title"
  [ "$status" -eq 0 ]
  [ "$output" = "" ]
}

@test "parse-issue-key ignores a team value that is not a plain key" {
  run bash "${SCRIPTS}/parse-issue-key.sh" "agent/ABH-5-x" ".*"
  [ "$status" -eq 0 ]
  [ "$output" = "ABH-5" ]
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

# CAT-50: strict flags. A typo must not silently run the full check.

@test "bootstrap rejects an unknown flag with exit 2 and lists the accepted ones" {
  mkdir -p "${TMP}/repo"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/bootstrap.sh" --quite
  [ "$status" -eq 2 ]
  [[ "$output" == *"--quite"* ]] || false
  [[ "$output" == *"--quiet"* ]] || false
  [[ "$output" != *"checking prerequisites"* ]] || false
}

@test "bootstrap --help exits 0 and lists the flags" {
  run bash "${SCRIPTS}/bootstrap.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--quiet"* ]] || false
}

# CAT-91: bootstrap gaps

@test "bootstrap fails when linear.yml still holds the template placeholders" {
  mkdir -p "${TMP}/repo/.claude"
  printf 'team: REPLACE_TEAM_KEY\nproject: REPLACE_PROJECT_NAME\n' > "${TMP}/repo/.claude/linear.yml"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/bootstrap.sh" --quiet
  [ "$status" -eq 1 ]
  [[ "$output" == *"placeholder"* ]] || false
}

@test "bootstrap accepts a real team and project" {
  write_linear_yml "${TMP}/repo" "autonomy: review-only"
  init_repo "${TMP}/repo"
  cd "${TMP}/repo"
  run bash "${SCRIPTS}/bootstrap.sh" --quiet
  [[ "$output" != *"placeholder"* ]] || false
}

@test "bootstrap reports a missing python3" {
  write_linear_yml "${TMP}/repo" "autonomy: review-only"
  init_repo "${TMP}/repo"
  mkdir -p "${TMP}/nopy"
  for t in git grep awk head dirname; do ln -s "$(command -v "$t")" "${TMP}/nopy/$t"; done
  cd "${TMP}/repo"
  run env PATH="${TMP}/nopy" /bin/bash "${SCRIPTS}/bootstrap.sh" --quiet
  [ "$status" -eq 1 ]
  [[ "$output" == *"python3"* ]] || false
}

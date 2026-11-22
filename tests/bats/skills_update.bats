#!/usr/bin/env bats

# Weekly launchd job that runs `npx skills update -g -y`: the setup.sh
# `skills_schedule` step (plist render + launchctl) and setup/skills-update.sh
# (the job body). Every test uses a fake HOME and the mocked launchctl/npx.

load helpers

LABEL="com.claude-skills.skills-update"

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
  export MOCK_CALL_LOG="${TMP}/mock-calls.log"
  : > "${MOCK_CALL_LOG}"
  # The step must never reach the real launchd: it takes the binary from
  # LAUNCHCTL, and every test points that at the mock.
  export LAUNCHCTL="${BATS_TEST_DIRNAME}/mocks/launchctl"
  [ -x "${LAUNCHCTL}" ]
  # Defence in depth: even a launchctl looked up on the test PATH is the mock.
  mkdir -p "${TMP}/bin" "${TMP}/mockbin"
  ln -s "${LAUNCHCTL}" "${TMP}/mockbin/launchctl"
  TEST_PATH="${TMP}/bin:${TMP}/mockbin:${PATH}"
  [ "$(PATH="${TEST_PATH}" command -v launchctl)" = "${TMP}/mockbin/launchctl" ]
  export MOCK_LAUNCHCTL_STATE="${TMP}/launchctl-state"
  mkdir -p "${MOCK_LAUNCHCTL_STATE}"
  export SKILLS_SCHEDULE_POLL_DELAY=0
  PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
  SETUP="${CLAUDE_SKILLS_HOME}/setup/setup.sh"
  JOB="${CLAUDE_SKILLS_HOME}/setup/skills-update.sh"
  mkdir -p "${TMP}/bin"
  # Pretend to be macOS so the step runs on Linux CI too.
  printf '#!/bin/sh\necho Darwin\n' > "${TMP}/bin/uname"
  chmod +x "${TMP}/bin/uname"
  printf '[meta]\nschema_version = 1\n[schedule]\nskills_weekly_update = true\n' > "${TMP}/on.toml"
  printf '[meta]\nschema_version = 1\n[schedule]\nskills_weekly_update = false\n' > "${TMP}/off.toml"
}

teardown() { chmod -R u+w "${TMP}" 2>/dev/null; rm -rf "${TMP}"; }

# run the step against a toml ($1) with extra setup.sh args ($2...)
run_step() {
  local toml="$1"; shift
  CLAUDE_SETUP_TOML="${toml}" PATH="${TEST_PATH}" \
    run bash "${SETUP}" --only skills_schedule "$@"
}

# A PATH dir holding only the tools the step and the job need, so `npx` is absent
# even on a machine that has it. $1 = dir.
make_nonpx_bin() {
  local d="$1" t p
  mkdir -p "${d}"
  for t in bash env python3 id mktemp cmp dirname mkdir mv rm chmod cat date sleep cp wc tail pkill; do
    p="$(command -v "${t}" 2>/dev/null)" || continue
    [[ -x "${p}" ]] && ln -sf "${p}" "${d}/${t}"
  done
  printf '#!/bin/sh\necho Darwin\n' > "${d}/uname"
  chmod +x "${d}/uname"
}

plist_get() {  # $1 = python expression over `d` (the parsed plist)
  python3 -c 'import plistlib,sys; d=plistlib.load(open(sys.argv[1],"rb")); print(eval(sys.argv[2]))' "${PLIST}" "$1"
}

calls() { cat "${MOCK_CALL_LOG}"; }

@test "shipped claude-setup.toml enables the weekly skills update" {
  run python3 "${CLAUDE_SKILLS_HOME}/setup/parse_toml.py" "${CLAUDE_SKILLS_HOME}/claude-setup.toml" schedule
  [ "$status" -eq 0 ]
  out_has '"skills_weekly_update": true'
}

@test "skills_schedule renders a plist with a generic label and the absolute npx path" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ -f "${PLIST}" ]
  [ "$(plist_get 'd["Label"]')" = "${LABEL}" ]
  [ "$(plist_get 'd["EnvironmentVariables"]["SKILLS_NPX"]')" = "$(command -v npx)" ]
  [[ "$(plist_get 'd["EnvironmentVariables"]["SKILLS_NPX"]')" == /* ]]
  [ "$(plist_get 'd["ProgramArguments"][-1]')" = "$(cd "${CLAUDE_SKILLS_HOME}" && pwd)/setup/skills-update.sh" ]
}

@test "plist leaves PATH to skills-update.sh: one source of truth" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ "$(plist_get '"PATH" in d["EnvironmentVariables"]')" = "False" ]
}

@test "plist runs weekly on Sunday 10:00, not at load, and logs under ~/Library/Logs/claude-skills" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ "$(plist_get 'd["StartCalendarInterval"]')" = "{'Weekday': 0, 'Hour': 10, 'Minute': 0}" ]
  [ "$(plist_get 'd["RunAtLoad"]')" = "False" ]
  [ "$(plist_get 'd["StandardOutPath"]')" = "${HOME}/Library/Logs/claude-skills/launchd.out.log" ]
  [ "$(plist_get 'd["StandardErrorPath"]')" = "${HOME}/Library/Logs/claude-skills/launchd.err.log" ]
  [ -d "${HOME}/Library/Logs/claude-skills" ]
}

@test "skills_schedule bootstraps into gui/<uid> and does not bootout when not loaded" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  grep -q "^launchctl bootstrap gui/$(id -u) ${PLIST}$" "${MOCK_CALL_LOG}"
  ! grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
}

@test "the step takes launchctl from LAUNCHCTL, never from PATH" {
  printf '#!/bin/sh\necho REAL >> "%s/real-launchctl-called"\n' "${TMP}" > "${TMP}/bin/launchctl"
  chmod +x "${TMP}/bin/launchctl"
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${TMP}/real-launchctl-called" ]
  grep -q "^launchctl bootstrap " "${MOCK_CALL_LOG}"
}

# --- reload: skip when unchanged, wait for bootout, retry bootstrap ----------

@test "re-run with an identical plist and a loaded agent does not reload it" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  cp "${PLIST}" "${TMP}/first.plist"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  cmp "${TMP}/first.plist" "${PLIST}"
  ! grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
  ! grep -q "^launchctl bootstrap" "${MOCK_CALL_LOG}"
  out_has "no change"
}

@test "re-run with an identical plist but an unloaded agent bootstraps it" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  : > "${MOCK_CALL_LOG}"
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  ! grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
  [ "$(grep -c '^launchctl bootstrap' "${MOCK_CALL_LOG}")" -eq 1 ]
}

@test "a changed plist and a loaded agent: bootout first, then bootstrap, plist rewritten" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  cp "${PLIST}" "${TMP}/first.plist"
  printf '<!-- stale -->\n' >> "${PLIST}"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  cmp "${TMP}/first.plist" "${PLIST}"
  grep -q "^launchctl bootout gui/$(id -u)/${LABEL}$" "${MOCK_CALL_LOG}"
  [ "$(grep -n '^launchctl bootout' "${MOCK_CALL_LOG}" | cut -d: -f1)" -lt "$(grep -n '^launchctl bootstrap' "${MOCK_CALL_LOG}" | cut -d: -f1)" ]
  [ "$(grep -c '^launchctl bootstrap' "${MOCK_CALL_LOG}")" -eq 1 ]
}

@test "after bootout the step polls launchctl print until the agent is gone, then bootstraps" {
  run_step "${TMP}/on.toml"
  printf '<!-- stale -->\n' >> "${PLIST}"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 MOCK_LAUNCHCTL_LINGER=3 run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  # 3 prints that still see it, 1 that does not, all between bootout and bootstrap
  [ "$(sed -n '/^launchctl bootout/,/^launchctl bootstrap/p' "${MOCK_CALL_LOG}" | grep -c '^launchctl print')" -eq 4 ]
  [ "$(grep -c '^launchctl bootstrap' "${MOCK_CALL_LOG}")" -eq 1 ]
  out_lacks "failed"
}

@test "the bootout poll is bounded and warns, then bootstraps anyway" {
  run_step "${TMP}/on.toml"
  printf '<!-- stale -->\n' >> "${PLIST}"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 MOCK_LAUNCHCTL_LINGER=99 run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ "$(sed -n '/^launchctl bootout/,/^launchctl bootstrap/p' "${MOCK_CALL_LOG}" | grep -c '^launchctl print')" -le 10 ]
  grep -q "^launchctl bootstrap" "${MOCK_CALL_LOG}"
  out_has "still loaded"
}

@test "bootstrap is retried once after a failure and then succeeds quietly" {
  MOCK_LAUNCHCTL_BOOTSTRAP_FAILS=1 run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ "$(grep -c '^launchctl bootstrap' "${MOCK_CALL_LOG}")" -eq 2 ]
  out_has "weekly skills update loaded"
  out_lacks "after one retry"
}

@test "a bootstrap that keeps failing warns after one retry" {
  MOCK_LAUNCHCTL_BOOTSTRAP_FAILS=99 run_step "${TMP}/on.toml"
  [ "$(grep -c '^launchctl bootstrap' "${MOCK_CALL_LOG}")" -eq 2 ]
  out_has "launchctl bootstrap ${LABEL} failed"
  out_lacks "weekly skills update loaded"
}

# --- disabling removes an installed agent ----------------------------------

@test "flag false removes an installed plist and boots out the loaded agent" {
  run_step "${TMP}/on.toml"
  [ -f "${PLIST}" ]
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/off.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  grep -q "^launchctl bootout gui/$(id -u)/${LABEL}$" "${MOCK_CALL_LOG}"
  ! grep -q "^launchctl bootstrap" "${MOCK_CALL_LOG}"
}

@test "flag false removes an installed plist even when the agent is not loaded" {
  run_step "${TMP}/on.toml"
  : > "${MOCK_CALL_LOG}"
  run_step "${TMP}/off.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  ! grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
}

@test "a missing [schedule] section also removes an installed plist" {
  run_step "${TMP}/on.toml"
  printf '[meta]\nschema_version = 1\n' > "${TMP}/none.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/none.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
}

@test "flag false with --dry-run keeps the plist and never calls launchctl" {
  run_step "${TMP}/on.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/off.toml" --dry-run
  [ "$status" -eq 0 ]
  [ -f "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "would"
}

@test "a non-bool skills_weekly_update warns and leaves an installed agent alone" {
  run_step "${TMP}/on.toml"
  printf '[meta]\nschema_version = 1\n[schedule]\nskills_weekly_update = "true"\n' > "${TMP}/str.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/str.toml"
  [ -f "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "skills_weekly_update must be true or false"
}

@test "a misspelled key under [schedule] warns and leaves an installed agent alone" {
  run_step "${TMP}/on.toml"
  printf '[meta]\nschema_version = 1\n[schedule]\nskills_weekly_updates = true\n' > "${TMP}/typo.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/typo.toml"
  [ -f "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "unknown key"
  out_has "skills_weekly_updates"
  out_lacks "removed"
}

@test "an unknown key next to an explicit false still uninstalls, with a warning" {
  run_step "${TMP}/on.toml"
  printf '[meta]\nschema_version = 1\n[schedule]\nskills_weekly_update = false\nextra = 1\n' > "${TMP}/extra.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/extra.toml"
  [ ! -e "${PLIST}" ]
  grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
  out_has "unknown key"
}

@test "a non-table [schedule] fails closed: warns, leaves an installed agent alone, installs nothing" {
  run_step "${TMP}/on.toml"
  printf 'schedule = 5\n[meta]\nschema_version = 1\n' > "${TMP}/int.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/int.toml"
  [ -f "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "skills_weekly_update must be true or false"
  out_lacks "Traceback"
  out_lacks "would write"
}

@test "a non-table [schedule] does not install a fresh agent" {
  printf 'schedule = [1]\n[meta]\nschema_version = 1\n' > "${TMP}/list.toml"
  run_step "${TMP}/list.toml"
  [ ! -e "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
}

@test "a python failure while reading the flag fails closed: nothing installed or removed" {
  local real_py; real_py="$(command -v python3)"
  # Pass parse_toml.py through; fail every `python3 -c` (the flag parse).
  printf '#!/bin/sh\n[ "$1" = "-c" ] && exit 1\nexec "%s" "$@"\n' "${real_py}" > "${TMP}/bin/python3"
  chmod +x "${TMP}/bin/python3"
  run_step "${TMP}/on.toml"
  [ ! -e "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "cannot parse [schedule]"
}

@test "flag false boots out a loaded agent even when its plist was deleted by hand" {
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 run_step "${TMP}/off.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  grep -q "^launchctl bootout gui/$(id -u)/${LABEL}$" "${MOCK_CALL_LOG}"
}

@test "a failed bootout keeps the plist so the next run retries, and does not claim removal" {
  run_step "${TMP}/on.toml"
  : > "${MOCK_CALL_LOG}"
  MOCK_LAUNCHCTL_LOADED=1 MOCK_LAUNCHCTL_BOOTOUT_FAILS=1 run_step "${TMP}/off.toml"
  [ -f "${PLIST}" ]
  grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
  out_has "bootout ${LABEL} failed"
  out_lacks "removed"
}

@test "a plist that cannot be removed is a warning, not a claim of removal" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores file modes"
  run_step "${TMP}/on.toml"
  chmod 555 "${HOME}/Library/LaunchAgents"
  run_step "${TMP}/off.toml"
  chmod 755 "${HOME}/Library/LaunchAgents"
  [ -f "${PLIST}" ]
  out_has "could not remove"
  out_lacks "removed ${PLIST}"
}

# --- other step behaviour ---------------------------------------------------

@test "skills_schedule --dry-run writes nothing and never calls launchctl" {
  run_step "${TMP}/on.toml" --dry-run
  [ "$status" -eq 0 ]
  [ ! -e "${HOME}/Library" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "would"
}

@test "skills_schedule skips on non-macOS" {
  printf '#!/bin/sh\necho Linux\n' > "${TMP}/bin/uname"
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${HOME}/Library" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "macOS"
}

@test "skills_schedule does nothing when the toml flag is false and nothing is installed" {
  run_step "${TMP}/off.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  # It may ask launchd whether a plist-less agent is loaded, but changes nothing.
  ! grep -q "^launchctl bootout" "${MOCK_CALL_LOG}"
  ! grep -q "^launchctl bootstrap" "${MOCK_CALL_LOG}"
}

@test "skills_schedule does nothing when the toml has no [schedule] section" {
  printf '[meta]\nschema_version = 1\n' > "${TMP}/none.toml"
  run_step "${TMP}/none.toml"
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
}

@test "--skip-skills_schedule skips the step: no plist, no launchctl call" {
  run_step "${TMP}/on.toml" --skip-skills_schedule
  [ "$status" -eq 0 ]
  [ ! -e "${PLIST}" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
  out_has "skipping skills_schedule"
}

@test "npx missing from PATH warns visibly and keeps the homebrew fallback path" {
  make_nonpx_bin "${TMP}/nonpx"
  local bash_bin; bash_bin="$(command -v bash)"
  CLAUDE_SETUP_TOML="${TMP}/on.toml" PATH="${TMP}/nonpx" \
    run "${bash_bin}" "${SETUP}" --only skills_schedule
  [ "$status" -eq 0 ]
  out_has "npx not found"
  [ "$(plist_get 'd["EnvironmentVariables"]["SKILLS_NPX"]')" = "/opt/homebrew/bin/npx" ]
  # The mock must really have run (bash and env are on this PATH), not failed to exec.
  grep -q "^launchctl bootstrap gui/$(id -u) ${PLIST}$" "${MOCK_CALL_LOG}"
  out_lacks "failed"
}

@test "the installed plist is mode 644 and no temp file is left in LaunchAgents" {
  run_step "${TMP}/on.toml"
  [ "$status" -eq 0 ]
  [ "$(ls -A "${HOME}/Library/LaunchAgents")" = "${LABEL}.plist" ]
  [ "$(python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "${PLIST}")" = "0o644" ]
}

@test "a render failure leaves no temp file in LaunchAgents or TMPDIR and loads nothing" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores file modes"
  mkdir -p "${TMP}/repo" "${TMP}/tmpdir"
  cp -R "${CLAUDE_SKILLS_HOME}/setup" "${TMP}/repo/setup"
  chmod 000 "${TMP}/repo/setup/launchd/${LABEL}.plist.template"
  TMPDIR="${TMP}/tmpdir" CLAUDE_SETUP_TOML="${TMP}/on.toml" PATH="${TMP}/bin:${PATH}" \
    run bash "${TMP}/repo/setup/setup.sh" --only skills_schedule
  out_has "could not render"
  [ -z "$(ls -A "${HOME}/Library/LaunchAgents")" ]
  [ -z "$(ls -A "${TMP}/tmpdir")" ]
  ! grep -q "^launchctl" "${MOCK_CALL_LOG}"
}

@test "every setup step is documented: README and architecture pages" {
  steps="$(sed -n 's/^ALL_STEPS=(\(.*\))$/\1/p' "${SETUP}")"
  # shellcheck disable=SC2086
  set -- ${steps}
  [ "$#" -eq 11 ]  # ten steps plus summary
  grep -qF 'Steps: `preflight claude marketplaces plugins skills skills_schedule dotfiles guidelines local_plugins symlinks`.' "${CLAUDE_SKILLS_HOME}/README.md"
  grep -q "ten idempotent steps" "${CLAUDE_SKILLS_HOME}/docs/architecture.md"
  grep -q "skills → skills_schedule → dotfiles → guidelines → local_plugins" "${CLAUDE_SKILLS_HOME}/docs/architecture.md"
  grep -q "ten idempotent steps" "${CLAUDE_SKILLS_HOME}/docs/architecture.html"
  grep -q ">skills_schedule<" "${CLAUDE_SKILLS_HOME}/docs/architecture.html"
  grep -q ">guidelines<" "${CLAUDE_SKILLS_HOME}/docs/architecture.html"
}

# --- the job body: setup/skills-update.sh ---------------------------------

# Fake npx that records argv, rewrites the lock file, and exits with $FAKE_NPX_RC.
make_fake_npx() {
  cat > "${TMP}/fake-npx" <<EOF
#!/usr/bin/env bash
echo "npx \$*" >> "${MOCK_CALL_LOG}"
echo "fake npx output line"
python3 - "${HOME}/.agents/.skill-lock.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["skills"]["alpha"]["updatedAt"] = "2026-11-22T10:00:00.000Z"
d["skills"]["gamma"] = {"updatedAt": "2026-11-22T10:00:00.000Z"}
del d["skills"]["beta"]
json.dump(d, open(p, "w"))
PY
exit "\${FAKE_NPX_RC:-0}"
EOF
  chmod +x "${TMP}/fake-npx"
  mkdir -p "${HOME}/.agents"
  cat > "${HOME}/.agents/.skill-lock.json" <<'JSON'
{"version": 3, "skills": {"alpha": {"updatedAt": "2026-11-15T10:00:00.000Z"}, "beta": {"updatedAt": "2026-11-15T10:00:00.000Z"}, "delta": {"updatedAt": "2026-11-15T10:00:00.000Z"}}}
JSON
}

@test "skills-update.sh runs npx skills update -g -y by absolute path and logs a timestamped lock diff" {
  make_fake_npx
  SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 0 ]
  grep -q "^npx -y skills update -g -y$" "${MOCK_CALL_LOG}"
  LOG="${HOME}/Library/Logs/claude-skills/skills-update.log"
  [ -f "${LOG}" ]
  grep -Eq '^\[20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+[+-][0-9]{4}\] ' "${LOG}"
  grep -q "fake npx output line" "${LOG}"
  grep -q "updated alpha: 2026-11-15T10:00:00.000Z -> 2026-11-22T10:00:00.000Z" "${LOG}"
  grep -q "added gamma" "${LOG}"
  grep -q "removed beta" "${LOG}"
  ! grep -q "delta" "${LOG}"
}

@test "skills-update.sh logs no-changes when the lock file is unchanged" {
  mkdir -p "${HOME}/.agents"
  echo '{"version": 3, "skills": {"alpha": {"updatedAt": "x"}}}' > "${HOME}/.agents/.skill-lock.json"
  printf '#!/bin/sh\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 0 ]
  grep -q "no skill changes" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

@test "skills-update.sh propagates npx failure as its own exit code and logs it" {
  make_fake_npx
  FAKE_NPX_RC=3 SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 3 ]
  grep -q "FAILED (exit 3)" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

@test "skills-update.sh survives a missing lock file" {
  printf '#!/bin/sh\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 0 ]
  [ -f "${HOME}/Library/Logs/claude-skills/skills-update.log" ]
}

@test "skills-update.sh fails loudly when npx is not executable and not on PATH" {
  make_nonpx_bin "${TMP}/nonpx"
  local bash_bin; bash_bin="$(command -v bash)"
  SKILLS_NPX="${TMP}/does-not-exist" SKILLS_EXTRA_PATH="" PATH="${TMP}/nonpx" \
    run "${bash_bin}" "${JOB}"
  [ "$status" -eq 126 ]
  grep -q "not executable" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

@test "skills-update.sh falls back to npx on PATH when SKILLS_NPX is not executable" {
  make_nonpx_bin "${TMP}/nonpx"
  printf '#!/bin/sh\necho "npx $*" >> "%s"\necho via-path-npx\n' "${MOCK_CALL_LOG}" > "${TMP}/nonpx/npx"
  chmod +x "${TMP}/nonpx/npx"
  local bash_bin; bash_bin="$(command -v bash)"
  SKILLS_NPX="${TMP}/stale-nvm-path/npx" SKILLS_EXTRA_PATH="" PATH="${TMP}/nonpx" \
    run "${bash_bin}" "${JOB}"
  [ "$status" -eq 0 ]
  grep -q "^npx -y skills update -g -y$" "${MOCK_CALL_LOG}"
  LOG="${HOME}/Library/Logs/claude-skills/skills-update.log"
  grep -q "falling back" "${LOG}"
  grep -q "via-path-npx" "${LOG}"
}

@test "skills-update.sh kills a hung npx after the timeout, logs it, and exits 124" {
  printf '#!/bin/sh\nexec sleep 30\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX_TIMEOUT=1 SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 124 ]
  grep -q "killed" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

@test "skills-update.sh writes nothing to stderr on a successful run" {
  printf '#!/bin/sh\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX="${TMP}/fake-npx" bash "${JOB}" 2> "${TMP}/job.err"
  [ ! -s "${TMP}/job.err" ]
}

@test "skills-update.sh writes nothing to stderr after a timeout kill either" {
  printf '#!/bin/sh\nexec sleep 30\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  run env SKILLS_NPX_TIMEOUT=1 SKILLS_NPX="${TMP}/fake-npx" bash -c 'bash "$0" 2> "$1"' "${JOB}" "${TMP}/job.err"
  [ "$status" -eq 124 ]
  [ ! -s "${TMP}/job.err" ]
}

# Poll until pid $1 is gone (a killed process may linger as a zombie for a moment).
wait_gone() {
  local i
  for i in $(seq 1 50); do
    kill -0 "$1" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

# Fake npx whose real work happens in a grandchild: npx -> sh -> sleep.
make_grandchild_npx() {
  cat > "${TMP}/fake-npx" <<EOF
#!/bin/sh
sh -c 'sleep 60 & echo \$! > "${TMP}/grandchild.pid"; wait' &
wait
EOF
  chmod +x "${TMP}/fake-npx"
}

@test "a timeout kills npx's whole process group, grandchildren included" {
  make_grandchild_npx
  SKILLS_NPX_TIMEOUT=2 SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 124 ]
  [ -s "${TMP}/grandchild.pid" ]
  wait_gone "$(cat "${TMP}/grandchild.pid")"
}

@test "a grandchild that ignores TERM is KILLed after the grace period" {
  cat > "${TMP}/fake-npx" <<EOF
#!/bin/sh
sh -c 'trap "" TERM; sleep 60 & echo \$! > "${TMP}/grandchild.pid"; wait' &
wait
EOF
  chmod +x "${TMP}/fake-npx"
  SKILLS_NPX_TIMEOUT=2 SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 124 ]
  wait_gone "$(cat "${TMP}/grandchild.pid")"
}

@test "TERMing the job (launchd bootout) also takes npx's process group down" {
  make_grandchild_npx
  SKILLS_NPX="${TMP}/fake-npx" bash "${JOB}" &
  local job_pid=$!
  local i
  for i in $(seq 1 50); do [ -s "${TMP}/grandchild.pid" ] && break; sleep 0.1; done
  [ -s "${TMP}/grandchild.pid" ]
  kill -TERM "${job_pid}"
  wait "${job_pid}" || true
  wait_gone "$(cat "${TMP}/grandchild.pid")"
}

@test "skills-update.sh falls back to the default timeout when SKILLS_NPX_TIMEOUT is not a positive integer" {
  printf '#!/bin/sh\nsleep 1\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  local bad
  for bad in abc 0 -5 1.5; do
    SKILLS_NPX_TIMEOUT="${bad}" SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
    [ "$status" -eq 0 ]
  done
  grep -q "SKILLS_NPX_TIMEOUT 'abc' is not a positive integer; using 900" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

@test "skills-update.sh trims an oversized log to the last 2000 lines" {
  mkdir -p "${HOME}/Library/Logs/claude-skills"
  python3 -c '
import sys
with open(sys.argv[1], "w") as f:
    for i in range(1, 3001):
        f.write("OLD-LINE-%d %s\n" % (i, "x" * 400))
' "${HOME}/Library/Logs/claude-skills/skills-update.log"
  [ "$(wc -c < "${HOME}/Library/Logs/claude-skills/skills-update.log")" -gt 1048576 ]
  printf '#!/bin/sh\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 0 ]
  LOG="${HOME}/Library/Logs/claude-skills/skills-update.log"
  [ "$(wc -l < "${LOG}")" -le 2020 ]
  ! grep -q "OLD-LINE-1 " "${LOG}"
  grep -q "OLD-LINE-3000 " "${LOG}"
  grep -q "done" "${LOG}"
}

@test "skills-update.sh leaves a small log untouched" {
  mkdir -p "${HOME}/Library/Logs/claude-skills"
  echo "OLD-LINE-A" > "${HOME}/Library/Logs/claude-skills/skills-update.log"
  printf '#!/bin/sh\necho ok\n' > "${TMP}/fake-npx"; chmod +x "${TMP}/fake-npx"
  SKILLS_NPX="${TMP}/fake-npx" run bash "${JOB}"
  [ "$status" -eq 0 ]
  grep -q "OLD-LINE-A" "${HOME}/Library/Logs/claude-skills/skills-update.log"
}

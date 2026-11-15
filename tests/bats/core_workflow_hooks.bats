#!/usr/bin/env bats

# core-workflow hooks: skill-hint.sh (PostToolUse / PostToolUseFailure, Bash)
# and shellcheck-on-edit.sh (PostToolUse, Edit/Write on *.sh).

REPO="${BATS_TEST_DIRNAME}/../.."
HOOKS="${REPO}/plugins/core-workflow/hooks"

setup() {
  WORK="$(mktemp -d "${BATS_TMPDIR}/cwhooks.XXXXXX")"
}

# bash_payload <event> <command> <stdout-text>  -> PostToolUse-shaped JSON
bash_payload() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
event, command, out = sys.argv[1:4]
p = {"hook_event_name": event, "tool_name": "Bash",
     "tool_input": {"command": command}}
if event == "PostToolUseFailure":
    p["error"] = out
else:
    p["tool_response"] = {"stdout": out, "stderr": "", "interrupted": False}
print(json.dumps(p))
PY
}

# ---------- skill-hint.sh ----------

@test "skill-hint names the blast-radius skill when a hold text appears" {
  payload="$(bash_payload PostToolUse 'rm -rf "$O"' 'Blast Radius held this command and did not run it: no answer within 10 minutes.')"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  printf '%s' "$output" | python3 -c '
import json, sys
d = json.load(sys.stdin)["hookSpecificOutput"]
assert d["hookEventName"] == "PostToolUse", d
assert "core-workflow:blast-radius-rm-hold-unattended-subagent-stall" in d["additionalContext"], d
'
}

@test "skill-hint names the worktree-guard skill on a guard refusal" {
  payload="$(bash_payload PostToolUse 'git -C /x status' 'this command redirects git to the shared checkout via -C. Refusing to run it.')"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"core-workflow:worktree-isolation-guard-refuses-complex-bash"* ]]
}

@test "skill-hint names the xcode-license skill on the licence text" {
  payload="$(bash_payload PostToolUseFailure 'git status' 'Exit code 69
You have not agreed to the Xcode license agreements.')"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"core-workflow:xcode-license-blocks-git-exit-69"* ]]
  [[ "$output" == *'"hookEventName": "PostToolUseFailure"'* || "$output" == *'"hookEventName":"PostToolUseFailure"'* ]]
}

@test "skill-hint is silent on benign output" {
  payload="$(bash_payload PostToolUse 'ls' 'README.md
setup')"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "skill-hint is silent when the command itself only quotes the string" {
  payload="$(bash_payload PostToolUse 'grep -rn "Blast Radius held this command" plugins/' 'plugins/x/SKILL.md:10: Blast Radius held this command and did not run it')"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "skill-hint is silent on empty or malformed stdin" {
  run bash -c 'printf "" | bash "$1"' _ "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run bash -c 'printf "not json" | bash "$1"' _ "${HOOKS}/skill-hint.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------- hooks.json wiring ----------

@test "hooks.json registers skill-hint on Bash for success and failure events" {
  python3 - "${HOOKS}/hooks.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))["hooks"]
for ev in ("PostToolUse", "PostToolUseFailure"):
    groups = [g for g in h[ev] if g.get("matcher") == "Bash"]
    assert groups, ev
    cmds = [x["command"] for g in groups for x in g["hooks"]]
    assert any("skill-hint.sh" in c for c in cmds), (ev, cmds)
PY
}

@test "hooks.json gives shellcheck-on-edit one if rule per entry (Edit and Write)" {
  python3 - "${HOOKS}/hooks.json" <<'PY'
import json, sys
h = json.load(open(sys.argv[1]))["hooks"]["PostToolUse"]
entries = [x for g in h for x in g["hooks"] if "shellcheck-on-edit.sh" in x["command"]]
conds = sorted(x.get("if", "") for x in entries)
assert conds == ["Edit(*.sh)", "Write(*.sh)"], conds
PY
}

# ---------- shellcheck-on-edit.sh ----------

edit_payload() {  # $1 tool, $2 file
  python3 -c '
import json, sys
print(json.dumps({"hook_event_name": "PostToolUse", "tool_name": sys.argv[1],
                  "tool_input": {"file_path": sys.argv[2]}, "tool_response": {}}))
' "$1" "$2"
}

@test "shellcheck hook puts SC findings in additionalContext JSON for a bad .sh" {
  command -v shellcheck >/dev/null || skip "shellcheck not installed"
  printf '#!/usr/bin/env bash\necho $1\n' > "${WORK}/bad.sh"
  payload="$(edit_payload Write "${WORK}/bad.sh")"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/shellcheck-on-edit.sh"
  [ "$status" -eq 0 ]
  printf '%s' "$output" | python3 -c '
import json, sys
d = json.load(sys.stdin)["hookSpecificOutput"]
assert d["hookEventName"] == "PostToolUse", d
assert "SC2086" in d["additionalContext"], d
'
}

@test "shellcheck hook is silent for a clean .sh" {
  command -v shellcheck >/dev/null || skip "shellcheck not installed"
  printf '#!/usr/bin/env bash\necho "$1"\n' > "${WORK}/ok.sh"
  payload="$(edit_payload Edit "${WORK}/ok.sh")"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/shellcheck-on-edit.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "shellcheck hook is silent for a non-.sh file" {
  printf '# notes\n' > "${WORK}/notes.md"
  payload="$(edit_payload Edit "${WORK}/notes.md")"
  run bash -c 'printf "%s" "$1" | bash "$2"' _ "$payload" "${HOOKS}/shellcheck-on-edit.sh"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

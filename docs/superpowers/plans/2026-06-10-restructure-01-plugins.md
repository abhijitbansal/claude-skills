# Plugin Restructure + Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert this repo into a Claude Code marketplace hosting three plugins (`ios-dev`, `linear-pm`, `core-workflow`) while keeping the personal seed machinery working.

**Architecture:** Top-level `skills/`, `commands/`, `agents/`, `hooks/` move under `plugins/<name>/`. A root `.claude-plugin/marketplace.json` lists the plugins. `setup.sh` gains a `local_plugins` step (marketplace-add this repo + install every plugin listed in marketplace.json) and its `symlinks` step shrinks to stale-link cleanup + the contribute shim. `contribute.sh` scaffolds skills into plugins.

**Tech Stack:** bash, bats, python3 (JSON parsing), Claude Code plugin layout.

**Spec:** `docs/superpowers/specs/2026-06-10-plugin-marketplace-restructure-design.md`

**Deviation from spec:** `commands/fix.md` goes to `ios-dev` (not `core-workflow`) — its content drives the app-preview scripts, so it belongs with them.

---

### Task 1: Marketplace + plugin manifests

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/ios-dev/.claude-plugin/plugin.json`
- Create: `plugins/linear-pm/.claude-plugin/plugin.json`
- Create: `plugins/core-workflow/.claude-plugin/plugin.json`
- Test: `tests/bats/marketplace.bats`

- [ ] **Step 1: Write the failing test**

`tests/bats/marketplace.bats`:

```bash
#!/usr/bin/env bats

load helpers

REPO_ROOT="${BATS_TEST_DIRNAME}/../.."

@test "marketplace.json is valid JSON with required fields" {
  run python3 -c "
import json, sys
d = json.load(open('${REPO_ROOT}/.claude-plugin/marketplace.json'))
assert d['name'] == 'claude-skills', 'marketplace name'
assert d['owner']['name'], 'owner name'
assert len(d['plugins']) >= 3, 'expected >= 3 plugins'
for p in d['plugins']:
    assert p['name'] and p['source'] and p['description'], p
"
  [ "$status" -eq 0 ]
}

@test "every marketplace plugin source dir has a plugin.json naming it" {
  run python3 -c "
import json, os
root = '${REPO_ROOT}'
d = json.load(open(os.path.join(root, '.claude-plugin/marketplace.json')))
for p in d['plugins']:
    pj_path = os.path.join(root, p['source'], '.claude-plugin', 'plugin.json')
    pj = json.load(open(pj_path))
    assert pj['name'] == p['name'], f\"{pj_path}: {pj['name']} != {p['name']}\"
    assert pj['description'], pj_path
"
  [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/bats/marketplace.bats`
Expected: both tests FAIL (no such file `.claude-plugin/marketplace.json`).

- [ ] **Step 3: Create the manifests**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "claude-skills",
  "owner": {
    "name": "Abhijit Bansal",
    "url": "https://github.com/abhijitbansal"
  },
  "metadata": {
    "description": "Abhijit's AI-agent skills: iOS dev loop, Linear PM, core workflow helpers",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "ios-dev",
      "source": "./plugins/ios-dev",
      "description": "iOS development loop: simulator build + preview + screenshot delivery, device builds, TestFlight/App Store release automation"
    },
    {
      "name": "linear-pm",
      "source": "./plugins/linear-pm",
      "description": "Linear project management conventions and slash commands: issue templates, agent-ready workflow, autonomous issue pickup"
    },
    {
      "name": "core-workflow",
      "source": "./plugins/core-workflow",
      "description": "General dev workflow helpers: commit flow, skill contribution, team orchestration, image-parser and web-researcher agents, shellcheck-on-edit hook"
    }
  ]
}
```

`plugins/ios-dev/.claude-plugin/plugin.json`:

```json
{
  "name": "ios-dev",
  "description": "iOS development loop: simulator build + preview + screenshot delivery, device builds, TestFlight/App Store release automation. Requires .claude/app.yml in the target app repo.",
  "version": "1.0.0",
  "author": { "name": "Abhijit Bansal", "url": "https://github.com/abhijitbansal" }
}
```

`plugins/linear-pm/.claude-plugin/plugin.json`:

```json
{
  "name": "linear-pm",
  "description": "Linear project management conventions and slash commands: issue templates, status taxonomy, agent-ready workflow, autonomous issue pickup via /linear-pick.",
  "version": "1.0.0",
  "author": { "name": "Abhijit Bansal", "url": "https://github.com/abhijitbansal" }
}
```

`plugins/core-workflow/.claude-plugin/plugin.json`:

```json
{
  "name": "core-workflow",
  "description": "General dev workflow helpers: commit flow, skill contribution, team orchestration, image-parser and web-researcher agents, shellcheck-on-edit hook.",
  "version": "1.0.0",
  "author": { "name": "Abhijit Bansal", "url": "https://github.com/abhijitbansal" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bats tests/bats/marketplace.bats`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin plugins tests/bats/marketplace.bats
git commit -m "feat: add marketplace.json and plugin manifests for ios-dev, linear-pm, core-workflow"
```

---

### Task 2: Move iOS cluster into plugins/ios-dev

**Files:**
- Move: `skills/_lib` → `plugins/ios-dev/skills/_lib`
- Move: `skills/app-preview` → `plugins/ios-dev/skills/app-preview`
- Move: `skills/ios-build` → `plugins/ios-dev/skills/ios-build`
- Move: `skills/release` → `plugins/ios-dev/skills/release`
- Move: `commands/preview.md` → `plugins/ios-dev/commands/preview.md`
- Move: `commands/fix.md` → `plugins/ios-dev/commands/fix.md`
- Move: `hooks/app-build-reminder.sh` → `plugins/ios-dev/hooks/app-build-reminder.sh`
- Create: `plugins/ios-dev/hooks/hooks.json`
- Modify: `tests/bats/app_preview.bats:13,20`, `tests/bats/ios_build.bats:13`, `tests/bats/release.bats:13`, `tests/bats/load_app_config.bats:27,39,45`
- Modify: `.github/workflows/test.yml` (shellcheck path)

The skill scripts source `_lib` via `"${SCRIPT_DIR}/../../_lib/load_app_config.sh"` — that relative shape is preserved by moving the whole `skills/` subtree together, so **no script edits needed**.

- [ ] **Step 1: Move the files**

```bash
mkdir -p plugins/ios-dev/skills plugins/ios-dev/commands plugins/ios-dev/hooks
git mv skills/_lib plugins/ios-dev/skills/_lib
git mv skills/app-preview plugins/ios-dev/skills/app-preview
git mv skills/ios-build plugins/ios-dev/skills/ios-build
git mv skills/release plugins/ios-dev/skills/release
git mv commands/preview.md plugins/ios-dev/commands/preview.md
git mv commands/fix.md plugins/ios-dev/commands/fix.md
git mv hooks/app-build-reminder.sh plugins/ios-dev/hooks/app-build-reminder.sh
```

- [ ] **Step 2: Create hooks.json**

`plugins/ios-dev/hooks/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/app-build-reminder.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Update test paths**

In `tests/bats/app_preview.bats`, `tests/bats/ios_build.bats`, `tests/bats/release.bats`: replace `../../skills/` with `../../plugins/ios-dev/skills/` on the `run bash` lines.

In `tests/bats/load_app_config.bats`: replace `${REPO_ROOT}/skills/_lib/load_app_config.sh` with `${REPO_ROOT}/plugins/ios-dev/skills/_lib/load_app_config.sh` (3 occurrences).

In `.github/workflows/test.yml`, change the shellcheck step:

```yaml
      - name: shellcheck
        run: shellcheck setup/*.sh plugins/ios-dev/skills/_lib/*.sh
```

- [ ] **Step 4: Run the moved-cluster tests**

Run: `bats tests/bats/app_preview.bats tests/bats/ios_build.bats tests/bats/release.bats tests/bats/load_app_config.bats`
Expected: PASS (same counts as before the move).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move iOS skills, commands, and hook into plugins/ios-dev"
```

---

### Task 3: Move linear-pm cluster into plugins/linear-pm

**Files:**
- Move: `skills/linear-pm` → `plugins/linear-pm/skills/linear-pm`
- Move: `commands/linear-init.md`, `linear-new.md`, `linear-pick.md`, `linear-status.md`, `linear-sync.md`, `linear-block.md` → `plugins/linear-pm/commands/`

- [ ] **Step 1: Move the files**

```bash
mkdir -p plugins/linear-pm/skills plugins/linear-pm/commands
git mv skills/linear-pm plugins/linear-pm/skills/linear-pm
git mv commands/linear-init.md commands/linear-new.md commands/linear-pick.md \
       commands/linear-status.md commands/linear-sync.md commands/linear-block.md \
       plugins/linear-pm/commands/
```

- [ ] **Step 2: Verify nothing references the old path**

Run: `grep -rn "skills/linear-pm" --include="*.sh" --include="*.bats" --include="*.yml" . | grep -v plugins/ | grep -v .git/`
Expected: no output. (`.claude/skills/linear-pm/...` references inside the command/skill markdown describe consumer-repo paths, not this repo — leave them.)

- [ ] **Step 3: Run full bats to catch breakage**

Run: `bats tests/bats/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move linear-pm skill and commands into plugins/linear-pm"
```

---

### Task 4: Move core-workflow cluster into plugins/core-workflow

**Files:**
- Move: `skills/commit` → `plugins/core-workflow/skills/commit`
- Move: `skills/contribute` → `plugins/core-workflow/skills/contribute`
- Move: `commands/team.md`, `commands/contribute-skill.md` → `plugins/core-workflow/commands/`
- Move: `agents/image-parser.md`, `agents/web-researcher.md` → `plugins/core-workflow/agents/`
- Move: `hooks/shellcheck-on-edit.sh` → `plugins/core-workflow/hooks/shellcheck-on-edit.sh`
- Create: `plugins/core-workflow/hooks/hooks.json`

- [ ] **Step 1: Move the files**

```bash
mkdir -p plugins/core-workflow/skills plugins/core-workflow/commands \
         plugins/core-workflow/agents plugins/core-workflow/hooks
git mv skills/commit plugins/core-workflow/skills/commit
git mv skills/contribute plugins/core-workflow/skills/contribute
git mv commands/team.md commands/contribute-skill.md plugins/core-workflow/commands/
git mv agents/image-parser.md agents/web-researcher.md plugins/core-workflow/agents/
git mv hooks/shellcheck-on-edit.sh plugins/core-workflow/hooks/shellcheck-on-edit.sh
rmdir skills commands agents hooks 2>/dev/null || true
```

- [ ] **Step 2: Create hooks.json**

`plugins/core-workflow/hooks/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/shellcheck-on-edit.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Verify empty dirs are gone and tests pass**

Run: `ls skills commands agents hooks 2>&1; bats tests/bats/`
Expected: four "No such file or directory" lines, then bats PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move commit/contribute skills, team command, agents, shellcheck hook into plugins/core-workflow"
```

---

### Task 5: setup.sh — local_plugins step replaces skill symlink fan-out

**Files:**
- Modify: `setup/setup.sh` (ALL_STEPS line 16, `--skip-*` case line 30, `step_symlinks` lines 190-222, new `step_local_plugins`)
- Modify: `claude-setup.toml` (remove `[custom_skills]` section, lines 123-124)
- Test: `tests/bats/setup.bats`

- [ ] **Step 1: Write the failing tests**

Append to `tests/bats/setup.bats`:

```bash
@test "setup.sh --only local_plugins adds self marketplace and installs every marketplace plugin" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only local_plugins
  [ "$status" -eq 0 ]
  grep -q "claude plugin marketplace" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install ios-dev@claude-skills" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install linear-pm@claude-skills" "${MOCK_CALL_LOG}"
  grep -q "claude plugin install core-workflow@claude-skills" "${MOCK_CALL_LOG}"
}

@test "setup.sh symlinks step removes stale links into this repo" {
  mkdir -p "${HOME}/.claude/skills"
  ln -s "${CLAUDE_SKILLS_HOME}/skills/gone" "${HOME}/.claude/skills/gone"
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ ! -L "${HOME}/.claude/skills/gone" ]
}
```

Also update the existing test `"setup.sh --only symlinks fans out skills/agents/commands"` — rename it and change its body, since fan-out is gone:

```bash
@test "setup.sh --only symlinks installs contribute shim" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.local/bin/claude-skills-contribute" ]
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bats tests/bats/setup.bats`
Expected: new tests FAIL ("unknown step: local_plugins"; stale link still present).

- [ ] **Step 3: Implement in setup.sh**

Line 16, add the step before `symlinks`:

```bash
ALL_STEPS=(preflight claude marketplaces plugins skills dotfiles local_plugins symlinks summary)
```

Line 30, extend the skip list:

```bash
    --skip-claude|--skip-marketplaces|--skip-plugins|--skip-skills|--skip-dotfiles|--skip-local_plugins|--skip-symlinks)
```

Add `step_local_plugins` after `step_dotfiles`:

```bash
step_local_plugins() {
  local manifest="${REPO_ROOT}/.claude-plugin/marketplace.json"
  [[ -f "${manifest}" ]] || { warn "no ${manifest}; skipping"; return 0; }
  local existing
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  if printf '%s\n' "${existing}" | grep -qw "claude-skills"; then
    info "self marketplace: update"
    [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace update claude-skills || warn "marketplace update failed"
  else
    info "self marketplace: add (${REPO_ROOT})"
    [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace add "${REPO_ROOT}" || warn "marketplace add failed"
  fi
  local installed
  installed="$(claude plugin list --scope user 2>/dev/null || true)"
  python3 -c "import json,sys; [print(p['name']) for p in json.load(open(sys.argv[1]))['plugins']]" "${manifest}" \
    | while IFS= read -r name; do
      if printf '%s\n' "${installed}" | grep -qw "${name}"; then
        info "local plugin ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin update "${name}@claude-skills" || warn "update ${name} failed"
      else
        info "local plugin ${name}: install"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${name}@claude-skills" --scope user || warn "install ${name} failed"
      fi
    done
}
```

Replace `step_symlinks` body (the fan-out loop and toml read go away; keep contribute shim; add stale-link cleanup):

```bash
step_symlinks() {
  # Clean up symlinks left behind by the pre-plugin layout: anything in
  # ~/.claude/{skills,agents,commands} that points into this repo is stale
  # now that plugins own those assets.
  local dir base target
  for dir in skills agents commands; do
    local dst_root="${HOME}/.claude/${dir}"
    [[ -d "${dst_root}" ]] || continue
    for entry in "${dst_root}"/*; do
      [[ -L "${entry}" ]] || continue
      target="$(readlink "${entry}")"
      if [[ "${target}" == "${REPO_ROOT}"/* ]]; then
        base="$(basename "${entry}")"
        if [[ "${DRY_RUN}" -eq 1 ]]; then
          info "would remove stale link ${dst_root}/${base}"
        else
          rm "${entry}"
          info "removed stale link ${dst_root}/${base}"
        fi
      fi
    done
  done

  mkdir -p "${HOME}/.local/bin"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "would link ${HOME}/.local/bin/claude-skills-contribute → ${REPO_ROOT}/setup/contribute.sh"
  else
    safe_symlink "${REPO_ROOT}/setup/contribute.sh" "${HOME}/.local/bin/claude-skills-contribute"
  fi
}
```

In `claude-setup.toml`, delete the `[custom_skills]` section:

```toml
[custom_skills]
symlink_targets = ["skills", "agents", "commands"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/bats/setup.bats`
Expected: PASS, including the two new tests and the renamed symlinks test.

- [ ] **Step 5: Run full suite + shellcheck**

Run: `shellcheck setup/*.sh && bats tests/bats/`
Expected: clean shellcheck, all bats PASS.

- [ ] **Step 6: Commit**

```bash
git add setup/setup.sh claude-setup.toml tests/bats/setup.bats
git commit -m "feat(setup): install repo plugins via local marketplace, retire skill symlink fan-out"
```

---

### Task 6: contribute.sh — scaffold skills into plugins

**Files:**
- Modify: `setup/contribute.sh:12-26` (args), `:56-90` (mutate step)
- Test: `tests/bats/contribute.bats`

- [ ] **Step 1: Update the failing test**

In `tests/bats/contribute.bats`, the scaffold assertion (line 22) currently checks `${CLAUDE_SKILLS_HOME}/skills/demo/SKILL.md`. Change to:

```bash
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/core-workflow/skills/demo/SKILL.md" ]
```

Add a new test after it:

```bash
@test "contribute --skill --plugin scaffolds into the named plugin" {
  run claude-skills-contribute --skill demo2 --plugin ios-dev --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/plugins/ios-dev/skills/demo2/SKILL.md" ]
}
```

(Mirror the setup/teardown conventions already used in that file — it runs against a temp clone.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/bats/contribute.bats`
Expected: FAIL on the new path assertions.

- [ ] **Step 3: Implement in contribute.sh**

Add a `PLUGIN` variable and flag (after line 12-15 block):

```bash
SKILL=""
PLUGIN="core-workflow"
MESSAGE=""
NO_PR=0
AUTO_MERGE=0
```

In the arg loop add:

```bash
    --plugin)       PLUGIN="$2"; shift ;;
```

In the mutate step (line 56-57), change:

```bash
if [[ -n "${SKILL}" ]]; then
  [[ -d "${REPO}/plugins/${PLUGIN}" ]] || { fail "no plugin ${PLUGIN} in ${REPO}/plugins"; exit 1; }
  dest="${REPO}/plugins/${PLUGIN}/skills/${SKILL}"
```

And the scaffold info line:

```bash
  info "scaffolded plugins/${PLUGIN}/skills/${SKILL}/"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bats tests/bats/contribute.bats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add setup/contribute.sh tests/bats/contribute.bats
git commit -m "feat(contribute): scaffold new skills into plugins, add --plugin flag"
```

---

### Task 7: Command text — plugin-root paths

The command markdown files reference `.claude/skills/<name>/scripts/` which only works for project-local copies. Plugin installs expose scripts under `${CLAUDE_PLUGIN_ROOT}`.

**Files:**
- Modify: `plugins/ios-dev/commands/preview.md`, `plugins/ios-dev/commands/fix.md`
- Modify: `plugins/linear-pm/commands/linear-init.md`, `linear-new.md`, `linear-pick.md`

- [ ] **Step 1: Update script path references**

In `preview.md` and `fix.md`, replace every `.claude/skills/app-preview/scripts/` with `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/` and add one sentence near the first usage: "If `${CLAUDE_PLUGIN_ROOT}` is unset (project-local copy instead of plugin install), use `.claude/skills/app-preview/scripts/` relative to the repo root."

In `linear-init.md` replace `.claude/skills/linear-pm/templates/linear.yml.template` with `${CLAUDE_PLUGIN_ROOT}/skills/linear-pm/templates/linear.yml.template`; in `linear-new.md` and `linear-pick.md` replace `.claude/skills/linear-pm/SKILL.md` with "the `linear-pm` skill" (the skill is loaded by name; no path needed).

- [ ] **Step 2: Verify no stale repo-internal refs remain**

Run: `grep -rn '\.claude/skills/' plugins/*/commands/`
Expected: only the documented fallback sentences (one per iOS command), nothing else.

- [ ] **Step 3: Commit**

```bash
git add plugins
git commit -m "fix(commands): reference skill scripts via CLAUDE_PLUGIN_ROOT with project-local fallback"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full test suite**

Run: `shellcheck setup/*.sh plugins/ios-dev/skills/_lib/*.sh && bats tests/bats/ && uv tool run pytest tests/pytest -q`
Expected: all green.

- [ ] **Step 2: Live smoke test (this machine)**

Run: `claude plugin marketplace add "$(pwd)" && claude plugin install core-workflow@claude-skills --scope user`
Expected: both commands succeed. Then `claude plugin list --scope user | grep core-workflow` shows it.
If the live CLI rejects something (schema mismatch), fix the manifest to match the real CLI and re-run Task 1's bats.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: adjust plugin manifests after live CLI validation" || true
```

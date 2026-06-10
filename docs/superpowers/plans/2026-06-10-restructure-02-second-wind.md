# Second Wind Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the Second Wind CLI (`wind.py`) into `tools/second-wind/`, wire its tests into CI, ship a `second-wind` plugin with a SKILL.md wrapper, and install `wind` onto PATH via setup.sh.

**Architecture:** Canonical CLI lives at `tools/second-wind/wind.py` (single-file, stdlib-only Python). The plugin contains only a SKILL.md that teaches the agent the wind commands and how to self-install when `wind` is missing. setup.sh symlinks the repo copy onto PATH for seeded machines.

**Tech Stack:** Python 3.9+ (stdlib only), pytest, tmux, bash/bats.

**Source:** `github.com/abhijitbansal/second-wind`, branch `claude/abh-42-implementation-4vb9xc`. Files: `wind.py`, `tests/fake_claude.py`, `tests/test_wind.py`, `README.md`. Plain copy, no git history.

**Spec:** `docs/superpowers/specs/2026-06-10-plugin-marketplace-restructure-design.md`

---

### Task 1: Import the files

**Files:**
- Create: `tools/second-wind/wind.py`
- Create: `tools/second-wind/tests/fake_claude.py`
- Create: `tools/second-wind/tests/test_wind.py`
- Create: `tools/second-wind/README.md`

- [ ] **Step 1: Fetch the four files from the branch**

```bash
mkdir -p tools/second-wind/tests
br="claude/abh-42-implementation-4vb9xc"
for f in wind.py README.md tests/fake_claude.py tests/test_wind.py; do
  gh api "repos/abhijitbansal/second-wind/contents/${f}?ref=${br}" --jq '.content' \
    | base64 -d > "tools/second-wind/${f}"
done
chmod +x tools/second-wind/wind.py
```

- [ ] **Step 2: Sanity-check the import**

Run: `head -5 tools/second-wind/wind.py && python3 -m py_compile tools/second-wind/wind.py && echo OK`
Expected: shebang + `OK`. If `tests/test_wind.py` references `wind` by relative import or path, note how — Task 2 must run pytest from the directory that satisfies it.

- [ ] **Step 3: Run the imported test suite**

Run: `cd tools/second-wind && uv tool run pytest tests/ -q`
Expected: PASS (whatever count the suite has). If tmux is missing locally, tests that need it should skip or be noted; CI installs tmux in Task 2.

- [ ] **Step 4: Commit**

```bash
git add tools/second-wind
git commit -m "feat: import second-wind CLI (wind.py) with tests from abhijitbansal/second-wind"
```

---

### Task 2: CI wiring

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add tmux install + second-wind pytest to the workflow**

In the macOS install step, change to:

```yaml
      - name: install bats + shellcheck (macOS)
        if: runner.os == 'macOS'
        run: brew install bats-core shellcheck tmux
```

In the Ubuntu install step:

```yaml
      - name: install bats + shellcheck (Ubuntu)
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y bats shellcheck tmux
```

After the existing pytest step, add:

```yaml
      - name: pytest (second-wind)
        run: uv tool run pytest tools/second-wind/tests/ -q
        working-directory: ${{ github.workspace }}
```

If Task 1 Step 2 showed the suite must run from `tools/second-wind/`, use instead:

```yaml
      - name: pytest (second-wind)
        run: uv tool run pytest tests/ -q
        working-directory: tools/second-wind
```

- [ ] **Step 2: Verify locally with the same invocation CI uses**

Run: the exact command chosen above, from the repo root or `tools/second-wind` accordingly.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run second-wind pytest suite"
```

---

### Task 3: second-wind plugin

**Files:**
- Create: `plugins/second-wind/.claude-plugin/plugin.json`
- Create: `plugins/second-wind/skills/second-wind/SKILL.md`
- Modify: `.claude-plugin/marketplace.json` (add plugin entry)
- Test: `tests/bats/marketplace.bats` (existing tests cover the new entry automatically)

- [ ] **Step 1: Add the marketplace entry**

In `.claude-plugin/marketplace.json`, append to `plugins`:

```json
    {
      "name": "second-wind",
      "source": "./plugins/second-wind",
      "description": "Set-and-forget orchestrator for long Claude Code runs: when the 5-hour usage limit pauses sessions, wind notices, waits for the reset, and resumes every tmux session — including overnight"
    }
```

- [ ] **Step 2: Create plugin.json**

`plugins/second-wind/.claude-plugin/plugin.json`:

```json
{
  "name": "second-wind",
  "description": "Set-and-forget orchestrator for long Claude Code runs across multiple repos. Detects the 5-hour usage limit, waits for reset, resumes every tmux session. Single-file Python CLI (wind), stdlib only.",
  "version": "1.0.0",
  "author": { "name": "Abhijit Bansal", "url": "https://github.com/abhijitbansal" }
}
```

- [ ] **Step 3: Write the SKILL.md**

`plugins/second-wind/skills/second-wind/SKILL.md`:

```markdown
---
name: second-wind
description: Orchestrate long unattended Claude Code runs across multiple repos with the wind CLI. Use when the user wants to run Claude Code overnight, resume sessions after the 5-hour usage limit, run Claude in many repos at once via tmux, or says "set up second wind", "wind up", "overnight run", "resume after limit", "usage limit orchestrator".
---

# Second Wind — usage-limit-aware session orchestrator

`wind` runs Claude Code in one tmux session per repo and watches for the
account-level 5-hour usage limit. When the limit hits, it waits for the reset
time and resumes every paused session automatically.

## Prerequisites

- `tmux` and the Claude Code CLI (logged in) on PATH.
- Python 3.9+.

## If `wind` is not on PATH

Install it (single stdlib-only file):

```bash
mkdir -p ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
head -1 ~/.local/bin/wind | grep -q python || { echo "download broken — inspect ~/.local/bin/wind"; exit 1; }
chmod +x ~/.local/bin/wind
```

(On seeded machines `setup.sh` already symlinks it from the repo clone.)

## Commands

| Command | What it does |
| --- | --- |
| `wind init` | write `./second-wind.json` starter config — edit the `repos` list |
| `wind up` | start a tmux session per repo, launch Claude Code, send each repo's initial prompt file |
| `wind watch` | run the watcher loop (keep running; on macOS it self-caffeinates) |
| `wind status` | per-session state + next reset time |
| `wind resume` | manually nudge all sessions with the resume message |
| `wind down` | kill all wind sessions |

## Typical setups

Overnight run:

```bash
wind init   # then edit second-wind.json: repos[].path, prompt_file, claude_args
wind up
tmux new -d -s wind-watcher 'wind watch'
```

Attach to a live session: `tmux attach -t wind-<repo>` (detach: `Ctrl-b d`).

## Config essentials (`second-wind.json`)

- `repos[]`: `name`, `path`, optional `prompt_file` (sent as first prompt), optional per-repo `claude_args` (e.g. `--permission-mode acceptEdits`).
- `resume_message`: text typed into each paused session after reset (default `continue`).
- `ntfy_url`: optional ntfy.sh topic URL — notifies when the limit hits and when sessions resume.
- `limit_patterns`: extra regexes tried before the built-ins if Claude Code's limit message format changes.

Full reference: `tools/second-wind/README.md` in the claude-skills repo.

## Hard rules

- Never run `wind watch` in the same tmux session as a managed repo — it must survive the sessions it manages.
- `wind down` kills sessions without saving; confirm with the user before running it on their behalf.
```

- [ ] **Step 4: Run the marketplace bats**

Run: `bats tests/bats/marketplace.bats`
Expected: PASS — the "every marketplace plugin source dir has a plugin.json" test now validates the fourth plugin too.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json plugins/second-wind
git commit -m "feat: add second-wind plugin with skill wrapper for the wind CLI"
```

---

### Task 4: PATH install via setup.sh

**Files:**
- Modify: `setup/setup.sh` (`step_symlinks`)
- Test: `tests/bats/setup.bats`

- [ ] **Step 1: Write the failing test**

Append to `tests/bats/setup.bats`:

```bash
@test "setup.sh symlinks step installs wind onto PATH" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.local/bin/wind" ]
  [ "$(readlink "${HOME}/.local/bin/wind")" = "${CLAUDE_SKILLS_HOME}/tools/second-wind/wind.py" ]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bats tests/bats/setup.bats`
Expected: new test FAILS (no wind symlink).

- [ ] **Step 3: Implement**

In `setup/setup.sh` `step_symlinks`, after the contribute shim block, add:

```bash
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    info "would link ${HOME}/.local/bin/wind → ${REPO_ROOT}/tools/second-wind/wind.py"
  else
    safe_symlink "${REPO_ROOT}/tools/second-wind/wind.py" "${HOME}/.local/bin/wind"
  fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bats tests/bats/setup.bats`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `shellcheck setup/*.sh && bats tests/bats/`
Expected: green.

```bash
git add setup/setup.sh tests/bats/setup.bats
git commit -m "feat(setup): symlink wind CLI onto PATH"
```

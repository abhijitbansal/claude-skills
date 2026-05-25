# claude-skills usage guide

Single-source dev environment seed. Cloned on every machine, referenced by every app repo. This doc is the operator's manual.

## What this repo is

- **`claude-setup.toml`** — declarative manifest: marketplaces, plugins, npx-skills, dotfile mappings, custom-skill symlink targets. Hand-edit or let `capture.sh` rewrite it.
- **`setup/setup.sh`** — idempotent installer. Reads the TOML, brings any machine to the manifest's state.
- **`setup/capture.sh`** — snapshots the current machine into the TOML + `templates/`.
- **`setup/contribute.sh`** — runnable from any repo (installed as `~/.local/bin/claude-skills-contribute`); branches off this repo, captures or scaffolds, commits, pushes, opens a PR.
- **`skills/`** — custom skills. Six today: `commit`, `linear-pm`, `release`, `ios-build`, `app-preview`, `contribute`. Symlinked into `~/.claude/skills/` by `setup.sh`.
- **`agents/`, `commands/`, `hooks/`, `scripts/`** — non-skill assets. Same symlink fan-out pattern (where applicable).
- **`templates/`** — `home-CLAUDE.md`, `user-settings.json`, `app.yml.example`, `skill.md.example`. Sources for `setup.sh` dotfile copy and `contribute.sh` skill scaffolding.
- **`tests/bats/`, `tests/pytest/`** — mocked test suite. `bats tests/bats/ && python3 -m pytest tests/pytest/`.
- **`docs/superpowers/`** — design spec + implementation plan from the seed work.

## Bootstrap a fresh machine

```bash
# 1. Clone to the canonical path (the env var defaults to this)
git clone <repo-url> ~/projects/claude-skills

# 2. Run setup. Idempotent. Re-run any time to pull updates.
bash ~/projects/claude-skills/setup/setup.sh
```

That's it. The preflight step auto-installs missing dev dependencies (`bats-core`, `shellcheck` via brew; `uv` via the official Astral installer). Python dependencies (`tomlkit`) are resolved on demand by `uv run` from PEP 723 inline metadata — no `pip install` step, no `requirements.txt`, no virtualenv to remember.

```bash
# 3. Confirm symlinks landed
ls -l ~/.claude/skills/ | grep claude-skills
which claude-skills-contribute   # → ~/.local/bin/claude-skills-contribute
```

End state: marketplaces registered, user-scope plugins installed, npx-skills installed, `~/CLAUDE.md` + `~/.claude/settings.json` synced from `templates/`, custom skills symlinked into `~/.claude/skills/`, `claude-skills-contribute` shim on PATH.

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Print what would change. No mutations. |
| `--verbose` | `set -x` — every shell command logged. |
| `--only <step>` | Run just one step. Steps: `preflight claude marketplaces plugins skills dotfiles symlinks summary`. |
| `--skip-<step>` | Skip a single step. Repeatable. |

### Exit codes

- `0` — all steps succeeded.
- `1` — a `fail`-level error occurred (e.g. installer crashed, gh not authed).
- `2` — `warn`-level issues only (e.g. one plugin update failed, the rest succeeded).

## Onboard a new app repo

Custom templated skills (`release`, `ios-build`, `app-preview`) need a per-app config. The app declares its identity in `.claude/app.yml`.

```bash
# In the app repo root
mkdir -p .claude
cp ~/projects/claude-skills/templates/app.yml.example .claude/app.yml
$EDITOR .claude/app.yml   # fill in name, bundle_id, scheme, team_id, url_scheme, linear team_key
git add .claude/app.yml
git commit -m "chore: add claude-skills app config"
```

Schema:

```yaml
schema_version: 1
app:
  name: MyApp                       # required — drives APP_NAME, preview folder, archive name
  bundle_id: com.example.myapp      # required — drives APP_BUNDLE_ID
  scheme: MyApp                     # required — xcodebuild scheme
  team_id: TEAMID123                # required — signing team
  url_scheme: myapp                 # required — deep-link scheme (no `://`)
  build_script: build.sh            # optional, default build.sh
  preview_root: ~/MyAppPreviews     # optional, default ~/<name>Previews
linear:
  team_key: MYA                     # used by /linear-* commands
  agent_user_id:                    # optional — for /linear-pick assignment
```

After landing `.claude/app.yml`, the templated skills work from inside that repo automatically — they walk up the directory tree to find the config.

## Common operations

### Sync a machine after installing/removing something via Claude UI

```bash
cd ~/projects/claude-skills
bash setup/capture.sh
git diff               # review what changed
git add -A && git commit -m "chore: sync from <machine>" && git push
```

Capture only upserts — it never deletes entries. To remove a plugin, hand-edit `claude-setup.toml` and commit.

### Add a new custom skill from any repo

```bash
claude-skills-contribute --skill <skill-name> --message "add <skill-name> skill"
```

This: branches off `main`, scaffolds `skills/<skill-name>/SKILL.md` from the template, runs tests, commits, pushes, opens a PR via `gh`. Refuses on dirty working tree or unauthenticated `gh`.

### Contribute live machine state back

```bash
claude-skills-contribute --message "<what changed>"
```

Same as above but instead of scaffolding, runs `capture.sh` to absorb live state.

### Useful flags

| Flag | Effect |
|---|---|
| `--no-pr` | Push branch, skip `gh pr create`. |
| `--auto-merge` | Squash-merge once CI passes (use sparingly). |

## What each skill does

| Skill | Trigger | What it does |
|---|---|---|
| `commit` | "commit", "save this", "checkpoint" | Lint changed `.sh` with shellcheck, stage by name, write conventional commit, no `--amend` ever. |
| `linear-pm` | Any `/linear-*` invocation | Linear label vocabulary + status taxonomy + the six `/linear-*` slash commands. Per-repo policy in `.claude/linear.yml`. |
| `release` | "release", "ship a TestFlight build", `/release` | iOS release pipeline: archive → export → validate → upload via altool → tag. Reads `app.yml`. Refuses on dirty tree unless `--force`. |
| `ios-build` | "build", "build for sim", "build on device" | Delegates to app's own `build.sh` if present, falls back to bare `xcodebuild`. Reads `app.yml`. |
| `app-preview` | "screenshot", "show me", "preview the app", `/preview`, `/fix` | Build → launch on booted sim → deep-link → snap → deliver to phone via iMessage ping + iCloud Drive. Reads `app.yml`. |
| `contribute` | "contribute back to claude-skills", `/contribute-skill` | Thin wrapper around `claude-skills-contribute`. |

## Files Claude reads automatically

Once `setup.sh` runs:

- `~/.claude/skills/<name>` → `claude-skills/skills/<name>` (each custom skill).
- `~/.claude/agents/<name>.md` → `claude-skills/agents/<name>.md`.
- `~/.claude/commands/<name>.md` → `claude-skills/commands/<name>.md`.

Edit the file in this repo, change goes live immediately — no re-deploy.

## Hooks (not auto-installed; reference from per-project settings)

`hooks/app-build-reminder.sh` and `hooks/shellcheck-on-edit.sh` are not symlinked anywhere by default. Reference them from a project's `.claude/settings.json` if you want them active in that project:

```json
{
  "hooks": {
    "Stop": [
      { "command": "bash", "args": ["~/projects/claude-skills/hooks/app-build-reminder.sh"] }
    ],
    "PostToolUse": {
      "Edit|Write": [
        { "command": "bash", "args": ["~/projects/claude-skills/hooks/shellcheck-on-edit.sh"] }
      ]
    }
  }
}
```

## Testing

```bash
cd ~/projects/claude-skills
bats tests/bats/                          # 27 tests — bash + integration
uv tool run pytest tests/pytest/ -q       # 7 tests — TOML parse/write
shellcheck setup/*.sh skills/_lib/*.sh    # clean
```

CI runs all three on `push` to `main` and on every PR — `.github/workflows/test.yml`. macOS + Ubuntu matrix.

## Architecture

```
                     ┌──────────────────────┐
                     │  claude-setup.toml   │  ← manifest (TOML)
                     └────────┬─────────────┘
                              │
        ┌─────────────────────┴──────────────────────┐
        │                                            │
        ▼                                            ▼
  setup.sh (apply)                          capture.sh (snapshot)
        │                                            │
        ▼                                            ▼
  ~/.claude/                                  Live machine state
  ├── skills/<name> ─ symlink ──┐             (settings.json,
  ├── agents/<name>.md          │              installed_plugins.json,
  ├── commands/<name>.md        │              skill-lock.json, …)
  ├── settings.json (copy)      │
  └── ...                       │
                                ▼
                       claude-skills/
                       ├── skills/<name>/
                       ├── agents/, commands/
                       └── templates/

  ~/.local/bin/
  └── claude-skills-contribute ─→ claude-skills/setup/contribute.sh
                                       │
                                       ▼
                          branches + commits + PR back here
```

Templated skills (`release`, `ios-build`, `app-preview`) source `skills/_lib/load_app_config.sh` at invocation. That walks up from `$PWD` looking for `.claude/app.yml` and exports `APP_NAME`, `APP_BUNDLE_ID`, `APP_SCHEME`, `APP_TEAM_ID`, `APP_URL_SCHEME`, `APP_BUILD_SCRIPT`, `APP_PREVIEW_ROOT`, `LINEAR_TEAM_KEY`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh` says "python3 too old" | macOS Sequoia ships 3.13. Older machines: `brew install python@3.11`. |
| `setup.sh` says symlink target is "foreign" | Existing symlink at `~/.claude/skills/<name>` points elsewhere (e.g. an npx-skills install). Setup refuses to clobber. Delete or rename the existing one, re-run setup. |
| `claude-skills-contribute` says "gh not authenticated" | `gh auth login`. |
| `claude-skills-contribute` says "working tree dirty" | Commit or stash other in-progress work in `claude-skills` first — contribute won't bundle unrelated changes. |
| `release.sh` says "no .claude/app.yml found" | You're not in an app repo, or `.claude/app.yml` is missing. See "Onboard a new app repo". |
| `bats` "command not found" | Re-run `setup.sh` — preflight installs it via brew. Manual: `brew install bats-core`. |
| `pytest` "command not found" | Use `uv tool run pytest tests/pytest/` — pytest is invoked through `uv`, never installed system-wide. |
| `uv` "command not found" | Re-run `setup.sh` — preflight installs it. Manual: `curl -LsSf https://astral.sh/uv/install.sh \| sh`. |

## Design + plan documents

- `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md` — full design rationale, the 4 advisor-flagged blockers, the 9-section migration plan.
- `docs/superpowers/plans/2026-05-25-claude-skills-seed.md` — the 23-task TDD implementation plan that built this repo.

## Open follow-ups

- **doc-scan cutover** — still has its own `scripts/claude-setup/` and `.claude/skills/{commit,linear-pm,paperix-preview,release,ios-build}/`. Once the symlinked skills here are battle-tested on a Paperix release cycle, delete the doc-scan copies and add `doc-scan/.claude/app.yml`.
- **Mac mini validation** — clone fresh, run `setup.sh`, run a real `release` cycle. Original failure mode never reproduced; defensive measures in place.
- **Phase 2: marketplace publication** — register the repo as a Claude marketplace + push skills to skills.sh so friends can `claude plugin marketplace add <yours>`. Out of scope for v1.
- **Caveman skills under `~/.claude/skills/`** — symlinks to `~/.agents/skills/caveman*` exist but aren't in any lockfile. Provenance unknown — investigate before next capture.

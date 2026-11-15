# claude-skills usage guide

Single-source dev environment seed. Cloned on every machine, referenced by every app repo. This doc is the operator's manual for the machine seed and for contributing back; for what each plugin does, read the [skills catalog](docs/skills-catalog.md).

## What this repo is

- **`plugins/<name>/`** — the eight plugins (`ios-dev`, `linear-pm`, `core-workflow`, `second-wind`, `prompt-craft`, `portable-artifacts`, `test-board`, `session-compass`). Each holds its own `skills/`, `commands/`, `agents/` and `hooks/` and installs through the marketplace in `.claude-plugin/marketplace.json`; nothing is symlinked out of this repo any more.
- **`claude-setup.toml`** — declarative manifest: marketplaces, plugins, npx-skills, dotfile mappings. Hand-edit it or let `capture.sh` rewrite it.
- **`setup/setup.sh`** — idempotent installer. Reads the TOML, brings a machine to the manifest's state.
- **`setup/capture.sh`** — snapshots the current machine into the TOML and `templates/`, after a secret scan.
- **`setup/contribute.sh`** — runnable from any repo (installed as `~/.local/bin/claude-skills-contribute`); branches off this repo, then captures or scaffolds a skill. Capture mode stops after the diff unless you pass `--commit` or `--push`.
- **`tools/`** — `second-wind` (the `wind` CLI) and `cache-clock` (a Copilot CLI extension).
- **`adapters/install.sh`** — links plugin skills into Codex, Copilot CLI and `AGENTS.md`-aware tools.
- **`templates/`** — `home-CLAUDE.md`, `user-settings.json`, `app.yml.example`, `skill.md.example`: sources for the `setup.sh` dotfile copy and for `contribute.sh` scaffolding.
- **`tests/bats/`, `tests/pytest/`** — the suites CI runs on macOS and Ubuntu.
- **`docs/`** — architecture and catalog pages, design specs, plans. `site/` is the public landing page.

## Bootstrap a fresh machine

```bash
# 1. Clone to the canonical path (the env var defaults to this)
git clone <repo-url> ~/projects/claude-skills

# 2. Run setup. Idempotent. Re-run any time to pull updates.
bash ~/projects/claude-skills/setup/setup.sh
```

The preflight step installs missing dev dependencies (`bats-core`, `shellcheck` via brew; `uv` via the official Astral installer). Python dependencies (`tomlkit`) are resolved on demand by `uv run` from PEP 723 inline metadata — no `pip install` step, no `requirements.txt`, no virtualenv to remember.

```bash
# 3. Confirm the shims landed
which claude-skills-contribute   # → ~/.local/bin/claude-skills-contribute
which wind                       # → ~/.local/bin/wind
claude plugin list               # the plugins from the manifest and from this repo
```

End state: Claude Code installed and updated, the manifest's marketplaces registered, its plugins installed at user scope, this repo's own marketplace added from the checkout with all eight plugins installed, npx-skills installed, `~/CLAUDE.md` and `~/.claude/settings.json` copied from `templates/` (a different existing file is backed up as `<name>.bak.<timestamp>` first; `--dry-run` only reports "would back up"), the shared behavioral guidelines merged into `~/CLAUDE.md`, and the `claude-skills-contribute` and `wind` shims on PATH. The `symlinks` step also removes links in `~/.claude/{skills,agents,commands}` that point into this repo, left over from the pre-plugin layout.

Which `CLAUDE.md` the setup writes, which plugins it enables, whether the self marketplace is a folder or a GitHub source, and the site wording are open owner decisions: see [`docs/decisions-pending.md`](docs/decisions-pending.md).

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Print what would change. No mutations and no backups. |
| `--verbose` | `set -x` — every shell command logged. |
| `--only <step>` | Run just one step. Steps: `preflight claude marketplaces plugins skills dotfiles guidelines local_plugins symlinks summary`. |
| `--skip-<step>` | Skip a single step. Repeatable. |
| `--merge-claude-md <path>` | In the `guidelines` step, also merge the behavioral guidelines into `<path>` (any machine or repo's `CLAUDE.md`). |

### Exit codes

- `0` — all steps succeeded.
- `1` — a `fail`-level error occurred (e.g. installer crashed, gh not authed).
- `2` — `warn`-level issues only (e.g. one plugin update failed, the rest succeeded).

## Onboard a new iOS app repo

The `ios-dev` skills and commands (`/preview`, `/fix`, build, release) read a per-app config, `.claude/app.yml`, schema v2. Generate it from inside the app repo:

```text
/ios-init
```

It detects the name, bundle id, team, extension targets and deployment target from an XcodeGen `project.yml` (or `xcodebuild -list`), leaves anything it cannot find as `TODO`, and walks you through the rest. It refuses to overwrite an existing file unless you pass `--force`; `--migrate` upgrades a v1 file in place. Commit the result:

```bash
git add .claude/app.yml
git commit -m "chore: add ios-dev app config"
```

The skills find the config by walking up from `$PWD`; `plugins/ios-dev/skills/_lib/load_app_config.sh` reads it and exports `APP_*`, `TARGETS_*`, `RELEASE_*` and `SITE_*` variables (including `APP_NAME`, `APP_BUNDLE_ID`, `APP_SCHEME`, `APP_TEAM_ID`, `APP_URL_SCHEME`, `APP_PREVIEW_ROOT` and `LINEAR_TEAM_KEY`). `templates/app.yml.example` is a schema v1 sample kept for reference. See the [ios-dev guide](https://abhijitbansal.github.io/claude-skills/features/ios-dev.html).

## Common operations

### Sync a machine after installing/removing something via Claude UI

```bash
claude-skills-contribute --message "chore: sync from <machine>"
```

This runs `capture.sh` on a fresh `contrib/*` branch, shows the diff and stops. Read it for secrets and private names. To keep it, pass `--commit` (commit only) or `--push` (commit, push and open a PR); nothing is staged except the three files capture writes. Capture only upserts — it never deletes entries. To remove a plugin, hand-edit `claude-setup.toml` and commit.

```bash
bash setup/capture.sh && git diff    # the same capture, in the current checkout
```

### Add a new skill from any repo

```bash
claude-skills-contribute --skill <skill-name> --plugin <plugin> --message "add <skill-name> skill"
```

This branches off `main`, scaffolds `plugins/<plugin>/skills/<skill-name>/SKILL.md` from the template (`--plugin` defaults to `core-workflow`), runs the tests, commits, pushes and opens a PR via `gh`. It needs `bats` and `uv` and fails before branching when either is missing. It refuses on a dirty working tree or an unauthenticated `gh`. A new skill also needs the count sweep and a catalog row in the same commit: `python3 scripts/sweep_counts.py --write`.

### Useful flags

| Flag | Effect |
|---|---|
| `--commit` | Capture mode only: commit on the new branch and stop. |
| `--push` | Capture mode only: commit, push and open a PR. |
| `--no-pr` | Push the branch, skip `gh pr create`. |
| `--auto-merge` | Queue a squash-merge once required checks pass (`gh pr merge --auto`); branch protection can still hold it. |

An unknown flag exits 2 and lists the accepted ones.

## What the plugins do

Each plugin's skills, commands, agents and hooks are listed in the [skills catalog](docs/skills-catalog.md) ([searchable version](https://abhijitbansal.github.io/claude-skills/catalog.html)). In short:

| Plugin | What it gives you |
|---|---|
| `ios-dev` | Simulator build, screenshot and delivery to your phone (`/preview`, `/fix`), device builds, gated TestFlight and App Store releases (`/release`), repo scaffolding (`/ios-scaffold`), the app config (`/ios-init`), the marketing-site kit (`/site`) and a catalog of lesson skills. |
| `linear-pm` | Linear label and status conventions and six `/linear-*` commands, including `/linear-pick`. Per-repo policy in `.claude/linear.yml`. |
| `core-workflow` | `commit`, `contribute`, `/team`, `/explain-branch`, `/cleanup-branches`, the `/learn` lesson capture, the image-parser and web-researcher agents, a shellcheck-on-edit hook and a hook that suggests a lesson skill from an exact error string. |
| `second-wind` | The `wind` CLI and a skill that resume tmux sessions after the usage limit resets. |
| `prompt-craft` | `/improve-prompt`, `/plan`, debug, refactor and review lenses, and opt-in guardrails. |
| `portable-artifacts` | `make-dashboard`, `make-diagram`, `make-explainer`, `make-motion` and `make-scene`: offline HTML pages and MP4 films from a prompt. See [portable-artifacts USAGE](plugins/portable-artifacts/USAGE.md). |
| `test-board`, `session-compass` | Two session mods: a test-results band and a session compass above the prompt. |

## Files Claude reads automatically

Installing a plugin registers everything it ships: its skills, slash commands, agents and hooks (for example `core-workflow`'s `hooks/hooks.json` wires `shellcheck-on-edit.sh` and `skill-hint.sh`). Nothing in `~/.claude/skills`, `~/.claude/agents` or `~/.claude/commands` needs to point into this repo. Edit a file under `plugins/` and update the plugin (`claude plugin update <name>@claude-skills`) to load the change; the plugin cache is a copy, so edit in the repo, never in the cache.

## Testing

```bash
cd ~/projects/claude-skills
bats tests/bats/                          # bash + integration
uv tool run pytest tests/pytest/ -q       # TOML round-trip, counts, frontmatter, copy buttons
shellcheck setup/*.sh adapters/*.sh
```

`python3 scripts/sweep_counts.py --check` finds stale counts in the docs and site; `--write` fixes them. CI runs the suites, the sweep, manifest validation, `shellcheck`, the commit-trailer check and the plugin-version guard on every PR — `.github/workflows/test.yml`, macOS and Ubuntu. The two mods' TypeScript tests are not in CI; their local gate is in [`AGENTS.md`](AGENTS.md).

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
  claude plugin install ...                   Live machine state
  ~/CLAUDE.md, ~/.claude/settings.json        (settings.json,
  ~/.local/bin shims                           installed_plugins.json, …)
        │
        ▼
  claude-skills/
  ├── .claude-plugin/marketplace.json  → the eight plugins
  ├── plugins/<name>/{skills,commands,agents,hooks}
  └── templates/

  ~/.local/bin/
  ├── claude-skills-contribute ─→ claude-skills/setup/contribute.sh
  │                                    │
  │                                    ▼
  │                       branch, capture or scaffold, optional commit, push, PR
  └── wind ─→ claude-skills/tools/second-wind/wind.py
```

The templated `ios-dev` skills (`release`, `ios-build`, `app-preview`) source `plugins/ios-dev/skills/_lib/load_app_config.sh` at invocation. It walks up from `$PWD` looking for `.claude/app.yml` and exports the variables named above.

## Tips & limitations

**Tips**

- Run `setup.sh --dry-run` first on any unfamiliar machine — it prints every action and mutates nothing. Add `--verbose` to trace each shell command.
- Isolate a single step with `--only <step>` (e.g. `--only guidelines`) or exclude one with `--skip-<step>`. Every step is idempotent, so re-running the whole script is always safe.
- Treat `claude-setup.toml` as the single source of truth — edit the arrays to diverge from the author's stack, then re-run `setup.sh` to reconcile the machine.
- Use `--merge-claude-md <path>` to additively push the behavioral guidelines into any other repo's `CLAUDE.md` without rewriting the rest of that file.

**Limitations**

- **No version pinning for plugins.** `claude plugin install` has no version flag, so any pin in the TOML is surfaced as a warning and the latest is installed.
- **The guidelines merge is additive only.** It appends `##` sections that are missing; it never edits or removes a section already present, so a drifted section must be reconciled by hand.
- **Second Wind needs tmux + the Claude Code CLI** and is validated on macOS and Ubuntu only. It detects the usage limit by parsing pane text, so an upstream wording change could require a pattern update — see the limit-detection section of the [Second Wind guide](docs/second-wind/index.html).
- **Cache Clock is tested on Copilot CLI 1.0.95 and VS Code's Copilot agent host (runtime 1.0.92-4.unstable).** It reads Copilot's `assistant.usage` events, so a change to that payload could need an update. VS Code loads it only from a per-repo install (`install.sh --project`, into `.github/extensions`) and only with the experimental setting `"chat.canvases.enabled": true`, does not list `/cache-clock` in its `/` menu, and shows its heads-up only in VS Code's log — see the [Cache Clock guide](docs/features/cache-clock.html).
- **GitHub Pages is gated.** The public site deploys only when the repo is public, Pages source is set to GitHub Actions, and a release is published — see the [machine-setup runbook](docs/machine-setup.html).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh` says "python3 too old" | macOS Sequoia ships 3.13. Older machines: `brew install python@3.11`. |
| `setup.sh` says symlink target is "foreign" | Existing symlink at `~/.local/bin/<name>` points elsewhere. Setup refuses to clobber. Delete or rename the existing one, re-run setup. |
| `claude-skills-contribute` says "gh not authenticated" | `gh auth login`. |
| `claude-skills-contribute` says "working tree dirty" | Commit or stash other in-progress work in `claude-skills` first — contribute won't bundle unrelated changes. |
| `claude-skills-contribute` stops after printing a diff | Capture mode keeps nothing until you ask. Re-run with `--commit` or `--push`. |
| `release.sh` says "no .claude/app.yml found" | You're not in an app repo, or `.claude/app.yml` is missing. Run `/ios-init`. |
| `bats` "command not found" | Re-run `setup.sh` — preflight installs it via brew. Manual: `brew install bats-core`. |
| `pytest` "command not found" | Use `uv tool run pytest tests/pytest/` — pytest is invoked through `uv`, never installed system-wide. |
| `uv` "command not found" | Re-run `setup.sh` — preflight installs it. Manual: `curl -LsSf https://astral.sh/uv/install.sh \| sh`. |

## Design + plan documents

- `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md` — full design rationale, the 4 advisor-flagged blockers, the 9-section migration plan.
- `docs/superpowers/plans/2026-05-25-claude-skills-seed.md` — the 23-task TDD implementation plan that built this repo.
- `docs/skill-improvement-plan-2026-11.md` — the 2026-11 skill improvement plan, with its status and the register behind it.
- `docs/decisions-pending.md` — owner calls an agent parked.

## Open follow-ups

The dated seed spec lists its follow-ups as of May 2026; this is the live list.

- **Legacy app cutover** — an older app repo may still have its own `scripts/claude-setup/` and `.claude/skills/`. Once the plugin skills here are battle-tested on one of its release cycles, delete the local copies and add `.claude/app.yml` with `/ios-init`.
- **Mac mini validation** — clone fresh, run `setup.sh`, run a real `release` cycle. The original failure was never reproduced; defensive measures are in place.
- **Machine-setup decisions** — see [`docs/decisions-pending.md`](docs/decisions-pending.md).
- Done since the seed: marketplace publication (`/plugin marketplace add abhijitbansal/claude-skills`, plus `npx skills add`).

## Using these skills from other AI tools

SKILL.md is tool-agnostic. To wire the skills into other agents:

```bash
adapters/install.sh codex      # symlink into ~/.agents/skills (CODEX_SKILLS_DIR to override)
adapters/install.sh copilot    # symlink into ~/.copilot/skills (COPILOT_SKILLS_DIR to override)
adapters/install.sh agents-md [path/to/AGENTS.md]   # managed skill-index block for AGENTS.md-aware tools (Hermes, etc.)
adapters/install.sh all
```

Re-run after adding skills; the script is idempotent and prunes links it created for removed skills. The `codex` adapter links into `~/.agents/skills`, the folder Codex reads; links an older run left in `~/.codex/skills` are not removed, so delete them by hand.

The adapters link skill folders only. `make-dashboard` / `make-diagram` / `make-explainer` / `make-motion` / `make-scene` additionally need `npm ci` in their skill folders, and sibling skills beside them; `node plugins/portable-artifacts/bin/install.mjs <host>` handles that (plus Gemini and project-scoped installs). Run any installer against a temporary directory when testing, not this checkout.

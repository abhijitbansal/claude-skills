# claude-skills: Plugin Marketplace Restructure + Second Wind Import

**Date:** 2026-06-10
**Status:** Approved

## Goal

Make this repo the single home for all of Abhijit's AI-agent skills and scripts:

1. Restructure as a Claude Code **marketplace** hosting focused **plugins**, while keeping the personal seed/bootstrap machinery.
2. Import **Second Wind** (`wind.py` tmux orchestrator) from `github.com/abhijitbansal/second-wind`, branch `claude/abh-42-implementation-4vb9xc`.
3. Make skills usable from other AI tools (Codex, Copilot CLI, Hermes, anything AGENTS.md-aware) via thin adapters.
4. Ready the repo for other machines and public users.

## Decisions (from brainstorm)

| Question | Decision |
| --- | --- |
| Repo shape | Marketplace + plugins, **keep** personal seed machinery in same repo |
| Second Wind placement | Canonical CLI in `tools/second-wind/`, thin SKILL.md wrapper in a plugin |
| Multi-tool depth | Agent-agnostic core (standard SKILL.md) + symlink/AGENTS.md adapters; no conversion pipeline |
| Plugin packaging | Few focused plugins: `ios-dev`, `linear-pm`, `second-wind`, `core-workflow` |
| Public prep | Sanitize and keep personal templates in-repo, clearly marked; public installs touch only plugin dirs |
| Second Wind history | Plain file copy, no git history (history stays in old repo) |

## Target layout

```
claude-skills/
├── .claude-plugin/
│   └── marketplace.json          # lists the 4 plugins below
├── plugins/
│   ├── ios-dev/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── skills/               # app-preview, ios-build, release (+ _lib/load_app_config.sh)
│   │   ├── commands/             # preview.md
│   │   └── hooks/                # app-build-reminder.sh + hooks.json
│   ├── linear-pm/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── skills/linear-pm/     # SKILL.md, README, scripts, templates
│   │   └── commands/             # linear-init, linear-new, linear-pick, linear-status, linear-sync, linear-block
│   ├── second-wind/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/second-wind/SKILL.md   # wrapper that drives the wind CLI
│   └── core-workflow/
│       ├── .claude-plugin/plugin.json
│       ├── skills/               # commit, contribute
│       ├── commands/             # fix.md, team.md, contribute-skill.md
│       ├── agents/               # image-parser.md, web-researcher.md
│       └── hooks/                # shellcheck-on-edit.sh + hooks.json
├── tools/
│   └── second-wind/              # wind.py, tests/, README.md  (canonical home)
├── adapters/
│   └── install.sh                # wire skills into other AI tools
├── setup/                        # personal seed: setup.sh, capture.sh, contribute.sh, parse/write_toml.py, _lib.sh
├── scripts/                      # statusline.sh, show-advisor.sh (personal, not in plugins)
├── templates/                    # personal machine templates (marked personal)
├── tests/                        # bats + pytest (existing + second-wind suite)
└── docs/
```

## Components

### 1. Marketplace + plugins (the big move)

- `.claude-plugin/marketplace.json`: owner metadata + 4 plugin entries with `source: "./plugins/<name>"`.
- Each plugin gets `.claude-plugin/plugin.json` (name, description, version, author).
- Move top-level `skills/`, `commands/`, `agents/`, `hooks/` content into the plugin dirs per the layout above.
- `skills/_lib/load_app_config.sh` is shared by iOS skills only → moves into `ios-dev` plugin; skill scripts reference it via `${CLAUDE_PLUGIN_ROOT}`-relative paths (verify the exact env var/path mechanism plugins provide at implementation time; fall back to path-relative `../../_lib/`).
- Hook registration: plugins declare hooks via the plugin `hooks/hooks.json` mechanism. Current hooks live in user `settings.json` via seed setup — the move must not double-register. Seed setup stops wiring these two hooks directly once plugins own them.

### 2. Seed coexistence

- `setup.sh` replaces the symlink-skills step with:
  1. `claude plugin marketplace add <repo path>` (local marketplace, idempotent),
  2. install `ios-dev`, `linear-pm`, `second-wind`, `core-workflow` from it,
  3. symlink `tools/second-wind/wind.py` → `~/.local/bin/wind`.
- `claude-setup.toml` gains the self-marketplace + 4 plugin entries so capture/setup round-trips.
- `capture.sh` and `contribute.sh` updated for new paths (contribute's `--skill` flag now targets `plugins/<plugin>/skills/`; default plugin `core-workflow`, flag to choose).
- Bats tests updated for all of the above.

### 3. Second Wind import

- Copy `wind.py`, `tests/fake_claude.py`, `tests/test_wind.py`, `README.md` from the branch into `tools/second-wind/`.
- Pytest suite wired into existing CI (`.github/workflows/test.yml`).
- `plugins/second-wind/skills/second-wind/SKILL.md`: teaches the agent `wind init/up/watch/status/resume/down`, config keys, and limit-detection behavior. Includes an install fallback: if `wind` is not on PATH, fetch raw `wind.py` from this repo's GitHub main branch and install to `~/.local/bin/wind` (covers plugin-only installs without the repo clone).
- Old repo: untouched by this work; archive manually later if desired.

### 4. Multi-tool adapters

- `adapters/install.sh [codex|copilot|agents-md|all]`:
  - **codex**: symlink each `plugins/*/skills/*` dir into `~/.codex/skills/` (verify Codex's actual discovery path at implementation time).
  - **copilot**: same pattern into Copilot CLI's skill discovery path (verify).
  - **agents-md**: generate/refresh a managed block in the target repo's `AGENTS.md` listing each skill name, description (from frontmatter), and absolute path — generic fallback for Hermes and other AGENTS.md-aware tools.
- Idempotent, re-runnable; removes stale links it created (managed-marker convention).
- SKILL.md remains the single source format; no per-tool conversion.

### 5. Public readiness

- Sanitize audit: `templates/user-settings.json`, `templates/home-CLAUDE.md`, linear templates, all skill scripts — no secrets, tokens, emails, or machine-specific absolute paths in plugin dirs. Personal-but-harmless seed files stay with a "personal seed" header comment.
- `README.md` rewrite: public quick start first (`/plugin marketplace add abhijitbansal/claude-skills`, then `/plugin install <name>@claude-skills`), Second Wind CLI install, multi-tool adapter usage, then personal machine bootstrap section.
- Add MIT `LICENSE`.
- CI additions: JSON validation of `marketplace.json` + all `plugin.json` files; second-wind pytest job.

## Error handling

- `setup.sh` plugin steps follow existing `_lib.sh` conventions (fail loud, idempotent re-runs).
- `adapters/install.sh` skips tools whose directories don't exist, with a clear message — no silent failure, no creation of foreign tool dirs.
- Second Wind skill install fallback verifies download (non-empty, contains expected shebang) before marking executable.

## Testing

- Existing bats suites updated for new paths; new bats coverage for marketplace-add/install steps in `setup.sh` (mock `claude` already exists in `tests/bats/mocks/`).
- New bats test for `adapters/install.sh` (symlinks created/removed, AGENTS.md block managed).
- Second Wind pytest suite runs as-is from `tools/second-wind/tests/`.
- CI: shellcheck (existing hook), bats, pytest, JSON validation.

## Build order (4 implementation plans)

1. **Plugin restructure**: marketplace.json, plugin.json files, file moves, setup.sh/capture.sh/contribute.sh rewire, test updates.
2. **Second Wind import**: tools/ copy, pytest in CI, skill wrapper, PATH install.
3. **Multi-tool adapters**: adapters/install.sh + tests.
4. **Public polish**: sanitize audit, README rewrite, LICENSE, CI validation jobs.

Each plan lands independently; repo stays green between them.

## Out of scope

- Converting skills to tool-specific formats (Cursor rules, Copilot instructions files).
- Archiving/redirecting the old second-wind repo.
- Publishing to any registry beyond GitHub.

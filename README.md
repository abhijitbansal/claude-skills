# claude-skills

[![test](https://github.com/abhijitbansal/claude-skills/actions/workflows/test.yml/badge.svg)](https://github.com/abhijitbansal/claude-skills/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Plugins and tools for the daily dev loop on Claude Code: iOS builds and releases, Linear project management, workflow helpers, overnight resume after usage limits, prompt craft, test results and session status.**

## Plugins

Skills, plugins and tools for AI agents, usable from **Claude Code**, **Codex**, **Copilot CLI** and any **AGENTS.md-aware** agent. Everything below is a separate plugin; install only what you need.

| Plugin | What you get |
| --- | --- |
| `ios-dev` | The iOS feedback loop: a simulator build and screenshot delivered to your phone, device builds, TestFlight and App Store release automation. |
| `linear-pm` | Linear project-management conventions and six `/linear-*` commands, including `/linear-pick` for autonomous issue pickup. |
| `core-workflow` | Commit flow, skill contribution, a branch-cleanup command, the image-parser and web-researcher agents, and a shellcheck-on-edit hook. |
| `second-wind` | A usage-limit-aware overnight orchestrator (the `wind` CLI plus a skill wrapper). |
| `prompt-craft` | Turns a rough ask into a deterministic spec (`/improve-prompt`, `/plan`), with debug, refactor and review lenses and opt-in secret and format guardrails. |
| `test-board` | A band above the prompt with passed, failed and skipped counts after every test run, next to the previous run of the same suite. |
| `session-compass` | What each session is building, where it stands and what it produced: a compass band, a `/compass` pane and a `compass_status` tool. |

Beyond the plugins: a standalone `wind` CLI (`tools/second-wind`), a Copilot CLI cache guard (`tools/cache-clock`), and the companion `cartoon` project for token-lean CLI output.

### Companion plugin: portable-artifacts

`portable-artifacts` turns one prompt into decks, diagrams, dashboards, 3D scenes and MP4 films: files that open offline, built by whatever coding agent you already use. It used to live in this repo and now has its own: [abhijitbansal/portable-artifacts](https://github.com/abhijitbansal/portable-artifacts), with a [site and gallery](https://abhijitbansal.github.io/portable-artifacts/).

```text
/plugin marketplace add abhijitbansal/portable-artifacts
/plugin install portable-artifacts@portable-artifacts
```

Other agents: `npx skills add abhijitbansal/portable-artifacts --skill make-dashboard make-diagram make-explainer make-motion make-scene` (`npx skills` does not install sibling skills for you: `make-explainer` needs `make-diagram` and `make-dashboard` beside it, and `make-scene` needs them to lift a diagram or a chart, so name all five as shown), or clone the repo and run `node portable-artifacts/plugins/portable-artifacts/bin/install.mjs codex` (also `copilot`, `gemini`, `agents`). If you already added this marketplace, `portable-artifacts@claude-skills` still works: it resolves to the new repo. [Changelog](https://github.com/abhijitbansal/portable-artifacts/blob/main/plugins/portable-artifacts/CHANGELOG.md).

**Feature guides:** [portable-artifacts](https://abhijitbansal.github.io/portable-artifacts/) (own site) ·
[Second Wind](https://abhijitbansal.github.io/claude-skills/features/second-wind.html) ·
[prompt-craft](https://abhijitbansal.github.io/claude-skills/features/prompt-craft.html) ·
[session mods](https://abhijitbansal.github.io/claude-skills/features/mods.html) ·
[ios-dev](https://abhijitbansal.github.io/claude-skills/features/ios-dev.html) ·
[linear-pm](https://abhijitbansal.github.io/claude-skills/features/linear-pm.html) ·
[core-workflow](https://abhijitbansal.github.io/claude-skills/features/core-workflow.html)

**Docs:** [Architecture](docs/architecture.md) ([visual](https://abhijitbansal.github.io/claude-skills/architecture.html)) ·
[Skills & Tools Catalog](docs/skills-catalog.md) ([visual](https://abhijitbansal.github.io/claude-skills/catalog.html)) ·
[Usage guide](USAGE.md)

## Installation

### Claude Code (recommended)

Inside any Claude Code session:

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install ios-dev@claude-skills
/plugin install linear-pm@claude-skills
/plugin install second-wind@claude-skills
/plugin install core-workflow@claude-skills
/plugin install prompt-craft@claude-skills
/plugin install test-board@claude-skills
/plugin install session-compass@claude-skills
```

Install only what you need — each plugin is self-contained. Skills, slash commands,
agents, and hooks register automatically on install.

### Second Wind (standalone CLI)

No plugin required. Needs Python 3.9+, tmux, and the Claude Code CLI.
Includes an interactive `wind init` wizard and a live `wind dash` web dashboard.

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/install.sh | sh

exec $SHELL
wind init     # interactive wizard: scans for repos, writes config
wind up       # one tmux session per repo + the detached auto-resume watcher
wind dash     # live localhost dashboard: status, pane tails, actions
```

`wind up` auto-spawns the watcher (detects the 5-hour limit, resumes after
reset) in its own detached tmux session — `--no-watch` skips it.

Full reference: [tools/second-wind/README.md](tools/second-wind/README.md) ·
[visual explainer](docs/second-wind/index.html)

### Cache Clock (Copilot CLI and VS Code Copilot chat)

A [cache-tax](https://github.com/karanb192/cache-tax)-style guard for GitHub Copilot:
shows when the prompt cache goes cold, what the next send costs cold vs warm, and asks
before a costly cold send goes out. Works in Copilot CLI, and in VS Code's Copilot chat
with a per-repo install (`install.sh --project`) and `"chat.canvases.enabled": true` in
VS Code settings.

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.2.0/tools/cache-clock/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/cache-clock-v1.2.0/tools/cache-clock/install.sh | sh -s -- --project   # VS Code: run in each repo
node ~/.copilot/extensions/cache-clock/report.mjs --since 7d   # what cold sends already cost you
```

Then run `/cache-clock help` in Copilot. The install is pinned to the release tag
`cache-clock-v1.2.0` and checks a SHA-256 for every file; the tag exists on the remote
(checked with `git ls-remote --tags origin`). The guard never stops local commands such as
`/model`, or `!` shell escapes; every other `/name`, including `/compact` and skill commands,
is guarded. A cold send on a model with no known price only warns once, then sends. Its files
are owner-only (0600 in 0700 folders). Optional keep-warm is off until `/cache-clock keepwarm on` and it costs money: it
keeps the cache warm for 3 hours after your last message (up to 12) and stops at payback,
the budget, the window end or the daily limit. The setting is global, but each open session
has its own window, budget and 24-hour ceiling: per session, at most 362 pings in 24 hours and
the daily dollar limit (default $2.00, set between $0.10 and $20); deleting the ledger file
resets it. Only one process per session pings: its lock is taken over after 30 minutes without
a refresh. It is tested against
a fake Copilot host only; do not enable it before the owner's live check confirms that Copilot
labels the ping's message as ours.

Full reference: [tools/cache-clock/README.md](tools/cache-clock/README.md) ·
[guide](docs/features/cache-clock.html) ·
[visual explainer](docs/features/showcase/cache-clock/how-it-works.html) ·
[architecture diagram](docs/features/showcase/cache-clock/diagram/cache-clock-architecture.html) ·
[17-second video](docs/features/showcase/cache-clock/video.mp4) (made with make-motion 1.x)

### Other AI tools (Codex, Copilot CLI, Hermes, …)

The skills are plain SKILL.md directories — tool-agnostic. Clone, then run the adapter:

```bash
git clone https://github.com/abhijitbansal/claude-skills
cd claude-skills
adapters/install.sh codex      # symlink into ~/.agents/skills   (CODEX_SKILLS_DIR overrides)
adapters/install.sh copilot    # symlink into ~/.copilot/skills  (COPILOT_SKILLS_DIR overrides)
adapters/install.sh agents-md [path/to/AGENTS.md]   # managed skills-index block for AGENTS.md-aware tools
adapters/install.sh all
```

Idempotent — re-run after pulling updates; it prunes links for removed skills. The adapter
only links skill folders: it runs no `npm ci --ignore-scripts`, installs no agent file and does not add sibling
skills. The `portable-artifacts` skills now live in their [own repo](https://github.com/abhijitbansal/portable-artifacts)
and are Node packages with their own installer (`node portable-artifacts/plugins/portable-artifacts/bin/install.mjs <claude|codex|copilot|gemini|agents> [--project .]`),
described in [its README](https://github.com/abhijitbansal/portable-artifacts#readme).

### Cartoon (token-optimized CLI output)

[`cartoon`](https://github.com/abhijitbansal/cartoon) is a companion project — a
separate marketplace that wraps noisy CLI output (test runs, JSON CLIs) into a
compact format for ~70% fewer input tokens. The full machine seed below installs
it automatically; to add it on its own:

```text
# Claude Code
/plugin marketplace add abhijitbansal/cartoon
/plugin install cartoon@cartoon
```

```bash
# Other agents
npx skills add abhijitbansal/cartoon
```

The plugin's skill auto-installs the `cartoon` binary on first use, or install it
yourself: `uv tool install cartoon` (or `pipx install cartoon` /
`npm install -g cartoon-wrap` / `cargo install cartoon`).

## Setup (full machine seed)

For a machine you own: clones the repo, installs Claude Code, marketplaces, plugins
(including this repo's own, via a local marketplace), npx skills, dotfiles, PATH shims,
and the shared behavioral guidelines.

```bash
git clone https://github.com/abhijitbansal/claude-skills ~/projects/claude-skills
bash ~/projects/claude-skills/setup/setup.sh
```

Useful flags: `--dry-run`, `--only <step>`, `--skip-<step>`, `--merge-claude-md <path>`.
Steps: `preflight claude marketplaces plugins skills dotfiles guidelines local_plugins symlinks`.

The `guidelines` step evaluates the `CLAUDE.md` on the machine (`~/CLAUDE.md`) and on the
repo you run setup from, then additively merges in any missing behavioral-guideline section
from this repo's [`CLAUDE.md`](CLAUDE.md) (adapted from Andrej Karpathy's). It never clobbers
your own content — sections already present are skipped. Point it at any other file with
`--merge-claude-md <path>`.

Snapshot the machine's current state back into the repo:

```bash
bash setup/capture.sh && git diff
```

Note: `templates/` and `claude-setup.toml` are the owner's personal seed data — public
users can ignore them entirely; plugins never touch them.

## Layout

| Path | What |
| --- | --- |
| `.claude-plugin/` | marketplace manifest |
| `plugins/` | the seven plugins (skills, commands, agents, hooks); portable-artifacts lives in [its own repo](https://github.com/abhijitbansal/portable-artifacts) |
| `tools/` | standalone CLIs (second-wind) and the Copilot CLI extension (cache-clock) |
| `adapters/` | wire skills into non-Claude tools |
| `setup/`, `templates/`, `claude-setup.toml` | personal machine seed |
| `docs/` | architecture + catalog docs, design specs, implementation plans |
| `tests/` | bats + pytest suites |

## Development

```bash
bats tests/bats/                                  # shell suites (setup, adapters, skills, manifests)
uv tool run pytest tests/pytest -q                # TOML round-trip
uv tool run pytest tools/second-wind/tests -q     # wind CLI
(cd tools/cache-clock && node --test "test/*.test.mjs")   # cache-clock
shellcheck setup/*.sh adapters/*.sh
```

CI runs all of the above plus manifest validation on macOS and Ubuntu.
Design history lives in [docs/superpowers/specs/](docs/superpowers/specs/).

## Contributing

PRs welcome. From any repo on a seeded machine:

```bash
claude-skills-contribute --message "fix: ..."                      # capture machine state, show the diff, stop (add --commit or --push to keep it)
claude-skills-contribute --skill my-skill --plugin core-workflow   # scaffold a new skill, then commit, push and open a PR
```

Or the ordinary way: fork, branch, `bats tests/bats/`, PR.

## License & support

MIT — see [LICENSE](LICENSE). If this repo saves you time, **star it** ⭐ — it helps
others find it. Issues and ideas: [GitHub issues](https://github.com/abhijitbansal/claude-skills/issues).

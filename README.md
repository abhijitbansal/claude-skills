# claude-skills

[![test](https://github.com/abhijitbansal/claude-skills/actions/workflows/test.yml/badge.svg)](https://github.com/abhijitbansal/claude-skills/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

Abhijit's AI-agent skills, plugins, and tools — one repo, usable from **Claude Code**,
**Codex**, **Copilot CLI**, and any **AGENTS.md-aware** agent.

| Plugin | What you get |
| --- | --- |
| `ios-dev` | iOS feedback loop: simulator build + screenshot delivered to your phone, device builds, TestFlight/App Store release automation |
| `linear-pm` | Linear PM conventions + 6 `/linear-*` commands, including `/linear-pick` autonomous issue pickup |
| `core-workflow` | commit flow, skill contribution, image-parser + web-researcher agents, shellcheck-on-edit hook |
| `second-wind` | usage-limit-aware overnight orchestrator (`wind` CLI + skill wrapper) |

**Docs:** [Architecture](docs/architecture.md) ([visual](docs/architecture.html)) ·
[Skills & Tools Catalog](docs/skills-catalog.md) ([visual](docs/skills-catalog.html)) ·
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
wind up       # one tmux session per repo, Claude Code launched in each
wind watch    # watcher: detects the 5-hour limit, resumes after reset
wind dash     # live localhost dashboard: status, pane tails, actions
```

Full reference: [tools/second-wind/README.md](tools/second-wind/README.md) ·
[visual explainer](docs/second-wind/index.html)

### Other AI tools (Codex, Copilot CLI, Hermes, …)

The skills are plain SKILL.md directories — tool-agnostic. Clone, then run the adapter:

```bash
git clone https://github.com/abhijitbansal/claude-skills
cd claude-skills
adapters/install.sh codex      # symlink into ~/.codex/skills    (CODEX_SKILLS_DIR overrides)
adapters/install.sh copilot    # symlink into ~/.copilot/skills  (COPILOT_SKILLS_DIR overrides)
adapters/install.sh agents-md [path/to/AGENTS.md]   # managed skills-index block for AGENTS.md-aware tools
adapters/install.sh all
```

Idempotent — re-run after pulling updates; it prunes links for removed skills.

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
(including this repo's own, via a local marketplace), npx skills, dotfiles, and PATH shims.

```bash
git clone https://github.com/abhijitbansal/claude-skills ~/projects/claude-skills
bash ~/projects/claude-skills/setup/setup.sh
```

Useful flags: `--dry-run`, `--only <step>`, `--skip-<step>`.
Steps: `preflight claude marketplaces plugins skills dotfiles local_plugins symlinks`.

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
| `plugins/` | the four plugins (skills, commands, agents, hooks) |
| `tools/` | standalone CLIs (second-wind) |
| `adapters/` | wire skills into non-Claude tools |
| `setup/`, `templates/`, `claude-setup.toml` | personal machine seed |
| `docs/` | architecture + catalog docs, design specs, implementation plans |
| `tests/` | bats + pytest suites |

## Development

```bash
bats tests/bats/                                  # shell suites (setup, adapters, skills, manifests)
uv tool run pytest tests/pytest -q                # TOML round-trip
uv tool run pytest tools/second-wind/tests -q     # wind CLI
shellcheck setup/*.sh adapters/*.sh
```

CI runs all of the above plus manifest validation on macOS and Ubuntu.
Design history lives in [docs/superpowers/specs/](docs/superpowers/specs/).

## Contributing

PRs welcome. From any repo on a seeded machine:

```bash
claude-skills-contribute --message "fix: ..."                      # capture current machine state
claude-skills-contribute --skill my-skill --plugin core-workflow   # scaffold a new skill
```

Or the ordinary way: fork, branch, `bats tests/bats/`, PR.

## License & support

MIT — see [LICENSE](LICENSE). If this repo saves you time, **star it** ⭐ — it helps
others find it. Issues and ideas: [GitHub issues](https://github.com/abhijitbansal/claude-skills/issues).

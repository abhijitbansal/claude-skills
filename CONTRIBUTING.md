# Contributing

Thanks for your interest! This repo is a collection of AI-agent **skills**,
**plugins**, and **tools** that work across Claude Code, Codex, Copilot CLI, and
any AGENTS.md-aware agent.

## Ways to contribute

- **Fix a bug** in a skill, command, hook, or tool.
- **Add a skill** — a `SKILL.md` directory teaching an agent a reusable technique.
- **Improve docs** — clearer install steps, better examples, fixed typos.

## Repo layout

| Path | What |
| --- | --- |
| `plugins/` | the five plugins (`ios-dev`, `linear-pm`, `core-workflow`, `prompt-craft`, `second-wind`) — each ships skills, commands, agents, hooks |
| `tools/` | standalone CLIs (`second-wind`) |
| `adapters/` | wire the skills into non-Claude tools |
| `AGENTS.md`, `CLAUDE.md` | contributor + agent conventions — `AGENTS.md` owns process (orchestration modes, model-tier/effort routing, branch/commit/CI workflow); `CLAUDE.md` owns the behavioral guidelines |
| `setup/`, `templates/`, `claude-setup.toml` | the owner's personal machine seed — safe to ignore |
| `tests/` | bats + pytest suites |

## Adding or changing a skill

1. A skill is a directory with a `SKILL.md` whose frontmatter has `name` and a
   **trigger-rich `description`** (list the phrasings that should fire it — this
   is what makes the skill discoverable).
2. Keep skills tool-agnostic where possible: prefer reading config (e.g.
   `.claude/app.yml`) over hardcoding any one project's names or paths.
3. Put scripts under the skill's own directory; make them `set -euo pipefail`
   and portable (macOS bash 3.2 + Linux).

## Before opening a PR

```bash
bats tests/bats/                              # shell suites
uv tool run pytest tests/pytest -q            # TOML round-trip
uv tool run pytest tools/second-wind/tests -q # wind CLI
shellcheck setup/*.sh adapters/*.sh plugins/**/*.sh
bash -n <any-changed-shell-script>            # quick syntax gate
```

CI runs the same suites on macOS and Ubuntu. Keep PRs focused, describe the
change and how you tested it, and flag anything that needs manual (device-only)
verification.

## Reporting issues

Use the issue templates. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

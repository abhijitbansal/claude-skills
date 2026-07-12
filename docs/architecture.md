# Repository Architecture

> Visual version: [architecture.html](architecture.html) (open in a browser)

`claude-skills` is three things in one repo:

1. A **Claude Code plugin marketplace** hosting five focused plugins.
2. A home for **standalone CLI tools** (currently Second Wind).
3. **Adapters** that wire the same skills into Codex, Copilot CLI, and any AGENTS.md-aware agent.

Plus private **seed machinery** that rebuilds the owner's full dev environment on a fresh machine.

## System overview

```mermaid
flowchart TD
  MP["marketplace.json (.claude-plugin/)"]
  IOS["ios-dev — 50 skills · 6 cmds"]
  LIN["linear-pm — 1 skill · 6 cmds"]
  CW["core-workflow — 11 skills · 4 cmds · 2 agents · 1 hook"]
  SW["second-wind — skill wrapper"]
  PC["prompt-craft — 7 skills · 6 hooks"]
  WIND[("tools/second-wind/wind.py")]
  AD["adapters/install.sh"]
  SEED["setup/ — setup.sh · capture.sh · contribute.sh"]
  CC(("Claude Code"))
  OTHER(("Codex / Copilot / AGENTS.md agents"))

  MP --> IOS & LIN & CW & SW & PC
  SW -.->|wraps| WIND
  CC -->|"/plugin marketplace add"| MP
  SEED -->|local_plugins step| CC
  SEED -->|"wind → ~/.local/bin"| WIND
  AD -->|symlink skills| OTHER
  IOS & LIN & CW & SW & PC -->|skills/| AD
```

## The five plugins

| Plugin | One-liner | Contents |
| --- | --- | --- |
| `ios-dev` | build → screenshot → phone → ship | app-preview, ios-build, release skills; `/preview`, `/fix` |
| `linear-pm` | issue conventions + autonomous pickup | linear-pm skill; `/linear-init`, `/linear-new`, `/linear-pick`, `/linear-status`, `/linear-sync`, `/linear-block` |
| `core-workflow` | everyday glue | commit, contribute, learn-lesson, branch-explainer, github-repo-go-public-preflight-scan, github-solo-branch-protection-codeowners skills; `/team`, `/contribute-skill`, `/learn`, `/explain-branch`; image-parser + web-researcher agents; shellcheck-on-edit hook |
| `second-wind` | outlast the 5-hour usage limit | SKILL.md wrapper for the `wind` CLI (self-installs when missing) |
| `prompt-craft` | rough ask → deterministic spec | `/improve-prompt`, `/plan`; debug/refactor/review lens skills; `/refresh`; a command advisor (relevance + history + git state) powering user-only `suggest_next` (Stop), `prompt_hint` (UserPromptSubmit) + `statusline_hint`; `registry_freshness` (SessionStart); opt-in `block_secrets` + `format_on_edit` hooks |

Full per-item descriptions: [skills-catalog.md](skills-catalog.md).

## How installs flow

**Public user, Claude Code** — two commands:

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install <name>@claude-skills
```

**Public user, other agents** — clone, then one script:

```bash
adapters/install.sh codex      # or copilot, agents-md, all
```

**Owner, fresh machine** — `setup/setup.sh` runs eight idempotent steps:

```
preflight → claude → marketplaces → plugins → skills → dotfiles → local_plugins → symlinks
```

The `local_plugins` step adds this repo as a local marketplace and installs every plugin listed in
`marketplace.json` — the owner's machines use the **same mechanism the public does**, so there is no
second code path to drift. The `symlinks` step also cleans up pre-plugin-era symlinks and puts
`wind` and `claude-skills-contribute` on PATH.

## Directory map

| Path | What |
| --- | --- |
| `.claude-plugin/marketplace.json` | marketplace manifest — the list of plugins |
| `plugins/<name>/` | one plugin each: `.claude-plugin/plugin.json` + `skills/`, `commands/`, `agents/`, `hooks/` |
| `tools/second-wind/` | canonical `wind.py` + its pytest suite |
| `adapters/install.sh` | codex / copilot / agents-md wiring |
| `setup/` | seed machinery (setup, capture, contribute) |
| `templates/`, `claude-setup.toml` | personal machine seed data |
| `tests/` | bats (shell) + pytest suites |
| `docs/superpowers/` | design specs and implementation plans |

## Testing

- `bats tests/bats/` — shell behavior: setup steps, adapters, contribute flow, skill scripts, manifest validation.
- `uv tool run pytest tests/pytest -q` — TOML parse/write round-trip.
- `uv tool run pytest tools/second-wind/tests -q` — wind's limit-detection and classification logic.
- CI (GitHub Actions, macOS + Ubuntu): manifest validation, shellcheck, all three suites.

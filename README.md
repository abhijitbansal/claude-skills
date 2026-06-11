# claude-skills

Abhijit's AI-agent skills, plugins, and tools — one repo, usable from Claude Code,
Codex, Copilot CLI, and any AGENTS.md-aware agent.

## Install (Claude Code)

```
/plugin marketplace add abhijitbansal/claude-skills
/plugin install ios-dev@claude-skills          # iOS build/preview/release loop
/plugin install linear-pm@claude-skills        # Linear PM conventions + /linear-* commands
/plugin install second-wind@claude-skills      # usage-limit-aware overnight orchestrator
/plugin install core-workflow@claude-skills    # commit flow, agents, shellcheck hook
```

## Second Wind (CLI)

Set-and-forget orchestrator for long Claude Code runs: detects the 5-hour usage
limit, waits for the reset, resumes every tmux session. Stdlib-only single file.

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
chmod +x ~/.local/bin/wind
wind init && wind up && wind watch
```

Docs: [tools/second-wind/README.md](tools/second-wind/README.md)

## Other AI tools

```bash
adapters/install.sh codex      # ~/.codex/skills
adapters/install.sh copilot    # ~/.copilot/skills
adapters/install.sh agents-md  # managed skills block in AGENTS.md (Hermes etc.)
```

## Layout

| Path | What |
| --- | --- |
| `plugins/` | Claude Code plugins (skills, commands, agents, hooks) |
| `tools/` | standalone CLIs (second-wind) |
| `adapters/` | wire skills into non-Claude tools |
| `setup/`, `templates/`, `claude-setup.toml` | personal machine seed — public users can ignore |
| `docs/superpowers/` | design specs and implementation plans |

## Personal machine bootstrap

```bash
git clone https://github.com/abhijitbansal/claude-skills ~/projects/claude-skills
bash ~/projects/claude-skills/setup/setup.sh
```

Snapshot current machine state back: `bash setup/capture.sh && git diff`.
Contribute from any repo: `claude-skills-contribute --message "..." [--skill <name>] [--plugin <plugin>]`.

## Development

Tests: `bats tests/bats/ && uv tool run pytest tests/pytest tools/second-wind/tests -q`
Design docs: `docs/superpowers/specs/`. License: MIT.

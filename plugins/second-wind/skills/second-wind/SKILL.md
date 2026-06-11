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

Install it with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/install.sh | sh
exec $SHELL
```

This places everything in `~/.wind` and adds `~/.wind/bin` to PATH (with your
consent). On seeded machines `setup.sh` already handles this.

## Commands

| Command | What it does |
| --- | --- |
| `wind init` | interactive wizard: scan dirs, pick repos, set permission presets, write config (`--defaults` for non-interactive starter file) |
| `wind up` | start a tmux session per repo, launch Claude Code, send each repo's initial prompt file |
| `wind watch` | run the watcher loop (keep running; on macOS it self-caffeinates) |
| `wind status` | per-session state + next reset time |
| `wind resume` | manually nudge all sessions with the resume message |
| `wind down` | kill all wind sessions |
| `wind dash` | serve the live localhost dashboard (status, pane tails, resume/send/kill); `--port` to change port, `--no-browser` to skip auto-open |

## Typical setup

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
- `wind dash` kill button kills tmux sessions — apply the same confirmation rule as `wind down`: always confirm with the user before triggering a kill action on their behalf.

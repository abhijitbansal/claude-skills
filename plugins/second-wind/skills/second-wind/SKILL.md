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
| `wind init` | interactive wizard: scan dirs, pick repos, set a global permission preset + per-repo overrides, pick an agent, write config (`--defaults` for non-interactive starter file) |
| `wind prompt <repo>` | create/edit a repo's first-prompt file in `$EDITOR` (convention `~/.wind/prompts/<repo>.md`; wires `prompt_file` into the config); `--editor` to override `$EDITOR` |
| `wind up` | start a tmux session per repo, launch the agent, send each repo's initial prompt, and auto-spawn the watcher (`--no-watch` to skip) |
| `wind watch` | run the watcher loop in the foreground (keep running; on macOS it self-caffeinates); `--detach` re-execs it into a detached `<prefix>-watcher` tmux session |
| `wind status` | per-session state + next reset time |
| `wind resume` | manually nudge all sessions with the resume message |
| `wind down` | kill all wind sessions (and the watcher) |
| `wind dash` | serve the live localhost dashboard (status, full-color pane tails, click-to-expand modal, resume/send/kill); `--port` to change port, `--no-browser` to skip auto-open |

## Typical setup

Overnight run:

```bash
wind init   # interactive wizard picks repos and writes the config
wind up     # starts a session per repo AND the detached watcher
wind dash   # live localhost view of every session
```

`wind up` auto-spawns the watcher in a detached `<prefix>-watcher` tmux session
(one watcher per machine), so no separate `tmux new -d … 'wind watch'` is needed.
Pass `--no-watch` to skip it; `wind down` reaps the watcher with the rest.

Attach to a live session: `tmux attach -t wind-<repo>` (detach: `Ctrl-b d`).

## Config essentials

The config may live at `./second-wind.json` or `~/.wind/config.json`.

- `agent`: top-level default agent (`claude` | `copilot`), overridable per repo. Absent → `claude` → today's behavior.
- `repos[]`: `name`, `path`, optional `agent` override, optional `prompt_file` (sent as first prompt; convention `~/.wind/prompts/<repo>.md`) or inline `prompt` string (wins over `prompt_file`), optional per-repo `claude_args` override.
- `claude_args`: top-level **global permission preset** (e.g. `--permission-mode acceptEdits`); a repo inherits it unless it sets its own `claude_args`.
- `resume_message`: text typed into each paused **claude** session after reset (default `continue`); copilot uses its own preset message.
- `ntfy_url`: optional ntfy.sh topic URL — notifies when the limit hits and when sessions resume.
- `limit_patterns`: extra regexes appended to the resolved agent's built-ins if Claude Code's limit message format changes.

Full reference: `tools/second-wind/README.md` in the claude-skills repo.

## Agents (Claude + Copilot)

`agent` picks a preset. `claude` (default) is watched — limit detection +
auto-resume. `copilot` launches the `copilot` CLI and is **shown in the
dashboard but NOT watched**: never scanned for limits, never auto-resumed (the
human handles its rate limits). Initial prompts and dashboard sends still work,
and a manual `wind resume` nudges it with its own message. A config with no
`agent` key behaves exactly as before.

## Hard rules

- `wind up` runs the watcher in its own detached `<prefix>-watcher` session; only one watcher per machine. If you run `wind watch` by hand, never run it in a managed repo's tmux session — it must survive the sessions it manages.
- `copilot` repos are launched and shown but **never auto-resumed**; don't tell the user the watcher will handle a Copilot session's limits — it won't.
- The config is trusted input (`claude_cmd`/`claude_args`/`limit_patterns`/prompt files run/compile/type verbatim) — never point `wind` at a config the user didn't write.
- `wind down` kills sessions without saving; confirm with the user before running it on their behalf.
- `wind dash` kill button kills tmux sessions — apply the same confirmation rule as `wind down`: always confirm with the user before triggering a kill action on their behalf.

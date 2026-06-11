# Second Wind

Set-and-forget orchestrator for long Claude Code runs across multiple repos.
When Claude's 5-hour usage limit pauses everything, Second Wind notices,
waits for the reset, and resumes every session — including overnight.

- **No dependencies.** `wind.py` is plain Python (stdlib only) plus one HTML file for the dashboard. All it needs is `tmux` and the Claude Code CLI.
- **One clock.** The 5-hour limit is account-level: all sessions pause and
  reset together. The watcher keeps a single reset clock and resumes
  everything in one sweep.
- **tmux-native.** Each repo runs Claude Code in a named tmux session. Attach
  from any terminal (including the VS Code integrated terminal) with
  `tmux attach -t wind-<repo>`; sessions survive editor restarts.

Prefer pictures? See the
[visual explainer](../../docs/second-wind/index.html) — what Second Wind is,
how to use it, and how the watch loop works.

## Install

One command:

```sh
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/install.sh | sh
```

This places everything in `~/.wind` (program, dashboard, config, state),
writes a `wind` shim to `~/.wind/bin`, and offers to add that to your PATH —
it never edits your shell profile without asking. From a clone:
`sh tools/second-wind/install.sh`. Then:

```sh
exec $SHELL
wind init      # interactive wizard: scans for repos, writes config for you
```

Optional — teach Claude Code itself to drive `wind`:

```text
/plugin marketplace add abhijitbansal/claude-skills
/plugin install second-wind@claude-skills
```

Requirements: Python 3.9+, tmux, Claude Code CLI logged in.

## Quick start

```sh
wind init            # interactive wizard: scans dirs, lets you pick repos,
                     # choose permission presets, and writes config for you
                     # (use --defaults to get the old non-interactive starter file)
wind up              # start a tmux session per repo, launch Claude Code,
                     # send each repo's initial prompt file
wind watch           # run the watcher (keep this running; use caffeinate
                     # config on a Mac to prevent sleep)
```

## Dashboard

`wind dash` serves a live dashboard at `http://127.0.0.1:8787` — one card per
session with state, reset countdown, and the last 30 lines of each pane, plus
resume-all / send-message / kill actions. Localhost-only; every action
requires a per-run token embedded in the page, so other websites can't POST
into your sessions. `--port` to change port, `--no-browser` to skip
auto-open.

Then check in whenever you like:

```sh
wind status          # per-session state + next reset time
tmux attach -t wind-myrepo    # watch a session live (detach: Ctrl-b d)
wind resume          # manually nudge all sessions with the resume message
wind down            # kill all wind sessions
```

For an overnight run, start the watcher in its own tmux session too:

```sh
tmux new -d -s wind-watcher 'wind watch'
```

## Config

`wind` looks for `./second-wind.json`, then `~/.wind/config.json`, then
`~/.config/second-wind/config.json` (legacy). State lives in
`~/.wind/state.json` (legacy `~/.local/state/second-wind/state.json` is still
read on upgrade and cleared at both locations).

```json
{
  "session_prefix": "wind",
  "claude_cmd": "claude",
  "claude_args": "",
  "resume_message": "continue",
  "resume_buffer_seconds": 120,
  "poll_interval_seconds": 30,
  "resume_cooldown_seconds": 600,
  "startup_delay_seconds": 8,
  "capture_lines": 120,
  "caffeinate": true,
  "ntfy_url": "",
  "limit_patterns": [],
  "repos": [
    {
      "name": "myrepo",
      "path": "~/code/myrepo",
      "prompt_file": "~/prompts/myrepo.md",
      "claude_args": "--permission-mode acceptEdits"
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `session_prefix` | tmux sessions are named `<prefix>-<repo name>` |
| `claude_cmd` / `claude_args` | command used to launch Claude Code; both can be overridden per repo |
| `resume_message` | text typed into each paused session after the limit resets |
| `resume_buffer_seconds` | extra wait after the parsed reset time before resuming |
| `poll_interval_seconds` | how often the watcher captures panes |
| `resume_cooldown_seconds` | after resuming a session, ignore limit messages still visible in its scrollback for this long |
| `startup_delay_seconds` | wait after launching Claude Code before sending the initial prompt |
| `capture_lines` | how many trailing pane lines to scan |
| `caffeinate` | on macOS, keep the machine awake while `wind watch` runs (`caffeinate -dims`) |
| `ntfy_url` | optional; POST a notification here when the limit hits and when sessions resume (works with [ntfy.sh](https://ntfy.sh) topics) |
| `limit_patterns` | extra regexes tried *before* the built-ins (see below) |
| `repos[].prompt_file` | optional file whose contents are sent as the first prompt by `wind up` |

## How limit detection works

The watcher captures the tail of each pane and scans it against a list of
regexes. Built-in patterns cover the formats Claude Code currently emits:

- `Claude AI usage limit reached|<unix-epoch>` (headless/print mode)
- `5-hour limit reached ∙ resets 3am` (interactive UI)
- `…usage limit… resets at 8pm` / `…try again at 6:15pm`

Clock times like `3am` are interpreted as the next occurrence in local time.
The message format changes between Claude Code versions, so the parser is
config-driven: add regexes to `limit_patterns` with a named group
`(?P<epoch>…)` or `(?P<time>…)` and they take precedence over the built-ins.
If a pattern matches but no time can be parsed, the watcher falls back to
retrying after 1 hour rather than stalling forever.

When a limit is seen, the watcher records one account-level reset clock
(the latest reset time seen across sessions), waits until
`reset + resume_buffer_seconds`, then types `resume_message` into every
paused session.

## Testing without burning usage

`tests/fake_claude.py` mimics the CLI: it echoes input and prints a fake
limit message (reset N seconds out) when you send it a line starting with
`work`. Point `claude_cmd` at it in a scratch config:

```json
{ "claude_cmd": "python3 /path/to/second-wind/tests/fake_claude.py", ... }
```

Unit tests for the parser: `python3 -m unittest discover tests`.

## Notes & caveats

- Second Wind drives the **CLI in tmux**; it cannot control the Claude Code
  VS Code extension panel (no terminal process to script). The hybrid
  workflow: unattended runs in tmux, interactive work in the panel.
- Resuming blindly types `resume_message` into the pane. If a session was
  actually waiting on a permission prompt or a question, "continue" is still
  a reasonable nudge, but review sessions in the morning.
- Permission mode is your call per repo via `claude_args` (e.g.
  `--permission-mode acceptEdits` vs a full allowlist). Second Wind does not
  default to `--dangerously-skip-permissions`.

## Security model

- `second-wind.json` is trusted input. `claude_cmd`, `claude_args`, and
  `limit_patterns` are executed/compiled exactly as written — never point
  `wind` at a config file you did not write yourself.
- Prompt files are typed into Claude Code sessions verbatim, with the same
  trust level as typing them by hand.
- `ntfy_url` must start with `http://` or `https://`. Notifications carry
  only session counts and reset times — never repo content.
- The watcher's state file (`~/.wind/state.json`) is written with `0600`
  permissions.
- The dashboard binds `127.0.0.1` only and gates every action behind a
  per-run CSRF token (generated with `secrets.token_hex(16)` at startup,
  embedded in the served page, required on every POST via `X-Wind-Token`).
  The handler also enforces a Host-header allowlist to block DNS-rebinding
  attacks from other sites on the same machine.
- `/api/status` is intentionally unauthenticated — it is reachable only from
  localhost and cross-origin reads are blocked by the browser's same-origin
  policy (no `Access-Control-Allow-Origin` header is set). The token gates
  the write actions (`/api/send`, `/api/kill`, `/api/resume`).
- `/api/send` types text directly into a session's tmux pane. For sessions
  running with `--permission-mode acceptEdits`, sent text is an instruction
  the agent can act on without a permission prompt. Treat the dashboard
  token with the same care as a terminal session.

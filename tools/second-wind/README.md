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
wind guide           # print the setup walkthrough (start here)
wind init            # interactive wizard: scans dirs, lets you pick repos,
                     # choose a global permission preset + per-repo overrides,
                     # pick an agent, and writes config for you
                     # (use --defaults to get the old non-interactive starter file)
wind prompt myrepo   # optional: author/edit a repo's first prompt in $EDITOR
wind up              # start a tmux session per repo, launch the agent,
                     # send each repo's initial prompt, and auto-spawn
                     # the watcher in a detached tmux session
wind dash            # live localhost view of every session
```

`wind up` starts the watcher for you in a detached `<prefix>-watcher` tmux
session (one watcher per machine; on a Mac it self-caffeinates to prevent
sleep). Pass `--no-watch` to skip it and run `wind watch` yourself. `wind down`
reaps the watcher along with the repo sessions.

## Authoring prompts

`wind prompt <repo>` opens that repo's first-prompt file in your editor, sent
verbatim into the session on the next `wind up`. By convention prompt files
live at `~/.wind/prompts/<repo>.md`; if the repo has neither an inline `prompt`
nor a `prompt_file`, `wind prompt` derives the convention path, seeds it with a
template, opens it, and on a clean close wires `prompt_file` into your config
(written atomically). For one-liners, give a repo an inline `prompt` string in
the config instead — it wins over `prompt_file`.

The editor is `--editor`, else `$EDITOR`, else `vi`/`nano`. `$EDITOR` is parsed
with `shlex`, so `EDITOR="code --wait"` or `"emacsclient -nw"` work; `wind`
never invokes a shell.

## Adding repos later

`wind add <path>` brings a new git repo under management without re-running
`wind init`: it validates the path, appends a `{name, path}` entry (inheriting
the global permission preset), launches its tmux session, and refreshes the
watcher so the new session is auto-resumed. In the dashboard, the **＋ add repo**
button lists repos found under your persisted `scan_roots` that aren't managed
yet; click one to add + launch it live. Both paths write `{name, path}` only —
see Security model.

## Permissions

The wizard asks for a **global permission preset** (stored as top-level
`claude_args`) that applies to every repo, then offers either a per-repo
override **or** a one-choice "apply the global preset + defaults to every
selected repo" fast path (no clicking through each repo). The presets are
`acceptEdits`, `plan`, `default`, `custom`, and `auto` — where **`auto`
(`--permission-mode bypassPermissions`) accepts everything and is the shipped
default** for a brand-new starter config (see Security model).
A repo that inherits the global preset carries no `claude_args` key; only an
explicit override writes one. Per-repo `claude_args` (when the key is present)
wins over the global preset; an explicit `claude_args: ""` is honored as "no
args", distinct from "unset → inherit global".

## Settings & hooks inheritance

`wind up` launches the same `claude` binary in the same `$HOME` via
`tmux new-session` + `send-keys`, with no `--settings`, `CLAUDE_CONFIG_DIR`, or
`HOME` override and no env stripping. So your `~/.claude/settings.json` defaults
(e.g. effort, remote control) and your SessionStart hooks fire exactly as they do
in a normal terminal. `--permission-mode` governs only tool-permission prompting
and does not suppress settings or hooks.

Caveat: settings tuned via **shell environment variables** (not `settings.json`)
can be stale, because a long-running tmux server freezes its environment and
`wind` does not run `tmux update-environment`. Put durable defaults in
`settings.json` rather than shell exports for the most reliable behavior.

## Agents (Claude + GitHub Copilot)

The `agent` key selects a preset — `claude` (the default) or `copilot` —
top-level with an optional per-repo override. A config with no `agent` key
behaves byte-for-byte as before.

- **claude** — watched: limit detection + auto-resume, exactly as today.
- **copilot** — launched with the `copilot` CLI and **shown in the dashboard,
  but the watcher skips it**. A Copilot session is never scanned for limits and
  never auto-resumed; its cards show `running`/`idle`/`not running` but never a
  reset countdown. You handle its rate limits yourself. Initial prompts (from
  `wind up`) and dashboard sends still work, and a manual `wind resume` /
  dashboard "resume all" nudges it with its own resume message.

The launch binary is overridable per repo via `claude_cmd` if a GA Copilot
build renames the command.

## Dashboard

`wind dash` serves a live dashboard at `http://127.0.0.1:8787` — one card per
session with state, reset countdown, and the last 30 lines of each pane, in
**full color**, plus resume-all / send-message / kill actions. Click a card to
**expand it into a full-height modal**: a large colorized scrollback (up to
1000 lines, fetched from the token-gated `/api/pane`) and a roomy send box for
prompts and answers — easier to read and type on a small screen. Escape or the
close button dismisses it. The modal's **⧉ attach** button copies
`tmux attach -t <session>` to your clipboard — paste it into any terminal to
drop into the real session with the full Claude Code TUI (slash-command
autocomplete, history) that the dashboard send box can't offer. Localhost-only; every action — and the modal's
scrollback fetch — requires a per-run token embedded in the page, so other
websites can't reach your sessions. `--port` to change port, `--no-browser` to
skip auto-open.

Copilot sessions appear as cards too (state only, no reset countdown) and can
be sent prompts, but are never auto-resumed by the watcher.

Then check in whenever you like:

```sh
wind status          # per-session state + next reset time
tmux attach -t wind-myrepo    # watch a session live (detach: Ctrl-b d)
wind resume          # manually nudge all sessions with the resume message
wind down            # kill all wind sessions
```

The watcher already runs detached after `wind up`. To run it in the foreground
(e.g. to watch its logs), use `wind watch`; to spawn the detached session
yourself, use `wind watch --detach`.

## Config

`wind` looks for `./second-wind.json`, then `~/.wind/config.json`, then
`~/.config/second-wind/config.json` (legacy). State lives in
`~/.wind/state.json` (legacy `~/.local/state/second-wind/state.json` is still
read on upgrade and cleared at both locations).

```jsonc
{
  "session_prefix": "wind",
  "agent": "claude",                 // default agent: "claude" | "copilot"
  "claude_cmd": "claude",            // launch binary (overridable per repo)
  "claude_args": "",                 // global permission/args preset
  "resume_message": "continue",      // claude resume nudge (copilot uses its preset)
  "resume_buffer_seconds": 120,
  "poll_interval_seconds": 30,
  "resume_cooldown_seconds": 600,
  "startup_delay_seconds": 8,
  "capture_lines": 120,
  "caffeinate": true,
  "ntfy_url": "",
  "limit_patterns": [],              // appended to the RESOLVED agent's patterns
  "repos": [
    {
      "name": "api",
      "path": "~/code/api",
      "agent": "claude",             // optional per-repo override
      "claude_args": "--permission-mode acceptEdits",
      "prompt_file": "~/.wind/prompts/api.md"   // first prompt sent on `wind up`
    },
    {
      "name": "web",
      "path": "~/code/web",
      "prompt": "continue the refactor; run tests"   // inline first prompt (wins over prompt_file)
    },
    {
      "name": "docs",
      "path": "~/code/docs",
      "agent": "copilot"             // launched + shown; NOT auto-resumed
    }
  ]
}
```

New keys vs earlier versions: `agent` (top-level + per-repo) and inline
`prompt` (per-repo). All optional; absent → today's behavior.

| Key | Meaning |
| --- | --- |
| `session_prefix` | tmux sessions are named `<prefix>-<repo name>`; the watcher runs in `<prefix>-watcher` |
| `agent` | default agent — `claude` (watched + auto-resumed) or `copilot` (launched + shown, never auto-resumed); overridable per repo |
| `claude_cmd` / `claude_args` | command + args used to launch the agent; both can be overridden per repo. `claude_args` is the **global permission preset** |
| `resume_message` | text typed into each paused **claude** session after the limit resets (copilot uses its preset's own message) |
| `resume_buffer_seconds` | extra wait after the parsed reset time before resuming |
| `poll_interval_seconds` | how often the watcher captures panes |
| `resume_cooldown_seconds` | after resuming a session, ignore limit messages still visible in its scrollback for this long |
| `startup_delay_seconds` | wait after launching the agent before sending the initial prompt |
| `capture_lines` | how many trailing pane lines to scan |
| `caffeinate` | on macOS, keep the machine awake while `wind watch` runs (`caffeinate -dims`) |
| `ntfy_url` | optional; POST a notification here when the limit hits and when sessions resume (works with [ntfy.sh](https://ntfy.sh) topics) |
| `scan_roots` | directories the `wind init` wizard scanned, persisted so `wind add` and the dashboard's **Add repo** can offer more repos later without re-running `init` |
| `limit_patterns` | extra regexes tried *before* the **resolved agent's** built-ins (see below); appended to the resolved set, not a fixed Claude append |
| `repos[].agent` | optional per-repo override of the top-level `agent` |
| `repos[].claude_args` | optional per-repo permission override; present → wins over the global preset (explicit `""` honored as "no args") |
| `repos[].prompt_file` | optional file whose contents are sent as the first prompt by `wind up` (convention `~/.wind/prompts/<repo>.md`; author with `wind prompt`) |
| `repos[].prompt` | optional inline first-prompt string for one-liners; wins over `prompt_file` |

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

Only repos whose resolved agent is **watched** (`claude`) are scanned and
auto-resumed. `copilot` repos are skipped entirely — never matched against
limit patterns, never auto-resumed — and `limit_patterns` you add are appended
to the *resolved* agent's set, so they don't leak Claude's regexes onto an
unwatched agent.

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
- Permission mode is your call per repo via `claude_args`. As of v2.1 the
  **shipped default is full-auto** (`--permission-mode bypassPermissions`, the
  `auto` preset) — an unattended overnight run accepts everything, not just
  edits. This is functionally the same risk class as
  `--dangerously-skip-permissions`: only ever point `wind` at repos you trust to
  run agent actions without prompts. Pick the `acceptEdits`, `plan`, or
  `default` preset in `wind init` (or set `claude_args` in the config) to dial
  the autonomy back down.

## Security model

- `second-wind.json` is trusted input. `claude_cmd`, `claude_args`,
  `limit_patterns`, and prompt files are executed/compiled/typed exactly as
  written — never point `wind` at a config file you did not write yourself.
- `wind add <path>` and the dashboard's **Add repo** (`POST /api/add`) write a
  new repo entry as **`{name, path}` only** — they never accept `claude_cmd`,
  `claude_args`, `limit_patterns`, or a prompt from the CLI arg or HTTP body, so
  they open no new verbatim-execution surface: an added repo simply inherits the
  top-level global preset. The dashboard endpoint additionally only accepts a
  path that appears in `GET /api/scan` (a repo already under a persisted
  `scan_roots`), so a localhost request can't add an arbitrary filesystem path.
  `/api/scan` is tokenless like `/api/status` (it lists only candidate names +
  paths under `scan_roots`); `/api/add` is token-gated like the other writes.
- Prompt files are typed into agent sessions verbatim, with the same trust
  level as typing them by hand.
- `wind prompt` never invokes a shell. `$EDITOR` is parsed with `shlex.split`
  and exec'd as an argv list (no `shell=True`, no `os.system`), the first token
  is validated with `shutil.which`, and the repo→filename mapping is validated
  as a single path component (names containing `/`, `..`, or path separators
  are rejected) so a repo name can't traverse or inject.
- Config and state writes are **atomic**: each is written to a temp file in the
  same directory, fsynced, then `os.replace`d into place. A crash mid-write — or
  a concurrent watcher/dashboard read — never sees a truncated JSON file. State
  keeps `0600`; config files keep `0644`.
- `ntfy_url` must start with `http://` or `https://`. Notifications carry
  only session counts and reset times — never repo content.
- The dashboard binds `127.0.0.1` only and gates every action behind a
  per-run CSRF token (generated with `secrets.token_hex(16)` at startup,
  embedded in the served page, required via `X-Wind-Token`). The handler also
  enforces a Host-header allowlist to block DNS-rebinding attacks from other
  sites on the same machine.
- `/api/status` is intentionally unauthenticated — it returns only a 30-line
  pane tail, is reachable only from localhost, and cross-origin reads are
  blocked by the browser's same-origin policy (no `Access-Control-Allow-Origin`
  header is set). The token gates the write actions (`/api/send`, `/api/kill`,
  `/api/resume`) **and** the modal's full-scrollback read, `/api/pane`.
- `/api/pane` (the expand modal's source) requires `X-Wind-Token` — unlike the
  tokenless tail, it returns up to 1000 lines of scrollback that can include
  secrets, file contents, and prompts; a missing/bad token returns 401. It
  validates the `session` name, clamps `lines`, and never echoes pane content
  in an error body. The server emits only allowlisted SGR color/style codes
  (truecolor and out-of-palette 256-color are stripped); the client
  integer-parses each code, only ever sets known-literal CSS classes, and puts
  pane text into the DOM via `textContent`/`createTextNode` — never `innerHTML`.
- `/api/send` types text directly into a session's tmux pane. For sessions
  running with `--permission-mode acceptEdits`, sent text is an instruction
  the agent can act on without a permission prompt. Treat the dashboard
  token with the same care as a terminal session.

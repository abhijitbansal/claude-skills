# Second Wind 2.0 — Installer, Wizard, Dashboard — Design

**Date:** 2026-06-11
**Status:** Approved (user approved design in session; build authorized on a feature branch)
**Branch:** `feat/second-wind-2`

## Background

Second Wind v1.1 (post-polish) is a single-file CLI installed by hand-curling
`wind.py` into `~/.local/bin`. Real-world install hit two snags: `~/.local/bin`
not on PATH, and editing `second-wind.json` by hand is the only configuration
path. The status view is terminal-only.

## Goals

1. **One-command install** into a self-contained `~/.wind` tool home, with
   PATH handled (consensually) by the installer.
2. **Interactive setup wizard** — `wind init` discovers cloned repos, offers
   selectable options for every setting, and writes the config JSON itself.
3. **Web dashboard** — `wind dash` serves a beautiful localhost UI with
   auto-updating session status, live pane previews, and actions
   (resume / send message / kill, with confirmation).

## Non-goals

- Third-party dependencies. Everything stays Python stdlib + sh.
- Replacing `wind watch` — the dashboard is a viewer/remote, not the resume
  engine.
- Remote (non-localhost) dashboard access, HTTPS, or multi-user auth.
- Windows support (tmux prerequisite already excludes it).

## Decision: multi-file package, not single-file

The one-file constraint existed to make hand-install trivial. With an
installer owning placement, the package becomes `wind.py` + `dashboard.html`
(+ the `bin/wind` shim the installer writes). `wind.py` stays focused;
the dashboard is real HTML, not a Python string blob.

## 1. `~/.wind` tool home + installer

```
~/.wind/
  bin/wind          # sh shim: exec python3 "$HOME/.wind/wind.py" "$@"
  wind.py           # the program
  dashboard.html    # dashboard template
  config.json       # global config (new canonical location)
  state.json        # watcher state
```

`tools/second-wind/install.sh`:

- Run via `curl -fsSL <raw-url>/install.sh | sh` (works once repo is public)
  **or** directly from a clone — the script detects sibling `wind.py` /
  `dashboard.html` next to itself and copies instead of downloading.
- Creates the layout above, writes the `bin/wind` shim, `chmod +x`.
- PATH: detects the user's shell rc (`~/.zshrc` / `~/.bashrc` /
  `~/.profile` fallback), shows the exact line it wants to append
  (`export PATH="$HOME/.wind/bin:$PATH"`), asks y/N before touching the file.
  `--no-modify-path` skips the prompt. Idempotent: re-running never
  duplicates the PATH line or clobbers an existing `config.json`.
- Ends with a styled summary and next step: `exec $SHELL && wind init`.

### Config / state path migration (zero breakage)

- Config lookup order becomes:
  1. `./second-wind.json` (project-local, unchanged)
  2. `~/.wind/config.json` (new)
  3. `~/.config/second-wind/config.json` (legacy fallback)
- State: canonical `~/.wind/state.json`. On first read, if the legacy
  `~/.local/state/second-wind/state.json` exists and the new one does not,
  read the legacy file once and write the new location thereafter.
- `wind init` writes `~/.wind/config.json` unless a `./second-wind.json`
  already exists in the CWD (then it edits/overwrites that, asking first).

## 2. Interactive wizard (`wind init`)

- TTY → wizard. Not a TTY, or `wind init --defaults` → current behavior
  (write starter JSON, exit). `--force` keeps its meaning.
- Existing config found → menu: "Edit repos / Start over / Cancel".

### Interaction primitives (stdlib only)

- Arrow-key single-select and space-toggle multi-select menus using
  `termios` + `tty` raw mode, rendered with the existing glyph/color kit
  (cyan cursor `❯`, green `◉` selected, dim `○` unselected).
- Every menu has a numbered-prompt fallback used automatically when raw
  mode is unavailable (no termios, dumb terminal, or raw-mode error).
- Primitives live in a clearly-bounded `wizard ui` section of `wind.py`
  with key-event input injected as a callable, so logic is unit-testable
  without a real TTY.

### Wizard flow

1. **Scan root** — prompt for the directory to scan (default `~/projects`;
   accepts comma-separated multiples). Lists git repos found one level deep
   (`<root>/*/.git`). Multi-select which repos wind should manage.
   Manual-path escape hatch for repos outside the scan roots.
2. **Per repo** — permission preset (single-select):
   `acceptEdits` (`--permission-mode acceptEdits`) / `plan`
   (`--permission-mode plan`) / `default` (no args) / `custom` (free-text
   `claude_args`). Then optional prompt file path (or skip).
3. **Globals** — resume message (default `continue`), ntfy topic URL
   (optional; validated with the existing `valid_notify_url`, re-prompt on
   invalid).
4. **Write + summary** — writes config, prints a summary card (repos,
   presets, config path) and the next step: `wind up`.

## 3. Web dashboard (`wind dash`)

- `wind dash [--port PORT]` (default 8787). Stdlib
  `http.server.ThreadingHTTPServer` bound to `127.0.0.1` **only**. Opens
  the browser via `webbrowser.open` after binding. Ctrl-C stops cleanly.
- Template resolution: `~/.wind/dashboard.html`, falling back to the file
  next to `wind.py` (dev mode from a clone).

### Endpoints

| Route | Method | Behavior |
| --- | --- | --- |
| `/` | GET | serve dashboard.html with `{{TOKEN}}` replaced by the per-run token |
| `/api/status` | GET | JSON: `{watcher: {reset_at, resume_at}, sessions: [{name, state, reset_at, reset_human, pane_tail}]}` — reuses `classify` / `detect_limit` / `capture_pane`; `pane_tail` is the last 30 pane lines |
| `/api/resume` | POST | resume all paused sessions now (same as `wind resume`) |
| `/api/send` | POST | `{session, text}` — type text + Enter into one session |
| `/api/kill` | POST | `{session}` — kill one tmux session |

### Security model (dashboard)

- **CSRF protection:** a random 32-hex token (`secrets.token_hex(16)`) is
  generated per server run, embedded in the served page, and required as an
  `X-Wind-Token` header on every POST. Requests without it get 401. Without
  this, any website open in the user's browser could blindly POST to
  `localhost:8787` and type into Claude sessions or kill them.
- Server binds loopback only; no remote exposure.
- `pane_tail` content is LLM output — untrusted. The UI inserts it via
  `textContent` (never `innerHTML`), neutralizing HTML/script injection;
  ANSI escapes are stripped server-side before JSON encoding.
- `Cache-Control: no-store` on all responses; the token never persists.
- Kill action requires an explicit confirmation dialog in the UI.

### UI (`dashboard.html`)

- Self-contained: zero external fetches, system font stack, vanilla JS.
- Dark slate theme, cyan/amber accents — same language as the CLI and the
  explainer page.
- Header: `◢◤ second wind` + watcher banner (active / limit-hit countdown).
- One card per session: state glyph + color, reset countdown, live pane
  tail (mono, scrollable), per-card send box, kill button (confirm),
  global "resume all" button.
- Polls `/api/status` every 3 s; countdown timers tick client-side every
  second between polls. Graceful "server stopped" banner on fetch failure.

## 4. Code organization (`wind.py`)

New sections, same file, each independently testable:

| Section | Contents |
| --- | --- |
| `paths` | WIND_HOME (`~/.wind`), config/state path resolution + migration |
| `wizard ui` | raw-mode key reader, select/multiselect/prompt primitives, numbered fallback |
| `wizard` | repo scan, flow steps, config assembly (pure functions), `cmd_init` wiring |
| `dash` | request handler, JSON builders, token check, `cmd_dash` |

`wind.py` will grow to roughly 1,100–1,200 lines. Accepted: it remains one
cohesive tool with clearly bounded sections; splitting into a package would
complicate the installer story for marginal benefit. Revisit if it passes
~1,500.

## 5. Testing

- **Wizard:** unit tests for repo scanning (tmp dirs with fake `.git`),
  config assembly from answer dicts, menu logic with injected key events
  (down/space/enter sequences), numbered fallback parsing.
- **Dashboard:** start server on port 0 in tests; `http.client` asserts:
  `/` contains token; `/api/status` shape; POST without token → 401; POST
  with token → action dispatched (tmux calls monkeypatched).
- **Paths:** config order, legacy state migration.
- **install.sh:** bats tests (local-clone mode): creates layout, shim
  works, idempotent re-run, `--no-modify-path` honored, never duplicates
  PATH line.
- Existing 27 tests keep passing unchanged.

## 6. Docs ripple

- `tools/second-wind/README.md`: Install section → install.sh one-liner
  (+ clone mode); new Dashboard section; config path order; wizard mention.
- `docs/second-wind/index.html`: "How to use" gains wizard + dashboard;
  install command updated.
- `plugins/second-wind/skills/second-wind/SKILL.md`: command table gains
  `wind dash`; install instructions updated.
- Main `README.md`: second-wind blurb mentions wizard + dashboard.

## Implementation order

1. `paths` section + migration (foundation, keeps tests green).
2. Wizard ui primitives + wizard flow + tests.
3. `install.sh` + bats tests.
4. Dashboard backend (`/api/*`, token) + tests.
5. `dashboard.html` UI.
6. Docs ripple + final review (security review on dash + installer).

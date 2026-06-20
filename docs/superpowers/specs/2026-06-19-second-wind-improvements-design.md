# Second Wind — Watcher, Prompts, Config, Dashboard, Copilot — Design

**Date:** 2026-06-19
**Status:** Approved (user approved design in session; full build authorized on a feature branch)
**Branch:** `feat/second-wind-overhaul`

## Background

Second Wind 2.0 ships `wind` as `~/.wind/wind.py` + `dashboard.html`, with a
`wind init` wizard, a `wind watch` resume engine, and a localhost `wind dash`.
Real use surfaced seven friction points (the user's words, paraphrased):

1. A config file should come out of `wind init` and hold settings like
   permissions — and it should be obvious it does.
2. Why does it ask for a "prompt file"? Is that the first prompt of the session?
3. Where should prompt files live, and how do people create them beforehand?
4. What's the difference between `wind watch` and
   `tmux new -d -s wind-watcher 'wind watch'`? `wind init` doesn't mention the
   second; the docs do. If the detached form is needed, simplify it.
5. Before `wind up`, is there a way to create/update the initial-prompt file?
6. The dashboard should let you pop a session open to add prompts / answer
   questions; on a small screen it's hard to read, and it should be full color.
7. Support GitHub Copilot CLI sessions — **as the last phase**.

Items 1, 2 and 4 are partly answered by code that already exists (the wizard
writes a full config with per-repo permission presets; `prompt_file` *is* the
first prompt; `wind watch` runs in the foreground while the tmux form survives
terminal close). The remaining gaps are real UX/feature work.

This design was hardened by a research + adversarial-critique pass before
writing. That pass changed the plan materially; the resulting requirements are
marked **[critique]** where they exist to fix a flaw the review caught.

## Goals

- One-command overnight flow: `wind up` → `wind dash`, no second tmux command.
- A first-class way to author/store per-repo initial prompts before `wind up`.
- Discoverable, documented config with a global permission preset and per-repo
  overrides.
- A readable, full-color, poppable dashboard session view that also lets you
  type into a session.
- Launch and observe GitHub **Copilot CLI** sessions through `wind` — **without**
  putting Copilot under the auto-resume watcher (the user confirmed Copilot does
  not need the watcher for now).
- Zero migration: every existing `~/.wind/config.json` and `state.json` keeps
  working untouched.

## Non-goals

- Third-party runtime dependencies. Everything stays Python stdlib + sh + one
  static HTML file. No xterm.js, no websocket PTY bridge.
- Auto-resume for Copilot. Copilot sessions are launched and shown; their
  rate limits are handled by the human. The watcher **skips** them.
- Per-session independent reset clocks / multi-agent watcher arbitration. Not
  needed once Copilot is unwatched; the watcher stays Claude-only and keeps its
  single account-level reset clock.
- Remote (non-localhost) dashboard access, HTTPS, multi-user auth, Windows
  support.

## Cross-cutting decisions

### C1. Atomic config/state writes **[critique]**

Today `run_wizard`, `write_starter_config`, and `save_state` each do
`open(path, "w")` + `json.dump` — a non-atomic truncate-then-write. A crash
mid-write, or a `wind prompt`/wizard writing while a watcher/dashboard reads,
can leave truncated JSON that `load_config` rejects with `die()`, bricking every
later `wind` command.

Add one shared helper and route every JSON writer through it:

```python
def atomic_write_json(path, obj, mode=0o600):
    """Write JSON to a temp file in the same dir, fsync, os.replace (atomic on POSIX)."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".wind-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise
```

Callers: `run_wizard` (config, `0o644`), `write_starter_config` (config,
`0o644`), `save_state` (state, `0o600`), and the new `cmd_prompt`. State keeps
its existing `0o600`; config files keep their normal mode.

### C2. Agent presets **[from #7, scoped by "Copilot unwatched"]**

A new optional `agent` field selects a preset bundle. The preset's only
*behavioral* job beyond launch convenience is telling the watcher whether to
manage a repo.

```python
AGENT_PRESETS = {
    "claude": {
        "cmd": "claude",
        "args": "",
        "resume_message": "continue",
        "watch": True,                      # watcher manages limits + auto-resume
        "limit_patterns": DEFAULT_LIMIT_PATTERNS,
    },
    "copilot": {
        "cmd": "copilot",
        "args": "",
        "resume_message": "Please continue where you left off.",
        "watch": False,                     # launch + display only; never auto-resumed
        "limit_patterns": [],
    },
}
```

- `agent` resolves per repo: `repo.get("agent")` → `cfg.get("agent")` →
  `"claude"`. Unknown agent name → `die()` with the valid choices.
- The `claude` preset reproduces today's exact defaults, so a config with no
  `agent` key behaves byte-for-byte as before.
- Resolution **[critique]** uses key-*presence*, not truthiness, so an
  explicitly-empty `claude_args: ""` is honored as "no args" distinctly from
  "unset → fall back to preset":

  | value source (first present wins) | `cmd` | `args` | `resume_message` | `limit_patterns` |
  |---|---|---|---|---|
  | per-repo explicit key | `claude_cmd` | `claude_args` | — (n/a per-repo today) | `limit_patterns` |
  | top-level explicit key | `claude_cmd` | `claude_args` | `resume_message` | `limit_patterns` |
  | agent preset | `cmd` | `args` | `resume_message` | `limit_patterns` |

  "Present" = the key exists in the dict (`"claude_args" in repo`), regardless of
  value. `resume_message` becomes resolvable per repo via the preset so a
  Copilot session gets its own nudge; there is no per-repo `resume_message` key.

  Implement as `resolve_agent(repo, cfg) -> dict` returning the four resolved
  values. **Note [critique]:** because `DEFAULT_CONFIG` already sets top-level
  `claude_cmd`/`claude_args`/`resume_message`, those top-level keys are *always*
  present after `cfg.update`. That is fine and preserves current behavior: the
  preset only fills a gap the top-level config leaves, and Copilot's `cmd` comes
  from the preset because the user doesn't set top-level `claude_cmd: copilot`
  for a mixed config — they set it per repo or rely on `agent`. Resolution
  therefore checks the **repo** dict for presence first, then the agent preset,
  then top-level, for `cmd`/`args` specifically when `agent != "claude"`. The
  exact precedence is pinned by the tests in Phase 5 (one assertion per cell).

### C3. Watcher skips unwatched agents **[critique — replaces mixed-clock refactor]**

The watcher keeps ONE account-level reset clock (correct for Claude, which has a
single account-level 5-hour limit). It must never scan or auto-resume a repo
whose resolved preset has `watch == False`. Concretely, in `cmd_watch`,
`status_payload`, and `cmd_status`, skip limit detection for unwatched repos and
compile limit patterns from the *resolved agent* (not the global append). This
sidesteps three critique-criticals at once:

- A Copilot pane can't false-match Claude's loose `resets at 8pm` regex, because
  it is never scanned.
- No per-session reset-clock refactor is needed.
- `limit_patterns()` no longer needs to unconditionally append
  `DEFAULT_LIMIT_PATTERNS`; the Claude pattern set lives in the preset and the
  user's `limit_patterns` append to the *resolved* set.

### C4. Naming / constants

New named constants (no magic numbers **[critique]**): `PANE_TAIL_LINES = 30`
(exists), `MODAL_LINES = 500` (default for the modal fetch), `MAX_PANE_LINES =
1000` (clamp for `/api/pane`). Watcher tmux session name: `f"{prefix}-watcher"`.

---

## Phase 0 — Safety prerequisites (zero behavior change)

Lands the foundations later phases depend on, with no user-visible change.

1. **`atomic_write_json`** (C1) + reroute `run_wizard`, `write_starter_config`,
   `save_state`.
2. **Wizard test harness** **[critique]**: `run_wizard`, `menu_select`,
   `menu_multiselect`, and `prompt_text` already accept injectable `get_key` /
   `input_fn` / `render` seams. Add a small test helper that drives `run_wizard`
   end-to-end with scripted keypresses and inputs, plus a fake `scan_repos`
   root, so Phases 2/3/5 (which all mutate the wizard) ship with coverage. The
   wizard currently has near-zero automated coverage; this is a prerequisite.

**Verify:** existing `tests/test_wind.py` passes unchanged; a new test proves an
interrupted write (temp file removed before `os.replace`) leaves the prior
config intact; a new wizard-driving test reproduces today's output for a scripted
run.

---

## Phase 1 — Watcher one-command (#4)

### Behavior

- `wind up` starts each repo session, then **auto-spawns the watcher** in a
  detached tmux session named `<prefix>-watcher`, unless `--no-watch` is passed.
  Guarded against double-start by `session_exists`.
- `wind watch --detach` re-execs itself into that same detached tmux session
  instead of running in the foreground. **[critique]** It does **not** use
  `os.fork()`: `caffeinate -w <pid>` would otherwise watch the pre-fork parent
  pid and exit immediately, killing keep-awake. Re-exec-into-tmux means
  `caffeinate` starts inside the surviving process.
- `wind down` kills the watcher session too, then clears state.
- Wizard closing text + README + SKILL.md converge on `wind up` → `wind dash`.
  The raw `tmux new -d -s wind-watcher 'wind watch'` recipe is retired from docs.

### The config-path fix **[critique — critical]**

The detached watcher must be launched with an **absolute** config path. `wind up`
resolves it from the parent process's cwd *before* spawning:

```python
cfg_path = os.path.abspath(cfg["_path"])        # cfg["_path"] may be "./second-wind.json"
watcher_cmd = [sys.executable, os.path.abspath(__file__), "-c", cfg_path, "watch"]
tmux("new-session", "-d", "-s", watcher_name, *_as_tmux_command(watcher_cmd))
```

`find_config` returns `CONFIG_PATHS[0] == "./second-wind.json"` first and
`os.path.expanduser` does **not** absolutize it, so `cfg["_path"]` is often the
literal relative string. A detached tmux session does **not** inherit the user's
cwd, so passing the relative path would make the watcher resolve it against the
wrong dir, fall through to `~/.wind/config.json` (a different or absent config),
and silently watch zero/wrong sessions. Passing an absolute `-c` makes the
watcher's cwd irrelevant.

The watcher records its own session name + resolved config path into
`state.json` on start **[critique]**, so `wind down` can reap the
actually-running watcher even if the derived name later differs (e.g. a prefix
change between runs). `wind up` warns if a `*-watcher` session exists under a
different name. Single-watcher-per-machine is documented.

### Touchpoints

`DEFAULT_CONFIG` (watcher session name derives from `session_prefix`, no new key
needed unless we expose an override — keep it derived); `cmd_up`
(spawn block + `--no-watch`); `cmd_watch` (`--detach` re-exec path; write
watcher identity to state); `cmd_down` (reap watcher); `main` argparse
(`p_up.add_argument("--no-watch")`, `p_watch.add_argument("--detach")`); wizard
end-text; README; SKILL.md.

### Tests

- `wind up` from a temp dir holding a relative `./second-wind.json`: the spawned
  watcher command string contains an **absolute, existing** config path
  (regression for the cwd bug).
- `--no-watch` skips the spawn and logs it.
- Double `wind up` does not double-spawn (guard via `session_exists`).
- `wind down` kills the watcher session and clears state, including when the
  running watcher's recorded name differs from the current derived name.
- `wind watch --detach` builds a tmux re-exec command (not `os.fork`) and
  returns; `caffeinate` (if any) targets the live pid.

---

## Phase 2 — Prompt files (#2/#3/#5)

### Behavior

- **Convention:** prompt files live in `~/.wind/prompts/<repo>.md`.
- **`wind prompt <repo>`:** resolve the repo in config; derive the convention
  path if the repo has neither inline `prompt` nor `prompt_file`; create parent
  dir + seed the file with a template comment if missing; open it in the editor;
  on a clean close, if the repo entry had no `prompt`/`prompt_file`, wire
  `prompt_file` to the convention path and save the config atomically (C1).
- **Inline `prompt`:** a repo may carry a `prompt` string instead of a file, for
  one-liners. `prompt` wins over `prompt_file`.
- **Wizard:** the per-repo prompt step defaults to the convention path and offers
  to open the editor immediately.

### Editor safety **[critique — high]**

```python
editor = args.editor or os.environ.get("EDITOR") or _first_available("vi", "nano")
cmd = shlex.split(editor) + [path]          # supports EDITOR="code --wait", "emacsclient -nw"
subprocess.run(cmd, check=False)            # list form, NO shell, NO os.system
```

- Parse `$EDITOR` with `shlex.split` — many users set `EDITOR="code --wait"` /
  `"subl -w"`; `subprocess.run([editor, path])` would `ENOENT` on the whole
  string.
- Never `os.system`/`shell=True`. The repo-derived filename must be validated as
  a single path component (reject names containing `/`, `..`, or path
  separators) before joining, so a repo basename can't traverse or inject.
- Validate the first editor token with `shutil.which`; fall back `vi` → `nano`.

### `cmd_up` inline-prompt fix **[critique — medium]**

The current send-prompt filter is `[(r, n) for ... if r.get("prompt_file")]`,
which silently drops a repo that has only an inline `prompt`. Change to
`if r.get("prompt") or r.get("prompt_file")`, and in the body prefer inline
`prompt`, else read `prompt_file`; log which source was used.

### Touchpoints

`cmd_prompt` (new) + `_prompt_path(repo_name, cfg)` + `_first_available` helpers;
`argparse` (`p_prompt = sub.add_parser("prompt")`, positional `repo`, optional
`--editor`); `main` handlers dict; `run_wizard` per-repo prompt step;
`cmd_up` prompt block; `build_repo_entry` (accept inline `prompt`).

### Tests

- `wind prompt foo` creates `~/.wind/prompts/foo.md` with the template, opens the
  editor (mocked), and wires `prompt_file` into the saved config.
- `$EDITOR="code --wait"` splits correctly (mock asserts argv `["code","--wait",path]`).
- A repo named `a b` yields a safe path; a repo name containing `/` or `..` is
  rejected.
- Inline-only repo: `cmd_up` sends the inline `prompt`; a repo with both uses
  inline; the filter does not drop inline-only repos.

---

## Phase 3 — Config & permissions (#1)

### Behavior

- The wizard gains a **global permission preset** step before the per-repo loop,
  stored as top-level `claude_args`. The per-repo step becomes "use global / set
  a custom override for this repo"; an override writes a per-repo `claude_args`,
  otherwise the repo inherits and no per-repo key is written.
- Docs gain a complete annotated config block covering the new keys (`agent`,
  inline `prompt`) and the existing ones.

### Precedence **[critique — medium]**

Permission/args precedence is by key-presence (C2): per-repo `claude_args` (if
the key exists) > top-level `claude_args` (if the key exists) > preset `args`.
Because `DEFAULT_CONFIG` always carries top-level `claude_args: ""`, the
practical rule is "per-repo overrides global; global defaults to empty," which
matches today — but the wizard must write a per-repo key *only* on explicit
override, never duplicating the global value.

### Touchpoints

`run_wizard` (global preset step + per-repo "inherit/override" branch);
`build_repo_entry` (omit `claude_args` when inheriting); `cmd_up` (log which
source supplied args); README + SKILL.md config reference.

### Tests (use the Phase 0 wizard harness)

- Global preset chosen, all repos inherit → no per-repo `claude_args` written.
- One repo overrides → only that repo gets `claude_args`.
- `cmd_up` uses per-repo args when present, else global; `claude_args: ""`
  explicit is honored as empty (not treated as unset).

---

## Phase 4 — Dashboard expand modal + full color (#6)

### Behavior

- Click a card (or an "expand" affordance) → a **full-height, responsive modal**
  overlay: large scrollback rendered with **real ANSI colors**, a roomy send box
  for prompts/answers, and resume / kill / close. Escape and a close button
  dismiss it. On small screens the modal is ~95vw/95vh.
- The grid keeps polling the light 30-line `pane_tail` via `/api/status`. Only an
  open modal fetches the larger, colorized capture from the new endpoint, on its
  own cadence. Modal content is an independent snapshot of the card (documented).

### New endpoint: `GET /api/pane` **[critique — token-gated]**

`GET /api/pane?session=<name>&lines=<N>`:

- **Requires `X-Wind-Token`** — unlike tokenless `/api/status`. It returns up to
  `MAX_PANE_LINES` of full scrollback (which can include secrets, file contents,
  prompts); widening the unauthenticated surface from a 30-line tail to 1000
  lines is not acceptable. The dashboard already holds the token, so its fetch
  sends it. Missing/bad token → 401.
- Validate `session` against `valid_session` → 400 on bad/missing; clamp `lines`
  to `[1, MAX_PANE_LINES]`, default `MODAL_LINES`. Never echo pane content in an
  error body.
- Response: `{ "ok": true, "session": name, "content": <sgr-preserving text>,
  "lines_returned": <int> }`.

### Server-side strip: SGR-aware **[critique — high]**

One shared escape-stripping core with a `preserve_sgr` flag, used by both the
card tail (strip everything, as today) and `/api/pane` (keep safe SGR):

- Remove OSC (`ESC ] … BEL|ST`), DCS/APC/PM (`ESC P|_|^ … ST`), cursor-movement
  and other non-SGR CSI, and the 8-bit C1 forms (`0x9b` CSI, `0x9d` OSC) that
  `tmux capture-pane -e` can emit.
- For SGR (`ESC [ … m`), **parse the parameter list** and keep only the
  allowlisted color/style codes; **drop truecolor** `38;2;…`/`48;2;…` (a
  truecolor sequence *is* an SGR ending in `m`, so a naive "keep all `…m`" filter
  passes it through — explicitly drop it) and out-of-palette 256-color indices.
- Incomplete sequences at the capture boundary are left as literal text safely.

### Client renderer: enforce, don't assert **[critique — high, XSS]**

A `parseAnsi(text)` tokenizer turns runs into DOM, reusing the same renderer for
card and modal so there is one tested path:

- **Integer-parse** every SGR sub-code; emit a class **only** from a fixed
  allowlist `{0,1,2, 30–37, 40–47, 90–97, 100–107}` plus a bounded 256-color
  palette `[0,255]`. Unrecognized → ignored (literal text, no attribute).
- Build spans with `classList.add(<literal known string>)` — never
  `className`/`style`/CSS-var-name derived from a token. Text reaches the DOM
  **only** via `createTextNode`/`textContent`; pane content never touches
  `innerHTML`. This preserves the existing card guarantee (dashboard.html:574–575).

### Touchpoints

`dashboard.html` (modal markup + styles + `openModal`, `parseAnsi`, reuse in
`updateCard`); `make_dash_handler` `do_GET` (route `/api/pane`, require token);
`get_pane_extended(cfg, name, lines)` (new) + the shared strip core with
`preserve_sgr`; constants `MODAL_LINES`, `MAX_PANE_LINES`.

### Tests

- `/api/pane` without `X-Wind-Token` → 401; bad/missing `session` → 400;
  `lines=99999` clamps to `MAX_PANE_LINES`; no pane content in error bodies.
- Server strip keeps `ESC[31m` (red) but drops truecolor `ESC[38;2;255;0;0m`,
  256-color out-of-range, OSC, and a DCS string.
- Client tokenizer: `ESC[38;5;999m` and `ESC[<garbage>m` render as literal text
  with **no** injected class/style attribute (XSS regression).
- `parseAnsi("a\x1b[31mred\x1b[0m b")` → a red run between plain runs.

### Manual surface

The modal interaction (open/close/responsive/color/send) is JS and not unit
-tested. Per the repo's branch workflow, an **interactive HTML manual-test
checklist** is generated at branch end, with the ANSI-XSS case tagged as a
regression check.

---

## Phase 5 — Agent presets + Copilot launch/dashboard (#7, last)

Copilot is **launch + display + manual control only**; the watcher skips it (C3).

### Behavior

- `agent` field (`claude` | `copilot`), top-level default + per-repo override
  (C2). Existing configs (no `agent`) → `claude` → identical behavior.
- `wind up` launches the resolved `cmd` (`copilot` for Copilot repos; explicit
  `claude_cmd`/`claude_args` still override). Initial prompt sent the same way.
- `cmd_watch`, `status_payload`, `cmd_status` **skip** repos whose resolved
  preset has `watch == False`, and compile limit patterns from the resolved
  agent's set (no unconditional append of Claude defaults). Copilot cards show
  state (`running`/`idle`/`not running`) but never a reset countdown and are
  never auto-resumed.
- `resume_sessions` resolves each repo's `resume_message` from its preset, so a
  manual `wind resume` / dashboard "resume all" nudges Copilot with its own
  message. **[critique]** This changes `resume_sessions(cfg, names)` →
  `resume_sessions(cfg, repos)`; update all callers (`cmd_resume`, the
  `cmd_watch` resume block, `/api/resume`). `/api/send` and `/api/kill` are
  agent-agnostic and unchanged.
- Wizard: a per-repo (or global-default) agent choice; choosing Copilot prints a
  one-line note that Copilot is launched and shown but **not** auto-resumed.

### Validation gate **[critique — critical for correctness]**

The Copilot facts came from user-reported issues, and GitHub migrated Copilot
billing to usage-based "AI Credits" (June 2026), so message formats may have
shifted. Because Copilot is unwatched, **none of its rate-limit regexes are
needed or shipped** — this removes the entire stale-regex risk from scope. The
only Copilot facts this phase depends on are: the launch command is `copilot`,
and an interactive `copilot` session accepts typed follow-up prompts in its pane
(so `wind up` prompt-send and dashboard send work). Both are confirmed by the
research but **must be verified against a live `copilot` CLI before merge**; the
command name is overridable via `claude_cmd`/preset if GA renames it.

### Touchpoints

`AGENT_PRESETS` + `resolve_agent` (C2); `cmd_up` (resolve `cmd`/`args`);
`cmd_watch`/`status_payload`/`cmd_status` (skip unwatched + per-agent patterns);
`resume_sessions` signature + callers; `run_wizard` (agent step);
`build_repo_entry` (accept `agent`); README + SKILL.md.

### Tests

- `resolve_agent` precedence table: one assertion per cell (C2), including
  explicit-empty-args.
- `agent: copilot` repo is skipped by `cmd_watch`/`status_payload`/`cmd_status`
  (never matched against Claude patterns; never auto-resumed).
- A Copilot pane containing `usage limit … try again at 8pm` does **not** trigger
  a resume (proves the skip).
- `cmd_up` launches `copilot` for a Copilot repo and `claude` for a Claude repo.
- `resume_sessions` sends each repo its preset's `resume_message`.
- Backward compat: a config with no `agent`/`prompt` loads and runs `cmd_up`/
  `cmd_watch` exactly as before; old `state.json` still loads.

---

## Config schema (final, annotated)

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

New keys: `agent` (top-level + per-repo), `prompt` (per-repo inline). All
optional; absent → today's behavior.

## Security model updates

- `/api/pane` requires `X-Wind-Token` (new authenticated GET); `/api/status`
  stays tokenless (30-line tail only). Host-allowlist + per-run CSRF token
  unchanged.
- Dashboard ANSI rendering: server emits only allowlisted SGR; client
  integer-parses + allowlists codes and only ever sets known-literal classes;
  pane text reaches the DOM via `textContent`/`createTextNode`. No `innerHTML` on
  pane content.
- `wind prompt` never invokes a shell; `$EDITOR` is `shlex.split` + list-exec;
  repo→filename mapping is validated as a single path component.
- Config/state writes are atomic (`os.replace`), preventing corruption-on-crash
  and partial reads by a concurrent watcher/dashboard.
- Trust model unchanged: `claude_cmd`/`claude_args`/`limit_patterns`/prompt files
  remain trusted input — never point `wind` at a config you didn't write.

## Testing strategy

- Unit tests (`tests/test_wind.py`, stdlib `unittest`) per phase as listed.
- Wizard-driving tests via injected `get_key`/`input_fn` (Phase 0 harness).
- `bats tests/bats` after any `setup/` touch (docs phase may touch setup docs).
- Backward-compat tests loading a pre-change config + state.
- Branch-end interactive HTML manual-test checklist for the dashboard modal,
  with the ANSI-XSS regression case tagged.

## Docs to update (end of build)

- `tools/second-wind/README.md`: watcher one-command flow; `wind prompt` +
  prompt conventions; global/per-repo permissions; dashboard modal + color;
  `agent`/Copilot (launch+display, not watched); full config table; security
  notes (token-gated `/api/pane`, atomic writes, editor safety).
- `plugins/second-wind/skills/second-wind/SKILL.md`: commands table (`wind
  prompt`, `--no-watch`, `--detach`), typical setup converged on `wind up` →
  `wind dash`, `agent` essentials, Copilot caveat (unwatched), hard rules.
- `docs/second-wind/index.html` visual explainer: reflect the simplified flow
  and Copilot's unwatched role if it describes the watch loop.
- Root `README.md` / `USAGE.md`: only if they reference the retired two-command
  watcher recipe.

## Open items / validation gates

1. **Live `copilot` CLI check (Phase 5 merge gate):** confirm the launch command
   is `copilot` and that an interactive session accepts typed pane prompts.
   Command name overridable if GA differs.
2. **Watcher daemonization on non-tmux paths:** `wind watch --detach` assumes
   tmux is present (already a hard prerequisite); no `os.fork` fallback.
3. **Single-watcher-per-machine** is a documented assumption; `wind down` reaps
   the recorded watcher identity, and `wind up` warns on a foreign `*-watcher`.

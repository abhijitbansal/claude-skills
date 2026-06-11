# Second Wind Polish — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** `tools/second-wind/` docs correction, CLI UX upgrade, security review, visual explainer doc.

## Background

Second Wind (`wind.py`) was merged into this repo from the standalone
`second-wind` repository. Its tool README still carries the old standalone
install instructions, its CLI output is plain unstyled text, and there is no
visual documentation explaining what it is or how it works.

## Goals

1. Correct install/usage docs to reflect that Second Wind lives in this repo.
2. Give the CLI a polished, Claude-Code-quality terminal feel — while staying
   single-file and stdlib-only.
3. Security-review `wind.py`; fix CRITICAL/HIGH findings inline.
4. Ship a visual explainer (HTML) covering what / how-to-use / how-it-works.

## Non-goals

- New subcommands, flag changes, or behavior changes to the orchestration loop.
- Third-party dependencies (rich, click, textual).
- Full-screen curses dashboard.

## 1. Docs corrections

- `tools/second-wind/README.md` Install section: drop
  `git clone https://github.com/abhijitbansal/second-wind.git`. Replace with:
  - **Curl install** (primary): download raw `wind.py` from this repo to
    `~/.local/bin/wind`, matching the main README and SKILL.md.
  - **Repo clone** (alternative): clone `claude-skills`, symlink
    `tools/second-wind/wind.py`.
  - Pointer to `/plugin install second-wind@claude-skills` for the skill that
    teaches Claude Code to drive `wind`.
  - Link to the new visual explainer.
- Verify (no expected changes): main `README.md`, `USAGE.md`,
  `plugins/second-wind/skills/second-wind/SKILL.md`, marketplace.json.

## 2. CLI UX (stdlib-only)

A small UI section inside `wind.py` (~80 lines). No new files, no deps.

### UI kit

- ANSI palette: dim, bold, cyan, yellow, green, red, magenta.
- `style(text, *codes)` helper; colors auto-disabled when stdout is not a TTY,
  `NO_COLOR` is set, or `TERM=dumb`.
- `human_delta(seconds)` → `"2h 14m"`, `"45s"`, `"3d 2h"`.
- Spinner frames (braille set `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`).

### Per-command treatment

- **Banner**: `◢◤ second wind` one-liner (dim version suffix) printed at the
  start of `up` and `watch` only. `status` stays banner-free so it remains
  pipeline-friendly.
- **`status`**: state glyphs — `●` running (green), `◌` waiting-for-reset
  (yellow), `○` idle (dim), `✗` not running (red). Unicode rule under the
  header row. Reset column shows absolute + relative: `3:00am · in 2h 14m`.
- **`watch`**: log lines get colored glyph prefixes (`✓` success, `→` action,
  `!` warning). Between sweeps, a single-line spinner heartbeat
  (`⠋ watching 3 sessions · next reset 3:00am · resuming in 2h 14m`) rewritten
  in place via `\r` — only when stdout is a TTY; when piped, plain timestamped
  lines only (no spinner, no `\r`).
- **`up` / `resume` / `down`**: `✓`/`→` glyph feedback per session.

### Compatibility

- No flag or exit-code changes. Log content (post color-strip) stays
  grep-compatible.
- Existing tests keep passing; new unit tests for `human_delta`, `style`
  no-TTY behavior, and spinner suppression when piped.

## 3. Security review

Run a security review over `wind.py` and any files touched. Known hot spots
to examine explicitly:

- `send_text` types arbitrary prompt-file content into tmux panes
  (prompt-injection surface — document trust model).
- `ntfy_url`: validate scheme is `http://`/`https://` before POSTing.
- Config-driven `claude_cmd`/`claude_args` executed in shell via tmux
  send-keys — config file is trusted input; document, don't sandbox.
- State file in `~/.local/state/second-wind/` — check permissions handling.
- Regexes from config compiled and run against pane output (ReDoS surface).

Disposition: fix CRITICAL/HIGH inline in the same branch; list MEDIUM/LOW in
the review summary for later.

## 4. Visual explainer

`docs/second-wind/index.html` — self-contained HTML page (visual-explainer
skill), committed to the repo and linked from the main README and the tool
README. Sections:

1. **What is Second Wind** — hero summary, the 5-hour-limit problem.
2. **How to use** — install, `init → up → watch` quick start, attach/status.
3. **How it works** — architecture diagram (watcher ↔ tmux sessions ↔ single
   account-level reset clock), watch-loop state machine (running → limit
   detected → waiting → resume sweep → cooldown), limit-detection patterns,
   config reference table.

## 5. Verification

- `uv tool run pytest tools/second-wind/tests -q` green.
- Manual smoke: `wind status` with a scratch config; `wind status | cat`
  shows no ANSI escapes; `NO_COLOR=1 wind status` plain.
- Explainer HTML opens locally, renders self-contained (no CDN fetches).

## Implementation order

1. Docs corrections (small, unblocks everything).
2. CLI UI kit + per-command styling, with tests.
3. Security review + inline fixes.
4. Visual explainer page.

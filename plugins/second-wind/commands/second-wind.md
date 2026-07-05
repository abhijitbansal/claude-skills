---
description: Guide the user through Second Wind setup (init → prompt → up → dash) and optionally run each step for them.
argument-hint: [optional — "setup" to walk setup, or a question about wind]
---

# /second-wind

Help the user set up and run **Second Wind** — the set-and-forget orchestrator
that resumes long Claude Code runs across the 5-hour usage limit.

**Input:** `$ARGUMENTS`

Confirm `wind` is installed first: run `wind --help`. If it is missing, point the
user at `tools/second-wind/install.sh` (or the curl one-liner in the README) and
stop.

Walk these four steps in order. After each, show the exact command, explain what
it does in one line, and — only with the user's go-ahead — run it for them.

1. **`wind init`** — interactive wizard: scans dirs, lets the user pick repos,
   choose a global permission preset (+ per-repo overrides), and pick an agent
   (`claude` or `copilot`). Writes the config.
2. **`wind prompt <repo>`** — optional. Author a repo's first prompt in `$EDITOR`;
   it is sent verbatim on the next `wind up`.
3. **`wind up`** — start a tmux session per repo, launch the agent, send each
   first prompt, and auto-spawn the watcher (resumes every session after the
   limit resets). `--no-watch` skips the watcher.
4. **`wind dash`** — open the live localhost dashboard. Click a card to expand it
   into a modal; the **⧉ attach** button copies `tmux attach -t <session>` so the
   user can jump into the real terminal with full TUI autocomplete.

Then mention the check-in commands: `wind status`, `wind resume`, `wind down`,
and `wind guide` (`--open` for the visual guide at `docs/second-wind/index.html`).

Never run `wind up` or `wind down` without explicit confirmation — they start or
kill real sessions.

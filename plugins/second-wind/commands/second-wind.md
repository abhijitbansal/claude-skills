---
description: Guide the user through Second Wind setup (init → prompt → up → dash) and optionally run each step for them.
argument-hint: [optional — "setup" to walk setup, or a question about wind]
---

# /second-wind

Help the user set up and run **Second Wind** — the set-and-forget orchestrator
that resumes long Claude Code runs across the 5-hour usage limit.

**Input:** `$ARGUMENTS`

Confirm `wind` is installed first: run `wind --help`. If it is missing, give the
user the one-line installer and stop:

```bash
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/install.sh | sh
```

Walk these four steps in order. After each, show the exact command and explain
what it does in one line. Steps 1 and 2 need a real terminal, so the user types
those; you run steps 3 and 4 only with the user's go-ahead.

1. **`wind init`** — the user runs this in their own terminal. It is an
   interactive wizard: scans dirs, lets the user pick repos, choose a global
   permission preset (+ per-repo overrides), and pick an agent (`claude` or
   `copilot`). Writes the config. Do not run it yourself: without a TTY it
   writes the full-bypass starter config without asking.
2. **`wind prompt <repo>`** — optional, and the user runs it in their own
   terminal. It opens a repo's first prompt in `$EDITOR`; the file is sent
   verbatim on the next `wind up`. You cannot drive an editor.
3. **`wind up`** — start a tmux session per repo, launch the agent, send each
   first prompt, and auto-spawn the watcher (resumes every session after the
   limit resets). `--no-watch` skips the watcher.
4. **`wind dash`** — the live localhost dashboard. It blocks, so either run it
   in the background or print the command for the user to run. Click a card to
   expand it into a modal; the **⧉ attach** button copies
   `tmux attach -t <session>` so the user can jump into the real terminal with
   full TUI autocomplete.

Then mention the check-in commands: `wind status`, `wind resume`, `wind down`,
and `wind guide` (prints the setup walkthrough; `--open` opens the visual guide
when it is installed locally).

Never run `wind up` or `wind down` without explicit confirmation — they start or
kill real sessions.

# Second Wind overhaul — manual test guide (PR #2)

Branch: `feat/second-wind-overhaul` · [PR #2](https://github.com/abhijitbansal/claude-skills/pull/2) · 12 commits ahead of `main`

**Covers only the human-driven surface.** 194 unit tests already cover atomic writes,
absolute watcher config-path, `$EDITOR` shlex-split + filename sanitization, inline-prompt
filtering, args precedence, `/api/pane` token/validation/clamp, server SGR strip
(truecolor/256/OSC/DCS dropped), client `parseAnsi` XSS cases, `resolve_agent` precedence,
watcher-skips-Copilot, per-repo resume message, reserved-session collision, `wind down`
reaping the watcher, and backward-compat. The checks below need a **human eye**.

**REG** = regression caught in this branch's review cycle. **GATE** = blocks merge.

## 0 · Setup — no real usage burned
- [ ] Refresh installed dashboard: `sh tools/second-wind/install.sh` (so `~/.wind/dashboard.html` matches this branch)
- [ ] Point a scratch config `claude_cmd` at `tools/second-wind/tests/fake_claude.py`, then `wind up`

## 1 · Watcher one-command (#4)
- [ ] `wind up` auto-starts the watcher — `tmux ls` shows `wind-watcher`
- [ ] `wind up --no-watch` skips it (logged); no `wind-watcher` session
- [ ] `wind down` kills repo sessions AND `wind-watcher`
- [ ] **REG** `wind watch --poll 5 --detach` honors the poll interval in the detached watcher (flag used to be dropped from the threaded argv)

## 2 · Prompt files (#2/#3/#5/#8)
- [ ] `wind prompt <repo>` creates `~/.wind/prompts/<repo>.md`, opens editor, wires `prompt_file` on clean save
- [ ] `EDITOR="code --wait" wind prompt <repo>` launches a multi-word editor correctly (no shell)
- [ ] **REG** `wind prompt <repo-NOT-in-config>` warns and leaves the on-disk config unchanged — no spurious success, no `DEFAULT_CONFIG` keys written into a minimal config

## 3 · Dashboard modal + full color (#6)
- [ ] Click a card → full-height modal (scrollback + send box + resume/kill/close)
- [ ] Close via button AND <kbd>Esc</kbd>
- [ ] Readable on a small/narrow window (fills viewport, nothing clipped)
- [ ] **REG** ANSI colors render in full color in modal and cards (not raw codes / stripped grey) — `escapes=False/True` capture fix
- [ ] Send a prompt/answer from the modal → reaches the session (e.g. answer a permission prompt with `1`)
- [ ] **NEW** Click `⧉ attach` in the modal header → clipboard holds `tmux attach -t wind-<repo>`, button flips to `copied ✓`. Paste in a terminal → full Claude TUI with slash autocomplete + history
- [ ] **REG** Modal resume nudges ONLY the focused session (others keep their countdown); top-of-page "resume all" still resumes everything
- [ ] Kill from the modal works (confirms first)
- [ ] **REG** Switch/kill a session mid-load → modal never paints the stale session's late output
- [ ] **REG** Crafted pane output renders inert: `printf '\033[31m<img src=x onerror=alert(1)>\033[0m done\n'` → literal text, NO alert, NO injected element, no console errors
- [ ] **REG** `curl 'http://127.0.0.1:8787/api/pane?session=wind-<repo>&lines=50'` → HTTP 401 (no token, no pane content)
- [ ] **NEW** `? help` opens the in-dashboard help modal; <kbd>Esc</kbd> closes it; ✕ button closes it; clicking the backdrop closes it

## 4 · Permissions + agent validation (#14/#15)
- [ ] Global preset applies to every repo; per-repo `claude_args` override wins; explicit `"claude_args": ""` honored as "no args" (distinct from unset → inherit)
- [ ] **REG** A bad `agent` name (top-level or per-repo) dies at config load, not on a dashboard request
- [ ] **REG** A repo colliding with reserved `<prefix>-watcher` (e.g. named `watcher`) is rejected at load; a repo like `ci-watcher` is NOT falsely flagged as a foreign watcher

## 5 · Copilot (#7) — launch + display only
- [ ] **GATE** A repo with `"agent": "copilot"` launches the `copilot` CLI on `wind up`
- [ ] **GATE** The running copilot session accepts a typed prompt from the dashboard send box
- [ ] Watcher ignores the Copilot session — card never shows a reset countdown; never auto-resumed

## 6 · Watcher resume correctness (#5/#7)
- [ ] Fake a limit (send `work…` to fake CLI); at reset the watcher resumes EVERY paused session in one sweep
- [ ] **REG** A paused session no longer in the watched set still gets resumed — orphaned paused names fall back to the global `resume_message`, never stranded paused forever

## 7 · Onboarding
- [ ] **NEW** `wind guide` prints all 4 steps (`wind init` / `wind prompt` / `wind up` / `wind dash`) — verify all four keywords appear in the output
- [ ] **NEW** `wind guide --open` opens the visual guide in a browser
- [ ] **NEW** `/second-wind` walks setup in Claude Code — slash command appears and steps through the four commands
- [ ] **NEW** `docs/features.html` — search narrows results; each type chip filters; clicking a card expands its detail; back-link and landing "All features" link resolve

## Known deferred limitations (documented, not bugs to test)
- Manual resume during a pending auto-resume may yield one extra harmless `continue` at reset.
- Two watchers/configs on one machine share one `~/.wind/state.json` (single-watcher-per-machine supported).
- A stale limit message lingering past the resume cooldown could re-pause a session (rare; agent idle >10 min).

## If something fails
Note exact card/command, expected vs actual, and any devtools console error. Restart `wind dash`
after refreshing `~/.wind/dashboard.html`. A **GATE** failure blocks merge. A **REG** failure on an
XSS/token check means a security guarantee is broken — stop and report.

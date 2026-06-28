# Onboarding & Features Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three onboarding/discovery surfaces — a `wind guide` CLI + `/second-wind` slash command, an in-dashboard help modal, and a public interactive `docs/features.html` explorer of the whole repo.

**Architecture:** One canonical 4-step setup walkthrough is authored once (a `GUIDE_TEXT` constant in `wind.py`) and echoed consistently into each surface; a cheap drift-guard test keeps the slash command in step. `features.html` is a standalone, dependency-free page rendered from a hand-authored data array, deployed by the existing `pages.yml` with no workflow change.

**Tech Stack:** Python 3.9+ stdlib (`wind.py`), vanilla HTML/CSS/JS (dashboard + features page), markdown (slash command), `unittest`/`pytest` + `bats` for tests.

## Global Constraints

- **Branch:** all work on `feat/second-wind-overhaul` (PR #2). Do NOT create a new branch.
- **Python:** stdlib only in `wind.py` — no third-party imports (matches the tool's "no dependencies" promise).
- **`wind guide` needs no config:** a brand-new user has no config; dispatch `guide` BEFORE `load_config` (like `init`).
- **Canonical 4 step keywords** (must appear verbatim in both `wind guide` output and the slash command): `wind init`, `wind prompt`, `wind up`, `wind dash`.
- **Inventory counts** (must match the landing stat band): 4 plugins · 13 skills · 11 commands · 2 agents · 2 hooks · 1 CLI.
- **Tests:** `python3 -m pytest tests` (run from `tools/second-wind/`) stays green; `bats tests/bats` (run from repo root) stays green.
- **No new security surface:** `features.html` is static with no user input echoed; the dashboard help modal is static content.

---

## Pre-step: commit the already-complete attach button

The `⧉ attach` button (Piece from the prior task) is implemented and green
(`dashboard.html`, `tools/second-wind/tests/test_wind.py`,
`tools/second-wind/README.md`) but uncommitted. Commit it first so this epic
builds on a clean tree.

- [ ] **Step 1: Verify suite is green**

Run (from `tools/second-wind/`): `python3 -m pytest tests -q`
Expected: `194 passed`.

- [ ] **Step 2: Commit**

```bash
git add tools/second-wind/dashboard.html tools/second-wind/tests/test_wind.py tools/second-wind/README.md
git commit -m "feat(second-wind): copy 'tmux attach' command from dashboard modal"
```

- [ ] **Step 3: Commit the design + plan docs**

```bash
git add docs/superpowers/specs/2026-06-28-onboarding-and-features-showcase-design.md docs/superpowers/plans/2026-06-28-onboarding-and-features-showcase.md
git commit -m "docs(second-wind): spec + plan for onboarding & features showcase"
```

---

## Task 1: `wind guide` CLI subcommand

**Files:**
- Modify: `tools/second-wind/wind.py` (add `GUIDE_TEXT`, `find_guide_html`, `cmd_guide`; wire into `main`)
- Test: `tools/second-wind/tests/test_wind.py` (new `WindGuide` class)

**Interfaces:**
- Produces: `wind.GUIDE_TEXT` (str); `wind.cmd_guide(args)` → int (0 on success), prints `GUIDE_TEXT`, opens the visual guide when `args.open` is truthy; `wind.find_guide_html()` → path str or None.
- Consumes: existing `WIND_HOME` constant, `os`, `webbrowser` (stdlib).

- [ ] **Step 1: Write the failing test**

Add to `tools/second-wind/tests/test_wind.py`, immediately before the
`if __name__ == "__main__":` guard:

```python
class WindGuide(unittest.TestCase):
    """`wind guide` prints the canonical 4-step setup walkthrough."""

    def _capture_guide(self, open_flag=False):
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = wind.cmd_guide(argparse.Namespace(open=open_flag))
        return rc, buf.getvalue()

    def test_guide_prints_four_steps_and_exits_zero(self):
        rc, out = self._capture_guide()
        self.assertEqual(rc, 0)
        for kw in ("wind init", "wind prompt", "wind up", "wind dash"):
            self.assertIn(kw, out, f"guide must name `{kw}`")

    def test_guide_mentions_attach_and_visual_guide(self):
        _, out = self._capture_guide()
        self.assertIn("attach", out)
        self.assertIn("docs/second-wind/index.html", out)
```

Note: `argparse` is already imported at the top of the test module.

- [ ] **Step 2: Run test to verify it fails**

Run (from `tools/second-wind/`): `python3 -m pytest tests/test_wind.py::WindGuide -v`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'cmd_guide'`.

- [ ] **Step 3: Add `GUIDE_TEXT` + `find_guide_html` + `cmd_guide`**

In `tools/second-wind/wind.py`, add this block immediately above
`def cmd_dash(cfg, args):` (currently line 1326):

```python
GUIDE_TEXT = """\
Second Wind — set-and-forget Claude Code across repos.

  1. wind init            Pick repos, a permission preset, and an agent.
                          Writes your config (or --defaults for a starter file).
  2. wind prompt <repo>   Optional: author each repo's first prompt in $EDITOR.
  3. wind up              Launch a tmux session per repo, send the first prompt,
                          and auto-spawn the watcher (it resumes you after the
                          5-hour limit resets — overnight, untouched).
  4. wind dash            Live localhost dashboard. Click a card to expand it;
                          hit the attach button to copy `tmux attach -t <session>`
                          and drop into the real terminal with full TUI autocomplete.

Check in anytime:  wind status · wind resume · wind down
Full visual guide:  docs/second-wind/index.html
"""


def find_guide_html():
    """Locate the Second Wind visual guide for `wind guide --open`."""
    candidates = [
        os.path.expanduser(os.path.join(WIND_HOME, "guide.html")),
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "..", "docs", "second-wind", "index.html"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def cmd_guide(args):
    print(GUIDE_TEXT)
    if getattr(args, "open", False):
        path = find_guide_html()
        if path:
            import webbrowser
            webbrowser.open("file://" + os.path.abspath(path))
        else:
            print("Visual guide not bundled locally — see "
                  "https://abhijitbansal.github.io/claude-skills/second-wind/")
    return 0
```

- [ ] **Step 4: Wire `guide` into `main`**

In `tools/second-wind/wind.py`, in `main()`, add the subparser after the
`p_dash` block (after line 1783):

```python
    p_guide = sub.add_parser("guide",
                             help="print the setup walkthrough")
    p_guide.add_argument("--open", action="store_true",
                         help="also open the visual guide in a browser")
```

Then dispatch it before `load_config` — change:

```python
    if args.command == "init":
        return cmd_init(args)
```

to:

```python
    if args.command == "init":
        return cmd_init(args)
    if args.command == "guide":
        return cmd_guide(args)
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `tools/second-wind/`): `python3 -m pytest tests/test_wind.py::WindGuide -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Smoke-test the CLI**

Run (from `tools/second-wind/`): `python3 wind.py guide`
Expected: prints the walkthrough; exit 0.

- [ ] **Step 7: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): wind guide prints the setup walkthrough"
```

---

## Task 2: `/second-wind` slash command

**Files:**
- Create: `plugins/second-wind/commands/second-wind.md`
- Test: `tests/bats/onboarding-showcase.bats` (new)

**Interfaces:**
- Consumes: the four canonical keywords from Task 1 (`wind init`, `wind prompt`, `wind up`, `wind dash`).
- Produces: a Claude Code slash command file; a bats drift-guard test.

- [ ] **Step 1: Write the failing test**

Create `tests/bats/onboarding-showcase.bats`:

```bash
#!/usr/bin/env bats

# Repo-file content checks for the onboarding & features-showcase surfaces.
ROOT="${BATS_TEST_DIRNAME}/../.."

@test "/second-wind slash command exists and names the four steps" {
  local f="$ROOT/plugins/second-wind/commands/second-wind.md"
  [ -f "$f" ]
  grep -q "wind init"   "$f"
  grep -q "wind prompt" "$f"
  grep -q "wind up"     "$f"
  grep -q "wind dash"   "$f"
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `bats tests/bats/onboarding-showcase.bats`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the slash command**

Create `plugins/second-wind/commands/second-wind.md`:

```markdown
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
and the visual guide at `docs/second-wind/index.html`.

Never run `wind up` or `wind down` without explicit confirmation — they start or
kill real sessions.
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `bats tests/bats/onboarding-showcase.bats`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add plugins/second-wind/commands/second-wind.md tests/bats/onboarding-showcase.bats
git commit -m "feat(second-wind): /second-wind slash command for guided setup"
```

---

## Task 3: In-dashboard help modal

**Files:**
- Modify: `tools/second-wind/dashboard.html` (help button in header, `#help-overlay` markup, CSS, JS wiring)
- Test: `tools/second-wind/tests/test_wind.py` (new `DashboardHelp` class)

**Interfaces:**
- Consumes: existing CSS variables and `.btn-close` style; existing `els` object pattern.
- Produces: a static help overlay; assertable element ids `help-btn`, `help-overlay`, `help-close`.

- [ ] **Step 1: Write the failing test**

Add to `tools/second-wind/tests/test_wind.py`, before the `if __name__` guard
(it can reuse the same file-read approach as `DashboardAttachButton`):

```python
class DashboardHelp(unittest.TestCase):
    """The dashboard has a help button + modal that explains itself."""

    @classmethod
    def setUpClass(cls):
        path = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")
        with open(path) as f:
            cls.html = f.read()

    def test_help_button_and_overlay_present(self):
        self.assertIn('id="help-btn"', self.html)
        self.assertIn('id="help-overlay"', self.html)
        self.assertIn('id="help-close"', self.html)

    def test_help_mentions_key_surfaces(self):
        for needle in ("wind guide", "attach", "watcher", "resume"):
            self.assertIn(needle, self.html,
                          f"help should mention `{needle}`")
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `tools/second-wind/`): `python3 -m pytest tests/test_wind.py::DashboardHelp -v`
Expected: FAIL — `id="help-btn"` not found.

- [ ] **Step 3: Add the help button to the header**

In `tools/second-wind/dashboard.html`, change the `<header>` block (lines
496–499):

```html
  <header>
    <h1 class="wordmark"><span class="glyphs">◢◤</span> second wind</h1>
    <span class="tagline">live session dashboard</span>
  </header>
```

to:

```html
  <header>
    <h1 class="wordmark"><span class="glyphs">◢◤</span> second wind</h1>
    <span class="tagline">live session dashboard</span>
    <button id="help-btn" type="button" class="btn-help"
      title="Dashboard guide">? help</button>
  </header>
```

- [ ] **Step 4: Add the help overlay markup**

In `tools/second-wind/dashboard.html`, immediately after the closing `</div>`
of `#modal-overlay` (the line `</div>` that closes the modal overlay, currently
line 521), add:

```html
<div id="help-overlay" hidden>
  <div id="help-card" role="dialog" aria-modal="true" aria-label="dashboard help">
    <div id="help-head">
      <span class="help-title">Dashboard guide</span>
      <button id="help-close" type="button" class="btn-close" aria-label="close">✕</button>
    </div>
    <div id="help-body">
      <h3>Session states</h3>
      <ul>
        <li><b>running</b> — the agent is active.</li>
        <li><b>idle</b> — launched, waiting for input.</li>
        <li><b>paused</b> — hit the 5-hour limit; the watcher auto-resumes after reset.</li>
        <li><b>reset countdown</b> — time until the watcher resumes.</li>
      </ul>
      <h3>Actions</h3>
      <ul>
        <li><b>↻ resume</b> — nudge this session (or all) with the resume message.</li>
        <li><b>⧉ attach</b> — copy <code>tmux attach -t &lt;session&gt;</code>; paste in a terminal for the full TUI (slash autocomplete, history).</li>
        <li><b>kill</b> — end the tmux session (confirms first).</li>
        <li><b>send</b> — type text or answers straight into the pane.</li>
      </ul>
      <h3>The watcher</h3>
      <p>Detects the usage limit, waits for the reset, and resumes every watched
        (Claude) session in one sweep. Copilot sessions are shown but never
        auto-resumed.</p>
      <h3>First time?</h3>
      <p>Run <code>wind guide</code> in your terminal for the full setup walkthrough.</p>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Add CSS**

In `tools/second-wind/dashboard.html`, add just before `</style>` (line 488):

```css
  .btn-help {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 13px;
    padding: 5px 10px;
    margin-left: 12px;
    cursor: pointer;
  }
  .btn-help:hover { color: var(--cyan); border-color: var(--cyan-dim); }
  #help-overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 12, .72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5vh 5vw;
    z-index: 60;
  }
  #help-overlay[hidden] { display: none; }
  #help-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    max-width: 640px;
    width: 100%;
    max-height: 86vh;
    overflow-y: auto;
  }
  #help-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-soft);
  }
  #help-head .help-title { font-weight: 600; flex: 1 1 auto; }
  #help-body { padding: 8px 20px 20px; }
  #help-body h3 { color: var(--cyan-soft); font-size: 14px; margin: 16px 0 6px; }
  #help-body ul { margin: 0; padding-left: 18px; }
  #help-body li, #help-body p { color: var(--text-dim); margin: 4px 0; }
  #help-body code {
    background: var(--bg-pre);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: .05em .35em;
    font-family: var(--mono);
    font-size: .85em;
  }
```

- [ ] **Step 6: Wire the JS**

In `tools/second-wind/dashboard.html`, add to the `els` object (after the
`modalClose:` line, currently line 558):

```javascript
  helpBtn: document.getElementById("help-btn"),
  helpOverlay: document.getElementById("help-overlay"),
  helpClose: document.getElementById("help-close"),
```

Then add the handlers immediately after the existing modal Escape handler (the
`document.addEventListener("keydown", ...)` block that closes the modal):

```javascript
function openHelp() { els.helpOverlay.hidden = false; }
function closeHelp() { els.helpOverlay.hidden = true; }
els.helpBtn.addEventListener("click", openHelp);
els.helpClose.addEventListener("click", closeHelp);
els.helpOverlay.addEventListener("click", (ev) => {
  if (ev.target === els.helpOverlay) closeHelp();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !els.helpOverlay.hidden) closeHelp();
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run (from `tools/second-wind/`): `python3 -m pytest tests/test_wind.py::DashboardHelp -v`
Expected: PASS (2 tests).

- [ ] **Step 8: Refresh the installed dashboard + manual check**

```bash
cp tools/second-wind/dashboard.html "$HOME/.wind/dashboard.html" 2>/dev/null || true
```
Then in a `wind dash` window: click **? help** → modal opens; **Esc** and **✕**
both close it. (Manual; record in the test guide.)

- [ ] **Step 9: Commit**

```bash
git add tools/second-wind/dashboard.html tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): in-dashboard help modal"
```

---

## Task 4: `docs/features.html` public explorer + landing link

**Files:**
- Create: `docs/features.html`
- Modify: `site/index.html` (add a "Browse all features" link in the nav)
- Test: `tests/bats/onboarding-showcase.bats` (extend)

**Interfaces:**
- Consumes: nothing at runtime (standalone page).
- Produces: a deployed `/features.html`; a landing link rewritten by `pages.yml`'s existing sed.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bats/onboarding-showcase.bats`:

```bash
@test "features.html lists every plugin and the filter chips" {
  local f="$ROOT/docs/features.html"
  [ -f "$f" ]
  for name in second-wind core-workflow ios-dev linear-pm; do
    grep -q "$name" "$f"
  done
  grep -q 'data-filter="Plugin"' "$f"
  grep -q 'data-filter="Skill"' "$f"
  grep -q 'data-filter="Command"' "$f"
  grep -q 'data-filter="Agent"' "$f"
  grep -q 'data-filter="CLI"' "$f"
}

@test "landing links to the features explorer" {
  grep -q 'docs/features.html' "$ROOT/site/index.html"
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from repo root): `bats tests/bats/onboarding-showcase.bats`
Expected: FAIL — `docs/features.html` does not exist; landing link missing.

- [ ] **Step 3: Create `docs/features.html`**

Create `docs/features.html` with this exact content. The `FEATURES` array IS
the complete inventory (29 items) — do not abbreviate it.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>claude-skills — every feature</title>
<!-- Inventory source of truth: docs/superpowers/specs/2026-06-28-onboarding-and-features-showcase-design.md -->
<style>
  :root {
    --bg: #0a0e14; --bg-card: #151b26; --bg-raised: #11161f; --border: #232c3b;
    --text: #d7dee9; --dim: #8b97a8; --faint: #5c6878; --cyan: #22d3ee;
    --cyan-dim: #2a8f9a; --amber: #f59e0b; --green: #34d399;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); }
  a { color: var(--cyan); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 80px; }
  header.top { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  header.top h1 { font-size: 24px; margin: 0; }
  header.top .back { margin-left: auto; font-size: 13px; }
  .lead { color: var(--dim); margin: 8px 0 18px; }
  .stat-row { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; font-size: 13px; color: var(--dim); }
  .stat-row b { color: var(--text); }
  .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; align-items: center; }
  #search {
    flex: 1 1 220px; background: var(--bg-raised); border: 1px solid var(--border);
    border-radius: 9px; color: var(--text); padding: 9px 12px; font: inherit;
  }
  .chip {
    background: var(--bg-raised); border: 1px solid var(--border); color: var(--dim);
    border-radius: 999px; padding: 6px 13px; font-size: 13px; cursor: pointer;
  }
  .chip.active { color: var(--bg); background: var(--cyan); border-color: var(--cyan); }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
    padding: 15px 16px; cursor: pointer;
  }
  .card:hover { border-color: var(--cyan-dim); }
  .card .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .card .title { font-weight: 600; }
  .card .badges { margin-left: auto; display: flex; gap: 6px; }
  .badge {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px;
    border-radius: 5px; padding: 2px 7px; border: 1px solid var(--border); color: var(--dim);
  }
  .badge.type { color: var(--cyan); border-color: var(--cyan-dim); }
  .card .summary { color: var(--dim); font-size: 13.5px; }
  .card .detail { color: var(--faint); font-size: 13px; margin-top: 8px; display: none; }
  .card.open .detail { display: block; }
  #empty { color: var(--faint); padding: 30px 0; display: none; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>Every feature</h1>
    <a class="back" href="../site/index.html">← back to claude-skills</a>
  </header>
  <p class="lead">Browse everything in the repo — plugins, skills, slash commands, agents, hooks, and the Second Wind CLI. Search or filter by type.</p>
  <div class="stat-row">
    <span><b>4</b> plugins</span><span><b>13</b> skills</span><span><b>11</b> commands</span>
    <span><b>2</b> agents</span><span><b>2</b> hooks</span><span><b>1</b> CLI</span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Search features…" aria-label="search features">
    <button class="chip active" data-filter="All">All</button>
    <button class="chip" data-filter="Plugin">Plugins</button>
    <button class="chip" data-filter="Skill">Skills</button>
    <button class="chip" data-filter="Command">Commands</button>
    <button class="chip" data-filter="Agent">Agents</button>
    <button class="chip" data-filter="Hook">Hooks</button>
    <button class="chip" data-filter="CLI">CLI</button>
  </div>
  <div id="grid"></div>
  <p id="empty">No features match.</p>
</div>

<script>
const FEATURES = [
  { title: "wind", plugin: "second-wind", type: "CLI", summary: "Set-and-forget orchestrator: detects the 5-hour limit, waits for reset, resumes every tmux session.", detail: "tools/second-wind/wind.py — stdlib-only Python CLI. Run `wind guide` to get started." },
  { title: "second-wind", plugin: "second-wind", type: "Skill", summary: "Teaches Claude Code to drive the wind CLI.", detail: "Trigger: ask Claude to set up or run Second Wind." },
  { title: "commit", plugin: "core-workflow", type: "Skill", summary: "Conventional-commit message from staged changes.", detail: "Trigger: \"write a commit\", \"/commit\"." },
  { title: "contribute", plugin: "core-workflow", type: "Skill", summary: "Contribute a skill back to the marketplace.", detail: "Packages a skill and opens a contribution branch." },
  { title: "/contribute-skill", plugin: "core-workflow", type: "Command", summary: "Package and submit a new skill.", detail: "plugins/core-workflow/commands/contribute-skill.md" },
  { title: "/team", plugin: "core-workflow", type: "Command", summary: "Evaluate whether a task warrants an agent team; propose a composition.", detail: "Applies a four-part team-fit heuristic before spawning." },
  { title: "image-parser", plugin: "core-workflow", type: "Agent", summary: "Vision agent: OCR, screenshot analysis, image comparison.", detail: "Cheaper vision pass than the main loop." },
  { title: "web-researcher", plugin: "core-workflow", type: "Agent", summary: "Web + library-doc research with cited synthesis.", detail: "Prefers Context7 for library docs; falls back to web search." },
  { title: "shellcheck-on-edit", plugin: "core-workflow", type: "Hook", summary: "Runs shellcheck on shell files after edits.", detail: "PostToolUse hook." },
  { title: "/fix", plugin: "ios-dev", type: "Command", summary: "Diagnose and fix an iOS build failure.", detail: "plugins/ios-dev/commands/fix.md" },
  { title: "/ios-init", plugin: "ios-dev", type: "Command", summary: "Scaffold .claude/app.yml for an app repo.", detail: "Required before the other ios-dev features." },
  { title: "/preview", plugin: "ios-dev", type: "Command", summary: "Build, run in the simulator, deliver a screenshot.", detail: "plugins/ios-dev/commands/preview.md" },
  { title: "ios-build", plugin: "ios-dev", type: "Skill", summary: "Simulator build + run loop.", detail: "Core of the iOS build-and-preview workflow." },
  { title: "app-preview", plugin: "ios-dev", type: "Skill", summary: "Preview a SwiftUI screen and deliver a screenshot.", detail: "Paced to capture a clean frame." },
  { title: "release", plugin: "ios-dev", type: "Skill", summary: "TestFlight / App Store release automation.", detail: "Handles signing, upload, and submission steps." },
  { title: "biometric-applock", plugin: "ios-dev", type: "Skill", summary: "SwiftUI biometric app-lock with bypass-pitfall guards.", detail: "Covers four common Face ID/Touch ID bypass mistakes." },
  { title: "demo-recording", plugin: "ios-dev", type: "Skill", summary: "Record demo videos/GIFs via paced XCUITests.", detail: "Deterministic frames for shareable clips." },
  { title: "alternate-app-icons", plugin: "ios-dev", type: "Skill", summary: "Alternate app icons in an XcodeGen project.", detail: "Wires actool + Info.plist for icon switching." },
  { title: "swift6-mainactor-migration", plugin: "ios-dev", type: "Skill", summary: "Migrate to Swift 6 @MainActor concurrency.", detail: "Resolves Sendable / data-race diagnostics." },
  { title: "xcode-cloud-validate", plugin: "ios-dev", type: "Skill", summary: "Validate an Xcode Cloud workflow config.", detail: "Catches misconfig before a cloud build." },
  { title: "xcodegen-test-targets", plugin: "ios-dev", type: "Skill", summary: "Add or repair XcodeGen test targets.", detail: "Keeps project.yml test targets correct." },
  { title: "app-build-reminder", plugin: "ios-dev", type: "Hook", summary: "Reminds you to build after iOS source edits.", detail: "PostToolUse hook." },
  { title: "linear-pm", plugin: "linear-pm", type: "Skill", summary: "Linear conventions: templates, status taxonomy, agent-ready workflow.", detail: "Shared backbone for the linear-* commands." },
  { title: "/linear-block", plugin: "linear-pm", type: "Command", summary: "Mark an issue blocked with a reason.", detail: "plugins/linear-pm/commands/linear-block.md" },
  { title: "/linear-init", plugin: "linear-pm", type: "Command", summary: "Configure the Linear project.", detail: "One-time setup for the linear-pm workflow." },
  { title: "/linear-new", plugin: "linear-pm", type: "Command", summary: "File an issue with the standard template.", detail: "Why / What / Acceptance criteria / Notes." },
  { title: "/linear-pick", plugin: "linear-pm", type: "Command", summary: "Autonomously pick up the next agent-ready issue.", detail: "Drives the agent-ready workflow." },
  { title: "/linear-status", plugin: "linear-pm", type: "Command", summary: "Move an issue across the status taxonomy.", detail: "plugins/linear-pm/commands/linear-status.md" },
  { title: "/linear-sync", plugin: "linear-pm", type: "Command", summary: "Sync issue state.", detail: "plugins/linear-pm/commands/linear-sync.md" },
];

const PLUGIN_TYPES = new Set(["Skill", "Command", "Agent", "Hook", "CLI"]);
const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const search = document.getElementById("search");
let activeFilter = "All";
let query = "";

function matches(f) {
  if (activeFilter === "Plugin") {
    // "Plugins" chip shows everything that ships inside a plugin.
    if (!PLUGIN_TYPES.has(f.type)) return false;
  } else if (activeFilter !== "All" && f.type !== activeFilter) {
    return false;
  }
  if (query) {
    const hay = (f.title + " " + f.plugin + " " + f.summary).toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function render() {
  grid.textContent = "";
  let shown = 0;
  for (const f of FEATURES) {
    if (!matches(f)) continue;
    shown++;
    const card = document.createElement("div");
    card.className = "card";
    const head = document.createElement("div");
    head.className = "head";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = f.title;
    const badges = document.createElement("div");
    badges.className = "badges";
    const bPlugin = document.createElement("span");
    bPlugin.className = "badge";
    bPlugin.textContent = f.plugin;
    const bType = document.createElement("span");
    bType.className = "badge type";
    bType.textContent = f.type;
    badges.appendChild(bPlugin);
    badges.appendChild(bType);
    head.appendChild(title);
    head.appendChild(badges);
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = f.summary;
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = f.detail;
    card.appendChild(head);
    card.appendChild(summary);
    card.appendChild(detail);
    card.addEventListener("click", () => card.classList.toggle("open"));
    grid.appendChild(card);
  }
  empty.style.display = shown ? "none" : "block";
}

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    render();
  });
}
search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
render();
</script>
</body>
</html>
```

- [ ] **Step 4: Add the landing link**

In `site/index.html`, in the nav `.nav-links` block (lines 240–247), add a link
before the GitHub CTA so it becomes:

```html
    <div class="nav-links">
      <a href="#problems">Why</a>
      <a href="#plugins">Plugins</a>
      <a href="#install">Install</a>
      <a href="#second-wind">Second Wind</a>
      <a href="#docs">Docs</a>
      <a href="../docs/features.html">All features</a>
      <a class="nav-cta" href="https://github.com/abhijitbansal/claude-skills">GitHub ↗</a>
    </div>
```

(`pages.yml` rewrites `../docs/features.html` → `features.html` on deploy via the
existing `sed 's#\.\./docs/##g'`.)

- [ ] **Step 5: Run tests to verify they pass**

Run (from repo root): `bats tests/bats/onboarding-showcase.bats`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Manual browser check**

Open `docs/features.html` directly in a browser: 29 cards render; typing in
search narrows them; each chip filters by type; clicking a card expands its
detail; "← back" and the landing's "All features" link resolve locally.

- [ ] **Step 7: Commit**

```bash
git add docs/features.html site/index.html tests/bats/onboarding-showcase.bats
git commit -m "feat(site): interactive features explorer + landing link"
```

---

## Task 5: Full regression + docs sync

**Files:**
- Modify: `tools/second-wind/README.md` (mention `wind guide`)
- Modify: `.scratch/second-wind-overhaul-test-checklist.{html,md}` (add manual rows)

- [ ] **Step 1: Run the entire suite**

Run (from `tools/second-wind/`): `python3 -m pytest tests -q`
Expected: all pass (≥ 198: 194 + WindGuide 2 + DashboardHelp 2).
Run (from repo root): `bats tests/bats`
Expected: all pass.

- [ ] **Step 2: Note `wind guide` in the README quick start**

In `tools/second-wind/README.md`, add a line to the Quick start block so the
first command shown is discoverable:

```sh
wind guide           # print the setup walkthrough (start here)
```

- [ ] **Step 3: Add manual-test rows to the test guide**

In both `.scratch/second-wind-overhaul-test-checklist.md` and `.html`, add under
the dashboard section: a row for the **? help** modal (open / Esc / ✕), and a new
section for **Onboarding** with: `wind guide` prints 4 steps; `wind guide --open`
opens the visual guide; `/second-wind` walks setup in Claude Code; and
`docs/features.html` search/filter/expand works in a browser.

- [ ] **Step 4: Commit**

```bash
git add tools/second-wind/README.md .scratch/second-wind-overhaul-test-checklist.md .scratch/second-wind-overhaul-test-checklist.html
git commit -m "docs(second-wind): document wind guide + onboarding test rows"
```

---

## Self-review notes

- **Spec coverage:** Goal 1 (setup command, both surfaces) → Tasks 1 + 2. Goal 2
  (in-dashboard help) → Task 3. Goal 3 (features.html) → Task 4. Deploy/link →
  Task 4 Step 4. Docs/test-guide sync → Task 5.
- **Counts:** `FEATURES` array = 29 items = 13 skills + 11 commands + 2 agents +
  2 hooks + 1 CLI; the 4 plugins appear as `plugin` badges. Matches the stat band.
- **Drift guard:** Task 2's bats test pins the four keywords shared with Task 1's
  `GUIDE_TEXT`.
- **No new CI:** `pages.yml` already `cp docs/*.html` and rewrites `../docs/`
  links — verified against the workflow.

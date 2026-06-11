# Second Wind Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix second-wind's stale install docs, give the CLI a Claude-Code-quality terminal feel (stdlib-only), harden it per security review, and ship a visual explainer page.

**Architecture:** All CLI work happens inside the single file `tools/second-wind/wind.py` (a new `ui` section: ANSI palette, `style()`, `human_delta()`, spinner heartbeat). Docs changes touch `tools/second-wind/README.md` and the main `README.md`. The explainer is one self-contained HTML file at `docs/second-wind/index.html`.

**Tech Stack:** Python 3.9+ stdlib only, unittest (run via pytest), tmux, hand-written HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-06-10-second-wind-polish-design.md`

**Test command (all tasks):** `uv tool run pytest tools/second-wind/tests -q` (fallback: `python3 -m unittest discover tools/second-wind/tests`)

---

### Task 1: Rewrite tool README install section + security model

**Files:**
- Modify: `tools/second-wind/README.md:16-24` (Install section), end of file (Security model)

- [ ] **Step 1: Replace the Install section**

In `tools/second-wind/README.md`, replace the entire `## Install` section (the
`git clone https://github.com/abhijitbansal/second-wind.git` block plus the
requirements line) with:

```markdown
## Install

Second Wind lives in the
[claude-skills](https://github.com/abhijitbansal/claude-skills) repo — there
is no separate repository to clone.

One-liner (just the CLI):

```sh
mkdir -p ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
chmod +x ~/.local/bin/wind
```

From a repo clone (stays current with `git pull`):

```sh
git clone https://github.com/abhijitbansal/claude-skills.git
ln -s "$PWD/claude-skills/tools/second-wind/wind.py" ~/.local/bin/wind
```

Optional — teach Claude Code itself to drive `wind`:

```text
/plugin marketplace add abhijitbansal/claude-skills
/plugin install second-wind@claude-skills
```

Requirements: Python 3.9+, tmux, Claude Code CLI logged in.
```

- [ ] **Step 2: Add explainer link under the intro paragraph**

After the three intro bullets (the `tmux-native` bullet, line ~14), add:

```markdown
Prefer pictures? See the
[visual explainer](../../docs/second-wind/index.html) — what Second Wind is,
how to use it, and how the watch loop works.
```

(The file is created in Task 6; a briefly dangling relative link inside the
same branch is fine.)

- [ ] **Step 3: Append a Security model section at the end of the file**

```markdown
## Security model

- `second-wind.json` is trusted input. `claude_cmd`, `claude_args`, and
  `limit_patterns` are executed/compiled exactly as written — never point
  `wind` at a config file you did not write yourself.
- Prompt files are typed into Claude Code sessions verbatim, with the same
  trust level as typing them by hand.
- `ntfy_url` must start with `http://` or `https://`. Notifications carry
  only session counts and reset times — never repo content.
- The watcher's state file (`~/.local/state/second-wind/state.json`) is
  written with `0600` permissions.
```

- [ ] **Step 4: Verify no other stale references remain**

Run: `grep -rn "second-wind.git" /Users/abhijitbansal/projects/claude-skills --include="*.md"`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/README.md
git commit -m "docs(second-wind): install from claude-skills repo, add security model"
```

---

### Task 2: UI kit — `style`, `human_delta`, color gating

**Files:**
- Modify: `tools/second-wind/wind.py` (new `ui` section after the `log`/`die` helpers, ~line 80)
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

Append to `tools/second-wind/tests/test_wind.py`:

```python
class HumanDelta(unittest.TestCase):
    def test_seconds(self):
        self.assertEqual(wind.human_delta(45), "45s")

    def test_minutes(self):
        self.assertEqual(wind.human_delta(150), "2m")

    def test_hours_minutes(self):
        self.assertEqual(wind.human_delta(2 * 3600 + 14 * 60), "2h 14m")

    def test_days_hours(self):
        self.assertEqual(wind.human_delta(3 * 86400 + 2 * 3600), "3d 2h")

    def test_negative_clamps_to_zero(self):
        self.assertEqual(wind.human_delta(-5), "0s")


class _FakeTty:
    def isatty(self):
        return True


class Style(unittest.TestCase):
    def test_plain_when_not_a_tty(self):
        # unit-test stdout is not a tty, so default stream gives plain text
        self.assertEqual(wind.style("hi", "red"), "hi")

    def test_colors_on_a_tty(self):
        out = wind.style("hi", "red", stream=_FakeTty())
        self.assertIn("\033[31m", out)
        self.assertTrue(out.endswith("\033[0m"))

    def test_no_color_env_wins_over_tty(self):
        os.environ["NO_COLOR"] = "1"
        try:
            self.assertEqual(wind.style("hi", "red", stream=_FakeTty()), "hi")
        finally:
            del os.environ["NO_COLOR"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'human_delta'`

- [ ] **Step 3: Add the ui section to wind.py**

Insert after the `die()` function (before the `config` section comment):

```python
# -------------------------------------------------------------------- ui ----

ANSI_RESET = "\033[0m"
ANSI_CODES = {
    "dim": "\033[2m",
    "bold": "\033[1m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "magenta": "\033[35m",
    "cyan": "\033[36m",
}
SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPINNER_TICK_SECONDS = 0.25
VERSION = "1.1.0"


def use_color(stream=None):
    """Color only on a real terminal, honoring NO_COLOR and TERM=dumb."""
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    stream = stream or sys.stdout
    return hasattr(stream, "isatty") and stream.isatty()


def style(text, *names, stream=None):
    if not use_color(stream):
        return text
    prefix = "".join(ANSI_CODES[n] for n in names)
    return f"{prefix}{text}{ANSI_RESET}"


def human_delta(seconds):
    """65 -> '1m', 8040 -> '2h 14m', 266400 -> '3d 2h'."""
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def banner():
    print()
    print(f"  {style('◢◤', 'cyan')} {style('second wind', 'bold')} "
          f"{style('v' + VERSION + ' · usage-limit auto-resume', 'dim')}")
    print()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: PASS (all existing + new)

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): stdlib ui kit — style(), human_delta(), banner"
```

---

### Task 3: Harden `detect_limit` against out-of-range epochs

**Files:**
- Modify: `tools/second-wind/wind.py` — `detect_limit()` (~line 207)
- Test: `tools/second-wind/tests/test_wind.py`

Pane output is semi-untrusted (Claude's own output is scanned). A matched
12-digit epoch like `999999999999` maps to year 33658 and makes
`datetime.fromtimestamp` raise, crashing the watcher loop.

- [ ] **Step 1: Write the failing test**

Append inside `class DetectLimit`:

```python
    def test_out_of_range_epoch_falls_back_to_one_hour(self):
        text = "Claude AI usage limit reached|999999999999"
        reset = wind.detect_limit(text, PATTERNS, NOW)
        self.assertEqual(reset, NOW + datetime.timedelta(hours=1))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv tool run pytest tools/second-wind/tests -q -k out_of_range`
Expected: FAIL — `ValueError: year 33658 is out of range` (or OverflowError/OSError)

- [ ] **Step 3: Fix detect_limit**

Replace the body of the `for pat in patterns:` loop in `detect_limit` with:

```python
    for pat in patterns:
        m = pat.search(text)
        if not m:
            continue
        groups = m.groupdict()
        if groups.get("epoch"):
            try:
                return datetime.datetime.fromtimestamp(int(groups["epoch"]))
            except (ValueError, OverflowError, OSError):
                pass  # absurd timestamp in pane output; use the fallback
        if groups.get("time"):
            parsed = parse_clock_time(groups["time"], now=now)
            if parsed:
                return parsed
        # Pattern matched but carried no usable timestamp: fall back to a
        # conservative wait so we still resume eventually.
        now = now or datetime.datetime.now()
        return now + datetime.timedelta(hours=1)
    return None
```

- [ ] **Step 4: Run full tests to verify pass**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "fix(second-wind): out-of-range epoch in pane output no longer crashes watcher"
```

---

### Task 4: Notify URL validation + state-file permissions

**Files:**
- Modify: `tools/second-wind/wind.py` — `notify()` (~line 240), `save_state()` (~line 137)
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

Append to `tools/second-wind/tests/test_wind.py`:

```python
class NotifyUrl(unittest.TestCase):
    def test_accepts_http_and_https(self):
        self.assertTrue(wind.valid_notify_url("https://ntfy.sh/my-topic"))
        self.assertTrue(wind.valid_notify_url("http://host.local/topic"))

    def test_rejects_other_schemes(self):
        self.assertFalse(wind.valid_notify_url("file:///etc/passwd"))
        self.assertFalse(wind.valid_notify_url("ftp://host/x"))
        self.assertFalse(wind.valid_notify_url("ntfy.sh/topic"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv tool run pytest tools/second-wind/tests -q -k NotifyUrl`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'valid_notify_url'`

- [ ] **Step 3: Implement**

Above `notify()`:

```python
def valid_notify_url(url):
    return url.startswith(("http://", "https://"))
```

In `notify()`, after the `if not url: return` guard, add:

```python
    if not valid_notify_url(url):
        log("notify skipped: ntfy_url must start with http:// or https://")
        return
```

(Task 5 upgrades `log` with glyph support; this call stays valid either way.)

Replace `save_state` with:

```python
def save_state(state):
    path = state_file()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)
    os.chmod(path, 0o600)
```

- [ ] **Step 4: Run full tests to verify pass**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "fix(second-wind): validate ntfy_url scheme, tighten state file perms"
```

---

### Task 5: Wire UI into commands — glyph logs, status table, watch heartbeat

**Files:**
- Modify: `tools/second-wind/wind.py` — `log()`, ui section, `cmd_status`, `cmd_up`, `cmd_watch`, `resume_sessions`, `cmd_down`

No behavior change: same flags, same exit codes, same log content after
stripping color. Existing tests must keep passing untouched.

- [ ] **Step 1: Upgrade `log()` and add heartbeat helpers**

Replace `log()`:

```python
def log(msg, glyph=None, color="cyan"):
    heartbeat_clear()
    ts = style(datetime.datetime.now().strftime("%H:%M:%S"), "dim")
    prefix = f"{style(glyph, color)} " if glyph else ""
    print(f"[{ts}] {prefix}{msg}", flush=True)
```

Add to the ui section (after `banner()`):

```python
STATE_GLYPHS = {
    "running": ("●", "green"),
    "waiting-for-reset": ("◌", "yellow"),
    "idle": ("○", "dim"),
    "starting": ("◍", "cyan"),
    "not running": ("✗", "red"),
}

_heartbeat_visible = False


def heartbeat(text):
    """Transient one-line spinner, rewritten in place. TTY only."""
    global _heartbeat_visible
    if not sys.stdout.isatty():
        return
    frame = SPINNER_FRAMES[int(time.time() / SPINNER_TICK_SECONDS)
                           % len(SPINNER_FRAMES)]
    print(f"\r\033[2K  {style(frame, 'cyan')} {style(text, 'dim')}",
          end="", flush=True)
    _heartbeat_visible = True


def heartbeat_clear():
    global _heartbeat_visible
    if _heartbeat_visible:
        print("\r\033[2K", end="", flush=True)
        _heartbeat_visible = False


def watch_sleep(seconds, text):
    """Sleep, animating the heartbeat when on a TTY; plain sleep when piped."""
    if not sys.stdout.isatty():
        time.sleep(seconds)
        return
    end = time.time() + seconds
    while time.time() < end:
        heartbeat(text)
        time.sleep(SPINNER_TICK_SECONDS)
    heartbeat_clear()
```

Definition order in the ui section: palette consts → `use_color` → `style`
→ `human_delta` → `banner` → `STATE_GLYPHS` → `heartbeat` /
`heartbeat_clear` / `watch_sleep`. `log()` lives above the ui section and
calls `heartbeat_clear` — resolved at call time, so order is fine.

- [ ] **Step 2: Restyle `cmd_status`**

Replace `cmd_status` with:

```python
def cmd_status(cfg, args):
    patterns = limit_patterns(cfg)
    state = load_state()
    now = time.time()
    rows = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if not session_exists(name):
            rows.append((name, "not running", ""))
            continue
        text = capture_pane(name, cfg["capture_lines"])
        st = classify(text, patterns)
        reset = detect_limit(text, patterns)
        when = ""
        if reset:
            when = (f"{reset:%a %H:%M} · in "
                    f"{human_delta(reset.timestamp() - now)}")
        rows.append((name, st, when))

    width = max(len(r[0]) for r in rows) + 2
    print(style(f"{'SESSION':<{width}}{'STATE':<22}{'RESETS'}", "bold"))
    print(style("─" * (width + 36), "dim"))
    for name, st, when in rows:
        glyph, color = STATE_GLYPHS.get(st, ("·", "dim"))
        cell = f"{glyph} {st}"
        pad = " " * max(1, 22 - len(cell))
        print(f"{name:<{width}}{style(cell, color)}{pad}{when}")
    if state.get("reset_at"):
        resume_ts = state["reset_at"] + cfg["resume_buffer_seconds"]
        resume_at = datetime.datetime.fromtimestamp(resume_ts)
        print(f"\n{style('◌', 'yellow')} watcher: limit detected, resuming "
              f"all at {resume_at:%a %H:%M:%S} · in "
              f"{human_delta(resume_ts - now)}")
```

(Padding is computed on the plain `cell` text before styling, so ANSI codes
never skew column widths.)

- [ ] **Step 3: Glyph feedback in `cmd_up`, `resume_sessions`, `cmd_down`; banner in `cmd_up`/`cmd_watch`**

`cmd_up`: add `banner()` as the first line of the function, then:
- `log(f"{name}: already running, skipping", glyph="○", color="dim")`
- `` log(f"{name}: launched `{command}` in {path}", glyph="→", color="cyan") ``
- `log(f"{name}: prompt file not found: {repo['prompt_file']}", glyph="!", color="yellow")`
- `log(f"{name}: sent initial prompt ({len(prompt)} chars)", glyph="✓", color="green")`
- final summary: same message, `glyph="✓", color="green"`
- `log("nothing to start", glyph="○", color="dim")`

`resume_sessions`: `log(f"{name}: sent resume message", glyph="✓", color="green")`

`cmd_down`: `log(f"{name}: killed", glyph="✗", color="red")`

`cmd_watch`: add `banner()` as the first line, then:
- `log(f"{name}: usage limit detected, resets {reset:%a %H:%M}", glyph="!", color="yellow")`
- `log("reset time reached, resuming paused sessions", glyph="→", color="cyan")`
- in the `except KeyboardInterrupt:` handler, call `heartbeat_clear()` before `log("watcher stopped")`

- [ ] **Step 4: Replace the watch loop sleep with the heartbeat sleep**

At the bottom of the `while True:` loop in `cmd_watch`, replace
`time.sleep(poll)` with:

```python
            if paused and reset_at:
                eta = reset_at + buffer_s - time.time()
                hb = (f"limit hit · resuming {len(paused)} session(s) in "
                      f"{human_delta(eta)}")
            else:
                hb = (f"watching {len(cfg['repos'])} session(s) · "
                      f"poll {poll}s")
            watch_sleep(poll, hb)
```

- [ ] **Step 5: Run full tests**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: PASS (no existing test modified)

- [ ] **Step 6: Manual smoke — piped output stays clean**

```bash
cd /tmp && rm -rf windsmoke && mkdir windsmoke && cd windsmoke
python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py init
python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py status | cat
NO_COLOR=1 python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py status
```

Expected: table prints; `| cat` output contains no escape codes
(verify: `python3 .../wind.py status | cat | grep -c $'\033'` → `0`).
Glyphs (`✗`) still appear — they are content, not color.

- [ ] **Step 7: Commit**

```bash
git add tools/second-wind/wind.py
git commit -m "feat(second-wind): styled status table, glyph logs, watch heartbeat"
```

---

### Task 6: Visual explainer page

**Files:**
- Create: `docs/second-wind/index.html`
- Modify: `README.md:27` (Docs link line)

- [ ] **Step 1: Generate the explainer**

Use the `visual-explainer:generate-web-diagram` skill if available in the
executing session; otherwise hand-write. Requirements either way:

- Single self-contained HTML file, no CDN/network fetches, system font stack,
  dark theme (slate background, cyan/amber accents echoing the CLI palette).
- Save to `docs/second-wind/index.html`.

Content (three sections, in order):

1. **What is Second Wind** — hero: "Second Wind — your Claude Code sessions,
   running while you sleep." Sub: single-file Python orchestrator; runs
   Claude Code in one tmux session per repo; when the account-level 5-hour
   usage limit pauses everything, the watcher parses the reset time, waits,
   and resumes every session automatically. Three stat cards: "1 file, 0
   deps", "N repos, 1 watcher", "0 babysitting".
2. **How to use** — numbered steps with the actual commands:
   `wind init` (edit repos list) → `wind up` → `tmux new -d -s wind-watcher
   'wind watch'` → check in with `wind status` / `tmux attach -t wind-<repo>`
   → `wind down`. Include the curl install one-liner from Task 1.
3. **How it works** — two diagrams plus a table:
   - Architecture: watcher process ↔ tmux server hosting `wind-repo1..N`
     panes, each running Claude Code; watcher arrows labeled "capture-pane
     (poll every 30s)" and "paste resume message"; a single "account-level
     reset clock" box feeding the watcher; optional ntfy.sh box for
     notifications.
   - Watch-loop state machine: `running → limit detected (regex match on
     pane tail) → waiting (until reset + buffer) → resume sweep (all paused
     sessions) → cooldown (ignore stale limit text) → running`.
   - Config reference table: the 12 keys from `DEFAULT_CONFIG` with the
     one-line meanings already written in `tools/second-wind/README.md`.

- [ ] **Step 2: Link it from the main README**

In `README.md`, change the line
`Docs: [tools/second-wind/README.md](tools/second-wind/README.md)` to:

```markdown
Docs: [tools/second-wind/README.md](tools/second-wind/README.md) ·
[visual explainer](docs/second-wind/index.html)
```

- [ ] **Step 3: Verify self-containment**

Run: `grep -cE 'https?://[^"]*\.(js|css|woff)|cdn\.' docs/second-wind/index.html`
Expected: `0`. Open locally: `open docs/second-wind/index.html` — renders offline.

- [ ] **Step 4: Commit**

```bash
git add docs/second-wind/index.html README.md
git commit -m "docs(second-wind): visual explainer page (what/how-to/how-it-works)"
```

---

### Task 7: Security review pass + final verification

**Files:**
- Read: `tools/second-wind/wind.py`, diff of this branch

- [ ] **Step 1: Run a security review on the branch diff and wind.py**

Use the security-reviewer agent (or `/security-review`) over
`tools/second-wind/wind.py` plus the branch diff. Hot spots already
dispositioned by the spec — confirm each:

| Surface | Expected disposition |
| --- | --- |
| `send_text` types prompt-file content into panes | trusted input, documented in README (Task 1) |
| `ntfy_url` scheme | validated (Task 4) |
| `claude_cmd`/`claude_args` executed via tmux | trusted config, documented (Task 1) |
| state file perms | 0700 dir / 0600 file (Task 4) |
| epoch from pane output | range-guarded (Task 3) |
| config `limit_patterns` ReDoS | trusted config, documented (Task 1) |

- [ ] **Step 2: Fix any new CRITICAL/HIGH findings inline; list MEDIUM/LOW**

New CRITICAL/HIGH: fix in this branch with a test where feasible, commit as
`fix(second-wind): <finding>`. MEDIUM/LOW: record in the final summary
message to the user (not a new doc).

- [ ] **Step 3: Full verification**

```bash
uv tool run pytest tools/second-wind/tests -q
bats tests/bats/ 2>/dev/null || true   # repo-level tests still green
```

Expected: pytest PASS; bats unaffected.

- [ ] **Step 4: Commit any remaining changes**

```bash
git status --short   # should be clean; commit stragglers if any
```

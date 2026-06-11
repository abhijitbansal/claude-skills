# Second Wind 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `~/.wind` tool home with one-command installer, interactive `wind init` wizard, and a token-protected localhost web dashboard (`wind dash`) with live status + actions.

**Architecture:** Everything stays Python stdlib + sh. `wind.py` gains three bounded sections (`paths`, `wizard ui` + `wizard`, `dash`); the dashboard UI is a separate self-contained `dashboard.html`; `install.sh` places both into `~/.wind` and writes a `bin/wind` shim. Config/state move to `~/.wind` with legacy-path fallbacks so existing users break zero.

**Tech Stack:** Python 3.9+ stdlib (`termios`/`tty`, `http.server`, `secrets`, `webbrowser`), POSIX sh, vanilla HTML/CSS/JS, unittest (run via pytest), bats.

**Spec:** `docs/superpowers/specs/2026-06-11-second-wind-2-design.md`
**Branch:** `feat/second-wind-2` (already checked out)
**Test command:** `uv tool run pytest tools/second-wind/tests -q` (fallback: `python3 -m unittest discover tools/second-wind/tests`). Baseline: 27 passed.

**Note for every task:** add `import json` and `import tempfile` to the test file's import block the first time a task needs them (Tasks 1-4 do).

---

### Task 1: `paths` section — `~/.wind` config/state with legacy fallback

**Files:**
- Modify: `tools/second-wind/wind.py` — `CONFIG_PATHS`, `STATE_PATH` constants (~line 29-33), `load_state`/`save_state`/`clear_state` (state section)
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

Append to `tools/second-wind/tests/test_wind.py` (add `import json` and `import tempfile` to its imports):

```python
class ConfigPathOrder(unittest.TestCase):
    def test_wind_home_config_wins_over_legacy(self):
        with tempfile.TemporaryDirectory() as tmp:
            wind_cfg = os.path.join(tmp, "wind.json")
            legacy_cfg = os.path.join(tmp, "legacy.json")
            for p, marker in ((wind_cfg, "new"), (legacy_cfg, "old")):
                with open(p, "w") as f:
                    json.dump({"session_prefix": marker,
                               "repos": [{"name": "x", "path": "/tmp"}]}, f)
            orig = wind.CONFIG_PATHS
            wind.CONFIG_PATHS = [os.path.join(tmp, "absent.json"),
                                 wind_cfg, legacy_cfg]
            try:
                cfg = wind.load_config()
                self.assertEqual(cfg["session_prefix"], "new")
            finally:
                wind.CONFIG_PATHS = orig


class StatePaths(unittest.TestCase):
    def test_legacy_state_read_when_new_missing_then_new_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            new = os.path.join(tmp, "state.json")
            legacy = os.path.join(tmp, "legacy.json")
            with open(legacy, "w") as f:
                json.dump({"reset_at": 1}, f)
            orig = (wind.STATE_PATH, wind.LEGACY_STATE_PATH)
            wind.STATE_PATH, wind.LEGACY_STATE_PATH = new, legacy
            try:
                self.assertEqual(wind.load_state(), {"reset_at": 1})
                wind.save_state({"reset_at": 2})
                self.assertEqual(wind.load_state(), {"reset_at": 2})
                wind.clear_state()
                self.assertEqual(wind.load_state(), {})
            finally:
                wind.STATE_PATH, wind.LEGACY_STATE_PATH = orig
```

- [ ] **Step 2: Run to verify failure**

Run: `uv tool run pytest tools/second-wind/tests -q -k "ConfigPathOrder or StatePaths"`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'LEGACY_STATE_PATH'`.

- [ ] **Step 3: Implement**

In `wind.py`, replace the path constants block with:

```python
WIND_HOME = "~/.wind"
WIND_CONFIG = "~/.wind/config.json"
CONFIG_PATHS = [
    "./second-wind.json",
    WIND_CONFIG,
    "~/.config/second-wind/config.json",   # legacy fallback
]
STATE_PATH = "~/.wind/state.json"
LEGACY_STATE_PATH = "~/.local/state/second-wind/state.json"
```

Replace the state helpers:

```python
def state_file():
    return os.path.expanduser(STATE_PATH)


def load_state():
    for p in (STATE_PATH, LEGACY_STATE_PATH):
        try:
            with open(os.path.expanduser(p)) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def save_state(state):
    path = state_file()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)
    os.chmod(path, 0o600)


def clear_state():
    for p in (STATE_PATH, LEGACY_STATE_PATH):
        try:
            os.remove(os.path.expanduser(p))
        except OSError:
            pass
```

- [ ] **Step 4: Run full suite**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: 29 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): ~/.wind config/state paths with legacy fallback"
```

---

### Task 2: wizard ui primitives — key reader, menus, numbered fallback

**Files:**
- Modify: `tools/second-wind/wind.py` — new `wizard ui` section after the existing `ui` section
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

```python
class MenuLogic(unittest.TestCase):
    def test_select_arrows_and_enter(self):
        keys = iter([wind.KEY_DOWN, wind.KEY_DOWN, wind.KEY_ENTER])
        idx = wind.menu_select("t", ["a", "b", "c"],
                               get_key=lambda: next(keys),
                               render=lambda *a, **k: None)
        self.assertEqual(idx, 2)

    def test_select_wraps_upward(self):
        keys = iter([wind.KEY_UP, wind.KEY_ENTER])
        idx = wind.menu_select("t", ["a", "b", "c"],
                               get_key=lambda: next(keys),
                               render=lambda *a, **k: None)
        self.assertEqual(idx, 2)

    def test_select_quit_returns_none(self):
        keys = iter([wind.KEY_QUIT])
        self.assertIsNone(wind.menu_select("t", ["a"],
                                           get_key=lambda: next(keys),
                                           render=lambda *a, **k: None))

    def test_multiselect_toggle_and_confirm(self):
        keys = iter([wind.KEY_SPACE, wind.KEY_DOWN, wind.KEY_SPACE,
                     wind.KEY_ENTER])
        out = wind.menu_multiselect("t", ["a", "b"],
                                    get_key=lambda: next(keys),
                                    render=lambda *a, **k: None)
        self.assertEqual(out, [0, 1])

    def test_multiselect_untoggle(self):
        keys = iter([wind.KEY_SPACE, wind.KEY_SPACE, wind.KEY_ENTER])
        out = wind.menu_multiselect("t", ["a", "b"],
                                    get_key=lambda: next(keys),
                                    render=lambda *a, **k: None)
        self.assertEqual(out, [])

    def test_multiselect_preselected(self):
        keys = iter([wind.KEY_ENTER])
        out = wind.menu_multiselect("t", ["a", "b"], preselected=[1],
                                    get_key=lambda: next(keys),
                                    render=lambda *a, **k: None)
        self.assertEqual(out, [1])


class ParseMultiNumbers(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(wind.parse_multi_numbers("1,3", 3), [0, 2])

    def test_empty_means_none_selected(self):
        self.assertEqual(wind.parse_multi_numbers("", 3), [])

    def test_out_of_range_invalid(self):
        self.assertIsNone(wind.parse_multi_numbers("4", 3))

    def test_garbage_invalid(self):
        self.assertIsNone(wind.parse_multi_numbers("x", 3))

    def test_dedupes_and_sorts(self):
        self.assertEqual(wind.parse_multi_numbers("3,1,3", 3), [0, 2])
```

- [ ] **Step 2: Run to verify failure**

Run: `uv tool run pytest tools/second-wind/tests -q -k "MenuLogic or ParseMultiNumbers"`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'KEY_DOWN'`

- [ ] **Step 3: Implement the `wizard ui` section**

Insert after the existing `ui` section (after `watch_sleep`):

```python
# ----------------------------------------------------------- wizard ui -----

KEY_UP, KEY_DOWN, KEY_ENTER, KEY_SPACE, KEY_QUIT = (
    "up", "down", "enter", "space", "quit")


def _read_key_raw():
    """Read one keypress in raw mode; arrows mapped to KEY_UP/KEY_DOWN."""
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            seq = sys.stdin.read(2)
            if seq == "[A":
                return KEY_UP
            if seq == "[B":
                return KEY_DOWN
            return KEY_QUIT
        if ch in ("\r", "\n"):
            return KEY_ENTER
        if ch == " ":
            return KEY_SPACE
        if ch in ("\x03", "q"):
            return KEY_QUIT
        return ch
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def supports_raw_mode():
    if os.environ.get("TERM") == "dumb":
        return False
    try:
        import termios  # noqa: F401
    except ImportError:
        return False
    return sys.stdin.isatty() and sys.stdout.isatty()


def _render_menu(title, options, idx, selected=None, first=True):
    if not first:
        sys.stdout.write(f"\x1b[{len(options) + 1}A")
    print(f"\x1b[2K{style(title, 'bold')}")
    for i, opt in enumerate(options):
        cursor = style("❯", "cyan") if i == idx else " "
        if selected is not None:
            mark = (style("◉", "green") if i in selected
                    else style("○", "dim"))
            print(f"\x1b[2K  {cursor} {mark} {opt}")
        else:
            print(f"\x1b[2K  {cursor} {opt}")


def menu_select(title, options, get_key=_read_key_raw, render=_render_menu):
    """Arrow-key single-select. Returns index, or None on quit."""
    idx, first = 0, True
    while True:
        render(title, options, idx, selected=None, first=first)
        first = False
        key = get_key()
        if key == KEY_UP:
            idx = (idx - 1) % len(options)
        elif key == KEY_DOWN:
            idx = (idx + 1) % len(options)
        elif key == KEY_ENTER:
            return idx
        elif key == KEY_QUIT:
            return None


def menu_multiselect(title, options, preselected=None,
                     get_key=_read_key_raw, render=_render_menu):
    """Space-toggle multi-select. Returns sorted indices, or None on quit."""
    idx, first = 0, True
    chosen = frozenset(preselected or [])
    while True:
        render(title, options, idx, selected=chosen, first=first)
        first = False
        key = get_key()
        if key == KEY_UP:
            idx = (idx - 1) % len(options)
        elif key == KEY_DOWN:
            idx = (idx + 1) % len(options)
        elif key == KEY_SPACE:
            chosen = chosen ^ {idx}
        elif key == KEY_ENTER:
            return sorted(chosen)
        elif key == KEY_QUIT:
            return None


def parse_multi_numbers(raw, count):
    """'1,3' -> [0, 2]. '' -> []. Invalid -> None. Dedupes, sorts."""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    idxs = set()
    for p in parts:
        if not p.isdigit() or not 1 <= int(p) <= count:
            return None
        idxs.add(int(p) - 1)
    return sorted(idxs)


def menu_select_numbered(title, options, input_fn=input):
    print(style(title, "bold"))
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        raw = input_fn("> ").strip()
        if raw.lower() in ("q", "quit"):
            return None
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw) - 1
        print("enter a number from the list (q to cancel)")


def menu_multiselect_numbered(title, options, input_fn=input):
    print(style(title, "bold"))
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        raw = input_fn("numbers, comma-separated (empty = none, q = cancel)> ")
        if raw.strip().lower() in ("q", "quit"):
            return None
        idxs = parse_multi_numbers(raw, len(options))
        if idxs is not None:
            return idxs
        print("invalid — e.g. 1,3")


def select(title, options):
    if supports_raw_mode():
        return menu_select(title, options)
    return menu_select_numbered(title, options)


def multiselect(title, options, preselected=None):
    if supports_raw_mode():
        return menu_multiselect(title, options, preselected=preselected)
    return menu_multiselect_numbered(title, options)


def prompt_text(label, default="", input_fn=input):
    suffix = f" {style('(' + default + ')', 'dim')}" if default else ""
    raw = input_fn(f"{style('?', 'cyan')} {label}{suffix}: ").strip()
    return raw or default
```

- [ ] **Step 4: Run full suite**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: 40 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): wizard ui primitives — arrow menus with numbered fallback"
```

---

### Task 3: wizard flow + `cmd_init` wiring

**Files:**
- Modify: `tools/second-wind/wind.py` — new `wizard` section after `wizard ui`; `cmd_init`; argparse `init` subparser
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

```python
class ScanRepos(unittest.TestCase):
    def test_finds_git_dirs_one_level_deep(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "alpha", ".git"))
            os.makedirs(os.path.join(tmp, "beta"))
            os.makedirs(os.path.join(tmp, "gamma", ".git"))
            found = wind.scan_repos([tmp])
            self.assertEqual([n for n, _ in found], ["alpha", "gamma"])

    def test_missing_root_ignored(self):
        self.assertEqual(wind.scan_repos(["/nonexistent-xyz-123"]), [])

    def test_multiple_roots_concatenate(self):
        with tempfile.TemporaryDirectory() as t1, \
                tempfile.TemporaryDirectory() as t2:
            os.makedirs(os.path.join(t1, "one", ".git"))
            os.makedirs(os.path.join(t2, "two", ".git"))
            names = [n for n, _ in wind.scan_repos([t1, t2])]
            self.assertEqual(names, ["one", "two"])


class ConfigAssembly(unittest.TestCase):
    def test_build_repo_entry_minimal(self):
        self.assertEqual(wind.build_repo_entry("a", "/p", "", ""),
                         {"name": "a", "path": "/p"})

    def test_build_repo_entry_full(self):
        e = wind.build_repo_entry("a", "/p", "--permission-mode plan",
                                  "~/x.md")
        self.assertEqual(e["claude_args"], "--permission-mode plan")
        self.assertEqual(e["prompt_file"], "~/x.md")

    def test_build_config_defaults_and_repos(self):
        cfg = wind.build_config([{"name": "a", "path": "/p"}], "", "")
        self.assertEqual(cfg["resume_message"], "continue")
        self.assertEqual(cfg["ntfy_url"], "")
        self.assertEqual(len(cfg["repos"]), 1)

    def test_build_config_overrides(self):
        cfg = wind.build_config([], "go on", "https://ntfy.sh/t")
        self.assertEqual(cfg["resume_message"], "go on")
        self.assertEqual(cfg["ntfy_url"], "https://ntfy.sh/t")
```

- [ ] **Step 2: Run to verify failure**

Run: `uv tool run pytest tools/second-wind/tests -q -k "ScanRepos or ConfigAssembly"`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'scan_repos'`

- [ ] **Step 3: Implement the `wizard` section**

Insert after the `wizard ui` section:

```python
# --------------------------------------------------------------- wizard ----

PERMISSION_PRESETS = [
    ("acceptEdits — edits files without asking (overnight default)",
     "--permission-mode acceptEdits"),
    ("plan — plans first, asks before acting", "--permission-mode plan"),
    ("default — normal permission prompts", ""),
    ("custom — type your own claude_args", None),
]


def scan_repos(roots):
    """[(name, path)] for every <root>/<child>/.git, name-sorted per root."""
    found = []
    for root in roots:
        root_full = os.path.expanduser(str(root).strip())
        if not os.path.isdir(root_full):
            continue
        for child in sorted(os.listdir(root_full)):
            path = os.path.join(root_full, child)
            if os.path.isdir(os.path.join(path, ".git")):
                found.append((child, path))
    return found


def build_repo_entry(name, path, claude_args, prompt_file):
    entry = {"name": name, "path": path}
    if prompt_file:
        entry["prompt_file"] = prompt_file
    if claude_args:
        entry["claude_args"] = claude_args
    return entry


def build_config(repos, resume_message, ntfy_url):
    cfg = dict(DEFAULT_CONFIG)
    cfg["repos"] = repos
    cfg["resume_message"] = resume_message or DEFAULT_CONFIG["resume_message"]
    cfg["ntfy_url"] = ntfy_url or ""
    return cfg


def load_existing_config(target):
    try:
        with open(target) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def wizard_target_path(args):
    """Where the wizard writes. None = cancelled."""
    if args.config:
        return os.path.expanduser(args.config)
    local = "./second-wind.json"
    if os.path.isfile(local):
        choice = select(
            f"Found {local}",
            ["Reconfigure it (existing values become defaults)",
             f"Leave it — write {WIND_CONFIG} instead",
             "Cancel"])
        if choice == 0:
            return local
        if choice == 1:
            return os.path.expanduser(WIND_CONFIG)
        return None
    return os.path.expanduser(WIND_CONFIG)


def run_wizard(args):
    banner()
    target = wizard_target_path(args)
    if target is None:
        log("wizard cancelled", glyph="○", color="dim")
        return
    existing = load_existing_config(target)

    roots = prompt_text("Directories to scan for git repos (comma-separated)",
                        default="~/projects")
    found = scan_repos(roots.split(","))
    if not found:
        log(f"no git repos found under {roots}", glyph="!", color="yellow")
    existing_paths = {os.path.expanduser(r.get("path", ""))
                      for r in existing.get("repos", [])}
    labels = [f"{name}  {style(path, 'dim')}" for name, path in found]
    preselected = [i for i, (_, path) in enumerate(found)
                   if path in existing_paths]
    picked = []
    if found:
        picked = multiselect(
            "Select repos for wind to manage (space toggles, enter confirms)",
            labels, preselected=preselected)
        if picked is None:
            log("wizard cancelled", glyph="○", color="dim")
            return
    chosen = [found[i] for i in picked]

    extra = prompt_text("Other repo paths (comma-separated, empty to skip)",
                        default="")
    for raw in [p.strip() for p in extra.split(",") if p.strip()]:
        full = os.path.expanduser(raw)
        if os.path.isdir(full):
            chosen.append((os.path.basename(full.rstrip("/")), full))
        else:
            log(f"skipping {raw}: not a directory", glyph="!", color="yellow")

    if not chosen:
        die("no repos selected — nothing to configure")

    repos = []
    for name, path in chosen:
        print(f"\n{style(name, 'bold')} {style(path, 'dim')}")
        pick = select("Permission preset",
                      [label for label, _ in PERMISSION_PRESETS])
        if pick is None:
            log("wizard cancelled", glyph="○", color="dim")
            return
        claude_args = PERMISSION_PRESETS[pick][1]
        if claude_args is None:
            claude_args = prompt_text("claude_args", default="")
        prompt_file = prompt_text(
            "Prompt file sent on `wind up` (path, empty to skip)",
            default="")
        repos.append(build_repo_entry(name, path, claude_args, prompt_file))

    resume_message = prompt_text(
        "Resume message typed after the limit resets",
        default=existing.get("resume_message",
                             DEFAULT_CONFIG["resume_message"]))
    ntfy = prompt_text("ntfy.sh topic URL for notifications (empty to skip)",
                       default=existing.get("ntfy_url", ""))
    while ntfy and not valid_notify_url(ntfy):
        log("must start with http:// or https://", glyph="!", color="yellow")
        ntfy = prompt_text("ntfy.sh topic URL (empty to skip)", default="")

    cfg = build_config(repos, resume_message, ntfy)
    os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
    with open(target, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")

    print()
    log(f"wrote {target}", glyph="✓", color="green")
    for r in repos:
        preset = r.get("claude_args", "") or "default permissions"
        log(f"{r['name']}: {preset}", glyph="✓", color="green")
    print(f"\n  Next: {style('wind up', 'bold')} then "
          f"{style('wind watch', 'bold')} — live view: "
          f"{style('wind dash', 'bold')}\n")
```

- [ ] **Step 4: Rewire `cmd_init`**

Rename the existing `cmd_init` body to `write_starter_config(args)` (content
unchanged), then:

```python
def cmd_init(args):
    if getattr(args, "defaults", False) or not (
            sys.stdin.isatty() and sys.stdout.isatty()):
        return write_starter_config(args)
    return run_wizard(args)
```

In `main()`, extend the `init` subparser:

```python
    p_init.add_argument("--defaults", action="store_true",
                        help="write the starter config without the wizard")
```

- [ ] **Step 5: Run full suite**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: 47 passed. (Existing behavior safe in tests: stdin isn't a TTY
there, so `cmd_init` falls back to `write_starter_config`.)

- [ ] **Step 6: Manual smoke (interactive)**

In a real terminal: `cd /tmp && rm -f second-wind.json && mkdir -p /tmp/wizscan/demo1/.git /tmp/wizscan/demo2/.git && python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py init`
- enter `/tmp/wizscan` as scan root, arrow/space select demo1, pick a preset,
  skip prompt file, accept defaults → verify `~/.wind/config.json` written
  with the demo1 entry. Also verify `wind init --defaults` still writes
  `./second-wind.json` non-interactively. Clean up test artifacts.

- [ ] **Step 7: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): interactive init wizard — repo scan, presets, config write"
```

---

### Task 4: dashboard backend — status payload, handler, token auth

**Files:**
- Modify: `tools/second-wind/wind.py` — new `dash` section before the commands section
- Test: `tools/second-wind/tests/test_wind.py`

- [ ] **Step 1: Write the failing tests**

```python
class StripAnsi(unittest.TestCase):
    def test_strips_color_and_clears(self):
        self.assertEqual(wind.strip_ansi("\x1b[31mred\x1b[0m \x1b[2Kx"),
                         "red x")


class DashApi(unittest.TestCase):
    def setUp(self):
        self.cfg = dict(wind.DEFAULT_CONFIG)
        self.cfg["repos"] = [{"name": "demo", "path": "/tmp"}]
        self.token = "tok123"
        self.calls = []
        self._orig = (wind.session_exists, wind.capture_pane, wind.send_text,
                      wind.tmux, wind.resume_sessions, wind.clear_state,
                      wind.load_state)
        wind.session_exists = lambda name: True
        wind.capture_pane = lambda name, lines: "hello\nesc to interrupt"
        wind.send_text = (lambda name, text:
                          self.calls.append(("send", name, text)))
        wind.tmux = lambda *a, **k: self.calls.append(("tmux",) + a)
        wind.resume_sessions = (lambda cfg, names:
                                self.calls.append(("resume", tuple(names)))
                                or list(names))
        wind.clear_state = lambda: None
        wind.load_state = lambda: {}
        handler = wind.make_dash_handler(self.cfg, self.token,
                                         "<html>{{TOKEN}}</html>")
        import http.server
        import threading
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                                      handler)
        threading.Thread(target=self.server.serve_forever,
                         daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        (wind.session_exists, wind.capture_pane, wind.send_text, wind.tmux,
         wind.resume_sessions, wind.clear_state,
         wind.load_state) = self._orig

    def _req(self, method, path, body=None, token=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Wind-Token"] = token
        conn.request(method, path,
                     json.dumps(body) if body is not None else None, headers)
        resp = conn.getresponse()
        data = resp.read().decode()
        conn.close()
        return resp.status, data

    def test_index_embeds_token(self):
        status, data = self._req("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("tok123", data)

    def test_status_shape(self):
        status, data = self._req("GET", "/api/status")
        self.assertEqual(status, 200)
        payload = json.loads(data)
        sess = payload["sessions"][0]
        self.assertEqual(sess["name"], "wind-demo")
        self.assertEqual(sess["state"], "running")
        self.assertIn("pane_tail", sess)
        self.assertIn("watcher", payload)

    def test_post_without_token_rejected(self):
        status, _ = self._req("POST", "/api/send",
                              {"session": "wind-demo", "text": "hi"})
        self.assertEqual(status, 401)
        self.assertEqual(self.calls, [])

    def test_send_with_token_dispatches(self):
        status, _ = self._req("POST", "/api/send",
                              {"session": "wind-demo", "text": "hi"},
                              token="tok123")
        self.assertEqual(status, 200)
        self.assertIn(("send", "wind-demo", "hi"), self.calls)

    def test_send_unknown_session_rejected(self):
        status, _ = self._req("POST", "/api/send",
                              {"session": "evil", "text": "hi"},
                              token="tok123")
        self.assertEqual(status, 400)

    def test_kill_known_session(self):
        status, _ = self._req("POST", "/api/kill", {"session": "wind-demo"},
                              token="tok123")
        self.assertEqual(status, 200)
        self.assertIn(("tmux", "kill-session", "-t", "=wind-demo"),
                      self.calls)

    def test_resume_all(self):
        status, _ = self._req("POST", "/api/resume", {}, token="tok123")
        self.assertEqual(status, 200)
        self.assertIn(("resume", ("wind-demo",)), self.calls)

    def test_unknown_route_404(self):
        status, _ = self._req("GET", "/etc/passwd")
        self.assertEqual(status, 404)
```

- [ ] **Step 2: Run to verify failure**

Run: `uv tool run pytest tools/second-wind/tests -q -k "StripAnsi or DashApi"`
Expected: FAIL — `AttributeError: module 'wind' has no attribute 'strip_ansi'`

- [ ] **Step 3: Implement the `dash` section**

Insert before the `# commands` section:

```python
# ------------------------------------------------------------------ dash ---

PANE_TAIL_LINES = 30


def strip_ansi(text):
    return re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)


def valid_session(cfg, name):
    return name in {session_name(cfg, r) for r in cfg["repos"]}


def status_payload(cfg):
    patterns = limit_patterns(cfg)
    state = load_state()
    now = time.time()
    sessions = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if not session_exists(name):
            sessions.append({"name": name, "state": "not running",
                             "reset_at": None, "reset_human": "",
                             "pane_tail": ""})
            continue
        text = capture_pane(name, cfg["capture_lines"])
        st = classify(text, patterns)
        reset = detect_limit(text, patterns)
        tail = "\n".join(
            strip_ansi(text).rstrip().splitlines()[-PANE_TAIL_LINES:])
        sessions.append({
            "name": name,
            "state": st,
            "reset_at": reset.timestamp() if reset else None,
            "reset_human": (f"{reset:%a %H:%M} · in "
                            f"{human_delta(reset.timestamp() - now)}"
                            if reset else ""),
            "pane_tail": tail,
        })
    watcher = {}
    if state.get("reset_at"):
        try:
            reset_at = float(state["reset_at"])
            watcher = {"reset_at": reset_at,
                       "resume_at": reset_at + cfg["resume_buffer_seconds"]}
        except (TypeError, ValueError):
            watcher = {}
    return {"watcher": watcher, "sessions": sessions}


def make_dash_handler(cfg, token, template):
    import http.server

    class DashHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # keep the wind terminal clean

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/":
                self._send(200, template.replace("{{TOKEN}}", token),
                           "text/html; charset=utf-8")
            elif self.path == "/api/status":
                self._send(200, json.dumps(status_payload(cfg)))
            else:
                self._send(404, '{"error": "not found"}')

        def do_POST(self):
            if self.headers.get("X-Wind-Token") != token:
                self._send(401, '{"error": "bad token"}')
                return
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self._send(400, '{"error": "bad json"}')
                return
            if self.path == "/api/resume":
                names = [session_name(cfg, r) for r in cfg["repos"]]
                sent = resume_sessions(cfg, names)
                clear_state()
                self._send(200, json.dumps({"resumed": sent}))
            elif self.path == "/api/send":
                name = body.get("session")
                text = (body.get("text") or "").strip()
                if not valid_session(cfg, name) or not text:
                    self._send(400, '{"error": "bad session or empty text"}')
                    return
                send_text(name, text)
                self._send(200, '{"ok": true}')
            elif self.path == "/api/kill":
                name = body.get("session")
                if not valid_session(cfg, name):
                    self._send(400, '{"error": "bad session"}')
                    return
                tmux("kill-session", "-t", f"={name}")
                self._send(200, '{"ok": true}')
            else:
                self._send(404, '{"error": "not found"}')

    return DashHandler
```

- [ ] **Step 4: Run full suite**

Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: 57 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/wind.py tools/second-wind/tests/test_wind.py
git commit -m "feat(second-wind): dashboard backend — status API, token-gated actions"
```

---

### Task 5: `dashboard.html` + `cmd_dash`

**Files:**
- Create: `tools/second-wind/dashboard.html`
- Modify: `tools/second-wind/wind.py` — `cmd_dash`, template finder, argparse `dash` subparser

- [ ] **Step 1: Implement `cmd_dash` and template finder**

Add at the end of the `dash` section:

```python
def find_dashboard_template():
    candidates = [
        os.path.expanduser(os.path.join(WIND_HOME, "dashboard.html")),
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "dashboard.html"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def cmd_dash(cfg, args):
    import http.server
    import secrets
    import webbrowser

    template_path = find_dashboard_template()
    if not template_path:
        die("dashboard.html not found (looked in ~/.wind and next to "
            "wind.py) — re-run install.sh")
    with open(template_path) as f:
        template = f.read()
    token = secrets.token_hex(16)
    handler = make_dash_handler(cfg, token, template)
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port),
                                                 handler)
    except OSError as e:
        die(f"cannot bind 127.0.0.1:{args.port}: {e}")
    banner()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    log(f"dashboard at {url}", glyph="→", color="cyan")
    log("Ctrl-C to stop", glyph="○", color="dim")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("dashboard stopped")
    finally:
        server.server_close()
```

In `main()` add the subparser and handler entry:

```python
    p_dash = sub.add_parser("dash", help="serve the live web dashboard")
    p_dash.add_argument("--port", type=int, default=8787,
                        help="port on 127.0.0.1 (default 8787)")
    p_dash.add_argument("--no-browser", action="store_true",
                        help="don't open the browser automatically")
```

and `"dash": cmd_dash` in the `handlers` dict.

- [ ] **Step 2: Build `tools/second-wind/dashboard.html`**

Self-contained page. Binding requirements (UI craft is the implementer's, the
contract is not):

- Zero external fetches; system font stack; vanilla JS; dark slate
  background (#0b1220 family), cyan (#22d3ee) + amber (#f59e0b) accents —
  same visual language as `docs/second-wind/index.html`.
- `const TOKEN = "{{TOKEN}}";` — the server substitutes `{{TOKEN}}`.
- Header: `◢◤ second wind` wordmark; watcher banner — when
  `watcher.resume_at` present show amber "limit hit · resuming all at
  <local time> · in <countdown>", else dim "watcher idle / no limit
  detected"; "Resume all" button → `POST /api/resume`.
- One card per session (responsive grid, stacks on mobile): name; state
  pill colored by state (`running` green ●, `waiting-for-reset` amber ◌,
  `idle` dim ○, `starting` cyan ◍, `not running` red ✗); `reset_human`
  line when present; pane tail in a scrollable `<pre>` — **set via
  `textContent`, never `innerHTML`** (pane text is untrusted LLM output);
  send box (text input + button → `POST /api/send {session, text}`, clear
  input on 200); kill button → `confirm("Kill <name>? The tmux session and
  anything unsaved in it dies.")` → `POST /api/kill`.
- All POSTs send `X-Wind-Token: TOKEN` header and
  `Content-Type: application/json`.
- Poll `GET /api/status` every 3000 ms; between polls, tick visible
  countdowns client-side every second from `reset_at`/`resume_at` epochs.
- On fetch failure: red banner "dashboard server stopped — restart with
  `wind dash`"; clear it on the next successful poll.
- Auto-scroll each pane `<pre>` to bottom only if the user hasn't scrolled
  it up (track per-card "pinned to bottom" state).

- [ ] **Step 3: Verify self-containment + tests still green**

Run: `grep -cE 'https?://[^"]*\.(js|css|woff)|cdn\.|fonts\.googleapis|<script src' tools/second-wind/dashboard.html`
Expected: `0`
Run: `uv tool run pytest tools/second-wind/tests -q`
Expected: 57 passed.

- [ ] **Step 4: Manual smoke**

```bash
cd /tmp && rm -rf dashsmoke && mkdir dashsmoke && cd dashsmoke
python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py init --defaults
tmux new -d -s wind-example-repo 'sleep 300'   # fake session so a card is live
python3 /Users/abhijitbansal/projects/claude-skills/tools/second-wind/wind.py dash --no-browser --port 8911 &
sleep 1
curl -s http://127.0.0.1:8911/api/status | python3 -m json.tool | head -20
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8911/api/resume   # expect 401
kill %1; tmux kill-session -t wind-example-repo
```

Then a real-browser pass (headless Chrome screenshots at 1280px and 390px are
acceptable): cards render, dark theme, no console errors, no horizontal
overflow at 390px.

- [ ] **Step 5: Commit**

```bash
git add tools/second-wind/dashboard.html tools/second-wind/wind.py
git commit -m "feat(second-wind): wind dash — live web dashboard with actions"
```

---

### Task 6: `install.sh` + bats tests

**Files:**
- Create: `tools/second-wind/install.sh`
- Test: `tests/bats/install-second-wind.bats` (follow the style of existing files in `tests/bats/`)

- [ ] **Step 1: Write the failing bats tests**

```bash
#!/usr/bin/env bats

setup() {
  TMP="$(mktemp -d)"
  export WIND_HOME="$TMP/.wind"
  export WIND_RC="$TMP/zshrc"
  touch "$WIND_RC"
}

teardown() { rm -rf "$TMP"; }

@test "local mode creates layout and a working shim" {
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  [ -f "$WIND_HOME/wind.py" ]
  [ -f "$WIND_HOME/dashboard.html" ]
  [ -x "$WIND_HOME/bin/wind" ]
  run "$WIND_HOME/bin/wind" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Second Wind"* ]]
}

@test "PATH line appended once, idempotent on rerun" {
  WIND_ASSUME_YES=1 run sh tools/second-wind/install.sh
  [ "$status" -eq 0 ]
  WIND_ASSUME_YES=1 run sh tools/second-wind/install.sh
  [ "$status" -eq 0 ]
  [ "$(grep -c '.wind/bin' "$WIND_RC")" -eq 1 ]
}

@test "--no-modify-path leaves rc untouched" {
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  run grep -c '.wind/bin' "$WIND_RC"
  [ "$output" = "0" ]
}

@test "rerun does not clobber existing config.json" {
  run sh tools/second-wind/install.sh --no-modify-path
  echo '{"repos": []}' > "$WIND_HOME/config.json"
  run sh tools/second-wind/install.sh --no-modify-path
  [ "$status" -eq 0 ]
  [ "$(cat "$WIND_HOME/config.json")" = '{"repos": []}' ]
}
```

Note: bats `run` + env prefix (`WIND_ASSUME_YES=1 run ...`) works in bats ≥1.5;
if the repo's bats is older, set `export WIND_ASSUME_YES=1` on the line before
instead.

- [ ] **Step 2: Run to verify failure**

Run: `bats tests/bats/install-second-wind.bats`
Expected: FAIL — install.sh does not exist.

- [ ] **Step 3: Implement `tools/second-wind/install.sh`**

```sh
#!/bin/sh
# Second Wind installer — places wind into ~/.wind and (optionally) onto PATH.
# Usage: curl -fsSL <raw-url>/install.sh | sh        (download mode)
#        sh tools/second-wind/install.sh             (local-clone mode)
# Flags: --no-modify-path    never touch the shell rc
# Env:   WIND_HOME (default ~/.wind), WIND_RC (rc file override),
#        WIND_ASSUME_YES=1 (skip the PATH y/N prompt), WIND_RAW_BASE.
set -eu

RAW_BASE="${WIND_RAW_BASE:-https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind}"
WIND_HOME="${WIND_HOME:-$HOME/.wind}"
MODIFY_PATH=1
for arg in "$@"; do
  case "$arg" in
    --no-modify-path) MODIFY_PATH=0 ;;
    *) printf 'unknown flag: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

say ""
say "  ◢◤ second wind installer"
say ""

mkdir -p "$WIND_HOME/bin"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P) || SCRIPT_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/wind.py" ] && [ -f "$SCRIPT_DIR/dashboard.html" ]; then
  cp "$SCRIPT_DIR/wind.py" "$WIND_HOME/wind.py"
  cp "$SCRIPT_DIR/dashboard.html" "$WIND_HOME/dashboard.html"
  say "  ✓ copied wind.py + dashboard.html from local clone"
else
  curl -fsSL "$RAW_BASE/wind.py" -o "$WIND_HOME/wind.py"
  curl -fsSL "$RAW_BASE/dashboard.html" -o "$WIND_HOME/dashboard.html"
  say "  ✓ downloaded wind.py + dashboard.html"
fi

head -1 "$WIND_HOME/wind.py" | grep -q python || {
  say "  ✗ wind.py looks broken — inspect $WIND_HOME/wind.py"; exit 1; }

cat > "$WIND_HOME/bin/wind" <<'SHIM'
#!/bin/sh
exec python3 "${WIND_HOME:-$HOME/.wind}/wind.py" "$@"
SHIM
chmod +x "$WIND_HOME/bin/wind" "$WIND_HOME/wind.py"
say "  ✓ shim at $WIND_HOME/bin/wind"

PATH_LINE='export PATH="$HOME/.wind/bin:$PATH"'
RC="${WIND_RC:-}"
if [ -z "$RC" ]; then
  case "$(basename "${SHELL:-sh}")" in
    zsh)  RC="$HOME/.zshrc" ;;
    bash) RC="$HOME/.bashrc" ;;
    *)    RC="$HOME/.profile" ;;
  esac
fi

if grep -qsF '.wind/bin' "$RC"; then
  say "  ✓ PATH already set in $RC"
elif [ "$MODIFY_PATH" = 0 ]; then
  say "  → add to PATH yourself:  $PATH_LINE"
else
  ans=""
  if [ "${WIND_ASSUME_YES:-}" = "1" ]; then
    ans=y
  elif [ -t 0 ]; then
    printf '  add %s to %s? [y/N] ' "$PATH_LINE" "$RC"
    read -r ans || ans=""
  elif [ -r /dev/tty ]; then
    printf '  add %s to %s? [y/N] ' "$PATH_LINE" "$RC"
    read -r ans < /dev/tty || ans=""
  fi
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    printf '\n%s\n' "$PATH_LINE" >> "$RC"
    say "  ✓ PATH line added to $RC"
  else
    say "  → add to PATH yourself:  $PATH_LINE"
  fi
fi

say ""
say "  Next:  exec \$SHELL   then   wind init"
say ""
```

`chmod +x tools/second-wind/install.sh`

- [ ] **Step 4: Run bats to verify pass**

Run: `bats tests/bats/install-second-wind.bats`
Expected: 4 tests pass. Also `bats tests/bats/` — pre-existing tests
unaffected. The shim test relies on the `WIND_HOME` env override in the shim
(`${WIND_HOME:-$HOME/.wind}`), which the test exports.

- [ ] **Step 5: Shellcheck**

Run: `shellcheck tools/second-wind/install.sh` — fix any warnings (repo CI
shellchecks adapters; match that bar).

- [ ] **Step 6: Commit**

```bash
git add tools/second-wind/install.sh tests/bats/install-second-wind.bats
git commit -m "feat(second-wind): install.sh — ~/.wind layout, shim, consensual PATH setup"
```

---

### Task 7: docs ripple

**Files:**
- Modify: `tools/second-wind/README.md` (Install section, Quick start, new Dashboard section, Config section, Security model)
- Modify: `docs/second-wind/index.html` (install one-liner, how-to-use steps, dashboard mention)
- Modify: `plugins/second-wind/skills/second-wind/SKILL.md` (install block, command table, hard rules)
- Modify: `README.md` (second-wind blurb)

- [ ] **Step 1: tool README**

Replace the `## Install` section content (keep the heading) with:

```markdown
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
```

Quick start: describe `wind init` as the interactive wizard, mention
`--defaults` for the old non-interactive starter file. Add:

```markdown
## Dashboard

`wind dash` serves a live dashboard at `http://127.0.0.1:8787` — one card per
session with state, reset countdown, and the last 30 lines of each pane, plus
resume-all / send-message / kill actions. Localhost-only; every action
requires a per-run token embedded in the page, so other websites can't POST
into your sessions. `--port` to change port, `--no-browser` to skip
auto-open.
```

Config section: lookup order is now `./second-wind.json` →
`~/.wind/config.json` → `~/.config/second-wind/config.json` (legacy). State
lives in `~/.wind/state.json` (legacy `~/.local/state/...` still read).
Security model section: add "the dashboard binds 127.0.0.1 and gates all
actions behind a per-run CSRF token".

- [ ] **Step 2: explainer page** — in `docs/second-wind/index.html`: replace
the curl install block with the install.sh one-liner; change the
"How to use" step-1 copy to "run `wind init` — an interactive wizard scans
for your repos and writes the config"; add a short "Watch it live" card for
`wind dash` (no new diagrams required).

- [ ] **Step 3: SKILL.md** — replace the "If `wind` is not on PATH" install
block with the install.sh one-liner; add `wind dash` to the command table:
"serve the live localhost dashboard (status, pane tails, resume/send/kill)".
Add hard rule: "`wind dash` kill button kills tmux sessions — same
confirmation rule as `wind down`."

- [ ] **Step 4: main README** — in the second-wind section, switch install to
the install.sh one-liner and mention "interactive `wind init` wizard and a
live `wind dash` web dashboard" in the blurb.

- [ ] **Step 5: Verify + commit**

`grep -rn "local/bin/wind" README.md tools/second-wind/README.md plugins/` —
expect no stale install instructions (`setup/` may legitimately still
symlink).

```bash
git add tools/second-wind/README.md docs/second-wind/index.html \
  plugins/second-wind/skills/second-wind/SKILL.md README.md
git commit -m "docs(second-wind): install.sh flow, wizard, dashboard docs"
```

---

### Task 8: security review + final verification

- [ ] **Step 1: Security review** (security-reviewer agent) over the branch
diff, focused on: dashboard handler (token comparison, route handling, header
parsing), `valid_session` allowlist, `strip_ansi` completeness for what gets
JSON-encoded, install.sh (download integrity, quoting, rc-file append), wizard
file writes. Confirm dispositions: token = per-run `secrets.token_hex(16)`
required on every POST; bind 127.0.0.1 only; pane text rendered via
`textContent`; config remains trusted input.

- [ ] **Step 2: Fix CRITICAL/HIGH inline** with tests where feasible; list
MEDIUM/LOW in the final summary.

- [ ] **Step 3: Full verification**

```bash
uv tool run pytest tools/second-wind/tests -q     # expect 57 passed
bats tests/bats/                                  # all pass
shellcheck tools/second-wind/install.sh
```

- [ ] **Step 4: End-to-end smoke**

```bash
WIND_HOME=/tmp/e2e-wind sh tools/second-wind/install.sh --no-modify-path
WIND_HOME=/tmp/e2e-wind /tmp/e2e-wind/bin/wind --help
cd /tmp && rm -f second-wind.json
WIND_HOME=/tmp/e2e-wind /tmp/e2e-wind/bin/wind init --defaults
WIND_HOME=/tmp/e2e-wind /tmp/e2e-wind/bin/wind dash --no-browser --port 8912 &
sleep 1
curl -s http://127.0.0.1:8912/api/status | head -5
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8912/api/resume   # 401
kill %1
rm -rf /tmp/e2e-wind /tmp/second-wind.json
```

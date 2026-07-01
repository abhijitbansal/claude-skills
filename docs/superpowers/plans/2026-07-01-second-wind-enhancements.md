# Second Wind Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-auto permission preset (as the shipped default), a one-choice "defaults for all repos" path in `wind init`, a `wind add <path>` CLI + dashboard "add repo" that persist scan roots and launch immediately, and a regression test + docs locking Claude settings/hook inheritance.

**Architecture:** All CLI/server logic lives in one module, `tools/second-wind/wind.py` (data constants → helpers → `cmd_*` handlers → `main()` argparse). The dashboard is a static `dashboard.html` served by an in-process `http.server` handler built in `make_dash_handler`. Tests are a single `tools/second-wind/tests/test_wind.py` (stdlib `unittest`, wizard driven via the `drive_wizard` harness, tmux mocked). Changes are additive and preserve byte-for-byte behavior for existing configs.

**Tech Stack:** Python 3.9+ stdlib only (argparse, json, http.server, subprocess, tmux CLI). No third-party deps. `unittest` + `pytest` runner.

## Global Constraints

- **Trusted-config security rule:** `claude_cmd` / `claude_args` / `limit_patterns` / prompt files run/compile/type **verbatim** on `wind up`. New config-writing paths (`wind add`, `/api/add`) MUST write **`{name, path}` only** — never accept `claude_cmd`/`claude_args`/`limit_patterns`/`prompt` from a CLI arg or HTTP body. Added repos inherit the top-level global preset.
- **Dashboard defenses:** all write endpoints stay behind 127.0.0.1 bind + Host allowlist (`_host_allowed`) + `X-Wind-Token` CSRF gate. Config writes stay atomic (`atomic_write_json`, mode `0o644`).
- **Key-presence resolution:** `resolve_agent` resolves `claude_args` by key **presence** (an explicit `""` means "no args"). Full-auto default lives in `DEFAULT_CONFIG` top-level value; minimal `{name,path}` entries must carry **no** `claude_args` key so they inherit the global preset.
- **Flag string:** use `--permission-mode bypassPermissions` (never `--dangerously-skip-permissions`).
- **Preset stability:** append the new preset at **index 4** (after `custom`) so indices 0–3 are unchanged.
- **Immutability:** keep using `build_config` / `build_repo_entry` (fresh dicts); do not mutate `chosen`.
- **Coverage:** keep the suite green and ≥80%.
- **Run tests with:** `cd tools/second-wind && python -m pytest tests/test_wind.py -q` (or `-k <name>` for one test). Bats: `bats tests/bats` from repo root.

---

### Task 1: F1 — Full-auto preset + shipped default

**Files:**
- Modify: `tools/second-wind/wind.py:396-402` (`PERMISSION_PRESETS`), `tools/second-wind/wind.py:87` (`DEFAULT_CONFIG["claude_args"]`)
- Test: `tools/second-wind/tests/test_wind.py`

**Interfaces:**
- Produces: `PERMISSION_PRESETS[4] == ("auto — accepts everything, no prompts (full bypass)", "--permission-mode bypassPermissions")`; `DEFAULT_CONFIG["claude_args"] == "--permission-mode bypassPermissions"`.

- [ ] **Step 1: Write the failing test**

```python
class FullAutoPreset(unittest.TestCase):
    def test_bypass_preset_appended_at_index_4(self):
        label, args = wind.PERMISSION_PRESETS[4]
        self.assertIn("bypass", label.lower())
        self.assertEqual(args, "--permission-mode bypassPermissions")

    def test_existing_preset_indices_unchanged(self):
        # Appending must not shift acceptEdits/plan/default/custom.
        self.assertEqual(wind.PERMISSION_PRESETS[0][1],
                         "--permission-mode acceptEdits")
        self.assertEqual(wind.PERMISSION_PRESETS[1][1],
                         "--permission-mode plan")
        self.assertEqual(wind.PERMISSION_PRESETS[2][1], "")
        self.assertIsNone(wind.PERMISSION_PRESETS[3][1])  # custom

    def test_shipped_default_is_full_auto(self):
        self.assertEqual(wind.DEFAULT_CONFIG["claude_args"],
                         "--permission-mode bypassPermissions")

    def test_starter_config_carries_full_auto(self):
        # write_starter_config dumps DEFAULT_CONFIG; the starter default flips.
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            args = mock.Mock(config=target, force=True, defaults=True)
            wind.write_starter_config(args)
            with open(target) as f:
                cfg = json.load(f)
            self.assertEqual(cfg["claude_args"],
                             "--permission-mode bypassPermissions")
```

- [ ] **Step 2: Run to verify it fails** — `python -m pytest tests/test_wind.py -k FullAutoPreset -q` → FAIL (IndexError / wrong value).

- [ ] **Step 3: Implement**

In `PERMISSION_PRESETS` (wind.py:396) append after the `custom` tuple:
```python
PERMISSION_PRESETS = [
    ("acceptEdits — edits files without asking (overnight default)",
     "--permission-mode acceptEdits"),
    ("plan — plans first, asks before acting", "--permission-mode plan"),
    ("default — normal permission prompts", ""),
    ("custom — type your own claude_args", None),
    ("auto — accepts everything, no prompts (full bypass)",
     "--permission-mode bypassPermissions"),
]
```
In `DEFAULT_CONFIG` (wind.py:87) change:
```python
    "claude_args": "--permission-mode bypassPermissions",
```

- [ ] **Step 4: Run the whole suite** — `python -m pytest tests/test_wind.py -q`. Fix any test that assumed the old empty default (e.g. a load/launch test that omits `claude_args` and asserts no args). Expected primary breakage is limited; the map found launch tests set `claude_args` explicitly. Update any that merge `DEFAULT_CONFIG` and assert `""`.

- [ ] **Step 5: Verify starter check `verify_write_starter`/write path** and confirm `write_starter_config`'s signature matches the mock in the test (read wind.py:1477-1494; adjust the `mock.Mock(...)` attributes to the real `args` fields the function reads).

- [ ] **Step 6: Commit** — `git commit -am "feat(second-wind): add full-auto bypassPermissions preset as shipped default (F1)"`

---

### Task 2: F4 — Lock settings/hook inheritance with a regression test + README note

**Files:**
- Test: `tools/second-wind/tests/test_wind.py`
- Modify: `tools/second-wind/README.md` (add a "Settings & hooks inheritance" note)

**Interfaces:**
- Consumes: `cmd_up`, `tmux`, `resolve_agent` (unchanged).
- Produces: nothing new in code; a behavioral guard.

- [ ] **Step 1: Write the failing test** (it will actually pass once written — this is a *characterization/guard* test that must stay green; write it and confirm green, then it guards against regressions).

```python
class SettingsInheritance(unittest.TestCase):
    def _run_cmd_up(self, cfg):
        calls = []
        with mock.patch.object(wind, "tmux",
                               lambda *a, **k: calls.append((a, k))), \
                mock.patch.object(wind, "session_exists", lambda n: False), \
                mock.patch.object(wind, "spawn_watcher", lambda c, **k: True), \
                mock.patch("os.path.isdir", lambda p: True), \
                mock.patch("time.sleep", lambda s: None):
            args = mock.Mock(no_watch=True)
            wind.cmd_up(cfg, args)
        return calls

    def test_launch_injects_no_settings_flag_and_no_env(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "alpha", "path": "/tmp/alpha"}]
        cfg["claude_args"] = ""            # isolate: no wind-injected flags
        cfg["_path"] = "/tmp/second-wind.json"
        calls = self._run_cmd_up(cfg)
        send = [a for (a, k) in calls if a and a[0] == "send-keys"]
        self.assertTrue(send, "expected a send-keys launch call")
        command = send[0][3]               # tmux("send-keys","-t",target,command,"Enter")
        self.assertEqual(command, "claude")           # no --settings, no env prefix
        self.assertNotIn("--settings", command)
        # tmux() is never called with an env= kwarg (would break settings.json inheritance)
        self.assertTrue(all("env" not in k for (a, k) in calls))
```

- [ ] **Step 2: Run** — `python -m pytest tests/test_wind.py -k SettingsInheritance -q`. Expected: PASS. If it fails, the mock signature for `cmd_up` args/`session_exists` needs aligning with wind.py:1497-1519 — fix the test, not the code.

- [ ] **Step 3: README note.** Add a short subsection under the config/security area of `tools/second-wind/README.md`:

```markdown
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
```

- [ ] **Step 4: Commit** — `git commit -am "test(second-wind): lock settings.json/hook inheritance at launch + document (F4)"`

---

### Task 3: F2 — "Accept defaults for all repos" wizard branch

**Files:**
- Modify: `tools/second-wind/wind.py:700-751` (`run_wizard`)
- Test: `tools/second-wind/tests/test_wind.py` (new test + **update every existing wizard test's `selects`** in lockstep)

**Interfaces:**
- Consumes: `select`, `pick_permission_preset`, `build_repo_entry`, `build_config`.
- Produces: after the global-preset pick, a new `select` at wizard position: `["Configure each repo individually", "Apply the global preset + defaults to all selected repos"]`. Choice `1` = accept-all.

- [ ] **Step 1: Write the failing test**

```python
class WizardAcceptAll(unittest.TestCase):
    def test_accept_all_writes_minimal_entries_inheriting_global(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",   # scan roots
                    "",             # extra paths
                    "continue",     # resume message
                    "",             # ntfy
                ],
                # global preset acceptEdits (0); accept-all (1)  -> no per-repo selects
                selects=[0, 1],
                multiselects=[[0, 1]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha")),
                             ("beta", os.path.join(tmp, "beta"))])
            self.assertEqual([r["name"] for r in cfg["repos"]], ["alpha", "beta"])
            for repo in cfg["repos"]:
                self.assertEqual(set(repo.keys()), {"name", "path"})
            self.assertEqual(cfg["claude_args"],
                             "--permission-mode acceptEdits")
```

- [ ] **Step 2: Run** — `python -m pytest tests/test_wind.py -k WizardAcceptAll -q` → FAIL (extra select consumes a value or entries carry extra keys).

- [ ] **Step 3: Implement** — in `run_wizard`, immediately after the global-preset block (after wind.py:704, before `repos = []` at 705) insert:

```python
    mode = select(
        "Per-repo setup",
        ["Configure each repo individually",
         "Apply the global preset + defaults to all selected repos"])
    if mode is None:
        log("wizard cancelled", glyph="○", color="dim")
        return
    if mode == 1:
        repos = [build_repo_entry(name, path, "", "", override=False,
                                  agent="claude")
                 for name, path in chosen]
    else:
        repos = []
        for name, path in chosen:
            # ... existing per-repo loop body unchanged ...
```
(Wrap the existing `for name, path in chosen:` loop in the `else` branch; do not change its body.)

- [ ] **Step 4: Update existing wizard tests in lockstep.** The inserted `select` shifts every downstream index. In each existing `drive_wizard(... selects=[...])` for `run_wizard`, insert `0` (configure-individually) immediately **after** the global-preset element:
  - `WizardHarness.test_scripted_run_writes_expected_config`: `selects=[2, 0, 0, 0]` → `[2, 0, 0, 0, 0]`
  - `WizardHarness.test_scripted_run_with_custom_permission_and_prompt`: `[2, 1, 0, 0, 0]` → `[2, 0, 1, 0, 0, 0]`
  - `WizardHarness.test_wizard_write_is_atomic`: `[2, 0, 0, 0]` → `[2, 0, 0, 0, 0]`
  - `WizardPermissionPresets.test_global_preset_chosen_all_repos_inherit`: `[0, 0, 0, 0, 0, 0, 0]` → `[0, 0, 0, 0, 0, 0, 0, 0]`
  - `WizardPermissionPresets.test_one_repo_overrides_only_that_repo_gets_key`: `[2, 1, 1, 0, 0, 0, 0, 0]` → `[2, 0, 1, 1, 0, 0, 0, 0, 0]`
  - `WizardPermissionPresets.test_override_with_custom_args` (read its current `selects` at ~test_wind.py:947-1009) and any other `run_wizard`-driving test: insert `0` after the global-preset element.

  **Method:** grep the test file for `drive_wizard(` and audit each `selects=` list. For every one, the first element is the global preset; insert `0` at position 1.

- [ ] **Step 5: Run the whole wizard suite** — `python -m pytest tests/test_wind.py -k Wizard -q` → all PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat(second-wind): one-choice 'defaults for all repos' in wind init (F2)"`

---

### Task 4: F3a — Persist scan_roots in config

**Files:**
- Modify: `tools/second-wind/wind.py:84-105` (`DEFAULT_CONFIG`), `tools/second-wind/wind.py:622-628` (`build_config` signature), `tools/second-wind/wind.py:763` (wizard write)
- Test: `tools/second-wind/tests/test_wind.py`

**Interfaces:**
- Produces: `DEFAULT_CONFIG["scan_roots"] == []`; `build_config(..., scan_roots=None)` writes `cfg["scan_roots"]`; wizard persists cleaned roots.

- [ ] **Step 1: Write the failing test**

```python
class ScanRootsPersisted(unittest.TestCase):
    def test_default_config_has_scan_roots(self):
        self.assertEqual(wind.DEFAULT_CONFIG["scan_roots"], [])

    def test_wizard_persists_scan_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=["~/projects, ~/work", "", "continue", ""],
                selects=[0, 1],                 # global preset, accept-all
                multiselects=[[0]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])
            self.assertEqual(cfg["scan_roots"], ["~/projects", "~/work"])
```

- [ ] **Step 2: Run** — FAIL (KeyError `scan_roots`).

- [ ] **Step 3: Implement**
  - Add `"scan_roots": [],` to `DEFAULT_CONFIG` (near line 96, alongside `limit_patterns`).
  - Change `build_config` (wind.py:622):
    ```python
    def build_config(repos, resume_message, ntfy_url, claude_args="",
                     scan_roots=None):
        cfg = dict(DEFAULT_CONFIG)
        cfg["repos"] = repos
        cfg["resume_message"] = resume_message or DEFAULT_CONFIG["resume_message"]
        cfg["ntfy_url"] = ntfy_url or ""
        cfg["claude_args"] = claude_args
        cfg["scan_roots"] = scan_roots or []
        return cfg
    ```
  - In `run_wizard`, capture the cleaned roots where they're parsed (wind.py:666-668) and pass them to `build_config` at wind.py:763:
    ```python
    root_list = [r.strip() for r in roots.split(",") if r.strip()]
    found = scan_repos(root_list)
    ...
    cfg = build_config(repos, resume_message, ntfy, claude_args=global_args,
                       scan_roots=root_list)
    ```

- [ ] **Step 4: Run** — `python -m pytest tests/test_wind.py -k "ScanRoots or Wizard" -q` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(second-wind): persist scan_roots in config (F3a)"`

---

### Task 5: F3b — Extract a `launch_repo` helper (DRY the single-repo launch)

**Files:**
- Modify: `tools/second-wind/wind.py:1497-1519` (`cmd_up` launch loop → call helper); add `launch_repo` above `cmd_up`.
- Test: `tools/second-wind/tests/test_wind.py`

**Interfaces:**
- Produces: `launch_repo(cfg, repo) -> str|None` — resolves the agent, creates the tmux session (`new-session -d -s NAME -c PATH`), sends the launch command, logs, and returns the session name; returns `None` if the session already exists or the path is missing (mirrors `cmd_up`'s per-repo guards). Consumed by `cmd_up` and `cmd_add`.

- [ ] **Step 1: Write the failing test**

```python
class LaunchRepo(unittest.TestCase):
    def test_launch_repo_creates_session_and_sends_command(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "alpha", "path": "/tmp/alpha"}]
        cfg["claude_args"] = "--permission-mode bypassPermissions"
        calls = []
        with mock.patch.object(wind, "tmux",
                               lambda *a, **k: calls.append(a)), \
                mock.patch.object(wind, "session_exists", lambda n: False), \
                mock.patch("os.path.isdir", lambda p: True):
            name = wind.launch_repo(cfg, cfg["repos"][0])
        self.assertEqual(name, "wind-alpha")
        new = [a for a in calls if a[0] == "new-session"][0]
        self.assertIn("-c", new)
        send = [a for a in calls if a[0] == "send-keys"][0]
        self.assertEqual(send[3], "claude --permission-mode bypassPermissions")

    def test_launch_repo_skips_running_session(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "alpha", "path": "/tmp/alpha"}]
        with mock.patch.object(wind, "session_exists", lambda n: True):
            self.assertIsNone(wind.launch_repo(cfg, cfg["repos"][0]))
```

- [ ] **Step 2: Run** — FAIL (`launch_repo` undefined).

- [ ] **Step 3: Implement** — add `launch_repo` and refactor `cmd_up`'s per-repo body to use it (behavior-preserving; keep the `started.append((repo, name))` bookkeeping and the prompt-send loop in `cmd_up`):

```python
def launch_repo(cfg, repo):
    """Create the repo's tmux session and launch its agent. Returns the
    session name, or None if it already runs. die()s on a missing path
    (same guard as cmd_up)."""
    name = session_name(cfg, repo)
    path = os.path.expanduser(repo["path"])
    if session_exists(name):
        log(f"{name}: already running, skipping", glyph="○", color="dim")
        return None
    if not os.path.isdir(path):
        die(f"{name}: repo path does not exist: {path}")
    agent = resolve_agent(repo, cfg)
    command = agent["cmd"] + (f" {agent['args']}" if agent["args"] else "")
    tmux("new-session", "-d", "-s", name, "-c", path)
    tmux("send-keys", "-t", f"={name}:", command, "Enter")
    log(f"{name}: launched `{command}` in {path} "
        f"(agent {agent['name']}, {agent['args_source']} args)",
        glyph="→", color="cyan")
    return name
```
In `cmd_up`, replace the inline body (wind.py:1500-1519) with:
```python
    for repo in cfg["repos"]:
        name = launch_repo(cfg, repo)
        if name is not None:
            started.append((repo, name))
```

- [ ] **Step 4: Run the whole suite** — `python -m pytest tests/test_wind.py -q`. Existing `cmd_up` tests must still pass (behavior preserved). Fix mock alignment only if the refactor changed call ordering (it should not).

- [ ] **Step 5: Commit** — `git commit -am "refactor(second-wind): extract launch_repo helper from cmd_up (F3b)"`

---

### Task 6: F3c — `wind add <path>` CLI + `_refresh_watcher`

**Files:**
- Modify: `tools/second-wind/wind.py` — add `cmd_add`, `_refresh_watcher`; register `add` subparser in `main()` (wind.py:1912-1959).
- Test: `tools/second-wind/tests/test_wind.py`

**Interfaces:**
- Consumes: `load_config`, `launch_repo`, `build_repo_entry`, `atomic_write_json`, `watcher_session_name`, `session_exists`, `spawn_watcher`, `_prompt_path`'s single-component validation.
- Produces:
  - `add_repo_to_config(cfg, path) -> dict` — validates + appends `{name,path}` to the RAW config file atomically, returns the new entry. Raises `ValueError` on bad path / dup / collision. Shared by `cmd_add` and `/api/add`.
  - `cmd_add(cfg, args)` — calls `add_repo_to_config`, then `launch_repo`, then `_refresh_watcher`.
  - `_refresh_watcher(cfg)` — restart the watcher so it re-reads config.

- [ ] **Step 1: Write the failing tests**

```python
class AddRepo(unittest.TestCase):
    def _cfg_with(self, tmp, repos, extra=None):
        path = os.path.join(tmp, "second-wind.json")
        data = {"session_prefix": "wind", "claude_args": "",
                "repos": repos, "scan_roots": [tmp]}
        if extra:
            data.update(extra)
        wind.atomic_write_json(path, data, mode=0o644)
        cfg = dict(wind.DEFAULT_CONFIG); cfg.update(data); cfg["_path"] = path
        return cfg, path

    def _git(self, tmp, name):
        d = os.path.join(tmp, name); os.makedirs(os.path.join(d, ".git"))
        return d

    def test_add_appends_minimal_entry_and_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg, path = self._cfg_with(tmp, [{"name": "alpha",
                                              "path": self._git(tmp, "alpha")}])
            newdir = self._git(tmp, "beta")
            entry = wind.add_repo_to_config(cfg, newdir)
            self.assertEqual(entry, {"name": "beta", "path": newdir})
            with open(path) as f:
                saved = json.load(f)
            self.assertIn("beta", [r["name"] for r in saved["repos"]])
            # security: entry carries ONLY name+path
            self.assertEqual(set(saved["repos"][-1].keys()), {"name", "path"})

    def test_add_rejects_non_git_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg, _ = self._cfg_with(tmp, [{"name": "alpha", "path": tmp}])
            plain = os.path.join(tmp, "plain"); os.makedirs(plain)
            with self.assertRaises(ValueError):
                wind.add_repo_to_config(cfg, plain)

    def test_add_rejects_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self._git(tmp, "alpha")
            cfg, _ = self._cfg_with(tmp, [{"name": "alpha", "path": a}])
            with self.assertRaises(ValueError):
                wind.add_repo_to_config(cfg, a)

    def test_add_rejects_watcher_name_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg, _ = self._cfg_with(tmp, [{"name": "alpha",
                                           "path": self._git(tmp, "alpha")}])
            watcher = self._git(tmp, "watcher")   # -> wind-watcher reserved
            with self.assertRaises(ValueError):
                wind.add_repo_to_config(cfg, watcher)

    def test_cmd_add_launches_and_refreshes_watcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg, path = self._cfg_with(tmp, [{"name": "alpha",
                                              "path": self._git(tmp, "alpha")}])
            beta = self._git(tmp, "beta")
            launched, refreshed = [], []
            with mock.patch.object(wind, "launch_repo",
                                   lambda c, r: launched.append(r["name"])), \
                    mock.patch.object(wind, "_refresh_watcher",
                                      lambda c: refreshed.append(True)), \
                    mock.patch.object(wind, "load_config", lambda e=None: cfg):
                wind.cmd_add(cfg, mock.Mock(path=beta))
            self.assertEqual(launched, ["beta"])
            self.assertTrue(refreshed)
```

- [ ] **Step 2: Run** — FAIL (`add_repo_to_config` / `cmd_add` undefined).

- [ ] **Step 3: Implement**

```python
def add_repo_to_config(cfg, path):
    """Append a {name, path} repo to the RAW config file atomically.

    Security: writes ONLY name+path (inherits the global preset); never
    accepts claude_args/agent/prompt from callers. Raises ValueError on a
    non-git path, a duplicate name/path, or a reserved watcher-name collision.
    Returns the new entry dict.
    """
    full = os.path.expanduser(str(path).strip())
    if not os.path.isdir(os.path.join(full, ".git")):
        raise ValueError(f"not a git repo: {full}")
    name = os.path.basename(full.rstrip("/"))
    if not name or "/" in name or name in (".", ".."):
        raise ValueError(f"cannot derive a safe repo name from {full!r}")
    with open(cfg["_path"]) as f:
        raw = json.load(f)
    existing = raw.get("repos", [])
    for r in existing:
        if r.get("name") == name:
            raise ValueError(f"a repo named {name!r} is already configured")
        if os.path.expanduser(r.get("path", "")) == full:
            raise ValueError(f"{full} is already configured as {r.get('name')!r}")
    reserved = watcher_session_name(cfg)
    probe = dict(cfg); probe_repo = {"name": name, "path": full}
    if session_name(cfg, probe_repo) == reserved:
        raise ValueError(f"{name!r} collides with the reserved watcher session "
                         f"{reserved!r}; rename the directory or change "
                         f"'session_prefix'")
    entry = build_repo_entry(name, full, "", "", override=False)
    raw["repos"] = existing + [entry]
    atomic_write_json(cfg["_path"], raw, mode=0o644)
    return entry


def _refresh_watcher(cfg):
    """Restart the watcher so it re-reads config and watches new repos.

    cmd_watch derives its watched set ONCE at startup, so a repo added after
    the watcher launched is otherwise never auto-resumed. State is persisted
    (state.json), so a restart is safe.
    """
    name = watcher_session_name(cfg)
    if session_exists(name):
        tmux("kill-session", "-t", f"={name}", check=False)
    spawn_watcher(cfg)


def cmd_add(cfg, args):
    try:
        entry = add_repo_to_config(cfg, args.path)
    except ValueError as e:
        die(str(e))
    log(f"added {entry['name']} -> {entry['path']}", glyph="✓", color="green")
    # Re-load so cfg carries the new entry for launch + watcher config.
    cfg = load_config(cfg["_path"])
    repo = next(r for r in cfg["repos"] if r["name"] == entry["name"])
    launch_repo(cfg, repo)
    _refresh_watcher(cfg)
    log(f"{entry['name']}: launched and watcher refreshed", glyph="✓",
        color="green")
```

Register the subparser in `main()` (after the `prompt` parser, ~wind.py:1931) and route it (add to the `handlers` dict):
```python
    p_add = sub.add_parser("add", help="add a git repo to the config and launch it")
    p_add.add_argument("path", help="path to a git repo directory")
```
```python
        "add": cmd_add,
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_wind.py -k AddRepo -q` → PASS. Then full suite.

- [ ] **Step 5: Commit** — `git commit -am "feat(second-wind): wind add <path> command with launch + watcher refresh (F3c)"`

---

### Task 7: F3d — Dashboard `/api/scan` (tokenless) + `/api/add` (token-gated)

**Files:**
- Modify: `tools/second-wind/wind.py:1274-1382` (`DashHandler.do_GET` / `do_POST` inside `make_dash_handler`).
- Test: `tools/second-wind/tests/test_wind.py`

**Interfaces:**
- Consumes: `scan_repos`, `add_repo_to_config`, `launch_repo`, `_refresh_watcher`, `status_payload`.
- Produces: `GET /api/scan` → `{"candidates": [{"name","path"}, ...]}` (scanned under `scan_roots`, minus configured, restricted to scan_roots); `POST /api/add {"path": ...}` → validates the path is a scan-root candidate, appends via `add_repo_to_config`, appends to the in-memory `cfg["repos"]`, launches, refreshes the watcher → `{"ok": true, "repo": {...}}`.

- [ ] **Step 1: Write the failing tests** (drive the handler methods directly via a lightweight fake request, matching the existing dashboard-handler test style in the file — locate it with `grep -n "make_dash_handler" tests/test_wind.py` and mirror its request harness). Assertions:
  - `/api/scan` returns candidates = scanned − configured, and every candidate path is under a `scan_roots` entry.
  - `/api/add` with a candidate path: config file gains the repo, `cfg["repos"]` (in-memory snapshot) gains it, `launch_repo` + `_refresh_watcher` were called, response `ok`.
  - `/api/add` with a path **not** under `scan_roots`: rejected `400`, config unchanged.
  - `/api/add` with a body carrying `claude_args`/`agent`: those keys are **ignored** — the saved entry is `{name, path}` only.
  - `/api/add` without the token: `401`.

```python
# Sketch of the direct-call harness (align field names with the existing
# dashboard test in this file):
def _add(cfg, token, body, headers=None):
    Handler = wind.make_dash_handler(cfg, token, "<html/>")
    h = Handler.__new__(Handler)
    h.headers = {"Host": "127.0.0.1", "X-Wind-Token": token,
                 "Content-Length": str(len(json.dumps(body)))}
    if headers:
        h.headers.update(headers)
    h.path = "/api/add"
    h.rfile = io.BytesIO(json.dumps(body).encode())
    captured = {}
    h._send = lambda code, b, ctype="application/json": captured.update(
        code=code, body=b)
    h.do_POST()
    return captured
```

- [ ] **Step 2: Run** — FAIL (`/api/scan`, `/api/add` → 404).

- [ ] **Step 3: Implement** — inside `do_GET`, add before the `else` 404:
```python
            elif parts.path == "/api/scan":
                self._send(200, json.dumps({"candidates": _scan_candidates(cfg)}))
```
Inside `do_POST`, add before the `else` 404:
```python
            elif self.path == "/api/add":
                req_path = body.get("path")
                if not isinstance(req_path, str) or not req_path:
                    self._send(400, '{"error": "missing path"}')
                    return
                full = os.path.expanduser(req_path)
                # Restrict to candidates under a persisted scan_root.
                if full not in {c["path"] for c in _scan_candidates(cfg)}:
                    self._send(400, '{"error": "path not a scanned candidate"}')
                    return
                try:
                    entry = add_repo_to_config(cfg, full)
                except ValueError as e:
                    self._send(400, json.dumps({"error": str(e)}))
                    return
                cfg["repos"].append(entry)          # live snapshot -> /api/status
                launch_repo(cfg, entry)
                _refresh_watcher(cfg)
                self._send(200, json.dumps({"ok": True, "repo": entry}))
```
Add a module-level helper near `scan_repos`:
```python
def _scan_candidates(cfg):
    """Scanned repos under cfg['scan_roots'] not already configured."""
    configured = {os.path.expanduser(r.get("path", "")) for r in cfg["repos"]}
    out = []
    for name, path in scan_repos(cfg.get("scan_roots", [])):
        if os.path.expanduser(path) not in configured:
            out.append({"name": name, "path": path})
    return out
```

- [ ] **Step 4: Run** — `python -m pytest tests/test_wind.py -k "Dash or Add or Scan" -q` → PASS. Full suite green.

- [ ] **Step 5: Commit** — `git commit -am "feat(second-wind): dashboard /api/scan + /api/add endpoints (F3d)"`

---

### Task 8: F3e — Dashboard "add repo" UI

**Files:**
- Modify: `tools/second-wind/dashboard.html` (add a control that calls `/api/scan` then `/api/add`).

**Interfaces:**
- Consumes: existing `apiPost` helper (dashboard.html:850) + a `fetch('/api/scan')`.

- [ ] **Step 1: Read** `dashboard.html` around the header/controls (grep for `apiPost`, `/api/status`, the render root, and the `#empty` block at ~560) to match markup + JS style.

- [ ] **Step 2: Implement** an "Add repo" button in the dashboard header that:
  - `GET /api/scan`, renders the returned `candidates` as a small pick list (name + dim path);
  - on pick, `POST /api/add {path}` via the token header used by `apiPost`;
  - on success, refresh status (the new card appears);
  - if `candidates` is empty, show "No scanned repos left to add (scan roots: …)".
  Keep it minimal and consistent with the existing modal/list styling. No new JS deps.

- [ ] **Step 3: Manual smoke** (documented, not automated — JS UI): note in the PR test checklist to run `wind dash`, click Add repo, add a scanned repo, confirm the card appears and the session launches.

- [ ] **Step 4: Commit** — `git commit -am "feat(second-wind): dashboard add-repo control (F3e)"`

---

### Task 9: Docs — README + SKILL

**Files:**
- Modify: `tools/second-wind/README.md`, `plugins/second-wind/skills/second-wind/SKILL.md`

- [ ] **Step 1:** README — under Commands, add `wind add <path>` ("add a scanned/any git repo and launch it"); document the new `auto` permission preset and that full-auto (`--permission-mode bypassPermissions`) is now the **shipped default**; update the security section (reverse the "does not default to full bypass" statement — state it now does, same risk class as `--dangerously-skip-permissions`, and how to pick a safer preset); document `scan_roots` and the dashboard "Add repo" control.
- [ ] **Step 2:** SKILL.md — add `wind add` to the command table; note full-auto default in the permission/preset text and the "Hard rules" (config is trusted; added repos inherit the global preset; `{name,path}`-only writes).
- [ ] **Step 3:** Bump `VERSION` in `wind.py:159` (`2.0.0` → `2.1.0`) and note it in README.
- [ ] **Step 4: Commit** — `git commit -am "docs(second-wind): document full-auto default, wind add, scan_roots, dashboard add (F1–F3)"`

---

### Task 10: Site sync

**Files:**
- Modify: `site/index.html`, `docs/features/second-wind.html`, `docs/second-wind/index.html`, and any shared footer counts (skills/hooks/bats) that reference Second Wind features.

- [ ] **Step 1: Discover the current site's Second Wind copy** — grep `site/` and `docs/` for `wind add`, `permission`, `bypass`, `acceptEdits`, command lists, and the footer counters (skills/hooks/bats totals). Enumerate every page that describes Second Wind's commands or permission behavior.
- [ ] **Step 2:** Update the feature copy to mention: `wind add`, full-auto default, the accept-all init path, and the dashboard add-repo control. Match each page's existing tone/markup (do not restyle).
- [ ] **Step 3:** Recompute any footer/stat counters that changed (e.g. bats test count if new bats added; command counts). If the repo has a generator for `og.png`/catalog, run it; otherwise update the numbers in place.
- [ ] **Step 4: Verify** — open the changed HTML locally (or grep-diff the counters) to confirm no broken references; run `bats tests/bats` (some bats assert doc/site invariants).
- [ ] **Step 5: Commit** — `git commit -am "docs(site): sync Second Wind pages with full-auto default, wind add, accept-all init"`

---

## Final verification (after all tasks)

- [ ] `cd tools/second-wind && python -m pytest tests/test_wind.py -q` → all green.
- [ ] Coverage check: `python -m pytest tests/test_wind.py --cov=wind --cov-report=term-missing` (if `pytest-cov` present) → ≥80%.
- [ ] `bats tests/bats` from repo root → green.
- [ ] Adversarial review pass (workflow) over the diff: security (no injection via add paths; token/host gates intact), correctness (watcher refresh; key-presence resolution unbroken), and back-compat (existing configs behave identically).
- [ ] Generate the interactive manual-test checklist (device/UI-only flows: dashboard add-repo, full-auto launch behavior) per repo convention and deliver it.

## Self-review notes

- **Spec coverage:** F1 → Task 1; F2 → Task 3; F3 (scan_roots) → Task 4; F3 (launch helper) → Task 5; F3 (`wind add`) → Task 6; F3 (dashboard endpoints) → Task 7; F3 (dashboard UI) → Task 8; F4 → Task 2; docs → Task 9; site → Task 10. All spec sections covered.
- **Watcher-refresh caveat** (spec F3) → handled in Task 6 (`_refresh_watcher`) and used by Task 7.
- **`{name,path}`-only security rule** → enforced in `add_repo_to_config` (Task 6) and re-asserted in the `/api/add` tests (Task 7).
- **Index-shift blast radius** (F2) → explicitly enumerated in Task 3 Step 4.

"""Unit tests for Second Wind's parsing and classification logic.

Run: python3 -m unittest discover tests
"""

import datetime
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "wind",
    os.path.join(os.path.dirname(__file__), "..", "wind.py"))
wind = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wind)

NOW = datetime.datetime(2026, 6, 10, 14, 0, 0)  # 2pm local
PATTERNS = wind.limit_patterns({"limit_patterns": []})


class ParseClockTime(unittest.TestCase):
    def test_plain_pm(self):
        self.assertEqual(wind.parse_clock_time("3pm", NOW),
                         NOW.replace(hour=15, minute=0))

    def test_with_minutes_and_space(self):
        self.assertEqual(wind.parse_clock_time("4:30 PM", NOW),
                         NOW.replace(hour=16, minute=30))

    def test_rolls_to_tomorrow(self):
        parsed = wind.parse_clock_time("3am", NOW)
        self.assertEqual(parsed,
                         NOW.replace(hour=3, minute=0)
                         + datetime.timedelta(days=1))

    def test_noon_and_midnight(self):
        self.assertEqual(wind.parse_clock_time("12pm", NOW).hour, 12)
        self.assertEqual(wind.parse_clock_time("12am", NOW).hour, 0)

    def test_garbage(self):
        self.assertIsNone(wind.parse_clock_time("soon", NOW))


class DetectLimit(unittest.TestCase):
    def test_headless_epoch_format(self):
        epoch = 1780000000
        text = f"Claude AI usage limit reached|{epoch}"
        reset = wind.detect_limit(text, PATTERNS, NOW)
        self.assertEqual(reset, datetime.datetime.fromtimestamp(epoch))

    def test_interactive_five_hour_format(self):
        text = "5-hour limit reached ∙ resets 3am"
        self.assertEqual(wind.detect_limit(text, PATTERNS, NOW),
                         NOW.replace(hour=3) + datetime.timedelta(days=1))

    def test_resets_at_with_timezone_suffix(self):
        text = ("You've hit your usage limit. Wait until your limit "
                "resets at 8pm (Asia/Kolkata).")
        self.assertEqual(wind.detect_limit(text, PATTERNS, NOW),
                         NOW.replace(hour=20))

    def test_try_again_format(self):
        text = "Usage limit reached — try again at 6:15pm."
        self.assertEqual(wind.detect_limit(text, PATTERNS, NOW),
                         NOW.replace(hour=18, minute=15))

    def test_no_limit_in_normal_output(self):
        text = "I'll start by reading the config file.\n● Read(wind.py)"
        self.assertIsNone(wind.detect_limit(text, PATTERNS, NOW))

    def test_unparseable_time_falls_back_to_one_hour(self):
        text = "usage limit reached, resets later"
        # matches a limit pattern shape? It shouldn't match the strict
        # patterns above, so no fallback fires.
        self.assertIsNone(wind.detect_limit(text, PATTERNS, NOW))

    def test_custom_config_pattern(self):
        pats = wind.limit_patterns(
            {"limit_patterns": [r"RATE_LIMIT until (?P<epoch>\d{9,12})"]})
        reset = wind.detect_limit("RATE_LIMIT until 1780000000", pats, NOW)
        self.assertEqual(reset, datetime.datetime.fromtimestamp(1780000000))

    def test_out_of_range_epoch_falls_back_to_one_hour(self):
        text = "Claude AI usage limit reached|999999999999"
        reset = wind.detect_limit(text, PATTERNS, NOW)
        self.assertEqual(reset, NOW + datetime.timedelta(hours=1))


class Classify(unittest.TestCase):
    def test_running(self):
        self.assertEqual(
            wind.classify("✻ Cogitating… (esc to interrupt)", PATTERNS),
            "running")

    def test_waiting_for_reset(self):
        self.assertEqual(
            wind.classify("5-hour limit reached ∙ resets 3am", PATTERNS),
            "waiting-for-reset")

    def test_idle(self):
        self.assertEqual(wind.classify("> \n", PATTERNS), "idle")

    def test_starting(self):
        self.assertEqual(wind.classify("", PATTERNS), "starting")


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


class NotifyUrl(unittest.TestCase):
    def test_accepts_http_and_https(self):
        self.assertTrue(wind.valid_notify_url("https://ntfy.sh/my-topic"))
        self.assertTrue(wind.valid_notify_url("http://host.local/topic"))

    def test_rejects_other_schemes(self):
        self.assertFalse(wind.valid_notify_url("file:///etc/passwd"))
        self.assertFalse(wind.valid_notify_url("ftp://host/x"))
        self.assertFalse(wind.valid_notify_url("ntfy.sh/topic"))


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


class StripAnsi(unittest.TestCase):
    def test_strips_color_and_clears(self):
        self.assertEqual(wind.strip_ansi("\x1b[31mred\x1b[0m \x1b[2Kx"),
                         "red x")

    def test_strips_osc_sequences(self):
        self.assertEqual(wind.strip_ansi("\x1b]0;title\x07hi"), "hi")


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

    def _req(self, method, path, body=None, token=None, host=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Wind-Token"] = token
        if host:
            headers["Host"] = host
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

    def test_dns_rebinding_host_rejected(self):
        status, _ = self._req("GET", "/", host="evil.example.com")
        self.assertEqual(status, 403)

    def test_rebinding_post_rejected_even_with_token(self):
        status, _ = self._req("POST", "/api/kill", {"session": "wind-demo"},
                              token="tok123", host="evil.example.com:8787")
        self.assertEqual(status, 403)
        self.assertEqual(self.calls, [])

    def test_localhost_host_allowed(self):
        status, _ = self._req("GET", "/api/status", host="localhost:8787")
        self.assertEqual(status, 200)

    def test_negative_content_length_rejected(self):
        import socket
        s = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        s.sendall(
            b"POST /api/resume HTTP/1.1\r\n"
            b"Host: 127.0.0.1\r\n"
            b"X-Wind-Token: tok123\r\n"
            b"Content-Length: -1\r\n"
            b"\r\n"
        )
        response = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            response += chunk
            if b"\r\n\r\n" in response:
                break
        s.close()
        self.assertIn(b"400", response)


class AtomicWriteJson(unittest.TestCase):
    def test_writes_json_with_trailing_newline(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "out.json")
            wind.atomic_write_json(path, {"a": 1})
            with open(path) as f:
                raw = f.read()
            self.assertEqual(json.loads(raw), {"a": 1})
            self.assertTrue(raw.endswith("\n"))

    def test_creates_parent_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "nested", "deep", "out.json")
            wind.atomic_write_json(path, {"x": True})
            self.assertEqual(wind.load_existing_config(path), {"x": True})

    def test_honors_requested_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "out.json")
            wind.atomic_write_json(path, {"a": 1}, mode=0o600)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_default_mode_is_0600(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "out.json")
            wind.atomic_write_json(path, {"a": 1})
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_interrupted_write_leaves_prior_config_intact(self):
        # Arrange: an existing, valid config on disk.
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "config.json")
            wind.atomic_write_json(path, {"session_prefix": "wind",
                                          "repos": [{"name": "x",
                                                     "path": "/tmp"}]})
            before = wind.load_existing_config(path)

            # Act: a write that blows up after the temp file is created but
            # before os.replace runs (simulating a crash mid-write).
            real_replace = os.replace

            def boom(src, dst):
                raise RuntimeError("crash mid-write")

            with mock.patch("os.replace", boom):
                with self.assertRaises(RuntimeError):
                    wind.atomic_write_json(path, {"session_prefix": "BROKEN"})

            # Assert: the prior file is untouched and still valid JSON, and no
            # stray temp files were left behind in the directory.
            self.assertEqual(real_replace, os.replace)  # patch unwound
            self.assertEqual(wind.load_existing_config(path), before)
            leftovers = [n for n in os.listdir(tmp)
                         if n.startswith(".wind-")]
            self.assertEqual(leftovers, [])

    def test_save_state_routes_through_atomic_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            new = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = new
            try:
                wind.save_state({"reset_at": 7})
                self.assertEqual(wind.load_state(), {"reset_at": 7})
                self.assertEqual(os.stat(new).st_mode & 0o777, 0o600)
            finally:
                wind.STATE_PATH = orig


def drive_wizard(texts, selects, multiselects=None, target=None,
                 scan_result=()):
    """Run run_wizard end to end with scripted answers.

    texts:        strings returned in order by each prompt_text() call.
    selects:      indices returned in order by each select() call (a
                  menu_select pick); None entries simulate a quit.
    multiselects: lists returned in order by each multiselect() call.
    target:       the path run_wizard writes to (via args.config).
    scan_result:  what the patched scan_repos returns.

    Returns the parsed config dict written by the wizard (or {} if none).
    """
    texts_iter = iter(texts)
    selects_iter = iter(selects)
    multi_iter = iter(multiselects or [])
    args = mock.Mock()
    args.config = target

    def fake_prompt_text(label, default="", input_fn=None):
        try:
            raw = next(texts_iter)
        except StopIteration:
            return default
        return raw or default

    with mock.patch.object(wind, "prompt_text", fake_prompt_text), \
            mock.patch.object(wind, "select",
                              lambda *a, **k: next(selects_iter)), \
            mock.patch.object(wind, "multiselect",
                              lambda *a, **k: next(multi_iter)), \
            mock.patch.object(wind, "scan_repos",
                              lambda roots: list(scan_result)):
        wind.run_wizard(args)

    return wind.load_existing_config(target)


class WizardHarness(unittest.TestCase):
    def test_scripted_run_writes_expected_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",    # scan roots
                    "",              # extra repo paths (none)
                    "",              # prompt file (skip)
                    "go on",         # resume message
                    "",              # ntfy url (skip)
                ],
                selects=[2],         # permission preset: "default" (index 2)
                multiselects=[[0]],  # pick repo #0 (alpha)
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])

            self.assertEqual([r["name"] for r in cfg["repos"]], ["alpha"])
            self.assertEqual(cfg["repos"][0]["path"],
                             os.path.join(tmp, "alpha"))
            self.assertNotIn("claude_args", cfg["repos"][0])  # default preset
            self.assertEqual(cfg["resume_message"], "go on")
            self.assertEqual(cfg["ntfy_url"], "")

    def test_scripted_run_with_custom_permission_and_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",                 # scan roots
                    "",                           # extra paths
                    "~/.wind/prompts/alpha.md",   # prompt file
                    "continue",                   # resume message
                    "https://ntfy.sh/topic",      # ntfy url
                ],
                selects=[0],         # preset: acceptEdits (index 0)
                multiselects=[[0]],  # pick repo #0
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])

            repo = cfg["repos"][0]
            self.assertEqual(repo["claude_args"],
                             "--permission-mode acceptEdits")
            self.assertEqual(repo["prompt_file"], "~/.wind/prompts/alpha.md")
            self.assertEqual(cfg["ntfy_url"], "https://ntfy.sh/topic")

    def test_wizard_write_is_atomic(self):
        # Proves run_wizard routes through atomic_write_json: a crash at
        # os.replace leaves no partial config and surfaces the error.
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")

            def boom(src, dst):
                raise RuntimeError("crash mid-write")

            with mock.patch("os.replace", boom):
                with self.assertRaises(RuntimeError):
                    drive_wizard(
                        texts=["~/projects", "", "", "go on", ""],
                        selects=[2],
                        multiselects=[[0]],
                        target=target,
                        scan_result=[("alpha",
                                      os.path.join(tmp, "alpha"))])
            self.assertFalse(os.path.exists(target))


class _TmuxRecorder:
    """Records tmux invocations and answers has-session from a name set."""

    def __init__(self, existing=()):
        self.calls = []
        self.existing = set(existing)

    def __call__(self, *args, check=True, capture=True):
        self.calls.append(args)
        result = mock.Mock()
        result.returncode = 0
        result.stdout = ""
        result.stderr = ""
        if args and args[0] == "has-session":
            # args: ("has-session", "-t", "=name")
            target = args[2][1:] if args[2].startswith("=") else args[2]
            result.returncode = 0 if target in self.existing else 1
        if args and args[0] == "list-sessions":
            result.stdout = "\n".join(sorted(self.existing))
        return result


class WatcherSessionName(unittest.TestCase):
    def test_derives_from_prefix(self):
        self.assertEqual(
            wind.watcher_session_name({"session_prefix": "wind"}),
            "wind-watcher")

    def test_honors_custom_prefix(self):
        self.assertEqual(
            wind.watcher_session_name({"session_prefix": "night"}),
            "night-watcher")


class BuildWatcherCommand(unittest.TestCase):
    def test_uses_absolute_config_path_from_temp_cwd(self):
        # Regression for the cwd bug: cfg["_path"] may be the literal
        # relative "./second-wind.json"; the spawned watcher must carry an
        # absolute, existing config path because a detached tmux session
        # does not inherit the parent's cwd.
        with tempfile.TemporaryDirectory() as tmp:
            cfg_rel = "./second-wind.json"
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"session_prefix": "wind",
                           "repos": [{"name": "x", "path": "/tmp"}]}, f)
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                cmd = wind.build_watcher_command({"_path": cfg_rel})
            finally:
                os.chdir(cwd)
            # python executable + abs wind.py + -c + abs cfg + watch
            self.assertEqual(cmd[0], sys.executable)
            self.assertTrue(os.path.isabs(cmd[1]))
            self.assertTrue(cmd[1].endswith("wind.py"))
            self.assertEqual(cmd[2], "-c")
            self.assertTrue(os.path.isabs(cmd[3]))
            self.assertTrue(os.path.isfile(cmd[3]))
            self.assertTrue(os.path.samefile(cmd[3], abs_cfg))
            self.assertEqual(cmd[4], "watch")


class SpawnWatcher(unittest.TestCase):
    def _cfg(self, tmp):
        abs_cfg = os.path.join(tmp, "second-wind.json")
        with open(abs_cfg, "w") as f:
            json.dump({"session_prefix": "wind",
                       "repos": [{"name": "x", "path": "/tmp"}]}, f)
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "x", "path": "/tmp"}]
        cfg["_path"] = abs_cfg
        return cfg

    def test_spawns_detached_session_with_abs_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            rec = _TmuxRecorder(existing=[])
            with mock.patch.object(wind, "tmux", rec):
                wind.spawn_watcher(cfg)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(len(new), 1)
            # the joined shell command must reference the abs config path
            joined = " ".join(new[0])
            self.assertIn(cfg["_path"], joined)
            self.assertIn("watch", joined)

    def test_does_not_spawn_when_watcher_already_running(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            rec = _TmuxRecorder(existing=["wind-watcher"])
            with mock.patch.object(wind, "tmux", rec):
                wind.spawn_watcher(cfg)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(new, [])

    def test_warns_on_foreign_watcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            # a watcher under a different prefix is present
            rec = _TmuxRecorder(existing=["other-watcher"])
            logs = []
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "log",
                                      lambda msg, **k: logs.append(msg)):
                wind.spawn_watcher(cfg)
            self.assertTrue(any("other-watcher" in m for m in logs),
                            f"expected a foreign-watcher warning, got {logs}")


class CmdUpWatcherSpawn(unittest.TestCase):
    def _cfg(self, tmp):
        abs_cfg = os.path.join(tmp, "second-wind.json")
        with open(abs_cfg, "w") as f:
            json.dump({"repos": [{"name": "x", "path": tmp}]}, f)
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "x", "path": tmp}]
        cfg["_path"] = abs_cfg
        return cfg

    def test_up_auto_spawns_watcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.no_watch = False
            with mock.patch.object(wind, "tmux", rec):
                wind.cmd_up(cfg, args)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            watcher_new = [c for c in new
                           if "-s" in c and "wind-watcher" in c]
            self.assertTrue(watcher_new,
                            f"expected a watcher new-session, got {new}")
            self.assertIn("watch", " ".join(watcher_new[0]))

    def test_no_watch_skips_spawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.no_watch = True
            logs = []
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "log",
                                      lambda msg, **k: logs.append(msg)):
                wind.cmd_up(cfg, args)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            watcher_new = [c for c in new
                           if "-s" in c and "wind-watcher" in c]
            self.assertEqual(watcher_new, [])
            self.assertTrue(any("watch" in m.lower() for m in logs))

    def test_double_up_does_not_double_spawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            # second run: both repo session and watcher already exist
            rec = _TmuxRecorder(existing=["wind-x", "wind-watcher"])
            args = mock.Mock()
            args.no_watch = False
            with mock.patch.object(wind, "tmux", rec):
                wind.cmd_up(cfg, args)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(new, [])


class CmdDownReapsWatcher(unittest.TestCase):
    def test_down_kills_watcher_and_clears_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]
            rec = _TmuxRecorder(existing=["wind-x", "wind-watcher"])
            try:
                with mock.patch.object(wind, "tmux", rec):
                    wind.cmd_down(cfg, mock.Mock())
                kills = [c for c in rec.calls if c and c[0] == "kill-session"]
                killed = {c[2] for c in kills}
                self.assertIn("=wind-watcher", killed)
                self.assertIn("=wind-x", killed)
                self.assertEqual(wind.load_state(), {})
            finally:
                wind.STATE_PATH = orig

    def test_down_reaps_renamed_watcher_from_state(self):
        # The running watcher recorded a name that differs from the current
        # derived name (e.g. a prefix change between runs). wind down must
        # still reap the recorded identity.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["session_prefix"] = "wind"
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]
            # state records a watcher named under an old prefix
            wind.save_state({"watcher_session": "old-watcher",
                             "watcher_config": cfg.get("_path", "")})
            rec = _TmuxRecorder(existing=["old-watcher"])
            try:
                with mock.patch.object(wind, "tmux", rec):
                    wind.cmd_down(cfg, mock.Mock())
                kills = [c for c in rec.calls if c and c[0] == "kill-session"]
                killed = {c[2] for c in kills}
                self.assertIn("=old-watcher", killed)
                self.assertEqual(wind.load_state(), {})
            finally:
                wind.STATE_PATH = orig


class CmdWatchDetach(unittest.TestCase):
    def test_detach_reexecs_into_tmux_not_fork(self):
        with tempfile.TemporaryDirectory() as tmp:
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"repos": [{"name": "x", "path": "/tmp"}]}, f)
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]
            cfg["_path"] = abs_cfg
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.detach = True
            args.poll = None
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch("os.fork",
                               side_effect=AssertionError("must not fork")):
                wind.cmd_watch(cfg, args)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(len(new), 1)
            joined = " ".join(new[0])
            self.assertIn("watch", joined)
            self.assertIn(abs_cfg, joined)

    def test_detach_does_not_double_spawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"repos": [{"name": "x", "path": "/tmp"}]}, f)
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]
            cfg["_path"] = abs_cfg
            rec = _TmuxRecorder(existing=["wind-watcher"])
            args = mock.Mock()
            args.detach = True
            args.poll = None
            with mock.patch.object(wind, "tmux", rec):
                wind.cmd_watch(cfg, args)
            new = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(new, [])

    def test_foreground_watch_records_identity_in_state(self):
        # A non-detached watch run records its session name + resolved config
        # into state.json so wind down can reap it later. We stop the loop
        # immediately via a KeyboardInterrupt from the first watch_sleep.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"repos": [{"name": "x", "path": "/tmp"}]}, f)
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["session_prefix"] = "wind"
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]
            cfg["_path"] = abs_cfg
            cfg["caffeinate"] = False
            recorded = {}

            def capture_state(state):
                recorded.update(state)
                raise KeyboardInterrupt

            args = mock.Mock()
            args.detach = False
            args.poll = None
            try:
                with mock.patch.object(wind, "save_state", capture_state), \
                        mock.patch.object(wind, "session_exists",
                                          lambda n: False):
                    with self.assertRaises(KeyboardInterrupt):
                        wind.cmd_watch(cfg, args)
            finally:
                wind.STATE_PATH = orig
            self.assertEqual(recorded.get("watcher_session"), "wind-watcher")
            self.assertEqual(recorded.get("watcher_config"), abs_cfg)


if __name__ == "__main__":
    unittest.main()

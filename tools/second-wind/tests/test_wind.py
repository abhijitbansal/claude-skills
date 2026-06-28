"""Unit tests for Second Wind's parsing and classification logic.

Run: python3 -m unittest discover tests
"""

import argparse
import datetime
import importlib.util
import json
import os
import re
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


class ClearStatePreservesIdentity(unittest.TestCase):
    """B1: clear_state() must preserve watcher identity keys."""

    def test_clears_paused_and_reset_at_but_keeps_watcher_identity(self):
        # B1: clear_state() currently deletes the whole file, destroying
        # watcher_session/watcher_config that cmd_down needs to reap a
        # renamed watcher. Fix: clear only paused/reset_at.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = (wind.STATE_PATH, wind.LEGACY_STATE_PATH)
            wind.STATE_PATH = statef
            wind.LEGACY_STATE_PATH = os.path.join(tmp, "legacy.json")
            try:
                wind.save_state({
                    "paused": ["wind-x"],
                    "reset_at": 1234567890.0,
                    "watcher_session": "wind-watcher",
                    "watcher_config": "/home/user/.wind/config.json",
                })
                wind.clear_state()
                state = wind.load_state()
                self.assertNotIn("paused", state,
                                 "clear_state must remove paused")
                self.assertNotIn("reset_at", state,
                                 "clear_state must remove reset_at")
                self.assertEqual(state.get("watcher_session"), "wind-watcher",
                                 "clear_state must preserve watcher_session")
                self.assertEqual(state.get("watcher_config"),
                                 "/home/user/.wind/config.json",
                                 "clear_state must preserve watcher_config")
            finally:
                wind.STATE_PATH, wind.LEGACY_STATE_PATH = orig

    def test_clear_state_erases_file_when_only_bookkeeping_present(self):
        # When state has only paused/reset_at (no identity), clear_state
        # should leave no file (load_state returns {}).
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = (wind.STATE_PATH, wind.LEGACY_STATE_PATH)
            wind.STATE_PATH = statef
            wind.LEGACY_STATE_PATH = os.path.join(tmp, "legacy.json")
            try:
                wind.save_state({"paused": ["wind-x"], "reset_at": 1.0})
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
        # A per-repo claude_args is written only on an explicit override.
        e = wind.build_repo_entry("a", "/p", "--permission-mode plan",
                                  "~/x.md", override=True)
        self.assertEqual(e["claude_args"], "--permission-mode plan")
        self.assertEqual(e["prompt_file"], "~/x.md")

    def test_build_repo_entry_inherits_global_omits_args_key(self):
        # Without override, no per-repo claude_args key is written even if a
        # value is passed (inherit-global is the default branch).
        e = wind.build_repo_entry("a", "/p", "--permission-mode plan",
                                  "", override=False)
        self.assertNotIn("claude_args", e)

    def test_build_repo_entry_override_to_empty_writes_empty_key(self):
        # Overriding to the "default" preset records claude_args:"" so key-
        # presence resolution honors it as "no args" (not inherit-global).
        e = wind.build_repo_entry("a", "/p", "", "", override=True)
        self.assertEqual(e["claude_args"], "")

    def test_build_config_defaults_and_repos(self):
        cfg = wind.build_config([{"name": "a", "path": "/p"}], "", "")
        self.assertEqual(cfg["resume_message"], "continue")
        self.assertEqual(cfg["ntfy_url"], "")
        self.assertEqual(len(cfg["repos"]), 1)

    def test_build_config_overrides(self):
        cfg = wind.build_config([], "go on", "https://ntfy.sh/t")
        self.assertEqual(cfg["resume_message"], "go on")
        self.assertEqual(cfg["ntfy_url"], "https://ntfy.sh/t")

    def test_build_config_stores_global_claude_args(self):
        cfg = wind.build_config([], "", "",
                                claude_args="--permission-mode plan")
        self.assertEqual(cfg["claude_args"], "--permission-mode plan")


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
        wind.resume_sessions = (
            lambda cfg, repos:
            self.calls.append(("resume", tuple(
                wind.session_name(cfg, r) for r in repos)))
            or [wind.session_name(cfg, r) for r in repos])
        wind.clear_state = lambda: self.calls.append(("clear_state",))
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
        self.assertIn(("clear_state",), self.calls)

    def test_resume_single_session_does_not_clear_state(self):
        self.cfg["repos"].append({"name": "other", "path": "/tmp/other"})
        status, data = self._req("POST", "/api/resume",
                                 {"session": "wind-demo"}, token="tok123")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["resumed"], 1)
        self.assertIn(("resume", ("wind-demo",)), self.calls)
        self.assertNotIn(("resume", ("wind-other",)), self.calls)
        self.assertNotIn(("clear_state",), self.calls)

    def test_resume_unknown_session_rejected(self):
        status, _ = self._req("POST", "/api/resume", {"session": "bogus"},
                              token="tok123")
        self.assertEqual(status, 400)
        self.assertEqual(self.calls, [])

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


class DashApiPerSessionResumeUpdatesState(unittest.TestCase):
    """B2: per-session /api/resume must remove that session from persisted paused."""

    def setUp(self):
        self.cfg = dict(wind.DEFAULT_CONFIG)
        self.cfg["repos"] = [{"name": "s1", "path": "/tmp"},
                             {"name": "s2", "path": "/tmp"}]
        self.token = "tok-b2"
        self.saved_states = []
        self._orig = (wind.resume_sessions, wind.resume_orphans,
                      wind.load_state, wind.save_state, wind.clear_state)

        def fake_resume(cfg, repos):
            return [wind.session_name(cfg, r) for r in repos]

        wind.resume_sessions = fake_resume
        wind.resume_orphans = lambda cfg, names: []
        wind.clear_state = lambda: None

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
        (wind.resume_sessions, wind.resume_orphans,
         wind.load_state, wind.save_state, wind.clear_state) = self._orig

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

    def test_per_session_resume_removes_session_from_paused(self):
        # B2: resuming s1 must remove it from persisted paused; s2 is preserved.
        saved = []
        wind.load_state = lambda: {
            "paused": ["wind-s1", "wind-s2"],
            "reset_at": 9999999.0,
            "watcher_session": "wind-watcher",
        }
        wind.save_state = lambda s: saved.append(dict(s))

        status, data = self._req("POST", "/api/resume",
                                 {"session": "wind-s1"}, token="tok-b2")
        self.assertEqual(status, 200)
        self.assertTrue(saved, "per-session resume must call save_state")
        last = saved[-1]
        self.assertNotIn("wind-s1", last.get("paused", []),
                         "resumed session must be removed from paused")
        self.assertIn("wind-s2", last.get("paused", []),
                      "other session must remain in paused")
        self.assertIn("reset_at", last,
                      "reset_at must stay while other sessions remain paused")

    def test_per_session_resume_drops_reset_at_when_last_paused(self):
        # B2: resuming the last paused session must drop reset_at from state.
        saved = []
        wind.load_state = lambda: {
            "paused": ["wind-s1"],
            "reset_at": 9999999.0,
            "watcher_session": "wind-watcher",
        }
        wind.save_state = lambda s: saved.append(dict(s))

        status, _ = self._req("POST", "/api/resume",
                               {"session": "wind-s1"}, token="tok-b2")
        self.assertEqual(status, 200)
        self.assertTrue(saved, "must call save_state")
        last = saved[-1]
        self.assertNotIn("paused", last,
                         "paused must be absent when empty")
        self.assertNotIn("reset_at", last,
                         "reset_at must be dropped when paused becomes empty")
        self.assertEqual(last.get("watcher_session"), "wind-watcher",
                         "watcher identity must be preserved")


class DashApiResumeAllOrphans(unittest.TestCase):
    """B3: dashboard resume-all must also call resume_orphans for paused sessions
    not in cfg['repos']."""

    def setUp(self):
        self.cfg = dict(wind.DEFAULT_CONFIG)
        self.cfg["repos"] = [{"name": "active", "path": "/tmp"}]
        self.token = "tok-b3"
        self.orphan_calls = []
        self._orig = (wind.resume_sessions, wind.resume_orphans,
                      wind.load_state, wind.save_state, wind.clear_state)
        wind.resume_sessions = lambda cfg, repos: (
            [wind.session_name(cfg, r) for r in repos])
        wind.resume_orphans = (
            lambda cfg, names: self.orphan_calls.append(list(names)) or [])
        wind.clear_state = lambda: None
        wind.save_state = lambda s: None
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
        (wind.resume_sessions, wind.resume_orphans,
         wind.load_state, wind.save_state, wind.clear_state) = self._orig

    def _req(self, method, path, body=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json",
                   "X-Wind-Token": self.token}
        conn.request(method, path,
                     json.dumps(body) if body is not None else None, headers)
        resp = conn.getresponse()
        data = resp.read().decode()
        conn.close()
        return resp.status, data

    def test_resume_all_calls_resume_orphans_for_paused_non_repo_sessions(self):
        # B3: paused session 'wind-gone' is NOT in cfg['repos']; resume-all
        # must still nudge it via resume_orphans.
        wind.load_state = lambda: {
            "paused": ["wind-gone"],
            "reset_at": 1.0,
        }
        status, _ = self._req("POST", "/api/resume", {})
        self.assertEqual(status, 200)
        self.assertTrue(self.orphan_calls,
                        "dashboard resume-all must call resume_orphans for orphan paused sessions")
        self.assertIn("wind-gone", self.orphan_calls[0],
                      "orphan 'wind-gone' must be in the resume_orphans call")

    def test_resume_all_does_not_call_orphans_when_none_paused(self):
        # When no orphan paused sessions exist, resume_orphans is not called.
        wind.load_state = lambda: {}
        status, _ = self._req("POST", "/api/resume", {})
        self.assertEqual(status, 200)
        self.assertEqual(self.orphan_calls, [],
                         "resume_orphans must not be called when no orphans")


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
                              lambda roots: list(scan_result)), \
            mock.patch.object(wind, "_open_editor",
                              lambda path, ed: None), \
            mock.patch.object(wind, "_seed_prompt_file",
                              lambda path, name: None):
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
                # global preset "default"; per repo: inherit global (0),
                # agent claude (0), skip editor (0)
                selects=[2, 0, 0, 0],
                multiselects=[[0]],  # pick repo #0 (alpha)
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])

            self.assertEqual([r["name"] for r in cfg["repos"]], ["alpha"])
            self.assertEqual(cfg["repos"][0]["path"],
                             os.path.join(tmp, "alpha"))
            # Repo inherits the global preset -> no per-repo claude_args key.
            self.assertNotIn("claude_args", cfg["repos"][0])
            self.assertEqual(cfg["claude_args"], "")  # global "default" preset
            # A6 (fixed): empty answer at the prompt-file step now truly skips;
            # no prompt_file key is stored (old behavior pre-filled convention).
            self.assertNotIn("prompt_file", cfg["repos"][0])
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
                # global preset "default"; per repo: override -> acceptEdits (0);
                # agent claude (0); editor-offer (0 = skip)
                selects=[2, 1, 0, 0, 0],
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
                        selects=[2, 0, 0, 0],
                        multiselects=[[0]],
                        target=target,
                        scan_result=[("alpha",
                                      os.path.join(tmp, "alpha"))])
            self.assertFalse(os.path.exists(target))


class WizardPermissionPresets(unittest.TestCase):
    """Phase 3: global preset step + per-repo inherit/override branch."""

    def test_global_preset_chosen_all_repos_inherit(self):
        # Global preset acceptEdits; both repos inherit -> top-level
        # claude_args set, NO per-repo claude_args keys written.
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",  # scan roots
                    "",            # extra paths
                    "",            # repo alpha prompt file (skip default)
                    "",            # repo beta prompt file
                    "continue",    # resume message
                    "",            # ntfy
                ],
                # global preset acceptEdits (0);
                # alpha: inherit (0), agent claude (0), editor skip (0);
                # beta:  inherit (0), agent claude (0), editor skip (0)
                selects=[0, 0, 0, 0, 0, 0, 0],
                multiselects=[[0, 1]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha")),
                             ("beta", os.path.join(tmp, "beta"))])

            self.assertEqual(cfg["claude_args"],
                             "--permission-mode acceptEdits")
            for repo in cfg["repos"]:
                self.assertNotIn("claude_args", repo)

    def test_one_repo_overrides_only_that_repo_gets_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",  # scan roots
                    "",            # extra paths
                    "",            # alpha prompt file
                    "",            # beta prompt file
                    "continue",    # resume message
                    "",            # ntfy
                ],
                # global preset default (2);
                # alpha: override (1) -> plan preset (1), agent claude (0),
                #        editor skip (0);
                # beta:  inherit (0), agent claude (0), editor skip (0)
                selects=[2, 1, 1, 0, 0, 0, 0, 0],
                multiselects=[[0, 1]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha")),
                             ("beta", os.path.join(tmp, "beta"))])

            self.assertEqual(cfg["claude_args"], "")  # global default
            alpha = next(r for r in cfg["repos"] if r["name"] == "alpha")
            beta = next(r for r in cfg["repos"] if r["name"] == "beta")
            self.assertEqual(alpha["claude_args"], "--permission-mode plan")
            self.assertNotIn("claude_args", beta)

    def test_override_with_custom_args(self):
        # Override -> custom preset -> typed claude_args is stored per repo.
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",      # scan roots
                    "",                # extra paths
                    "--dangerous",     # custom claude_args for the override
                    "",                # prompt file
                    "continue",        # resume message
                    "",                # ntfy
                ],
                # global preset default (2);
                # alpha: override (1) -> custom preset (3), agent claude (0),
                #        editor skip (0)
                selects=[2, 1, 3, 0, 0],
                multiselects=[[0]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])

            self.assertEqual(cfg["claude_args"], "")
            self.assertEqual(cfg["repos"][0]["claude_args"], "--dangerous")

    def test_global_custom_preset_stored_top_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",       # scan roots
                    "",                 # extra paths
                    "--global-custom",  # custom global claude_args
                    "",                 # prompt file
                    "continue",         # resume message
                    "",                 # ntfy
                ],
                # global preset custom (3) -> typed args;
                # alpha: inherit (0), agent claude (0), editor skip (0)
                selects=[3, 0, 0, 0],
                multiselects=[[0]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])

            self.assertEqual(cfg["claude_args"], "--global-custom")
            self.assertNotIn("claude_args", cfg["repos"][0])

    def test_wizard_empty_skip_no_prompt_file(self):
        # A6: the prompt-file step pre-fills the convention path as default,
        # so pressing Enter (empty input) stores the convention path instead
        # of skipping. Fix: default="" so Enter truly skips.
        # We provide 4 selects; before the fix the 4th (editor-offer) is
        # consumed; after the fix it is not consumed (prompt_file is empty).
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "second-wind.json")
            cfg = drive_wizard(
                texts=[
                    "~/projects",  # scan roots
                    "",            # extra paths
                    "",            # prompt file — Enter should SKIP, not pre-fill
                    "continue",    # resume message
                    "",            # ntfy
                ],
                # global default (2); alpha: inherit (0), agent claude (0)
                # 4th select = editor-offer (only consumed before the fix).
                selects=[2, 0, 0, 0],
                multiselects=[[0]],
                target=target,
                scan_result=[("alpha", os.path.join(tmp, "alpha"))])
            self.assertNotIn(
                "prompt_file", cfg["repos"][0],
                "empty answer at prompt-file step must skip, not store convention path")


class CmdUpArgsPrecedence(unittest.TestCase):
    """Phase 3: cmd_up resolves claude_args by key-presence, logs the source."""

    def _run(self, tmp, cfg):
        cfg = dict(cfg)
        cfg.setdefault("session_prefix", "wind")
        cfg["_path"] = os.path.join(tmp, "second-wind.json")
        cfg["startup_delay_seconds"] = 0
        rec = _TmuxRecorder(existing=[])
        logs = []
        args = mock.Mock()
        args.no_watch = True
        with mock.patch.object(wind, "tmux", rec), \
                mock.patch.object(wind, "log",
                                  lambda msg, **k: logs.append(msg)):
            wind.cmd_up(cfg, args)
        send_keys = [c for c in rec.calls
                     if c and c[0] == "send-keys" and "Enter" in c]
        # First send-keys per session is the launch command.
        launch = send_keys[0]
        return launch, logs

    def test_uses_per_repo_args_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["claude_args"] = "--global"
            cfg["repos"] = [{"name": "x", "path": tmp,
                             "claude_args": "--repo"}]
            launch, logs = self._run(tmp, cfg)
            self.assertIn("--repo", " ".join(launch))
            self.assertNotIn("--global", " ".join(launch))

    def test_falls_back_to_global_when_repo_key_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["claude_args"] = "--global"
            cfg["repos"] = [{"name": "x", "path": tmp}]
            launch, logs = self._run(tmp, cfg)
            self.assertIn("--global", " ".join(launch))

    def test_explicit_empty_repo_args_honored_as_empty(self):
        # Per-repo claude_args:"" must NOT fall through to the global value;
        # key-presence wins, so the launch command carries no args.
        with tempfile.TemporaryDirectory() as tmp:
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["claude_args"] = "--global"
            cfg["repos"] = [{"name": "x", "path": tmp, "claude_args": ""}]
            launch, logs = self._run(tmp, cfg)
            self.assertNotIn("--global", " ".join(launch))
            # The command is just the bare claude binary (plus tmux framing).
            self.assertNotIn("--", " ".join(launch).replace("send-keys", ""))

    def test_logs_which_source_supplied_args(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["claude_args"] = "--global"
            cfg["repos"] = [{"name": "x", "path": tmp,
                             "claude_args": "--repo"}]
            _, logs = self._run(tmp, cfg)
            self.assertTrue(any("per-repo" in m for m in logs),
                            f"expected an args-source log, got {logs}")


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

    def test_poll_is_threaded_through_after_watch(self):
        # `watch --poll N --detach` must not drop --poll: the detached argv
        # carries it so the watcher honors N instead of config fallback.
        with tempfile.TemporaryDirectory() as tmp:
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"repos": [{"name": "x", "path": "/tmp"}]}, f)
            cmd = wind.build_watcher_command({"_path": abs_cfg}, poll=30)
            self.assertEqual(cmd[4], "watch")
            self.assertIn("--poll", cmd)
            self.assertIn("30", cmd)
            self.assertEqual(cmd[cmd.index("--poll") + 1], "30")

    def test_no_poll_omits_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            abs_cfg = os.path.join(tmp, "second-wind.json")
            with open(abs_cfg, "w") as f:
                json.dump({"repos": [{"name": "x", "path": "/tmp"}]}, f)
            cmd = wind.build_watcher_command({"_path": abs_cfg})
            self.assertNotIn("--poll", cmd)


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

    def test_foreign_watcher_prevents_spawn(self):
        # B5: when a foreign watcher session exists, spawn_watcher must NOT
        # spawn a second one — it must log a warning and return without
        # creating any new tmux session.
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp)
            rec = _TmuxRecorder(existing=["other-watcher"])
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "log", lambda msg, **k: None):
                result = wind.spawn_watcher(cfg)
            new_sessions = [c for c in rec.calls if c and c[0] == "new-session"]
            self.assertEqual(new_sessions, [],
                             "foreign watcher must prevent spawning a second watcher")
            self.assertIs(result, False,
                          "spawn_watcher must return False when refusing a foreign")


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


class CmdUpClearsStaleState(unittest.TestCase):
    """B4: cmd_up must clear stale paused/reset_at for freshly-launched sessions."""

    def _cfg(self, tmp):
        abs_cfg = os.path.join(tmp, "second-wind.json")
        with open(abs_cfg, "w") as f:
            json.dump({"repos": [{"name": "x", "path": tmp}]}, f)
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "x", "path": tmp}]
        cfg["_path"] = abs_cfg
        cfg["startup_delay_seconds"] = 0
        return cfg

    def test_up_clears_paused_entry_for_launched_session(self):
        # B4: if wind-x is in state['paused'] before cmd_up launches it,
        # the stale paused entry and reset_at must be removed before the
        # watcher starts (otherwise the watcher fires a spurious first-poll
        # resume + cooldown).
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = self._cfg(tmp)
            wind.save_state({
                "paused": ["wind-x"],
                "reset_at": 1.0,
                "watcher_session": "wind-watcher",
                "watcher_config": cfg["_path"],
            })
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.no_watch = True  # skip actual watcher spawn, test state only
            try:
                with mock.patch.object(wind, "tmux", rec):
                    wind.cmd_up(cfg, args)
                state = wind.load_state()
                self.assertNotIn(
                    "wind-x", state.get("paused", []),
                    "cmd_up must remove launched session from stale paused state")
                self.assertNotIn(
                    "reset_at", state,
                    "cmd_up must drop reset_at when no paused sessions remain")
            finally:
                wind.STATE_PATH = orig

    def test_up_preserves_other_paused_sessions(self):
        # B4: clearing stale state for a launched session must not disturb
        # other paused sessions.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = self._cfg(tmp)
            wind.save_state({
                "paused": ["wind-x", "wind-other"],
                "reset_at": 1.0,
                "watcher_session": "wind-watcher",
            })
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.no_watch = True
            try:
                with mock.patch.object(wind, "tmux", rec):
                    wind.cmd_up(cfg, args)
                state = wind.load_state()
                self.assertNotIn("wind-x", state.get("paused", []))
                self.assertIn("wind-other", state.get("paused", []),
                              "other paused sessions must be preserved")
                self.assertIn("reset_at", state,
                              "reset_at must stay when other sessions remain paused")
            finally:
                wind.STATE_PATH = orig


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


class PromptPath(unittest.TestCase):
    def test_convention_path_for_simple_name(self):
        path = wind._prompt_path("api")
        self.assertEqual(
            path,
            os.path.expanduser(os.path.join(wind.WIND_HOME, "prompts",
                                            "api.md")))

    def test_name_with_space_is_safe(self):
        # A repo named "a b" yields a safe single-component filename.
        path = wind._prompt_path("a b")
        self.assertEqual(os.path.basename(path), "a b.md")
        self.assertEqual(
            os.path.dirname(path),
            os.path.expanduser(os.path.join(wind.WIND_HOME, "prompts")))

    def test_name_with_slash_is_rejected(self):
        with self.assertRaises(ValueError):
            wind._prompt_path("a/b")

    def test_name_with_dotdot_is_rejected(self):
        with self.assertRaises(ValueError):
            wind._prompt_path("..")

    def test_name_with_dotdot_segment_is_rejected(self):
        with self.assertRaises(ValueError):
            wind._prompt_path("../etc/passwd")

    def test_empty_name_is_rejected(self):
        with self.assertRaises(ValueError):
            wind._prompt_path("")


class FirstAvailable(unittest.TestCase):
    def test_returns_first_found(self):
        with mock.patch("shutil.which",
                        side_effect=lambda n: "/usr/bin/" + n
                        if n == "nano" else None):
            self.assertEqual(wind._first_available("vi", "nano"), "nano")

    def test_falls_back_to_first_when_none_found(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertEqual(wind._first_available("vi", "nano"), "vi")


class EditorCommand(unittest.TestCase):
    def test_uses_explicit_editor_arg(self):
        with mock.patch("shutil.which", return_value="/usr/bin/vim"):
            cmd = wind._editor_command("vim", "/tmp/p.md")
        self.assertEqual(cmd, ["vim", "/tmp/p.md"])

    def test_splits_multiword_editor_env(self):
        # EDITOR="code --wait" must split into a list, not ENOENT the string.
        with mock.patch.dict(os.environ, {"EDITOR": "code --wait"}), \
                mock.patch("shutil.which", return_value="/usr/bin/code"):
            cmd = wind._editor_command(None, "/tmp/p.md")
        self.assertEqual(cmd, ["code", "--wait", "/tmp/p.md"])

    def test_falls_back_to_vi_then_nano(self):
        # No --editor, no EDITOR; vi missing, nano present -> nano.
        def which(name):
            return "/usr/bin/nano" if name == "nano" else None
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch("shutil.which", side_effect=which):
            cmd = wind._editor_command(None, "/tmp/p.md")
        self.assertEqual(cmd, ["nano", "/tmp/p.md"])

    def test_unknown_editor_binary_dies(self):
        with mock.patch.dict(os.environ, {"EDITOR": "doesnotexist123"}), \
                mock.patch("shutil.which", return_value=None):
            with self.assertRaises(SystemExit):
                wind._editor_command(None, "/tmp/p.md")

    def test_editor_command_unbalanced_quote(self):
        # A2: shlex.split raises ValueError on unbalanced quotes; must die(),
        # not propagate ValueError.
        with mock.patch.dict(os.environ, {"EDITOR": 'code "--wait'}):
            with self.assertRaises(SystemExit):
                wind._editor_command(None, "/tmp/p.md")


class SeedPromptFile(unittest.TestCase):
    def test_seed_prompt_file_bare_filename(self):
        # A1: os.path.dirname("PROMPT.md") == "" -> makedirs("") crashes.
        # Fix: use dirname or "." so bare filenames work.
        with tempfile.TemporaryDirectory() as tmp:
            orig_cwd = os.getcwd()
            try:
                os.chdir(tmp)
                wind._seed_prompt_file("PROMPT.md", "test-repo")
                self.assertTrue(os.path.isfile("PROMPT.md"))
            finally:
                os.chdir(orig_cwd)


class CmdPrompt(unittest.TestCase):
    def _cfg(self, repos):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = repos
        return cfg

    def test_creates_file_seeds_template_and_wires_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            home = os.path.join(tmp, "home")
            cfg = self._cfg([{"name": "foo", "path": "/tmp"}])
            cfg["_path"] = cfg_path
            wind.atomic_write_json(cfg_path, {k: v for k, v in cfg.items()
                                              if k != "_path"}, mode=0o644)
            opened = []
            args = mock.Mock()
            args.repo = "foo"
            args.editor = None
            expected = os.path.join(home, "prompts", "foo.md")
            with mock.patch.object(wind, "WIND_HOME", home), \
                    mock.patch.object(
                        wind, "_open_editor",
                        lambda path, ed: opened.append(path)):
                wind.cmd_prompt(cfg, args)
            # File created with a template comment.
            self.assertTrue(os.path.isfile(expected))
            with open(expected) as f:
                seeded = f.read()
            self.assertIn("foo", seeded)
            self.assertTrue(seeded.lstrip().startswith("<!--")
                            or seeded.lstrip().startswith("#"))
            # Editor opened on the convention path.
            self.assertEqual(opened, [expected])
            # Config wired prompt_file to the convention path, atomically.
            saved = wind.load_existing_config(cfg_path)
            foo = next(r for r in saved["repos"] if r["name"] == "foo")
            self.assertEqual(foo.get("prompt_file"), expected)

    def test_unknown_repo_dies(self):
        cfg = self._cfg([{"name": "foo", "path": "/tmp"}])
        cfg["_path"] = "/tmp/x.json"
        args = mock.Mock()
        args.repo = "missing"
        args.editor = None
        with self.assertRaises(SystemExit):
            wind.cmd_prompt(cfg, args)

    def test_inline_prompt_repo_wires_prompt_file_and_removes_inline(self):
        # A3 (fixed): cmd_prompt on a repo with inline `prompt` now wires
        # prompt_file to the convention path and removes the inline `prompt`
        # so cmd_up uses the file on the next run.
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            home = os.path.join(tmp, "home")
            cfg = self._cfg([{"name": "web", "path": "/tmp",
                              "prompt": "do the thing"}])
            cfg["_path"] = cfg_path
            wind.atomic_write_json(cfg_path, {"repos": cfg["repos"]},
                                   mode=0o644)
            args = mock.Mock()
            args.repo = "web"
            args.editor = None
            with mock.patch.object(wind, "WIND_HOME", home), \
                    mock.patch.object(wind, "_open_editor",
                                      lambda path, ed: None):
                wind.cmd_prompt(cfg, args)
            saved = wind.load_existing_config(cfg_path)
            web = next(r for r in saved["repos"] if r["name"] == "web")
            self.assertIn("prompt_file", web,
                          "cmd_prompt must wire prompt_file for inline-prompt repo")
            self.assertNotIn("prompt", web,
                             "cmd_prompt must remove inline prompt when wiring file")

    def test_no_matching_raw_repo_warns_and_leaves_config_unchanged(self):
        # The on-disk config has no "repos" key, so the merged cfg carries the
        # repo from DEFAULT_CONFIG. cmd_prompt must NOT claim success or rewrite
        # the file: it warns and leaves the config byte-identical.
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            home = os.path.join(tmp, "home")
            # Raw config without "repos" — only an unrelated key.
            wind.atomic_write_json(cfg_path, {"session_prefix": "wind"},
                                   mode=0o644)
            with open(cfg_path) as f:
                before = f.read()
            cfg = self._cfg([{"name": "ghost", "path": "/tmp"}])
            cfg["_path"] = cfg_path
            args = mock.Mock()
            args.repo = "ghost"
            args.editor = None
            logs = []
            with mock.patch.object(wind, "WIND_HOME", home), \
                    mock.patch.object(wind, "_open_editor",
                                      lambda path, ed: None), \
                    mock.patch.object(wind, "log",
                                      lambda msg, **k: logs.append(msg)):
                wind.cmd_prompt(cfg, args)
            with open(cfg_path) as f:
                after = f.read()
            self.assertEqual(before, after,
                             "config must be unchanged when no raw repo matches")
            self.assertTrue(any("not found" in m for m in logs),
                            f"expected a not-found warning, got {logs}")
            self.assertFalse(any("wired prompt_file" in m for m in logs),
                             f"must not claim wiring success, got {logs}")

    def test_existing_prompt_file_is_not_reseeded(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            pf = os.path.join(tmp, "api.md")
            with open(pf, "w") as f:
                f.write("my real prompt")
            cfg = self._cfg([{"name": "api", "path": "/tmp",
                              "prompt_file": pf}])
            cfg["_path"] = cfg_path
            wind.atomic_write_json(cfg_path, {"repos": cfg["repos"]},
                                   mode=0o644)
            args = mock.Mock()
            args.repo = "api"
            args.editor = None
            with mock.patch.object(wind, "_open_editor",
                                   lambda path, ed: None):
                wind.cmd_prompt(cfg, args)
            with open(pf) as f:
                self.assertEqual(f.read(), "my real prompt")

    def test_cmd_prompt_inline_wires_prompt_file(self):
        # A3: repo with inline `prompt` currently never wires prompt_file.
        # After the fix, cmd_prompt removes the inline prompt and wires
        # prompt_file so cmd_up uses the file on the next run.
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            home = os.path.join(tmp, "home")
            raw_repo = {"name": "r", "path": "/tmp/x", "prompt": "old inline"}
            cfg = self._cfg([dict(raw_repo)])
            cfg["_path"] = cfg_path
            wind.atomic_write_json(cfg_path, {"repos": [raw_repo]}, mode=0o644)
            args = mock.Mock()
            args.repo = "r"
            args.editor = None
            with mock.patch.object(wind, "WIND_HOME", home), \
                    mock.patch.object(wind, "_open_editor",
                                      lambda path, ed: None):
                wind.cmd_prompt(cfg, args)
            with open(cfg_path) as f:
                saved = json.load(f)
            r = next(x for x in saved["repos"] if x["name"] == "r")
            self.assertIn("prompt_file", r,
                          "cmd_prompt must wire prompt_file for inline-prompt repo")
            self.assertNotIn("prompt", r,
                             "cmd_prompt must remove inline prompt when wiring file")

    def test_cmd_prompt_relative_path_resolves_vs_repo(self):
        # A4: a relative prompt_file like "PROMPT.md" must resolve against
        # the repo's path, matching how cmd_up resolves it at runtime.
        with tempfile.TemporaryDirectory() as tmp:
            repo_dir = os.path.join(tmp, "myrepo")
            os.makedirs(repo_dir)
            cfg_path = os.path.join(tmp, "second-wind.json")
            pf_abs = os.path.join(repo_dir, "PROMPT.md")
            with open(pf_abs, "w") as f:
                f.write("real content")
            cfg = self._cfg([{"name": "myr", "path": repo_dir,
                               "prompt_file": "PROMPT.md"}])
            cfg["_path"] = cfg_path
            wind.atomic_write_json(cfg_path, {"repos": cfg["repos"]}, mode=0o644)
            opened = []
            args = mock.Mock()
            args.repo = "myr"
            args.editor = None
            with mock.patch.object(wind, "_open_editor",
                                   lambda path, ed: opened.append(path)), \
                    mock.patch.object(wind, "_seed_prompt_file",
                                      lambda path, name: None):
                wind.cmd_prompt(cfg, args)
            self.assertEqual(opened, [pf_abs],
                             "relative prompt_file must resolve vs repo path")


class CmdUpInlinePrompt(unittest.TestCase):
    def _cfg(self, tmp, repos):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = repos
        cfg["_path"] = os.path.join(tmp, "second-wind.json")
        cfg["startup_delay_seconds"] = 0
        return cfg

    def test_inline_only_repo_is_sent_its_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp, [{"name": "web", "path": tmp,
                                   "prompt": "continue the refactor"}])
            rec = _TmuxRecorder(existing=[])
            sent = []
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text",
                                      lambda n, t: sent.append((n, t))):
                wind.cmd_up(cfg, args)
            self.assertIn(("wind-web", "continue the refactor"), sent)

    def test_inline_prompt_wins_over_prompt_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            pf = os.path.join(tmp, "web.md")
            with open(pf, "w") as f:
                f.write("from file")
            cfg = self._cfg(tmp, [{"name": "web", "path": tmp,
                                   "prompt": "from inline",
                                   "prompt_file": pf}])
            rec = _TmuxRecorder(existing=[])
            sent = []
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text",
                                      lambda n, t: sent.append((n, t))):
                wind.cmd_up(cfg, args)
            self.assertIn(("wind-web", "from inline"), sent)
            self.assertNotIn(("wind-web", "from file"), sent)

    def test_filter_does_not_drop_inline_only_repo(self):
        # Regression: the old filter [(r,n) ... if r.get("prompt_file")]
        # silently dropped inline-only repos. With an inline-only repo and a
        # zero startup delay, send_text must still fire.
        with tempfile.TemporaryDirectory() as tmp:
            cfg = self._cfg(tmp, [{"name": "web", "path": tmp,
                                   "prompt": "hello"}])
            rec = _TmuxRecorder(existing=[])
            sent = []
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text",
                                      lambda n, t: sent.append((n, t))):
                wind.cmd_up(cfg, args)
            self.assertEqual(len(sent), 1)

    def test_cmd_up_skips_unedited_seed(self):
        # A5: if the user never edited the seed template, cmd_up must warn
        # and skip instead of sending the template lines verbatim.
        with tempfile.TemporaryDirectory() as tmp:
            pf = os.path.join(tmp, "myrepo.md")
            wind._seed_prompt_file(pf, "myrepo")
            cfg = self._cfg(tmp, [{"name": "myrepo", "path": tmp,
                                   "prompt_file": pf}])
            rec = _TmuxRecorder(existing=[])
            sent = []
            warnings = []
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text",
                                      lambda n, t: sent.append((n, t))), \
                    mock.patch.object(wind, "log",
                                      lambda msg, **k: warnings.append(msg)):
                wind.cmd_up(cfg, args)
            self.assertEqual(sent, [],
                             "unedited seed file must not be sent")
            self.assertTrue(
                any("seed" in w.lower() or "unedited" in w.lower()
                    or "skip" in w.lower() or "template" in w.lower()
                    for w in warnings),
                f"expected a warning about unedited seed, got: {warnings}")

    def test_cmd_up_preserves_real_heading(self):
        # A5: a real prompt file that starts with a heading (not a seed line)
        # must be sent in full, including the heading.
        with tempfile.TemporaryDirectory() as tmp:
            pf = os.path.join(tmp, "myrepo.md")
            with open(pf, "w") as f:
                f.write("# My heading\nDo the thing")
            cfg = self._cfg(tmp, [{"name": "myrepo", "path": tmp,
                                   "prompt_file": pf}])
            rec = _TmuxRecorder(existing=[])
            sent = []
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text",
                                      lambda n, t: sent.append((n, t))):
                wind.cmd_up(cfg, args)
            self.assertEqual(len(sent), 1, "real prompt must be sent")
            self.assertIn("# My heading", sent[0][1])
            self.assertIn("Do the thing", sent[0][1])


class BuildRepoEntryPrompt(unittest.TestCase):
    def test_inline_prompt_is_carried(self):
        e = wind.build_repo_entry("a", "/p", "", "", prompt="go on")
        self.assertEqual(e["prompt"], "go on")
        self.assertNotIn("prompt_file", e)

    def test_no_prompt_keys_when_empty(self):
        e = wind.build_repo_entry("a", "/p", "", "")
        self.assertNotIn("prompt", e)
        self.assertNotIn("prompt_file", e)


ESC = "\x1b"


class StripEscapesStripAll(unittest.TestCase):
    """strip_ansi (preserve_sgr=False) removes every escape, as before."""

    def test_removes_sgr_color(self):
        self.assertEqual(wind.strip_ansi(f"{ESC}[31mred{ESC}[0m"), "red")

    def test_removes_cursor_movement_csi(self):
        self.assertEqual(wind.strip_ansi(f"a{ESC}[2Jb"), "ab")

    def test_removes_osc_title_sequence(self):
        self.assertEqual(
            wind.strip_ansi(f"x{ESC}]0;window title\x07y"), "xy")

    def test_keeps_plain_text(self):
        self.assertEqual(wind.strip_ansi("hello world"), "hello world")


class StripEscapesPreserveSgr(unittest.TestCase):
    """The /api/pane path keeps only allowlisted SGR, drops everything else."""

    def test_keeps_basic_red(self):
        out = wind._strip_escapes(f"{ESC}[31mred{ESC}[0m", preserve_sgr=True)
        self.assertEqual(out, f"{ESC}[31mred{ESC}[0m")

    def test_keeps_bright_and_bg_and_256(self):
        seq = f"{ESC}[1;38;5;200mhi{ESC}[0m"
        out = wind._strip_escapes(seq, preserve_sgr=True)
        self.assertEqual(out, seq)

    def test_drops_truecolor_fg(self):
        # 38;2;R;G;B is an SGR ending in m; it must still be dropped.
        out = wind._strip_escapes(
            f"{ESC}[38;2;255;0;0mred{ESC}[0m", preserve_sgr=True)
        self.assertEqual(out, f"red{ESC}[0m")

    def test_drops_truecolor_bg(self):
        out = wind._strip_escapes(
            f"{ESC}[48;2;1;2;3mx{ESC}[0m", preserve_sgr=True)
        self.assertEqual(out, f"x{ESC}[0m")

    def test_drops_out_of_palette_256(self):
        out = wind._strip_escapes(
            f"{ESC}[38;5;999mx{ESC}[0m", preserve_sgr=True)
        self.assertEqual(out, f"x{ESC}[0m")

    def test_drops_osc_even_when_preserving_sgr(self):
        out = wind._strip_escapes(
            f"a{ESC}]0;title\x07b", preserve_sgr=True)
        self.assertEqual(out, "ab")

    def test_drops_dcs_string(self):
        out = wind._strip_escapes(
            f"a{ESC}Psome dcs payload{ESC}\\b", preserve_sgr=True)
        self.assertEqual(out, "ab")

    def test_drops_cursor_movement_csi(self):
        out = wind._strip_escapes(f"a{ESC}[2Jb", preserve_sgr=True)
        self.assertEqual(out, "ab")

    def test_drops_8bit_c1_csi_and_osc(self):
        # 0x9b = CSI, 0x9d = OSC in 8-bit C1 form.
        out = wind._strip_escapes(
            "a\x9b31mb\x9d0;t\x07c", preserve_sgr=True)
        self.assertEqual(out, "abc")

    def test_drops_out_of_allowlist_simple_codes(self):
        # 7 (reverse video) is not in the allowlist; the whole SGR is dropped
        # if it carries no allowlisted code.
        out = wind._strip_escapes(f"{ESC}[7mx", preserve_sgr=True)
        self.assertEqual(out, "x")


class _FakeHeaders:
    def __init__(self, mapping):
        self._m = mapping

    def get(self, key, default=None):
        return self._m.get(key, default)


class _RecordingHandler:
    """Minimal stand-in for the BaseHTTPRequestHandler subclass under test.

    We bypass __init__ (which would talk to a socket) and capture the single
    _send call each request path makes.
    """

    def __init__(self, handler_cls, path, headers):
        self.path = path
        self.headers = _FakeHeaders(headers)
        self.sent = None
        # Bind the real handler methods to this object.
        self.do_GET = handler_cls.do_GET.__get__(self, handler_cls)
        self._serve_pane = handler_cls._serve_pane.__get__(self, handler_cls)

    def _send(self, code, body, ctype="application/json"):
        self.sent = (code, body, ctype)

    def _host_allowed(self):
        return True


class ApiPaneEndpoint(unittest.TestCase):
    TOKEN = "secret-token"

    def _handler_cls(self, cfg):
        return wind.make_dash_handler(cfg, self.TOKEN, "<html>")

    def _cfg(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "api", "path": "/tmp"}]
        return cfg

    def _get(self, cfg, path, headers):
        handler_cls = self._handler_cls(cfg)
        h = _RecordingHandler(handler_cls, path, headers)
        h.do_GET()
        return h.sent

    def test_missing_token_returns_401(self):
        cfg = self._cfg()
        with mock.patch.object(wind, "capture_pane", lambda n, l: ""):
            code, body, _ = self._get(
                cfg, "/api/pane?session=wind-api&lines=100", {})
        self.assertEqual(code, 401)
        self.assertNotIn("api", body)  # no pane/session content leaked

    def test_bad_token_returns_401(self):
        cfg = self._cfg()
        code, body, _ = self._get(
            cfg, "/api/pane?session=wind-api",
            {"X-Wind-Token": "wrong"})
        self.assertEqual(code, 401)

    def test_unknown_session_returns_400_no_content(self):
        cfg = self._cfg()
        code, body, _ = self._get(
            cfg, "/api/pane?session=wind-nope",
            {"X-Wind-Token": self.TOKEN})
        self.assertEqual(code, 400)
        self.assertNotIn("nope", body)

    def test_missing_session_returns_400(self):
        cfg = self._cfg()
        code, body, _ = self._get(
            cfg, "/api/pane?lines=50",
            {"X-Wind-Token": self.TOKEN})
        self.assertEqual(code, 400)

    def test_valid_session_returns_content(self):
        cfg = self._cfg()
        captured = {}

        def fake_capture(name, lines, escapes=False):
            captured["name"] = name
            captured["lines"] = lines
            return f"{ESC}[31mred{ESC}[0m\nplain\n"

        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "capture_pane", fake_capture):
            code, body, _ = self._get(
                cfg, "/api/pane?session=wind-api&lines=120",
                {"X-Wind-Token": self.TOKEN})
        self.assertEqual(code, 200)
        data = json.loads(body)
        self.assertTrue(data["ok"])
        self.assertEqual(data["session"], "wind-api")
        self.assertIn(f"{ESC}[31m", data["content"])  # red preserved
        self.assertEqual(captured["lines"], 120)

    def test_lines_clamped_to_max(self):
        cfg = self._cfg()
        captured = {}

        def fake_capture(name, lines, escapes=False):
            captured["lines"] = lines
            return ""

        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "capture_pane", fake_capture):
            self._get(
                cfg, "/api/pane?session=wind-api&lines=99999",
                {"X-Wind-Token": self.TOKEN})
        self.assertEqual(captured["lines"], wind.MAX_PANE_LINES)

    def test_lines_defaults_to_modal_lines(self):
        cfg = self._cfg()
        captured = {}

        def fake_capture(name, lines, escapes=False):
            captured["lines"] = lines
            return ""

        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "capture_pane", fake_capture):
            self._get(
                cfg, "/api/pane?session=wind-api",
                {"X-Wind-Token": self.TOKEN})
        self.assertEqual(captured["lines"], wind.MODAL_LINES)

    def test_non_positive_lines_clamped_to_one(self):
        cfg = self._cfg()
        captured = {}

        def fake_capture(name, lines, escapes=False):
            captured["lines"] = lines
            return ""

        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "capture_pane", fake_capture):
            self._get(
                cfg, "/api/pane?session=wind-api&lines=0",
                {"X-Wind-Token": self.TOKEN})
        self.assertEqual(captured["lines"], 1)


class GetPaneExtended(unittest.TestCase):
    def _cfg(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "api", "path": "/tmp"}]
        return cfg

    def test_strips_truecolor_keeps_red(self):
        cfg = self._cfg()
        raw = f"{ESC}[31mred{ESC}[38;2;1;2;3mtrue{ESC}[0m"
        with mock.patch.object(wind, "capture_pane",
                               lambda n, l, escapes=False: raw):
            out = wind.get_pane_extended(cfg, "wind-api", 100)
        self.assertIn(f"{ESC}[31m", out)
        self.assertNotIn("38;2", out)
        self.assertIn("red", out)
        self.assertIn("true", out)


class ResolveAgentPrecedence(unittest.TestCase):
    """Phase 5 (C2): one assertion per cell of the key-presence precedence."""

    def _cfg(self, **over):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg.update(over)
        return cfg

    def test_defaults_to_claude_when_no_agent_keys(self):
        agent = wind.resolve_agent({}, self._cfg())
        self.assertEqual(agent["name"], "claude")
        self.assertEqual(agent["cmd"], "claude")
        self.assertTrue(agent["watch"])
        self.assertEqual(agent["resume_message"], "continue")
        self.assertEqual(agent["limit_patterns"],
                         wind.DEFAULT_LIMIT_PATTERNS)

    def test_top_level_agent_selects_preset(self):
        agent = wind.resolve_agent({}, self._cfg(agent="copilot"))
        self.assertEqual(agent["name"], "copilot")
        self.assertEqual(agent["cmd"], "copilot")
        self.assertFalse(agent["watch"])
        self.assertEqual(agent["resume_message"],
                         "Please continue where you left off.")
        self.assertEqual(agent["limit_patterns"], [])

    def test_per_repo_agent_overrides_top_level(self):
        cfg = self._cfg(agent="claude")
        agent = wind.resolve_agent({"agent": "copilot"}, cfg)
        self.assertEqual(agent["name"], "copilot")
        self.assertEqual(agent["cmd"], "copilot")

    def test_unknown_agent_dies(self):
        with self.assertRaises(SystemExit):
            wind.resolve_agent({"agent": "bogus"}, self._cfg())

    def test_explicit_empty_agent_dies_not_silent_claude(self):
        # An explicitly-set-but-empty agent is a config error, surfaced via the
        # unknown-agent die() rather than silently falling back to claude.
        with self.assertRaises(SystemExit):
            wind.resolve_agent({"agent": ""}, self._cfg())
        with self.assertRaises(SystemExit):
            wind.resolve_agent({}, self._cfg(agent=""))

    def test_copilot_cmd_from_preset_not_top_level_claude_cmd(self):
        # DEFAULT_CONFIG always carries top-level claude_cmd:"claude"; a copilot
        # repo's cmd must still come from the preset, not that top-level key.
        cfg = self._cfg()  # claude_cmd == "claude" present
        agent = wind.resolve_agent({"agent": "copilot"}, cfg)
        self.assertEqual(agent["cmd"], "copilot")

    def test_per_repo_claude_cmd_overrides_preset(self):
        cfg = self._cfg()
        agent = wind.resolve_agent(
            {"agent": "copilot", "claude_cmd": "copilot-beta"}, cfg)
        self.assertEqual(agent["cmd"], "copilot-beta")

    def test_per_repo_claude_args_wins_for_claude(self):
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({"claude_args": "--repo"}, cfg)
        self.assertEqual(agent["args"], "--repo")

    def test_top_level_claude_args_used_for_claude_when_repo_absent(self):
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({}, cfg)
        self.assertEqual(agent["args"], "--global")

    def test_explicit_empty_repo_args_honored_for_claude(self):
        # Per-repo claude_args:"" must NOT fall through to the global value.
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({"claude_args": ""}, cfg)
        self.assertEqual(agent["args"], "")

    def test_copilot_args_from_preset_not_top_level(self):
        # Top-level claude_args is for claude; copilot uses its preset args
        # ("") unless the repo explicitly overrides.
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({"agent": "copilot"}, cfg)
        self.assertEqual(agent["args"], "")

    def test_copilot_repo_args_override_preset(self):
        cfg = self._cfg()
        agent = wind.resolve_agent(
            {"agent": "copilot", "claude_args": "--yolo"}, cfg)
        self.assertEqual(agent["args"], "--yolo")

    def test_resume_message_from_top_level_for_claude(self):
        cfg = self._cfg(resume_message="keep going")
        agent = wind.resolve_agent({}, cfg)
        self.assertEqual(agent["resume_message"], "keep going")

    def test_copilot_resume_message_from_preset_when_no_top_level_key(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        del cfg["resume_message"]
        agent = wind.resolve_agent({"agent": "copilot"}, cfg)
        self.assertEqual(agent["resume_message"],
                         "Please continue where you left off.")

    # C1: empty claude_cmd must fall back to default, not become an empty cmd
    def test_explicit_empty_claude_cmd_falls_back_to_default(self):
        # Repo with claude_cmd:"" must resolve to the preset/global default, not "".
        cfg = self._cfg()  # DEFAULT_CONFIG has top-level claude_cmd:"claude"
        agent = wind.resolve_agent({"claude_cmd": ""}, cfg)
        self.assertNotEqual(agent["cmd"], "")
        self.assertEqual(agent["cmd"], "claude")

    def test_explicit_empty_claude_cmd_for_copilot_falls_back_to_preset(self):
        # Copilot repo with claude_cmd:"" must get "copilot" from the preset.
        cfg = self._cfg()
        agent = wind.resolve_agent({"agent": "copilot", "claude_cmd": ""}, cfg)
        self.assertEqual(agent["cmd"], "copilot")

    # C2: resolve_agent must return args_source so cmd_up can't disagree
    def test_args_source_returned_per_repo(self):
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({"claude_args": "--repo"}, cfg)
        self.assertEqual(agent["args_source"], "per-repo")

    def test_args_source_returned_global(self):
        cfg = self._cfg(claude_args="--global")
        agent = wind.resolve_agent({}, cfg)
        self.assertEqual(agent["args_source"], "global")

    def test_copilot_args_source_is_preset_not_global(self):
        # Copilot ignores global claude_args; source must say "preset" not "global".
        cfg = self._cfg(claude_args="--some-global")
        agent = wind.resolve_agent({"agent": "copilot"}, cfg)
        self.assertEqual(agent["args"], "")
        self.assertEqual(agent["args_source"], "preset")

    def test_args_source_returned_preset_when_no_keys(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        del cfg["claude_args"]
        agent = wind.resolve_agent({}, cfg)
        self.assertEqual(agent["args_source"], "preset")

    # C3: limit_patterns must be a copy, not the shared global list
    def test_limit_patterns_is_copy_not_reference(self):
        agent = wind.resolve_agent({}, self._cfg())
        original_patterns = list(wind.DEFAULT_LIMIT_PATTERNS)
        agent["limit_patterns"].append("EXTRA_SENTINEL")
        self.assertEqual(wind.DEFAULT_LIMIT_PATTERNS, original_patterns)
        self.assertEqual(wind.AGENT_PRESETS["claude"]["limit_patterns"],
                         original_patterns)


class LimitPatternsResolution(unittest.TestCase):
    def test_no_agent_uses_claude_preset_patterns(self):
        pats = wind.limit_patterns({"limit_patterns": []})
        self.assertEqual(len(pats), len(wind.DEFAULT_LIMIT_PATTERNS))

    def test_copilot_agent_has_no_patterns(self):
        copilot = wind.AGENT_PRESETS["copilot"]
        pats = wind.limit_patterns({"limit_patterns": []}, copilot)
        self.assertEqual(pats, [])

    def test_user_patterns_append_to_resolved_set(self):
        copilot = wind.AGENT_PRESETS["copilot"]
        pats = wind.limit_patterns(
            {"limit_patterns": [r"FOO (?P<epoch>\d{9,12})"]}, copilot)
        # User pattern is kept; no Claude defaults bolted on for copilot.
        self.assertEqual(len(pats), 1)

    def test_user_patterns_append_to_claude_set(self):
        claude = wind.AGENT_PRESETS["claude"]
        pats = wind.limit_patterns(
            {"limit_patterns": [r"FOO (?P<epoch>\d{9,12})"]}, claude)
        self.assertEqual(len(pats), len(wind.DEFAULT_LIMIT_PATTERNS) + 1)


class BuildRepoEntryAgent(unittest.TestCase):
    def test_copilot_agent_is_written(self):
        e = wind.build_repo_entry("a", "/p", "", "", agent="copilot")
        self.assertEqual(e["agent"], "copilot")

    def test_default_claude_agent_is_omitted(self):
        e = wind.build_repo_entry("a", "/p", "", "", agent="claude")
        self.assertNotIn("agent", e)

    def test_no_agent_arg_omits_key(self):
        e = wind.build_repo_entry("a", "/p", "", "")
        self.assertNotIn("agent", e)


class CmdUpAgentLaunch(unittest.TestCase):
    def _run(self, tmp, repos):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = repos
        cfg["_path"] = os.path.join(tmp, "second-wind.json")
        cfg["startup_delay_seconds"] = 0
        rec = _TmuxRecorder(existing=[])
        args = mock.Mock()
        args.no_watch = True
        with mock.patch.object(wind, "tmux", rec), \
                mock.patch.object(wind, "send_text", lambda n, t: None):
            wind.cmd_up(cfg, args)
        return [c for c in rec.calls
                if c and c[0] == "send-keys" and "Enter" in c]

    def test_launches_copilot_for_copilot_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            launch = self._run(tmp, [{"name": "docs", "path": tmp,
                                      "agent": "copilot"}])
            joined = " ".join(launch[0])
            self.assertIn("copilot", joined)
            self.assertNotIn("claude", joined)

    def test_launches_claude_for_claude_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            launch = self._run(tmp, [{"name": "api", "path": tmp}])
            self.assertIn("claude", " ".join(launch[0]))


class WatcherSkipsUnwatched(unittest.TestCase):
    """Phase 5 (C3): unwatched (copilot) repos are never scanned/resumed."""

    def _cfg(self, tmp, repos):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["session_prefix"] = "wind"
        cfg["repos"] = repos
        cfg["_path"] = os.path.join(tmp, "second-wind.json")
        cfg["caffeinate"] = False
        return cfg

    def test_copilot_pane_with_limit_text_does_not_trigger_resume(self):
        # A copilot pane that literally contains a Claude-style limit message
        # must NOT be detected (it is never scanned), so no resume fires. We
        # force copilot's preset to a pattern that WOULD match the pane text so
        # the only thing keeping it out of the watched set is watch==False —
        # this test goes RED if the watch guard is removed.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = self._cfg(tmp, [{"name": "docs", "path": "/tmp",
                                   "agent": "copilot"}])
            resumed = []
            saved = []
            # Use an `epoch` group resolving to ~now so a scanned match would
            # immediately pause AND (with buffer 0) resume — making the revert
            # signal unambiguous. The copilot pane carries that timestamp.
            cfg["resume_buffer_seconds"] = 0
            epoch = str(int(wind.time.time()))
            captured = (f"You've hit your usage limit ... reset {epoch}")
            match_pat = r"reset (?P<epoch>\d{9,12})"
            # Sanity: the injected pattern really matches the copilot pane.
            self.assertIsNotNone(
                wind.detect_limit(captured,
                                  [re.compile(match_pat, re.IGNORECASE)]))
            orig_pats = wind.AGENT_PRESETS["copilot"]["limit_patterns"]
            wind.AGENT_PRESETS["copilot"]["limit_patterns"] = [match_pat]
            args = mock.Mock()
            args.detach = False
            args.poll = None

            def stop_after_first(seconds, text):
                raise KeyboardInterrupt

            try:
                with mock.patch.object(wind, "session_exists",
                                       lambda n: True), \
                        mock.patch.object(wind, "capture_pane",
                                          lambda n, l: captured), \
                        mock.patch.object(
                            wind, "resume_sessions",
                            lambda c, r: resumed.append(r) or []), \
                        mock.patch.object(wind, "save_state",
                                          lambda s: saved.append(s)), \
                        mock.patch.object(wind, "watch_sleep",
                                          stop_after_first):
                    # cmd_watch catches KeyboardInterrupt internally and
                    # returns cleanly; we just need one loop iteration.
                    wind.cmd_watch(cfg, args)
            finally:
                wind.STATE_PATH = orig
                wind.AGENT_PRESETS["copilot"]["limit_patterns"] = orig_pats
            self.assertEqual(resumed, [],
                             "copilot pane must never be scanned or resumed")
            # And it is never recorded as paused: scanning is the only path to
            # a paused entry, so this fails if the watch guard is dropped.
            self.assertFalse(
                any("wind-docs" in s.get("paused", []) for s in saved),
                f"copilot must never be paused/scanned: {saved}")

    def test_status_payload_skips_limit_detection_for_copilot(self):
        # A copilot session whose pane carries a Claude limit message shows a
        # plain state and NO reset_at (limit detection is skipped). We force
        # copilot's preset to a pattern that WOULD match the pane text, proving
        # the skip comes from watch==False, not from copilot's empty patterns —
        # so this test goes RED if the watch guard is removed.
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "docs", "path": "/tmp", "agent": "copilot"}]
        limit_text = "usage limit ... try again at 8pm\nesc to interrupt"
        match_pat = r"try again at (?P<time>\d{1,2}pm)"
        # Sanity: the pattern really matches, so an unwatched skip is the only
        # reason reset_at can stay None.
        self.assertIsNotNone(
            wind.detect_limit(limit_text,
                              [re.compile(match_pat, re.IGNORECASE)]))
        orig = wind.AGENT_PRESETS["copilot"]["limit_patterns"]
        wind.AGENT_PRESETS["copilot"]["limit_patterns"] = [match_pat]
        try:
            with mock.patch.object(wind, "session_exists", lambda n: True), \
                    mock.patch.object(wind, "capture_pane",
                                      lambda n, l: limit_text), \
                    mock.patch.object(wind, "load_state", lambda: {}):
                payload = wind.status_payload(cfg)
        finally:
            wind.AGENT_PRESETS["copilot"]["limit_patterns"] = orig
        sess = payload["sessions"][0]
        self.assertEqual(sess["name"], "wind-docs")
        self.assertIsNone(sess["reset_at"])
        self.assertEqual(sess["reset_human"], "")
        # It still shows a live state (the running marker is present).
        self.assertEqual(sess["state"], "running")

    def test_cmd_status_skips_limit_detection_for_copilot(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "docs", "path": "/tmp", "agent": "copilot"}]
        limit_text = "usage limit ... try again at 8pm"
        rows = []
        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "capture_pane",
                                  lambda n, l: limit_text), \
                mock.patch.object(wind, "load_state", lambda: {}), \
                mock.patch.object(wind, "detect_limit",
                                  lambda *a, **k: rows.append(a) or None):
            args = mock.Mock()
            wind.cmd_status(cfg, args)
        # detect_limit was called with empty patterns for the copilot repo,
        # so it can never match.
        self.assertTrue(all(call[1] == [] for call in rows),
                        f"copilot must be scanned with no patterns: {rows}")


class ResumeSessionsResolvesMessage(unittest.TestCase):
    def test_each_repo_gets_its_preset_resume_message(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "api", "path": "/tmp"},
                        {"name": "docs", "path": "/tmp", "agent": "copilot"}]
        sent = []
        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "send_text",
                                  lambda n, t: sent.append((n, t))):
            wind.resume_sessions(cfg, cfg["repos"])
        self.assertIn(("wind-api", "continue"), sent)
        self.assertIn(("wind-docs", "Please continue where you left off."),
                      sent)


class BackwardCompatNoAgent(unittest.TestCase):
    """A config with no agent/prompt runs cmd_up/cmd_watch as before."""

    def test_legacy_config_cmd_up_launches_claude(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["repos"] = [{"name": "x", "path": tmp}]
            cfg["_path"] = os.path.join(tmp, "second-wind.json")
            cfg["startup_delay_seconds"] = 0
            rec = _TmuxRecorder(existing=[])
            args = mock.Mock()
            args.no_watch = True
            with mock.patch.object(wind, "tmux", rec), \
                    mock.patch.object(wind, "send_text", lambda n, t: None):
                wind.cmd_up(cfg, args)
            launch = [c for c in rec.calls
                      if c and c[0] == "send-keys" and "Enter" in c][0]
            self.assertIn("claude", " ".join(launch))

    def test_legacy_state_still_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            with open(statef, "w") as f:
                json.dump({"paused": ["wind-x"], "reset_at": 123}, f)
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            try:
                state = wind.load_state()
            finally:
                wind.STATE_PATH = orig
            self.assertEqual(state["paused"], ["wind-x"])
            self.assertEqual(state["reset_at"], 123)


class CapturePaneEscapes(unittest.TestCase):
    """#1: capture_pane(escapes=True) adds tmux's -e flag; default omits it."""

    def test_default_omits_dash_e_flag(self):
        seen = {}

        def fake_tmux(*args, **kw):
            seen["args"] = args
            return mock.Mock(returncode=0, stdout="plain")

        with mock.patch.object(wind, "tmux", fake_tmux):
            wind.capture_pane("wind-api", 100)
        self.assertNotIn("-e", seen["args"])

    def test_escapes_true_puts_dash_e_in_argv(self):
        seen = {}

        def fake_tmux(*args, **kw):
            seen["args"] = args
            return mock.Mock(returncode=0, stdout="plain")

        with mock.patch.object(wind, "tmux", fake_tmux):
            wind.capture_pane("wind-api", 100, escapes=True)
        self.assertIn("-e", seen["args"])
        self.assertIn("capture-pane", seen["args"])

    def test_get_pane_extended_captures_with_escapes_and_keeps_red(self):
        # The whole color feature: get_pane_extended must request escapes so SGR
        # bytes exist, then preserve_sgr keeps the red.
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "api", "path": "/tmp"}]
        seen = {}

        def fake_capture(name, lines, escapes=False):
            seen["escapes"] = escapes
            return f"{ESC}[31mred{ESC}[0m" if escapes else "red"

        with mock.patch.object(wind, "capture_pane", fake_capture):
            out = wind.get_pane_extended(cfg, "wind-api", 100)
        self.assertTrue(seen["escapes"])
        self.assertIn(f"{ESC}[31m", out)  # red SGR survives _strip_escapes
        self.assertIn("red", out)


class LoadConfigAgentValidation(unittest.TestCase):
    """#14: unknown agent names die at load, not in a request thread."""

    def _write(self, tmp, obj):
        p = os.path.join(tmp, "wind.json")
        with open(p, "w") as f:
            json.dump(obj, f)
        orig = wind.CONFIG_PATHS
        wind.CONFIG_PATHS = [p]
        self.addCleanup(lambda: setattr(wind, "CONFIG_PATHS", orig))
        return p

    def test_bad_top_level_agent_dies(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(tmp, {"agent": "bogus",
                              "repos": [{"name": "x", "path": "/tmp"}]})
            with self.assertRaises(SystemExit):
                wind.load_config()

    def test_bad_per_repo_agent_dies(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(tmp, {"repos": [{"name": "x", "path": "/tmp",
                                         "agent": "bogus"}]})
            with self.assertRaises(SystemExit):
                wind.load_config()

    def test_good_agents_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(tmp, {"agent": "claude",
                              "repos": [{"name": "x", "path": "/tmp",
                                         "agent": "copilot"}]})
            cfg = wind.load_config()
            self.assertEqual(cfg["agent"], "claude")


class LoadConfigWatcherCollision(unittest.TestCase):
    """#2/#15: a repo whose session collides with the watcher dies at load."""

    def _write(self, tmp, obj):
        p = os.path.join(tmp, "wind.json")
        with open(p, "w") as f:
            json.dump(obj, f)
        orig = wind.CONFIG_PATHS
        wind.CONFIG_PATHS = [p]
        self.addCleanup(lambda: setattr(wind, "CONFIG_PATHS", orig))
        return p

    def test_repo_named_watcher_dies(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(tmp, {"repos": [{"name": "watcher", "path": "/tmp"}]})
            with self.assertRaises(SystemExit):
                wind.load_config()

    def test_non_colliding_repo_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._write(tmp, {"repos": [{"name": "ci-watcher",
                                         "path": "/tmp"}]})
            cfg = wind.load_config()
            self.assertEqual(cfg["repos"][0]["name"], "ci-watcher")


class ForeignWatcherExcludesOwnRepos(unittest.TestCase):
    """#3: a normal repo whose name ends in -watcher is not a foreign watcher."""

    def test_own_ci_watcher_repo_not_flagged(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "ci-watcher", "path": "/tmp"}]
        # The repo's own session 'wind-ci-watcher' is live; must NOT be foreign.
        with mock.patch.object(wind, "list_session_names",
                               lambda: ["wind-ci-watcher"]):
            self.assertIsNone(wind.find_foreign_watcher(cfg))

    def test_truly_foreign_watcher_still_flagged(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "x", "path": "/tmp"}]
        with mock.patch.object(wind, "list_session_names",
                               lambda: ["other-watcher"]):
            self.assertEqual(wind.find_foreign_watcher(cfg), "other-watcher")


class CmdPromptPreservesMinimalConfig(unittest.TestCase):
    """#8: wiring prompt_file does not persist DEFAULT_CONFIG keys."""

    def test_minimal_config_gains_only_prompt_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, "second-wind.json")
            home = os.path.join(tmp, "home")
            # A minimal raw config: NO claude_args anywhere.
            raw = {"repos": [{"name": "foo", "path": "/tmp"}]}
            with open(cfg_path, "w") as f:
                json.dump(raw, f)
            # cfg as load_config would produce it (DEFAULT_CONFIG-merged).
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["repos"] = [{"name": "foo", "path": "/tmp"}]
            cfg["_path"] = cfg_path
            args = mock.Mock()
            args.repo = "foo"
            args.editor = None
            with mock.patch.object(wind, "WIND_HOME", home), \
                    mock.patch.object(wind, "_open_editor",
                                      lambda path, ed: None):
                wind.cmd_prompt(cfg, args)
            with open(cfg_path) as f:
                saved = json.load(f)
            self.assertNotIn("claude_args", saved)  # default key not persisted
            self.assertNotIn("resume_message", saved)
            foo = next(r for r in saved["repos"] if r["name"] == "foo")
            self.assertIn("prompt_file", foo)
            self.assertNotIn("claude_args", foo)


class ResumeOrphanedPausedSessions(unittest.TestCase):
    """#5/#7: a paused session absent from watched is still resumed at reset."""

    def test_orphan_paused_name_resumed_with_global_message(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["repos"] = [{"name": "x", "path": "/tmp"}]
        cfg["resume_message"] = "wake up"
        sent = []
        with mock.patch.object(wind, "session_exists", lambda n: True), \
                mock.patch.object(wind, "send_text",
                                  lambda n, t: sent.append((n, t))):
            # 'wind-gone' is paused but no longer a watched repo.
            resumed = wind.resume_orphans(cfg, ["wind-gone"])
        self.assertEqual(resumed, ["wind-gone"])
        self.assertEqual(sent, [("wind-gone", "wake up")])

    def test_orphan_not_dropped_silently_when_session_missing(self):
        cfg = dict(wind.DEFAULT_CONFIG)
        cfg["resume_message"] = "wake up"
        with mock.patch.object(wind, "session_exists", lambda n: False), \
                mock.patch.object(wind, "send_text",
                                  lambda n, t: self.fail("should not send")):
            resumed = wind.resume_orphans(cfg, ["wind-gone"])
        self.assertEqual(resumed, [])

    def test_cmd_watch_resumes_paused_session_no_longer_watched(self):
        # Integration: state pauses 'wind-gone' (not in the current watched
        # repos) with a reset_at in the past. At reset the watcher must still
        # nudge it via the global resume_message, not strand it paused forever.
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            with open(statef, "w") as f:
                json.dump({"paused": ["wind-gone"], "reset_at": 1.0}, f)
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            cfg = dict(wind.DEFAULT_CONFIG)
            cfg["session_prefix"] = "wind"
            cfg["repos"] = [{"name": "x", "path": "/tmp"}]  # 'gone' not here
            cfg["_path"] = os.path.join(tmp, "second-wind.json")
            cfg["caffeinate"] = False
            cfg["resume_message"] = "wake up"
            cfg["resume_buffer_seconds"] = 0
            sent = []
            args = mock.Mock()
            args.detach = False
            args.poll = None

            def stop_after_first(seconds, text):
                raise KeyboardInterrupt

            try:
                with mock.patch.object(wind, "session_exists",
                                       lambda n: True), \
                        mock.patch.object(wind, "capture_pane",
                                          lambda n, l: ""), \
                        mock.patch.object(wind, "send_text",
                                          lambda n, t: sent.append((n, t))), \
                        mock.patch.object(wind, "notify",
                                          lambda *a, **k: None), \
                        mock.patch.object(wind, "watch_sleep",
                                          stop_after_first):
                    wind.cmd_watch(cfg, args)
            finally:
                wind.STATE_PATH = orig
            self.assertIn(("wind-gone", "wake up"), sent,
                          f"orphan paused session must be resumed: {sent}")

    def test_cmd_watch_resumes_paused_session_in_cfg_but_not_watched(self):
        # B3-regression: a session is paused for a repo that IS in cfg['repos']
        # but whose resolved agent has watch=False (e.g. copilot), so it is NOT
        # in the watched set / by_name dict.  The watcher reset path must still
        # nudge it via resume_orphans (global resume_message) rather than
        # silently stranding it paused forever.
        #
        # This test FAILS against _paused_orphans(cfg, state) using all-cfg-names
        # as baseline (the regression), and PASSES after parametrizing the
        # baseline to set(by_name) at the watcher call site.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            statef = os.path.join(tmp, "state.json")
            # "wind-unwatched" is paused; its repo IS in cfg but watch=False
            with open(statef, "w") as f:
                json.dump({"paused": ["wind-unwatched"], "reset_at": 1.0}, f)
            orig = wind.STATE_PATH
            wind.STATE_PATH = statef
            try:
                cfg = dict(wind.DEFAULT_CONFIG)
                cfg["session_prefix"] = "wind"
                # repo "unwatched" is in cfg["repos"] but uses copilot agent
                # (watch=False), so it will never appear in the watched/by_name set.
                cfg["repos"] = [{"name": "unwatched", "path": "/tmp",
                                  "agent": "copilot"}]
                cfg["_path"] = os.path.join(tmp, "second-wind.json")
                cfg["caffeinate"] = False
                cfg["resume_message"] = "wake up"
                cfg["resume_buffer_seconds"] = 0
                sent = []

                args = mock.Mock()
                args.detach = False
                args.poll = None

                def stop_after_first(seconds, text):
                    raise KeyboardInterrupt

                try:
                    with mock.patch.object(wind, "session_exists",
                                           lambda n: True), \
                            mock.patch.object(wind, "capture_pane",
                                              lambda n, l: ""), \
                            mock.patch.object(wind, "send_text",
                                              lambda n, t: sent.append((n, t))), \
                            mock.patch.object(wind, "notify",
                                              lambda *a, **k: None), \
                            mock.patch.object(wind, "watch_sleep",
                                              stop_after_first):
                        wind.cmd_watch(cfg, args)
                except KeyboardInterrupt:
                    pass
            finally:
                wind.STATE_PATH = orig
            self.assertIn(("wind-unwatched", "wake up"), sent,
                          f"session in cfg but not watched must be nudged, not "
                          f"stranded paused forever: {sent}")


class DashboardAttachButton(unittest.TestCase):
    """The dashboard modal exposes a 'copy attach command' button so a user
    can jump into the real tmux session for full TUI autocomplete."""

    @classmethod
    def setUpClass(cls):
        path = os.path.join(os.path.dirname(__file__), "..", "dashboard.html")
        with open(path) as f:
            cls.html = f.read()

    def test_modal_has_attach_button(self):
        self.assertIn('id="modal-attach"', self.html,
                      "modal header must carry the attach-command button")

    def test_attach_command_helper_present(self):
        # the pure helper builds `tmux attach -t <session>`
        self.assertRegex(
            self.html,
            r"function attachCommand\([^)]*\)\s*\{\s*return\s*"
            r"['\"]tmux attach -t ['\"]",
            "attachCommand(name) must return 'tmux attach -t ' + name")

    def test_attach_uses_clipboard_with_execcommand_fallback(self):
        self.assertIn("navigator.clipboard", self.html,
                      "attach copy should use the clipboard API")
        self.assertIn("execCommand", self.html,
                      "attach copy needs an execCommand fallback")


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


if __name__ == "__main__":
    unittest.main()

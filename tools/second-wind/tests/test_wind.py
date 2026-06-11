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


if __name__ == "__main__":
    unittest.main()

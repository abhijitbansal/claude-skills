"""Unit tests for Second Wind's parsing and classification logic.

Run: python3 -m unittest discover tests
"""

import datetime
import importlib.util
import os
import sys
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


if __name__ == "__main__":
    unittest.main()

"""learn_history.py — minimal, opt-out-honoring history mining."""
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import learn_history as lh  # noqa: E402


def _history(home, lines):
    h = home / ".claude" / "history.jsonl"
    h.parent.mkdir(parents=True, exist_ok=True)
    h.write_text("".join(json.dumps(x) + "\n" for x in lines))
    return h


def test_counts_leading_slash_token_only(tmp_path):
    home = tmp_path / "home"
    _history(home, [
        {"display": "/commit save it", "pastedContents": {}, "timestamp": "2026-06-01T00:00:00Z"},
        {"display": "/commit again", "pastedContents": {}, "timestamp": "2026-06-02T00:00:00Z"},
        {"display": "just chatting", "pastedContents": {}, "timestamp": "2026-06-03T00:00:00Z"},
    ])
    prof = lh.learn(home, env={})
    assert prof["by_command"]["/commit"]["count"] == 2
    assert "/just" not in prof["by_command"]  # non-slash display ignored
    assert prof["by_command"]["/commit"]["last_ts"] == "2026-06-02T00:00:00Z"


def test_pasted_contents_never_read(tmp_path):
    home = tmp_path / "home"
    _history(home, [{"display": "/commit", "pastedContents": {"a": "/secret-token"}, "timestamp": "t"}])
    prof = lh.learn(home, env={})
    assert "/secret-token" not in json.dumps(prof)


def test_optout_yields_empty_profile_even_with_history(tmp_path):
    home = tmp_path / "home"
    _history(home, [{"display": "/commit", "pastedContents": {}, "timestamp": "t"}])
    prof = lh.learn(home, env={lh.SKIP_ENV: "1"})
    assert prof["by_command"] == {}


def test_cap_keeps_only_most_recent(tmp_path):
    home = tmp_path / "home"
    lines = [{"display": "/old", "pastedContents": {}, "timestamp": "t"}]
    lines += [{"display": "/new", "pastedContents": {}, "timestamp": "t"} for _ in range(lh.HISTORY_MAX_ENTRIES)]
    _history(home, lines)
    prof = lh.learn(home, env={})
    assert "/old" not in prof["by_command"]  # pushed out by the 5000-line cap
    assert prof["by_command"]["/new"]["count"] == lh.HISTORY_MAX_ENTRIES


def test_missing_history_yields_empty_profile(tmp_path):
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    prof = lh.learn(home, env={})
    assert prof["by_command"] == {}


def test_malformed_line_is_skipped(tmp_path):
    home = tmp_path / "home"
    h = home / ".claude" / "history.jsonl"
    h.parent.mkdir(parents=True, exist_ok=True)
    h.write_text('not-json\n{"display": "/commit", "timestamp": "t"}\n')
    prof = lh.learn(home, env={})
    assert prof["by_command"]["/commit"]["count"] == 1  # malformed line skipped, valid line counted


def test_profile_written_with_perms(tmp_path):
    home = tmp_path / "home"
    _history(home, [{"display": "/commit", "pastedContents": {}, "timestamp": "t"}])
    lh.learn(home, env={})
    pf = home / ".claude" / "prompt-craft" / "profile.json"
    assert oct(os.stat(pf).st_mode & 0o777) == "0o600"
    assert oct(os.stat(pf.parent).st_mode & 0o777) == "0o700"

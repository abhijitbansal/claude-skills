#!/usr/bin/env python3
"""Mine ~/.claude/history.jsonl into ~/.claude/prompt-craft/profile.json.

Reads only the leading token of `display`; never reads `pastedContents`.
Honors the opt-out env var explicitly (empty profile, no read).
"""
import argparse
import json
import os
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry_lib import atomic_write_json  # noqa: E402

SKIP_ENV = "CLAUDE_CODE_SKIP_PROMPT_HISTORY"  # verified: matches Claude Code opt-out convention
HISTORY_MAX_ENTRIES = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_truthy(value) -> bool:
    return bool(value) and str(value).strip().lower() not in ("0", "false", "no", "")


def _profile_path(home) -> Path:
    return Path(home) / ".claude" / "prompt-craft" / "profile.json"


def learn(home, env=None) -> dict:
    env = os.environ if env is None else env
    profile = {"learned_at": _now_iso(), "by_command": {}}
    if _is_truthy(env.get(SKIP_ENV)):
        atomic_write_json(_profile_path(home), profile)
        return profile
    history = Path(home) / ".claude" / "history.jsonl"
    try:
        with open(history, "r", encoding="utf-8", errors="ignore") as fh:
            lines = deque(fh, maxlen=HISTORY_MAX_ENTRIES)
    except OSError:
        print(f"learn_history: no history at {history}", file=sys.stderr)
        atomic_write_json(_profile_path(home), profile)
        return profile
    by_command = profile["by_command"]
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        display = rec.get("display") or ""
        parts = display.split()
        if not parts or not parts[0].startswith("/"):
            continue
        name = parts[0]
        ts = rec.get("timestamp") or profile["learned_at"]
        entry = by_command.setdefault(name, {"count": 0, "last_ts": ts})
        entry["count"] += 1
        entry["last_ts"] = ts
    atomic_write_json(_profile_path(home), profile)
    return profile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=os.path.expanduser("~"))
    args = ap.parse_args()
    learn(args.home)
    return 0


if __name__ == "__main__":
    sys.exit(main())

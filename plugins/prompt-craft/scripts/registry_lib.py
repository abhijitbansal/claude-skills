#!/usr/bin/env python3
"""Shared helpers for the prompt-craft command-advisor scripts.

Stdlib-only and version-agnostic (runs under /usr/bin/python3 3.9+): no tomllib.
"""
import json
import os
import re
import tempfile
from pathlib import Path

STOPWORDS = {
    "the", "and", "for", "this", "that", "with", "from", "into", "your", "you",
    "are", "was", "but", "not", "all", "can", "has", "have", "out", "use", "via",
    "what", "whats", "who", "why", "how", "when", "where", "does", "did", "would",
    "let", "make", "made", "get", "got", "set", "add", "new", "any", "its", "it's",
    "me", "my", "mine", "our", "their", "them", "they", "his", "her", "a", "an",
    "to", "of", "in", "on", "at", "by", "is", "be", "do", "or", "as", "so", "up",
    "tell", "about", "before", "after", "different", "current", "state", "thing",
}


def tokenize(text: str) -> set:
    toks = re.split(r"[^a-z0-9]+", (text or "").lower())
    return {t for t in toks if len(t) >= 3 and t not in STOPWORDS}


def parse_frontmatter(path) -> dict:
    """Parse a leading `---` frontmatter block into a flat {key: value} dict."""
    text = Path(path).read_text()
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    out = {}
    for line in text[3:end].splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def atomic_write_json(path, data: dict, mode: int = 0o600, sort_keys: bool = True) -> None:
    """Write JSON via temp file + fsync + os.replace; dir 0700, file `mode`."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2, sort_keys=sort_keys)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

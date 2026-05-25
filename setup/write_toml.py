#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = ["tomlkit>=0.13,<1.0"]
# ///
"""Rewrite one section of claude-setup.toml from JSON stdin, preserving comments.

Usage: uv run write_toml.py <toml-path> <section>
Reads a JSON array (or object for dotfiles/custom_skills) from stdin.

Inline PEP 723 deps — uv installs tomlkit in a managed cache on first run.
No requirements.txt, no manual pip install needed.
"""

import json
import sys
from pathlib import Path

import tomlkit

ARRAY_SECTIONS = {"marketplaces", "plugins", "skills"}
TABLE_SECTIONS = {"dotfiles", "custom_skills"}


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: write_toml.py <toml-path> <section>\n")
        return 2
    path, section = Path(sys.argv[1]), sys.argv[2]
    payload = json.loads(sys.stdin.read())

    doc = tomlkit.parse(path.read_text()) if path.exists() else tomlkit.document()
    if "meta" not in doc:
        doc["meta"] = tomlkit.table()
        doc["meta"]["schema_version"] = 1

    if section in ARRAY_SECTIONS:
        if not isinstance(payload, list):
            sys.stderr.write(f"{section}: expected list, got {type(payload).__name__}\n")
            return 2
        new_array = tomlkit.aot()
        for entry in payload:
            t = tomlkit.table()
            for k, v in entry.items():
                if v is None:
                    continue
                t[k] = v
            new_array.append(t)
        doc[section] = new_array
    elif section in TABLE_SECTIONS:
        if not isinstance(payload, dict):
            sys.stderr.write(f"{section}: expected dict, got {type(payload).__name__}\n")
            return 2
        t = tomlkit.table()
        for k, v in payload.items():
            t[k] = v
        doc[section] = t
    else:
        sys.stderr.write(f"unknown section: {section}\n")
        return 2

    path.write_text(tomlkit.dumps(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())

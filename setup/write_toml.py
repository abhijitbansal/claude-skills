#!/usr/bin/env python3
"""Rewrite one section of claude-setup.toml from JSON stdin, preserving comments.

Usage: write_toml.py <toml-path> <section>
Reads a JSON array (or object for dotfiles/custom_skills) from stdin.
"""

import json
import sys
from pathlib import Path

try:
    import tomlkit
except ImportError:  # pragma: no cover
    sys.stderr.write("tomlkit not installed; run: pip3 install --user tomlkit\n")
    sys.exit(2)

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

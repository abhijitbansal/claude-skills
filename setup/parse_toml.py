#!/usr/bin/env python3
"""Read claude-setup.toml and emit a JSON-encoded list for one section.

Usage: parse_toml.py <toml-path> <section>
  section ∈ {marketplaces, plugins, skills, dotfiles, custom_skills}

Reads from <toml-path> (use "/dev/stdin" to pipe).  Always emits JSON to stdout.
Schema validation: rejects unknown meta.schema_version.
"""

import json
import sys
from pathlib import Path

try:
    import tomllib  # py3.11+
except ImportError:  # pragma: no cover
    sys.stderr.write("python3.11+ required (need tomllib)\n")
    sys.exit(2)

SUPPORTED_SCHEMA = 1


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: parse_toml.py <toml-path> <section>\n")
        return 2
    toml_path, section = sys.argv[1], sys.argv[2]
    if toml_path == "/dev/stdin":
        data = tomllib.loads(sys.stdin.read())
    else:
        with Path(toml_path).open("rb") as f:
            data = tomllib.load(f)

    meta = data.get("meta", {})
    if meta.get("schema_version") != SUPPORTED_SCHEMA:
        sys.stderr.write(
            f"unsupported schema_version: {meta.get('schema_version')!r} "
            f"(expected {SUPPORTED_SCHEMA})\n"
        )
        return 2

    if section in ("marketplaces", "plugins", "skills"):
        items = data.get(section, []) or []
        if section == "plugins":
            items = [{"name": i["name"], "marketplace": i["marketplace"],
                      "pin": i.get("pin")} for i in items]
        print(json.dumps(items))
        return 0

    if section in ("dotfiles", "custom_skills"):
        print(json.dumps(data.get(section, {})))
        return 0

    sys.stderr.write(f"unknown section: {section}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())

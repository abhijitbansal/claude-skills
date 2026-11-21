#!/usr/bin/env python3
"""Validate .claude-plugin/marketplace.json against the plugins/ tree.

Used by the "validate plugin manifests" step in .github/workflows/test.yml.

A plugin's `source` is either a string (a path inside this repo, "./plugins/x")
or an object (a plugin hosted in another repo, e.g. {"source": "git-subdir", ...}).
Only string sources have a directory here to check; object sources are skipped.
"""
import json
import os
import sys

# Fields an object source must carry, by its `source` type. Other types are only
# checked for having a type; `claude plugin validate` covers the full schema.
REQUIRED_OBJECT_FIELDS = {
    "git-subdir": ("url", "path"),
    "github": ("repo",),
    "url": ("url",),
}


def validate(root: str) -> tuple[int, int]:
    """Return (plugins listed, plugins checked on disk). Raise AssertionError on a problem."""
    mp = json.load(open(os.path.join(root, ".claude-plugin", "marketplace.json")))
    assert mp["name"] and mp["owner"]["name"], "marketplace metadata"
    names = set()
    checked = 0
    for p in mp["plugins"]:
        assert p["name"] not in names, f"duplicate plugin {p['name']}"
        names.add(p["name"])
        source = p["source"]
        if not isinstance(source, str):
            assert isinstance(source, dict) and source.get("source"), (
                f"{p['name']}: source must be a path or an object with a 'source' type"
            )
            for field in REQUIRED_OBJECT_FIELDS.get(source["source"], ()):
                value = source.get(field)
                assert isinstance(value, str) and value.strip(), (
                    f"{p['name']}: a '{source['source']}' source requires a non-empty '{field}'"
                )
            continue
        checked += 1
        plugin_dir = os.path.join(root, source)
        pj = json.load(open(os.path.join(plugin_dir, ".claude-plugin", "plugin.json")))
        assert pj["name"] == p["name"], f"name mismatch in {source}"
        skills = os.path.join(plugin_dir, "skills")
        if os.path.isdir(skills):
            for s in os.listdir(skills):
                if s == "_lib":
                    continue
                md = os.path.join(skills, s, "SKILL.md")
                assert os.path.isfile(md), f"missing {md}"
    return len(names), checked


if __name__ == "__main__":
    listed, checked = validate(sys.argv[1] if len(sys.argv) > 1 else ".")
    print(f"OK: {listed} plugins valid ({checked} in this repo, {listed - checked} hosted elsewhere)")

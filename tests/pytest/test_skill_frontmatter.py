"""Every SKILL.md frontmatter must parse under strict YAML (Claude Code,
`npx skills`) AND the repo's line-based registry parser: one `key: value`
per line, and any value containing ": ", " #" or a leading YAML indicator
must be a JSON-style double-quoted string."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SKILLS = sorted(ROOT.glob("plugins/*/skills/*/SKILL.md"))
INDICATOR = re.compile(r"""^["'&*!%@`{\[|>]""")


def frontmatter(path):
    m = re.match(r"^---\n(.*?)\n---\n", path.read_text(encoding="utf-8"), re.S)
    assert m, f"{path}: missing frontmatter"
    return m.group(1).splitlines()


@pytest.mark.parametrize("path", SKILLS, ids=lambda p: f"{p.parts[-4]}/{p.parts[-2]}")
def test_frontmatter_is_strict_yaml_safe(path):
    keys = {}
    for line in frontmatter(path):
        kv = re.match(r"^([a-z][a-z0-9_-]*): (.+)$", line)
        assert kv, f"not a single-line key: value: {line!r}"
        key, value = kv.groups()
        if value.startswith('"'):
            parsed = json.loads(value)  # raises on bad escaping
            assert isinstance(parsed, str)
        else:
            assert ": " not in value, f"{key}: plain value contains ': ' (quote it)"
            assert " #" not in value, f"{key}: plain value contains ' #' (quote it)"
            assert not INDICATOR.match(value), f"{key}: plain value starts with a YAML indicator"
        keys[key] = value
    assert keys.get("name") == path.parent.name
    assert "description" in keys


def test_found_skills():
    assert len(SKILLS) > 50

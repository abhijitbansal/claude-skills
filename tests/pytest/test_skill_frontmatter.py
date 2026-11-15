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
# Commands and agents carry the same frontmatter and are listed to the model the
# same way, so they are held to the same parse rules. They have no `name` key
# that must match a directory, so the name assertion is skill-only.
COMMANDS = sorted(ROOT.glob("plugins/*/commands/*.md"))
AGENTS = sorted(ROOT.glob("plugins/*/agents/*.md"))
DESCRIBED = SKILLS + COMMANDS + AGENTS
INDICATOR = re.compile(r"""^["'&*!%@`{\[|>]""")


def frontmatter(path):
    m = re.match(r"^---\n(.*?)\n---\n", path.read_text(encoding="utf-8"), re.S)
    assert m, f"{path}: missing frontmatter"
    return m.group(1).splitlines()


def _id(path):
    stem = path.parts[-2] if path.name == "SKILL.md" else f"{path.parts[-2]}/{path.stem}"
    return f"{path.parts[-4] if path.name == 'SKILL.md' else path.parts[-3]}/{stem}"


@pytest.mark.parametrize("path", DESCRIBED, ids=_id)
def test_frontmatter_is_strict_yaml_safe(path):
    # Skills are checked on every key. Commands and agents are checked on
    # `description` only: their `argument-hint: [a, b]` flow sequences are valid
    # YAML (the registry parser tolerates them), but an unquoted description with
    # ": " is not, and it drops the entry from the listing.
    strict_keys = None if path.name == "SKILL.md" else {"description"}
    keys = {}
    for line in frontmatter(path):
        kv = re.match(r"^([a-z][a-z0-9_-]*): (.+)$", line)
        assert kv, f"not a single-line key: value: {line!r}"
        key, value = kv.groups()
        if strict_keys is not None and key not in strict_keys:
            keys[key] = value
            continue
        if value.startswith('"'):
            parsed = json.loads(value)  # raises on bad escaping
            assert isinstance(parsed, str)
        else:
            assert ": " not in value, f"{key}: plain value contains ': ' (quote it)"
            assert " #" not in value, f"{key}: plain value contains ' #' (quote it)"
            assert not INDICATOR.match(value), f"{key}: plain value starts with a YAML indicator"
        keys[key] = value
    if path.name == "SKILL.md":
        assert keys.get("name") == path.parent.name
    assert "description" in keys


def test_found_skills():
    assert len(SKILLS) > 50


def test_found_commands_and_agents():
    assert len(COMMANDS) >= 15
    assert len(AGENTS) >= 2

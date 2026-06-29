"""Structural validation for the prompt-craft plugin.

Skills are markdown and the manifests are JSON (config, not logic), so these
checks guard structure -- the behavioral hook tests live in bats. Frontmatter
parsing is cleaner in Python than in bash, hence pytest here.
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGIN = REPO_ROOT / "plugins" / "prompt-craft"

EXPECTED_SKILLS = {"improve-prompt", "plan", "debug", "refactor", "review", "refresh"}
EXPECTED_HOOK_SCRIPTS = {"suggest_next.sh", "block_secrets.sh", "format_on_edit.sh"}


def _frontmatter(skill_md: Path) -> dict:
    """Parse the leading `---` YAML-ish frontmatter into a flat dict.

    Only `key: value` scalars are needed here, so a tiny parser beats a
    PyYAML dependency the repo doesn't otherwise carry.
    """
    text = skill_md.read_text()
    assert text.startswith("---\n"), f"{skill_md}: missing frontmatter"
    end = text.index("\n---", 4)
    out = {}
    for line in text[4:end].splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = value.strip()
    return out


def test_plugin_json_valid():
    pj = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
    assert pj["name"] == "prompt-craft"
    assert pj["description"]
    assert pj["version"]
    assert pj["author"]["name"]


def test_every_expected_skill_has_well_formed_frontmatter():
    found = {p.parent.name for p in PLUGIN.glob("skills/*/SKILL.md")}
    assert found == EXPECTED_SKILLS, f"skills mismatch: {found}"
    for skill_dir in EXPECTED_SKILLS:
        fm = _frontmatter(PLUGIN / "skills" / skill_dir / "SKILL.md")
        assert fm.get("name") == skill_dir, f"{skill_dir}: name != dir"
        assert fm.get("description"), f"{skill_dir}: empty description"


def test_high_effort_on_improve_prompt():
    fm = _frontmatter(PLUGIN / "skills" / "improve-prompt" / "SKILL.md")
    assert fm.get("effort") == "high", "improve-prompt should request high effort"


def test_hooks_json_valid_and_references_existing_scripts():
    hooks = json.loads((PLUGIN / "hooks" / "hooks.json").read_text())
    referenced = json.dumps(hooks)
    for script in EXPECTED_HOOK_SCRIPTS:
        assert script in referenced, f"{script} not wired in hooks.json"
        assert (PLUGIN / "hooks" / script).exists(), f"{script} missing"

"""build_registry.py — repo-scope scan, overlay merge, atomic write."""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import build_registry as br  # noqa: E402


def _mk_skill(root, plugin, name, desc):
    p = root / "plugins" / plugin / "skills" / name / "SKILL.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\nname: {name}\ndescription: {desc}\n---\n# {name}\n")
    return p


def _overlay():
    return {"builtins": ["/goal"], "prefer_over": {"/prompt-craft:plan": ["/goal"]}}


def test_scan_repo_finds_plugin_skills_with_qualified_names(tmp_path):
    _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task into steps.")
    _mk_skill(tmp_path, "ecc", "review", "Review a diff for bugs.")
    cmds = br.scan_repo(tmp_path, _overlay())
    by = {c["name"]: c for c in cmds}
    assert "/prompt-craft:plan" in by and "/ecc:review" in by
    assert by["/prompt-craft:plan"]["kind"] == "skill"
    assert by["/prompt-craft:plan"]["scope"] == "repo"


def test_canonical_is_true_for_non_prompt_craft(tmp_path):
    _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
    _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
    by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
    assert by["/ecc:review"]["canonical"] is True
    assert by["/prompt-craft:plan"]["canonical"] is False


def test_prefer_over_merged_from_overlay(tmp_path):
    _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
    by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
    assert by["/prompt-craft:plan"]["prefer_over"] == ["/goal"]


def test_keywords_inferred_from_name_and_description(tmp_path):
    _mk_skill(tmp_path, "ecc", "review", "Review a diff for bugs.")
    by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
    kw = set(by["/ecc:review"]["keywords"])
    assert {"review", "diff", "bugs"} <= kw


def test_malformed_skill_is_skipped_not_fatal(tmp_path, capsys):
    good = _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
    bad = tmp_path / "plugins" / "ecc" / "skills" / "broken" / "SKILL.md"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text("no frontmatter at all")
    names = {c["name"] for c in br.scan_repo(tmp_path, _overlay())}
    assert "/ecc:review" in names  # bad entry appears as '/ecc:broken' (dir-name fallback); good entry unchanged


def test_load_overlay_parses_builtins_and_prefer_over(tmp_path):
    f = tmp_path / "registry-notes.toml"
    f.write_text(
        '[builtins]\nnames = ["/goal", "/model"]\n\n'
        '[prefer_over]\n"/prompt-craft:plan" = ["/goal", "/ecc:plan"]\n'
    )
    ov = br.load_overlay(f)
    assert ov["builtins"] == ["/goal", "/model"]
    assert ov["prefer_over"]["/prompt-craft:plan"] == ["/goal", "/ecc:plan"]


def test_build_registry_writes_valid_atomic_file(tmp_path):
    _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    reg = br.build_registry(tmp_path, home, "1.2.3")
    out = home / ".claude" / "prompt-craft" / "registry.json"
    br_atomic = json.loads(out.read_text())  # written by build_registry() itself
    assert br_atomic["repo_root"] == str(tmp_path)
    assert br_atomic["claude_version"] == "1.2.3"
    assert any(c["name"] == "/prompt-craft:plan" for c in br_atomic["commands"])
    assert "repo" in br_atomic["scan_signature"] and "global" in br_atomic["scan_signature"]
    assert reg == br_atomic


def test_stale_entry_dropped_on_rebuild(tmp_path):
    import shutil
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    skill = _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
    br.build_registry(tmp_path, home, None)
    shutil.rmtree(skill.parent)  # delete the skill, then rebuild
    reg = br.build_registry(tmp_path, home, None)
    assert not any(c["name"] == "/ecc:review" for c in reg["commands"])


def test_build_registry_overlay_path_kwarg_injects_controlled_overlay(tmp_path):
    """overlay_path kwarg must override OVERLAY_PATH; injected builtins/prefer_over must appear."""
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")

    overlay_file = tmp_path / "test-overlay.toml"
    overlay_file.write_text(
        '[builtins]\nnames = ["/injected-builtin"]\n\n'
        '[prefer_over]\n"/prompt-craft:plan" = ["/injected-builtin"]\n'
    )

    reg = br.build_registry(tmp_path, home, None, overlay_path=overlay_file)
    names = {c["name"] for c in reg["commands"]}

    # Injected builtin must be present
    assert "/injected-builtin" in names
    # prefer_over from injected overlay must be merged
    plan = next(c for c in reg["commands"] if c["name"] == "/prompt-craft:plan")
    assert plan["prefer_over"] == ["/injected-builtin"]
    # Real overlay's builtins (/goal, /model, etc.) must NOT appear
    assert not any(n.startswith("/goal") for n in names)

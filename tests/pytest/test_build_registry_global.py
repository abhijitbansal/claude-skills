"""Global-scope scan: the corrected marketplace/plugin/version cache glob."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import build_registry as br  # noqa: E402


def _cache_skill(home, marketplace, plugin, version, skill, desc):
    p = (home / ".claude" / "plugins" / "cache" / marketplace / plugin / version
         / "skills" / skill / "SKILL.md")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\nname: {skill}\ndescription: {desc}\n---\n# {skill}\n")
    return p


def _settings(*keys):
    return {"enabledPlugins": {k: [{"scope": "user"}] for k in keys}}


def test_version_key_orders_numerically():
    assert br._version_key("1.10.0") > br._version_key("1.9.0")


def test_three_level_cache_glob_resolves_skill(tmp_path):
    home = tmp_path / "home"
    _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "Decompose work.")
    cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
    by = {c["name"]: c for c in cmds}
    assert "/ecc:plan" in by
    assert by["/ecc:plan"]["scope"] == "global"


def test_newest_version_dir_is_picked(tmp_path):
    home = tmp_path / "home"
    _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "OLD description.")
    _cache_skill(home, "alpha", "ecc", "0.2.0", "plan", "NEW description.")
    cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
    by = {c["name"]: c for c in cmds}
    assert by["/ecc:plan"]["description"] == "NEW description."


def test_temp_git_dirs_are_skipped(tmp_path):
    home = tmp_path / "home"
    _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "Real one.")
    _cache_skill(home, "alpha", "ecc", "temp_git_xyz", "plan", "Transient.")
    cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
    by = {c["name"]: c for c in cmds}
    assert by["/ecc:plan"]["description"] == "Real one."


def test_missing_plugin_cache_is_skipped_silently(tmp_path):
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    cmds = br.scan_global(home, _settings("ghost@alpha"), {"builtins": [], "prefer_over": {}})
    assert cmds == []


def test_user_level_skills_and_commands_scanned(tmp_path):
    home = tmp_path / "home"
    uc = home / ".claude" / "commands" / "deploy.md"
    uc.parent.mkdir(parents=True, exist_ok=True)
    uc.write_text("---\nname: deploy\ndescription: Ship it.\n---\n")
    cmds = br.scan_global(home, {"enabledPlugins": {}}, {"builtins": [], "prefer_over": {}})
    assert any(c["name"] == "/deploy" and c["source"] == "user" for c in cmds)

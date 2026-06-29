"""advisor.py scoring core: relevance, frequency tiebreak, context fit, override."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import advisor  # noqa: E402


def _cmd(name, desc, source="ecc", canonical=True, prefer_over=None, kind="skill"):
    return {"name": name, "kind": kind, "source": source, "scope": "global",
            "description": desc, "why": desc, "when": "", "keywords": [],
            "canonical": canonical, "prefer_over": prefer_over or []}


def _registry(cmds):
    return {"commands": cmds}


def test_relevance_is_description_token_overlap():
    cmd = _cmd("/ecc:review", "Review a diff for bugs and security issues.")
    assert advisor.relevance({"review", "diff"}, cmd) == 2
    assert advisor.relevance({"weather"}, cmd) == 0


def test_prompt_match_returns_rec_schema():
    reg = _registry([_cmd("/ecc:review", "Review a diff for bugs.")])
    recs = advisor.recommend({"prompt": "review this diff", "git_state": {}}, reg, {"by_command": {}})
    assert recs and set(recs[0]) == {"name", "kind", "scope", "score", "why"}
    assert recs[0]["name"] == "/ecc:review"


def test_frequency_breaks_ties_for_relied_on_command():
    reg = _registry([
        _cmd("/ecc:review", "Review the diff."),
        _cmd("/ecc:reviewer", "Review the diff."),
    ])
    profile = {"by_command": {"/ecc:reviewer": {"count": 9, "last_ts": "t"}}}
    recs = advisor.recommend({"prompt": "review the diff", "git_state": {}}, reg, profile)
    assert recs[0]["name"] == "/ecc:reviewer"  # equal relevance, higher frequency wins


def test_context_fit_dirty_suggests_commit():
    assert advisor.context_fit({"dirty": True}) == ["/prompt-craft:review", "/commit"]
    assert advisor.context_fit({"dirty": False, "unpushed": 2}) == ["/pr"]
    assert advisor.context_fit({"dirty": False, "unpushed": 0}) == []


def test_no_prompt_mode_uses_context_fit_even_without_registry():
    recs = advisor.recommend({"prompt": None, "git_state": {"dirty": True}}, None, {})
    names = [r["name"] for r in recs]
    assert names == ["/prompt-craft:review", "/commit"]


def test_canonical_override_replaces_own_skill_when_target_present():
    reg = _registry([
        _cmd("/prompt-craft:plan", "Decompose a task into steps.",
             source="prompt-craft", canonical=False, prefer_over=["/ecc:plan"]),
        _cmd("/ecc:plan", "Decompose a task into steps.", source="ecc", canonical=True),
    ])
    recs = advisor.recommend({"prompt": "decompose a task", "git_state": {}}, reg, {"by_command": {}})
    names = [r["name"] for r in recs]
    assert "/ecc:plan" in names and "/prompt-craft:plan" not in names


def test_prefer_over_absent_keeps_own_skill():
    reg = _registry([
        _cmd("/prompt-craft:plan", "Decompose a task into steps.",
             source="prompt-craft", canonical=False, prefer_over=["/ecc:plan"]),
    ])
    recs = advisor.recommend({"prompt": "decompose a task", "git_state": {}}, reg, {"by_command": {}})
    assert [r["name"] for r in recs] == ["/prompt-craft:plan"]  # target absent -> no demotion


def test_discovery_fills_thin_slots_with_unused_canonical():
    reg = _registry([
        _cmd("/ecc:review", "Review the diff."),
        _cmd("/ecc:deploy", "Ship the build to production."),
        _cmd("/ecc:lint", "Run the linters."),
    ])
    profile = {"by_command": {"/ecc:review": {"count": 1, "last_ts": "t"}}}
    recs = advisor.recommend({"prompt": "review the diff", "git_state": {}}, reg, profile)
    names = [r["name"] for r in recs]
    assert names[0] == "/ecc:review"
    assert names[1:] == ["/ecc:deploy", "/ecc:lint"]  # never-used canonical, name-ordered


def test_degrades_to_empty_when_no_registry_and_no_git():
    assert advisor.recommend({"prompt": "anything", "git_state": {}}, None, None) == []


def test_recommend_prompt_empty_when_no_relevance_match():
    commands = [_cmd("/ecc:review", "review code changes for quality")]
    out = advisor._recommend_prompt("xyzzy frobnicate nothing", commands, None, 5)
    assert out == []  # zero relevance -> no discovery padding (guard: 0 < len(recs) < k)

"""Tests for the routing spike (RFC v2 phase 2, the gate).

The spike answers one question: does a keyword/name scorer beat matching on the
command *description* (the signal the platform already uses to auto-invoke skills)?
These tests pin the scorer's behavior and that the evaluation runs over the real
labeled set; the accuracy numbers themselves are a measurement, not an assertion.
"""

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPIKE = REPO_ROOT / "scripts" / "route_spike.py"
LABELED = REPO_ROOT / "tests" / "fixtures" / "intent-router" / "labeled-prompts.json"


def _load_module():
    spec = importlib.util.spec_from_file_location("route_spike", SPIKE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_tokenize_drops_stopwords_and_short_tokens():
    rs = _load_module()
    toks = rs.tokenize("Fix the bug in my app")
    assert "fix" in toks and "bug" in toks and "app" in toks
    assert "the" not in toks and "in" not in toks and "my" not in toks


def test_predict_matches_an_obvious_command_on_a_tiny_catalog():
    rs = _load_module()
    catalog = [
        {"name": "commit", "kind": "skill", "description": "Stage and save your changes in a git commit."},
        {"name": "review", "kind": "skill", "description": "Review a diff for bugs and security issues."},
    ]
    assert rs.predict("review this diff for bugs", catalog, field="description") == "review"


def test_predict_returns_none_below_threshold():
    rs = _load_module()
    catalog = [
        {"name": "commit", "kind": "skill", "description": "Stage and save your changes in a git commit."},
    ]
    assert rs.predict("what is the weather today", catalog, field="description") is None


def test_evaluate_reports_both_scorers_over_the_labeled_set():
    rs = _load_module()
    catalog = rs.load_catalog(REPO_ROOT)
    assert len(catalog) >= 15, "expected the real command catalog"
    report = rs.evaluate(rs.load_labeled(LABELED), catalog)
    assert report["n"] >= 30, "labeled set should have >= 30 prompts"
    for key in ("keyword_accuracy", "description_accuracy"):
        assert 0.0 <= report[key] <= 1.0

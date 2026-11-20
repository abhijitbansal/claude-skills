"""Tests for the routing spike (RFC v2 phase 2, the gate).

The spike answers one question: does a keyword/name scorer beat matching on the
command *description* (the signal the platform already uses to auto-invoke skills)?
These tests pin the scorer's behavior, that the evaluation runs over the real
labeled set, and a committed regression floor so a description edit cannot quietly
make routing worse.

The scorer calls no model: it is token overlap, so the gate is free to run in CI.
"""

import copy
import importlib.util
import json
import random
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPIKE = REPO_ROOT / "scripts" / "route_spike.py"
LABELED = REPO_ROOT / "tests" / "fixtures" / "intent-router" / "labeled-prompts.json"

# Committed baseline: description-scorer tie-fair accuracy over the real catalog
# and the labeled set at n=BASELINE_N. Measured with
# `python3 scripts/route_spike.py` (no model is called). A description edit that
# drops the number below the floor fails test_description_edit_does_not_regress.
# Re-baseline in the same commit as an intended improvement or a labeled-set change.
BASELINE_N = 60
# Re-measured 2026-11-19 after portable-artifacts moved to its own repo: its make-* skills left this catalog, so
# the 10 labeled prompts that expected them were dropped (n=70 -> 60). Measured 0.72824 at n=60 with
# `python3 scripts/route_spike.py`; the floor is that number rounded down. (Before the move: 0.74802 at n=70.)
# No model is called.
DESCRIPTION_TIE_FAIR_FLOOR = 0.728
FLOOR_EPSILON = 1e-9

LOREM = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor."


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
    for key in ("keyword_accuracy", "description_accuracy",
                "keyword_tie_fair_accuracy", "description_tie_fair_accuracy"):
        assert 0.0 <= report[key] <= 1.0


def test_catalog_is_sorted_by_name():
    rs = _load_module()
    names = [e["name"] for e in rs.load_catalog(REPO_ROOT)]
    assert names == sorted(names)


def test_ties_are_decided_by_name_not_by_catalog_order():
    rs = _load_module()
    catalog = [
        {"name": "zeta", "kind": "skill", "description": "Handle widgets for the shipping crew."},
        {"name": "alpha", "kind": "skill", "description": "Handle widgets for the shipping crew."},
    ]
    forward = rs.predict("shipping widgets", catalog, field="description")
    backward = rs.predict("shipping widgets", list(reversed(catalog)), field="description")
    assert forward == backward == "alpha"


def test_accuracy_is_identical_under_any_catalog_order():
    rs = _load_module()
    catalog = rs.load_catalog(REPO_ROOT)
    labeled = rs.load_labeled(LABELED)
    expected = rs.evaluate(labeled, catalog)
    rng = random.Random(7)
    for _ in range(5):
        shuffled = list(catalog)
        rng.shuffle(shuffled)
        assert rs.evaluate(labeled, shuffled) == expected


def test_tie_fair_credit_is_split_across_a_tie():
    rs = _load_module()
    catalog = [
        {"name": "alpha", "kind": "skill", "description": "Handle widgets for the shipping crew."},
        {"name": "beta", "kind": "skill", "description": "Handle widgets for the shipping crew."},
        {"name": "gamma", "kind": "skill", "description": "Unrelated cooking advice."},
    ]
    labeled = [{"prompt": "shipping widgets", "expected": "beta"}]
    report = rs.evaluate(labeled, catalog)
    assert report["description_tie_fair_accuracy"] == 0.5
    assert report["description_accuracy"] == 0.0  # name order picks alpha


def test_expected_none_is_correct_only_when_nothing_matches():
    rs = _load_module()
    catalog = [{"name": "commit", "kind": "skill", "description": "Stage changes in a git commit."}]
    hit = rs.evaluate([{"prompt": "git commit", "expected": "none"}], catalog)
    miss = rs.evaluate([{"prompt": "weather tomorrow", "expected": "none"}], catalog)
    assert hit["description_tie_fair_accuracy"] == 0.0
    assert miss["description_tie_fair_accuracy"] == 1.0


def test_every_expected_name_exists_in_the_catalog():
    rs = _load_module()
    names = {e["name"] for e in rs.load_catalog(REPO_ROOT)}
    missing = sorted({i["expected"] for i in rs.load_labeled(LABELED)} - names - {"none"})
    assert not missing, f"labeled prompts expect names missing from the catalog: {missing}"


def test_labeled_set_has_one_prompt_per_gated_description():
    rs = _load_module()
    expected = {i["expected"] for i in rs.load_labeled(LABELED)}
    gated = {
        "app-preview", "async-enrichment-silent-loss-outcome-states",
        "avfoundation-capture-delivery-watchdog", "release-inapp-vs-asc-whatsnew-surfaces",
        "swift6-mainactor-compile-fixes", "vision-barcode-cidetector-fallback",
        "commit", "structured-output-adaptive-thinking-token-bloat", "linear-pick",
        "launchd-git-automation-self-heal", "swiftdata-cloudkit-production-schema",
        "swiftdata-cloudkit-model-rules", "swiftdata-rollback-attribute-restore",
        "explain-branch",
    }
    assert not (gated - expected), f"no labeled prompt for: {sorted(gated - expected)}"


def test_labeled_set_size_matches_the_baseline():
    rs = _load_module()
    assert len(rs.load_labeled(LABELED)) == BASELINE_N, (
        "labeled set changed: re-measure and update BASELINE_N and the floor together"
    )


def test_description_edit_does_not_regress():
    rs = _load_module()
    report = rs.evaluate(rs.load_labeled(LABELED), rs.load_catalog(REPO_ROOT))
    assert report["description_tie_fair_accuracy"] >= DESCRIPTION_TIE_FAIR_FLOOR - FLOOR_EPSILON, (
        f"description tie-fair accuracy {report['description_tie_fair_accuracy']:.3f} "
        f"fell below the committed floor {DESCRIPTION_TIE_FAIR_FLOOR:.3f}"
    )


def test_floor_fires_on_a_lorem_ipsum_description():
    """The gate must be shown failing: blank out the described skills and the floor trips."""
    rs = _load_module()
    labeled = rs.load_labeled(LABELED)
    catalog = copy.deepcopy(rs.load_catalog(REPO_ROOT))
    targets = {i["expected"] for i in labeled} - {"none"}
    for entry in catalog:
        if entry["name"] in targets:
            entry["description"] = LOREM
    broken = rs.evaluate(labeled, catalog)["description_tie_fair_accuracy"]
    assert broken < DESCRIPTION_TIE_FAIR_FLOOR - FLOOR_EPSILON


def test_floor_fires_on_one_real_description_edit():
    """Per-description sensitivity: one lorem-ipsum edit must be visible to the metric."""
    rs = _load_module()
    labeled = rs.load_labeled(LABELED)
    base_catalog = rs.load_catalog(REPO_ROOT)
    base = rs.evaluate(labeled, base_catalog)["description_tie_fair_accuracy"]
    drops = 0
    for target in sorted({i["expected"] for i in labeled} - {"none"}):
        catalog = copy.deepcopy(base_catalog)
        for entry in catalog:
            if entry["name"] == target:
                entry["description"] = LOREM
        if rs.evaluate(labeled, catalog)["description_tie_fair_accuracy"] < base - FLOOR_EPSILON:
            drops += 1
    assert drops >= 5, "the metric should notice a bad description on several skills"


def test_labeled_prompts_are_well_formed():
    labeled = json.loads(LABELED.read_text())
    assert all(set(i) == {"prompt", "expected"} for i in labeled)
    prompts = [i["prompt"] for i in labeled]
    assert len(prompts) == len(set(prompts)), "duplicate prompts inflate the metric"

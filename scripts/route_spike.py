#!/usr/bin/env python3
"""Routing spike — RFC v2 phase 2 gate.

Question: does a keyword/name scorer beat matching on a command's *description* —
the signal Claude Code already uses to auto-invoke skills? If keyword routing does
not clearly win, the proposed catalog + per-turn injection hook add a maintained
subsystem for no gain over the platform baseline, and the router is not built.

The keyword scorer routes on the command *name* only (the structured signal a
router adds). The description scorer is a deterministic proxy for native
auto-invocation. Any router that derives keywords *from* the description converges
to the description scorer, so the description number is an upper bound the router
cannot exceed — the keyword (name) number is its realistic floor.

Ties are decided by name (not catalog order) and also scored tie-fair, so the
numbers do not move when the catalog is listed in a different order. No model is
called: the scorer is token overlap, so the run is free and deterministic.

Run: `python3 scripts/route_spike.py`
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plugins" / "prompt-craft" / "scripts"))
from registry_lib import parse_frontmatter as _frontmatter  # noqa: E402

DEFAULT_THRESHOLD = 1  # min overlapping meaningful tokens to count as a match

STOPWORDS = {
    "the", "and", "for", "this", "that", "with", "from", "into", "your", "you",
    "are", "was", "but", "not", "all", "can", "has", "have", "out", "use", "via",
    "what", "whats", "who", "why", "how", "when", "where", "does", "did", "would",
    "let", "make", "made", "get", "got", "set", "add", "new", "any", "its", "it's",
    "me", "my", "mine", "our", "their", "them", "they", "his", "her", "a", "an",
    "to", "of", "in", "on", "at", "by", "is", "be", "do", "or", "as", "so", "up",
    "tell", "about", "before", "after", "different", "current", "state", "thing",
}


def tokenize(text: str) -> set:
    toks = re.split(r"[^a-z0-9]+", text.lower())
    return {t for t in toks if len(t) >= 3 and t not in STOPWORDS}



def load_catalog(repo_root) -> list:
    """Scan the repo's plugins for skills, commands, and agents.

    Skill/agent names come from frontmatter (`name:`); command names from the
    filename. Deduped by name (a skill and command can share one, e.g. commit).
    """
    plugins = Path(repo_root) / "plugins"
    entries = []
    # sorted(): glob order is filesystem-dependent, so sort every scan.
    for skill in sorted(plugins.glob("*/skills/*/SKILL.md")):
        fm = _frontmatter(skill)
        entries.append({"name": fm.get("name") or skill.parent.name,
                        "kind": "skill", "description": fm.get("description", "")})
    for cmd in sorted(plugins.glob("*/commands/*.md")):
        fm = _frontmatter(cmd)
        entries.append({"name": fm.get("name") or cmd.stem,
                        "kind": "command", "description": fm.get("description", "")})
    for agent in sorted(plugins.glob("*/agents/*.md")):
        fm = _frontmatter(agent)
        entries.append({"name": fm.get("name") or agent.stem,
                        "kind": "agent", "description": fm.get("description", "")})
    deduped = {}
    for e in entries:
        deduped.setdefault(e["name"], e)
    return sorted(deduped.values(), key=lambda e: e["name"])


def load_labeled(path) -> list:
    return json.loads(Path(path).read_text())


def _field_tokens(entry: dict, field: str) -> set:
    name_tokens = tokenize(entry["name"].replace("-", " "))
    if field == "keyword":
        return name_tokens
    return name_tokens | tokenize(entry.get("description", ""))


def tied_best(prompt: str, catalog: list, field: str, threshold: int = DEFAULT_THRESHOLD) -> list:
    """Names sharing the best overlap score, sorted by name; empty below threshold.

    The result depends only on the set of catalog entries, never on their order.
    """
    ptoks = tokenize(prompt)
    best_score, best = 0, []
    for entry in catalog:
        overlap = len(ptoks & _field_tokens(entry, field))
        if overlap > best_score:
            best_score, best = overlap, [entry["name"]]
        elif overlap == best_score and overlap > 0:
            best.append(entry["name"])
    return sorted(best) if best_score >= threshold else []


def predict(prompt: str, catalog: list, field: str, threshold: int = DEFAULT_THRESHOLD):
    """Single best name; a tie goes to the alphabetically first name (deterministic)."""
    tied = tied_best(prompt, catalog, field, threshold)
    return tied[0] if tied else None


def _tie_fair_credit(expected: str, tied: list) -> float:
    """1/k when the expected name is one of k tied winners; 'none' is right only on no match."""
    if not tied:
        return 1.0 if expected == "none" else 0.0
    return 1.0 / len(tied) if expected in tied else 0.0


def evaluate(labeled: list, catalog: list, threshold: int = DEFAULT_THRESHOLD) -> dict:
    kw_correct = desc_correct = 0
    kw_fair = desc_fair = 0.0
    for item in labeled:
        expected = item["expected"]
        kw_tied = tied_best(item["prompt"], catalog, "keyword", threshold)
        desc_tied = tied_best(item["prompt"], catalog, "description", threshold)
        kw_correct += int((kw_tied[0] if kw_tied else "none") == expected)
        desc_correct += int((desc_tied[0] if desc_tied else "none") == expected)
        kw_fair += _tie_fair_credit(expected, kw_tied)
        desc_fair += _tie_fair_credit(expected, desc_tied)
    n = len(labeled)
    return {
        "n": n,
        "keyword_accuracy": kw_correct / n,
        "description_accuracy": desc_correct / n,
        "keyword_tie_fair_accuracy": kw_fair / n,
        "description_tie_fair_accuracy": desc_fair / n,
    }


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    catalog = load_catalog(root)
    labeled = load_labeled(root / "tests" / "fixtures" / "intent-router" / "labeled-prompts.json")
    rep = evaluate(labeled, catalog)
    print(f"catalog: {len(catalog)} commands | prompts: {rep['n']}")
    print(f"keyword (name-only) accuracy:      {rep['keyword_accuracy']:.0%}")
    print(f"description (native proxy) accuracy: {rep['description_accuracy']:.0%}")
    print(f"keyword tie-fair accuracy:         {rep['keyword_tie_fair_accuracy']:.1%}")
    print(f"description tie-fair accuracy:     {rep['description_tie_fair_accuracy']:.1%}"
          " (the number tests/pytest/test_route_spike.py floors)")
    wins = rep["keyword_accuracy"] > rep["description_accuracy"]
    verdict = "BUILD the router" if wins else "DO NOT build the router"
    print(f"GATE: {verdict} — keyword routing must beat the native baseline to "
          f"justify the per-turn hook + catalog maintenance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
    for skill in plugins.glob("*/skills/*/SKILL.md"):
        fm = _frontmatter(skill)
        entries.append({"name": fm.get("name") or skill.parent.name,
                        "kind": "skill", "description": fm.get("description", "")})
    for cmd in plugins.glob("*/commands/*.md"):
        fm = _frontmatter(cmd)
        entries.append({"name": fm.get("name") or cmd.stem,
                        "kind": "command", "description": fm.get("description", "")})
    for agent in plugins.glob("*/agents/*.md"):
        fm = _frontmatter(agent)
        entries.append({"name": fm.get("name") or agent.stem,
                        "kind": "agent", "description": fm.get("description", "")})
    deduped = {}
    for e in entries:
        deduped.setdefault(e["name"], e)
    return list(deduped.values())


def load_labeled(path) -> list:
    return json.loads(Path(path).read_text())


def _field_tokens(entry: dict, field: str) -> set:
    name_tokens = tokenize(entry["name"].replace("-", " "))
    if field == "keyword":
        return name_tokens
    return name_tokens | tokenize(entry.get("description", ""))


def predict(prompt: str, catalog: list, field: str, threshold: int = DEFAULT_THRESHOLD):
    ptoks = tokenize(prompt)
    best_name, best_score = None, 0
    for entry in catalog:
        overlap = len(ptoks & _field_tokens(entry, field))
        if overlap > best_score:
            best_score, best_name = overlap, entry["name"]
    return best_name if best_score >= threshold else None


def evaluate(labeled: list, catalog: list, threshold: int = DEFAULT_THRESHOLD) -> dict:
    kw_correct = desc_correct = 0
    for item in labeled:
        expected = item["expected"]
        kw = predict(item["prompt"], catalog, "keyword", threshold) or "none"
        desc = predict(item["prompt"], catalog, "description", threshold) or "none"
        kw_correct += int(kw == expected)
        desc_correct += int(desc == expected)
    n = len(labeled)
    return {
        "n": n,
        "keyword_accuracy": kw_correct / n,
        "description_accuracy": desc_correct / n,
    }


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    catalog = load_catalog(root)
    labeled = load_labeled(root / "tests" / "fixtures" / "intent-router" / "labeled-prompts.json")
    rep = evaluate(labeled, catalog)
    print(f"catalog: {len(catalog)} commands | prompts: {rep['n']}")
    print(f"keyword (name-only) accuracy:      {rep['keyword_accuracy']:.0%}")
    print(f"description (native proxy) accuracy: {rep['description_accuracy']:.0%}")
    wins = rep["keyword_accuracy"] > rep["description_accuracy"]
    verdict = "BUILD the router" if wins else "DO NOT build the router"
    print(f"GATE: {verdict} — keyword routing must beat the native baseline to "
          f"justify the per-turn hook + catalog maintenance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

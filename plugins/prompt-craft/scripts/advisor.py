#!/usr/bin/env python3
"""Command advisor — the integration seam.

Reads a context JSON {prompt, git_state:{dirty,unpushed}, cwd} on stdin and
emits user-facing recommendations. Degrades to empty (never raises) on missing
or unparseable artifacts. The CLI main() lands in Task 6.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry_lib import tokenize  # noqa: E402

RELEVANCE_THRESHOLD = 1
TOP_K = 3
CONTEXT_HINTS = {
    "/prompt-craft:review": "check the diff first",
    "/commit": "save this work",
    "/pr": "open a pull request",
}


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def relevance(prompt_tokens: set, command: dict) -> int:
    return len(prompt_tokens & tokenize(command.get("description", "")))


def frequency(profile: dict, name: str) -> int:
    return (profile or {}).get("by_command", {}).get(name, {}).get("count", 0)


def context_fit(git_state: dict) -> list:
    git_state = git_state or {}
    if git_state.get("dirty"):
        return ["/prompt-craft:review", "/commit"]
    if git_state.get("unpushed", 0) > 0:
        return ["/pr"]
    return []


def _why(name, matched_token, deferred_from, freq) -> str:
    parts = []
    if matched_token:
        parts.append(f"fits '{matched_token}'")
    if deferred_from:
        parts.append(f"{deferred_from} defers here")
    if freq:
        parts.append(f"you've used it {freq}×")
    return f"{name} — " + ("; ".join(parts) if parts else "suggested")


def _ctx_why(name, freq) -> str:
    hint = CONTEXT_HINTS.get(name, "suggested")
    tail = f"; used {freq}×" if freq else ""
    return f"{name} — {hint}{tail}"


def _rec(cmd, score, why) -> dict:
    return {"name": cmd["name"], "kind": cmd.get("kind", "command"),
            "scope": cmd.get("scope", "global"), "score": score, "why": why}


def _recommend_prompt(prompt, commands, profile, k) -> list:
    by_name = {c["name"]: c for c in commands}
    present = set(by_name)
    ptoks = tokenize(prompt)
    best = {}  # target name -> (rel, matched_token, deferred_from, cmd)
    for c in commands:
        matched = ptoks & tokenize(c.get("description", ""))
        rel = len(matched)
        if rel < RELEVANCE_THRESHOLD:
            continue
        target, deferred_from = c, None
        po = [t for t in c.get("prefer_over", []) if t in present]
        if po:
            po.sort(key=lambda n: (not by_name[n].get("canonical"), n))
            target, deferred_from = by_name[po[0]], c["name"]
        token = sorted(matched)[0] if matched else ""
        prev = best.get(target["name"])
        if prev is None or rel > prev[0]:
            best[target["name"]] = (rel, token, deferred_from, target)
    ordered = sorted(
        best.values(),
        key=lambda v: (-v[0], -frequency(profile, v[3]["name"]), not v[3].get("canonical"), v[3]["name"]),
    )
    recs = [_rec(t, rel, _why(t["name"], tok, df, frequency(profile, t["name"])))
            for (rel, tok, df, t) in ordered]
    if len(recs) < k:
        chosen = {r["name"] for r in recs}
        used = set((profile or {}).get("by_command", {}))
        never = [c for c in commands
                 if c.get("canonical") and c["name"] not in used and c["name"] not in chosen]
        never.sort(key=lambda c: (not c.get("canonical"), c["name"]))
        for c in never:
            if len(recs) >= k:
                break
            recs.append(_rec(c, 0, _why(c["name"], "", None, 0)))
    return recs[:k]


def _recommend_context(git_state, commands, profile, k) -> list:
    by_name = {c["name"]: c for c in commands}
    recs = []
    for i, name in enumerate(context_fit(git_state)):
        cmd = by_name.get(name) or {"name": name}
        recs.append(_rec(cmd, len(context_fit(git_state)) - i, _ctx_why(name, frequency(profile, name))))
    return recs[:k]


def recommend(context: dict, registry, profile, k: int = TOP_K) -> list:
    commands = (registry or {}).get("commands", [])
    prompt = (context or {}).get("prompt")
    if prompt:
        return _recommend_prompt(prompt, commands, profile, k)
    return _recommend_context((context or {}).get("git_state"), commands, profile, k)

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

RELEVANCE_THRESHOLD = 2  # one shared word is noise, not a match
TOP_K = 3
NON_RECOMMENDABLE_KINDS = ("agent",)  # agents are not typed at the prompt
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


def _wanted_context(git_state: dict) -> list:
    git_state = git_state or {}
    if git_state.get("dirty"):
        return ["/prompt-craft:review", "/commit"]
    if git_state.get("unpushed", 0) > 0:
        return ["/pr"]
    return []


def _installed_equivalent(wanted, commands):
    """The installed command that stands in for a bare name, e.g.
    /core-workflow:commit for /commit, or None."""
    tail = ":" + wanted.lstrip("/").split(":")[-1]
    matches = [c for c in commands if c["name"].endswith(tail)
               and c.get("kind", "command") not in NON_RECOMMENDABLE_KINDS]
    matches.sort(key=lambda c: (not c.get("canonical"), c["name"]))
    return matches[0] if matches else None


def _resolve_context(git_state: dict, commands=None) -> list:
    """[(wanted name, command or None)] for the git context. With a populated
    registry, a wanted name that is not installed is replaced by an installed
    equivalent or dropped; with no registry the bare names pass through."""
    wanted = _wanted_context(git_state)
    if not commands:
        return [(name, None) for name in wanted]
    by_name = {c["name"]: c for c in commands}
    out, seen = [], set()
    for name in wanted:
        cmd = by_name.get(name) or _installed_equivalent(name, commands)
        if cmd is None or cmd["name"] in seen:
            continue
        seen.add(cmd["name"])
        out.append((name, cmd))
    return out


def context_fit(git_state: dict, commands=None) -> list:
    return [(cmd["name"] if cmd else name)
            for name, cmd in _resolve_context(git_state, commands)]


def _why(name, matched_token, deferred_from, freq) -> str:
    parts = []
    if matched_token:
        parts.append(f"fits '{matched_token}'")
    if deferred_from:
        parts.append(f"{deferred_from} defers here")
    if freq:
        parts.append(f"you've used it {freq}×")
    return f"{name} — " + ("; ".join(parts) if parts else "suggested")


def _ctx_why(name, freq, wanted=None) -> str:
    hint = CONTEXT_HINTS.get(wanted or name, "suggested")
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
    if 0 < len(recs) < k:
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
    resolved = _resolve_context(git_state, commands)
    recs = []
    for i, (wanted, found) in enumerate(resolved):
        cmd = found or {"name": wanted}
        # The hint belongs to what was wanted; the name is what is installed.
        recs.append(_rec(cmd, len(resolved) - i,
                         _ctx_why(cmd["name"], frequency(profile, cmd["name"]), wanted)))
    return recs[:k]


def recommend(context: dict, registry, profile, k: int = TOP_K) -> list:
    commands = [c for c in (registry or {}).get("commands", [])
                if c.get("kind", "command") not in NON_RECOMMENDABLE_KINDS]
    prompt = (context or {}).get("prompt")
    if prompt:
        return _recommend_prompt(prompt, commands, profile, k)
    return _recommend_context((context or {}).get("git_state"), commands, profile, k)


import argparse  # noqa: E402


def _banner(recs: list) -> str:
    if not recs:
        return ""
    lines = ["💡 Recommended commands:"]
    lines += [f"  {r['why']}" for r in recs]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("prompt", "statusline", "stop"), required=True)
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--prompt-file", default=None,
                    help="read the prompt text from this file instead of the "
                         "stdin context's \"prompt\" (no shell quoting needed)")
    args = ap.parse_args()
    try:
        context = json.loads(sys.stdin.read())
    except (ValueError, OSError):
        # A prompt file stands alone; without one, bad stdin means no advice.
        if not args.prompt_file:
            return 0
        context = {}
    if not isinstance(context, dict):
        return 0
    if args.prompt_file:
        try:
            context["prompt"] = Path(args.prompt_file).read_text()
        except (OSError, ValueError) as exc:
            print("advisor: cannot read --prompt-file: %s" % exc, file=sys.stderr)
            return 2
    base = Path(args.home) / ".claude" / "prompt-craft"
    registry = load_json(base / "registry.json")
    profile = load_json(base / "profile.json")
    recs = recommend(context, registry, profile)
    if not recs:
        return 0
    if args.mode == "statusline":
        sys.stdout.write("next: " + recs[0]["name"])
    else:
        sys.stdout.write(_banner(recs))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)

#!/usr/bin/env python3
"""Require a plugin.json version bump for every plugin a PR changes.

Used by the plugin-version-guard job in .github/workflows/test.yml. A plugin's
plugin.json `version` is the only update trigger Claude Code honours, so any PR
that touches plugins/<name>/** must bump it.

A plugin whose directory existed at the merge base but is gone at HEAD was
removed (moved to another repo, say). That is reported and passes: there is no
version left to bump. A plugin.json deleted while the directory stays fails.
If the merge base cannot be resolved the script exits 2 (fail closed).

Escape hatch: put [skip-plugin-bump] in a commit message of the range.

Usage: plugin_version_guard.py BASE_SHA HEAD_SHA   (run inside the git checkout)
"""
import json
import subprocess
import sys

SKIP_MARKER = "[skip-plugin-bump]"


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def _version_at(repo, rev, plugin):
    r = _git(repo, "show", f"{rev}:plugins/{plugin}/.claude-plugin/plugin.json")
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout).get("version")
    except json.JSONDecodeError:
        return "INVALID"


def evaluate(repo, base, head):
    """Return (skipped, touched, removed, failures) for the range merge-base(base, head)..head."""
    r = _git(repo, "merge-base", base, head)
    mb = r.stdout.strip()
    if r.returncode != 0 or not mb:
        # Fail closed: an empty merge base would turn the ranges into ..HEAD and pass silently.
        raise RuntimeError(f"git merge-base {base} {head} failed: {r.stderr.strip() or 'no output'}")
    msgs = _git(repo, "log", "--format=%B", f"{mb}..{head}").stdout
    if SKIP_MARKER in msgs:
        return True, [], [], []

    changed = [l for l in _git(repo, "diff", "--name-only", f"{mb}..{head}").stdout.splitlines() if l]
    touched = sorted({
        p.split("/")[1] for p in changed
        if p.startswith("plugins/") and len(p.split("/")) > 2
    })

    removed, failures = [], []
    for plugin in touched:
        base_v = _version_at(repo, mb, plugin)
        if base_v is None:                       # newly added plugin
            continue
        head_v = _version_at(repo, head, plugin)
        if head_v is None:
            if _git(repo, "ls-tree", head, f"plugins/{plugin}").stdout.strip():
                failures.append(
                    f"{plugin}: plugin.json missing at HEAD but plugins/{plugin} still exists"
                )
            else:
                removed.append(plugin)           # whole directory gone at HEAD
        elif head_v == "INVALID":
            failures.append(f"{plugin}: plugin.json invalid at HEAD")
        elif base_v == head_v:
            failures.append(
                f"{plugin}: content changed but version still {head_v} — "
                f"bump plugins/{plugin}/.claude-plugin/plugin.json"
            )
    return False, touched, removed, failures


def main(argv):
    base, head = argv[1], argv[2]
    try:
        skipped, touched, removed, failures = evaluate(".", base, head)
    except RuntimeError as err:
        print(f"Plugin version guard ERROR: {err}", file=sys.stderr)
        return 2
    if skipped:
        print(f"skip: {SKIP_MARKER} found in commit range")
        return 0
    for plugin in removed:
        print(f"removed: plugins/{plugin} existed at the merge base and is gone at HEAD (OK)")
    if failures:
        print("Plugin version guard FAILED:")
        for f in failures:
            print("  - " + f)
        print("\nBump the plugin's version (patch/minor/major), or add "
              f"{SKIP_MARKER} to a commit message if this ships nothing to users.")
        return 1
    bumped = [p for p in touched if p not in removed]
    print(f"OK: version bump present for changed plugins ({', '.join(bumped) or 'none'})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

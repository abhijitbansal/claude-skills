#!/usr/bin/env python3
"""Inventory count sweep — keeps skill counts in sync across docs and the site.

Skill counts appear in many files (footers, plugin badges, mermaid labels, the
catalog badge). AGENTS.md treats them as cross-file invariants: change them with
this one scripted sweep, never by hand.

Live count = directories under plugins/<plugin>/skills/ that contain SKILL.md
(excluding `_lib`). Scopes are `total` plus one per plugin that has a skills dir.
Skills only; command, agent and hook counts are not modeled.

Each SITES entry is (relative file, scope, regex template). The template has one
capture group for the number. A template may reuse the number with a `(?P<n>\\d+)`
group and `(?P=n)` backreferences (e.g. `data-count="N">N<`); `--write` rewrites
every copy. A template must match exactly once: zero matches means a renamed site
and is an error in every mode.

Structural invariant: the Skill rows in docs/catalog.html must equal the live
total. It is checked, never rewritten.

Run: `python3 scripts/sweep_counts.py [--check | --write]`
"""

import argparse
import re
import sys
from pathlib import Path

EXCLUDED_SKILL_DIRS = {"_lib"}
CATALOG_FILE = "docs/catalog.html"
CATALOG_ROW_RE = re.compile(r'<div class="crow" data-type="Skill"')
TOTAL_SCOPE = "total"
OG_REGEN_NOTE = "total changed: regenerate site/og.png from site/og.html"

_FOOTER_FILES = [
    "docs/architecture.html",
    "docs/catalog.html",
    "docs/machine-setup.html",
    "docs/second-wind/index.html",
    "docs/features/core-workflow.html",
    "docs/features/ios-dev.html",
    "docs/features/linear-pm.html",
    "docs/features/mods.html",
    "docs/features/portable-artifacts.html",
    "docs/features/prompt-craft.html",
    "docs/features/second-wind.html",
    "site/index.html",
]


def _stat_band(skill_label: str = "skills?") -> str:
    return rf'data-count="(?P<n>\d+)">(?P=n)</div><div class="l">{skill_label}</div>'


def _index_meta(plugin: str) -> str:
    return (rf'<a href="\.\./docs/features/{plugin}\.html">{plugin}</a></h3>\s*'
            r'<span class="meta">(\d+) skills? ·')


SITES = (
    [(f, TOTAL_SCOPE, r"\d+ plugins · (\d+) skills") for f in _FOOTER_FILES]
    + [
        ("site/og.html", TOTAL_SCOPE, r"\d+ plugins · (\d+) skills"),
        ("site/index.html", TOTAL_SCOPE, r"\d+ plugins, (\d+) skills,"),
        ("site/index.html", TOTAL_SCOPE, r'<span class="meta">(\d+) skills · \d+ commands · agents'),
        ("docs/catalog.html", TOTAL_SCOPE, r'<h3>Skills <span class="badge">(\d+)</span>'),
        # mermaid labels (architecture.html uses <br/><small>, architecture.md a dash)
        ("docs/architecture.html", "ios-dev", r"ios-dev<br/><small>(\d+) skills? ·"),
        ("docs/architecture.html", "linear-pm", r"linear-pm<br/><small>(\d+) skills? ·"),
        ("docs/architecture.html", "core-workflow", r"core-workflow<br/><small>(\d+) skills? ·"),
        ("docs/architecture.html", "prompt-craft", r"prompt-craft<br/><small>(\d+) skills? ·"),
        ("docs/architecture.html", "portable-artifacts", r"portable-artifacts<br/><small>(\d+) skills? ·"),
        ("docs/architecture.md", "ios-dev", r"ios-dev — (\d+) skills? ·"),
        ("docs/architecture.md", "linear-pm", r"linear-pm — (\d+) skills? ·"),
        ("docs/architecture.md", "core-workflow", r"core-workflow — (\d+) skills? ·"),
        ("docs/architecture.md", "prompt-craft", r"prompt-craft — (\d+) skills? ·"),
        ("docs/architecture.md", "portable-artifacts", r"portable-artifacts — (\d+) skills? ·"),
        # feature-page stat bands
        ("docs/features/ios-dev.html", "ios-dev", _stat_band()),
        ("docs/features/core-workflow.html", "core-workflow", _stat_band()),
        ("docs/features/prompt-craft.html", "prompt-craft", _stat_band()),
        ("docs/features/portable-artifacts.html", "portable-artifacts", _stat_band()),
        ("docs/features/linear-pm.html", "linear-pm", _stat_band()),
        # feature-page kickers
        ("docs/features/ios-dev.html", "ios-dev", r"plugin · (\d+) skills?"),
        ("docs/features/prompt-craft.html", "prompt-craft", r"plugin · (\d+) skills?"),
        ("docs/features/portable-artifacts.html", "portable-artifacts", r"plugin · (\d+) skills?"),
        # site index plugin rows
        ("site/index.html", "ios-dev", _index_meta("ios-dev")),
        ("site/index.html", "core-workflow", _index_meta("core-workflow")),
        ("site/index.html", "prompt-craft", _index_meta("prompt-craft")),
        ("site/index.html", "second-wind", _index_meta("second-wind")),
        ("site/index.html", "linear-pm", _index_meta("linear-pm")),
    ]
)


def live_counts(root) -> dict:
    """Skills per plugin plus `total`, from the plugins/ tree."""
    counts = {}
    for skills_dir in sorted(Path(root).glob("plugins/*/skills")):
        if not skills_dir.is_dir():
            continue
        counts[skills_dir.parent.name] = sum(
            1 for d in skills_dir.iterdir()
            if d.is_dir() and d.name not in EXCLUDED_SKILL_DIRS and (d / "SKILL.md").is_file()
        )
    return {TOTAL_SCOPE: sum(counts.values()), **counts}


def _read(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def _wide(template: str) -> str:
    """Template with the named backref widened so every copy of N is a group."""
    return template.replace("(?P=n)", r"(\d+)")


def scan(root, sites, live) -> list:
    """One result per site: found value (or None) plus an error string when unusable."""
    results = []
    for rel, scope, template in sites:
        entry = {"file": rel, "scope": scope, "template": template,
                 "found": None, "expected": live.get(scope), "error": None}
        path = Path(root) / rel
        if scope not in live:
            entry["error"] = f"unknown scope {scope!r}"
        elif not path.is_file():
            entry["error"] = "file missing"
        else:
            matches = list(re.finditer(template, _read(path)))
            if len(matches) != 1:
                entry["error"] = f"pattern matched {len(matches)} times (need exactly 1)"
            else:
                entry["found"] = int(matches[0].group(1))
        results.append(entry)
    return results


def catalog_rows(root):
    """Skill-row count in the catalog page, or None when the page is absent."""
    path = Path(root) / CATALOG_FILE
    if not path.is_file():
        return None
    return len(CATALOG_ROW_RE.findall(_read(path)))


def stale(results) -> list:
    return [r for r in results if r["error"] is None and r["found"] != r["expected"]]


def broken(results) -> list:
    return [r for r in results if r["error"] is not None]


def rewrite(root, results) -> list:
    """Rewrite each stale site to its live number; returns the changed entries."""
    changed = []
    for entry in stale(results):
        path = Path(root) / entry["file"]
        text = _read(path)
        wide = re.compile(_wide(entry["template"]))
        new_value = str(entry["expected"])

        def _sub(m, wide=wide, new_value=new_value):
            out, last = [], m.start()
            for i in range(1, wide.groups + 1):
                out.append(m.string[last:m.start(i)])
                out.append(new_value)
                last = m.end(i)
            out.append(m.string[last:m.end()])
            return "".join(out)

        new_text, n = wide.subn(_sub, text)
        if n != 1:
            entry["error"] = f"rewrite matched {n} times"
            continue
        _write(path, new_text)
        changed.append(entry)
    return changed


def _print_live(live, results, rows) -> None:
    print("live counts:")
    for scope, n in live.items():
        print(f"  {scope}: {n}")
    print("sites:")
    for r in results:
        found = r["error"] if r["error"] else r["found"]
        print(f"  {r['file']} [{r['scope']}] = {found}")
    if rows is not None:
        print(f"{CATALOG_FILE} Skill rows = {rows}")


def _report_problems(results, rows, live) -> int:
    failures = 0
    for r in stale(results):
        print(f"STALE {r['file']} [{r['scope']}] found {r['found']} expected {r['expected']}")
        failures += 1
    for r in broken(results):
        print(f"ERROR {r['file']} [{r['scope']}] {r['error']}: {r['template']}")
        failures += 1
    if rows is not None and rows != live[TOTAL_SCOPE]:
        print(f"STALE {CATALOG_FILE} [rows] found {rows} Skill rows expected {live[TOTAL_SCOPE]}"
              " (rows are not rewritten; regenerate the catalog)")
        failures += 1
    return failures


def run(root, sites, mode: str) -> int:
    live = live_counts(root)
    results = scan(root, sites, live)
    rows = catalog_rows(root)

    if mode == "report":
        _print_live(live, results, rows)
        return 1 if broken(results) else 0

    if mode == "check":
        failures = _report_problems(results, rows, live)
        if failures == 0:
            print(f"ok: {len(results)} sites in sync with live counts")
        return 1 if failures else 0

    if broken(results):
        for r in broken(results):
            print(f"ERROR {r['file']} [{r['scope']}] {r['error']}: {r['template']}")
        return 1
    total_stale = any(r["scope"] == TOTAL_SCOPE for r in stale(results))
    changed = rewrite(root, results)
    for r in changed:
        print(f"updated {r['file']} [{r['scope']}] {r['found']} -> {r['expected']}")
    if not changed:
        print("nothing to update")
    if total_stale:
        print(OG_REGEN_NOTE)
    if rows is not None and rows != live[TOTAL_SCOPE]:
        print(f"STALE {CATALOG_FILE} [rows] found {rows} Skill rows expected {live[TOTAL_SCOPE]}"
              " (rows are not rewritten; regenerate the catalog)")
        return 1
    return 1 if broken(results) else 0


def main(argv=None, root=None, sites=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="exit 1 on any stale or missing site")
    group.add_argument("--write", action="store_true", help="rewrite stale sites to the live count")
    args = parser.parse_args(argv)
    root = Path(root) if root else Path(__file__).resolve().parents[1]
    mode = "check" if args.check else "write" if args.write else "report"
    return run(root, SITES if sites is None else sites, mode)


if __name__ == "__main__":
    sys.exit(main())

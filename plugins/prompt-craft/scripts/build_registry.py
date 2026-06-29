#!/usr/bin/env python3
"""Scan repo + global command scopes into one ~/.claude/prompt-craft/registry.json.

Stdlib-only, no tomllib: the small overlay is parsed with ast.literal_eval.
"""
import argparse
import ast
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry_lib import atomic_write_json, parse_frontmatter, tokenize  # noqa: E402

HERE = Path(__file__).resolve().parent
OVERLAY_PATH = HERE.parent / "registry-notes.toml"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_overlay(path) -> dict:
    overlay = {"builtins": [], "prefer_over": {}}
    try:
        text = Path(path).read_text()
    except OSError:
        return overlay
    section = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip().strip('"')
        try:
            parsed = ast.literal_eval(val.strip())
        except (ValueError, SyntaxError):
            continue
        if section == "builtins" and key == "names":
            overlay["builtins"] = [str(x) for x in parsed]
        elif section == "prefer_over":
            overlay["prefer_over"][key] = [str(x) for x in parsed]
    return overlay


def _keywords(name: str, description: str) -> list:
    return sorted(tokenize(name.replace("-", " ").replace(":", " ")) | tokenize(description))


def _entry(name, kind, source, scope, description, prefer_over) -> dict:
    return {
        "name": name,
        "kind": kind,
        "source": source,
        "scope": scope,
        "description": description,
        "why": description,
        "when": "",
        "keywords": _keywords(name, description),
        "canonical": source != "prompt-craft",
        "prefer_over": prefer_over,
    }


def _safe_fm(path) -> dict:
    try:
        return parse_frontmatter(path)
    except OSError as exc:
        print(f"build_registry: skip {path}: {exc}", file=sys.stderr)
        return {}


def scan_repo(repo_root, overlay: dict) -> list:
    repo_root = Path(repo_root)
    prefer = overlay.get("prefer_over", {})
    out = []
    for skill in repo_root.glob("plugins/*/skills/*/SKILL.md"):
        source = skill.parents[2].name
        fm = _safe_fm(skill)
        name = "/" + source + ":" + (fm.get("name") or skill.parent.name)
        out.append(_entry(name, "skill", source, "repo", fm.get("description", ""), prefer.get(name, [])))
    for kind, pat in (("command", "plugins/*/commands/*.md"), ("agent", "plugins/*/agents/*.md")):
        for f in repo_root.glob(pat):
            source = f.parents[2].name
            fm = _safe_fm(f)
            name = "/" + source + ":" + (fm.get("name") or f.stem)
            out.append(_entry(name, kind, source, "repo", fm.get("description", ""), prefer.get(name, [])))
    for sub, kind in (("skills", "skill"), ("commands", "command")):
        base = repo_root / ".claude" / sub
        glob = "*/SKILL.md" if sub == "skills" else "*.md"
        for f in base.glob(glob):
            fm = _safe_fm(f)
            stem = f.parent.name if sub == "skills" else f.stem
            name = "/" + (fm.get("name") or stem)
            out.append(_entry(name, kind, "project", "repo", fm.get("description", ""), prefer.get(name, [])))
    return out


def _version_key(name: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", name)) or (0,)


def _plugin_version_dir(plugin_dir: Path):
    versions = [d for d in plugin_dir.glob("*/")
                if d.is_dir() and not d.name.startswith("temp_git_")]
    if not versions:
        return None
    return max(versions, key=lambda d: (_version_key(d.name), d.stat().st_mtime))


def _enabled_plugin_dirs(home, settings) -> list:
    cache = Path(home) / ".claude" / "plugins" / "cache"
    out = []
    ep = settings.get("enabledPlugins")
    keys = ep if isinstance(ep, (dict, list)) else []
    for key in keys:
        if "@" not in key:
            continue
        plugin, _, marketplace = key.partition("@")
        plugin_dir = cache / marketplace / plugin
        vdir = _plugin_version_dir(plugin_dir)
        if vdir is not None:
            out.append((plugin, vdir))
    return out


def _scan_dir_for(source, scope, root: Path, prefer) -> list:
    out = []
    for skill in (root / "skills").glob("*/SKILL.md"):
        fm = _safe_fm(skill)
        name = "/" + source + ":" + (fm.get("name") or skill.parent.name)
        out.append(_entry(name, "skill", source, scope, fm.get("description", ""), prefer.get(name, [])))
    for kind, pat in (("command", "commands/*.md"), ("agent", "agents/*.md")):
        for f in root.glob(pat):
            fm = _safe_fm(f)
            name = "/" + source + ":" + (fm.get("name") or f.stem)
            out.append(_entry(name, kind, source, scope, fm.get("description", ""), prefer.get(name, [])))
    return out


def scan_global(home, settings: dict, overlay: dict) -> list:
    home = Path(home)
    prefer = overlay.get("prefer_over", {})
    out = []
    uroot = home / ".claude"
    for skill in (uroot / "skills").glob("*/SKILL.md"):
        fm = _safe_fm(skill)
        name = "/" + (fm.get("name") or skill.parent.name)
        out.append(_entry(name, "skill", "user", "global", fm.get("description", ""), prefer.get(name, [])))
    for f in (uroot / "commands").glob("*.md"):
        fm = _safe_fm(f)
        name = "/" + (fm.get("name") or f.stem)
        out.append(_entry(name, "command", "user", "global", fm.get("description", ""), prefer.get(name, [])))
    for plugin, vdir in _enabled_plugin_dirs(home, settings):
        out.extend(_scan_dir_for(plugin, "global", vdir, prefer))
    return out


def _builtin_entries(overlay: dict) -> list:
    return [_entry(n, "builtin", "builtin", "global", "", []) for n in overlay.get("builtins", [])]


def _repo_files(repo_root) -> list:
    repo_root = Path(repo_root)
    files = list(repo_root.glob("plugins/*/skills/*/SKILL.md"))
    files += list(repo_root.glob("plugins/*/commands/*.md"))
    files += list(repo_root.glob("plugins/*/agents/*.md"))
    files += list((repo_root / ".claude").glob("skills/*/SKILL.md"))
    files += list((repo_root / ".claude").glob("commands/*.md"))
    return files


def _global_files(home, settings) -> list:
    home = Path(home)
    files = list((home / ".claude" / "skills").glob("*/SKILL.md"))
    files += list((home / ".claude" / "commands").glob("*.md"))
    for _plugin, vdir in _enabled_plugin_dirs(home, settings):
        files += list((vdir / "skills").glob("*/SKILL.md"))
        files += list(vdir.glob("commands/*.md"))
        files += list(vdir.glob("agents/*.md"))
    return files


def _sig(files) -> dict:
    mtimes = []
    for f in files:
        try:
            mtimes.append(f.stat().st_mtime)
        except OSError:
            pass
    return {"count": len(files), "max_mtime": max(mtimes, default=0.0)}


def current_signature(repo_root, home, settings) -> dict:
    return {"repo": _sig(_repo_files(repo_root)), "global": _sig(_global_files(home, settings))}


def _load_settings(home) -> dict:
    try:
        data = json.loads((Path(home) / ".claude" / "settings.json").read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def build_registry(repo_root, home, claude_version, *, overlay_path=None) -> dict:
    repo_root, home = Path(repo_root), Path(home)
    overlay = load_overlay(overlay_path if overlay_path is not None else OVERLAY_PATH)
    settings = _load_settings(home)
    commands = scan_repo(repo_root, overlay) + scan_global(home, settings, overlay) + _builtin_entries(overlay)
    deduped = {}
    for c in commands:
        deduped.setdefault(c["name"], c)
    commands = sorted(deduped.values(), key=lambda c: c["name"])
    registry = {
        "built_at": _now_iso(),
        "claude_version": claude_version,
        "repo_root": str(repo_root),
        "scan_signature": current_signature(repo_root, home, settings),
        "commands": commands,
    }
    atomic_write_json(home / ".claude" / "prompt-craft" / "registry.json", registry)
    return registry


def _check_stale(repo_root, home, claude_version) -> bool:
    reg_path = Path(home) / ".claude" / "prompt-craft" / "registry.json"
    try:
        reg = json.loads(reg_path.read_text())
    except (OSError, ValueError):
        return True
    if reg.get("repo_root") != str(Path(repo_root)):
        return True
    settings = _load_settings(home)
    if reg.get("scan_signature") != current_signature(repo_root, home, settings):
        return True
    if claude_version and reg.get("claude_version") != claude_version:
        return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--signature", action="store_true")
    ap.add_argument("--claude-version", default=None)
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--repo-root", default=os.getcwd())
    args = ap.parse_args()
    if args.signature:
        settings = _load_settings(args.home)
        print(json.dumps(current_signature(args.repo_root, args.home, settings)))
        return 0
    if args.check:
        print("stale" if _check_stale(args.repo_root, args.home, args.claude_version) else "fresh")
        return 0
    build_registry(args.repo_root, args.home, args.claude_version)
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Command-Advisor Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a user-facing command advisor for prompt-craft that scans every installed command into one registry, learns the user's own habits, and surfaces the right canonical command at prompt-time, in the statusline, and post-turn — to the user's eyes only, never the model's context.

**Architecture:** Three stdlib Python scripts ship in the plugin — `build_registry.py` (scan repo + global scopes → one `~/.claude/prompt-craft/registry.json`), `learn_history.py` (mine `history.jsonl` → `profile.json`), and `advisor.py` (the CLI seam: `--mode={prompt|statusline|stop}` reading a context JSON on stdin). Bash hooks (`prompt_hint.sh` UserPromptSubmit, extended `suggest_next.sh` Stop, `statusline_hint.sh`, `registry_freshness.sh` SessionStart) call the advisor CLI and render output via top-level `systemMessage` or the statusline; the model context is never touched. The hand-off is made real by setting `disable-model-invocation` on the prompt-craft skills that have a canonical equivalent.

**Tech Stack:** stdlib Python 3 (json, re, ast, os, tempfile, pathlib — no tomllib, no new deps), bash hooks parsing stdin JSON via `/usr/bin/python3`, bats + pytest, matching the repo.

## Global Constraints
- stdlib-only, no new deps (no tomllib — `/usr/bin/python3` is 3.9 on macOS; parse the small overlay with `ast.literal_eval`).
- All artifacts under `~/.claude/prompt-craft/` (`profile.json` `0600`, dir `0700`); NOTHING written into user repos.
- Advisor output reaches the user ONLY via `systemMessage`/statusline, NEVER `additionalContext`/stdout-to-model.
- `systemMessage` is a TOP-LEVEL JSON key (`{"systemMessage": …}`), never nested under `hookSpecificOutput`.
- Atomic writes (temp file in same dir + `fsync` + `os.replace`) for `registry.json`/`profile.json`/`settings.json`.
- All hooks `exit 0` on any error — an advisor fault must never block a prompt, turn, or statusline render.
- Untrusted data (plugin descriptions, history tokens) is rendered only via `printf '%s'` / `json.dumps`, never `eval`, never an unquoted expansion, never a `printf` format string.
- Only the leading token of `display` is read from `history.jsonl`; `pastedContents` is never read.
- Honor `CLAUDE_CODE_SKIP_PROMPT_HISTORY` by an explicit env check (empty profile, no read) — never infer opt-out from file-absence.
- macOS + Ubuntu CI must stay green; stdlib only.
- prompt-craft's own commands are `/prompt-craft:<name>`; bare forms (`/commit`, `/pr`, `/goal`, `/ecc:plan`, `/code-review`) denote external/canonical commands.

---

### Task 1: Shared `registry_lib.py` helper (promote `_frontmatter`)

The plugin scripts run from the installed cache, so the shared helper must ship **inside** the plugin. Promote `route_spike.py`'s frontmatter parser (and the tokenizer it duplicates) into one module both the repo spike and the new plugin scripts reuse, plus the atomic-write helper every writer needs.

- **Files:**
  - Create `plugins/prompt-craft/scripts/registry_lib.py`
  - Modify `scripts/route_spike.py` (lines 18-53: imports + delete local `_frontmatter`)
  - Test `tests/pytest/test_registry_lib.py`

- **Interfaces:**
  - Produces: `STOPWORDS: set[str]`; `tokenize(text: str) -> set[str]`; `parse_frontmatter(path) -> dict`; `atomic_write_json(path, data: dict, mode: int = 0o600, sort_keys: bool = True) -> None`.
  - Consumes: nothing (leaf module, stdlib only).

- [ ] Write failing test `tests/pytest/test_registry_lib.py`:
  ```python
  """Shared helper used by build_registry, advisor, and the route spike."""
  import json
  import os
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  sys.path.insert(0, str(SCRIPTS))
  import registry_lib as rl  # noqa: E402


  def test_tokenize_drops_stopwords_and_short_tokens():
      toks = rl.tokenize("Fix the bug in my app")
      assert {"fix", "bug", "app"} <= toks
      assert not ({"the", "in", "my"} & toks)


  def test_parse_frontmatter_reads_scalars(tmp_path):
      md = tmp_path / "SKILL.md"
      md.write_text("---\nname: plan\ndescription: Decompose a task.\n---\n# body\n")
      fm = rl.parse_frontmatter(md)
      assert fm == {"name": "plan", "description": "Decompose a task."}


  def test_parse_frontmatter_missing_block_returns_empty(tmp_path):
      md = tmp_path / "x.md"
      md.write_text("# no frontmatter here\n")
      assert rl.parse_frontmatter(md) == {}


  def test_atomic_write_json_writes_valid_file_with_perms(tmp_path):
      target = tmp_path / "sub" / "out.json"
      rl.atomic_write_json(target, {"b": 2, "a": 1})
      assert json.loads(target.read_text()) == {"a": 1, "b": 2}
      assert oct(os.stat(target).st_mode & 0o777) == "0o600"
      assert oct(os.stat(target.parent).st_mode & 0o777) == "0o700"
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_registry_lib.py -q` → `ModuleNotFoundError: No module named 'registry_lib'`.
- [ ] Create `plugins/prompt-craft/scripts/registry_lib.py`:
  ```python
  #!/usr/bin/env python3
  """Shared helpers for the prompt-craft command-advisor scripts.

  Stdlib-only and version-agnostic (runs under /usr/bin/python3 3.9+): no tomllib.
  """
  import json
  import os
  import re
  import tempfile
  from pathlib import Path

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
      toks = re.split(r"[^a-z0-9]+", (text or "").lower())
      return {t for t in toks if len(t) >= 3 and t not in STOPWORDS}


  def parse_frontmatter(path) -> dict:
      """Parse a leading `---` frontmatter block into a flat {key: value} dict."""
      text = Path(path).read_text()
      if not text.startswith("---"):
          return {}
      end = text.find("\n---", 3)
      if end == -1:
          return {}
      out = {}
      for line in text[3:end].splitlines():
          if ":" in line and not line.lstrip().startswith("#"):
              key, _, value = line.partition(":")
              out[key.strip()] = value.strip()
      return out


  def atomic_write_json(path, data: dict, mode: int = 0o600, sort_keys: bool = True) -> None:
      """Write JSON via temp file + fsync + os.replace; dir 0700, file `mode`."""
      path = Path(path)
      path.parent.mkdir(parents=True, exist_ok=True)
      try:
          os.chmod(path.parent, 0o700)
      except OSError:
          pass
      fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
      try:
          with os.fdopen(fd, "w") as fh:
              json.dump(data, fh, indent=2, sort_keys=sort_keys)
              fh.flush()
              os.fsync(fh.fileno())
          os.chmod(tmp, mode)
          os.replace(tmp, path)
      except Exception:
          try:
              os.unlink(tmp)
          except OSError:
              pass
          raise
  ```
- [ ] Edit `scripts/route_spike.py` to reuse the helper. Replace the local `_frontmatter` definition (lines 41-53) with an import. After the existing `from pathlib import Path` (line 21), add:
  ```python
  sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plugins" / "prompt-craft" / "scripts"))
  from registry_lib import parse_frontmatter as _frontmatter  # noqa: E402
  ```
  and delete the `def _frontmatter(path: Path) -> dict:` block (lines 41-53). Leave `tokenize`/`STOPWORDS` in `route_spike.py` untouched (surgical: the spec asks only to promote `_frontmatter`).
- [ ] Run both suites — expect PASS: `uv tool run pytest tests/pytest/test_registry_lib.py tests/pytest/test_route_spike.py -q` → all pass (route spike's `load_catalog` still resolves `_frontmatter` via the import).
- [ ] Commit: `feat(prompt-craft): add shared registry_lib helper; reuse in route_spike`

---

### Task 2: `build_registry.py` repo scope + overlay + atomic write + `registry-notes.toml`

The spine. Scan the repo scope, merge the small overlay, emit the full schema atomically. Global scope is stubbed (`scan_global` returns `[]`) and lands in Task 3 — the schema and signature shape are final now so Task 3 is purely additive.

- **Files:**
  - Create `plugins/prompt-craft/scripts/build_registry.py`
  - Create `plugins/prompt-craft/registry-notes.toml`
  - Test `tests/pytest/test_build_registry.py`

- **Interfaces:**
  - Consumes: `registry_lib.tokenize`, `registry_lib.parse_frontmatter`, `registry_lib.atomic_write_json`.
  - Produces:
    - `load_overlay(path) -> dict` → `{"builtins": list[str], "prefer_over": dict[str, list[str]]}`
    - `scan_repo(repo_root: Path, overlay: dict) -> list[dict]`
    - `scan_global(home: Path, settings: dict, overlay: dict) -> list[dict]` (stub returns `[]` in this task)
    - `current_signature(repo_root: Path, home: Path, settings: dict) -> dict` → `{"repo": {"count": int, "max_mtime": float}, "global": {...}}`
    - `build_registry(repo_root: Path, home: Path, claude_version) -> dict` (the full schema dict)
    - `main()` / argparse CLI: `python3 build_registry.py [--check] [--signature] [--claude-version V] [--home D] [--repo-root D]`
    - Command dict schema (every entry): `{"name","kind","source","scope","description","why","when","keywords","canonical","prefer_over"}`

- [ ] Write failing test `tests/pytest/test_build_registry.py`:
  ```python
  """build_registry.py — repo-scope scan, overlay merge, atomic write."""
  import json
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  sys.path.insert(0, str(SCRIPTS))
  import build_registry as br  # noqa: E402


  def _mk_skill(root, plugin, name, desc):
      p = root / "plugins" / plugin / "skills" / name / "SKILL.md"
      p.parent.mkdir(parents=True, exist_ok=True)
      p.write_text(f"---\nname: {name}\ndescription: {desc}\n---\n# {name}\n")
      return p


  def _overlay():
      return {"builtins": ["/goal"], "prefer_over": {"/prompt-craft:plan": ["/goal"]}}


  def test_scan_repo_finds_plugin_skills_with_qualified_names(tmp_path):
      _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task into steps.")
      _mk_skill(tmp_path, "ecc", "review", "Review a diff for bugs.")
      cmds = br.scan_repo(tmp_path, _overlay())
      by = {c["name"]: c for c in cmds}
      assert "/prompt-craft:plan" in by and "/ecc:review" in by
      assert by["/prompt-craft:plan"]["kind"] == "skill"
      assert by["/prompt-craft:plan"]["scope"] == "repo"


  def test_canonical_is_true_for_non_prompt_craft(tmp_path):
      _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
      _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
      by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
      assert by["/ecc:review"]["canonical"] is True
      assert by["/prompt-craft:plan"]["canonical"] is False


  def test_prefer_over_merged_from_overlay(tmp_path):
      _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
      by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
      assert by["/prompt-craft:plan"]["prefer_over"] == ["/goal"]


  def test_keywords_inferred_from_name_and_description(tmp_path):
      _mk_skill(tmp_path, "ecc", "review", "Review a diff for bugs.")
      by = {c["name"]: c for c in br.scan_repo(tmp_path, _overlay())}
      kw = set(by["/ecc:review"]["keywords"])
      assert {"review", "diff", "bugs"} <= kw


  def test_malformed_skill_is_skipped_not_fatal(tmp_path, capsys):
      good = _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
      bad = tmp_path / "plugins" / "ecc" / "skills" / "broken" / "SKILL.md"
      bad.parent.mkdir(parents=True, exist_ok=True)
      bad.write_text("no frontmatter at all")
      names = {c["name"] for c in br.scan_repo(tmp_path, _overlay())}
      assert "/ecc:review" in names  # good entry survives; bad one skipped (falls back to dir name, empty desc)


  def test_load_overlay_parses_builtins_and_prefer_over(tmp_path):
      f = tmp_path / "registry-notes.toml"
      f.write_text(
          '[builtins]\nnames = ["/goal", "/model"]\n\n'
          '[prefer_over]\n"/prompt-craft:plan" = ["/goal", "/ecc:plan"]\n'
      )
      ov = br.load_overlay(f)
      assert ov["builtins"] == ["/goal", "/model"]
      assert ov["prefer_over"]["/prompt-craft:plan"] == ["/goal", "/ecc:plan"]


  def test_build_registry_writes_valid_atomic_file(tmp_path):
      _mk_skill(tmp_path, "prompt-craft", "plan", "Decompose a task.")
      home = tmp_path / "home"
      (home / ".claude").mkdir(parents=True)
      reg = br.build_registry(tmp_path, home, "1.2.3")
      out = home / ".claude" / "prompt-craft" / "registry.json"
      br_atomic = json.loads(out.read_text())  # written by build_registry() itself
      assert br_atomic["repo_root"] == str(tmp_path)
      assert br_atomic["claude_version"] == "1.2.3"
      assert any(c["name"] == "/prompt-craft:plan" for c in br_atomic["commands"])
      assert "repo" in br_atomic["scan_signature"] and "global" in br_atomic["scan_signature"]
      assert reg == br_atomic


  def test_stale_entry_dropped_on_rebuild(tmp_path):
      import shutil
      home = tmp_path / "home"
      (home / ".claude").mkdir(parents=True)
      skill = _mk_skill(tmp_path, "ecc", "review", "Review a diff.")
      br.build_registry(tmp_path, home, None)
      shutil.rmtree(skill.parent)  # delete the skill, then rebuild
      reg = br.build_registry(tmp_path, home, None)
      assert not any(c["name"] == "/ecc:review" for c in reg["commands"])
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_build_registry.py -q` → `ModuleNotFoundError: No module named 'build_registry'`.
- [ ] Create `plugins/prompt-craft/registry-notes.toml`:
  ```toml
  # Small overlay merged into registry.json by build_registry.py.
  # Only two things live here: built-in commands (not on disk) and the
  # prompt-craft -> canonical hand-off pairs. Everything else derives from
  # each command's own frontmatter description.

  [builtins]
  # Built-in slash commands Claude Code ships; surfaced as canonical.
  names = ["/goal", "/model", "/code-review", "/clear", "/compact"]

  [prefer_over]
  # prompt-craft skill -> canonical commands it defers to (the hand-off).
  "/prompt-craft:plan" = ["/goal", "/ecc:plan"]
  "/prompt-craft:review" = ["/code-review"]
  ```
- [ ] Create `plugins/prompt-craft/scripts/build_registry.py`:
  ```python
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


  def scan_global(home, settings: dict, overlay: dict) -> list:
      # Global scope lands in Task 3. Builtins are merged in build_registry().
      return []


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
      return []  # mirrors scan_global; filled in Task 3


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
          return json.loads((Path(home) / ".claude" / "settings.json").read_text())
      except (OSError, ValueError):
          return {}


  def build_registry(repo_root, home, claude_version) -> dict:
      repo_root, home = Path(repo_root), Path(home)
      overlay = load_overlay(OVERLAY_PATH)
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
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_build_registry.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): build_registry repo scope + overlay + atomic write`

---

### Task 3: `build_registry.py` global scope (plugin cache glob + builtins regression)

Fill in `scan_global` / `_global_files`: scan `~/.claude/{skills,commands}` and, for each `<plugin>@<marketplace>` in `enabledPlugins`, resolve the **corrected** 3-level cache path `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, pick the newest version dir, skip `temp_git_*`.

- **Files:**
  - Modify `plugins/prompt-craft/scripts/build_registry.py` (replace the `scan_global` and `_global_files` stubs + add `_version_key`, `_plugin_version_dir`)
  - Test `tests/pytest/test_build_registry_global.py`

- **Interfaces:**
  - Consumes: settings `{"enabledPlugins": {"<plugin>@<marketplace>": ...}}` (Task 2 `_load_settings`).
  - Produces: `_version_key(name: str) -> tuple[int, ...]`; `_plugin_version_dir(plugin_dir: Path) -> Path | None`; real `scan_global(home, settings, overlay) -> list[dict]`; real `_global_files(home, settings) -> list[Path]`.

- [ ] Write failing test `tests/pytest/test_build_registry_global.py`:
  ```python
  """Global-scope scan: the corrected marketplace/plugin/version cache glob."""
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  sys.path.insert(0, str(SCRIPTS))
  import build_registry as br  # noqa: E402


  def _cache_skill(home, marketplace, plugin, version, skill, desc):
      p = (home / ".claude" / "plugins" / "cache" / marketplace / plugin / version
           / "skills" / skill / "SKILL.md")
      p.parent.mkdir(parents=True, exist_ok=True)
      p.write_text(f"---\nname: {skill}\ndescription: {desc}\n---\n# {skill}\n")
      return p


  def _settings(*keys):
      return {"enabledPlugins": {k: [{"scope": "user"}] for k in keys}}


  def test_version_key_orders_numerically():
      assert br._version_key("1.10.0") > br._version_key("1.9.0")


  def test_three_level_cache_glob_resolves_skill(tmp_path):
      home = tmp_path / "home"
      _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "Decompose work.")
      cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
      by = {c["name"]: c for c in cmds}
      assert "/ecc:plan" in by
      assert by["/ecc:plan"]["scope"] == "global"


  def test_newest_version_dir_is_picked(tmp_path):
      home = tmp_path / "home"
      _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "OLD description.")
      _cache_skill(home, "alpha", "ecc", "0.2.0", "plan", "NEW description.")
      cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
      by = {c["name"]: c for c in cmds}
      assert by["/ecc:plan"]["description"] == "NEW description."


  def test_temp_git_dirs_are_skipped(tmp_path):
      home = tmp_path / "home"
      _cache_skill(home, "alpha", "ecc", "0.1.0", "plan", "Real one.")
      _cache_skill(home, "alpha", "ecc", "temp_git_xyz", "plan", "Transient.")
      cmds = br.scan_global(home, _settings("ecc@alpha"), {"builtins": [], "prefer_over": {}})
      by = {c["name"]: c for c in cmds}
      assert by["/ecc:plan"]["description"] == "Real one."


  def test_missing_plugin_cache_is_skipped_silently(tmp_path):
      home = tmp_path / "home"
      (home / ".claude").mkdir(parents=True)
      cmds = br.scan_global(home, _settings("ghost@alpha"), {"builtins": [], "prefer_over": {}})
      assert cmds == []


  def test_user_level_skills_and_commands_scanned(tmp_path):
      home = tmp_path / "home"
      uc = home / ".claude" / "commands" / "deploy.md"
      uc.parent.mkdir(parents=True, exist_ok=True)
      uc.write_text("---\nname: deploy\ndescription: Ship it.\n---\n")
      cmds = br.scan_global(home, {"enabledPlugins": {}}, {"builtins": [], "prefer_over": {}})
      assert any(c["name"] == "/deploy" and c["source"] == "user" for c in cmds)
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_build_registry_global.py -q` → fails (e.g. `test_three_level_cache_glob_resolves_skill` → `assert "/ecc:plan" in {}`; stub returns `[]`).
- [ ] Edit `plugins/prompt-craft/scripts/build_registry.py` — replace the `scan_global` stub and `_global_files` stub with:
  ```python
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
      for key in (settings.get("enabledPlugins") or {}):
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


  def _global_files(home, settings) -> list:
      home = Path(home)
      files = list((home / ".claude" / "skills").glob("*/SKILL.md"))
      files += list((home / ".claude" / "commands").glob("*.md"))
      for _plugin, vdir in _enabled_plugin_dirs(home, settings):
          files += list((vdir / "skills").glob("*/SKILL.md"))
          files += list(vdir.glob("commands/*.md"))
          files += list(vdir.glob("agents/*.md"))
      return files
  ```
- [ ] Run both registry test files — expect PASS: `uv tool run pytest tests/pytest/test_build_registry.py tests/pytest/test_build_registry_global.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): build_registry global scope via corrected cache glob`

---

### Task 4: `learn_history.py` (opt-out, leading-token-only, cap, perms)

Mine `~/.claude/history.jsonl` into `profile.json`. **Assumption to verify before coding:** the opt-out env var name is `CLAUDE_CODE_SKIP_PROMPT_HISTORY` (spec open-risk). Confirm against current Claude Code docs (claude-code-guide agent or docs) and correct the constant if wrong — a wrong name silently disables the opt-out.

- **Files:**
  - Create `plugins/prompt-craft/scripts/learn_history.py`
  - Test `tests/pytest/test_learn_history.py`

- **Interfaces:**
  - Consumes: `registry_lib.atomic_write_json`.
  - Produces:
    - `SKIP_ENV = "CLAUDE_CODE_SKIP_PROMPT_HISTORY"`; `HISTORY_MAX_ENTRIES = 5000`
    - `_is_truthy(value: str | None) -> bool`
    - `learn(home, env=None) -> dict` → `{"learned_at": iso, "by_command": {name: {"count": int, "last_ts": str}}}`; writes `profile.json` atomically (`0600`, dir `0700`).
    - `main()` / argparse: `python3 learn_history.py [--home D]`.

- [ ] Verify the env-var name (docs check); record the confirmed name in `SKIP_ENV`.
- [ ] Write failing test `tests/pytest/test_learn_history.py`:
  ```python
  """learn_history.py — minimal, opt-out-honoring history mining."""
  import json
  import os
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  sys.path.insert(0, str(SCRIPTS))
  import learn_history as lh  # noqa: E402


  def _history(home, lines):
      h = home / ".claude" / "history.jsonl"
      h.parent.mkdir(parents=True, exist_ok=True)
      h.write_text("".join(json.dumps(x) + "\n" for x in lines))
      return h


  def test_counts_leading_slash_token_only(tmp_path):
      home = tmp_path / "home"
      _history(home, [
          {"display": "/commit save it", "pastedContents": {}, "timestamp": "2026-06-01T00:00:00Z"},
          {"display": "/commit again", "pastedContents": {}, "timestamp": "2026-06-02T00:00:00Z"},
          {"display": "just chatting", "pastedContents": {}, "timestamp": "2026-06-03T00:00:00Z"},
      ])
      prof = lh.learn(home, env={})
      assert prof["by_command"]["/commit"]["count"] == 2
      assert "/just" not in prof["by_command"]  # non-slash display ignored
      assert prof["by_command"]["/commit"]["last_ts"] == "2026-06-02T00:00:00Z"


  def test_pasted_contents_never_read(tmp_path):
      home = tmp_path / "home"
      _history(home, [{"display": "/commit", "pastedContents": {"a": "/secret-token"}, "timestamp": "t"}])
      prof = lh.learn(home, env={})
      assert "/secret-token" not in json.dumps(prof)


  def test_optout_yields_empty_profile_even_with_history(tmp_path):
      home = tmp_path / "home"
      _history(home, [{"display": "/commit", "pastedContents": {}, "timestamp": "t"}])
      prof = lh.learn(home, env={lh.SKIP_ENV: "1"})
      assert prof["by_command"] == {}


  def test_cap_keeps_only_most_recent(tmp_path):
      home = tmp_path / "home"
      lines = [{"display": "/old", "pastedContents": {}, "timestamp": "t"}]
      lines += [{"display": "/new", "pastedContents": {}, "timestamp": "t"} for _ in range(lh.HISTORY_MAX_ENTRIES)]
      _history(home, lines)
      prof = lh.learn(home, env={})
      assert "/old" not in prof["by_command"]  # pushed out by the 5000-line cap
      assert prof["by_command"]["/new"]["count"] == lh.HISTORY_MAX_ENTRIES


  def test_missing_history_yields_empty_profile(tmp_path):
      home = tmp_path / "home"
      (home / ".claude").mkdir(parents=True)
      prof = lh.learn(home, env={})
      assert prof["by_command"] == {}


  def test_profile_written_with_perms(tmp_path):
      home = tmp_path / "home"
      _history(home, [{"display": "/commit", "pastedContents": {}, "timestamp": "t"}])
      lh.learn(home, env={})
      pf = home / ".claude" / "prompt-craft" / "profile.json"
      assert oct(os.stat(pf).st_mode & 0o777) == "0o600"
      assert oct(os.stat(pf.parent).st_mode & 0o777) == "0o700"
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_learn_history.py -q` → `ModuleNotFoundError: No module named 'learn_history'`.
- [ ] Create `plugins/prompt-craft/scripts/learn_history.py`:
  ```python
  #!/usr/bin/env python3
  """Mine ~/.claude/history.jsonl into ~/.claude/prompt-craft/profile.json.

  Reads only the leading token of `display`; never reads `pastedContents`.
  Honors the opt-out env var explicitly (empty profile, no read).
  """
  import argparse
  import json
  import os
  import sys
  from collections import deque
  from datetime import datetime, timezone
  from pathlib import Path

  sys.path.insert(0, str(Path(__file__).resolve().parent))
  from registry_lib import atomic_write_json  # noqa: E402

  SKIP_ENV = "CLAUDE_CODE_SKIP_PROMPT_HISTORY"  # verify against current docs before coding
  HISTORY_MAX_ENTRIES = 5000


  def _now_iso() -> str:
      return datetime.now(timezone.utc).isoformat()


  def _is_truthy(value) -> bool:
      return bool(value) and str(value).strip().lower() not in ("0", "false", "no", "")


  def _profile_path(home) -> Path:
      return Path(home) / ".claude" / "prompt-craft" / "profile.json"


  def learn(home, env=None) -> dict:
      env = os.environ if env is None else env
      profile = {"learned_at": _now_iso(), "by_command": {}}
      if _is_truthy(env.get(SKIP_ENV)):
          atomic_write_json(_profile_path(home), profile)
          return profile
      history = Path(home) / ".claude" / "history.jsonl"
      try:
          with open(history, "r", encoding="utf-8", errors="ignore") as fh:
              lines = deque(fh, maxlen=HISTORY_MAX_ENTRIES)
      except OSError:
          print(f"learn_history: no history at {history}", file=sys.stderr)
          atomic_write_json(_profile_path(home), profile)
          return profile
      by_command = profile["by_command"]
      for raw in lines:
          raw = raw.strip()
          if not raw:
              continue
          try:
              rec = json.loads(raw)
          except ValueError:
              continue
          display = rec.get("display") or ""
          parts = display.split()
          if not parts or not parts[0].startswith("/"):
              continue
          name = parts[0]
          ts = rec.get("timestamp") or profile["learned_at"]
          entry = by_command.setdefault(name, {"count": 0, "last_ts": ts})
          entry["count"] += 1
          entry["last_ts"] = ts
      atomic_write_json(_profile_path(home), profile)
      return profile


  def main() -> int:
      ap = argparse.ArgumentParser()
      ap.add_argument("--home", default=os.path.expanduser("~"))
      args = ap.parse_args()
      learn(args.home)
      return 0


  if __name__ == "__main__":
      sys.exit(main())
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_learn_history.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): learn_history miner (opt-out, leading-token, capped)`

---

### Task 5: `advisor.py` scoring core (3 signals + canonical override + discovery)

The brains. Pure, testable functions; degrades to empty when artifacts are missing. The CLI wrapper lands in Task 6.

- **Files:**
  - Create `plugins/prompt-craft/scripts/advisor.py` (functions only — no `__main__` guard yet)
  - Test `tests/pytest/test_advisor.py`

- **Interfaces:**
  - Consumes: `registry_lib.tokenize`; registry dict (Task 2/3 schema); profile dict (Task 4 schema).
  - Produces:
    - `RELEVANCE_THRESHOLD = 1`; `TOP_K = 3`; `CONTEXT_HINTS: dict[str, str]`
    - `load_json(path) -> dict | None`
    - `relevance(prompt_tokens: set, command: dict) -> int`
    - `frequency(profile: dict, name: str) -> int`
    - `context_fit(git_state: dict) -> list[str]`
    - `recommend(context: dict, registry, profile, k: int = TOP_K) -> list[dict]` → recs `{"name","kind","scope","score","why"}`

- [ ] Write failing test `tests/pytest/test_advisor.py`:
  ```python
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
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_advisor.py -q` → `ModuleNotFoundError: No module named 'advisor'`.
- [ ] Create `plugins/prompt-craft/scripts/advisor.py` (functions only):
  ```python
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
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_advisor.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): advisor scoring core (relevance, override, discovery)`

---

### Task 6: `advisor.py` CLI modes (`--mode={prompt|statusline|stop}`)

Wrap the scoring core in the CLI contract the hooks and the skill call.

- **Files:**
  - Modify `plugins/prompt-craft/scripts/advisor.py` (append `_banner`, `main`, `__main__` guard)
  - Test `tests/pytest/test_advisor_cli.py`

- **Interfaces:**
  - CLI contract: `python3 advisor.py --mode={prompt|statusline|stop}` reads context JSON `{prompt, git_state:{dirty,unpushed}, cwd}` on stdin, `--home` overrides artifact dir (default `~`). Output:
    - `--mode=prompt` → multi-line banner string (or nothing).
    - `--mode=statusline` → single segment `next: /x` (or nothing).
    - `--mode=stop` → multi-line banner string (or nothing).
    - Always exit 0; degrade to empty on any error.
  - Produces: `_banner(recs: list) -> str`; `main() -> int`.

- [ ] Write failing test `tests/pytest/test_advisor_cli.py`:
  ```python
  """advisor.py CLI: stdin context JSON + --mode output shapes."""
  import json
  import subprocess
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  ADVISOR = SCRIPTS / "advisor.py"
  sys.path.insert(0, str(SCRIPTS))
  import build_registry as br  # noqa: E402


  def _seed(home, repo_root):
      (home / ".claude").mkdir(parents=True, exist_ok=True)
      p = repo_root / "plugins" / "ecc" / "skills" / "review" / "SKILL.md"
      p.parent.mkdir(parents=True, exist_ok=True)
      p.write_text("---\nname: review\ndescription: Review a diff for bugs.\n---\n")
      br.build_registry(repo_root, home, None)


  def _run(mode, ctx, home):
      return subprocess.run(
          ["python3", str(ADVISOR), "--mode", mode, "--home", str(home)],
          input=json.dumps(ctx), capture_output=True, text=True,
      )


  def test_mode_prompt_returns_banner(tmp_path):
      home, repo = tmp_path / "home", tmp_path / "repo"
      _seed(home, repo)
      r = _run("prompt", {"prompt": "review this diff", "git_state": {}, "cwd": str(repo)}, home)
      assert r.returncode == 0
      assert "/ecc:review" in r.stdout


  def test_mode_statusline_is_single_next_segment(tmp_path):
      home, repo = tmp_path / "home", tmp_path / "repo"
      _seed(home, repo)
      r = _run("statusline", {"prompt": None, "git_state": {"dirty": True}, "cwd": str(repo)}, home)
      assert r.returncode == 0
      assert r.stdout.strip().startswith("next: /")
      assert "\n" not in r.stdout.strip()


  def test_mode_stop_banner_on_dirty(tmp_path):
      home, repo = tmp_path / "home", tmp_path / "repo"
      _seed(home, repo)
      r = _run("stop", {"prompt": None, "git_state": {"dirty": True}, "cwd": str(repo)}, home)
      assert r.returncode == 0 and "/commit" in r.stdout


  def test_silent_when_nothing_matches(tmp_path):
      home, repo = tmp_path / "home", tmp_path / "repo"
      _seed(home, repo)
      r = _run("prompt", {"prompt": "xyzzy nothing here", "git_state": {}, "cwd": str(repo)}, home)
      assert r.returncode == 0 and r.stdout.strip() == ""


  def test_degrades_when_registry_missing(tmp_path):
      home = tmp_path / "home"
      r = _run("prompt", {"prompt": "review", "git_state": {}, "cwd": "/x"}, home)
      assert r.returncode == 0 and r.stdout.strip() == ""


  def test_bad_stdin_exits_zero_empty(tmp_path):
      r = subprocess.run(["python3", str(ADVISOR), "--mode", "prompt", "--home", str(tmp_path)],
                         input="not json", capture_output=True, text=True)
      assert r.returncode == 0 and r.stdout.strip() == ""
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_advisor_cli.py -q` → fails (advisor has no `main`/`__main__`; `--mode` unrecognized / no output).
- [ ] Edit `plugins/prompt-craft/scripts/advisor.py` — append at the end of the file:
  ```python
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
      args = ap.parse_args()
      try:
          context = json.loads(sys.stdin.read())
      except (ValueError, OSError):
          return 0
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
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_advisor_cli.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): advisor CLI modes (prompt/statusline/stop)`

---

### Task 7: `/prompt-craft:refresh` skill (build + learn + summary)

User-invocable manual rebuild. The `--wire/--unwire-statusline` flags are added in Task 12 (statusline ships last).

- **Files:**
  - Create `plugins/prompt-craft/skills/refresh/SKILL.md`
  - Modify `tests/pytest/test_prompt_craft.py` (add `refresh` to `EXPECTED_SKILLS`, line 14)

- **Interfaces:**
  - Consumes: `build_registry.py`, `learn_history.py` CLIs (Tasks 2-4).
  - Produces: a `disable-model-invocation: true` user-invocable skill named `refresh`.

- [ ] Edit `tests/pytest/test_prompt_craft.py` line 14 — add `refresh`:
  ```python
  EXPECTED_SKILLS = {"improve-prompt", "plan", "debug", "refactor", "review", "refresh"}
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_prompt_craft.py -q` → `test_every_expected_skill_has_well_formed_frontmatter` fails (`skills mismatch`, `refresh` missing).
- [ ] Create `plugins/prompt-craft/skills/refresh/SKILL.md`:
  ```markdown
  ---
  name: refresh
  description: Rebuild the prompt-craft command registry and usage profile, and print a summary of installed commands and your personalized recommendations. Use when you install or update plugins and want the advisor to pick them up immediately, or say "refresh prompt-craft", "rebuild the command registry".
  disable-model-invocation: true
  ---

  # Refresh the command advisor

  Rebuilds the machine-global registry (`~/.claude/prompt-craft/registry.json`) and
  usage profile (`~/.claude/prompt-craft/profile.json`) from the current repo + your
  installed plugins, then summarizes what changed. Nothing is written into the repo.

  ## Steps

  1. **Rebuild the registry** (both scopes, atomic write):
     ```sh
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_registry.py" --repo-root "$PWD"
     ```
  2. **Relearn usage** (honors `CLAUDE_CODE_SKIP_PROMPT_HISTORY`):
     ```sh
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/learn_history.py"
     ```
  3. **Summarize** from `~/.claude/prompt-craft/registry.json`: N commands across M
     sources; your top personalized recommendations; commands newly discovered since the
     last build. Naming: prompt-craft's own commands are `/prompt-craft:<name>`; bare
     forms (`/commit`, `/pr`, `/goal`, `/ecc:plan`, `/code-review`) are external/canonical.

  ## Statusline wiring (optional)

  To add a persistent next-command hint segment to your statusline, see the
  `--wire-statusline` / `--unwire-statusline` flags (added in Task 12). The edit to
  `~/.claude/settings.json` is atomic, backed up, confirmed, and reversible.
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_prompt_craft.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): /prompt-craft:refresh skill (build + learn + summary)`

---

### Task 8: `registry_freshness.sh` SessionStart hook + hooks.json entry

Rebuild-when-stale on session start: missing registry / repo-root change / signature change / `claude --version` change (skip the version dimension if `claude` is off PATH). Always exit 0.

- **Files:**
  - Create `plugins/prompt-craft/hooks/registry_freshness.sh`
  - Modify `plugins/prompt-craft/hooks/hooks.json` (add `SessionStart`)
  - Test `tests/bats/command_advisor.bats` (new file; freshness section)

- **Interfaces:**
  - Consumes: `build_registry.py --check` / build (Task 2), `learn_history.py` (Task 4). Reads `cwd` from SessionStart stdin; reads `claude --version`.
  - Produces: the `SessionStart` hook wired to `registry_freshness.sh`.

- [ ] Write failing test `tests/bats/command_advisor.bats`:
  ```bash
  #!/usr/bin/env bats

  load helpers

  PLUGIN="${BATS_TEST_DIRNAME}/../../plugins/prompt-craft"
  HOOKS="${PLUGIN}/hooks"

  setup() {
    TMP="$(mktemp -d)"
    export HOME="${TMP}/home"
    mkdir -p "${HOME}/.claude"
    export CLAUDE_PLUGIN_ROOT="${PLUGIN}"
  }
  teardown() { rm -rf "${TMP}"; }

  _repo() {
    mkdir -p "$1/plugins/ecc/skills/review"
    printf -- '---\nname: review\ndescription: Review a diff for bugs.\n---\n' \
      > "$1/plugins/ecc/skills/review/SKILL.md"
  }

  @test "registry_freshness: builds when registry missing" {
    _repo "${TMP}/repo"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
    [ "$status" -eq 0 ]
    [ -f "${HOME}/.claude/prompt-craft/registry.json" ]
  }

  @test "registry_freshness: no-op when fresh (registry unchanged)" {
    _repo "${TMP}/repo"
    printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
    before="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
    sleep 1
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
    after="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
    [ "$status" -eq 0 ]
    [ "$before" = "$after" ]
  }

  @test "registry_freshness: rebuilds on repo-root change" {
    _repo "${TMP}/repo"; _repo "${TMP}/other"
    printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/other\"}' | bash '${HOOKS}/registry_freshness.sh'"
    [ "$status" -eq 0 ]
    grep -q "${TMP}/other" "${HOME}/.claude/prompt-craft/registry.json"
  }

  @test "registry_freshness: rebuilds on signature change (new command)" {
    _repo "${TMP}/repo"
    printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
    mkdir -p "${TMP}/repo/plugins/ecc/skills/lint"
    printf -- '---\nname: lint\ndescription: Run the linters.\n---\n' \
      > "${TMP}/repo/plugins/ecc/skills/lint/SKILL.md"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
    [ "$status" -eq 0 ]
    grep -q "/ecc:lint" "${HOME}/.claude/prompt-craft/registry.json"
  }

  @test "registry_freshness: claude absent does not force a rebuild" {
    _repo "${TMP}/repo"
    printf '%s' "{\"cwd\":\"${TMP}/repo\"}" | bash "${HOOKS}/registry_freshness.sh"
    before="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
    sleep 1
    # PATH without our mock `claude` -> `claude --version` empty -> version dimension skipped
    run env PATH="/usr/bin:/bin" bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/registry_freshness.sh'"
    after="$(stat -f %m "${HOME}/.claude/prompt-craft/registry.json" 2>/dev/null || stat -c %Y "${HOME}/.claude/prompt-craft/registry.json")"
    [ "$status" -eq 0 ]
    [ "$before" = "$after" ]
  }
  ```
- [ ] Run it — expect FAIL: `bats tests/bats/command_advisor.bats` → `No such file or directory` for `registry_freshness.sh`.
- [ ] Create `plugins/prompt-craft/hooks/registry_freshness.sh`:
  ```bash
  #!/usr/bin/env bash
  # SessionStart: rebuild ~/.claude/prompt-craft/{registry,profile}.json when stale.
  # Stale = missing registry | repo-root change | scan-signature change | claude
  # --version change (version dimension skipped if claude is off PATH). Always exit 0.
  set -uo pipefail

  INPUT="$(cat)"
  CWD="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys, json
  try:
      print(json.load(sys.stdin).get("cwd", ""))
  except Exception:
      print("")' 2>/dev/null)"
  [ -n "$CWD" ] || CWD="$PWD"

  SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
  CV="$(claude --version 2>/dev/null | head -n1 | tr -dc '0-9.' || true)"

  ARGS=(--repo-root "$CWD")
  [ -n "$CV" ] && ARGS+=(--claude-version "$CV")

  verdict="$(python3 "${SCRIPTS}/build_registry.py" --check "${ARGS[@]}" 2>/dev/null || echo stale)"
  if [ "$verdict" = "stale" ]; then
    python3 "${SCRIPTS}/build_registry.py" "${ARGS[@]}" >/dev/null 2>&1 || true
    python3 "${SCRIPTS}/learn_history.py" >/dev/null 2>&1 || true
  fi
  exit 0
  ```
- [ ] Edit `plugins/prompt-craft/hooks/hooks.json` — add a `SessionStart` block (insert after the opening `"hooks": {`, before `"Stop"`):
  ```json
      "SessionStart": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/registry_freshness.sh\""
            }
          ]
        }
      ],
  ```
- [ ] Run it — expect PASS: `bats tests/bats/command_advisor.bats` → freshness tests pass. Also `shellcheck plugins/prompt-craft/hooks/registry_freshness.sh`.
- [ ] Commit: `feat(prompt-craft): SessionStart registry freshness hook`

---

### Task 9: `prompt_hint.sh` UserPromptSubmit hook → top-level `systemMessage`

Prompt-time banner: build context (prompt + git state) safely in one `/usr/bin/python3` call (the prompt never round-trips through bash), call `advisor.py --mode=prompt`, emit top-level `{"systemMessage": …}`. Silent on no match. **Never** `additionalContext`.

- **Files:**
  - Create `plugins/prompt-craft/hooks/prompt_hint.sh`
  - Modify `plugins/prompt-craft/hooks/hooks.json` (add `UserPromptSubmit`)
  - Modify `tests/bats/command_advisor.bats` (add prompt_hint + data-safety sections)

- **Interfaces:**
  - Consumes: `advisor.py --mode=prompt` (Task 6). UserPromptSubmit stdin `{"prompt","cwd",...}`.
  - Produces: the `UserPromptSubmit` hook; output is top-level `{"systemMessage": "<banner>"}` or silent.

- [ ] Append failing tests to `tests/bats/command_advisor.bats`:
  ```bash
  # ---- prompt_hint.sh (UserPromptSubmit) ----

  _seed_registry() {
    mkdir -p "${TMP}/repo/plugins/ecc/skills/review"
    printf -- '---\nname: review\ndescription: Review a diff for bugs and security.\n---\n' \
      > "${TMP}/repo/plugins/ecc/skills/review/SKILL.md"
    python3 "${PLUGIN}/scripts/build_registry.py" --home "${HOME}" --repo-root "${TMP}/repo" >/dev/null 2>&1
  }

  @test "prompt_hint: confident match emits TOP-LEVEL systemMessage, no additionalContext" {
    _seed_registry
    run bash -c "printf '%s' '{\"prompt\":\"review this diff for security\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" == *'"systemMessage"'* ]]
    [[ "$output" == *"/ecc:review"* ]]
    [[ "$output" != *"additionalContext"* ]]
    [[ "$output" != *"hookSpecificOutput"* ]]
    # systemMessage is a TOP-LEVEL key
    printf '%s' "$output" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); assert "systemMessage" in d and "additionalContext" not in json.dumps(d)'
  }

  @test "prompt_hint: no match is silent (exit 0, no output)" {
    _seed_registry
    run bash -c "printf '%s' '{\"prompt\":\"xyzzy nothing matches here\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
  }

  @test "prompt_hint: data in a description is printed literally, never executed" {
    mkdir -p "${TMP}/repo/plugins/ecc/skills/danger"
    printf -- '---\nname: danger\ndescription: review $(touch %s/PWNED) `id` %%s diff\n---\n' "${TMP}" \
      > "${TMP}/repo/plugins/ecc/skills/danger/SKILL.md"
    python3 "${PLUGIN}/scripts/build_registry.py" --home "${HOME}" --repo-root "${TMP}/repo" >/dev/null 2>&1
    run bash -c "printf '%s' '{\"prompt\":\"review the diff\",\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/prompt_hint.sh'"
    [ "$status" -eq 0 ]
    [ ! -f "${TMP}/PWNED" ]            # command substitution never ran
    [[ "$output" != *"uid="* ]]        # backtick `id` never ran
  }
  ```
- [ ] Run it — expect FAIL: `bats tests/bats/command_advisor.bats` → `No such file or directory` for `prompt_hint.sh`.
- [ ] Create `plugins/prompt-craft/hooks/prompt_hint.sh`:
  ```bash
  #!/usr/bin/env bash
  # UserPromptSubmit: surface prompt-specific command recommendations to the USER
  # via a TOP-LEVEL {"systemMessage": ...}. Never feeds the model (no
  # additionalContext / stdout-to-model). Silent (exit 0, no output) on no match.
  set -uo pipefail

  INPUT="$(cat)"
  SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

  # Build the advisor context entirely in python so the prompt text never reaches
  # bash word-splitting. Computes git state via subprocess inside the same process.
  CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
  import sys, json, os, subprocess
  try:
      d = json.load(sys.stdin)
  except Exception:
      sys.exit(0)
  cwd = d.get("cwd") or os.getcwd()
  prompt = d.get("prompt")
  dirty, unpushed = False, 0
  if cwd and os.path.isdir(cwd):
      def g(*a):
          return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True)
      if g("rev-parse", "--is-inside-work-tree").returncode == 0:
          dirty = bool(g("status", "--porcelain").stdout.strip())
          up = g("rev-list", "--count", "@{upstream}..HEAD")
          if up.returncode == 0 and up.stdout.strip().isdigit():
              unpushed = int(up.stdout.strip())
  json.dump({"prompt": prompt, "git_state": {"dirty": dirty, "unpushed": unpushed}, "cwd": cwd}, sys.stdout)
  ' 2>/dev/null)"
  [ -n "$CTX" ] || exit 0

  OUT="$(printf '%s' "$CTX" | python3 "${SCRIPTS}/advisor.py" --mode prompt 2>/dev/null || true)"
  [ -n "$OUT" ] || exit 0

  # Wrap as TOP-LEVEL systemMessage. The banner is DATA: json.dumps escapes it.
  printf '%s' "$OUT" | /usr/bin/python3 -c 'import sys, json
  print(json.dumps({"systemMessage": sys.stdin.read()}))'
  exit 0
  ```
- [ ] Edit `plugins/prompt-craft/hooks/hooks.json` — add a `UserPromptSubmit` block:
  ```json
      "UserPromptSubmit": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt_hint.sh\""
            }
          ]
        }
      ],
  ```
- [ ] Run it — expect PASS: `bats tests/bats/command_advisor.bats` and `shellcheck plugins/prompt-craft/hooks/prompt_hint.sh`.
- [ ] Commit: `feat(prompt-craft): UserPromptSubmit prompt_hint -> top-level systemMessage`

---

### Task 10: Extend `suggest_next.sh` Stop hook → top-level `systemMessage`

Reroute the Stop hook through `advisor.py --mode=stop` and switch its emission from nested `additionalContext` to a **top-level `systemMessage`**. Git-context recs still work without a registry (advisor `context_fit` is registry-independent), so the existing dirty→/commit behavior is preserved.

- **Files:**
  - Modify `plugins/prompt-craft/hooks/suggest_next.sh` (rewrite — replace the hand-rolled suggestion logic + the `additionalContext` emitter)
  - Modify `tests/bats/prompt_craft.bats` (lines 24-46: extend the suggest_next assertions)

- **Interfaces:**
  - Consumes: `advisor.py --mode=stop` (Task 6). Stop stdin `{"cwd",...}`.
  - Produces: Stop hook output `{"systemMessage": "<banner>"}` (top-level) or silent. No `additionalContext`.

- [ ] Edit the existing suggest_next tests in `tests/bats/prompt_craft.bats` to pin the new invariants. Replace the dirty test (lines 26-32) and add a no-additionalContext assertion:
  ```bash
  @test "suggest_next: dirty working tree suggests /commit via top-level systemMessage" {
    _init_repo "${TMP}/repo"
    echo change >> "${TMP}/repo/seed.txt"   # uncommitted change
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/suggest_next.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"/commit"* ]]
    [[ "$output" == *'"systemMessage"'* ]]
    [[ "$output" != *"additionalContext"* ]]
    [[ "$output" != *"hookSpecificOutput"* ]]
  }
  ```
  (Leave the "clean → silent" and "non-git → silent" tests at lines 34-46 unchanged — they still pass.)
- [ ] Run it — expect FAIL: `bats tests/bats/prompt_craft.bats` → the dirty test fails (current hook emits `hookSpecificOutput`/`additionalContext`, so the new assertions `!= additionalContext` / `== systemMessage` fail).
- [ ] Rewrite `plugins/prompt-craft/hooks/suggest_next.sh`:
  ```bash
  #!/usr/bin/env bash
  # Stop hook: after a turn, suggest follow-up slash commands based on git state,
  # surfaced to the USER via a TOP-LEVEL {"systemMessage": ...} (never the model).
  # Routed through advisor.py --mode=stop. Silent (exit 0) when nothing fits.
  set -uo pipefail

  INPUT="$(cat)"
  SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

  CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
  import sys, json, os, subprocess
  try:
      d = json.load(sys.stdin)
  except Exception:
      sys.exit(0)
  cwd = d.get("cwd") or os.getcwd()
  dirty, unpushed = False, 0
  if cwd and os.path.isdir(cwd):
      def g(*a):
          return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True)
      if g("rev-parse", "--is-inside-work-tree").returncode == 0:
          dirty = bool(g("status", "--porcelain").stdout.strip())
          up = g("rev-list", "--count", "@{upstream}..HEAD")
          if up.returncode == 0 and up.stdout.strip().isdigit():
              unpushed = int(up.stdout.strip())
  json.dump({"prompt": None, "git_state": {"dirty": dirty, "unpushed": unpushed}, "cwd": cwd}, sys.stdout)
  ' 2>/dev/null)"
  [ -n "$CTX" ] || exit 0

  OUT="$(printf '%s' "$CTX" | python3 "${SCRIPTS}/advisor.py" --mode stop 2>/dev/null || true)"
  [ -n "$OUT" ] || exit 0

  printf '%s' "$OUT" | /usr/bin/python3 -c 'import sys, json
  print(json.dumps({"systemMessage": sys.stdin.read()}))'
  exit 0
  ```
- [ ] Run it — expect PASS: `bats tests/bats/prompt_craft.bats` and `shellcheck plugins/prompt-craft/hooks/suggest_next.sh`.
- [ ] Commit: `refactor(prompt-craft): route Stop hook through advisor, emit systemMessage`

---

### Task 11: `statusline_hint.sh` + stable shim (chain to base, ANSI/cap, self-ref)

Persistent hint segment. The shim resolves the current plugin version at runtime; `statusline_hint.sh` chains to the recorded base statusline, appends the hint, strips ANSI before measuring, resets color after truncation, caps at 140, and guards against self-reference.

- **Files:**
  - Create `plugins/prompt-craft/hooks/statusline_hint.sh`
  - Create `plugins/prompt-craft/hooks/statusline_shim.sh` (the template installed to `~/.claude/prompt-craft/statusline.sh`)
  - Modify `tests/bats/command_advisor.bats` (statusline section)

- **Interfaces:**
  - Consumes: `advisor.py --mode=statusline` (Task 6); sidecar `~/.claude/prompt-craft/base-statusline`.
  - Produces: `statusline_hint.sh` printing `"<base> | 💡 next: /x"` (or base-only / hint-only); the shim template.

- [ ] Append failing tests to `tests/bats/command_advisor.bats`:
  ```bash
  # ---- statusline_hint.sh ----

  @test "statusline_hint: chains to base and appends the hint segment" {
    _seed_registry
    printf 'echo BASELINE' > "${HOME}/.claude/prompt-craft/base-statusline"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"BASELINE"* ]]
  }

  @test "statusline_hint: base missing -> hint-only, never fails" {
    _seed_registry
    rm -f "${HOME}/.claude/prompt-craft/base-statusline"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"BASELINE"* ]]
  }

  @test "statusline_hint: self-referencing base -> hint-only (no recursion)" {
    _seed_registry
    printf 'bash %s/statusline_hint.sh' "${HOOKS}" > "${HOME}/.claude/prompt-craft/base-statusline"
    run timeout 10 bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
    [ "$status" -eq 0 ]
  }

  @test "statusline_hint: ANSI base truncated leaves no dangling escape" {
    _seed_registry
    long="$(printf 'X%.0s' {1..200})"
    printf "echo \$'\\033[31m%s\\033[0m'" "$long" > "${HOME}/.claude/prompt-craft/base-statusline"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
    [ "$status" -eq 0 ]
    # ends with a reset; total visible width capped at 140
    [[ "$output" == *$'\033[0m' ]]
  }

  @test "statusline_hint: never exits non-zero on a broken base command" {
    _seed_registry
    printf 'this-command-does-not-exist-xyz' > "${HOME}/.claude/prompt-craft/base-statusline"
    run bash -c "printf '%s' '{\"cwd\":\"${TMP}/repo\"}' | bash '${HOOKS}/statusline_hint.sh'"
    [ "$status" -eq 0 ]
  }
  ```
- [ ] Run it — expect FAIL: `bats tests/bats/command_advisor.bats` → `No such file or directory` for `statusline_hint.sh`.
- [ ] Create `plugins/prompt-craft/hooks/statusline_hint.sh`:
  ```bash
  #!/usr/bin/env bash
  # statusLine segment: "<base> | 💡 next: /x". Chains to the recorded base
  # statusline, appends the advisor hint, strips ANSI before width-measuring,
  # appends a reset after truncation, caps at 140, guards self-reference.
  set -uo pipefail

  INPUT="$(cat)"
  SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
  SIDECAR="${HOME}/.claude/prompt-craft/base-statusline"
  SHIM="${HOME}/.claude/prompt-craft/statusline.sh"
  MAX=140

  # Base statusline (sidecar). Skip if it self-references (would recurse).
  BASE=""
  if [ -f "$SIDECAR" ]; then
    BASE_CMD="$(cat "$SIDECAR")"
    case "$BASE_CMD" in
      *statusline_hint.sh*|*"$SHIM"*) BASE="" ;;
      *) BASE="$(printf '%s' "$INPUT" | bash -c "$BASE_CMD" 2>/dev/null || true)" ;;
    esac
  fi

  # Hint via advisor (statusline mode). Build context (git state) in python first.
  CTX="$(printf '%s' "$INPUT" | /usr/bin/python3 -c '
  import sys, json, os, subprocess
  try:
      d = json.load(sys.stdin)
  except Exception:
      sys.exit(0)
  cwd = d.get("cwd") or d.get("workspace", {}).get("current_dir") or os.getcwd()
  dirty, unpushed = False, 0
  if cwd and os.path.isdir(cwd):
      def g(*a):
          return subprocess.run(["git", "-C", cwd, *a], capture_output=True, text=True)
      if g("rev-parse", "--is-inside-work-tree").returncode == 0:
          dirty = bool(g("status", "--porcelain").stdout.strip())
          up = g("rev-list", "--count", "@{upstream}..HEAD")
          if up.returncode == 0 and up.stdout.strip().isdigit():
              unpushed = int(up.stdout.strip())
  json.dump({"prompt": None, "git_state": {"dirty": dirty, "unpushed": unpushed}, "cwd": cwd}, sys.stdout)
  ' 2>/dev/null)"
  HINT=""
  [ -n "$CTX" ] && HINT="$(printf '%s' "$CTX" | python3 "${SCRIPTS}/advisor.py" --mode statusline 2>/dev/null || true)"

  SEG=""
  [ -n "$HINT" ] && SEG="💡 $HINT"
  if [ -n "$BASE" ] && [ -n "$SEG" ]; then
    OUT="$BASE | $SEG"
  elif [ -n "$BASE" ]; then
    OUT="$BASE"
  else
    OUT="$SEG"
  fi

  # Strip ANSI for width measurement; cap at MAX; always append a reset.
  printf '%s' "$OUT" | /usr/bin/python3 -c '
  import sys, re
  MAX = '"$MAX"'
  s = sys.stdin.read()
  plain = re.sub(r"\x1b\[[0-9;]*m", "", s)
  if len(plain) > MAX:
      s = plain[:MAX - 1] + "…"
  sys.stdout.write(s + "\x1b[0m\n")
  '
  exit 0
  ```
- [ ] Create `plugins/prompt-craft/hooks/statusline_shim.sh` (template copied to `~/.claude/prompt-craft/statusline.sh` by `--wire`):
  ```bash
  #!/usr/bin/env bash
  # prompt-craft statusline shim. settings.json points here so plugin updates do
  # not dangle a version-pinned cache path. Resolves the current plugin version
  # at runtime and runs the real statusline_hint.sh. Falls back to the recorded
  # base statusline if the plugin is not found.
  set -uo pipefail
  INPUT="$(cat)"

  HINT=""
  for d in "${HOME}"/.claude/plugins/cache/*/prompt-craft/*/hooks/statusline_hint.sh; do
    [ -f "$d" ] && HINT="$d"
  done

  if [ -z "$HINT" ]; then
    BASE_FILE="${HOME}/.claude/prompt-craft/base-statusline"
    if [ -f "$BASE_FILE" ]; then
      printf '%s' "$INPUT" | bash -c "$(cat "$BASE_FILE")" 2>/dev/null || true
    fi
    exit 0
  fi
  printf '%s' "$INPUT" | bash "$HINT"
  exit 0
  ```
- [ ] Run it — expect PASS: `bats tests/bats/command_advisor.bats` and `shellcheck plugins/prompt-craft/hooks/statusline_hint.sh plugins/prompt-craft/hooks/statusline_shim.sh`.
- [ ] Commit: `feat(prompt-craft): statusline hint segment + stable shim`

---

### Task 12: `wire_statusline.py` + `--wire/--unwire-statusline` in `/prompt-craft:refresh`

The one mutating action: an atomic, backed-up, confirmed, reversible edit to `~/.claude/settings.json` that points `statusLine.command` at the shim and records the prior command to the sidecar.

- **Files:**
  - Create `plugins/prompt-craft/scripts/wire_statusline.py`
  - Modify `plugins/prompt-craft/skills/refresh/SKILL.md` (replace the "Statusline wiring (optional)" stub from Task 7 with concrete steps)
  - Test `tests/pytest/test_wire_statusline.py`, and append a wire/unwire section to `tests/bats/command_advisor.bats`

- **Interfaces:**
  - Consumes: `registry_lib.atomic_write_json` (with `sort_keys=False` to preserve settings structure), `statusline_shim.sh` template.
  - Produces:
    - `SHIM_REL`, `_settings_path(home)`, `_shim_path(home)`, `_sidecar_path(home)`, `_backup_pointer(home)`
    - `wire(home, plugin_root, dry_run=False) -> dict` (returns `{"before","after","wired"}`); `unwire(home) -> dict`
    - `main()` / argparse: `python3 wire_statusline.py {--wire|--unwire} [--dry-run] [--home D] [--plugin-root D]`

- [ ] Write failing test `tests/pytest/test_wire_statusline.py`:
  ```python
  """wire_statusline.py — atomic, backed-up, reversible settings.json edit."""
  import json
  import os
  import sys
  from pathlib import Path

  REPO_ROOT = Path(__file__).resolve().parents[2]
  SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
  PLUGIN = REPO_ROOT / "plugins" / "prompt-craft"
  sys.path.insert(0, str(SCRIPTS))
  import wire_statusline as ws  # noqa: E402


  def _home(tmp_path, settings):
      home = tmp_path / "home"
      sp = home / ".claude" / "settings.json"
      sp.parent.mkdir(parents=True, exist_ok=True)
      sp.write_text(settings)
      return home


  def test_wire_records_base_installs_shim_and_backs_up(tmp_path):
      home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
      ws.wire(home, str(PLUGIN))
      settings = json.loads((home / ".claude" / "settings.json").read_text())
      assert "statusline.sh" in settings["statusLine"]["command"]
      assert (home / ".claude" / "prompt-craft" / "base-statusline").read_text().strip() == "echo BASE"
      assert (home / ".claude" / "prompt-craft" / "statusline.sh").exists()
      backups = list((home / ".claude").glob("settings.json.bak.*"))
      assert backups and oct(os.stat(backups[0]).st_mode & 0o777) == "0o600"


  def test_wire_is_idempotent(tmp_path):
      home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
      ws.wire(home, str(PLUGIN))
      r = ws.wire(home, str(PLUGIN))
      assert r["wired"] is False  # already wired -> no-op
      # base sidecar still the original, not overwritten with the shim
      assert (home / ".claude" / "prompt-craft" / "base-statusline").read_text().strip() == "echo BASE"


  def test_wire_aborts_on_unparseable_settings(tmp_path):
      home = _home(tmp_path, "{not valid json")
      before = (home / ".claude" / "settings.json").read_text()
      try:
          ws.wire(home, str(PLUGIN))
          raised = False
      except ValueError:
          raised = True
      assert raised
      assert (home / ".claude" / "settings.json").read_text() == before  # never written


  def test_wire_refuses_self_referencing_base(tmp_path):
      shim = "bash \"" + str(Path("~/.claude/prompt-craft/statusline.sh").expanduser()) + "\""
      home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": shim}}))
      ws.wire(home, str(PLUGIN))
      # the self-referencing prior command must NOT be recorded as the base
      sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
      assert not sidecar.exists() or "statusline.sh" not in sidecar.read_text()


  def test_unwire_restores_base_and_removes_shim(tmp_path):
      home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
      ws.wire(home, str(PLUGIN))
      ws.unwire(home)
      settings = json.loads((home / ".claude" / "settings.json").read_text())
      assert settings["statusLine"]["command"] == "echo BASE"
      assert not (home / ".claude" / "prompt-craft" / "statusline.sh").exists()
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_wire_statusline.py -q` → `ModuleNotFoundError: No module named 'wire_statusline'`.
- [ ] Create `plugins/prompt-craft/scripts/wire_statusline.py`:
  ```python
  #!/usr/bin/env python3
  """Wire/unwire the prompt-craft statusline shim into ~/.claude/settings.json.

  Atomic, backed up (0600), idempotent, reversible. Aborts (no write) if
  settings.json is unparseable. Refuses to record a self-referencing base.
  """
  import argparse
  import json
  import os
  import shutil
  import sys
  from datetime import datetime, timezone
  from pathlib import Path

  sys.path.insert(0, str(Path(__file__).resolve().parent))
  from registry_lib import atomic_write_json  # noqa: E402

  SHIM_TEMPLATE = Path(__file__).resolve().parent.parent / "hooks" / "statusline_shim.sh"


  def _pc_dir(home) -> Path:
      return Path(home) / ".claude" / "prompt-craft"


  def _settings_path(home) -> Path:
      return Path(home) / ".claude" / "settings.json"


  def _shim_path(home) -> Path:
      return _pc_dir(home) / "statusline.sh"


  def _sidecar_path(home) -> Path:
      return _pc_dir(home) / "base-statusline"


  def _backup_pointer(home) -> Path:
      return _pc_dir(home) / "last-backup"


  def _shim_command(home) -> str:
      return 'bash "%s"' % _shim_path(home)


  def _load_settings(home) -> dict:
      sp = _settings_path(home)
      if not sp.exists():
          return {}
      try:
          return json.loads(sp.read_text())
      except ValueError as exc:
          raise ValueError(f"settings.json is unparseable; refusing to write: {exc}")


  def _is_self_reference(command: str, home) -> bool:
      return "statusline_hint.sh" in command or str(_shim_path(home)) in command


  def wire(home, plugin_root, dry_run: bool = False) -> dict:
      settings = _load_settings(home)
      shim_cmd = _shim_command(home)
      current = (settings.get("statusLine") or {}).get("command", "")
      if current == shim_cmd:
          return {"before": current, "after": current, "wired": False}
      if dry_run:
          return {"before": current, "after": shim_cmd, "wired": False}

      _pc_dir(home).mkdir(parents=True, exist_ok=True)
      os.chmod(_pc_dir(home), 0o700)

      # Record prior base command, unless it self-references (would recurse).
      if current and not _is_self_reference(current, home):
          _sidecar_path(home).write_text(current)

      # Install the shim from the plugin template.
      shutil.copyfile(SHIM_TEMPLATE, _shim_path(home))
      os.chmod(_shim_path(home), 0o755)

      # Timestamped 0600 backup BEFORE the write, verified readable.
      sp = _settings_path(home)
      if sp.exists():
          ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
          backup = sp.with_name(f"settings.json.bak.{ts}")
          shutil.copyfile(sp, backup)
          os.chmod(backup, 0o600)
          backup.read_text()  # verify readable
          _backup_pointer(home).write_text(str(backup))

      settings.setdefault("statusLine", {})
      settings["statusLine"]["type"] = "command"
      settings["statusLine"]["command"] = shim_cmd
      atomic_write_json(sp, settings, mode=0o600, sort_keys=False)
      return {"before": current, "after": shim_cmd, "wired": True}


  def unwire(home) -> dict:
      settings = _load_settings(home)
      sidecar = _sidecar_path(home)
      base = sidecar.read_text().strip() if sidecar.exists() else ""
      if base:
          settings.setdefault("statusLine", {})
          settings["statusLine"]["type"] = "command"
          settings["statusLine"]["command"] = base
      else:
          settings.pop("statusLine", None)
      atomic_write_json(_settings_path(home), settings, mode=0o600, sort_keys=False)
      for path in (_shim_path(home), sidecar):
          try:
              path.unlink()
          except OSError:
              pass
      ptr = _backup_pointer(home)
      if ptr.exists():
          try:
              Path(ptr.read_text().strip()).unlink()
          except OSError:
              pass
          ptr.unlink()
      return {"restored": base}


  def main() -> int:
      ap = argparse.ArgumentParser()
      g = ap.add_mutually_exclusive_group(required=True)
      g.add_argument("--wire", action="store_true")
      g.add_argument("--unwire", action="store_true")
      ap.add_argument("--dry-run", action="store_true")
      ap.add_argument("--home", default=os.path.expanduser("~"))
      ap.add_argument("--plugin-root", default=str(Path(__file__).resolve().parent.parent))
      args = ap.parse_args()
      if args.wire:
          r = wire(args.home, args.plugin_root, dry_run=args.dry_run)
          print(f"before: {r['before'] or '(none)'}\nafter:  {r['after']}\nwired:  {r['wired']}")
      else:
          r = unwire(args.home)
          print(f"restored: {r['restored'] or '(removed statusLine)'}")
      return 0


  if __name__ == "__main__":
      sys.exit(main())
  ```
- [ ] Replace the "Statusline wiring (optional)" section in `plugins/prompt-craft/skills/refresh/SKILL.md` with concrete, confirm-gated steps:
  ```markdown
  ## Statusline wiring (optional, reversible)

  Adds a persistent next-command hint segment by pointing `~/.claude/settings.json`
  `statusLine.command` at a stable shim (`~/.claude/prompt-craft/statusline.sh`).
  The edit is atomic, backed up (`0600`), and reversible.

  1. **Preview** the change (no write):
     ```sh
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --wire --dry-run
     ```
  2. **Confirm with the user** (show before/after). Only on explicit confirmation:
     ```sh
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --wire
     ```
  3. **Undo** anytime:
     ```sh
     python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wire_statusline.py" --unwire
     ```

  Manual recovery: if anything looks wrong, restore the timestamped backup:
  `cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json`.
  ```
- [ ] Append failing bats to `tests/bats/command_advisor.bats`:
  ```bash
  # ---- wire/unwire statusline ----

  @test "wire_statusline: wires, records base, backs up; unwire restores" {
    printf '%s' '{"statusLine":{"type":"command","command":"echo BASE"}}' > "${HOME}/.claude/settings.json"
    run python3 "${PLUGIN}/scripts/wire_statusline.py" --wire --home "${HOME}" --plugin-root "${PLUGIN}"
    [ "$status" -eq 0 ]
    grep -q "statusline.sh" "${HOME}/.claude/settings.json"
    [ -f "${HOME}/.claude/prompt-craft/statusline.sh" ]
    ls "${HOME}/.claude"/settings.json.bak.* >/dev/null 2>&1
    run python3 "${PLUGIN}/scripts/wire_statusline.py" --unwire --home "${HOME}"
    [ "$status" -eq 0 ]
    grep -q "echo BASE" "${HOME}/.claude/settings.json"
  }

  @test "wire_statusline: aborts on unparseable settings (no write)" {
    printf '%s' '{not valid' > "${HOME}/.claude/settings.json"
    run python3 "${PLUGIN}/scripts/wire_statusline.py" --wire --home "${HOME}" --plugin-root "${PLUGIN}"
    [ "$status" -ne 0 ]
    grep -q "not valid" "${HOME}/.claude/settings.json"
  }
  ```
- [ ] Run both suites — expect PASS: `uv tool run pytest tests/pytest/test_wire_statusline.py -q` and `bats tests/bats/command_advisor.bats`.
- [ ] Commit: `feat(prompt-craft): atomic statusline wire/unwire + refresh flags`

---

### Task 13: `disable-model-invocation` on `plan` and `review` skills

Make the hand-off real: the model auto-routes to the canonical command instead of the prompt-craft reinvention. The skills stay user-invocable.

- **Files:**
  - Modify `plugins/prompt-craft/skills/plan/SKILL.md` (frontmatter, after line 3)
  - Modify `plugins/prompt-craft/skills/review/SKILL.md` (frontmatter, after line 3)
  - Modify `tests/pytest/test_prompt_craft.py` (add an assertion)

- **Interfaces:** none new — frontmatter-only change.

- [ ] Write failing test — append to `tests/pytest/test_prompt_craft.py`:
  ```python
  def test_plan_and_review_disable_model_invocation():
      for skill in ("plan", "review"):
          fm = _frontmatter(PLUGIN / "skills" / skill / "SKILL.md")
          assert fm.get("disable-model-invocation") == "true", f"{skill}: must defer to canonical"
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_prompt_craft.py::test_plan_and_review_disable_model_invocation -q` → `assert None == "true"`.
- [ ] Edit `plugins/prompt-craft/skills/plan/SKILL.md` — add the key to the frontmatter (between the `description:` line and the closing `---` at line 4):
  ```markdown
  disable-model-invocation: true
  ```
- [ ] Edit `plugins/prompt-craft/skills/review/SKILL.md` — same addition between `description:` and the closing `---` at line 4:
  ```markdown
  disable-model-invocation: true
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_prompt_craft.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): defer plan/review to canonical (disable-model-invocation)`

---

### Task 14: Wire `/improve-prompt` block 5 to `advisor.py --mode=prompt`

Make block 5's "Recommended commands" real, ranked, canonical-first, and personalized by calling the advisor CLI.

- **Files:**
  - Modify `plugins/prompt-craft/skills/improve-prompt/SKILL.md` (block 5, lines 24-26)
  - Modify `tests/pytest/test_prompt_craft.py` (add an assertion)

- **Interfaces:**
  - Consumes: `advisor.py --mode=prompt` (Task 6).

- [ ] Write failing test — append to `tests/pytest/test_prompt_craft.py`:
  ```python
  def test_improve_prompt_block5_calls_advisor():
      text = (PLUGIN / "skills" / "improve-prompt" / "SKILL.md").read_text()
      assert "advisor.py" in text and "--mode" in text and "prompt" in text
  ```
- [ ] Run it — expect FAIL: `uv tool run pytest tests/pytest/test_prompt_craft.py::test_improve_prompt_block5_calls_advisor -q` → `assert False` (`advisor.py` not referenced).
- [ ] Edit `plugins/prompt-craft/skills/improve-prompt/SKILL.md` — replace block 5 (lines 24-26) with:
  ```markdown
  5. **Recommended commands** — 1–3 slash commands that fit the work, ranked
     canonical-first and personalized to your usage. Build a context JSON from the
     restated goal and call the advisor:
     ```sh
     printf '%s' '{"prompt":"<restated goal>","git_state":{"dirty":false,"unpushed":0},"cwd":"'"$PWD"'"}' \
       | python3 "${CLAUDE_PLUGIN_ROOT}/scripts/advisor.py" --mode prompt
     ```
     Render the returned recommendations here, each with its `why`. If the advisor
     returns nothing, say so — don't invent commands.
  ```
- [ ] Run it — expect PASS: `uv tool run pytest tests/pytest/test_prompt_craft.py -q` → all pass.
- [ ] Commit: `feat(prompt-craft): improve-prompt block 5 sources recs from advisor`

---

### Task 15: Docs, version bump, CI

Document the advisor layer, bump the plugin version, and extend CI to shellcheck the prompt-craft hooks (the new Python is already covered by `pytest tests/pytest/`; the new bats by `bats tests/bats/`).

- **Files:**
  - Modify `plugins/prompt-craft/README.md`
  - Modify `docs/skills-catalog.md` (prompt-craft section — hand-curated)
  - Modify `plugins/prompt-craft/.claude-plugin/plugin.json` (version, line 4)
  - Modify `.github/workflows/test.yml` (shellcheck step, line 56)

- **Interfaces:** none — docs/config only.

- [ ] Edit `.github/workflows/test.yml` line 56 to shellcheck the prompt-craft hooks:
  ```yaml
        run: shellcheck setup/*.sh plugins/ios-dev/skills/_lib/*.sh adapters/*.sh plugins/prompt-craft/hooks/*.sh
  ```
- [ ] Run shellcheck locally — expect PASS (fix any warnings it surfaces in the pre-existing hooks `block_secrets.sh`/`format_on_edit.sh` only if they block, per the surgical-changes rule): `shellcheck plugins/prompt-craft/hooks/*.sh`.
- [ ] Edit `plugins/prompt-craft/.claude-plugin/plugin.json` line 4 — bump the version:
  ```json
    "version": "0.2.0",
  ```
- [ ] Edit `plugins/prompt-craft/README.md` — add rows to the "What's in it" table and a short "Command advisor" section covering: `/prompt-craft:refresh`, the registry/profile artifacts under `~/.claude/prompt-craft/` (`0600`/`0700`, nothing in repos), the three user-visible surfaces (UserPromptSubmit banner, statusline segment, Stop banner — all `systemMessage`, never the model), the `CLAUDE_CODE_SKIP_PROMPT_HISTORY` opt-out, and the `--wire/--unwire-statusline` flags with the manual `cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json` recovery note.
- [ ] Edit `docs/skills-catalog.md` — in the prompt-craft section, add `/prompt-craft:refresh` (skill) and note the advisor hooks (`prompt_hint.sh` UserPromptSubmit, `registry_freshness.sh` SessionStart, `statusline_hint.sh`) plus the extended `suggest_next.sh`. Keep it hand-curated (registry.json is the machine artifact; this doc is NOT auto-rewritten).
- [ ] Run the full suite — expect PASS: `uv tool run pytest tests/pytest/ -q && bats tests/bats/ && shellcheck plugins/prompt-craft/hooks/*.sh setup/*.sh adapters/*.sh`.
- [ ] Commit: `docs(prompt-craft): document command advisor; bump version; shellcheck hooks`

---

## Self-review (run after writing — performed)

**(a) Spec-coverage — every spec section maps to a task:**

| Spec section | Task(s) |
| --- | --- |
| A. `build_registry.py` (repo+global, 3-level cache regression, temp_git_* skip, newest-version, overlay merge, stale drop, malformed skip, atomic write, signature) | 2, 3 |
| `registry-notes.toml` (initial `[builtins]` + plan/review `prefer_over`) | 2 |
| B. `learn_history.py` (opt-out, leading-token-only, cap=5000, perms, missing→empty) | 4 |
| C. `advisor.py` (relevance, frequency tiebreak, context-fit table, ONE canonical override gated on present target, deterministic discovery, rec schema, degrade-on-missing, CLI modes) | 5, 6 |
| `_frontmatter` promotion to shared helper | 1 |
| D. `/prompt-craft:refresh` + `registry_freshness.sh` + SessionStart | 7, 8 |
| E. `prompt_hint.sh` (UserPromptSubmit → top-level systemMessage, silent, no additionalContext) | 9 |
| E. `suggest_next.sh` extension (top-level systemMessage, no additionalContext) | 10 |
| E. `statusline_hint.sh` + shim + ANSI/cap/self-ref | 11 |
| E. `--wire/--unwire-statusline` (atomic settings.json, 0600 backup, idempotent, abort-on-unparseable, self-reference guard, sidecar) | 12 |
| F. `/improve-prompt` wiring | 14 |
| G. `disable-model-invocation` on plan/review | 13 |
| Data-safety bats + no-additionalContext assertions | 9, 10 |
| README + docs/skills-catalog.md + plugin.json bump + CI | 15 |

All spec components are covered.

**(b) Placeholder scan:** No `TBD`/`add validation`/"similar to Task N" left. The one deferred-by-design stub (`scan_global`/`_global_files` returning `[]` in Task 2) is shown as real code and fully replaced with shown code in Task 3 — a legitimate incremental TDD slice, not a placeholder. The opt-out env-var name carries an explicit verify step (Task 4) flagged from the spec's open risk.

**(c) Type/name consistency across tasks (verified identical):** `registry_lib.{tokenize,parse_frontmatter,atomic_write_json,STOPWORDS}`; command dict schema `{name,kind,source,scope,description,why,when,keywords,canonical,prefer_over}`; rec schema `{name,kind,scope,score,why}`; `build_registry.{load_overlay,scan_repo,scan_global,current_signature,build_registry,_check_stale}` + CLI `--check/--signature/--claude-version/--home/--repo-root`; `learn_history.{learn,SKIP_ENV,HISTORY_MAX_ENTRIES}`; `advisor.{relevance,frequency,context_fit,recommend,_banner,main}` + CLI `--mode {prompt|statusline|stop} --home`; advisor stdin contract `{prompt,git_state:{dirty,unpushed},cwd}` used identically by `prompt_hint.sh`, `suggest_next.sh`, `statusline_hint.sh`, and `improve-prompt`; `wire_statusline.{wire,unwire}` + CLI `--wire/--unwire/--dry-run/--home/--plugin-root`. No drift.

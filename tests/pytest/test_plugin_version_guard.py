"""scripts/plugin_version_guard.py against throwaway git repos."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from plugin_version_guard import evaluate, main  # noqa: E402


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", *args],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "r"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    for name in ("keep", "gone"):
        pdir = repo / "plugins" / name
        (pdir / ".claude-plugin").mkdir(parents=True)
        (pdir / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": name, "version": "1.0.0"}))
        (pdir / "f.txt").write_text("a")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "checkout", "-q", "-b", "pr")
    return repo


def _commit(repo: Path, msg: str) -> str:
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD")


def test_plugin_removed_at_head_is_reported_not_failed(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    _git(repo, "rm", "-rq", "plugins/gone")
    head = _commit(repo, "move gone to its own repo")
    skipped, touched, removed, failures = evaluate(str(repo), base, head)
    assert (skipped, removed, failures) == (False, ["gone"], [])
    assert touched == ["gone"]


def test_changed_plugin_without_a_bump_still_fails(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    (repo / "plugins" / "keep" / "f.txt").write_text("b")
    head = _commit(repo, "change keep")
    _, _, removed, failures = evaluate(str(repo), base, head)
    assert removed == []
    assert failures and "keep: content changed but version still 1.0.0" in failures[0]


def test_changed_plugin_with_a_bump_passes(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    (repo / "plugins" / "keep" / "f.txt").write_text("b")
    pj = repo / "plugins" / "keep" / ".claude-plugin" / "plugin.json"
    pj.write_text(json.dumps({"name": "keep", "version": "1.0.1"}))
    head = _commit(repo, "change keep")
    assert evaluate(str(repo), base, head)[3] == []


def test_invalid_plugin_json_at_head_fails(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    (repo / "plugins" / "keep" / ".claude-plugin" / "plugin.json").write_text("{not json")
    head = _commit(repo, "break keep")
    failures = evaluate(str(repo), base, head)[3]
    assert failures == ["keep: plugin.json invalid at HEAD"]


def test_plugin_json_deleted_but_directory_kept_fails(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    _git(repo, "rm", "-q", "plugins/keep/.claude-plugin/plugin.json")
    head = _commit(repo, "drop keep manifest only")
    _, _, removed, failures = evaluate(str(repo), base, head)
    assert removed == []
    assert failures == ["keep: plugin.json missing at HEAD but plugins/keep still exists"]


def test_unresolvable_merge_base_fails_closed(tmp_path):
    repo = _repo(tmp_path)
    (repo / "plugins" / "keep" / "f.txt").write_text("b")
    head = _commit(repo, "change keep")
    with pytest.raises(RuntimeError, match="merge-base"):
        evaluate(str(repo), "0" * 40, head)


def test_main_exits_nonzero_when_merge_base_fails(tmp_path, monkeypatch):
    repo = _repo(tmp_path)
    (repo / "plugins" / "keep" / "f.txt").write_text("b")
    head = _commit(repo, "change keep")
    monkeypatch.chdir(repo)
    assert main(["plugin_version_guard.py", "0" * 40, head]) != 0


def test_skip_marker_short_circuits(tmp_path):
    repo = _repo(tmp_path)
    base = _git(repo, "rev-parse", "main")
    (repo / "plugins" / "keep" / "f.txt").write_text("b")
    head = _commit(repo, "docs only [skip-plugin-bump]")
    assert evaluate(str(repo), base, head)[0] is True

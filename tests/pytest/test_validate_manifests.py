"""scripts/validate_manifests.py: object sources (git-subdir) are skipped, string sources are checked."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_manifests import validate  # noqa: E402

GIT_SUBDIR = {
    "source": "git-subdir",
    "url": "https://github.com/example/elsewhere.git",
    "path": "plugins/elsewhere",
}


def _marketplace(root: Path, plugins: list) -> None:
    (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (root / ".claude-plugin" / "marketplace.json").write_text(
        json.dumps({"name": "m", "owner": {"name": "o"}, "plugins": plugins})
    )


def _local_plugin(root: Path, name: str) -> None:
    pdir = root / "plugins" / name
    (pdir / ".claude-plugin").mkdir(parents=True)
    (pdir / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": name}))
    (pdir / "skills" / "s").mkdir(parents=True)
    (pdir / "skills" / "s" / "SKILL.md").write_text("---\nname: s\n---\n")


def test_git_subdir_entry_is_skipped_and_local_entry_checked(tmp_path):
    _local_plugin(tmp_path, "here")
    _marketplace(tmp_path, [
        {"name": "here", "source": "./plugins/here", "description": "d"},
        {"name": "elsewhere", "source": GIT_SUBDIR, "description": "d"},
    ])
    assert validate(str(tmp_path)) == (2, 1)


def test_local_entry_without_plugin_json_still_fails(tmp_path):
    _marketplace(tmp_path, [{"name": "ghost", "source": "./plugins/ghost", "description": "d"}])
    with pytest.raises(FileNotFoundError):
        validate(str(tmp_path))


def test_object_source_without_a_type_fails(tmp_path):
    _marketplace(tmp_path, [{"name": "bad", "source": {"url": "x"}, "description": "d"}])
    with pytest.raises(AssertionError, match="source must be a path or an object"):
        validate(str(tmp_path))


@pytest.mark.parametrize("source, missing", [
    ({"source": "git-subdir", "path": "plugins/x"}, "url"),
    ({"source": "git-subdir", "url": "https://github.com/example/x.git", "pth": "plugins/x"}, "path"),
    ({"source": "git-subdir", "url": "https://github.com/example/x.git", "path": ""}, "path"),
    ({"source": "github"}, "repo"),
    ({"source": "url"}, "url"),
])
def test_object_source_missing_required_field_fails(tmp_path, source, missing):
    _marketplace(tmp_path, [{"name": "bad", "source": source, "description": "d"}])
    with pytest.raises(AssertionError, match=f"requires a non-empty '{missing}'"):
        validate(str(tmp_path))


@pytest.mark.parametrize("source", [
    {"source": "github", "repo": "example/x"},
    {"source": "url", "url": "https://example.com/x.git"},
    {"source": "npm", "package": "x"},
])
def test_object_source_with_required_fields_passes(tmp_path, source):
    _marketplace(tmp_path, [{"name": "ok", "source": source, "description": "d"}])
    assert validate(str(tmp_path)) == (1, 0)


def test_duplicate_names_fail(tmp_path):
    _marketplace(tmp_path, [
        {"name": "dup", "source": GIT_SUBDIR, "description": "d"},
        {"name": "dup", "source": GIT_SUBDIR, "description": "d"},
    ])
    with pytest.raises(AssertionError, match="duplicate plugin"):
        validate(str(tmp_path))


def test_repo_marketplace_validates():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_manifests.py"), str(ROOT)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("OK:")

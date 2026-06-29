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

"""Tests for the inventory count sweep (scripts/sweep_counts.py).

Skill counts are cross-file invariants. The sweep reads the live count from
plugins/*/skills, compares it with every site that quotes it, and rewrites stale
sites. `test_live_tree_counts_in_sync` is the CI guard against stale counts.
"""

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SWEEP = REPO_ROOT / "scripts" / "sweep_counts.py"

FAKE_SITES = [
    ("site.html", "total", r"\d+ plugins · (\d+) skills"),
    ("site.html", "alpha", r"alpha<br/>(\d+) skills?"),
    ("band.html", "beta", r'data-count="(?P<n>\d+)">(?P=n)</div><div class="l">skills</div>'),
]


def _load_module():
    spec = importlib.util.spec_from_file_location("sweep_counts", SWEEP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_skill(root: Path, plugin: str, name: str, with_manifest: bool = True) -> None:
    skill_dir = root / "plugins" / plugin / "skills" / name
    skill_dir.mkdir(parents=True)
    if with_manifest:
        (skill_dir / "SKILL.md").write_text(f"---\nname: {name}\n---\n")


def _build_tree(root: Path, total_text: str = "2 plugins · 9 skills") -> None:
    _make_skill(root, "alpha", "one")
    _make_skill(root, "alpha", "two")
    _make_skill(root, "beta", "three")
    _make_skill(root, "beta", "_lib")  # excluded
    _make_skill(root, "beta", "no-manifest", with_manifest=False)  # excluded
    (root / "site.html").write_text(f"<p>{total_text}</p>\nalpha<br/>5 skills\n")
    (root / "band.html").write_text('<div data-count="7">7</div><div class="l">skills</div>\n')


def test_live_counts_skips_lib_and_dirs_without_skill_md(tmp_path):
    sc = _load_module()
    _build_tree(tmp_path)
    assert sc.live_counts(tmp_path) == {"total": 3, "alpha": 2, "beta": 1}


def test_check_reports_stale_sites_then_write_fixes_and_check_passes(tmp_path, capsys):
    sc = _load_module()
    _build_tree(tmp_path)

    assert sc.main(["--check"], root=tmp_path, sites=FAKE_SITES) == 1
    out = capsys.readouterr().out
    assert "STALE site.html [total] found 9 expected 3" in out
    assert "STALE site.html [alpha] found 5 expected 2" in out
    assert "STALE band.html [beta] found 7 expected 1" in out

    assert sc.main(["--write"], root=tmp_path, sites=FAKE_SITES) == 0
    out = capsys.readouterr().out
    assert "updated site.html [total] 9 -> 3" in out
    assert "total changed: regenerate site/og.png from site/og.html" in out

    assert "2 plugins · 3 skills" in (tmp_path / "site.html").read_text()
    # both the data-count attribute and the inner text are rewritten
    assert (tmp_path / "band.html").read_text() == (
        '<div data-count="1">1</div><div class="l">skills</div>\n')
    assert sc.main(["--check"], root=tmp_path, sites=FAKE_SITES) == 0


def test_write_is_quiet_about_og_when_total_is_already_current(tmp_path, capsys):
    sc = _load_module()
    _build_tree(tmp_path, total_text="2 plugins · 3 skills")
    assert sc.main(["--write"], root=tmp_path, sites=FAKE_SITES) == 0
    assert "regenerate site/og.png" not in capsys.readouterr().out


def test_zero_match_template_is_an_error_in_check_and_write(tmp_path, capsys):
    sc = _load_module()
    _build_tree(tmp_path)
    renamed = [("site.html", "total", r"\d+ gadgets · (\d+) skills")]
    for flag in ("--check", "--write"):
        assert sc.main([flag], root=tmp_path, sites=renamed) == 1
        assert "matched 0 times" in capsys.readouterr().out


def test_default_run_prints_live_counts_and_sites(tmp_path, capsys):
    sc = _load_module()
    _build_tree(tmp_path)
    assert sc.main([], root=tmp_path, sites=FAKE_SITES) == 0
    out = capsys.readouterr().out
    assert "total: 3" in out and "site.html [alpha] = 5" in out


def test_catalog_row_count_must_equal_live_total(tmp_path, capsys):
    sc = _load_module()
    _build_tree(tmp_path, total_text="2 plugins · 3 skills")
    (tmp_path / "docs").mkdir()
    rows = '<div class="crow" data-type="Skill" data-search="x">\n' * 2
    (tmp_path / "docs" / "catalog.html").write_text(rows)
    sites = [("site.html", "total", r"\d+ plugins · (\d+) skills")]
    assert sc.main(["--check"], root=tmp_path, sites=sites) == 1
    assert "docs/catalog.html [rows] found 2 Skill rows expected 3" in capsys.readouterr().out


def test_live_tree_counts_in_sync(capsys):
    """CI guard: every count in the docs and site matches plugins/*/skills."""
    sc = _load_module()
    code = sc.main(["--check"], root=REPO_ROOT)
    assert code == 0, capsys.readouterr().out

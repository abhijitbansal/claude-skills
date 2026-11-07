"""A gallery visitor gets the published spec and the data needed to rebuild it."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/build_dashboard_gallery.py"
BASE = ROOT / "docs/features/showcase/portable-artifacts"
EXAMPLES = {
    "growth-overview": "growth-dashboard.json",
    "support-ops": "gallery/support-ops/dashboard.json",
    "traffic-deep-dive": "gallery/traffic-deep-dive/dashboard.json",
    "product-performance": "gallery/product-performance/dashboard.json",
}


def load():
    spec = importlib.util.spec_from_file_location("dashboard_gallery", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("slug,spec_file", EXAMPLES.items())
def test_pack_contains_unchanged_spec_and_every_csv(tmp_path, slug, spec_file):
    gallery = load()
    archive = gallery.pack_example(slug, tmp_path)
    published = (BASE / spec_file).read_bytes()
    sources = json.loads(published)["sources"]
    with zipfile.ZipFile(archive) as pack:
        assert pack.read("dashboard.json") == published
        assert pack.read("LICENSE") == (ROOT / "LICENSE").read_bytes()
        assert set(pack.namelist()) == {"dashboard.json", "README.md", "LICENSE"} | {
            source["path"] for source in sources.values()
        }
        for source in sources.values():
            original = ROOT / "plugins/portable-artifacts/eval/fixtures" / source["path"]
            assert pack.read(source["path"]) == original.read_bytes()
        readme = pack.read("README.md").decode()
        assert "scripts/build.mjs" in readme
        assert "scripts/doctor.mjs" in readme
        assert "sample" in readme.lower()


def test_pack_bytes_are_deterministic(tmp_path):
    gallery = load()
    first = gallery.pack_example("growth-overview", tmp_path / "a").read_bytes()
    second = gallery.pack_example("growth-overview", tmp_path / "b").read_bytes()
    assert first == second


def test_missing_fixture_fails_instead_of_shipping_a_partial_pack(tmp_path):
    gallery = load()
    with pytest.raises(FileNotFoundError):
        gallery.pack_example("growth-overview", tmp_path / "out", fixtures=tmp_path / "empty")
    assert not list(tmp_path.rglob("*.zip"))


def test_cli_builds_all_four_packs_without_node_dependencies(tmp_path):
    result = subprocess.run([sys.executable, str(SCRIPT), "--out", str(tmp_path)],
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    assert {p.parent.name for p in tmp_path.glob("*/source.zip")} == set(EXAMPLES)


@pytest.mark.parametrize("slug", EXAMPLES)
def test_each_dashboard_card_links_to_its_source_download(slug):
    html = (ROOT / "docs/features/portable-artifacts.html").read_text()
    assert f'href="showcase/portable-artifacts/gallery/{slug}/source.zip"' in html


def test_published_data_comparison_ignores_only_refresh_timestamps(tmp_path):
    gallery = load()
    published = {"rows": [{"n": 1}], "columns": ["n"], "rowCount": 1,
                 "truncated": False, "refreshedAt": "yesterday"}

    def page(name, query, kpi="42"):
        file = tmp_path / name
        data = json.dumps({"queries": {"totals": query}, "charts": []})
        file.write_text(f'<div class="kpi-value">{kpi}</div>'
                        f'<script type="application/json" id="dash-data">{data}</script>')
        return file

    original = page("original.html", published)
    refreshed = page("refreshed.html", {**published, "refreshedAt": "today"})
    assert gallery.dashboard_data(original) == gallery.dashboard_data(refreshed)
    assert gallery.dashboard_data(original) != gallery.dashboard_data(page("wrong-rows.html", {**published, "rows": [{"n": 2}]}))
    assert gallery.dashboard_data(original) != gallery.dashboard_data(page("wrong-kpi.html", published, "43"))


def test_missing_dashboard_data_is_an_error(tmp_path):
    gallery = load()
    empty = tmp_path / "empty.html"
    empty.write_text("<html>No dashboard here</html>")
    with pytest.raises(ValueError, match="dash-data"):
        gallery.dashboard_data(empty)

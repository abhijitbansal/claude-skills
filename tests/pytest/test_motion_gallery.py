"""The gallery's source download must be enough to rebuild the advertised example."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/build_motion_gallery.py"
GALLERY = ROOT / "docs/features/showcase/portable-artifacts/gallery/motion-1-4"
EXAMPLES = (
    "beats", "blocks-tour", "gl-transitions", "grade", "lottie", "loudness",
    "maps", "pick-and-storyboard", "race", "text-behind-subject",
)


def build(out):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--out", str(out)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return out


def references(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"src", "beats", "cutout", "avatar"} and isinstance(child, str):
                yield child
            yield from references(child)
    elif isinstance(value, list):
        for child in value:
            yield from references(child)


@pytest.fixture(scope="module")
def packs(tmp_path_factory):
    return build(tmp_path_factory.mktemp("gallery-packs"))


@pytest.mark.parametrize("slug", EXAMPLES)
def test_source_download_contains_unchanged_spec_and_every_input(packs, slug):
    with zipfile.ZipFile(packs / slug / "source.zip") as archive:
        names = archive.namelist()
        assert len(names) == len(set(names))
        assert all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in names)
        assert archive.read("motion.json") == (GALLERY / slug / "motion.json").read_bytes()
        spec = json.loads(archive.read("motion.json"))
        for ref in references(spec):
            assert ref in names, f"{slug}: missing {ref} in source download"
        assert archive.read("LICENSE") == (ROOT / "LICENSE").read_bytes()
        readme = archive.read("README.md").decode()
        for command in ("doctor.mjs", "validate.mjs", "preview.mjs", "render.mjs"):
            assert command in readme
        if slug == "loudness":
            assert "--loudness -16" in readme


def test_gallery_download_links_cover_exactly_the_ten_technical_examples():
    from html.parser import HTMLParser

    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.downloads = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            href = attrs.get("href", "")
            if tag == "a" and "motion-1-4/" in href and href.endswith("source.zip"):
                assert "download" in attrs
                self.downloads.append(href.split("/")[-2])

    parser = Links()
    parser.feed((ROOT / "docs/features/portable-artifacts.html").read_text())
    assert sorted(parser.downloads) == sorted(EXAMPLES)


def test_archives_are_reproducible(packs, tmp_path):
    again = build(tmp_path)
    for slug in EXAMPLES:
        assert (packs / slug / "source.zip").read_bytes() == (again / slug / "source.zip").read_bytes()


def test_missing_asset_is_an_error_instead_of_an_incomplete_download(tmp_path):
    assert SCRIPT.is_file(), "gallery pack builder has not been implemented"
    module_spec = importlib.util.spec_from_file_location("motion_gallery", SCRIPT)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    assets = tmp_path / "examples"
    assets.mkdir()
    with pytest.raises((FileNotFoundError, ValueError), match="badge.lottie.json"):
        module.pack_example("lottie", tmp_path / "out", examples=assets)

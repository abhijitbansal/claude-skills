"""Structure checks for docs/features/portable-artifacts.html (stdlib only).

The page order is a product decision: showcase films, quick install, one line
per skill, then the details. The install block follows the per-line
copy-button contract in CLAUDE.md.
"""
import html
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "docs" / "features" / "portable-artifacts.html"
FILM_DIR = "showcase/portable-artifacts/gallery/motion-showcase"
FILMS = ("hand-drawn", "features")
SKILLS = ("make-dashboard", "make-diagram", "make-explainer", "make-motion", "make-scene")
TOP_ORDER = ("films", "quick-install", "skills", "details")
KEPT_IDS = (
    "whats-new", "overview", "showcase", "showcase-motion", "showcase-dashboard",
    "gallery", "gallery-motion-1-4", "why", "install", "requirements",
    "usability", "security", "licences", "inventory",
)


def _page():
    return PAGE.read_text(encoding="utf-8")


def _section(page, section_id):
    """Return the markup of the <section id=...> block, or '' if absent."""
    match = re.search(
        r'<section id="%s"[^>]*>(.*?)</section>' % re.escape(section_id), page, re.S
    )
    return match.group(1) if match else ""


def _position(page, element_id):
    """Offset of the element (any tag) that carries this id, or -1."""
    match = re.search(r'<[a-z0-9]+ id="%s"' % re.escape(element_id), page)
    return match.start() if match else -1


def test_portable_artifacts_page_order():
    page = _page()
    positions = [_position(page, sid) for sid in TOP_ORDER]
    assert all(p >= 0 for p in positions), dict(zip(TOP_ORDER, positions))
    assert positions == sorted(positions), dict(zip(TOP_ORDER, positions))
    # The hero comes before all of them, and the old detail sections after "details".
    assert page.find('<h1>portable-artifacts</h1>') < positions[0]
    for sid in KEPT_IDS:
        assert 'id="%s"' % sid in page, "lost id: " + sid
        assert page.find('id="%s"' % sid) > positions[3], sid + " should sit in the details"


def test_quick_install_copy_buttons_hold_one_command_without_comment():
    block = _section(_page(), "quick-install")
    buttons = re.findall(r'<button class="copy" data-copy="([^"]*)"', block)
    assert len(buttons) >= 2
    for raw in buttons:
        command = html.unescape(raw)
        assert "\n" not in command and "#" not in command, command
        assert command == command.strip() and command
    # one button per visible command line, as the CLAUDE.md contract says
    assert block.count('<div class="cl">') == len(buttons)
    # nothing invented, nothing repeated: known command forms only, and the
    # install details keep just the variants
    known = ("/plugin marketplace add ", "/plugin install ", "npx skills add ")
    details_install = _section(_page(), "install")
    for raw in buttons:
        assert html.unescape(raw).startswith(known), raw
        assert 'data-copy="%s"' % raw not in details_install, "repeated: " + raw


def test_both_films_are_referenced_with_poster_and_exist():
    block = _section(_page(), "films")
    for film in FILMS:
        video = "%s/%s/video.mp4" % (FILM_DIR, film)
        poster = "%s/%s/poster.jpg" % (FILM_DIR, film)
        assert 'src="%s"' % video in block, video
        assert 'poster="%s"' % poster in block, poster
        assert (PAGE.parent / video).is_file(), video
        assert (PAGE.parent / poster).is_file(), poster
    videos = re.findall(r"<video\b[^>]*>", block)
    assert len(videos) == len(FILMS)
    for tag in videos:
        assert "controls" in tag and 'preload="none"' in tag, tag
        assert "autoplay" not in tag, tag
        assert 'aria-label="' in tag, tag


def test_films_page_no_longer_says_the_films_are_silent():
    block = _section(_page(), "films").lower()
    assert "silent" not in block
    assert "no sound" not in block
    assert "neither has sound" not in block
    metas = re.findall(r'<p class="gal-meta"[^>]*>([^<]*)</p>', block)
    assert len(metas) == len(FILMS), metas
    assert all("voiceover" in meta for meta in metas), metas
    # still true: no music or sound cues, said plainly in the tour's caption
    assert "no music" in block


def test_both_films_have_an_audio_stream():
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        pytest.skip("ffprobe is not on PATH")
    for film in FILMS:
        video = PAGE.parent / FILM_DIR / film / "video.mp4"
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=codec_name", "-of", "csv=p=0", str(video)],
            capture_output=True, text=True, check=True,
        ).stdout.split()
        assert out, "no audio stream in " + str(video)


def test_films_open_the_page_and_do_not_depend_on_scripts_or_gallery_css():
    page = _page()
    main_start = page.index('<main id="main"')
    first_section = re.search(r"<section\b[^>]*id=\"([^\"]+)\"", page[main_start:]).group(1)
    assert first_section == "films"
    # no stat band between the hero and the films
    films_at = _position(page, "films")
    assert "statband" not in page[:films_at]
    # film cards are visible with JS off: no .reveal on them
    cards = re.findall(r'<div class="[^"]*"\s+id="film-[^"]+"', page)
    assert len(cards) == len(FILMS)
    assert all("reveal" not in card for card in cards), cards
    # the .gal-* rules that style them live in <head>, not inside the gallery
    head = page[: page.index("</head>")]
    assert ".gal-media{" in head and ".gal-card{" in head
    assert ".gal-media{" not in _section(page, "gallery")


GALLERY_DIR = "showcase/portable-artifacts/gallery"
# Page order, which is also the order of both link lists.
GALLERY_ANCHORS = (
    "gallery-dashboard", "gallery-motion", "gallery-explainer", "gallery-diagram", "gallery-scene",
)
GALLERY_LABELS = ("Dashboards", "Motion", "Explainers", "Diagrams", "3D scenes")
CLOUD_DIR = GALLERY_DIR + "/cloud-architecture"


def _toc(page):
    match = re.search(r'<aside class="toc"[^>]*>(.*?)</aside>', page, re.S)
    return match.group(1) if match else ""


def test_each_skill_has_one_gallery_anchor_on_its_own_heading():
    page = _page()
    gallery = _section(page, "gallery")
    for anchor in GALLERY_ANCHORS:
        assert page.count('id="%s"' % anchor) == 1, anchor
        assert re.search(r'<h3 class="gal-h3" id="%s">' % anchor, gallery), anchor
    assert [page.find("id=\"%s\"" % a) for a in GALLERY_ANCHORS] == sorted(
        page.find("id=\"%s\"" % a) for a in GALLERY_ANCHORS
    )
    # the mixed heading is split: no heading names two skills
    assert "Explainers and diagrams" not in page


def test_old_gallery_anchors_still_resolve():
    page = _page()
    for anchor in ("gallery", "gallery-motion-1-4"):
        assert page.count('id="%s"' % anchor) == 1, anchor
    assert 'href="#gallery-motion-1-4"' in page  # the 1.1.0 what's-new link


def test_left_menu_lists_the_gallery_anchors_under_gallery():
    toc = _toc(_page())
    links = re.findall(r'<a ([^>]*)>([^<]*)</a>', toc)
    hrefs = [re.search(r'href="([^"]+)"', attrs).group(1) for attrs, _ in links]
    assert "#gallery" in hrefs
    start = hrefs.index("#gallery")
    quick = links[start + 1:start + 1 + len(GALLERY_ANCHORS)]
    assert [re.search(r'href="#([^"]+)"', a).group(1) for a, _ in quick] == list(GALLERY_ANCHORS)
    assert [label for _, label in quick] == list(GALLERY_LABELS)
    assert all('class="sub"' in attrs for attrs, _ in quick)
    assert hrefs[start + 1 + len(GALLERY_ANCHORS)] == "#why"


def test_top_section_has_one_gallery_by_skill_row_with_the_same_links():
    block = _section(_page(), "films")
    assert block.count("Gallery by skill") == 1
    row = re.search(r'<p[^>]*>[^<]*Gallery by skill.*?</p>', block, re.S)
    assert row, "no Gallery by skill row"
    hrefs = re.findall(r'href="#([^"]+)"', row.group(0))
    for anchor in GALLERY_ANCHORS:
        assert anchor in hrefs, anchor
    # replaces, not repeats, the old "More outputs" line
    assert "More outputs" not in block
    assert block.count('href="#gallery"') == 0


def test_cloud_architecture_gallery_files_exist_and_are_linked_without_autoplay():
    for name in ("diagram.json", "dusk/index.html", "dusk/thumb.jpg",
                 "press/index.html", "press/thumb.jpg", "poster/index.html", "poster/thumb.jpg"):
        assert (PAGE.parent / CLOUD_DIR / name).is_file(), name
    page = _page()
    # one card in the diagrams part, one smaller preview directly under the films
    gallery = _section(page, "gallery")
    diagrams = gallery[gallery.index('id="gallery-diagram"'):gallery.index('id="gallery-scene"')]
    assert CLOUD_DIR + "/dusk/index.html" in diagrams
    assert CLOUD_DIR + "/diagram.json" in diagrams
    assert "cloud:" in diagrams
    films = _section(page, "films")
    assert CLOUD_DIR + "/dusk/thumb.jpg" in films
    assert films.index('id="film-features"') < films.index(CLOUD_DIR + "/dusk/thumb.jpg")
    assert len(re.findall(r"<video\b", films)) == len(FILMS)  # the preview is an image


def test_plan_mode_follows_the_explainers_it_belongs_to():
    page = _page()
    plan = page.index('<h3 class="gal-h3">Plan mode</h3>')
    assert page.index('id="gallery-explainer"') < plan < page.index('id="gallery-diagram"')


def test_every_skill_has_one_line_that_links_to_existing_details():
    page = _page()
    block = _section(page, "skills")
    details_start = _position(page, "details")
    for skill in SKILLS:
        target = re.search(r'<a href="#(%s)"' % re.escape(skill), block)
        assert target, "no one-liner link for " + skill
        marker = page.find('id="%s"' % skill)
        assert marker > details_start, skill + " details anchor missing"

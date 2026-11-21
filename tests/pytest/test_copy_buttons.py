"""Per-line copy-button contract (CLAUDE.md, "Working in this repo"), repo-wide.

Every `.code.cmds` block under docs/ and site/ wraps one `<div class="cl">` per
command, and each command `.cl` (one holding `<code class="ct">`) has exactly
one `<button class="copy">`; a note-only `.cl` has none. A button's
`data-copy` is one command: no newline, no surrounding whitespace, and no
trailing `# comment` (the comment may stay in the visible text only). Full
multi-line samples use a plain `.code` block with one copy-all button and are
not checked here. Stdlib only.
"""
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCANNED_DIRS = ("docs", "site")
COMMENT_RE = re.compile(r"(^|\s)#")


class _CmdsScanner(HTMLParser):
    """Collects one record per `.code.cmds` block: its .cl lines and stray buttons."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self._divs = []          # one entry per open <div>: "cmds", "cl" or None
        self._block = None
        self._cl = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        if tag == "div":
            kind = None
            if self._block is None and {"code", "cmds"} <= classes:
                self._block = {"line": self.getpos()[0], "cls": [], "stray": []}
                self.blocks.append(self._block)
                kind = "cmds"
            elif self._block is not None and "cl" in classes:
                self._cl = {"command": False, "buttons": []}
                self._block["cls"].append(self._cl)
                kind = "cl"
            self._divs.append(kind)
        elif tag == "code" and self._cl is not None and "ct" in classes:
            self._cl["command"] = True
        elif tag == "button" and self._block is not None and "copy" in classes:
            target = self._cl["buttons"] if self._cl is not None else self._block["stray"]
            target.append(attrs.get("data-copy"))

    def handle_endtag(self, tag):
        if tag != "div" or not self._divs:
            return
        kind = self._divs.pop()
        if kind == "cl":
            self._cl = None
        elif kind == "cmds":
            self._block = None
            self._cl = None


def violations(text, label="page"):
    """Every breach of the per-line contract in one page's markup."""
    scanner = _CmdsScanner()
    scanner.feed(text)
    found = []
    for block in scanner.blocks:
        where = "%s:%d" % (label, block["line"])
        if block["stray"]:
            found.append("%s: %d copy button(s) outside any .cl" % (where, len(block["stray"])))
        if not block["cls"]:
            found.append("%s: .code.cmds block with no .cl lines" % where)
        for i, cl in enumerate(block["cls"], 1):
            buttons = cl["buttons"]
            # A command line (code.ct) gets one button; a note-only line gets none.
            need = 1 if cl["command"] else 0
            if len(buttons) != need:
                found.append("%s: .cl #%d has %d copy buttons (need %d)" % (where, i, len(buttons), need))
            for copy in buttons:
                if copy is None:
                    found.append("%s: .cl #%d button has no data-copy" % (where, i))
                elif "\n" in copy:
                    found.append("%s: .cl #%d data-copy spans lines: %r" % (where, i, copy))
                elif copy != copy.strip() or not copy:
                    found.append("%s: .cl #%d data-copy has surrounding whitespace: %r" % (where, i, copy))
                elif COMMENT_RE.search(copy):
                    found.append("%s: .cl #%d data-copy carries a # comment: %r" % (where, i, copy))
    return found


GOOD = (
    '<div class="code cmds">'
    '<div class="cl"><code class="ct">git clone x   <span class="c"># fetch</span></code>'
    '<button class="copy" data-copy="git clone x">copy</button></div>'
    '<div class="cl"><span class="note"># then</span></div>'
    '<div class="cl"><code class="ct">cd x</code><button class="copy" data-copy="cd x">copy</button></div>'
    '</div>'
)


def test_good_fixture_has_no_violations():
    assert violations(GOOD) == []


def test_one_button_spanning_two_commands_is_caught():
    bad = (
        '<div class="code cmds">'
        '<div class="cl"><code class="ct">git clone x</code></div>'
        '<div class="cl"><code class="ct">cd x</code>'
        '<button class="copy" data-copy="git clone x\ncd x">copy</button></div>'
        '</div>'
    )
    found = violations(bad, "bad.html")
    assert any(".cl #1 has 0 copy buttons" in v for v in found), found
    assert any("data-copy spans lines" in v for v in found), found


def test_comment_in_data_copy_and_stray_button_are_caught():
    bad = (
        '<div class="code cmds">'
        '<div class="cl"><code class="ct">wind init  # pick</code>'
        '<button class="copy" data-copy="wind init  # pick">copy</button></div>'
        '<button class="copy" data-copy="wind up">copy</button>'
        '</div>'
    )
    found = violations(bad, "bad.html")
    assert any("# comment" in v for v in found), found
    assert any("outside any .cl" in v for v in found), found


def test_plain_code_blocks_are_not_checked():
    sample = '<div class="code"><div class="code-body">a\nb</div><button class="copy" data-copy="a\nb">copy</button></div>'
    assert violations(sample) == []


def test_every_cmds_block_in_docs_and_site_follows_the_contract():
    found = []
    pages = 0
    for top in SCANNED_DIRS:
        for path in sorted((ROOT / top).rglob("*.html")):
            pages += 1
            found += violations(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))
    assert pages > 0
    assert found == [], "\n".join(found)

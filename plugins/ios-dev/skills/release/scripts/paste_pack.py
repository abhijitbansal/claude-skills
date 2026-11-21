#!/usr/bin/env python3
"""Write a copy-ready App Store Connect paste pack with per-field character counts.

Usage: paste_pack.py <version> [--mode testflight|appstore]

Reads marketing/app-store-listing.md (sections found by their `## ` heading,
a trailing "(30 chars max)" style note is ignored) and the release-notes draft
.scratch/release/release-notes-<version>.md written by release_notes.sh.
Writes .scratch/release/asc-paste-<version>.md and prints one line per field:

    <field>: <chars>/<limit> ok | OVER LIMIT
    <field>: MISSING | TODO

appstore  : What's New (notes draft), Promotional text, Description, Subtitle, Keywords
testflight: What to Test (listing section "What to Test" if present, else the notes draft)

Exit 0, 1 when any field is over its limit, 2 on bad arguments. Missing and TODO
fields are reported, not errors: the pack is a convenience, not a gate.
"""
import os
import re
import sys

LISTING = os.path.join("marketing", "app-store-listing.md")
SCRATCH = os.path.join(".scratch", "release")

# (label, listing heading key or None for the notes draft, character limit)
APPSTORE_FIELDS = [
    ("What's New", None, 4000),
    ("Promotional text", "promotional text", 170),
    ("Description", "description", 4000),
    ("Subtitle", "subtitle", 30),
    ("Keywords", "keywords", 100),
]
TESTFLIGHT_FIELDS = [("What to Test", "what to test", 4000)]


def listing_sections(path):
    sections = {}
    if not os.path.isfile(path):
        return sections
    key, body = None, []
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"##\s+(.+?)\s*$", line)
            if m:
                if key is not None:
                    sections[key] = "\n".join(body).strip()
                key = re.sub(r"\s*\(.*\)\s*$", "", m.group(1)).strip().lower()
                body = []
            elif key is not None:
                body.append(line.rstrip("\n"))
    if key is not None:
        sections[key] = "\n".join(body).strip()
    return sections


def read_text(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def field_text(key, sections, notes):
    if key is None:
        return notes
    text = sections.get(key)
    if text is None and key == "what to test":
        return notes
    return text


def main(argv):
    usage = "usage: paste_pack.py <version> [--mode testflight|appstore]"
    args = argv[1:]
    if not args or args[0].startswith("--"):
        print(usage, file=sys.stderr)
        return 2
    version, mode = args[0], "testflight"
    rest = args[1:]
    while rest:
        if rest[0] == "--mode" and len(rest) >= 2 and rest[1] in ("testflight", "appstore"):
            mode = rest[1]
            rest = rest[2:]
        else:
            print("unknown argument: " + rest[0], file=sys.stderr)
            print(usage, file=sys.stderr)
            return 2

    sections = listing_sections(LISTING)
    notes = read_text(os.path.join(SCRATCH, "release-notes-%s.md" % version))
    fields = APPSTORE_FIELDS if mode == "appstore" else TESTFLIGHT_FIELDS

    report, over = [], False
    pack = ["# App Store Connect paste pack, v%s (%s)" % (version, mode), ""]
    for label, key, limit in fields:
        text = field_text(key, sections, notes)
        if text is None or text == "":
            report.append("%s: MISSING" % label)
            pack += ["## %s: MISSING" % label, ""]
            continue
        if text.upper().startswith("TODO"):
            report.append("%s: TODO (placeholder still in the listing)" % label)
            pack += ["## %s: TODO" % label, ""]
            continue
        count = len(text)
        status = "ok" if count <= limit else "OVER LIMIT"
        over = over or count > limit
        report.append("%s: %d/%d %s" % (label, count, limit, status))
        pack += ["## %s (%d/%d chars) %s" % (label, count, limit, status), "", "```text", text, "```", ""]

    os.makedirs(SCRATCH, exist_ok=True)
    out = os.path.join(SCRATCH, "asc-paste-%s.md" % version)
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(pack))
    print("\n".join(report))
    print("paste pack: " + out)
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

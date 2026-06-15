#!/usr/bin/env python3
"""Additively merge behavioral-guideline sections into a target CLAUDE.md.

Usage: merge_guidelines.py <source-claude-md> <target-claude-md> [--dry-run]

Reads the guideline region from <source> -- the text between the
``claude-skills:guidelines`` markers, or the whole file if no markers are
present -- splits it into ``## ``-delimited sections, and merges into <target>
only the sections whose heading is not already there.  Heading matching is
case- and number-prefix-insensitive ("## 1. Think Before Coding" matches
"## Think before coding"), so re-runs never duplicate a section.

Existing target content is never mutated; missing sections are appended.  A
missing or empty target is created from the full guideline region.  Prints one
``add: <heading>`` / ``skip (present): <heading>`` line per section.  Exits 0 on
success, 2 on usage/IO error.  With --dry-run, reports actions without writing.
"""

import re
import sys
from pathlib import Path

BEGIN_MARK = "claude-skills:guidelines:begin"
END_MARK = "claude-skills:guidelines:end"
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
NUM_PREFIX_RE = re.compile(r"^\d+[.)]\s*")


def norm_heading(text: str) -> str:
    """Normalize a heading's text for presence comparison."""
    text = NUM_PREFIX_RE.sub("", text.strip())
    return re.sub(r"\s+", " ", text).strip().lower()


def extract_region(src_text: str) -> str:
    """Return the guideline region between markers, or the whole file."""
    lines = src_text.splitlines()
    begin = end = None
    for i, line in enumerate(lines):
        if begin is None and BEGIN_MARK in line:
            begin = i
        elif begin is not None and END_MARK in line:
            end = i
            break
    if begin is not None and end is not None and end > begin:
        return "\n".join(lines[begin + 1:end]).strip("\n")
    return src_text.strip("\n")


def split_sections(region: str):
    """Split a region into [(norm_heading, section_text)] per ``## `` heading."""
    sections = []
    current = None
    for line in region.splitlines():
        match = HEADING_RE.match(line)
        if match and len(match.group(1)) == 2:  # level-2 heading only
            if current is not None:
                sections.append(current)
            current = (norm_heading(match.group(2)), [line])
        elif current is not None:
            current[1].append(line)
    if current is not None:
        sections.append(current)
    return [(heading, "\n".join(body).rstrip() + "\n") for heading, body in sections]


def existing_headings(text: str) -> set:
    """Every heading (any level) already present in the target, normalized."""
    found = set()
    for line in text.splitlines():
        match = HEADING_RE.match(line)
        if match:
            found.add(norm_heading(match.group(2)))
    return found


def main() -> int:
    raw = sys.argv[1:]
    dry_run = "--dry-run" in raw
    positional = [arg for arg in raw if arg != "--dry-run"]
    if len(positional) != 2:
        sys.stderr.write("usage: merge_guidelines.py <source> <target> [--dry-run]\n")
        return 2

    src_path, dst_path = Path(positional[0]), Path(positional[1])
    if not src_path.is_file():
        sys.stderr.write(f"source not found: {src_path}\n")
        return 2

    region = extract_region(src_path.read_text(encoding="utf-8"))
    sections = split_sections(region)
    if not sections:
        sys.stderr.write("no '## ' guideline sections found in source\n")
        return 2

    dst_text = dst_path.read_text(encoding="utf-8") if dst_path.is_file() else ""

    if not dst_text.strip():
        for heading, _ in sections:
            print(f"add: {heading}")
        if not dry_run:
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            dst_path.write_text(region.rstrip() + "\n", encoding="utf-8")
        return 0

    present = existing_headings(dst_text)
    to_add = [(h, body) for h, body in sections if h not in present]
    for heading, _ in sections:
        print(("add: " if heading not in present else "skip (present): ") + heading)
    if to_add:
        addition = "\n".join(body.rstrip() for _, body in to_add)
        new_text = dst_text.rstrip() + "\n\n" + addition + "\n"
        if not dry_run:
            dst_path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

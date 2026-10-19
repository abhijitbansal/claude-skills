#!/usr/bin/env python3
"""One-off generator for shared/fonts/metrics.json entries (not run in CI).

Sanctioned invocation (fonttools + brotli live in a throwaway venv, never in
system Python):

    python3 -m venv <scratch>/v && <scratch>/v/bin/pip install fonttools brotli
    <scratch>/v/bin/python bin/font-metrics.py shared/fonts/<file>.woff2... \\
        --merge shared/fonts/metrics.json --name "Host Grotesk|400" ...

Keys are "<Family>|<weight>". Without --name, the key is derived from the file
name (title-cased family, weight from the -latin-<weight>- part). Pass --name
once per file, in order, when title-casing is wrong (e.g. "JetBrains Mono").

Shape matches the existing entries: hhea ascender/descender/lineGap, unitsPerEm,
`advance` keyed by codepoint for U+0020-007E and U+00A0-00FF that the font has,
and `fallback` = mean advance of the ASCII letters, rounded to 2 decimals.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

CODEPOINTS = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
LETTERS = [c for c in range(0x20, 0x7F) if chr(c).isalpha()]


def key_for(path: Path) -> str:
    m = re.match(r"(.+)-latin-(\d+)-normal$", path.stem)
    if not m:
        sys.exit(f"cannot derive key from {path.name}; pass --name")
    return f"{m.group(1).replace('-', ' ').title()}|{m.group(2)}"


def entry(path: Path) -> dict:
    font = TTFont(path)
    cmap, hmtx, hhea = font.getBestCmap(), font["hmtx"], font["hhea"]
    adv = {c: hmtx[cmap[c]][0] for c in CODEPOINTS if c in cmap}
    mean = round(sum(adv[c] for c in LETTERS) / len(LETTERS), 2)
    return {
        "advance": {str(c): adv[c] for c in sorted(adv)},
        "ascender": hhea.ascent,
        "descender": hhea.descent,
        "fallback": int(mean) if mean.is_integer() else mean,
        "lineGap": hhea.lineGap,
        "unitsPerEm": font["head"].unitsPerEm,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fonts", nargs="+", type=Path)
    ap.add_argument("--merge", type=Path, required=True, help="metrics.json to update in place")
    ap.add_argument("--name", action="append", default=[], help='explicit "<Family>|<weight>" key, once per font')
    args = ap.parse_args()
    if args.name and len(args.name) != len(args.fonts):
        sys.exit("--name must be given once per font file")
    data = json.loads(args.merge.read_text())
    for i, path in enumerate(args.fonts):
        key = args.name[i] if args.name else key_for(path)
        data[key] = entry(path)
        print(f"{key}: {len(data[key]['advance'])} codepoints", file=sys.stderr)
    args.merge.write_text(json.dumps(dict(sorted(data.items())), indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()

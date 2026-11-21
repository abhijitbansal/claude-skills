#!/usr/bin/env python3
"""Generate the 1200x630 Open Graph card (og-card.png) for the app site.

A static, committed card is what Teams/iMessage/Slack unfurls need. Idempotent:
an existing card is left alone unless --force is given, so re-running after a
rebrand is one command.

  og-card.py --out site/og-card.png --title "My App" --subtitle "Tagline"
  og-card.py --out site/og-card.png --no-text     # solid card, stdlib only

Text needs Pillow (`pip install pillow`, dev-only); --no-text needs nothing.
Any unknown argument exits 2 and the usage line lists the accepted ones.
"""
import argparse
import os
import struct
import sys
import zlib

WIDTH, HEIGHT = 1200, 630
MARGIN = 96
TITLE_SIZE, SUBTITLE_SIZE = 96, 44
FONT_CANDIDATES = (
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def parse_color(text):
    value = text.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError(f"colour must be #RRGGBB, got {text!r}")
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        raise argparse.ArgumentTypeError(f"colour must be #RRGGBB, got {text!r}")


def write_solid_png(path, rgb):
    """Valid 1200x630 PNG, one flat colour, no third-party dependency."""
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    row = b"\x00" + bytes(rgb) * WIDTH
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(row * HEIGHT))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


def load_font(image_font, explicit, size):
    for candidate in ((explicit,) if explicit else FONT_CANDIDATES):
        try:
            return image_font.truetype(candidate, size)
        except OSError:
            continue
    return image_font.load_default(size=size)


def write_text_png(path, args):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        sys.exit("og-card: Pillow is not installed; run `pip install pillow` or pass --no-text")
    card = Image.new("RGB", (WIDTH, HEIGHT), args.bg)
    draw = ImageDraw.Draw(card)
    title_font = load_font(ImageFont, args.font, TITLE_SIZE)
    sub_font = load_font(ImageFont, args.font, SUBTITLE_SIZE)
    y = HEIGHT // 2 - TITLE_SIZE
    draw.text((MARGIN, y), args.title, font=title_font, fill=args.fg)
    if args.subtitle:
        draw.text((MARGIN, y + TITLE_SIZE + 24), args.subtitle, font=sub_font, fill=args.fg)
    card.save(path)


def main():
    parser = argparse.ArgumentParser(description="Generate the 1200x630 og-card.png")
    parser.add_argument("--out", required=True, help="output PNG path")
    parser.add_argument("--title", default="", help="headline text")
    parser.add_argument("--subtitle", default="", help="second line")
    parser.add_argument("--bg", type=parse_color, default=parse_color("#1f2937"), help="background #RRGGBB")
    parser.add_argument("--fg", type=parse_color, default=parse_color("#ffffff"), help="text #RRGGBB")
    parser.add_argument("--font", default="", help="path to a .ttf/.ttc (default: system bold sans)")
    parser.add_argument("--no-text", action="store_true", help="flat colour card, no Pillow needed")
    parser.add_argument("--force", action="store_true", help="overwrite an existing card")
    args = parser.parse_args()

    if os.path.exists(args.out) and not args.force:
        print(f"og-card: {args.out} exists, leaving it (use --force to regenerate)")
        return
    if not args.no_text and not args.title:
        parser.error("--title is required unless --no-text is given")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    if args.no_text:
        write_solid_png(args.out, args.bg)
    else:
        write_text_png(args.out, args)
    print(f"og-card: wrote {args.out} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()

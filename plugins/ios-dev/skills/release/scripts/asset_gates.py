#!/usr/bin/env python3
"""Pixel-level checks on store assets, stdlib only (no sips, so Linux CI works).

Usage:
  asset_gates.py icon                       check the light 1024 app icon for alpha
  asset_gates.py screenshots <dir> <sizes>  check screenshot pixel sizes

icon prints one line, tab separated:
  OPAQUE <png path>    light 1024 icon has no alpha channel
  ALPHA  <png path>    light 1024 icon has an alpha channel (App Store Connect rejects it)
  NOTFOUND <reason>    could not resolve or read the icon; the caller must not treat this as a pass

The light icon is the 1024x1024 entry of AppIcon.appiconset/Contents.json that
has no `appearances` key, so the dark and tinted variants (which keep alpha) are
never looked at.

screenshots prints BAD / UNREADABLE lines and a final `SUMMARY <checked> <bad>`.
<sizes> holds one `WIDTHxHEIGHT` per line, `#` starts a comment.
"""
import json
import os
import re
import struct
import sys

PNG_SIG = b"\x89PNG\r\n\x1a\n"
SKIP_DIRS = {"build", ".git", "Pods", "DerivedData", "node_modules", ".scratch"}
IMAGE_EXT = (".png", ".jpg", ".jpeg")


def png_info(path):
    """(width, height, has_alpha) for a PNG, or None if it is not a readable PNG."""
    with open(path, "rb") as f:
        if f.read(8) != PNG_SIG:
            return None
        width = height = color = None
        has_trns = False
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            length, ctype = struct.unpack(">I4s", head)
            if ctype == b"IHDR":
                data = f.read(length)
                width, height = struct.unpack(">II", data[:8])
                color = data[9]
                f.read(4)
                continue
            if ctype == b"tRNS":
                has_trns = True
            if ctype in (b"IDAT", b"IEND"):
                break
            f.seek(length + 4, 1)
    if color is None:
        return None
    return width, height, color in (4, 6) or has_trns


def jpeg_size(path):
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            byte = f.read(1)
            if not byte:
                return None
            if byte != b"\xff":
                continue
            marker = f.read(1)
            while marker == b"\xff":
                marker = f.read(1)
            if not marker:
                return None
            if marker[0] in range(0xC0, 0xD0) and marker[0] not in (0xC4, 0xC8, 0xCC):
                f.read(3)
                height, width = struct.unpack(">HH", f.read(4))
                return width, height
            if marker[0] in (0xD8, 0x01) or marker[0] in range(0xD0, 0xD8):
                continue
            seg = f.read(2)
            if len(seg) < 2:
                return None
            f.seek(struct.unpack(">H", seg)[0] - 2, 1)


def image_size(path):
    try:
        if path.lower().endswith(".png"):
            info = png_info(path)
            return None if info is None else (info[0], info[1])
        return jpeg_size(path)
    except (OSError, struct.error):
        return None


def find_appiconset():
    named, other = [], []
    for root, dirs, _files in os.walk("."):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for d in dirs:
            if d == "AppIcon.appiconset":
                named.append(os.path.join(root, d))
            elif d.endswith(".appiconset"):
                other.append(os.path.join(root, d))
    for group in (named, other):
        if group:
            return sorted(group)[0]
    return None


def check_icon():
    iconset = find_appiconset()
    if iconset is None:
        print("NOTFOUND\tno *.appiconset in the repo (an Xcode 26 .icon bundle is not checked)")
        return 0
    try:
        with open(os.path.join(iconset, "Contents.json")) as f:
            images = json.load(f).get("images", [])
    except (OSError, ValueError) as exc:
        print("NOTFOUND\tcannot read " + iconset + "/Contents.json: " + str(exc))
        return 0
    light = [
        i for i in images
        if i.get("size") == "1024x1024" and not i.get("appearances") and i.get("filename")
    ]
    if not light:
        print("NOTFOUND\tno light 1024x1024 entry in " + iconset + "/Contents.json")
        return 0
    path = os.path.join(iconset, light[0]["filename"])
    if not os.path.isfile(path):
        print("NOTFOUND\t" + path + " is listed in Contents.json but missing")
        return 0
    if not path.lower().endswith(".png"):
        print("NOTFOUND\t" + path + " is not a PNG, alpha not inspected")
        return 0
    try:
        info = png_info(path)
    except OSError as exc:
        print("NOTFOUND\tcannot read " + path + ": " + str(exc))
        return 0
    if info is None:
        print("NOTFOUND\t" + path + " is not a readable PNG")
        return 0
    print(("ALPHA" if info[2] else "OPAQUE") + "\t" + path)
    return 0


def load_sizes(path):
    allowed = set()
    with open(path) as f:
        for line in f:
            m = re.match(r"\s*(\d+)\s*x\s*(\d+)", line)
            if m:
                allowed.add((int(m.group(1)), int(m.group(2))))
    return allowed


def check_screenshots(directory, sizes_file):
    allowed = load_sizes(sizes_file)
    if not allowed:
        print("NOTFOUND\tno sizes in " + sizes_file)
        return 3
    checked = bad = 0
    for root, _dirs, files in os.walk(directory):
        for name in sorted(files):
            if not name.lower().endswith(IMAGE_EXT):
                continue
            path = os.path.join(root, name)
            checked += 1
            size = image_size(path)
            if size is None:
                bad += 1
                print("UNREADABLE\t" + path)
            elif size not in allowed:
                bad += 1
                print("BAD\t%s\t%dx%d" % (path, size[0], size[1]))
    print("SUMMARY\t%d\t%d" % (checked, bad))
    return 0


def main(argv):
    if len(argv) >= 2 and argv[1] == "icon" and len(argv) == 2:
        return check_icon()
    if len(argv) == 4 and argv[1] == "screenshots":
        return check_screenshots(argv[2], argv[3])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

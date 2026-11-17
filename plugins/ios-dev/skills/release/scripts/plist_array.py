#!/usr/bin/env python3
"""Print the items of one array key of a plist, space separated.

Usage: plist_array.py <plist> <key>

Exit 0 with empty output when the key is absent; non-zero when the plist
cannot be read (the caller must treat that as unverified, never as a pass).
"""
import plistlib
import sys


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], "rb") as f:
        data = plistlib.load(f)
    print(" ".join(str(item) for item in data.get(argv[2], [])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

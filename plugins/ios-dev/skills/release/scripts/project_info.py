#!/usr/bin/env python3
"""Read a few facts out of an XcodeGen project.yml with the stdlib only.

Usage: project_info.py <command> <target> [--file project.yml]

Commands:
  entitlements-path  the target's declared entitlements path (exit 1 if none)
  info-path          the target's info.path (exit 1 if none)
  sources            one source path per line (exit 1 if none)
  groups             App Group ids from the target's checked-in .entitlements,
                     one per line. Exit 3 when no entitlements file can be found,
                     4 when it cannot be read. Zero lines with exit 0 means the
                     file exists and declares no group.

No YAML library is assumed (release.sh must run on a bare machine), so this is
a small indentation-based reader. It understands the usual XcodeGen layout, not
arbitrary YAML.
"""
import os
import plistlib
import re
import sys

GROUPS_KEY = "com.apple.security.application-groups"
SKIP_DIRS = {"build", ".git", "Pods", "DerivedData", "node_modules", ".scratch"}


def indent_of(line):
    return len(line) - len(line.lstrip(" "))


def is_blank(line):
    s = line.strip()
    return not s or s.startswith("#")


def children(lines, idx):
    """Lines nested under lines[idx] (deeper indent), up to the next sibling."""
    base = indent_of(lines[idx])
    out = []
    for line in lines[idx + 1:]:
        if is_blank(line):
            out.append(line)
            continue
        if indent_of(line) <= base:
            break
        out.append(line)
    return out


def find_key(lines, name):
    """Index of the shallowest `name:` line in `lines`, or None."""
    real = [ln for ln in lines if not is_blank(ln)]
    if not real:
        return None
    base = min(indent_of(ln) for ln in real)
    pat = re.compile(r"^" + re.escape(name) + r"\s*:")
    for i, line in enumerate(lines):
        if not is_blank(line) and indent_of(line) == base and pat.match(line.strip()):
            return i
    return None


def inline_value(line):
    value = line.strip().split(":", 1)[1]
    value = re.sub(r"\s+#.*$", "", value).strip()
    return unquote(value)


def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def target_block(lines, target):
    t = find_key(lines, "targets")
    if t is None:
        return None
    body = children(lines, t)
    i = find_key(body, target)
    if i is None:
        return None
    return children(body, i)


def nested_path(block, key):
    """`key:` map with a `path:` child, or `key: <path>` inline."""
    k = find_key(block, key)
    if k is None:
        return None
    inline = inline_value(block[k])
    if inline:
        return inline
    sub = children(block, k)
    p = find_key(sub, "path")
    if p is None:
        return None
    return inline_value(sub[p]) or None


def sources_of(block):
    k = find_key(block, "sources")
    if k is None:
        return []
    inline = inline_value(block[k])
    if inline.startswith("["):
        inner = inline.strip("[]")
        return [unquote(x) for x in inner.split(",") if x.strip()]
    if inline:
        return [inline]
    items = [ln for ln in children(block, k) if ln.lstrip().startswith("- ")]
    if not items:
        return []
    base = min(indent_of(ln) for ln in items)
    out = []
    for ln in items:
        if indent_of(ln) != base:
            continue
        item = re.sub(r"\s+#.*$", "", ln.strip()[2:]).strip()
        m = re.match(r"path\s*:\s*(.+)$", item)
        if m:
            out.append(unquote(m.group(1)))
        elif ":" not in item:
            out.append(unquote(item))
    return out


def find_entitlements(target, declared):
    if declared and os.path.isfile(declared):
        return declared
    wanted = target + ".entitlements"
    for root, dirs, files in os.walk("."):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        if wanted in files:
            return os.path.join(root, wanted)
    return None


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    command, target = argv[1], argv[2]
    path = "project.yml"
    rest = argv[3:]
    while rest:
        if rest[0] != "--file":
            print("unknown argument: " + rest[0] + " (accepted: --file <path>)", file=sys.stderr)
            return 2
        if len(rest) < 2:
            print("--file needs a value (accepted: --file <path>)", file=sys.stderr)
            return 2
        path = rest[1]
        rest = rest[2:]
    if command not in ("entitlements-path", "info-path", "sources", "groups"):
        print("unknown command: " + command, file=sys.stderr)
        return 2
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except OSError as exc:
        print("cannot read " + path + ": " + str(exc), file=sys.stderr)
        return 4 if command == "groups" else 1
    block = target_block(lines, target)
    if block is None:
        block = []

    if command == "entitlements-path":
        value = nested_path(block, "entitlements")
        if value:
            print(value)
            return 0
        return 1
    if command == "info-path":
        value = nested_path(block, "info")
        if value:
            print(value)
            return 0
        return 1
    if command == "sources":
        found = sources_of(block)
        for item in found:
            print(item)
        return 0 if found else 1

    ent = find_entitlements(target, nested_path(block, "entitlements"))
    if ent is None:
        return 3
    try:
        with open(ent, "rb") as f:
            data = plistlib.load(f)
    except Exception as exc:  # unreadable or not a plist
        print("cannot read " + ent + ": " + str(exc), file=sys.stderr)
        return 4
    for group in data.get(GROUPS_KEY, []):
        print(group)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

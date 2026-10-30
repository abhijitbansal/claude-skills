"""Bounded, read-only source identity. No source payloads leave this process.

Invoked with python3 -I -B by the hook host, which also enforces an outer timeout.
Two matching scans are an observation, not an atomic snapshot or attestation.
"""

import hashlib
import json
import os
import re
import selectors
import signal
import stat
import subprocess
import sys
import time


VERSION = 1
SCOPE = "git-tracked+untracked-nonignored"
OID = re.compile(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
GIT_ENV = {"PATH": os.defpath, "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0"}


class Unknown(Exception):
    """Only fixed reason codes are ever returned to the caller."""


class Budget:
    def __init__(self, max_files, max_bytes, max_file_bytes, max_git_bytes, timeout_s):
        self.max_files = max_files
        self.bytes_left = max_bytes
        self.max_file_bytes = max_file_bytes
        self.max_git_bytes = max_git_bytes
        self.deadline = time.monotonic() + timeout_s

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise Unknown("deadline")
        return remaining


def git_bytes(root, args, budget, *, allow_empty=False, input_bytes=None):
    """Bound both pipes while reading, not after an unbounded communicate()."""
    argv = ["git", "--no-optional-locks", "-c", "core.hooksPath=/dev/null",
            "-c", "core.fsmonitor=false", *args]
    budget.remaining()
    if input_bytes is not None and len(input_bytes) > budget.max_git_bytes:
        raise Unknown("git_output_limit")
    with subprocess.Popen(argv, cwd=root, env=GIT_ENV,
                          stdin=subprocess.PIPE if input_bytes else subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
        try:
            data = {"stdout": bytearray(), "stderr": bytearray()}
            with selectors.DefaultSelector() as ready:
                ready.register(proc.stdout, selectors.EVENT_READ, "stdout")
                ready.register(proc.stderr, selectors.EVENT_READ, "stderr")
                pending = memoryview(input_bytes or b"")
                if pending:
                    os.set_blocking(proc.stdin.fileno(), False)
                    ready.register(proc.stdin, selectors.EVENT_WRITE, "stdin")
                while ready.get_map():
                    for key, _ in ready.select(budget.remaining()):
                        if key.data == "stdin":
                            sent = os.write(proc.stdin.fileno(), pending[:4096])
                            pending = pending[sent:]
                            if not pending:
                                ready.unregister(proc.stdin)
                                proc.stdin.close()
                            continue
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            ready.unregister(key.fileobj)
                            continue
                        data[key.data].extend(chunk)
                        if sum(map(len, data.values())) > budget.max_git_bytes:
                            raise Unknown("git_output_limit")
            code = proc.wait(timeout=budget.remaining())
            if allow_empty and code == 1 and not any(data.values()):
                return None
            if code != 0 or data["stderr"]:
                raise Unknown("git_unavailable")
            return bytes(data["stdout"])
        finally:
            if proc.poll() is None:
                proc.kill()


def records(raw):
    if raw and not raw.endswith(b"\0"):
        raise Unknown("invalid_listing")
    return raw[:-1].split(b"\0") if raw else []


def inventory(root, budget):
    head = git_bytes(root, ["rev-parse", "--verify", "HEAD"], budget).rstrip(b"\n")
    if OID.fullmatch(head) is None:
        raise Unknown("git_unavailable")
    branch = git_bytes(root, ["symbolic-ref", "--quiet", "HEAD"], budget, allow_empty=True)
    tracked = git_bytes(root, ["ls-files", "-v", "--stage", "-z"], budget)
    untracked = git_bytes(root, ["ls-files", "--others", "--exclude-standard", "-z"], budget)
    entries = {}
    for line in records(tracked):
        header, path = line.split(b"\t", 1)
        tag, mode, oid, stage = header.split(b" ")
        if tag != b"H" or mode not in (b"100644", b"100755") or stage != b"0" or not OID.fullmatch(oid):
            raise Unknown("unsupported_index")
        if path in entries:
            raise Unknown("invalid_listing")
        entries[path] = True
    for path in records(untracked):
        if path in entries:
            raise Unknown("invalid_listing")
        entries[path] = False
    if len(entries) > budget.max_files:
        raise Unknown("file_limit")
    return head, branch, tracked, untracked, entries


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def check_scope(root, root_fd, entries, budget):
    """Git omits special nodes. Check nonignored directories without following links."""
    visited = 0

    def walk(directory, prefix, depth=0):
        nonlocal visited
        if depth > 64 or len(prefix) > 4096:
            raise Unknown("unsupported_path")
        paths = {}
        with os.scandir(directory) as children:
            for child in children:
                budget.remaining()
                name = os.fsencode(child.name)
                if not prefix and name == b".git":
                    continue
                visited += 1
                if visited > budget.max_files:
                    raise Unknown("file_limit")
                paths[prefix + name] = (name, child.stat(follow_symlinks=False))
        if not paths:
            return
        ignored = set(records(git_bytes(root, ["check-ignore", "--stdin", "-z"], budget,
                                        allow_empty=True, input_bytes=b"\0".join(paths) + b"\0") or b""))
        if not ignored.issubset(paths):
            raise Unknown("invalid_listing")
        for path, (name, info) in paths.items():
            if path in ignored:
                continue
            if stat.S_ISDIR(info.st_mode):
                child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                try:
                    walk(child_fd, path + b"/", depth + 1)
                finally:
                    os.close(child_fd)
            elif not stat.S_ISREG(info.st_mode):
                raise Unknown("unsupported_file")
            elif path not in entries:
                raise Unknown("changed_during_capture")

    walk(root_fd, b"")


def read_file(root_fd, path, tracked, budget):
    """Resolve every component relative to an open directory, never a symlink."""
    parts = path.split(b"/")
    if len(path) > 4096 or any(part in (b"", b".", b"..", b".git") for part in parts):
        raise Unknown("unsupported_path")
    directory = os.dup(root_fd)
    file_fd = None
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        # NONBLOCK prevents a replaced file/FIFO from stalling before fstat.
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode):
            raise Unknown("unsupported_file")
        if before.st_size > budget.max_file_bytes or before.st_size > budget.bytes_left:
            raise Unknown("byte_limit")
        digest = hashlib.sha256()
        size = 0
        while True:
            budget.remaining()
            chunk = os.read(file_fd, min(65536, budget.max_file_bytes - size + 1))
            if not chunk:
                break
            size += len(chunk)
            budget.bytes_left -= len(chunk)
            if size > budget.max_file_bytes or budget.bytes_left < 0:
                raise Unknown("byte_limit")
            digest.update(chunk)
        after = os.fstat(file_fd)
        named = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
        if identity(before) != identity(after) or identity(after) != identity(named) or size != before.st_size:
            raise Unknown("changed_during_capture")
        return f"file:{before.st_mode & 0o111}:{size}:{digest.hexdigest()}".encode(), size
    except FileNotFoundError:
        if tracked and file_fd is None:
            return b"deleted", 0
        raise Unknown("changed_during_capture") from None
    finally:
        if file_fd is not None:
            os.close(file_fd)
        os.close(directory)


def scan(root, root_fd, budget):
    head, branch, tracked, untracked, entries = inventory(root, budget)
    check_scope(root, root_fd, entries, budget)
    digest = hashlib.sha256()

    def add(value):
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)

    add(SCOPE.encode())
    add(tracked)
    add(untracked)
    size = 0
    for path, is_tracked in sorted(entries.items()):
        value, length = read_file(root_fd, path, is_tracked, budget)
        add(path)
        add(value)
        size += length
    return {"head": head.decode("ascii"),
            "branch": branch.decode("utf-8").rstrip("\n") if branch is not None else None,
            "digest": digest.hexdigest(), "files": len(entries), "bytes": size}


def capture(root, *, max_files=4096, max_bytes=32 * 1024 * 1024,
            max_file_bytes=4 * 1024 * 1024, max_git_bytes=512 * 1024,
            timeout_s=1.5):
    """Return a complete identity or unknown; never return a partial digest.

The byte budget covers both scans. Only this disposable subprocess installs an
alarm; the hook host must additionally bound process startup and shutdown.
"""
    base = {"version": VERSION, "scope": SCOPE}
    if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
        return {**base, "status": "unknown", "reason": "unsupported_host"}
    if timeout_s <= 0:
        return {**base, "status": "unknown", "reason": "deadline"}
    if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        return {**base, "status": "unknown", "reason": "unsupported_host"}
    previous = signal.getsignal(signal.SIGALRM)

    def deadline(_signal, _frame):
        raise Unknown("deadline")

    root_fd = None
    try:
        signal.signal(signal.SIGALRM, deadline)
        signal.setitimer(signal.ITIMER_REAL, timeout_s)
        budget = Budget(max_files, max_bytes, max_file_bytes, max_git_bytes, timeout_s)
        root = os.path.realpath(root)
        top = git_bytes(root, ["rev-parse", "--show-toplevel"], budget).rstrip(b"\n")
        if os.fsencode(root) != top:
            raise Unknown("not_worktree_root")
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        original = os.fstat(root_fd)
        first = scan(root, root_fd, budget)
        second = scan(root, root_fd, budget)
        current = os.stat(root, follow_symlinks=False)
        if first != second or (original.st_dev, original.st_ino) != (current.st_dev, current.st_ino):
            raise Unknown("changed_during_capture")
        budget.remaining()
        return {**base, "status": "available", "root": root, **second}
    except Unknown as error:
        return {**base, "status": "unknown", "reason": str(error)}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {**base, "status": "unknown", "reason": "unavailable"}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if root_fd is not None:
            os.close(root_fd)


if __name__ == "__main__":
    result = capture(sys.argv[1]) if len(sys.argv) == 2 else {
        "version": VERSION, "scope": SCOPE, "status": "unknown", "reason": "invalid_arguments"}
    print(json.dumps(result, separators=(",", ":")))

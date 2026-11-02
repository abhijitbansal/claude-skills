"""Bounded, read-only source identity. No source payloads leave this process.

Invoked with python3 -I -B by the hook host, which also enforces an outer timeout.
One hashing pass bracketed by two cheap listings is an observation, not an atomic
snapshot or attestation.
"""

import errno
import hashlib
import json
import os
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time


VERSION = 1
SCOPE = "git-tracked+untracked-nonignored"
OID = re.compile(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
REAP_TIMEOUT_S = 2  # a SIGKILLed child exits at once; this only bounds a pathological one
GIT_ENV = {"PATH": os.defpath, "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_OPTIONAL_LOCKS": "0"}


class Unknown(Exception):
    """Only fixed reason codes are ever returned to the caller."""


class Budget:
    def __init__(self, max_files, max_bytes, max_file_bytes, max_git_bytes, timeout_s):
        self.git = None      # absolute path, resolved once per capture
        self.config = []     # extra `-c` arguments, e.g. the global excludes file
        self.env = {**GIT_ENV, **home_env()}  # what every git child gets, unless a call passes its own
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


def home_env():
    """Where git may look for `~` and its default ignore file. Config stays off (see GIT_ENV)."""
    return {key: os.environ[key] for key in ("HOME", "XDG_CONFIG_HOME") if os.environ.get(key)}


def resolve_git():
    """Find git on the caller's PATH, but only run it by absolute path."""
    found = shutil.which("git", path=os.environ.get("PATH") or os.defpath)
    if found is None or not os.path.isabs(found):
        raise Unknown("git_unavailable")
    return found


def usable_excludes(path):
    """Only a regular file (or a link to one) is handed to git: a FIFO or device would stall it."""
    try:
        return stat.S_ISREG(os.stat(path).st_mode)
    except (OSError, ValueError):
        return False


def global_excludes(root, budget):
    """Global config stays disabled; only the user's excludes file is read back from it.

    A repo-local core.excludesFile wins in git itself. It is read with --type=path so `~` and the like
    expand as in git, and handed back as that expanded path. Git re-parses the repo config on every
    call and dies on a `~` it cannot expand, so the children get HOME (budget.env). Because of that, an
    explicit core.excludesFile is always passed (an empty one when there is nothing usable): git never
    falls back to a default ignore file that could be a FIFO. A path that is not a regular file is
    swapped for an empty one, as for the global file.
    """
    local = git_bytes(root, ["config", "--type=path", "--get", "core.excludesFile"], budget, allow_empty=True)
    if local is not None:
        path = os.path.join(root, os.fsdecode(local.rstrip(b"\n")))
        return ["-c", f"core.excludesFile={path}"] if usable_excludes(path) else ["-c", f"core.excludesFile={os.devnull}"]
    env = {key: value for key, value in GIT_ENV.items() if key != "GIT_CONFIG_GLOBAL"}
    env.update(home_env())
    try:
        configured = git_bytes(root, ["config", "--global", "--type=path", "--get", "core.excludesFile"],
                               budget, allow_empty=True, env=env)
    except Unknown as error:
        if str(error) != "git_unavailable":
            raise
        rearm(budget)  # git_bytes reaped its child on the way out, which disarmed the deadline alarm
        configured = None  # unreadable global config: fall back to the default location
    path = os.fsdecode(configured.rstrip(b"\n")) if configured else None
    if path is None or not os.path.isabs(path) or "\0" in path:
        base = os.environ.get("XDG_CONFIG_HOME") or (
            os.path.join(os.environ["HOME"], ".config") if os.environ.get("HOME") else None)
        path = os.path.join(base, "git", "ignore") if base and os.path.isabs(base) else None
    return ["-c", f"core.excludesFile={path if path is not None and usable_excludes(path) else os.devnull}"]


def reap(proc):
    """Kill and collect a child without the one-shot deadline alarm interrupting the cleanup.

    Every caller is about to fail the whole capture, so disarming the alarm costs nothing.
    A late alarm that lands before the disarm raises Unknown once; the retry then runs clean.
    Invariant: this disarms the capture-wide deadline alarm. A caller that swallows the Unknown
    and carries on must call rearm() first, or only the cooperative budget checks keep the deadline.
    """
    while True:
        try:
            signal.setitimer(signal.ITIMER_REAL, 0)
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=REAP_TIMEOUT_S)
            return
        except Unknown:
            continue
        except subprocess.TimeoutExpired:
            return


def rearm(budget):
    """Put back the deadline alarm that reap() took down, for the time the capture has left."""
    signal.setitimer(signal.ITIMER_REAL, budget.remaining())


def git_bytes(root, args, budget, *, allow_empty=False, input_bytes=None, env=None):
    """Bound both pipes while reading, not after an unbounded communicate()."""
    argv = [budget.git, "--no-optional-locks", "-c", "core.hooksPath=/dev/null",
            "-c", "core.fsmonitor=false", *budget.config, *args]
    budget.remaining()
    env = budget.env if env is None else env
    if input_bytes is not None and len(input_bytes) > budget.max_git_bytes:
        raise Unknown("git_output_limit")
    # The deadline alarm is held back until the child is under cleanup's care: an alarm landing after Popen()
    # returns but before the try below would skip the kill, and the `with` exit would then wait on a live child.
    unblocked = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM})
    try:
        # The child must not inherit the held-back alarm; this script is single-threaded, so preexec_fn is safe.
        started = subprocess.Popen(argv, cwd=root, env=env,
                                   stdin=subprocess.PIPE if input_bytes else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, unblocked))
    except BaseException:
        signal.pthread_sigmask(signal.SIG_SETMASK, unblocked)
        raise
    with started as proc:
        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, unblocked)  # a held alarm is delivered here, inside the try
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
        except BaseException:
            reap(proc)  # first thing: it disarms the alarm, so none can land between here and the kill
            raise


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
        if tag != b"H" or mode not in (b"100644", b"100755", b"120000") or stage != b"0" or not OID.fullmatch(oid):
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


def listed_identity(info, directory_fd, name):
    """lstat identity, plus the link text for a symlink: a link is read as text, never followed."""
    if stat.S_ISLNK(info.st_mode):
        return identity(info) + (os.readlink(name, dir_fd=directory_fd),)
    return identity(info)


def open_dir(root_fd, path):
    """Open a directory below root_fd component by component, never through a symlink."""
    directory = os.dup(root_fd)
    try:
        for part in path.split(b"/") if path else []:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
    except BaseException:
        os.close(directory)
        raise
    return directory


def check_scope(root, root_fd, entries, budget):
    """Git omits special nodes, so look for them without following links.

    Returns the lstat identity of every listed file. Directories holding listed
    files are always entered; any other directory costs one ignore query shared
    by its whole tree level, so git runs per level, not per directory.
    """
    holding = {b""}
    for path in entries:
        parent = path.rpartition(b"/")[0]
        while parent and parent not in holding:
            holding.add(parent)
            parent = parent.rpartition(b"/")[0]
    stats = {}
    visited = 0
    level = [b""]
    depth = 0
    while level:
        if depth > 64:
            raise Unknown("unsupported_path")
        descend, candidates = [], {}
        for directory in level:
            if len(directory) > 4096:
                raise Unknown("unsupported_path")
            directory_fd = open_dir(root_fd, directory)
            try:
                with os.scandir(directory_fd) as children:
                    for child in children:
                        budget.remaining()
                        name = os.fsencode(child.name)
                        if name == b".git":
                            if directory:
                                raise Unknown("unsupported_file")  # nested repository
                            continue
                        visited += 1
                        if visited > budget.max_files:
                            raise Unknown("file_limit")
                        path = directory + b"/" + name if directory else name
                        info = child.stat(follow_symlinks=False)
                        if path in entries:
                            if not (stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                                raise Unknown("unsupported_file")
                            stats[path] = listed_identity(info, directory_fd, name)
                        elif path in holding and stat.S_ISDIR(info.st_mode):
                            descend.append(path)
                        elif not stat.S_ISREG(info.st_mode):
                            # A regular file git omits is assumed ignored: one created after the first listing
                            # would be caught by the second listing's comparison, so it is not checked here.
                            candidates[path] = info
            finally:
                os.close(directory_fd)
        if candidates:
            ignored = set(records(git_bytes(root, ["check-ignore", "--stdin", "-z"], budget,
                                            allow_empty=True,
                                            input_bytes=b"\0".join(candidates) + b"\0") or b""))
            if not ignored.issubset(candidates):
                raise Unknown("invalid_listing")
            for path, info in candidates.items():
                if path in ignored:
                    continue
                if not stat.S_ISDIR(info.st_mode):
                    raise Unknown("unsupported_file")
                descend.append(path)
        level = descend
        depth += 1
    return stats


def read_link(directory, name, before, budget):
    """A symlink is its own link text. Its target is never opened, listed or statted."""
    text = os.readlink(name, dir_fd=directory)
    named = os.stat(name, dir_fd=directory, follow_symlinks=False)
    if identity(before) != identity(named) or not stat.S_ISLNK(named.st_mode):
        raise Unknown("changed_during_capture")
    budget.bytes_left -= len(text)
    if len(text) > budget.max_file_bytes or budget.bytes_left < 0:
        raise Unknown("byte_limit")
    value = b"link:" + hashlib.sha256(text).hexdigest().encode()
    return value, len(text), identity(named) + (text,)


def read_file(root_fd, path, tracked, budget):
    """Resolve every component relative to an open directory, never a symlink.

    A symlink in the last position is not opened: it is read as its own link text.
    """
    parts = path.split(b"/")
    if len(path) > 4096 or any(part in (b"", b".", b"..", b".git") for part in parts):
        raise Unknown("unsupported_path")
    directory = None
    file_fd = None
    try:
        directory = open_dir(root_fd, b"/".join(parts[:-1]))
        # NONBLOCK prevents a replaced file/FIFO from stalling before fstat.
        link = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
        if stat.S_ISLNK(link.st_mode):
            return read_link(directory, parts[-1], link, budget)
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
        value = f"file:{before.st_mode & 0o111}:{size}:{digest.hexdigest()}".encode()
        return value, size, identity(named)
    except FileNotFoundError:
        if tracked and file_fd is None:
            return b"deleted", 0, None
        raise Unknown("changed_during_capture") from None
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            raise Unknown("unsupported_file") from None  # a link or non-directory replaced a component
        raise
    finally:
        if file_fd is not None:
            os.close(file_fd)
        if directory is not None:
            os.close(directory)


def observe(root, root_fd, budget):
    """Cheap listing of the in-scope tree: git state plus each file's lstat identity."""
    head, branch, tracked, untracked, entries = inventory(root, budget)
    return (head, branch, tracked, untracked), entries, check_scope(root, root_fd, entries, budget)


def scan(root, root_fd, budget):
    listing, entries, stats = observe(root, root_fd, budget)
    head, branch, tracked, untracked = listing
    digest = hashlib.sha256()

    def add(value):
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)

    add(SCOPE.encode())
    add(tracked)
    add(untracked)
    size = 0
    for path, is_tracked in sorted(entries.items()):
        value, length, seen = read_file(root_fd, path, is_tracked, budget)
        if seen != stats.get(path):
            raise Unknown("changed_during_capture")
        add(path)
        add(value)
        size += length
    summary = {"head": head.decode("ascii"),
               "branch": branch.decode("utf-8").rstrip("\n") if branch is not None else None,
               "digest": digest.hexdigest(), "files": len(entries), "bytes": size}
    return summary, (listing, stats)


def capture(root, *, max_files=4096, max_bytes=128 * 1024 * 1024,
            max_file_bytes=16 * 1024 * 1024, max_git_bytes=512 * 1024,
            timeout_s=3.0):
    """Return a complete identity or unknown; never return a partial digest.

Contents are hashed once; a second listing then rechecks git state, the directory
walk and every file's lstat identity. Only this disposable subprocess installs an
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
        budget.git = resolve_git()
        root = os.path.realpath(root)
        top = git_bytes(root, ["rev-parse", "--show-toplevel"], budget).rstrip(b"\n")
        if os.fsencode(root) != top:
            raise Unknown("not_worktree_root")
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        original = os.fstat(root_fd)
        budget.config = global_excludes(root, budget)
        summary, watched = scan(root, root_fd, budget)
        listing, _, stats = observe(root, root_fd, budget)
        current = os.stat(root, follow_symlinks=False)
        if watched != (listing, stats) or (original.st_dev, original.st_ino) != (current.st_dev, current.st_ino):
            raise Unknown("changed_during_capture")
        budget.remaining()
        return {**base, "status": "available", "root": root, **summary}
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

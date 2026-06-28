#!/usr/bin/env python3
"""Second Wind — Claude Code multi-repo auto-resume orchestrator.

Runs Claude Code sessions for several repos in named tmux sessions, watches
their panes for the (account-level) usage-limit message, parses the reset
time, and resumes every paused session shortly after the limit resets.

Python stdlib only. Requires: tmux, Claude Code CLI.

Commands:
  wind init     write a starter config file
  wind up       start a tmux session per repo and launch Claude Code
  wind prompt   create/edit a repo's first-prompt file in $EDITOR
  wind status   show each session's state and the next reset time
  wind watch    run the watcher loop (detect limit -> wait -> resume all)
  wind resume   send the resume message to sessions now
  wind dash     serve the live localhost web dashboard
  wind down     kill the tmux sessions
"""

import argparse
import datetime
import hmac
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

WIND_HOME = "~/.wind"
WIND_CONFIG = "~/.wind/config.json"
CONFIG_PATHS = [
    "./second-wind.json",
    WIND_CONFIG,
    "~/.config/second-wind/config.json",   # legacy fallback
]
STATE_PATH = "~/.wind/state.json"
LEGACY_STATE_PATH = "~/.local/state/second-wind/state.json"

# Patterns are tried in order against recent pane output. A match marks the
# session as limited; the named group ("epoch" or "time") gives the reset
# moment. The limit message format changes between Claude Code versions, so
# these can be overridden/extended via "limit_patterns" in the config.
DEFAULT_LIMIT_PATTERNS = [
    # Headless / print mode emits: Claude AI usage limit reached|1718000000
    r"Claude AI usage limit reached\|(?P<epoch>\d{9,12})",
    # Interactive UI: "5-hour limit reached ∙ resets 3am" / "resets at 4:30pm"
    r"limit reached.{0,40}?resets?(?:\s+at)?\s+(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm))",
    # "You've hit your usage limit ... wait until your limit resets at 8pm"
    r"usage limit.{0,80}?(?:resets?|try again)(?:\s+at)?\s+(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm))",
]

# Agent presets. The preset's only *behavioral* job beyond launch convenience
# is telling the watcher whether to manage a repo (watch). "claude" reproduces
# today's exact defaults, so a config with no `agent` key behaves byte-for-byte
# as before. Copilot is launch + display only: the watcher skips it, so it
# ships NO rate-limit regexes (limit_patterns is empty).
#
# NOTE: the copilot launch command "copilot" must be verified against a live
# copilot CLI before relying on it; it is overridable via per-repo/top-level
# `claude_cmd` (or the preset) if a GA build renames it.
AGENT_PRESETS = {
    "claude": {
        "cmd": "claude",
        "args": "",
        "resume_message": "continue",
        "watch": True,                      # watcher manages limits + auto-resume
        "limit_patterns": DEFAULT_LIMIT_PATTERNS,
    },
    "copilot": {
        "cmd": "copilot",
        "args": "",
        "resume_message": "Please continue where you left off.",
        "watch": False,                     # launch + display only; never auto-resumed
        "limit_patterns": [],
    },
}

DEFAULT_CONFIG = {
    "session_prefix": "wind",
    "claude_cmd": "claude",
    "claude_args": "",
    "resume_message": "continue",
    "resume_buffer_seconds": 120,
    "poll_interval_seconds": 30,
    "resume_cooldown_seconds": 600,
    "startup_delay_seconds": 8,
    "capture_lines": 120,
    "caffeinate": True,
    "ntfy_url": "",
    "limit_patterns": [],
    "repos": [
        {
            "name": "example-repo",
            "path": "~/code/example-repo",
            "prompt_file": "",
            "claude_args": "",
        }
    ],
}


def log(msg, glyph=None, color="cyan"):
    heartbeat_clear()
    ts = style(datetime.datetime.now().strftime("%H:%M:%S"), "dim")
    prefix = f"{style(glyph, color)} " if glyph else ""
    print(f"[{ts}] {prefix}{msg}", flush=True)


def die(msg, code=1):
    print(f"wind: {msg}", file=sys.stderr)
    sys.exit(code)


def atomic_write_json(path, obj, mode=0o600):
    """Write JSON to a temp file in the same dir, fsync, os.replace.

    os.replace is atomic on POSIX, so a crash mid-write or a concurrent
    reader (watcher/dashboard) never sees a truncated config/state file.
    """
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".wind-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# -------------------------------------------------------------------- ui ----

ANSI_RESET = "\033[0m"
ANSI_CODES = {
    "dim": "\033[2m",
    "bold": "\033[1m",
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "magenta": "\033[35m",
    "cyan": "\033[36m",
}
SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPINNER_TICK_SECONDS = 0.25
VERSION = "2.0.0"


def use_color(stream=None):
    """Color only on a real terminal, honoring NO_COLOR and TERM=dumb."""
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    stream = stream or sys.stdout
    return hasattr(stream, "isatty") and stream.isatty()


def style(text, *names, stream=None):
    if not use_color(stream):
        return text
    prefix = "".join(ANSI_CODES[n] for n in names)
    return f"{prefix}{text}{ANSI_RESET}"


def human_delta(seconds):
    """65 -> '1m', 8040 -> '2h 14m', 266400 -> '3d 2h'."""
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def banner():
    print()
    print(f"  {style('◢◤', 'cyan')} {style('second wind', 'bold')} "
          f"{style('v' + VERSION + ' · usage-limit auto-resume', 'dim')}")
    print()


STATE_GLYPHS = {
    "running": ("●", "green"),
    "waiting-for-reset": ("◌", "yellow"),
    "idle": ("○", "dim"),
    "starting": ("◍", "cyan"),
    "not running": ("✗", "red"),
}

_heartbeat_visible = False


def heartbeat(text):
    """Transient one-line spinner, rewritten in place. TTY only."""
    global _heartbeat_visible
    if not use_color():
        return
    frame = SPINNER_FRAMES[int(time.time() / SPINNER_TICK_SECONDS)
                           % len(SPINNER_FRAMES)]
    print(f"\r\033[2K  {style(frame, 'cyan')} {style(text, 'dim')}",
          end="", flush=True)
    _heartbeat_visible = True


def heartbeat_clear():
    global _heartbeat_visible
    if _heartbeat_visible:
        print("\r\033[2K", end="", flush=True)
        _heartbeat_visible = False


def watch_sleep(seconds, text):
    """Sleep, animating the heartbeat when on a TTY; plain sleep when piped."""
    if not use_color():
        time.sleep(seconds)
        return
    end = time.time() + seconds
    while time.time() < end:
        heartbeat(text)
        time.sleep(SPINNER_TICK_SECONDS)
    heartbeat_clear()


# ----------------------------------------------------------- wizard ui -----

KEY_UP, KEY_DOWN, KEY_ENTER, KEY_SPACE, KEY_QUIT = (
    "up", "down", "enter", "space", "quit")


def _read_key_raw():
    """Read one keypress in raw mode; arrows mapped to KEY_UP/KEY_DOWN."""
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            seq = sys.stdin.read(2)
            if seq == "[A":
                return KEY_UP
            if seq == "[B":
                return KEY_DOWN
            return KEY_QUIT
        if ch in ("\r", "\n"):
            return KEY_ENTER
        if ch == " ":
            return KEY_SPACE
        if ch in ("\x03", "q"):
            return KEY_QUIT
        return ch
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def supports_raw_mode():
    if os.environ.get("TERM") == "dumb":
        return False
    try:
        import termios  # noqa: F401
    except ImportError:
        return False
    return sys.stdin.isatty() and sys.stdout.isatty()


def _render_menu(title, options, idx, selected=None, first=True):
    if not first:
        sys.stdout.write(f"\x1b[{len(options) + 1}A")
    print(f"\x1b[2K{style(title, 'bold')}")
    for i, opt in enumerate(options):
        cursor = style("❯", "cyan") if i == idx else " "
        if selected is not None:
            mark = (style("◉", "green") if i in selected
                    else style("○", "dim"))
            print(f"\x1b[2K  {cursor} {mark} {opt}")
        else:
            print(f"\x1b[2K  {cursor} {opt}")


def menu_select(title, options, get_key=_read_key_raw, render=_render_menu):
    """Arrow-key single-select. Returns index, or None on quit."""
    idx, first = 0, True
    while True:
        render(title, options, idx, selected=None, first=first)
        first = False
        key = get_key()
        if key == KEY_UP:
            idx = (idx - 1) % len(options)
        elif key == KEY_DOWN:
            idx = (idx + 1) % len(options)
        elif key == KEY_ENTER:
            return idx
        elif key == KEY_QUIT:
            return None


def menu_multiselect(title, options, preselected=None,
                     get_key=_read_key_raw, render=_render_menu):
    """Space-toggle multi-select. Returns sorted indices, or None on quit."""
    idx, first = 0, True
    chosen = frozenset(preselected or [])
    while True:
        render(title, options, idx, selected=chosen, first=first)
        first = False
        key = get_key()
        if key == KEY_UP:
            idx = (idx - 1) % len(options)
        elif key == KEY_DOWN:
            idx = (idx + 1) % len(options)
        elif key == KEY_SPACE:
            chosen = chosen ^ {idx}
        elif key == KEY_ENTER:
            return sorted(chosen)
        elif key == KEY_QUIT:
            return None


def parse_multi_numbers(raw, count):
    """'1,3' -> [0, 2]. '' -> []. Invalid -> None. Dedupes, sorts."""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    idxs = set()
    for p in parts:
        if not p.isdigit() or not 1 <= int(p) <= count:
            return None
        idxs.add(int(p) - 1)
    return sorted(idxs)


def menu_select_numbered(title, options, input_fn=input):
    print(style(title, "bold"))
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        raw = input_fn("> ").strip()
        if raw.lower() in ("q", "quit"):
            return None
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return int(raw) - 1
        print("enter a number from the list (q to cancel)")


def menu_multiselect_numbered(title, options, input_fn=input):
    print(style(title, "bold"))
    for i, opt in enumerate(options, 1):
        print(f"  {i}. {opt}")
    while True:
        raw = input_fn("numbers, comma-separated (empty = none, q = cancel)> ")
        if raw.strip().lower() in ("q", "quit"):
            return None
        idxs = parse_multi_numbers(raw, len(options))
        if idxs is not None:
            return idxs
        print("invalid — e.g. 1,3")


def select(title, options):
    if supports_raw_mode():
        return menu_select(title, options)
    return menu_select_numbered(title, options)


def multiselect(title, options, preselected=None):
    if supports_raw_mode():
        return menu_multiselect(title, options, preselected=preselected)
    return menu_multiselect_numbered(title, options)


def prompt_text(label, default="", input_fn=input):
    suffix = f" {style('(' + default + ')', 'dim')}" if default else ""
    raw = input_fn(f"{style('?', 'cyan')} {label}{suffix}: ").strip()
    return raw or default


# --------------------------------------------------------------- wizard ----

PERMISSION_PRESETS = [
    ("acceptEdits — edits files without asking (overnight default)",
     "--permission-mode acceptEdits"),
    ("plan — plans first, asks before acting", "--permission-mode plan"),
    ("default — normal permission prompts", ""),
    ("custom — type your own claude_args", None),
]


def pick_permission_preset(title):
    """Ask for a permission preset; returns claude_args, or None on quit.

    The "custom" choice prompts for a free-form claude_args string. The
    "default" choice resolves to "" (no args).
    """
    pick = select(title, [label for label, _ in PERMISSION_PRESETS])
    if pick is None:
        return None
    claude_args = PERMISSION_PRESETS[pick][1]
    if claude_args is None:
        claude_args = prompt_text("claude_args", default="")
    return claude_args


def resolve_claude_args(repo, cfg):
    """Resolve a repo's claude_args by key-PRESENCE, not truthiness.

    Per-repo `claude_args` (if the key exists) wins over top-level
    `claude_args` (if the key exists), which wins over "" (no args). An
    explicit per-repo `claude_args: ""` is therefore honored as empty,
    distinct from "unset → inherit global". Returns (args, source).
    """
    if "claude_args" in repo:
        return repo["claude_args"], "per-repo"
    if "claude_args" in cfg:
        return cfg["claude_args"], "global"
    return "", "default"


def resolve_agent(repo, cfg):
    """Resolve a repo's agent preset + launch/resume/limit values (C2).

    Returns {"name", "cmd", "args", "resume_message", "watch",
    "limit_patterns"}. Resolution is by key-*presence*, not truthiness, so an
    explicit `claude_args: ""` is honored as "no args" distinctly from "unset".

    Precedence for `cmd`/`args`: per-repo explicit `claude_cmd`/`claude_args`
    (if the key exists) > agent preset > top-level `claude_cmd`/`claude_args`.
    Because DEFAULT_CONFIG always carries top-level `claude_cmd: "claude"` /
    `claude_args: ""`, the preset is checked *before* top-level so a Copilot
    repo's `cmd` comes from its preset (the user does not set top-level
    `claude_cmd: copilot` for a mixed config). For `claude` the preset values
    equal today's defaults, so behavior is unchanged.

    `resume_message`: top-level explicit key (if present) > preset.
    `limit_patterns`: the resolved agent's preset patterns (user `limit_patterns`
    is appended to this resolved set by `limit_patterns()`).
    """
    if "agent" in repo:
        name = repo["agent"]
    elif "agent" in cfg:
        name = cfg["agent"]
    else:
        name = "claude"
    preset = AGENT_PRESETS.get(name)
    if preset is None:
        die(f"unknown agent {name!r}; choose one of: "
            f"{', '.join(sorted(AGENT_PRESETS))}")
    if "claude_cmd" in repo:
        cmd = repo["claude_cmd"]
    elif "cmd" in preset and name != "claude":
        cmd = preset["cmd"]
    elif "claude_cmd" in cfg:
        cmd = cfg["claude_cmd"]
    else:
        cmd = preset["cmd"]
    if "claude_args" in repo:
        args = repo["claude_args"]
    elif name != "claude":
        args = preset["args"]
    elif "claude_args" in cfg:
        args = cfg["claude_args"]
    else:
        args = preset["args"]
    # resume_message: for non-claude agents the preset wins over the
    # always-present top-level `resume_message` so a Copilot session gets its
    # own nudge. For claude, top-level (if present) wins, matching today.
    if name != "claude":
        resume_message = preset["resume_message"]
    elif "resume_message" in cfg:
        resume_message = cfg["resume_message"]
    else:
        resume_message = preset["resume_message"]
    return {
        "name": name,
        "cmd": cmd,
        "args": args,
        "resume_message": resume_message,
        "watch": preset["watch"],
        "limit_patterns": preset["limit_patterns"],
    }


def scan_repos(roots):
    """[(name, path)] for every <root>/<child>/.git, name-sorted per root."""
    found = []
    for root in roots:
        root_full = os.path.expanduser(str(root).strip())
        if not os.path.isdir(root_full):
            continue
        for child in sorted(os.listdir(root_full)):
            path = os.path.join(root_full, child)
            if os.path.isdir(os.path.join(path, ".git")):
                found.append((child, path))
    return found


def build_repo_entry(name, path, claude_args, prompt_file, prompt="",
                     override=False, agent=None):
    """Assemble a repo config entry.

    A per-repo `claude_args` key is written only when this repo explicitly
    overrides the global preset (`override=True`) — including an override to
    the empty "default" preset, which records `claude_args: ""` so key-
    presence resolution honors it as "no args" rather than inheriting global.
    When inheriting (`override=False`), no `claude_args` key is written.

    `agent` is written only when set to a non-default override (e.g. "copilot")
    so a config relying on the top-level default carries no per-repo `agent`.
    """
    entry = {"name": name, "path": path}
    if agent and agent != "claude":
        entry["agent"] = agent
    if prompt:
        entry["prompt"] = prompt
    elif prompt_file:
        entry["prompt_file"] = prompt_file
    if override:
        entry["claude_args"] = claude_args
    return entry


# ----------------------------------------------------------- prompts -------

PROMPTS_SUBDIR = "prompts"


def _seed_lines(repo_name):
    """The exact template lines seeded into a fresh prompt file.

    Single source of truth for both _seed_prompt_file (which writes them) and
    _is_seed_line / cmd_up (which filters them out) so the two can never drift.
    """
    return (
        f"# First prompt for `{repo_name}`, sent verbatim on `wind up`.",
        "# Replace this whole file with the prompt you want to send.",
    )


def _is_seed_line(line, repo_name):
    """Return True if `line` is one of the two template lines seeded by
    _seed_prompt_file, so cmd_up can detect an unedited prompt file."""
    return line.rstrip() in _seed_lines(repo_name)


def _prompt_path(repo_name, cfg=None):
    """Convention path ~/.wind/prompts/<repo>.md for a repo's first prompt.

    The repo name becomes a single filename component; reject anything that
    could traverse or inject (`/`, `..`, other path separators, empty).
    """
    name = (repo_name or "").strip()
    if not name or name in (".", ".."):
        raise ValueError(f"unsafe repo name for a prompt file: {repo_name!r}")
    if "/" in name or os.sep in name or (os.altsep and os.altsep in name):
        raise ValueError(f"unsafe repo name for a prompt file: {repo_name!r}")
    filename = f"{name}.md"
    if os.path.basename(filename) != filename:
        raise ValueError(f"unsafe repo name for a prompt file: {repo_name!r}")
    return os.path.expanduser(
        os.path.join(WIND_HOME, PROMPTS_SUBDIR, filename))


def _first_available(*names):
    """First of `names` that resolves via shutil.which, else names[0]."""
    for name in names:
        if shutil.which(name):
            return name
    return names[0]


def _editor_command(editor_arg, path):
    """Build the editor argv list (NO shell). Validates the binary exists.

    editor_arg (from --editor) wins; else $EDITOR; else vi -> nano fallback.
    $EDITOR is shlex.split so values like "code --wait" / "emacsclient -nw"
    work as a list instead of ENOENT-ing the whole string.
    """
    editor = editor_arg or os.environ.get("EDITOR") or _first_available(
        "vi", "nano")
    try:
        parts = shlex.split(editor)
    except ValueError:
        die("no usable editor (set $EDITOR or pass --editor)")
    if not parts:
        die("no usable editor (set $EDITOR or pass --editor)")
    if not shutil.which(parts[0]):
        die(f"editor not found on PATH: {parts[0]} "
            f"(set $EDITOR or pass --editor)")
    return parts + [path]


def _open_editor(path, editor_arg):
    """Open `path` in the resolved editor; list-exec, never a shell."""
    cmd = _editor_command(editor_arg, path)
    subprocess.run(cmd, check=False)


def _seed_prompt_file(path, repo_name):
    """Create parent dir and seed `path` with a template if it is missing."""
    if os.path.isfile(path):
        return
    os.makedirs(os.path.dirname(path) or ".", mode=0o700, exist_ok=True)
    template = "".join(f"{line}\n" for line in _seed_lines(repo_name))
    with open(path, "w") as f:
        f.write(template)
    os.chmod(path, 0o600)


def build_config(repos, resume_message, ntfy_url, claude_args=""):
    cfg = dict(DEFAULT_CONFIG)
    cfg["repos"] = repos
    cfg["resume_message"] = resume_message or DEFAULT_CONFIG["resume_message"]
    cfg["ntfy_url"] = ntfy_url or ""
    cfg["claude_args"] = claude_args
    return cfg


def load_existing_config(target):
    try:
        with open(target) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def wizard_target_path(args):
    """Where the wizard writes. None = cancelled."""
    if args.config:
        return os.path.expanduser(args.config)
    local = "./second-wind.json"
    if os.path.isfile(local):
        choice = select(
            f"Found {local}",
            ["Reconfigure it (existing values become defaults)",
             f"Leave it — write {WIND_CONFIG} instead",
             "Cancel"])
        if choice == 0:
            return local
        if choice == 1:
            return os.path.expanduser(WIND_CONFIG)
        return None
    return os.path.expanduser(WIND_CONFIG)


def run_wizard(args):
    banner()
    target = wizard_target_path(args)
    if target is None:
        log("wizard cancelled", glyph="○", color="dim")
        return
    existing = load_existing_config(target)

    roots = prompt_text("Directories to scan for git repos (comma-separated)",
                        default="~/projects")
    found = scan_repos(roots.split(","))
    if not found:
        log(f"no git repos found under {roots}", glyph="!", color="yellow")
    existing_paths = {os.path.expanduser(r.get("path", ""))
                      for r in existing.get("repos", [])}
    labels = [f"{name}  {style(path, 'dim')}" for name, path in found]
    preselected = [i for i, (_, path) in enumerate(found)
                   if path in existing_paths]
    picked = []
    if found:
        picked = multiselect(
            "Select repos for wind to manage (space toggles, enter confirms)",
            labels, preselected=preselected)
        if picked is None:
            log("wizard cancelled", glyph="○", color="dim")
            return
    chosen = [found[i] for i in picked]

    extra = prompt_text("Other repo paths (comma-separated, empty to skip)",
                        default="")
    for raw in [p.strip() for p in extra.split(",") if p.strip()]:
        full = os.path.expanduser(raw)
        if os.path.isdir(full):
            chosen.append((os.path.basename(full.rstrip("/")), full))
        else:
            log(f"skipping {raw}: not a directory", glyph="!", color="yellow")

    if not chosen:
        die("no repos selected — nothing to configure")

    print(f"\n{style('Global permission preset', 'bold')} "
          f"{style('(applies to every repo unless overridden)', 'dim')}")
    global_args = pick_permission_preset("Permission preset for all repos")
    if global_args is None:
        log("wizard cancelled", glyph="○", color="dim")
        return

    repos = []
    for name, path in chosen:
        print(f"\n{style(name, 'bold')} {style(path, 'dim')}")
        override_pick = select(
            "Permissions for this repo",
            ["Use the global preset",
             "Set a custom override for this repo"])
        if override_pick is None:
            log("wizard cancelled", glyph="○", color="dim")
            return
        if override_pick == 1:
            claude_args = pick_permission_preset("Override preset for this repo")
            if claude_args is None:
                log("wizard cancelled", glyph="○", color="dim")
                return
            override = True
        else:
            claude_args = ""
            override = False
        agent_pick = select(
            "Agent for this repo",
            ["claude — watched + auto-resumed on the usage limit",
             "copilot — launched + shown, NOT auto-resumed"])
        if agent_pick is None:
            log("wizard cancelled", glyph="○", color="dim")
            return
        agent = "copilot" if agent_pick == 1 else "claude"
        if agent == "copilot":
            log("copilot is launched and shown in the dashboard but NOT "
                "auto-resumed — handle its limits yourself", glyph="○",
                color="dim")
        try:
            convention = _prompt_path(name)
        except ValueError:
            convention = ""
        prompt_file = prompt_text(
            "Prompt file sent on `wind up` (empty to skip)",
            default="")
        repos.append(build_repo_entry(name, path, claude_args, prompt_file,
                                      override=override, agent=agent))
        if prompt_file:
            open_pick = select(
                f"Open {prompt_file} in your editor now?",
                ["Skip — I'll write it later", "Open in editor now"])
            if open_pick == 1:
                _seed_prompt_file(os.path.expanduser(prompt_file), name)
                _open_editor(os.path.expanduser(prompt_file), None)

    resume_message = prompt_text(
        "Resume message typed after the limit resets",
        default=existing.get("resume_message",
                             DEFAULT_CONFIG["resume_message"]))
    ntfy = prompt_text("ntfy.sh topic URL for notifications (empty to skip)",
                       default=existing.get("ntfy_url", ""))
    while ntfy and not valid_notify_url(ntfy):
        log("must start with http:// or https://", glyph="!", color="yellow")
        ntfy = prompt_text("ntfy.sh topic URL (empty to skip)", default="")

    cfg = build_config(repos, resume_message, ntfy, claude_args=global_args)
    atomic_write_json(target, cfg, mode=0o644)

    print()
    log(f"wrote {target}", glyph="✓", color="green")
    log(f"global: {global_args or 'default permissions'}", glyph="✓",
        color="green")
    for r in repos:
        if "claude_args" in r:
            preset = r["claude_args"] or "default permissions"
            log(f"{r['name']}: {preset} (override)", glyph="✓", color="green")
        else:
            log(f"{r['name']}: inherits global", glyph="✓", color="green")
    print(f"\n  Next: {style('wind up', 'bold')} "
          f"(starts your sessions + the watcher) — then "
          f"{style('wind dash', 'bold')} for the live view\n")


# ---------------------------------------------------------------- config ---

def find_config(explicit=None):
    candidates = [explicit] if explicit else CONFIG_PATHS
    for p in candidates:
        full = os.path.expanduser(p)
        if os.path.isfile(full):
            return full
    return None


def load_config(explicit=None):
    path = find_config(explicit)
    if not path:
        die("no config found (looked for %s). Run `wind init` first."
            % ", ".join(CONFIG_PATHS))
    with open(path) as f:
        try:
            user = json.load(f)
        except json.JSONDecodeError as e:
            die(f"invalid JSON in {path}: {e}")
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(user)
    if not cfg["repos"]:
        die(f"{path}: 'repos' is empty")
    for repo in cfg["repos"]:
        if "name" not in repo or "path" not in repo:
            die(f"{path}: every repo needs 'name' and 'path'")
    # Validate agent names at load (the boundary) so a typo fails fast at
    # startup instead of crashing a dashboard request thread via resolve_agent.
    valid_agents = ", ".join(sorted(AGENT_PRESETS))
    if "agent" in cfg and cfg["agent"] not in AGENT_PRESETS:
        die(f"{path}: unknown agent {cfg['agent']!r}; "
            f"choose one of: {valid_agents}")
    for repo in cfg["repos"]:
        if "agent" in repo and repo["agent"] not in AGENT_PRESETS:
            die(f"{path}: repo {repo['name']!r} has unknown agent "
                f"{repo['agent']!r}; choose one of: {valid_agents}")
    # A repo whose derived session name collides with the reserved watcher
    # session ('<prefix>-watcher') would make spawn_watcher mistake the repo
    # for the watcher and `wind down` kill it as one. Reject at load.
    reserved = watcher_session_name(cfg)
    for repo in cfg["repos"]:
        if session_name(cfg, repo) == reserved:
            die(f"{path}: repo {repo['name']!r} collides with the reserved "
                f"watcher session {reserved!r}; rename the repo or change "
                f"'session_prefix'")
    cfg["_path"] = path
    return cfg


def limit_patterns(cfg, agent=None):
    """Compile the limit-detection patterns for a resolved agent.

    The resolved agent's preset patterns form the base set (claude's are the
    former DEFAULT_LIMIT_PATTERNS; copilot ships none). The user's top-level
    `limit_patterns` are appended to that *resolved* set, so they no longer
    unconditionally bolt the Claude defaults onto an unwatched agent. With no
    `agent` argument the claude preset is used, matching today's behavior.
    """
    base = (agent or AGENT_PRESETS["claude"]).get("limit_patterns") or []
    pats = list(cfg.get("limit_patterns") or []) + list(base)
    return [re.compile(p, re.IGNORECASE) for p in pats]


def session_name(cfg, repo):
    return f"{cfg['session_prefix']}-{repo['name']}"


WATCHER_SUFFIX = "watcher"


def watcher_session_name(cfg):
    """Derived name of the detached watcher tmux session, <prefix>-watcher."""
    return f"{cfg['session_prefix']}-{WATCHER_SUFFIX}"


# ----------------------------------------------------------------- state ---

def state_file():
    return os.path.expanduser(STATE_PATH)


def load_state():
    for p in (STATE_PATH, LEGACY_STATE_PATH):
        try:
            with open(os.path.expanduser(p)) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def save_state(state):
    path = state_file()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    atomic_write_json(path, state, mode=0o600)


def clear_state():
    for p in (STATE_PATH, LEGACY_STATE_PATH):
        try:
            os.remove(os.path.expanduser(p))
        except OSError:
            pass


# ------------------------------------------------------------------ tmux ---

def tmux(*args, check=True, capture=True):
    result = subprocess.run(
        ["tmux", *args],
        capture_output=capture,
        text=True,
    )
    if check and result.returncode != 0:
        err = (result.stderr or "").strip() if capture else ""
        die(f"tmux {' '.join(args)} failed: {err}")
    return result


def session_exists(name):
    return tmux("has-session", "-t", f"={name}", check=False).returncode == 0


def capture_pane(name, lines, escapes=False):
    # "=name:" — exact-match session, default window/pane. Bare "=name" is
    # rejected as a pane target by tmux 3.6 ("can't find pane").
    # escapes=True adds tmux's -e flag so SGR color escapes are preserved in
    # the output (only get_pane_extended wants this; limit-detection callers
    # keep escapes=False so their regexes match plain text).
    args = ["capture-pane"]
    if escapes:
        args.append("-e")
    args += ["-p", "-t", f"={name}:", "-S", f"-{lines}"]
    result = tmux(*args, check=False)
    return result.stdout if result.returncode == 0 else ""


def send_text(name, text):
    """Type text into a pane (bracketed paste, safe for multi-line), then Enter."""
    proc = subprocess.run(
        ["tmux", "load-buffer", "-b", "wind", "-"],
        input=text, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        die(f"tmux load-buffer failed: {proc.stderr.strip()}")
    tmux("paste-buffer", "-p", "-d", "-b", "wind", "-t", f"={name}:")
    time.sleep(0.3)
    tmux("send-keys", "-t", f"={name}:", "Enter")


def list_session_names():
    """All tmux session names, or [] if there is no server / none exist."""
    result = tmux("list-sessions", "-F", "#{session_name}", check=False)
    if result.returncode != 0:
        return []
    return [ln for ln in (result.stdout or "").splitlines() if ln]


# ----------------------------------------------------------- watcher -------

def _as_tmux_command(cmd):
    """Quote an argv list into the single shell-command tmux runs detached."""
    return (shlex.join(cmd),)


def build_watcher_command(cfg, poll=None):
    """argv that re-runs this wind with an ABSOLUTE config path + `watch`.

    cfg["_path"] is frequently the literal relative "./second-wind.json"
    (find_config returns it first and expanduser does not absolutize it). A
    detached tmux session does NOT inherit the parent cwd, so we resolve the
    config path against the *current* process cwd here, before spawning.

    When `poll` is set, thread it through as `--poll N` so a detached watcher
    honors `watch --poll N` rather than silently falling back to config.
    """
    cfg_path = os.path.abspath(cfg["_path"])
    cmd = [sys.executable, os.path.abspath(__file__), "-c", cfg_path, "watch"]
    if poll is not None:
        cmd += ["--poll", str(poll)]
    return cmd


def find_foreign_watcher(cfg):
    """A *-watcher session whose name isn't ours, or None.

    Exclude this config's own repo sessions: a normal repo whose name ends in
    '-watcher' (e.g. 'ci-watcher' → 'wind-ci-watcher') is not a foreign watcher.
    """
    own = {session_name(cfg, r) for r in cfg["repos"]}
    own.add(watcher_session_name(cfg))
    for name in list_session_names():
        if name.endswith(f"-{WATCHER_SUFFIX}") and name not in own:
            return name
    return None


def spawn_watcher(cfg, poll=None):
    """Start the detached watcher tmux session if not already running."""
    name = watcher_session_name(cfg)
    if session_exists(name):
        log(f"{name}: watcher already running, skipping", glyph="○",
            color="dim")
        return False
    foreign = find_foreign_watcher(cfg)
    if foreign:
        log(f"another watcher session is running: {foreign} — "
            f"single watcher per machine; leaving it alone",
            glyph="!", color="yellow")
    cmd = build_watcher_command(cfg, poll=poll)
    tmux("new-session", "-d", "-s", name, *_as_tmux_command(cmd))
    log(f"{name}: watcher started (auto-resume active)", glyph="→",
        color="cyan")
    return True


# ------------------------------------------------------- limit detection ---

def parse_clock_time(text, now=None):
    """'3am' / '4:30 PM' -> next occurrence as a local datetime."""
    now = now or datetime.datetime.now()
    m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)", text.strip(),
                 re.IGNORECASE)
    if not m:
        return None
    hour = int(m.group(1)) % 12
    if m.group(3).lower() == "pm":
        hour += 12
    minute = int(m.group(2) or 0)
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += datetime.timedelta(days=1)
    return candidate


def detect_limit(text, patterns, now=None):
    """Return the reset datetime if `text` contains a usage-limit message."""
    for pat in patterns:
        m = pat.search(text)
        if not m:
            continue
        groups = m.groupdict()
        if groups.get("epoch"):
            try:
                return datetime.datetime.fromtimestamp(int(groups["epoch"]))
            except (ValueError, OverflowError, OSError):
                pass  # absurd timestamp in pane output; use the fallback
        if groups.get("time"):
            parsed = parse_clock_time(groups["time"], now=now)
            if parsed:
                return parsed
        # Pattern matched but carried no usable timestamp: fall back to a
        # conservative wait so we still resume eventually.
        now = now or datetime.datetime.now()
        return now + datetime.timedelta(hours=1)
    return None


def classify(text, patterns):
    if detect_limit(text, patterns):
        return "waiting-for-reset"
    tail = text.rstrip()[-2000:]
    if re.search(r"esc to interrupt", tail, re.IGNORECASE):
        return "running"
    if tail:
        return "idle"
    return "starting"


# -------------------------------------------------------------- notify -----

def valid_notify_url(url):
    return url.startswith(("http://", "https://"))


def notify(cfg, message):
    url = cfg.get("ntfy_url")
    if not url:
        return
    if not valid_notify_url(url):
        log("notify skipped: ntfy_url must start with http:// or https://")
        return
    try:
        req = urllib.request.Request(
            url, data=message.encode(),
            headers={"Title": "Second Wind"}, method="POST")
        urllib.request.urlopen(req, timeout=10)
    except OSError as e:
        log(f"notify failed: {e}")


# ------------------------------------------------------------------ dash ---

PANE_TAIL_LINES = 30      # lines of tail shown on each card (tokenless /api/status)
MODAL_LINES = 500         # default scrollback the modal fetches from /api/pane
MAX_PANE_LINES = 1000     # hard clamp for /api/pane requests

# SGR codes we let through to the client (the client re-validates). Basic
# attrs reset/bold/dim, the 16 fg/bg colors, and the 16 bright fg/bg colors.
_SGR_SIMPLE_ALLOWED = (
    {0, 1, 2}
    | set(range(30, 38)) | set(range(40, 48))
    | set(range(90, 98)) | set(range(100, 108))
)

# Match one escape sequence: OSC / DCS-APC-PM string terminators, a CSI
# (7-bit ESC[ or 8-bit 0x9b), or an 8-bit OSC (0x9d). SGR vs other CSI is
# decided after parsing, so we capture the CSI params + final byte.
_ESC_SEQ_RE = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"         # 7-bit OSC ... BEL|ST
    r"|\x9d[^\x07\x1b]*(?:\x07|\x1b\\)"          # 8-bit OSC ... BEL|ST
    r"|\x1b[P_^][^\x1b]*(?:\x1b\\)?"             # DCS|APC|PM ... ST
    r"|\x9b[0-9;?]*[A-Za-z]"                     # 8-bit CSI (always dropped)
    r"|\x1b\[([0-9;?]*)([A-Za-z])"              # 7-bit CSI params + final byte
)


def _keep_sgr(params):
    """Return the SGR sequence for `params` if every code is allowlisted.

    Truecolor (38;2/48;2), out-of-palette 256-color, and any non-allowlisted
    code make the whole sequence unsafe → dropped (return ""). An empty param
    list ("\\x1b[m") is treated as a reset and kept.
    """
    if params == "":
        return "\x1b[m"
    parts = params.split(";")
    i = 0
    while i < len(parts):
        part = parts[i]
        if not part.isdigit():
            return ""
        code = int(part)
        if code in (38, 48):
            # Extended color: 38;5;N (256) or 38;2;R;G;B (truecolor).
            if i + 1 >= len(parts) or not parts[i + 1].isdigit():
                return ""
            mode = int(parts[i + 1])
            if mode == 5:
                if i + 2 >= len(parts) or not parts[i + 2].isdigit():
                    return ""
                idx = int(parts[i + 2])
                if not (0 <= idx <= 255):
                    return ""
                i += 3
                continue
            # mode 2 (truecolor) or anything else → drop the whole sequence.
            return ""
        if code not in _SGR_SIMPLE_ALLOWED:
            return ""
        i += 1
    return f"\x1b[{params}m"


def _strip_escapes(text, preserve_sgr=False):
    """Remove terminal escape sequences from captured pane text.

    With preserve_sgr=False (card tail) every escape is removed. With
    preserve_sgr=True (/api/pane) allowlisted SGR color/style sequences are
    kept and everything else (OSC/DCS/APC/PM, cursor CSI, truecolor and
    out-of-palette 256-color, 8-bit C1 forms) is removed.
    """
    def repl(m):
        if not preserve_sgr:
            return ""
        final = m.group(2)
        if final == "m":                 # an SGR sequence
            return _keep_sgr(m.group(1) or "")
        return ""                        # OSC/DCS/non-SGR CSI → drop

    return _ESC_SEQ_RE.sub(repl, text)


def strip_ansi(text):
    return _strip_escapes(text, preserve_sgr=False)


def get_pane_extended(cfg, name, lines):
    """Capture `lines` of scrollback for `name`, keeping allowlisted SGR."""
    text = capture_pane(name, lines, escapes=True)
    return _strip_escapes(text, preserve_sgr=True)


def valid_session(cfg, name):
    return name in {session_name(cfg, r) for r in cfg["repos"]}


def status_payload(cfg):
    state = load_state()
    now = time.time()
    sessions = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if not session_exists(name):
            sessions.append({"name": name, "state": "not running",
                             "reset_at": None, "reset_human": "",
                             "pane_tail": ""})
            continue
        # Skip limit detection for unwatched agents (C3): empty patterns mean a
        # Copilot pane never false-matches a Claude limit regex, so it shows
        # running/idle/starting but never a reset countdown.
        agent = resolve_agent(repo, cfg)
        patterns = limit_patterns(cfg, agent) if agent["watch"] else []
        text = capture_pane(name, cfg["capture_lines"])
        st = classify(text, patterns)
        reset = detect_limit(text, patterns)
        tail = "\n".join(
            strip_ansi(text).rstrip().splitlines()[-PANE_TAIL_LINES:])
        sessions.append({
            "name": name,
            "state": st,
            "reset_at": reset.timestamp() if reset else None,
            "reset_human": (f"{reset:%a %H:%M} · in "
                            f"{human_delta(reset.timestamp() - now)}"
                            if reset else ""),
            "pane_tail": tail,
        })
    watcher = {}
    if state.get("reset_at"):
        try:
            reset_at = float(state["reset_at"])
            watcher = {"reset_at": reset_at,
                       "resume_at": reset_at + cfg["resume_buffer_seconds"]}
        except (TypeError, ValueError):
            watcher = {}
    return {"watcher": watcher, "sessions": sessions}


def make_dash_handler(cfg, token, template):
    import http.server

    class DashHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # keep the wind terminal clean

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _host_allowed(self):
            """Reject DNS-rebinding: Host must be a localhost name."""
            host = self.headers.get("Host") or ""
            if host.startswith("["):                 # [::1]:8787 or [::1]
                host = host.split("]", 1)[0] + "]"
            elif ":" in host:
                host = host.rsplit(":", 1)[0]
            return host in ("127.0.0.1", "localhost", "[::1]")

        def do_GET(self):
            if not self._host_allowed():
                self._send(403, '{"error": "bad host"}')
                return
            from urllib.parse import urlsplit, parse_qs
            parts = urlsplit(self.path)
            if parts.path == "/":
                self._send(200, template.replace("{{TOKEN}}", token),
                           "text/html; charset=utf-8")
            elif parts.path == "/api/status":
                self._send(200, json.dumps(status_payload(cfg)))
            elif parts.path == "/api/pane":
                self._serve_pane(parse_qs(parts.query))
            else:
                self._send(404, '{"error": "not found"}')

        def _serve_pane(self, query):
            # /api/pane returns up to MAX_PANE_LINES of scrollback (can hold
            # secrets) so, unlike /api/status, it requires the CSRF token.
            supplied = self.headers.get("X-Wind-Token") or ""
            if not hmac.compare_digest(supplied, token):
                self._send(401, '{"error": "bad token"}')
                return
            name = (query.get("session") or [""])[0]
            if not valid_session(cfg, name):
                self._send(400, '{"error": "bad session"}')
                return
            try:
                lines = int((query.get("lines") or [MODAL_LINES])[0])
            except (ValueError, TypeError):
                lines = MODAL_LINES
            lines = max(1, min(lines, MAX_PANE_LINES))
            content = get_pane_extended(cfg, name, lines)
            self._send(200, json.dumps({
                "ok": True,
                "session": name,
                "content": content,
                "lines_returned": len(content.splitlines()),
            }))

        def do_POST(self):
            if not self._host_allowed():
                self._send(403, '{"error": "bad host"}')
                return
            supplied = self.headers.get("X-Wind-Token") or ""
            if not hmac.compare_digest(supplied, token):
                self._send(401, '{"error": "bad token"}')
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > 65536:
                self._send(400, '{"error": "bad content-length"}')
                return
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self._send(400, '{"error": "bad json"}')
                return
            if self.path == "/api/resume":
                name = body.get("session")
                if name is not None:
                    if not valid_session(cfg, name):
                        self._send(400, '{"error": "bad session"}')
                        return
                    repos = [r for r in cfg["repos"]
                             if session_name(cfg, r) == name]
                    sent = resume_sessions(cfg, repos)
                else:
                    sent = resume_sessions(cfg, cfg["repos"])
                    clear_state()
                self._send(200, json.dumps({"resumed": len(sent)}))
            elif self.path == "/api/send":
                name = body.get("session")
                text = (body.get("text") or "").strip()
                if not valid_session(cfg, name) or not text:
                    self._send(400, '{"error": "bad session or empty text"}')
                    return
                send_text(name, text)
                self._send(200, '{"ok": true}')
            elif self.path == "/api/kill":
                name = body.get("session")
                if not valid_session(cfg, name):
                    self._send(400, '{"error": "bad session"}')
                    return
                tmux("kill-session", "-t", f"={name}")
                self._send(200, '{"ok": true}')
            else:
                self._send(404, '{"error": "not found"}')

    return DashHandler


def find_dashboard_template():
    candidates = [
        os.path.expanduser(os.path.join(WIND_HOME, "dashboard.html")),
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "dashboard.html"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


GUIDE_TEXT = """\
Second Wind — set-and-forget Claude Code across repos.

  1. wind init            Pick repos, a permission preset, and an agent.
                          Writes your config (or --defaults for a starter file).
  2. wind prompt <repo>   Optional: author each repo's first prompt in $EDITOR.
  3. wind up              Launch a tmux session per repo, send the first prompt,
                          and auto-spawn the watcher (it resumes you after the
                          5-hour limit resets — overnight, untouched).
  4. wind dash            Live localhost dashboard. Click a card to expand it;
                          hit the attach button to copy `tmux attach -t <session>`
                          and drop into the real terminal with full TUI autocomplete.

Check in anytime:  wind status · wind resume · wind down
Full visual guide:  docs/second-wind/index.html
"""


def find_guide_html():
    """Locate the Second Wind visual guide for `wind guide --open`."""
    candidates = [
        os.path.expanduser(os.path.join(WIND_HOME, "guide.html")),
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "..", "docs", "second-wind", "index.html"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def cmd_guide(args):
    print(GUIDE_TEXT, end="")
    if getattr(args, "open", False):
        path = find_guide_html()
        if path:
            import webbrowser
            webbrowser.open("file://" + os.path.abspath(path))
        else:
            print("Visual guide not bundled locally — see "
                  "https://abhijitbansal.github.io/claude-skills/second-wind/")
    return 0


def cmd_dash(cfg, args):
    import http.server
    import secrets
    import webbrowser

    template_path = find_dashboard_template()
    if not template_path:
        die("dashboard.html not found (looked in ~/.wind and next to "
            "wind.py) — re-run install.sh")
    with open(template_path) as f:
        template = f.read()
    token = secrets.token_hex(16)
    handler = make_dash_handler(cfg, token, template)
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port),
                                                 handler)
    except OSError as e:
        die(f"cannot bind 127.0.0.1:{args.port}: {e}")
    banner()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    log(f"dashboard at {url}", glyph="→", color="cyan")
    log("Ctrl-C to stop", glyph="○", color="dim")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("dashboard stopped")
    finally:
        server.server_close()


# ------------------------------------------------------------- commands ----

def write_starter_config(args):
    path = os.path.expanduser(args.config or CONFIG_PATHS[0])
    if os.path.exists(path) and not args.force:
        die(f"{path} already exists (use --force to overwrite)")
    sample = {k: v for k, v in DEFAULT_CONFIG.items()}
    atomic_write_json(path, sample, mode=0o644)
    print(f"Wrote starter config to {path} — edit 'repos' and run `wind up`.")


def cmd_init(args):
    if getattr(args, "defaults", False) or not (
            sys.stdin.isatty() and sys.stdout.isatty()):
        return write_starter_config(args)
    try:
        return run_wizard(args)
    except KeyboardInterrupt:
        print()
        log("wizard cancelled", glyph="○", color="dim")


def cmd_up(cfg, args):
    banner()
    started = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        path = os.path.expanduser(repo["path"])
        if session_exists(name):
            log(f"{name}: already running, skipping", glyph="○", color="dim")
            continue
        if not os.path.isdir(path):
            die(f"{name}: repo path does not exist: {path}")
        # Resolve cmd/args from the repo's agent preset (C2). Explicit per-repo
        # `claude_cmd`/`claude_args` still override; an explicit "" is honored
        # as empty (key-presence), not treated as unset → inherit.
        agent = resolve_agent(repo, cfg)
        _, args_source = resolve_claude_args(repo, cfg)
        command = agent["cmd"] + (f" {agent['args']}" if agent["args"] else "")
        tmux("new-session", "-d", "-s", name, "-c", path)
        tmux("send-keys", "-t", f"={name}:", command, "Enter")
        log(f"{name}: launched `{command}` in {path} "
            f"(agent {agent['name']}, {args_source} args)",
            glyph="→", color="cyan")
        started.append((repo, name))

    prompts = [(r, n) for r, n in started
               if r.get("prompt") or r.get("prompt_file")]
    if prompts:
        delay = cfg["startup_delay_seconds"]
        log(f"waiting {delay}s for Claude Code to start before sending prompts")
        time.sleep(delay)
        for repo, name in prompts:
            # Inline `prompt` wins over `prompt_file`.
            if repo.get("prompt"):
                prompt = repo["prompt"].strip()
                source = "inline prompt"
            else:
                pf = os.path.expanduser(repo["prompt_file"])
                if not os.path.isfile(pf):
                    pf_rel = os.path.join(os.path.expanduser(repo["path"]),
                                          repo["prompt_file"])
                    if os.path.isfile(pf_rel):
                        pf = pf_rel
                    else:
                        log(f"{name}: prompt file not found: "
                            f"{repo['prompt_file']}",
                            glyph="!", color="yellow")
                        continue
                with open(pf) as f:
                    raw_lines = f.readlines()
                repo_name = repo.get("name", name)
                filtered = [ln for ln in raw_lines
                            if not _is_seed_line(ln, repo_name)]
                prompt = "".join(filtered).strip()
                if not prompt:
                    log(f"{name}: prompt file appears to be the unedited seed "
                        f"template — skipping send",
                        glyph="!", color="yellow")
                    continue
                source = f"prompt_file {pf}"
            if prompt:
                send_text(name, prompt)
                log(f"{name}: sent initial prompt from {source} "
                    f"({len(prompt)} chars)", glyph="✓", color="green")
    if getattr(args, "no_watch", False):
        log("watcher not started (--no-watch); run `wind watch` to enable "
            "auto-resume", glyph="○", color="dim")
    else:
        spawn_watcher(cfg)

    if started:
        log(f"{len(started)} session(s) up. Attach: tmux attach -t "
            f"{started[0][1]}  |  live view: wind dash",
            glyph="✓", color="green")
    else:
        log("nothing to start", glyph="○", color="dim")


def _find_repo(cfg, name):
    for repo in cfg["repos"]:
        if repo.get("name") == name:
            return repo
    return None


def cmd_prompt(cfg, args):
    """Open (creating if needed) a repo's first-prompt file in $EDITOR.

    If the repo has neither an inline `prompt` nor a `prompt_file`, derive the
    convention path ~/.wind/prompts/<repo>.md, seed it with a template, open
    it, and on a clean close wire `prompt_file` into the config (atomically).

    If the repo carries an inline `prompt`, open the convention path so the
    user can write a file, then on a clean close wire `prompt_file` AND remove
    the inline `prompt` key — so cmd_up uses the file on the next run (A3).

    Relative `prompt_file` values are resolved against the repo's path to
    match the runtime resolution in cmd_up (A4).
    """
    repo = _find_repo(cfg, args.repo)
    if repo is None:
        names = ", ".join(r.get("name", "?") for r in cfg["repos"]) or "(none)"
        die(f"no repo named {args.repo!r} in config; known repos: {names}")

    has_inline = bool(repo.get("prompt"))
    existing_file = repo.get("prompt_file")

    if existing_file:
        # A4: resolve relative prompt_file paths against the repo path, not
        # cwd, so the path we open matches what cmd_up resolves at runtime.
        repo_path = os.path.expanduser(repo["path"])
        if not os.path.isabs(existing_file) and not existing_file.startswith("~"):
            path = os.path.join(repo_path, existing_file)
        else:
            path = os.path.expanduser(existing_file)
    else:
        # No existing file: derive convention path (covers both fresh repos
        # and inline-prompt repos that the user wants to migrate to a file).
        path = _prompt_path(repo["name"], cfg)

    _seed_prompt_file(path, repo["name"])
    _open_editor(path, args.editor)

    if not existing_file:
        # Re-read the RAW config (not the DEFAULT_CONFIG-merged cfg) so we only
        # add prompt_file and never persist default keys (e.g. claude_args:"")
        # into a previously-minimal config — that would flip presence-based
        # resolution (resolve_agent/resolve_claude_args treat absent vs "").
        with open(cfg["_path"]) as f:
            raw = json.load(f)
        matched = False
        for r in raw.get("repos", []):
            if r.get("name") == repo["name"]:
                r["prompt_file"] = path
                # A3: remove the inline prompt so cmd_up uses the file.
                r.pop("prompt", None)
                matched = True
        if matched:
            atomic_write_json(cfg["_path"], raw, mode=0o644)
            log(f"{repo['name']}: wired prompt_file -> {path}", glyph="✓",
                color="green")
        else:
            # The merged cfg carried this repo from DEFAULT_CONFIG (or the name
            # has no raw counterpart): the file was seeded/opened, but there is
            # nothing on disk to wire. Don't rewrite the config or claim success.
            log(f"{repo['name']} not found in {cfg['_path']}; prompt_file not "
                f"persisted — add the repo to your config", glyph="!",
                color="yellow")
    else:
        log(f"{repo['name']}: edited {path}", glyph="✓", color="green")


def cmd_status(cfg, args):
    state = load_state()
    now = time.time()
    rows = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if not session_exists(name):
            rows.append((name, "not running", ""))
            continue
        # Skip limit detection for unwatched agents (C3); see status_payload.
        agent = resolve_agent(repo, cfg)
        patterns = limit_patterns(cfg, agent) if agent["watch"] else []
        text = capture_pane(name, cfg["capture_lines"])
        st = classify(text, patterns)
        reset = detect_limit(text, patterns)
        when = ""
        if reset:
            when = (f"{reset:%a %H:%M} · in "
                    f"{human_delta(reset.timestamp() - now)}")
        rows.append((name, st, when))

    width = max(len(r[0]) for r in rows) + 2
    print(style(f"{'SESSION':<{width}}{'STATE':<22}{'RESETS'}", "bold"))
    print(style("─" * (width + 36), "dim"))
    for name, st, when in rows:
        glyph, color = STATE_GLYPHS.get(st, ("·", "dim"))
        cell = f"{glyph} {st}"
        pad = " " * max(1, 22 - len(cell))
        print(f"{name:<{width}}{style(cell, color)}{pad}{when}")
    if state.get("reset_at"):
        try:
            resume_ts = float(state["reset_at"]) + cfg["resume_buffer_seconds"]
            resume_at = datetime.datetime.fromtimestamp(resume_ts)
        except (TypeError, ValueError, OverflowError, OSError):
            print(f"\n{style('!', 'yellow')} watcher state file is corrupt "
                  f"({state_file()}) — delete it or run `wind resume`")
        else:
            print(f"\n{style('◌', 'yellow')} watcher: limit detected, resuming "
                  f"all at {resume_at:%a %H:%M:%S} · in "
                  f"{human_delta(resume_ts - now)}")


def resume_sessions(cfg, repos):
    """Send each repo its resolved agent's resume_message (C2).

    Takes repo dicts (not bare session names) so a Copilot repo gets its own
    nudge ("Please continue where you left off.") and a Claude repo gets
    "continue". Returns the list of session names actually resumed.
    """
    sent = []
    for repo in repos:
        name = session_name(cfg, repo)
        if not session_exists(name):
            continue
        agent = resolve_agent(repo, cfg)
        send_text(name, agent["resume_message"])
        sent.append(name)
        log(f"{name}: sent resume message", glyph="✓", color="green")
    return sent


def resume_orphans(cfg, names):
    """Nudge paused session names that are no longer watched repos (C5/C7).

    These have no resolved repo (agent switched to an unwatched preset or the
    repo was removed), so fall back to the global `resume_message` rather than
    dropping them from resume and leaving them paused forever.
    """
    sent = []
    for name in names:
        if not session_exists(name):
            continue
        send_text(name, cfg["resume_message"])
        sent.append(name)
        log(f"{name}: sent resume message (global default)", glyph="✓",
            color="green")
    return sent


def cmd_resume(cfg, args):
    sent = resume_sessions(cfg, cfg["repos"])
    clear_state()
    log(f"resumed {len(sent)} session(s)")


def cmd_down(cfg, args):
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if session_exists(name):
            tmux("kill-session", "-t", f"={name}")
            log(f"{name}: killed", glyph="✗", color="red")
    # Reap the watcher: the recorded identity (which survives a prefix change
    # between runs) plus the currently-derived name, deduped.
    recorded = load_state().get("watcher_session")
    for name in dict.fromkeys([recorded, watcher_session_name(cfg)]):
        if name and session_exists(name):
            tmux("kill-session", "-t", f"={name}")
            log(f"{name}: watcher killed", glyph="✗", color="red")
    clear_state()


def start_caffeinate():
    if sys.platform != "darwin":
        return None
    try:
        return subprocess.Popen(
            ["caffeinate", "-dims", "-w", str(os.getpid())])
    except OSError as e:
        log(f"caffeinate unavailable: {e}")
        return None


def cmd_watch(cfg, args):
    # --detach re-execs this watcher into a detached tmux session and returns.
    # NOT os.fork(): caffeinate -w <pid> would otherwise target the pre-fork
    # parent pid and exit immediately, killing keep-awake. Re-exec-into-tmux
    # means caffeinate starts inside the surviving process.
    if getattr(args, "detach", False):
        spawn_watcher(cfg, poll=args.poll)
        return

    banner()
    poll = args.poll or cfg["poll_interval_seconds"]
    buffer_s = cfg["resume_buffer_seconds"]
    # Only repos whose resolved agent has watch==True are scanned/auto-resumed
    # (C3). Copilot (watch==False) is never matched against limit patterns and
    # never auto-resumed. Patterns are compiled per repo from its resolved
    # agent's set, not a global append.
    watched = []
    for repo in cfg["repos"]:
        agent = resolve_agent(repo, cfg)
        if agent["watch"]:
            watched.append((repo, limit_patterns(cfg, agent)))
    keeper = start_caffeinate() if cfg["caffeinate"] else None
    if keeper:
        log("caffeinate active (Mac will stay awake while watching)")
    log(f"watching {len(watched)} session(s), poll every {poll}s, "
        f"resume buffer {buffer_s}s")

    # Record this watcher's identity so `wind down` can reap the actually
    # running watcher even if the derived name later differs (prefix change).
    identity = {"watcher_session": watcher_session_name(cfg),
                "watcher_config": os.path.abspath(cfg["_path"])}

    state = load_state()
    try:
        if state.get("reset_at") is not None:
            state["reset_at"] = float(state["reset_at"])
    except (TypeError, ValueError):
        log("ignoring corrupt watcher state file", glyph="!", color="yellow")
        state = {}
        clear_state()
    state.update(identity)
    save_state(state)
    # After resuming, the old limit message lingers in the pane scrollback;
    # skip re-detection on a session until the cooldown passes.
    cooldown_until = {}
    try:
        while True:
            paused = set(state.get("paused", []))
            reset_at = state.get("reset_at")

            for repo, patterns in watched:
                name = session_name(cfg, repo)
                if not session_exists(name) or name in paused:
                    continue
                if time.time() < cooldown_until.get(name, 0):
                    continue
                text = capture_pane(name, cfg["capture_lines"])
                reset = detect_limit(text, patterns)
                if not reset:
                    continue
                if reset.timestamp() < time.time() - 120:
                    continue  # stale message from a previous limit
                paused.add(name)
                ts = reset.timestamp()
                # One account-level clock: keep the latest reset time seen.
                if not reset_at or ts > reset_at:
                    reset_at = ts
                log(f"{name}: usage limit detected, resets "
                    f"{reset:%a %H:%M}", glyph="!", color="yellow")

            if paused and reset_at:
                if state.get("paused") != sorted(paused) or \
                        state.get("reset_at") != reset_at:
                    first_detection = not state.get("reset_at")
                    state = {"paused": sorted(paused), "reset_at": reset_at,
                             **identity}
                    save_state(state)
                    if first_detection:
                        when = datetime.datetime.fromtimestamp(
                            reset_at + buffer_s)
                        notify(cfg, f"Usage limit hit. Resuming "
                                    f"{len(paused)} session(s) at "
                                    f"{when:%H:%M}.")
                if time.time() >= reset_at + buffer_s:
                    log("reset time reached, resuming paused sessions",
                        glyph="→", color="cyan")
                    by_name = {session_name(cfg, r): r for r, _ in watched}
                    # Resume EVERY paused name. A name still watched resumes via
                    # its resolved repo (preset resume_message); a paused name no
                    # longer watched (agent switched/removed between runs) falls
                    # back to the global resume_message so it is still nudged
                    # rather than silently stranded paused forever.
                    paused_repos = [by_name[n] for n in sorted(paused)
                                    if n in by_name]
                    sent = resume_sessions(cfg, paused_repos)
                    orphans = sorted(n for n in paused if n not in by_name)
                    sent += resume_orphans(cfg, orphans)
                    notify(cfg, f"Resumed {len(sent)} session(s) after "
                                f"limit reset.")
                    until = time.time() + cfg["resume_cooldown_seconds"]
                    for name in paused:
                        cooldown_until[name] = until
                    # Drop limit state but keep recording our identity so a
                    # later `wind down` can still reap this running watcher.
                    state = dict(identity)
                    save_state(state)

            if paused and reset_at:
                eta = reset_at + buffer_s - time.time()
                hb = (f"limit hit · resuming {len(paused)} session(s) in "
                      f"{human_delta(eta)}")
            else:
                hb = (f"watching {len(watched)} session(s) · "
                      f"poll {poll}s")
            watch_sleep(poll, hb)
    except KeyboardInterrupt:
        heartbeat_clear()
        log("watcher stopped")
    finally:
        if keeper:
            keeper.terminate()


# ---------------------------------------------------------------- main -----

def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="wind",
        description="Second Wind: auto-resume Claude Code tmux sessions "
                    "after the 5-hour usage limit resets.")
    parser.add_argument("-c", "--config", help="path to config JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="write a starter config file")
    p_init.add_argument("--force", action="store_true",
                        help="overwrite existing config")
    p_init.add_argument("--defaults", action="store_true",
                        help="write the starter config without the wizard")
    p_up = sub.add_parser("up",
                          help="start tmux sessions and launch Claude Code")
    p_up.add_argument("--no-watch", action="store_true",
                      help="don't auto-spawn the watcher session")
    sub.add_parser("status", help="show session states and next reset")
    p_watch = sub.add_parser("watch", help="watch panes and auto-resume")
    p_watch.add_argument("--poll", type=int,
                         help="poll interval in seconds (overrides config)")
    p_watch.add_argument("--detach", action="store_true",
                         help="run the watcher in a detached tmux session")
    p_prompt = sub.add_parser(
        "prompt", help="create/edit a repo's first-prompt file")
    p_prompt.add_argument("repo", help="repo name from the config")
    p_prompt.add_argument("--editor",
                          help="editor command (overrides $EDITOR)")
    sub.add_parser("resume", help="send the resume message to all sessions")
    sub.add_parser("down", help="kill all wind tmux sessions")
    p_dash = sub.add_parser("dash", help="serve the live web dashboard")
    p_dash.add_argument("--port", type=int, default=8787,
                        help="port on 127.0.0.1 (default 8787)")
    p_dash.add_argument("--no-browser", action="store_true",
                        help="don't open the browser automatically")
    p_guide = sub.add_parser("guide", help="print the setup walkthrough")
    p_guide.add_argument("--open", action="store_true",
                         help="also open the visual guide in a browser")

    args = parser.parse_args(argv)

    if args.command == "init":
        return cmd_init(args)
    if args.command == "guide":
        return cmd_guide(args)

    cfg = load_config(args.config)
    handlers = {
        "up": cmd_up,
        "status": cmd_status,
        "watch": cmd_watch,
        "prompt": cmd_prompt,
        "resume": cmd_resume,
        "down": cmd_down,
        "dash": cmd_dash,
    }
    return handlers[args.command](cfg, args)


if __name__ == "__main__":
    main()

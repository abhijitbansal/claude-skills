#!/usr/bin/env python3
"""Second Wind — Claude Code multi-repo auto-resume orchestrator.

Runs Claude Code sessions for several repos in named tmux sessions, watches
their panes for the (account-level) usage-limit message, parses the reset
time, and resumes every paused session shortly after the limit resets.

Single file, Python stdlib only. Requires: tmux, Claude Code CLI.

Commands:
  wind init     write a starter config file
  wind up       start a tmux session per repo and launch Claude Code
  wind status   show each session's state and the next reset time
  wind watch    run the watcher loop (detect limit -> wait -> resume all)
  wind resume   send the resume message to sessions now
  wind down     kill the tmux sessions
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

CONFIG_PATHS = [
    "./second-wind.json",
    "~/.config/second-wind/config.json",
]
STATE_PATH = "~/.local/state/second-wind/state.json"

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
VERSION = "1.1.0"


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
    cfg["_path"] = path
    return cfg


def limit_patterns(cfg):
    pats = list(cfg.get("limit_patterns") or []) + DEFAULT_LIMIT_PATTERNS
    return [re.compile(p, re.IGNORECASE) for p in pats]


def session_name(cfg, repo):
    return f"{cfg['session_prefix']}-{repo['name']}"


# ----------------------------------------------------------------- state ---

def state_file():
    return os.path.expanduser(STATE_PATH)


def load_state():
    try:
        with open(state_file()) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state):
    path = state_file()
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)
    os.chmod(path, 0o600)


def clear_state():
    try:
        os.remove(state_file())
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


def capture_pane(name, lines):
    result = tmux("capture-pane", "-p", "-t", f"={name}", "-S", f"-{lines}",
                  check=False)
    return result.stdout if result.returncode == 0 else ""


def send_text(name, text):
    """Type text into a pane (bracketed paste, safe for multi-line), then Enter."""
    proc = subprocess.run(
        ["tmux", "load-buffer", "-b", "wind", "-"],
        input=text, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        die(f"tmux load-buffer failed: {proc.stderr.strip()}")
    tmux("paste-buffer", "-p", "-d", "-b", "wind", "-t", f"={name}")
    time.sleep(0.3)
    tmux("send-keys", "-t", f"={name}", "Enter")


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


# ------------------------------------------------------------- commands ----

def cmd_init(args):
    path = os.path.expanduser(args.config or CONFIG_PATHS[0])
    if os.path.exists(path) and not args.force:
        die(f"{path} already exists (use --force to overwrite)")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    sample = {k: v for k, v in DEFAULT_CONFIG.items()}
    with open(path, "w") as f:
        json.dump(sample, f, indent=2)
        f.write("\n")
    print(f"Wrote starter config to {path} — edit 'repos' and run `wind up`.")


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
        claude_cmd = repo.get("claude_cmd") or cfg["claude_cmd"]
        claude_args = repo.get("claude_args") or cfg["claude_args"]
        command = claude_cmd + (f" {claude_args}" if claude_args else "")
        tmux("new-session", "-d", "-s", name, "-c", path)
        tmux("send-keys", "-t", f"={name}", command, "Enter")
        log(f"{name}: launched `{command}` in {path}", glyph="→", color="cyan")
        started.append((repo, name))

    prompts = [(r, n) for r, n in started if r.get("prompt_file")]
    if prompts:
        delay = cfg["startup_delay_seconds"]
        log(f"waiting {delay}s for Claude Code to start before sending prompts")
        time.sleep(delay)
        for repo, name in prompts:
            pf = os.path.expanduser(repo["prompt_file"])
            if not os.path.isfile(pf):
                pf_rel = os.path.join(os.path.expanduser(repo["path"]),
                                      repo["prompt_file"])
                if os.path.isfile(pf_rel):
                    pf = pf_rel
                else:
                    log(f"{name}: prompt file not found: {repo['prompt_file']}",
                        glyph="!", color="yellow")
                    continue
            with open(pf) as f:
                prompt = f.read().strip()
            if prompt:
                send_text(name, prompt)
                log(f"{name}: sent initial prompt ({len(prompt)} chars)",
                    glyph="✓", color="green")
    if started:
        log(f"{len(started)} session(s) up. Attach: tmux attach -t "
            f"{started[0][1]}  |  watch: wind watch",
            glyph="✓", color="green")
    else:
        log("nothing to start", glyph="○", color="dim")


def cmd_status(cfg, args):
    patterns = limit_patterns(cfg)
    state = load_state()
    now = time.time()
    rows = []
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if not session_exists(name):
            rows.append((name, "not running", ""))
            continue
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


def resume_sessions(cfg, names):
    sent = []
    for name in names:
        if not session_exists(name):
            continue
        send_text(name, cfg["resume_message"])
        sent.append(name)
        log(f"{name}: sent resume message", glyph="✓", color="green")
    return sent


def cmd_resume(cfg, args):
    names = [session_name(cfg, r) for r in cfg["repos"]]
    sent = resume_sessions(cfg, names)
    clear_state()
    log(f"resumed {len(sent)} session(s)")


def cmd_down(cfg, args):
    for repo in cfg["repos"]:
        name = session_name(cfg, repo)
        if session_exists(name):
            tmux("kill-session", "-t", f"={name}")
            log(f"{name}: killed", glyph="✗", color="red")
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
    banner()
    patterns = limit_patterns(cfg)
    poll = args.poll or cfg["poll_interval_seconds"]
    buffer_s = cfg["resume_buffer_seconds"]
    keeper = start_caffeinate() if cfg["caffeinate"] else None
    if keeper:
        log("caffeinate active (Mac will stay awake while watching)")
    log(f"watching {len(cfg['repos'])} session(s), poll every {poll}s, "
        f"resume buffer {buffer_s}s")

    state = load_state()
    # After resuming, the old limit message lingers in the pane scrollback;
    # skip re-detection on a session until the cooldown passes.
    cooldown_until = {}
    try:
        while True:
            paused = set(state.get("paused", []))
            reset_at = state.get("reset_at")

            for repo in cfg["repos"]:
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
                    state = {"paused": sorted(paused), "reset_at": reset_at}
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
                    sent = resume_sessions(cfg, sorted(paused))
                    notify(cfg, f"Resumed {len(sent)} session(s) after "
                                f"limit reset.")
                    until = time.time() + cfg["resume_cooldown_seconds"]
                    for name in paused:
                        cooldown_until[name] = until
                    state = {}
                    clear_state()

            if paused and reset_at:
                eta = reset_at + buffer_s - time.time()
                hb = (f"limit hit · resuming {len(paused)} session(s) in "
                      f"{human_delta(eta)}")
            else:
                hb = (f"watching {len(cfg['repos'])} session(s) · "
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
    sub.add_parser("up", help="start tmux sessions and launch Claude Code")
    sub.add_parser("status", help="show session states and next reset")
    p_watch = sub.add_parser("watch", help="watch panes and auto-resume")
    p_watch.add_argument("--poll", type=int,
                         help="poll interval in seconds (overrides config)")
    sub.add_parser("resume", help="send the resume message to all sessions")
    sub.add_parser("down", help="kill all wind tmux sessions")

    args = parser.parse_args(argv)

    if args.command == "init":
        return cmd_init(args)

    cfg = load_config(args.config)
    handlers = {
        "up": cmd_up,
        "status": cmd_status,
        "watch": cmd_watch,
        "resume": cmd_resume,
        "down": cmd_down,
    }
    return handlers[args.command](cfg, args)


if __name__ == "__main__":
    main()

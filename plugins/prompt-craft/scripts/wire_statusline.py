#!/usr/bin/env python3
"""Wire/unwire the prompt-craft statusline shim into ~/.claude/settings.json.

Atomic, backed up (0600), idempotent, reversible. Aborts (no write) if
settings.json is unparseable. Refuses to record a self-referencing base.
"""
import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry_lib import atomic_write_json  # noqa: E402

def _shim_template(plugin_root):
    # type: (object) -> Path
    return Path(plugin_root) / "hooks" / "statusline_shim.sh"


def _pc_dir(home):
    # type: (object) -> Path
    return Path(home) / ".claude" / "prompt-craft"


def _settings_path(home):
    # type: (object) -> Path
    return Path(home) / ".claude" / "settings.json"


def _shim_path(home):
    # type: (object) -> Path
    return _pc_dir(home) / "statusline.sh"


def _sidecar_path(home):
    # type: (object) -> Path
    return _pc_dir(home) / "base-statusline"


def _backup_pointer(home):
    # type: (object) -> Path
    return _pc_dir(home) / "last-backup"


def _shim_command(home):
    # type: (object) -> str
    return 'bash "%s"' % _shim_path(home)


def _load_settings(home):
    # type: (object) -> dict
    sp = _settings_path(home)
    if not sp.exists():
        return {}
    try:
        settings = json.loads(sp.read_text())
    except ValueError as exc:
        raise ValueError("settings.json is unparseable; refusing to write: %s" % exc)
    if not isinstance(settings, dict):
        raise ValueError("settings.json is not a JSON object; refusing to write")
    return settings


def _current_command(settings):
    # type: (dict) -> str
    """The statusLine command in settings ("" if none). Raises ValueError on
    an unexpected shape rather than crashing or overwriting it."""
    status_line = settings.get("statusLine")
    if status_line is None:
        return ""
    if not isinstance(status_line, dict):
        raise ValueError("settings.json statusLine is not an object; refusing to write")
    command = status_line.get("command", "")
    if not isinstance(command, str):
        raise ValueError("settings.json statusLine.command is not a string; refusing to write")
    return command


def _backup_settings(home):
    # type: (object) -> None
    """Timestamped 0600 copy of settings.json, recorded in the last-backup pointer."""
    sp = _settings_path(home)
    if not sp.exists():
        return
    _pc_dir(home).mkdir(parents=True, exist_ok=True)
    # Microseconds keep two backups in the same second from overwriting each other.
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    backup = sp.with_name("settings.json.bak.%s" % ts)
    shutil.copyfile(str(sp), str(backup))
    os.chmod(str(backup), 0o600)
    backup.read_text()  # verify readable
    _backup_pointer(home).write_text(str(backup))


def _is_self_reference(command, home):
    # type: (str, object) -> bool
    """Return True if command references OUR specific shim (would cause recursion).

    Uses the full absolute shim path to avoid false positives on user commands
    whose path happens to contain "statusline.sh" as a substring (e.g.
    bash "~/bin/mystatusline.sh" must NOT be flagged as self-referential).
    """
    return str(_shim_path(home)) in command


def _refresh_shim(home, plugin_root):
    # type: (object, str) -> bool
    """Overwrite the installed shim with the plugin template when they differ.
    True if the file changed; a missing template or shim is left alone."""
    template = _shim_template(plugin_root)
    shim = _shim_path(home)
    if not template.is_file() or not shim.is_file():
        return False
    if shim.read_bytes() == template.read_bytes():
        return False
    shutil.copyfile(str(template), str(shim))
    os.chmod(str(shim), 0o755)
    return True


def wire(home, plugin_root, dry_run=False):
    # type: (object, str, bool) -> dict
    """Point settings.json statusLine.command at the shim, saving the prior command.

    Returns {"before": str, "after": str, "wired": bool, "shim_refreshed": bool}.
    wired=False means already wired or dry_run; an already-wired install still
    gets an outdated shim file refreshed (shim_refreshed=True).
    Raises ValueError if settings.json exists but is not valid JSON (aborts, no write).
    """
    settings = _load_settings(home)  # raises ValueError on bad JSON
    shim_cmd = _shim_command(home)
    current = _current_command(settings)  # raises ValueError on a bad shape

    # Idempotency: detect already-wired BEFORE touching sidecar. settings.json
    # and the sidecar stay untouched, but an outdated shim file is refreshed
    # so fixes to the template reach installs that were wired earlier.
    if current == shim_cmd:
        refreshed = False if dry_run else _refresh_shim(home, plugin_root)
        return {"before": current, "after": current, "wired": False,
                "shim_refreshed": refreshed}

    if dry_run:
        return {"before": current, "after": shim_cmd, "wired": False,
                "shim_refreshed": False}

    _pc_dir(home).mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(str(_pc_dir(home)), 0o700)
    except OSError:
        pass

    # Save prior base command — unless it self-references (would cause recursion).
    if current and not _is_self_reference(current, home):
        _sidecar_path(home).write_text(current)

    # Install the shim from the plugin template.
    template = _shim_template(plugin_root)
    if not template.is_file():
        raise ValueError("shim template not found: %s" % template)
    shutil.copyfile(str(template), str(_shim_path(home)))
    os.chmod(str(_shim_path(home)), 0o755)

    # Timestamped 0600 backup BEFORE the write.
    sp = _settings_path(home)
    _backup_settings(home)

    settings.setdefault("statusLine", {})
    settings["statusLine"]["type"] = "command"
    settings["statusLine"]["command"] = shim_cmd
    atomic_write_json(sp, settings, mode=0o600, sort_keys=False)
    return {"before": current, "after": shim_cmd, "wired": True,
            "shim_refreshed": False}


def unwire(home):
    # type: (object) -> dict
    """Restore settings.json statusLine.command from the sidecar and clean up.

    Acts only when statusLine.command is exactly our shim command: a settings
    file that was never wired, was already unwired, or was edited since is left
    untouched. Timestamped backups are kept, never deleted.

    Returns {"restored": str, "changed": bool}; restored is the command put
    back ("" if the statusLine was removed or nothing was changed).
    """
    settings = _load_settings(home)
    if _current_command(settings) != _shim_command(home):
        return {"restored": "", "changed": False}

    sidecar = _sidecar_path(home)
    base = sidecar.read_text().strip() if sidecar.exists() else ""

    _backup_settings(home)
    if base:
        settings["statusLine"]["type"] = "command"
        settings["statusLine"]["command"] = base
    else:
        settings.pop("statusLine", None)

    atomic_write_json(_settings_path(home), settings, mode=0o600, sort_keys=False)

    for path in (_shim_path(home), sidecar):
        try:
            path.unlink()
        except OSError:
            pass

    return {"restored": base, "changed": True}


def main(argv=None):
    # type: (object) -> int
    ap = argparse.ArgumentParser(
        description="Wire/unwire prompt-craft statusline shim into ~/.claude/settings.json"
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--wire", action="store_true", help="Install shim into settings.json")
    g.add_argument("--unwire", action="store_true", help="Restore original command from sidecar")
    ap.add_argument("--dry-run", action="store_true", help="Show what would change, no write")
    ap.add_argument("--home", default=os.path.expanduser("~"),
                    help="Override home directory (for testing)")
    ap.add_argument("--plugin-root",
                    default=str(Path(__file__).resolve().parent.parent),
                    help="Override plugin root directory (for testing)")
    args = ap.parse_args(argv)

    if args.wire:
        try:
            r = wire(args.home, args.plugin_root, dry_run=args.dry_run)
        except ValueError as exc:
            print("ERROR: %s" % exc, file=sys.stderr)
            return 1
        print("before: %s" % (r["before"] or "(none)"))
        print("after:  %s" % r["after"])
        print("wired:  %s" % r["wired"])
        if r["wired"]:
            ptr = _backup_pointer(args.home)
            if ptr.exists():
                print("backup: %s" % ptr.read_text().strip())
        elif r["shim_refreshed"]:
            print("(already wired — shim refreshed from the plugin template)")
        elif not args.dry_run:
            print("(already wired — no-op)")
        if args.dry_run:
            backup_note = "Backup path: %s" % (
                _backup_pointer(args.home).parent / "settings.json.bak.<ts>"
            )
            print("DRY RUN — no files written. %s" % backup_note)
    else:
        try:
            r = unwire(args.home)
        except ValueError as exc:
            print("ERROR: %s" % exc, file=sys.stderr)
            return 1
        if not r["changed"]:
            print("(statusLine is not the prompt-craft shim — nothing to restore)")
            return 0
        restored = r["restored"] or "(removed statusLine)"
        print("restored: %s" % restored)
        ptr = _backup_pointer(args.home)
        if ptr.exists():
            print("backup kept: %s" % ptr.read_text().strip())
        print()
        print("Manual recovery: if anything looks wrong, restore the timestamped backup:")
        print("  cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())

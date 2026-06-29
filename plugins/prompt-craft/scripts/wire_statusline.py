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

SHIM_REL = ".claude/prompt-craft/statusline.sh"
SHIM_TEMPLATE = Path(__file__).resolve().parent.parent / "hooks" / "statusline_shim.sh"


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
        return json.loads(sp.read_text())
    except ValueError as exc:
        raise ValueError("settings.json is unparseable; refusing to write: %s" % exc)


def _is_self_reference(command, home):
    # type: (str, object) -> bool
    """Return True if command references our shim or hint scripts (would recurse)."""
    # Match what statusline_shim.sh's bash guard does:
    #   case "$BASE_CMD" in *statusline_hint.sh*|*statusline.sh*) ...
    return "statusline_hint.sh" in command or "statusline.sh" in command


def wire(home, plugin_root, dry_run=False):
    # type: (object, str, bool) -> dict
    """Point settings.json statusLine.command at the shim, saving the prior command.

    Returns {"before": str, "after": str, "wired": bool}.
    wired=False means already wired (no-op) or dry_run.
    Raises ValueError if settings.json exists but is not valid JSON (aborts, no write).
    """
    settings = _load_settings(home)  # raises ValueError on bad JSON
    shim_cmd = _shim_command(home)
    current = (settings.get("statusLine") or {}).get("command", "")

    # Idempotency: detect already-wired BEFORE touching sidecar.
    if current == shim_cmd:
        return {"before": current, "after": current, "wired": False}

    if dry_run:
        return {"before": current, "after": shim_cmd, "wired": False}

    _pc_dir(home).mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(str(_pc_dir(home)), 0o700)
    except OSError:
        pass

    # Save prior base command — unless it self-references (would cause recursion).
    if current and not _is_self_reference(current, home):
        _sidecar_path(home).write_text(current)

    # Install the shim from the plugin template.
    shutil.copyfile(str(SHIM_TEMPLATE), str(_shim_path(home)))
    os.chmod(str(_shim_path(home)), 0o755)

    # Timestamped 0600 backup BEFORE the write.
    sp = _settings_path(home)
    if sp.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        backup = sp.with_name("settings.json.bak.%s" % ts)
        shutil.copyfile(str(sp), str(backup))
        os.chmod(str(backup), 0o600)
        backup.read_text()  # verify readable
        _backup_pointer(home).write_text(str(backup))

    settings.setdefault("statusLine", {})
    settings["statusLine"]["type"] = "command"
    settings["statusLine"]["command"] = shim_cmd
    atomic_write_json(sp, settings, mode=0o600, sort_keys=False)
    return {"before": current, "after": shim_cmd, "wired": True}


def unwire(home):
    # type: (object) -> dict
    """Restore settings.json statusLine.command from the sidecar and clean up.

    Returns {"restored": str} where str is the restored command (or "" if removed).
    """
    settings = _load_settings(home)
    sidecar = _sidecar_path(home)
    base = sidecar.read_text().strip() if sidecar.exists() else ""

    if base:
        settings.setdefault("statusLine", {})
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

    ptr = _backup_pointer(home)
    if ptr.exists():
        try:
            Path(ptr.read_text().strip()).unlink()
        except OSError:
            pass
        try:
            ptr.unlink()
        except OSError:
            pass

    return {"restored": base}


def main():
    # type: () -> int
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
    args = ap.parse_args()

    if args.wire:
        try:
            r = wire(args.home, args.plugin_root, dry_run=args.dry_run)
        except ValueError as exc:
            print("ERROR: %s" % exc, file=sys.stderr)
            return 1
        print("before: %s" % (r["before"] or "(none)"))
        print("after:  %s" % r["after"])
        print("wired:  %s" % r["wired"])
        if not r["wired"] and not args.dry_run:
            print("(already wired — no-op)")
        if args.dry_run:
            backup_note = ("Backup path: %s" % _backup_pointer(args.home).parent
                           / ("settings.json.bak.<ts>"))
            print("DRY RUN — no files written. %s" % backup_note)
    else:
        try:
            r = unwire(args.home)
        except ValueError as exc:
            print("ERROR: %s" % exc, file=sys.stderr)
            return 1
        restored = r["restored"] or "(removed statusLine)"
        print("restored: %s" % restored)
        print()
        print("Manual recovery: if anything looks wrong, restore the timestamped backup:")
        print("  cp ~/.claude/settings.json.bak.<ts> ~/.claude/settings.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())

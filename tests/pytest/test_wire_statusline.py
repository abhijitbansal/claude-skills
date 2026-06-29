"""wire_statusline.py — atomic, backed-up, reversible settings.json edit."""
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
PLUGIN = REPO_ROOT / "plugins" / "prompt-craft"
sys.path.insert(0, str(SCRIPTS))
import wire_statusline as ws  # noqa: E402


def _home(tmp_path, settings):
    home = tmp_path / "home"
    sp = home / ".claude" / "settings.json"
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(settings)
    return home


def test_wire_records_base_installs_shim_and_backs_up(tmp_path):
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
    ws.wire(home, str(PLUGIN))
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert "statusline.sh" in settings["statusLine"]["command"]
    assert (home / ".claude" / "prompt-craft" / "base-statusline").read_text().strip() == "echo BASE"
    assert (home / ".claude" / "prompt-craft" / "statusline.sh").exists()
    backups = list((home / ".claude").glob("settings.json.bak.*"))
    assert backups and oct(os.stat(backups[0]).st_mode & 0o777) == "0o600"


def test_wire_is_idempotent(tmp_path):
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
    ws.wire(home, str(PLUGIN))
    r = ws.wire(home, str(PLUGIN))
    assert r["wired"] is False  # already wired -> no-op
    # base sidecar still the original, not overwritten with the shim
    assert (home / ".claude" / "prompt-craft" / "base-statusline").read_text().strip() == "echo BASE"


def test_wire_aborts_on_unparseable_settings(tmp_path):
    home = _home(tmp_path, "{not valid json")
    before = (home / ".claude" / "settings.json").read_text()
    try:
        ws.wire(home, str(PLUGIN))
        raised = False
    except ValueError:
        raised = True
    assert raised
    assert (home / ".claude" / "settings.json").read_text() == before  # never written


def test_wire_refuses_self_referencing_base(tmp_path):
    # Use the SAME home for both the shim-command construction and the wire() call.
    # The old test used Path("~/.claude/...").expanduser() (the real user's home)
    # while passing tmp_path/home to wire() — a cross-home setup that only worked
    # because the old substring check matched any path ending in "statusline.sh".
    # With the precise _shim_path(home) check we must use a consistent home so
    # the guard actually fires.  We also use a variant command (adds --debug) so
    # the idempotency check does NOT short-circuit — this specifically exercises
    # _is_self_reference.
    home = tmp_path / "home"
    shim_path = ws._shim_path(home)
    shim_variant = 'bash "%s" --debug' % shim_path
    sp = home / ".claude" / "settings.json"
    sp.parent.mkdir(parents=True, exist_ok=True)
    sp.write_text(json.dumps({"statusLine": {"type": "command", "command": shim_variant}}))
    ws.wire(home, str(PLUGIN))
    # The self-referencing command must NOT be recorded in the sidecar.
    sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
    assert not sidecar.exists() or str(shim_path) not in sidecar.read_text()


def test_unwire_restores_base_and_removes_shim(tmp_path):
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
    ws.wire(home, str(PLUGIN))
    ws.unwire(home)
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert settings["statusLine"]["command"] == "echo BASE"
    assert not (home / ".claude" / "prompt-craft" / "statusline.sh").exists()


def test_wire_no_original_does_not_write_sidecar(tmp_path):
    """When settings.json has no statusLine, sidecar must not be created."""
    home = _home(tmp_path, json.dumps({"theme": "dark"}))
    ws.wire(home, str(PLUGIN))
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert "statusline.sh" in settings["statusLine"]["command"]
    # No original to save — sidecar must be absent
    sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
    assert not sidecar.exists()


def test_unwire_no_sidecar_removes_statusline(tmp_path):
    """unwire when sidecar is absent removes statusLine from settings entirely."""
    home = _home(tmp_path, json.dumps({"theme": "dark"}))
    ws.wire(home, str(PLUGIN))
    # Simulate missing sidecar (e.g. no original was ever saved)
    sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
    sidecar.unlink(missing_ok=True)
    ws.unwire(home)
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert "statusLine" not in settings
    assert settings.get("theme") == "dark"


def test_wire_preserves_unrelated_settings_keys(tmp_path):
    """Wire must round-trip every key except statusLine untouched."""
    original = {"theme": "dark", "model": "sonnet", "statusLine": {"type": "command", "command": "echo X"}}
    home = _home(tmp_path, json.dumps(original))
    ws.wire(home, str(PLUGIN))
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert settings["theme"] == "dark"
    assert settings["model"] == "sonnet"
    assert "statusline.sh" in settings["statusLine"]["command"]


def test_wire_unwire_preserves_user_statusline_with_statusline_in_name(tmp_path):
    """Data-loss guard: a user whose original command contains 'statusline.sh' as
    a substring (e.g. mystatusline.sh) must NOT be falsely treated as our shim.
    The original must survive wire→unwire without loss.
    """
    # This path looks similar to our shim name but is NOT our shim.
    user_cmd = 'bash "%s/bin/mystatusline.sh"' % str(tmp_path)
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": user_cmd}}))
    ws.wire(home, str(PLUGIN))
    # Sidecar must record the original user command.
    sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
    assert sidecar.exists(), "sidecar must be written for a non-shim original"
    assert sidecar.read_text().strip() == user_cmd
    # unwire must restore it exactly.
    ws.unwire(home)
    settings = json.loads((home / ".claude" / "settings.json").read_text())
    assert settings["statusLine"]["command"] == user_cmd


def test_wire_dry_run_exits_clean_and_writes_nothing(tmp_path):
    """--wire --dry-run must exit 0, write nothing, and print a backup-path line."""
    import io
    from contextlib import redirect_stdout
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": "echo BASE"}}))
    settings_before = (home / ".claude" / "settings.json").read_text()
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = ws.main(["--wire", "--dry-run", "--home", str(home),
                      "--plugin-root", str(PLUGIN)])
    assert rc == 0
    # settings.json must be unchanged.
    assert (home / ".claude" / "settings.json").read_text() == settings_before
    # Output must include a backup-path line.
    out = buf.getvalue()
    assert "Backup path:" in out
    assert "DRY RUN" in out

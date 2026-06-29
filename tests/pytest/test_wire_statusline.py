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
    shim = "bash \"" + str(Path("~/.claude/prompt-craft/statusline.sh").expanduser()) + "\""
    home = _home(tmp_path, json.dumps({"statusLine": {"type": "command", "command": shim}}))
    ws.wire(home, str(PLUGIN))
    # the self-referencing prior command must NOT be recorded as the base
    sidecar = home / ".claude" / "prompt-craft" / "base-statusline"
    assert not sidecar.exists() or "statusline.sh" not in sidecar.read_text()


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

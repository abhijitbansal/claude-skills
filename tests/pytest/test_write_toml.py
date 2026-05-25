import json
import subprocess
import textwrap
from pathlib import Path

WRITER = Path(__file__).resolve().parents[2] / "setup" / "write_toml.py"
PARSER = Path(__file__).resolve().parents[2] / "setup" / "parse_toml.py"


def write(initial: str, section: str, payload) -> str:
    p = Path("/tmp/write-toml-test.toml")
    p.write_text(initial)
    subprocess.run(
        ["python3", str(WRITER), str(p), section],
        input=json.dumps(payload), text=True, check=True,
    )
    return p.read_text()


def parse(text: str, section: str):
    return json.loads(subprocess.check_output(
        ["python3", str(PARSER), "/dev/stdin", section],
        input=text, text=True,
    ))


def test_round_trip_marketplaces_preserves_comments():
    initial = textwrap.dedent("""\
        [meta]
        schema_version = 1

        # Marketplaces — auto-managed by capture.sh, comments preserved.
        [[marketplaces]]
        name = "a"
        repo = "owner/a"
        """)
    out = write(initial, "marketplaces", [
        {"name": "a", "repo": "owner/a"},
        {"name": "b", "repo": "owner/b"},
    ])
    assert "Marketplaces — auto-managed" in out
    assert parse(out, "marketplaces") == [
        {"name": "a", "repo": "owner/a"},
        {"name": "b", "repo": "owner/b"},
    ]


def test_overwrites_existing_entries():
    initial = textwrap.dedent("""\
        [meta]
        schema_version = 1
        [[plugins]]
        name = "old"
        marketplace = "m"
        """)
    out = write(initial, "plugins", [{"name": "new", "marketplace": "m", "pin": None}])
    assert "old" not in out
    assert parse(out, "plugins") == [{"name": "new", "marketplace": "m", "pin": None}]


def test_creates_section_if_absent():
    initial = "[meta]\nschema_version = 1\n"
    out = write(initial, "skills", [{"source": "s", "name": "n"}])
    assert parse(out, "skills") == [{"source": "s", "name": "n"}]

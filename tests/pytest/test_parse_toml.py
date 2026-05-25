import json
import subprocess
import textwrap
from pathlib import Path

PARSER = Path(__file__).resolve().parents[2] / "setup" / "parse_toml.py"


def run(toml_text: str, *args: str) -> str:
    p = Path("/tmp/parse-toml-test.toml")
    p.write_text(toml_text)
    return subprocess.check_output(["python3", str(PARSER), str(p), *args], text=True)


def test_lists_marketplaces():
    toml = textwrap.dedent("""
        [meta]
        schema_version = 1
        [[marketplaces]]
        name = "a"
        repo = "owner/a"
        [[marketplaces]]
        name = "b"
        repo = "owner/b"
    """)
    out = json.loads(run(toml, "marketplaces"))
    assert out == [
        {"name": "a", "repo": "owner/a"},
        {"name": "b", "repo": "owner/b"},
    ]


def test_lists_plugins_with_optional_pin():
    toml = textwrap.dedent("""
        [meta]
        schema_version = 1
        [[plugins]]
        name = "x"
        marketplace = "m"
        [[plugins]]
        name = "y"
        marketplace = "m"
        pin = "v1.0"
    """)
    out = json.loads(run(toml, "plugins"))
    assert out == [
        {"name": "x", "marketplace": "m", "pin": None},
        {"name": "y", "marketplace": "m", "pin": "v1.0"},
    ]


def test_empty_section_returns_empty_list():
    toml = '[meta]\nschema_version = 1\n'
    assert json.loads(run(toml, "skills")) == []


def test_rejects_unknown_schema_version():
    toml = '[meta]\nschema_version = 99\n'
    proc = subprocess.run(
        ["python3", str(PARSER), "/dev/stdin", "marketplaces"],
        input=toml, text=True, capture_output=True,
    )
    assert proc.returncode != 0
    assert "schema_version" in proc.stderr

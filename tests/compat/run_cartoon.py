#!/usr/bin/env python3
"""Real Cartoon CLI captures, followed by Test Board hook/store/display replay.

No installation or model calls. Requires an explicitly selected, reviewed binary.
SHA-256 checks selection/integrity; it does not authenticate build provenance.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CASES = [
    ("adapter-pass", 0, 2, 0, True),
    ("adapter-pass-then-fail", 7, 2, 0, True),
    ("adapter-fail-then-zero", 0, 1, 1, True),
    ("pass", 0, 2, 0, True),
    ("pass-then-fail", 7, 2, 0, True),
    ("fail-then-zero", 0, 1, 1, True),
    ("forged-exit", 9, 2, 0, True),
    ("no-counts", 2, 0, 0, False),
]


def binary(path, expected_hash):
    path = path.resolve(strict=True)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise ValueError("Cartoon must be an executable file")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected_hash:
        raise ValueError("Cartoon SHA-256 mismatch; no execution attempted")
    return path


def run(cartoon, expected_hash, claude):
    cartoon = binary(cartoon, expected_hash)
    scratch = ROOT / ".scratch"
    scratch.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="cartoon-compat-", dir=scratch))
    print(f"Evidence directory: {work}", flush=True)
    (work / "selection.json").write_text(json.dumps({
        "cartoon_sha256": expected_hash,
        "qualification": "real-cli-producer + modeled-bash-envelope + real-test-board-consumer",
        "native_mcp_delivery_verified": False,
    }, indent=2) + "\n")
    home, commands = work / "home", work / "bin"
    home.mkdir()
    commands.mkdir()
    fixture = commands / "pytest"
    shutil.copyfile(HERE / "fixtures" / "pytest", fixture)
    fixture.chmod(0o700)
    env = {
        "HOME": str(home), "PATH": f"{commands}:/usr/bin:/bin", "LC_ALL": "C",
        "TMPDIR": str(work), "XDG_CONFIG_HOME": str(home / "config"),
        "XDG_STATE_HOME": str(home / "state"), "XDG_CACHE_HOME": str(home / "cache"),
        "NO_COLOR": "1",
    }
    captures = []
    for name, exit_code, passed, failed, parsed in CASES:
        result = subprocess.run([str(cartoon), "-c", f"pytest {name}"], cwd=work,
                                env=env, stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=10, check=False)
        capture = {
            "name": name, "command": f'cartoon -c "pytest {name}"',
            "exit": result.returncode, "stdout": result.stdout.decode("utf-8"),
            "stderr": result.stderr.decode("utf-8"),
            "expected": {
                "passed": passed, "failed": failed, "total": passed + failed,
                "parsed": parsed, "exitCode": exit_code if exit_code else None,
                "commandStatus": "tool-error" if exit_code else "unknown",
            },
        }
        captures.append(capture)
        (work / "captures.json").write_text(json.dumps(captures, indent=2) + "\n")
        if result.returncode != exit_code:
            raise ValueError(f"{name}: expected process exit {exit_code}, observed {result.returncode}")
        print(f"CAPTURE {name}: process exit {result.returncode}", flush=True)

    plugin = work / "test-board"
    shutil.copytree(ROOT / "plugins" / "test-board", plugin,
                    ignore=shutil.ignore_patterns("node_modules", ".git", ".scratch"))
    shutil.copyfile(HERE / "cartoon-replay.test.tsx", plugin / "tests" / "cartoon-replay.test.tsx")
    (plugin / "tests" / "cartoon-captures.ts").write_text(
        "// Generated producer captures with fixed scenario expectations.\n"
        + "export const cases = " + json.dumps(captures, ensure_ascii=True) + "\n")
    # This is the installed offline plugin test runner, not a model session.
    with (work / "plugin-tests.log").open("wb") as log:
        result = subprocess.run([claude, "plugin", "test", str(plugin)], cwd=ROOT,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                timeout=120, check=False)
    print((work / "plugin-tests.log").read_text(), end="")
    print("LIMIT: host envelope is modeled; no native MCP or live host delivery claim.")
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cartoon", type=Path, required=True)
    parser.add_argument("--sha256", required=True, help="SHA-256 of the reviewed Cartoon executable")
    args = parser.parse_args()
    claude = shutil.which("claude")
    if claude is None:
        parser.error("installed Claude plugin test runner is required; nothing will be installed")
    try:
        return run(args.cartoon, args.sha256, claude)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"Qualification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

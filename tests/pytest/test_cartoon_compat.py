"""Runner guardrails; the opt-in real producer qualification is tests/compat."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def runner(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("run_cartoon", ROOT / "tests/compat/run_cartoon.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    (tmp_path / "plugins/test-board/tests").mkdir(parents=True)
    executable = tmp_path / "reviewed-cartoon"
    executable.write_bytes(b"synthetic executable selection, never executed in these tests")
    executable.chmod(0o700)
    digest = hashlib.sha256(executable.read_bytes()).hexdigest()
    return module, executable, digest


def evidence(module):
    return next((module.ROOT / ".scratch").glob("cartoon-compat-*"))


def test_exact_binary_selection(runner):
    module, executable, digest = runner
    assert module.binary(executable, digest) == executable


def test_wrong_hash_denies_before_subprocess_or_evidence_creation(runner, monkeypatch):
    module, executable, _ = runner
    monkeypatch.setattr(module.subprocess, "run", lambda *a, **kw: pytest.fail("must not execute"))
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        module.run(executable, "0" * 64, "/synthetic/claude")
    assert not (module.ROOT / ".scratch").exists()


def test_nonexecutable_and_missing_binary_are_rejected(runner):
    module, executable, digest = runner
    executable.chmod(0o600)
    with pytest.raises(ValueError, match="executable file"):
        module.binary(executable, digest)
    with pytest.raises(FileNotFoundError):
        module.binary(executable.with_name("missing"), digest)


def test_missing_plugin_runner_is_an_error_not_a_skip(runner, monkeypatch):
    module, executable, digest = runner
    monkeypatch.setattr(sys, "argv", ["run_cartoon.py", "--cartoon", str(executable), "--sha256", digest])
    monkeypatch.setattr(module.shutil, "which", lambda _: None)
    monkeypatch.setattr(module.subprocess, "run", lambda *a, **kw: pytest.fail("must not execute"))
    with pytest.raises(SystemExit) as error:
        module.main()
    assert error.value.code == 2


def test_unexpected_exit_preserves_capture_and_never_replays(runner, monkeypatch):
    module, executable, digest = runner
    calls = []

    def wrong_exit(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 42, b"synthetic failure", b"")

    monkeypatch.setattr(module.subprocess, "run", wrong_exit)
    with pytest.raises(ValueError, match="observed 42"):
        module.run(executable, digest, "/synthetic/claude")
    assert len(calls) == 1
    assert json.loads((evidence(module) / "captures.json").read_text())[0]["exit"] == 42


@pytest.mark.parametrize("failure", [
    subprocess.TimeoutExpired("synthetic", 10), OSError("synthetic spawn failure"),
])
def test_producer_failure_retains_binary_selection_and_never_replays(runner, monkeypatch, failure):
    module, executable, digest = runner
    calls = []

    def fail(args, **kwargs):
        calls.append(args)
        raise failure

    monkeypatch.setattr(module.subprocess, "run", fail)
    with pytest.raises(type(failure)):
        module.run(executable, digest, "/synthetic/claude")
    assert len(calls) == 1
    assert json.loads((evidence(module) / "selection.json").read_text())["cartoon_sha256"] == digest


def test_invalid_utf8_is_not_silently_replaced(runner, monkeypatch):
    module, executable, digest = runner
    calls = []

    def invalid(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, b"\xff", b"")

    monkeypatch.setattr(module.subprocess, "run", invalid)
    with pytest.raises(UnicodeDecodeError):
        module.run(executable, digest, "/synthetic/claude")
    assert len(calls) == 1


@pytest.mark.parametrize("replay_exit", [0, 3])
def test_replay_exit_propagates_with_all_captures_and_logs(runner, monkeypatch, replay_exit):
    module, executable, digest = runner
    calls = []
    monkeypatch.setenv("SYNTHETIC_CREDENTIAL_SENTINEL", "must-not-reach-producer")

    def complete(args, **kwargs):
        calls.append((args, kwargs))
        if args[0] == str(executable):
            name = args[2].split()[1]
            code = next(c[1] for c in module.CASES if c[0] == name)
            assert "SYNTHETIC_CREDENTIAL_SENTINEL" not in kwargs["env"]
            assert Path(kwargs["cwd"]).is_relative_to(module.ROOT / ".scratch")
            return subprocess.CompletedProcess(args, code, b"synthetic capture", b"")
        assert args[:3] == ["/synthetic/claude", "plugin", "test"]
        kwargs["stdout"].write(b"synthetic offline runner log\n")
        return subprocess.CompletedProcess(args, replay_exit)

    monkeypatch.setattr(module.subprocess, "run", complete)
    assert module.run(executable, digest, "/synthetic/claude") == replay_exit
    work = evidence(module)
    captures = json.loads((work / "captures.json").read_text())
    assert [c["name"] for c in captures] == [c[0] for c in module.CASES]
    assert len(calls) == len(module.CASES) + 1
    assert (work / "plugin-tests.log").read_text() == "synthetic offline runner log\n"
    assert (work / "test-board/tests/cartoon-replay.test.tsx").is_file()
    assert all(call[1].get("stdin") == subprocess.DEVNULL for call in calls)

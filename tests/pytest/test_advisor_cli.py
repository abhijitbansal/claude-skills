"""advisor.py CLI: stdin context JSON + --mode output shapes."""
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "plugins" / "prompt-craft" / "scripts"
ADVISOR = SCRIPTS / "advisor.py"
sys.path.insert(0, str(SCRIPTS))
import build_registry as br  # noqa: E402


def _seed(home, repo_root):
    (home / ".claude").mkdir(parents=True, exist_ok=True)
    p = repo_root / "plugins" / "ecc" / "skills" / "review" / "SKILL.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("---\nname: review\ndescription: Review a diff for bugs.\n---\n")
    br.build_registry(repo_root, home, None)


def _run(mode, ctx, home):
    return subprocess.run(
        ["python3", str(ADVISOR), "--mode", mode, "--home", str(home)],
        input=json.dumps(ctx), capture_output=True, text=True,
    )


def test_mode_prompt_returns_banner(tmp_path):
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    r = _run("prompt", {"prompt": "review this diff", "git_state": {}, "cwd": str(repo)}, home)
    assert r.returncode == 0
    assert "/ecc:review" in r.stdout


def test_mode_statusline_is_single_next_segment(tmp_path):
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    r = _run("statusline", {"prompt": None, "git_state": {"dirty": True}, "cwd": str(repo)}, home)
    assert r.returncode == 0
    assert r.stdout.strip().startswith("next: /")
    assert "\n" not in r.stdout.strip()


def test_prompt_file_with_apostrophe_reaches_the_advisor(tmp_path):
    """CAT-85: a goal containing ' must work; the old inline-JSON snippet broke
    on it and read as 'no commands'."""
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    goal = tmp_path / "goal.txt"
    goal.write_text("Review the diff for bugs - don't touch what's out of scope")
    r = subprocess.run(
        ["python3", str(ADVISOR), "--mode", "prompt", "--home", str(home),
         "--prompt-file", str(goal)],
        input=json.dumps({"git_state": {}}), capture_output=True, text=True,
    )
    assert r.returncode == 0
    assert "/ecc:review" in r.stdout


def test_prompt_file_works_with_empty_stdin(tmp_path):
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    goal = tmp_path / "goal.txt"
    goal.write_text("review this diff")
    r = subprocess.run(
        ["python3", str(ADVISOR), "--mode", "prompt", "--home", str(home),
         "--prompt-file", str(goal)],
        input="", capture_output=True, text=True,
    )
    assert r.returncode == 0 and "/ecc:review" in r.stdout


def test_unreadable_prompt_file_reports_an_error(tmp_path):
    r = subprocess.run(
        ["python3", str(ADVISOR), "--mode", "prompt", "--home", str(tmp_path),
         "--prompt-file", str(tmp_path / "missing.txt")],
        input="{}", capture_output=True, text=True,
    )
    assert r.returncode == 2
    assert "--prompt-file" in r.stderr


def test_mode_stop_banner_on_dirty(tmp_path):
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    # /commit must be installed to be recommended (CAT-85): add a user command.
    commit = home / ".claude" / "commands" / "commit.md"
    commit.parent.mkdir(parents=True, exist_ok=True)
    commit.write_text("---\nname: commit\ndescription: Commit the work.\n---\n")
    br.build_registry(repo, home, None)
    r = _run("stop", {"prompt": None, "git_state": {"dirty": True}, "cwd": str(repo)}, home)
    assert r.returncode == 0 and "/commit" in r.stdout


def test_silent_when_nothing_matches(tmp_path):
    home, repo = tmp_path / "home", tmp_path / "repo"
    _seed(home, repo)
    r = _run("prompt", {"prompt": "xyzzy nothing here", "git_state": {}, "cwd": str(repo)}, home)
    assert r.returncode == 0 and r.stdout.strip() == ""


def test_degrades_when_registry_missing(tmp_path):
    home = tmp_path / "home"
    r = _run("prompt", {"prompt": "review", "git_state": {}, "cwd": "/x"}, home)
    assert r.returncode == 0 and r.stdout.strip() == ""


def test_bad_stdin_exits_zero_empty(tmp_path):
    r = subprocess.run(["python3", str(ADVISOR), "--mode", "prompt", "--home", str(tmp_path)],
                       input="not json", capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == ""


def test_empty_stdin_exits_zero_empty(tmp_path):
    r = subprocess.run(["python3", str(ADVISOR), "--mode", "prompt", "--home", str(tmp_path)],
                       input="", capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == ""


def test_non_dict_json_exits_zero_empty(tmp_path):
    r = subprocess.run(["python3", str(ADVISOR), "--mode", "prompt", "--home", str(tmp_path)],
                       input="42", capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == ""

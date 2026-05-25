# claude-skills Seeding Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `/Users/abhijitbansal/projects/claude-skills` as the canonical seeding repo for the author's Claude Code dev environment, with TOML-driven install, generalized custom skills, cross-repo contribute, and bats/pytest CI.

**Architecture:** A TOML manifest plus four bash scripts (`setup`, `capture`, `contribute`, `_lib`) drive installation, snapshotting, and contribution. Custom skills are symlinked from the repo into `~/.claude/` so edits go live without re-deploy; templated skills read `.claude/app.yml` at invocation time so the symlink model is preserved. Every shell entry point is covered by bats tests with mocked `claude`, `npx`, `gh`, `curl` stubs and a tmpdir `$HOME`. CI runs on macOS and Ubuntu.

**Tech Stack:** Bash 4+, Python 3.11+ (`tomllib` stdlib for read, `tomlkit` for write), bats-core 1.10+, pytest, shellcheck, GitHub Actions, `gh` CLI.

**Spec:** [docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md](../specs/2026-05-25-claude-skills-seed-design.md)

---

## File Structure

Created during the plan (annotated with the task that creates each file):

```
claude-skills/
├── README.md                                  # T1
├── claude-setup.toml                          # T6 (seeded from doc-scan; rewritten by T7 capture)
├── setup/
│   ├── _lib.sh                                # T2 (safe_symlink + logging)
│   ├── parse_toml.py                          # T3
│   ├── write_toml.py                          # T4
│   ├── requirements.txt                       # T4 (pins tomlkit)
│   ├── setup.sh                               # T5–T12 (each step is its own task)
│   ├── capture.sh                             # T13
│   └── contribute.sh                          # T14
├── skills/
│   ├── _lib/load_app_config.sh                # T16 (shared helper for templated skills)
│   ├── commit/SKILL.md                        # T15 (lifted verbatim)
│   ├── linear-pm/{SKILL.md,scripts,templates} # T15 (lifted verbatim)
│   ├── release/{SKILL.md,scripts/release.sh}  # T17
│   ├── ios-build/{SKILL.md,scripts/build.sh}  # T18
│   ├── app-preview/{SKILL.md,scripts/*}       # T19
│   └── contribute/SKILL.md                    # T14
├── agents/{image-parser.md,web-researcher.md} # T15
├── hooks/{shellcheck-on-edit.sh,app-build-reminder.sh} # T15
├── commands/{fix.md,preview.md,team.md,linear-*.md}    # T15
├── scripts/{show-advisor.sh,statusline.sh}    # T15
├── templates/
│   ├── app.yml.example                        # T16
│   ├── home-CLAUDE.md                         # T6
│   ├── user-settings.json                     # T6
│   └── skill.md.example                       # T14 (contribute scaffolding source)
├── tests/
│   ├── bats/
│   │   ├── helpers.bash                       # T2
│   │   ├── mocks/{claude,npx,gh,curl}         # T2
│   │   ├── safe_symlink.bats                  # T2
│   │   ├── parse_toml.bats                    # T3
│   │   ├── setup.bats                         # T5, extended T7–T12
│   │   ├── capture.bats                       # T13
│   │   ├── contribute.bats                    # T14
│   │   └── load_app_config.bats               # T16
│   ├── pytest/
│   │   ├── test_parse_toml.py                 # T3
│   │   └── test_write_toml.py                 # T4
│   └── fixtures/
│       ├── live-state/                        # T13 (seeded ~/.claude snapshots)
│       └── expected/                          # T13
├── .github/workflows/test.yml                 # T20
└── docs/
    ├── superpowers/specs/2026-05-25-claude-skills-seed-design.md  # (already committed)
    └── superpowers/plans/2026-05-25-claude-skills-seed.md         # this file
```

Existing repo state: `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md` committed (root commit `f2a06c3`). Everything else is greenfield.

---

## Task 1: README + repo bootstrap

**Files:**
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
.DS_Store
*.bak.*
__pycache__/
*.pyc
.pytest_cache/
node_modules/
.tmp/
```

- [ ] **Step 2: Create `README.md`**

```markdown
# claude-skills

Seeding repo for Abhijit's Claude Code dev environment. Cloned on each machine, drives a reproducible install of marketplaces, plugins, npx-skills, custom skills, agents, hooks, and commands.

## Bootstrap a fresh machine

\`\`\`bash
git clone https://github.com/<owner>/claude-skills ~/projects/claude-skills
bash ~/projects/claude-skills/setup/setup.sh
\`\`\`

## Snapshot a machine's current state back into the repo

\`\`\`bash
bash setup/capture.sh
git diff   # review
\`\`\`

## Contribute from any repo or machine

\`\`\`bash
claude-skills-contribute --message "..." [--skill <new-skill-name>]
\`\`\`

## Layout

See `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md` for the design.
```

- [ ] **Step 3: Commit**

```bash
git add README.md .gitignore
git commit -m "$(cat <<'EOF'
chore: scaffold repo with README and gitignore

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared bash lib + `safe_symlink` with tests

**Files:**
- Create: `setup/_lib.sh`
- Create: `tests/bats/helpers.bash`
- Create: `tests/bats/mocks/{claude,npx,gh,curl}`
- Create: `tests/bats/safe_symlink.bats`

- [ ] **Step 1: Write `tests/bats/safe_symlink.bats` (failing)**

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  mkdir -p "${CLAUDE_SKILLS_HOME}/skills/example"
  mkdir -p "${TMP}/home/.claude/skills"
  export HOME="${TMP}/home"
  # shellcheck source=/dev/null
  source "${BATS_TEST_DIRNAME}/../../setup/_lib.sh"
}

teardown() { rm -rf "${TMP}"; }

@test "safe_symlink creates symlink when target absent" {
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.claude/skills/example" ]
  [ "$(readlink "${HOME}/.claude/skills/example")" = "${CLAUDE_SKILLS_HOME}/skills/example" ]
}

@test "safe_symlink is idempotent when correct symlink exists" {
  ln -s "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already correct"* ]]
}

@test "safe_symlink warns and skips when target is a foreign symlink" {
  ln -s "/some/other/path" "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -eq 0 ]
  [[ "$output" == *"foreign symlink"* ]]
  [ "$(readlink "${HOME}/.claude/skills/example")" = "/some/other/path" ]
}

@test "safe_symlink errors when target is a regular file" {
  echo "real file" > "${HOME}/.claude/skills/example"
  run safe_symlink "${CLAUDE_SKILLS_HOME}/skills/example" "${HOME}/.claude/skills/example"
  [ "$status" -ne 0 ]
  [[ "$output" == *"regular file"* ]]
}
```

- [ ] **Step 2: Write `tests/bats/helpers.bash`**

```bash
# Common bats helpers. Each test file `load helpers` to get them.

# Prepend the mocks dir to PATH so calls to `claude`, `npx`, `gh`, `curl` hit our stubs.
export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"

# Recorded-call log: mocks append their argv here so tests can inspect it.
export MOCK_CALL_LOG="${BATS_TMPDIR}/mock-calls.log"
: > "${MOCK_CALL_LOG}"
```

- [ ] **Step 3: Write `tests/bats/mocks/claude`**

```bash
#!/usr/bin/env bash
echo "claude $*" >> "${MOCK_CALL_LOG:-/dev/null}"
case "$1" in
  --version) echo "claude 1.0.0-test" ;;
  plugin)
    case "$2" in
      marketplace) case "$3" in list) ;; add|update) ;; esac ;;
      list) ;;
      install|update) ;;
    esac
    ;;
  update) ;;
esac
exit 0
```

Make executable: `chmod +x tests/bats/mocks/claude`.

- [ ] **Step 4: Write `tests/bats/mocks/{npx,gh,curl}` analogues**

Each is the same shape — log argv, return 0, emit any canned output the tests need. Files:

```bash
# tests/bats/mocks/npx
#!/usr/bin/env bash
echo "npx $*" >> "${MOCK_CALL_LOG:-/dev/null}"
exit 0
```

```bash
# tests/bats/mocks/gh
#!/usr/bin/env bash
echo "gh $*" >> "${MOCK_CALL_LOG:-/dev/null}"
case "$1" in
  auth) [[ "$2" == "status" ]] && exit 0 ;;
  pr)   echo "https://example/pr/1" ;;
esac
exit 0
```

```bash
# tests/bats/mocks/curl
#!/usr/bin/env bash
echo "curl $*" >> "${MOCK_CALL_LOG:-/dev/null}"
exit 0
```

`chmod +x` all three.

- [ ] **Step 5: Run the failing tests**

Run: `bats tests/bats/safe_symlink.bats`
Expected: 4 tests fail because `setup/_lib.sh` does not exist yet.

- [ ] **Step 6: Implement `setup/_lib.sh`**

```bash
#!/usr/bin/env bash
# Shared helpers for setup.sh / capture.sh / contribute.sh. Source only — do not exec.

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
info()  { printf "  → %s\n" "$*"; }
warn()  { printf "  ! %s\n" "$*" >&2; }
fail()  { printf "  ✗ %s\n" "$*" >&2; return 1; }

# safe_symlink <src> <dst>
# Create dst as symlink to src, but never silently clobber existing state.
safe_symlink() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "${dst}")"
  if [[ -L "${dst}" ]]; then
    local current
    current="$(readlink "${dst}")"
    if [[ "${current}" == "${src}" ]]; then
      info "symlink ${dst} already correct"
      return 0
    fi
    warn "foreign symlink at ${dst} → ${current}; leaving it alone"
    return 0
  fi
  if [[ -e "${dst}" ]]; then
    fail "regular file or directory at ${dst}; refusing to clobber"
    return 1
  fi
  ln -s "${src}" "${dst}"
  info "linked ${dst} → ${src}"
}

ensure_path() {
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) export PATH="${HOME}/.local/bin:${PATH}" ;;
  esac
}

python_check() {
  if ! command -v python3 >/dev/null 2>&1; then
    fail "python3 not found; install Python 3.11+" || return 1
  fi
  local v
  v="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  awk -v v="${v}" 'BEGIN{ if (v+0 < 3.11) exit 1 }' || {
    fail "python3 ${v} too old; need 3.11+" || return 1
  }
}

gh_auth_check() {
  command -v gh >/dev/null 2>&1 || { fail "gh CLI not installed" || return 1; }
  gh auth status >/dev/null 2>&1 || { fail "gh not authenticated; run 'gh auth login'" || return 1; }
}
```

- [ ] **Step 7: Run the tests, expect green**

Run: `bats tests/bats/safe_symlink.bats`
Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add setup/_lib.sh tests/
git commit -m "$(cat <<'EOF'
feat(setup): add _lib.sh with safe_symlink + bats harness

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `parse_toml.py` (read) + pytest

**Files:**
- Create: `setup/parse_toml.py`
- Create: `tests/pytest/test_parse_toml.py`
- Create: `tests/pytest/conftest.py`

- [ ] **Step 1: Write failing pytest `tests/pytest/test_parse_toml.py`**

```python
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
```

- [ ] **Step 2: Create `tests/pytest/conftest.py` (empty placeholder for pytest discovery)**

```python
# Intentionally empty — pytest needs this to treat the dir as a package root.
```

- [ ] **Step 3: Run tests, expect failure**

Run: `pytest tests/pytest/test_parse_toml.py -v`
Expected: ImportError or "no such file" because `setup/parse_toml.py` is missing.

- [ ] **Step 4: Implement `setup/parse_toml.py`**

```python
#!/usr/bin/env python3
"""Read claude-setup.toml and emit a JSON-encoded list for one section.

Usage: parse_toml.py <toml-path> <section>
  section ∈ {marketplaces, plugins, skills, dotfiles, custom_skills}

Reads from <toml-path> (use "/dev/stdin" to pipe).  Always emits JSON to stdout.
Schema validation: rejects unknown meta.schema_version.
"""

import json
import sys
from pathlib import Path

try:
    import tomllib  # py3.11+
except ImportError:  # pragma: no cover
    sys.stderr.write("python3.11+ required (need tomllib)\n")
    sys.exit(2)

SUPPORTED_SCHEMA = 1


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: parse_toml.py <toml-path> <section>\n")
        return 2
    toml_path, section = sys.argv[1], sys.argv[2]
    if toml_path == "/dev/stdin":
        data = tomllib.loads(sys.stdin.read())
    else:
        with Path(toml_path).open("rb") as f:
            data = tomllib.load(f)

    meta = data.get("meta", {})
    if meta.get("schema_version") != SUPPORTED_SCHEMA:
        sys.stderr.write(
            f"unsupported schema_version: {meta.get('schema_version')!r} "
            f"(expected {SUPPORTED_SCHEMA})\n"
        )
        return 2

    if section in ("marketplaces", "plugins", "skills"):
        items = data.get(section, []) or []
        if section == "plugins":
            items = [{"name": i["name"], "marketplace": i["marketplace"],
                      "pin": i.get("pin")} for i in items]
        print(json.dumps(items))
        return 0

    if section in ("dotfiles", "custom_skills"):
        print(json.dumps(data.get(section, {})))
        return 0

    sys.stderr.write(f"unknown section: {section}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests, expect green**

Run: `pytest tests/pytest/test_parse_toml.py -v`
Expected: 4 passed.

- [ ] **Step 6: Add bats wrapper test `tests/bats/parse_toml.bats`**

```bash
#!/usr/bin/env bats

load helpers

@test "parse_toml emits marketplaces JSON" {
  TOML="$(mktemp)"
  cat >"${TOML}" <<EOF
[meta]
schema_version = 1
[[marketplaces]]
name = "a"
repo = "owner/a"
EOF
  run python3 "${BATS_TEST_DIRNAME}/../../setup/parse_toml.py" "${TOML}" marketplaces
  [ "$status" -eq 0 ]
  [[ "$output" == *'"name": "a"'* ]]
}
```

- [ ] **Step 7: Run bats, expect green; commit**

```bash
bats tests/bats/parse_toml.bats
git add setup/parse_toml.py tests/
git commit -m "$(cat <<'EOF'
feat(setup): add parse_toml.py with pytest + bats coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `write_toml.py` (capture) + pytest round-trip

**Files:**
- Create: `setup/write_toml.py`
- Create: `setup/requirements.txt`
- Create: `tests/pytest/test_write_toml.py`

- [ ] **Step 1: Write `setup/requirements.txt`**

```
tomlkit>=0.13,<1.0
pytest>=7.4
```

- [ ] **Step 2: Install locally (one-time dev convenience)**

Run: `pip3 install --user -r setup/requirements.txt`

- [ ] **Step 3: Write failing `tests/pytest/test_write_toml.py`**

```python
import json
import subprocess
import textwrap
from pathlib import Path

WRITER = Path(__file__).resolve().parents[2] / "setup" / "write_toml.py"
PARSER = Path(__file__).resolve().parents[2] / "setup" / "parse_toml.py"


def write(initial: str, section: str, payload) -> str:
    p = Path("/tmp/write-toml-test.toml")
    p.write_text(initial)
    subprocess.check_call(
        ["python3", str(WRITER), str(p), section],
        input=json.dumps(payload), text=True,
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
```

- [ ] **Step 4: Run tests, expect failure**

Run: `pytest tests/pytest/test_write_toml.py -v`

- [ ] **Step 5: Implement `setup/write_toml.py`**

```python
#!/usr/bin/env python3
"""Rewrite one section of claude-setup.toml from JSON stdin, preserving comments.

Usage: write_toml.py <toml-path> <section>
Reads a JSON array (or object for dotfiles/custom_skills) from stdin.
"""

import json
import sys
from pathlib import Path

try:
    import tomlkit
except ImportError:  # pragma: no cover
    sys.stderr.write("tomlkit not installed; run: pip3 install --user tomlkit\n")
    sys.exit(2)

ARRAY_SECTIONS = {"marketplaces", "plugins", "skills"}
TABLE_SECTIONS = {"dotfiles", "custom_skills"}


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: write_toml.py <toml-path> <section>\n")
        return 2
    path, section = Path(sys.argv[1]), sys.argv[2]
    payload = json.loads(sys.stdin.read())

    doc = tomlkit.parse(path.read_text()) if path.exists() else tomlkit.document()
    if "meta" not in doc:
        doc["meta"] = tomlkit.table()
        doc["meta"]["schema_version"] = 1

    if section in ARRAY_SECTIONS:
        if not isinstance(payload, list):
            sys.stderr.write(f"{section}: expected list, got {type(payload).__name__}\n")
            return 2
        new_array = tomlkit.aot()
        for entry in payload:
            t = tomlkit.table()
            for k, v in entry.items():
                if v is None:
                    continue
                t[k] = v
            new_array.append(t)
        doc[section] = new_array
    elif section in TABLE_SECTIONS:
        if not isinstance(payload, dict):
            sys.stderr.write(f"{section}: expected dict, got {type(payload).__name__}\n")
            return 2
        t = tomlkit.table()
        for k, v in payload.items():
            t[k] = v
        doc[section] = t
    else:
        sys.stderr.write(f"unknown section: {section}\n")
        return 2

    path.write_text(tomlkit.dumps(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Run tests, expect green**

Run: `pytest tests/pytest/test_write_toml.py -v`

- [ ] **Step 7: Commit**

```bash
git add setup/write_toml.py setup/requirements.txt tests/pytest/test_write_toml.py
git commit -m "$(cat <<'EOF'
feat(setup): add write_toml.py for capture (tomlkit, comment-preserving)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `setup.sh` skeleton + preflight (step 1)

**Files:**
- Create: `setup/setup.sh`
- Create: `tests/bats/setup.bats`

- [ ] **Step 1: Write failing `tests/bats/setup.bats` (preflight-only initially)**

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
}

teardown() { rm -rf "${TMP}"; }

@test "setup.sh --dry-run preflight succeeds" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run --only preflight
  [ "$status" -eq 0 ]
  [[ "$output" == *"preflight"* ]]
}

@test "setup.sh --only=bogus errors" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only bogus
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 2: Run, expect failure**

Run: `bats tests/bats/setup.bats`

- [ ] **Step 3: Implement `setup/setup.sh` skeleton**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export CLAUDE_SKILLS_HOME="${CLAUDE_SKILLS_HOME:-${REPO_ROOT}}"

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

DRY_RUN=0
VERBOSE=0
ONLY=""
declare -A SKIP=()

ALL_STEPS=(preflight claude marketplaces plugins skills dotfiles symlinks summary)

usage() {
  cat <<EOF
Usage: setup.sh [--dry-run] [--verbose] [--only <step>] [--skip-<step>]
Steps: ${ALL_STEPS[*]}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --verbose)        VERBOSE=1 ;;
    --only)           ONLY="$2"; shift ;;
    --skip-claude|--skip-marketplaces|--skip-plugins|--skip-skills|--skip-dotfiles|--skip-symlinks)
                      SKIP["${1#--skip-}"]=1 ;;
    -h|--help)        usage; exit 0 ;;
    *)                usage; exit 2 ;;
  esac
  shift
done

if [[ -n "${ONLY}" ]]; then
  found=0
  for s in "${ALL_STEPS[@]}"; do [[ "${s}" == "${ONLY}" ]] && found=1; done
  [[ "${found}" -eq 1 ]] || { fail "unknown step: ${ONLY}"; exit 2; }
fi

run_step() {
  local name="$1"
  [[ -n "${ONLY}" && "${ONLY}" != "${name}" ]] && return 0
  [[ -n "${SKIP[${name}]:-}" ]] && { info "skipping ${name}"; return 0; }
  bold "step: ${name}"
  "step_${name}"
}

step_preflight() {
  ensure_path
  python_check
  info "preflight ok"
}
step_claude()        { info "(claude install/update — to be implemented in T6)"; }
step_marketplaces()  { info "(marketplaces — to be implemented in T7)"; }
step_plugins()       { info "(plugins — to be implemented in T8)"; }
step_skills()        { info "(npx skills — to be implemented in T9)"; }
step_dotfiles()      { info "(dotfiles — to be implemented in T10)"; }
step_symlinks()      { info "(symlinks — to be implemented in T11)"; }
step_summary()       { info "(summary — to be implemented in T12)"; }

for s in "${ALL_STEPS[@]}"; do run_step "${s}"; done
```

`chmod +x setup/setup.sh`.

- [ ] **Step 4: Run tests, expect green**

Run: `bats tests/bats/setup.bats`

- [ ] **Step 5: Commit**

```bash
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): scaffold setup.sh with preflight + step dispatcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Seed `claude-setup.toml` + dotfile templates from current machine

**Files:**
- Create: `claude-setup.toml`
- Create: `templates/home-CLAUDE.md`
- Create: `templates/user-settings.json`

- [ ] **Step 1: Copy live dotfiles into templates/**

```bash
cp ~/CLAUDE.md templates/home-CLAUDE.md
cp ~/.claude/settings.json templates/user-settings.json
```

- [ ] **Step 2: Author `claude-setup.toml` by hand from live state**

Reference live state: 4 marketplaces (`claude-plugins-official`, `claude-code-skills`, `caveman`, `visual-explainer-marketplace`), 18 user-scope plugins (from `~/.claude/plugins/installed_plugins.json`), 6 npx-skills (from `~/.agents/.skill-lock.json`).

```toml
[meta]
schema_version = 1

# Marketplaces — re-added idempotently by setup.sh.
[[marketplaces]]
name = "claude-plugins-official"
repo = "anthropics/claude-plugins-official"

[[marketplaces]]
name = "claude-code-skills"
repo = "alirezarezvani/claude-skills"

[[marketplaces]]
name = "caveman"
repo = "JuliusBrussee/caveman"

[[marketplaces]]
name = "visual-explainer-marketplace"
repo = "nicobailon/visual-explainer"

# User-scope plugin installs.
[[plugins]]
name = "claude-code-setup"
marketplace = "claude-plugins-official"
[[plugins]]
name = "engineering-advanced-skills"
marketplace = "claude-code-skills"
[[plugins]]
name = "engineering-skills"
marketplace = "claude-code-skills"
[[plugins]]
name = "huggingface-skills"
marketplace = "claude-plugins-official"
[[plugins]]
name = "linear"
marketplace = "claude-plugins-official"
[[plugins]]
name = "llm-wiki"
marketplace = "claude-code-skills"
[[plugins]]
name = "mcp-server-dev"
marketplace = "claude-plugins-official"
[[plugins]]
name = "plugin-dev"
marketplace = "claude-plugins-official"
[[plugins]]
name = "pyright-lsp"
marketplace = "claude-plugins-official"
[[plugins]]
name = "qodo-skills"
marketplace = "claude-plugins-official"
[[plugins]]
name = "security-guidance"
marketplace = "claude-plugins-official"
[[plugins]]
name = "skill-creator"
marketplace = "claude-plugins-official"
[[plugins]]
name = "superpowers"
marketplace = "claude-plugins-official"
[[plugins]]
name = "frontend-design"
marketplace = "claude-plugins-official"
[[plugins]]
name = "code-review"
marketplace = "claude-plugins-official"
[[plugins]]
name = "claude-md-management"
marketplace = "claude-plugins-official"
[[plugins]]
name = "caveman"
marketplace = "caveman"
[[plugins]]
name = "visual-explainer"
marketplace = "visual-explainer-marketplace"

# npx-skills entries.
[[skills]]
source = "vercel-labs/skills"
name   = "find-skills"
[[skills]]
source = "remotion-dev/skills"
name   = "remotion-best-practices"
[[skills]]
source = "avdlee/swift-concurrency-agent-skill"
name   = "swift-concurrency"
[[skills]]
source = "avdlee/swiftui-agent-skill"
name   = "swiftui-expert-skill"
[[skills]]
source = "avdlee/xcode-build-optimization-agent-skill"
name   = "xcode-build-fixer"
[[skills]]
source = "zyuapp/agent-skills"
name   = "xcodegen-cli"

[dotfiles]
home_claude_md = "templates/home-CLAUDE.md"
user_settings  = "templates/user-settings.json"

[custom_skills]
symlink_targets = ["skills", "agents", "commands"]
```

- [ ] **Step 3: Validate by parsing**

Run: `python3 setup/parse_toml.py claude-setup.toml marketplaces`
Expected: JSON listing all 4 marketplaces.

- [ ] **Step 4: Commit**

```bash
git add claude-setup.toml templates/
git commit -m "$(cat <<'EOF'
chore(setup): seed claude-setup.toml + dotfile templates from laptop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `setup.sh` step — marketplaces

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Extend `tests/bats/setup.bats` with marketplaces test**

Append:

```bash
@test "setup.sh --only marketplaces adds + updates" {
  cp "${CLAUDE_SKILLS_HOME}/claude-setup.toml" "${TMP}/copy.toml"
  CLAUDE_SETUP_TOML="${TMP}/copy.toml" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only marketplaces
  [ "$status" -eq 0 ]
  grep -q "claude plugin marketplace" "${MOCK_CALL_LOG}"
}
```

- [ ] **Step 2: Run, expect failure**

Run: `bats tests/bats/setup.bats -f "marketplaces adds"`

- [ ] **Step 3: Replace `step_marketplaces` in `setup/setup.sh`**

```bash
step_marketplaces() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" marketplaces)"
  local existing
  existing="$(claude plugin marketplace list 2>/dev/null || true)"
  python3 -c "import json,sys; [print(e['name']+'\t'+e['repo']) for e in json.loads(sys.argv[1])]" "${entries}" \
    | while IFS=$'\t' read -r name repo; do
      if printf '%s\n' "${existing}" | grep -qw "${name}"; then
        info "marketplace ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace update "${name}" || warn "update ${name} failed"
      else
        info "marketplace ${name}: add (${repo})"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin marketplace add "${repo}" || warn "add ${name} failed"
      fi
    done
}
```

- [ ] **Step 4: Run tests green**

Run: `bats tests/bats/setup.bats`

- [ ] **Step 5: Commit**

```bash
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement marketplaces step

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `setup.sh` step — plugins

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Add bats test (failing)**

```bash
@test "setup.sh --only plugins installs every plugin in toml" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only plugins
  [ "$status" -eq 0 ]
  grep -c "claude plugin install" "${MOCK_CALL_LOG}" >/dev/null
}

@test "setup.sh plugins step honors pin if present" {
  cat >"${TMP}/pinned.toml" <<EOF
[meta]
schema_version = 1
[[plugins]]
name = "p"
marketplace = "m"
pin = "v1.2"
EOF
  CLAUDE_SETUP_TOML="${TMP}/pinned.toml" run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only plugins
  [ "$status" -eq 0 ]
  grep -q "v1.2" "${MOCK_CALL_LOG}"
}
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Replace `step_plugins`**

```bash
step_plugins() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" plugins)"
  local installed
  installed="$(claude plugin list --scope user 2>/dev/null || true)"
  python3 -c "
import json, sys
for e in json.loads(sys.argv[1]):
    pin = e.get('pin')
    print('\t'.join([e['name'], e['marketplace'], pin or '']))
" "${entries}" \
    | while IFS=$'\t' read -r name market pin; do
      local spec="${name}@${market}"
      if printf '%s\n' "${installed}" | grep -qw "${name}"; then
        info "plugin ${name}: update"
        [[ "${DRY_RUN}" -eq 1 ]] || claude plugin update "${spec}" || warn "update ${spec} failed"
      else
        if [[ -n "${pin}" ]]; then
          info "plugin ${name}: install (pinned ${pin})"
          [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${spec}" --version "${pin}" --scope user || warn "install ${spec}@${pin} failed"
        else
          info "plugin ${name}: install"
          [[ "${DRY_RUN}" -eq 1 ]] || claude plugin install "${spec}" --scope user || warn "install ${spec} failed"
        fi
      fi
    done
}
```

- [ ] **Step 4: Run tests green; commit**

```bash
bats tests/bats/setup.bats
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement plugins step with optional pin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `setup.sh` step — npx skills

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Add bats test (failing)**

```bash
@test "setup.sh --only skills runs npx skills add per entry" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only skills
  [ "$status" -eq 0 ]
  grep -c "npx -y skills add" "${MOCK_CALL_LOG}" | grep -q "[1-9]"
}
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Replace `step_skills`**

```bash
step_skills() {
  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found; skipping npx skills"
    return 0
  fi
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local entries
  entries="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" skills)"
  python3 -c "
import json, sys
for e in json.loads(sys.argv[1]):
    print(e['source'] + '@' + e['name'])
" "${entries}" \
    | while IFS= read -r spec; do
      info "npx skill: ${spec}"
      [[ "${DRY_RUN}" -eq 1 ]] || npx -y skills add "${spec}" -g -y || warn "skills add ${spec} failed"
    done
  [[ "${DRY_RUN}" -eq 1 ]] || npx -y skills update -g -y 2>/dev/null || true
}
```

- [ ] **Step 4: Run tests green; commit**

```bash
bats tests/bats/setup.bats
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement npx skills step

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `setup.sh` step — dotfiles

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Add bats test**

```bash
@test "setup.sh --only dotfiles copies templates with backup" {
  echo "old" > "${HOME}/CLAUDE.md"
  mkdir -p "${HOME}/.claude"
  echo "{\"old\":true}" > "${HOME}/.claude/settings.json"
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only dotfiles
  [ "$status" -eq 0 ]
  diff -q "${CLAUDE_SKILLS_HOME}/templates/home-CLAUDE.md" "${HOME}/CLAUDE.md"
  ls "${HOME}/CLAUDE.md.bak."*
}
```

- [ ] **Step 2: Replace `step_dotfiles`**

```bash
step_dotfiles() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local dotfiles_json
  dotfiles_json="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" dotfiles)"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  install_one() {
    local src_rel="$1" dst="$2"
    local src="${REPO_ROOT}/${src_rel}"
    [[ -f "${src}" ]] || { warn "missing template ${src}; skipping"; return 0; }
    if [[ -f "${dst}" ]] && ! cmp -s "${src}" "${dst}"; then
      cp "${dst}" "${dst}.bak.${timestamp}"
      info "backed up ${dst}"
    fi
    [[ "${DRY_RUN}" -eq 1 ]] || cp "${src}" "${dst}"
    info "installed ${dst}"
  }

  local home_md user_settings
  home_md="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('home_claude_md',''))" "${dotfiles_json}")"
  user_settings="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('user_settings',''))" "${dotfiles_json}")"

  mkdir -p "${HOME}/.claude"
  [[ -n "${home_md}" ]]       && install_one "${home_md}"       "${HOME}/CLAUDE.md"
  [[ -n "${user_settings}" ]] && install_one "${user_settings}" "${HOME}/.claude/settings.json"
}
```

- [ ] **Step 3: Run tests green; commit**

```bash
bats tests/bats/setup.bats
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement dotfiles step with timestamped backups

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `setup.sh` step — custom skill symlinks + bin shim

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Add bats test**

```bash
@test "setup.sh --only symlinks fans out skills/agents/commands" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ "$status" -eq 0 ]
}

@test "setup.sh symlinks step installs claude-skills-contribute shim" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --only symlinks
  [ -L "${HOME}/.local/bin/claude-skills-contribute" ]
}
```

(Note: the first test will pass even with empty skills/ dirs — it just shouldn't error. The second locks the bin shim.)

- [ ] **Step 2: Replace `step_symlinks`**

```bash
step_symlinks() {
  local toml="${CLAUDE_SETUP_TOML:-${REPO_ROOT}/claude-setup.toml}"
  local custom_json
  custom_json="$(python3 "${SCRIPT_DIR}/parse_toml.py" "${toml}" custom_skills)"
  local dirs
  dirs="$(python3 -c "import json,sys; print('\n'.join(json.loads(sys.argv[1]).get('symlink_targets', [])))" "${custom_json}")"

  while IFS= read -r dir; do
    [[ -z "${dir}" ]] && continue
    local src_root="${REPO_ROOT}/${dir}"
    local dst_root="${HOME}/.claude/${dir}"
    [[ -d "${src_root}" ]] || { warn "no ${src_root}; skipping"; continue; }
    mkdir -p "${dst_root}"
    for entry in "${src_root}"/*; do
      [[ -e "${entry}" ]] || continue
      local base
      base="$(basename "${entry}")"
      [[ "${base}" == "_lib" ]] && continue   # internal helpers are not skills
      safe_symlink "${entry}" "${dst_root}/${base}" || warn "symlink ${dst_root}/${base} failed"
    done
  done <<< "${dirs}"

  mkdir -p "${HOME}/.local/bin"
  safe_symlink "${REPO_ROOT}/setup/contribute.sh" "${HOME}/.local/bin/claude-skills-contribute"
}
```

- [ ] **Step 3: Run tests; commit**

```bash
bats tests/bats/setup.bats
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement custom skill symlink fan-out + contribute shim

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `setup.sh` step — claude binary + summary + exit codes

**Files:**
- Modify: `setup/setup.sh`
- Modify: `tests/bats/setup.bats`

- [ ] **Step 1: Add bats tests**

```bash
@test "setup.sh full run is idempotent on rerun" {
  CLAUDE_SETUP_TOML="${CLAUDE_SKILLS_HOME}/claude-setup.toml" \
    bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  run bash "${CLAUDE_SKILLS_HOME}/setup/setup.sh" --dry-run
  [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Replace `step_claude` and `step_summary`, add accounting**

```bash
declare -i FAILS=0 WARNS=0

step_claude() {
  if ! command -v claude >/dev/null 2>&1; then
    info "installing claude (official native installer)"
    [[ "${DRY_RUN}" -eq 1 ]] || curl -fsSL https://claude.ai/install.sh | bash || { FAILS+=1; fail "installer failed"; return; }
    ensure_path
  fi
  info "claude version: $(claude --version 2>/dev/null || echo unknown)"
  [[ "${DRY_RUN}" -eq 1 ]] || claude update 2>/dev/null || { WARNS+=1; warn "claude update failed"; }
}

step_summary() {
  bold "summary"
  printf "  fails=%d warns=%d\n" "${FAILS}" "${WARNS}"
  if (( FAILS > 0 )); then exit 1
  elif (( WARNS > 0 )); then exit 2
  else exit 0
  fi
}
```

Replace the bare `for s in ALL_STEPS` loop with one that also tolerates per-step failures by incrementing `FAILS`.

- [ ] **Step 3: Run tests green; commit**

```bash
bats tests/bats/setup.bats
git add setup/setup.sh tests/bats/setup.bats
git commit -m "$(cat <<'EOF'
feat(setup): implement claude binary step + exit-code accounting

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `capture.sh` + round-trip test + fixtures

**Files:**
- Create: `setup/capture.sh`
- Create: `tests/bats/capture.bats`
- Create: `tests/fixtures/live-state/{settings.json,CLAUDE.md,known_marketplaces.json,installed_plugins.json,skill-lock.json}`
- Create: `tests/fixtures/expected/claude-setup.toml`

- [ ] **Step 1: Author fixture inputs**

Sample minimal `tests/fixtures/live-state/known_marketplaces.json`:

```json
{
  "alpha":  { "source": { "source": "github", "repo": "owner/alpha" } },
  "beta":   { "source": { "source": "github", "repo": "owner/beta"  } }
}
```

Analogous minimal `installed_plugins.json`:

```json
{
  "plugins": {
    "p1@alpha": [{ "scope": "user" }],
    "p2@beta":  [{ "scope": "user" }]
  }
}
```

Sample `skill-lock.json`:

```json
{
  "version": 3,
  "skills": {
    "find-skills": { "source": "vercel-labs/skills", "sourceType": "github" }
  }
}
```

And `tests/fixtures/expected/claude-setup.toml` matching the merged output.

- [ ] **Step 2: Write failing `tests/bats/capture.bats`**

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.claude/plugins" "${HOME}/.agents"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/known_marketplaces.json" "${HOME}/.claude/plugins/"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/installed_plugins.json"  "${HOME}/.claude/plugins/"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/skill-lock.json"         "${HOME}/.agents/.skill-lock.json"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/CLAUDE.md"               "${HOME}/CLAUDE.md"
  cp "${BATS_TEST_DIRNAME}/../fixtures/live-state/settings.json"           "${HOME}/.claude/settings.json"
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  mkdir -p "${CLAUDE_SKILLS_HOME}/templates"
  cat >"${CLAUDE_SKILLS_HOME}/claude-setup.toml" <<EOF
[meta]
schema_version = 1
EOF
}

teardown() { rm -rf "${TMP}"; }

@test "capture.sh produces expected TOML" {
  run bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ "$status" -eq 0 ]
  diff -u "${BATS_TEST_DIRNAME}/../fixtures/expected/claude-setup.toml" "${CLAUDE_SKILLS_HOME}/claude-setup.toml"
}

@test "capture.sh copies dotfiles" {
  bash "${BATS_TEST_DIRNAME}/../../setup/capture.sh"
  [ -f "${CLAUDE_SKILLS_HOME}/templates/home-CLAUDE.md" ]
  [ -f "${CLAUDE_SKILLS_HOME}/templates/user-settings.json" ]
}
```

- [ ] **Step 3: Implement `setup/capture.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${CLAUDE_SKILLS_HOME:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

TOML="${REPO_ROOT}/claude-setup.toml"

bold "1/4  Dotfiles"
[[ -f "${HOME}/CLAUDE.md" ]]              && cp "${HOME}/CLAUDE.md"              "${REPO_ROOT}/templates/home-CLAUDE.md"
[[ -f "${HOME}/.claude/settings.json" ]]  && cp "${HOME}/.claude/settings.json"  "${REPO_ROOT}/templates/user-settings.json"

write_section() {
  local section="$1" payload="$2"
  printf '%s' "${payload}" | python3 "${SCRIPT_DIR}/write_toml.py" "${TOML}" "${section}"
}

bold "2/4  Marketplaces"
MARKETS_JSON="${HOME}/.claude/plugins/known_marketplaces.json"
if [[ -f "${MARKETS_JSON}" ]]; then
  payload="$(python3 - "${MARKETS_JSON}" <<'PY'
import json, sys
src = sys.argv[1]
data = json.load(open(src))
out = []
for name, entry in sorted(data.items()):
    src = entry.get("source", {})
    if src.get("source") != "github":
        continue
    repo = src.get("repo")
    if repo:
        out.append({"name": name, "repo": repo})
print(json.dumps(out))
PY
)"
  write_section marketplaces "${payload}"
fi

bold "3/4  Plugins (user scope)"
INSTALLED_JSON="${HOME}/.claude/plugins/installed_plugins.json"
if [[ -f "${INSTALLED_JSON}" ]]; then
  payload="$(python3 - "${INSTALLED_JSON}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
out = []
for full, scopes in sorted(data.get("plugins", {}).items()):
    if not any(s.get("scope") == "user" for s in scopes):
        continue
    name, _, market = full.partition("@")
    out.append({"name": name, "marketplace": market})
print(json.dumps(out))
PY
)"
  write_section plugins "${payload}"
fi

bold "4/4  npx-skills"
LOCK="${HOME}/.agents/.skill-lock.json"
if [[ -f "${LOCK}" ]]; then
  payload="$(python3 - "${LOCK}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
out = []
for name, meta in sorted(data.get("skills", {}).items()):
    src = meta.get("source")
    if not src:
        continue
    out.append({"source": src, "name": name})
print(json.dumps(out))
PY
)"
  write_section skills "${payload}"
fi

bold "Done. Review with:  git -C \"${REPO_ROOT}\" diff"
```

`chmod +x setup/capture.sh`.

- [ ] **Step 4: Generate `tests/fixtures/expected/claude-setup.toml`** by running capture against fixtures once, then hand-curating the comment block at the top.

- [ ] **Step 5: Run tests green; commit**

```bash
bats tests/bats/capture.bats
git add setup/capture.sh tests/
git commit -m "$(cat <<'EOF'
feat(setup): implement capture.sh + round-trip bats coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `contribute.sh` + skill + slash command

**Files:**
- Create: `setup/contribute.sh`
- Create: `skills/contribute/SKILL.md`
- Create: `commands/contribute-skill.md`
- Create: `templates/skill.md.example`
- Create: `tests/bats/contribute.bats`

- [ ] **Step 1: Write `templates/skill.md.example`**

```markdown
---
name: <skill-name>
description: <one-line trigger description; when should Claude pick this skill>
---

# <Skill Title>

## When to use

- <case 1>
- <case 2>

## Steps

1. <first step>
2. <second step>

## Hard rules

- <rule>
```

- [ ] **Step 2: Write failing `tests/bats/contribute.bats`**

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}/.local/bin"
  REAL_REPO="${BATS_TEST_DIRNAME}/../.."
  export CLAUDE_SKILLS_HOME="${TMP}/repo"
  git clone --quiet "${REAL_REPO}" "${CLAUDE_SKILLS_HOME}"
  git -C "${CLAUDE_SKILLS_HOME}" config user.email t@t
  git -C "${CLAUDE_SKILLS_HOME}" config user.name  Tester
  cd "${CLAUDE_SKILLS_HOME}"
}

teardown() { rm -rf "${TMP}"; }

@test "contribute.sh scaffolds a new skill on --skill" {
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --message "demo skill" --no-pr
  [ "$status" -eq 0 ]
  [ -f "${CLAUDE_SKILLS_HOME}/skills/demo/SKILL.md" ]
  git -C "${CLAUDE_SKILLS_HOME}" log --oneline | grep -q "demo"
}

@test "contribute.sh refuses on dirty tree" {
  echo dirty > "${CLAUDE_SKILLS_HOME}/dirty"
  run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --no-pr
  [ "$status" -ne 0 ]
  [[ "$output" == *"working tree dirty"* ]]
}

@test "contribute.sh preflights gh auth before mutating" {
  PATH_NO_GH="$(echo "$PATH" | tr ':' '\n' | grep -v mocks | paste -sd: -)"
  PATH="${PATH_NO_GH}" run bash "${CLAUDE_SKILLS_HOME}/setup/contribute.sh" --skill demo --message x
  [ "$status" -ne 0 ]
  [[ "$output" == *"gh"* ]]
}
```

- [ ] **Step 3: Implement `setup/contribute.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

REPO="${CLAUDE_SKILLS_HOME:-${HOME}/projects/claude-skills}"
[[ -d "${REPO}/.git" ]] || { fail "no claude-skills repo at ${REPO}; clone first"; exit 1; }

SKILL=""
MESSAGE=""
NO_PR=0
AUTO_MERGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)        SKILL="$2"; shift ;;
    --message)      MESSAGE="$2"; shift ;;
    --no-pr)        NO_PR=1 ;;
    --auto-merge)   AUTO_MERGE=1 ;;
    *) fail "unknown arg: $1"; exit 2 ;;
  esac
  shift
done

# Step 1: preflight
gh_auth_check

# Step 2: sync
cd "${REPO}"
if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree dirty at ${REPO}; commit or stash first"
  git status --short
  exit 1
fi
git fetch origin
git switch main 2>/dev/null || git switch master
git pull --ff-only

# Step 3: branch
slug="${SKILL:-${MESSAGE:-update}}"
slug="$(echo "${slug}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
branch="contrib/${slug}-$(date +%Y%m%d-%H%M)"
git switch -c "${branch}"

# Step 4: mutate
if [[ -n "${SKILL}" ]]; then
  dest="${REPO}/skills/${SKILL}"
  [[ -e "${dest}" ]] && { fail "skill ${SKILL} already exists"; exit 1; }
  mkdir -p "${dest}/scripts"
  sed "s/<skill-name>/${SKILL}/g" "${REPO}/templates/skill.md.example" > "${dest}/SKILL.md"
  info "scaffolded skills/${SKILL}/"
else
  bash "${SCRIPT_DIR}/capture.sh"
fi

# Step 5: validate
info "running tests"
if command -v bats >/dev/null 2>&1; then
  bats "${REPO}/tests/bats" || { fail "bats failing — leaving branch ${branch} for you to fix"; exit 1; }
fi
if command -v pytest >/dev/null 2>&1; then
  pytest "${REPO}/tests/pytest" -q || { fail "pytest failing — leaving branch ${branch}"; exit 1; }
fi
shellcheck "${REPO}"/setup/*.sh "${REPO}"/skills/_lib/*.sh 2>/dev/null || true

# Step 6: commit
if [[ -z "$(git status --porcelain)" ]]; then
  info "nothing to commit; aborting"
  git switch -
  git branch -d "${branch}"
  exit 0
fi
git add -A
msg="${MESSAGE:-chore: contribute via claude-skills-contribute}"
git commit -m "${msg}

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Step 7: push
git push -u origin "${branch}"

# Step 8: PR
if (( NO_PR == 0 )); then
  gh pr create --title "${msg}" --body "Automated contribution from claude-skills-contribute."
fi

# Step 9: merge
if (( AUTO_MERGE == 1 )); then
  gh pr merge --squash --delete-branch
fi

info "done"
```

`chmod +x setup/contribute.sh`.

- [ ] **Step 4: Author `skills/contribute/SKILL.md`**

```markdown
---
name: contribute
description: Contribute a change or new skill back to the claude-skills seeding repo from any working directory. Use when the user says "contribute this back", "add this to claude-skills", "share this skill", or invokes /contribute-skill. Wraps the claude-skills-contribute script: branches, validates, commits, opens a PR. Refuses on dirty tree and unauthenticated gh.
---

# Contribute to claude-skills

Drives `claude-skills-contribute` from any repo or machine.

## When to use

- User wrote a new custom skill locally and wants it shared.
- User changed an existing skill, agent, hook, or command in claude-skills and wants the change captured + reviewed.
- User installed/removed a Claude plugin or npx skill and wants the manifest snapshotted.

## Steps

1. Confirm the user's intent — capture state, or scaffold a new skill? Ask if ambiguous.
2. Run `claude-skills-contribute --skill <name> --message "<msg>"` for a brand-new skill, or `claude-skills-contribute --message "<msg>"` to capture live state.
3. Surface the PR URL printed by `gh`.
4. If `--no-pr` was used (e.g. offline), tell the user the branch name so they can push later.

## Hard rules

- Never run with `--auto-merge` unless the user explicitly asks.
- Refuse if `gh auth status` fails — tell the user to run `gh auth login` first.
- Do not stash or rewrite working tree state in the user's current repo. claude-skills-contribute operates on `$CLAUDE_SKILLS_HOME`, not the caller's cwd.
```

- [ ] **Step 5: Author `commands/contribute-skill.md`**

```markdown
---
description: Contribute a change or new skill back to claude-skills (creates branch + PR).
---

Invoke the `contribute` skill. Args:
- `--skill <name>` to scaffold a new skill
- `--message "<text>"` for the commit + PR title
- `--no-pr` to skip the PR step (push only)
- `--auto-merge` to squash-merge once CI passes (use sparingly)
```

- [ ] **Step 6: Run tests green; commit**

```bash
bats tests/bats/contribute.bats
git add setup/contribute.sh skills/contribute/ commands/contribute-skill.md templates/skill.md.example tests/bats/contribute.bats
git commit -m "$(cat <<'EOF'
feat(contribute): cross-repo contribute flow + skill + slash command

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Lift generic skills, agents, hooks, commands, scripts from doc-scan

**Files:**
- Create: `skills/commit/SKILL.md`
- Create: `skills/linear-pm/{SKILL.md,README.md,scripts/bootstrap.sh,templates/linear.yml.template}`
- Create: `agents/{image-parser.md,web-researcher.md}`
- Create: `hooks/{shellcheck-on-edit.sh,app-build-reminder.sh}` (rename `paperix-build-reminder.sh`)
- Create: `commands/{fix.md,preview.md,team.md,linear-block.md,linear-init.md,linear-new.md,linear-pick.md,linear-status.md,linear-sync.md}`
- Create: `scripts/{show-advisor.sh,statusline.sh}`

- [ ] **Step 1: Copy verbatim with one rename**

```bash
DOCSCAN=/Users/abhijitbansal/projects/doc-scan/.claude

# skills
cp -R "${DOCSCAN}/skills/commit"       skills/
cp -R "${DOCSCAN}/skills/linear-pm"    skills/

# agents
cp "${DOCSCAN}/agents/"*.md            agents/

# hooks — rename paperix-build-reminder → app-build-reminder
cp "${DOCSCAN}/hooks/shellcheck-on-edit.sh"    hooks/
cp "${DOCSCAN}/hooks/paperix-build-reminder.sh" hooks/app-build-reminder.sh

# commands
cp "${DOCSCAN}/commands/fix.md"       commands/
cp "${DOCSCAN}/commands/preview.md"   commands/
cp "${DOCSCAN}/commands/team.md"      commands/
cp "${DOCSCAN}/commands/linear-"*.md  commands/

# scripts
cp "${DOCSCAN}/scripts/show-advisor.sh"  scripts/
cp "${DOCSCAN}/scripts/statusline.sh"    scripts/
```

- [ ] **Step 2: Manually scan each copied file for any "Paperix" references**

Run: `grep -rn -i paperix skills/commit/ skills/linear-pm/ agents/ commands/ scripts/`
Expected: zero hits (these are all generic). If any hit, generalize inline (use `$APP_NAME`).

- [ ] **Step 3: Scan `hooks/app-build-reminder.sh`** for Paperix-specific paths.

Open the file, replace any literal `paperix` / `Paperix` / `paperix://` with template tokens or `$APP_NAME` resolved from `.claude/app.yml`. (Hook reads app config at runtime via `_lib/load_app_config.sh` once T16 lands; for now, leave a TODO comment in the hook and revisit in T16.)

- [ ] **Step 4: Commit**

```bash
git add skills/commit/ skills/linear-pm/ agents/ hooks/ commands/ scripts/
git commit -m "$(cat <<'EOF'
feat(skills): lift commit, linear-pm, agents, hooks, commands, scripts from doc-scan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `.claude/app.yml` schema + `load_app_config.sh` helper + bats

**Files:**
- Create: `skills/_lib/load_app_config.sh`
- Create: `templates/app.yml.example`
- Create: `tests/bats/load_app_config.bats`

- [ ] **Step 1: Write failing `tests/bats/load_app_config.bats`**

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  mkdir -p "${TMP}/proj/.claude"
  cat >"${TMP}/proj/.claude/app.yml" <<EOF
schema_version: 1
app:
  name: Paperix
  bundle_id: com.abhijit.paperix
  scheme: Paperix
  team_id: ABC123
  url_scheme: paperix
linear:
  team_key: PAP
EOF
  export REPO_ROOT
  REPO_ROOT="${BATS_TEST_DIRNAME}/../.."
}

teardown() { rm -rf "${TMP}"; }

@test "load_app_config exports keys from .claude/app.yml" {
  cd "${TMP}/proj"
  source "${REPO_ROOT}/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "Paperix" ]
  [ "${APP_BUNDLE_ID}" = "com.abhijit.paperix" ]
  [ "${APP_SCHEME}" = "Paperix" ]
  [ "${APP_TEAM_ID}" = "ABC123" ]
  [ "${APP_URL_SCHEME}" = "paperix" ]
  [ "${LINEAR_TEAM_KEY}" = "PAP" ]
}

@test "load_app_config walks up to find .claude/app.yml" {
  mkdir -p "${TMP}/proj/deep/nested"
  cd "${TMP}/proj/deep/nested"
  source "${REPO_ROOT}/skills/_lib/load_app_config.sh"
  [ "${APP_NAME}" = "Paperix" ]
}

@test "load_app_config errors when no app.yml is found" {
  cd "${TMP}"
  run bash -c "source '${REPO_ROOT}/skills/_lib/load_app_config.sh'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}
```

- [ ] **Step 2: Implement `skills/_lib/load_app_config.sh`**

```bash
#!/usr/bin/env bash
# Walk up from $PWD to find .claude/app.yml. Export APP_* and LINEAR_* env vars.
# Source this file from any templated skill's script. Fails (returns 1) if no
# app.yml is found or required keys are missing.

_find_app_yml() {
  local dir
  dir="$(pwd -P)"
  while [[ "${dir}" != "/" ]]; do
    if [[ -f "${dir}/.claude/app.yml" ]]; then
      printf '%s\n' "${dir}/.claude/app.yml"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
}

_yaml_get() {
  # naive YAML reader for two-level keys: "app.name", "linear.team_key", …
  local file="$1" path="$2"
  local top="${path%%.*}" leaf="${path#*.}"
  python3 - "${file}" "${top}" "${leaf}" <<'PY'
import sys
try:
    import yaml  # PyYAML
except ImportError:
    # fall back to a stdlib mini-parser sufficient for this schema
    import re
    file, top, leaf = sys.argv[1], sys.argv[2], sys.argv[3]
    section = None
    with open(file) as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line or line.lstrip().startswith("#"): continue
            if not line.startswith(" ") and line.endswith(":"):
                section = line[:-1].strip()
                continue
            m = re.match(r"\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$", line)
            if m and section == top and m.group(1) == leaf:
                print(m.group(2).strip().strip('"').strip("'"))
                sys.exit(0)
    sys.exit(1)
else:
    file, top, leaf = sys.argv[1], sys.argv[2], sys.argv[3]
    data = yaml.safe_load(open(file))
    val = (data or {}).get(top, {}).get(leaf)
    if val is None: sys.exit(1)
    print(val)
PY
}

APP_YML="$(_find_app_yml)" || { echo "no .claude/app.yml found above $(pwd)" >&2; return 1; }

export APP_NAME="$(_yaml_get "${APP_YML}" app.name)"
export APP_BUNDLE_ID="$(_yaml_get "${APP_YML}" app.bundle_id)"
export APP_SCHEME="$(_yaml_get "${APP_YML}" app.scheme)"
export APP_TEAM_ID="$(_yaml_get "${APP_YML}" app.team_id)"
export APP_URL_SCHEME="$(_yaml_get "${APP_YML}" app.url_scheme)"
export APP_BUILD_SCRIPT="$(_yaml_get "${APP_YML}" app.build_script 2>/dev/null || true)"
export APP_BUILD_SCRIPT="${APP_BUILD_SCRIPT:-build.sh}"
export APP_PREVIEW_ROOT="$(_yaml_get "${APP_YML}" app.preview_root 2>/dev/null || true)"
export APP_PREVIEW_ROOT="${APP_PREVIEW_ROOT:-${HOME}/${APP_NAME}Previews}"
export LINEAR_TEAM_KEY="$(_yaml_get "${APP_YML}" linear.team_key 2>/dev/null || true)"
```

- [ ] **Step 3: Author `templates/app.yml.example`**

```yaml
# Per-app config consumed by templated skills (release, ios-build, app-preview).
# Drop this in <app-repo>/.claude/app.yml and fill in the values.
schema_version: 1

app:
  name: MyApp
  bundle_id: com.example.myapp
  scheme: MyApp
  team_id: TEAMID123
  url_scheme: myapp
  build_script: build.sh                # optional, default build.sh
  preview_root: ~/MyAppPreviews         # optional, default ~/<name>Previews

linear:
  team_key: MYA
  agent_user_id:                        # optional, for /linear-pick assignment
```

- [ ] **Step 4: Run tests green; commit**

```bash
bats tests/bats/load_app_config.bats
git add skills/_lib/ templates/app.yml.example tests/bats/load_app_config.bats
git commit -m "$(cat <<'EOF'
feat(skills): add load_app_config.sh + app.yml schema for templated skills

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Generalize `release` skill

**Files:**
- Create: `skills/release/SKILL.md`
- Create: `skills/release/scripts/release.sh`

- [ ] **Step 1: Port `doc-scan/.claude/skills/release/SKILL.md` to `skills/release/SKILL.md`**

Copy the file verbatim, then apply these literal substitutions throughout:

- `Paperix` → `${APP_NAME}` (in prose and code blocks)
- `paperix` (lowercase, used in bundle id / scheme strings) → `${APP_NAME,,}` (or the explicit `${APP_BUNDLE_ID}` / `${APP_SCHEME}` where appropriate)
- Any hard-coded bundle id (e.g. `com.abhijit.paperix`) → `${APP_BUNDLE_ID}`
- Any hard-coded scheme → `${APP_SCHEME}`
- Any hard-coded team id → `${APP_TEAM_ID}`

Add this paragraph near the top of SKILL.md, before "Modes":

> **Requires `.claude/app.yml` in the app repo root** with `app.bundle_id`, `app.scheme`, `app.team_id`, `app.name`. The release script loads it via `skills/_lib/load_app_config.sh`. Run from inside the app repo.

- [ ] **Step 2: Extract the actual release commands into `skills/release/scripts/release.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

MODE="${1:-testflight}"   # testflight | appstore
FORCE="${2:-}"

[[ "${MODE}" == "testflight" || "${MODE}" == "appstore" ]] || {
  echo "usage: release.sh {testflight|appstore} [--force]" >&2
  exit 2
}

# Refuse on dirty tree unless --force
if [[ "${FORCE}" != "--force" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "dirty tree; commit or pass --force" >&2
  exit 1
fi

archive_path="build/${APP_NAME}.xcarchive"
ipa_path="build/${APP_NAME}.ipa"

xcodebuild archive \
  -scheme "${APP_SCHEME}" \
  -configuration Release \
  -archivePath "${archive_path}" \
  DEVELOPMENT_TEAM="${APP_TEAM_ID}" \
  PRODUCT_BUNDLE_IDENTIFIER="${APP_BUNDLE_ID}"

xcodebuild -exportArchive \
  -archivePath "${archive_path}" \
  -exportPath build/ \
  -exportOptionsPlist "$(dirname "${SCRIPT_DIR}")/ExportOptions.plist"

xcrun altool --validate-app -f "${ipa_path}" -t ios --apiKey "${APP_STORE_API_KEY:-}" --apiIssuer "${APP_STORE_API_ISSUER:-}"
xcrun altool --upload-app   -f "${ipa_path}" -t ios --apiKey "${APP_STORE_API_KEY:-}" --apiIssuer "${APP_STORE_API_ISSUER:-}"

tag="release-${MODE}-$(date +%Y%m%d-%H%M)"
git tag "${tag}"
echo "tagged ${tag}"
```

(If the doc-scan release skill referenced custom export options, fastlane, or other tools, port those verbatim with the same substitutions.)

`chmod +x skills/release/scripts/release.sh`.

- [ ] **Step 3: Add a smoke test that confirms the script reads app config**

Append to `tests/bats/load_app_config.bats` (or new file `tests/bats/release.bats`):

```bash
@test "release.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../skills/release/scripts/release.sh" testflight
  [ "$status" -ne 0 ]
  [[ "$output" == *"app.yml"* ]]
}
```

- [ ] **Step 4: Run; commit**

```bash
bats tests/bats/
git add skills/release/ tests/
git commit -m "$(cat <<'EOF'
feat(release): generalize release skill via app.yml

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Generalize `ios-build` skill

**Files:**
- Create: `skills/ios-build/SKILL.md`
- Create: `skills/ios-build/scripts/build.sh`

- [ ] **Step 1: Port `doc-scan/.claude/skills/ios-build/SKILL.md`**

Same substitution pass as Task 17: `Paperix` → `${APP_NAME}`, `build.sh` references stay (defaults to `build.sh` per `app.yml` `app.build_script`).

Add at the top:

> Reads `.claude/app.yml` for `app.scheme`, `app.bundle_id`, `app.build_script`. Defaults `build_script` to `build.sh`. Run from the app repo root.

- [ ] **Step 2: Write `skills/ios-build/scripts/build.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"

TARGET="${1:-sim}"   # sim | device

if [[ -x "./${APP_BUILD_SCRIPT}" ]]; then
  exec "./${APP_BUILD_SCRIPT}" "${TARGET}"
fi

# Fallback: minimal xcodebuild invocation
case "${TARGET}" in
  sim)
    xcodebuild -scheme "${APP_SCHEME}" \
      -destination 'platform=iOS Simulator,name=iPhone 16'
    ;;
  device)
    xcodebuild -scheme "${APP_SCHEME}" \
      -destination 'generic/platform=iOS' \
      DEVELOPMENT_TEAM="${APP_TEAM_ID}"
    ;;
  *) echo "usage: build.sh {sim|device}" >&2; exit 2 ;;
esac
```

`chmod +x skills/ios-build/scripts/build.sh`.

- [ ] **Step 3: Smoke bats**

```bash
@test "ios-build build.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../skills/ios-build/scripts/build.sh" sim
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 4: Commit**

```bash
bats tests/bats/
git add skills/ios-build/ tests/
git commit -m "$(cat <<'EOF'
feat(ios-build): generalize ios-build via app.yml

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Generalize `paperix-preview` → `app-preview`

**Files:**
- Create: `skills/app-preview/SKILL.md`
- Create: `skills/app-preview/scripts/{branch-dir.sh,bundle.sh,deliver.sh,launch.sh,snap.sh}`

- [ ] **Step 1: Port `doc-scan/.claude/skills/paperix-preview/SKILL.md`**

Substitutions:

- `paperix-preview` → `app-preview`
- `Paperix` → `${APP_NAME}` (prose)
- `paperix://` → `${APP_URL_SCHEME}://`
- `paperix://scan`, `paperix://doc` etc. → keep `${APP_URL_SCHEME}://scan` etc. (apps that don't define those deep links just won't use them — note this in SKILL.md)
- `PaperixPreviews/` (iCloud folder) → `${APP_PREVIEW_ROOT##*/}/`
- `/tmp/paperix-snaps/` → `/tmp/${APP_NAME,,}-snaps/`

- [ ] **Step 2: Port each script under `paperix-preview/scripts/`**

For each of `branch-dir.sh`, `bundle.sh`, `deliver.sh`, `launch.sh`, `snap.sh`:

1. Add the standard load-config preamble at the top:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../_lib/load_app_config.sh
source "${SCRIPT_DIR}/../../_lib/load_app_config.sh"
```

2. Replace literal `paperix` / `Paperix` references with `${APP_NAME}`, `${APP_URL_SCHEME}`, `${APP_PREVIEW_ROOT}` etc.

3. `chmod +x` all five.

- [ ] **Step 3: Smoke bats**

```bash
@test "app-preview launch.sh refuses without .claude/app.yml" {
  cd "${TMP}"
  run bash "${BATS_TEST_DIRNAME}/../../skills/app-preview/scripts/launch.sh"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 4: Commit**

```bash
bats tests/bats/
git add skills/app-preview/ tests/
git commit -m "$(cat <<'EOF'
feat(app-preview): generalize paperix-preview via app.yml (rename to app-preview)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: CI workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: install bats + shellcheck (macOS)
        if: runner.os == 'macOS'
        run: brew install bats-core shellcheck
      - name: install bats + shellcheck (Ubuntu)
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y bats shellcheck
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install --user -r setup/requirements.txt
      - name: shellcheck
        run: shellcheck setup/*.sh skills/_lib/*.sh
      - name: bats
        run: bats tests/bats/
      - name: pytest
        run: pytest tests/pytest/ -q
```

- [ ] **Step 2: Push branch, watch CI**

```bash
git add .github/
git commit -m "$(cat <<'EOF'
ci: bats + pytest + shellcheck on macOS and ubuntu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

CI runs on push to main and on PRs. If running locally only for now (no remote yet), this step is just a forward-looking artifact.

---

## Task 21: End-to-end laptop validation

- [ ] **Step 1: Run setup on the live laptop in `--dry-run` mode**

Run: `bash setup/setup.sh --dry-run --verbose`
Expected: every step prints "would …", no actual mutations.

- [ ] **Step 2: Compare current state vs. captured TOML**

Run: `bash setup/capture.sh && git diff claude-setup.toml`
Expected: no diff (already captured in Task 6).

- [ ] **Step 3: Run setup for real (small risk — back up `~/CLAUDE.md` first)**

```bash
cp ~/CLAUDE.md /tmp/CLAUDE.md.precheck
bash setup/setup.sh
diff ~/CLAUDE.md templates/home-CLAUDE.md
```

Expected: no diff. Symlinks under `~/.claude/skills/` for each entry in `skills/` exist and resolve back into the repo.

- [ ] **Step 4: Verify the contribute shim**

```bash
which claude-skills-contribute
ls -l ~/.local/bin/claude-skills-contribute
```

Expected: symlink to `$CLAUDE_SKILLS_HOME/setup/contribute.sh`.

- [ ] **Step 5: Record any unexpected behaviour as follow-up issues**

If anything surprises — drift in the symlinks, an unexpected backup, a plugin already installed at a different version — capture it in `docs/superpowers/specs/2026-05-25-claude-skills-seed-design.md §10` and commit.

---

## Task 22: doc-scan cutover

**Files (in doc-scan repo, not this one):**
- Delete: `doc-scan/scripts/claude-setup/`
- Delete: `doc-scan/.claude/skills/{commit,linear-pm,paperix-preview,release,ios-build}/`
- Modify: `doc-scan/.claude/hooks/paperix-build-reminder.sh` (replaced by claude-skills symlink)
- Create: `doc-scan/.claude/app.yml`
- Create: `doc-scan/.claude/README.md`

- [ ] **Step 1: Author `doc-scan/.claude/app.yml`**

```yaml
schema_version: 1
app:
  name: Paperix
  bundle_id: com.abhijit.paperix     # confirm against doc-scan/project.yml
  scheme: Paperix
  team_id: <copy from doc-scan/.dev-team>
  url_scheme: paperix
  build_script: build.sh
  preview_root: ~/PaperixPreviews
linear:
  team_key: PAP
  agent_user_id: <copy from existing doc-scan linear.yml>
```

- [ ] **Step 2: Smoke-test each templated skill against doc-scan**

From inside `doc-scan/`:

```bash
bash ~/projects/claude-skills/skills/release/scripts/release.sh testflight --force
bash ~/projects/claude-skills/skills/ios-build/scripts/build.sh sim
bash ~/projects/claude-skills/skills/app-preview/scripts/launch.sh
```

Each should at minimum reach the point where it would have run before the migration (validating that app.yml is read correctly). For release/build, expect them to drop into actual builds — verify the resulting artifact matches what the pre-migration `release` skill produced.

- [ ] **Step 3: Delete the old assets**

```bash
cd ~/projects/doc-scan
rm -rf scripts/claude-setup/
rm -rf .claude/skills/{commit,linear-pm,paperix-preview,release,ios-build}/
rm .claude/hooks/paperix-build-reminder.sh
```

(The hook stays available via claude-skills/hooks/app-build-reminder.sh — referenced from `doc-scan`'s settings.json if it uses one.)

- [ ] **Step 4: Author `doc-scan/.claude/README.md`**

```markdown
# Paperix .claude/

The skills, hooks, and commands previously lived here have moved to the seeding repo:
https://github.com/<owner>/claude-skills

This repo keeps only `app.yml` (Paperix-specific values) and any Paperix-only overrides.

Bootstrap a new machine: clone claude-skills and run `setup/setup.sh`.
```

- [ ] **Step 5: Commit in doc-scan**

```bash
cd ~/projects/doc-scan
git add .claude/ -A
git rm -r scripts/claude-setup/
git commit -m "$(cat <<'EOF'
chore: migrate claude setup + custom skills to claude-skills repo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Mac mini validation (acceptance gate)

- [ ] **Step 1: SSH or operate on the Mac mini**

- [ ] **Step 2: Clone claude-skills fresh**

```bash
git clone <repo-url> ~/projects/claude-skills
```

- [ ] **Step 3: Run setup**

```bash
bash ~/projects/claude-skills/setup/setup.sh --verbose 2>&1 | tee /tmp/mac-mini-setup.log
```

- [ ] **Step 4: If failures appear** — capture the exact error from `/tmp/mac-mini-setup.log`, file an issue / add a follow-up in the spec §10, and patch the relevant script + test on the laptop.

- [ ] **Step 5: Once setup succeeds** — run `claude --version`, check that all symlinks under `~/.claude/skills/` resolve correctly, and run a single contribute round-trip (`claude-skills-contribute --skill smoke-test --message "mac mini smoke" --no-pr`) to confirm `contribute.sh` works on this machine.

- [ ] **Step 6: Document the Mac mini result** as a one-paragraph addition to README.md (or close it as fully validated).

---

## Self-Review

**Spec coverage:**
- Spec §1 Purpose → T1, T6 (seeding), T15+T17–19 (custom skills), T22 (doc-scan cutover). ✓
- Spec §2 Goals → all 6 goals map to T5–T19. ✓
- Spec §3 Repo layout → T1–T6 + T15 establish the tree. ✓
- Spec §4 TOML schema → T3, T4, T6. ✓
- Spec §5.1 setup.sh (all 8 steps) → T5 (preflight), T7–T12. ✓
- Spec §5.2 capture.sh → T13. ✓
- Spec §5.3 contribute.sh → T14. ✓
- Spec §5.4 _lib.sh → T2. ✓
- Spec §6 generalized skills (commit, linear-pm, release, ios-build, app-preview) → T15, T17, T18, T19. ✓
- Spec §7 Tests + CI → T2, T3, T4, T13, T14, T16, T20. ✓
- Spec §8 Migration plan → T21 (laptop), T22 (doc-scan), T23 (mac mini). ✓

**Placeholder scan:** No TBDs. Two minor exceptions: Task 17's "If the doc-scan release skill referenced custom export options, fastlane, or other tools, port those verbatim" — this is a port instruction with concrete substitution rules, not a placeholder. Task 22's `<copy from doc-scan/.dev-team>` is a real value to copy at execution time.

**Type consistency:** `safe_symlink` signature `safe_symlink <src> <dst>` used the same way in T2 and T11. `load_app_config.sh` exports `APP_NAME`, `APP_BUNDLE_ID`, `APP_SCHEME`, `APP_TEAM_ID`, `APP_URL_SCHEME`, `APP_BUILD_SCRIPT`, `APP_PREVIEW_ROOT`, `LINEAR_TEAM_KEY` — these names are used consistently in T16, T17, T18, T19. `CLAUDE_SETUP_TOML` env var (used by bats to override path) is read in every step of setup.sh.

Plan complete.

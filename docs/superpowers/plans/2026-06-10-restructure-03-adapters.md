# Multi-Tool Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One script, `adapters/install.sh`, that wires this repo's skills into non-Claude AI tools: Codex (`~/.codex/skills`), Copilot CLI (`~/.copilot/skills`), and a generic AGENTS.md managed block for anything else (Hermes etc.).

**Architecture:** SKILL.md is the shared format — no conversion. The codex/copilot modes symlink every `plugins/*/skills/<name>` directory into the tool's skill directory. The agents-md mode rewrites a marker-delimited block in a target file listing each skill's name, description (parsed from frontmatter), and absolute path. All modes are idempotent; symlink modes also remove stale links they created (detected by target prefix = this repo).

**Tech Stack:** bash, python3 (frontmatter parse), bats.

**Spec:** `docs/superpowers/specs/2026-06-10-plugin-marketplace-restructure-design.md`

**Note on discovery paths:** `~/.codex/skills` and `~/.copilot/skills` are defaults, overridable via `CODEX_SKILLS_DIR` / `COPILOT_SKILLS_DIR`. The script only writes into a directory whose parent (`~/.codex`, `~/.copilot`) already exists — it never fabricates a tool installation. If a tool's real discovery path differs in a future version, the env var covers it without code change.

---

### Task 1: adapters/install.sh — symlink modes

**Files:**
- Create: `adapters/install.sh`
- Test: `tests/bats/adapters.bats`

- [ ] **Step 1: Write the failing tests**

`tests/bats/adapters.bats`:

```bash
#!/usr/bin/env bats

load helpers

setup() {
  TMP="$(mktemp -d)"
  export HOME="${TMP}/home"
  mkdir -p "${HOME}"
  export CLAUDE_SKILLS_HOME="${BATS_TEST_DIRNAME}/../.."
  INSTALL="${CLAUDE_SKILLS_HOME}/adapters/install.sh"
}

teardown() { rm -rf "${TMP}"; }

@test "codex mode refuses when ~/.codex does not exist" {
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [[ "$output" == *"no ~/.codex"* ]]
  [ ! -d "${HOME}/.codex/skills" ]
}

@test "codex mode symlinks every plugin skill" {
  mkdir -p "${HOME}/.codex"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ -L "${HOME}/.codex/skills/commit" ]
  [ -L "${HOME}/.codex/skills/linear-pm" ]
  [ -L "${HOME}/.codex/skills/second-wind" ]
  [ ! -e "${HOME}/.codex/skills/_lib" ]
}

@test "codex mode is idempotent and prunes stale links" {
  mkdir -p "${HOME}/.codex/skills"
  ln -s "${CLAUDE_SKILLS_HOME}/plugins/gone/skills/gone" "${HOME}/.codex/skills/gone"
  ln -s "/elsewhere/foreign" "${HOME}/.codex/skills/foreign"
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  run bash "${INSTALL}" codex
  [ "$status" -eq 0 ]
  [ ! -L "${HOME}/.codex/skills/gone" ]      # stale repo link pruned
  [ -L "${HOME}/.codex/skills/foreign" ]     # foreign link untouched
}

@test "copilot mode honors COPILOT_SKILLS_DIR override" {
  export COPILOT_SKILLS_DIR="${TMP}/custom-skills"
  mkdir -p "${COPILOT_SKILLS_DIR}"
  run bash "${INSTALL}" copilot
  [ "$status" -eq 0 ]
  [ -L "${COPILOT_SKILLS_DIR}/commit" ]
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bats tests/bats/adapters.bats`
Expected: FAIL (no adapters/install.sh).

- [ ] **Step 3: Implement the symlink modes**

`adapters/install.sh`:

```bash
#!/usr/bin/env bash
# Wire this repo's skills into non-Claude AI tools.
# Usage: install.sh <codex|copilot|agents-md|all> [agents-md-target-file]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=../setup/_lib.sh
# shellcheck disable=SC1091
source "${REPO_ROOT}/setup/_lib.sh"

usage() { echo "Usage: install.sh <codex|copilot|agents-md|all> [agents-md target file]"; }

# Every skill dir across all plugins, one per line. Skips _lib (shared helpers, not a skill).
skill_dirs() {
  local d
  for d in "${REPO_ROOT}"/plugins/*/skills/*/; do
    [[ -d "${d}" ]] || continue
    [[ "$(basename "${d}")" == "_lib" ]] && continue
    [[ -f "${d}/SKILL.md" ]] || continue
    printf '%s\n' "${d%/}"
  done
}

# link_skills <dest-dir>: symlink each skill dir into dest, prune stale repo links.
link_skills() {
  local dest="$1"
  mkdir -p "${dest}"
  # prune: links we own (pointing into this repo) whose target vanished
  local entry target
  for entry in "${dest}"/*; do
    [[ -L "${entry}" ]] || continue
    target="$(readlink "${entry}")"
    if [[ "${target}" == "${REPO_ROOT}"/* && ! -e "${entry}" ]]; then
      rm "${entry}"
      info "pruned stale link $(basename "${entry}")"
    fi
  done
  local d
  while IFS= read -r d; do
    safe_symlink "${d}" "${dest}/$(basename "${d}")"
  done < <(skill_dirs)
}

mode_codex() {
  local dest="${CODEX_SKILLS_DIR:-${HOME}/.codex/skills}"
  if [[ -z "${CODEX_SKILLS_DIR:-}" && ! -d "${HOME}/.codex" ]]; then
    info "no ~/.codex — Codex not installed; skipping"
    return 0
  fi
  link_skills "${dest}"
  info "codex: skills linked into ${dest}"
}

mode_copilot() {
  local dest="${COPILOT_SKILLS_DIR:-${HOME}/.copilot/skills}"
  if [[ -z "${COPILOT_SKILLS_DIR:-}" && ! -d "${HOME}/.copilot" ]]; then
    info "no ~/.copilot — Copilot CLI not installed; skipping"
    return 0
  fi
  link_skills "${dest}"
  info "copilot: skills linked into ${dest}"
}

MODE="${1:-}"
TARGET="${2:-AGENTS.md}"
case "${MODE}" in
  codex)     mode_codex ;;
  copilot)   mode_copilot ;;
  agents-md) mode_agents_md "${TARGET}" ;;
  all)       mode_codex; mode_copilot; mode_agents_md "${TARGET}" ;;
  *)         usage; exit 2 ;;
esac
```

(`mode_agents_md` arrives in Task 2 — for now add a stub so `all` doesn't break:)

```bash
mode_agents_md() { info "agents-md: not yet implemented"; }
```

Place the stub above the `case` block. Make executable: `chmod +x adapters/install.sh`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/bats/adapters.bats && shellcheck adapters/install.sh`
Expected: PASS, clean shellcheck.

- [ ] **Step 5: Commit**

```bash
git add adapters tests/bats/adapters.bats
git commit -m "feat: adapters/install.sh symlinks skills into Codex and Copilot CLI"
```

---

### Task 2: agents-md mode

**Files:**
- Modify: `adapters/install.sh` (replace stub)
- Test: `tests/bats/adapters.bats`

- [ ] **Step 1: Write the failing tests**

Append to `tests/bats/adapters.bats`:

```bash
@test "agents-md mode writes managed block into target file" {
  target="${TMP}/AGENTS.md"
  echo "# My agents file" > "${target}"
  run bash "${INSTALL}" agents-md "${target}"
  [ "$status" -eq 0 ]
  grep -q "BEGIN claude-skills" "${target}"
  grep -q "END claude-skills" "${target}"
  grep -q "second-wind" "${target}"
  grep -q "# My agents file" "${target}"   # pre-existing content preserved
}

@test "agents-md mode is idempotent (block replaced, not duplicated)" {
  target="${TMP}/AGENTS.md"
  echo "# My agents file" > "${target}"
  bash "${INSTALL}" agents-md "${target}"
  bash "${INSTALL}" agents-md "${target}"
  [ "$(grep -c 'BEGIN claude-skills' "${target}")" -eq 1 ]
}

@test "agents-md mode creates the target file when missing" {
  target="${TMP}/sub/AGENTS.md"
  run bash "${INSTALL}" agents-md "${target}"
  [ "$status" -eq 0 ]
  grep -q "BEGIN claude-skills" "${target}"
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bats tests/bats/adapters.bats`
Expected: the three new tests FAIL ("not yet implemented" stub writes nothing).

- [ ] **Step 3: Implement**

Replace the `mode_agents_md` stub in `adapters/install.sh` with:

```bash
# mode_agents_md <target-file>: maintain a marker-delimited skills index.
# The block lists every skill's name, description (from SKILL.md frontmatter),
# and absolute path, so any AGENTS.md-aware tool can discover them.
mode_agents_md() {
  local target="$1"
  mkdir -p "$(dirname "${target}")"
  [[ -f "${target}" ]] || : > "${target}"
  local block
  block="$(python3 - "${REPO_ROOT}" <<'PY'
import os, re, sys
root = sys.argv[1]
lines = ["<!-- BEGIN claude-skills (managed by adapters/install.sh; do not edit) -->",
         "## Skills (claude-skills)",
         "",
         "Each skill is a directory with a SKILL.md playbook. Read the SKILL.md",
         "before acting on a matching task.",
         ""]
plugins_dir = os.path.join(root, "plugins")
for plugin in sorted(os.listdir(plugins_dir)):
    skills_dir = os.path.join(plugins_dir, plugin, "skills")
    if not os.path.isdir(skills_dir):
        continue
    for skill in sorted(os.listdir(skills_dir)):
        if skill == "_lib":
            continue
        md = os.path.join(skills_dir, skill, "SKILL.md")
        if not os.path.isfile(md):
            continue
        text = open(md, encoding="utf-8").read()
        m = re.search(r"^description:\s*(.+?)$", text, re.M)
        desc = (m.group(1).strip() if m else "").strip('"')
        if len(desc) > 200:
            desc = desc[:197] + "..."
        lines.append(f"- **{skill}** — {desc}")
        lines.append(f"  Path: `{os.path.join(skills_dir, skill)}`")
lines.append("<!-- END claude-skills -->")
print("\n".join(lines))
PY
)"
  python3 - "${target}" <<PY
import re, sys
target = sys.argv[1]
block = """${block}"""
text = open(target, encoding="utf-8").read()
pattern = re.compile(r"<!-- BEGIN claude-skills.*?END claude-skills -->", re.S)
if pattern.search(text):
    text = pattern.sub(lambda _: block, text)
else:
    text = text.rstrip("\n") + ("\n\n" if text.strip() else "") + block + "\n"
open(target, "w", encoding="utf-8").write(text)
PY
  info "agents-md: managed block written to ${target}"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bats tests/bats/adapters.bats && shellcheck adapters/install.sh`
Expected: all PASS, clean shellcheck.

- [ ] **Step 5: Commit**

```bash
git add adapters/install.sh tests/bats/adapters.bats
git commit -m "feat(adapters): agents-md mode maintains managed skills block"
```

---

### Task 3: CI + docs hook-in

**Files:**
- Modify: `.github/workflows/test.yml` (shellcheck path)
- Modify: `USAGE.md` (short adapters section)

- [ ] **Step 1: Extend shellcheck in CI**

```yaml
      - name: shellcheck
        run: shellcheck setup/*.sh plugins/ios-dev/skills/_lib/*.sh adapters/*.sh
```

- [ ] **Step 2: Document in USAGE.md**

Append:

```markdown
## Using these skills from other AI tools

SKILL.md is tool-agnostic. To wire the skills into other agents:

    adapters/install.sh codex      # symlink into ~/.codex/skills (CODEX_SKILLS_DIR to override)
    adapters/install.sh copilot    # symlink into ~/.copilot/skills (COPILOT_SKILLS_DIR to override)
    adapters/install.sh agents-md [path/to/AGENTS.md]   # managed skill-index block for AGENTS.md-aware tools (Hermes, etc.)
    adapters/install.sh all

Re-run after adding skills; the script is idempotent and prunes links it created for removed skills.
```

- [ ] **Step 3: Verify + commit**

Run: `bats tests/bats/ && shellcheck setup/*.sh adapters/*.sh`
Expected: green.

```bash
git add .github/workflows/test.yml USAGE.md
git commit -m "ci: shellcheck adapters; docs: multi-tool adapter usage"
```

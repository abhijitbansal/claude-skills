# Public Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repo safe and welcoming for public users: sanitize audit, public-first README, MIT license, manifest validation in CI.

**Architecture:** No code restructuring — documentation, license, audit, and one CI job. Personal seed files stay but get a "personal seed" marker so public users know to ignore them.

**Tech Stack:** markdown, GitHub Actions, grep.

**Spec:** `docs/superpowers/specs/2026-06-10-plugin-marketplace-restructure-design.md`

---

### Task 1: Sanitize audit

**Files:**
- Inspect: `templates/user-settings.json`, `templates/home-CLAUDE.md`, all `plugins/**`, `setup/**`, `tools/**`
- Possibly modify: any file the audit flags

- [ ] **Step 1: Run the audit greps**

```bash
# secrets / tokens / keys
grep -rniE '(api[_-]?key|secret|token|password|bearer)[^a-z]' \
  --include='*.sh' --include='*.json' --include='*.md' --include='*.py' --include='*.toml' \
  plugins setup tools templates adapters | grep -viE 'tokens? (usage|count|budget)|GITHUB_TOKEN' || echo CLEAN-secrets

# personal email / phone
grep -rniE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' plugins setup tools templates adapters \
  | grep -viE 'noreply@anthropic|example\.com|you@' || echo CLEAN-emails

# absolute personal paths
grep -rn '/Users/abhijitbansal' plugins setup tools adapters || echo CLEAN-paths
```

- [ ] **Step 2: Triage every hit**

For each hit, decide:
- secret/token → remove, rotate if it was real.
- personal email/phone in plugin dirs → replace with a placeholder (`you@example.com`).
- `/Users/abhijitbansal` paths in plugin dirs → replace with `${HOME}` or a relative path.
- hits in `templates/` (user-settings.json, home-CLAUDE.md) → allowed (personal seed files), but confirm nothing is a credential. Note: `templates/user-settings.json` contains machine-specific node/hook paths — fine, it's the personal dotfile snapshot.

- [ ] **Step 3: Mark personal seed files**

Add a first-line comment/header to `templates/home-CLAUDE.md`:

```markdown
<!-- Personal seed file for Abhijit's machines. Public users: ignore templates/; install the plugins instead. -->
```

(`user-settings.json` is JSON — no comment support; the README section in Task 2 covers it.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: sanitize audit fixes, mark personal seed templates"
```

---

### Task 2: README rewrite

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Write the new README**

New content (fenced blocks shown indented to keep this plan readable — write them as proper fenced code blocks):

    # claude-skills

    Abhijit's AI-agent skills, plugins, and tools — one repo, usable from Claude Code,
    Codex, Copilot CLI, and any AGENTS.md-aware agent.

    ## Install (Claude Code)

        /plugin marketplace add abhijitbansal/claude-skills
        /plugin install ios-dev@claude-skills          # iOS build/preview/release loop
        /plugin install linear-pm@claude-skills        # Linear PM conventions + /linear-* commands
        /plugin install second-wind@claude-skills      # usage-limit-aware overnight orchestrator
        /plugin install core-workflow@claude-skills    # commit flow, agents, shellcheck hook

    ## Second Wind (CLI)

    Set-and-forget orchestrator for long Claude Code runs: detects the 5-hour usage
    limit, waits for the reset, resumes every tmux session. Stdlib-only single file.

        curl -fsSL https://raw.githubusercontent.com/abhijitbansal/claude-skills/main/tools/second-wind/wind.py -o ~/.local/bin/wind
        chmod +x ~/.local/bin/wind
        wind init && wind up && wind watch

    Docs: [tools/second-wind/README.md](tools/second-wind/README.md)

    ## Other AI tools

        adapters/install.sh codex      # ~/.codex/skills
        adapters/install.sh copilot    # ~/.copilot/skills
        adapters/install.sh agents-md  # managed skills block in AGENTS.md (Hermes etc.)

    ## Layout

    | Path | What |
    | --- | --- |
    | `plugins/` | Claude Code plugins (skills, commands, agents, hooks) |
    | `tools/` | standalone CLIs (second-wind) |
    | `adapters/` | wire skills into non-Claude tools |
    | `setup/`, `templates/`, `claude-setup.toml` | personal machine seed — public users can ignore |
    | `docs/superpowers/` | design specs and implementation plans |

    ## Personal machine bootstrap

        git clone https://github.com/abhijitbansal/claude-skills ~/projects/claude-skills
        bash ~/projects/claude-skills/setup/setup.sh

    Snapshot current machine state back: `bash setup/capture.sh && git diff`.
    Contribute from any repo: `claude-skills-contribute --message "..." [--skill <name>] [--plugin <plugin>]`.

    ## Development

    Tests: `bats tests/bats/ && uv tool run pytest tests/pytest tools/second-wind/tests -q`
    Design docs: `docs/superpowers/specs/`. License: MIT.

- [ ] **Step 2: Verify links resolve**

Run: `ls tools/second-wind/README.md adapters/install.sh docs/superpowers/specs/`
Expected: all exist.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: public-first README with plugin install, second-wind, adapters"
```

---

### Task 3: LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Write MIT license**

`LICENSE` — standard MIT text, year 2026, holder "Abhijit Bansal":

```text
MIT License

Copyright (c) 2026 Abhijit Bansal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 4: CI manifest validation

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add a validation step**

After the checkout step (before the OS-specific installs is fine — it only needs python3, present on all runners):

```yaml
      - name: validate plugin manifests
        run: |
          python3 - <<'PY'
          import json, os, sys
          mp = json.load(open(".claude-plugin/marketplace.json"))
          assert mp["name"] and mp["owner"]["name"], "marketplace metadata"
          names = set()
          for p in mp["plugins"]:
              assert p["name"] not in names, f"duplicate plugin {p['name']}"
              names.add(p["name"])
              pj = json.load(open(os.path.join(p["source"], ".claude-plugin", "plugin.json")))
              assert pj["name"] == p["name"], f"name mismatch in {p['source']}"
              skills = os.path.join(p["source"], "skills")
              if os.path.isdir(skills):
                  for s in os.listdir(skills):
                      if s == "_lib": continue
                      md = os.path.join(skills, s, "SKILL.md")
                      assert os.path.isfile(md), f"missing {md}"
          print(f"OK: {len(names)} plugins valid")
          PY
```

- [ ] **Step 2: Run the same script locally**

Run: paste the inline python into `python3 -` from the repo root.
Expected: `OK: 4 plugins valid`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: validate marketplace and plugin manifests"
```

---

### Task 5: Final verification + push

- [ ] **Step 1: Everything green**

Run: `shellcheck setup/*.sh adapters/*.sh plugins/ios-dev/skills/_lib/*.sh && bats tests/bats/ && uv tool run pytest tests/pytest -q && (cd tools/second-wind && uv tool run pytest tests/ -q)`
Expected: all PASS.

- [ ] **Step 2: Push and watch CI**

```bash
git push origin main
gh run watch --exit-status || gh run view --log-failed
```

Expected: CI green on both macOS and Ubuntu. Fix and re-push if not.

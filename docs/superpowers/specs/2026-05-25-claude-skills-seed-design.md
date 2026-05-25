# claude-skills Seeding Repo — Design

**Date:** 2026-05-25
**Status:** Draft (awaiting user review)
**Owner:** Abhijit Bansal

## 1. Purpose

Stand up `~/projects/claude-skills` as the single source of truth for the author's Claude Code dev environment:

- Custom skills, agents, hooks, commands, and scripts (lifted out of `doc-scan` and generalized).
- A reproducible installer for the open-source plugins, marketplaces, and npx-skills currently scattered across two machines (laptop + mac mini).
- A contribute flow that any other repo or machine can invoke to push changes back into this repo via a PR.

This repo becomes the seed for future apps: each new app references claude-skills (via the global install) and only ships its own `.claude/app.yml` with app-specific values (bundle id, scheme, linear team, …).

`doc-scan/scripts/claude-setup/` and `doc-scan/.claude/skills/` are deleted once equivalents land here. `doc-scan` keeps only its `.claude/app.yml`.

Phase 1 (this spec): clone-and-run install. Phase 2 (later, out of scope): also publish as a Claude plugin marketplace + npx-skills source so friends can `claude plugin marketplace add` it.

## 2. Goals / Non-goals

**Goals**

- One `bash setup.sh` on a fresh Mac brings Claude Code to the author's full configuration.
- One TOML file is the canonical description of marketplaces + plugins + npx-skills.
- Custom skills are edited in-repo and live everywhere via symlinks — no copy/regenerate step.
- Templated skills (release, ios-build, app-preview) work for any app whose root contains `.claude/app.yml`.
- A `contribute.sh` (and matching `/contribute-skill` slash command) lets the author push a change from any repo or machine back into `claude-skills` as a PR.
- Setup, capture, and contribute scripts are covered by automated tests run in CI.

**Non-goals**

- Cross-platform support beyond macOS (Linux CI is convenience; primary target is macOS).
- Publishing as a Claude marketplace or to skills.sh (deferred to Phase 2).
- Migrating skills owned by other plugins (caveman, visual-explainer, engineering-skills) — those stay plugin-managed.
- Per-machine settings divergence — `claude-setup.toml` is the same on every machine; per-app divergence lives in `.claude/app.yml`.

## 3. Repo layout

```
claude-skills/
├── README.md                       # what this is, how to bootstrap
├── claude-setup.toml               # marketplaces, plugins, npx-skills, dotfiles
├── setup/
│   ├── setup.sh                    # idempotent installer
│   ├── capture.sh                  # snapshots live state into the repo
│   ├── contribute.sh               # cross-repo contribute flow
│   ├── _lib.sh                     # shared logging / PATH / preflight helpers
│   ├── parse_toml.py               # read TOML for setup.sh (tomllib, stdlib)
│   └── write_toml.py               # rewrite TOML preserving comments (tomlkit)
├── skills/                         # custom skills (symlinked into ~/.claude/skills/)
│   ├── _lib/
│   │   └── load_app_config.sh      # shared helper: read .claude/app.yml → env
│   ├── commit/                     # generic
│   ├── linear-pm/                  # generic
│   ├── release/                    # templated, reads .claude/app.yml at runtime
│   ├── ios-build/                  # templated
│   ├── app-preview/                # generalized paperix-preview, templated
│   └── contribute/                 # NEW — wraps setup/contribute.sh as a skill
├── agents/                         # image-parser, web-researcher
├── hooks/                          # shellcheck-on-edit, app-build-reminder
├── commands/                       # /fix, /preview, /team, /linear-*
├── scripts/                        # show-advisor.sh, statusline.sh
├── templates/
│   ├── app.yml.example             # schema for per-app .claude/app.yml
│   ├── home-CLAUDE.md              # global ~/CLAUDE.md content
│   └── user-settings.json          # ~/.claude/settings.json content
├── tests/
│   ├── bats/                       # bash unit + integration tests
│   ├── pytest/                     # python tests for parse_toml / write_toml
│   └── fixtures/                   # canned ~/.claude state, expected outputs
├── .github/workflows/test.yml      # CI: shellcheck + bats + pytest on macOS + Ubuntu
└── docs/
    └── superpowers/specs/          # this design and future specs
```

`CLAUDE_SKILLS_HOME` env var (default `~/projects/claude-skills`) tells `setup.sh` where the repo lives so symlinks resolve correctly.

## 4. `claude-setup.toml` schema

```toml
[meta]
schema_version = 1

# Marketplaces are re-added idempotently. `repo` is the github "owner/name".
[[marketplaces]]
name = "claude-plugins-official"
repo = "anthropics/claude-plugins-official"

[[marketplaces]]
name = "claude-code-skills"
repo = "alirezarezvani/claude-skills"

[[marketplaces]]
name = "caveman"
repo = "JuliusBrussee/caveman"

# User-scope plugin installs. `pin` is optional — when set, setup.sh
# installs/updates to that exact version and refuses bare `update`.
[[plugins]]
name = "superpowers"
marketplace = "claude-plugins-official"
# pin = "v5.1.0"

# npx-skills entries (installed via `npx skills add -g`)
[[skills]]
source = "vercel-labs/skills"
name   = "find-skills"

[dotfiles]
home_claude_md = "templates/home-CLAUDE.md"
user_settings  = "templates/user-settings.json"

[custom_skills]
# Directories under the repo whose subdirs get symlinked into ~/.claude/<dir>/.
# Each entry symlinks `claude-skills/<name>/*` → `~/.claude/<name>/*`.
symlink_targets = ["skills", "agents", "commands"]
```

Schema rules:

- `meta.schema_version = 1`; `setup.sh` refuses unknown versions and prints the migration command.
- Hand-edited comment blocks above an entry are preserved across capture. Inline comments are not — capture strips them.
- Empty arrays for marketplaces/plugins/skills are valid (e.g. a minimal machine).
- `dotfiles` paths are repo-relative.

## 5. Scripts

### 5.1 `setup.sh`

Idempotent. Safe to rerun. Exit codes: 0 success, 1 hard failure, 2 partial (warns).

Flags: `--dry-run`, `--verbose`, `--skip-plugins`, `--skip-skills`, `--skip-dotfiles`, `--only <step>`.

Steps (each can be skipped via `--skip-*` or run alone via `--only`):

1. **Preflight.** Resolve `CLAUDE_SKILLS_HOME` (env or script's repo root). Ensure `~/.local/bin` is on PATH. Verify `python3 ≥ 3.11` (for `tomllib`). If `pip3 show tomlkit` is missing, install with `pip3 install --user tomlkit` (needed by capture; setup itself can read with stdlib).
2. **Claude Code binary.** Install via official installer if missing; otherwise `claude update`. Warn (do not fail) if `update` fails.
3. **Marketplaces.** Loop `[[marketplaces]]`. Add if absent, update if present. Diff against `claude plugin marketplace list`.
4. **Plugins.** Loop `[[plugins]]`. Install at user scope if absent. If `pin` set, `claude plugin install <name>@<marketplace>@<pin>` (current Claude CLI supports a `--version` flag — see Risks). Otherwise `claude plugin update` for present plugins.
5. **npx-skills.** Loop `[[skills]]`. `npx -y skills add <source>@<name> -g -y`. Then `npx -y skills update -g -y` once at the end.
6. **Dotfiles.** Copy each `[dotfiles]` source over its `~` destination. If destination exists and differs, back it up to `<dst>.bak.<YYYYMMDD-HHMMSS>` before copy.
7. **Custom skill symlinks.** For each dir in `custom_skills.symlink_targets`:
   - For each subdir `claude-skills/<dir>/<entry>`, target = `~/.claude/<dir>/<entry>`.
   - **Collision rule:** if target exists and is a symlink pointing at `$CLAUDE_SKILLS_HOME/<dir>/<entry>` — skip (already correct). If target exists and points elsewhere (e.g. `~/.agents/skills/caveman` symlinks created by npx-skills) — print a warning, do not overwrite, continue. If target is a regular file or directory — abort that entry with an error and continue with others. Use `ln -s` (no `-f`); never silently clobber. This is enforced by `setup/_lib.sh::safe_symlink`.
8. **Summary.** Print counts of installed / updated / skipped / warned / failed. Exit 0 if no failures, 2 if any warnings, 1 if any failures.

### 5.2 `capture.sh`

Inverse of setup. Snapshots live machine state back into the repo so subsequent `setup.sh` runs reproduce it elsewhere.

Sources → repo destinations:

| Live source                                          | Repo destination                          |
| ---------------------------------------------------- | ----------------------------------------- |
| `~/CLAUDE.md`                                        | `templates/home-CLAUDE.md`                |
| `~/.claude/settings.json`                            | `templates/user-settings.json`            |
| `~/.claude/plugins/known_marketplaces.json`          | `claude-setup.toml [[marketplaces]]`      |
| `~/.claude/plugins/installed_plugins.json` (user)    | `claude-setup.toml [[plugins]]`           |
| `~/.agents/.skill-lock.json`                         | `claude-setup.toml [[skills]]`            |

Implementation:

- TOML rewrites go through `setup/write_toml.py` using `tomlkit` (preserves the comment blocks the human wrote above each section). Read → modify table arrays → write.
- `pip3 install --user tomlkit` is part of `setup.sh` preflight so capture is usable after the first setup.
- Dotfile copies are byte-for-byte.
- Capture does not delete entries automatically; it strictly upserts. To remove a plugin from the manifest, hand-edit and commit. (This prevents an accidental `claude plugin uninstall` on one machine from wiping the entry for the other.)

Flags: `--dry-run`, `--include <section>` (limit which sections capture touches), `--prune` (the only way to remove entries; explicit and noisy).

### 5.3 `contribute.sh`

Cross-repo contribute flow. Installed onto the machine as `~/.local/bin/claude-skills-contribute` (symlink created by `setup.sh` step 7 alongside the symlink fan-out).

```
claude-skills-contribute [--skill <name>] [--message "..."] [--no-pr] [--auto-merge]
```

Flow:

1. **Preflight.** Resolve `$CLAUDE_SKILLS_HOME`. Refuse if missing — print the clone instruction. Run `gh auth status` early — refuse if `gh` isn't authed (otherwise step 6 would leave a half-finished commit).
2. **Sync.** `git -C $CLAUDE_SKILLS_HOME fetch origin && git switch main && git pull --ff-only`. Refuse if working tree is dirty — print which files and exit. The author is expected to commit or stash other in-progress work in `claude-skills` before contributing.
3. **Branch.** `git switch -c contrib/<slug>-<YYYYMMDD-HHMM>` where `<slug>` is derived from `--message` or `--skill`.
4. **Mutate.** If `--skill <name>`: scaffold `skills/<name>/SKILL.md` from `templates/skill.md.example`, plus an empty `scripts/` dir. Otherwise: run `capture.sh` to sync live state.
5. **Validate.** Run the test suite (`bats tests/bats/*.bats && pytest tests/pytest -q`) and `shellcheck setup/*.sh skills/_lib/*.sh`. Fail the contribute if red — leave the branch in place for the user to fix.
6. **Commit.** `git add -A && git commit -m "<conventional message>"`. Message defaults to the `--message` value; if absent, generated from the diff (mirrors the existing `commit` skill behaviour).
7. **Push.** `git push -u origin <branch>`.
8. **PR.** Unless `--no-pr`, `gh pr create --title <slug> --body <auto-generated body listing files changed>`.
9. **Merge.** If `--auto-merge`, wait for CI green and `gh pr merge --squash --delete-branch`.

The `/contribute-skill` slash command (`commands/contribute-skill.md`) and the `contribute` skill (`skills/contribute/SKILL.md`) are both thin wrappers that invoke `contribute.sh`.

### 5.4 `setup/_lib.sh`

Shared helpers used by all three scripts:

- `bold`, `info`, `warn`, `fail` — logging primitives.
- `safe_symlink <src> <dst>` — implements the collision rule from §5.1 step 7.
- `ensure_path` — guarantees `~/.local/bin` on PATH.
- `python_check` — asserts `python3 ≥ 3.11`; offers `brew install python@3.11` if not.
- `gh_auth_check` — wraps `gh auth status`.
- `toml_read <section> <field>` — wraps `python3 setup/parse_toml.py`.

## 6. Custom skills — generalization

Five doc-scan skills are lifted. Each has its own per-skill section in this design's implementation plan (see §10), but the high-level rules:

**Generic (no changes beyond rehoming):**

- `commit` — stage + lint + conventional commit. No app-specific assumptions.
- `linear-pm` — Linear label vocabulary, status taxonomy, slash command behaviour. Already config-driven via `.claude/linear.yml` per repo.

**Templated (read `.claude/app.yml` at invocation):**

- `release` — was hardcoded to Paperix scheme, bundle id, App Store Connect team. After generalization: `release/scripts/release.sh` calls `_lib/load_app_config.sh` which exports `APP_SCHEME`, `APP_BUNDLE_ID`, `APP_TEAM_ID`, `APP_NAME` from `.claude/app.yml`. SKILL.md prose stays static and references the env vars by name.
- `ios-build` — was hardcoded to `build.sh`. Generalized to read `APP_BUILD_SCRIPT` (default `build.sh`) and `APP_SCHEME` from `app.yml`.
- `app-preview` (renamed from `paperix-preview`) — was hardcoded to `paperix://` URL scheme and "Paperix" branding throughout. Generalized to read `APP_URL_SCHEME`, `APP_NAME`, `APP_PREVIEW_ROOT` (default `~/<APP_NAME>Previews`) from `app.yml`. iCloud delivery path becomes `<APP_PREVIEW_ROOT>/<branch>/`. Refuses to run if `APP_URL_SCHEME` is missing.

Skill rendering is **runtime, not install-time** — SKILL.md is static prose, scripts read the config at invocation. This preserves the symlink model (a rendered file would have to be regenerated whenever app.yml changed).

`.claude/app.yml` schema (`templates/app.yml.example`):

```yaml
schema_version: 1
app:
  name: Paperix                    # human-readable, also drives preview folder
  bundle_id: com.abhijit.paperix
  scheme: Paperix                  # xcodebuild scheme
  team_id: ABC123XYZ               # App Store Connect / signing
  url_scheme: paperix              # deep-link URL scheme without `://`
  build_script: build.sh           # optional, default build.sh
  preview_root: ~/PaperixPreviews  # optional, default ~/<name>Previews
linear:
  team_key: PAP                    # used by linear-pm slash commands
  agent_user_id: <linear-user-id>  # optional, for /linear-pick assignment
```

Missing keys → templated skill refuses to run with a clear "set `app.bundle_id` in .claude/app.yml" message.

## 7. Tests

### 7.1 Tooling

- **bats-core** for bash scripts (`tests/bats/`). Installed via `brew install bats-core` (or `apt-get` on Ubuntu CI). Test runner asserts version ≥ 1.10 because we use `--filter-tags`.
- **pytest** for Python (`tests/pytest/`). Just `pytest` + `tomlkit` + stdlib.
- **shellcheck** for static lint on every `.sh`.

### 7.2 Test plan

```
tests/bats/
├── setup.bats           # fresh $HOME, mocked claude/npx/gh — assert files + symlinks land
├── capture.bats         # seed live state fixtures, assert TOML rewrite matches expected/
├── contribute.bats      # mock gh, assert branch name + commit message shape
├── safe_symlink.bats    # all 4 collision cases (absent / correct symlink / wrong symlink / regular file)
├── parse_toml.bats      # wrapper-level: setup.sh consumes parse_toml.py output correctly
└── helpers.bash         # mock $PATH stubs for claude / npx / gh / curl

tests/pytest/
├── test_parse_toml.py   # schema validation, missing-section behaviour
├── test_write_toml.py   # round-trip: read → write → read preserves comments
└── test_app_config.py   # _lib/load_app_config.sh integration via subprocess
```

**Mocks.** Every test:

- Sets `HOME=$(mktemp -d)` and `CLAUDE_SKILLS_HOME=<test-repo-clone>`.
- Prepends `tests/bats/mocks/` to `PATH` — that dir contains shell stubs for `claude`, `npx`, `gh`, `curl` that emit canned responses and record their argv to a log the test inspects.
- No network. No real $HOME mutation.

**Coverage gates** (enforced in CI):

- `setup.sh` step 7 collision rule — all 4 cases must pass.
- `capture.sh` round-trip — `setup → capture → setup → capture` must produce identical TOML.
- `contribute.sh` failing-tests path — when validation fails (step 5), the script must NOT commit or push; the branch is left for manual fix.

### 7.3 CI

`.github/workflows/test.yml`:

```yaml
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - run: brew install bats-core shellcheck || sudo apt-get install -y bats shellcheck
      - run: pip3 install --user tomlkit pytest
      - run: shellcheck setup/*.sh skills/_lib/*.sh
      - run: bats tests/bats/
      - run: pytest tests/pytest/ -q
```

PR merges blocked on CI green (branch protection rule, configured in repo settings — out of scope for this spec but noted).

## 8. Migration plan (doc-scan → claude-skills)

Order matters — each step is verifiable in isolation:

1. **Stand up scaffolding.** Create directory layout, write empty `claude-setup.toml`, copy `setup.sh` / `capture.sh` from doc-scan as a starting point. Tests not required yet (covered next).
2. **Land tests for the existing scripts** before refactoring them. Lock in current behaviour as a baseline.
3. **Migrate `claude-setup.toml`.** Run `capture.sh` (the rewritten one, with tomlkit) against the laptop. Hand-merge the resulting TOML with the captured state from doc-scan's three .txt files. Verify all 4 marketplaces + 18 plugins + 6 npx-skills present.
4. **Lift generic skills.** Copy `commit`, `linear-pm`, agents, commands, scripts from doc-scan verbatim. Run `setup.sh` on a clean `$HOME` fixture, assert symlinks land.
5. **Generalize templated skills.** For each of `release`, `ios-build`, `app-preview`: write `app.yml` schema entries, refactor scripts to read `_lib/load_app_config.sh`, add per-skill bats tests.
6. **Write doc-scan's `.claude/app.yml`.** With Paperix's real values. Run all generalized skills end-to-end against doc-scan to verify behavioural parity.
7. **Build `contribute.sh` + `/contribute-skill`.** Test by using contribute itself to land the final spec follow-ups.
8. **Validate on mac mini.** Clone fresh, run `setup.sh`, run a real `release` cycle. This is the load-bearing acceptance test.
9. **Delete `doc-scan/scripts/claude-setup/` and `doc-scan/.claude/skills/` (except hooks).** Add a 2-line `doc-scan/.claude/README.md` pointing at claude-skills.

## 9. Risks + mitigations

- **`claude plugin install --version` may not exist.** The `pin` field assumes a CLI flag we haven't verified. Mitigation: before implementation, run `claude plugin install --help` and confirm; if absent, drop `pin` from schema v1 and revisit.
- **npx-skills lockfile drift.** `~/.agents/.skill-lock.json` can contain entries that no longer match the TOML if a skill is removed from the lockfile but kept in TOML. Mitigation: capture compares both directions and warns; setup tolerates missing-from-lockfile entries (treats as a fresh install).
- **`~/.claude/skills/` symlink collisions with npx-skills entries** (e.g. `caveman*` symlinks present from `~/.agents/skills/`). Mitigation: §5.1 step 7 collision rule. Tested.
- **Mac mini PATH failure (the original "upstream" bug).** Root cause unknown — listed as a follow-up validation gate (§8 step 8). The defensive measures cover the four most likely classes: `~/.local/bin` not on PATH, missing `python3.11`, missing `npx`, missing `gh`.
- **`tomlkit` is not stdlib.** It's pinned via `pip3 install --user tomlkit` in setup preflight. Pinned version recorded in `setup/requirements.txt` to keep CI and dev environments aligned.
- **Symlinking couples machine state to clone path.** Mitigated via `CLAUDE_SKILLS_HOME` env var with a sensible default. Moving the repo just means re-exporting the var and rerunning setup.

## 10. Open follow-ups (out of scope here, but flagged)

- Phase 2 marketplace publication (Claude marketplace.json + skills.sh registration).
- Per-machine TOML overrides (e.g. mac mini wants `engineering-skills` but laptop doesn't).
- A `/sync-machines` skill that wraps `capture → contribute → setup` as a one-shot.
- Confirming the Mac mini original failure mode (do this during §8 step 8).
- Reproduce the caveman-symlinks-under-`~/.claude/skills/` provenance — they're not in any current lockfile we can see, which suggests either the lockfile is stale or they were created manually.

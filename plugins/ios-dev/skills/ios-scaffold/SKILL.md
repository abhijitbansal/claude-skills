---
name: ios-scaffold
description: "Standardize an iOS app repo to the portfolio conventions — marketing copy home, Fastlane files, Xcode Cloud ci_post_clone, release-hooks dir, architecture checklist, AGENTS.md skeleton. Use when setting up a new app repo, when the user says \"scaffold this repo\", \"standardize the repo\", \"set up fastlane/CI here\", or invokes /ios-scaffold. Idempotent: creates what's missing, reports drift on what exists, never overwrites."
---

# iOS repo scaffold

Requires `.claude/app.yml` (run `/ios-init` first). Renders every managed file
from app.yml values — no hand-edited app names in templates.

## Run

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/ios-scaffold/scripts/scaffold.sh"          # create + report
bash "${CLAUDE_PLUGIN_ROOT}/skills/ios-scaffold/scripts/scaffold.sh" --check  # report only; exit 1 only if a managed file is missing
```

Output contract: `CREATE: <path>` (written), `OK: <path>` (matches template),
`DRIFT: <path>: …` (exists but differs — kept as-is), `SKIP: <path>: …`.
Only `--check` and `-h|--help` are accepted; any other argument exits 2 and
writes nothing. Paths are always written at the repo root (the directory with
`.claude/app.yml`), even when started from a subdirectory.

## Managed set

| Path | Purpose |
|---|---|
| `marketing/app-store-listing.md` | canonical store copy (ASC/site/in-app derive from it) |
| `fastlane/Fastfile` + `Gemfile` | archive/beta/release lanes (release skill S5/S6); `archive` is self-contained; ASC API key from `ASC_KEY_ID`/`ASC_ISSUER_ID`/`ASC_KEY_PATH`; one profile per app and extension target; extension id is `<app-id>.<TargetName>`, override with `APP_EXTENSION_BUNDLE_IDS`; manual `provisioningProfiles` export map |
| `ci_scripts/ci_post_clone.sh` | Xcode Cloud contract (skill `xcode-cloud-post-clone-contract`) |
| `build.sh` (or `app.build_script`) | the build wrapper ios-build and app-preview run: `-s [name\|UDID]` simulator (default), `-d [device]` device via `devicectl`, `--debug`, `--no-launch`; regenerates XcodeGen, resolves the team from the matching provisioning profile when `app.team_id` is `TODO` |
| `scripts/release-hooks/` | per-app pre/post stage hooks for the release skill |
| `docs/ARCHITECTURE_CHECKLIST.md` | per-subsystem pointers to the knowledge skills |
| `.claude/rules/swift-lessons-by-symptom.md` | path-scoped (`**/*.swift`) symptom-to-skill table, loaded whenever Swift is edited; works for repos that already have an AGENTS.md (no retrofit of AGENTS.md needed) |
| `.claude/hooks/guard-generated.sh` + `.claude/settings.json` | PreToolUse hook blocking edits to the generated `.xcodeproj` (edit `project.yml` instead); fails closed without `jq`. `settings.json` is created only when absent: if one exists, scaffold prints `SKIP` and you add the hook entry (`matcher: "Edit\|Write\|MultiEdit"`, command `"$CLAUDE_PROJECT_DIR"/.claude/hooks/guard-generated.sh`) by hand |
| `AGENTS.md` + `CLAUDE.md` | ONLY when AGENTS.md doesn't exist (never touches an existing one). `CLAUDE.md` is `@AGENTS.md` plus a note: Claude Code reads a root AGENTS.md only through that import once a CLAUDE.md exists. For an existing repo whose CLAUDE.md merely links to AGENTS.md, add the `@AGENTS.md` line by hand |

Never scaffolds Swift source — architecture seeds are knowledge skills the
checklist points to, not generated code.

## Resolving DRIFT

DRIFT means the file diverged from the current template — either the app
customized it (fine — lane logic, extra marketing sections) or the plugin
template improved since scaffolding. Walk each DRIFT with the user:
`diff <(render template) <file>`, then either adopt the template change into
the file or consciously keep the divergence. Never bulk-overwrite.

## As a CI gate

`scaffold.sh --check` exits 1 only when a managed file is missing (it would
CREATE) — usable in a pre-release hook (`scripts/release-hooks/s1-pre.sh`).
DRIFT is printed but never fails the check: customised lanes and edited
listings are expected, so a drift-failing gate would never go green on a real
repo.

**After a plugin update, expect one red run.** New managed files count as
missing in every repo scaffolded before they existed: `build.sh` (or
`app.build_script`), `.claude/rules/swift-lessons-by-symptom.md`,
`.claude/hooks/guard-generated.sh`, and `.claude/settings.json` when absent. A
`--check` gate such as `s1-pre.sh` then exits 1 until `scaffold.sh` is run once
and the new files are committed (an existing `settings.json` is never edited; it
prints how to wire the hook). A repo that deliberately builds without a
`build.sh` cannot pass the gate while that file is missing, although
`validate_app_config.sh` only warns about it: point `app.build_script` at the
script it does use, or drop `--check` from the gate and read the CREATE lines.

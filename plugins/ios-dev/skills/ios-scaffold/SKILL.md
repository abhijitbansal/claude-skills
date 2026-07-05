---
name: ios-scaffold
description: >-
  Standardize an iOS app repo to the portfolio conventions — marketing copy
  home, Fastlane files, Xcode Cloud ci_post_clone, release-hooks dir,
  architecture checklist, AGENTS.md skeleton. Use when setting up a new app
  repo, when the user says "scaffold this repo", "standardize the repo",
  "set up fastlane/CI here", or invokes /ios-scaffold. Idempotent: creates
  what's missing, reports drift on what exists, never overwrites.
---

# iOS repo scaffold

Requires `.claude/app.yml` (run `/ios-init` first). Renders every managed file
from app.yml values — no hand-edited app names in templates.

## Run

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/ios-scaffold/scripts/scaffold.sh"          # create + report
bash "${CLAUDE_PLUGIN_ROOT}/skills/ios-scaffold/scripts/scaffold.sh" --check  # report only; exit 1 if work needed
```

Output contract: `CREATE: <path>` (written), `OK: <path>` (matches template),
`DRIFT: <path>: …` (exists but differs — kept as-is), `SKIP: <path>: …`.

## Managed set

| Path | Purpose |
|---|---|
| `marketing/app-store-listing.md` | canonical store copy (ASC/site/in-app derive from it) |
| `fastlane/Fastfile` + `Gemfile` | archive/beta/release lanes (release skill S5/S6) |
| `ci_scripts/ci_post_clone.sh` | Xcode Cloud contract (skill `xcode-cloud-post-clone-contract`) |
| `scripts/release-hooks/` | per-app pre/post stage hooks for the release skill |
| `docs/ARCHITECTURE_CHECKLIST.md` | per-subsystem pointers to the knowledge skills |
| `AGENTS.md` + `CLAUDE.md` | ONLY when AGENTS.md doesn't exist (never touches an existing one) |

Never scaffolds Swift source — architecture seeds are knowledge skills the
checklist points to, not generated code.

## Resolving DRIFT

DRIFT means the file diverged from the current template — either the app
customized it (fine — lane logic, extra marketing sections) or the plugin
template improved since scaffolding. Walk each DRIFT with the user:
`diff <(render template) <file>`, then either adopt the template change into
the file or consciously keep the divergence. Never bulk-overwrite.

## As a CI gate

`scaffold.sh --check` exits 1 when anything would CREATE or DRIFTs — usable in
a pre-release hook (`scripts/release-hooks/s1-pre.sh`) to keep repos aligned.

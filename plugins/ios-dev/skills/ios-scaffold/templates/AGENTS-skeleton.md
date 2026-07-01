# AGENTS.md — {{APP_NAME}} conventions

Canonical engineering guide for **{{APP_NAME}}**, for human contributors and
AI coding agents. `CLAUDE.md` is a thin pointer to this file.

## What this app is

TODO — one paragraph: what it does, for whom, the non-negotiable product
principles (privacy posture, offline behavior, dependency policy).

## Stack decisions

| Decision | Value |
|---|---|
| Language / UI | Swift 6, SwiftUI |
| Build system | XcodeGen (`project.yml` is the source of truth; `.xcodeproj` gitignored) |
| Config | `.claude/app.yml` (schema v2) drives ios-dev skills |
| Versions | `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in `project.yml` ONLY — bumped by the release skill, never by hand |

## Build & test

```bash
./build.sh            # simulator build (default)
./build.sh -d         # device
```

## Lessons

Portfolio-wide lessons live as ios-dev plugin skills — see
`docs/ARCHITECTURE_CHECKLIST.md` for the per-subsystem list. Add app-specific
lessons here only when they don't generalize (otherwise run `/learn`).

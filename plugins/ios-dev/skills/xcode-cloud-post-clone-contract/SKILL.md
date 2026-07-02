---
name: xcode-cloud-post-clone-contract
description: Xcode Cloud build fails with "project not found" / cannot find the .xcodeproj, SPM resolves different package versions than local, or a build that works locally breaks only in Xcode Cloud. Use when setting up Xcode Cloud for an XcodeGen-based app, when a cloud build breaks after adding a local generation step, or when SPM versions drift between local and cloud. The fix is a ci_scripts/ci_post_clone.sh honoring a four-rule contract.
---

# Xcode Cloud post-clone contract (XcodeGen apps)

Xcode Cloud clones clean. An XcodeGen repo has **no `.xcodeproj` in git** —
without a post-clone hook the cloud build can't even find a project. Every
app in the portfolio (Paperix → Floorprint) re-derived this the hard way;
this skill is the contract.

## The four rules

**1. Materialize the gitignored `.xcodeproj`.**
`ci_scripts/ci_post_clone.sh` must run *every* local generation step in the
same order a developer's `build.sh` does — build-info generation, asset
generation, then `xcodegen generate`. Failure mode: "works locally" because
the developer ran steps by hand; the clean clone has none of their outputs.

**2. Mirror rule.**
Any NEW local generation step lands in `ci_post_clone.sh` **in the same
change**. Drift here is invisible until release time, when the cloud archive
breaks. (Floorprint's real script mirrors `GenerateBuildInfo.sh` before
`xcodegen generate` — that's the pattern.)

**3. Pin SPM via committed `Package.resolved`.**
Xcode Cloud disables automatic SPM resolution and requires a
`Package.resolved` *inside the generated project*. Commit the root
`Package.resolved`, then copy it in after generation:

```bash
RESOLVED_DST="<App>.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "$RESOLVED_DST"
cp Package.resolved "$RESOLVED_DST/Package.resolved"
```

Evidence: floorprint `fix: commit Package.resolved pin for Xcode Cloud SPM
resolution` — cloud resolved different versions than local until pinned.

**4. brew + stdlib only.**
The script runs before credential setup: no gems, no tokens, no network
beyond `brew install xcodegen`.

## Canonical template

`/ios-scaffold` places the rendered template at `ci_scripts/ci_post_clone.sh`
(source: `plugins/ios-dev/skills/ios-scaffold/templates/ci_post_clone.sh`).
The marked `>>> mirror local generation steps here` line is where app-specific
steps go.

## Real-world instance

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$CI_PRIMARY_REPOSITORY_PATH"
brew install xcodegen
SRCROOT="$(pwd)" ./Floorprint/App/GenerateBuildInfo.sh   # mirror rule in action
xcodegen generate
RESOLVED_DST="Floorprint.xcodeproj/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "$RESOLVED_DST"
cp Package.resolved "$RESOLVED_DST/Package.resolved"
```

## Related

- `references/workflow-recipe.md` — the two Xcode Cloud workflows (PR check +
  tag-triggered release) and how the release skill's `v*` tag push fires the
  hosted archive.
- Skill `xcode-cloud-validate` — pre-push validation of the cloud setup.
- Skill `release` — S7 tag push is the release trigger.

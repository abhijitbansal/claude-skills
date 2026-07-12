# Fastlane Upload + Pushed Release Tag = Redundant Xcode Cloud Build (ITMS-90189)

**Extracted:** 2026-07-12
**Context:** Mined from Cubby session log 0022 (v0.3.0 build 8 release close-out).

## Problem
A project with **two release paths** — local fastlane (`pilot`) upload AND Xcode Cloud configured with a `v*` tag as its release-workflow trigger — double-builds when the normal release ritual is followed: upload the binary via fastlane, then push the release tag. The pushed tag kicks a redundant Xcode Cloud build of the same commit, which tries to upload the same version/build number and fails with **ITMS-90189 (redundant binary upload)** — noise at best, a confusing red CI run at worst.

## Solution
Pick one trigger per release, and make the tag policy explicit:
- If fastlane did the upload, **create the release tag locally but do not push it** (it lives in `.git` as a marker; push later only if a Cloud rebuild is acceptable/desired).
- Alternatively, scope the Xcode Cloud workflow trigger so it can't collide (different tag pattern, branch-based trigger, or manual-only), and document which path owns uploads.
- Record the policy in the release runbook — the trap only bites at the very end of an otherwise-successful release, when the habit is to "finish" by pushing the tag.

## Evidence
Session 0022 wave-end: "Tag `v0.3.0-b8` created but NOT pushed (user chose keep-local). Cubby's CI is Xcode Cloud and a pushed `v*` tag is its release trigger; pushing after the fastlane upload would kick a redundant Cloud build re-uploading build 8 (ITMS-90189)."

## When to Use
Any iOS/macOS project that has both Xcode Cloud (or any tag-triggered CI release workflow) and a local fastlane/altool upload lane. Check the CI trigger config before pushing release tags as part of a fastlane-driven release.

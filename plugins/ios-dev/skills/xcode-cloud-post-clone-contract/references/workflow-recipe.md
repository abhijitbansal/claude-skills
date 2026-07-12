# Xcode Cloud workflow recipe (per app, one-time ASC setup)

Two workflows per app, configured in App Store Connect → the app → Xcode Cloud.
Prereq: `ci_scripts/ci_post_clone.sh` committed (see SKILL.md) — it's the only
custom script either workflow needs.

## Workflow 1 — PR check

| Setting | Value |
|---|---|
| Start Conditions | Pull Request Changes → any source branch |
| Environment | macOS latest, Xcode latest release, clean |
| Actions | **Build** (scheme from `.claude/app.yml app.scheme`, platform iOS) + **Test** (same scheme, latest iOS Simulator) |
| Signing | none required |
| Post-actions | none |

## Workflow 2 — Release (tag-triggered)

| Setting | Value |
|---|---|
| Start Conditions | **Tag Changes: `v*`** |
| Environment | macOS latest, Xcode latest release, clean |
| Actions | **Archive** — App Store Connect distribution, automatic signing (team from app.yml) |
| Post-actions | **TestFlight Internal Testing** → internal group; notify |

The release skill's stage 7 tags `v<version>-b<build>` (testflight) or
`v<version>` (appstore) and asks before pushing — **pushing the tag IS the
hosted-release trigger**. This makes local S5/S6 (gym/pilot) the fast path and
Xcode Cloud the canonical path; per app you can rely on either.

**Either path, never both, for one build number.** If S5/S6 already
fastlane-uploaded a build locally, pushing that same build's release tag
afterward kicks a redundant Xcode Cloud build that tries to upload the exact
same version/build number and fails `ITMS-90189` (redundant binary upload).
The trap bites at the very end of an otherwise-successful release, when the
habit is to "finish" by pushing the tag: after a local upload, either create
the release tag **without pushing it** (`tag-only` — it stays a local marker,
push later only if a Cloud rebuild is wanted) or push it and accept/ignore the
resulting redundant-upload failure, since the binary already made it to ASC.

Floorprint precedent: its GitHub `release.yml` (manual dispatch) bumps
versions, pushes the `v*` tag, and lets Xcode Cloud take over — Start
Condition "Tag Changes: v*". GH-Actions-side app builds are deliberately NOT
part of the standard (Xcode Cloud owns hosted build/release; the only GH
workflow in the standard is the site deploy).

## Checklist for a new app

1. `/ios-scaffold` → commits `ci_scripts/ci_post_clone.sh`.
2. Commit `Package.resolved` if the app has SPM deps.
3. ASC → app → Xcode Cloud → create the two workflows above.
4. Run skill `xcode-cloud-validate` before the first cloud build.
5. First release: `/release testflight`, accept the tag push, watch the cloud
   archive start.

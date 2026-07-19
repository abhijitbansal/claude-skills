---
name: release
description: Drive an iOS app from "code complete" to "binary uploaded to App Store Connect" with maximum CLI automation. Use when the user says "release", "ship a TestFlight build", "upload to App Store", "cut a release", or invokes `/release`. Two modes — `testflight` (everyday) and `appstore` (milestone). Gates on mining-derived pre-flight checks (compliance strings, entitlement parity, iOS 26 NFC-entitlement + iPad-orientation validation traps, runtime-trap audit), builds via Fastlane gym (xcodebuild fallback), uploads via pilot/deliver (altool fallback), tags, deploys the site. Reads every per-app value from .claude/app.yml (schema v2) — no hardcoded app assumptions. Refuses on dirty tree unless `--force`.
---

# Release ${APP_NAME} to App Store Connect

**Requires `.claude/app.yml` (schema v2)** in the app repo root — run `/ios-init`
(or `/ios-init --migrate` for a v1 file) first. Every per-app value below
(`${APP_NAME}`, extensions, fonts count, usage strings, site repo) comes from
that file via `skills/_lib/load_app_config.sh`. Stage 0 of every run is
`skills/_lib/validate_app_config.sh` — a failing config stops the release.

## Modes

| Invocation | Mode |
|---|---|
| `release testflight` | TestFlight build (everyday). Stages 0–7. |
| `release appstore` | App Store milestone. All stages 0–9. |
| `release` (no arg) | Ask the user which mode. |
| `release <mode> --dry-run` | Run everything up to and including validate; stop before upload. |
| `release <mode> --force` | Bypass pre-flight refusals. |

## Per-app hooks

Before/after each stage `N`, if `${RELEASE_HOOKS_DIR}/s<N>-pre.sh` /
`s<N>-post.sh` exists (default dir `scripts/release-hooks/`), run it with the
mode as `$1`. A non-zero pre-hook aborts the stage — that's the per-app escape
hatch (e.g. Paperix regenerating fonts before S1, or suppressing a reviewed
runtime-trap warning).

## Stage 0 — Credentials + config

**Config:** `bash "${CLAUDE_PLUGIN_ROOT}/skills/_lib/validate_app_config.sh"`
must print `ok:`. On ERROR lines, stop and fix `.claude/app.yml` with the user.

**ASC API key** (needed for upload; skippable under `--dry-run`): required files
- `~/.app-store-connect/AuthKey_<KEY_ID>.p8`
- `~/.app-store-connect/config` containing `KEY_ID=…` and `ISSUER_ID=…`

If missing, STOP and print:

> I need an App Store Connect API key to upload builds. One-time setup:
> 1. Open https://appstoreconnect.apple.com/access/integrations/api
> 2. "+" under Keys → name it "${APP_NAME} Release CLI", role "App Manager"
> 3. Generate. **Download the `.p8` — Apple only lets you download it once.**
> 4. Note the Key ID (10 chars) and Issuer ID (UUID).
> 5. ```bash
>    mkdir -p ~/.app-store-connect && chmod 700 ~/.app-store-connect
>    mv ~/Downloads/AuthKey_*.p8 ~/.app-store-connect/
>    chmod 600 ~/.app-store-connect/AuthKey_*.p8
>    cat > ~/.app-store-connect/config <<'EOF'
>    KEY_ID=PASTE_KEY_ID_HERE
>    ISSUER_ID=PASTE_ISSUER_ID_HERE
>    EOF
>    chmod 600 ~/.app-store-connect/config
>    ```
> 6. Re-run `release <mode>`.

Never echo `KEY_ID`, `ISSUER_ID`, or `.p8` contents into any output or log.

## Stage 1 — Pre-flight gates 🤖

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/preflight.sh" --mode <mode> --next-version <planned-version>
```

Output contract: `PASS|WARN|FAIL: <gate>[: detail]`; exit 1 iff any FAIL. Gates:

| Gate | Checks | On failure |
|---|---|---|
| `tree-clean` | no uncommitted changes | commit/stash, or `--force` |
| `branch` | on `main` (WARN otherwise) | switch or proceed knowingly |
| `xcodegen-fresh` | `xcodegen generate` succeeds | fix project.yml |
| `signing-identity` | "Apple Distribution" identity in keychain | switch to paid team in Xcode |
| `fonts` | `.ttf` count == `release.fonts_expected` (skip if 0) | run the app's font installer |
| `usage-strings` | every `release.usage_strings` key in the GENERATED plist | add to project.yml Info properties |
| `encryption-flag` | `ITSAppUsesNonExemptEncryption` declared | add it (mining: forgot twice; wastes a review round) |
| `capabilities` | plist `UIRequiredDeviceCapabilities` ⊆ `release.required_capabilities` | remove stray capability (mining: `lidar-depth-camera` blocked install base) |
| `nfc-entitlement` | NFC `readersession.formats` is not `NDEF` | the iOS 26 SDK rejects the `NDEF` value (ITMS-90778) — ship `TAG` + migrate `NFCNDEFReaderSession`→`NFCTagReaderSession` (only surfaced at validate, cost a build number) |
| `ipad-orientation` | universal app declares all 4 iPad orientations | ITMS-90474 — add them to `UISupportedInterfaceOrientations~ipad`; `UIRequiresFullScreen` is deprecated on iOS 26 and no longer opts out |
| `entitlement-parity` | App Group identical across app + `targets.extensions` | fix entitlements (mining: mismatch only surfaced at validate, wasting a build number) |
| `runtime-trap` | WARN-only: heavy work in `App.init`/`.task`/`onAppear` without off-main dispatch | read skill `mainactor-launch-watchdog-audit`; fix or accept knowingly |
| `whatsnew` | `release.whatsnew_file` has an entry for the next version (FAIL in appstore mode, WARN in testflight) | add the entry |
| `inapp-whatsnew` | `release.inapp_changelog_file` has an entry for the next version — sibling gate for the in-app changelog surface, distinct from ASC metadata above; optional, skipped cleanly when unset (FAIL in appstore mode, WARN in testflight when configured) | add the `ChangelogEntry` |

Report every WARN to the user even when the run continues.

## Stage 2 — Version bump 🤖/✋

Ask which bump. For appstore: `patch`/`minor`/`major`. For testflight: offer
`release.testflight_bump` from `.claude/app.yml` as the default (`build` when the
key is unset — some repos bump `patch` per TestFlight release instead). Then:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/bump_version.sh" <kind>
# → prints: version=<MV> build=<BV>   (capture both)
xcodegen --spec project.yml --quiet
git add project.yml
git commit -m "chore(release): bump to v<MV> build <BV>"
```

`project.yml` is the ONLY place versions change — never agvtool, never the
pbxproj, never by hand (rule was re-learned in 3 apps; now it's executable).

## Stage 3 — Release notes 🤖/✋

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/release_notes.sh" <MV>
# → prints the draft path: build/release-notes-<MV>.md
```

Collects `Release-Note:` commit trailers since the last `v*` tag (adopt the
trailer habit in every commit that changes user-facing behavior). Show the
draft; let the user edit. In appstore mode also confirm the whatsnew file entry
(already gated in S1) and update the "What's New" section of
`marketing/app-store-listing.md`, committing with
`docs(release): update what's new for v<MV>`.

**Two independent "What's New" surfaces** (see skill
`release-inapp-vs-asc-whatsnew-surfaces` if either is configured): the in-app
`Changelog`/`FeatureCatalog` data (`release.inapp_changelog_file`) is
**binary** — compiled into the app, only visible once a build containing the
new entry ships. App Store Connect's "What's New"/"What to Test" metadata
(`release.whatsnew_file`) is a **manual paste**, independent of the binary —
no upload lane can push it. Updating one does not update the other; gate S1
checks both when configured, but the content itself still needs writing in
both places.

## Stage 4 — Local build + test 🤖

```bash
./"${APP_BUILD_SCRIPT}" --no-launch   # sim build via the app's wrapper
xcodebuild test -scheme "${APP_SCHEME}" -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -40
```

All checks run locally (user decision: local + Xcode Cloud). On failure surface
the last 40 lines and STOP — the user fixes, then re-runs (re-bumping is
correct behavior).

**Verify warnings on a COLD build.** A warm incremental `xcodebuild` does *not*
re-emit warnings for files it didn't recompile — a release binary can look
warning-clean while unchanged files still warn. To trust a "zero warnings"
claim before shipping, force a clean build:

```bash
rm -rf build ~/Library/Developer/Xcode/DerivedData/${APP_NAME}-*
./"${APP_BUILD_SCRIPT}" --no-launch
```

## Stage 5 — Archive + export 🤖

**Fastlane path** (when `fastlane/Fastfile` exists — `/ios-scaffold` creates it):

```bash
bundle exec fastlane archive     # gym: scheme/team from the rendered Fastfile
```

**Cold-start signing.** On a machine with no App Store *distribution*
provisioning profile yet, gym's *automatic* export cannot resolve one — the
archive signs clean but export fails with "no provisioning profile mapping".
Make the `archive` lane self-contained: create/fetch the profile via the ASC
API key, then export with a **manual** signing map. In the Fastfile:

```ruby
# Fetch/map a profile for the main app AND every signed embedded extension
# (targets.extensions in .claude/app.yml, e.g. a widget/share/notification-
# service .appex) — a target left out of this loop archives fine but fails
# at export with "no provisioning profile mapping" for its bundle id.
signed_targets = [APP_IDENTIFIER] + APP_EXTENSION_IDENTIFIERS   # from app.yml
profiles = signed_targets.map do |identifier|
  name = get_provisioning_profile(   # sigh; App Store type by default
    api_key: asc_api_key, app_identifier: identifier, readonly: false)
  [identifier, name]
end.to_h
gym(export_method: "app-store", export_options: {
  signingStyle: "manual",
  provisioningProfiles: profiles,   # every signed target, not just the app
})
```

Every embedded extension added to the app must be added to this list at the
same time it's added to the Xcode project — treat it like entitlement parity
(S1 gate): both are "every signed target needs matching setup," just for
different concerns.

**Fallback (no Fastfile)** — raw xcodebuild, kept working on purpose:

```bash
mkdir -p build
xcodebuild archive -scheme "${APP_SCHEME}" -configuration Release \
  -destination "generic/platform=iOS" -archivePath "build/${APP_NAME}.xcarchive" \
  DEVELOPMENT_TEAM="${APP_TEAM_ID}" -allowProvisioningUpdates \
  | tee build/archive.log | xcbeautify || true
grep -q "ARCHIVE SUCCEEDED" build/archive.log   # exit code is eaten by the pipe
cat > build/ExportOptions.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${RELEASE_EXPORT_METHOD}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "build/${APP_NAME}.xcarchive" \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/ \
  -allowProvisioningUpdates | tee build/export.log | xcbeautify || true
```

Either path must yield `build/${APP_NAME}.ipa`. `--dry-run` continues to
validate (S6) but stops before upload.

## Stage 6 — Validate + upload ✋ (the only irreversible step)

Validate first (both paths):

```bash
xcrun altool --validate-app -f "build/${APP_NAME}.ipa" --type ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
```

`--dry-run` stops here, printing what WOULD upload (version, build, mode).

Then ask, verbatim:

> Ready to upload ${APP_NAME} v<MV> build <BV> to App Store Connect (<mode>).
> Build numbers cannot be reused — a failed upload means re-bumping.
> Type 'upload' to confirm, or anything else to abort.

Only on the exact answer `upload`:

```bash
# fastlane path
bundle exec fastlane beta       # testflight (pilot)
bundle exec fastlane release    # appstore  (deliver, no auto-submit)
# fallback
xcrun altool --upload-app -f "build/${APP_NAME}.ipa" --type ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
```

Recovery table:

| Error | Recovery |
|---|---|
| `ITMS-90283 Invalid Provisioning Profile` | signing drift — re-archive |
| `ITMS-90189 Redundant Binary Upload` | usually: build number already used — re-run, S2 bumps. If this fired from a Cloud build **after** S6 already uploaded this build locally: expected — see S7's tag-push caveat, no action needed |
| `Authentication failed` | check `~/.app-store-connect/config` IDs + `.p8` filename |
| "missing entitlement" at validate | App Group parity across targets — see S1 gate, re-archive |

## Stage 7 — Tag ✋

Tag `v<MV>-b<BV>` (testflight) or `v<MV>` (appstore), annotated with the notes:

```bash
git tag -a "<tag>" -F "build/release-notes-<MV>.md"
```

Ask before pushing (`yes` / `tag-only` / `skip`) — pushed tags are public, and
a pushed `v*` tag is the Xcode Cloud release trigger (see skill
`xcode-cloud-post-clone-contract`), so pushing may start a hosted build.
**This build was already uploaded in S6 above** — if Xcode Cloud is also
tag-triggered for this app, pushing now kicks a *redundant* hosted build that
will fail `ITMS-90189` re-uploading the same binary. That failure is expected
and harmless (the binary already made it to ASC); default to `tag-only`
unless a Cloud rebuild is specifically wanted.

## Stage 8 — Site deploy (appstore mode, if `site.repo` is set) ✋

Delegate to `/site deploy` (skill `site-pages-deploy-kit`): refresh assets if
the app has a refresh script, `verify-site.sh`, then subtree-push. Skip freely.

## Stage 9 — ASC web-UI checklist (appstore mode) 👤

> 🎉 Build uploaded. Remaining App Store Connect web-UI steps:
> Open https://appstoreconnect.apple.com → My Apps → ${APP_NAME} → iOS App <MV>.
> 1. [ ] **Build** — select this build once processing finishes (~5–30 min email).
> 2. [ ] **What's New** — paste from `marketing/app-store-listing.md`. This is the ASC-metadata surface specifically — separate from any in-app changelog already baked into the uploaded build.
> 3. [ ] **App Privacy** — verify declarations still accurate.
> 4. [ ] **Screenshots** — upload from `marketing/screenshots/` if changed.
> 5. [ ] **Description/Keywords/Promo text** — paste from `marketing/app-store-listing.md`.
> 6. [ ] **Export Compliance** — matches `release.encryption_exempt`.
> 7. [ ] **App Review Information** — contact + reviewer note.
> 8. [ ] **Submit for Review**.

## Red flags — never do these

- ❌ Auto-push tags or upload without the explicit confirmation word
- ❌ Echo `KEY_ID` / `ISSUER_ID` / `.p8` contents anywhere
- ❌ Continue past a FAIL gate without `--force`
- ❌ Modify `project.yml` versions outside `bump_version.sh`
- ❌ `git add -A` — name files explicitly

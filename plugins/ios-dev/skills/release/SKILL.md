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

`scripts/release.sh <mode>` is the non-interactive core of Stages 1 and 5-7. Its
flags: `--dry-run`, `--force`, `--next-version <X.Y.Z>` (forwarded to the
Stage 1 gates) and `--confirm-upload` (the script never prompts; it refuses to
upload without this flag, see Stage 6). `XCODEBUILD_FLAGS` adds words to the
fallback `xcodebuild archive` and `-exportArchive` calls.

## Per-app hooks

Before/after each stage `N`, if `${RELEASE_HOOKS_DIR}/s<N>-pre.sh` /
`s<N>-post.sh` exists (default dir `scripts/release-hooks/`), run it with the
mode as `$1`. A non-zero pre-hook aborts the stage — that's the per-app escape
hatch (e.g. an app regenerating fonts before S1, or suppressing a reviewed
runtime-trap warning). `release.sh` runs the S1, S5, S6 and S7 hooks (S1 before
the pre-flight gates, S7 around the tag); a hook file that exists but is not
executable is reported and skipped. Hooks for the other stages are not run by
the script: run them yourself if the app has them.

## Stage 0 — Credentials + config

**Config:** `bash "${CLAUDE_PLUGIN_ROOT}/skills/_lib/validate_app_config.sh"`
must print `ok:`. On ERROR lines, stop and fix `.claude/app.yml` with the user.

**ASC API key** (required for the Fastlane archive path, validate and upload,
so NOT skippable under `--dry-run`): required files
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

`release.sh` sources that config file before Stage 5 and exports
`ASC_KEY_ID` (from `KEY_ID`), `ASC_ISSUER_ID` (from `ISSUER_ID`) and
`ASC_KEY_PATH` (`${API_PRIVATE_KEYS_DIR}/AuthKey_<KEY_ID>.p8`) for the
Fastfile's `archive` lane; values already set in the environment win.

Never echo `KEY_ID`, `ISSUER_ID`, or `.p8` contents into any output or log.

## Stage 1 — Pre-flight gates 🤖

Ask the bump kind first (the Stage 2 question), then get the planned version
without writing anything, so the whatsnew gates check the right entry:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/bump_version.sh" --print <kind>
# → version=<planned MV> build=<next BV>
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/preflight.sh" --mode <mode> --next-version <planned MV>
```

Output contract: `PASS|WARN|FAIL|SKIP: <gate>[: detail]`; exit 1 iff any FAIL.
`SKIP` means the gate did not run because its input is absent (for example the
whatsnew gates without `--next-version`); it is never a pass. A gate that cannot
verify its subject (no entitlements to read, no plist, no icon) FAILs in
appstore mode and WARNs in testflight mode, except where the row says WARN.
Gates:

| Gate | Checks | On failure |
|---|---|---|
| `tree-clean` | no uncommitted changes | commit/stash, or `--force` |
| `branch` | on `main` (WARN otherwise) | switch or proceed knowingly |
| `xcodegen-fresh` | `xcodegen generate` succeeds | fix project.yml |
| `signing-identity` | "Apple Distribution" identity in keychain | switch to paid team in Xcode |
| `fonts` | `.ttf` count == `release.fonts_expected` (skip if 0) | run the app's font installer, or update `release.fonts_expected` when the count grew on purpose; never `--force` past it |
| `plist-conversion` | XML copy of the generated plist staged via `plutil` (python3 `plistlib` fallback → WARN); FAIL means the three plist gates below could not run | fix the environment (plutil/python3) or the corrupt plist — never grep the binary plist raw |
| `usage-strings` | every `release.usage_strings` key in the plist: the build product under `build/`, else the file at the app target's `info.path` in project.yml (that file lacks keys set only through `INFOPLIST_KEY_*` build settings). No plist found → unverified | add to project.yml Info properties; build once if unverified |
| `encryption-flag` | `ITSAppUsesNonExemptEncryption` declared | add it (mining: forgot twice; wastes a review round) |
| `capabilities` | plist `UIRequiredDeviceCapabilities` ⊆ `release.required_capabilities`; an empty list allows nothing, so any capability in the plist FAILs (appstore) or WARNs (testflight) | remove the stray capability or list it in `.claude/app.yml`. `lidar-depth-camera` is not a valid value at any `MinimumOSVersion` (ITMS-90098); gate LiDAR at runtime (`RoomCaptureSession.isSupported`), see skill `xcode-cloud-validate` |
| `nfc-entitlement` | NFC `readersession.formats` is not `NDEF` in any checked-in `.entitlements` file | the iOS 26 SDK rejects the `NDEF` value (ITMS-90778) — ship `TAG` + migrate `NFCNDEFReaderSession`→`NFCTagReaderSession` (only surfaced at validate, cost a build number) |
| `ipad-orientation` | universal app declares all 4 iPad orientations. A project.yml with no `TARGETED_DEVICE_FAMILY` counts as universal (the XcodeGen default) | ITMS-90474 — add them to `UISupportedInterfaceOrientations~ipad`; `UIRequiresFullScreen` is deprecated on iOS 26 and no longer opts out |
| `entitlement-parity` | App Group identical across app + `targets.extensions`, read from each target's checked-in `.entitlements` (declared `entitlements.path`, else `<Target>.entitlements`); a per-app hook may leave `build/gen/<Target>.entitlements.groups` as a fallback. A target with neither is unverified, never a pass | fix entitlements (mining: mismatch only surfaced at validate, wasting a build number) |
| `runtime-trap` | WARN-only: heavy work in `App.init`/`.task`/`onAppear` without off-main dispatch, scanning the app target's project.yml `sources` (`Sources/` when none declared) | read skill `mainactor-launch-watchdog-audit`; fix or accept knowingly |
| `whatsnew-config` | WARN-only hint: a `WhatsNew*.json` (or `Changelog*.swift` / `FeatureCatalog*.swift`) exists but `release.whatsnew_file` (or `release.inapp_changelog_file`) is unset, so the gates below would SKIP | set the key in `.claude/app.yml` |
| `whatsnew` | `release.whatsnew_file` has an entry for the next version (FAIL in appstore mode, WARN in testflight). SKIP when the key is unset or `--next-version` is absent | add the entry |
| `inapp-whatsnew` | `release.inapp_changelog_file` has an entry for the next version — sibling gate for the in-app changelog surface, distinct from ASC metadata above; optional (FAIL in appstore mode, WARN in testflight when configured). SKIP when unset or `--next-version` is absent | add the `ChangelogEntry` |
| `icon-opaque` | the light 1024 px icon in `AppIcon.appiconset` (the 1024x1024 entry of `Contents.json` without `appearances`) has no alpha channel. Dark and tinted variants keep alpha and are never checked. No appiconset, or no light entry, is a WARN, not a pass | re-encode the PNG without alpha (CoreGraphics `noneSkipLast`); the fix reaches App Store Connect only with the next uploaded build |
| `screenshot-sizes` | appstore mode only: every PNG/JPEG under `marketing/screenshots/` has a pixel size listed in `skills/_lib/asc_screenshot_sizes.txt` (both orientations). SKIP in testflight mode, with no directory, or with no images | re-render at an accepted size; never scale non-uniformly. The size list is one data file: update it there when Apple adds a device class |

Report every WARN to the user even when the run continues.

## Stage 2 — Version bump 🤖/✋

Use the bump kind already chosen in Stage 1 (ask it there if you skipped
ahead). For appstore: `patch`/`minor`/`major`. For testflight: offer
`${RELEASE_TESTFLIGHT_BUMP}` as the default (exported by `load_app_config.sh`
from `release.testflight_bump` in `.claude/app.yml`; `build` when the key is
unset — some repos bump `patch` per TestFlight release instead). Then:

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
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/release_notes.sh" <MV> --mode <mode>
# → stdout: the draft path .scratch/release/release-notes-<MV>.md
# → stderr: "scanned N commits since <tag>, found M trailers"
```

Collects `Release-Note:` lines from commit messages since the nearest `v*` tag
(adopt the habit in every commit that changes user-facing behavior). The match
is line-anchored per commit, so a line in its own paragraph, apart from
`Co-Authored-By:`, still counts; a quoted `> Release-Note:` line does not. In
appstore mode TestFlight tags (`release.testflight_tag_format`, default
`v{version}-b{build}`) are skipped, so the range starts at the last App Store
release. Zero lines found stops with exit 4: ask the user for the notes and
write them to the draft path, or pass `--allow-empty` for the generic line.
The draft lives in `.scratch/release/` (excluded locally, never in `git status`,
not deleted by a cold build) and Stage 7 tags from it. Show the
draft; let the user edit. In appstore mode also confirm the whatsnew file entry
(already gated in S1) and update the "What's New" section of
`marketing/app-store-listing.md`, committing with
`docs(release): update what's new for v<MV>`.

**Two independent "What's New" surfaces** (see skill
`release-inapp-vs-asc-whatsnew-surfaces` if either is configured): the in-app
`Changelog`/`FeatureCatalog` data (`release.inapp_changelog_file`) is
**binary** — compiled into the app, only visible once a build containing the
new entry ships. App Store Connect's "What's New"/"What to Test" metadata
(`release.whatsnew_file`) is independent of the binary: copy
`release.whatsnew_file` into `fastlane/metadata/<locale>/release_notes.txt`
(deliver) or pass it as pilot's `changelog:`, or paste it manually in App
Store Connect. Updating one does not update the other; gate S1 checks both
when configured, but the content itself still needs writing in both places.

## Stage 4 — Local build + test 🤖

```bash
./"${APP_BUILD_SCRIPT}" --no-launch   # sim build via the app's wrapper
xcodebuild test -scheme "${APP_SCHEME}" -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

All checks run locally (user decision: local + Xcode Cloud). Run it bare — a
`| tail` pipe would swallow the exit status. On failure surface the last 40
lines of output and STOP — the user fixes, then re-runs (re-bumping is
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
Make the `archive` lane self-contained: fetch or create the profile via the ASC
API key (the App IDs must already exist in the developer portal), then export
with a **manual** signing map. The canonical full lane is `ios-scaffold`'s
`templates/Fastfile`; the snippet below shows only the signing core (scheme,
output options etc. live in the template):

```ruby
# Fail early, not with a KeyError: release.sh exports these from the Stage 0
# key files (~/.app-store-connect).
unless %w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH].all? { |k| !ENV[k].to_s.empty? }
  UI.user_error!("ASC_KEY_ID/ASC_ISSUER_ID/ASC_KEY_PATH unset — run release Stage 0 (/release) or export them")
end
api_key = app_store_connect_api_key(
  key_id: ENV.fetch("ASC_KEY_ID"),
  issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  key_filepath: ENV.fetch("ASC_KEY_PATH"))   # path to the AuthKey_*.p8

# Fetch/map a profile for the main app AND every signed embedded extension
# (a widget/share/notification-service .appex) — a target left out of this
# loop archives fine but fails at export with "no provisioning profile
# mapping" for its bundle id.
# TARGETS_EXTENSIONS (targets.extensions in .claude/app.yml, exported by
# load_app_config.sh) holds target NAMES, space-separated, not bundle ids.
# Each id is derived as "<app bundle id>.<TargetName>" with the name
# rfc1034-sanitised (runs of spaces/underscores become '-', as Xcode does for
# PRODUCT_NAME), Xcode's default for a new extension target. A target whose
# product name differs from its target name, or any other deviation, needs
# APP_EXTENSION_BUNDLE_IDS (space-separated bundle ids) to override.
# APP_IDENTIFIER is rendered from app.bundle_id into the Fastfile by
# ios-scaffold (see the template), so no env var can be missing here.
app_identifier = APP_IDENTIFIER
extension_identifiers =
  if ENV["APP_EXTENSION_BUNDLE_IDS"].to_s.strip.empty?
    ENV.fetch("TARGETS_EXTENSIONS", "").split.map do |name|
      "#{app_identifier}.#{name.gsub(/[ _]+/, '-')}"
    end
  else
    ENV["APP_EXTENSION_BUNDLE_IDS"].split
  end
UI.important("TARGETS_EXTENSIONS is empty: signing only the main app") if extension_identifiers.empty?
signed_targets = [app_identifier] + extension_identifiers
profiles = signed_targets.map do |identifier|
  get_provisioning_profile(   # sigh; App Store type by default
    api_key: api_key, app_identifier: identifier, readonly: false)
  [identifier, lane_context[SharedValues::SIGH_NAME]]   # profile name (SIGH_NAME); the action itself returns the UUID
end.to_h
# gym rejects the app.yml value "app-store-connect" (it accepts app-store,
# validation, ad-hoc, package, enterprise, development, developer-id,
# mac-application), so map it to gym's name.
m = ENV.fetch("RELEASE_EXPORT_METHOD", "app-store-connect")
GYM_EXPORT_METHOD = { "app-store-connect" => "app-store", "release-testing" => "ad-hoc",
                      "debugging" => "development" }.fetch(m, m)
gym(export_method: GYM_EXPORT_METHOD,
    export_options: {
      method: GYM_EXPORT_METHOD,
      signingStyle: "manual",
      provisioningProfiles: profiles,   # every signed target, not just the app
    })
```

Fastlane does not source `load_app_config.sh`. **`release.sh` does all of the
following for you and is the supported path** — it loads `.claude/app.yml`,
reads the Stage 0 key files and exports `APP_*`, `TARGETS_EXTENSIONS` and
`ASC_*` before invoking the lane. A bare `bundle exec fastlane archive` sees an
empty extension list, and the lane warns when it does. To run the lane by hand,
from the app repo (the loader walks up from `$PWD` to find `.claude/app.yml`):

```bash
source "${CLAUDE_PLUGIN_ROOT}/skills/_lib/load_app_config.sh"   # or the installed plugin cache path
source ~/.app-store-connect/config
export ASC_KEY_ID="$KEY_ID" ASC_ISSUER_ID="$ISSUER_ID" \
  ASC_KEY_PATH="$HOME/.app-store-connect/AuthKey_$KEY_ID.p8"
bundle exec fastlane archive
```

Read `fastlane-archive-multi-target-signing` before editing the archive lane.
The extension list is derived from `targets.extensions` in `.claude/app.yml`,
not edited in the Fastfile. When a derived bundle id does not match (for
example a target whose product name differs from its target name), set
`APP_EXTENSION_BUNDLE_IDS` to the space-separated bundle ids. There is no
`app.yml` key for it: `export` it in the shell that runs `release.sh` (a
`direnv` `.envrc` or your shell profile). A `release-hooks` script is
executed, not sourced, so it cannot export the variable into the lane. The
Stage 0 config file is sourced by `release.sh`, but it holds credentials and
is shared across apps, so keep per-app overrides out of it. Add every embedded
extension to `targets.extensions`
at the same time it's added to the Xcode project — treat it like entitlement
parity (S1 gate): both are "every signed target needs matching setup," just
for different concerns.

**Fallback (no Fastfile)** — raw xcodebuild, kept working on purpose:

```bash
mkdir -p build
archive_args=(-scheme "${APP_SCHEME}" -configuration Release
  -destination "generic/platform=iOS" -archivePath "build/${APP_NAME}.xcarchive"
  DEVELOPMENT_TEAM="${APP_TEAM_ID}" -allowProvisioningUpdates)
# A command-line PRODUCT_BUNDLE_IDENTIFIER overrides every target, so with
# embedded extensions it would give them the app's id (duplicate
# CFBundleIdentifier in the archive). Pass it only for single-target apps.
if [[ -z "${TARGETS_EXTENSIONS:-}" ]]; then
  archive_args+=(PRODUCT_BUNDLE_IDENTIFIER="${APP_BUNDLE_ID}")
fi
# XCODEBUILD_FLAGS (env, space-separated words) is appended to every xcodebuild
# call below, e.g. plugin-validation flags a build needs; release.sh does the
# same and exports it for the Fastfile.
read -r -a xcodebuild_extra <<< "${XCODEBUILD_FLAGS:-}"
# Pipe through xcbeautify only when it is installed.
pretty() { if command -v xcbeautify >/dev/null; then xcbeautify; else cat; fi; }
xcodebuild archive "${archive_args[@]}" ${xcodebuild_extra[@]+"${xcodebuild_extra[@]}"} \
  | tee build/archive.log | pretty || true
grep -q "ARCHIVE SUCCEEDED" build/archive.log   # exit code is eaten by the pipe
# Unlike gym (which needs app-store), xcodebuild -exportArchive accepts the
# Xcode 15.3+ names, so ${RELEASE_EXPORT_METHOD} is used unmapped here.
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
  -allowProvisioningUpdates ${xcodebuild_extra[@]+"${xcodebuild_extra[@]}"} \
  | tee build/export.log | pretty || true
```

Either path must yield `build/${APP_NAME}.ipa`. `--dry-run` continues to
validate (S6) but stops before upload.

The scaffold's Fastfile `gym` call can pick the same flags up from the exported
`XCODEBUILD_FLAGS` (`xcargs`); the template is owned by `ios-scaffold`, so check
that it reads the variable before relying on it for the Fastlane path.

## Stage 6 — Validate + upload ✋ (the only irreversible step)

Validate first (both paths). `altool --apiKey` looks for `AuthKey_<KEY_ID>.p8`
in `API_PRIVATE_KEYS_DIR` (or `~/.private_keys` etc.), not `~/.app-store-connect/`
— point it there first. `$KEY_ID` / `$ISSUER_ID` come from the Stage 0
config file (`release.sh` sources it for you; by hand, source it first):

```bash
source ~/.app-store-connect/config   # defines KEY_ID, ISSUER_ID
export API_PRIVATE_KEYS_DIR="${API_PRIVATE_KEYS_DIR:-${HOME}/.app-store-connect}"
xcrun altool --validate-app -f "build/${APP_NAME}.ipa" --type ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
```

`--dry-run` stops here, printing what WOULD upload (version, build, mode).
`release.sh` never prompts: without `--confirm-upload` it stops before the
upload and says so, so an agent can run the whole flow and still keep the user's
confirmation.

Then ask, verbatim:

> Ready to upload ${APP_NAME} v<MV> build <BV> to App Store Connect (<mode>).
> Build numbers cannot be reused — a failed upload means re-bumping.
> Type 'upload' to confirm, or anything else to abort.

Only on the exact answer `upload`, re-run the script with the flag (it checks
the `AuthKey_<KEY_ID>.p8` file before the build, uploads, then tags in Stage 7):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/release.sh" <mode> --next-version <MV> --confirm-upload
```

Or by hand:

```bash
# fastlane path
bundle exec fastlane beta       # testflight (pilot)
bundle exec fastlane release    # appstore  (deliver, no auto-submit)
# fallback (same config source + API_PRIVATE_KEYS_DIR export as the validate step above)
source ~/.app-store-connect/config
export API_PRIVATE_KEYS_DIR="${API_PRIVATE_KEYS_DIR:-${HOME}/.app-store-connect}"
xcrun altool --upload-app -f "build/${APP_NAME}.ipa" --type ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
```

**After the upload: confirm the build landed.** If the upload command exits
non-zero, first look for `UPLOAD SUCCEEDED` in its output (see the recovery row
below). Then check App Store Connect before any re-bump, filtering by the exact
build number and polling, because processing is delayed. Label: seen in one
repo, not yet run in this form. The `altool --list-builds` option no longer
exists, and `fastlane pilot` / `latest_testflight_build_number` failed on auth in
that repo (observed on Xcode 16 in 2026-07; may have changed). Xcode Cloud builds
share the marketing version, so match on the build number, never on recency:

```ruby
# ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH from Stage 0; APP_BUNDLE_ID and BUILD_NUMBER from the run.
require "spaceship"
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: ENV.fetch("ASC_KEY_ID"), issuer_id: ENV.fetch("ASC_ISSUER_ID"),
  filepath: ENV.fetch("ASC_KEY_PATH"))
app = Spaceship::ConnectAPI::App.find(ENV.fetch("APP_BUNDLE_ID"))
12.times do
  build = Spaceship::ConnectAPI::Build.all(app_id: app.id, build_number: ENV.fetch("BUILD_NUMBER")).first
  puts(build ? "build #{ENV['BUILD_NUMBER']}: #{build.processing_state}" : "build not listed yet")
  break if build && build.processing_state == "VALID"
  sleep 60
end
```

Recovery table (Stages 5-6):

| Error | Recovery |
|---|---|
| `xcodebuild` / `fastlane` stops at Stage 5 because a new Apple Developer Program License Agreement (PLA) must be accepted | only the Account Holder can accept it, in the developer account or App Store Connect; ask them, then re-run. Nothing in the repo fixes it |
| `fastlane beta` / `release` exits 1 after the log shows `UPLOAD SUCCEEDED`, with `Failed to create URL for CDUploaderStateInfoResumeFilePath` | the upload worked and only a resume-file cleanup failed. Treat it as success once App Store Connect lists the build (check above); do not re-bump or re-upload. Run fastlane bare, not piped, so the success line survives |
| `ITMS-90283 Invalid Provisioning Profile` | signing drift — re-archive |
| `ITMS-90189 Redundant Binary Upload` | usually: build number already used — re-run, S2 bumps. If this fired from a Cloud build **after** S6 already uploaded this build locally: expected — see S7's tag-push caveat, no action needed |
| `Authentication failed` | check `~/.app-store-connect/config` IDs + `.p8` filename |
| altool cannot find the key (`AuthKey_<KEY_ID>.p8` not found) | `export API_PRIVATE_KEYS_DIR="$HOME/.app-store-connect"` — altool does not search that dir by default |
| altool errors on an empty `--apiKey` / `--apiIssuer` (`$KEY_ID` / `$ISSUER_ID` unset), or the lane stops with `ASC_KEY_ID/ASC_ISSUER_ID/ASC_KEY_PATH unset` | `source ~/.app-store-connect/config` and export `ASC_*` as in Stage 5, or run via `release.sh`, which does both |
| "missing entitlement" at validate | App Group parity across targets — see S1 gate, re-archive |

## Stage 7 — Tag ✋

`release.sh` creates the tag, once, right after the upload: `v<MV>` (appstore) or
`release.testflight_tag_format` from `.claude/app.yml` (testflight; default
`v<MV>-b<BV>`, placeholders `{version}` and `{build}`), annotated with
`.scratch/release/release-notes-<MV>.md`. It warns and falls back to a
lightweight tag when that draft is missing, and leaves an existing tag alone.
Do not tag by hand on this path. If you uploaded by hand instead of through
`release.sh`, create the tag yourself:

```bash
git tag -a "<tag>" -F ".scratch/release/release-notes-<MV>.md"
```

`release.sh` also writes the ASC paste pack (after the tag, and on `--dry-run`),
`.scratch/release/asc-paste-<MV>.md`: What's
New or What to Test from the notes draft, plus promotional text, description,
subtitle and keywords from `marketing/app-store-listing.md`, each with its
character count against Apple's limit and an OVER LIMIT flag. Rerun it by hand
with `python3 "${CLAUDE_PLUGIN_ROOT}/skills/release/scripts/paste_pack.py" <MV> --mode <mode>`.
A listing section the template does not have yet (Promotional Text, What to
Test) shows as MISSING; add the heading to `marketing/app-store-listing.md`.

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
> 2. [ ] **What's New** — paste from `.scratch/release/asc-paste-<MV>.md` (counts and limits are in it). This is the ASC-metadata surface specifically — separate from any in-app changelog already baked into the uploaded build.
> 3. [ ] **App Privacy** — verify declarations still accurate.
> 4. [ ] **Screenshots** — upload from `marketing/screenshots/` if changed (the `screenshot-sizes` gate already checked their pixel sizes).
> 5. [ ] **Description/Keywords/Promo text** — paste from `.scratch/release/asc-paste-<MV>.md`.
> 6. [ ] **Export Compliance** — matches `release.encryption_exempt`.
> 7. [ ] **App Review Information** — contact + reviewer note.
> 8. [ ] **Store copy** — no rival names or prices anywhere in the listing (guideline 2.3.7).
> 9. [ ] **Privacy label vs network** — grep the app for the hosts it calls (`URLSession`, `URL(string:)`) and compare the list with the App Privacy declarations; a lookup call can change "Data Not Collected".
> 10. [ ] **Site privacy copy** — the site's privacy page says the same as the label.
> 11. [ ] **Submit for Review**.

## Red flags — never do these

- ❌ Auto-push tags or upload without the explicit confirmation word
- ❌ Echo `KEY_ID` / `ISSUER_ID` / `.p8` contents anywhere
- ❌ Continue past a FAIL gate without `--force`
- ❌ Pass `--confirm-upload` before the user typed the exact word `upload`
- ❌ Create the release tag by hand after a `release.sh` upload (it already did)
- ❌ Modify `project.yml` versions outside `bump_version.sh`
- ❌ `git add -A` — name files explicitly

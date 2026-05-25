---
name: release
description: Drive an iOS app from "code complete" to "binary uploaded to App Store Connect" with maximum CLI automation. Use when the user says "release", "ship a TestFlight build", "upload to App Store", "cut a release", or invokes `/release`. Two modes — `testflight` (everyday) and `appstore` (milestone). Runs xcodebuild archive, exports the .ipa, validates and uploads via altool, tags the commit, and prints a checklist of remaining App Store Connect web UI steps. Refuses to run on a dirty tree or wrong branch unless `--force`.
---

# Release ${APP_NAME} to App Store Connect

**Requires `.claude/app.yml`** in the app repo root with `app.name`, `app.bundle_id`, `app.scheme`, `app.team_id`. The release script sources `skills/_lib/load_app_config.sh` to load them. Some checks below (font count, widget entitlements, marketing files) are Paperix-shaped patterns and may need adjustment per app.

> Some paths and checks below (font count check, widget entitlement names, marketing/app-store-listing.md) are Paperix-shaped patterns — adjust per app.

A pipeline that takes you from a clean working tree to a build processing in App Store Connect, automating everything the CLI can do and pointing you at the web UI for the rest.

## Modes

| Invocation | Mode |
|---|---|
| `release testflight` | TestFlight build (everyday). Stages 0, 1, 3, 5–10. |
| `release appstore` | App Store milestone. All stages. |
| `release` (no arg) | Ask the user which mode. |
| `release <mode> --force` | Bypass pre-flight refusals and idempotency skips. |
| `release <mode> --skip-tests` | Skip stage 5 (sim build). |

## Pipeline stages

## Stage 0 — One-time setup (App Store Connect API key)

Run this check at the START of every invocation. If credentials exist, silently move to stage 1.

Required files:
- `~/.app-store-connect/AuthKey_<KEY_ID>.p8`
- `~/.app-store-connect/config` containing `KEY_ID=…` and `ISSUER_ID=…`

If either is missing, STOP and print these instructions verbatim:

> I need an App Store Connect API key to upload builds. One-time setup:
>
> 1. Open https://appstoreconnect.apple.com/access/integrations/api
> 2. Click "+" under Keys → name it "${APP_NAME} Release CLI", role "App Manager"
> 3. Click Generate. **Download the `.p8` file — Apple only lets you download it once.**
> 4. Note the Key ID (10 chars, shown in the table) and Issuer ID (UUID, above the table).
> 5. Run:
>    ```bash
>    mkdir -p ~/.app-store-connect
>    chmod 700 ~/.app-store-connect
>    mv ~/Downloads/AuthKey_*.p8 ~/.app-store-connect/
>    chmod 600 ~/.app-store-connect/AuthKey_*.p8
>    cat > ~/.app-store-connect/config <<'EOF'
>    KEY_ID=PASTE_KEY_ID_HERE
>    ISSUER_ID=PASTE_ISSUER_ID_HERE
>    EOF
>    chmod 600 ~/.app-store-connect/config
>    ```
> 6. Re-run `release <mode>`.

Then exit. Do not proceed to stage 1.

When credentials are present, source them into env:
```bash
source ~/.app-store-connect/config
export KEY_ID ISSUER_ID
KEY_FILE=$(ls ~/.app-store-connect/AuthKey_*.p8 | head -1)
```

Never echo `KEY_ID`, `ISSUER_ID`, or the contents of the `.p8` file back to the user or into any log.

## Stage 1 — Pre-flight checks (both modes, 🤖)

Run all checks. On any failure, STOP with a clear message and do not proceed. If the user passed `--force`, log the failure and continue anyway.

### Check 1.1: clean working tree

Run: `git status --porcelain`

Expected: empty output.

If non-empty → STOP: "Working tree is dirty. Commit or stash before releasing, or pass --force."

### Check 1.2: on the right branch

Run: `git rev-parse --abbrev-ref HEAD`

Expected: `main` (or value of `$RELEASE_BRANCH` if set).

If different → STOP: "Not on release branch (currently on <X>). Switch to main or pass --force."

### Check 1.3: xcodegen up to date

Run: `xcodegen --spec project.yml --quiet && git diff --quiet ${APP_NAME}.xcodeproj/project.pbxproj`

Expected: exit 0 after regen, no diff.

If there's a diff → STOP: "project.yml has un-applied changes. Run `xcodegen` and commit before releasing."

### Check 1.4: paid team signing configured

Read the app.yml team_id (`${APP_TEAM_ID}`) and verify it matches the signing identity:

```bash
security find-identity -p codesigning -v | grep "${APP_TEAM_ID}"
```

Expected: a match. The Personal Team certificate contains "Apple Development:" with the user's email — the paid team certificate says "Apple Distribution:" or "Apple Development:" with the team name.

If no match or the heuristic flags a Personal Team → STOP: "Switch signing to the paid team in Xcode and verify app_team_id in .claude/app.yml. See SETUP.md or run `./build.sh --debug` to see which team is detected."

### Check 1.5: fonts present

Run: `ls ${APP_NAME}/Resources/Fonts/*.ttf | wc -l`

Expected: 7 (matches the UIAppFonts list in project.yml).

If different → STOP: "Font files missing. Run `./scripts/install-fonts.sh`."

## Stage 2 — Marketing version bump (appstore only, ✋)

Skip in `testflight` mode.

Read current value:
```bash
CURRENT_MV=$(awk '/MARKETING_VERSION:/ {gsub(/"/, "", $2); print $2}' project.yml)
```

Ask the user: "Current MARKETING_VERSION is `$CURRENT_MV`. New version? (semver, e.g. 0.2.0 or 1.0.0)"

Wait for input. Validate the answer matches `^[0-9]+\.[0-9]+\.[0-9]+$`. If not, re-ask once; on second invalid input, STOP.

Edit `project.yml` line in place:
```bash
sed -i '' "s/MARKETING_VERSION: \"$CURRENT_MV\"/MARKETING_VERSION: \"$NEW_MV\"/" project.yml
```

Then regen:
```bash
xcodegen --spec project.yml --quiet
```

## Stage 3 — Build number bump (both modes, 🤖)

Read current values (re-read `NEW_MV` so it's set even in `testflight` mode where stage 2 was skipped):
```bash
NEW_MV=$(awk '/MARKETING_VERSION:/ {gsub(/"/, "", $2); print $2}' project.yml)
CURRENT_BV=$(awk '/CURRENT_PROJECT_VERSION:/ {gsub(/"/, "", $2); print $2}' project.yml)
NEW_BV=$((CURRENT_BV + 1))
```

Edit `project.yml` in place:
```bash
sed -i '' "s/CURRENT_PROJECT_VERSION: \"$CURRENT_BV\"/CURRENT_PROJECT_VERSION: \"$NEW_BV\"/" project.yml
```

Then regen:
```bash
xcodegen --spec project.yml --quiet
```

Print: "Bumped build number $CURRENT_BV → $NEW_BV."

Commit the bump immediately so the tag at stage 10 points at a clean, named state. The message differs by mode:

- `testflight` mode:
  ```bash
  git add project.yml ${APP_NAME}.xcodeproj/project.pbxproj
  git commit -m "chore(release): bump build to $NEW_BV"
  ```
- `appstore` mode (stage 2 ran, so `MARKETING_VERSION` actually changed):
  ```bash
  git add project.yml ${APP_NAME}.xcodeproj/project.pbxproj
  git commit -m "chore(release): bump to v$NEW_MV build $NEW_BV"
  ```

## Stage 4 — Changelog update (appstore only, ✋)

Skip in `testflight` mode.

Tell the user: "Time to update the 'What's New in This Version' section in marketing/app-store-listing.md. I'll wait while you edit. Save the file and tell me when you're done."

DO NOT auto-open the file. The user may have it open in a different editor already, or want to inspect git log first. Just pause for their "done" / "continue" / equivalent.

When they say done, verify the file changed since stage 3:
```bash
git diff --quiet marketing/app-store-listing.md
```

If unchanged, ask once: "I don't see any change to app-store-listing.md. Is that intentional? (y/skip / n/redo)". On `y` proceed; on `n` re-pause.

Commit the changelog edit:
```bash
git add marketing/app-store-listing.md
git commit -m "docs(release): update what's new for v$NEW_MV"
```

## Stage 5 — Sim sanity build (both modes, 🤖)

Skip if `--skip-tests` was passed.

Invoke the existing `ios-build` skill against the default simulator:
```bash
./build.sh
```

Expected: `** BUILD SUCCEEDED **` in the output.

On failure: surface the full last 40 lines of build output and STOP. The user fixes the code, then re-runs `release` (which will re-bump the build number — that's correct).

Idempotency: if the most-recent `./build.sh` ran cleanly less than 5 minutes ago AND `git diff HEAD~..HEAD -- ${APP_NAME}/` is empty, the skill may skip this. Detect via mtime on `~/Library/Developer/Xcode/DerivedData/${APP_NAME}-*/Build/Products/Debug-iphonesimulator/${APP_NAME}.app`. When in doubt, run it — the build is fast.

## Stage 6 — Archive (both modes, 🤖)

Build the App Store archive:

```bash
mkdir -p build
xcodebuild \
  -workspace $(echo "${APP_NAME}" | tr '[:upper:]' '[:lower:]').xcworkspace \
  -scheme "${APP_SCHEME}" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath build/${APP_NAME}.xcarchive \
  -allowProvisioningUpdates \
  archive \
  | tee build/archive.log | xcbeautify || true
```

Expected: `ARCHIVE SUCCEEDED` near the end of `build/archive.log`.

Detection (the pipe-to-tee makes `xcodebuild`'s exit code unavailable through the pipe — read it from the log):
```bash
grep -q "ARCHIVE SUCCEEDED" build/archive.log
```

On failure: print the last 30 lines of `build/archive.log` and STOP. Common cause: signing not switched to paid team (re-check stage 1.4).

Idempotency: if `build/${APP_NAME}.xcarchive/Info.plist` exists AND its `CFBundleVersion` matches the current `CURRENT_PROJECT_VERSION`, skip unless `--force`. Read with:
```bash
plutil -extract ApplicationProperties.CFBundleVersion raw -o - build/${APP_NAME}.xcarchive/Info.plist
```

## Stage 7 — Export `.ipa` (both modes, 🤖)

Write `build/ExportOptions.plist` if it doesn't exist:

```bash
cat > build/ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>destination</key>
  <string>export</string>
</dict>
</plist>
EOF
```

Then export:

```bash
xcodebuild -exportArchive \
  -archivePath build/${APP_NAME}.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist \
  -exportPath build/ \
  -allowProvisioningUpdates \
  | tee build/export.log | xcbeautify || true
```

Expected: `build/${APP_NAME}.ipa` exists after this runs.

On failure: print last 30 lines of `build/export.log` and STOP.

## Stage 8 — Validate (both modes, 🤖)

```bash
xcrun altool --validate-app \
  -f build/${APP_NAME}.ipa \
  --type ios \
  --apiKey "$KEY_ID" \
  --apiIssuer "$ISSUER_ID"
```

Expected: `No errors validating archive at: build/${APP_NAME}.ipa`

On failure: surface the full `altool` error (it's usually clear — missing entitlement, wrong bundle ID, duplicate build number) and STOP.

The `altool` command finds the `.p8` automatically because it's at the canonical path `~/.app-store-connect/AuthKey_<KEY_ID>.p8` — no need to pass it explicitly. If `altool` complains it can't find the key, double-check the filename matches `AuthKey_$KEY_ID.p8` exactly.

## Stage 9 — Upload (both modes, ✋)

**This is the only irreversible step beyond version bumps. Ask explicitly:**

> Ready to upload ${APP_NAME} v$NEW_MV build $NEW_BV to App Store Connect.
> Once uploaded, the build will appear in TestFlight after ~5-30 min processing.
> Build numbers cannot be reused — if this fails partway through, the next attempt will need stage 3 to bump again.
>
> Type 'upload' to confirm, or anything else to abort.

If the answer is exactly `upload`, run:

```bash
xcrun altool --upload-app \
  -f build/${APP_NAME}.ipa \
  --type ios \
  --apiKey "$KEY_ID" \
  --apiIssuer "$ISSUER_ID"
```

Expected: `No errors uploading 'build/${APP_NAME}.ipa'`.

On success: print
> ✅ Uploaded. Build is now processing in App Store Connect.
> Track: https://appstoreconnect.apple.com/apps → ${APP_NAME} → TestFlight → Builds.
> You'll get an email from Apple when processing completes (typically 5-30 minutes).

On failure: surface the full error. Common failures:
- `ERROR ITMS-90283: Invalid Provisioning Profile Signature` → re-archive (signing drift)
- `ERROR ITMS-90189: Redundant Binary Upload` → duplicate build number (re-run with --force to skip 6-9 won't help; bump and re-archive)
- `Authentication failed` → re-check API key file and IDs in `~/.app-store-connect/config`

Pre-upload idempotency: v1 of this skill **does not** pre-query the App Store Connect Builds API to detect duplicate uploads. Generating the required JWT for the API needs ES256 signing of the `.p8` key, which is non-trivial without a helper library, and `altool` already gives a clear server-side rejection (`ERROR ITMS-90189: Redundant Binary Upload`) when the build number is duplicate. The recovery on that error is "re-run release, stage 3 will bump." Good enough for v1.

## Stage 10 — Tag the commit (both modes, ✋)

Construct the tag name:
- `testflight` mode: `v$NEW_MV-build$NEW_BV` (e.g. `v0.1.0-build7`)
- `appstore` mode: `v$NEW_MV` (e.g. `v1.0.0`)

(`$NEW_MV` was set in stage 2 in appstore mode; in testflight mode it defaults to the unchanged value from `project.yml`. Re-read it at the start of stage 10 to be safe: `NEW_MV=$(awk '/MARKETING_VERSION:/ {gsub(/"/, "", $2); print $2}' project.yml)`.)

Ask:
> Tag this commit as `$TAG_NAME` and push the tag to origin? (yes / tag-only / skip)

- `yes` → run both:
  ```bash
  git tag "$TAG_NAME"
  git push origin "$TAG_NAME"
  ```
- `tag-only` → run just `git tag "$TAG_NAME"`. User can push later.
- `skip` → do nothing, continue to stage 11.

Never push automatically without the explicit `yes`. Tags pushed to origin are effectively public.

## Stage 11 — Refresh and deploy site (appstore only, ✋)

Skip in `testflight` mode.

Ask:
> Refresh site assets from the current app icon and deploy the
> marketing/privacy/support site? (yes / skip)

On `yes`:

1. Regenerate site/assets/* (icons + OG image) from the canonical generators:
   ```bash
   ./scripts/refresh-site-assets.sh
   ```

2. If `git status --porcelain -- site/` is non-empty, commit the refresh.
   Name the files explicitly per the commit skill — never `git add -A`:
   ```bash
   git add site/assets/
   git commit -m "site: refresh assets for v$NEW_MV"
   ```
   If the diff includes hand-edited HTML/CSS the user did out-of-band,
   STOP and ask before committing — those need their own commit message.

3. Deploy the subtree to `${APP_NAME}-site`:
   ```bash
   ./scripts/deploy-site.sh
   ```

Surface stdout/stderr from both scripts.

On `skip`, continue to stage 12.

## Stage 12 — App Store Connect web-UI checklist (appstore only, 👤)

Skip in `testflight` mode.

Print this checklist exactly:

> 🎉 Build uploaded. Remaining App Store Connect web-UI steps:
>
> Open https://appstoreconnect.apple.com → My Apps → ${APP_NAME} → iOS App $NEW_MV (or create a new version if this is the first appstore release at this version).
>
> 1. [ ] **Build section** — once Apple finishes processing (~5–30 min, you'll get an email), click "+" next to Build and select this build.
> 2. [ ] **What's New in This Version** — paste from marketing/app-store-listing.md "What's New" section.
> 3. [ ] **App Privacy** — verify "Data Not Collected" still checked.
> 4. [ ] **App Information → Age Rating** — verify 4+.
> 5. [ ] **App Information → Category** — Productivity / Business.
> 6. [ ] **Pricing and Availability** — Free, all territories.
> 7. [ ] **Privacy Policy URL** + **Support URL** — verify live and load.
> 8. [ ] **Screenshots** — upload from marketing/screenshots/ if not already done.
> 9. [ ] **Promotional Text + Description + Keywords** — paste from marketing/app-store-listing.md.
> 10. [ ] **Export Compliance** — Yes, qualifies for exemption (iOS-only encryption).
> 11. [ ] **Copyright** — <COPYRIGHT_HOLDER>.
> 12. [ ] **App Review Information** — contact details + brief reviewer note (no demo account needed).
> 13. [ ] **Submit for Review** button (top right).
>
> Apple's first-app review typically takes 24–48h. Common rejections for scanners: vague privacy strings, unclear permission flow, no demo content. The current Info.plist usage strings (see project.yml) are already specific.

## When in doubt — recovery moves

| Symptom | Recovery |
|---|---|
| Stage 1 refuses on dirty tree | `git status` → resolve → re-run |
| Stage 1 refuses on wrong branch | `git checkout main` (or set `RELEASE_BRANCH`) → re-run |
| Stage 6 fails with signing error | Open Xcode → confirm paid team selected → check the app.yml team_id matches → re-run |
| Stage 8 says "missing entitlement" | Check ${APP_NAME}.entitlements and widget entitlements both list the App Group → re-archive |
| Stage 9 says "redundant binary" | Build number was already uploaded. Re-run; stage 3 will bump it. |
| altool says "authentication failed" | `cat ~/.app-store-connect/config` — IDs typoed? `.p8` filename matches `AuthKey_<KEY_ID>.p8`? |
| Want to abort mid-flow | Ctrl-C is safe at every stage except 9 (upload). Local-only changes from stages 2-3 stay committed — you can reset them. |

## Red flags — never do these

- ❌ Auto-push without asking
- ❌ Echo `KEY_ID` / `ISSUER_ID` / contents of `.p8` to the user or any log
- ❌ Continue past stage 1 failure unless `--force` was explicit
- ❌ Skip the explicit `upload` confirmation at stage 9
- ❌ Modify `project.yml` outside stages 2 and 3
- ❌ Use `git add -A` / `git add .` — name files explicitly (per repo's commit skill)

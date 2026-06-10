---
name: app-preview
description: Build an iOS app on the booted simulator, launch it (optionally deep-linking via ${APP_URL_SCHEME}://scan or ${APP_URL_SCHEME}://doc), take screenshots, and deliver them to the user's iPhone via a hybrid channel — iMessage text ping (push notification) plus iCloud Drive copy (the actual image, viewable from Files app). Claude's chat response cannot embed images on the Remote Control mobile surface, so this out-of-band delivery is the load-bearing step. Use this skill aggressively whenever the user is working remotely and wants to see what the app currently looks like — including "show me the home screen", "take a screenshot", "build and send a pic", "did that fix work", "what does X look like now", "preview the app", "give me a quick look at Y", or any request to verify a UI change visually. Also use proactively after fixing a UI bug or completing a SwiftUI change, even if the user doesn't say "screenshot" — closing the loop with a visual is the whole point of this skill. **Text-driven mode:** when the user describes a UI concern in words ("the home-row spacing looks off", "the new doc sheet doesn't show the title"), map the description to the affected screens and capture all of them in one run via `scripts/bundle.sh`. After delivering the screenshots, hand off to `superpowers:brainstorming` to align on the fix, then to `superpowers:test-driven-development` to implement it (or `superpowers:executing-plans` if a plan already exists). All output is organized by git branch — `$(basename "${APP_PREVIEW_ROOT}")/<branch>/...` on iCloud and `/tmp/${APP_NAME_LC}-snaps/<branch>/...` locally — so the user can flip between branches and see exactly which screenshots belong to which line of work.
---

> **Requires `.claude/app.yml`** with `app.name`, `app.bundle_id`, `app.url_scheme`, optionally `app.preview_root`. All five scripts source `skills/_lib/load_app_config.sh` and refuse if config is missing. Screen vocabulary, deep-link routes, and the iMessage delivery quirks are app-shaped — adjust the examples below for your app's `handleDeepLink` surface.

# ${APP_NAME} preview — remote-control visual feedback

## Why this skill exists

The user is often away from the machine. They ask you to fix something visual ("the home-row spacing looks off", "the new sheet doesn't show the title"), and the fastest way for them to validate the fix is a screenshot — not a description, not a code diff, a picture. This skill captures the loop:

1. Build the app for the iOS Simulator
2. Install + launch on the booted simulator
3. (Optionally) deep-link to a specific screen
4. Take a PNG screenshot
5. **Deliver to the user's iPhone via the hybrid channel** (`scripts/deliver.sh`):
   - iMessage text ping → push notification on the phone, so the user knows it's ready
   - iCloud Drive copy into `$(basename "${APP_PREVIEW_ROOT}")/<branch>/` → the actual image, viewable full-size in Files
6. Read the PNG with the Read tool (lets you describe what's on screen; also renders inline if the user is on the desktop VS Code extension)

Step 5 is non-negotiable when the user is remote. The Claude assistant response cannot embed images on the Remote Control mobile UI — this is a [verified Anthropic limitation](https://github.com/anthropics/anthropic-sdk-python/issues/1329): tool-returned images go into Claude's context but are hidden from the user inside a collapsed tool-use accordion. The image has to be pushed out-of-band.

### Why hybrid? (the iMessage attachment quirk)

The obvious approach was: send the PNG as an iMessage attachment to self. It silently fails. Diagnostic findings:

- **AppleScript text to self via iMessage** → ✅ delivered
- **AppleScript file attachment to self via iMessage** → ❌ Apple's server returns "Not Delivered" even though the same destination receives manual sends fine

The root cause is on Apple's side — `osascript`-originated attachment sends to a self-buddy get rejected at the iMessage routing layer, while identical sends from a human typing in Messages.app go through. Apple does not document this and there's no workaround at the AppleScript level.

The hybrid sidesteps the issue: AppleScript handles the text ping (which works), iCloud Drive handles the bytes (which doesn't need iMessage at all). Two-tap UX on the phone: notification → open Files → tap the file.

## Output is organized by branch

Every run writes screenshots (and a `MANIFEST.md` companion) into a folder named after the current git branch:

- iCloud: `~/Library/Mobile Documents/com~apple~CloudDocs/$(basename "${APP_PREVIEW_ROOT}")/<branch>/`
- Local: `/tmp/${APP_NAME_LC}-snaps/<branch>/`

Slashes in branch names are flattened to `--` for iOS Files compatibility — `ui/update-match-design` becomes `ui--update-match-design`. Detached HEAD falls back to `detached-<shortsha>`.

The branch slug is computed once per script invocation by `scripts/branch-dir.sh`. All three scripts (`snap.sh`, `deliver.sh`, `bundle.sh`) source it — there is no separate config to keep in sync. Flip to a different branch, take another snapshot, and the new shots land in a new folder; the old branch's folder stays put until you delete it.

## The four scripts

All live in `scripts/` next to this file and are already executable. Prefer them over hand-rolling `xcrun simctl` commands so the build/install/launch/deliver sequence stays consistent across sessions.

### `scripts/launch.sh` — build → install → launch

```bash
scripts/launch.sh                       # full build, install, launch
scripts/launch.sh --no-build            # skip build script, reinstall last build (fast)
scripts/launch.sh --sim "iPhone 16 Pro" # force a specific simulator
```

Boots `iPhone 17 Pro` if no simulator is currently booted, runs `${APP_BUILD_SCRIPT}`, installs the freshest `${APP_NAME}.app` from DerivedData, terminates any prior instance, then launches. Use `--no-build` when the user just changed app state (signed in, navigated somewhere) and wants another snapshot — saves the 10–30s xcodebuild round-trip.

### `scripts/snap.sh` — screenshot → print path

```bash
scripts/snap.sh                # → /tmp/${APP_NAME_LC}-snaps/<branch>/${APP_NAME_LC}-snap-<ts>.png
scripts/snap.sh home-empty     # → /tmp/${APP_NAME_LC}-snaps/<branch>/${APP_NAME_LC}-snap-<ts>-home-empty.png
scripts/snap.sh --dir /tmp/x   # override the dir (no branch subfolder appended)
```

Prints the absolute PNG path on the last line of stdout. The default output dir is the per-branch subfolder; pass `--dir` only for ad-hoc one-offs that shouldn't be grouped with branch work.

### `scripts/deliver.sh` — iMessage ping + iCloud Drive copy

```bash
scripts/deliver.sh /tmp/${APP_NAME_LC}-snaps/<branch>/${APP_NAME_LC}-snap-<ts>.png
scripts/deliver.sh --no-ping <path>     # skip the iMessage notification
scripts/deliver.sh --no-icloud <path>   # skip the iCloud copy (just notify)
```

Two-channel delivery:

1. **iCloud Drive copy** → `~/Library/Mobile Documents/com~apple~CloudDocs/$(basename "${APP_PREVIEW_ROOT}")/<branch>/<basename>`. iCloud syncs to iPhone Files app in 5–30s.
2. **iMessage text ping** → reads destination from `app-preview/.imessage-to` (first non-blank line; Apple ID email or E.164 phone). Sends a text like:
   ```
   ${APP_NAME} preview: ${APP_NAME_LC}-snap-...-after-fix.png — Files → iCloud Drive → $(basename "${APP_PREVIEW_ROOT}") → <branch>
   ```
   The branch slug at the end is the load-bearing hint: the user lands in the right subfolder without having to guess.

Either channel can fail independently. If iCloud fails but iMessage succeeds, the user still gets a notification with a "couldn't deliver image" message. If iMessage fails (e.g., destination not configured) but iCloud succeeds, the file is still there — the user just doesn't get notified.

### `scripts/bundle.sh` — text-driven multi-screen capture

The new entry point. Given a textual description of a UI concern and a list of screens, builds once, walks each screen, captures + delivers each, and appends a section to the per-branch `MANIFEST.md`.

```bash
scripts/bundle.sh \
  --description "home-row spacing looks off on the doc screen" \
  --screen home \
  --screen doc:Receipts/2026-receipt.pdf
```

Flags:

| Flag | Purpose |
|---|---|
| `--description "<text>"` | **Required.** Verbatim user request, written into `MANIFEST.md`. |
| `--screen <id>` | **Required, repeatable.** One per screen to capture. |
| `--no-build` | Forwarded to `launch.sh`. |
| `--sim "<name>"` | Forwarded to `launch.sh`. |
| `--no-deliver` | Skip `deliver.sh` entirely (local-only run). |

Between screens the script does `terminate` + `launch` + `openurl` rather than just `openurl`, so a previous screen's sheet/modal doesn't stack underneath the next capture. The first delivered screenshot carries the iMessage ping; subsequent ones suppress the ping (no notification spam) but still mirror to iCloud. The `MANIFEST.md` is also mirrored at the end, so the user has the per-run index on the phone.

## Navigation: deep links only, and the surface is small

The app registers the `${APP_URL_SCHEME}://` URL scheme. The exact routes depend on what `handleDeepLink` in your app currently handles — re-grep it before claiming you can deep-link somewhere.

The examples below are **Paperix-shaped** (how Paperix shipped its `handleDeepLink` in `Paperix/PaperixApp.swift`). Your app's vocabulary may differ:

```bash
xcrun simctl openurl booted "${APP_URL_SCHEME}://scan"
# → (Paperix) opens the app and triggers the scanner (posts .snapDocTriggerScan)

xcrun simctl openurl booted "${APP_URL_SCHEME}://doc?path=<relative-path-under-store-dir>"
# → (Paperix) opens the app and navigates to that document, if it exists
```

These two patterns were the full navigable surface for Paperix at the time this skill was written. Your app's `handleDeepLink` may route fewer or more patterns. Always verify against the source.

**For any other screen** (settings, the import sheet, OCR detail, widget config, etc.) you have three honest options:

1. **Cold-launch screenshot only.** `launch.sh` lands the user on the home screen; snap it as-is and surface what's visible. Often enough.
2. **Ask the user to navigate.** If they're remote and you can't tap, tell them what to tap; they can do it on their phone or in Xcode, then ask you to snap again. This skill is collaborative, not autonomous.
3. **Add a deep-link route** to `handleDeepLink` if the screen will be visited repeatedly during this debugging session — but that's a real code edit, separate from running this skill.

`xcrun simctl` does **not** provide tap, swipe, or text input. Do not try to script taps via AppleScript against the Simulator window — coordinates depend on the Simulator window position, device chrome, and Retina scale, and silent mis-clicks are a worse failure mode than admitting the limitation. If interactive navigation becomes a recurring need, install `idb` (`brew install facebook/fb/idb-companion && pipx install fb-idb`) and revisit this skill.

## Text-driven mode (the bridge from words to screenshots)

The user says: *"the home-row spacing looks off on the doc screen, and the scanner trigger feels small."* You need to:

1. **Identify the affected screens.** Use the screen vocabulary below. The mapping is interpretive, not regex — read the user's intent and pick the surfaces that would show the problem. When in doubt, capture *more* screens rather than fewer; an extra PNG is cheap and the MANIFEST keeps them disambiguated.

2. **Pick the right doc path if `doc` is in play.** If the user says "the doc screen", ask which document or pick a reasonable existing one. The deep link needs a real path under the store directory.

3. **Invoke `bundle.sh` once** with all chosen screens. Don't loop over `launch.sh` + `snap.sh` + `deliver.sh` by hand — the bundle script handles cold-restart between screens, MANIFEST writing, and ping deduplication.

4. **After delivery, hand off explicitly:**
   - `superpowers:brainstorming` to align with the user on what the fix should look like before you write code.
   - `superpowers:test-driven-development` to implement it. (If a plan already exists from a prior `superpowers:writing-plans` run, use `superpowers:executing-plans` instead.)

   The handoff sequence is part of the skill's contract — `app-preview` produces a visual; `brainstorming` decides the fix; TDD writes the code. Don't shortcut past brainstorming just because the fix "feels obvious"; the screenshot is what makes alignment possible.

### Screen vocabulary

The table below is **Paperix-shaped** — these are the screen IDs that Paperix's `handleDeepLink` recognizes. Your app's vocabulary is determined by what routes your `handleDeepLink` actually implements. The IDs and deep-link patterns below are illustrative examples:

| Screen ID | What it captures | How `bundle.sh` reaches it |
|---|---|---|
| `home` | The default view the app lands on at cold launch | No deep link — just the launched app |
| `scan` | Scanner sheet over home (Paperix: `${APP_URL_SCHEME}://scan`) | `${APP_URL_SCHEME}://scan` |
| `doc:<rel-path>` | Document detail view (Paperix: `${APP_URL_SCHEME}://doc?path=<rel-path>`) | `${APP_URL_SCHEME}://doc?path=<rel-path>` |

For anything else (settings, OCR review, trash, folders, share sheet, app lock, …), pick `home` and mention the limitation in your final summary — the user can navigate manually on their device or in Xcode and ask for another snap once they're there.

### Caveat: `scan` is a sheet over `home`

`${APP_URL_SCHEME}://scan` (in Paperix: posts `.snapDocTriggerScan`) presents the scanner as a sheet — the home screen is still mounted underneath. The resulting screenshot shows the scanner UI; that's the intended state for verifying a scan-flow change. If the user actually wants to see *home* with no sheet, capture `home` separately (which `bundle.sh` already does via terminate-and-relaunch between screens).

## The full remote-control loop

### Simple path (single screen, deep-link or cold launch)

Typical session, after the user reports a UI bug and you've made a code change:

```
1. scripts/launch.sh                                            # rebuild + relaunch with the fix
2. xcrun simctl openurl booted ${APP_URL_SCHEME}://scan         # (optional) deep-link if applicable
3. scripts/snap.sh after-fix                                    # capture → /tmp/${APP_NAME_LC}-snaps/<branch>/...-after-fix.png
4. scripts/deliver.sh <path>                                    # iMessage ping + iCloud copy (REQUIRED for remote)
5. Read(<path>)                                                 # for desktop inline + narration
6. "Sent — Files → iCloud Drive → $(basename "${APP_PREVIEW_ROOT}") → <branch> → <filename>. The title sits one row above the toolbar now."
```

### Text-driven path (multi-screen from a description)

End-to-end example. User says: *"the home-row spacing looks off on the doc screen."*

```
1. (Identify affected screens.)
   "Home" because that's where the row sits.
   "Doc detail" because the user mentioned it.
   → Screens: home, doc:<some-existing-doc>

2. scripts/bundle.sh \
     --description "home-row spacing looks off on the doc screen" \
     --screen home \
     --screen doc:Receipts/2026-receipt.pdf

   Output:
     /tmp/${APP_NAME_LC}-snaps/agent--ABH-6-.../${APP_NAME_LC}-snap-<ts>-home.png
     /tmp/${APP_NAME_LC}-snaps/agent--ABH-6-.../${APP_NAME_LC}-snap-<ts>-doc.png
     /tmp/${APP_NAME_LC}-snaps/agent--ABH-6-.../MANIFEST.md (request + screens + timestamp)

   Each screenshot is delivered to iCloud → $(basename "${APP_PREVIEW_ROOT}")/<branch>/, the first
   one pings via iMessage, the MANIFEST is mirrored at the end.

3. Read each PNG to narrate what's on screen.

4. Hand off to superpowers:brainstorming.
   "Before I touch code: the home row uses .padding(.vertical, 12) and the doc
   header uses .padding(.vertical, 16). Want me to unify them at 14, or pull
   them out to a shared constant?"

5. After the user aligns, hand off to superpowers:test-driven-development.
   Write a snapshot test (or a unit test on the layout constant), then make it
   pass, then re-run bundle.sh to verify the fix visually.
```

## Useful one-liners

Appearance toggle (light/dark):
```bash
xcrun simctl ui booted appearance dark    # or 'light'
```

Force-restart fresh (kills app, clears nothing else):
```bash
xcrun simctl terminate booted "${APP_BUNDLE_ID}"
xcrun simctl launch booted "${APP_BUNDLE_ID}"
```

Wipe app data (use sparingly — destroys keychain, defaults, files):
```bash
xcrun simctl uninstall booted "${APP_BUNDLE_ID}"
scripts/launch.sh --no-build
```

## Gotchas

- **Build script regenerates `${APP_NAME}.xcodeproj`** (if using XcodeGen and `project.yml`) whenever sources or project config changed. That's fine — but it means the first build after pulling new code can take longer than subsequent ones.
- **Build failures**: surface the `xcodebuild` error verbatim to the user, then stop. Don't try to "fix and retry" inside this skill — the build error might be the very thing the user wants to know about. Hand off to the project's existing iOS skills (e.g., `swiftui-expert-skill`, `xcode-build-fixer`) if remediation is needed.
- **Simulator not booted on first run**: `launch.sh` boots `iPhone 17 Pro` by default to match the build script's default destination. If the user wants a different simulator, pass `--sim "<name>"` to both.
- **Multiple sims booted**: `xcrun simctl ... booted` errors out when more than one device is booted. Shut extras down: `xcrun simctl shutdown <UDID>`.
- **iMessage destination not configured**: deliver.sh skips the ping with a warning and proceeds with iCloud Drive only. To enable pings: `echo 'you@example.com' > ~/.claude/skills/app-preview/.imessage-to`. **First-time setup also requires** the user to manually send themselves one message in Messages.app first — without that bootstrap, AppleScript-generated text sends don't deliver either.
- **Do not try to attach the image to iMessage** — AppleScript file attachments to self-destinations are silently rejected by Apple's iMessage server. The hybrid pattern (text ping + iCloud Drive image) is the workaround. See "Why hybrid?" above.
- **iCloud sync latency**: usually a few seconds for a 200KB PNG. If the user reports "I don't see it on my phone," ask them to pull-to-refresh in Files → iCloud Drive → `$(basename "${APP_PREVIEW_ROOT}")` → `<branch>`. If still not there after ~30s, check that iCloud Drive is on for both devices.
- **Preview folder grows unbounded**: each preview adds another PNG. Nothing prunes them. With branch subfolders the cleanup target is more obvious — delete the folder for a merged branch and you reclaim everything that was about that line of work.
- **MANIFEST.md is append-only**: each `bundle.sh` run appends a section, so a branch folder accumulates history. If the manifest gets too long, the user can edit or truncate it manually — nothing in the skill depends on its exact contents.
- **Stale `.app` in DerivedData**: the script picks the most recently modified `${APP_NAME}.app`, ignoring `Index.noindex`. If the wrong build keeps getting picked up (e.g., from a different branch's DerivedData folder), run the build script directly first and verify the output path.
- **Detached HEAD branch folder**: when there is no branch (e.g., checked out a tag), the slug is `detached-<shortsha>`. Switch back to a named branch before the next run if you want the screenshots grouped with active work.

## What this skill is NOT

- It does not handle device builds. Remote-control via simulator screenshots only.
- It does not run UI tests. For automated assertions, use XCUITest in the app's test target.
- It does not interact with the UI beyond launch + deep links. For tap/swipe automation you'd need `idb` (`brew install facebook/fb/idb-companion`) — out of scope for this skill.
- It does not implement fixes. After delivering screenshots, hand off to `superpowers:brainstorming` for alignment, then `superpowers:test-driven-development` (or `superpowers:executing-plans` with an existing plan) to write the code.

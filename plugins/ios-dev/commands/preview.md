---
description: Build the iOS app (reads .claude/app.yml; --no-build skips), launch on the booted simulator, optionally deep-link, screenshot, embed inline
argument-hint: "[--no-build] [scan | doc?path=...]"
model: sonnet
---

Use the `app-preview` skill to produce a fresh screenshot of the app (configured in `.claude/app.yml`) and embed it inline in this chat. Arguments: `$ARGUMENTS`

Parse `$ARGUMENTS` like this:

- If it contains `--no-build`, pass `--no-build` to `scripts/launch.sh` (skips the app's build script, `app.build_script` in `.claude/app.yml`, default `./build.sh` — fast path, ~2s instead of 10–30s).
- If it contains a deep-link token (a route name, or anything starting with `doc?path=`), after launching run `xcrun simctl openurl <UDID> "<url_scheme>://<token>"` before snapping (the UDID of the simulator `launch.sh` used; `xcrun simctl list devices booted` shows it) — substitute `app.url_scheme` from `.claude/app.yml`. Only routes wired up in your app's `handleDeepLink` will work; verify against the source and reject anything else, telling me which routes exist.
- If `$ARGUMENTS` contains `--sim <name|UDID>`, pass it to `launch.sh` and `snap.sh` (and use that UDID for any `openurl`). Without it the scripts use the only booted simulator and refuse when several are booted.
- If `$ARGUMENTS` is empty, just build, launch, and snap the cold-start home screen.

Then:

1. Run `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/launch.sh` (with `--no-build` if requested). The skill's scripts (`launch.sh`, `snap.sh`, `deliver.sh`, `bundle.sh`) live at `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/`. If `${CLAUDE_PLUGIN_ROOT}` is unset (project-local copy instead of plugin install), use `.claude/skills/app-preview/scripts/` relative to the repo root.
2. (If applicable) Run the deep-link `openurl`
3. Run `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/snap.sh <short-label>` where the label reflects the state (e.g. `cold-start`, `scan-deeplink`, `after-fix`). Capture the PNG path it prints on the last line.
4. **Deliver only if I am not at the desktop.** If I am working remotely (Remote Control, phone, or I said so), chat cannot embed images, so send the PNG out of band. Try in this order and stop at the first that works:
   1. **The host's file-send tool** (`SendUserFile`), when it is available: send the PNG path directly. No iMessage, no `deliver.sh`.
   2. **The imessage plugin's `reply` tool** with the PNG as an attachment (`files: ["<png-path>"]`). To verify: the plugin may route through the same Messages path that `deliver.sh` documents as rejecting AppleScript attachments, so confirm it arrived.
   3. **Fallback, `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/deliver.sh <png-path>`:** an iMessage text ping (needs `IMESSAGE_TO` exported) plus a copy into the app's previews folder under `~/Library/Mobile Documents/com~apple~CloudDocs/` (`<AppName>Previews/<branch>/`), which syncs to Files. Do NOT try to attach the image to the iMessage from AppleScript: Apple silently rejects those sends to self; iCloud Drive is the bytes channel here.

   If I am at the desktop, skip this step entirely: no iMessage, no iCloud copy.
5. ALSO Read the PNG path. This lets you describe what's on screen, and renders inline if I happen to be looking from the desktop VS Code extension.
6. Reply with: which screen was captured, how it was delivered (and, if `deliver.sh` ran, the breadcrumb it printed: `Files → iCloud Drive → <AppName>Previews → <branch> → <filename>`), and one sentence on what's visible. Do not describe the UI in detail — the picture is the artifact.

If the build script fails, surface the xcodebuild error verbatim and stop. Don't auto-fix.

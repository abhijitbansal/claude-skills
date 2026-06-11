---
description: Build the iOS app (reads .claude/app.yml; --no-build skips), launch on the booted simulator, optionally deep-link, screenshot, embed inline
argument-hint: [--no-build] [scan | doc?path=...]
model: sonnet
---

Use the `app-preview` skill to produce a fresh screenshot of the Paperix app and embed it inline in this chat. Arguments: `$ARGUMENTS`

Parse `$ARGUMENTS` like this:

- If it contains `--no-build`, pass `--no-build` to `scripts/launch.sh` (skips the `./build.sh` step — fast path, ~2s instead of 10–30s).
- If it contains a deep-link token (`scan`, or anything starting with `doc?path=`), after launching run `xcrun simctl openurl booted "paperix://<token>"` before snapping. Only `paperix://scan` and `paperix://doc?path=...` are wired up in `handleDeepLink`; reject anything else and tell me which routes exist.
- If `$ARGUMENTS` is empty, just build, launch, and snap the cold-start home screen.

Then:

1. Run `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/launch.sh` (with `--no-build` if requested). All three skill scripts live at `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/`. If `${CLAUDE_PLUGIN_ROOT}` is unset (project-local copy instead of plugin install), use `.claude/skills/app-preview/scripts/` relative to the repo root.
2. (If applicable) Run the deep-link `openurl`
3. Run `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/snap.sh <short-label>` where the label reflects the state (e.g. `cold-start`, `scan-deeplink`, `after-fix`). Capture the PNG path it prints on the last line.
4. **Deliver to my phone via deliver.sh:** run `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/deliver.sh <png-path>`. This is the load-bearing step — Claude's chat response cannot embed images on the Remote Control mobile UI (verified Anthropic limitation). deliver.sh runs two channels: (a) iMessage text ping → push notification on my iPhone so I know a snap is ready, (b) copies the PNG into ~/Library/Mobile Documents/com~apple~CloudDocs/PaperixPreviews/ which syncs to my iPhone Files app within seconds. Do NOT try to attach the image directly to the iMessage — Apple silently rejects AppleScript-driven attachment sends to self; iCloud Drive is the bytes channel.
5. ALSO Read the PNG path. This lets you describe what's on screen, and renders inline if I happen to be looking from the desktop VS Code extension.
6. Reply with: which screen was captured, the breadcrumb deliver.sh printed (`Files → iCloud Drive → PaperixPreviews → <filename>`), and one sentence on what's visible. Do not describe the UI in detail — the picture is the artifact.

If `./build.sh` fails, surface the xcodebuild error verbatim and stop. Don't auto-fix.

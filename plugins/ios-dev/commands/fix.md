---
description: Apply a UI fix to the iOS app (reads .claude/app.yml), then build + screenshot to prove it worked — closes the remote feedback loop
argument-hint: <description of the bug or change>
---

I want you to apply a fix to the app (its name, scheme, and URL scheme live in `.claude/app.yml` — read them if you need them), then immediately prove it worked by screenshotting the result inline. If I'm remote and can't see the simulator, I also need the screenshot sent to me (step 3); at the desktop, the inline image is enough. The fix request is: $ARGUMENTS

Workflow:

1. **Understand the change.** Find the relevant SwiftUI view(s) in the app's source directory. If the issue is ambiguous (which "home row"? which "search bar"?), take a screenshot first via the `app-preview` skill so we're looking at the same UI, then proceed.

2. **Apply the fix.** Edit the Swift source directly. Keep the change tight — no incidental refactors. If the fix is non-obvious or needs a design choice, propose two options in one sentence each before editing.

3. **Build and screenshot; deliver the screenshot if I'm remote.** Use the `app-preview` skill at `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/` (if `${CLAUDE_PLUGIN_ROOT}` is unset — project-local copy instead of plugin install — use `.claude/skills/app-preview/scripts/` relative to the repo root):
   - `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/launch.sh` (full rebuild — this is the whole point)
   - If a specific screen needs to be in view, deep-link via `xcrun simctl openurl <UDID> "<url_scheme>://<route>"` (the UDID `launch.sh` used; `xcrun simctl list devices booted` shows it) — substitute `app.url_scheme` from `.claude/app.yml` and a route your app's `handleDeepLink` actually implements (verify against the source; don't assume routes exist)
   - `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/snap.sh after-fix` — capture the printed PNG path
   - **If I'm remote, deliver the PNG** (chat cannot embed images on the Remote Control mobile UI, so without this I see your words but not the result). Try in order and stop at the first that works: (1) the host's file-send tool (`SendUserFile`) with the PNG path; (2) the imessage plugin's `reply` tool with the PNG attached (to verify it arrived); (3) fallback `${CLAUDE_PLUGIN_ROOT}/skills/app-preview/scripts/deliver.sh <png-path>`, which sends an iMessage text ping (needs `IMESSAGE_TO` exported) and copies the PNG to the app's previews folder in iCloud Drive (`<AppName>Previews/<branch>/`). Do NOT attach the image to an AppleScript iMessage: Apple silently rejects those sends to self. At the desktop, skip delivery.
   - Read the PNG too, so you can describe what's on screen and so the image renders inline if I'm watching from the desktop VS Code extension.
   - Do not ask me first; the screenshot IS the confirmation that the fix landed.

4. **Report tight.** One sentence summarizing what changed in code (file:line), then the screenshot, then "good?" — let me drive the next iteration.

If the build fails, surface the xcodebuild error and stop. Don't keep retrying — I'd rather see the error than a wrong fix.

If the fix needs deeper systematic debugging (the bug isn't where you first thought), use the `systematic-debugging` skill before re-editing.

---
name: demo-recording
description: Recording repeatable iOS feature demo videos / marketing GIFs from the simulator without hand-driving it. Drives the app with paced XCUITests (Thread.sleep + lenient guards) gated out of normal runs via an env flag forwarded through xcodebuild's TEST_RUNNER_ prefix, records with simctl recordVideo (finalized on SIGINT), and converts to GIF with ffmpeg palettegen/paletteuse — including a CoreText caption-bar fallback when the ffmpeg build lacks drawtext/libfreetype. Trigger on "record the app / make a GIF or video of the features", or any need for repeatable demo footage in CI.
---

# Simulator Demo Videos/GIFs via Paced XCUITests

## Why this skill exists

`simctl` can screenshot but not tap; hand-recording is unrepeatable; and demo
flows shouldn't pollute the regular test suite. A paced, env-gated XCUITest
class plus `simctl recordVideo` produces deterministic footage you can
regenerate on demand or in CI.

## When to use

- "Record the app / make a GIF / video of the features" on any iOS project
- Repeatable demo footage in CI without a human driver

## Pipeline

1. **Write a `DemoRecordingUITests` class** — real flows with `Thread.sleep`
   pacing and lenient guards (`waitForExistence` + if-checks, minimal asserts,
   `continueAfterFailure = true`). Gate it out of normal runs:

   ```swift
   try XCTSkipUnless(ProcessInfo.processInfo.environment["DEMO_RECORDING"] == "1")
   ```

   `xcodebuild` forwards env vars to the test runner via the `TEST_RUNNER_`
   prefix: `TEST_RUNNER_DEMO_RECORDING=1 xcodebuild test-without-building …`.

2. **`build-for-testing` once, then record per clip:**

   ```bash
   xcodebuild build-for-testing -scheme App -destination "id=$UDID"
   xcrun simctl io "$UDID" recordVideo --codec h264 --force out.mov &
   recpid=$!
   TEST_RUNNER_DEMO_RECORDING=1 xcodebuild test-without-building \
     -destination "id=$UDID" -only-testing:"UITests/Demo/testOneFlow"
   kill -INT "$recpid"; wait "$recpid"   # recordVideo finalizes on SIGINT
   ```

3. **GIF conversion** (trim launch dead-time with `-ss`):

   ```bash
   ffmpeg -ss 6 -i clip.mov -vf "fps=8,scale=380:-1:flags=lanczos,\
   split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" out.gif
   ```

4. **Caption bars when ffmpeg lacks `drawtext`** (homebrew builds often skip
   libfreetype): render text → PNG with a tiny CoreGraphics/CoreText Swift
   script, then composite with the always-available `overlay` filter:

   ```bash
   ffmpeg -ss 6 -i clip.mov -i caption.png \
     -filter_complex "[0:v]fps=8,scale=380:-1[v];[v][1:v]overlay=0:H-44,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" out.gif
   ```

5. **Seed deterministic app data first:** `xcrun simctl get_app_container
   <udid> <bundle> data` → copy fixture folders into `Documents/`. Control
   `@AppStorage` per-launch through the NSArgumentDomain:
   `app.launchArguments = ["-hasSeenOnboarding", "YES"]`.

## Related

This is the manual/CI counterpart to the simulator screenshot loop in the
`app-preview` skill — use `app-preview` for single inline screenshots,
`demo-recording` for narrated multi-step video.

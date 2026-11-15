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

2. **Seed deterministic app data first** (before any recording): `xcrun simctl
   get_app_container <udid> <bundle> data` → copy fixture folders into
   `Documents/`. Control `@AppStorage` per-launch through the NSArgumentDomain:
   `app.launchArguments = ["-hasSeenOnboarding", "YES"]`.

3. **Pin the status bar** so every clip shows the same clock and full bars, and
   clear it afterwards:

   ```bash
   xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged \
     --batteryLevel 100 --wifiBars 3 --cellularBars 4
   # … record …
   xcrun simctl status_bar "$UDID" clear
   ```

4. **`build-for-testing` once, then record per clip.** The simulator must be
   booted before `recordVideo`, `xcodebuild` needs a `-scheme` (or an
   `-xctestrun`), `-only-testing` takes `<TestTarget>/<Class>/<method>`, and the
   `.mov` is only finalised when `recordVideo` gets SIGINT, so the trap stops it
   even if the test step fails:

   ```bash
   set -euo pipefail
   UDID=<udid>                                   # a simulator id, not a name
   xcrun simctl bootstatus "$UDID" -b            # boot if needed, wait until ready
   xcodebuild build-for-testing -scheme App -destination "id=$UDID" -derivedDataPath build

   rec_log=$(mktemp)
   xcrun simctl io "$UDID" recordVideo --codec=h264 --force out.mov 2>"$rec_log" &
   recpid=$!
   stop_recording() { kill -INT "$recpid" 2>/dev/null || true; wait "$recpid" 2>/dev/null || true; }
   trap stop_recording EXIT
   # simctl prints "Recording started" to stderr after the first frame:
   until grep -q "Recording started" "$rec_log"; do sleep 0.2; done

   TEST_RUNNER_DEMO_RECORDING=1 xcodebuild test-without-building -scheme App \
     -destination "id=$UDID" -derivedDataPath build \
     -only-testing:"AppUITests/DemoRecordingUITests/testOneFlow"

   stop_recording; trap - EXIT
   ```

   `-only-testing` must match your real UI test target and class names. The
   record, SIGINT and finalise half was run against a booted simulator with a
   `sleep` in place of the `xcodebuild` step and produced a readable h264 `.mov`
   (a static screen records a single frame: `recordVideo` only writes on change).
   The `xcodebuild` lines were not run here, so check scheme and test names on
   your project.

5. **GIF conversion** (trim launch dead-time with `-ss`):

   ```bash
   ffmpeg -ss 6 -i clip.mov -vf "fps=8,scale=380:-1:flags=lanczos,\
   split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" out.gif
   ```

6. **Caption bars when ffmpeg lacks `drawtext`** (homebrew builds often skip
   libfreetype): render the text to a PNG with `references/caption.swift`, then
   composite with the always-available `overlay` filter:

   ```bash
   xcrun swiftc -O references/caption.swift -o /tmp/caption    # once
   /tmp/caption "Scan a receipt" 380 caption.png                # text, width px, out
   ffmpeg -ss 6 -i clip.mov -i caption.png \
     -filter_complex "[0:v]fps=8,scale=380:-1[v];[v][1:v]overlay=0:H-44,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" out.gif
   ```

   Run here: the caption script produced a 380x44 bar PNG (viewed) and the
   overlay command above turned a recorded clip into a captioned 380-px-wide GIF.
   The width argument must equal the `scale=` width. Drop `-ss 6` for a clip
   shorter than 6 seconds.

## Related skills

This is the manual/CI counterpart to the simulator screenshot loop in the
`app-preview` skill — use `app-preview` for single inline screenshots,
`demo-recording` for multi-step video.

---
name: field-log-duration-clustering-race-diagnosis
description: A device-only timing bug (e.g. speech recognition "no speech detected", NFC/AVFoundation timeouts) can't be reproduced in the Simulator, and you're about to ship a speculative fix for a suspected timer-arms-before-async-task-exists race with no evidence it's the real cause. Use when a hardware-gated framework (on-device Speech, CoreNFC, AVFoundation capture) fails intermittently only on real devices, you have structured diagnostic logs already recording per-attempt duration and outcome, and you need to confirm or refute a race hypothesis — and pick a numeric fix constant — without a repro.
---

# Field-Log Duration Clustering Confirms a Startup-Race Timeout Hypothesis

## Symptom

A hardware-gated framework (on-device Speech recognition, CoreNFC, AVFoundation
capture) intermittently times out or fails on real devices — e.g.
`.noSpeechDetected` — with no way to reproduce it, because the framework
doesn't run in the Simulator at all. You have a hypothesis ("the timeout timer
arms before the async task it's supposed to be timing even exists, so it races
startup/warm-up latency instead of detecting a genuine pause") but no way to
test it, so any fix would ship purely speculative.

## Root cause

A silence/timeout timer (e.g. `armSilenceTimer()`) is started before the
guarded async operation (e.g. `recognitionTask(with:)`) is actually created.
The timer's countdown therefore includes framework startup/warm-up latency,
not just genuine mid-operation silence. On a device, startup latency is
variable and sometimes exceeds the timeout, producing false failures that look
like real timeouts — but only on the very first arm of the timer, not on
subsequent re-arms once the async task is already running.

## Fix

1. **Instrument first, cheap, ship-now.** If the app already has structured
   diagnostic logging that records per-attempt duration and outcome, no new
   code is needed — go straight to analysis. If it doesn't, add minimal
   logging (duration + outcome per attempt) and ship that alone before
   attempting a fix.
2. **Mine the field log for a duration cluster near the suspect threshold.**
   Pull every failure's duration and outcome. If failures cluster tightly
   around a duration close to the suspect timer's threshold — while the rare
   success takes meaningfully longer — that's quantitative confirmation of the
   race hypothesis without needing a repro. (Evidence below: 9 of 10 failures
   within ~250ms of each other, right at timeout-plus-startup-overhead; the 1
   success took roughly double that.)
3. **Split the single timeout constant into two.** A short one for genuine
   mid-utterance/mid-operation re-arming (the original value, still correct
   once the async task is live), and a longer, empirically-derived one for the
   very first arm before any result exists yet. Derive the first-arm value
   from the observed failure cluster — e.g. roughly 2x the worst individual
   observed failure duration, while staying comfortably under the one
   successful attempt's total duration — not a round-number guess.
4. **Instrument the fix with the same signal.** Keep the duration/outcome log
   in place after the fix ships. On the next real-world use, the same signal
   tells you whether the fix worked (failures disappear) or the constant needs
   another bump (failures persist, but at a new shifted duration near the new
   threshold).

This generalizes to any mobile/embedded timing bug that only manifests on real
hardware and can't be reproduced in a simulator/emulator/CI: instrument first,
then use the field-log duration distribution as the evidence base for both
diagnosing the race and picking the numeric fix parameter, rather than
guessing or shipping an untested speculative fix blind.

## Evidence

Session 0011, Phase 7 (00:55), Cubby iOS: "Analysis of every [Voice] entry ...
9 of 10 failed with `.noSpeechDetected` at a near-identical 1868–2111ms total
duration; the 1 success took 4226ms ... close to a textbook confirmation of
the plan's leading hypothesis: `armSilenceTimer()` arms its 1.5s countdown
before `recognitionTask(with:)` is even called."

Fix: split into `speechSilenceTimeoutSeconds` (re-arm) vs new
`speechInitialSilenceTimeoutSeconds` (first arm, 4.0s — "roughly 2x the worst
individual observed failure duration ... while staying comfortably under the
one successful attempt's 4.2s total"), with the reviewer noting the same log
signal will confirm or refute the new constant on the next real attempt.

## Related skills

- `avfoundation-capture-delivery-watchdog` — a related timeout/watchdog
  pattern for AVFoundation capture delivery on real devices.
- `mainactor-launch-watchdog-audit` — launch-time watchdog timing audited
  under MainActor-default isolation.

# For a device-only, hard-to-repro timing bug, mine accumulated structured diagnostic logs for a duration cluster near the suspect threshold before writing a speculative fix

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0011); adversarially verified.

## Problem
A bug hypothesis exists (a silence-detection timer starts before the async recognition task it's supposed to be timing is even created, so it races startup/warm-up latency instead of detecting a real pause) but there is no way to reproduce or unit-test it — the framework in question (on-device Speech recognition) doesn't run in the Simulator at all, so any fix would ship purely speculative.

## Solution
Before writing the fix, pull the app's own existing structured diagnostic log (already recording per-attempt `durationMs` and outcome with zero new code needed) and analyze the failure population statistically: do failures cluster tightly around a duration close to the suspect timer's threshold, while the rare success takes meaningfully longer? A tight cluster (here: 9 of 10 failures within ~250ms of each other, all near timeout-plus-startup-overhead, versus one success at roughly double that duration) is strong quantitative confirmation of the race hypothesis without needing a repro. Split the single timeout constant into two — a short one for genuine mid-utterance re-arming, and a longer, empirically-derived one for the very first arm before any result exists — and instrument the fix so the same log signal (failures disappearing, or persisting at a new shifted duration) tells you on the next real-world use whether the constant needs another bump.

## Evidence
Session 0011, Phase 7 (00:55): 'Analysis of every [Voice] entry ... 9 of 10 failed with .noSpeechDetected at a near-identical 1868–2111ms total duration; the 1 success took 4226ms ... close to a textbook confirmation of the plan's leading hypothesis: armSilenceTimer() arms its 1.5s countdown before recognitionTask(with:) is even called.' Fix: split into `speechSilenceTimeoutSeconds` (re-arm) vs new `speechInitialSilenceTimeoutSeconds` (first arm, 4.0s — 'roughly 2x the worst individual observed failure duration ... while staying comfortably under the one successful attempt's 4.2s total'), with the reviewer noting the same log signal will confirm or refute the new constant on the next real attempt.

## When to Use
This generalizes to any mobile/embedded timing bug that only manifests on real hardware and can't be reproduced in a simulator/emulator/CI: instrument first (cheap, ship-now), then use the field-log duration distribution as the evidence base for both diagnosing the race and picking a numeric fix parameter, rather than guessing or shipping untested speculative fixes blind.

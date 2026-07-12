# An async on-device AI/inference result must never silently vanish — every outcome (working / auto-applied / offered / failed / unusable) needs a distinct, visible UI state

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0018); adversarially verified.

## Problem
A background VLM naming pipeline was 'working as designed' (a higher-confidence OCR result correctly beat a lower-confidence VLM result in the merge logic) but from the user's perspective it looked completely broken — the losing VLM result was silently discarded, and both silent code paths (model-not-ready vs ran-and-lost) were unlogged and visually indistinguishable from a dead/non-functional feature. The user explicitly diagnosed this as a trust problem, not a correctness problem: 'AI must be visible + user chooses.'

## Solution
Model every terminal state of an async AI enrichment step as a distinct, user-visible payload rather than a boolean success/failure or a value that's silently dropped when it loses a merge: an explicit outcome type (e.g. `.autoApplied` / `.offered(alternates)` / `.failed(reason)` / `.unusable(rawText)`), a visible in-progress indicator while the async step runs, and — when the AI's result loses to a higher-confidence rule rather than erroring — surface it anyway as a non-destructive, tap-to-apply suggestion (a 'chip') instead of discarding it. This turns 'nothing happened, is it broken?' into 'the AI ran, here's what it found, you choose.'

## Evidence
Session 0018 (09:58 checkpoint): 'User's first scan (LITE SALT jar) showed OCR name at 69% and "nothing AI-ish" — diagnosed: merge working as designed (OCR 0.69 > VLM 0.65) but the losing VLM result was silently discarded and both silent paths (not-ready, ran-and-lost) were unlogged, indistinguishable from a dead engine. User directive: AI must be visible + user chooses. Shipped `VLMUpgradeOutcome` payload (auto-merge OR offered names)... spinner state..., "AI suggests" chips when Vision/OCR keeps the field, tap-to-apply.'

## When to Use
Any app layering an async, sometimes-lossy AI/ML enrichment step (autocomplete suggestions, on-device transcription, background classification, LLM-assisted field-filling) on top of a deterministic primary path faces the identical trust gap: a technically-correct 'AI lost the merge' silently reads as 'AI is broken' to the user. The outcome-typed, always-visible pattern generalizes well beyond this specific naming feature.

---
name: async-enrichment-silent-loss-outcome-states
description: A background AI/ML enrichment step (VLM naming, on-device classification, autocomplete) runs and produces a real result, but the user sees nothing — no spinner ever appeared, no suggestion shows up, and there is no way to tell "the model hasn't finished yet" apart from "it ran and a higher-confidence rule silently outvoted it," because a correct confidence-merge (e.g. OCR 0.69 beats VLM 0.65) just drops the losing result instead of surfacing it, making a working pipeline look completely dead. Use when adding any async, sometimes-lossy AI/ML enrichment layered on top of a deterministic primary path (autocomplete, background transcription/classification, LLM-assisted field-filling) — model every terminal state as a distinct visible UI state before shipping.
---

# Async AI Enrichment: Every Outcome Needs a Distinct, Visible UI State

## Symptom

A background VLM (vision-language model) naming pipeline was "working as
designed" — a higher-confidence OCR result (0.69) correctly beat a
lower-confidence VLM result (0.65) in the merge logic — but from the user's
perspective it looked completely broken. The user's first scan showed only
the OCR name at 69% confidence and "nothing AI-ish" happened. There was no
way to distinguish, from the UI, between:

- the VLM model hasn't finished running yet (not-ready), and
- the VLM ran, produced a result, and lost the merge (ran-and-lost).

Both paths were silent and unlogged, and both rendered identically to a
dead/non-functional feature. A technically-correct merge decision reads to
the user as "the AI is broken."

## Root cause

The merge logic only modeled the *winning* value — a boolean success/failure,
or a plain value that gets silently overwritten/discarded the moment a
higher-confidence rule wins. Losing async results were not values at all by
the time they reached the UI; they were already gone. Because the two silent
paths (not-ready vs. ran-and-lost) produced the exact same "nothing changed"
UI, and neither was logged, there was no observable difference between "AI
feature is disabled/broken" and "AI feature is working exactly as designed."
The user explicitly diagnosed this as a trust problem, not a correctness
problem: **"AI must be visible + user chooses."**

## Fix

Model every terminal state of the async enrichment step as a distinct,
user-visible payload — never collapse the outcome down to a boolean or a
value that can be silently dropped on the losing path of a merge:

1. **Explicit outcome type**, one case per terminal state — e.g. an
   `.autoApplied`, `.offered(alternates)`, `.failed(reason)`, `.unusable(rawText)`
   enum (named `VLMUpgradeOutcome` in the shipped fix). Do not represent this
   as `Bool` or `Result<Value, Error>` — those two cases can't distinguish
   "ran and lost the merge" from "ran and errored" from "still running."
2. **Visible in-progress indicator** while the async step runs, so
   "not-ready yet" is distinguishable from every terminal state.
3. **Surface losing results instead of discarding them.** When the AI's
   result loses to a higher-confidence deterministic rule (rather than
   erroring), don't drop it — render it as a non-destructive, tap-to-apply
   suggestion chip ("AI suggests: ___") next to the field that won the merge.
   The deterministic result still wins by default; the user can override.

This turns "nothing happened, is it broken?" into "the AI ran, here's what it
found, you choose." The pattern generalizes to any app layering an async,
sometimes-lossy AI/ML enrichment step (autocomplete suggestions, on-device
transcription, background classification, LLM-assisted field-filling) on top
of a deterministic primary path — the identical trust gap appears whenever a
technically-correct "AI lost the merge" is allowed to silently read as "AI is
broken."

## Evidence

Session 0018 (09:58 checkpoint), Cubby iOS: "User's first scan (LITE SALT
jar) showed OCR name at 69% and 'nothing AI-ish' — diagnosed: merge working
as designed (OCR 0.69 > VLM 0.65) but the losing VLM result was silently
discarded and both silent paths (not-ready, ran-and-lost) were unlogged,
indistinguishable from a dead engine. User directive: AI must be visible +
user chooses. Shipped `VLMUpgradeOutcome` payload (auto-merge OR offered
names)... spinner state..., 'AI suggests' chips when Vision/OCR keeps the
field, tap-to-apply."

## Related skills

- `vision-layout-ocr-grounding` — a different on-device-AI trust failure on
  the same scan pipeline (confabulated values from jumbled OCR text on the
  cold path) rather than a silently dropped result.
- `ondevice-generable-anti-hallucination` — related on-device AI output
  quality issue (hallucinated/placeholder values from `@Generable` schemas)
  that also needs a visible, distinguishable failure state rather than
  silently-wrong output.
- `scan-capture-quality-gates` — upstream capture-quality gating on the same
  scan pipeline this VLM naming step runs against.

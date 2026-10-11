---
name: async-enrichment-silent-loss-outcome-states
description: "A background AI/ML enrichment step (VLM naming, on-device classification, autocomplete) runs and produces a real result, but the user sees nothing — no spinner ever appeared, no suggestion shows up, and there is no way to tell \"the model hasn't finished yet\" apart from \"it ran and a higher-confidence rule silently outvoted it,\" because a correct confidence-merge (e.g. OCR 0.69 beats VLM 0.65) just drops the losing result instead of surfacing it, making a working pipeline look completely dead. The degenerate form ships even more easily: the step returns *successfully* with an empty or whitespace-only string, which then gets cached, rendered as blank space, and logged as a success — a card headed \"AI-generated\" above no text at all, with nothing in the diagnostics to say why. Use when adding any async, sometimes-lossy AI/ML enrichment layered on top of a deterministic primary path (autocomplete, background transcription/classification, LLM-assisted field-filling), or when a generation step's output reaches a cache or a renderer without a non-blank check at the boundary — model every terminal state as a distinct visible UI state before shipping. Also covers a transient Vision/ML failure or task cancellation on one page that silently falls back to a lower-quality recogniser whose non-empty text passes the never-cache-empty guard and is cached permanently."
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

## Fix 1 — every terminal state gets its own visible UI state

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

## Fix 2 — a blank result is a FAILURE outcome, not an empty success

The same defect has a degenerate form that is easier to ship and harder to see:
the enrichment step returns successfully with an **empty string**.

Generation succeeded from the pipeline's point of view — no throw, no nil — so
the empty value flows straight through: it gets cached (poisoning every
subsequent request for that key), rendered as blank space, and logged as a
success. The user sees a feature that "generates nothing", and the diagnostics
agree that everything worked.

**Validate non-blankness at the generation boundary, before the cache and before
the render:**

```swift
let text = try await model.generate(prompt)
guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    throw GenerationError.emptyOutput      // its own case, its own user-facing copy
}
cache[key] = text                          // only a validated value is cacheable
```

Three requirements, all load-bearing:

1. **Its own error case with its own message.** Folding it into a generic
   failure loses the one diagnostic that identifies it ("the model returned
   nothing" is a different bug from "the model errored").
2. **Validate before caching.** An empty value written to the cache converts a
   transient failure into a permanent one for that key.
3. **Whitespace-only counts as empty.** Models return `"\n"` and `" "` more
   often than `""`.

Test it by stubbing the model to return `""` and `"   "` and asserting a
user-visible error state — not by asserting the happy path still works.

## Fix 3 — a degraded fallback is not a success either

Fix 2's non-blank guard does not catch this: a recogniser swallows a Vision
error and returns `[]`, so the caller silently falls back to a second source
(e.g. the document API's lines). That text is non-empty, passes the guard,
and the layout and AI-text caches persist it until the file is rewritten. A
cancelled Analyze run did the same: the document API throws on cancellation
but the legacy text recogniser does not, so table-less text got cached.

Root cause: the recogniser returns `[]` for both "no text" and "threw", and
the caller treats the fallback as a normal page. Nothing checks
`Task.isCancelled` or source quality before the cache write.

Fix:
1. Make failure a distinct outcome (throw, or an enum case), never a silent
   fallback to the weaker source.
2. Allow a cache write only if every page came from the full-quality source
   AND `!Task.isCancelled`.
3. Record the entry's source; rebuild entries marked degraded.
4. Regression test: inject a throw or cancellation on one page and assert no
   cache file is written.
5. Version-bump cache keys on pipeline changes and sweep old suffixes at
   launch.

Evidence (a private document-scanner app, 6 sessions): paddle-ocr worktree `4918f6eb` (error
swallowed, fell back to document-API lines) and `27e2731c` (cancellation
asymmetry), main checkout `19b46702` (review flagged the permanent cache
write in the document-structure recognizer).

## Evidence

Session 0018 (09:58 checkpoint), Cubby iOS: "User's first scan (LITE SALT
jar) showed OCR name at 69% and 'nothing AI-ish' — diagnosed: merge working
as designed (OCR 0.69 > VLM 0.65) but the losing VLM result was silently
discarded and both silent paths (not-ready, ran-and-lost) were unlogged,
indistinguishable from a dead engine. User directive: AI must be visible +
user chooses. Shipped `VLMUpgradeOutcome` payload (auto-merge OR offered
names)... spinner state..., 'AI suggests' chips when Vision/OCR keeps the
field, tap-to-apply."

Fix 2 comes from the same app one wave later — session 0066 (2026-07-25),
BUG-043: "an empty model reply was stored as a valid summary, and
`SummaryMarkdown.blocks(from: "")` returns zero blocks, so the card rendered
'Generated now / AI-generated' with no text and no error." Shipped as a
`ContainerSummaryValidation` boundary that "rejects blank output at the
summarizer boundary", a cache "made to refuse to store a blank entry", and a
failure that surfaces "its **own** `LocalizedError` copy instead of one generic
retry line" — the three requirements above, in the order they were needed.

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

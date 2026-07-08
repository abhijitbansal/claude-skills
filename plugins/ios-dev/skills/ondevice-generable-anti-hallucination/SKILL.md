---
name: ondevice-generable-anti-hallucination
description: Fixing on-device FoundationModels (Apple Intelligence / SystemLanguageModel) generation that hangs indefinitely — spinner spins forever, respond(generating:) never returns — when a @Generable schema nests another @Generable type in an array (iOS 26), and output that hallucinates — bracketed placeholders like "[Insert Number Here]", dummy values ("John Doe", "12345"), concatenated fields ("Card Reference: Credit Card Amount: 25.0"), or an empty SOURCES/citations section — or degrades on long multi-script documents that blow the ~4K-token context window. Use when designing @Generable schemas, grounding prompts, or citation rendering for the on-device model.
---

# On-Device @Generable: Flat Schemas, Verbatim Pinning, Context Clipping

## Symptom

- **Hang:** `respond(generating:)` never returns; the Key Points spinner spins
  forever. No error, no timeout — the model just never completes. Happens the
  moment a `@Generable` struct nests another `@Generable` type inside an array.
- **Hallucination:** unstructured or loosely-guided prompts yield
  `[Insert Number Here]`-style bracketed placeholders, stock dummies
  (`John Doe`, `12345`), or two fields fused into one
  (`"Card Reference: Credit Card Amount: 25.0"`).
- **Empty SOURCES:** a terse model emits no `[n]` markers, so a regex-based
  citation parser renders nothing.
- **Long-doc degradation:** multi-script documents (e.g. a medical bill whose
  back pages repeat "Language Assistance Services" in 40+ scripts) tokenize
  2–3× heavier than English and overflow the fixed ~4K-token window.

## Root cause

Apple's FoundationModels constraint-satisfaction layer struggles with arrays
of **nested** `@Generable` structs on iOS 26 — generation stalls indefinitely.
Separately, the on-device model is small: without a schema that *pins* values
to verbatim document text, it fills gaps with plausible-looking placeholders;
and its context window is token- (not character-) budgeted, so non-English
scripts eat it 2–3× faster.

## Fix

**1. Flat `@Generable` schemas only.** Emit flat "LABEL: VALUE" strings from a
single-level `@Generable` struct; parse into your real type in code. The
`@Guide` description must explicitly demand verbatim copying — e.g. "Each
entry must be in the exact format 'LABEL: VALUE' — e.g. 'Receipt Number:
151987'. The VALUE must be copied verbatim from the document text. Never
invent values. Never combine two fields into one entry."

**Read `references/generable-schemas.md` before implementing** — the flat
`KeyFact`/`DocumentKeyPoints` structs and the `parseFacts` helper (splits each
entry on the first `":"`, drops empty halves, then runs the placeholder filter
below).

**2. Verbatim-quote pinning + belt-and-suspenders filter.** The `@Guide` text
(above) demands verbatim copying; code still filters model regressions
afterward — a `[Insert…]`-bracket scan plus a denylist of common stock dummy
values (`john doe`, `12345`, `n/a`, `tbd`, `lorem ipsum`, etc.).

**Read `references/generable-schemas.md` before implementing** — the
`filterFacts` implementation with the full denylist and bracket-placeholder
scan.

**3. Structured citations + top-N SOURCES fallback.** Have the model return
1-based indices into the excerpts you passed in; never depend on it emitting
`[n]` markers in prose. Fall back, in order, so SOURCES always renders when
material was retrieved: model indices → regex-scan the answer text for `[n]`
markers → the top-3 highest-scored excerpts as "sources considered."

**Read `references/generable-schemas.md` before implementing** — the
`AskAnswer` schema and the `resolveCitations` fallback chain.

**4. Clip grounding text to ~4000 chars, on read.** 4000 chars ≈ 1000 English
tokens or ~3000 multi-script tokens — headroom for the instruction template,
prompt, and generation buffer inside the ~4K window:

```swift
static let maxModelInputChars = 4000

static func clipForModel(_ text: String) -> String {
    guard text.count > maxModelInputChars else { return text }
    return String(text.prefix(maxModelInputChars))
        + "\n\n[… document truncated to fit the on-device model's context window]"
}
```

Apply the clip **on read** (cache hit or fresh OCR alike) so tuning the
constant never requires a cache bump; the cache file keeps the full text.
Hard-truncate each retrieval excerpt too (~1400 chars) before assembly.

## Evidence

doc-scan (Paperix) abh-9 commit series:
`fix(abh-9): flat schema for KeyFact — nested @Generable hangs gen` (the
nested-schema predecessor `structured KeyFact schema kills hallucination +
concat` hung on device),
`fix(abh-9): kill [Insert X Here] placeholders; pin verbatim quotes`,
`fix(abh-9): structured AskAnswer + top-3 fallback for SOURCES`,
`fix(abh-9): anti-hallucination grounding in Key Points prompt`. The 4000-char
clip lives in `DocumentTextLoader.maxModelInputChars`; first user repro was a
multi-script medical bill.

## Related skills

- `vision-layout-ocr-grounding` — where the grounding text comes from; garbage
  layout in ⇒ confabulation out, no matter how good the schema is.
- `swift6-mainactor-compile-fixes` — the parsed DTOs (`KeyFact`) and
  parse/filter helpers must be `nonisolated` in MainActor-default builds; run the
  AI pipeline off-main correctly.

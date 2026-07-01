---
name: ondevice-generable-anti-hallucination
description: >-
  Fixing on-device FoundationModels (Apple Intelligence / SystemLanguageModel)
  generation that hangs indefinitely — spinner spins forever,
  respond(generating:) never returns — when a @Generable schema nests another
  @Generable type in an array (iOS 26), and output that hallucinates —
  bracketed placeholders like "[Insert Number Here]", dummy values
  ("John Doe", "12345"), concatenated fields
  ("Card Reference: Credit Card Amount: 25.0"), or an empty SOURCES/citations
  section — or degrades on long multi-script documents that blow the
  ~4K-token context window. Use when designing @Generable schemas, grounding
  prompts, or citation rendering for the on-device model.
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

**1. Flat `@Generable` schemas only.** Emit flat strings; parse into your real
type in code:

```swift
/// Plain struct (NOT @Generable) — parsed from flat "LABEL: VALUE" strings.
/// Nested @Generable composition hangs generation on iOS 26.
struct KeyFact: Codable, Equatable, Hashable, Identifiable {
    let label: String
    let value: String
    var id: String { "\(label)\u{0001}\(value)" }
}

@Generable
struct DocumentKeyPoints {
    @Guide(description: """
    5 to 7 of the most important fields. Each entry must be in the exact \
    format "LABEL: VALUE" — e.g. "Receipt Number: 151987". The VALUE must be \
    copied verbatim from the document text. Never invent values. Never \
    combine two fields into one entry.
    """)
    let facts: [String]
}
// parseFacts(_:) splits each entry on the first ":", drops empty halves,
// then runs the placeholder filter below.
```

**2. Verbatim-quote pinning + belt-and-suspenders filter.** The `@Guide` text
demands verbatim copying (above); code still filters model regressions:

```swift
nonisolated static func filterFacts(_ facts: [KeyFact]) -> [KeyFact] {
    let knownDummies: Set<String> = ["john doe", "jane doe", "12345",
                                     "n/a", "none", "tbd", "unknown", "lorem ipsum"]
    return facts.filter { fact in
        let lowered = fact.value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !lowered.isEmpty else { return false }
        if let open = lowered.range(of: "[insert"),                 // [Insert X Here]
           lowered.range(of: "]", range: open.upperBound..<lowered.endIndex) != nil {
            return false
        }
        return !knownDummies.contains(lowered)
    }
}
```

**3. Structured citations + top-N SOURCES fallback.** Have the model return
1-based indices into the excerpts you passed in; never depend on it emitting
`[n]` markers in prose:

```swift
@Generable
struct AskAnswer {
    @Guide(description: "Answer grounded ONLY in the provided excerpts. If they don't contain the answer, say so plainly.")
    let answer: String
    @Guide(description: "1-based indices of the excerpts you actually used. Empty if none.")
    let citations: [Int]
}

// Fallback chain so SOURCES always renders when material was retrieved:
// model indices → regex-scan prose for [n] → top-3 hits as "sources considered".
nonisolated static func resolveCitations(indices: [Int], hits: [ScoredChunk],
                                         answer: String) -> [Citation] {
    var out = indices.compactMap { n in hits.indices.contains(n - 1) ? citation(hits[n - 1]) : nil }
    if out.isEmpty { out = parseCitations(in: answer, hits: hits) }
    if out.isEmpty { out = hits.prefix(3).map(citation) }
    return out
}
```

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
- `nonisolated-struct-codable-mainactor` (local learned micro-skill, not
  shipped with this plugin) — the parsed DTOs (`KeyFact`) and parse/filter
  helpers must be `nonisolated` in MainActor-default builds.
- `swift6-mainactor-migration` — running the AI pipeline off-main correctly.

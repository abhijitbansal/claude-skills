# @Generable Schemas: Flat KeyFacts, Verbatim Filter, Structured Citations

Full worked examples for rules 1–3 of `ondevice-generable-anti-hallucination`.

## Rule 1 — flat `@Generable` schema + parse helper

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
```

```swift
enum KeyFactParser {
    /// Splits each "LABEL: VALUE" entry on the FIRST ":" (values may contain
    /// colons, e.g. times), drops entries with an empty half, then runs the
    /// placeholder filter below.
    nonisolated static func parseFacts(_ entries: [String]) -> [KeyFact] {
        let facts: [KeyFact] = entries.compactMap { entry in
            guard let colon = entry.firstIndex(of: ":") else { return nil }
            let label = entry[..<colon].trimmingCharacters(in: .whitespacesAndNewlines)
            let value = entry[entry.index(after: colon)...]
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty, !value.isEmpty else { return nil }
            return KeyFact(label: label, value: value)
        }
        return filterFacts(facts)    // rule 2 below; same enum
    }
}
```

Run on macOS: `["Receipt Number: 151987", "Time: 10:30", "Amount:", ": 5",
"no colon here", "Name: [Insert Name Here]", "Name: John Doe"]` parses to the
first two facts only (value colons kept; empty halves, a missing colon, the
bracket placeholder and the stock dummy all dropped).

## Rule 2 — verbatim-quote pinning + belt-and-suspenders filter

```swift
// inside `enum KeyFactParser` (above)
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

## Rule 3 — structured citations + top-N SOURCES fallback

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

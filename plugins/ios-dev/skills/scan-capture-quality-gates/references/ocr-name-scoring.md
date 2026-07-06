# ItemNamer: single naming entry point, confidence floor/cap, prose reject

```swift
nonisolated enum ItemNamer {
    /// The ONLY way an item gets a name. No caller-supplied name parameter.
    static func resolveName(ocrCandidates: [NameCandidate],
                            defaultName: String) -> NameCandidate {
        let best = ocrCandidates
            .filter { !isSentenceLike($0.text) }
            // Per-glyph OCR confidence says "read correctly", not "is a name" — cap it.
            .map { NameCandidate(text: $0.text,
                                 confidence: min($0.confidence,
                                                 NamingConstants.ocrNameConfidenceCap)) }
            .max { $0.confidence < $1.confidence }
        guard let best, best.confidence >= NamingConstants.minNameConfidence
        else { return NameCandidate(text: defaultName, confidence: 0) }
        return best
    }

    /// Prose fragments ("Complete the form below and") are instructions, not names.
    static func isSentenceLike(_ text: String) -> Bool {
        let words = text.split(separator: " ")
        if words.count > 6 { return true }               // names are short noun phrases
        if text.hasSuffix(".") || text.hasSuffix(",") || text.hasSuffix(":") { return true }
        let proseMarkers: Set<String> = ["the", "and", "your", "please", "below",
                                         "above", "complete", "enter", "fill"]
        return words.filter { proseMarkers.contains($0.lowercased()) }.count >= 2
    }
}
```

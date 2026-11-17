# Pure, framework-free filter type + its unit test

```swift
// CORRECT — pure, framework-free filter type. Zero simulator.
// Matching is case-insensitive on BOTH sides (typed, vocabulary, selected), but the
// returned strings keep the vocabulary's own display casing.
enum LabelSuggestions {
    static func filtered(
        vocabulary: [String],
        typed: String,
        excluding selected: Set<String>
    ) -> [String] {
        let query = typed.trimmingCharacters(in: .whitespaces).lowercased()
        let selectedKeys = Set(selected.map { $0.lowercased() })
        let candidates = vocabulary.filter { !selectedKeys.contains($0.lowercased()) }
        guard !query.isEmpty else { return candidates }                   // empty field = browse-all
        return candidates.filter { $0.lowercased().hasPrefix(query) }      // non-empty = type-to-filter
    }
}
```

```swift
func testEmptyTextReturnsAllVocabularyExcludingSelected() {
    let result = LabelSuggestions.filtered(
        vocabulary: ["tools", "electronics", "holiday"], typed: "", excluding: ["holiday"])
    XCTAssertEqual(result, ["tools", "electronics"])
}
```

```swift
func testMixedCaseVocabularyMatchesAndKeepsDisplayCasing() {
    let vocabulary = ["Tools", "Electronics", "Holiday"]
    XCTAssertEqual(LabelSuggestions.filtered(vocabulary: vocabulary, typed: "TO", excluding: []),
                   ["Tools"])
    XCTAssertEqual(LabelSuggestions.filtered(vocabulary: vocabulary, typed: "", excluding: ["holiday"]),
                   ["Tools", "Electronics"])
}
```

Run on macOS (Swift 6) against the filter above: `"TO"` matches `"Tools"`, a
selected `"holiday"` removes `"Holiday"`, and the display casing is kept. The
earlier version lowercased only the query, so a capitalised vocabulary never
matched and `selected` was compared case-sensitively.

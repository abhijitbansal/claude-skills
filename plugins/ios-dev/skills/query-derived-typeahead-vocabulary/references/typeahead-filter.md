# Pure, framework-free filter type + its unit test

```swift
// CORRECT — pure, framework-free filter type. Ten unit tests, zero simulator.
enum LabelSuggestions {
    static func filtered(
        vocabulary: [String],
        typed: String,
        excluding selected: Set<String>
    ) -> [String] {
        let query = typed.trimmingCharacters(in: .whitespaces).lowercased()
        let candidates = vocabulary.filter { !selected.contains($0) }
        guard !query.isEmpty else { return candidates }   // empty field = browse-all
        return candidates.filter { $0.hasPrefix(query) }   // non-empty = type-to-filter
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

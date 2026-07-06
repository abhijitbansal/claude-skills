# Live vocabulary: reactive query reduced to a deduped, normalized set

```swift
// Live vocabulary: reactive query over persisted items, reduced to a
// deduped label set. Self-maintaining — no editorial list to keep in sync.
@Query(filter: #Predicate<Item> { $0.isActive })
private var activeItems: [Item]

private var labelVocabulary: [String] {
    var seen = Set<String>()
    var ordered: [String] = []
    for item in activeItems {
        let normalized = item.label.trimmingCharacters(in: .whitespaces).lowercased()
        guard !normalized.isEmpty, seen.insert(normalized).inserted else { continue }
        ordered.append(normalized)
    }
    return ordered
}
```

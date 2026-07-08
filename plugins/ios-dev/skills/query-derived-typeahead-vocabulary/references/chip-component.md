# Shared chip component with an optional vocabulary dependency

```swift
// Shared across add-screen and edit-screen. A third call site (e.g. a
// multi-crop bulk-review flow) that has no vocabulary just omits the
// parameter — it isn't forced to wire anything.
struct LabelChipEditor: View {
    @Binding var selected: Set<String>
    var labelVocabulary: [String]? = nil   // optional — composes, doesn't impose

    var body: some View {
        // ... text field ...
        if let vocabulary = labelVocabulary {
            let suggestions = LabelSuggestions.filtered(
                vocabulary: vocabulary, typed: typedText, excluding: selected)
            ChipList(items: suggestions)
        }
    }
}
```

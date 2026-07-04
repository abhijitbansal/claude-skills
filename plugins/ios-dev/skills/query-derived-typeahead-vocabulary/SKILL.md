---
name: query-derived-typeahead-vocabulary
description: Type-ahead label/category suggestion chips that go stale within days (hardcoded suggestion list never matches what the user actually types), or filtering logic for those chips that can't be unit-tested and is duplicated between an add-screen and an edit-screen because it's written inline in the view body against the UI framework's view protocol. Use when building suggestion/autocomplete chips for a tagging, labeling, or category-entry UI backed by a persistent store, when a shared chip/tag-input component needs to serve multiple screens (add vs edit vs a bulk/multi-item flow) some of which have no vocabulary to offer, or when reviewing a PR that filters suggestions directly inside a SwiftUI View/ViewModel body.
---

# Query-Derived Type-Ahead Vocabulary (not a static suggestion list)

## Symptom

The obvious first implementation of "suggest labels as you type" ships fine
and rots fast:

- A hardcoded `["Electronics", "Tools", "Holiday", …]` array of suggested
  labels/categories. It never reflects what this user actually calls things,
  so it's stale within days and permanently wrong for anyone whose vocabulary
  differs from the seed list.
- Or, reaching for real data but wiring it up inline: querying the store and
  filtering results directly inside the view body (or a view-bound
  `@Observable`/`ObservableObject` view model). This compiles and demos fine,
  then fails on the second call site — the same filter-by-typed-text logic
  gets copy-pasted into the edit screen, drifts from the add screen's
  version, and can't be unit tested because it's entangled with the UI
  framework's view protocol (no view, no test).

## Root cause

Two separate problems get solved with one bad shortcut each:

1. **Vocabulary source.** A static list is an editorial artifact — someone
   has to remember to update it, and it can never lead the user's actual
   usage. The real vocabulary already exists in the persisted store; it just
   isn't being read live.
2. **Filter logic placement.** Ranking/filtering "which of these strings
   match what's typed, excluding what's already selected" is pure
   string/array logic with zero UI dependency. Writing it inside a `View`
   body (or a view-model method that only makes sense bound to that view)
   couples a pure computation to a rendering lifecycle — you can't call it
   from a unit test without spinning up the UI framework, and you can't
   reuse it from a second screen without duplicating it or awkwardly
   reaching across view boundaries.

A third, smaller trap compounds both: baking a *required* vocabulary
parameter into a shared chip/tag-input component. Every call site — including
ones that have no sensible vocabulary to offer (e.g. a bulk multi-item review
flow) — is then forced to wire something in, even if it's an empty array
that silently disables the feature there.

## Fix

**1. Source the vocabulary live from the store, not from a literal.** Use
the persistence layer's reactive query mechanism (SwiftData `@Query`, Core
Data `@FetchRequest`, a Combine/Room/Realm live query — whatever the stack
provides) scoped to the relevant records, then reduce it to a deduped,
normalized set:

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

Normalize (trim + lowercase) at the point of dedup, not at display time —
otherwise "Tools" and "tools" typed on different days silently become two
vocabulary entries.

**2. Put the filter in a pure, framework-free type.** It takes the full
vocabulary, the user's current typed text, and current selections, and
returns ranked/filtered suggestions. No `View`, no `@Observable`, no import
of the UI framework at all:

```swift
// WRONG — filtering inline in the view body: untestable without a
// simulator/view host, and gets copy-pasted into the next screen that needs it.
var body: some View {
    let matches = allLabels.filter {
        $0.lowercased().hasPrefix(typedText.lowercased()) && !selected.contains($0)
    }
    ChipList(items: matches)
}
```

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

The empty-vs-non-empty branch is deliberate: an empty text field means "let
me browse everything I've used before" (tap-to-reveal), while typed text
means "filter to what matches" — collapsing the two loses the browse
affordance.

**3. Make the shared chip component's vocabulary dependency optional.**
Every call site that wires the component gets the feature only if it wants
it; nothing is forced to plumb through a real (or fake-empty) vocabulary it
doesn't have:

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

## Evidence

Cubby (label/category type-ahead on the item add and edit screens): shipped
as an `Item`-vocabulary reduction over a SwiftData `@Query` feeding a pure
`LabelSuggestions` filter type, covered by ten unit tests with no simulator
dependency; the shared chip editor took `labelVocabulary: [String]? = nil` so
the burst/multi-crop review flow — which has no per-item vocabulary to offer
— could reuse the same editor component without wiring anything extra.

## Related skills

- `swiftdata-cloudkit-model-rules` — model/container-level SwiftData +
  CloudKit failures (attribute optionality, sync toggling); not about
  deriving UI vocabulary from query results.
- `mainactor-runtime-isolation-trap` — runtime isolation crashes/re-entrancy
  under `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`; unrelated to this
  skill's pure-type/optional-dependency composition problem, though the same
  "push logic into a `nonisolated`/framework-free type" instinct applies to
  both.

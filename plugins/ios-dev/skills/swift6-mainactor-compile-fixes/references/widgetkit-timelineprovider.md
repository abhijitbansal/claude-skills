# WidgetKit TimelineProvider needs whole-type `nonisolated`, not per-method

## Symptom

In a widget extension target under `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`,
marking individual `TimelineProvider` methods (`placeholder`, `getSnapshot`,
`getTimeline`) `nonisolated` is insufficient. The protocol *conformance
itself* stays main-actor-isolated under MainActor-default, producing:

```
conformance of 'X' to protocol 'TimelineProvider' crosses into main actor-isolated code
```

Don't copy a pre-MainActor-default provider verbatim from an older codebase
or a pre-Xcode-26 template — it won't compile clean.

## Root cause

Same class of bug as the general case in the parent skill (an implicitly
`@MainActor` type used from a nonisolated context), but the conformance
itself — not just the methods — carries the isolation. Per-method
`nonisolated` fixes each method's own body but leaves the `TimelineProvider`
conformance declaration itself main-actor-isolated, which is what the
compiler is actually complaining about.

## Fix

Mark the **whole provider struct and its `TimelineEntry` type**
`nonisolated struct`, not just the methods:

```swift
nonisolated struct OverviewEntry: TimelineEntry {
    let date: Date
    let snapshot: CubbyWidgetSnapshot
}

nonisolated struct OverviewProvider: TimelineProvider {
    func placeholder(in _: Context) -> OverviewEntry { .init(date: Date(), snapshot: .sample) }
    func getSnapshot(in _: Context, completion: @escaping (OverviewEntry) -> Void) { ... }
    func getTimeline(in _: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) { ... }
}
```

Related, separate gotcha in the same build: `nonisolated` on a type does NOT
propagate to a separately-declared `extension` of that type — mark the
extension `nonisolated extension X { ... }` explicitly too if it's read from
the nonisolated provider (this is the same extension-isolation rule the
parent skill's "Hard rules" section notes generally, applied here to a
`TimelineProvider`'s own extensions).

## When to use

- Building a WidgetKit extension in any project with
  `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`.
- Error mentions a protocol conformance "crosses into main actor-isolated
  code."

# WidgetKit TimelineProvider Needs Whole-Type nonisolated (Not Per-Method)

**Extracted:** 2026-07-04
**Context:** Widget extension target in a Swift 6 project with `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`.

## Problem
Marking individual `TimelineProvider` methods (`placeholder`, `getSnapshot`, `getTimeline`) `nonisolated` is insufficient. The protocol *conformance itself* stays main-actor-isolated under MainActor-default, producing:
`conformance of 'X' to protocol 'TimelineProvider' crosses into main actor-isolated code`.
Don't copy a pre-MainActor-default provider (older codebase, pre-Xcode-26 template) verbatim — it won't compile clean.

## Solution
Mark the **whole provider struct and its `TimelineEntry` type** `nonisolated struct`, not just the methods.

## Example
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
Related, separate gotcha in the same build: `nonisolated` on a type does NOT propagate to a separately-declared `extension` of that type — mark the extension `nonisolated extension X { ... }` explicitly too if it's read from the nonisolated provider.

## When to Use
- Building a WidgetKit extension in any project with `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`.
- Error mentions a protocol conformance "crosses into main actor-isolated code."

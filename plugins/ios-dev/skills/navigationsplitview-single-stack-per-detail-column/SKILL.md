---
name: navigationsplitview-single-stack-per-detail-column
description: iPad app crashes only on iPad (NavigationSplitView is iPad/regular-width only) with a cryptic internal SwiftUI stack trace (_assertionFailure <- NavigationColumnState.boundPathChange <- NavigationState.update), only after multi-device sync brings in new navigable data — nothing in the app's own model layer. Use when a NavigationSplitView.detail slot keeps multiple tab roots permanently mounted in a ZStack for cross-tab @State preservation and each tab root wraps itself in its own NavigationStack; also use when reviewing a fix that conditionally mounts/unmounts a NavigationStack, since toggling that wrapper resets any @State owned inside it.
---

# NavigationSplitView detail column corrupts when multiple NavigationStacks stay mounted

## Symptom

An iPad app crashes with a cryptic internal SwiftUI stack trace:

```
_assertionFailure <- NavigationColumnState.boundPathChange <- NavigationState.update
```

Distinguishing marks that make this easy to misdiagnose:

- Crashes **only on iPad** — `NavigationSplitView` is iPad/regular-width only,
  so an iPhone-only test matrix never reproduces it.
- Crashes **only after multi-device sync** brings in new navigable data (e.g.
  CloudKit pushes a new record that becomes selectable/navigable).
- The trace is entirely inside SwiftUI internals — nothing points at the
  app's own model layer, persistence, or relationships.

This combination is a strong lure toward the wrong hypothesis: two prior
debugging sessions on the source app chased CloudKit/relationship-rename
theories before the real TestFlight crash log (pulled via Xcode Organizer)
revealed the true cause was SwiftUI-internal, not data-layer.

## Root cause

The app kept several tab roots permanently mounted in a `ZStack` inside one
`NavigationSplitView.detail` slot, specifically to preserve `@State` across
tab switches. Each tab root self-wrapped its own `NavigationStack`. That
means three `NavigationStack`s were simultaneously live, all feeding a single
`NavigationSplitView` detail column.

**Exactly one `NavigationStack` may be live inside a `NavigationSplitView`'s
detail column at any time.** This is an undocumented SwiftUI internal
invariant, not app-specific business logic. Having multiple simultaneously
mounted corrupts SwiftUI's internal column-path bookkeeping
(`NavigationColumnState`), and the corruption only surfaces as a crash once
new navigable data forces a column-path update.

## Fix

Conditionally mount only the active tab's `NavigationStack`; inactive tab
roots skip wrapping themselves in `NavigationStack` entirely. Drive this with
an environment flag set by the split container, e.g. `isInactiveSplitDetail`,
that each tab root reads to decide whether to self-wrap:

```swift
// Split container sets the flag per tab root:
TabRootView()
    .environment(\.isInactiveSplitDetail, tab != activeTab)

// Each tab root reads it and conditionally wraps:
struct TabRootView: View {
    @Environment(\.isInactiveSplitDetail) private var isInactive

    var body: some View {
        if isInactive {
            content   // no NavigationStack — inactive, stays mounted for state
        } else {
            NavigationStack {
                content
            }
        }
    }
}
```

### Second-order regression to watch for

Conditionally wrapping a view in `NavigationStack` on toggle **changes
SwiftUI structural identity**. Every time a tab reactivates, `content`'s
identity is torn down and rebuilt, silently resetting any `@State` owned
*inside* that view — defeating the exact cross-tab state preservation the
`ZStack`-of-tab-roots pattern was built for in the first place.

Fix: lift that `@State` up into the parent that stays permanently mounted
(the tab root itself, outside the conditional), and pass it down as
`@Binding` to `content`. Only the `NavigationStack` wrapper toggles identity;
the state owner does not.

When reviewing a PR that applies the `isInactiveSplitDetail`-style fix,
explicitly check whether any `@State` lives inside the conditionally-wrapped
view — that's the regression a first pass of this fix is likely to introduce.

## Evidence

Mined from Cubby iOS session logs (session 0021), adversarially verified:

> "three simultaneously-live NavigationStacks feeding one column is
> unsupported by NavigationSplitView and corrupts its column-path state...
> Fixed (938c0db): new isInactiveSplitDetail environment flag...
> ecc:swift-reviewer caught a real HIGH regression the fix introduced —
> conditionally wrapping in NavigationStack changes SwiftUI structural
> identity on toggle, silently resetting BrowseRootView's own @State... fixed
> by lifting that state up into BrowseTab."

Two prior debugging sessions on the same crash chased CloudKit/relationship-
rename hypotheses before the real TestFlight crash log (pulled via Xcode
Organizer) surfaced the true SwiftUI-internal cause.

## Related skills

- `swiftui-tabbar-swipe-nav-tradeoff` — related NavigationStack-per-tab
  architecture tradeoffs in tab-based navigation.
- `mainactor-runtime-isolation-trap` — another case of a crash whose stack
  trace points away from the actual app-level cause.
- `swiftui-sheet-in-sheet-uikit-present-bridge` — a different SwiftUI
  presentation bug that shares the same debugging shape: only reveals itself
  by tracing the actual runtime hierarchy, not the call site in isolation.

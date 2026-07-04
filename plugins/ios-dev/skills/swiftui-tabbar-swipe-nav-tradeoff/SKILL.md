---
name: swiftui-tabbar-swipe-nav-tradeoff
description: Product wants a labeled bottom tab bar (icon + text, like Scan/Browse/Search) AND horizontal swipe-between-tabs like a page view — SwiftUI's TabView won't give you both at once, only one or the other without custom work. If you build a custom pager to get the swipe, deep link / NFC tag scan / Siri App Intent routing into a tab can land on the wrong page or leave it in a scroll-disabled state, because setting the selected tab and pushing a nav path in the same render races with the pager's own render pass. Use when scoping a tab bar + swipe requirement, or when programmatic navigation into a custom-pager tab area intermittently mis-lands.
---

# TabView Labeled-Bar vs Swipe-Between-Tabs Tradeoff

## Symptom

Design asks for a bottom tab bar with visible labels (not just icons) *and*
the ability to swipe left/right between tab contents the way a page-style
view works. SwiftUI's `TabView` does not do both simultaneously — the
page-style presentation that enables swiping and the labeled-icon bar style
are mutually exclusive without custom work.

If you route around this by building your own horizontal pager and keeping
native `TabView`'s selection binding wired to it, a second symptom shows up
once any *programmatic* navigation touches the same screen: a deep link, an
NFC tag scan, or a Siri App Intent that both (a) selects a tab and (b) pushes
a navigation path in the same update lands on the wrong page, or leaves the
pager scroll-disabled — intermittently, not every time.

## Root cause

**Part 1 — the TabView tradeoff.** `TabView`'s labeled bottom-bar appearance
and its swipeable page-style appearance are two different presentation modes.
Picking the labeled bar gets you standard tab-switching (tap only); picking
the page style gets you swipe, but loses the persistent labeled bar. There is
no built-in flag that gives both.

**Part 2 — the custom-pager race.** A hand-rolled pager doesn't inherit
`TabView`'s built-in handling of *simultaneous* programmatic state changes.
When code sets the selected-tab index and pushes a navigation path in the
same render pass (typical of deep-link / NFC / App Intent handlers, which
want to say "go to Browse tab, at this item" in one shot), that mutation
races the pager's own render/layout pass. The pager can read stale layout
state and settle on the wrong page, or end up in a transient state where its
own scroll gesture is disabled.

## Fix

Ship in two phases, and architect the swap point so phase 2 is a one-line
revert if the custom pager misbehaves.

**Phase A — ship native `TabView` first.** Labeled tab bar, tap-to-switch
only, no swipe. This is the safe fallback and the thing you revert to.

```swift
// WRONG — trying to force both labeled bar + swipe out of one TabView
TabView(selection: $selectedTab) {
    ScanView().tag(Tab.scan)
    BrowseView().tag(Tab.browse)
    SearchView().tag(Tab.search)
}
.tabViewStyle(.page)          // gives swipe, DROPS the labeled bar
```

```swift
// CORRECT — phase A: native TabView, labeled bar, tap-only
TabView(selection: $selectedTab) {
    ScanView().tag(Tab.scan)
        .tabItem { Label("Scan", systemImage: "viewfinder") }
    BrowseView().tag(Tab.browse)
        .tabItem { Label("Browse", systemImage: "square.grid.2x2") }
    SearchView().tag(Tab.search)
        .tabItem { Label("Search", systemImage: "magnifyingglass") }
}
```

**Phase B — add swipe via a custom pager wrapping the same tab content**,
behind a single switch so it is revertible in one line:

```swift
// Swappable in one line: flip `usesCustomPager` back to false
// to fall back to native TabView if the pager misbehaves.
if usesCustomPager {
    SwipeablePager(selection: $selectedTab, tabs: Tab.allCases) { tab in
        content(for: tab)
    }
} else {
    TabView(selection: $selectedTab) { /* same tag/tabItem content as phase A */ }
}
```

**The programmatic-navigation guard.** Never set `selectedTab` and push a
nav path in the same render when the custom pager is active. Split the
mutation across two run-loop ticks so the pager finishes laying out the new
tab before the path push arrives:

```swift
// WRONG — races the pager's own render pass; can land on wrong page
// or leave it scroll-disabled
func handleDeepLink(_ target: DeepLinkTarget) {
    selectedTab = target.tab
    browsePath.append(target.itemID)   // pushed same tick as tab change
}
```

```swift
// CORRECT — split across two ticks so the pager settles first
func handleDeepLink(_ target: DeepLinkTarget) {
    selectedTab = target.tab
    Task { @MainActor in
        await Task.yield()             // let the pager's render pass complete
        browsePath.append(target.itemID)
    }
}
```

If the app has several programmatic-navigation entry points (deep links, NFC,
Siri App Intents) feeding a tabbed area, it's often simpler and lower-risk to
keep those specific destinations on native `TabView` (revert the phase B
switch for that screen) and reserve the custom pager for tabs that are only
ever reached by a user's own swipe/tap gesture.

## Evidence

- **cubby** — 3-tab (Scan/Browse/Search) navigation layer. Phase A shipped
  native `TabView` with a labeled bar plus a gear-sheet Settings entry, no
  swipe. Phase B added swipe via a custom pager wrapping the tab content,
  deliberately built swappable back to native `TabView` in one line. Risk
  identified before it shipped further: deep link / NFC tag scan / Siri App
  Intent routing into Browse sets the selected tab and pushes a nav path in
  the same render, which could race the pager's layout pass and land on the
  wrong page or a scroll-disabled state. Mitigations on the table: split the
  state mutation across two run-loop ticks, or revert to native `TabView`
  specifically for the programmatic-navigation-heavy screens.

## Related skills

- `deep-link-resolver-applock-pathtraversal` — the single resolver pattern
  for turning a deep link / widget link / App Intent into a routing action;
  pairs with this skill's two-tick guard when that action targets a
  custom-pager tab.
- `mainactor-runtime-isolation-trap` — variant B (re-entrancy across an
  `await`) is the same family of race as the pager race here, but for
  `@MainActor` methods rather than a SwiftUI render pass; both are fixed by
  not asserting two state changes happen atomically across a suspension
  point.

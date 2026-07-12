---
name: swiftui-pushed-list-tabbar-scroll-clearance
description: A custom bottom tab bar (attached via safeAreaInset to a pager/root container, not per-screen) leaves the last row of a pushed List hidden or clipped behind it, even though pushed ScrollView screens clear it fine. Use this whenever a SwiftUI app has a hand-rolled tab bar (not the native TabView bar) and a pushed detail screen — especially a List — has content overlapping or hidden behind the bar, the last row is unreachable, or scrolling doesn't seem to go "all the way." This is a companion gotcha to the swiftui-tabbar-swipe-nav-tradeoff skill (custom pager + tab bar architecture) — read that skill first if the tab bar itself is a custom pager; this one is specifically about List's safe-area handling differing from ScrollView's.
promotion_target: Append as "Part 3" to the ios-dev plugin's swiftui-tabbar-swipe-nav-tradeoff skill — same architecture family (custom pager-attached tab bar), different symptom (scroll clearance vs navigation race).
---

# Custom Tab Bar + Pushed `List` — Last Row Clips Behind the Bar

## Symptom

An app has a custom bottom tab bar attached via `.safeAreaInset(edge: .bottom)`
to the pager/root container (not to each individual screen) so it stays
visible over pushed detail screens. Pushed `ScrollView`-based screens already
have an explicit clearance helper applied and scroll cleanly past the bar. A
**pushed `List`-based** detail screen (`BinDetailView`, `RackDetailView`, or
any `List` pushed onto the same `NavigationStack`) has its **last row hidden
or clipped behind the bar** — the list appears to stop scrolling before
reaching its real end, and a doc comment on the existing clearance helper may
even claim this is expected ("List is exempt, it handles its own inset") —
that claim is wrong.

## Root cause

The bar's `safeAreaInset` is attached to the **pager**, one level up from any
individual `NavigationStack`. A pushed screen's own scroll surface never
receives that inset automatically — SwiftUI only auto-reserves the **device**
safe area (the home indicator strip) for a `List`, not the extra height added
by an app-level custom overlay bar that a `NavigationStack` push doesn't know
about. A raw `ScrollView` has exactly the same gap, which is presumably why an
explicit clearance helper already existed — but `List` was assumed (wrongly)
to handle it via its own automatic inset behavior. It doesn't: `List`'s
automatic inset only ever covers the device's own safe area, never a custom
in-app overlay.

## Fix

Apply the **same** clearance helper to `List`-based pushed screens that
`ScrollView`-based ones already use — there is no List-specific alternative
needed, and no reason to special-case it:

```swift
extension View {
    /// Reserve bottom clearance for the paged root's custom tab bar on a
    /// **pushed** detail screen — List or raw ScrollView alike. The bar is
    /// attached to the pager, not each NavigationStack, so it stays visible
    /// over pushed screens and its safe-area inset doesn't reach a pushed
    /// screen's scroll surface; List's automatic inset only covers the device
    /// safe area, not this bar's added height. Apply to every pushed
    /// scrollable detail screen so its last content clears the bar. Single
    /// choke point so a new push destination can't silently forget it.
    func rootTabBarScrollClearance() -> some View {
        contentMargins(.bottom, RootTabBar.contentHeight, for: .scrollContent)
    }
}

// BinDetailView.swift / RackDetailView.swift — both List-based
List { ... }
    .scrollContentBackground(.hidden)
    .background(Theme.Palette.background)
    .rootTabBarScrollClearance()   // <- the fix; identical call as ScrollView screens
```

`contentMargins(_:for:)` works uniformly across `List` and `ScrollView`
because both are backed by the same scroll-content machinery — there's no
List-vs-ScrollView branching needed in the helper itself, only in remembering
to **call** it on every pushed scrollable screen.

**Verify by seeding enough rows to overflow one screen** (an 11-item list, or
whatever comfortably exceeds a device's visible height), reverting the fix
temporarily to confirm the last row actually clips, then reapplying it and
confirming the content clears the bar with no dead gap left over. Confirming
the *broken* state first is what catches an insufficient fix (e.g., adding
just enough clearance to help but not enough to fully clear).

## The generalizable rule

Any time a custom overlay (tab bar, floating action button, banner) is
attached at a container level **above** individual pushed screens rather than
per-screen, assume its extra height reaches **none** of those pushed screens'
own safe-area/inset handling automatically — regardless of whether the pushed
screen is `List`, `ScrollView`, `Form`, or anything else backed by scrollable
content. Route every pushed scrollable screen through one shared clearance
helper (a single choke point) rather than hand-adding padding per screen, so a
newly added push destination can't silently forget it — and don't trust a doc
comment's claim that one content type is "exempt" without reverting the fix
and reproducing the clip yourself first.

## Related skills
- `swiftui-tabbar-swipe-nav-tradeoff` — the parent architecture (custom pager +
  attached tab bar) that creates the pushed-content clearance gap in the first
  place; read that skill for the pager itself, this one for the scroll-content
  side effect once the pager exists.

# NavigationSplitView detail column corrupts when multiple NavigationStacks stay mounted

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0021); adversarially verified.

## Problem
An iPad app kept several tab roots permanently mounted in a ZStack inside one NavigationSplitView.detail slot (for cross-tab @State preservation), and each tab root self-wrapped its own NavigationStack. Having three simultaneously-live NavigationStacks feeding a single NavigationSplitView detail column is unsupported and corrupts SwiftUI's internal column-path bookkeeping — it crashed only on iPad (NavigationSplitView is iPad/regular-width only), only after multi-device sync brought in new navigable data, with a cryptic internal SwiftUI stack trace (_assertionFailure <- NavigationColumnState.boundPathChange <- NavigationState.update), nothing to do with the app's own model layer. Two prior debugging sessions chased CloudKit/relationship-rename hypotheses before the real TestFlight crash log (pulled via Xcode Organizer) revealed the true SwiftUI-internal cause.

## Solution
Exactly one NavigationStack may be live inside a NavigationSplitView's detail column at any time. Fix pattern: an environment flag (e.g. isInactiveSplitDetail) set by the split container tells each tab root to skip wrapping itself in NavigationStack while inactive, so only the active tab's stack is mounted. Watch for a second-order regression: conditionally wrapping a view in NavigationStack changes SwiftUI structural identity on toggle, silently resetting any @State owned inside that view on every reactivation — lift that state up into the parent that stays permanently mounted and pass it down as @Binding.

## Evidence
Session 0021: 'three simultaneously-live NavigationStacks feeding one column is unsupported by NavigationSplitView and corrupts its column-path state... Fixed (938c0db): new isInactiveSplitDetail environment flag... ecc:swift-reviewer caught a real HIGH regression the fix introduced — conditionally wrapping in NavigationStack changes SwiftUI structural identity on toggle, silently resetting BrowseRootView's own @State... fixed by lifting that state up into BrowseTab.'

## When to Use
Any SwiftUI iPad/multi-column app that wants cross-tab state preservation via a persistent ZStack of tab roots inside NavigationSplitView will hit this exact trap — it's a documented-nowhere SwiftUI internal invariant (one NavigationStack per split column), not Cubby-specific business logic.

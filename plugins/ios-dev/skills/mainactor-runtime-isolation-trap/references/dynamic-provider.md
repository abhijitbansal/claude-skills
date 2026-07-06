# Dynamic color/image provider: WRONG vs CORRECT nonisolated pattern

```swift
// WRONG — formed in @MainActor context, closure inherits @MainActor;
// UIKit caches it and resolves it on com.apple.SwiftUI.AsyncRenderer → brk 1
enum Palette {
    static let card = UIColor { traits in
        traits.userInterfaceStyle == .dark ? darkCard : lightCard
    }
}
```

```swift
// CORRECT
enum Palette {
    // 1. Store the resolved provider as `nonisolated static let`.
    // 2. Mark the closure @Sendable so inherited isolation is a compile error.
    nonisolated static let card = UIColor { @Sendable traits in
        resolvedCard(for: traits.userInterfaceStyle)   // 3. everything it calls…
    }

    // …must itself be nonisolated (pure compute, no main-actor state).
    nonisolated static func resolvedCard(for style: UIUserInterfaceStyle) -> UIColor {
        style == .dark ? darkCard : lightCard
    }
}
```

The `nonisolated` seam (`resolvedCard`) doubles as the off-main regression test
hook:

```swift
func testDynamicColorResolvesOffMain() async {
    await Task.detached {
        _ = Palette.card.resolvedColor(
            with: UITraitCollection(userInterfaceStyle: .dark))
    }.value
}
```

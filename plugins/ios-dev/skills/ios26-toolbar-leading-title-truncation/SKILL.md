---
name: ios26-toolbar-leading-title-truncation
description: A SwiftUI screen title placed in ToolbarItem(placement .topBarLeading) renders on iOS 26 as a single letter plus ellipsis ("C…") inside a small glassy circle/capsule, instead of the full title text — happens with .navigationBarTitleDisplayMode(.inline) and a custom Text (especially large/serif font) in a leading or trailing toolbar slot. Use when a title looks truncated-to-one-glyph in a Liquid Glass toolbar button on iOS 26, when deciding where to put a screen title that also needs an adjacent action button, or when tempted to move a title out of .navigationTitle into a ToolbarItem for layout control.
---

# iOS 26 Toolbar Leading/Trailing Title Truncates to One Glyph

## Symptom

A custom title `Text` placed in `ToolbarItem(placement: .topBarLeading)` (or
`.topBarTrailing`) renders on iOS 26 as just its **first character followed by
an ellipsis**, e.g. "Cubby" → "C…", inside a small glass capsule/circle. This
happens even though the same title works fine as `.navigationTitle`, and even
though short symbols (`+`, `xmark`) in other toolbar slots render correctly.
`.navigationBarTitleDisplayMode(.inline)` is typically set to keep the bar
thin. The bug reads like a font or Dynamic Type problem but isn't — it
reproduces at default text sizes with any sufficiently wide title.

## Root cause

A leading/trailing toolbar item is a **compact bar-button placement** — sized
and Liquid-Glass-wrapped for an icon or a one-to-two-character label, not a
free-form title. `.navigationTitle` is laid out and scaled by the system
(it owns truncation/scaling behavior for the nav bar); a `ToolbarItem` slot is
not — it treats its content like a button label and clips it hard once it
overflows the capsule, degenerating to first-glyph-plus-ellipsis. Wide or
serif fonts overflow the slot faster, making this easy to trigger with a
branded/large title font specifically. The failure is placement-specific, not
font-specific: any title long enough to exceed the compact bar-button width
will do this.

## Fix

Don't put a screen title in a toolbar item at all. Render it as an in-content
header row at the top of the scrollable content instead, and keep
`.navigationBarTitleDisplayMode(.inline)` with an empty system title so the
nav bar stays thin. This also gives you a natural home for a trailing action
button on the same row as the title.

```swift
// WRONG — title text in a bar-button placement; iOS 26 clips to "C…"
// inside a glass capsule once the title is wider than a compact button.
.toolbar {
    ToolbarItem(placement: .topBarLeading) {
        Text("Cubby").font(.largeTitle.bold())
    }
}
```

```swift
// CORRECT — title rendered in content, not in a toolbar slot.
struct ScreenHeader<Trailing: View>: View {
    let title: String
    let trailing: Trailing

    init(title: String, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title.bold())
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            trailing   // e.g. a "+" quick-add button, same row as the title
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String) { self.init(title: title) { EmptyView() } }
}

// In the screen:
// .navigationBarTitleDisplayMode(.inline)   // keep the system title empty/thin
// ScrollView { ScreenHeader(title: "Cubby") { addButton }; ... }
```

Toolbar slots remain fine for genuinely short content — single glyphs, SF
Symbols, one- or two-character labels. The trap is specifically a *title*
(long text, custom/large font) placed in a *bar-button* placement.

## Evidence

- **cubby** — a branded serif "Cubby" title in `ToolbarItem(.topBarLeading)`
  rendered as "C…" in a glass circle on iOS 26; fixed by replacing it with an
  in-content `ScreenHeader` row and keeping `.navigationBarTitleDisplayMode(.inline)`
  for a thin, title-less system bar.

## Related skills

- `mainactor-runtime-isolation-trap` — unrelated failure class (runtime actor
  isolation crashes/re-entrancy), not a layout issue; don't confuse "compiles
  clean but misbehaves at runtime" framing across the two.

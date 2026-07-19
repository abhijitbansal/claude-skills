---
name: realityview-fullscreencover-black-defer-mount
description: A .virtual-camera RealityKit RealityView renders correctly inline (a sheet, a List row, embedded in another screen) but is a solid black feed with zero content the moment it's the root of a fullScreenCover — not navy, not empty-but-lit, fully black, as if nothing was ever added to the scene — and wrapping it in GeometryReader with concrete width/height (the fix everyone tries first) does not work. Use whenever building or debugging a RealityKit RealityView in a windowed iOS/iPadOS app (NOT visionOS) — a 3D companion view next to 2D UI, a scene mounted in a sheet or fullScreenCover, or any windowed .virtual-camera scene — even if the user says "3D view," "rack/bin/map viewer," "blank/black render," or "make this look like the 3D mockup" without saying "RealityKit" explicitly.
---

# RealityKit `fullScreenCover` Black Render — Defer the Mount, Not the Layout

Apple's RealityView/RealityKit docs and sample code are written against
visionOS assumptions (an immersive space, always-on stereo rendering, no
concept of a sheet or `fullScreenCover` racing a scene's first frame). Every
one of those assumptions silently breaks in a windowed iPhone/iPad app. This
skill (and its references) is the accumulated, sim-verified fix set from
building a rack/bin 3D viewer — treat the flagship bug below as the first
thing to check any time a windowed RealityView renders wrong in *some*
mounts but not others.

## Symptom

The identical `RackScene3DView` renders correctly inline (in a sheet, in a
`List` row, embedded in another screen) but is a **solid black feed with
zero content** the moment it's the root of a `fullScreenCover`. Not navy, not
empty-but-lit — fully black, as if nothing was ever added to the scene.

**The fix everyone tries first — wrapping in `GeometryReader` and handing the
`RealityView` concrete `width`/`height` — does not work.** It's a reasonable
hypothesis (ambiguous size at `make:` time) but it is **not the actual
cause**, and shipping it will cost you a full diagnostic-and-fix cycle before
you find out. Prove this to yourself with a sim screenshot before trusting
either fix: force the presentation you're debugging, screenshot it, and only
then change code — see the diagnostic protocol in
[references/architecture-decisions-and-diagnostics.md](references/architecture-decisions-and-diagnostics.md).

## Root cause

A `.virtual`-camera `RealityView` created as the root of a `fullScreenCover`
**while the cover is still animating its presentation** never establishes a
render surface. `make:` runs exactly once, on that bad frame, and nothing
after — including a later resize — recovers it. This is Apple's own bug
(FB22536529 / FB22537390 family, the non-AR `.virtual`-camera variant of a
publicly-reported "RealityView black as a modal root" issue:
developer.apple.com/forums/thread/786543), verified twice, independently, in
two different features. No published fix as of iOS 26; re-test on every new
iOS major before assuming it's still needed.

## Fix

**Defer mounting past the present animation, not past a layout pass.**

```swift
@State private var is3DReady = false

private enum Layout {
    /// Long enough to clear the fullScreenCover present animation so
    /// RealityKit has a live render surface at `make:` time.
    static let scene3DMountDelayMilliseconds = 500
}

var body: some View {
    GeometryReader { geometry in
        if is3DReady, geometry.size.width > 0, geometry.size.height > 0 {
            RackScene3DView(rack: rack, mode: .browse(onSelect: selectAndDismiss))
                .frame(width: geometry.size.width, height: geometry.size.height)
        } else {
            Color.black   // masks the mount delay; matches the eventual scene bg
        }
    }
    .task {
        guard !is3DReady else { return }
        try? await Task.sleep(for: .milliseconds(Layout.scene3DMountDelayMilliseconds))
        guard !Task.isCancelled else { return }   // see references — cancellation gotcha
        is3DReady = true
    }
}
```

The `GeometryReader`'s `width > 0`/`height > 0` guard is still worth keeping
(cheap, correct), but it is not what fixes the black feed — the `.task`
delay is. Leave inline mounts (sheet, List row) completely untouched; they
already render because they're never inside a still-presenting cover.

**Trade-off:** ~500ms of `Color.black` before the scene appears. Acceptable;
tune the constant if a slower device needs more headroom, but don't remove
the delay to "fix" the flash — that reintroduces the black feed.

## Also in this skill: other windowed-RealityView gotchas

This is one bug in a family of windowed-iOS RealityView gotchas mined from
the same feature build — all preserved in
[references/windowed-realityview-gotchas.md](references/windowed-realityview-gotchas.md),
**read it before implementing any windowed RealityView feature**, not just
when chasing the black-render bug:

- **`attachments:` is visionOS-only** — no SwiftUI compositing in windowed
  mode; render in-scene labels as text geometry instead.
- **No default camera gestures in windowed mode** — orbit/pinch must be
  opted into explicitly.
- **Scene must rebuild on data drift**, not just once in `make:` — a
  reference-type `SceneStore` diffed in `update:`.
- **Guard the mount-defer `.task` against cancellation** — this fix's own
  `.task` delay can resurrect the black-feed race under fast toggling if
  cancellation isn't checked explicitly.
- **Structural/chrome geometry needs its own rebuild container**, separate
  from per-item content, or it either gets wiped on every item rebuild or
  never rebuilt when its own input changes.
- **Camera framing is presentation-context-dependent**, not scene-dependent
  — inline vs. full-screen-portrait need different starting distances.
- **Verification settle time is longer than the mount delay** — a
  screenshot taken too soon after triggering the presentation can still land
  mid-transition and look blank even when the fix worked.

## Architecture decisions

Three product/architecture calls this project made when shipping a windowed
RealityView feature — full reasoning in
[references/architecture-decisions-and-diagnostics.md](references/architecture-decisions-and-diagnostics.md):
ship the unlit-material tier first and treat lit PBR as separately-risked
optional polish (an unlit scene cannot go dark/blank from a lighting
failure); keep the 2D view as the accessible source of truth with 3D as a
sighted-only enhancement backed by the same data-model/layout code; and when
shipping less than the chosen fidelity tier, say so explicitly rather than
silently reporting the lesser tier as the requested one.

## Evidence

Root cause verified twice, independently, in two different features, by
forcing each mount (inline card, sheet, `List` row, `fullScreenCover`) and
screenshotting it separately — the pattern ("only the `fullScreenCover`
fails") is what identifies the cause; reading the code alone reliably picks
the wrong hypothesis first (the `GeometryReader` sizing theory). Matches
Apple's own tracked bug family (FB22536529 / FB22537390) and a
publicly-reported forum thread (developer.apple.com/forums/thread/786543)
describing the same "RealityView black as a modal root" symptom.

## Related skills
- `subagent-buildverify-tool-grant-check` — if you're delegating this
  diagnostic/fix cycle to a subagent, confirm it actually has a shell before
  handing it a "screenshot and verify" acceptance test.
- `swiftui-tabbar-swipe-nav-tradeoff` — if this 3D view sits behind a custom
  tab bar / pager, that skill's pushed-scroll-clearance sibling is a
  related-but-separate SwiftUI layout gotcha in the same feature area.

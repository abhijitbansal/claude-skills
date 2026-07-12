---
name: realitykit-windowed-view-ios-gotchas
description: Building or debugging a RealityKit RealityView in a windowed iOS/iPadOS app (NOT visionOS) — a 3D companion view next to existing 2D UI, a scene mounted in a sheet or fullScreenCover, or any windowed .virtual-camera scene. Covers the fullScreenCover black-feed bug and its real fix, camera framing per presentation context, scene-rebuild-on-drift architecture, and the tiered-fidelity design decision (unlit-safe vs lit-PBR-risk) for shipping a 3D view that must not go blank. Use this whenever the user mentions RealityKit, RealityView, ARView, a 3D scene/rack/map/viewer on iPhone or iPad, a blank/black 3D render, or "make this look like the 3D mockup" for a non-visionOS target — even if they don't say "RealityKit" explicitly.
---

# RealityKit Windowed RealityView on iOS (Not visionOS)

Apple's RealityView/RealityKit docs and sample code are written against visionOS
assumptions (an immersive space, always-on stereo rendering, no concept of a
sheet or fullScreenCover racing a scene's first frame). Every one of those
assumptions silently breaks in a windowed iPhone/iPad app. This skill is the
accumulated, sim-verified fix set from building a rack/bin 3D viewer — treat it
as the starting checklist any time a RealityView needs to render correctly and
consistently on iOS, not just "usually."

## Gotcha 1 — `attachments:` is visionOS-only

`RealityView { content, attachments in }` with a SwiftUI `attachments:` closure
(compositing SwiftUI views into the 3D scene) is not available in the windowed
iOS presentation. For in-scene labels, render text as geometry instead:

```swift
let mesh = MeshResource.generateText(shortCode, extrusionDepth: 0.002,
                                      font: .systemFont(ofSize: 0.14, weight: .semibold))
let label = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: .white)])
// Billboard it every `update:` pass so it keeps facing the camera — see Gotcha 4.
```

## Gotcha 2 — no default camera gestures in windowed mode

Orbit/pinch is not free. Opt in explicitly:

```swift
RealityView { content in ... }
    .realityViewCameraControls(.orbit)   // otherwise the scene is frozen
```
If you need custom framing per mount (Gotcha 6) or your own pinch handling,
you may skip this and drive the camera transform yourself instead.

## Gotcha 3 — a `.virtual`-camera RealityView mounted inside a *still-presenting* `fullScreenCover` renders solid black

This is the big one, and the first fix most people reach for is wrong.

**Symptom:** the identical `RackScene3DView` renders correctly inline (in a
sheet, in a `List` row, embedded in another screen) but is a **solid black
feed with zero content** the moment it's the root of a `fullScreenCover`. Not
navy, not empty-but-lit — fully black, as if nothing was ever added to the
scene.

**The fix everyone tries first — wrapping in `GeometryReader` and handing the
`RealityView` concrete `width`/`height` — does not work.** It's a reasonable
hypothesis (ambiguous size at `make:` time) but it is **not the actual cause**,
and shipping it will cost you a full diagnostic-and-fix cycle before you find
out. Prove this to yourself with a sim screenshot before trusting either
fix: force the presentation you're debugging, screenshot it, and only then
change code — see the diagnostic protocol below.

**Root cause (verified twice, independently, in two different features):** a
`.virtual`-camera `RealityView` created as the root of a `fullScreenCover`
*while the cover is still animating its presentation* never establishes a
render surface. `make:` runs exactly once, on that bad frame, and nothing
after — including a later resize — recovers it. This is Apple's own bug
(FB22536529 / FB22537390 family, the non-AR `.virtual`-camera variant of a
publicly-reported "RealityView black as a modal root" issue:
developer.apple.com/forums/thread/786543). No published fix as of iOS 26;
re-test on every new iOS major before assuming it's still needed.

**The real fix: defer mounting past the present animation, not past a layout pass.**

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
        guard !Task.isCancelled else { return }   // see Gotcha 5
        is3DReady = true
    }
}
```

The `GeometryReader`'s `width > 0`/`height > 0` guard is still worth keeping
(cheap, correct), but it is not what fixes the black feed — the `.task` delay
is. Leave inline mounts (sheet, List row) completely untouched; they already
render because they're never inside a still-presenting cover.

**Trade-off:** ~500ms of `Color.black` before the scene appears. Acceptable;
tune the constant if a slower device needs more headroom, but don't remove the
delay to "fix" the flash — that reintroduces the black feed.

## Gotcha 4 — scene must rebuild on data drift, not just once in `make:`

Hold scene state in one reference-type `@State` object (a "SceneStore" /
"ObservableStore" pattern), and diff drift-relevant inputs in `update:`,
rebuilding only what changed:

```swift
@Observable
final class SceneStore {
    var rootEntity = Entity()      // bins — rebuilt by rebuildScene on drift
    var cameraEntity = Entity()
    var frameContainer = Entity()  // structural chrome — rebuilt separately, see Gotcha 7
    var builtBoxes: [BinBox] = []
    var builtHighlightID: UUID?
}

RealityView { content in
    content.add(store.cameraEntity)
    content.add(store.rootEntity)
    content.add(store.frameContainer)
    rebuildScene(...)      // first build
} update: { content in
    guard boxes != store.builtBoxes || highlightID != store.builtHighlightID else { return }
    rebuildScene(...)      // only on drift — `make:`-only assembly goes stale
                            // on any subsequent SwiftUI re-render
}
```

`make:`-only assembly is the second most common mistake after Gotcha 3: it
looks correct on first render and only breaks once something in the model
changes while the view stays mounted.

## Gotcha 5 — guard a mount-defer `.task` against cancellation

If Gotcha 3's fix is a `.task` that flips a readiness flag after a sleep, a
user can toggle away from the 3D view mid-sleep and cancel that task. `try?`
around `Task.sleep` **swallows** `CancellationError` — without an explicit
check, the flag flips `true` on a torn-down subtree anyway:

```swift
try? await Task.sleep(for: .milliseconds(Layout.scene3DMountDelayMilliseconds))
guard !Task.isCancelled else { return }   // NOT optional — see below
is3DReady = true
```

Without this guard: rapid toggle A→B→A skips the present-clearance delay on
the second entry into A (the flag was already `true` from the cancelled first
attempt), which can resurrect the exact black-feed race from Gotcha 3. This
bug is invisible in a slow manual test and only shows up under fast
programmatic or impatient-user toggling — write a test or a scripted
sim-toggle for it, don't rely on eyeballing.

## Gotcha 6 — structural/chrome geometry needs its own rebuild container, separate from per-item content

If the scene has both per-item entities (bins, rows — driven by a data
collection) *and* structural chrome that depends on a different input (a rack
frame, shelf planks, whose shape depends on grid dimensions, not on which
items exist), **do not add the chrome to the same root entity you clear and
rebuild for item changes.** It'll either get wiped on every item rebuild
(wasteful) or never rebuilt at all when its own input changes (stale frame
around a resized grid):

```swift
// SceneStore
var rootEntity = Entity()        // items — cleared/rebuilt by rebuildScene
var frameContainer = Entity()    // chrome — its OWN container, added to content once
var builtShelfCount = -1         // -1 forces the first rebuildFrame to run even for 0×0
var builtColumnCount = -1

// make: — add both containers once
content.add(store.rootEntity)
content.add(store.frameContainer)
rebuildFrame(shelfCount: layout.rows.count, columnCount: layout.rows.first?.count ?? 0)

// update: — each container rebuilds independently, on its own drift condition
if shelfCount != store.builtShelfCount || columnCount != store.builtColumnCount {
    rebuildFrame(shelfCount: shelfCount, columnCount: columnCount)   // chrome
}
// ...rebuildScene(...) for items, gated on its own diff (Gotcha 4)

private func rebuildFrame(shelfCount: Int, columnCount: Int) {
    store.frameContainer.children.removeAll()   // mutate the container in place —
    for frame in makeFrameEntities(shelfCount: shelfCount, columnCount: columnCount) {
        store.frameContainer.addChild(frame)    // no `content` handle needed post-mount
    }
    store.builtShelfCount = shelfCount
    store.builtColumnCount = columnCount
}
```

The tell that you need this split: chrome that's sized/shaped from
*configuration* (grid dimensions, layout mode) while items are sized/shaped
from a *collection* (which bins exist) will drift out of sync the moment
configuration changes while the view stays mounted — e.g. editing a rack's
shelf count while its inline 3D map is still on screen.

## Gotcha 7 — camera framing is presentation-context-dependent, not scene-dependent

The same scene needs a different default camera distance depending on where
it's mounted, because the *viewport aspect ratio* differs — an inline mount in
a card is roughly square-ish; a full-screen cover in portrait is tall and
narrow, and the same "distance that frames a wide rack nicely inline" clips
the outer edges in portrait full-screen.

Make the starting radius an init parameter with a per-mount default, not a
single shared constant:

```swift
enum ScanConstants {
    static let rack3DDefaultRadius: Float = 2.0        // inline framing
    static let rack3DFullScreenRadius: Float = 2.9      // dollied back for portrait
}

init(rack: Rack, mode: Mode, initialRadius: Float = ScanConstants.rack3DDefaultRadius) { ... }

// full-screen call site:
RackScene3DView(rack: rack, mode: .browse(...), initialRadius: ScanConstants.rack3DFullScreenRadius)
```
Pinch/orbit still re-dollies within existing min/max clamps from either
starting point — this only fixes the *first-frame* framing, which is what a
screenshot or a user's first glance actually judges.

## Gotcha 8 — verification settle time is longer than the mount delay

If Gotcha 3's fix adds a ~500ms mount defer, a screenshot taken at, say, 4
seconds after triggering the presentation can still land mid-transition and
look blank — not because the fix failed, but because the cover's own present
animation plus the mount defer plus first-frame render adds up to more than a
few seconds end-to-end on a simulator. Settle **≥6 seconds** before trusting a
"still blank" screenshot as a real failure; re-shoot before debugging further.

## Architecture decisions — building the *feature*, not just the view

These are product/architecture calls this project made and the reasoning
behind them — apply the same reasoning, not necessarily the same choice, to a
different app's constraints.

**Tiered fidelity: ship the unlit tier first; treat lit PBR as separately-risked, optional polish.**
A `UnlitMaterial`/emissive-only scene cannot go dark or blank from a lighting
problem — it has no lighting dependency to break. A scene built from
`PhysicallyBasedMaterial` + `DirectionalLight`/`PointLight` entities can
render solid black or fully dark if a light entity fails to attach, a shadow
setting misbehaves, or ambient/IBL isn't configured — and that failure mode is
much harder to diagnose than "the render is dim." When a fully-lit,
shadowed, particle-effects tier is the *stated* goal, still ship the unlit
structural tier as the safe baseline first (translucent materials, flat
color, no light entities at all can still look intentional and premium — see
`ScanConstants`-style hex-matched colors pulled from a design reference), and
gate the lit tier as an explicit, separately-tested follow-up. This is a
direct trade of "matches the mockup exactly" against "cannot regress to a
worse state than before the feature existed" — bias toward the latter for a
first ship.

**The 2D view stays the accessible source of truth; 3D is a sighted-only enhancement.**
If the feature has both a flat/2D representation and a 3D one, keep them
backed by the **same** data-model and layout-building code (one
`RackMapBuilder`/`RackMapLayout`-equivalent used by both renderers, so they
can never disagree about what exists or where it sits), mark the 3D scene's
container `.accessibilityHidden` where appropriate, and never let a
capability (tap-to-open, quick placement, drag) exist in 3D-only. Users with
VoiceOver, Reduce Motion, or devices where the 3D tier degrades should get a
fully-functional experience from the 2D view alone.

**Tier-honesty: when you ship less than the chosen tier, say so explicitly.**
If a user picks "Full fidelity" (lit PBR, shadows, particles) but the safe
unlit tier is what actually ships this round, that is a legitimate
engineering call given Gotcha above — but say so as an explicit
accept-vs-attempt decision ("delivered X of the 5 Full-tier items; Y/Z
deferred because <risk>") rather than silently reporting the lesser tier as
"Full re-skin done." Catching your own tier-downgrade before the user does is
cheaper than them catching it on device.

## Diagnostic protocol (don't skip this before picking a fix)

When a RealityView renders wrong in only *some* mounts:
1. List every mount (inline card, sheet, `List` row, `fullScreenCover`, etc.)
2. Force the feature on and screenshot **each** mount independently (a debug
   seed + forced `UserDefaults` flag + `xcrun simctl io <udid> screenshot` is
   usually the fastest harness).
3. Record exactly which mounts render and which don't — the pattern (e.g.
   "only the fullScreenCover fails") tells you the cause; guessing from the
   code alone before this step reliably picks the wrong hypothesis first
   (see Gotcha 3).
4. Only then change code, and re-screenshot the *specific* mount you fixed
   with ≥6s settle (Gotcha 8) before calling it done.

## Related skills
- `subagent-buildverify-tool-grant-check` — if you're delegating this
  diagnostic/fix cycle to a subagent, confirm it actually has a shell before
  handing it a "screenshot and verify" acceptance test.
- `swiftui-tabbar-swipe-nav-tradeoff` — if this 3D view sits behind a custom
  tab bar / pager, that skill's Part 3 (pushed-scroll clearance) is a
  related-but-separate SwiftUI layout gotcha in the same feature area.

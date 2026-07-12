# Windowed RealityView gotchas (iOS/iPadOS, not visionOS)

Read before implementing any windowed RealityView feature, not just when
chasing the flagship `fullScreenCover` black-render bug (see the parent
SKILL.md's Symptom/Root cause/Fix) — these are the other gotchas mined from
the same feature build.

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
If you need custom framing per mount (Gotcha 6 below) or your own pinch
handling, you may skip this and drive the camera transform yourself instead.

## Gotcha 4 — scene must rebuild on data drift, not just once in `make:`

Hold scene state in one reference-type `@State` object (a "SceneStore" /
"ObservableStore" pattern), and diff drift-relevant inputs in `update:`,
rebuilding only what changed:

```swift
@Observable
final class SceneStore {
    var rootEntity = Entity()      // bins — rebuilt by rebuildScene on drift
    var cameraEntity = Entity()
    var frameContainer = Entity()  // structural chrome — rebuilt separately, see Gotcha 6
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

`make:`-only assembly is the second most common mistake after the
`fullScreenCover` black-render bug: it looks correct on first render and only
breaks once something in the model changes while the view stays mounted.

## Gotcha 5 — guard a mount-defer `.task` against cancellation

If the flagship fix (parent SKILL.md) is a `.task` that flips a readiness
flag after a sleep, a user can toggle away from the 3D view mid-sleep and
cancel that task. `try?` around `Task.sleep` **swallows**
`CancellationError` — without an explicit check, the flag flips `true` on a
torn-down subtree anyway:

```swift
try? await Task.sleep(for: .milliseconds(Layout.scene3DMountDelayMilliseconds))
guard !Task.isCancelled else { return }   // NOT optional — see below
is3DReady = true
```

Without this guard: rapid toggle A→B→A skips the present-clearance delay on
the second entry into A (the flag was already `true` from the cancelled first
attempt), which can resurrect the exact black-feed race from the flagship
bug. This bug is invisible in a slow manual test and only shows up under fast
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

If the flagship fix (parent SKILL.md) adds a ~500ms mount defer, a screenshot
taken at, say, 4 seconds after triggering the presentation can still land
mid-transition and look blank — not because the fix failed, but because the
cover's own present animation plus the mount defer plus first-frame render
adds up to more than a few seconds end-to-end on a simulator. Settle **≥6
seconds** before trusting a "still blank" screenshot as a real failure;
re-shoot before debugging further.

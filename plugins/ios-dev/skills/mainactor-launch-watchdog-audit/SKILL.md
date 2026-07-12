---
name: mainactor-launch-watchdog-audit
description: App killed at launch with 0x8BADF00D (the ~10s scene-update watchdog SIGKILL), freezes on the first frame, or boot-loops after a crash because the failed launch work retries unconditionally every start. Happens in SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor projects where unannotated heavy work (ML embedding, Vision/OCR, floor-plan build, PDF render, photo preload) silently runs on main when invoked from App.init / .task / .onAppear. Sim-green does not clear it — it ships to TestFlight. Use when a device build dies at launch, hangs on first frame, or crash-loops, to audit entry points and offload the work.
---

# Launch-Watchdog Audit: Heavy Work Hidden on the Main Actor

## Symptom

- Device build is **killed at launch with `0x8BADF00D`** — the iOS watchdog
  SIGKILLs any app that blocks scene update for ~10s. Simulator has no
  watchdog, so a sim smoke build stays green while TestFlight crashes.
- App **freezes on the first frame** (same mechanism, under the 10s limit).
- **Boot-loop**: the killed work retries unconditionally on every launch, gets
  killed again, forever — unrecoverable without a reinstall (doc-scan's
  embedding backfill did exactly this).

## Root cause

`SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor` makes every unannotated service
implicitly `@MainActor`. Heavy work — ML embedding, floor-plan + quality-report
build, `renderer.pdfData` (N disk reads + JPEG decodes), photo preload — runs
synchronously on main when invoked from `App.init`, `.task`, or `.onAppear`,
stalls the first frame past the watchdog, and is SIGKILLed. If completion is
only recorded *after* the whole loop, a mid-loop kill persists zero progress
and the next launch redoes (and re-dies on) the same work: boot-loop.

## Fix

### 1. Audit the entry points

Walk the call graphs of `App.init`, every `.task`, and every `.onAppear`
reachable at launch. Grep for the usual heavy suspects:

```bash
grep -rnE 'VNImageRequestHandler|VNRecognizeTextRequest|MLModel|\.pdfData\(|Data\(contentsOf:|UIImage\(contentsOfFile:|jpegData\(|CGImageSourceCreate|embed|index\.upsert' Sources/
```

Anything found that is unannotated is implicitly `@MainActor` — it runs on
main no matter how "background" it looks.

### 2. Offload: nonisolated worker, Sendable results, one hop back

```swift
// BEFORE — implicitly @MainActor: the whole backfill runs on main from .task
struct EmbeddingBackfillService {
    func backfill(_ documents: [Document]) async throws { /* ML embed each… */ }
}

// AFTER — nonisolated worker returns Sendable DTOs / PersistentIdentifiers
nonisolated struct EmbeddingBackfillService {
    struct Output: Sendable {
        let id: PersistentIdentifier
        let vector: [Float]
    }
    func embed(_ inputs: [EmbeddingInput]) async throws -> [Output] {
        // Vision / MLModel / decode work — off main by construction
    }
}

// Call site: resolve inputs on main, detach the work, hop back ONCE
.task {
    let inputs = documents.map(\.embeddingInput)        // Sendable DTOs
    let outputs = await Task.detached(priority: .utility) {
        try? await EmbeddingBackfillService().embed(inputs)
    }.value
    if let outputs { apply(outputs) }                    // single @MainActor hop
}
```

For parallel units (e.g. cubby's report-photo preload — N disk reads + JPEG
decodes), use a `TaskGroup` of `nonisolated` work and collect `Sendable`
results before the one hop back:

```swift
let images: [DocumentID: SendableImageData] = await withTaskGroup { group in
    for ref in photoRefs {
        group.addTask(priority: .utility) { await Self.loadAndDecode(ref) }
    }
    return await group.reduce(into: [:]) { $0[$1.id] = $1 }
}
render(images)   // back on @MainActor once, with everything decoded
```

### 3. Make retried launch work idempotent

doc-scan's boot-loop: `index.upsert` progress was recorded **after** the loop,
so a watchdog kill mid-loop persisted nothing and every launch restarted from
zero. Record progress per unit, *before* the heavy step, so a crash still
advances state and a retried launch skips completed work:

```swift
// BOOT-LOOP: kill mid-loop → no progress persisted → identical next launch
for doc in pending {
    let vector = try await embed(doc)          // heavy — where the kill lands
    index.upsert(doc.id, vector)
}
store.markCompleted(pending.map(\.id))          // never reached

// FIX: per-unit, persisted before the heavy step
for doc in pending {
    store.recordAttempt(doc.id)                 // survives a SIGKILL
    let vector = try await embed(doc)
    index.upsert(doc.id, vector)
    store.markCompleted(doc.id)
}
// Launch path skips anything completed (or over an attempt cap).
```

### Verify

Cold-launch on a **physical device** (kill the app first). The simulator
cannot reproduce the watchdog; sim-green explicitly does not clear this class.

## Evidence

- **doc-scan** — `fix(ai): run embedding backfill off the main actor…`: names
  `0x8BADF00D`, the 10s scene-update watchdog, and the boot-loop from the
  index.upsert-after-loop non-idempotency. `EmbeddingBackfillService.swift`
  carries the verbatim `0x8BADF00D` comment.
- **floorprint** — `build floor plan + quality report off the main actor`,
  `prewarm furniture templates off-main`.
- **cubby** — `pre-load report photos off-main` (N disk reads + JPEG decodes
  on main inside `renderer.pdfData`).

## Related skills

- `swift6-mainactor-compile-fixes` — the compile-time face of the same
  default: marking pure-compute types `nonisolated` and cascading honestly,
  plus the Codable-specific synthesized-conformance micro-fix; distinct from
  this launch-path audit.
- `mainactor-runtime-isolation-trap` — the other runtime faces: `brk 1` on
  AsyncRenderer from MainActor-inheriting closures, and re-entrancy across
  `await`.
- `avfoundation-capture-delivery-watchdog` — a different watchdog: stalled
  capture delivery, not launch scene-update.
- `field-log-duration-clustering-race-diagnosis` — the field-log-clustering
  diagnostic technique this skill's timing hypotheses can be confirmed with
  when a device-only launch timing bug can't be reproduced locally.

# @Model Example: CloudKit-Valid Item/Photo Pair

Full worked example for rules 2 and 3 of `swiftdata-cloudkit-model-rules`.

## Rule 2 — @Model rules for a valid CloudKit mirror

```swift
@Model
final class Item {
    // Every stored property optional OR defaulted — CloudKit rejects
    // non-optional, non-defaulted attributes at container init.
    var name: String = ""
    var createdAt: Date = Date.now   // NOT `.now` — @Model requires the
    var notes: String?               // fully qualified `Date.now`

    // Never NSManagedObject-reserved names: `isDeleted` silently breaks
    // sync — use `isTrashed`.
    var isTrashed: Bool = false

    // inverse on exactly ONE side; declaring it on both sides crashes
    // the container at init.
    @Relationship(deleteRule: .cascade, inverse: \Photo.item)
    var photos: [Photo]? = []

    init() {}    // @Model suppresses the synthesized init — one is required
}

@Model
final class Photo {
    var item: Item?                      // no @Relationship(inverse:) here
    @Attribute(.externalStorage)
    var imageData: Data?                 // travels as CKAsset (rule 3)

    init() {}
}
```

## Rule 3 — externalStorage ↔ CKAsset bridge: idempotent, gated, batched

```swift
// If blobs also live as file sidecars, reconcile bidirectionally and
// idempotently — and only when sync is ON. (Sketch: `reconcile(_:)` is
// your app's per-photo reconcile step.)
func reconcileAssets(context: ModelContext, mode: CloudSyncMode) async throws {
    guard mode != .off else { return }              // gate on sync-ON
    let batchSize = 32
    let photos = try context.fetch(FetchDescriptor<Photo>())
    for (index, photo) in photos.enumerated() {
        try reconcile(photo)                        // safe to re-run
        if (index + 1).isMultiple(of: batchSize) {
            try context.save()                      // flush blobs per batch —
            await Task.yield()                      // else the first pass holds
        }                                           // the whole library resident
    }
    try context.save()
}
```

Coalesce re-entrant passes with a run guard — see
`mainactor-runtime-isolation-trap` for why `@MainActor` doesn't prevent
overlapping passes, and for the full `PhotoSyncRunGuard` implementation.

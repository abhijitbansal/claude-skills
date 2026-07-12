---
name: swiftdata-cloudkit-model-rules
description: SwiftData + CloudKit failures that compile clean and fail at runtime — ModelContainer crashes at init ("CloudKit integration requires that all attributes be optional or have a default value set", @Relationship(inverse:) declared on both sides), launch bricks behind a try!/fatalError when iCloud is signed out or unprovisioned, a local-only/in-memory/preview store silently starts syncing to iCloud (cloudKitDatabase defaults to .automatic the moment the entitlement exists; .automatic + isStoredInMemoryOnly is invalid), or records silently stop syncing (NSManagedObject-reserved names like isDeleted). Use when enabling CloudKit sync on a SwiftData app, writing @Model types that must mirror to CloudKit, configuring ModelConfiguration for local-only/preview/test stores, or bridging @Attribute(.externalStorage) blobs to CKAsset. Or CKShare sharing concurrent with SwiftData sync risks corruption (two mirroring engines, one store, unvalidated by Apple) — exactly one engine mirrors at a time.
---

# SwiftData + CloudKit: Model & Container Rules That Only Fail at Runtime

## Symptom

- `ModelContainer` **crashes at init** the moment CloudKit mirroring is
  enabled — non-optional/non-defaulted attributes, or `@Relationship(inverse:)`
  declared on both sides of a relationship.
- App **bricks at launch** when iCloud is signed out or unprovisioned, because
  the container build was wrapped in `try!` / `fatalError`.
- A store meant to be **local-only / in-memory / preview silently syncs to
  iCloud** — no error, data just appears in CloudKit — defeating opt-in privacy.
- Records **silently stop syncing** with no error (reserved property name).

None of these are compile errors. Simulator smoke builds pass.

## Root cause

`ModelConfiguration`'s `cloudKitDatabase` defaults to `.automatic`, which
begins syncing the moment the iCloud entitlement exists — and `.automatic` +
`isStoredInMemoryOnly` is an invalid combination. Separately, CloudKit's
mirroring schema is stricter than SwiftData's: it validates models only at
container init (crash) or during sync (silent non-sync). And when multiple
containers (production, in-memory tests, a coexisting
`NSPersistentCloudKitContainer`) open the same store with schemas assembled
inline, any drift between them corrupts data.

## Fix — four rule groups

### 1. Always pass `cloudKitDatabase` explicitly

```swift
// Local-only / preview / test stores: NEVER rely on the default.
let local = ModelConfiguration(
    schema: AppModelSchema.schema,
    isStoredInMemoryOnly: true,
    cloudKitDatabase: .none          // .automatic here is invalid AND leaks data
)

// Sync-enabled store: explicit private database, never .automatic.
let synced = ModelConfiguration(
    schema: AppModelSchema.schema,
    cloudKitDatabase: .private("iCloud.com.example.app")
)
```

Never `try!` the container build — it fails whenever iCloud is signed out or
unprovisioned. Build it through one throwing factory keyed off a
`Sendable` + `Equatable` `CloudSyncMode` enum, with a composition-root catch
that falls back to local-only, logs via OSLog, and surfaces a Settings
warning. Full idiom (including the relaunch prompt — the backing store is
fixed at launch): [references/container-factory.md](references/container-factory.md).

### 2. @Model rules for a valid CloudKit mirror

- Every stored property must be optional or have a default value — CloudKit
  rejects non-optional, non-defaulted attributes at container init.
- Default values must use the fully-qualified static member (`Date.now`, not
  `.now`) — @Model's macro expansion requires it.
- Never use an NSManagedObject-reserved property name (`isDeleted` is the
  common one) — pick an alternate name (e.g. `isTrashed`); a reserved name
  silently breaks sync with no error.
- Declare `@Relationship(inverse:)` on exactly ONE side of a relationship —
  declaring it on both sides crashes the container at init.
- @Model suppresses the synthesized init — always declare one explicitly.

**Read `references/model-rules-example.md` before implementing** — a full
`Item`/`Photo` model pair applying all five rules together, including the
`@Attribute(.externalStorage)` property that bridges to CKAsset (rule 3).

### 3. externalStorage ↔ CKAsset bridge: idempotent, gated, batched

Reconcile file-sidecar blobs bidirectionally and idempotently, and only when
sync is ON. Batch the save: flush every N photos and yield, rather than
holding the whole photo library resident in memory across one giant save.

**Read `references/model-rules-example.md` before implementing** — the
`reconcileAssets` batching loop (batch size, per-batch save, `Task.yield()`).

Coalesce re-entrant passes with a run guard — see
`mainactor-runtime-isolation-trap` for why `@MainActor` doesn't prevent
overlapping passes, and for the full `PhotoSyncRunGuard` implementation.

### 4. Centralize the schema in one `nonisolated` type

```swift
// ONE source of truth. Production container, in-memory test container,
// and any coexisting NSPersistentCloudKitContainer over the same store
// must agree exactly — schema drift corrupts data.
nonisolated enum AppModelSchema {
    static var models: [any PersistentModel.Type] {
        [Item.self, Photo.self, Tag.self /* …every @Model type… */]
    }
    static var schema: Schema { Schema(models) }    // build on demand
}
```

Resolve every `Schema`/`ModelContainer` from this type — never assemble the
model list inline at a call site.

### 5. CKShare sharing and native sync cannot mirror the same store concurrently

Adding record sharing (`CKShare`/`UICloudSharingController`) to an app that
already syncs via SwiftData's own `ModelConfiguration(cloudKitDatabase:)`
tempts a design where a second, separate `NSPersistentCloudKitContainer`
opens over the *same underlying store* purely to get `CKShare` support,
while SwiftData's own sync keeps running. This dual-mirror pattern — two
independent CloudKit mirroring engines both watching one store — is
explicitly **unvalidated by Apple** (DTS forum thread 770513): a real risk
for silent divergence/corruption, not just a performance concern.

Architect for **single-mirror handoff** instead: exactly one engine owns
CloudKit mirroring for the store at any time.

```swift
// Sharing OFF: SwiftData's own sync owns mirroring.
cloudKitDatabase: .private("iCloud.com.example.app")

// Sharing ON: hand mirroring entirely to NSPersistentCloudKitContainer;
// SwiftData's sync config steps aside.
cloudKitDatabase: .none
```

Spike-test the handoff transition itself before shipping — the mode switch,
not either mode alone, is the untested seam.

## Evidence

- **cubby** — `in-memory ModelConfiguration must pass cloudKitDatabase: .none`;
  `centralize 10-type SwiftData schema in CubbyModelSchema`;
  `coalesce re-entrant photo-sync passes via PhotoSyncRunGuard` and the
  surrounding photo-sync commit series (externalStorage↔CKAsset reconcile,
  per-batch save + `Task.yield()`).
- All four rule groups mined from cubby's CloudKit adoption; none produced a
  compile error — every one surfaced as a runtime container-init crash,
  bricked launch, or silent mis-sync.
- **Rule 5:** 0016 session-end checkpoint: "Research-driven correction to the
  S4 assumption: dual-mirror (SwiftData private sync + NSPCKC over one store)
  is unvalidated per Apple DTS (forums 770513) — plan switches to
  single-mirror architecture (sharing ON ⇒ NSPCKC owns all mirroring,
  SwiftData .none); H4 spike tests the engine handoff."

## Related skills

- `swiftdata-inmemory-test-harness` — in-memory test containers; they must use
  `cloudKitDatabase: .none` and resolve the same centralized schema (rule 4).
- `mainactor-runtime-isolation-trap` — run-guard pattern
  (`PhotoSyncRunGuard`) for coalescing re-entrant async passes (rule 3).
- `swift6-mainactor-compile-fixes` — why the schema type (and other pure-compute
  types) must be `nonisolated` under `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.

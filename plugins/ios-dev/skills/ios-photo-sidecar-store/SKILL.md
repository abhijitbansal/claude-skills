---
name: ios-photo-sidecar-store
description: Designing or debugging photo/attachment storage in an iOS app that keeps a database (SwiftData/Core Data/GRDB) — where to put image bytes, a photos-as-blobs vs files decision, thumbnails, soft-delete/trash for photos, photos + iCloud sync, a "cover photo" / primary-photo feature, or photos that vanish/strand after sync. Use whenever an app stores user-captured images alongside DB records.
---

# Photo sidecar store — the verified pattern

Battle-tested across two shipped apps (doc scanner, inventory app); every rule below
has a production incident behind it.

## Core architecture

1. **Photos and thumbnails are FILES, never DB blobs.** Application Support, keyed by
   a stable hash (CryptoKit) of the owning entity's UUID. The DB stores the reference,
   not the bytes.
2. **Atomic sidecar pairs.** Write photo + thumbnail together; if the thumbnail write
   fails, roll the photo back. Never leave a half-pair.
3. **Verify by content hash, never size equality.** A partial write matching size goes
   undetected; hash the written bytes back to confirm.
4. **Relative paths / stable IDs only.** Absolute URLs break when the container
   repoints (iCloud, app reinstall, device migration).
5. **Trash = move ALL sidecars together** into a `.Trash` directory so restore is
   lossless. Entity-level soft delete is a **flag on the record** (`isTrashed`), not a
   file move — files vs records are different lifecycles; don't conflate them.

## Sync bridge (CloudKit / externalStorage)

6. **Mirror sidecars to/from `@Attribute(.externalStorage)` fields** with an
   idempotent bridge, both directions, gated on sync-enabled. The resulting 2× photo
   bytes while sync is on is deliberate — the store copy IS the sync payload; it only
   exists while sync is on.
7. **Fresh UUID per capture — never reuse the parent entity's id as a photo ref.** A
   reused ref makes the sync bridge see "same ref, nothing changed", skip re-mirroring,
   and strand the old photo on both devices. (Real shipped bug — recurred a second
   time in a later feature; caught during plan review before it shipped again.)
8. **Cover-photo features: scalar-slot-swap, not an `isPrimary` flag.** Keep one
   scalar photo-ref slot as the single render source and SWAP which photo occupies it.
   No new synced field → no schema migration, no CloudKit Production deploy, and the
   whole isPrimary-desync bug class never exists.

## Concurrency

9. Off-main image loaders in a MainActor-default Swift 6 build: see the
   swift-concurrency rules — a plain `nonisolated async` loader runs on the CALLER's
   actor under SE-0461; it needs `@concurrent` to genuinely hop off-main.
   (Cross-reference — the concurrency rules own this; don't restate.)

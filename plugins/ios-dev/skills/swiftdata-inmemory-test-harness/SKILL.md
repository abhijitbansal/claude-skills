---
name: swiftdata-inmemory-test-harness
description: >-
  SwiftData unit tests crash the test runner ("Test runner crashed before
  establishing connection", "Thread 1: EXC_BREAKPOINT" / brk trap on the
  second test that touches the store), a store-reset step throws "Batch
  delete failed due to mandatory OTO nullify inverse on <relationship>", or
  store tests pass individually but fail/hang/race when the full suite runs
  together (`@Suite(.serialized)` on one suite doesn't help). Use when
  writing the first test that touches a SwiftData
  `ModelContext`/`ModelContainer` (Swift Testing or XCTest), when adding a
  second or third store-backed test suite, or when a "wipe between tests"
  helper needs to clear persisted parent↔child model pairs.
---

# SwiftData In-Memory Test Harness: Crashes, Batch-Delete Failures, and Cross-Suite Races

## Symptom

- The test runner itself crashes — not an assertion failure — with something
  like "Test runner crashed before establishing connection" or an
  `EXC_BREAKPOINT`/`brk` trap, and it happens intermittently, usually on the
  *second* test that touches a SwiftData store, never the first.
- A per-test reset step that calls `context.delete(model: T.self)` (batch
  delete) throws `"Batch delete failed due to mandatory OTO nullify inverse on
  …"` the moment a persisted parent↔child pair exists in the store.
- Store-backed tests are green in isolation but flaky, hang, or fail only when
  run as part of the full suite — and adding `@Suite(.serialized)` to the
  suite that's failing does not fix it.

## Root cause

- **Crash**: a `ModelContainer` created fresh per test tears down
  *asynchronously* — `-[NSSQLCore dealloc]` runs on a background queue. If the
  next test creates its own container and fetches on the main thread before
  the previous one finished deallocating, the two race and the process traps.
  This is a real race confirmed from the crash report, not a guess — it does
  not show up as a Swift Concurrency data-race diagnostic because it's at the
  Core Data/SQLite layer underneath SwiftData.
- **Batch delete failure**: `context.delete(model:)` is a batch operation that
  bypasses normal inverse-relationship maintenance. The moment a relationship
  has a required (non-optional) inverse — the common "one-to-one, must have a
  parent" shape — the batch delete can't satisfy the nullify and throws.
  Object-by-object `context.delete(object)` goes through the normal
  relationship-maintenance path and doesn't have this problem.
- **Cross-suite races**: `@Suite(.serialized)` only orders tests *within the
  suite it's attached to*. It does not know about other suites. Two separate
  store-touching suites, each individually `.serialized`, still run
  concurrently *relative to each other* and interleave at `await` points,
  racing the same shared container or colliding on leftover state.

## Fix

1. **One process-wide shared in-memory container**, never one per test — so
   nothing tears down mid-run and there's no dealloc race to hit.
2. **Reset state object-by-object** (fetch each model type, `context.delete`
   each instance — children before parents), never `context.delete(model:)`
   batch delete.
3. **Nest every store-touching suite under one shared `@Suite(.serialized)`
   parent type.** The trait applies recursively to descendants, so a single
   parent serializes *all* store suites against each other — not just tests
   within one suite. Suites that don't touch the store stay top-level and run
   in parallel as normal.

```swift
// 1. One shared container for the whole test run.
@MainActor
enum SharedTestStore {
    static let container: ModelContainer = {
        do {
            return try ModelContainer(
                for: Rack.self, Bin.self, Item.self, ItemPhoto.self, // … full schema
                configurations: ModelConfiguration(isStoredInMemoryOnly: true)
            )
        } catch {
            fatalError("in-memory container: \(error)")
        }
    }()
}

@MainActor
func makeInMemoryStore() throws -> (store: InventoryStore, context: ModelContext) {
    let ctx = SharedTestStore.container.mainContext
    try wipeAllModels(in: ctx)   // 2. object-by-object, children before parents
    try ctx.save()
    return (InventoryStore(ctx), ctx)
}

// WRONG: throws "mandatory OTO nullify inverse" once a parent↔child pair exists.
@MainActor private func wipeAllModelsBatch(in ctx: ModelContext) throws {
    try ctx.delete(model: Item.self)
}

// CORRECT: object-by-object, honors cascade/nullify, order-independent.
@MainActor private func wipeAllModels(in ctx: ModelContext) throws {
    func deleteEach<T: PersistentModel>(_ type: T.Type) throws {
        for object in try ctx.fetch(FetchDescriptor<T>()) { ctx.delete(object) }
    }
    try deleteEach(ItemPhoto.self)
    try deleteEach(Item.self)
    try deleteEach(Bin.self)
    try deleteEach(Rack.self)
}

// 3. One serialized parent; every store suite nests under it.
@MainActor @Suite(.serialized) enum StoreTestSuite {}

extension StoreTestSuite {
    @MainActor @Suite(.serialized) struct ItemFieldsTests {
        @Test func savingItemPersistsName() throws {
            let (store, _) = try makeInMemoryStore()
            // …
        }
    }
    @MainActor @Suite(.serialized) struct BinAssignmentTests { /* … */ }
}
```

## Evidence

- **cubby** — SwiftData test target: intermittent "test runner crashed before
  establishing connection" traced to per-test `ModelContainer` teardown racing
  the next test's fetch; store-reset helper hit "mandatory OTO nullify
  inverse" on `Item`↔`Bin` until switched to object-by-object delete; multiple
  store suites (`ItemFieldsTests`, `BinAssignmentTests`, …) each individually
  `@Suite(.serialized)` still interleaved until nested under one shared
  `StoreTestSuite` parent.

## Related skills

- `swiftdata-cloudkit-model-rules` — a **different** problem: CloudKit
  sync/schema failures that only surface at runtime (container-init crashes
  from non-optional attributes, `.automatic` + in-memory being invalid,
  silent mis-sync). That skill's in-memory test configs should still pass
  `cloudKitDatabase: .none` and resolve the same centralized schema type —
  but this skill is about the test *harness itself* (container lifecycle,
  batch-delete semantics, suite serialization), not CloudKit correctness.
  Don't merge the two.
- `mainactor-runtime-isolation-trap` — covers `@MainActor` isolation and
  re-entrancy traps in production async code; a different failure mode than
  the container-teardown race here, though both are races at `await` points.
- `swift6-mainactor-migration` — background on why store types and test
  helpers touching a `ModelContext` need explicit `@MainActor` under
  `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.

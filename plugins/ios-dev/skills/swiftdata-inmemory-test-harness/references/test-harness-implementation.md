# In-Memory Test Harness: Shared Container, Object-by-Object Reset, Serialized Suite Nesting

Full worked example for the fix in `swiftdata-inmemory-test-harness`: one
process-wide shared container, an object-by-object reset (never a batch
delete), and every store-touching suite nested under one shared
`@Suite(.serialized)` parent.

```swift
// 1. One shared container for the whole test run.
@MainActor
enum SharedTestStore {
    static let container: ModelContainer = {
        do {
            // The app's own centralized schema (`swiftdata-cloudkit-model-rules`,
            // rule 4), never a second hand-listed model set that can drift.
            // `cloudKitDatabase: .none` is required: the default `.automatic`
            // would try to bind CloudKit in a CloudKit-entitled test host (that
            // skill's rule 1: pass it explicitly on every store).
            let configuration = ModelConfiguration(
                schema: AppModelSchema.schema,
                isStoredInMemoryOnly: true,
                cloudKitDatabase: .none
            )
            return try ModelContainer(
                for: AppModelSchema.schema,
                configurations: configuration
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

// CORRECT: object-by-object, honors cascade/nullify; order still matters —
// delete children before parents (see the list below).
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

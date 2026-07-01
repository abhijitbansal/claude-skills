# Throwing ModelContainer Factory with Local-Only Fallback

The full idiom for rule 1 of `swiftdata-cloudkit-model-rules`: one throwing
factory keyed off a `CloudSyncMode` enum, a composition-root catch that falls
back to local-only instead of bricking launch, and a relaunch prompt because
the backing store is fixed at launch.

## Why a factory

- `try!` / `fatalError` on a CloudKit container build bricks launch whenever
  iCloud is signed out or the container is unprovisioned — a state you cannot
  control and will hit in review.
- Every store (production, preview, in-memory test) must pass
  `cloudKitDatabase` explicitly; funneling all container creation through one
  factory makes that impossible to forget.
- The sync choice must be `Sendable` + `Equatable` so it can cross actor
  boundaries and be compared in Settings UI and the composition root.

## CloudSyncMode

```swift
import SwiftData

/// The user's sync choice. Persisted as a raw value; read once at launch.
enum CloudSyncMode: String, Sendable, Equatable, CaseIterable {
    case off
    case privateDatabase

    func cloudKitDatabase(containerID: String) -> ModelConfiguration.CloudKitDatabase {
        switch self {
        case .off:             .none
        case .privateDatabase: .private(containerID)
        }
    }
}
```

## The throwing factory

```swift
import SwiftData

nonisolated enum ModelContainerFactory {
    static func make(
        mode: CloudSyncMode,
        containerID: String,
        inMemory: Bool = false
    ) throws -> ModelContainer {
        // .automatic + isStoredInMemoryOnly is invalid, and in-memory
        // stores must never sync — force .none regardless of mode.
        let database: ModelConfiguration.CloudKitDatabase =
            inMemory ? .none : mode.cloudKitDatabase(containerID: containerID)

        let configuration = ModelConfiguration(
            schema: AppModelSchema.schema,          // centralized — rule 4
            isStoredInMemoryOnly: inMemory,
            cloudKitDatabase: database
        )
        return try ModelContainer(
            for: AppModelSchema.schema,
            configurations: [configuration]
        )
    }
}
```

## Composition-root catch → local-only fallback

```swift
import OSLog
import SwiftData
import SwiftUI

@main
struct MyApp: App {
    private static let containerID = "iCloud.com.example.app"
    private static let log = Logger(subsystem: "com.example.app", category: "persistence")

    private let container: ModelContainer
    /// Non-nil when CloudKit was requested but unavailable; Settings shows
    /// a persistent warning row while this is set.
    private let cloudSyncFailure: Error?

    init() {
        let mode = CloudSyncMode(
            rawValue: UserDefaults.standard.string(forKey: "cloudSyncMode") ?? ""
        ) ?? .off

        do {
            container = try ModelContainerFactory.make(
                mode: mode, containerID: Self.containerID
            )
            cloudSyncFailure = nil
        } catch {
            // CloudKit container builds fail when iCloud is signed out or
            // unprovisioned. Fall back to local-only; never brick launch.
            Self.log.error("CloudKit container failed, falling back to local-only: \(error, privacy: .public)")
            do {
                container = try ModelContainerFactory.make(
                    mode: .off, containerID: Self.containerID
                )
                cloudSyncFailure = error
            } catch {
                // Local-only failing too means the store itself is
                // unreadable — a disk/migration failure, genuinely fatal.
                fatalError("Local ModelContainer failed: \(error)")
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView(cloudSyncFailure: cloudSyncFailure)
        }
        .modelContainer(container)
    }
}
```

## Relaunch prompt — the backing store is fixed at launch

You cannot swap a `ModelContainer`'s CloudKit configuration mid-session.
When the user flips the sync toggle in Settings:

```swift
struct CloudSyncToggle: View {
    @AppStorage("cloudSyncMode") private var storedMode = CloudSyncMode.off.rawValue
    let activeMode: CloudSyncMode   // the mode the container ACTUALLY launched with

    private var pendingMode: CloudSyncMode {
        CloudSyncMode(rawValue: storedMode) ?? .off
    }

    var body: some View {
        Toggle("iCloud Sync", isOn: Binding(
            get: { pendingMode == .privateDatabase },
            set: { storedMode = ($0 ? CloudSyncMode.privateDatabase : .off).rawValue }
        ))
        if pendingMode != activeMode {
            Label("Relaunch the app to apply this change.",
                  systemImage: "arrow.triangle.2.circlepath")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}
```

Write the preference, show the relaunch note, and keep running on the
container built at launch. Do NOT tear down and rebuild the container
mid-session — live `ModelContext`s and `@Query`s still reference the old one.

## Settings warning for the fallback path

When `cloudSyncFailure != nil` (CloudKit requested but launch fell back to
local-only), show a persistent, non-blocking warning row in Settings —
"iCloud sync is unavailable (sign in to iCloud), data is stored on this
device only" — rather than an alert at launch. The user's data is safe
locally; the reconcile pass (rule 3) catches CloudKit up after the next
successful sync-ON launch because it is idempotent and bidirectional.

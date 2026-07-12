---
name: scan-crash-recovery-store
description: A long capture (RoomPlan scan, multi-minute AR/photo session) is lost when post-processing hangs or the app crashes — the user relaunches to an empty state, or worse the app boot-loops re-running the same crashing build; the elapsed-time clock also jumps forward after a call/backgrounding interruption. Root cause is persisting only the final derived model (FloorPlanData/scene) instead of the raw processed result (CapturedRoom), with no crash marker and a wall-clock-derived timer. Use when building or debugging RoomPlan/ARKit/long-capture pipelines, scan recovery after crash, "scan lost after processing", boot-loop on relaunch after a scan crash, or ModelContainer-init crashes eating captures.
---

# Scan Crash-Recovery Store: Persist the Raw Result Before the Hang-Prone Build

## Symptom

- User finishes a multi-minute scan; the app hangs or crashes during the
  plan/scene build; on relaunch the capture is **gone** — minutes of walking a
  room wasted.
- Or the opposite failure: recovery exists but naïvely, so a crash during
  re-processing produces a **restart loop** (relaunch → load recovery file →
  same crash).
- Elapsed-time display jumps forward after a phone call / backgrounding
  interruption because the timer is derived from wall-clock start time.
- A corrupt store crashes `ModelContainer` init itself, before any app code
  can decide to take a safe path.

## Root cause

The pipeline persists only the *final* derived artifact (floor plan, scene,
SwiftData model). Everything between "RoomBuilder succeeded" and "model saved"
is a crash window that discards the raw result. Recovery files written
non-atomically or decoded against the wrong type (`CapturedStructure` vs
`CapturedRoom`) fail unreadable/partial reads; without clearing on
decode-mismatch, every relaunch retries the same failure.

## Fix

**1. Persist `CapturedRoom` JSON immediately after `RoomBuilder` succeeds —
BEFORE the hang-prone plan/scene build. Clear only after the final commit.**

```swift
let capturedRoom = try await roomBuilder.capturedRoom(from: roomData)
try ScanRecoveryStore.save(capturedRoom)            // ① raw result on disk FIRST
let plan = try await buildFloorPlan(capturedRoom)   // ② hang/crash-prone build
try persistToModelStore(plan)                       // ③ final commit
ScanRecoveryStore.clear()                           // ④ only now
```

**2. Harden the store: atomic writes, tolerate unreadable/partial files, and
clear on decode-mismatch so there is no restart loop.**

**Read `references/crash-marker-store.md` before implementing** — has the
full `ScanRecoveryStore` (atomic save/load/clear with decode-mismatch
recovery).

**3. Time-box the processing step with a graceful fallback.** The recovery
file is already on disk, so timing out is safe — show the raw capture or offer
a retry instead of hanging forever.

```swift
let plan = try await withThrowingTaskGroup(of: FloorPlanData.self) { group in
    group.addTask { try await buildFloorPlan(capturedRoom) }
    group.addTask {
        try await Task.sleep(for: .seconds(30))
        throw ScanProcessingTimeout()
    }
    guard let result = try await group.next() else { throw ScanProcessingTimeout() }
    group.cancelAll()
    return result
}
```

**4. Freeze the elapsed clock across interruptions.** Accumulate active time;
never compute `Date().timeIntervalSince(startedAt)` at render time. Pause the
accumulator on session interruption / whenever `scenePhase` leaves `.active`,
and resume it when active again — see `ScanClock` in
`references/crash-marker-store.md` for the full accumulate-on-pause struct.

**5. Async-signal-safe crash marker armed BEFORE `ModelContainer` init.** A
corrupt store can crash inside container init — before any Swift recovery
logic runs. POSIX-only calls (no Foundation, no allocation) so the marker is
also usable from a signal handler. Marker present at next launch ⇒ last launch
died during init ⇒ take the safe path (fresh/in-memory store, keep the
recovery file) instead of re-crashing.

**Read `references/crash-marker-store.md` before implementing** — has the
full `CrashSentinel` (arm/disarm/crashedLastLaunch) and the app-start call
sequence around `ModelContainer` init. The marker path there is a
placeholder — resolve it under the real Application Support directory, not
literally `/tmp`.

## Evidence

- **floorprint** — scan-recovery commit series: `ScanRecoveryStore.save` writes
  `CapturedRoom` JSON right after `RoomBuilder` succeeds and before the
  FloorPlanData/scene build; hardening against unreadable/partial files; clear
  on `CapturedStructure` vs `CapturedRoom` decode-mismatch; time-boxed
  processing; frozen elapsed clock across interruption.
- **cubby** — `CrashSentinel`: async-signal-safe crash marker written before
  `ModelContainer` init.

## Related skills

- `avfoundation-capture-delivery-watchdog` — detecting stalled/interrupted capture sessions during the scan itself.
- `swift6-mainactor-compile-fixes` — run the hang-prone plan/scene build off the main actor, and make the Codable recovery DTOs decodable off-main under MainActor-default isolation.
- `swiftdata-inmemory-test-harness` — exercising the safe-mode/recovery path without touching the real ModelContainer.
- `devicectl-crashlog-oslog-cli-diagnostics` — the device-only crash-log
  retrieval and bounded-depth error-unwrap pattern this recovery store's
  diagnostic surface is a natural home for.

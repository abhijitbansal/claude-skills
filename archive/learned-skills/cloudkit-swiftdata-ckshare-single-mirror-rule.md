# SwiftData CloudKit sync and NSPersistentCloudKitContainer CKShare mirroring cannot safely run concurrently over the same store — pick one mirror at a time

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0016-2026-07-07-homes-sharing-ai-plans); adversarially verified.

## Problem
A natural design for adding record sharing (CKShare) to an app that already syncs via SwiftData's native `ModelConfiguration(cloudKitDatabase:)` is to add a second, separate `NSPersistentCloudKitContainer` over the *same underlying store* purely to get `CKShare`/`UICloudSharingController` support, while leaving SwiftData's own sync running. Research (Apple DTS forum thread 770513) found this dual-mirror pattern — two independent CloudKit mirroring engines both watching one store — is explicitly unvalidated by Apple, a real risk for silent divergence/corruption, not just a performance concern.

## Solution
Architect for single-mirror handoff instead: exactly one engine owns CloudKit mirroring for the store at any time. When whole-record/whole-entity sharing is enabled, hand mirroring entirely to `NSPersistentCloudKitContainer` (SwiftData's own sync config passes `cloudKitDatabase: .none` while sharing is active); when sharing is off, SwiftData's native sync resumes sole ownership. Spike-test the handoff transition itself before shipping, since the mode switch — not either mode alone — is the untested seam.

## Evidence
0016 session-end checkpoint: "Research-driven correction to the S4 assumption: dual-mirror (SwiftData private sync + NSPCKC over one store) is unvalidated per Apple DTS (forums 770513) — plan switches to single-mirror architecture (sharing ON ⇒ NSPCKC owns all mirroring, SwiftData .none); H4 spike tests the engine handoff."

## When to Use
Any app on the modern Apple stack (SwiftData or Core Data) that wants to combine automatic private-database sync with CKShare-based record sharing will independently discover the 'just layer on a second container' approach and needs to know upfront it's an unvalidated combination — this saves a wasted implementation-then-device-corruption cycle. The single-mirror-ownership rule (exactly one CloudKit mirroring engine per store, switched not stacked) generalizes beyond this app's specific Home/Rack model.

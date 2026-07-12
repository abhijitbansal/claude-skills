# CoreNFC overwrite-guard pre-read must stay inline in-session — the NFCTag can't survive a @concurrent hop

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0015-2026-07-06-v0.2.2-fix-wave); adversarially verified.

## Problem
Implementing a 'read-before-write' guard for NFC tag writing (detect if a tag is already occupied before overwriting it) is naturally reached for as a separate async helper function that the write flow calls. But CoreNFC's tag object is non-Sendable and tied to the live `NFCReaderSession`; handing it to a `@concurrent`-annotated helper (the standard SE-0461 idiom for genuinely hopping off-main) is illegal/unsafe because the tag reference cannot cross that isolation boundary and doesn't outlive the session that vended it.

## Solution
Perform the pre-read inline in the same NFC session that will do the write — call `readNDEF` directly in the write delegate callback rather than factoring it into a reusable off-main helper — so the tag object never needs to cross an isolation boundary. Only extract the read-then-decide *logic* (classifying free/same-destination/occupied) into a pure, testable helper; the NFC I/O itself stays un-factored.

## Evidence
0015 checkpoint '2026-07-07 20:20', ISSUE-07: "NFC write overwrite guard — in-session pre-read (readNDEF inline; @concurrent + non-Sendable tag forbids a helper hop), new NFCTagError.tagOccupied, pure TagOverwriteClassifier (free/same-destination/occupied + occupant naming + warning copy)…"

## When to Use
Generalizes to any hardware-session API whose live handle is non-Sendable and session-scoped (CoreNFC, some AVFoundation delegate objects, CoreBluetooth peripherals mid-transaction): the instinct to extract I/O into a `@concurrent` helper for testability or reuse is wrong when the framework object itself can't leave the calling context. This is a distinct, sharper case than the general Swift 6 concurrency playbook's rows (which cover isolation of *constants/config*, not *live non-Sendable session handles that must stay inline*).

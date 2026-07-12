---
name: nonsendable-hardware-handle-inline-io
description: Factoring a hardware-session read (e.g. an NFC overwrite-guard pre-read via readNDEF, or any CoreBluetooth/AVFoundation delegate I/O) into a reusable @concurrent or off-main helper function is illegal or unsafe because the framework's tag/peripheral handle is non-Sendable and cannot outlive or cross out of the live session that vended it — do the I/O inline in the delegate callback instead. Use when writing a read-before-write guard, retry logic, or any reusable-looking I/O step against CoreNFC's NFCTag, a CoreBluetooth CBPeripheral mid-transaction, or an AVFoundation delegate object tied to a live capture/reader session.
---

# Non-Sendable hardware session handles must do I/O inline, not via a @concurrent helper

## Symptom

Implementing a "read-before-write" guard — e.g. detect whether an NFC tag is
already occupied before overwriting it — is naturally reached for as a
separate async helper function that the write flow calls out to. Passing the
hardware handle (an `NFCTag`, a `CBPeripheral` mid-transaction, some
AVFoundation delegate object) into a `@concurrent`-annotated helper — the
standard SE-0461 idiom for genuinely hopping off-main — either fails to
compile (`Sendable`/isolation error) or is unsafe even if forced through with
`@unchecked Sendable`.

## Root cause

CoreNFC's tag object (and equivalents like a `CBPeripheral` mid-transaction)
is **non-Sendable and session-scoped**: it is only valid for the lifetime of
the live `NFCReaderSession` that vended it, and it legally cannot cross an
isolation boundary into a `@concurrent` context. This isn't a missing
annotation you can fix by marking the type `Sendable` — the object's validity
is tied to the session itself, so handing it to a helper that runs on a
different execution context is unsafe regardless of concurrency-checking
mode. The instinct to extract I/O into a reusable, testable, off-main helper
— which is *correct* for pure constants/config (see
`swift6-mainactor-compile-fixes`) — is wrong here because the framework object
itself cannot leave the calling context, not because of an isolation
annotation gap.

## Fix

Perform the pre-read inline, in the same NFC session that will do the write:
call `readNDEF` directly inside the write delegate callback, rather than
factoring it into a separate reusable off-main helper. The tag object then
never needs to cross an isolation boundary at all.

Only extract the read-then-decide **logic** — classifying the read result as
free / same-destination / occupied, naming the occupant, producing warning
copy — into a pure, `Sendable`, testable helper (e.g. a
`TagOverwriteClassifier`). That classifier takes plain data in (decoded NDEF
payload) and returns a plain enum out; it never touches the `NFCTag` itself.
The split is: **I/O stays un-factored and inline; only pure computation gets
extracted.**

```swift
// Inside the write session's delegate callback — NOT a separate @concurrent helper.
func readerSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    let tag = tags.first!
    session.connect(to: tag) { error in
        // readNDEF happens inline, in this session, on this tag.
        tag.readNDEF { message, error in
            // Pure, Sendable, unit-testable — no NFCTag crosses this boundary.
            let verdict = TagOverwriteClassifier.classify(message)
            switch verdict {
            case .free:
                self.writePayload(to: tag, session: session)
            case .occupied(let occupantName):
                session.invalidate(errorMessage: "Tag occupied by \(occupantName)")
            case .sameDestination:
                self.writePayload(to: tag, session: session) // idempotent overwrite
            }
        }
    }
}
```

Generalizes to any hardware-session API whose live handle is non-Sendable and
session-scoped: CoreNFC (`NFCTag`), some AVFoundation delegate objects, and
CoreBluetooth peripherals mid-transaction. In all of these, do the I/O where
the handle already lives; extract only the decision logic around it.

## Evidence

Mined from Cubby iOS session logs (checkpoint 0015, 2026-07-06,
v0.2.2-fix-wave), checkpoint entry '2026-07-07 20:20', ISSUE-07:

> "NFC write overwrite guard — in-session pre-read (readNDEF inline;
> @concurrent + non-Sendable tag forbids a helper hop), new
> NFCTagError.tagOccupied, pure TagOverwriteClassifier (free/same-destination/
> occupied + occupant naming + warning copy)…"

Adversarially verified during mining.

## Related skills

- `swift6-mainactor-compile-fixes` — covers isolation of constants/config/pure
  compute under `SWIFT_DEFAULT_ACTOR_ISOLATION: MainActor`; this skill is the
  distinct case of a framework object that can't leave its session at all.
- `avfoundation-capture-delivery-watchdog` — another AVFoundation
  session-lifetime hazard.

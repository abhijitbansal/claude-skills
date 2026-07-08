---
name: file-handoff-inbox-backstop
description: App boot-loops after receiving a share — every cold launch is jetsam-killed mid-import (a 24MP EXIF-rotated image decodes to a ~880MB bitmap), and widget-timeline launches keep re-triggering the same crash; or shared items import twice / silently vanish because the host drained a half-written batch. Use when a share/action extension hands files to its host app through an App Group inbox — the drain needs a manifest ready-marker, a per-batch attempt cap persisted BEFORE heavy work, quarantine for poison batches, a launch re-entrancy guard, and an injectable inbox root for tests/CI.
---

# Share-Extension Inbox: Backstop the Drain Against Poison Batches

## Symptom

- App crashes on launch, **every** launch, after a user shares a large item.
  doc-scan's case: a 24MP EXIF-rotated shared image decoded to a ~880MB bitmap
  → jetsam during the inbox drain → drain died before clearing the batch →
  cold-launch boot-loop. Widget timeline launches re-triggered it too.
- Shared items imported twice (drain ran concurrently) or never appeared
  (host drained a batch the extension was still writing).

## Root cause

The naive inbox — extension writes files into the App Group container, host
imports-then-deletes on launch — has no failure story. A crash *during* import
leaves the batch in place, so the very work that crashed runs again on the next
launch, unconditionally. And launch has multiple triggers (`onAppear`,
`scenePhase .active`, widget timeline reloads), so drains overlap.

## Fix

**Layout** — batch dir per share; `manifest.json` written LAST is the ready marker:

```
<AppGroup>/ShareInbox/<batchID>/item-0.jpg … manifest.json
<AppGroup>/ShareInboxFailed/          # quarantined poison batches
```

**Read `references/inbox-drain.md` before implementing** — has the full
extension-side manifest writer, the host-side drain loop (attempt cap +
quarantine + re-entrancy guard), and the injectable `ShareInbox` root
wrapper. Rules that live only in that code and matter before you open it:

- The manifest's `files` list stores paths **relative to the batch dir**,
  never absolute URLs.
- `onAppear` AND `scenePhase == .active` both fire on cold launch — the
  drain loop must **guard** re-entrancy, not try to dedupe its callers.
- `importBatch`'s heavy decode work happens **off-main**, inside the guarded
  drain loop.
- A caught import error **leaves the batch in place** — the already-burned
  attempt count is the backstop, not a retry-immediately.
- `ShareInbox.appGroup(id:)` returns `nil` **silently** when the App Group
  entitlement is missing on that specific target — check the entitlement
  per target, not once app-wide.

**Image normalization** — the actual jetsam trigger. `UIGraphicsImageRenderer`
defaults to device scale, so a 24MP image renders at 3× pixels:

```swift
let format = UIGraphicsImageRendererFormat()
format.scale = 1   // NOT device scale — 24MP @3x ≈ 880 MB bitmap → jetsam
let out = UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
    image.draw(in: CGRect(origin: .zero, size: targetSize))  // also bakes in EXIF rotation
}
```

## Invariants

1. Manifest written last; no manifest ⇒ batch does not exist to the drain.
2. Attempt counter hits disk **before** decode work — a crash burns an attempt.
3. After `maxDrainAttempts` (3): quarantine to `ShareInboxFailed/`, never delete.
4. One drain at a time; every launch path (view appear, scene activation,
   widget-triggered launch) funnels through the same guarded entry point.
5. Renderer `scale = 1` when normalizing shared images.
6. Inbox root is injected, never read from the entitlement inside the logic.

## Evidence

- doc-scan (Paperix, 5 targets incl. share extension + `ShareExtensionInbox`
  helper): `stop launch boot-loop on large rotated shared images`,
  `cap drain attempts and quarantine poison batches`.

## Related skills

- `widget-appgroup-snapshot-bridge` — the read-only sibling over the same App
  Group; its timeline reloads are one of the launch paths that re-trigger drains.
- `deep-link-resolver-applock-pathtraversal` — hardening the other cold-launch
  entry point (URLs) with the same one-guarded-funnel discipline.
- `mainactor-launch-watchdog-audit` — the general launch rule this instantiates:
  record progress before the loop body, and keep heavy launch work off-main.
- `swiftdata-inmemory-test-harness` — same injectable-root discipline applied to
  the persistence layer.
- `swift6-mainactor-compile-fixes` — if moving `importBatch` decode work off-main
  trips "main actor-isolated X" errors.

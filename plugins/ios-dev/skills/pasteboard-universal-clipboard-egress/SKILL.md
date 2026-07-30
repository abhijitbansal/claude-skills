---
name: pasteboard-universal-clipboard-egress
description: A privacy-first iOS app copies diagnostics, logs, prompts, tokens or user content to UIPasteboard with a plain `UIPasteboard.general.string = value`, which silently syncs to every other Apple device on the account via Universal Clipboard and persists indefinitely — data leaves the device through a path the privacy policy never mentions. Use when adding any copy-to-clipboard affordance in an app that claims on-device-only processing, when auditing what leaves the device, or when reviewing a Copy button on a diagnostics, activity-log, debug or export screen.
---

# Clipboard Writes Leave the Device — Scope Them

## Symptom

An app whose whole promise is "nothing leaves your device" ships a **Copy**
button on a diagnostics or activity-log screen:

```swift
UIPasteboard.general.string = diagnosticDump   // looks local. isn't.
```

`UIPasteboard.general` participates in **Universal Clipboard**. With Handoff on
— the default — the payload is relayed to the user's other Apple devices over
iCloud. It also persists in the pasteboard indefinitely, readable by any app the
user foregrounds afterwards.

For an app that declares on-device-only processing, this is a real egress path
that no privacy label mentions, usually carrying exactly the sensitive content
(prompts, model responses, file paths, error strings) that the diagnostics
screen exists to collect.

## The fix

`setItems(_:options:)` takes the two options that matter:

```swift
UIPasteboard.general.setItems(
    [[UTType.utf8PlainText.identifier: diagnosticDump]],
    options: [
        .localOnly: true,                                  // no Universal Clipboard relay
        .expirationDate: Date().addingTimeInterval(120),   // auto-clear
    ]
)
```

- **`.localOnly`** keeps the payload on this device. This is the load-bearing one.
- **`.expirationDate`** bounds how long any other app can read it. Pick a window
  matching the intended use — a couple of minutes is plenty for "copy, switch to
  Mail, paste".

Apply this to *every* clipboard write of app-derived data, not only the
obviously-sensitive screen. The audit is "what does this app put on the
pasteboard", not "which button looks scary".

## Where the line actually falls: copy vs. share

**Do not** apply this reflexively to `ShareLink` / `UIActivityViewController`.
They are different in kind:

| Path | User intent | Treatment |
|---|---|---|
| `UIPasteboard.general.string = …` | Implicit — user tapped "Copy", not "send this to iCloud" | Must be `.localOnly` + expiry |
| `ShareLink` / share sheet | **Explicit** — the user picks the destination in a system UI | Legitimate as-is |

A share sheet *is* an egress path, but it is one the user consciously chose and
directed. Rewriting it as a local-only copy would break the feature.

This distinction matters because auditors who miss it half-fix the screen:
they harden the Copy button and leave an adjacent `ShareLink` exporting the
identical payload, or they rip out a working share feature. Decide per
affordance, and say which is which in the review.

## Testing it

`UIPasteboard` is awkward in tests and mutating the real one in CI is rude.
Put a narrow seam in front of it:

```swift
protocol PasteboardWriting {
    func write(_ string: String, localOnly: Bool, expiresAfter: TimeInterval?)
}
```

Then assert the call was made **with `localOnly: true`** — not merely that a
copy happened. A test asserting "copy was called" passes against the unsafe
version, which makes it worse than no test.

## Checklist

- [ ] Every `UIPasteboard` write in the app uses `setItems(_:options:)`
- [ ] `.localOnly: true` on all of them
- [ ] `.expirationDate` set to a bounded, intentional window
- [ ] Share-sheet paths deliberately left alone, and that decision is stated
- [ ] A test seam asserts the **options**, not just that a copy occurred
- [ ] If the app claims on-device-only, confirm the privacy documentation matches what the clipboard path actually does

## Evidence

Cubby iOS, session 0068 (2026-07-26), branch-wide review finding #8,
`AIActivityLogView.swift:49`: "'Copy log' puts raw prompts/notes on
`UIPasteboard.general` with no `.localOnly` → Universal Clipboard egress."

The screen was an AI-activity log, so the copied payload was prompts and item
notes — precisely the content the app's on-device-only promise covers. Nothing
about the call site looked wrong; the defect is that the default `UIPasteboard`
write *is* the egress.

Shipped fix: "pasteboard copy scoped `.localOnly` + 120s expiry behind a
`PasteboardWriting` seam." The seam is there because the assertion that matters
is **which options were passed**, not that a copy happened — a test asserting
only the latter passes against the unsafe version.

## Related skills

- `diagnostic-export-error-redaction-boundary` — the other half of the same
  screen. That one governs *what* enters an exportable buffer (reduce errors to
  domain + code); this one governs *where* the buffer goes. A diagnostics screen
  usually needs both, and hardening one alone still leaves the privacy promise
  broken.
- `widget-appgroup-snapshot-bridge` — a third egress surface on the same app: an
  App-Group snapshot DTO, with its own redaction flags and its own App-Lock
  rule.
- `biometric-applock` — the adjacent question on any privacy-first app: what is
  readable while the app is locked or backgrounded. A pasteboard payload
  outlives the lock.

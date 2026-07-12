---
name: diagnostic-export-error-redaction-boundary
description: A "share diagnostics" or "copy error details" feature that promises "no personal content" feeds raw String(describing: error) (or error.localizedDescription) from an ML/Vision/OCR/file-I/O error sink straight into the exportable buffer — an NSError from a model-load failure can embed the absolute on-device container path, and a FoundationModels/OCR-adjacent error can embed OCR'd text from the user's own photo, both leaking into a file the user believes is anonymized. Use when building or reviewing any diagnostic-log export, crash-report share sheet, or "copy error" button that touches ML/Vision/OCR/file-path-bearing errors — the leak is invisible from any single call site in isolation and only shows up by tracing what actually reaches the shareable buffer.
---

# Diagnostic Export Error Redaction Boundary

## Symptom

A shareable diagnostic-log feature explicitly promises "no personal content,"
but one or more error sinks (model load, generation, refiner failure, OCR)
feed raw `String(describing: error)` directly into the exportable buffer. In
practice:

- An `NSError` from a model-load failure can embed the **absolute on-device
  container path**.
- A FoundationModels/OCR-adjacent error can embed **OCR'd text from the
  user's own item photo**.

Both leak into a file the user might share for support, silently violating
the feature's own privacy promise. This is not visible from reading any
single call site in isolation — only from tracing what actually ends up in
the shareable buffer, which is why it's typically caught by a security review
rather than by design.

## Root cause

`String(describing:)` and `error.localizedDescription` are **not** redaction
boundaries — they serialize whatever the underlying error type chose to put
in its description, which for ML/Vision/OCR/file-I/O errors routinely
includes absolute paths and user content by design (that's exactly the
information a *developer* debugging the error wants). A diagnostic-export
feature that treats "caught the error" and "safe to show the user" as the
same step inherits every future error type's verbosity as a privacy
liability, with no compile-time or review-time signal that a new sink was
added.

## Fix

At every sink that feeds a user-facing/shareable export (diagnostic logs,
crash reporters users can send, "copy error" buttons), apply a redaction
boundary that reduces any caught `Error`/`NSError` to its **structural
identity only** — domain + code — never its localized description or
`String(describing:)`:

```swift
enum DiagnosticErrorRedactor {
    /// Reduces any error to domain + code only. Never surfaces
    /// localizedDescription or String(describing:) — both can embed
    /// absolute paths (model-load NSErrors) or user content (OCR'd text
    /// in FoundationModels-adjacent errors).
    static func safeLabel(_ error: Error) -> String {
        let nsError = error as NSError
        return "\(nsError.domain) #\(nsError.code)"
    }
}

// At each shareable-export sink:
diagnosticBuffer.append(DiagnosticErrorRedactor.safeLabel(modelLoadError))
```

Keep the raw, unredacted error in **developer-only** surfaces (OSLog
`.private`/system logs) where the threat model is different (system log
access, not casual user sharing) — that's a separate, still-open surface to
redact only if the threat model extends to sysdiagnose export.

Apply this at **every** sink feeding the shareable buffer, not just the one
that prompted the review — a redaction helper added at one call site and
missed at three others leaves the same promise broken for whichever pipeline
wasn't audited.

## Evidence

Session 0022: "#1 privacy (CONFIRMED) — the shareable DiagnosticLog (promises
'no personal content') received raw `String(describing: error)` from the
AI-naming sink; a load/generation `NSError` can carry the model's absolute
container path, a FoundationModels error can carry OCR'd label text. New
`DiagnosticErrorRedactor.safeLabel` -> domain #code only, applied at the 4
sink sites."

## Related skills

- `widget-appgroup-snapshot-bridge` — a different redaction boundary (App-Group
  snapshot DTO flags) on the same app; compare when a feature needs more than
  one kind of redaction gate.

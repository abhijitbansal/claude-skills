---
name: vision-barcode-cidetector-fallback
description: >-
  `VNDetectBarcodesRequest` returns zero results for a perfectly valid,
  freshly generated QR/barcode — decode returns `nil`, not a thrown error —
  and OSLog shows "Could not create inference context" or similar Vision ML
  context failures. Reproduces reliably on the iOS Simulator (Vision's
  barcode ML context often can't initialize there) and can also happen on
  device when the ML context is unavailable or the image is low-contrast,
  silently dropping scannable codes. Use when a Vision-based barcode/QR
  decode test fails on the Simulator while the QR generator clearly works,
  when you're writing barcode-decode tests that must run in CI, or when you
  want scan robustness (competitors get dinged for "won't scan") instead of
  a single point of failure.
---

# Vision Barcode Decode Fails on Simulator → CIDetector Fallback

## Symptom

- `VNDetectBarcodesRequest` returns an empty results array for a QR/barcode
  in a `CGImage` that was just generated in the same test and is visibly
  valid. The decoder returns `nil` — it does not throw, so this looks like
  "no code found," not a crash.
- OSLog/console shows something like `QR Vision detect failed: Could not
  create inference context` — Vision's barcode ML inference context failed
  to initialize.
- Reproduces reliably on the **iOS Simulator**; the same failure mode can
  also surface on a real device under memory pressure, low contrast, or
  whenever the ML context is unavailable, silently dropping a code a human
  eye can read fine.
- Any unit/UI test that generates a code then round-trips it through Vision
  decode fails on CI (which runs on Simulator) even though the feature works
  when a person tests it by hand on a phone.

## Root cause

Vision's barcode detector depends on an ML inference context that the
Simulator's software rendering path frequently fails to construct. This is
an environment limitation, not a bug in the input image or in your request
configuration — retrying the same `VNDetectBarcodesRequest` won't help.
Treating a single detector as the whole decode pipeline means this one
initialization failure (Simulator-only, or device-under-pressure) silently
turns into "this app can't scan codes."

## Fix

Don't rely on a single detector. Try Vision first — it's fast and accurate
on real hardware — then fall back to CoreImage's `CIDetector` QR reader,
which initializes reliably on the Simulator and tolerates low-contrast
images better in practice. This is a pure upside: Vision still runs first
and wins on device; `CIDetector` only fires when Vision comes back empty.

```swift
// WRONG — single detector, silently drops codes when Vision's ML
// context fails to initialize (Simulator, low contrast, memory pressure)
func decode(_ image: CGImage) -> URL? {
    decodeWithVision(image)
}
```

```swift
// CORRECT — Vision first, CIDetector fallback
func decode(_ image: CGImage) -> URL? {
    decodeWithVision(image) ?? decodeWithCoreImage(image)
}

private func decodeWithCoreImage(_ image: CGImage) -> URL? {
    let ciImage = CIImage(cgImage: image)
    guard let detector = CIDetector(
        ofType: CIDetectorTypeQRCode,
        context: nil,
        options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
    ) else { return nil }

    for case let qr as CIQRCodeFeature in detector.features(in: ciImage) {
        if let message = qr.messageString, let url = URL(string: message) {
            return url
        }
    }
    return nil
}
```

Keep `decodeWithVision` and `decodeWithCoreImage` as pure, `nonisolated`
functions over a `CGImage` — no actor hops, no UI — so both the Vision
callback path and CI test code can call the combined `decode(_:)` directly.
Log which path answered (Vision vs. CIDetector) at debug level so a
Simulator-only failure pattern is visible in test output instead of looking
like a flaky decode.

## Evidence

- Found writing barcode-decode tests for a scanning app's QR/NFC tag flow:
  a test that generates a QR then feeds it straight back into
  `VNDetectBarcodesRequest` failed only on the iOS 26 Simulator, with OSLog
  showing `Could not create inference context`. Adding the `CIDetector`
  fallback made the same test pass on Simulator and left on-device behavior
  unchanged (Vision still answers first there).

## Related skills

- `scan-capture-quality-gates` — a different failure stage: that skill
  covers whether the *captured frame itself* is good enough to decode
  (blur, auto-naming from OCR prose); this skill covers the *decoder*
  failing on an otherwise-good frame. A soft blur gate reduces how often
  you even need this fallback to fire.
- `vision-layout-ocr-grounding` — a sibling Vision-pipeline concern, but
  about text layout/reading order for on-device AI grounding, not barcode
  detection; both are examples of "don't trust one Vision output path,"
  applied to different Vision request types.
- `swift6-mainactor-compile-fixes` — keep `decodeWithVision`/`decodeWithCoreImage`
  `nonisolated` pure compute per that playbook, so the fallback chain can run
  off-main from capture-delivery callbacks.

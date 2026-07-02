---
name: scan-capture-quality-gates
description: Two scan-capture quality failures — (1) blurry captures sail through with no warning, OR the opposite, a hard blur gate rejects every low-texture subject (plain box, matte fabric, blank wall) and re-prompts "Retake" forever, stranding the user mid-scan; (2) an item auto-names itself with background OCR prose like "Complete the form below and" and the UI renders that guess as high-confidence (green). Use when adding a sharpness/blur accept-reject gate to a camera capture pipeline, or when deriving item/document names from OCR text in a scanning app.
---

# Scan Capture Quality Gates: Soft Blur Gate + Auto-Naming Discipline

## Symptom

- **Blur:** captures of low-texture subjects (plain cardboard, matte fabric)
  fail a hard sharpness check every single attempt — the user is stuck in a
  retake loop and can never finish the scan. Or, with no gate at all, blurry
  frames are silently accepted and OCR/recognition downstream degrades.
- **Naming:** a freshly scanned item appears named with a fragment of
  background OCR prose — cubby's verbatim case: **"Complete the form below
  and"** — and the name renders in the high-confidence (green) style, so the
  user trusts it.

## Root cause

- Sharpness (variance of Laplacian) is a **texture** metric, not a focus
  metric. Low-texture subjects score low even in perfect focus, so any *hard*
  threshold either passes blur (too low) or strands users (too high). A
  threshold of 80 rejects legitimate subjects; ~50 is the working value.
- Auto-naming leaks when there are **multiple creation entry points**: any
  caller that can pass a name string will eventually pass raw OCR output, and
  OCR confidence scores are per-glyph, not "is this a *name*" — prose reads as
  high-confidence text.

## Fix 1 — variance-of-Laplacian as a SOFT gate

Three verdicts, not pass/fail. Auto-accept after a retry budget so low-texture
subjects can't strand the user.

```swift
import Accelerate

nonisolated enum ScanConstants {
    static let sharpnessThreshold: Double = 50  // NOT 80 — 80 strands low-texture subjects
    static let maxBlurRetries = 2               // then auto-accept
}

nonisolated enum BlurVerdict {
    case deliver            // sharp enough — accept silently
    case warnAllowOverride  // soft warn: offer Retake, but keep a "Use Anyway" path
    case autoAccept         // retry budget exhausted — accept; optionally tag low-detail
}

nonisolated enum BlurGate {
    static func verdict(sharpness: Double, retryCount: Int) -> BlurVerdict {
        if sharpness >= ScanConstants.sharpnessThreshold { return .deliver }
        if retryCount >= ScanConstants.maxBlurRetries { return .autoAccept }
        return .warnAllowOverride
    }

    /// Variance of the Laplacian over an 8-bit luma plane. Higher = sharper.
    static func laplacianVariance(luma src: inout vImage_Buffer) -> Double {
        var dst = vImage_Buffer()
        guard vImageBuffer_Init(&dst, src.height, src.width, 8,
                                vImage_Flags(kvImageNoFlags)) == kvImageNoError
        else { return 0 }
        defer { free(dst.data) }
        var kernel: [Int16] = [0, 1, 0,  1, -4, 1,  0, 1, 0]
        vImageConvolve_Planar8(&src, &dst, nil, 0, 0, &kernel, 3, 3, 1, 0,
                               vImage_Flags(kvImageEdgeExtend))
        let w = Int(dst.width), h = Int(dst.height)
        var floats = [Float](repeating: 0, count: w * h)
        let bytes = dst.data.assumingMemoryBound(to: UInt8.self)
        for row in 0..<h {
            let rowPtr = bytes + row * dst.rowBytes
            for col in 0..<w { floats[row * w + col] = Float(rowPtr[col]) }
        }
        var mean: Float = 0, stdDev: Float = 0
        vDSP_normalize(floats, 1, nil, 1, &mean, &stdDev, vDSP_Length(floats.count))
        return Double(stdDev) * Double(stdDev)
    }
}
```

Rules: the gate is advisory (`warnAllowOverride` always keeps a "Use Anyway"
button); never block delivery of the frame itself — gate the *accept* step.

## Fix 2 — auto-naming discipline

ONE creation entry point (callers cannot inject a name), a confidence floor, a
sentence-shape reject list, and a hard cap on OCR-derived confidence so OCR
guesses never render as verified (green) in the UI.

```swift
nonisolated enum NamingConstants {
    static let minNameConfidence: Double = 0.5   // below the floor → default name
    static let ocrNameConfidenceCap: Double = 0.69 // OCR names never reach "green"
}

nonisolated struct NameCandidate { let text: String; let confidence: Double }

nonisolated enum ItemNamer {
    /// The ONLY way an item gets a name. No caller-supplied name parameter.
    static func resolveName(ocrCandidates: [NameCandidate],
                            defaultName: String) -> NameCandidate {
        let best = ocrCandidates
            .filter { !isSentenceLike($0.text) }
            // Per-glyph OCR confidence says "read correctly", not "is a name" — cap it.
            .map { NameCandidate(text: $0.text,
                                 confidence: min($0.confidence,
                                                 NamingConstants.ocrNameConfidenceCap)) }
            .max { $0.confidence < $1.confidence }
        guard let best, best.confidence >= NamingConstants.minNameConfidence
        else { return NameCandidate(text: defaultName, confidence: 0) }
        return best
    }

    /// Prose fragments ("Complete the form below and") are instructions, not names.
    static func isSentenceLike(_ text: String) -> Bool {
        let words = text.split(separator: " ")
        if words.count > 6 { return true }               // names are short noun phrases
        if text.hasSuffix(".") || text.hasSuffix(",") || text.hasSuffix(":") { return true }
        let proseMarkers: Set<String> = ["the", "and", "your", "please", "below",
                                         "above", "complete", "enter", "fill"]
        return words.filter { proseMarkers.contains($0.lowercased()) }.count >= 2
    }
}
```

## Evidence

- **cubby** — P4/P6 fix series: soft blur gate (`.deliver` /
  `.warnAllowOverride` / `.autoAccept`, threshold lowered 80 → 50, auto-accept
  after retry budget) and the auto-naming cleanup after background OCR prose
  ("Complete the form below and") became an item name.
- **doc-scan (Paperix)** — shares the auto-naming discipline; had *no*
  sharpness gate at all (the gap this skill closes for new scanning apps).
- Mining report Themes 3.3–3.4 (`docs/superpowers/specs/2026-07-01-ios-mining-report.md`).

## Related skills

- `avfoundation-capture-delivery-watchdog` — frames never *arriving* (delivery
  stalls) is a different failure than frames arriving blurry; gate quality here,
  watchdog delivery there.
- `vision-barcode-cidetector-fallback` — recognition fallbacks on the captured
  frame; a soft blur gate reduces how often those fallbacks fire.
- `swift6-mainactor-migration` — `BlurGate`/`ItemNamer` are pure compute:
  keep them `nonisolated` so they run off-main in the capture pipeline.

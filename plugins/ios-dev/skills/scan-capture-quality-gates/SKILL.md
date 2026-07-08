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
}
```

Sharpness itself is measured as the variance of the Laplacian over an 8-bit
luma plane (higher = sharper) — a vImage convolution, not a decision rule, so
it lives out-of-line.

**Read `references/blur-gate.md` before implementing** — `laplacianVariance`,
the vImage/Accelerate sharpness measurement that feeds `verdict` above.

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
```

`ItemNamer.resolveName` is the ONLY way an item gets a name (no caller can
inject a name string): it filters out sentence-like candidates, caps every
surviving candidate's confidence at `ocrNameConfidenceCap`, takes the best,
and falls back to `defaultName` if nothing clears `minNameConfidence`.
`isSentenceLike` is the prose-fragment reject rule — text is sentence-like
(not a name) if it has more than 6 words, ends in `.`/`,`/`:`, or contains
2+ words from a prose-marker set (the/and/your/please/below/above/complete/
enter/fill). This is what stops fragments like "Complete the form below and"
from becoming an item name.

**Read `references/ocr-name-scoring.md` before implementing** — the full
`ItemNamer.resolveName` and `isSentenceLike` implementations.

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
- `swift6-mainactor-compile-fixes` — `BlurGate`/`ItemNamer` are pure compute:
  keep them `nonisolated` so they run off-main in the capture pipeline.

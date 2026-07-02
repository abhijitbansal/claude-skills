---
name: vision-layout-ocr-grounding
description: >-
  On-device AI (Analyze / Ask / summarize) confabulates values from a scanned
  document — the scan clearly shows "Patient ID: 110331" next to
  "Patient Name:", but the model answers with an invented value, and the bug
  appears ONLY after kill+relaunch (fresh scans answer correctly). Root cause
  is grounding the model on PDFDocument.string, whose linear reading order
  collapses multi-column layouts into one jumbled line and drops right-column
  values. Use when feeding document text to an on-device LLM / Apple
  Intelligence, when AI answers are wrong only on the cold path, or when
  extracted text scrambles multi-column scans.
---

# Ground AI on Vision-Layout Text, Never `PDFDocument.string`

## Symptom

- The AI surface (Analyze, Ask, Key Points) returns a wrong or invented value
  for a field that is plainly visible in the scan — e.g. `Patient ID: 110331`
  sits left of `Patient Name:` on the page, the extracted text shows one
  jumbled line with the right-column value gone, and the model confabulates.
- **The bug hides on fresh scans and appears only after kill + relaunch.**
  Right after scanning, the in-memory Vision observations are still around and
  answers look correct; the cold path re-reads text from the PDF and breaks.
- "Extract Text" output for receipts/forms/bills reads out of order.

## Root cause

`PDFDocument.string` extracts the invisible text layer in **linear reading
order**. Multi-column layouts (label/value pairs, receipts, tables) collapse:
left- and right-column runs interleave or the right column is dropped
entirely. The model is then asked an impossible question and hallucinates.
The in-memory OCR cache masks the defect until the app restarts.

## Fix

### 1. Pure `nonisolated` layout formatter over raw Vision observations

Rebuild layout from `VNRecognizedTextObservation` bounding boxes. Encode:
rows → `\n`, columns within a row → `\t`, pages → `\n\n`. Single-column pages
degenerate to `\n`-joined text, so this is a strict superset of the old
behavior. Keep it pure (no UI, no actor state) so Vision callbacks and
detached tasks can call it — see `swift6-mainactor-migration`.

```swift
import Vision

nonisolated enum VisionLayoutFormatter {
    struct LineItem: Equatable {
        let text: String
        let bbox: CGRect   // Vision-normalized: bottom-left origin, 0...1
    }

    static let rowToleranceFactor: CGFloat = 0.6  // × median line height
    static let minRowTolerance: CGFloat = 0.006   // floor, normalized Y
    static let columnGapFraction: CGFloat = 0.04  // X-gap => column break
    static let minColumnRowsPerSide = 3           // gutter rows before real columns
    static let fullWidthFraction: CGFloat = 0.55  // full-width row = heading

    static func formatPages(observationsPerPage pages: [[LineItem]]) -> String {
        pages.map(formatPage).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    static func formatPage(_ items: [LineItem]) -> String {
        guard !items.isEmpty else { return "" }
        // Rows: sort by Y-center descending (Vision origin is bottom-left);
        // same row while |ΔyCenter| <= max(rowToleranceFactor × median line
        // height, minRowTolerance).
        let sorted = items.sorted { $0.bbox.midY > $1.bbox.midY }
        let heights = sorted.map(\.bbox.height).sorted()
        let tolerance = max(rowToleranceFactor * heights[heights.count / 2],
                            minRowTolerance)
        let rows = sorted.dropFirst().reduce(into: [[sorted[0]]]) { bands, item in
            if abs(bands[bands.count - 1][0].bbox.midY - item.bbox.midY) <= tolerance {
                bands[bands.count - 1].append(item)
            } else {
                bands.append([item])
            }
        }
        // Columns: within a row sort by minX; split into segments where the
        // X-gap >= columnGapFraction of page width; join segment text by " ",
        // segments by "\t" — reading ACROSS the row is what protects
        // receipts/key-value pairs from being scrambled.
        let lines: [String] = rows.map { row in
            let cells = row.sorted { $0.bbox.minX < $1.bbox.minX }
            let segments = cells.dropFirst().reduce(into: [[cells[0]]]) { segs, cell in
                if let tail = segs[segs.count - 1].last,
                   cell.bbox.minX - tail.bbox.maxX >= columnGapFraction {
                    segs.append([cell])
                } else {
                    segs[segs.count - 1].append(cell)
                }
            }
            return segments.map { $0.map(\.text).joined(separator: " ") }
                .joined(separator: "\t")
        }
        return lines.filter { !$0.isEmpty }.joined(separator: "\n")
    }
}
```

The full implementation (see Evidence) adds two refinements: a shared vertical
gutter with >= `minColumnRowsPerSide` rows on EACH side is a real column block
— emit each column top-to-bottom instead of tab-joining across; and a single
segment spanning >= `fullWidthFraction` of the page width is a heading/footer
that terminates the column block above it.

`LineItem` exists because tests can't construct `VNRecognizedTextObservation`;
test the row/column geometry directly on `LineItem` arrays.

### 2. ONE entry point, versioned sidecar cache, `searchableText` fallback

Every AI feature must get its grounding text from a single loader — never call
`PDFDocument.string` (or a second ad-hoc extraction path) from a feature.

```swift
@MainActor
enum DocumentTextLoader {
    static let cacheSuffix = "aitext.v2.txt" // bump when formatter contract changes

    /// Always returns something — the fallback chain ends in searchableText.
    /// clipForModel is the clip-on-read pattern from
    /// `ondevice-generable-anti-hallucination` Fix #4 (~4000-char cap +
    /// truncation marker; the cache file keeps the full text).
    static func aiInputText(
        for document: Document, contentHash: String, store: DocumentStore
    ) async -> String {
        if let cached = readCache(for: document, hash: contentHash), !cached.isEmpty {
            return clipForModel(cached)
        }
        let formatted = await rasterizeRecognizeFormat(url: document.url)
        guard !formatted.isEmpty else {                 // image-only PDF, OCR failure
            return clipForModel(store.searchableText(for: document))
        }
        writeCache(formatted, for: document, hash: contentHash) // atomic write
        return clipForModel(formatted)
    }
}
```

Invariants that matter:

- **Versioned suffix** (`.aitext.v2.txt`): bump when the formatter contract
  changes so stale caches can't poison downstream features. Key by content
  hash so edits/re-OCR make old entries unreachable.
- **Clip on read, not on write** — pattern, constant, and rationale live in
  `ondevice-generable-anti-hallucination` (Fix #4).
- Rasterize pages at **native size** for OCR — downsampled thumbnails hurt
  small-text recognition.

### 3. Verify on the cold path

The in-memory cache hides the bug on fresh scans. The only honest test:
scan → **kill the app → relaunch** → ask the AI about a right-column value.
Add this as an explicit manual-test step; a warm-path check proves nothing.

## Evidence

- **doc-scan (Paperix):** `fix(ai): ground Analyze + Ask on Vision-layout
  text, restore copy` (e32db4a); `fix(ocr): column-aware reading order for
  multi-column scans` (4edae2e); `fix(import,ocr): edge-detect shared photos
  + layout-preserve Extract Text` (eba5e12). The `Patient ID: 110331`
  confabulation was the originating user repro. Full formatter:
  `AI/VisionLayoutFormatter.swift` in the originating doc-scan repo.
- **cubby:** OCR reading-order fixes; raw OCR prose leaking into user-visible
  surfaces (auto-naming) required the same "one grounded entry point" cure.

## Related skills

- `swift6-mainactor-migration` — why the formatter must be `nonisolated`
  pure compute under default-MainActor isolation.
- `ondevice-generable-anti-hallucination` — downstream consumer; owns the
  clip-on-read `clipForModel` pattern this loader applies.
- `nonisolated-struct-codable-mainactor` (local learned micro-skill, not
  shipped with this plugin) — keeping the formatter's value types usable
  off-main.
- `vision-barcode-cidetector-fallback` (local learned micro-skill, not
  shipped with this plugin) — sibling Vision-pipeline fallback pattern
  (primary detector + deterministic fallback chain).
- `avfoundation-capture-delivery-watchdog` (local learned micro-skill, not
  shipped with this plugin) — upstream capture-side failure detection for
  the same scan pipelines.

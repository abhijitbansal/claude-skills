# VisionLayoutFormatter: row/column reconstruction from Vision bounding boxes

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

This is the **base split** only, and it is all that is coded here. It runs on
macOS under default MainActor isolation: a row with `Patient ID:`, `110331` and
`Patient Name:` on one baseline formats as `Patient ID: 110331<TAB>Patient Name:`.
It does **not** implement multi-column page layout (a two-column page comes out
as tab-joined rows, not two blocks).

Two refinements exist in the originating app and are not reproduced here. If you
need multi-column pages, you have to write them: a shared vertical gutter with
>= 3 rows on EACH side is a real column block — emit each column top-to-bottom
instead of tab-joining across; and a single segment spanning >= 55% of the page
width is a heading/footer that terminates the column block above it. Add them
with a `LineItem`-array test that a two-column fixture yields two blocks.

`LineItem` exists because tests can't construct `VNRecognizedTextObservation`;
test the row/column geometry directly on `LineItem` arrays.

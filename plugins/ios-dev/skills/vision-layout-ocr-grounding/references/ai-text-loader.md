# DocumentTextLoader: single grounding-text entry point with versioned cache

**A sketch, not a drop-in.** `readCache`, `writeCache`, `rasterizeRecognizeFormat`
and `clipForModel` are not defined here — write them in your app (the clip is in
`ondevice-generable-anti-hallucination`, Fix #4; `rasterizeRecognizeFormat` feeds
`VisionLayoutFormatter` from `ocr-layout-formatter.md`). Not compiled.

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

# DeepLinkResolver.resolve + resolvePayloadPath: full implementations

```swift
enum DeepLinkAction: Equatable, Sendable {
    case openDocument(id: UUID)
    case startScan
    case ignore
}

nonisolated enum DeepLinkResolver {
    static func resolve(
        _ url: URL,
        isLocked: Bool,
        knownDocumentIDs: Set<UUID>
    ) -> DeepLinkAction {
        guard !isLocked else { return .ignore }   // DROP, never defer
        guard url.scheme == "paperix" else { return .ignore }
        switch url.host {
        case "doc":
            guard let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                      .queryItems?.first(where: { $0.name == "id" })?.value,
                  let id = UUID(uuidString: raw),
                  knownDocumentIDs.contains(id)   // whitelist, don't trust
            else { return .ignore }
            return .openDocument(id: id)
        case "scan":
            return .startScan
        default:
            return .ignore
        }
    }
}
```

If a payload must carry a path (keep it **relative** — never an absolute file
URL), validate before touching the filesystem:

```swift
nonisolated func resolvePayloadPath(_ relative: String, under root: URL) -> URL? {
    guard !relative.isEmpty, !relative.hasPrefix("/"),
          !relative.contains("..")                // reject BEFORE normalization
    else { return nil }
    let candidate = root.appendingPathComponent(relative)
    // Canonical-descendant check: resolve symlinks on BOTH sides,
    // trailing "/" so "…/Docs" can't match "…/DocsEvil".
    let canonicalRoot = root.resolvingSymlinksInPath()
        .standardizedFileURL.path + "/"
    let canonicalCandidate = candidate.resolvingSymlinksInPath()
        .standardizedFileURL.path
    guard canonicalCandidate.hasPrefix(canonicalRoot) else { return nil }
    return candidate
}
```

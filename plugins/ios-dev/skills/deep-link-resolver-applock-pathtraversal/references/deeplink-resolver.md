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
        guard url.scheme == "myapp" else { return .ignore }
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
          // reject a ".." PATH COMPONENT before normalization; a name that merely
          // contains two dots ("report..v2.pdf") is a legitimate file name
          !relative.split(separator: "/", omittingEmptySubsequences: false).contains("..")
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

Run on macOS (Swift 6): `report..v2.pdf` and `sub/file.pdf` resolve; `a/../b`,
`..`, `../x`, `a/b/..` and `/etc/passwd` are rejected. Unit tests to ship with it:
`report..v2.pdf` resolves, `a/../b` is rejected.

## Comparing paths: fold `/private` first

A temp or container directory can be spelled `/var/…` or `/private/var/…` (the
first is a symlink to the second on iOS and macOS). Two paths for the same file
then compare unequal as strings. The `resolvingSymlinksInPath()` calls above
fold both spellings to one; do the same before **any** string compare, prefix
check or set lookup of file paths (an export check, a "is this in the library"
test, a queue de-duplication). On macOS, `/var/folders/…` and `/private/var/folders/…`
differ as raw paths and are equal after `resolvingSymlinksInPath()`.

## Cold launch: a link can arrive before the id set is loaded

`resolve` takes `knownDocumentIDs`. If a link opens the app cold, `onOpenURL`
can run before the store has loaded, the set is empty, the id is not whitelisted
and the link is silently dropped, so the user lands on the home screen with
nothing opened. The link is not malicious; it just arrived early. Either hold the
URL until the store reports loaded and then resolve it once (this is a pending
*load*, not a deferred-while-locked link: a locked app still drops it), or
accept the drop and say so. Test both: cold link with an empty id set, and the
same link after load.

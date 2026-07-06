---
name: deep-link-resolver-applock-pathtraversal
description: A deep link (e.g. paperix://doc?id=…) opens its document ON TOP of the Face ID App-Lock overlay — or fires the moment the user unlocks, navigating somewhere they never chose; a URL payload containing ../ resolves to a file outside the app's documents root; onOpenURL routing is inline in view closures and untestable. Use when adding a custom URL scheme, widget/notification/App Intent deep links, or reviewing any onOpenURL handler that maps URL text to file paths or model ids — route every entry through one pure nonisolated resolver that DROPS (never defers) links while locked and canonically validates paths.
---

# One Pure Deep-Link Resolver: App-Lock Drops + Path-Traversal Guard

## Symptom

- Tapping a widget or notification deep link while App-Lock is engaged
  presents the target document **above the lock overlay** (or right after a
  cancelled Face ID prompt) — an effective lock bypass.
- A "deferred" link fires immediately after unlock, yanking the user to
  content they never re-requested post-auth.
- A crafted URL whose payload contains `..` (or an absolute path) resolves to
  a file **outside** the app's documents root — path traversal via `onOpenURL`.
- Routing logic is scattered inline across `onOpenURL` / widget / intent
  closures: unreachable by unit tests, and each copy re-decides lock policy.

## Root cause

All external entry points (URL scheme, widget links, notifications, App
Intents) converge on `onOpenURL`, but **inline routing in the view layer**:
(a) can present navigation above the lock overlay because the lock is UI, not
a gate on the router; (b) turns URL text directly into file paths — a
path-traversal sink; (c) isn't testable, so neither invariant is enforced.

## Fix

One pure `nonisolated` resolver returns an enum action; views only perform it.
Locked state gates it directly: a locked app always resolves to `.ignore` —
**dropped, never deferred** — because a link queued for after unlock would
fire without a fresh user gesture, and a stale one could present above the
lock overlay. Document ids are matched against a **whitelist** of known ids,
never constructed or fetched straight from URL text.

```swift
enum DeepLinkAction: Equatable, Sendable {
    case openDocument(id: UUID)
    case startScan
    case ignore
}

nonisolated enum DeepLinkResolver {
    static func resolve(
        _ url: URL, isLocked: Bool, knownDocumentIDs: Set<UUID>
    ) -> DeepLinkAction   // isLocked ⇒ .ignore; unknown scheme/host ⇒ .ignore
}
```

**Read `references/deeplink-resolver.md` before implementing** — the full
`resolve` implementation (lock check, scheme/host routing, id whitelist
against `knownDocumentIDs`) and the `resolvePayloadPath` traversal guard
below, matching the invariants section exactly.

If a payload must carry a path (keep it **relative** — never an absolute file
URL), validate before touching the filesystem: **reject any `..` before any
normalization**, then require the resolved path to be a canonical descendant
of the root — symlinks resolved on **both sides**, with a trailing `/` on the
root so `…/Docs` can't match `…/DocsEvil`.

```swift
nonisolated func resolvePayloadPath(_ relative: String, under root: URL) -> URL?
```

Single wiring point — every entry surface funnels here:

```swift
.onOpenURL { url in
    let action = DeepLinkResolver.resolve(
        url,
        isLocked: appLock.isLocked,
        knownDocumentIDs: store.documentIDs
    )
    router.perform(action)   // .ignore is a no-op — nothing is queued
}
```

### Invariants

1. **One resolver.** URL scheme, widget links, notifications, and App Intents
   all produce a URL that goes through `DeepLinkResolver.resolve` — no inline
   routing anywhere else.
2. **Locked ⇒ `.ignore`, dropped not deferred.** A queued link fires after
   unlock and navigates without a fresh user gesture; a stale one can present
   above the overlay. The user re-taps if they still care.
3. **Reject `..` before any normalization**, then canonical-descendant check
   with symlinks resolved on both sides and a trailing-slash root.
4. **Whitelist known ids** — never construct a path or fetch directly from
   URL text.
5. **Relative-path / opaque-id payloads only** — absolute file URLs in a link
   are both fragile (container moves) and an attack surface.
6. The resolver is pure and `nonisolated` ⇒ unit-test the whole matrix
   (locked × scheme × traversal payloads) with no UI harness.

## Evidence

- **doc-scan (Paperix)** — `paperix://doc` deep links + App-Lock fixes:
  inline `onOpenURL` routing presented above the lock overlay and accepted
  path payloads; replaced with the single `nonisolated` resolver returning an
  enum action, `.ignore` while locked, `..`-reject + descendant check +
  known-doc whitelist, relative-path payloads only.
- **cubby** — App-Lock gating of external entry points (App Intents / deep
  links / notification handlers arriving before auth resolves).
- Mining report Theme 5.3: "inline routing can present above the lock
  overlay, isn't testable, and is a path-traversal sink."

## Related skills

- `biometric-applock` — the lock overlay itself and its four bypass pitfalls;
  this skill supplies the deep-link gate that skill's "gating deep links"
  bullet points at.
- `widget-appgroup-snapshot-bridge` — widget links are the most common source
  of these URLs; its App-Lock redaction and relative-path-id rules pair with
  invariants 2 and 5 here.
- `file-handoff-inbox-backstop` — the other external-entry surface
  (share/action extensions); same "validate before the host app acts" stance.
- `swift6-mainactor-compile-fixes` — why the resolver is `nonisolated` pure
  compute under MainActor-default isolation, and how to keep it that way.

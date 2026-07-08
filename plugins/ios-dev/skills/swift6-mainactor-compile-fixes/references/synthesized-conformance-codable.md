# Synthesized Codable/Equatable Conformance Is MainActor-Isolated Too

## Symptom

A plain data struct — no methods, no UI, nothing stateful — fails to compile
the moment it's decoded, encoded, or compared from off-main code:

```
main actor-isolated conformance of 'UPCResponse' to 'Decodable' cannot be used in nonisolated context
```

Same error shape for `Equatable`/`Hashable`/`Encodable`. It shows up specifically
when:
- Decoding JSON inside a `nonisolated` helper function or a `@ModelActor`.
- Comparing two instances of the type (`==`, `Set`/`Dictionary` membership) from
  a `nonisolated` or `Task.detached` context.
- The struct itself has no explicit `@MainActor` anywhere — which is exactly
  what makes this confusing to debug.

## Root cause

Under `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, an unannotated `struct`/`enum`
is implicitly `@MainActor` — including types whose only job is to hold data.
The compiler doesn't just isolate the type's own members: it isolates the
**synthesized conformances** (`Codable`, `Equatable`, `Hashable`) too, because
synthesis happens on the MainActor-isolated type. Calling `JSONDecoder().decode`
or `==` on it from a `nonisolated` context is then a hard isolation violation,
not a warning.

This is easy to miss because nothing about the struct *looks* MainActor-bound —
there's no `@Published`, no UI reference, no obvious actor state. It's pure
implicit default isolation leaking into conformance synthesis.

## Fix

Mark the pure data type `nonisolated` at the declaration. This makes the type
*and* its synthesized conformances usable off-main, while it remains trivially
usable from `@MainActor` call sites too — there's no downside for a type with
no actor-isolated state.

```swift
// WRONG — implicitly @MainActor; synthesized Decodable conformance
// is MainActor-isolated, so decoding off-main fails to compile
struct UPCResponse: Decodable {
    let items: [Item]
}

func firstDraft(from data: Data) throws -> ProductDraft? {
    try JSONDecoder().decode(UPCResponse.self, from: data)   // ← error here
        .items.first.map { ProductDraft(name: $0.title, brand: nil) }
}
```

```swift
// CORRECT — nonisolated type ⇒ nonisolated synthesized conformance
nonisolated struct UPCResponse: Decodable, Sendable {
    let items: [Item]
}

nonisolated struct ProductDraft: Sendable, Equatable {
    var name: String
    var brand: String?
}

nonisolated func firstDraft(from data: Data) throws -> ProductDraft? {
    try JSONDecoder().decode(UPCResponse.self, from: data)   // compiles off-main
        .items.first.map { ProductDraft(name: $0.title, brand: nil) }
}
```

Enum cases hit the same trap — `nonisolated enum ShoppingReason { case lowStock, expired }`
when its synthesized `Equatable` clashes with an already-`nonisolated` enclosing
type.

Rule of thumb: reserve default MainActor isolation for genuinely *stateful UI*
types. Pure data — DTOs, response models, filter/search criteria, anything a
`@ModelActor` returns or a background decoder produces — should be `nonisolated`
(and `Sendable`) from the start, not patched reactively per call site.

## Evidence

Hit 3× in one session on a MainActor-default Swift 6 app: `UPCResponse` (JSON
decode inside a nonisolated barcode-lookup helper), `FilterCriteria` (encoded
for a saved-search feature from nonisolated code), `ShoppingReason` (synthesized
`Equatable` clashing with a nonisolated enclosing struct). All three were fixed
by adding `nonisolated` at the type declaration, with zero other changes.

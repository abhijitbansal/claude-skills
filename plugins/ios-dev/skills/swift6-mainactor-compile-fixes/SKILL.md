---
name: swift6-mainactor-compile-fixes
description: Compile-time Swift 6 MainActor-isolation failures under SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor. Two diagnostics: (1) "main actor-isolated X cannot be called from outside of the actor" on pure-compute types (exporters, geometry builders, parsers, value-model structs) implicitly @MainActor but run off-main in Task.detached / @concurrent contexts; (2) "main actor-isolated conformance of X to Decodable cannot be used in nonisolated context" (or Equatable/Hashable/Encodable variants) when a zero-state struct/enum — a DTO, response model, or filter-criteria type — is JSON-decoded, encoded, or compared from a background/nonisolated path: a nonisolated helper, a @ModelActor, Task.detached, or an off-main JSONDecoder call. Honest fix: mark the type nonisolated at its declaration, cascade through flagged callees, pass resolved values instead of actor-isolated objects. Forbids @unchecked Sendable / nonisolated(unsafe) / @preconcurrency band-aids. Trigger on Swift 6 default-MainActor migration or either error.
---

# Swift 6 MainActor Compile Fixes

## Why this skill exists

`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` makes **every unannotated type
implicitly `@MainActor`** — including pure data→file exporters, geometry
builders, value-type models, and plain DTOs written to run off-main. The naive
fixes are both wrong: `await MainActor.run` hops heavy compute onto the main
thread (UI jank); `@preconcurrency` / `nonisolated(unsafe)` hides real data
races.

## When to use

- "main actor-isolated X cannot be called from outside of the actor" warnings
  on exporters / builders / parsers called from `Task.detached` or
  `@concurrent` contexts
- Swift 6 migration of a project using `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
  / "approachable concurrency"
- "main actor-isolated conformance of 'X' to 'Decodable' cannot be used in
  nonisolated context" (or the `Equatable`/`Hashable`/`Encodable` variants) on
  a plain value-type struct or enum with **zero stored state of its own**,
  hit while JSON-decoding, encoding, or comparing it from a
  background/nonisolated path — a `nonisolated` helper function, a
  `@ModelActor`, `Task.detached`, or an off-main `JSONDecoder` call

## The honest fix (general case)

Mark the pure-compute types `nonisolated` at the *type* declaration
(Swift 6.1+/Xcode 26 supports type-level `nonisolated`), which matches how they
already execute at runtime. Process:

1. Mark the directly-flagged type `nonisolated struct/enum X`.
2. Rebuild — the compiler cascades: helpers and model types the nonisolated
   code calls get flagged next. Mark each `nonisolated` **only if** it's pure
   compute (no UI, no `@Published` / `@Observable` state). Iterate until clean.
3. Things that must stay `@MainActor` get explicit annotations on the *member*,
   not the type — e.g. a method mutating a live `SCNView`, or a function writing
   through a main-actor storage manager.
4. If a nonisolated function needs a value from main-actor state (e.g. a
   `@Published` directory path), **change its signature to accept the value**
   (resolved by the caller on the main actor) rather than passing the
   actor-isolated object in.
5. "Reference to captured var 'x' in concurrently-executing code": copy to a
   `let` before the `MainActor.run` hop — a 2-line fix, no restructuring.
6. Extensions get their own implicit isolation — a `nonisolated` parent type
   does NOT cover a separate `extension`; mark it too.

Safe-off-main APIs worth knowing: SceneKit scene-graph construction
(`SCNScene` / `SCNNode` building), `UIGraphicsPDFRenderer`, CoreGraphics PDF
contexts.

## Hard rules — do NOT regress

No `@unchecked Sendable`, no `nonisolated(unsafe)`, no `@preconcurrency`. If a
type can't be made `nonisolated` honestly, fix the call site instead. These
rules apply to both the general case and the struct-Codable sub-case below.

## Example shape (general case)

Exporters (`PDFExporter`, `GLBExporter`, …), scene builders, geometry solvers,
and plain data-model structs → `nonisolated`. A method mutating an `SCNView` and
one writing via a storage manager → explicit `@MainActor`. An
`exportArchive(from:storageManager:)` becomes `exportArchive(from:planFolder: URL)`
because the directory came from `@Published` state — resolve it at the call site.

## The narrower case: synthesized Codable/Equatable/Hashable conformance

Default-MainActor isolation covers a type's **synthesized conformances** too,
so a plain zero-state struct or enum fails to decode, encode, or compare
off-main even though nothing about it looks MainActor-bound. Same fix —
`nonisolated` at the declaration — with zero downside on a stateless type.

**Read `references/synthesized-conformance-codable.md` before implementing** —
it has the full symptom, root cause, and before/after code for this sub-case.

## The WidgetKit case: TimelineProvider needs whole-type nonisolated

A third diagnostic surface: `conformance of 'X' to protocol 'TimelineProvider'
crosses into main actor-isolated code`. Per-method `nonisolated` on
`placeholder`/`getSnapshot`/`getTimeline` is insufficient — the protocol
conformance itself stays isolated. Fix: mark the whole provider struct *and*
its `TimelineEntry` type `nonisolated struct`, not just the methods.

**Read `references/widgetkit-timelineprovider.md` before implementing** — full
symptom, root cause, and code for this sub-case.

## Verification

Incremental builds skip unchanged files and can hide warnings — `touch` the
changed files (or clean) to force recompilation, then grep build output for
`warning:`. Run ALL targets' compile gates (shared sources compile per-target).

## Related skills

- `mainactor-runtime-isolation-trap` — runtime crashes/re-entrancy that compile
  clean under MainActor-default isolation; this skill is the opposite failure
  mode (compile-time errors), not a runtime one.

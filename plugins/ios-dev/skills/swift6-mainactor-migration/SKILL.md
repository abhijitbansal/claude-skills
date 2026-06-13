---
name: swift6-mainactor-migration
description: Resolving "main actor-isolated X cannot be called from outside of the actor" warnings/errors in a project built with SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor, where pure-compute types (exporters, geometry builders, value-model structs) are implicitly @MainActor but actually run off-main in Task.detached / @concurrent contexts. Teaches the honest fix — mark pure-compute types nonisolated at the type declaration and cascade through flagged callees, change signatures to accept resolved values instead of passing actor-isolated objects — and forbids @unchecked Sendable / nonisolated(unsafe) / @preconcurrency band-aids. Trigger on Swift 6 default-MainActor migration or those isolation warnings.
---

# Swift 6 Default-MainActor: Mark Pure-Compute Types nonisolated

## Why this skill exists

`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` makes **every unannotated type
implicitly `@MainActor`** — including pure data→file exporters, geometry
builders, and value-type models written to run off-main. The naive fixes are
both wrong: `await MainActor.run` hops heavy compute onto the main thread (UI
jank); `@preconcurrency` / `nonisolated(unsafe)` hides real data races.

## When to use

- "main actor-isolated X cannot be called from outside of the actor" warnings
  on exporters / builders / parsers called from `Task.detached` or
  `@concurrent` contexts
- Swift 6 migration of a project using `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
  / "approachable concurrency"

## The honest fix

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
type can't be made `nonisolated` honestly, fix the call site instead.

## Example shape

Exporters (`PDFExporter`, `GLBExporter`, …), scene builders, geometry solvers,
and plain data-model structs → `nonisolated`. A method mutating an `SCNView` and
one writing via a storage manager → explicit `@MainActor`. An
`exportArchive(from:storageManager:)` becomes `exportArchive(from:planFolder: URL)`
because the directory came from `@Published` state — resolve it at the call site.

## Verification

Incremental builds skip unchanged files and can hide warnings — `touch` the
changed files (or clean) to force recompilation, then grep build output for
`warning:`. Run ALL targets' compile gates (shared sources compile per-target).

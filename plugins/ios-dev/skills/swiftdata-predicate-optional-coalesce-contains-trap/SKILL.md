---
name: swiftdata-predicate-optional-coalesce-contains-trap
description: SwiftData #Predicate like `ids.contains($0.fromBinID ?? sentinelUUID)` compiles fine but throws NSInvalidArgumentException "unimplemented SQL generation … (bad LHS)" at fetch time against a real (even in-memory) ModelContext. Use when writing a #Predicate that filters an optional model column (nullable foreign-key / relationship ID) against a caller-supplied Set or Array of candidate IDs.
---

# SwiftData #Predicate: coalescing an optional column on the LHS of contains() throws at fetch time

## Symptom

A `#Predicate` such as `ids.contains($0.fromBinID ?? sentinelUUID)` — matching
an optional model column against a candidate-ID list, the idiom developers
reach for constantly for nullable foreign keys — compiles cleanly and passes
any pure-logic unit test built around the predicate closure itself. It only
fails when actually run against a real `ModelContext` (a live store or an
in-memory one), throwing at fetch time:

```
NSInvalidArgumentException: unimplemented SQL generation … (bad LHS)
```

This happens identically whether the RHS candidate list is a `Set` or an
`Array`.

## Root cause

SwiftData's predicate-to-SQL translator cannot generate SQL when the
left-hand expression of `contains()` is a *computed* value — specifically an
optional model column coalesced with `??`. `$0.fromBinID ?? sentinelUUID`
turns the LHS into an expression the translator has no SQL form for, so it
throws rather than falling back to something correct. The predicate is legal
Swift and legal `#Predicate` syntax; the failure is purely in SwiftData's SQL
generation for this LHS shape, so nothing catches it before a real fetch runs.

## Fix

Don't coalesce the optional column. Instead widen the candidate list itself
to the optional type — `[UUID?]` instead of `[UUID]` — so the predicate
becomes a bare `column IN (…)` comparison against an unmodified, optional
LHS:

```swift
// Throws NSInvalidArgumentException at fetch time (bad LHS):
let predicate = #Predicate<Item> { ids.contains($0.fromBinID ?? sentinelUUID) }

// Works: widen the RHS list to [UUID?] instead, leave the column bare.
let optionalIDs: [UUID?] = ids.map { $0 }
let predicate = #Predicate<Item> { optionalIDs.contains($0.fromBinID) }
```

`nil` simply never matches, because `nil` is never a member of `optionalIDs`
— the same filtering semantics as the coalesced version, achieved without a
computed LHS.

## Evidence

Mined from Cubby iOS session logs (0015-2026-07-06-v0.2.2-fix-wave);
adversarially verified. Checkpoint '2026-07-07 20:20':

> "SwiftData #Predicate trap (worth remembering): coalescing an optional
> column on the LHS of contains() (`ids.contains($0.fromBinID ?? sentinel)`)
> throws NSInvalidArgumentException: unimplemented SQL generation … (bad LHS)
> at FETCH time — with either a Set or Array. Fix: make the list [UUID?] so
> the column sits bare (column IN (…)); nil never matches because it's never
> in the list."

The failure was caught by a TDD RED against a real in-memory `ModelContext`;
the log explicitly notes "a pure-helper test would have missed it" — the
predicate closure alone, exercised without a `ModelContext` fetch, never
touches SwiftData's SQL generator.

## Related skills

- `swiftdata-inmemory-test-harness` — the in-memory `ModelContext` harness
  that caught this trap; a pure-logic unit test around the predicate closure
  would not have.
- `swiftdata-cloudkit-model-rules` — other SwiftData failures that compile
  clean and only surface at runtime against a real container/context.

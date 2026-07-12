# SwiftData #Predicate: coalescing an optional column on the LHS of contains() throws at fetch time

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0015-2026-07-06-v0.2.2-fix-wave); adversarially verified.

## Problem
A #Predicate like `ids.contains($0.fromBinID ?? sentinelUUID)` compiles fine but throws `NSInvalidArgumentException: unimplemented SQL generation … (bad LHS)` at fetch time, with either a Set or Array on the RHS. SwiftData's predicate-to-SQL translator can't generate SQL when an optional model column is coalesced (`?? default`) as part of the contains() left-hand expression — a pattern developers reach for constantly when matching optional foreign keys against a candidate-ID list.

## Solution
Don't coalesce the optional column. Instead widen the candidate list itself to the optional type (`[UUID?]` instead of `[UUID]`) so the predicate becomes a bare `column IN (…)` comparison; `nil` simply never matches because it's never a member of the list, achieving the same semantics without a computed LHS.

## Evidence
0015 checkpoint '2026-07-07 20:20': "SwiftData #Predicate trap (worth remembering): coalescing an optional column on the LHS of contains() (`ids.contains($0.fromBinID ?? sentinel)`) throws NSInvalidArgumentException: unimplemented SQL generation … (bad LHS) at FETCH time — with either a Set or Array. Fix: make the list [UUID?] so the column sits bare (column IN (…)); nil never matches because it's never in the list."

## When to Use
Any SwiftData app with an optional foreign-key column (nullable relationship IDs are common — 'item currently in transit has no binID yet') will hit this the first time it filters that column against a caller-supplied ID set. The failure only manifests at fetch time against a real (even in-memory) ModelContext, not at compile time or in a pure-logic unit test — exactly the kind of trap a plan-then-code workflow misses until integration testing, which is what happened here (caught by TDD RED against a real in-memory context, and the log explicitly notes 'a pure-helper test would have missed it').

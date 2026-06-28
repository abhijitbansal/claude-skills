---
name: debug
description: Apply a disciplined debugging lens to a bug, test failure, crash, or "it's not working" report — reproduce first, isolate, form one hypothesis at a time, prove it with a failing test before fixing. Use when the user reports unexpected behavior, a stack trace, a flaky test, or asks "why is this broken". Skip for greenfield feature work.
---

# Debug lens

> **Contract (shared by prompt-craft lenses):** state the assumptions you're
> acting on, confirm anything load-bearing that's missing *before* changing code,
> make the smallest change that fits, and define how you'll know it's fixed.

The failure mode this prevents: guessing at fixes. A fix you can't reproduce
failing first is a fix you can't prove worked.

## Steps

1. **Reproduce.** Get a deterministic repro — ideally a failing test. Can't
   reproduce? Say so and ask for the exact inputs/steps before guessing.
2. **Isolate.** Narrow to the smallest code path that still fails. Bisect, log,
   or binary-search the change history.
3. **One hypothesis at a time.** State it, predict what you'd see, check. Don't
   shotgun multiple changes.
4. **Write the failing test** that captures the bug (RED), then fix to GREEN.
5. **Confirm** the original repro now passes and no neighboring test broke.

## Confirm-step (before editing)

If the repro, the expected-vs-actual, or the affected file is unclear — ask. One
sharp question beats three speculative edits.

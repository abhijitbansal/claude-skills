---
name: refactor
description: Apply a refactoring lens — restructure code without changing behavior, guarded by tests that pass before and after. Use when the user says "refactor", "clean this up", "extract this", "simplify this", "reduce duplication", or "make this readable" on existing working code. Skip when the change is meant to alter behavior (that's a feature or a fix).
---

# Refactor lens

> **Contract (shared by prompt-craft lenses):** state the assumptions you're
> acting on, confirm anything load-bearing that's missing *before* changing code,
> make the smallest change that fits, and define how you'll know it's right.

The invariant: behavior is unchanged. The proof: the same tests pass before and
after. No green test suite covering the target? That's step zero.

## Steps

1. **Pin behavior with tests.** Ensure tests cover the code being moved. If they
   don't, add characterization tests first — refactoring untested code is editing
   blind.
2. **Run the suite GREEN** before touching anything (the baseline).
3. **Refactor in small, reversible steps** — extract, rename, dedupe. Match the
   surrounding style even if you'd do it differently.
4. **Re-run the suite after each step**; it must stay GREEN. A red test means the
   refactor changed behavior — revert and reconsider.
5. **Stop at the goal.** No bundled feature changes, no opportunistic rewrites of
   adjacent code.

## Confirm-step (before editing)

If there's no test coverage and the behavior contract is non-obvious, ask whether
to add characterization tests first or whether a behavior change is actually intended.

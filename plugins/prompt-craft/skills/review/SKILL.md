---
name: review
description: Apply a code-review lens to a diff, branch, or file — find correctness bugs, security issues, and quality problems, ranked by severity, with a concrete fix for each. Use when the user says "review this", "review my diff", "check this PR", "look this over before I commit", or "is this safe". Skip when the user wants the code written, not reviewed.
---

# Review lens

> **Contract (shared by prompt-craft lenses):** state what you reviewed and what
> you didn't, confirm scope if it's ambiguous *before* reporting, and make every
> finding actionable.

The goal is signal, not a wall of nits. Each finding is one line: where, what's
wrong, how to fix.

## Steps

1. **Establish scope.** `git diff <base>...HEAD` for a branch, or the named file.
   State exactly what's in scope; if unclear, ask before reviewing the wrong thing.
2. **Pass 1 — correctness & security first.** Logic bugs, unhandled errors,
   injection, secrets, auth/authz, unsafe input. These block.
3. **Pass 2 — quality.** Duplication, dead code, naming, oversized functions,
   missing tests. These warn.
4. **Report by severity** (CRITICAL / HIGH / MEDIUM / LOW). Format each as
   `path:line — <problem>. <fix>.` Skip pure-style nits unless they change meaning.
5. **Verdict:** approve, approve-with-warnings, or block — with the one reason that
   decides it.

## Confirm-step (before reporting)

If the base branch / scope is ambiguous, or the change is large and you can only
cover part, say what you covered and what you skipped — never imply full coverage
you didn't do.

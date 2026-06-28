---
name: improve-prompt
description: Turn a rough, vague, or one-line request into a deterministic spec before any work starts — restated goal, explicit acceptance criteria, surfaced assumptions to confirm, and recommended slash commands. Use when the user says "improve this prompt", "make this a spec", "sharpen this", "what would you need to know", or hands over a fuzzy ask like "fix the thing" / "make it better" / "add auth" with no detail. Skip when the request is already precise and self-contained.
model: opus
effort: high
---

# Improve the prompt

A vague prompt routes to improvisation. This skill spends a higher-effort pass up
front to convert the ask into a spec that any agent (or human) could execute the
same way twice — *deterministic at the start* instead of guessed at the end.

## Output (always these five blocks, in order)

1. **Restated goal** — one sentence, in your own words, capturing the actual
   outcome wanted (not the literal phrasing).
2. **Acceptance criteria** — a checklist of observable, testable conditions that
   define "done". Each line must be verifiable (a test, a command output, a UI
   state), not a vibe.
3. **Assumptions to confirm** — every gap you had to fill to write the criteria.
   Mark the load-bearing ones. The user resolves these *before* implementation.
4. **Out of scope** — what you are deliberately NOT doing, to stop scope creep.
5. **Recommended commands** — 1–3 slash commands that fit the work, drawn from
   what's installed (e.g. `/plan` to decompose, `/prompt-craft:review` to check a
   diff). Say why each fits. If nothing fits, say so — don't invent commands.

## Rules

- **Do not start the work.** This skill produces the spec and stops. Acting on a
  fuzzy prompt is the exact failure mode it exists to prevent.
- **Surface ambiguity, never resolve it silently.** If two readings exist, list
  both under assumptions and ask which.
- **Criteria over prose.** If a criterion can't be checked, rewrite it until it can.
- **No speculative scope.** Criteria cover the ask, not a wishlist around it.

## When NOT to use

- The prompt is already a precise, bounded instruction — just do the work.
- The user explicitly said "just do it" / "no questions" on a small task — respect that.

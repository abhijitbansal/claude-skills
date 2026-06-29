---
name: plan
description: Decompose a non-trivial task into an explicit, tracked plan with goals and per-step acceptance criteria before writing code. Use when the user says "plan this", "break this down", "what's the plan", or asks for a multi-step feature/refactor that touches more than one file. Pairs with plan mode. Skip for single-edit changes that need no decomposition.
disable-model-invocation: true
---

# Plan the work

Turns a task into a decomposed, verifiable plan so execution can loop
independently against a clear finish line — strong success criteria let an agent
self-check; weak ones force constant clarification.

## Steps

1. **State the goal** — one sentence on the end state.
2. **Define acceptance criteria** — the observable conditions that mean the whole
   task is done (tests pass, command output, behavior).
3. **Decompose into steps** — each step is independently shippable where possible,
   ordered by dependency. Every step carries its own one-line verify check.
4. **Flag risks / unknowns** — what could block fast iteration (needs a device, a
   migration, an external API), called out so it's scheduled, not discovered late.
5. **Emit the plan as a TodoWrite list** (one todo per step) so progress is
   trackable and steerable mid-flight.

## Rules

- **Verify check per step, no exceptions.** A step with no way to confirm it
  worked is underspecified — sharpen it.
- **Smallest plan that reaches the goal.** No speculative steps, no abstractions
  the task didn't ask for.
- **Don't start implementing** from this skill — produce the plan, confirm it,
  then execute.

## When NOT to use

- A one-file, one-edit change — just make it.
- The user already gave a step-by-step plan — follow theirs, don't re-plan.

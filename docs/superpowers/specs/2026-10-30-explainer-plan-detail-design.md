# make-explainer plan mode: explain the plan before asking

Date: 2026-10-30. Branch: `worktree-skills-improvement`. This is the fourth item
on the shared branch, added after the first three were planned.

## Intent

The owner opened the plan page for this branch and could not answer its
questions. The page asked for decisions without explaining the plan behind them.
The cause is in the preset: `plan` in `scripts/lib/presets.mjs` is "decision
first". After the verdict and three numbers it goes straight to decisions,
approvals and questions. What gets built shrinks to one goals/non-goals text
block, a three-box diagram and three one-line phases, all placed after the
questions. SKILL.md's writing rules for plans say the same ("put what needs an
answer first", "keep it short").

A reviewer needs to understand what will be built, how and why before they can
answer well.

## Goals

1. **Context comes before questions.** The plan scaffold orders sections as
   follows:
   - tldr and three numbers;
   - **the plan itself**: what gets built, per workstream or phase, with its
     tasks, the files or areas it touches, how each is verified, and the
     choices already made (with why);
   - the architecture diagram, phases and risks;
   - then the decisions, approvals and questions, the "review these first" list
     and the verdict.
2. **Detail sections in the scaffold.** The scaffold adds placeholder sections
   for the plan body:
   - a `cards` section of workstreams (one card per workstream: what it
     delivers);
   - per workstream, a `steps` section of its tasks (title plus one line on
     what it does and how it is checked);
   - a `table` of choices already made (choice, why, who made it);
   - an optional `files` section.
3. **Validate warns on a thin plan.** A plan page with answerable items warns,
   but does not fail, when no detail section (`steps`, `cards`, `table`,
   `files` or `text`) comes before the first decision, approval or question.
   The warning names the fix.
4. **Writing rules change.** In SKILL.md, plan mode says to explain the plan
   (what, how, why, with per-workstream tasks) before anything that needs an
   answer. Each decision's `why` points at the section that explains it.
5. **Page budget fits a real plan.** The 900-word page prose soft cap is too
   small for a plan body. Plan pages get a higher cap.

## Non-goals

- Changing the plan answer format, `answers.mjs`, the plan hash or saved
  answers.
- Removing the "review these first" list or the verdict.
- Making detail sections required. The warning advises; it never blocks.

## Decided (this session's call; owner may override)

- Questions move below the plan body. The tldr still states what is needed from
  the reviewer, so the ask is visible at the top.
- The thin-plan check is a warning, not an error, because existing plan specs
  must keep building (opt-in and backward compatible).

## Left to the builder

- The exact plan-page prose cap (somewhere around 1,800 words).
- Whether the per-workstream `steps` sections are generated from a count
  (`--workstreams N`) or appear once, ready to be copied.
- The updated `references/examples/plan.explainer.json` content.

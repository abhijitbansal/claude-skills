# make-explainer plan mode: explain the plan before asking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `plan` page explains what gets built, how and why (per workstream, with tasks) before any decision, approval or question, and validate warns when a plan page asks without explaining.

**Architecture:** The `plan()` scaffold in `scripts/lib/presets.mjs` gains plan-body sections and moves the answerable items below them. A new warning in `scripts/lib/semantic.mjs` `warnSections` checks the section order. `scripts/lib/budget.mjs` gets a plan-page prose cap. SKILL.md, `references/sections.md` and the plan example follow.

**Tech Stack:** Node >= 20 ESM, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-30-explainer-plan-detail-design.md`

## Global Constraints

- Runs after the explainer KPI plan and before the harness plan (both touch make-explainer docs and the CHANGELOG `## [Unreleased]` section).
- The answer format, `answers.mjs`, `plan-hash.mjs` and saved answers do not change.
- Existing plan specs keep validating: the new check is a warning only.
- Paths below are relative to `plugins/portable-artifacts/skills/make-explainer/`.
- Commits: conventional, ending with the single trailer `Co-Authored-By: Claude <noreply@anthropic.com>` (AGENTS.md). The orchestrating session commits; implementers do not.
- Dispatch: implementer is executor tier (Sonnet, effort high). The reviewer is reviewer tier (Opus, effort medium), report-only, and gets the report-everything sentence from `~/.claude/rules/ecc/common/code-review.md` verbatim.

## Review Focus

1. A plan whose only detail section comes *after* the questions must still warn. Order matters, not presence. Covered in Task 2.
2. A non-plan page with no answerable items must never get the new warning. Covered in Task 2.
3. The scaffold's TODO strings for the new sections must be caught by validate as placeholders, like the existing ones. Covered in Task 1.
4. The plan example must stay warning-free under the new rules. Covered in Task 3.
5. A long plan body must not trip the page prose warning below the new cap. Covered in Task 2.

---

### Task 1: plan scaffold — body first, questions after

**Files:**
- Modify: `scripts/lib/presets.mjs` (the `plan()` function and its comment block, about lines 236–330)
- Test: `test/plan-preset.test.mjs`

**Interfaces:**
- Produces: the scaffold section order `tldr, kpis, cards(workstreams), steps(workstream tasks), table(choices made), diagram, steps(phases), details(risks), decision, approval, question, review, verdict`. The ids `decision-1`, `approval-1`, `question-1` and the verdict are unchanged.

- [ ] **Step 1: Write the failing test.** Rewrite `'scaffold plan: decision first, in this order, with fixed ids and the verdict last'` as `'scaffold plan: the plan body comes before anything that needs an answer'`. Assert the type order listed above. Assert that the index of the first `cards`/`steps`/`table` is less than the index of `decision-1`. Assert that the `cards` section has 2 TODO cards, the `table` has columns `['Choice', 'Why', 'Made by']`, and the verdict is last.
- [ ] **Step 2: Run** `node --test test/plan-preset.test.mjs`. Expected: FAIL on the order assertion.
- [ ] **Step 3: Implement.** Add `planBody()` returning the three body sections, with TODO prompts:
  - "what this workstream delivers, one line";
  - "task: what it does and how it is checked";
  - "a choice already made", "why", "who made it".

  Reorder `plan()`. Rewrite the comment block to "context first".
- [ ] **Step 4: Run** `node --test test/plan-preset.test.mjs`. Expected: PASS, including the existing `'validate rejects the starter only for its TODOs'` test (Review Focus 3).
- [ ] **Step 5: Commit** `feat(make-explainer): plan scaffold explains the plan before asking`.

### Task 2: thin-plan warning and a plan prose cap

**Files:**
- Modify: `scripts/lib/semantic.mjs` (`warnSections`), `scripts/lib/budget.mjs` (`SOFT_CAPS`, the page check at about line 227)
- Test: `test/plan-spec.test.mjs`, `test/budget.test.mjs`

**Interfaces:**
- Produces: the warning at path `sections` with the message `a plan asks before it explains: add steps, cards, table, files or text sections that say what gets built before the first decision, approval or question`. Add `SOFT_CAPS.planPageWords = 1800`, applied when `spec.preset === 'plan'`.

- [ ] **Step 1: Write the failing tests.**
  - `'warns when no detail section precedes the first answerable item'`: a plan of tldr, decision and verdict gets exactly that warning.
  - `'warns when the only detail section comes after the questions'` (Review Focus 1).
  - `'no warning when a steps section precedes the first decision'`.
  - `'no warning on a page without answerable items'`: a concept page (Review Focus 2).
  - In budget: `'a plan page under 1,800 words gets no page-prose warning; a concept page over 900 still does'` (Review Focus 5).
- [ ] **Step 2: Run** `node --test test/plan-spec.test.mjs test/budget.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `warnSections`: find the first section whose type is in `PLAN_ITEM_TYPES`, and warn if no section before it has a type in `{steps, cards, table, files, text}`. In budget, pick the cap with `spec.preset === 'plan' ? planPageWords : pageWords`, and keep the message format.
- [ ] **Step 4: Run** both test files plus `node --test test/validate-cli.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(make-explainer): warn when a plan asks before it explains`.

### Task 3: docs, example and release notes

**Files:**
- Modify: `SKILL.md` ("Plan mode" step 1 and step 3 writing rules), `references/sections.md` (plan preset order), `references/examples/plan.explainer.json` (add a workstream `cards`, a per-workstream `steps` and a choices `table` before `decision-1`), `README.md`, `../../USAGE.md`, `../../CHANGELOG.md` (`## [Unreleased]`), the site feature page row for plan mode (per-line copy-button rule in CLAUDE.md)
- Test: `test/plan-preset.test.mjs` (`'the plan example validates with no errors and no warnings…'`), `test/golden.test.mjs`

- [ ] **Step 1: Update the example test's title** to "…context first, verdict last". Assert that the first answerable item comes after a detail section. Run it. Expected: FAIL.
- [ ] **Step 2: Edit the example and docs.**
  - SKILL.md step 3 becomes: "Explain the plan first: one card per workstream, its tasks as steps (what each does and how it is checked), the choices already made in a table, with why. Then what needs an answer. Each decision's `why` names the section that explains it."
  - Remove "put what needs an answer first".
- [ ] **Step 3: Run** `npm test` in the skill folder. Expected: PASS. Regenerate goldens only for the plan example, and state that in the commit (the plan's own baseline rule).
- [ ] **Step 4: Commit** `docs(make-explainer): plan mode explains before it asks`.

## Self-review notes

- Spec goals 1–5 map to Task 1 (goals 1–2), Task 2 (goals 3 and 5) and Task 3 (goal 4).
- `PLAN_ITEM_TYPES` already exists in `semantic.mjs` (it is used by `checkSections`). Reuse it.

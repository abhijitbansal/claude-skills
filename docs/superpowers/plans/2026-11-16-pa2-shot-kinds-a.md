# make-motion 2: Shot Kinds, First Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five more shot kinds (`end`, `list`, `quote`, `compare`, `chart`) composed for the two shipped looks, `desk` and `pop`, at 16:9 and 9:16, each passing the film's own review and a look review of its frames.

**Architecture:** A kind is a registry entry that turns one shot of the spec into scene-graph nodes for a look and a format, exactly as `statement`, `number` and `clipping` do. Each kind owns its fields, its composition per look (read from look data, never from a look's name), its word-anchored timing, the devices it uses and its own review rules. No engine feature is added unless a kind cannot be built without it.

**Tech Stack:** The version 2 engine as it stands (scene graph, text layout, devices, cuts, review, captions, sound). `node:test`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, sections 5 (art direction), 6.1 (shots) and 8.5 (review). The look gate record and its bar: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/`.

## Global Constraints

- Version 1 files are not modified. No new npm package. No network.
- A kind lives in `engine/kinds/<kind>.mjs` (split into `<kind>-*.mjs` before 800 lines). Pure functions, immutable data, no `Math.random`, `Date` or wall-clock time; randomness only through `engine/seeded.mjs`; nothing touches `document` or `window`.
- Everything that differs between looks is look data (`look.composition`, `look.kinds.<kind>`, fonts, scale, devices). No branch on a look's or a mode's name. A look that has no data for a kind does not support it, and a film that asks for it in that look is a validation error naming the looks that do.
- Sizes are in units (short side / 1080). Text is never under the look's minimum. The typography rules of design 5.2 bind: a hero at least three times the supporting text, no more than three sizes on a frame (frame furniture excluded), breaks by sense, numerals with fixed advances, one emphasis system per look.
- Design 5.4: an asymmetric default; the hero sits on a grid line; one hero per frame; vertical formats are designed, not reflowed. In `pop`, text stays inside the platform safe zone and statements are stacks.
- Words arrive with the narration: every text a kind reveals over time is anchored to the shot's words (estimated or measured) through the same helpers the existing kinds use; a shot's first word shows on its first frame; no shot opens on an empty frame.
- Each kind declares `summary`, `example` (one valid shot, used by `--list kinds` and by the examples review), `fields` (validated, with did-you-mean), `targets` (what an `on` event can point at), `numbered`, `showsWords`, and `review` where it has rules of its own.
- Every example reviews clean (no mechanical and no creative finding) in `desk` and `pop` at 16:9 and 9:16; the existing sweep in `test/v2/review-browser.test.mjs` covers every `--list kinds` example and must stay green.
- The implementer looks at what it makes: for each kind, each look and each format it renders the example's sheet, views it, and says what the frame shows. A composition that looks wrong is changed; a review rule is not loosened to pass it.
- Sounds: a kind that lands something (a bar reaching its value, a list item arriving) exposes it as a `land` or `device` event the cue plan already understands; a new event kind is not added.
- Files under 800 lines, functions under 50, named constants, tests first, a mutation row for a test written after its code.

## Review Focus

1. Text that does not fit: a long list item, a long quote, a category label wider than its bar, a compare side with one word and one with thirty. Each must fit down to the reading floor or give a creative finding that says what to cut; none may overflow silently.
2. Numbers: negative values, zero, very large values, decimals, a series of one, all values equal, a value with a unit. Axes and labels must be honest (a bar chart's baseline is zero unless the film says otherwise and the frame shows it).
3. Timing without narration: a kind with `hold` and no `say`, and a kind with fewer sentences than items.
4. Both formats and both looks for every kind, including an `on` event whose target the kind does not have.
5. A kind used with captions on, and with sound on, in a voiced film.

## File Structure

- `engine/kinds/end.mjs`, `list.mjs`, `quote.mjs`, `compare.mjs`, `chart.mjs` (+ `chart-marks.mjs`, `chart-scale.mjs`), registered in `engine/kinds/index.mjs`.
- `engine/looks/desk.mjs`, `pop.mjs`: a `kinds.<kind>` entry each.
- Tests: `test/v2/kinds-<kind>.test.mjs`, and the browser sweep.
- Examples: `references/examples/v2/kinds-desk.json`, `kinds-pop.json` (one film per look that uses all five).

---

### Task 1: `end`

**Fields:** `title` (the closing line; default the shot's `say` plain text), `ask` (a short call to action), `mark` (a short wordmark or name, text only), `src` (an optional logo image inside the film's folder).

**Composition.** desk: the title as the hero in the display face on the grid's left columns, the ask under it in the text face, the mark on a taped card bottom right (the slug card device, no number). pop: a stack (mark as a tag over it, title lines fitted to the safe width, the ask as the last line in the accent). The picture, when given, sits where the mark would, at most a sixth of the short side.

- [ ] **Step 1: Failing tests.** Fields validate (unknown key did-you-mean; a `src` outside the folder refused); the example builds nodes with one hero; desk and pop place the pieces as above (hand-computed positions for the example at 16:9); words arrive with the narration and the first word is on frame 0; the mark never counts as a second hero; `--list kinds` shows the kind.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view the four sheets.

### Task 2: `list`

**Fields:** `items` (2 to 6 strings, or objects `{ text, note? }`), `title` (optional), `numbered` (boolean, default false), `style` (`points` | `steps`, default `points`).

**Timing.** One item per sentence of `say` when the counts match; otherwise items are spread evenly over the narration; with `hold` and no `say`, items arrive at equal intervals. Each arrival is a `device` event named `item` for the cue plan.

**Composition.** desk: the title as a slug-style kicker or small heading; items in the display face down the grid's left columns, each revealed whole, the current item in ink and earlier ones in ink2; with `numbered` or `steps`, figures in the label face hang in the margin with fixed advances. pop: one item on screen at a time as a stack (the list is a sequence of hits, not a column), with a count tag "2 / 5" in the kicker position. Review rule of its own: more than 6 items, or an item over 12 words, is a creative finding ("split the list" / "cut words").

- [ ] **Step 1: Failing tests.** Timing in the three cases; desk shows all arrived items and dims earlier ones; pop shows one at a time and the count tag; the two findings; items that do not fit give the creative fit finding, not overflow; `on` targets `item:<n>`.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 3: `quote`

**Fields:** `text` (the quotation; default the `say` plain text), `by` (who), `role` (optional), `src` (optional portrait, used as a cut-out).

**Composition.** desk: the quotation on a paper card (card device, slight tilt) in the display face with hanging opening quote mark, the attribution under it in label caps after a short rule; a portrait, when given, is a cut-out with keyline overlapping the card's corner. pop: the quotation as a stack with the opening mark as a giant accent glyph behind the first line; the attribution as a tag. Emphasis follows the look's system.

- [ ] **Step 1: Failing tests.** Hanging punctuation (the opening mark's ink sits outside the text's left edge); attribution placement; the portrait never covers text (overlap rule holds); a quotation of 40 words fits or gives the fit finding; the quote marks are added by the kind and never doubled when the author typed them.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 4: `compare`

**Fields:** `left` and `right`, each `{ title, points?: string[] (at most 3), value?: number | string, src? }`; `mode`: `versus` (default) or `before-after`.

**Timing.** The left side arrives with the first sentence and the right with the second (or at the narration's midpoint); `on` targets `left`, `right`.

**Composition.** desk: two paper cards side by side on the grid (stacked at 9:16), the side being spoken in full ink and the other dimmed with the focus device; a hand-drawn `vs` or an arrow (`before-after`) between them. pop: one side at a time, a hard cut inside the shot at the turn, each side a stack with its title as the hero and a tag `A` / `B` or `BEFORE` / `AFTER`. A value, when given on both sides, is set as a numeral and the larger is not styled as better (the film says which matters).

- [ ] **Step 1: Failing tests.** Arrival times; the dim on the unspoken side; stacking at 9:16; unequal content (one side with three points, one with none) still balances inside the grid; a side missing its title is a validation error.
- [ ] **Step 2 to 4:** run red, implement, run green. Render and view.

### Task 5: `chart`

**Fields:** `type` (`bar` | `column` | `line` | `area` | `donut`), `data` (`[{ label, value }]` for bar, column, donut; `[{ x, y }]` or `{ series: [{ name, points }] }` for line and area; at most 12 marks or 3 series), `title` (the claim, a sentence), `unit`, `highlight` (a label or series name), `baseline` (number, default 0), `source` (a short line). `scatter` and `race` are a later wave.

**Honesty rules (mechanical findings of its own).** A bar or column chart whose `baseline` is not 0 must show a broken-axis mark and say the baseline in a label; a donut needs 2 to 6 non-negative values; a line needs at least 2 points per series; values must be finite. Direct labels, never a legend; no gridlines beyond a baseline and at most three light reference lines.

**Timing.** Marks grow from the baseline or draw left to right over the first sentence; the `highlight` mark changes to the accent, and every other mark dims, on the word that names it (or at the second sentence); its value label lands then, exposed as a `land` event.

**Composition.** desk: the title as a serif heading top left, the chart on a paper card or directly on the paper with ink marks and one accent, labels in the label face, the source line bottom left in small caps. pop: the title as a kicker tag, big marks filling the safe width, the highlighted value as a numeral that punches. Scales and ticks come from `chart-scale.mjs` (nice numbers, fixed digit advances).

- [ ] **Step 1: Failing tests.** `chart-scale`: nice ticks for a range of inputs, negative and zero ranges, one value, all equal; each type builds the right marks for a small fixture, with hand-computed geometry for one bar chart; the honesty findings each fire; the highlight timing; labels never overlap each other or leave the frame (the fit finding when they cannot).
- [ ] **Step 2: Browser tests** for label measurement with the real fonts.
- [ ] **Step 3 to 4:** implement; run; render and view every type in both looks and formats.

### Task 6: Two films and a look review

**Files:** `references/examples/v2/kinds-desk.json`, `kinds-pop.json`.

- [ ] **Step 1: The controller writes** one film per look that tells one small story with all five new kinds plus the three old ones, voiced, with sound on.
- [ ] **Step 2: Render** both through `make.mjs`; zero findings; the controller views every sheet.
- [ ] **Step 3: Independent look review** (a fresh reviewer, sheets only, the same brief as the look gate). The same rule as for a new look: SHIP for a kind's frames, or at most two revision rounds; a kind that still fails is left out of the documented set and recorded for the owner.

## Not in this plan

`screen`, `media`, `map`, `diagram`, `timeline`, `code`, `feed`, chart types `scatter` and `race` (second wave); the five other looks (their own plan, `cosmos` first, each bringing its `kinds`, `sounds` and caption data); the cut-over.

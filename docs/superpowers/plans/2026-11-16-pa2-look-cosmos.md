# make-motion 2: The `cosmos` Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third look, `cosmos` (flat vector science explainer: deep navy to violet, saturated shapes, one glowing accent, a rounded sans), that supports every shipped shot kind at 16:9 and 9:16 and passes the same look gate as `desk` and `pop`.

**Architecture:** A look is data plus the few engine pieces its data names: a field (the ground), device styles, a caption style, sounds. `cosmos` adds one field (`cosmos`: a layered gradient with a seeded star field and soft glow), a rounded card and callout style for the devices, a glow emphasis, and its `kinds` data. It reuses the existing composition families where they fit and adds a family only where the look's design needs one. Nothing branches on the look's name.

**Tech Stack:** The version 2 engine as it stands. One new bundled font (a rounded sans under the SIL Open Font License), inside make-motion only. `node:test`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, section 5.1 (the `cosmos` row: no characters or mascots; scenes are built from shapes, scale and light), 5.2 to 5.4. The gate's bar and record: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/`.

## Global Constraints

- Version 1 files are not modified. No new npm package.
- The font: one rounded sans family under the SIL Open Font License, a variable weight axis if the family has one, Latin subset, WOFF2, fetched once from a pinned package version with its SHA-256 recorded, stored in `engine/fonts/` with its licence text in `engine/fonts/LICENSES` and a row in `engine/fonts/SOURCES.md` (name, version, source URL, licence, SHA-256, bytes). New font bytes in make-motion stay within the design's 600 KB budget (206 KB used). The font check in `engine/fonts/CANVAS-NOTES.md` is repeated for it (does canvas text reach its weight axis).
- No network at run time: the font is bundled, the star field and every texture are generated from the film's seed. No image assets.
- Art direction, binding: field deep navy `#0b1030` to violet `#2a1a5e`, ink `#f4f1ff`, ink2 `#a9a4d6`, accent (the glow) `#ffd166`, accent2 `#4de2c5`, plus two shape colours `#ff6b9a` and `#6ea8ff` for charts and compare. Type: the rounded sans at medium to bold weights, generous sizes; labels in the same family, sentence case, inside rounded callouts. No paper, no tape, no halftone. Depth comes from layered gradients, glow falloff and a slow constant float; no character art.
- Emphasis system (one per look): the emphasised words take the accent colour with a soft glow behind them. Devices: a card is a rounded rectangle with a faint inner gradient and a 1-unit lighter edge; a tag is a pill; highlight is a glow pill behind the phrase; circle and underline are smooth strokes with round caps (no hand wobble, no stepped frames); arrow has a round head; a callout is a pill with a leader line ending in a dot.
- Motion grammar: smooth ease-in-out with a small overshoot; entrances scale from 0.92 with a fade; the field's stars drift slowly (a constant gentle float); cuts are `cut` and `match`; no shake.
- Everything that differs from the other looks is this look's data or a named style a look selects; no branch on a look's or mode's name; the engine's purity rules hold (no `Math.random`, `Date`, DOM outside `engine/page/`).
- The typography and layout rules of design 5.2 and 5.4 bind, and every rule the review enforces (safe area, minimum size, contrast 3:1, hero ratio, at most three sizes, no empty first frame, captions clear of marks).
- Modes: `cosmos` serves `pro` and `viral`; at 9:16 in the viral mode it composes inside the platform safe zone.
- Every shipped kind (`statement`, `number`, `clipping`, `end`, `list`, `quote`, `compare`, `chart`, and `free` as far as a look applies) has `kinds` data in this look; each kind's example reviews clean at 16:9 and 9:16 and joins the examples sweep.
- The implementer looks at every frame it makes and says what it shows. A composition that looks wrong is redesigned; a review rule is not loosened.
- The gate: zero mechanical and zero creative findings on the gate film, and an independent reviewer who has not seen the design says SHIP. At most two revision rounds. If the look still fails, it is parked: kept on the branch, marked experimental in its data, left out of the docs and the `--list looks` default output, with the frames and reviews recorded for the owner (the owner's decision for the unattended run).

## Review Focus

1. Contrast on a dark, saturated field: ink2 and the two shape colours against the gradient at its lightest point, text over a glow, and dimmed marks in a chart.
2. Glow: it must never make text unreadable, exceed the frame, or change the measured ink box the review uses.
3. The star field: deterministic from the seed, identical across frames except for its drift, never behind text at a density that hurts legibility, cheap enough that the render time per frame stays within 1.5 times `desk`'s.
4. A clipping (a white screenshot) on a dark field: it must look placed, not pasted.
5. Vertical viral films: everything inside the platform safe zone, the hook on frame 0.

## File Structure

- `engine/fonts/<family>-latin-…​.woff2`, `LICENSES`, `SOURCES.md`, `index.mjs`, `CANVAS-NOTES.md`.
- `engine/fields/cosmos.mjs` (+ `index.mjs`).
- `engine/devices/*.mjs`: a `rounded` style where a device needs one (card, tag, highlight, marks, arrow), selected by look data.
- `engine/looks/cosmos.mjs` (+ `index.mjs`).
- `engine/captions/pill.mjs` (or a `pill` variant of an existing style).
- `engine/kinds/*`: only what a composition family lacks for this look.
- Tests: `test/v2/looks.test.mjs`, `fields.test.mjs`, `devices*.test.mjs`, `kinds-*.test.mjs`, the browser sweeps.
- Films: `references/examples/v2/gate-cosmos.json` (pro, 16:9) and `gate-cosmos-viral.json` (viral, 9:16).

---

### Task 1: Font, field and the look's base data

- [ ] **Step 1: Choose and bundle the font.** Candidates under the Open Font License: Nunito, Quicksand, Varela Round, M PLUS Rounded 1c. Choose by rendering "Scale changes everything 0123456789" at display and label sizes on the field and looking; state the choice and why. Fetch the Latin WOFF2 from the family's Fontsource package at an exact version, record the SHA-256 and bytes, add the licence text and the SOURCES row, register it in `engine/fonts/index.mjs`. Failing test first: the fonts test (file present, hash matches the SOURCES row, total new bytes within budget, licence text present).
- [ ] **Step 2: The field.** `cosmos`: a vertical gradient between the two field colours with a soft radial lift behind the hero area, two layers of seeded stars (small dots, three sizes, 60 to 140 per layer at 16:9 scaled by area) drifting at different slow speeds, and a faint vignette. Tests: deterministic for a seed; a star's position at time t is its position at 0 plus drift; density stays under a named cap inside the text area the kind reports; the field declares `animated: true`.
- [ ] **Step 3: Look data** in `engine/looks/cosmos.mjs`: palette, fonts, type scale `[32, 46, 76, 136, 232]`, grid (margin 96, gutter 24 at 16:9; the platform safe zone at 9:16 viral), composition family for statements (state which and why), emphasis `glow`, moves, camera (a slow drift), cuts, grain 0.01, `sounds` (cut `null`, slide `whoosh`, punch `sub`, match `null`; highlight `chime`, underline `chime`, circle `chime`, item `pop`, turn `whoosh`, others `null`; emphasis `null`; land `ding`), `captions` style, `modes: ['pro', 'viral']`. Tests in `looks.test.mjs`: registration passes validation; every registered cut, device and kind event device has a sound entry; contrast of ink, ink2, accent and both shape colours against both field colours is at least 3:1 (compute it in the test).
- [ ] **Step 4: Run** the fonts, fields and looks tests; render the field alone and a statement on it at both formats; view.

### Task 2: Device styles and emphasis

- [ ] **Step 1: Failing tests** for each style the look selects: card (rounded, radius from look data, no tilt, no tape), tag (pill), highlight (a pill with a glow behind the phrase that contains the phrase's ink and never touches a neighbouring line), circle and underline (smooth, round caps, drawn in one continuous move, no stepping), arrow (round head), the paper scrim's equivalent for a dark field (a field-coloured scrim), and emphasis `glow` (accent fill plus a blurred accent copy behind, the glow excluded from the ink box). Each is chosen by look data; `desk` and `pop` render exactly as before (the scene-graph snapshot of every kind's example in those two looks is unchanged).
- [ ] **Step 2 to 4:** run red, implement, run green; view each device on the field.

### Task 3: Every kind in `cosmos`

- [ ] **Step 1: Failing tests.** Add `cosmos` to the examples sweep (`review-browser`) and to each kind's composition tests: every kind's example builds in `cosmos` at 16:9 and 9:16 with no finding; a kind the look has no data for is refused.
- [ ] **Step 2: `kinds` data and compositions**, one kind at a time, rendering and viewing each at both formats: `statement` (large rounded type, flush left on the grid, emphasised words glowing; the kicker as a pill top left), `number` (the numeral as a glowing figure with an orbit ring that completes as it counts, the label in a callout), `clipping` (the picture on a rounded card with a soft glow edge and a field scrim outside the marked region), `list` (items as callouts joined by a thin vertical line with a dot per item, the current dot lit), `quote` (a rounded card with a large accent opening mark, attribution as a pill), `compare` (two rounded cards, the unspoken side under the field scrim, a smooth arrow or `vs` pill between), `chart` (rounded bar ends, the two shape colours for marks, the accent for the highlighted mark with a glow, labels in callouts only where they do not crowd), `end` (the closing line with a slow ring around the mark pill).
- [ ] **Step 3: Captions** in the look's style: a pill at the bottom of the grid, the spoken word in the accent.
- [ ] **Step 4: Run** every kinds test, both browser sweeps and the whole v2 suite once.

### Task 4: The gate

- [ ] **Step 1: The controller writes** `gate-cosmos.json` (pro, 16:9) and `gate-cosmos-viral.json` (viral, 9:16), each using at least five kinds, voiced, with sound on.
- [ ] **Step 2: Render** both; zero findings; the controller views every sheet and records render time per frame against `desk`.
- [ ] **Step 3: Independent look review** (fresh reviewer, sheets only, the gate's brief). SHIP on both films passes. Otherwise up to two revision rounds, then park the look as the Global Constraints say.
- [ ] **Step 4: Record** the results in the gate report.

## Not in this plan

The other four looks (`ledger`, `keynote`, `poster`, `marker`), each with its own plan in this shape; the second wave of shot kinds.

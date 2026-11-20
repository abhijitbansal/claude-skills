# make-motion 2: The Four Remaining Looks (`ledger`, `poster`, `keynote`, `marker`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four more looks, each a complete art direction carried as data, each supporting the registered shot kinds at 16:9 and 9:16, each built and gated in turn: `ledger` (newsroom data film), `poster` (kinetic type and cut paper), `keynote` (product launch film), `marker` (whiteboard time-lapse drawn by a hand). A look that does not pass its gate is parked as experimental, not shipped weak.

**Architecture:** A look is data plus the few engine pieces its data names (a field, device styles, an emphasis style, a caption style, cuts, sounds). The four looks reuse the two composition families that exist (`editorial`: flush left on grid columns; `stack`: short lines each fitted to the width) and add a composition only where the table for that look says so. Emphasis becomes a table of named styles, so four new emphasis systems are four entries, not four more `if`s in `statement.mjs`. `marker` adds one engine piece no other look has: a drawing hand that follows the strokes on screen. Nothing branches on a look's or a mode's name, and a new guard test proves it.

**Tech Stack:** The version 2 engine as it stands at `8093b24b`. Two new font files (Geist variable for `keynote`, Caveat for `marker`), both under the SIL Open Font License, inside make-motion only. `node:test`. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-15-portable-artifacts-2-design.md`, sections 5.1 (the look table), 5.2 (typography, binding), 5.3 (devices), 5.4 (layout, binding), 8.3 (moves), 8.4 (graphics), 9.3 (captions), 9.4 (sound). House style and gate rules: `docs/superpowers/plans/2026-11-16-pa2-look-cosmos.md`. What failed at earlier gates and why: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` (every section). Open owner calls: `docs/decisions-pending.md`.

All paths are relative to `plugins/portable-artifacts/skills/make-motion/` unless they start with `docs/`.

## Global Constraints

**Process**

- Order: groundwork, the hand spike, then `ledger`, `poster`, `keynote`, `marker`. A look's gate closes (shipped or parked) before the next look starts. The hand spike runs early because it is the riskiest piece; its result decides what `marker` is before any other marker work is spent.
- Implementers do not commit. The controller commits after each task on the branch `worktree-New-Motion`, with the single trailer `AGENTS.md` names. No push to `main`, no merge.
- Version 1 files are read, never modified and never imported: version 1 is deleted at cut-over. What `marker` needs from `template/sketch/` is copied into `engine/`.
- One browser run at a time (`pgrep -fl chrome-headless-shell` first). Films render with `ALLOW_BROWSER_RUN=1 node scripts/make.mjs references/examples/v2/<film>.json --json`. The suite is `node --test --test-concurrency=1 "test/v2/**/*.test.mjs"`.
- The implementer looks at every frame it makes and says what it shows. A composition that looks wrong is redesigned. No review rule is loosened, no test is weakened, no frozen fixture is regenerated to clear a red test.
- Every quantitative claim in a report says how it was obtained (the command, or "estimated").

**Engine rules**

- Everything that differs between looks is look data or a named style a look selects. No comparison on a look's or a mode's name anywhere in `engine/` or `scripts/v2/` (Task 1 adds the guard). The purity rules hold: no `Math.random`, `Date`, DOM outside `engine/page/`.
- `validateLook` requires a sound (or `null`) for every registered cut and device and a Move (or `null`) for every registered move. A task that registers a new cut, device or move adds the entry to `desk`, `pop`, `cosmos` and every look already added by this plan, in the same commit (the registry sweep). This plan registers exactly one new cut (`erase`, Task 2) and no new device or move.
- A new look registers with `experimental: true` from its first task and stays hidden from every listing until its gate says SHIP. The tests that pin the listing (`looks.test.mjs`, `cosmos-look.test.mjs`, `look-experimental.test.mjs`, `kinds-parked.test.mjs`) keep asserting `['desk', 'pop', 'cosmos']` until a look's gate task changes them; `allLookNames()` assertions grow by one name per look in that look's first task.
- A kind a look has no `kinds.<kind>` data for is refused by `kindSupportProblems` with the looks that support it. A kind whose example cannot be made clean in a look is parked in that look alone (`kinds.<kind>.experimental: true`, or `kinds.chart.experimentalTypes` for one chart type) and never blocks the look.
- A film's `accent` override must move every colour the look derives from its accent. Every such colour in look data is the palette key `accent`, never a repeated hex (the `cosmos` code review found the sun and glow left behind).
- Frozen frames: `desk`, `pop` and `cosmos` render exactly as they do at `8093b24b`. Task 1 widens the frozen fixture before any engine edit.
- Fonts: the two new files are Latin subset WOFF2, fetched once from a pinned `@fontsource` package version with SHA-256 and bytes recorded, stored in `engine/fonts/` with the licence text in `engine/fonts/LICENSES/` and a row in `engine/fonts/SOURCES.md`. Bytes used today: 250,248 of the 600 KB budget (measured, `SOURCES.md`). Stop rule: if a file would take the total over the budget the test holds, the task stops and reports; it does not raise the budget.
- No network at run time. Every texture, wobble and board smear is generated from the film's seed. No image assets.
- Render cost per frame is recorded against `desk` for each gate film. Over 1.5 times is a finding the look's task fixes (an animated field stops held frames from being reused: `cosmos` measured 2.13 times on a still shot).

**Banned up front (each failed an earlier gate; the source is in the gate record)**

1. A dark slide-deck look: text on a near-black ground with a coloured accent and nothing else. `keynote` ships on its light ground only (Task 9).
2. An empty half of the frame. Every composition states what fills a tall frame; a block that leaves more than 35 percent of the composition area empty at 9:16 is redesigned (the kinds gate found 39 to 56 percent).
3. Size-class tricks to dodge the 3x hero rule: no `stack` tag, `furniture` role or tag exemption on a text that carries meaning. Frame furniture is a slug or a caption card and nothing else.
4. Small text at phone size: each look sets `secondary.min`, and no meaning-carrying text is set under it. Mono or caps labels are not used for content.
5. Ghosted or empty first frames: no shot opens on an empty frame or on half-entered parts; a viral hook opens at full contrast (`hookInk: true`); no translucent unspoken words.
6. Muddy colour fades: every colour change is mixed in OKLab (`colorSpace: 'oklab'`); a dim is an opaque mix toward the ground, never an ink overlay.
7. Glow on things that are not light. None of these four looks has a glow emphasis; `post.bloom` is 0 in all four; the only light is `keynote`'s `sweep`.
8. Science or data errors: every figure in an example or a gate film comes from the bundled example data or a stated source in the film's `source` field; a scale drawn is the true scale; no invented quotations, people or contact details.
9. A device drawn two ways: each motif (a tag, a leader line, a cut-paper bar, the hand, a card) has one builder, used by every kind.
10. A highlight or emphasis over half a statement's words, three identical cuts in a row, a caption card over a chart mark, a figure sliced by the frame edge.

**The gate (the same for each look; each look's gate task refers here)**

- The controller writes two films: `references/examples/v2/gate-<look>.json` (16:9) and `gate-<look>-tall.json` (9:16), each with at least six kinds, voiced, sound on, in the look's own modes.
- Both render with zero mechanical and zero creative findings. The controller views every sheet and records frames, render time per frame against `desk`, loudness and file size from the command's JSON report.
- A fresh independent look reviewer who has not seen this plan or the design judges the contact sheets only, with the gate's brief, and carries the code-review rule's sentence that the finding stage never filters. Report only: the reviewer writes no project file.
- SHIP on both films passes. Otherwise at most two revision rounds, each followed by a new fresh reviewer. If the last verdict is not SHIP on both films the look is parked: `experimental: true` stays, it is left out of the docs, and the frames and reviews are recorded for the owner. (`cosmos` was listed on "ship after fixes, no shot failing" only because the owner asked; that is a controller decision here, not the rule.)
- Rulings made in a revision are written into the gate record so a later reviewer's opposite taste does not flip them.

## Review Focus

1. **The hand** (Task 2): the tip sits on the stroke end on every frame; the hand never rests over finished text; it reads as a hand holding a marker at phone size; frame 0 of every board is not empty although nothing fades in.
2. **Weight that changes on screen** (`ledger`, `keynote`): advances are reserved at the heaviest weight so no word moves when a weight changes; a light word in a heavy word's room must not look loosely spaced.
3. **Contrast on every ground**: `poster` has four grounds and two banned pairs; `keynote` has a mesh whose two blob colours are grounds; `ledger`'s dimmed series sits at 3.28:1, close to the floor. The contrast table of each look is computed in a test, never asserted from this document.
4. **The frozen looks**: the emphasis table and the reserved-advance text change touch `statement.mjs` and the text layout. The widened frozen fixture is the proof that `desk`, `pop` and `cosmos` did not move.
5. **Tall frames**: every look is designed at 9:16, not reflowed; `poster` in the viral mode composes inside the platform safe zone with the hook on frame 0.
6. **Data honesty in `ledger`**: bars start at zero, a line's axis is labelled when it does not, a direct label never sits on another mark, the dimmed series keep their true values.
7. **Sameness**: the gates found "four of five shots share one layout" twice. Each look's kinds table names what makes a statement, a quote and an end card differ.

## File Structure

- `engine/looks/ledger.mjs`, `poster.mjs`, `keynote.mjs`, `marker.mjs`; `engine/looks/index.mjs` (import and register each; the typedef gains the new emphasis and composition names).
- `engine/kinds/emphasis.mjs` (new): the emphasis styles as a table; `engine/kinds/statement.mjs` reads it.
- `engine/text/layout.mjs`, `engine/graph/sample.mjs`, `engine/page/draw.mjs`: a per-word `weight` track with advances reserved at a stated weight.
- `engine/fields/grid.mjs` (ledger), `flat.mjs` (poster), `board.mjs` (marker); `engine/fields/mesh.mjs` (two optional params, `colours` and `sway`, for keynote); `engine/fields/index.mjs`.
- `engine/hand/geometry.mjs`, `strokes.mjs`, `pose.mjs`, `shape.mjs`, `index.mjs` (new): the drawing hand. `engine/cuts/erase.mjs` (new) and `engine/cuts/index.mjs`.
- `engine/devices/*.mjs`: a `ruled` style (ledger), a `cut` style (poster), an `elevated` style (keynote), a `drawn` style (marker), each selected by look data, on the devices the look's table names.
- `engine/captions/*.mjs`: a variant selected by look data where an existing style is close; a new style only where the table says so.
- `engine/fonts/geist-latin-wght-normal.woff2`, `caveat-latin-wght-normal.woff2` (or the static 700 if the variable file breaks the budget), `LICENSES/geist.txt`, `LICENSES/caveat.txt`, `SOURCES.md`, `index.mjs`, `CANVAS-NOTES.md`.
- `scripts/v2/sound/synth.mjs`: one new cue, `erase`.
- Tests: `test/v2/helpers/look-contract.mjs` and `helpers/frozen.mjs`; `test/v2/look-names.test.mjs`, `emphasis.test.mjs`, `text-weight.test.mjs`, `kinds-frozen.test.mjs` (+ `fixtures/kinds-frozen-2.json`), `hand.test.mjs`, `hand-browser.test.mjs`, `cuts-erase.test.mjs`; per look `<look>-look.test.mjs`, `<look>-devices.test.mjs`, `<look>-kinds.test.mjs`, `<look>-examples-browser.test.mjs`.
- Films: `references/examples/v2/gate-<look>.json` and `gate-<look>-tall.json` for each look; `references/examples/v2/hand-spike.json`.
- Records: `docs/superpowers/plans/2026-11-15-pa2-gate-report.md` (one section per look), `docs/decisions-pending.md`.

## Interfaces shared by every look task

```js
// test/v2/helpers/look-contract.mjs
// Runs the assertions every look owes. `grounds`: every #rrggbb a text or mark can sit on; `pairs`: [fg, ground, min]
// for every pairing the look permits; `banned`: [fg, ground] pairings no kind may produce.
// `listed`: false while the look is experimental (the default), true once its gate says SHIP.
export function lookContract(name, { modes, grounds, pairs, banned, secondaryMin, kinds, parked = {}, listed = false }) {}

// engine/kinds/emphasis.mjs
// name -> { wordTracks(look, word, at, ctx) -> tracks, span?(layout, times, timing) -> device params | undefined,
//           reserve?(look) -> { weight?, width? } }   `reserve`: the weight and width keyword advances are measured at
export const EMPHASIS = Object.freeze({ highlight, 'recolor-scale': recolorScale, recolor, glow /* + four new */ });
export function emphasisOf(look) {} // throws for a name the table does not have, with did-you-mean
```

`lookContract` asserts, by name in the test output: (a) *registered, validated, deep-frozen, resolvable*; (b) *hidden while experimental, listed after SHIP*: with `listed: false` absent from `registries.looks.names()` and `--list looks` and present in `allLookNames()`; with `listed: true` present in all three; (c) *type rules*: five ascending steps, `scale[0] >= 28`, `scale[4] / scale[1] >= 3`, twelve columns, `secondary.min >= secondaryMin`; (d) *every font bundled at a reachable weight and width*, and `facesFor` loads it; (e) *a sound for exactly the registered cuts, devices and kind event devices*; (f) *a Move for every registered move, each ease parsing*; (g) *contrast*: every `pairs` entry at or over its minimum computed with `shared/contrast.mjs` `contrastRatio` (4.5 for `ink` and `ink2` on the look's main ground, 3 otherwise), and every `banned` pairing under 3 (so the ban is real, not decorative); (h) *kinds*: `supportsKind` true for every name in `kinds`, `kindSupportProblems` naming the supporting looks for every registered kind not in it, `isParkedKind` true exactly for `parked`; (i) *accent override*: after `applyAccent(look, '#00aa55')` no value reachable from the look equals the old accent hex; (j) *modes*: a film naming the look validates in each of `modes` at 16:9 and 9:16 and is refused in any other mode.

---

### Task 1: Groundwork (freeze, guard, emphasis table, weight tracks)

**Files:** `test/v2/helpers/frozen.mjs`, `test/v2/fixtures/kinds-frozen-2.json`, `test/v2/kinds-frozen.test.mjs`, `test/v2/look-names.test.mjs`, `test/v2/helpers/look-contract.mjs`, `engine/kinds/emphasis.mjs`, `engine/kinds/statement.mjs`, `engine/captions/stack.mjs`, `engine/text/layout.mjs`, `engine/graph/sample.mjs`, `engine/page/draw.mjs`, `test/v2/emphasis.test.mjs`, `test/v2/text-weight.test.mjs`.

**Interfaces:** `EMPHASIS`, `emphasisOf` (above). A text node's words take optional `weight` and `width` tracks (a CSS weight; one of the six stretch keywords), each for the whole word: type moves by word, never by letter, outside `pop` and `poster` (design 5.2). The node takes `reserve: { weight?, width? }`: layout measures every word at the reserved weight and width, and a word drawn lighter or narrower is centred in its reserved room, so nothing re-flows when a weight or a width changes.

- [ ] **Step 1: Widen the frozen fixture first, on the untouched tree.** The fixture today covers `desk` and `pop`, nine kinds, four films (`helpers/frozen.mjs`). Add a second fixture, generated from `8093b24b` before any engine file changes: every registered kind's example (16 kinds) in `desk` and `pop`, every kind `cosmos` has data for in `cosmos`, at both formats, plus every shot and the sampled frames of `gate-cosmos` and `gate-cosmos-viral`. The existing fixture is not regenerated. Test: *the second frozen fixture names every entry it is checked against* and *every entry's hash equals the working tree's*. Prove the guard fires: change one number in a look's data in a scratch copy and confirm the named entry fails, then confirm an empty diff.
- [ ] **Step 2: The no-look-name guard**, `look-names.test.mjs`. It reads every `.mjs` under `engine/` and `scripts/v2/` and fails on a comparison of a look's or mode's name: the patterns `look\??\.name\s*[!=]==`, `mode\??\.name\s*[!=]==`, `switch \([^)]*look\??\.name`, and `resolveLook\([^)]*\)\.name\s*[!=]==`. It is not a grep for the words: `'desk'` is also a camera style, `'pop'` a move and a cue, `'cosmos'` a field, `'marker'` a cue. Assertions: *no engine or script file compares a look's name*; *the guard fires on a planted comparison* (a fixture string holding `ctx.look.name === 'ledger'`). If it finds an existing site, report it; fix it only if it is in a file this task already edits.
- [ ] **Step 3: Failing tests for the emphasis table**, `emphasis.test.mjs`: *the four existing styles are entries and `emphasisOf` returns them for desk, pop and cosmos*; *an unknown emphasis name throws with the names it has*; *`statement.mjs` holds no comparison on `look.emphasis`* (a source assertion); the frozen fixtures stay green.
- [ ] **Step 4: Implement** `engine/kinds/emphasis.mjs` by moving the four branches out of `statement.mjs` (lines 66, 241 to 255, 314) and the one in `captions/stack.mjs` (line 31) unchanged in behaviour. Run the frozen tests.
- [ ] **Step 5: Failing tests for weight and width tracks**, `text-weight.test.mjs`: *no word's box moves when one word's weight track changes* (boxes at weight 300 and 800 equal with `reserve: { weight: 800 }`); *no word's box moves when one word steps from `extra-condensed` to `condensed` with `reserve: { width: 'condensed' }`*; *without `reserve` layout is exactly as before* (frozen fixtures); *a lighter or narrower word's ink is centred in its reserved room within one unit*; *the sampled weight is an integer from 100 to 900 and the sampled width one of the six keywords*. First check whether a per-word weight track already exists in `graph/sample.mjs`; if so, only `reserve` and `width` are new.
- [ ] **Step 6: Implement, run** the two new tests, the frozen tests and `looks.test.mjs`. Write `helpers/look-contract.mjs` and prove it on a synthetic look registered only in the test (`desk`'s data under another name with `experimental: true`): it passes; a copy with one sound removed fails on (e); a copy whose shadow colour repeats the accent hex under a key `applyAccent` does not move fails on (i); a copy with `listed: true` fails on (b). It is not run against `cosmos`, whose `sun.base` and `sun.color` repeat its accent hex (a known gap in `docs/decisions-pending.md`, not this plan's to fix).

### Task 2: The drawing hand (spike, with a kill rule)

**Files:** `engine/hand/geometry.mjs`, `strokes.mjs`, `pose.mjs`, `shape.mjs`, `index.mjs`; `engine/graph/film.mjs` (one call, behind look data); `engine/cuts/erase.mjs`, `engine/cuts/index.mjs`; `engine/looks/desk.mjs`, `pop.mjs`, `cosmos.mjs` (the `erase` sound entry, `null`, and `erase` in `cuts`); `scripts/v2/sound/synth.mjs`; `test/v2/hand.test.mjs`, `hand-browser.test.mjs`, `cuts-erase.test.mjs`; `references/examples/v2/hand-spike.json`. A throwaway look object registered only inside the tests carries `hand` data until Task 12.

**Interfaces:**

```js
// engine/hand/geometry.mjs: a copy of template/sketch/geometry.mjs (wobble, boxOutline, ellipseOutline, bowedLine,
// boxHatch, ellipseHatch, arrowBarbs, measure, makeStroke, pointAt). Its own unit, hashSeed and makeRng are dropped
// for engine/units.mjs and engine/seeded.mjs.
// engine/hand/strokes.mjs
export function strokePlan(nodes, timing, look) {}  // -> [{ id, points, lengths, total, start, end, kind: 'line' | 'write' | 'fill' }]
// engine/hand/pose.mjs
export function handPose(plan, t, look) {}          // -> { x, y, angle, down: boolean, resting: boolean }
// engine/hand/shape.mjs
export function handNodes(look, unit) {}            // path nodes, the marker's tip at the origin
// engine/hand/index.mjs
export function handLayer(shotNodes, timing, ctx) {} // -> nodes for the shot, [] when look.hand is absent
```

- [ ] **Step 1: Copy the geometry** from `template/sketch/geometry.mjs` (207 lines) and the pose logic from `template/sketch/hand.mjs` (`handPose` is pure; `handSvg` and `applyHand` touch the DOM and are not copied). The hand illustration becomes point lists drawn as path nodes holding a chisel marker, not a pencil. Record in a header comment that the files are copies and why.
- [ ] **Step 2: Failing tests**, `hand.test.mjs`: *the stroke plan lists one stroke per drawn node in draw order with start before end*; *while a stroke draws, the tip is within 6 units of the stroke's visible end at every 1/30 s*; *between strokes the hand travels in one eased move and never jumps more than 400 units in one frame*; *a `write` stroke's tip stays within the word's ink box and moves left to right*; *with no stroke for more than `hand.rest` seconds the hand rests at the look's rest point, outside every text's ink box*; *the hand is absent when the look has no `hand` data, and the frozen fixtures are unchanged*; *the pose is a pure function of the plan and t* (two calls equal); *wobble is deterministic for a seed and differs between two ids*.
- [ ] **Step 3: Drawing speed follows the narration.** An element starts on the first word of its sentence and its strokes share the time to the sentence's end, landed `LANDED_BEFORE_END` before the shot ends (`engine/kinds/arrivals.mjs`). Speed is capped at `hand.maxSpeed` units a second; a sentence that would need more is a `creative` finding (*too much to draw in this sentence: cut an element or lengthen the line*), tested with a ten-element sentence.
- [ ] **Step 4: Text is written, never faded.** A word appears through a left-to-right clip that the tip leads, a line at a time; unwritten words are absent, not ghosted. Test: *no text or path node of a hand shot has an opacity track with a value strictly between 0 and 1*.
- [ ] **Step 5: Frame 0 of every board.** The rule that no shot opens on an empty frame stands. A board's first element is complete on its first frame with the hand resting at its end: the time-lapse joins the drawing after the heading is written. Test: *the first frame of every shot in the spike film holds at least one fully drawn element and the review reports no empty first frame*.
- [ ] **Step 5b: How the audits treat the hand.** The hand is a group of path nodes with `role: 'hand'`. It is not text, so the type rules do not judge it. It must cross the frame's bottom or right edge (an arm does), which the safe-area audit would report. The ruling, a controller decision recorded in the gate report before the spike renders: the safe-area and title-safe audits skip nodes with `role: 'hand'` and nothing else, and two stricter rules are added so the role cannot hide anything: a `hand` node over a finished text's ink box for more than 0.3 s is a mechanical finding (`covered`), and a `hand` node crossing the top or left edge is a mechanical finding. Tests: *a text node given `role: 'hand'` is still judged by every text rule* (the role exempts paths only); *the two new findings fire on a planted pose*; *`desk`, `pop` and `cosmos` produce no new finding* (their example sweeps).
- [ ] **Step 6: The `erase` cut and cue.** A cut whose leading edge is a board eraser carried by the hand: the outgoing board is wiped in three overlapping passes, a faint seeded smear in the `rule` colour stays for `erase.smear` seconds, and the incoming board is already holding its first element. Register `erase`; run the registry sweep (`null` in `desk`, `pop`, `cosmos`; `'erase'` only in the hand look). The cue `erase` is a short band-passed noise sweep in `synth.mjs`. Tests, `cuts-erase.test.mjs`: *registered, with its options*; *at progress 0 the frame is the outgoing shot, at 1 the incoming*; *every look names a sound for it*; *`KNOWN_CUES` holds `erase` and its samples are finite, peak at or under the limit, same for a seed*.
- [ ] **Step 7: The kill rule, measured on `hand-spike.json`** (12 s, three boards, at 16:9 and 9:16; the controller renders): (a) Step 2's tests green; (b) zero findings; (c) render time per frame at most 1.5 times `desk`'s; (d) the controller views the sheets and at phone width the shape reads as a hand holding a marker, and the hand rests over no finished text; (e) the hand is inside the frame or leaving it through the bottom or right edge only. One redesign round is allowed. If it still fails, the fallback is fixed here: no hand, the marker's tip alone (a short chisel-nib shape on the stroke end), everything else unchanged. Record the outcome in the gate report before Task 3 starts.

---

## `ledger` (newsroom data film; pro)

**Art direction, binding.** Off-white, near-black, one signal red, greys and a short categorical set. No texture beyond a hairline grid. A coloured tag and a thin rule at top left with the claim as a title; direct labels, never a legend; everything but the series being discussed dims; an annotation with a leader line lands on the spoken figure.

| Role | Value | Contrast (measured with `shared/contrast.mjs`; the test recomputes) |
|---|---|---|
| paper (the only ground) | `#fbfaf7` | |
| ink | `#16181d` | 17.01 |
| ink2 | `#5a606b` | 6.06 |
| accent (signal red) | `#c8102e` | 5.64; paper on it (a tag's text) 5.64 |
| accent2 and categorical 1 | `#1f5fa8` | 6.17 |
| categorical 2, 3 | `#1b7f5c`, `#a86200` | 4.75, 4.56 |
| dim (a series not being discussed) | `#868b95` | 3.28, marks only, never text |
| rule (hairlines, grid) | `#dcdee3` | decoration, exempt |

- **Fonts (all bundled, no new bytes):** display and label `Archivo` at width `semi-condensed`, weights 700 and 600 (numbers in the label face, fixed digit advances); text `Fraunces Text` 400 for annotations and sources. Sentence case throughout; `caps.label` false (small caps labels failed at phone size).
- **Scale** `[34, 48, 76, 128, 208]`; `secondary.min` 46; line height display 1.08, text 1.3; display tracked in 0.01 em from 128.
- **Grid:** 16:9 margin 96, gutter 24. 9:16 margin 72, gutter 20 (if the look record has one grid only, add `gridTall` as look data read by `editorialSpan`; absent means today's behaviour).
- **Field:** `grid` (new): flat paper with vertical hairlines on the twelve column edges and a baseline rule, `rule` colour at 0.6; `animated: false`, so held frames are reused.
- **Composition:** `editorial`. Camera `{ drift: 0, style: 'locked' }`.
- **Emphasis (one system):** `weight-color`. An emphasised word steps from the display weight to 800 and turns the accent, with advances reserved at 800; in a chart the discussed series keeps its colour and gains line weight while the others take `dim`. No highlight, no underline.

| Move | Values |
|---|---|
| enter, rise, pop | `outCubic`, 0.45 s, dist 16 |
| exit | `inCubic`, 0.25 s |
| emphasize | `outCubic`, 0.3 s |
| draw (lines left to right, leader lines) | `inOutCubic`, 0.9 s |
| wipe (bars grow from the baseline) | `outCubic`, 0.7 s |
| count | `outCubic`, 0.8 s |
| slam | `linear`, 0 s (ledger does not slam) |
| settle (a race re-ranking) | `inOutCubic`, 0.6 s |

- **Cuts:** every registered cut may be named; `cutPalette: ['cut', 'match', 'fade', 'wipe']`; `cutStyle: {}`; no smear.
- **Devices:** `tag` ruled (accent plate, paper text, a 2-unit rule running right from it); `label` (ink text, ink2 hairline leader ending in a 6-unit dot); `focus` dim 0.65 with a paper scrim; `card` plain white with a 1-unit `rule` edge and no shadow; `underline`, `circle`, `bracket`, `arrow` ruled (straight, 3 units, ink, no wobble, no stepping); `highlight` declined (a film that asks for it gets the look's emphasis); `numeral` ink; `duotone` ink on paper.
- **Captions:** `lower` with a `plain` variant from look data: text face on a white strip with a top hairline, the spoken word in ink at weight 600, the rest in ink2.
- **Sounds:** cut: all `null` except `wipe: 'paper'`. device: `label: 'click'`, `item: 'click'`, `event: 'click'`, `change: 'click'`, the rest `null`. emphasis `null`. land `'ding'`.
- **Post:** grain 0, halftone 0, bloom 0.

**Kinds at launch: all sixteen.** None is excluded by the art direction.

| Kind | Composition |
|---|---|
| statement | editorial; the claim flush left under the tag and rule; differs from quote and end by the rule and by sitting on the top third |
| number | editorial (`deskParts`): the numeral in the label face, the unit small on the cap height, a one-line annotation in the serif beside it |
| chart (all seven types) | editorial `chart-desk` with data: `direct: true`, `refs` true only for line and area, `dimTo: 'dim'`, bars from zero, the highlighted mark in the accent, an annotation with a leader on the spoken figure (new: `annotation` part in `chart-labels.mjs`, used by this look's data) |
| compare | editorial `compare-desk`; two columns divided by a hairline, no cards |
| list | editorial `list-desk`; figures in the label face hang in the margin |
| quote | editorial `quote-desk` with `card: false`: the serif at step 3 to 4 with a 4-unit accent rule down its left |
| timeline | `timeline-desk` |
| map | `map.mjs`, `card: false`, land `#e9eaee`, borders paper, highlight accent |
| diagram | `diagram.mjs`, nodes as ruled boxes, straight arrows |
| clipping, media, screen | the existing compositions with the plain card and the paper scrim |
| code | `code.mjs` on the plain card, the bundled mono |
| feed | `feed.mjs`, flat slips with a hairline, no shadow |
| end | editorial; the closing line, the source line in the serif, the tag as the mark |
| free | as every look |

### Task 3: `ledger` data, field, devices and emphasis

**Files:** `engine/looks/ledger.mjs`, `index.mjs`; `engine/fields/grid.mjs`, `index.mjs`; `engine/kinds/emphasis.mjs` (`weight-color`); `engine/devices/tag.mjs`, `label.mjs`, `marks.mjs`, `card.mjs` (the `ruled` and `plain` styles); `engine/captions/lower.mjs`; `test/v2/ledger-look.test.mjs`, `ledger-devices.test.mjs`.

- [ ] **Step 1: Failing tests.** `ledger-look.test.mjs` calls `lookContract('ledger', …)` with the table above (ground `#fbfaf7`; pairs for ink, ink2, accent, the three categorical colours and paper-on-accent; `dim` at 3 as a mark; modes `['pro']`; `secondaryMin` 46; all sixteen kinds) and adds: *the field is `grid`, not animated, deterministic, and plans at both formats*; *camera locked with no drift*; *`cutPalette` is the four named cuts*; *post is all zero*. `ledger-devices.test.mjs`: *a ruled tag's rule starts at the plate's right edge on its mid height*; *a label's leader ends inside its target's box*; *ruled marks have no wobble and no step*; *`highlight` is declined by `supports(look)`*; *`weight-color` steps the weight and recolours without moving any word box*; *in `desk`, `pop` and `cosmos` every device builds exactly as before* (frozen fixtures).
- [ ] **Step 2: Run red. Step 3: Implement. Step 4: Run green**, then the frozen tests and `look-names.test.mjs`.
- [ ] **Step 5: Render** the field alone and a statement on it at both formats (controller); view; say what each shows.

### Task 4: Every kind in `ledger`

**Files:** `engine/looks/ledger.mjs` (`kinds`), `engine/kinds/chart-labels.mjs`, `chart-desk.mjs` and only what a kind lacks; `test/v2/ledger-kinds.test.mjs`, `ledger-examples-browser.test.mjs`.

- [ ] **Step 1: Failing tests.** `ledger-kinds.test.mjs`: *every kind's example builds at 16:9 and 9:16 with no finding from `auditFrame`*; *a bar chart's bars start on the baseline value 0*; *a line chart whose axis does not start at zero carries an axis label*; *no direct label's box meets another mark's box*; *exactly one series holds the accent while a series is discussed and the others hold `dim`*; *the annotation's leader ends on the spoken mark*; *no composition leaves more than 35 percent of the tall composition area empty* (measured from the union of node boxes). `ledger-examples-browser.test.mjs`: the examples sweep for `ledger` in both formats, zero findings, in the shape of `cosmos-examples-browser.test.mjs`.
- [ ] **Step 2: `kinds` data and compositions**, one kind at a time in the table's order, rendering and viewing each at both formats. Chart first: it is the look.
- [ ] **Step 3: Run** `ledger-*.test.mjs`, the frozen tests, then the whole suite once.

### Task 5: The `ledger` gate

**Files:** `references/examples/v2/gate-ledger.json`, `gate-ledger-tall.json` (controller); `engine/looks/ledger.mjs` (the flag, on SHIP only); the listing assertions in `test/v2/looks.test.mjs`, `cosmos-look.test.mjs`, `look-experimental.test.mjs`, `kinds-parked.test.mjs`, `ledger-look.test.mjs` (`listed: true`); the gate report; `docs/decisions-pending.md` if parked.

- [ ] **Step 1 to 4:** as "The gate" above. The films use the bundled example data under `references/examples/v2/data` or figures with a stated source. Record the result in the gate report; on SHIP remove `experimental`, update the listing assertions to `['desk', 'pop', 'cosmos', 'ledger']`, and add the look where the docs name looks (find the places by searching `references/` and `SKILL.md` for `cosmos`).

---

## `poster` (kinetic type and cut paper; viral and pro)

**Art direction, binding.** Two flat colours, black and paper white. Type is the image: words scale to fill the frame, lines stack and rotate, cut-paper bars and circles wipe as transitions, the grid shows. Hard and rhythmic.

| Text or mark on ground | paper `#f2ede2` | red `#d92b1c` | blue `#1f3fc4` | ink `#141414` |
|---|---|---|---|---|
| ink `#141414` | 15.78 | 3.78 | 2.25 **banned** | |
| paper `#f2ede2` | | 4.17 | 7.01 | 15.78 |
| red `#d92b1c` (accent) | 4.17 | | 1.68 **banned** | 3.78 |
| blue `#1f3fc4` (accent2) | 7.01 | 1.68 **banned** | | 2.25 **banned** |

Measured with `shared/contrast.mjs`. Look data carries the permitted pairings (`on: { paper: […], accent: […], accent2: ['paper'], ink: ['paper', 'accent'] }`); a kind picks a text colour only through it. Red on paper and ink on red are display sizes only (step 3 and up).

- **Fonts (bundled):** `Archivo` in every role: display 900 `extra-condensed`, text 700 `condensed`, label 700 `normal`; capitals for display, sentence case for text. Width changes on the beat in the six keyword steps canvas reaches (`CANVAS-NOTES.md`); a stepped change is the look, not a defect. Weight animates continuously.
- **Scale** `[38, 58, 104, 196, 360]`; `secondary.min` 52; display line height 0.9; display tracked in 0.02 em.
- **Grid:** 16:9 margin 64, gutter 16. 9:16: the platform safe zone in viral, margin 56 in pro; `band: { top: 0.14, bottom: 0.78 }`. The grid shows: `flat` draws the column hairlines in the ground's permitted second colour at 0.25.
- **Field:** `flat` (new): one flat ground a shot, chosen from `grounds: ['paper', 'accent', 'accent2', 'ink']` by the shot's index and the seed so no two neighbours match, with at most two cut-paper shapes (a bar, a circle) from the seed kept outside the text area; `animated: false`. The contrast review takes a film's field as `palette.paper` before it looks at a shot's background (`engine/review/contrast.mjs`), so a coloured ground painted by the field alone would be judged as paper: paper text on red would be reported and ink on blue would pass. The ground is therefore also a node: `engine/graph/film.mjs` puts one opaque full-frame path with the ground's `#rrggbb` fill first in every shot of a look that carries `grounds` data (one call, behind look data), which the review already reads as the ground of every text over it.
- **Composition:** `stack`. Camera `{ drift: 0, style: 'locked' }`. `hookInk: true`. `colorSpace: 'oklab'`.
- **Emphasis (one system):** `scale`. The emphasised line of a stack is the large size and the others the small one (the stack's two sizes); inside a single line, the word steps one width keyword wider on its beat, in room reserved at the wider keyword (`reserve.width`), so the line does not re-flow. No recolour.
- **Misregistration:** a cut-paper shape carries a second copy in the other flat colour offset 3 units, excluded from the ink box; never on text under step 3.

| Move | Values |
|---|---|
| enter, pop | `outExpo`, 0.16 s, scale 0.8 |
| exit | `linear`, 0.08 s |
| emphasize | `linear`, 0 s (a hard step on the word) |
| rise | `outExpo`, 0.16 s, dist 48 |
| wipe | `outExpo`, 0.2 s |
| slam | `spring(340,22)`, 0.14 s, scale 1.5 |
| draw | `outExpo`, 0.2 s |
| count | `outExpo`, 0.5 s |
| settle | `outExpo`, 0.25 s |

- **Cuts:** `cutPalette: ['cut', 'cover', 'iris', 'wipe', 'punch', 'slide']`; `cutStyle: { cover: { smear: false } }`; `coverEdge` a hard line in the next ground's colour. A cover's sheet takes the next shot's ground colour (if `cover.mjs` cannot fill its sheet from look data, add `coverFill` as look data; absent means today's behaviour), so the bar that wipes is the cut paper.
- **Devices:** `card` cut (a flat rectangle turned 2 degrees, no shadow, the misregistered copy); `tag` cut (flat plate in a permitted pairing); `sticker` declined; `numeral` in the ground's display colour; `arrow`, `underline`, `bracket` as flat cut bars 16 units thick; `circle` a cut ring; `highlight` a flat bar behind the phrase in a permitted pairing; `punch` scale 1.1; `focus` dim 0.6 toward the ground; `halftone` ink on paper for pictures; `label` text with a 6-unit bar leader.
- **Captions:** `stack`, with the spoken word one width step wider instead of recoloured (from look data).
- **Sounds:** cut: `cut: 'click'`, `cover: 'paper'`, `iris: 'paper'`, `wipe: 'paper'`, `punch: 'impact'`, `slide: 'whoosh'`, the rest `null`. device: `highlight: 'click'`, `punch: 'impact'`, `item: 'pop'`, `turn: 'paper'`, `numeral: 'sub'`, the rest `null`. emphasis `'click'`. land `'impact'`.
- **Post:** grain 0.015, halftone 0, bloom 0.

**Kinds at launch: all sixteen.** If the line, area or scatter chart cannot be made to read as poster after one redesign, those types go in `chart.experimentalTypes`; the rest of the look ships.

| Kind | Composition |
|---|---|
| statement | `stack`; a hook may set a word a line; one line may be turned 90 degrees up the left edge on a wide frame (new: `turn` in the look's `stack` data) so statements do not share one layout |
| number | new: the giant numeral fills the frame's short side and bleeds off one edge by design (its label and unit stay inside the safe area); `number.mjs` reads `bleed` from look data |
| list, quote, compare, end, timeline | the `-pop` family with this look's data; a tall compare stacks both sides with a cut bar between |
| chart | `chart-pop`: the claim a white or ink headline with no plate (the `pop` plate competed with the numeral), bars as cut-paper bars, the numeral the only accent |
| diagram, feed, code, map | the `pop` data shapes restyled flat: no outlines, no offset shadow |
| clipping, media, screen | the existing compositions on a cut card; pictures in `halftone` |
| free | as every look |

### Task 6: `poster` data, field, cut-paper cuts and emphasis

**Files:** `engine/looks/poster.mjs`, `index.mjs`; `engine/fields/flat.mjs`, `index.mjs`; `engine/graph/film.mjs` (the ground sheet); `engine/kinds/emphasis.mjs` (`scale`); `engine/kinds/stack.mjs` (reads `turn`, the pairing table); `engine/cuts/cover.mjs` (`coverFill`); `engine/devices/*.mjs` (the `cut` style); `engine/captions/stack.mjs`; `test/v2/poster-look.test.mjs`, `poster-devices.test.mjs`.

- [ ] **Step 1: Failing tests.** `poster-look.test.mjs`: `lookContract('poster', …)` with four grounds, the eight permitted pairings at 3 or over and the four banned ones under 3, modes `['pro', 'viral']`, `secondaryMin` 52; plus *no two neighbouring shots of a ten-shot film get the same ground*; *every shot's first node is the opaque ground sheet in the colour the field paints*; *the contrast review reports ink text planted on the blue ground and reports nothing for paper text on the red ground* (the guard is shown firing on a non-paper ground); *`desk`, `pop` and `cosmos` get no ground sheet* (frozen fixtures); *the field's shapes lie outside the text area the kind reports*; *every text colour a kind sets is permitted on its ground* (walk every kind's example on every ground); *display width takes only the six stretch keywords*. `poster-devices.test.mjs`: *a cut card has no shadow and carries one misregistered copy outside its ink box*; *the cover sheet takes the incoming ground colour*; *`scale` emphasis sets exactly two sizes in a stack and recolours nothing*; frozen fixtures green.
- [ ] **Step 2 to 4:** red, implement, green; frozen tests and `look-names.test.mjs`.
- [ ] **Step 5: Render** each ground with a three-line stack at both formats (controller); view.

### Task 7: Every kind in `poster`

**Files:** `engine/looks/poster.mjs` (`kinds`), `engine/kinds/number.mjs`, `chart-pop.mjs` and only what a kind lacks; `test/v2/poster-kinds.test.mjs`, `poster-examples-browser.test.mjs`.

- [ ] **Step 1: Failing tests:** *every kind's example builds at both formats, in `pro` and in `viral` at 9:16, with no finding*; *in viral at 9:16 every node is inside the platform safe zone on frame 0 and the hook's words are at full contrast*; *the bleeding numeral's label and unit are inside the safe area and the numeral's visible part still reads as its digits* (at least 70 percent of each digit's box inside the frame); *a tall frame is at least 65 percent used*; *no frame holds more than two type sizes outside frame furniture*; the examples sweep with zero findings.
- [ ] **Step 2: Compositions**, one kind at a time, rendering and viewing each. Statement and number first.
- [ ] **Step 3: Run** `poster-*.test.mjs`, the frozen tests, the whole suite once.

### Task 8: The `poster` gate

**Files:** as Task 5, for `poster`.

- [ ] **Step 1 to 4:** as "The gate" above: `gate-poster.json` in pro at 16:9 and `gate-poster-tall.json` in viral at 9:16 with a synthesised bed, so the cuts and width steps can be checked against the beat grid the report prints. Record; on SHIP un-park and update the listings and docs.

---

## `keynote` (product launch film; pro)

**Art direction, binding.** A near-white ground with a soft mesh gradient and fine grain, one neutral sans from light to black, one brand accent. A huge headline; a weight sweep across a word; product screens as cards with depth and parallax; a light sweep over type; a zoom to a region of a screen with a ring. Long ease-out settles, a continuous camera, mask reveals, match cuts. **The near-black variant is not built**: text on a dark ground with one accent is the slide-deck look the gates banned.

| Role | Value | On paper `#f5f5f7` | On blob A `#dfe4ff` | On blob B `#ffe6dc` | On card `#ffffff` |
|---|---|---|---|---|---|
| ink | `#0b0b0f` | 18.04 | 15.60 | 16.47 | 19.64 |
| ink2 | `#5c5f6a` | 5.84 | 5.05 | 5.33 | 6.36 |
| accent | `#3b5bff` | 4.67 | 4.04 | 4.27 | 5.09; white on it 5.09 |
| dim (chart marks not being discussed; marks only) | `#7d8394` | 3.48 | 3.01 | 3.17 | test computes |
| rule (hairlines) | `#dcdde3` | decoration, exempt | | | |

Measured with `shared/contrast.mjs`; the mesh's blobs are painted at `strength` 0.5 over paper, so the full blob colours are the worst case. A data mark is never decoration: every chart mark holds 3:1 on every ground, as `ledger`'s does (a paler grey, `#c9ccd6`, measured 1.47 and was dropped). `accent2` is `ink2`: there is no second hue.

- **Fonts:** `Geist`, one variable file with a `wght` axis (new: `@fontsource-variable/geist`, Latin, exact version pinned by the task; design 5.2 names Geist, and the two static weights in `shared/fonts` cannot sweep). Display 700, text 400, label 500; sentence case. The task measures the file's bytes before adding it and repeats the canvas check in `CANVAS-NOTES.md` (weights 100 and 900 draw differently; the stage loads it). The family name must not collide with the shared static `Geist` in `fonts-shared.mjs`: register it as `Geist Variable`.
- **Scale** `[34, 48, 84, 152, 264]`; `secondary.min` 46; display line height 1.02, text 1.35; display tracked in 0.02 em from 152, labels out 0.01 em.
- **Grid:** 16:9 margin 120, gutter 24. 9:16 margin 72, gutter 20.
- **Field:** `mesh` (exists). Today it takes only `blobs` (a count, 1 to 8) and `strength`, and draws its colours from the palette's accent, accent2 and ink2, which would put saturated blue and grey blobs behind the type. It gains two optional params, absent meaning today's behaviour: `colours` (palette keys or `#rrggbb`) and `sway` (0 to 1, a multiplier on the amplitude). `keynote` passes `{ blobs: 4, strength: 0.5, colours: ['wash', 'wash2'], sway: 1 }` with `wash: '#dfe4ff'` and `wash2: '#ffe6dc'` in its palette. It is animated; if the cost rule is broken on still shots, `sway` goes to 0 and the camera carries the motion.
- **Composition:** `editorial`. Camera `{ drift: 18, style: 'desk' }`, never still: a slow continuous move through every shot, cards moving against the field by their depth.
- **Emphasis (one system):** `weight-sweep`. An emphasised word's weight ramps from 300 to 800 over its spoken time, the whole word at once (type moves by word in this look; by letter is `pop` and `poster` only, design 5.2), and across an emphasised phrase the words ramp in spoken order, which is the sweep. Advances are reserved at 800 so nothing moves. If light words look loosely spaced in their heavy room on the sheets, the range narrows to 500 to 800; that is the only fallback.

| Move | Values |
|---|---|
| enter, rise | `outQuart`, 0.9 s, dist 36 (the longest settle `engine/time/ease.mjs` has: Quad, Cubic, Quart, Expo, Back and springs) |
| exit | `inCubic`, 0.3 s |
| emphasize (the sweep) | `inOutCubic`, 0.6 s |
| wipe (a mask reveal by line) | `outQuart`, 0.8 s |
| pop | `outQuart`, 0.7 s, scale 0.96 |
| slam | `linear`, 0 s (keynote does not slam) |
| draw (the ring) | `inOutCubic`, 0.7 s |
| count | `outQuart`, 1.1 s |
| settle | `outQuart`, 1.0 s |

- **Cuts:** `cutPalette: ['cut', 'match', 'crossfade', 'zoom', 'blur', 'cross-zoom']`; `cutStyle: { crossfade: { duration: 0.5 } }`. Crossfades mix in OKLab.
- **Devices:** `card` elevated (white, radius 28, a two-layer soft shadow in a cool grey, no blur filter redrawn every frame: the shadow is drawn once into the card's group or by stepped fills, as the cosmos review asked); `sweep` (a white band of light, screened, crossing a headline or a screen once: the look's only light); `focus` and the zoom ring (an accent ring 4 units wide drawing round a region of a screen as the camera pushes in); `tag` a small pill, ink2 text on white; `label` ink text with a hairline leader; `highlight`, `circle`, `underline`, `bracket` declined except the ring; `numeral` ink; `arrow` a thin accent line with a small head; `duotone` declined (pictures stay in colour on cards).
- **Captions:** `pill`, white pill, ink text, the spoken word at weight 700 (from look data), no recolour.
- **Sounds:** cut: `match: null`, `crossfade: null`, `zoom: 'whoosh'`, `blur: 'whoosh'`, `cross-zoom: 'whoosh'`, the rest `null`. device: `sweep: 'chime'`, `zoom: 'whoosh'`, `card: null`, `item: 'click'`, `numeral: 'sub'`, the rest `null`. emphasis `null`. land `'sub'`.
- **Post:** grain 0.012, halftone 0, bloom 0.

**Kinds at launch: all sixteen.**

| Kind | Composition |
|---|---|
| statement | editorial; one huge headline up to 264 on columns 1 to 10, revealed a line at a time through a mask; the sweep on one word |
| screen | the look's signature: the screen on an elevated card turned in depth, a second card behind it, parallax from the camera; the zoom ring on a region (new: `depth` and `layers` in `screen.mjs`, read from look data) |
| media, clipping | the picture on an elevated card; a clipping's region gets the ring, not a marker frame |
| number | editorial `deskParts`: the figure at weight 800 counting with fixed advances, its label at weight 400 beside it |
| chart | `chart-desk` with data: direct labels, no gridlines, rounded bar ends 8 units, the highlighted mark in the accent, the rest in `dim` |
| compare | two elevated cards, the unspoken one moved back in depth and scaled to 0.94, not dimmed |
| list | editorial `list-desk`, one item lit at weight 700 while the others rest at 400 in ink2 |
| quote | plain type, no card, the attribution in ink2; differs from a statement by its centred measure and smaller size |
| timeline, diagram, map, feed, code | the editorial data shapes on elevated cards; code in `Geist Mono` (bundled) |
| end | the wordmark at weight 800 with the sweep of light crossing it once, the ask under it |
| free | as every look |

### Task 9: `keynote` font, data, field and the two sweeps

**Files:** `engine/fonts/*` (the file, licence, `SOURCES.md`, `index.mjs`, `CANVAS-NOTES.md`); `engine/looks/keynote.mjs`, `index.mjs`; `engine/fields/mesh.mjs` (`colours`, `sway`; test in `fields.test.mjs`: *without them the plan is byte-equal to today's for a seed*; *with `colours` every blob takes one of them*; *`sway: 0` gives the same paint at t = 0 and t = 10*); `engine/kinds/emphasis.mjs` (`weight-sweep`); `engine/devices/card.mjs`, `sweep.mjs`, `focus.mjs`; `engine/captions/pill.mjs`; `test/v2/keynote-look.test.mjs`, `keynote-devices.test.mjs`, `fonts.test.mjs`, `fonts-browser.test.mjs`.

- [ ] **Step 1: The font, with the stop rule.** Failing test first in `fonts.test.mjs`: *the file is present, its hash matches its SOURCES row, the licence text is present, total new bytes are within the budget*. Fetch, measure, record. In `fonts-browser.test.mjs`: *Geist Variable at 100 and at 900 draw differently on canvas* and *the stage loads it with no page error*.
- [ ] **Step 2: Failing tests.** `keynote-look.test.mjs`: `lookContract('keynote', …)` with grounds paper, blob A, blob B and card, the pairs in the table, modes `['pro']`, `secondaryMin` 46; plus *the palette's paper is light* (relative luminance over 0.8: the dark variant cannot come back by a data edit without failing a test); *the camera drifts in every shot*; *`post.bloom` is 0*. `keynote-devices.test.mjs`: *the weight sweep takes each emphasised word to 800 by that word's end, in spoken order, and moves no word box*; *no word has per-letter tracks*; *a sweep band crosses its target once and ends at alpha 0, and no other node has a screen blend*; *an elevated card uses no blur filter that is redrawn every frame*; *a film accent override recolours the ring, the highlighted chart mark and the arrow*; frozen fixtures green.
- [ ] **Step 3 to 4:** implement, green; frozen tests and `look-names.test.mjs`.
- [ ] **Step 5: Render** a headline with one swept word and a card on the field at both formats (controller); view at full size and at phone width; record render time per frame against `desk`.

### Task 10: Every kind in `keynote`

**Files:** `engine/looks/keynote.mjs` (`kinds`), `engine/kinds/screen.mjs`, `screen-frame.mjs`, `compare-desk.mjs` and only what a kind lacks; `test/v2/keynote-kinds.test.mjs`, `keynote-examples-browser.test.mjs`.

- [ ] **Step 1: Failing tests:** *every kind's example builds at both formats with no finding*; *a screen's card stays inside the title-safe box through its whole parallax move*; *the zoom ring's box contains the region's box and no figure is cut by the frame edge during the push* (the region plus a margin stays inside the frame); *the compare's back card is never above the front card in draw order*; *a tall frame is at least 65 percent used*; *the statement, quote and end compositions differ in at least two of alignment, measure and size step* (asserted from their layouts); the examples sweep with zero findings.
- [ ] **Step 2: Compositions**, one kind at a time, screen and statement first.
- [ ] **Step 3: Run** `keynote-*.test.mjs`, the frozen tests, the whole suite once.

### Task 11: The `keynote` gate

**Files:** as Task 5, for `keynote`.

- [ ] **Step 1 to 4:** as "The gate" above. The films show an invented product with no real brand, person or contact detail; the screens are the bundled example pictures. Record; on SHIP un-park and update the listings and docs.

---

## `marker` (whiteboard time-lapse; pro)

**Art direction, binding.** A white board, one black marker, one accent colour. A hand draws strokes, boxes, arrows and scribble fills; one element per sentence; an erase between boards. Drawing speed follows the narration; nothing fades in.

| Role | Value | On board `#fdfdfb` (measured) |
|---|---|---|
| ink (the black marker) | `#1b1b1f` | 16.86 |
| ink2 (the same marker for notes) | `#4a4a52` | 8.62 |
| accent (the red marker) | `#d1321f` | 4.92 |
| rule (the erase smear, the board's edge) | `#e4e4df` | decoration, exempt |

`accent2` is `ink2`, not a copy of the accent hex (a copy would stay behind when a film overrides the accent); every accent stroke names the key `accent`. One accent colour is the look. Scribble fills are hatch strokes in the accent, never a flat fill, so text over a fill is still judged against the board and the hatch (the kinds test checks the hatch never crosses text).

- **Fonts:** `Caveat` in every role (design 5.2). It lives only in `template/sketch/caveat-700.woff2` (51,020 bytes), which cut-over deletes, so it is added to `engine/fonts/` from `@fontsource-variable/caveat` (Latin, `wght` 400 to 700) or, if the variable file breaks the budget, as the static 700 from the pinned Fontsource package, with its licence and SOURCES row. Its bytes count against the budget. Display 700, text 600, label 600; sentence case.
- **Scale** `[44, 60, 92, 150, 240]` (Caveat's x-height is small, so every step is larger than the other looks'); `secondary.min` 60; display line height 1.0, text 1.2.
- **Grid:** 16:9 margin 110, gutter 24. 9:16 margin 80, gutter 20. The hand's rest point is outside the grid, low on the right.
- **Field:** `board` (new): the board colour with a faint seeded sheen and a 6-unit `rule` frame at the margin's half; `animated: false`.
- **Composition:** `editorial`, with every part arriving by a stroke. Camera `{ drift: 0, style: 'locked' }`.
- **Emphasis (one system):** `underline`. The hand draws one wobbling stroke in the accent under the emphasised word as it is spoken. Nothing else.
- **`hand`** (look data read by `engine/hand`): `{ rest: 1.2, maxSpeed: 2600, wobble: { amp: 2.4, wave: 46 }, width: { line: 7, write: 6, fill: 5 }, restAt: { wide: [0.88, 0.86], tall: [0.8, 0.9] }, erase: { passes: 3, smear: 0.4 } }`, or the tip-only fallback Task 2 recorded.

| Move | Values |
|---|---|
| enter, rise, pop, wipe | the stroke: `linear`, duration from the narration (the entry carries `dur: 0.5` as the value used when a shot has no narration) |
| draw | `linear`, 0.5 s |
| exit | `linear`, 0 s (a board leaves only by the erase) |
| emphasize | `linear`, 0.3 s |
| slam | `linear`, 0 s (a pinned print is put on the board at once) |
| count | `linear`, 0.8 s, written digit by digit, never rolling |
| settle | `linear`, 0 s |

- **Cuts:** `cuts` lists every registered cut; `cutPalette: ['cut', 'erase']`; a film that names another cut is not a finding, but the examples and gate films use these two.
- **Devices:** every mark `drawn` (wobble from the hand's geometry, drawn once, no stepping); `card` a drawn box; `tag` a drawn box with caps handwriting; `highlight` declined (the look's emphasis is the underline); `focus` declined (nothing dims on a whiteboard; the hand circles the target instead); `label` handwriting with a drawn arrow; `route` a drawn line; `cutout` and pictures as a print pinned by two drawn magnets, put on at once; `numeral` handwriting; `duotone`, `halftone`, `sweep`, `sticker`, `punch` declined.
- **Captions:** `lower` with a `plain` variant: handwriting in ink2 on the board's lower edge with no card. Whether captions belong on a board at all is a controller decision; they stay opt-in as in every mode.
- **Sounds:** cut: `erase: 'erase'`, `cut: null`, the rest `null`. device: every drawn device `'marker'`, a pinned print `'click'`, the rest `null`. emphasis `'marker'`. land `null`.
- **Post:** grain 0.006, halftone 0, bloom 0.

**Kinds at launch: fourteen of sixteen (chart among them, with one type parked); `screen` and `code` excluded.**

| Kind | Composition |
|---|---|
| statement | editorial, written a line at a time; at most two lines a sentence |
| number | the figure written large, a drawn box round it, the label written beside it |
| list | items written one a sentence with a drawn bullet; the current one underlined |
| quote | written, with large drawn quote marks; attribution after a drawn dash |
| compare | two drawn boxes joined by a drawn "vs"; one side a sentence |
| chart | bar and column (drawn boxes with hatch fills), line and area (one stroke), donut (a drawn ring with hatch sectors), scatter (drawn dots); **`race` parked** (`experimentalTypes`): ranks change while on screen, which a board can only do by erasing |
| diagram | the look's natural kind: drawn boxes and bowed arrows, one node a sentence |
| timeline | a drawn line with ticks, events written in order |
| map | the outline drawn as one stroke per shape, places as drawn pins; `borders` simplified by a tolerance from look data so the hand can draw it in a sentence |
| feed | drawn speech bubbles |
| clipping, media | the pinned print; a clipping's region is circled by the hand |
| end | the closing line written, a drawn box round the ask |
| free | as every look |
| **screen: excluded** | a pixel UI on a board has no drawn form and would arrive as a picture in a browser frame, which is `media` |
| **code: excluded** | the look has one handwriting face; a twelve-line listing in handwriting is unreadable at phone size and a mono would break the look |

Excluded kinds have no `kinds` entry, so a film asking for one is refused with the looks that support it.

### Task 12: `marker` font, data, field and drawn devices

**Files:** `engine/fonts/*` (Caveat); `engine/looks/marker.mjs`, `index.mjs`; `engine/fields/board.mjs`, `index.mjs`; `engine/kinds/emphasis.mjs` (`underline`); `engine/devices/*.mjs` (the `drawn` style, built on `engine/hand/geometry.mjs`); `engine/captions/lower.mjs`; `test/v2/marker-look.test.mjs`, `marker-devices.test.mjs`, `fonts.test.mjs`, `fonts-browser.test.mjs`.

- [ ] **Step 1: The font**, as Task 9 Step 1, with the same stop rule.
- [ ] **Step 2: Failing tests.** `marker-look.test.mjs`: `lookContract('marker', …)` with ground `#fdfdfb`, pairs for ink, ink2 and accent, modes `['pro']`, `secondaryMin` 60, the fourteen kinds, `screen` and `code` refused, and *`race` is the one parked chart type*; plus *every move's ease is linear and no move has a `scale` or a `dist`*; *`cutPalette` is `cut` and `erase`*; *the look carries `hand` data and the hand layer is built for its shots*. `marker-devices.test.mjs`: *every drawn mark is one stroke from the hand's geometry, deterministic for a seed, with a stroke plan entry*; *a drawn box closes with an overshoot inside 12 units*; *a hatch fill stays inside its outline and crosses no text box*; *the underline emphasis draws under the word's ink box within the line gap and touches no neighbouring line*; *no node of any device has an opacity strictly between 0 and 1 at any sampled time*; frozen fixtures green.
- [ ] **Step 3 to 4:** implement, green; frozen tests and `look-names.test.mjs`.
- [ ] **Step 5: Render** a written statement with one underline, with the hand, at both formats (controller); view.

### Task 13: Every kind in `marker`

**Files:** `engine/looks/marker.mjs` (`kinds`), the kinds' draw modules only where a kind lacks a stroke form (`chart-draw.mjs`, `diagram-draw.mjs`, `map-draw.mjs`); `test/v2/marker-kinds.test.mjs`, `marker-examples-browser.test.mjs`.

- [ ] **Step 1: Failing tests:** *every supported kind's example builds at both formats with no finding*; *each sentence of an example starts at most one element* (the stroke plan's elements against the sentences); *no sentence needs more than `hand.maxSpeed`*; *frame 0 of every shot holds a complete first element*; *the hand's box meets no finished text's ink box for longer than 0.3 s*; *a drawn chart's bar heights are in the data's true ratio within 1 percent and start on the baseline*; *a tall frame is at least 65 percent used by the time the board is complete*; the examples sweep with zero findings.
- [ ] **Step 2: Compositions**, one kind at a time, diagram and chart first.
- [ ] **Step 3: Run** `marker-*.test.mjs`, `hand*.test.mjs`, the frozen tests, the whole suite once.

### Task 14: The `marker` gate

**Files:** as Task 5, for `marker`.

- [ ] **Step 1 to 4:** as "The gate" above. Each film has at least three boards and two erases. The reviewer's brief adds one question: does the drawing lead the eye to what the voice is saying. Record; on SHIP un-park and update the listings and docs.

---

### Task 15: Close-out

**Files:** `docs/superpowers/plans/2026-11-15-pa2-gate-report.md`, `docs/decisions-pending.md`, `engine/fonts/SOURCES.md`, the listing tests, `plugins/portable-artifacts/CHANGELOG.md` (the existing 2.0 heading only).

- [ ] **Step 1:** Run the whole version 2 suite once and the browser sweeps one at a time; record counts in the gate report as measured.
- [ ] **Step 2:** For each look, the gate report holds: the two films, findings, frames, render cost against `desk`, the reviews' verdicts, the rulings, and SHIPPED or PARKED with what the last review blocked on. `docs/decisions-pending.md` gets one entry per parked look or parked kind, with the shortest path to finish it.
- [ ] **Step 3:** `SOURCES.md` states the final font byte total against the budget. `look-experimental.test.mjs` and the listing tests match what shipped.
- [ ] **Step 4:** Check whether this branch's `plugin.json` version and `CHANGELOG.md` heading already cover the new looks (the 2.0 entry); add the shipped looks to that heading, never a second bump.

## Not in this plan

The showreel; the cut-over that deletes version 1; open fix items of `desk`, `pop` and `cosmos` listed in `docs/decisions-pending.md`; the second-wave kinds in `cosmos` and its review 4 fix items, which the gate record assigned to "the looks phase" (a controller decision: this plan leaves them to a `cosmos` follow-up so the frozen `cosmos` frames stay a fixed reference while four looks are built); a dark `keynote`; cut-outs with alpha; any new shot kind, device or move; a listening pass on the sound of the gate films (nobody has listened; the reports say so).

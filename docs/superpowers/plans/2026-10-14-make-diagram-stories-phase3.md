# make-diagram stories — Phase 3 Implementation Plan (the look)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The diagram looks like the design: one hue per kind family drives a tinted card, an icon tile (emoji or icon), a small-caps kind label and the node's outgoing edges; top-level groups read as lanes with a coloured bar and spaced-caps labels; edge labels are pills; a legend with counts sits at the top right; dark mode glows (navy canvas, glowing active edge, glowing dot) and light mode is archify's tinted cards on a dotted grid; make-diagram's default theme becomes `blueprint`; the goldens are regenerated once. Three review findings deferred to this phase are fixed first, each with a failing test.

**Architecture:** Part A fixes `template/story.js` (the dot's first frame, the step beats' glide, an empty chapter list) with a Node harness that loads the module on a bare `window` plus one real-DOM guard. Part B adds seven theme tokens (`kindPerson … kindDecision`, `glow`) to the shared themes, their CSS variables and a contrast rule, then syncs the copies. Part C is the look, build side only: `kinds.mjs` names a colour family per kind; `sizes.mjs` reserves a 28 px tile, a 10 px type line and a mono note; `parts.mjs`/`render.mjs`/`render-sequence.mjs` draw the card, class every edge path `pa-wire`, tag edges with their from-node's family and draw the legend; `lanes.mjs` stretches stacked top-level groups; `legend.mjs` counts and measures the legend, which the layouts reserve a band for; `css.mjs` carries every rule, light by default with a dark block mirroring `shared/theme.mjs`'s selectors; `viewer.html` paints the canvas and chrome; `scripts/lib/theme.mjs` holds make-diagram's own default theme. Goldens (make-diagram SVG and layout, make-explainer's recap body) are regenerated once, in Part C's commit, which says so.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, `ajv@8.20.0`, `elkjs@0.12.0`, Playwright 1.64 (dev; browser tests skip without a browser). Browser code is ES5-style IIFEs inlined into the page. CSS uses `color-mix(in srgb, …)`, `filter: drop-shadow()` and `context-stroke` (Chromium 119+, Firefox 115+, Safari 17+). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-make-diagram-stories-design.md` §3 Look (and the Reduced motion and Accessibility lines of §2), §4, phase 3 of §5. Master plan: `docs/superpowers/plans/2026-10-14-make-diagram-stories.md` (file map, contracts, decisions 1–15, "Deferred review findings"). Phase 1 plan (format and conventions): `docs/superpowers/plans/2026-10-14-make-diagram-stories-phase1.md`; phase 2 plan: `-phase2.md`.

## Global Constraints

- Branch `feat/diagram-stories`. Implementers do **not** run `git commit`/`git push`; each task ends with the commit message and the orchestrator commits.
- Plain ESM Node (Node 20); no new npm dependencies; `shared/` stays zero-dependency. Page code: no inline event handlers, no `eval`/`new Function`, no external requests; CSP stays `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. (Test code may use `new Function` to load a template module; the ban is on page code.)
- Every file under `template/` stays under 400 lines; every other file under 800 (`test/runtime.test.mjs` pins the template budget). Expected after this phase: `story.js` ≈ 326, `camera.js` ≈ 168, `toolbar.js` ≈ 192, `viewer.html` ≈ 170; `css.mjs` ≈ 190, `sizes.mjs` ≈ 180.
- `scripts/lib/api.mjs` exports exactly `buildDiagram`, `validateSpec`, `viewerRuntime` (pinned by `test/api.test.mjs`); the default-theme constant lives in a new `scripts/lib/theme.mjs`.
- `viewerData` keys do not change (`test/api.test.mjs:231`, `test/build.test.mjs:150` stay as they are). Geometry gains `legend`; a geometry node gains `emoji` and `typeLine`.
- Theme tokens are `#rrggbb` (the shared theme test loops `TOKENS` with `/^#[0-9a-f]{6}$/`); opacity lives in CSS. `shared/theme.mjs DEFAULT_THEME` stays `paper`; make-diagram's default becomes `blueprint`.
- Every kind hue passes `shared/contrast.mjs`: ≥ 4.5:1 against `surface` and against its own 10% tint (it is drawn as the type label, small text, on the tinted card) and ≥ 3:1 against `page`, in light and dark, in all four themes. The tint in `css.mjs` (`color-mix(in srgb,var(--k-…) 10%,var(--surface))`) and `contrast.mjs TINT = 0.1` are one number; a change to one is a change to both.
- Colour is never the only signal: shape still encodes kind; the active, selected and route edges are thicker, not only recoloured; the type label names the kind in words.
- Everything drawn inside a node is measured from `shared/text.mjs` metrics (`sizes.mjs`) and checked by `scripts/check.mjs` (every `<text>`'s bbox inside the shape, 2 px tolerance): the type line is measured as uppercase plus tracking, the note in the theme's mono font, the emoji in a fixed 28 px tile.
- Goldens (`test/golden/*.svg`, `*.layout.json`, and make-explainer's `test/golden/recap.body.html`) are regenerated once, in Part C's commit, and that commit message says so. They are red between Task 3 and the regeneration step of Task 5 and never regenerated to hide an unrelated failure. Every other test stays green after every task.
- Reduced motion: no travelling dot, the camera jumps, `autoplay` is ignored (unchanged by this phase; the glow is a static style).
- Design skills for the implementer of Task 5: `redesign-existing-projects` for the static pass over `viewer.html` and `css.mjs` values, then (unloaded first) `emil-design-eng` for the dot and glow motion values. Never both at once. The tests pin structure (class names, selectors, the 10% tint, the 28 px tile, the 10 px type line, the 11 px mono note); the passes may tune the other numbers (blur radius, dot radius, lane bar, chip padding) as long as `npm test` stays green.
- Verification commands (exact, bare, no pipes): `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test`; one file: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/<file>.test.mjs`; `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test`; `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`; after editing `plugins/portable-artifacts/shared/`: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs`. Goldens: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && PA_WRITE_GOLDEN=1 npm test` and `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && UPDATE_GOLDEN=1 node --test test/golden.test.mjs`, each run once, in Task 5.
- Guard proofs: each new browser assertion is shown failing against a deliberately broken page (phase 1's Step-10 style) before it is trusted; every doctoring edit is reverted and `npm test` rerun.
- Look at the result (agent-autonomy rule): the implementer of Task 5 opens the screenshots the browser tests write (`look-light.png`, `look-dark.png`, and `browser.test.mjs`'s `architecture-light.png`/`architecture-dark.png` in the scratch dir the test prints) and views them before declaring the task done.

## Review Focus

Inputs §3 implies but no test would otherwise exercise, most likely to bite first. Each line names the task that pins it.

1. **An emoji on a kind whose default icon is null** (flow `step` with `emoji`): the tile must be reserved in `nodeSize` and in the lint's text room, the type line `STEP` drawn, and the card no narrower than its text. Pinned in Task 3 (`look.test.mjs` card test; `lint.mjs textRoom` takes the tile, not the icon).
2. **A legend wider than the drawing** (a tall `direction: down` flow with several kinds and styles): the canvas widens to hold the row; nothing overlaps; the drawing starts below the band. Pinned in Task 4 (`legend.test.mjs` tiny-diagram case, every example's band check).
3. **Stacked top-level groups with an edge ending at one of them**: no stretching, because the arrow would land inside the lane (`anchorEdges` re-anchors only an end on a box side). Pinned in Task 4 (`lanes.test.mjs`).
4. **A `tone` on a coloured card** (the story example's `warehouse`, `tone: warn`): the tone's border and icon colour win over the family hue in light and dark. Pinned in Task 3 (rule order in `look.test.mjs`) and Task 5 (`look-browser.test.mjs` computed stroke equals `--warn`).
5. **Hostile text in a group label under the spaced-caps look**: the markup keeps the original case (CSS `text-transform`), so it stays one escaped string, and the measurement uses the uppercase width so the box still fits. Pinned in Task 4 (`render.test.mjs` hostile count unchanged; `look.test.mjs` asserts original case in the markup and the wider minimum).

## Drift from the master plan (the code wins; recorded here)

- **Glow mechanism.** The master plan puts "a glow filter in `<defs>`" in `svg.mjs`. This plan uses CSS `filter: drop-shadow(0 0 6px var(--glow))` on the active edge's path and the dot, in the dark rules only. A `<filter>` in `<defs>` carries the per-diagram id prefix (`d-…`, or `dg_<i>-…` inside make-explainer), which a page-wide stylesheet cannot name, `render.test.mjs` requires every id prefixed, and a `filter: url(#missing)` renders its element invisible in Chromium. `svg.mjs` is untouched; `markerDefs` is unchanged markup.
- **Arrow heads.** Markers live in `<defs>` and are not descendants of the edge group, so the existing `.pa-edge.pa-hl .pa-arrow-fill` rules never matched. The marker paths now use `fill: context-stroke` / `stroke: context-stroke`, so a head takes its edge's colour (family hue, accent when lit).
- **Edge path class.** Every edge (and message, and legend sample) path carries `class="pa-wire"`; every rule that used to end in ` path` ends in ` .pa-wire`. This is the deferred finding "`.pa-edge.pa-active path` strokes every path in the edge group".
- **Legend room.** The master plan names `legend.mjs` (counts → SVG) and `g.pa-legend` in `render.mjs`. Both stay, and the layouts reserve a 30 px band (`LEGEND_BAND`) above the drawing for the row and widen the canvas when the row is wider: the geometry carries `legend: { x, y, width, height, items }` and `render.mjs` draws it from there. Every drawing starts 30 px lower than before.
- **Type label.** `text.pa-type` is drawn only on cards that have a tile (an icon or an emoji); flow `step`/`decision`/`start`/`end`, state `state`/`start`/`end`/`choice` and other bare shapes carry none (a `STEP` on every box would be noise). Its text is the uppercased kind name in the markup (not user text).
- **Note text** is measured and drawn in the theme's mono font at 11 px in both modes (one measurement; CSS cannot differ per scheme).
- **Card borders** are 1.5 px in both modes. A dark-only `:root…` rule thinning them would also override the 2 px `tone` border (higher specificity), so light's "stronger border" lives in the thicker active edge (3 px light, 2.5 px plus glow dark) and the hairline pill border.
- **Lanes** stretch only when no edge ends at a top-level group; nested groups carry no bar.
- **Pills** are filled with `--surface`, not the canvas (`--page`): the SVG export draws on a `--surface` rectangle and make-explainer's inline figure sits on a surface card, where a page-coloured pill would show as a faint oval. The hairline `--line` border carries the pill look.
- **Sequence text** that `layout-sequence.mjs` measures with `f.note` (note boxes) and `f.group` (frame tab words) is drawn at the same sizes: `.pa-seq-note-text` in the mono font at 11 px, `.pa-frame-kind` at 11 px without tracking or capitals (the tab word is measured untracked).
- **Camera API** gains `glideMs()` (the 300 ms default) so `story.js` can ask for it. **Default theme** lives in `scripts/lib/theme.mjs` (`DIAGRAM_THEME`, `themeFor`), not inline in `api.mjs`/`build.mjs`/`spec.mjs`.
- From phase 2, still true: `RUNTIME_FILES` has seven modules; the count chips hook is `[data-pa-tally]`; `info` carries group entries.

## Deferred review findings handled here

| finding (master plan, "Deferred review findings") | handling |
|---|---|
| `.pa-edge.pa-active path` strokes every path in the edge group | **Fixed, Task 3**: the edge path is `path.pa-wire`; every edge rule targets it; `look.test.mjs` asserts no rule ends in a bare ` path{` under `.pa-edge`. |
| The dot shows for one frame at its previous position | **Fixed, Task 1**: `travel` parks the dot on the edge's first (or, reversed, last) point before adding `pa-dot-on`; pinned by the Node harness (call order) and a real-DOM `MutationObserver` guard. |
| Step-derived beats glide 600 ms instead of the camera's 300 ms | **Fixed, Task 1**: a step beat glides `camera.glideMs() / speed`; a story beat `GLIDE_MS / speed`. |
| Low: `prevChapter` reads `chapters[c].start` without a guard | **Fixed, Task 1** (file touched): a timeline with no chapters acts as one. |
| Low: the one-beat loop test waits a fixed 5 s | **Fixed, Task 1** (file touched): it waits for the dot to run twice. |
| Low: `loop` is on when `autoplay` is set even if a deep link or reduced motion suppressed autoplay | **Not changed**: spec §2 says loop defaults on when `autoplay` is true. |
| Low items in `emoji.mjs`, `stories.mjs`, step-note length, `stories.test.mjs` wording | **Not touched** this phase (files unchanged). Stay deferred for phase 4's docs pass, which reads those files. |
| Phase 4 items (overlay, resize restarts the beat, `replaceState` per frame, `scrollIntoView`) | **Not touched**: phase 4. |

---

## File structure (this phase)

Paths are relative to `plugins/portable-artifacts/`. **C** = create, **M** = modify, **R** = regenerate.

| | file | responsibility |
|---|---|---|
| M | `skills/make-diagram/template/story.js` | Task 1: dot parked before it shows; step glide; chapter guard |
| M | `skills/make-diagram/template/camera.js` | Task 1: `glideMs()` |
| C | `skills/make-diagram/test/story-unit.test.mjs` | Task 1: story.js on a bare window |
| M | `skills/make-diagram/test/story-browser.test.mjs` | Task 1: dot start guard; the one-beat loop test waits for arrival |
| M | `shared/themes/{paper,blueprint,ink,editorial}.json`, `shared/theme.mjs`, `shared/contrast.mjs`, `shared/test/{theme,contrast}.test.mjs`, `shared/test/fixtures/low-contrast.json` | Task 2: tokens, variables, the kind-hue rule, RED fixture |
| R | `skills/*/shared/` | Task 2: `node bin/sync-shared.mjs` |
| M | `skills/make-diagram/scripts/lib/kinds.mjs` | Task 3: `name` and `family` per kind; `FAMILIES`; `family(type, kind)` |
| M | `skills/make-diagram/scripts/lib/sizes.mjs` | Task 3: tile, type line, mono note, `tileOf`, `trackedWidth`; Task 4: group label tracking |
| M | `skills/make-diagram/scripts/lib/parts.mjs` | Task 3: tile, emoji, type line, `pa-wire`, `data-family`, family class on nodes; Task 4: pill radius |
| M | `skills/make-diagram/scripts/lib/render.mjs`, `render-sequence.mjs` | Task 3: families on nodes and edges; Task 4: lane bars, legend |
| M | `skills/make-diagram/scripts/lib/layout-graph.mjs`, `layout-sequence.mjs` | Task 3: `emoji`, `typeLine` on nodes and participants; Task 4: legend band and `legend` |
| M | `skills/make-diagram/scripts/lib/lint.mjs` | Task 3: text room from the tile |
| M | `skills/make-diagram/scripts/lib/css.mjs` | Task 3: card, family, tone, wire and head rules; Task 4: lanes, pills, legend; Task 5: dark rules |
| C | `skills/make-diagram/scripts/lib/lanes.mjs`, `legend.mjs` | Task 4 |
| M | `skills/make-diagram/scripts/lib/layout.mjs` | Task 4: `stretchLanes` after `layoutGraph` |
| C | `skills/make-diagram/scripts/lib/theme.mjs` | Task 5: `DIAGRAM_THEME`, `themeFor` |
| M | `skills/make-diagram/scripts/lib/api.mjs`, `scripts/lib/spec.mjs`, `scripts/build.mjs` | Task 5: read the default from `theme.mjs` |
| M | `skills/make-diagram/template/viewer.html`, `template/toolbar.js` | Task 5: canvas and chrome; export variables |
| M | `skills/make-diagram/references/schema.md:19` | Task 5: the default theme is `blueprint` |
| C | `skills/make-diagram/test/{look,lanes,legend,theme}.test.mjs`, `test/look-browser.test.mjs` | tests |
| M | `skills/make-diagram/test/{render,layout-graph,layout-sequence,api,build,browser}.test.mjs` | named behaviour changes |
| R | `skills/make-diagram/test/golden/*` (+ `story.svg`, `story.layout.json`), `skills/make-explainer/test/golden/recap.body.html` | Task 5, once |

---

### Task 1: story.js: the dot starts on its edge, step beats keep the camera's glide, chapter buttons survive an empty chapter list

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/story.js:172-191` (`travel`), `:216-234` (`show`), `:263-268` (`prevChapter`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/camera.js:156-165` (the returned object)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/story-unit.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/story-browser.test.mjs` (one new test after `the dot travels along the hop edge…`; the one-beat loop test's fixed wait)

**Interfaces:**
- Consumes: `PADiagram.story(stage, svg, data, els, camera, hooks)` as phase 1 left it; `camera.moveTo(target, { ms })`; `data.beats[i].kind` (`hop` | `focus` | `step`).
- Produces: `camera.glideMs()` → `300` (the camera's `CAMERA_MS`). In `story.js`: a step beat's camera move passes `{ ms: camera.glideMs() / speed }` and waits that long; a hop or focus beat passes `{ ms: GLIDE_MS / speed }` (600 / speed); `travel` sets `cx`/`cy` to `path.getPointAtLength(reverse ? length : 0)` before adding `pa-dot-on`; `prevChapter` on data with `chapters: []` goes to beat 0.
- Behaviour the phase changes: a step-derived beat glides 300 ms (was 600). Nothing else observable. `test/check.test.mjs:80` doctors the exact line `function next() { if (presenting) goTo(stepIndex + 1); }`; it stays verbatim.

- [ ] **Step 1: Write the failing tests**

Create `test/story-unit.test.mjs`:

```js
// PADiagram.story (template/story.js) in Node: a bare `window` with fakes for
// the stage, the svg, the camera and the timers, so call order and durations
// are deterministic (no browser, no clock). camera.js comes along for
// PADiagram.dict; its factory is never called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = ['camera.js', 'story.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');

// An element that records every class added and every attribute set, in order.
function fakeEl() {
  const classes = new Set();
  const log = [];
  const el = {
    log,
    attrs: {},
    path: null,
    classList: {
      add: (...c) => c.forEach((x) => { classes.add(x); log.push(x); }),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    setAttribute(name, value) { el.attrs[name] = value; log.push(name); },
    getAttribute(name) { return el.attrs[name] ?? null; },
    querySelector() { return el.path; },
  };
  return el;
}
// A straight 100-unit edge from (0, 0) to (100, 0).
const straight = { getTotalLength: () => 100, getPointAtLength: (l) => ({ x: l, y: 0 }) };

const beat = (kind, extra) => ({ kind, chapter: 0, title: kind, edge: null, reverse: false, ids: [], reveal: [], highlight: [], ...extra });
const STEPS = {
  type: 'flow', ids: ['a', 'b'], edges: { 'edge-0': ['a', 'b'] }, parents: {}, frames: [],
  beats: [beat('step', { title: 'One', ids: ['a'], reveal: ['a'] }), beat('step', { title: 'Two', ids: ['b'], reveal: ['b'] })],
  chapters: [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: 2 }],
};
const HOPS = {
  type: 'flow', ids: ['a', 'b'], edges: { 'edge-0': ['a', 'b'] }, parents: {}, frames: [],
  beats: [beat('hop', { title: 'There', edge: 'edge-0', ids: ['a', 'b'] }), beat('hop', { title: 'Back', edge: 'edge-0', reverse: true, ids: ['a', 'b'] })],
  chapters: [{ id: 's', title: 'S', start: 0, end: 2 }],
};

// Loads the modules on a bare window and mounts a story over fakes. Timers and
// animation frames are recorded, never run: a test fires the one it wants.
function load(data) {
  const timers = [];
  const frames = [];
  const moves = [];
  const dot = fakeEl();
  const win = {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    document: { createElementNS: () => dot },
  };
  new Function('window', src)(win);
  const stage = fakeEl();
  const svg = { namespaceURI: 'svg', querySelectorAll: () => [], appendChild: () => {} };
  const edge = fakeEl();
  edge.path = straight;
  const els = { nodes: Object.create(null), groups: Object.create(null), edges: Object.create(null), labels: Object.create(null), lifelines: [], frames: [], notes: [] };
  for (const id of Object.keys(data.edges)) els.edges[id] = edge;
  const camera = {
    reduced: () => false, unfit() {}, fit() {}, glideMs: () => 300,
    fitCamera: () => ({ cx: 0, cy: 0, s: 1 }), cameraFor: () => ({ cx: 0, cy: 0, s: 1 }), boxOf: () => null, unionBox: (a, b) => a || b,
    moveTo: (target, options) => { moves.push(options || {}); },
  };
  const story = win.PADiagram.story(stage, svg, data, els, camera, {});
  return { story, moves, timers, frames, dot };
}

test('a step beat glides at the camera default (300 ms) and a story beat at 600 ms; both divide by the speed', () => {
  const steps = load(STEPS);
  steps.story.present(0);
  assert.deepEqual(steps.moves.at(-1), { ms: 300 }, 'the camera is asked for its own pace');
  assert.equal(steps.timers.at(-1).ms, 300, 'and the beat waits that long before its hold');
  steps.story.setSpeed(2);
  steps.story.goTo(1);
  assert.deepEqual([steps.moves.at(-1), steps.timers.at(-1).ms], [{ ms: 150 }, 150]);

  const hops = load(HOPS);
  hops.story.present(0);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 600 }, 600]);
  hops.story.setSpeed(2);
  hops.story.goTo(1);
  assert.deepEqual([hops.moves.at(-1), hops.timers.at(-1).ms], [{ ms: 300 }, 300]);
});

test('the dot is placed on the first point of its edge before it shows, and on the last point for a reverse hop', () => {
  const { story, timers, dot } = load(HOPS);
  story.present(0);
  timers.at(-1).fn(); // the glide is over: the dot sets off
  assert.deepEqual(dot.log.slice(-3), ['cx', 'cy', 'pa-dot-on'], 'position first, then visible');
  assert.deepEqual([dot.attrs.cx, dot.attrs.cy], ['0', '0']);
  story.goTo(1);
  timers.at(-1).fn();
  assert.deepEqual([dot.attrs.cx, dot.attrs.cy], ['100', '0'], 'a reverse hop starts at the far end');
  assert.ok(dot.log.lastIndexOf('pa-dot-on') > dot.log.lastIndexOf('cy'), 'shown only after it moved');
});

test('a timeline with beats but no chapters: prev chapter goes to the first beat, next chapter to the last, nothing throws', () => {
  const { story } = load({ ...HOPS, chapters: [] });
  story.present(1);
  assert.doesNotThrow(() => story.prevChapter());
  assert.equal(story.index(), 0);
  story.nextChapter();
  assert.equal(story.index(), 1);
  assert.equal(story.chapter(), 0);
});
```

In `test/story-browser.test.mjs`, append after the test `the dot travels along the hop edge from its start, and backwards for a reverse hop`:

```js
test('the dot appears on the start of the new edge, never where the previous beat left it (real DOM)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); // beat 6: app -> shopper, reversed along edge-0
  assert.equal(await count(page), '6 / 9');
  await waitDotOn(page);
  await waitDotMoved(page, await dotAt(page)); // the dot now sits somewhere along edge-0
  // Record where the dot is the moment it becomes visible again. The observer runs
  // as a microtask after classList.add, before the first animation frame.
  await page.evaluate(() => {
    window.__dotShows = [];
    const dot = document.querySelector('.pa-dot');
    new MutationObserver(() => {
      if (dot.classList.contains('pa-dot-on')) window.__dotShows.push([Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]);
    }).observe(dot, { attributes: true, attributeFilter: ['class'] });
  });
  await page.keyboard.press('ArrowRight'); // beat 7: orders -> bus along edge-4
  await page.waitForFunction(() => window.__dotShows.length > 0, null, { timeout: 5000 });
  const [shown] = await page.evaluate(() => window.__dotShows);
  const start = await page.evaluate(() => { const p = document.querySelector('.pa-edge[data-id="edge-4"] path').getPointAtLength(0); return [p.x, p.y]; });
  assert.ok(Math.hypot(shown[0] - start[0], shown[1] - start[1]) < 1, `first shown at ${shown}; edge-4 starts at ${start}`);
  assert.deepEqual(problems, []);
  await context.close();
});
```

In the same file, in the test `a one-beat story plays to its end at once and loops when asked`, replace the three lines

```js
  await page.keyboard.press('Space');
  await page.waitForTimeout(5000); // two full cycles at 2×: still looping (the one fixed wait in this suite; it asserts persistence, not arrival)
  assert.equal(await playing(page), true);
```

with

```js
  await page.evaluate(() => {
    window.__dotRuns = 0;
    const dot = document.querySelector('.pa-dot'); // created by the first play above
    new MutationObserver(() => { if (dot.classList.contains('pa-dot-on')) window.__dotRuns += 1; }).observe(dot, { attributes: true, attributeFilter: ['class'] });
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__dotRuns >= 2, null, { timeout: 10000 }); // the one beat ran twice: it looped
  assert.equal(await playing(page), true);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-unit.test.mjs test/story-browser.test.mjs`
Expected: `a step beat glides…` fails at `the camera is asked for its own pace` (actual `{ ms: 600 }`); `the dot is placed…` fails at `position first, then visible` (actual `['class', 'r', 'pa-dot-on']`: the class is added before any `cx`); `a timeline with beats but no chapters…` fails with `TypeError: Cannot read properties of undefined (reading 'start')` from `prevChapter`. In the browser suite `the dot appears on the start of the new edge…` fails at `first shown at …`: the recorded point lies on edge-0, tens of px from edge-4's start. The one-beat loop test still passes.

- [ ] **Step 3: Implement**

`template/camera.js` — add `glideMs` to the returned object (after `onResize: onResize,`):

```js
      onResize: onResize,
      glideMs: function () { return CAMERA_MS; },
```

`template/story.js` — `travel` parks the dot before it shows. Replace

```js
      var length = path.getTotalLength();
      var el = dotEl();
      el.classList.add('pa-dot-on');
```

with

```js
      var length = path.getTotalLength();
      var el = dotEl();
      // Park the dot on the edge's first point before it shows: left where the
      // last beat ended, it would flash there for one frame.
      var start = path.getPointAtLength(beat.reverse ? length : 0);
      el.setAttribute('cx', String(start.x));
      el.setAttribute('cy', String(start.y));
      el.classList.add('pa-dot-on');
```

`show` glides a step beat at the camera's own pace. Replace

```js
    function show(beat, seen) {
      var token = run;
      var instant = camera.reduced();
      camera.unfit();
      camera.moveTo(targetOf(beat, seen), { ms: GLIDE_MS / speed });
```

with

```js
    function show(beat, seen) {
      var token = run;
      var instant = camera.reduced();
      // A story beat glides GLIDE_MS; a step beat (the older steps[] form) keeps the camera's own pace.
      var glide = (beat.kind === 'step' ? camera.glideMs() : GLIDE_MS) / speed;
      camera.unfit();
      camera.moveTo(targetOf(beat, seen), { ms: glide });
```

and, in the same function, `later(token, instant ? 0 : GLIDE_MS / speed, function () {` becomes `later(token, instant ? 0 : glide, function () {`.

`prevChapter` guards an empty chapter list:

```js
    // From inside a chapter, back to its first beat; from its first beat, to the
    // chapter before. A timeline with no chapters acts as one chapter.
    function prevChapter() {
      if (!presenting) return;
      var c = chapterAt(stepIndex);
      var start = chapters[c] ? chapters[c].start : 0;
      goTo(stepIndex > start || c === 0 ? start : chapters[c - 1].start);
    }
```

Update the header comment's duration line to: `Playing runs each beat as glide (600 ms for a story beat, the camera's 300 ms for a step beat), then (a hop, motion allowed) the dot, then a hold, and moves on; every duration divides by the speed; reduced motion drops the dot and the glide.`

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-unit.test.mjs test/story-browser.test.mjs` — expected: all pass. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green (`runtime.test.mjs`: story.js ≈ 326 lines, camera.js 168). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (its overlay steps with ArrowRight; the glide now takes 300 ms as before phase 1).

- [ ] **Step 5: Guard proofs** (revert each edit before moving on)

1. In `story.js`, move `el.classList.add('pa-dot-on');` back above the `var start = …` line; run `node --test test/story-unit.test.mjs` — expected: FAIL at `position first, then visible`; run `node --test --test-name-pattern="never where the previous beat" test/story-browser.test.mjs` — expected: FAIL at `first shown at`. Revert.
2. In `story.js`, change `var start = chapters[c] ? chapters[c].start : 0;` to `var start = chapters[c].start;`; run `node --test test/story-unit.test.mjs` — expected: FAIL with the `TypeError`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 6: Commit**

Message: `fix(make-diagram): the dot starts on its edge, step beats keep the camera's glide, chapter buttons survive an empty chapter list` — the orchestrator commits; do not run git commit.

---

### Task 2: kind hue and glow tokens in every theme, with a contrast rule

**Files:**
- Modify: `plugins/portable-artifacts/shared/themes/paper.json`, `blueprint.json`, `ink.json`, `editorial.json`
- Modify: `plugins/portable-artifacts/shared/theme.mjs:17-23` (`VARS`)
- Modify: `plugins/portable-artifacts/shared/contrast.mjs`
- Modify: `plugins/portable-artifacts/shared/test/theme.test.mjs`, `shared/test/contrast.test.mjs`, `shared/test/fixtures/low-contrast.json`
- Run: `node bin/sync-shared.mjs` (regenerates `skills/make-dashboard/shared/`, `skills/make-diagram/shared/`, `skills/make-explainer/shared/`)

**Interfaces:**
- Produces: tokens `kindPerson`, `kindService`, `kindData`, `kindQueue`, `kindExternal`, `kindDecision`, `glow` in `light` and `dark` of every theme; `VARS` maps them to `--k-person`, `--k-service`, `--k-data`, `--k-queue`, `--k-external`, `--k-decision`, `--glow`; `TOKENS` lists them (so the existing "every theme defines every token" test covers them).
- Produces: `contrast.mjs` → `export const TINT = 0.1`, `export function mixHex(a, b, share)` (a·share + b·(1−share) per 8-bit channel, rounded, as `color-mix(in srgb, a share%, b)` does), and a `checkTheme` rule: each kind hue ≥ 4.5:1 against `surface`, ≥ 4.5:1 against `mixHex(hue, surface, TINT)`, ≥ 3:1 against `page`.
- Values (identical across the four themes; verified with `contrastRatio` against every theme's surfaces and pages):

| token | light | lowest ratio, light (surface / tint / page) | dark | lowest ratio, dark (surface / tint / page) |
|---|---|---|---|---|
| `kindPerson` | `#a3480a` | 5.97 / 5.17 / 5.52 (editorial) | `#f5a524` | 8.41 / 7.05 / 9.14 (blueprint) |
| `kindService` | `#0e7490` | 5.31 / 4.62 / 4.92 (editorial) | `#38bdf8` | 8.01 / 6.71 / 8.71 (blueprint) |
| `kindData` | `#6d28d9` | 7.04 / 5.99 / 6.52 (editorial) | `#a78bfa` | 6.31 / 5.42 / 6.85 (blueprint) |
| `kindQueue` | `#0f766e` | 5.43 / 4.71 / 5.02 (editorial) | `#2dd4bf` | 9.22 / 7.64 / 10.02 (blueprint) |
| `kindExternal` | `#56677b` | 5.75 / 5.03 / 5.32 (editorial) | `#94a3b8` | 6.69 / 5.66 / 7.27 (blueprint) |
| `kindDecision` | `#4338ca` | 7.84 / 6.65 / 7.25 (editorial) | `#818cf8` | 5.75 / 4.99 / 6.25 (blueprint) |

`glow`: light = the theme's `accent` (unused by the light look, but every token is defined in both modes); dark = a brighter accent: blueprint `#8fd0ff`, paper `#5eead4`, ink `#fdba74`, editorial `#b4d4f0`.

- [ ] **Step 1: Write the failing tests**

`shared/test/theme.test.mjs` — append:

```js
test('kind hues and the glow are tokens with their own CSS variables', () => {
  for (const k of ['kindPerson', 'kindService', 'kindData', 'kindQueue', 'kindExternal', 'kindDecision', 'glow']) assert.ok(TOKENS.includes(k), k);
  const css = themeCss(loadTheme('blueprint'));
  assert.ok(css.includes('--k-person:#a3480a'), 'light person hue on :root');
  assert.ok(css.includes('--k-service:#38bdf8'), 'dark service hue');
  assert.ok(css.includes('--glow:#8fd0ff'), 'dark glow');
  for (const v of ['--k-data', '--k-queue', '--k-external', '--k-decision']) assert.ok(css.includes(`${v}:`), v);
});
```

`shared/test/contrast.test.mjs` — append:

```js
test('mixHex mixes two colours per channel like color-mix(in srgb)', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.1), '#e6e6e6');
  assert.equal(mixHex('#0e7490', '#ffffff', 0.1), '#e7f1f4');
  assert.equal(mixHex('#abcdef', '#123456', 1), '#abcdef');
  assert.equal(TINT, 0.1);
});

test('a kind hue too pale for its tint fails with the token, mode and ratio named (guardrail RED proof)', () => {
  const bad = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/low-contrast.json'), 'utf8'));
  const errors = checkTheme(bad);
  assert.ok(errors.some((e) => e.path === 'light.kindExternal' && /\d\.\d\d:1 against surface; needs 4\.5:1/.test(e.message)), JSON.stringify(errors));
  assert.ok(errors.some((e) => e.path === 'dark.kindDecision' && /against its tint; needs 4\.5:1/.test(e.message)));
  assert.ok(errors.some((e) => e.path === 'dark.kindDecision' && /against page; needs 3:1/.test(e.message)));
});
```

and change the import line to `import { contrastRatio, relativeLuminance, checkTheme, mixHex, TINT } from '../contrast.mjs';`.

`shared/test/fixtures/low-contrast.json` — add to `light` (after `"seq7": "#0d366b"`):

```json
    "kindPerson": "#a3480a", "kindService": "#0e7490", "kindData": "#6d28d9", "kindQueue": "#0f766e", "kindExternal": "#c0c6cf", "kindDecision": "#4338ca", "glow": "#0f766e"
```

and to `dark` (after its `"seq7"`):

```json
    "kindPerson": "#f5a524", "kindService": "#38bdf8", "kindData": "#a78bfa", "kindQueue": "#2dd4bf", "kindExternal": "#94a3b8", "kindDecision": "#2a2f36", "glow": "#5eead4"
```

(`#c0c6cf` on white is 1.7:1; `#2a2f36` on the fixture's dark surface `#171a19` is 1.2:1, so it fails all three rules.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`
Expected: `contrast.test.mjs` fails at import (`does not provide an export named 'mixHex'`); `theme.test.mjs` `kind hues and the glow…` fails at `kindPerson` (`TOKENS` lacks it).

- [ ] **Step 3: Implement**

`shared/theme.mjs` — `VARS` becomes:

```js
const VARS = {
  page: '--page', surface: '--surface', text: '--text', text2: '--text-2', text3: '--text-3',
  line: '--line', grid: '--grid', accent: '--accent', accentSoft: '--accent-soft',
  warn: '--warn', good: '--good', bad: '--bad',
  cat1: '--s1', cat2: '--s2', cat3: '--s3', cat4: '--s4', cat5: '--s5', cat6: '--s6', cat7: '--s7', cat8: '--s8',
  seq1: '--seq1', seq2: '--seq2', seq3: '--seq3', seq4: '--seq4', seq5: '--seq5', seq6: '--seq6', seq7: '--seq7',
  // make-diagram's kind families (one hue each) and the dark-mode glow
  kindPerson: '--k-person', kindService: '--k-service', kindData: '--k-data', kindQueue: '--k-queue', kindExternal: '--k-external', kindDecision: '--k-decision',
  glow: '--glow',
};
```

`shared/themes/*.json` — add to every theme's `light` block (after `seq7`):

```json
    "kindPerson": "#a3480a",
    "kindService": "#0e7490",
    "kindData": "#6d28d9",
    "kindQueue": "#0f766e",
    "kindExternal": "#56677b",
    "kindDecision": "#4338ca",
    "glow": "<the theme's light accent: blueprint #1e5f8a, paper #0f766e, ink #9a3412, editorial #1f4e79>"
```

and to every `dark` block:

```json
    "kindPerson": "#f5a524",
    "kindService": "#38bdf8",
    "kindData": "#a78bfa",
    "kindQueue": "#2dd4bf",
    "kindExternal": "#94a3b8",
    "kindDecision": "#818cf8",
    "glow": "<blueprint #8fd0ff, paper #5eead4, ink #fdba74, editorial #b4d4f0>"
```

(`paper.json` keeps its one-line-per-block style: append the seven pairs to each block's last line.)

`shared/contrast.mjs` — add after `contrastRatio`:

```js
const KIND = ['kindPerson', 'kindService', 'kindData', 'kindQueue', 'kindExternal', 'kindDecision'];
// make-diagram paints a card as its kind hue mixed TINT into the surface
// (css.mjs: color-mix(in srgb, hue 10%, surface)) and writes the kind on it in
// the hue itself, so the hue is small text on that tint. One number, two places.
export const TINT = 0.1;

const hex2 = (n) => n.toString(16).padStart(2, '0');
/** `a` mixed `share` (0..1) into `b`, per 8-bit channel and rounded: color-mix(in srgb, a share%, b). */
export function mixHex(a, b, share) {
  const ch = (c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  const [ca, cb] = [ch(a), ch(b)];
  return `#${ca.map((v, i) => hex2(Math.round(v * share + cb[i] * (1 - share)))).join('')}`;
}
```

and, inside `checkTheme`'s mode loop, after the `UI` loop:

```js
    for (const k of KIND) {
      const against = [['surface', t.surface, 4.5], ['its tint', mixHex(t[k], t.surface, TINT), 4.5], ['page', t.page, 3]];
      for (const [what, bg, need] of against) {
        const r = contrastRatio(t[k], bg);
        if (r < need) errors.push({ path: `${mode}.${k}`, message: `${t[k]} is ${fmt(r)} against ${what}; needs ${need}:1` });
      }
    }
```

Then sync: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs` — expected `synced shared/ into make-dashboard, make-diagram, make-explainer`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — expected: all pass (`every shipped theme passes checkTheme` now covers the kind rule). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs --check` — `shared/ copies are in sync`. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test`, `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` and `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-dashboard && npm test` — green: the pages gain seven variables nothing reads yet; no test pins the variable list.

- [ ] **Step 5: Commit**

Message: `feat(portable-artifacts): kind hue and glow tokens in every theme` (body: `shared/contrast.mjs gates each hue at 4.5:1 against the surface and its 10% tint; skills/*/shared regenerated with node bin/sync-shared.mjs`) — the orchestrator commits; do not run git commit.

---
### Task 3: kind families, the card (tile, emoji, type line, mono note), `pa-wire` edges with context-stroke heads

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/kinds.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/sizes.mjs` (rewritten)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/parts.mjs` (rewritten)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/css.mjs` (rewritten)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/render.mjs:6-7,26-30,32-43`, `render-sequence.mjs:6,9,43-46,51-58`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/layout-graph.mjs:173-190` (`readNode`), `layout-sequence.mjs:245-255` (participants), `lint.mjs:48-53,106-110`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/look.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/render.test.mjs`, `test/layout-graph.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_ICON` (icons.mjs), `measure`/`lineHeight`/`fontFor` (shared/text.mjs; `fontFor(theme, 'mono')` → `{ family, weight: 400 }`; metrics exist for IBM Plex Mono and JetBrains Mono), the theme variables `--k-<family>` (Task 2), `esc`/`num`/`textLines`/`iconGroup`/`ICON_DRAW` (svg.mjs).
- Produces (kinds.mjs): `KINDS[type].kinds[kind] = { name, shape, icon, family }`; `FAMILIES = ['person', 'service', 'data', 'queue', 'external', 'decision']`; `family(type, kind)` → one of those or `'bare'` (flow and state `start`/`end`).
- Produces (sizes.mjs): constants `TILE_SIZE = 28`, `TILE_GAP = 10`, `TILE_PAD_Y = 6`, `TILE_RADIUS = 7`, `TYPE_SIZE = 10`, `TYPE_TRACK = 0.8`, `TYPE_GAP = 2`, `NOTE_SIZE = 11`, `EMOJI_SIZE = 18`, `LEGEND_SIZE = 11`, `GROUP_TRACK = 0.9`, `EDGE_LABEL_PAD_X = 8`; `fonts(theme)` → `{ label, note (mono 11), type (body 600 10), edge, group, legend }`; `trackedWidth(text, font, track)`; `tileOf(node, kindInfo)` → `{ icon, emoji }`; `nodeSize(node, kindInfo, theme)` → `{ width, height, lines, noteLine, icon, emoji, typeLine, labelBox? }` (`typeLine` is the uppercased kind name when the node has a tile, else `null`); `textRoom(shape, width, hasTile)`. `ICON_SIZE` and `ICON_GAP` are gone.
- Produces (geometry): a graph node and a sequence participant carry `emoji` (string or null) and `typeLine` (string or null).
- Produces (SVG): node `<g class="pa-node pa-kind-K pa-family-F pa-tone-T">`; inside a card with a tile: `<rect class="pa-tile" … width="28" height="28" rx="7"/>` then either `<g class="pa-icon …">` or `<text class="pa-emoji" …>😀</text>`, then `<text class="pa-type">SERVICE</text>`, the label, the note; edge `<g class="pa-edge pa-edge-S" data-id data-from data-to [data-family="F"]><path class="pa-wire" d="…" fill="none" marker-end=…/></g>` (`data-family` is the from-node's family; absent when the edge leaves a group).
- Produces (CSS, `diagramCss()`): family rules `.pa-family-F .pa-shape{fill:color-mix(in srgb,var(--k-F) 10%,var(--surface));stroke:var(--k-F)}` etc., `.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}`, tone rules after family rules, `.pa-wire` for every edge rule, `.pa-arrow-fill{fill:context-stroke;stroke:none}`, `.pa-arrow-open{fill:none;stroke:context-stroke;…}`, `.pa-dim{opacity:.25}`; `export const CARD_TINT = 10`.
- Behaviour the phase changes (named): node class gains `pa-family-F` (`render.test.mjs:101`); the edge path carries `class="pa-wire"` (`render.test.mjs:154`, every ` path` rule); the tone border is 2 px (`render.test.mjs:364`); `diagramCss` may contain `color-mix` and (from Task 5) `drop-shadow`, so `render.test.mjs:311-319` is rewritten; the dynamic-class regex at `render.test.mjs:355` is tightened so `pa-tile`, `pa-type`, `pa-emoji`, `pa-wire` must have rules; geometry nodes gain `emoji` and `typeLine` (`layout-graph.test.mjs:323`); `ICON_SIZE`/`ICON_GAP` imports in `layout-graph.test.mjs` become `TILE_SIZE`/`TILE_GAP`. The SVG goldens turn red here and stay red until Task 5 regenerates them.

- [ ] **Step 1: Write the failing tests**

Create `test/look.test.mjs`:

```js
// The look: kind families, the card (tile, emoji, type line, note), family-tinted
// edges, and the CSS that paints them. Lanes, pills and the legend join in Task 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg, diagramCss } from '../scripts/lib/render.mjs';
import { nodeSize, textRoom, fonts, tileOf, trackedWidth, TILE_SIZE, TILE_GAP, TILE_PAD_Y, TYPE_TRACK } from '../scripts/lib/sizes.mjs';
import { KINDS, FAMILIES, family } from '../scripts/lib/kinds.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const draw = async (spec) => renderSvg(await layoutDiagram(spec, theme), spec, { theme });
const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
// A node's whole <g>: it ends with its last <text>, after any <g class="pa-icon"> inside it.
const nodeOf = (svg, id) => tagsOf(svg, new RegExp(`<g class="pa-node [^>]*data-id="${id}"[^>]*>[\\s\\S]*?</text></g>`, 'g'))[0];
const yOf = (node, cls) => Number(node.match(new RegExp(`<text class="${cls}"[^>]*><tspan x="[\\d.]+" y="([\\d.]+)"`))[1]);

test('family: one hue per kind family across the four types; bare shapes have none', () => {
  assert.deepEqual(FAMILIES, ['person', 'service', 'data', 'queue', 'external', 'decision']);
  assert.equal(family('architecture', 'user'), 'person');
  assert.equal(family('sequence', 'actor'), 'person');
  for (const k of ['service', 'client', 'function', 'gateway', 'cache', 'other']) assert.equal(family('architecture', k), 'service', k);
  for (const k of ['step', 'io', 'subprocess', 'wait']) assert.equal(family('flow', k), 'service', k);
  assert.equal(family('architecture', undefined), 'service', 'the default kind');
  assert.equal(family('architecture', 'database'), 'data');
  assert.equal(family('architecture', 'storage'), 'data');
  assert.equal(family('sequence', 'queue'), 'queue');
  assert.equal(family('architecture', 'external'), 'external');
  assert.equal(family('flow', 'decision'), 'decision');
  assert.equal(family('state', 'choice'), 'decision');
  assert.equal(family('state', undefined), 'decision', 'a state card is indigo');
  for (const [t, k] of [['flow', 'start'], ['flow', 'end'], ['state', 'start'], ['state', 'end']]) assert.equal(family(t, k), 'bare', `${t}.${k}`);
  assert.deepEqual(KINDS.architecture.kinds.database, { name: 'database', shape: 'cylinder', icon: 'lucide:database', family: 'data' });
});

test('a card has a tile (icon, or the emoji instead), the kind in spaced capitals and the label; a bare shape has none', () => {
  const service = KINDS.architecture.kinds.service;
  const plain = nodeSize({ id: 'a', label: 'Orders' }, service, theme);
  assert.deepEqual([plain.icon, plain.emoji, plain.typeLine], ['lucide:server', null, 'SERVICE']);
  assert.ok(plain.height >= TILE_SIZE + 2 * TILE_PAD_Y, 'the tile fits');
  const emoji = nodeSize({ id: 'a', label: 'Orders', emoji: '📦', icon: 'brand:postgresql' }, service, theme);
  assert.deepEqual([emoji.icon, emoji.emoji, emoji.typeLine], [null, '📦', 'SERVICE'], 'the emoji replaces the icon');
  assert.equal(emoji.width, plain.width, 'one tile size, icon or emoji');
  assert.deepEqual(tileOf({ emoji: '🚚' }, KINDS.flow.kinds.step), { icon: null, emoji: '🚚' });
  const step = nodeSize({ id: 's', label: 'Ship the parcel to the warehouse' }, KINDS.flow.kinds.step, theme); // wider than the 80 px minimum, so the tile shows in the width
  assert.deepEqual([step.icon, step.emoji, step.typeLine], [null, null, null], 'a plain step: no tile, no type line');
  const stepEmoji = nodeSize({ id: 's', label: 'Ship the parcel to the warehouse', emoji: '🚚' }, KINDS.flow.kinds.step, theme);
  assert.equal(stepEmoji.typeLine, 'STEP');
  assert.ok(stepEmoji.width - step.width >= TILE_SIZE + TILE_GAP - 2, 'an emoji on a step reserves the tile');
  const dot = nodeSize({ id: 'd', label: 'Begin' }, KINDS.state.kinds.start, theme);
  assert.deepEqual([dot.icon, dot.emoji, dot.typeLine, dot.width], [null, null, null, 20]);
  const decision = nodeSize({ id: 'q', label: 'Known?', emoji: '🤔' }, KINDS.flow.kinds.decision, theme);
  assert.deepEqual([decision.emoji, decision.typeLine], [null, null], 'a diamond has no tile even if the spec slipped an emoji past validation');
  assert.equal(textRoom('rounded-rect', 200, true), 200 - 28 - (TILE_SIZE + TILE_GAP));
  assert.equal(textRoom('rounded-rect', 200, false), 172);
});

test('the card is at least as wide as its type line; notes are measured in the theme mono font at 11 px', () => {
  const f = fonts(theme);
  assert.deepEqual([f.note.family, f.note.weight, f.note.size], ['IBM Plex Mono', 400, 11]);
  assert.deepEqual([f.type.family, f.type.weight, f.type.size], ['IBM Plex Sans', 600, 10]);
  assert.equal(fonts(loadTheme('ink')).note.family, 'JetBrains Mono');
  assert.deepEqual([f.legend.size, f.legend.weight], [11, 400]);
  const narrow = nodeSize({ id: 'x', label: 'Io' }, KINDS.architecture.kinds.external, theme);
  assert.ok(narrow.width >= trackedWidth('EXTERNAL', f.type, TYPE_TRACK) + 28 + TILE_SIZE + TILE_GAP - 2, `${narrow.width} holds the type line`);
  assert.ok(trackedWidth('ab', f.type, TYPE_TRACK) > trackedWidth('AB', f.type, 0), 'tracking adds width; the measurement is of the capitals');
});

test('the SVG card: family class, rect.pa-tile, the icon or the emoji inside it, text.pa-type above the label, the note below', async () => {
  const svg = await draw(example('story'));
  const orders = nodeOf(svg, 'orders');
  assert.match(orders, /^<g class="pa-node pa-kind-service pa-family-service pa-tone-neutral"/);
  assert.match(orders, /<rect class="pa-tile" x="[\d.]+" y="[\d.]+" width="28" height="28" rx="7"\/>/);
  assert.match(orders, /<text class="pa-emoji" text-anchor="middle" x="[\d.]+" y="[\d.]+">📦<\/text>/);
  assert.ok(!orders.includes('pa-icon'), 'the emoji replaces the icon');
  assert.match(orders, /<text class="pa-type" text-anchor="middle"><tspan [^>]*>SERVICE<\/tspan><\/text>/);
  const gateway = nodeOf(svg, 'gateway');
  assert.match(gateway, /pa-kind-gateway pa-family-service/);
  assert.match(gateway, /<rect class="pa-tile"/);
  assert.match(gateway, /<g class="pa-icon pa-icon-lucide"/);
  assert.match(gateway, />GATEWAY<\/tspan>/);
  assert.match(gateway, /<text class="pa-note"[^>]*><tspan[^>]*>auth, rate limits<\/tspan>/);
  assert.ok(yOf(gateway, 'pa-type') < yOf(gateway, 'pa-label') && yOf(gateway, 'pa-label') < yOf(gateway, 'pa-note'), 'type, label, note from top to bottom');
  assert.match(nodeOf(svg, 'warehouse'), /pa-kind-external pa-family-external pa-tone-warn/);
  assert.match(nodeOf(svg, 'shopper'), /pa-kind-user pa-family-person/);
  assert.match(nodeOf(svg, 'db'), /pa-kind-database pa-family-data/);
  assert.match(nodeOf(svg, 'bus'), /pa-kind-queue pa-family-queue/);

  const flow = await draw(example('flow'));
  const begin = nodeOf(flow, 'begin');
  assert.match(begin, /pa-kind-start pa-family-bare/);
  assert.ok(!begin.includes('pa-tile') && !begin.includes('pa-type'), 'a pill carries no tile or type line');
  const known = nodeOf(flow, 'known');
  assert.match(known, /pa-kind-decision pa-family-decision/);
  assert.ok(!known.includes('pa-tile'));
  assert.match(nodeOf(flow, 'ask'), /pa-kind-io pa-family-service[\s\S]*<rect class="pa-tile"[\s\S]*>IO<\/tspan>/);

  const seq = await draw(example('sequence'));
  const shopper = nodeOf(seq, 'shopper');
  assert.match(shopper, /pa-kind-actor pa-family-person/);
  assert.match(shopper, /<rect class="pa-tile"[\s\S]*>ACTOR<\/tspan>/);
  const withEmoji = await draw({ ...example('sequence'), participants: example('sequence').participants.map((p) => (p.id === 'web' ? { ...p, emoji: '🌐' } : p)) });
  assert.match(nodeOf(withEmoji, 'web'), /<text class="pa-emoji"[^>]*>🌐<\/text>/);
});

test('an edge carries its from-node family and one path.pa-wire; an edge leaving a group has no family', async () => {
  const svg = await draw(example('story'));
  const edges = tagsOf(svg, /<g class="pa-edge [^>]*>/g);
  const byId = (id) => edges.find((e) => attr(e, 'data-id') === id);
  assert.equal(attr(byId('edge-0'), 'data-family'), 'person', 'shopper (user) -> app');
  assert.equal(attr(byId('place'), 'data-family'), 'service', 'app (client) -> gateway');
  assert.equal(attr(byId('edge-4'), 'data-family'), 'service', 'orders -> bus');
  assert.equal(attr(byId('edge-5'), 'data-family'), 'queue', 'bus -> warehouse');
  assert.equal(tagsOf(svg, /<g class="pa-edge [^>]*><path class="pa-wire" d="[^"]*" fill="none" marker-end=/g).length, 7, 'every edge: one wire');
  const fromGroup = await draw({ title: 't', type: 'architecture', groups: [{ id: 'g', label: 'G' }], nodes: [{ id: 'a', label: 'A', group: 'g' }, { id: 'b', label: 'B' }], edges: [{ from: 'g', to: 'b' }] });
  assert.equal(attr(tagsOf(fromGroup, /<g class="pa-edge [^>]*>/g)[0], 'data-family'), undefined);
  const seq = await draw(example('sequence'));
  assert.equal(attr(tagsOf(seq, /<g class="pa-edge [^>]*data-id="m1"[^>]*>/g)[0], 'data-family'), 'person');
  assert.equal(attr(tagsOf(seq, /<g class="pa-edge [^>]*data-id="m5"[^>]*>/g)[0], 'data-family'), 'external', 'psp replies');
});

test('diagramCss: family rules tint the card and colour the tile, icon, type line and outgoing wires; tones come after and win; heads follow the wire', () => {
  const css = diagramCss();
  for (const f of FAMILIES) {
    assert.ok(css.includes(`.pa-family-${f} .pa-shape{fill:color-mix(in srgb,var(--k-${f}) 10%,var(--surface));stroke:var(--k-${f})}`), f);
    assert.ok(css.includes(`.pa-family-${f} .pa-tile{fill:color-mix(in srgb,var(--k-${f}) `), `${f} tile`);
    assert.ok(css.includes(`.pa-family-${f} .pa-icon{color:var(--k-${f})}`), `${f} icon`);
    assert.ok(css.includes(`.pa-family-${f} .pa-type{fill:var(--k-${f})}`), `${f} type line`);
    assert.ok(css.includes(`.pa-edge[data-family="${f}"] .pa-wire{stroke:var(--k-${f})}`), `${f} wire`);
  }
  assert.ok(css.includes('.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}'));
  const after = (a, b) => assert.ok(css.indexOf(a) > css.lastIndexOf(b), `${a} comes after ${b}`);
  after('.pa-tone-warn .pa-shape{', '.pa-family-decision .pa-shape{');
  after('.pa-node .pa-shape-filled-dot{', '.pa-family-bare .pa-shape{');
  after('.pa-tone-good .pa-shape-filled-dot{', '.pa-node .pa-shape-filled-dot{');
  after('.pa-hl .pa-shape,', '.pa-tone-bad .pa-shape{');
  assert.ok(css.includes('.pa-tone-warn .pa-type{fill:var(--warn)}'));
  assert.match(css, /\.pa-arrow-fill\{fill:context-stroke;stroke:none\}/);
  assert.match(css, /\.pa-arrow-open\{fill:none;stroke:context-stroke;/);
  assert.ok(!/\.pa-edge[^{]* path\{/.test(css), 'no rule strokes a bare path inside an edge group');
  assert.ok(!/\.pa-arrow-fill\{fill:var/.test(css) && !/\.pa-edge\.pa-[a-z]+ \.pa-arrow/.test(css), 'no dead marker rules: markers are not descendants of the edge');
  assert.match(css, /\.pa-wire\{fill:none;stroke:var\(--text-3\);stroke-width:1\.25;stroke-linejoin:round\}/);
  assert.match(css, /\.pa-edge\.pa-active \.pa-wire\{stroke:var\(--accent\);stroke-width:3\}/);
  assert.match(css, /\.pa-emoji\{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;font-size:18px\}/);
  assert.match(css, /\.pa-note\{fill:var\(--text-2\);font-family:var\(--mono\);font-size:11px;font-weight:400\}/);
  assert.match(css, /\.pa-seq-note-text\{fill:var\(--text-2\);font-family:var\(--mono\);font-size:11px;font-weight:400\}/, 'sequence notes are measured with f.note too');
  assert.match(css, /\.pa-type\{font-size:10px;font-weight:600;letter-spacing:\.08em;text-transform:uppercase\}/);
  assert.match(css, /\.pa-tile\{stroke:none\}/);
  assert.match(css, /\.pa-dim\{opacity:\.25\}/);
});
```

`test/render.test.mjs` — the named changes:

1. Imports: add `import { KINDS, family } from '../scripts/lib/kinds.mjs';`.
2. In `every node is a focusable group with classes, data-id and an accessible name`, the class assertion becomes:

```js
      const k = n.kind ?? KINDS[spec.type].default;
      assert.equal(attr(tag, 'class'), `pa-node pa-kind-${k} pa-family-${family(spec.type, n.kind)} pa-tone-${n.tone ?? 'neutral'}`, `${name}.${n.id}`);
```

(the following `aria-label` assertion keeps its inline default-kind expression).

3. In `an edge path ends where the anchored route ends…`: `const paths = tagsOf(svg, /<g class="pa-edge [^>]*><path class="pa-wire" d="[^"]*"/g).map((t) => t.match(/ d="([^"]*)"/)[1]);`.
4. Replace the whole test `diagramCss uses theme variables only and animates inside the reduced-motion guard` with:

```js
test('diagramCss uses theme variables only (mixed or shadowed, never literal) and animates inside the reduced-motion guard', () => {
  const css = diagramCss();
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(css), 'no literal colours');
  assert.ok(!/gradient|url\(/.test(css));
  for (const v of ['--page', '--surface', '--text', '--text-2', '--text-3', '--line', '--accent', '--warn', '--good', '--bad', '--font', '--mono', '--k-service']) assert.ok(css.includes(`var(${v})`), v);
  const motion = css.match(/@media \(prefers-reduced-motion: no-preference\)\{[^]*?\n\}/)?.[0]; // every rule inside is one line; the block's own } stands alone
  assert.ok(motion, 'one reduced-motion block holding the animation and its keyframes');
  assert.match(motion, /\.pa-animate \.pa-wire\{animation:pa-flow/);
  assert.match(motion, /@keyframes pa-flow\{to\{stroke-dashoffset:calc\(var\(--pa-period\) \* -1\)\}\}/);
  assert.ok(!css.replace(motion, '').includes('animation'), 'no animation outside the guard');
});
```

5. In `animation moves dashes without replacing an edge style's dash pattern`, every ` path` becomes ` .pa-wire`:

```js
  const animated = media.match(/\.pa-animate \.pa-wire\{([^}]*)\}/)[1];
  assert.match(animated, /animation:pa-flow/);
  assert.ok(!/dasharray/.test(animated), animated);
  assert.ok(!/\.pa-animate \.pa-edge-(dashed|async)[^{]*\{[^}]*dasharray/.test(media));
  assert.match(media, /\.pa-animate \.pa-edge-solid \.pa-wire\{stroke-dasharray:6 6\}/);
  assert.match(css, /\.pa-edge-dashed \.pa-wire\{[^}]*stroke-dasharray:6 4/);
  assert.match(media, /\.pa-edge-dashed \.pa-wire\{--pa-period:10px\}/);
  assert.match(media, /\.pa-edge-async \.pa-wire\{--pa-period:5\.5px\}/);
  assert.match(media, /\.pa-edge-solid \.pa-wire\{--pa-period:12px\}/);
```

6. In `diagramCss holds the viewer state rules…`: `/\.pa-edge\.pa-selected \.pa-wire\{[^}]*stroke-width:2\.5/` and `/\.pa-edge\.pa-route \.pa-wire\{[^}]*stroke-width:2\.5/`.
7. In `every non-dynamic class the renderers emit has a rule`: `const dynamic = /^pa-(kind-|tone-|shape-|edge-(solid|dashed|async)$|msg-|frame-(loop|alt|opt|par)$|type-|animate$)/;` and the tone line `assert.ok(css.includes(`.pa-tone-${tone} .pa-shape{stroke:var(--${tone});stroke-width:2}`));`.

`test/layout-graph.test.mjs` — imports: replace `ICON_SIZE, ICON_GAP, NOTE_GAP,` with `TILE_SIZE, TILE_GAP, TYPE_GAP, TYPE_TRACK, trackedWidth, NOTE_GAP,`. The `textBlock` helper becomes:

```js
// The tile + text block (centred in the node box) as local coordinates.
function textBlock(node, size, shape) {
  const f = fonts(theme);
  const text = Math.max(
    ...size.lines.map((l) => measure(l, f.label)),
    size.noteLine ? measure(size.noteLine, f.note) : 0,
    size.typeLine ? trackedWidth(size.typeLine, f.type, TYPE_TRACK) : 0,
  );
  const width = text + (size.icon || size.emoji ? TILE_SIZE + TILE_GAP : 0);
  const height = (size.typeLine ? lineHeight(f.type) + TYPE_GAP : 0) + size.lines.length * lineHeight(f.label) + (size.noteLine ? NOTE_GAP + lineHeight(f.note) : 0);
  const x0 = (size.width - width) / 2;
  const y0 = (size.height - height) / 2;
  return { x0, y0, x1: x0 + width, y1: y0 + height, text, height, shape };
}
```

and in `geometry carries the contract fields`:

```js
  assert.deepEqual(Object.keys(api).sort(), ['emoji', 'group', 'height', 'icon', 'id', 'layer', 'lines', 'noteLine', 'shape', 'tone', 'typeLine', 'width', 'x', 'y']);
  assert.equal(api.shape, 'rounded-rect');
  assert.equal(api.icon, 'brand:nodedotjs');
  assert.equal(api.emoji, null);
  assert.equal(api.typeLine, 'SERVICE');
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/look.test.mjs test/render.test.mjs test/layout-graph.test.mjs`
Expected: `look.test.mjs` fails at import (`does not provide an export named 'FAMILIES'`); `render.test.mjs` `every node is a focusable group…` fails at import too (`family`); `layout-graph.test.mjs` fails at import (`TILE_SIZE`).

- [ ] **Step 3: Implement `kinds.mjs` and `sizes.mjs`**

`scripts/lib/kinds.mjs` — the header comment, a family table and the kind record:

```js
// Per-type node kinds. Shape encodes kind (colour is never the only signal);
// `icon` is the default icon ref (null = drawn as a pure shape), read from
// icons.mjs so the two tables cannot drift apart; `family` is the colour family
// css.mjs paints (one hue each; `bare` has none); `name` is the kind itself,
// drawn on the card in spaced capitals. The first kind of each type is its default.
```

After `SHAPES`, before `BOX_SHAPES`:

```js
// kind -> colour family (spec §3). Anything not listed is service-like (cyan).
const FAMILY = {
  user: 'person', actor: 'person',
  database: 'data', storage: 'data',
  queue: 'queue',
  external: 'external',
  decision: 'decision', choice: 'decision', state: 'decision',
  start: 'bare', end: 'bare',
};
export const FAMILIES = Object.freeze(['person', 'service', 'data', 'queue', 'external', 'decision']);

/** The colour family of a kind of this type (the type's default kind when `kind` is undefined). */
export function family(type, kind) {
  return FAMILY[kind ?? KINDS[type].default] ?? 'service';
}
```

and in `build`: `kinds[kind] = Object.freeze({ name: kind, shape, icon: DEFAULT_ICON[kind] ?? null, family: FAMILY[kind] ?? 'service' });`.

`scripts/lib/sizes.mjs` — the whole file:

```js
// Node, edge-label and group sizing from font metrics plus per-shape padding.
// Every figure is a px constant here so the renderer, the stylesheet and the
// geometry lint can reuse them; nothing is measured in a browser.
import { measure, wrap, lineHeight, fontFor } from '../../shared/text.mjs';
import { BOX_SHAPES } from './kinds.mjs';

export const MAX_TEXT_WIDTH = 180; // wrap labels here first
export const MAX_WIDENED_TEXT_WIDTH = 240; // a label that needs a third line widens the wrap, up to here
export const MAX_LABEL_LINES = 2;
const WIDEN_STEP = 10;

export const LABEL_SIZE = 14;
export const NOTE_SIZE = 11; // the note, in the theme's mono font
export const TYPE_SIZE = 10; // the kind, in spaced capitals above the label
export const TYPE_TRACK = 0.8; // px of letter-spacing per character (.08em at 10 px); measure() knows no tracking
export const TYPE_GAP = 2; // type line to label block
export const EDGE_LABEL_SIZE = 12;
export const LEGEND_SIZE = 11;
export const GROUP_LABEL_SIZE = 12;
export const GROUP_TRACK = 0.9; // .08em at 11 px (Task 4 draws group labels in spaced capitals)
export const EMOJI_SIZE = 18; // an emoji in the tile (css.mjs draws .pa-emoji at this size)
export const TILE_SIZE = 28; // the icon or emoji tile
export const TILE_GAP = 10; // tile to text
export const TILE_PAD_Y = 6; // tile to the box's top and bottom, at least
export const TILE_RADIUS = 7;
export const PAD_X = 14;
export const PAD_Y = 10;
export const NOTE_GAP = 2; // label block to note line
export const EDGE_LABEL_PAD_X = 8; // the pill around an edge label
export const EDGE_LABEL_PAD_Y = 2;
export const GROUP_LABEL_INSET = 12; // label starts this far in from the group's left edge
export const GROUP_MIN_HEIGHT = 64;
const MIN_BOX = { width: 80, height: 40 };
const MIN_STADIUM = { width: 72, height: 36 };
const MIN_DIAMOND = { width: 88, height: 56 };
// The padded text box must sit inside the rhombus: a w x h box fits a W x H
// rhombus only while w/W + h/H <= 1, so both axes are sized to twice the padded box.
export const DIAMOND_PAD = { x: 8, y: 4 };
// Corner cut of hexagon-rect and slant of parallelogram, shared with the renderer.
export const HEXAGON_CUT = 10;
export const PARALLELOGRAM_SLANT = 12;
export const CYLINDER_CAP = 6; // ry of the top and bottom ellipse (together the +12 px)
const DOT = { width: 20, height: 20 };
const SMALL_DIAMOND = { width: 24, height: 24 };

// Extra width/height a shape needs beyond its padded text box.
const SHAPE_EXTRA = {
  cylinder: { width: 0, height: 2 * CYLINDER_CAP },
  'hexagon-rect': { width: 2 * HEXAGON_CUT, height: 0 },
  parallelogram: { width: 2 * PARALLELOGRAM_SLANT, height: 0 },
  'double-bar-rect': { width: 16, height: 0 },
  stadium: { width: 16, height: 0 },
};
// Shapes drawn without room for text: the label sits beside them.
const EXTERNAL_SHAPES = { 'filled-dot': DOT, 'ringed-dot': DOT, 'small-diamond': SMALL_DIAMOND };

export const evenUp = (v) => Math.ceil(v / 2) * 2;

export function fonts(theme) {
  const body = fontFor(theme, 'body');
  const mono = fontFor(theme, 'mono');
  return {
    label: { ...body, weight: 600, size: LABEL_SIZE },
    note: { ...mono, weight: 400, size: NOTE_SIZE },
    type: { ...body, weight: 600, size: TYPE_SIZE },
    edge: { ...body, weight: 400, size: EDGE_LABEL_SIZE },
    group: { ...body, weight: 600, size: GROUP_LABEL_SIZE },
    legend: { ...body, weight: 400, size: LEGEND_SIZE },
  };
}

/** Width of `text` drawn in spaced capitals: the uppercase measured, plus `track` px after every character. */
export function trackedWidth(text, font, track) {
  return measure(text.toUpperCase(), font) + track * [...text].length;
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));

// Wrap to at most two lines. 180 px first; a label that still needs a third
// line widens the wrap, up to 240 px. A 48-character Latin label always fits
// by then; text of unusually wide glyphs may still wrap to a third line (never
// cut), which the geometry lint reports.
function wrapLabel(text, font) {
  const clean = oneLine(text);
  let lines = [];
  for (let width = MAX_TEXT_WIDTH; width <= MAX_WIDENED_TEXT_WIDTH; width += WIDEN_STEP) {
    lines = wrap(clean, width, font);
    if (lines.length <= MAX_LABEL_LINES) break;
  }
  return lines;
}

// The type line (when the card has one), the label lines and the note, stacked.
function textBlock(node, f, typeLine) {
  const lines = wrapLabel(node.label, f.label);
  const noteLine = node.note === undefined ? null : oneLine(node.note);
  const typeWidth = typeLine === null ? 0 : trackedWidth(typeLine, f.type, TYPE_TRACK);
  const width = Math.max(widest(lines, f.label), noteLine ? measure(noteLine, f.note) : 0, typeWidth);
  const height = (typeLine === null ? 0 : lineHeight(f.type) + TYPE_GAP) + lines.length * lineHeight(f.label) + (noteLine ? NOTE_GAP + lineHeight(f.note) : 0);
  return { lines, noteLine, width, height };
}

/** Whether a node of this shape reserves room for a tile (icon or emoji). */
export function holdsIcon(kindInfo) {
  return BOX_SHAPES.has(kindInfo.shape);
}

/** What the tile holds: { icon, emoji }. An emoji replaces the icon; a shape without a tile holds neither. */
export function tileOf(node, kindInfo) {
  if (!holdsIcon(kindInfo)) return { icon: null, emoji: null };
  if (node.emoji !== undefined) return { icon: null, emoji: node.emoji };
  return { icon: node.icon ?? kindInfo.icon ?? null, emoji: null };
}

/**
 * Size of one node. Returns { width, height, lines, noteLine, icon, emoji, typeLine, labelBox? }:
 * widths and heights are even px; `icon` is the resolved icon ref and `emoji`
 * the emoji drawn instead of it (both null when there is no tile); `typeLine`
 * is the kind in capitals, drawn above the label on every card with a tile,
 * else null; `labelBox` ({ width, height }) is set only for dot and
 * small-diamond shapes, whose label is drawn outside the shape.
 */
export function nodeSize(node, kindInfo, theme) {
  const f = fonts(theme);
  const { icon, emoji } = tileOf(node, kindInfo);
  const tile = icon !== null || emoji !== null;
  const typeLine = tile && kindInfo.name ? kindInfo.name.toUpperCase() : null;
  const block = textBlock(node, f, typeLine);
  const { shape } = kindInfo;
  const base = { lines: block.lines, noteLine: block.noteLine, icon, emoji, typeLine };

  if (EXTERNAL_SHAPES[shape]) {
    return { ...base, ...EXTERNAL_SHAPES[shape], labelBox: { width: evenUp(block.width), height: evenUp(block.height) } };
  }
  if (shape === 'diamond') {
    const w = 2 * (block.width + 2 * DIAMOND_PAD.x);
    const h = 2 * (block.height + 2 * DIAMOND_PAD.y);
    return { ...base, width: evenUp(Math.max(w, MIN_DIAMOND.width)), height: evenUp(Math.max(h, MIN_DIAMOND.height)) };
  }
  const extra = SHAPE_EXTRA[shape] ?? { width: 0, height: 0 };
  const min = shape === 'stadium' ? MIN_STADIUM : MIN_BOX;
  const tileWidth = tile ? TILE_SIZE + TILE_GAP : 0;
  return {
    ...base,
    width: evenUp(Math.max(block.width + 2 * PAD_X + tileWidth + extra.width, min.width)),
    height: evenUp(Math.max(block.height + 2 * PAD_Y + extra.height, tile ? TILE_SIZE + 2 * TILE_PAD_Y : 0, min.height)),
  };
}

/**
 * Widest text line a node of this shape and width can hold: the inverse of the
 * width rule in nodeSize, so the geometry lint and the renderer read one rule.
 * Not for shapes whose label sits outside them (dots, small diamond).
 */
export function textRoom(shape, width, hasTile) {
  if (shape === 'diamond') return width / 2 - 2 * DIAMOND_PAD.x;
  const extra = SHAPE_EXTRA[shape]?.width ?? 0;
  return width - 2 * PAD_X - (hasTile ? TILE_SIZE + TILE_GAP : 0) - extra;
}

/** Size of an edge label's pill: one line, never wrapped. */
export function edgeLabelSize(text, theme) {
  const font = fonts(theme).edge;
  const clean = oneLine(text);
  return {
    text: clean,
    width: evenUp(measure(clean, font) + 2 * EDGE_LABEL_PAD_X),
    height: evenUp(lineHeight(font) + 2 * EDGE_LABEL_PAD_Y),
  };
}

/** Smallest group box that holds its label. */
export function groupMinSize(group, theme) {
  const font = fonts(theme).group;
  return {
    width: evenUp(measure(oneLine(group.label), font) + 2 * GROUP_LABEL_INSET),
    height: GROUP_MIN_HEIGHT,
  };
}
```

- [ ] **Step 4: Implement `parts.mjs`, the renderers, the layouts and the lint**

`scripts/lib/parts.mjs` — the whole file:

```js
// Drawing parts shared by the graph and sequence renderers: a node's shape and
// content (tile, type line, label, note), edge paths with arrow heads, label pills.
import { measure, lineHeight } from '../../shared/text.mjs';
import { TILE_SIZE, TILE_GAP, TILE_RADIUS, TYPE_GAP, TYPE_TRACK, NOTE_GAP, EMOJI_SIZE, trackedWidth } from './sizes.mjs';
import { shapeParts, pathD } from './shapes.mjs';
import { esc, num, textLines, iconGroup, markerIds, ICON_DRAW } from './svg.mjs';

const EMOJI_BASELINE = 0.35 * EMOJI_SIZE; // the emoji's baseline sits this far below the tile's middle (svg.mjs BASELINE)
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));

/** A node's box shape and decoration as <path> elements. */
export function shapeSvg(shape, box) {
  const { outline, decor } = shapeParts(shape, box);
  const decorCls = shape === 'ringed-dot' ? 'pa-decor pa-decor-dot' : 'pa-decor';
  return `<path class="pa-shape pa-shape-${shape}" d="${pathD(outline)}"/>${decor.map((d) => `<path class="${decorCls}" d="${pathD(d)}"/>`).join('')}`;
}

// The tile: a rounded square in the kind's tint holding the icon, or the emoji as text.
function tileSvg(n, x, y) {
  let out = `<rect class="pa-tile" x="${num(x)}" y="${num(y)}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}"/>`;
  if (n.emoji) out += `<text class="pa-emoji" text-anchor="middle" x="${num(x + TILE_SIZE / 2)}" y="${num(y + TILE_SIZE / 2 + EMOJI_BASELINE)}">${esc(n.emoji)}</text>`;
  else out += iconGroup(n.icon, x + (TILE_SIZE - ICON_DRAW) / 2, y + (TILE_SIZE - ICON_DRAW) / 2);
  return out;
}

/**
 * Tile, type line, label lines and note of a node centred in its box (the text
 * beside the tile when it has one). `n` is { x, y, width, height, lines,
 * noteLine, icon, emoji, typeLine }; sizes.mjs reserved the room for each.
 */
export function boxContent(n, f) {
  const labelLh = lineHeight(f.label);
  const noteLh = lineHeight(f.note);
  const typeLh = lineHeight(f.type);
  const hasType = !!n.typeLine;
  const blockHeight = (hasType ? typeLh + TYPE_GAP : 0) + n.lines.length * labelLh + (n.noteLine ? NOTE_GAP + noteLh : 0);
  const top = n.y + (n.height - blockHeight) / 2;
  const textWidth = Math.max(widest(n.lines, f.label), n.noteLine ? measure(n.noteLine, f.note) : 0, hasType ? trackedWidth(n.typeLine, f.type, TYPE_TRACK) : 0);
  const tile = !!(n.icon || n.emoji);
  const tileWidth = tile ? TILE_SIZE + TILE_GAP : 0;
  const left = n.x + n.width / 2 - (tileWidth + textWidth) / 2;
  const cx = left + tileWidth + textWidth / 2;
  let out = '';
  if (tile) out += tileSvg(n, left, n.y + (n.height - TILE_SIZE) / 2);
  let y = top;
  if (hasType) {
    out += textLines('pa-type', [n.typeLine], { x: cx, top: y, lh: typeLh, size: f.type.size });
    y += typeLh + TYPE_GAP;
  }
  out += textLines('pa-label', n.lines, { x: cx, top: y, lh: labelLh, size: f.label.size });
  y += n.lines.length * labelLh;
  if (n.noteLine) out += textLines('pa-note', [n.noteLine], { x: cx, top: y + NOTE_GAP, lh: noteLh, size: f.note.size });
  return out;
}

// The label of a dot or a choice, drawn in its reserved box beside the shape (no tile, no type line).
export function outsideContent(n, f) {
  const labelLh = lineHeight(f.label);
  const noteLh = lineHeight(f.note);
  const blockHeight = n.lines.length * labelLh + (n.noteLine ? NOTE_GAP + noteLh : 0);
  const top = n.labelBox.y + (n.labelBox.height - blockHeight) / 2;
  const centred = n.labelSide === 'bottom';
  const x = centred ? n.labelBox.x + n.labelBox.width / 2 : n.labelBox.x;
  const anchor = centred ? 'middle' : 'start';
  let out = textLines('pa-label', n.lines, { x, top, lh: labelLh, size: f.label.size, anchor });
  if (n.noteLine) {
    out += textLines('pa-note', [n.noteLine], { x, top: top + n.lines.length * labelLh + NOTE_GAP, lh: noteLh, size: f.note.size, anchor });
  }
  return out;
}

/** The label pill drawn over an edge or message: a fully rounded plate with the text centred. */
export function plateSvg(edgeId, label, f) {
  const lh = lineHeight(f.edge);
  const text = textLines('pa-edge-text', [label.text], { x: label.x + label.width / 2, top: label.y + (label.height - lh) / 2, lh, size: f.edge.size });
  return `<g class="pa-edge-label" data-edge="${esc(edgeId)}"><rect class="pa-edge-plate" x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="${num(label.height / 2)}"/>${text}</g>`;
}

/**
 * The <g> of one edge or message: its wire, with arrow heads by `heads`
 * ('solid' | 'open'). `family` is the from-node's colour family (css.mjs tints
 * the wire with it); an edge leaving a group passes none.
 */
export function edgeSvg({ id, from, to, style, both, d, heads, extra = '', family }, prefix) {
  const ids = markerIds(prefix);
  const end = `marker-end="url(#${ids[heads]})"`;
  const start = both ? ` marker-start="url(#${ids[heads]})"` : '';
  const fam = family ? ` data-family="${esc(family)}"` : '';
  return `<g class="pa-edge pa-edge-${style}${extra}" data-id="${esc(id)}" data-from="${esc(from)}" data-to="${esc(to)}"${fam}><path class="pa-wire" d="${d}" fill="none" ${end}${start}/></g>`;
}

/** Attributes every node <g> carries: classes (kind, colour family, tone), id, focus and an accessible name. */
export function nodeOpen(node, kind, label, family) {
  return `<g class="pa-node pa-kind-${esc(kind)} pa-family-${esc(family)} pa-tone-${esc(node.tone)}" data-id="${esc(node.id)}" tabindex="0" role="graphics-symbol" aria-label="${esc(`${label}: ${kind}`)}">`;
}
```

(The pill radius `rx = height / 2` is Task 4's pill look, landing here because `plateSvg` is rewritten once; Task 4's tests pin it.)

`scripts/lib/render.mjs` — import `family`: `import { KINDS, family } from './kinds.mjs';`. `graphNodeSvg`:

```js
function graphNodeSvg(n, specNode, type, f) {
  const kind = specNode.kind ?? KINDS[type].default;
  const content = n.labelBox ? outsideContent(n, f) : boxContent(n, f);
  return `${nodeOpen(n, kind, specNode.label, family(type, kind))}${shapeSvg(n.shape, n)}${content}</g>`;
}
```

In `renderGraph`, the edges line becomes:

```js
  // An edge takes its from-node's colour family (none when it leaves a group).
  const famOf = new Map(spec.nodes.map((n) => [n.id, family(spec.type, n.kind)]));
  const edges = g.edges.map((e) => edgeSvg({ ...e, d: roundedPath(e.points), heads: EDGE_ARROW[e.style], family: famOf.get(e.from) }, prefix));
```

`scripts/lib/render-sequence.mjs` — `import { family } from './kinds.mjs';`; `participantSvg`:

```js
function participantSvg(p, label, f) {
  const box = { ...p, noteLine: null };
  return `${nodeOpen({ id: p.id, tone: 'neutral' }, p.kind, label, family('sequence', p.kind))}${shapeSvg(p.shape, p)}${boxContent(box, f)}</g>`;
}
```

and in `renderSequence`, before `const messages`: `const famOf = new Map(spec.participants.map((p) => [p.id, family('sequence', p.kind)]));`, and the `edgeSvg` call gains `family: famOf.get(m.from)` after `extra: \` pa-msg-${m.kind}\``.

`scripts/lib/layout-graph.mjs` — in `readNode`, after `icon: size.icon,`: `emoji: size.emoji,` and `typeLine: size.typeLine,`.

`scripts/lib/layout-sequence.mjs` — in the `participants` map, after `icon: s.size.icon,`: `emoji: s.size.emoji,` and `typeLine: s.size.typeLine,`.

`scripts/lib/lint.mjs` — `nodeTextErrors`: `const room = n.labelBox ? n.labelBox.width : textRoom(n.shape, n.width, n.icon !== null || n.emoji !== null);`; `lintSequence`: `textRoom(p.shape, p.width, p.icon !== null || p.emoji !== null)`.

- [ ] **Step 5: Implement `css.mjs`**

The whole file (Task 4 adds the lane, pill and legend rules; Task 5 the dark block):

```js
// The rules for every class the renderers emit. Colours and fonts are theme
// variables (--surface, --line, --text, --font, --k-<family>, ...), so one
// stylesheet serves light, dark and every theme. Text sizes come from
// sizes.mjs, which measured the text with them.
import { LABEL_SIZE, NOTE_SIZE, TYPE_SIZE, EDGE_LABEL_SIZE, GROUP_LABEL_SIZE, EMOJI_SIZE } from './sizes.mjs';
import { FAMILIES } from './kinds.mjs';

const TONES = { accent: 'accent', good: 'good', warn: 'warn', bad: 'bad' };
const EMOJI_FONTS = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const CARD_TINT = 10; // % of the kind hue in a card's fill; shared/contrast.mjs TINT gates the hue as text on it
const TILE_TINT = 18; // the tile is a stronger tint of the same hue

const rules = [
  // frame
  '.pa-diagram{display:block;font-family:var(--font);font-size:14px;color:var(--text)}',
  // groups
  '.pa-group-box{fill:var(--page);stroke:var(--line);stroke-width:1}',
  `.pa-group-label{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600}`,
  // edges: one path.pa-wire per edge; the arrow heads take the wire's stroke
  '.pa-wire{fill:none;stroke:var(--text-3);stroke-width:1.25;stroke-linejoin:round}',
  '.pa-edge-dashed .pa-wire{stroke-dasharray:6 4}',
  '.pa-edge-async .pa-wire{stroke-dasharray:1.5 4;stroke-linecap:round}',
  '.pa-arrow-fill{fill:context-stroke;stroke:none}',
  '.pa-arrow-open{fill:none;stroke:context-stroke;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-edge-plate{fill:var(--surface)}',
  `.pa-edge-text{fill:var(--text-2);font-size:${EDGE_LABEL_SIZE}px;font-weight:400}`,
  // nodes: a card tinted by its kind family (familyRules below); the shape still encodes the kind
  '.pa-node{outline:none}',
  '.pa-shape{fill:var(--surface);stroke:var(--line);stroke-width:1.5}',
  '.pa-decor{fill:none;stroke:var(--line);stroke-width:1}',
  '.pa-kind-external .pa-shape{stroke-dasharray:5 4}',
  '.pa-tile{stroke:none}',
  `.pa-emoji{font-family:${EMOJI_FONTS};font-size:${EMOJI_SIZE}px}`,
  `.pa-type{font-size:${TYPE_SIZE}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}`,
  `.pa-label{fill:var(--text);font-size:${LABEL_SIZE}px;font-weight:600}`,
  `.pa-note{fill:var(--text-2);font-family:var(--mono);font-size:${NOTE_SIZE}px;font-weight:400}`,
  '.pa-icon{color:var(--text-2)}',
  '.pa-icon-lucide{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-icon-brand{fill:currentColor;stroke:none}',
  '.pa-node:focus-visible .pa-shape{stroke:var(--accent);stroke-width:2}',
  // sequence
  '.pa-lifeline{stroke:var(--text-3);stroke-width:1;stroke-dasharray:4 4;stroke-opacity:.6}',
  '.pa-frame-box{fill:none;stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  '.pa-frame-tab{fill:var(--surface);stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  // the tab's kind word is measured with f.group and a note's lines with f.note (layout-sequence.mjs): drawn at the same sizes
  `.pa-frame-kind{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600}`,
  `.pa-frame-label{fill:var(--text-2);font-size:${EDGE_LABEL_SIZE}px;font-weight:400}`,
  '.pa-seq-note-box{fill:var(--surface);stroke:var(--text-3);stroke-width:1}',
  `.pa-seq-note-text{fill:var(--text-2);font-family:var(--mono);font-size:${NOTE_SIZE}px;font-weight:400}`,
];

// One hue per family: the card's fill is a tint of it; the border, the tile,
// the icon, the type line and the wires leaving the node take it. A bare shape
// (dots, pills) keeps the neutral card.
const familyRules = FAMILIES.flatMap((f) => {
  const hue = `var(--k-${f})`;
  return [
    `.pa-family-${f} .pa-shape{fill:color-mix(in srgb,${hue} ${CARD_TINT}%,var(--surface));stroke:${hue}}`,
    `.pa-family-${f} .pa-decor{stroke:${hue}}`,
    `.pa-family-${f} .pa-tile{fill:color-mix(in srgb,${hue} ${TILE_TINT}%,var(--surface))}`,
    `.pa-family-${f} .pa-icon{color:${hue}}`,
    `.pa-family-${f} .pa-type{fill:${hue}}`,
    `.pa-edge[data-family="${f}"] .pa-wire{stroke:${hue}}`,
  ];
}).concat(['.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}']);

// Dots and the small diamond are drawn as marks, not cards: after the family
// rules (same specificity), so a bare family cannot wash them out.
const markRules = [
  '.pa-node .pa-shape-filled-dot{fill:var(--text-2);stroke:var(--text-2)}',
  '.pa-node .pa-shape-ringed-dot{stroke:var(--text-2);stroke-width:1.5}',
  '.pa-node .pa-decor-dot{fill:var(--text-2);stroke:none}',
  '.pa-node .pa-shape-small-diamond{stroke-width:1.25}',
];

// A tone colours the border (2 px), the filled dot, the icon and the type line,
// over the family hue (these rules come later, so they win at equal specificity).
const toneRules = Object.entries(TONES).flatMap(([tone, variable]) => [
  `.pa-tone-${tone} .pa-shape{stroke:var(--${variable});stroke-width:2}`,
  `.pa-tone-${tone} .pa-shape-filled-dot{fill:var(--${variable})}`,
  `.pa-tone-${tone} .pa-icon{color:var(--${variable})}`,
  `.pa-tone-${tone} .pa-type{fill:var(--${variable})}`,
]);

// Viewer state, set by the runtime: dim what a trace or a beat leaves out, hide
// what a presentation has not revealed yet (visibility, not display: hidden
// elements still measure), emphasise what a step highlights, a trace follows,
// a beat travels (pa-active) or Explore selected or routed. Every lit edge is
// thicker as well as recoloured.
const state = [
  '.pa-dim{opacity:.25}',
  '.pa-hidden{opacity:0;visibility:hidden}',
  '.pa-hl .pa-shape,.pa-on .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-hl > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-hl .pa-wire,.pa-edge.pa-on .pa-wire{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-active .pa-wire{stroke:var(--accent);stroke-width:3}',
  '.pa-selected .pa-shape{stroke:var(--accent);stroke-width:2.5}',
  '.pa-selected > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-selected .pa-wire{stroke:var(--accent);stroke-width:2.5}',
  '.pa-route .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-route > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-route .pa-wire{stroke:var(--accent);stroke-width:2.5}',
  '.pa-dot{fill:var(--accent);stroke:none;pointer-events:none;visibility:hidden}',
  '.pa-dot.pa-dot-on{visibility:visible}',
];

// Flow animation moves the dashes along a wire and keeps each style's own
// pattern: only stroke-dashoffset animates. A solid wire has no pattern, so it
// gets one while animating. --pa-period is the pattern's length, so the loop
// restarts on a whole period instead of jumping.
const animation = [
  '@media (prefers-reduced-motion: no-preference){',
  '.pa-edge-solid .pa-wire{--pa-period:12px}',
  '.pa-edge-dashed .pa-wire{--pa-period:10px}',
  '.pa-edge-async .pa-wire{--pa-period:5.5px}',
  '.pa-animate .pa-edge-solid .pa-wire{stroke-dasharray:6 6}',
  '.pa-animate .pa-wire{animation:pa-flow 1.2s linear infinite}',
  '@keyframes pa-flow{to{stroke-dashoffset:calc(var(--pa-period) * -1)}}',
  '.pa-node,.pa-edge,.pa-edge-label,.pa-group,.pa-lifeline,.pa-frame,.pa-seq-note{transition:opacity .25s ease,visibility .25s}',
  '}',
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...familyRules, ...markRules, ...toneRules, ...state, ...animation].join('\n');
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/look.test.mjs test/render.test.mjs test/layout-graph.test.mjs test/layout-sequence.test.mjs test/lint.test.mjs test/edges.test.mjs` — expected: everything passes except the eight golden tests (`architecture|flow|state|sequence example: SVG matches the golden file`, `… geometry matches the golden file`), which are red until Task 5 and must fail only with a golden diff. If `the shipped examples are valid specs` (layout-graph.test.mjs) or `the story example validates, layout included` (stories.test.mjs) now fails the geometry lint (a wider card under an edge label), change that example's label text only — never an id, an edge, a kind or a beat (the tests pin them) — and name the change in Part C's commit body. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — everything else green: the browser suites (`check.test.mjs` runs `scripts/check.mjs` over every example: no text leaves its card; `browser.test.mjs:175` still counts 4 icon groups; `explore-browser.test.mjs` still copies `.pa-icon` into the panel). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green except `golden: body markup of the recap example is unchanged` (the figure's `--dg-w`/`--dg-h` grew; regenerated in Task 5) — any other explainer failure is a finding to report, not to paper over.

- [ ] **Step 7: Commit**

This task lands with Tasks 4 and 5 in one commit (Part C); do not commit here. The orchestrator commits after Task 5.

---

### Task 4: lanes, spaced-caps group labels, pills and the legend

**Files:**
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/lanes.mjs`
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/legend.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/layout.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/layout-graph.mjs:9-11,259-272`, `layout-sequence.mjs:166,246-248`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/sizes.mjs` (`GROUP_LABEL_SIZE`, `groupMinSize`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/render.mjs:16-24,35,42` (groups, legend)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/css.mjs` (lane, pill and legend rules)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/lanes.test.mjs`, `test/legend.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/look.test.mjs`, `test/layout-graph.test.mjs:321,487-488`

**Interfaces:**
- Consumes: `fonts(theme).legend` and `.group`, `trackedWidth`, `GROUP_TRACK`, `GROUP_LABEL_INSET` (sizes.mjs), `family`/`KINDS` (kinds.mjs), `esc`/`num`/`textLines` (svg.mjs), `OUTER_MARGIN` (24, layout-graph.mjs; layout-sequence.mjs has its own equal constant).
- Produces (`lanes.mjs`): `stretchLanes(geometry)` → a new geometry whose top-level groups share one left and right edge when there are at least two, they do not overlap vertically and no edge ends at a top-level group; otherwise the same geometry object.
- Produces (`legend.mjs`): `LEGEND_ROW = 20`, `LEGEND_BAND = 30`, `SWATCH = 12`, `SAMPLE = 24`; `legendItems(spec)` → `[{ kind: 'kind', name, family, count }, …, { kind: 'style', name, style }]` in order of first use (sequence: participant kinds, then message kinds `sync|async|reply|self` with `style` solid|async|dashed|solid; graphs: node kinds, then edge styles); `legendLayout(spec, theme)` → `{ items: [{ …item, dx, width }], width, height: 20 }`; `placeLegend(row, canvasWidth, margin)` → `{ x, y: margin, width, height, items }` right-aligned; `legendSvg(legend, f)` → `<g class="pa-legend" aria-hidden="true">…</g>`.
- Produces (geometry): `legend` on graph and sequence geometries; every drawing starts at `OUTER_MARGIN + LEGEND_BAND` (54) from the top; the canvas is at least `legend.width + 2 * OUTER_MARGIN` wide.
- Produces (SVG): top-level groups `<g class="pa-group" data-id data-depth="0" data-lane="i">` (i = index among top-level groups mod 8) with `<rect class="pa-group-box" … rx="6"/>` then `<rect class="pa-lane" x y width="4" height rx="2"/>` then the label; nested groups have no `data-lane` and no bar; the legend group is the SVG's last child before `</svg>`.
- Produces (CSS): `.pa-group[data-lane="i"] .pa-lane{fill:var(--s<i+1>)}` for i 0..7, `.pa-group-label{…font-size:11px;…letter-spacing:.08em;text-transform:uppercase}`, `.pa-group-box{fill:color-mix(in srgb,var(--text-3) 7%,transparent);…}`, `.pa-edge-plate{fill:var(--surface);stroke:var(--line);stroke-width:1}`, `.pa-frame-kind` at `GROUP_LABEL_SIZE`, `.pa-legend-text`, `.pa-swatch`, `.pa-swatch.pa-family-F`, `.pa-legend-sample .pa-wire`.
- Behaviour the phase changes (named): a lone node sits at `y = 54` (`layout-graph.test.mjs:488`); geometry keys gain `legend` (`layout-graph.test.mjs:321`); goldens stay red until Task 5.

- [ ] **Step 1: Write the failing tests**

Create `test/lanes.test.mjs`:

```js
// stretchLanes (scripts/lib/lanes.mjs): stacked top-level groups read as lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stretchLanes } from '../scripts/lib/lanes.mjs';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { lintGeometry } from '../scripts/lib/lint.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const group = (id, x, y, width, height, parent = null) => ({ id, x, y, width, height, label: id, depth: parent ? 1 : 0, parent });
const geometry = (groups, edges = []) => ({ width: 400, height: 400, nodes: [], edges, layers: [], groups });

test('two top-level groups stacked vertically stretch to a common left and right; the input is untouched', () => {
  const g = geometry([group('a', 24, 24, 150, 100), group('b', 60, 160, 300, 100)]);
  const out = stretchLanes(g);
  assert.deepEqual(out.groups.map((x) => [x.x, x.width]), [[24, 336], [24, 336]]);
  assert.deepEqual(out.groups.map((x) => [x.y, x.height]), [[24, 100], [160, 100]], 'heights and tops stay');
  assert.equal(g.groups[0].width, 150, 'a new geometry, not a mutation');
  assert.notEqual(out, g);
});

test('groups beside each other, a single group, or a nested group: nothing moves', () => {
  const beside = geometry([group('a', 24, 24, 150, 100), group('b', 200, 50, 100, 100)]);
  assert.equal(stretchLanes(beside), beside, 'the same object back');
  const single = geometry([group('a', 24, 24, 150, 100)]);
  assert.equal(stretchLanes(single), single);
  const nested = geometry([group('a', 24, 24, 300, 200), group('c', 40, 60, 100, 50, 'a'), group('b', 24, 240, 100, 50)]);
  const out = stretchLanes(nested);
  assert.deepEqual(out.groups.map((x) => [x.id, x.x, x.width]), [['a', 24, 300], ['c', 40, 100], ['b', 24, 300]], 'top-level a and b become lanes; nested c keeps its box');
});

test('no stretching when an edge ends at a top-level group: its arrow would land inside the lane', () => {
  const g = geometry([group('a', 24, 24, 150, 100), group('b', 60, 160, 300, 100)], [{ id: 'e', from: 'x', to: 'b', points: [] }]);
  assert.equal(stretchLanes(g), g);
});

test('through layoutDiagram: a down-flow with two groups becomes two lanes and still lints; two groups beside each other do not', async () => {
  const flow = {
    title: 't', type: 'flow', direction: 'down',
    groups: [{ id: 'in', label: 'Intake' }, { id: 'out', label: 'A much longer fulfilment lane label' }],
    nodes: [{ id: 'a', label: 'A', group: 'in' }, { id: 'b', label: 'B', group: 'out' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  const g = await layoutDiagram(flow, theme);
  const [i, o] = g.groups;
  assert.equal(i.x, o.x);
  assert.equal(i.width, o.width);
  assert.ok(i.y + i.height <= o.y, 'stacked');
  assert.deepEqual(lintGeometry(g, { theme }), []);
  const arch = {
    title: 't', type: 'architecture',
    groups: [{ id: 'l', label: 'Left' }, { id: 'r', label: 'Right' }],
    nodes: [{ id: 'a', label: 'A', group: 'l' }, { id: 'b', label: 'B', group: 'r' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  const h = await layoutDiagram(arch, theme);
  assert.ok(h.groups[0].x + h.groups[0].width <= h.groups[1].x, 'beside each other: not lanes');
});
```

Create `test/legend.test.mjs`:

```js
// The legend (scripts/lib/legend.mjs): counts per kind and the edge styles used,
// measured into a row the layouts reserve a band for at the top right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { legendItems, legendLayout, placeLegend, legendSvg, LEGEND_ROW, LEGEND_BAND } from '../scripts/lib/legend.mjs';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg } from '../scripts/lib/render.mjs';
import { fonts } from '../scripts/lib/sizes.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const example = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url)), 'utf8'));
const kind = (name, family, count) => ({ kind: 'kind', name, family, count });
const style = (name, s = name) => ({ kind: 'style', name, style: s });

test('legendItems: kinds in order of first use with counts, then the edge styles used', () => {
  assert.deepEqual(legendItems(example('story')), [
    kind('user', 'person', 1), kind('client', 'service', 1), kind('gateway', 'service', 1), kind('service', 'service', 1), kind('database', 'data', 1), kind('queue', 'queue', 1), kind('external', 'external', 1),
    style('solid'), style('async'), style('dashed'),
  ]);
  assert.deepEqual(legendItems(example('architecture')), [kind('client', 'service', 1), kind('service', 'service', 1), kind('database', 'data', 1), kind('external', 'external', 1), style('solid'), style('async'), style('dashed')]);
  assert.deepEqual(legendItems(example('flow')).slice(0, 3), [kind('start', 'bare', 1), kind('io', 'service', 1), kind('decision', 'decision', 1)]);
  assert.deepEqual(legendItems(example('flow')).slice(-2), [style('solid'), style('dashed')]);
  assert.deepEqual(legendItems(example('sequence')), [
    kind('actor', 'person', 1), kind('service', 'service', 2), kind('database', 'data', 1), kind('external', 'external', 1),
    style('sync', 'solid'), style('async', 'async'), style('reply', 'dashed'), style('self', 'solid'),
  ]);
  assert.deepEqual(legendItems({ type: 'sequence', participants: [{ id: 'a', label: 'A' }] }), [kind('service', 'service', 1)], 'no messages, no styles');
});

test('legendLayout measures one row with the theme font; placeLegend right-aligns it in the top band', () => {
  const row = legendLayout(example('architecture'), theme);
  assert.equal(row.height, LEGEND_ROW);
  assert.equal(row.items.length, 7);
  assert.ok(row.width > 300 && row.width < 700, `${row.width}`);
  row.items.forEach((it, i) => {
    assert.ok(it.width > 12, it.name);
    if (i) assert.ok(it.dx >= row.items[i - 1].dx + row.items[i - 1].width, 'items do not overlap');
  });
  assert.equal(row.items[0].dx, 0);
  assert.ok(Math.abs(row.width - (row.items.at(-1).dx + row.items.at(-1).width)) < 0.01);
  const placed = placeLegend(row, 1000, 24);
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [Math.round((1000 - 24 - row.width) * 10) / 10, 24, row.width, LEGEND_ROW]);
  assert.equal(placed.items, row.items);
  assert.ok(LEGEND_BAND >= LEGEND_ROW + 8, 'a gap under the row');
});

test('every geometry carries its legend inside the canvas and starts the drawing below the band; a narrow drawing widens for it', async () => {
  for (const name of ['architecture', 'flow', 'state', 'sequence', 'story']) {
    const g = await layoutDiagram(example(name), theme);
    assert.equal(g.legend.y, 24, name);
    assert.ok(g.legend.x >= 24 - 0.05 && g.legend.x + g.legend.width <= g.width - 24 + 0.05, `${name}: inside the canvas`);
    const top = Math.min(...[...(g.nodes ?? []), ...(g.participants ?? []), ...(g.groups ?? [])].map((b) => b.y));
    assert.ok(top >= 24 + LEGEND_BAND - 0.05, `${name}: the drawing starts below the band (${top})`);
  }
  const tall = { title: 't', type: 'flow', direction: 'down', nodes: [{ id: 'a', label: 'A', kind: 'io' }, { id: 'b', label: 'B', kind: 'subprocess' }, { id: 'c', label: 'C', kind: 'wait' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', style: 'dashed' }] };
  const g = await layoutDiagram(tall, theme);
  assert.equal(g.width, Math.round((g.legend.width + 48) * 10) / 10, 'the canvas is as wide as the legend needs');
  assert.ok(g.nodes.every((n) => n.x + n.width <= g.width - 24 + 0.05));
});

test('legendSvg: a swatch per kind in its family, a wire sample per style, drawn last', async () => {
  const g = await layoutDiagram(example('architecture'), theme);
  const svg = legendSvg(g.legend, fonts(theme));
  assert.match(svg, /^<g class="pa-legend" aria-hidden="true">/);
  assert.equal((svg.match(/<rect class="pa-swatch pa-family-/g) ?? []).length, 4);
  assert.match(svg, /<rect class="pa-swatch pa-family-data" x="[\d.]+" y="[\d.]+" width="12" height="12" rx="3"\/><text class="pa-legend-text" text-anchor="start"><tspan x="[\d.]+" y="[\d.]+">1 database<\/tspan><\/text>/);
  assert.match(svg, /<g class="pa-legend-sample pa-edge-dashed"><path class="pa-wire" d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+"\/><\/g><text class="pa-legend-text" text-anchor="start"><tspan x="[\d.]+" y="[\d.]+">dashed<\/tspan><\/text>/);
  const page = renderSvg(g, example('architecture'), { theme });
  assert.ok(page.endsWith(`${svg}</svg>`), 'the legend is the last thing drawn');
  const seq = await layoutDiagram(example('sequence'), theme);
  const s = legendSvg(seq.legend, fonts(theme));
  assert.match(s, /pa-edge-solid"><path class="pa-wire"[^>]*\/><\/g><text class="pa-legend-text"[^>]*><tspan[^>]*>sync</);
  assert.match(s, /pa-edge-dashed"><path class="pa-wire"[^>]*\/><\/g><text class="pa-legend-text"[^>]*><tspan[^>]*>reply</);
  assert.match(s, />2 service</);
  const evil = await layoutDiagram({ title: 't', type: 'architecture', nodes: [{ id: 'a', label: 'A', kind: 'external' }] }, theme);
  assert.ok(!legendSvg(evil.legend, fonts(theme)).includes('<b'), 'nothing but kind names and counts reach the legend');
});
```

Append to `test/look.test.mjs` (and extend its `sizes.mjs` import with `groupMinSize, GROUP_TRACK, GROUP_LABEL_INSET`):

```js
test('groups: a top-level group is a lane with a numbered bar and a spaced-caps label kept in its source case; nested groups have no bar', async () => {
  const svg = await draw(example('architecture'));
  const aws = tagsOf(svg, /<g class="pa-group" data-id="aws"[^>]*>.*?<\/g>/g)[0];
  assert.match(aws, /^<g class="pa-group" data-id="aws" data-depth="0" data-lane="0">/);
  assert.match(aws, /<rect class="pa-group-box" [^>]*rx="6"\/><rect class="pa-lane" x="[\d.]+" y="[\d.]+" width="4" height="[\d.]+" rx="2"\/>/);
  assert.match(aws, /<text class="pa-group-label" text-anchor="start"><tspan [^>]*>AWS us-east-1<\/tspan>/, 'source case; CSS sets the capitals');
  const vpc = tagsOf(svg, /<g class="pa-group" data-id="vpc"[^>]*>.*?<\/g>/g)[0];
  assert.match(vpc, /^<g class="pa-group" data-id="vpc" data-depth="1">/);
  assert.ok(!vpc.includes('pa-lane'));
  const many = { title: 't', type: 'flow', direction: 'down', groups: Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, label: `Lane ${i}` })), nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, group: `g${i}` })), edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
  const lanes = tagsOf(await draw(many), /<g class="pa-group" [^>]*>/g).map((t) => attr(t, 'data-lane'));
  assert.deepEqual(lanes.sort(), ['0', '0', '1', '2', '3', '4', '5', '6', '7'], 'the ninth lane reuses the first colour');
});

test('pills: an edge label plate is fully rounded; the group label is measured in capitals with tracking', async () => {
  const svg = await draw(example('story'));
  const plate = tagsOf(svg, /<rect class="pa-edge-plate" [^>]*>/g)[0];
  assert.equal(attr(plate, 'rx'), String(Number(attr(plate, 'height')) / 2));
  const f = fonts(theme);
  const min = groupMinSize({ id: 'g', label: 'core services' }, theme);
  assert.ok(min.width >= trackedWidth('core services', f.group, GROUP_TRACK) + 2 * GROUP_LABEL_INSET - 2, `${min.width}`);
  assert.equal(f.group.size, 11);
});

test('diagramCss: lane, pill and legend rules', () => {
  const css = diagramCss();
  for (let i = 0; i < 8; i++) assert.ok(css.includes(`.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`), `lane ${i}`);
  assert.match(css, /\.pa-lane\{stroke:none\}/);
  assert.match(css, /\.pa-group-box\{fill:color-mix\(in srgb,var\(--text-3\) 7%,transparent\);stroke:var\(--line\);stroke-width:1\}/);
  assert.match(css, /\.pa-group-label\{fill:var\(--text-2\);font-size:11px;font-weight:600;letter-spacing:\.08em;text-transform:uppercase\}/);
  assert.match(css, /\.pa-edge-plate\{fill:var\(--surface\);stroke:var\(--line\);stroke-width:1\}/);
  assert.match(css, /\.pa-frame-kind\{fill:var\(--text-2\);font-size:11px;font-weight:600\}/, 'the frame tab word is measured with f.group: plain, no tracking');
  assert.match(css, /\.pa-legend-text\{fill:var\(--text-2\);font-size:11px\}/);
  assert.match(css, /\.pa-swatch\{stroke-width:1\}/);
  for (const f of FAMILIES) assert.ok(css.includes(`.pa-swatch.pa-family-${f}{fill:color-mix(in srgb,var(--k-${f}) 10%,var(--surface));stroke:var(--k-${f})}`), f);
  assert.match(css, /\.pa-swatch\.pa-family-bare\{fill:var\(--surface\);stroke:var\(--line\)\}/);
  assert.match(css, /\.pa-legend-sample \.pa-wire\{stroke-width:1\.5\}/);
});
```

`test/layout-graph.test.mjs` — add `import { LEGEND_BAND } from '../scripts/lib/legend.mjs';`; in `geometry carries the contract fields`: `assert.deepEqual(Object.keys(g).sort(), ['edges', 'groups', 'height', 'layers', 'legend', 'nodes', 'width']);`; in `${type}: a single node lays out`: `assert.equal(g.nodes[0].y, MARGIN + LEGEND_BAND, 'below the legend band');` (the `x` assertion stays `MARGIN`).

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/lanes.test.mjs test/legend.test.mjs test/look.test.mjs test/layout-graph.test.mjs`
Expected: `lanes.test.mjs` and `legend.test.mjs` fail at import (`Cannot find module '…/scripts/lib/lanes.mjs'`, `…/legend.mjs`); `layout-graph.test.mjs` fails at import (`legend.mjs`); in `look.test.mjs` the three new tests fail: `groups:` at the `data-lane="0"` match (no lane attribute yet), `pills:` at the `groupMinSize` width (the plate's `rx` assertion already holds since Task 3 rewrote `plateSvg`; the group minimum is still measured without capitals or tracking), `diagramCss: lane, pill and legend rules` at `lane 0` (no lane rules yet).

- [ ] **Step 3: Implement `lanes.mjs` and `legend.mjs`**

Create `scripts/lib/lanes.mjs`:

```js
// Lanes: top-level groups stacked one above the other (a down-flow of stages,
// a right-architecture whose groups ELK stacked) are stretched to a common left
// and right edge, so they read as swim lanes. Pure: a new geometry, or the same
// object when nothing qualifies. Edges are not re-routed, so a group that an
// edge ends at keeps its box (anchorEdges only moves an end that sits on a box
// side; stretched, the arrow would stop inside the lane).
const round = (v) => Math.round(v * 10) / 10;

const overlapsVertically = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;

/** The geometry with its top-level groups stretched into lanes when they stack; else the same geometry. */
export function stretchLanes(geometry) {
  const top = geometry.groups.filter((g) => g.parent === null);
  if (top.length < 2) return geometry;
  const ids = new Set(top.map((g) => g.id));
  if (geometry.edges.some((e) => ids.has(e.from) || ids.has(e.to))) return geometry;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) if (overlapsVertically(top[i], top[j])) return geometry;
  }
  const left = Math.min(...top.map((g) => g.x));
  const right = Math.max(...top.map((g) => g.x + g.width));
  return {
    ...geometry,
    groups: geometry.groups.map((g) => (ids.has(g.id) ? { ...g, x: round(left), width: round(right - left) } : g)),
  };
}
```

Create `scripts/lib/legend.mjs`:

```js
// The legend at the top right of every diagram: one swatch and count per node
// kind used, then one wire sample per edge style (message kind) used. The
// layouts reserve LEGEND_BAND above the drawing for the row and widen the canvas
// when the row is wider than the drawing; the renderer draws geometry.legend.
import { measure, lineHeight } from '../../shared/text.mjs';
import { KINDS, family } from './kinds.mjs';
import { fonts } from './sizes.mjs';
import { esc, num, textLines } from './svg.mjs';

export const LEGEND_ROW = 20; // the row's height
export const LEGEND_BAND = 30; // reserved above the drawing: the row and a 10 px gap
export const SWATCH = 12;
export const SAMPLE = 24; // the wire sample's length
const INNER_GAP = 6; // swatch or sample to its text
const ITEM_GAP = 16;
const SWATCH_RADIUS = 3;
const MESSAGE_STYLE = { sync: 'solid', async: 'async', reply: 'dashed', self: 'solid' };

const round = (v) => Math.round(v * 10) / 10;
const textOf = (it) => (it.kind === 'kind' ? `${it.count} ${it.name}` : it.name);

/** [{ kind: 'kind', name, family, count }, …, { kind: 'style', name, style }], each in order of first use. */
export function legendItems(spec) {
  const sequence = spec.type === 'sequence';
  const counts = new Map();
  for (const n of sequence ? spec.participants : spec.nodes) {
    const k = n.kind ?? KINDS[spec.type].default;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const styles = new Map();
  if (sequence) for (const m of spec.messages ?? []) { const k = m.kind ?? 'sync'; if (!styles.has(k)) styles.set(k, MESSAGE_STYLE[k]); }
  else for (const e of spec.edges ?? []) { const s = e.style ?? 'solid'; if (!styles.has(s)) styles.set(s, s); }
  return [
    ...[...counts].map(([name, count]) => ({ kind: 'kind', name, family: family(spec.type, name), count })),
    ...[...styles].map(([name, style]) => ({ kind: 'style', name, style })),
  ];
}

/** The row: every item with its offset from the row's left (`dx`) and width; the row's width and height. */
export function legendLayout(spec, theme) {
  const font = fonts(theme).legend;
  let dx = 0;
  const items = legendItems(spec).map((it) => {
    const width = round((it.kind === 'kind' ? SWATCH : SAMPLE) + INNER_GAP + measure(textOf(it), font));
    const out = { ...it, dx: round(dx), width };
    dx += width + ITEM_GAP;
    return out;
  });
  return { items, width: round(Math.max(0, dx - ITEM_GAP)), height: LEGEND_ROW };
}

/** The row placed in the band: right-aligned `margin` from the canvas's right edge, `margin` from the top. */
export function placeLegend(row, canvasWidth, margin) {
  return { x: round(canvasWidth - margin - row.width), y: margin, width: row.width, height: row.height, items: row.items };
}

/** geometry.legend as SVG: swatches in their family, wire samples in their style, the text beside each. */
export function legendSvg(legend, f) {
  const lh = lineHeight(f.legend);
  const cy = legend.y + legend.height / 2;
  const parts = legend.items.map((it) => {
    const x = legend.x + it.dx;
    const mark = it.kind === 'kind'
      ? `<rect class="pa-swatch pa-family-${esc(it.family)}" x="${num(x)}" y="${num(cy - SWATCH / 2)}" width="${SWATCH}" height="${SWATCH}" rx="${SWATCH_RADIUS}"/>`
      : `<g class="pa-legend-sample pa-edge-${esc(it.style)}"><path class="pa-wire" d="M${num(x)} ${num(cy)}L${num(x + SAMPLE)} ${num(cy)}"/></g>`;
    const text = textLines('pa-legend-text', [textOf(it)], { x: x + (it.kind === 'kind' ? SWATCH : SAMPLE) + INNER_GAP, top: cy - lh / 2, lh, size: f.legend.size, anchor: 'start' });
    return mark + text;
  });
  return `<g class="pa-legend" aria-hidden="true">${parts.join('')}</g>`;
}
```

- [ ] **Step 4: The layouts reserve the band, the renderer draws lanes and the legend**

`scripts/lib/layout.mjs` — the whole file:

```js
// One entry point for laying out any diagram type.
import { layoutGraph } from './layout-graph.mjs';
import { layoutSequence } from './layout-sequence.mjs';
import { stretchLanes } from './lanes.mjs';

/** Lay out a validated spec: Geometry for architecture, flow and state (stacked top-level groups become lanes); SeqGeometry for sequence. */
export async function layoutDiagram(spec, theme) {
  return spec.type === 'sequence' ? layoutSequence(spec, theme) : stretchLanes(await layoutGraph(spec, theme));
}
```

`scripts/lib/layout-graph.mjs` — import `import { legendLayout, placeLegend, LEGEND_BAND } from './legend.mjs';`; the root padding reserves the band:

```js
export const OUTER_MARGIN = 24;
const GROUP_PADDING = `[top=40,left=${OUTER_MARGIN},bottom=${OUTER_MARGIN},right=${OUTER_MARGIN}]`;
// The legend row sits in a band above the drawing (legend.mjs).
const ROOT_PADDING = `[top=${OUTER_MARGIN + LEGEND_BAND},left=${OUTER_MARGIN},bottom=${OUTER_MARGIN},right=${OUTER_MARGIN}]`;
```

and the return of `layoutGraph` becomes:

```js
  const depths = groupDepths(spec.groups ?? []);
  const legend = legendLayout(spec, theme);
  const width = Math.max(round(result.width), round(legend.width + 2 * OUTER_MARGIN)); // a narrow drawing widens to hold its legend
  return {
    width,
    height: round(result.height),
    legend: placeLegend(legend, width, OUTER_MARGIN),
    nodes: …(unchanged)…,
```

`scripts/lib/layout-sequence.mjs` — import `import { legendLayout, placeLegend, LEGEND_BAND } from './legend.mjs';`; `const headerTop = OUTER_MARGIN + LEGEND_BAND; // the legend row sits above the headers (legend.mjs)`; and the return:

```js
  const legend = legendLayout(spec, theme);
  const width = Math.max(round(maxX - minX + 2 * OUTER_MARGIN), round(legend.width + 2 * OUTER_MARGIN));
  return {
    width,
    height: round(lifelineBottom + OUTER_MARGIN),
    legend: placeLegend(legend, width, OUTER_MARGIN),
    participants: …(unchanged)…,
```

`scripts/lib/sizes.mjs` — `export const GROUP_LABEL_SIZE = 11;` and `groupMinSize` measures the capitals with tracking:

```js
/** Smallest group box that holds its label, drawn in spaced capitals. */
export function groupMinSize(group, theme) {
  const font = fonts(theme).group;
  return {
    width: evenUp(trackedWidth(oneLine(group.label), font, GROUP_TRACK) + 2 * GROUP_LABEL_INSET),
    height: GROUP_MIN_HEIGHT,
  };
}
```

`scripts/lib/render.mjs` — import `legendSvg`: `import { legendSvg } from './legend.mjs';`; the group constants and `groupSvg`:

```js
const GROUP_RADIUS = 6;
const GROUP_LABEL_MIDDLE = 20; // group label centre, below the group's top edge
const LANE_BAR = 4; // the accent bar on a top-level group's left edge
const LANE_COLOURS = 8; // --s1 … --s8 cycle
const EDGE_ARROW = { solid: 'solid', dashed: 'solid', async: 'open' };

// A group box with its label in spaced capitals (CSS uppercases it; sizes.mjs
// measured the capitals). A top-level group is a lane: data-lane picks its bar colour.
function groupSvg(group, f, lane) {
  const lh = lineHeight(f.group);
  const label = textLines('pa-group-label', [group.label], { x: group.x + GROUP_LABEL_INSET, top: group.y + GROUP_LABEL_MIDDLE - lh / 2, lh, size: f.group.size, anchor: 'start' });
  const laneAttr = lane === null ? '' : ` data-lane="${lane}"`;
  const bar = lane === null ? '' : `<rect class="pa-lane" x="${num(group.x)}" y="${num(group.y + GROUP_RADIUS)}" width="${LANE_BAR}" height="${num(group.height - 2 * GROUP_RADIUS)}" rx="2"/>`;
  return `<g class="pa-group" data-id="${esc(group.id)}" data-depth="${group.depth}"${laneAttr}><rect class="pa-group-box" x="${num(group.x)}" y="${num(group.y)}" width="${num(group.width)}" height="${num(group.height)}" rx="${GROUP_RADIUS}"/>${bar}${label}</g>`;
}
```

In `renderGraph`:

```js
  const laneOf = new Map(g.groups.filter((x) => x.depth === 0).map((x, i) => [x.id, i % LANE_COLOURS]));
  const groups = [...g.groups].sort((a, b) => a.depth - b.depth).map((x) => groupSvg(x, f, laneOf.has(x.id) ? laneOf.get(x.id) : null));
```

and its return: `body: [...groups, ...edges, ...nodes, ...labels, legendSvg(g.legend, f)].join('')`. In `renderSequence` (render-sequence.mjs), import `legendSvg` from `./legend.mjs` and append `legendSvg(g.legend, f)` as the last entry of its `body` array (after `...plates`).

`scripts/lib/css.mjs` — in `rules`, replace the two group lines with:

```js
  // groups: a lane with a coloured bar (top-level) or a nested box; labels in spaced capitals
  '.pa-group-box{fill:color-mix(in srgb,var(--text-3) 7%,transparent);stroke:var(--line);stroke-width:1}',
  '.pa-lane{stroke:none}',
  `.pa-group-label{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}`,
```

replace `'.pa-edge-plate{fill:var(--surface)}',` with `'.pa-edge-plate{fill:var(--surface);stroke:var(--line);stroke-width:1}', // a pill: surface fill (the export and make-explainer draw on the surface), hairline border`, and add after `animation`:

```js
// Lane bars cycle the categorical colours; the legend's swatches share the card tints.
const laneRules = Array.from({ length: 8 }, (_, i) => `.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`);
const legendRules = [
  '.pa-legend-text{fill:var(--text-2);font-size:11px}',
  '.pa-swatch{stroke-width:1}',
  ...FAMILIES.map((f) => `.pa-swatch.pa-family-${f}{fill:color-mix(in srgb,var(--k-${f}) ${CARD_TINT}%,var(--surface));stroke:var(--k-${f})}`),
  '.pa-swatch.pa-family-bare{fill:var(--surface);stroke:var(--line)}',
  '.pa-legend-sample .pa-wire{stroke-width:1.5}',
];
```

and `diagramCss` returns `[...rules, ...familyRules, ...markRules, ...toneRules, ...laneRules, ...legendRules, ...state, ...animation].join('\n')`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/lanes.test.mjs test/legend.test.mjs test/look.test.mjs test/layout-graph.test.mjs test/layout-sequence.test.mjs test/render.test.mjs test/lint.test.mjs test/data.test.mjs` — expected: all pass except the golden tests (still red, golden diffs only). Then `npm test` — the same picture: the browser suites green (`check.mjs`: no text leaves its card; the camera tests read boxes from the data, which now sit 30 px lower; `story-browser` hop and focus boxes come from the data too). If `check.test.mjs` reports an overflow for a node, the card sizing is wrong — fix `sizes.mjs`, never the check.

- [ ] **Step 6: Commit**

This task lands with Tasks 3 and 5 in one commit (Part C); do not commit here.

---
### Task 5: dark glow and light grid, the page chrome, export variables, default theme `blueprint`, goldens regenerated once

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/css.mjs` (the dark block)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.html:20-80` (the page stylesheet)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/toolbar.js:89` (`VARS`)
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/theme.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/api.mjs:3,121`, `scripts/lib/spec.mjs:8,375`, `scripts/build.mjs:14,34`
- Modify: `plugins/portable-artifacts/skills/make-diagram/references/schema.md:19`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/theme.test.mjs`, `test/look-browser.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/api.test.mjs:165-172`, `test/build.test.mjs`, `test/browser.test.mjs:686-712`, `test/render.test.mjs:14`, `test/layout-graph.test.mjs:16`
- Regenerate: `plugins/portable-artifacts/skills/make-diagram/test/golden/*` (+ `story.svg`, `story.layout.json`), `plugins/portable-artifacts/skills/make-explainer/test/golden/recap.body.html`

**Interfaces:**
- Consumes: `--glow`, `--k-*`, `--s1…--s8`, `--grid`, `--mono` (Task 2 and the existing tokens), the `pa-wire`/`pa-dot`/`pa-active` classes (Tasks 1 and 3).
- Produces (CSS): a dark block, in both of `shared/theme.mjs`'s forms: `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) R…}` and `:root[data-theme="dark"] R` for each dark rule R: `.pa-edge.pa-active .pa-wire{stroke-width:2.5;filter:drop-shadow(0 0 6px var(--glow))}`, `.pa-dot{fill:var(--glow);filter:drop-shadow(0 0 6px var(--glow))}`, `.pa-group-box{fill:color-mix(in srgb,var(--text-3) 12%,transparent)}`. Light (the default rules) keeps the 3 px active edge and the accent dot.
- Produces (page): `#pa-stage` background `var(--stage-bg)`: light a dotted grid over `--page`; dark a radial `--glow` wash, 48 px grid lines and `--page`. `toolbar.js VARS` carries every variable the diagram CSS reads, so exports render the hues.
- Produces (`scripts/lib/theme.mjs`): `DIAGRAM_THEME = 'blueprint'`; `themeFor(spec, override)` → the loaded theme (an override name or object wins, then `spec.theme`, then `DIAGRAM_THEME`; a bad name throws `ThemeError`). `api.mjs`, `build.mjs` and `spec.mjs`'s layout lint read it; `shared/theme.mjs DEFAULT_THEME` stays `paper`.
- Behaviour the phase changes (named): a spec without `theme` builds as `blueprint` (`api.test.mjs:165-172`, `build.test.mjs`, `references/schema.md:19`); `browser.test.mjs:699,707` read the canvas size from the page data instead of `1370 255`; `render.test.mjs NAMES` and `layout-graph.test.mjs EXAMPLES` gain `story`; every golden is rewritten once; make-explainer's recap golden is rewritten once (its diagram figure's `--dg-w`/`--dg-h` changed).

- [ ] **Step 1: Write the failing tests**

Create `test/theme.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_THEME, themeFor } from '../scripts/lib/theme.mjs';
import { loadTheme, DEFAULT_THEME, ThemeError } from '../shared/theme.mjs';

test('make-diagram defaults to blueprint while the shared default stays paper; an override, then the spec, win', () => {
  assert.equal(DIAGRAM_THEME, 'blueprint');
  assert.equal(DEFAULT_THEME, 'paper');
  assert.equal(themeFor({}).name, 'blueprint');
  assert.equal(themeFor({ theme: 'ink' }).name, 'ink');
  assert.equal(themeFor({ theme: 'ink' }, 'paper').name, 'paper', 'a name override wins');
  const loaded = loadTheme('editorial');
  assert.equal(themeFor({ theme: 'ink' }, loaded), loaded, 'a loaded theme passes through untouched');
  assert.throws(() => themeFor({}, 'nope'), ThemeError);
});
```

`test/api.test.mjs` — replace the test `theme: a name, a loaded theme, the spec theme, or the default` with:

```js
test('theme: a name, a loaded theme, the spec theme, or the default (blueprint)', async () => {
  const spec = example('flow');
  const byName = await buildDiagram(spec, { theme: 'blueprint' });
  assert.deepEqual(await buildDiagram(spec, { theme: loadTheme('blueprint') }), byName);
  assert.deepEqual(await buildDiagram(spec), byName, 'the default is blueprint (paper shares its body and mono fonts, so the SVG would match either; build.test pins the page)');
  const editorial = await buildDiagram({ ...spec, theme: 'editorial' });
  assert.notEqual(editorial.width, undefined);
  await assert.rejects(buildDiagram(spec, { theme: 'nope' }), /unknown theme "nope"/);
});
```

`test/build.test.mjs` — append after `--theme overrides the spec theme`:

```js
test('the default theme is blueprint: IBM Plex Sans display and the kind hues on :root; --theme paper brings Newsreader back', () => {
  const html = readOut(run([example('flow')]));
  assert.match(html, /--font-display:"IBM Plex Sans"/);
  assert.ok(!html.includes('Newsreader'));
  assert.match(html, /--k-service:#0e7490/);
  const dir = tmp();
  const r = run([example('flow'), '--out', path.join(dir, 'p.html'), '--theme', 'paper']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'p.html'), 'utf8'), /--font-display:"Newsreader"/);
});
```

`test/browser.test.mjs` — in `SVG and PNG export download under the strict CSP, filled with the theme surface`, replace `assert.match(text, /viewBox="0 0 1370 255"/);` with

```js
    const data = JSON.parse(built('architecture').html.match(/id="pa-data">([^<]*)<\/script>/)[1]);
    assert.match(text, new RegExp(`viewBox="0 0 ${data.width} ${data.height}"`));
    assert.ok(text.includes('--k-service:') && text.includes('--s1:') && text.includes('--mono:'), 'the kind hues, lane colours and mono font travel with the file');
    assert.ok(text.includes('class="pa-legend"'), 'the legend is part of the drawing');
```

and `assert.ok(width >= 1370 && height >= 255, …)` with `assert.ok(width >= data.width && height >= data.height, \`${width}x${height}\`);`.

Create `test/look-browser.test.mjs`:

```js
// The look in a real browser: the dark glow against the light thickness, the
// tinted cards, the tile and emoji, a tone over a hue, the canvas, the lanes and
// the legend. Screenshots land in the scratch dir: look at them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildPage, example, scratchDir } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `look-${name}` }));
const styleOf = (page, sel, props) => page.evaluate(([s, ps]) => { const c = getComputedStyle(document.querySelector(s)); return Object.fromEntries(ps.map((p) => [p, c[p]])); }, [sel, props]);
// A theme variable as the browser serialises a colour (rgb(...)), to compare with computed styles.
const varColour = (page, name) => page.evaluate((n) => { const s = document.createElement('span'); s.style.color = `var(${n})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name);
const waitDotOn = (page) => page.waitForFunction(() => !!document.querySelector('.pa-dot.pa-dot-on'), null, { timeout: 5000 });

for (const colorScheme of ['light', 'dark']) {
  test(`${colorScheme}: the active edge is thicker than a plain one; dark glows it and the dot, light does not (screenshot look-${colorScheme}.png)`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { colorScheme });
    const plain = await styleOf(page, '.pa-edge[data-id="place"] .pa-wire', ['strokeWidth', 'filter', 'stroke']);
    assert.equal(plain.filter, 'none');
    assert.equal(plain.stroke, await varColour(page, '--k-service'), 'app (client) -> gateway takes the service hue');
    await page.screenshot({ path: path.join(scratchDir(), `look-${colorScheme}.png`) });
    await page.keyboard.press('p');
    for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×: the dot shows for 2.4 s
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft'); // beat 1 again, now at 0.5×
    const active = await styleOf(page, '.pa-edge.pa-active .pa-wire', ['strokeWidth', 'filter', 'stroke']);
    const accent = await varColour(page, '--accent');
    assert.equal(active.stroke, accent, 'the active edge takes the accent');
    assert.ok(parseFloat(active.strokeWidth) > parseFloat(plain.strokeWidth), 'thicker, not only recoloured');
    await waitDotOn(page);
    const dot = await styleOf(page, '.pa-dot.pa-dot-on', ['filter', 'fill']);
    if (colorScheme === 'dark') {
      assert.equal(active.strokeWidth, '2.5px');
      assert.match(active.filter, /drop-shadow/);
      assert.match(dot.filter, /drop-shadow/);
      assert.equal(dot.fill, await varColour(page, '--glow'));
    } else {
      assert.equal(active.strokeWidth, '3px');
      assert.equal(active.filter, 'none');
      assert.equal(dot.filter, 'none');
      assert.equal(dot.fill, accent);
    }
    await page.screenshot({ path: path.join(scratchDir(), `look-${colorScheme}-beat.png`) });
    await page.keyboard.press('Escape');
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('cards: tinted by family, the tile inside the card and the emoji inside the tile, the type line in the hue, a tone over it, a mono note', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  const fill = async (id) => (await styleOf(page, `.pa-node[data-id="${id}"] .pa-shape`, ['fill'])).fill;
  assert.notEqual(await fill('orders'), await fill('db'), 'service and data differ');
  assert.notEqual(await fill('orders'), await varColour(page, '--surface'), 'a tint, not the bare surface');
  assert.equal(await fill('orders'), await fill('gateway'), 'one family, one tint');
  assert.notEqual((await styleOf(page, '.pa-node[data-id="orders"] .pa-tile', ['fill'])).fill, await fill('orders'), 'the tile is a stronger tint');
  const inside = await page.evaluate(() => {
    const n = document.querySelector('.pa-node[data-id="orders"]');
    const box = (sel) => n.querySelector(sel).getBBox();
    const within = (a, b, tol) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.width <= b.x + b.width + tol && a.y + a.height <= b.y + b.height + tol;
    const shape = box('.pa-shape');
    const tile = box('.pa-tile');
    return { tileInShape: within(tile, shape, 0.5), emojiInTile: within(box('.pa-emoji'), tile, 3), typeInShape: within(box('.pa-type'), shape, 0.5), typeText: n.querySelector('.pa-type').textContent };
  });
  assert.deepEqual(inside, { tileInShape: true, emojiInTile: true, typeInShape: true, typeText: 'SERVICE' });
  assert.equal((await styleOf(page, '.pa-node[data-id="orders"] .pa-type', ['fill'])).fill, await varColour(page, '--k-service'));
  const warn = await varColour(page, '--warn');
  assert.deepEqual(await styleOf(page, '.pa-node[data-id="warehouse"] .pa-shape', ['stroke', 'strokeWidth']), { stroke: warn, strokeWidth: '2px' }, 'the tone border wins over the external hue');
  assert.equal((await styleOf(page, '.pa-node[data-id="warehouse"] .pa-type', ['fill'])).fill, warn);
  assert.equal((await styleOf(page, '.pa-edge[data-id="edge-5"] .pa-wire', ['stroke'])).stroke, await varColour(page, '--k-queue'), 'bus -> warehouse takes the queue hue');
  assert.match((await styleOf(page, '.pa-node[data-id="gateway"] .pa-note', ['fontFamily'])).fontFamily, /Mono/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the canvas is a dotted grid in light and a glow with faint lines in dark; lanes and the legend are drawn; nothing overflows at 390 px', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const light = await openPage(built('architecture').url, { colorScheme: 'light' });
  const dark = await openPage(built('architecture').url, { colorScheme: 'dark' });
  const bg = (p) => p.evaluate(() => getComputedStyle(document.getElementById('pa-stage')).backgroundImage);
  const lightBg = await bg(light.page);
  const darkBg = await bg(dark.page);
  assert.match(lightBg, /radial-gradient/);
  assert.ok(!/linear-gradient/.test(lightBg), 'light: dots only');
  assert.match(darkBg, /radial-gradient[\s\S]*linear-gradient/, 'dark: the glow wash and the grid lines');
  assert.equal(await light.page.locator('.pa-legend .pa-swatch').count(), 4);
  assert.equal(await light.page.locator('.pa-legend .pa-legend-sample').count(), 3);
  assert.equal(await light.page.locator('.pa-group[data-lane="0"] .pa-lane').count(), 1);
  assert.equal((await styleOf(light.page, '.pa-lane', ['fill'])).fill, await varColour(light.page, '--s1'));
  assert.deepEqual([light.problems, dark.problems], [[], []]);
  await light.context.close();
  await dark.context.close();
  const phone = await openPage(built('story').url, { width: 390, height: 780 });
  const fit = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(fit.sw <= fit.iw, `no horizontal overflow: ${fit.sw} <= ${fit.iw}`);
  assert.deepEqual(phone.problems, []);
  await phone.context.close();
});
```

`test/render.test.mjs:14` — `const NAMES = ['architecture', 'flow', 'state', 'sequence', 'story'];`. `test/layout-graph.test.mjs:16` — `const EXAMPLES = ['architecture', 'flow', 'state', 'story'];`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/theme.test.mjs test/api.test.mjs test/build.test.mjs test/look-browser.test.mjs test/render.test.mjs test/layout-graph.test.mjs`
Expected: `theme.test.mjs` fails at import (`Cannot find module '…/scripts/lib/theme.mjs'`); `api.test.mjs` `theme:` passes already (paper and blueprint draw the same SVG); `build.test.mjs` `the default theme is blueprint…` fails at `--font-display:"IBM Plex Sans"` (the page has Newsreader); in `look-browser.test.mjs` the `dark:` test fails at `assert.equal(active.strokeWidth, '2.5px')` (actual `'3px'`: Task 3's light rules apply in dark too), the `light:` and `cards:` tests pass already (the 3 px edge, the matte dot and the tints are Task 3's defaults), the canvas test fails at `/radial-gradient/` (the stage's `backgroundImage` is `none`); `render.test.mjs` and `layout-graph.test.mjs` fail the `story example: … golden` tests with `ENOENT` and every other golden with a diff.

- [ ] **Step 3: Implement**

`scripts/lib/css.mjs` — after `animation`, add the dark block and join it last:

```js
// Dark mode: the glow. The active edge and the dot glow in the theme's --glow
// through a CSS drop-shadow (no <filter> in <defs>: a page-wide stylesheet
// cannot name a per-diagram id, and a missing filter target hides its element);
// the lanes' fill reads a little stronger on a dark page. Light mode is the
// default above: a thicker active edge instead of a glow. The two selector
// forms mirror shared/theme.mjs: the OS scheme unless the page pins light, or
// an explicit data-theme="dark".
const DARK = [
  '.pa-edge.pa-active .pa-wire{stroke-width:2.5;filter:drop-shadow(0 0 6px var(--glow))}',
  '.pa-dot{fill:var(--glow);filter:drop-shadow(0 0 6px var(--glow))}',
  '.pa-group-box{fill:color-mix(in srgb,var(--text-3) 12%,transparent)}',
];
const dark = [
  `@media (prefers-color-scheme: dark){${DARK.map((r) => `:root:not([data-theme="light"]) ${r}`).join('')}}`,
  ...DARK.map((r) => `:root[data-theme="dark"] ${r}`),
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...familyRules, ...markRules, ...toneRules, ...laneRules, ...legendRules, ...state, ...animation, ...dark].join('\n');
}
```

Add to `test/look.test.mjs`:

```js
test('diagramCss: the dark block glows the active edge and the dot in both selector forms; light stays thick and matte', () => {
  const css = diagramCss();
  const media = css.match(/@media \(prefers-color-scheme: dark\)\{([^]*?)\}\n/)[1];
  for (const form of [media, css.slice(css.indexOf(':root[data-theme="dark"]'))]) {
    assert.match(form, /\.pa-edge\.pa-active \.pa-wire\{stroke-width:2\.5;filter:drop-shadow\(0 0 6px var\(--glow\)\)\}/);
    assert.match(form, /\.pa-dot\{fill:var\(--glow\);filter:drop-shadow\(0 0 6px var\(--glow\)\)\}/);
  }
  assert.match(media, /^:root:not\(\[data-theme="light"\]\) \.pa-edge/);
  assert.ok(!/drop-shadow/.test(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'))), 'no glow outside the dark block');
  assert.ok(css.indexOf('@media (prefers-reduced-motion') < css.indexOf('@media (prefers-color-scheme: dark)'), 'the motion guard comes first');
});
```

`scripts/lib/theme.mjs` — create:

```js
// make-diagram's theme default. The shared DEFAULT_THEME stays `paper` for
// dashboards and explainers; a diagram defaults to `blueprint`, whose navy dark
// mode is the glow look of the design (spec §3).
import { loadTheme } from '../../shared/theme.mjs';

export const DIAGRAM_THEME = 'blueprint';

/** The loaded theme for `spec`: `override` (a name or a loaded theme) wins, then spec.theme, then DIAGRAM_THEME. */
export function themeFor(spec, override) {
  if (typeof override === 'object' && override !== null) return override;
  return loadTheme(override ?? spec.theme ?? DIAGRAM_THEME);
}
```

`scripts/lib/api.mjs` — replace `import { loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';` with `import { themeFor } from './theme.mjs';`, and in `buildDiagram`: `const resolved = themeFor(spec, theme);`. Update the doc comment's `(default: the spec's theme, else paper)` to `(default: the spec's theme, else blueprint)`.

`scripts/build.mjs` — drop `import { loadTheme, DEFAULT_THEME } from '../shared/theme.mjs';`, add `import { themeFor } from './lib/theme.mjs';`, and `const html = renderViewer(spec, built, { theme: themeFor(spec) });`.

`scripts/lib/spec.mjs` — the shared import becomes `import { listThemes } from '../../shared/theme.mjs';`, add `import { themeFor } from './theme.mjs';`, and in `lintLayout`: `const theme = themeFor(spec);`.

`references/schema.md:19` — the `theme` row's default column: `` `blueprint` ``.

`template/toolbar.js:89`:

```js
  // Every variable the diagram stylesheet reads, so an exported file carries its colours.
  var VARS = ['--page', '--surface', '--text', '--text-2', '--text-3', '--line', '--grid', '--accent', '--accent-soft', '--warn', '--good', '--bad', '--glow',
    '--k-person', '--k-service', '--k-data', '--k-queue', '--k-external', '--k-decision', '--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8', '--font', '--mono'];
```

`template/viewer.html` — in the page `<style>`, after `* { box-sizing: border-box; }` add:

```css
/* The canvas: a dotted grid on the page colour; in dark, a wash of the glow at the top and faint grid lines. Mirrors the theme's own dark selectors. */
:root { --stage-bg: radial-gradient(circle, var(--grid) 1px, transparent 1.5px) 0 0 / 18px 18px, var(--page); --stage-dark: radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in srgb, var(--glow) 16%, transparent), transparent 70%), linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 48px 48px, linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 48px 48px, var(--page); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --stage-bg: var(--stage-dark); } }
:root[data-theme="dark"] { --stage-bg: var(--stage-dark); }
```

change the `.stage` rule to `.stage { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; background: var(--stage-bg); }`, and the active chip to `.pa-chip[aria-current="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); font-weight: 600; }`.

- [ ] **Step 4: Regenerate the goldens, once**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && PA_WRITE_GOLDEN=1 npm test` — this rewrites `test/golden/{architecture,flow,state,sequence,story}.svg` and `{architecture,flow,state,story}.layout.json` and `sequence.layout.json`. Then, with nothing else changed: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green. Open `test/golden/story.svg` and `architecture.svg` in a browser (plain `file://`) and look: tiles, type lines, pills, the lane bar on `aws`, the legend row at the top right.

Then make-explainer: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && node --test test/golden.test.mjs` — expected: only `golden: body markup of the recap example is unchanged` fails, and only in the figure's `style="--dg-w: …; --dg-h: …"` values (the sibling SVG is emptied by the normaliser). Confirm the diff is that and nothing else, then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && UPDATE_GOLDEN=1 node --test test/golden.test.mjs`, then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (`diagram-browser.test.mjs` 'the diagram follows the page theme toggle' sees a tinted fill change between light and dark; any failure there other than the golden is a finding to report).

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green, `check.test.mjs` included (every example passes `scripts/check.mjs` at 1440 and 390 px: no console errors, no text outside its card, no page overflow). `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — green. `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs --check` — in sync. `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js plugins/portable-artifacts/skills/make-diagram/template/viewer.html` (from the repo root) — every file under 400. The built story example stays under 400 KB (`check.test.mjs` asserts it).

- [ ] **Step 6: Look, then the design passes**

Open and view `look-light.png`, `look-dark.png`, `look-light-beat.png`, `look-dark-beat.png` and `architecture-light.png`/`architecture-dark.png` from the scratch directory the browser tests print (`diagram-ui-*` under the OS temp dir). Check: the cards read as tinted cards with a tile; the type line is legible; the lane bar sits inside the group's rounded corner; the legend does not overlap the drawing; in dark the active edge and dot glow and the canvas shows the wash.

Then load `redesign-existing-projects` and pass over `template/viewer.html` (the chrome: bar, chips, transport, panel) and the numeric values in `css.mjs` (`TILE_TINT`, the pill border, lane bar width, legend text). Unload it, load `emil-design-eng`, and pass over the dot (`DOT_RADIUS` in story.js, the 6 px glow) and the camera ease. Constraints: the spec's durations (600 / 1200 / 2500 + 40 per char, cap 6000) do not move; the tests pin the structure and the 10% card tint (a different tint means changing `shared/contrast.mjs TINT` and `css.mjs CARD_TINT` together and re-running Task 2's gate); every file budget holds; after each pass `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` is green and the screenshots are looked at again.

- [ ] **Step 7: Guard proofs** (revert each edit before moving on)

1. In `css.mjs`, delete `;filter:drop-shadow(0 0 6px var(--glow))` from the active-edge line in `DARK`; run `node --test --test-name-pattern="dark:" test/look-browser.test.mjs` — expected: FAIL at `/drop-shadow/`. Revert.
2. In `css.mjs`, change the family `.pa-shape` fill to `var(--surface)` (keep the stroke); run `node --test --test-name-pattern="cards:" test/look-browser.test.mjs` — expected: FAIL at `a tint, not the bare surface`. Revert.
3. In `viewer.html`, remove `background: var(--stage-bg);` from `.stage`; run `node --test --test-name-pattern="canvas" test/look-browser.test.mjs` — expected: FAIL at `/radial-gradient/`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 8: Commit**

Message: `feat(make-diagram): kind colours, emoji tiles, lanes, pills, legend and the glow look (goldens regenerated)` with the body:

```
One hue per kind family (person, service, data, queue, external, decision)
tints the card, the tile, the type line and the node's outgoing edges; emoji
draw in the tile; top-level groups are lanes with a coloured bar; edge labels
are pills; a legend with counts sits at the top right; dark mode glows the
active edge and the dot; the default theme is blueprint.

Goldens regenerated once for the new look: test/golden/*.svg and
*.layout.json (story.svg and story.layout.json added), and make-explainer's
test/golden/recap.body.html (the diagram figure's --dg-w/--dg-h changed).
```

— the orchestrator commits (Tasks 3, 4 and 5 together); do not run git commit.

---

## Phase 3 close-out

After Task 5, with everything on disk:

- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green.
- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green, with the recap golden regenerated once in Task 5.
- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-dashboard && npm test` — green (it gained seven theme variables and nothing else).
- `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — green; `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs --check` — in sync.
- `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js plugins/portable-artifacts/skills/make-diagram/template/viewer.html` — every file under 400; the built story example under 400 KB.
- Spec coverage this phase delivers (§3): kind colour per family driving tint, border, tile, type label, outgoing edge tint and legend swatch, with `tone` overriding border and icon; dark navy canvas with a radial glow and faint grid, dark glass cards, the active edge and the dot glowing; light off-white dotted grid, tinted cards with a stronger (thicker, matte) active edge, mono notes, coloured edges; groups as lanes (pale fill, 4 px bar cycling per top-level group, spaced-caps label, stretched to common edges when stacked); pill edge labels; legend with counts and edge styles; tokens in every theme passing the contrast gate; emoji in the system emoji stack, text in the SVG export; default theme `blueprint`; goldens regenerated once. Deferred phase-3 findings fixed (Task 1, Task 3). Left to phase 4: full screen and its fallback, the make-explainer overlay mounting the full viewer, SKILL.md / schema.md / kinds.md / README (beyond the one default-theme line), the eval run, the gallery sample.
- Then a fresh reviewer reads the phase diff and reports every finding (the report-everything sentence from `code-review.md` goes in its prompt); CRITICAL and HIGH findings are fixed before the orchestrator commits and pushes.

## Commit parts

Consecutive groups; each leaves every suite green and is one coherent commit.

| part | tasks | commit |
|---|---|---|
| A | Task 1 | `fix(make-diagram): the dot starts on its edge, step beats keep the camera's glide, chapter buttons survive an empty chapter list` |
| B | Task 2 | `feat(portable-artifacts): kind hue and glow tokens in every theme` (body: the contrast gate; `skills/*/shared` regenerated) |
| C | Tasks 3, 4, 5 | `feat(make-diagram): kind colours, emoji tiles, lanes, pills, legend and the glow look (goldens regenerated)` (body as in Task 5 Step 8) |

Part C is one commit because Tasks 3 and 4 leave the goldens red until Task 5 regenerates them; the orchestrator does not split it.

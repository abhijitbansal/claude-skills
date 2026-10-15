# make-diagram stories — Phase 4 Implementation Plan (full screen, embed, docs, eval, sample)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer goes full screen (`F`, a button) with a window-filling fallback where the browser refuses; make-explainer's Present overlay runs the whole viewer (Play story / Explore tabs, the transport, chapter and beat chips, the side panel, Find, full screen) instead of its Back / Next caption; the docs teach `stories`, `emoji` and `detail` and mark `steps` as the older form; the eval runs over the eight existing prompts plus a story prompt and an emoji prompt and decides the `model: haiku` pin; the gallery sample plays a story with emoji and gets a fresh thumbnail. The four review findings deferred to this phase, and the Low items phase 3 handed on, are fixed first, each with a failing test.

**Architecture:** Part A touches no feature: `story.js` gains `reframe()` so a resize keeps the running beat; `transport.js` scrolls only its chip row and moves focus off a button it is about to disable; `toolbar.js` writes the `#step-N` hash once per beat; `emoji.mjs` and `stories.mjs` take the Low fixes (escaped invisibles and a structural cap; `focus` names nodes, groups and participants only; a `both` edge counts as forward; the "required with" error names its fix). Part B adds `template/fullscreen.js` (`PADiagram.fullscreen(root)`: `requestFullscreen`, else the `pa-fill` class), moves fit to `0`, puts full screen on `F`, and extends the Escape chain. Part C rewrites make-explainer's overlay markup around the same `data-pa-*` hooks the page uses, styles them in `template/diagram.css` under `.dg-overlay`, and wires tabs and full screen in `template/diagram.js`. Part D is docs, the eval and the sample.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, `ajv@8.20.0`, `elkjs@0.12.0`, Playwright 1.64 (dev; browser tests skip without a browser). Browser code is ES5-style IIFEs inlined into the page. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-make-diagram-stories-design.md` §2 Full screen, §2 Inside make-explainer, §1 (SKILL.md teaches `stories`, `emoji`, `detail`), §4 Tests (make-explainer, eval), phase 4 of §5. Master plan: `docs/superpowers/plans/2026-10-14-make-diagram-stories.md` (file map, contracts, decisions 1–15, "Deferred review findings"). Phase 1 plan (format and conventions): `docs/superpowers/plans/2026-10-14-make-diagram-stories-phase1.md`; phase 2: `-phase2.md`; phase 3: `-phase3.md`.

## Global Constraints

- Branch `feat/diagram-stories`. Implementers do **not** run `git commit`/`git push`; each task ends with the commit message and the orchestrator commits.
- Plain ESM Node (Node 20); no new npm dependencies; `shared/` is not touched this phase (so `node bin/sync-shared.mjs` is not run; `--check` stays clean). Page code: no inline event handlers, no `eval`/`new Function`, no external requests; CSP stays `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. (Test code may use `new Function` to load a template module; the ban is on page code.)
- Every file under `template/` (make-diagram and make-explainer) stays under 400 lines; every other file under 800 (`test/runtime.test.mjs` pins make-diagram's template budget). Expected after this phase: `viewer.js` ≈ 362, `story.js` ≈ 340, `transport.js` ≈ 142, `toolbar.js` ≈ 206, `viewer.html` ≈ 186, `fullscreen.js` ≈ 72; make-explainer `diagram.js` ≈ 150, `diagram.css` ≈ 110.
- `scripts/lib/api.mjs` exports exactly `buildDiagram`, `validateSpec`, `viewerRuntime` (pinned by `test/api.test.mjs`). `viewerData` keys do not change (`test/api.test.mjs`, `test/build.test.mjs` stay as they are).
- Limits (spec §1, unchanged): `stories` ≤ 8, beats in all ≤ 60, story title ≤ 40, beat title ≤ 48, caption ≤ 160, `detail` ≤ 400, `emoji` exactly one emoji grapheme.
- Errors: JSON path, problem, fix, did-you-mean over closed sets; the same wording style as spec.mjs.
- Keyboard (master plan decision 5): `F` becomes full screen; fit moves to `0`, the Fit button and double-click. Escape order: closes the panel or route, else leaves full screen (real or fallback), else leaves Play, else clears the Find filter, else clears the trace. In Play any key but Space still pauses (so `F` pauses as it enters full screen).
- Reduced motion: unchanged (no dot, instant camera, `autoplay` ignored). Full screen has no motion of its own.
- Every control has an accessible name: the full-screen button reads `Full screen` / `Exit full screen` and carries `aria-pressed`.
- Goldens: make-diagram's `test/golden/*` do not change this phase (nothing in the SVG or layout changes). make-explainer's `test/golden/recap.body.html` changes once, in Part C's commit, because the overlay markup inside the `<figure>` changes; it is regenerated with `UPDATE_GOLDEN=1 node --test test/golden.test.mjs` after reading the diff, and the commit message says so. Never regenerated to hide an unrelated failure.
- Verification commands (exact, bare, no pipes): `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test`; one file: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/<file>.test.mjs`; `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test`; `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`; `cd /Users/abhijitbansal/projects/claude-skills && python3 -m pytest -q` (Part D touches SKILL.md frontmatter and docs); eval tests: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node --test "eval/test/*.test.mjs"`. The eval run itself (Task 6) is `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node eval/run-eval.mjs --skill diagram --host claude --model haiku --timeout 900` and is **started by the orchestrator only** (it bills ten Claude Haiku sessions through the `claude` CLI); the executor prepares everything and stops.
- Guard proofs: each new browser assertion is shown failing against a deliberately broken page (phase 1's Step-10 style) before it is trusted; every doctoring edit is reverted and the suite rerun.
- Look at the result (agent-autonomy rule): the implementer of Task 7 opens `thumb.jpg` and the rebuilt `index.html` (in a browser, Play story tab, one beat in) and views them before declaring the task done.
- The eval, the gallery rebuild and the docs make no claim that is not measured: the summary names the results folder and the exact command; the gallery footnote says who wrote the stories.

## Review Focus

Inputs §2 implies but no task would otherwise exercise, most likely to bite first. Each line names the task that pins it.

1. **Escape inside make-explainer's overlay while the panel is open**: the first Escape closes the panel, not the overlay; the overlay closes on the next. Today `diagram.js` swallows every Escape before the viewer sees it. Pinned in Task 4 (browser: select a node in Explore, Escape twice).
2. **A page inside a `sandbox="allow-scripts"` iframe** (the site's `.sc-frame` pattern): `document.fullscreenEnabled` is false there, so the button must fall back at once, read `Exit full screen`, and Escape must leave. Pinned in Task 3 (the `srcdoc` iframe test).
3. **A window resize while the dot travels**: the beat keeps playing and the dot stays on; today `onResize` restarts the beat from its glide. Pinned in Task 1 (unit: no new timer; browser: `setViewportSize` mid-dot).
4. **Two diagrams in one explainer page**: every id in the overlay (the scrubber's `<datalist>`) is prefixed per figure, so the page's ids stay unique. Pinned in Task 4 (`diagram.test.mjs` "share no ids" test with the new markup).
5. **`from`/`to` naming a two-headed edge against its authored order**: it plays forward (a `both` edge has no reverse), and a `both` edge plus a plain edge between the same ends is ambiguous. Pinned in Task 2 (`resolveEnds`).

## Drift from the master plan (the code wins; recorded here)

- **Runtime files.** `RUNTIME_FILES` becomes `['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'fullscreen.js', 'viewer.js']` (eight modules; phase 2 added `route.js` and `panel.js`). `test/runtime.test.mjs` pins the list and the factory map; both change.
- **Fullscreen root.** The master plan says "`requestFullscreen` on the viewer root". The page's root is `document.documentElement` (the whole page goes full screen: browser chrome disappears); make-explainer passes its `<dialog>` (already in the top layer, so it stays above the page). `PADiagram.mount` gains the option `root` (default `document.documentElement`); the fallback class `pa-fill` goes on that root. On the page, `html.pa-fill` hides the title block, the View and Animate tools, Export and Theme, so the canvas gets the room full screen would have given it; the mode tabs, Find, the chapters row and the `Exit full screen` button stay. In the overlay `pa-fill` changes nothing visible (the dialog already fills the window); the button state is the signal.
- **Keyboard.** `F` → full screen, `0` → fit (master decision 5). Three existing tests press `f` to fit (`browser.test.mjs` "a single node…", "a stage with no size…", "pan: … F, the Fit button and a double click") and move to `0`; `story-browser.test.mjs` "a pointer on the canvas pauses" presses `f` as "any other key" and moves to `x` so the test stays about pausing.
- **Controller.** `ctl.state()` gains `fullscreen` (true in real full screen or the fallback) and `fill` (the fallback is on); `ctl` gains `enterFullscreen`, `exitFullscreen`, `toggleFullscreen`. `story` gains `reframe()`.
- **Hash.** `toolbar.js` writes `history.replaceState` once per beat change (and once on leaving Play), not on every camera frame.
- **Overlay chrome.** The page's `[data-pa-mode]` tabs are toolbar chrome, not runtime, so `diagram.js` wires its own tabs and full-screen button through the controller. The chip, panel and transport styles live in `viewer.html`'s `<style>` (not `css.mjs`), so make-explainer gets its own copies in `template/diagram.css`, scoped under `.dg-overlay`.
- **Overlay caption.** `[data-pa-title]` and `[data-pa-note]` leave the overlay; `[data-pa-line]` replaces them (the transport still paints title/note when an embedder keeps them). `test/diagram.test.mjs` "carries its caption, a Present button and the dialog" and `test/diagram-browser.test.mjs` "Present opens the overlay…" change accordingly.
- **Overlay Escape.** `diagram.js`'s Escape listener (registered before mount, `stopImmediatePropagation`) now steps aside when the controller reports a selection, a route or full screen, so the viewer's own Escape runs first.
- **Beat note length.** A step-derived beat's `caption` is the step's `note` (up to 200 characters), longer than a story caption's 160. Not changed: `steps` is the older form with its published limit; `references/schema.md` says so. The hold still caps at 6 s.

## Deferred review findings handled here

| finding (master plan, "Deferred review findings") | handling |
|---|---|
| make-explainer overlay: End disables Next, focus falls to `<body>`, the dialog stops receiving keys; Space plays with no Play control | **Fixed, Task 1 and Task 4**: `transport.js` moves focus to Play before disabling a focused Prev/Next (Task 1, browser test); the overlay mounts the full transport (Task 4) and `diagram-browser.test.mjs` restores the End / Home assertions. |
| A window resize while playing restarts the current beat | **Fixed, Task 1**: `story.reframe()` glides the camera to the current beat's target without cancelling the run; `viewer.js onResize` calls it. Unit (no new timer, one more glide) and browser (dot stays on) tests. |
| `history.replaceState` runs on every camera frame | **Fixed, Task 1**: `toolbar.js setHash` remembers the beat it wrote; browser test counts calls. |
| `scrollIntoView` on the active chip can scroll the document | **Fixed, Task 1**: `transport.js` sets the chip row's `scrollLeft` from bounding rects; `test/transport-unit.test.mjs` (fake window) asserts `scrollIntoView` is never called. |
| Low: `emoji.mjs` has no structural cap; literal U+200D/U+FE0F/U+20E3 in the source | **Fixed, Task 2**: at most 10 code points, at most 4 ZWJ-joined parts, no empty part, at most one skin tone per part; invisible characters as escapes (a test reads the source). |
| Low: `stories.mjs` `focus` accepts authored edge and message ids | **Fixed, Task 2**: `checkStories` takes `ctx.focusable` (groups and nodes; participants in a sequence); `spec.mjs` passes it. |
| Low: a `both` edge is not counted when judging `from`/`to` ambiguity | **Fixed, Task 2**: `resolveEnds` counts a two-headed edge as forward either way. |
| Low: "required with from" has no fix clause | **Fixed, Task 2**: `required with from — name the other end, or target the edge with "edge"`. |
| Low: `stories.test.mjs` does not pin the story-level unknown-property message | **Fixed, Task 2**: two pins (story level, beat level). |
| Low: step notes (200) become captions (160) | **Not changed**, documented (see Drift). |
| Low: `loop` is on when `autoplay` is set even if a deep link or reduced motion suppressed autoplay | **Not changed**: spec §2 says loop defaults on when `autoplay` is true, unconditionally. |
| Low: each template module merges into an existing `window.PADiagram` | **Not changed, by design** (phase 2 plan): factories register on one shared namespace in bundle order; `fullscreen.js` uses the same idiom. |

---

## File structure (this phase)

Paths are relative to `plugins/portable-artifacts/`. **C** = create, **M** = modify, **R** = regenerate.

| | file | responsibility |
|---|---|---|
| M | `skills/make-diagram/template/story.js` | Task 1: `reframe()`, `seenNow` |
| M | `skills/make-diagram/template/transport.js` | Task 1: `reveal()` scrolls the chip row; `disable()` moves focus off a button it disables |
| M | `skills/make-diagram/template/toolbar.js` | Task 1: `setHash` memo; Task 3: full-screen button, Fit title |
| M | `skills/make-diagram/template/viewer.js` | Task 1: `onResize` → `reframe`; Task 3: `root`, `fs`, `F`/`0`, Escape chain, state |
| C | `skills/make-diagram/template/fullscreen.js` | Task 3: `PADiagram.fullscreen(root, { onChange })` |
| M | `skills/make-diagram/template/viewer.html` | Task 3: `[data-pa-full]`, `html.pa-fill` rules, Fit title `(0)` |
| M | `skills/make-diagram/scripts/lib/runtime.mjs` | Task 3: `fullscreen.js` before `viewer.js` |
| M | `skills/make-diagram/scripts/lib/emoji.mjs` | Task 2: escapes, structural cap |
| M | `skills/make-diagram/scripts/lib/stories.mjs`, `scripts/lib/spec.mjs` | Task 2: `ctx.focusable`, `both` forward, the fix clause |
| M | `skills/make-diagram/test/helpers/page.mjs` | Task 1: `init` option on `openPage` |
| C | `skills/make-diagram/test/transport-unit.test.mjs`, `test/fullscreen-browser.test.mjs`, `test/docs.test.mjs` | Tasks 1, 3, 5 |
| M | `skills/make-diagram/test/{story-unit,story-browser,browser,runtime,emoji,stories}.test.mjs` | named behaviour changes |
| M | `skills/make-diagram/SKILL.md`, `references/schema.md`, `references/kinds.md`, `README.md` | Task 5 |
| M | `skills/make-explainer/scripts/lib/render/diagram.mjs` | Task 4: the overlay markup with the page's hooks; `prefix` per figure |
| M | `skills/make-explainer/template/diagram.css`, `template/diagram.js` | Task 4: overlay styles; tabs, full screen, Escape precedence, focus on open |
| M | `skills/make-explainer/test/{diagram,diagram-browser}.test.mjs`, `references/sections.md` | Task 4 |
| R | `skills/make-explainer/test/golden/recap.body.html` | Task 4, once |
| M | `eval/prompts/diagram.json`, `eval/test/lib.test.mjs` | Task 6: `order-story`, `emoji-map` |
| C | `eval/results/summary-diagram-stories-2026-10-14.md` | Task 6 |
| M | `../../docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/{diagram.json,index.html,thumb.jpg}`, `../../docs/features/portable-artifacts.html` | Task 7 |

---

### Task 1: a resize keeps the beat, the hash writes once per beat, the chip row scrolls alone, focus never drops off a disabled button

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/story.js` (`goTo`, the return object; new `reframe`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/transport.js` (`mark`, the `prev`/`next` lines of `paint`; new `reveal`, `disable`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/toolbar.js:39-45` (`setHash`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js:313-315` (`onResize`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/helpers/page.mjs` (`openPage` gains `init`)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/transport-unit.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/story-unit.test.mjs`, `test/story-browser.test.mjs`

**Interfaces:**
- Consumes: `PADiagram.story` and `PADiagram.transport` as phase 3 left them (`template/story.js`, `template/transport.js`); `camera.moveTo(target, { instant })`.
- Produces: `story.reframe()` (the camera glides to the current beat's target for the new stage size; the glide, dot or hold under way keep their clocks; a no-op outside Play). `openPage(url, { init })` runs `init` in the page before its scripts (Task 3 uses it too). `transport.js` never calls `scrollIntoView`; a focused Prev/Next that is about to be disabled hands focus to `[data-pa-play]`, else the scrubber.

- [ ] **Step 1: Write the failing tests**

Append to `test/story-unit.test.mjs`:

```js
test('reframe keeps the running beat: the camera glides to the same target again and no timer restarts', () => {
  const { story, moves, timers } = load(HOPS);
  story.play(); // goTo(0): one glide move, one timer waiting for the glide
  const before = timers.length;
  story.reframe();
  assert.equal(timers.length, before, 'no new timer: the beat under way keeps its clock');
  assert.equal(moves.length, 2, 'one more camera move');
  assert.deepEqual(moves.at(-1), { ms: 600 }, 'a story beat re-glides at its own pace (a jump would cut the entry glide short)');
  assert.equal(story.isPlaying(), true);
  assert.equal(story.index(), 0);
  const steps = load(STEPS);
  steps.story.setSpeed(2);
  steps.story.present(1);
  steps.story.reframe();
  assert.deepEqual(steps.moves.at(-1), { ms: 150 }, 'a step beat re-glides at the camera pace over the speed');
  const idle = load(HOPS);
  idle.story.reframe();
  assert.deepEqual(idle.moves, [], 'outside Play there is nothing to reframe');
});
```

Create `test/transport-unit.test.mjs`:

```js
// PADiagram.transport (template/transport.js) in Node: a bare `window` with a
// fake document, so what the painter does to the chip row and to focus can be
// asserted without a browser. camera.js comes along for PADiagram.dict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = ['camera.js', 'transport.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');

// An element that records its children, attributes, listeners and scrolling.
function fakeEl(doc, tag) {
  const e = {
    tag, children: [], attrs: {}, listeners: {}, textContent: '', hidden: false, disabled: false,
    scrollLeft: 0, scrollIntoViewCalls: 0, rect: { left: 0, width: 0 }, clientWidth: 0,
  };
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.removeAttribute = (k) => { delete e.attrs[k]; };
  e.getAttribute = (k) => e.attrs[k] ?? null;
  e.addEventListener = (n, fn) => { e.listeners[n] = fn; };
  e.scrollIntoView = () => { e.scrollIntoViewCalls += 1; };
  e.getBoundingClientRect = () => ({ left: e.rect.left, width: e.rect.width, right: e.rect.left + e.rect.width });
  e.focus = () => { doc.activeElement = e; };
  e.querySelector = () => null;
  return e;
}

const beat = (title) => ({ kind: 'hop', chapter: 0, title, edge: 'edge-0', reverse: false, ids: ['a', 'b'], reveal: [], highlight: [] });
const DATA = { beats: ['One', 'Two', 'Three', 'Four', 'Five'].map(beat), chapters: [{ id: 's', title: 'S', start: 0, end: 5 }] };

// Loads camera.js and transport.js on a bare window and mounts a transport over a
// caption holder whose data-pa-* parts are fake elements. `at` is the current beat.
function load() {
  const doc = { activeElement: null };
  doc.createElement = (tag) => fakeEl(doc, tag);
  const win = { document: doc };
  new Function('window', src)(win);
  const parts = {};
  for (const name of ['data-pa-beats', 'data-pa-prev', 'data-pa-next', 'data-pa-play', 'data-pa-scrub', 'data-pa-count', 'data-pa-line']) parts[name] = fakeEl(doc, 'div');
  const row = parts['data-pa-beats'];
  row.rect = { left: 0, width: 200 }; // a row 200 px wide showing about two chips
  row.clientWidth = 200;
  const caption = fakeEl(doc, 'aside');
  caption.querySelector = (sel) => parts[sel.slice(1, -1)] ?? null;
  const state = { at: 0 };
  const noop = () => {};
  const story = {
    isPresenting: () => true, index: () => state.at, count: () => DATA.beats.length, current: () => DATA.beats[state.at], chapter: () => 0,
    isPlaying: () => false, speed: () => 1, loop: () => false,
    goTo: noop, prev: noop, next: noop, exit: noop, prevChapter: noop, nextChapter: noop, togglePlay: noop, cycleSpeed: noop, toggleLoop: noop, pause: noop,
  };
  // The row clamps scrollLeft at 0 as a browser does, and a chip's rect moves with the row's scroll:
  // chips are 100 px wide, 120 px apart.
  let scrolled = 0;
  Object.defineProperty(row, 'scrollLeft', { get: () => scrolled, set: (v) => { scrolled = Math.max(0, v); } });
  const transport = win.PADiagram.transport({ caption, chapters: null }, DATA, story);
  row.children.forEach((chip, i) => { chip.getBoundingClientRect = () => ({ left: 120 * i - scrolled, width: 100, right: 120 * i - scrolled + 100 }); });
  return { transport, parts, row, doc, state };
}

test('the active chip is brought into its row by scrolling the row, never with scrollIntoView', () => {
  const { transport, row, state } = load();
  state.at = 3;
  transport.paint();
  assert.ok(row.children.every((c) => c.scrollIntoViewCalls === 0), 'scrollIntoView would scroll the document too');
  // chip 3 spans 360..460, centre 410; the row's centre is 100: the row scrolls by 310
  assert.equal(row.scrollLeft, 310);
  state.at = 0;
  transport.paint();
  assert.equal(row.scrollLeft, 0, 'back to chip 0 (centre now at -260): 310 - 360 clamps at zero');
});

test('disabling the focused Next (or Prev) moves focus to Play first, so the keys keep reaching the viewer', () => {
  const { transport, parts, doc, state } = load();
  parts['data-pa-next'].focus();
  state.at = DATA.beats.length - 1;
  transport.paint();
  assert.equal(parts['data-pa-next'].disabled, true);
  assert.equal(doc.activeElement, parts['data-pa-play'], 'focus moved to Play before Next was disabled');
  parts['data-pa-prev'].focus();
  state.at = 0;
  transport.paint();
  assert.equal(parts['data-pa-prev'].disabled, true);
  assert.equal(doc.activeElement, parts['data-pa-play']);
  parts['data-pa-next'].focus();
  state.at = 2;
  transport.paint();
  assert.equal(doc.activeElement, parts['data-pa-next'], 'an enabled button keeps its focus');
});
```

In `test/helpers/page.mjs`, change `openPage`:

```js
/** Opens `url`; collects every console error and warning and every page error in `problems`. `init` runs in the page before its scripts. */
export async function openPage(url, { width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', hash = '', init } = {}) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url + hash);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}
```

Append to `test/story-browser.test.mjs` (after the "a sequence hop low in the diagram…" test):

```js
// ---- phase 4: deferred findings ------------------------------------------------------------------

test('a resize while the dot travels keeps the beat playing: the dot stays on and the count does not move', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×: glide 1200 ms, dot 2400 ms
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await waitDotOn(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(300); // the ResizeObserver has fired; a restarted beat would be mid-glide with the dot hidden
  assert.equal(await playing(page), true, 'still playing');
  assert.equal(await count(page), '1 / 9', 'the same beat');
  assert.equal(await page.locator('.pa-dot.pa-dot-on').count(), 1, 'the dot never went away');
  assert.ok((await viewBox(page)).every(Number.isFinite));
  await page.keyboard.press('Space');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the #step-N hash is written once per beat, not on every camera frame', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, {
    init: () => {
      window.__replaced = 0;
      const original = history.replaceState.bind(history);
      history.replaceState = function () { window.__replaced += 1; return original.apply(history, arguments); };
    },
  });
  await page.keyboard.press('p');
  await settle(page);
  assert.equal(await page.evaluate(() => window.__replaced), 1, 'entering Play writes #step-1 once');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  assert.equal(await page.evaluate(() => window.__replaced), 2, 'one beat, one write, however many frames the glide took');
  assert.equal(await page.evaluate(() => location.hash), '#step-2');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__replaced), 3, 'leaving clears the hash once');
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.deepEqual(problems, []);
  await context.close();
});

test('End with focus on Next hands focus to Play, so Home still works from the keyboard', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.focus('[data-pa-next]');
  await page.keyboard.press('End');
  assert.equal(await count(page), '9 / 9');
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-pa-play')), true, 'focus is on Play, not on the page');
  await page.keyboard.press('Home');
  assert.equal(await count(page), '1 / 9');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-pa-play')), true);
  assert.deepEqual(problems, []);
  await context.close();
});
```

Also in the existing test "a pointer on the canvas pauses…" change `await page.keyboard.press('f');` to `await page.keyboard.press('x');` (Task 3 puts full screen on `F`; this test is about pausing).

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-unit.test.mjs test/transport-unit.test.mjs test/story-browser.test.mjs`
Expected: `story-unit` fails with `story.reframe is not a function`; `transport-unit` fails on `scrollIntoViewCalls === 0` (the chip's `scrollIntoView` was called) and on `doc.activeElement` (still Next); in `story-browser`, "a resize while the dot travels" fails at `the dot never went away` (count 0: the restarted beat is mid-glide), "written once per beat" fails at its first assertion, `entering Play writes #step-1 once` (the entry glide alone fires dozens of frames, each a write), "End with focus on Next" fails at `focus is on Play` (the active element is `<body>`).

- [ ] **Step 3: `template/story.js`**

Add `var seenNow = null;` next to `var run = 0;` (the "running a beat" block). In `goTo`, replace `var seen = stepMode ? applyReveal() : null;` with:

```js
      var seen = stepMode ? applyReveal() : null;
      seenNow = seen;
```

In `show`, replace `var glide = (beat.kind === 'step' ? camera.glideMs() : GLIDE_MS) / speed;` with `var glide = glideFor(beat);` and add, above `show`:

```js
    // A story beat glides GLIDE_MS; a step beat (the older steps[] form) keeps the camera's own pace.
    function glideFor(beat) { return (beat.kind === 'step' ? camera.glideMs() : GLIDE_MS) / speed; }
```

(The same sentence was a comment inside `show`; delete it there.) After `function togglePresent()` add:

```js
    // A resize reframes the beat where it stands: the camera glides to the beat's
    // target for the new stage size while the glide, dot or hold under way keep
    // their clocks. goTo would start the beat over and hide the dot for a glide;
    // an instant jump would cut short the glide into a beat (the panel hides on
    // entering Play, which resizes the stage at once).
    function reframe() {
      if (!presenting) return;
      camera.moveTo(targetOf(beats[stepIndex], seenNow), { ms: glideFor(beats[stepIndex]) });
    }
```

In the return object, after `nextChapter: nextChapter, prevChapter: prevChapter, exit: exit, togglePresent: togglePresent,` add `reframe: reframe,`.

- [ ] **Step 4: `template/transport.js`**

Replace `mark`:

```js
    // Scroll the chip's row so the chip sits in the middle. Only the row moves:
    // scrollIntoView would scroll every ancestor, the page included.
    function reveal(row, chip) {
      if (!row || !chip || !row.getBoundingClientRect) return;
      var r = row.getBoundingClientRect();
      var c = chip.getBoundingClientRect();
      row.scrollLeft = Math.max(0, row.scrollLeft + (c.left + c.width / 2) - (r.left + r.width / 2));
    }
    // `row` is the element the chips were appended to (the Node harness has no parentNode).
    function mark(chips, row, active) {
      chips.forEach(function (c, i) {
        if (i === active) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });
      if (chips[active]) reveal(row, chips[active]);
    }
```

In `paint()`, the two `mark` calls become `mark(beatChips, beatRow, i);` and `mark(chapterChips, chaptersEl, story.chapter());`.

Add, before `function paint()`:

```js
    // A button disabled while it has focus drops focus to the page (and, in
    // make-explainer's overlay, out of the element that takes the keys): focus
    // goes to Play first, else to the scrubber.
    function disable(button, off) {
      if (!button) return;
      if (off && !button.disabled && doc.activeElement === button) {
        var to = part('data-pa-play') || scrub;
        if (to && to.focus) to.focus();
      }
      button.disabled = off;
    }
```

In `paint()` replace the four `prev`/`next` lines with:

```js
      disable(part('data-pa-prev'), i === 0);
      disable(part('data-pa-next'), i === n - 1);
```

- [ ] **Step 5: `template/toolbar.js` and `template/viewer.js`**

`toolbar.js`: replace `var wasPresenting = false;` and `setHash` with:

```js
  var hashAt = null; // the beat the hash names (null outside Play): a camera frame does not rewrite it
  function setHash(state) {
    var want = state.presenting ? state.step : null;
    if (want === hashAt) return;
    try {
      if (want !== null) history.replaceState(null, '', '#step-' + (want + 1));
      else history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* file:// without history: the deep link just is not updated */ }
    hashAt = want;
  }
```

`viewer.js` `onResize`:

```js
    // A resize reframes a running beat where it stands; outside Play a fitted view refits.
    function onResize() {
      if (story.isPresenting()) story.reframe(); else camera.onResize();
    }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-unit.test.mjs test/transport-unit.test.mjs test/story-browser.test.mjs` — expected: all pass. Then `npm test` — green (the `#step-N deep link` test in `browser.test.mjs` still sees `#step-3` after ArrowRight and `''` after Escape). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (its overlay still passes only `caption`; the transport paints what it finds).

- [ ] **Step 7: Guard proofs** (each new browser assertion shown catching a broken page; revert each edit before moving on)

1. In `viewer.js` `onResize`, put back `story.goTo(story.index())`; run `node --test --test-name-pattern="resize while the dot" test/story-browser.test.mjs` — expected: FAIL at `the dot never went away`. Revert. (The unit test fails on the same edit's story.js side: in `reframe`, call `cancelRun()` first and run `node --test test/story-unit.test.mjs` — expected: FAIL at `no new timer`. Revert.)
2. In `toolbar.js` `setHash`, delete `if (want === hashAt) return;`; run `--test-name-pattern="written once per beat"` — expected: FAIL at `one beat, one write`. Revert.
3. In `transport.js` `disable`, delete the `if (off && …) { … }` block; run `--test-name-pattern="End with focus on Next"` — expected: FAIL at `focus is on Play`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 8: Commit**

Message: `fix(make-diagram): a resize keeps the beat, the hash writes once per beat, chip rows scroll alone, focus survives a disabled button` — the orchestrator commits; do not run git commit. (Part A also holds Task 2; see Commit parts.)

---

### Task 2: the Low findings in `emoji.mjs` and `stories.mjs`

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/emoji.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/stories.mjs` (`resolveEnds`, `checkTarget`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/spec.mjs:244,333` (`checkStories` calls)
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/emoji.test.mjs`, `test/stories.test.mjs`

**Interfaces:**
- Consumes: `checkStories(errors, spec, ctx)` with `ctx = { endpoints, known }` (phase 1).
- Produces: `ctx` gains `focusable` (ids a `focus` beat may name: groups and nodes in a graph, participants in a sequence); `known` stays (unused after this task but kept for the call shape). `resolveEnds` treats a `both` edge as forward whichever way it is named. The "required with" message gains a fix clause.

- [ ] **Step 1: Write the failing tests**

Append to `test/emoji.test.mjs`:

```js
import fs from 'node:fs';

test('structure: at most four joined parts, no empty part, one skin tone per part, ten code points', () => {
  assert.equal(isOneEmoji('🧑🏻‍❤️‍💋‍🧑🏼'), true, 'the longest common sequence: four parts, ten code points');
  assert.equal(isOneEmoji('🏴󠁧󠁢󠁥󠁮󠁧󠁿'), true, 'a subdivision flag: one base, six tag letters');
  assert.equal(isOneEmoji(Array.from({ length: 50 }, () => '👍').join('‍')), false, 'a 50-part ZWJ chain is one grapheme but not one emoji');
  assert.equal(isOneEmoji('👍🏽🏽'), false, 'two skin tones');
  assert.equal(isOneEmoji('👍‍'), false, 'a trailing joiner');
  assert.equal(isOneEmoji('🧑‍🧑‍🧑‍🧑‍🧑'), false, 'five parts');
});

test('the source spells its invisible characters as escapes', () => {
  const src = fs.readFileSync(new URL('../scripts/lib/emoji.mjs', import.meta.url), 'utf8');
  assert.ok(!/[‍️⃣]/.test(src), 'a literal ZWJ, VS16 or keycap combiner is invisible in an editor');
});
```

Append to `test/stories.test.mjs` (after the `resolveEnds` test):

```js
test('a two-headed edge plays forward whichever way from/to name it, and counts when judging ambiguity', () => {
  const ba = { id: 'ba', from: 'b', to: 'a', both: true };
  assert.deepEqual(resolveEnds('a', 'b', [ba]), { link: ba, reverse: false }, 'no reverse on a both edge');
  assert.deepEqual(resolveEnds('b', 'a', [ba]), { link: ba, reverse: false });
  const ab = { id: 'ab', from: 'a', to: 'b', both: false };
  assert.deepEqual(resolveEnds('a', 'b', [ab, ba]), { error: '2 edges connect "a" and "b" (ab, ba); name one with "edge"' });
});

test('focus names nodes and groups (participants in a sequence), not edges or messages', async () => {
  const e = await errorsOf(graph([story([beat({ focus: ['ab'] })])]));
  assert.equal(e.length, 1);
  assert.equal(e[0].path, 'stories[0].beats[0].focus[0]');
  assert.match(e[0].message, /^"ab" not found; /);
  const seq = { title: 'S', type: 'sequence', participants: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], messages: [{ id: 'm1', from: 'x', to: 'y' }], stories: [story([beat({ focus: ['m1'] })])] };
  const s = await errorsOf(seq);
  assert.equal(s.length, 1);
  assert.equal(s[0].path, 'stories[0].beats[0].focus[0]');
  assert.match(s[0].message, /^"m1" not found; /);
  assert.deepEqual(await errorsOf({ ...seq, stories: [story([beat({ focus: ['x', 'y'] })])] }), []);
});

test('unknown properties on a story and on a beat name the allowed ones', async () => {
  const s = await errorsOf(graph([{ id: 's1', title: 'S', beats: [beat({ edge: 'ab' })], bogus: 1 }]));
  assert.deepEqual(s, [{ path: 'stories[0].bogus', message: 'unknown property; allowed: id, title, beats' }]);
  const b = await errorsOf(graph([story([{ ...beat({ edge: 'ab' }), note: 'x' }])]));
  assert.deepEqual(b, [{ path: 'stories[0].beats[0].note', message: 'unknown property; allowed: title, caption, edge, from, to, focus' }]);
});
```

In the existing test "a beat needs exactly one target" change the two `required with` expectations to:

```js
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a' })])])), [{ path: 'stories[0].beats[0].to', message: 'required with from — name the other end, or target the edge with "edge"' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ to: 'a' })])])), [{ path: 'stories[0].beats[0].from', message: 'required with to — name the other end, or target the edge with "edge"' }]);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/emoji.test.mjs test/stories.test.mjs`
Expected: `structure` fails on the 50-part chain (`true`), `escapes` fails (the source holds literal characters); `two-headed edge` fails on the first assertion (`reverse: true`); `focus names nodes` fails (`[]`, the edge id is accepted); `unknown properties` passes only if the schema wording already matches — if it fails, read the message and adjust the expectation to the schema's own words (the test pins them either way); `required with` fails on the message.

- [ ] **Step 3: `scripts/lib/emoji.mjs`** (replace the whole file)

```js
// What `emoji` may hold: exactly one emoji grapheme. Intl.Segmenter counts the
// graphemes a reader sees; the rest of the rule says what the one grapheme may
// be made of (a pictograph with its modifiers and joins, a two-letter flag, a
// keycap) and how much: a grapheme has no upper size, so a 50-part ZWJ chain
// or a doubled skin tone would otherwise pass. Symbols Unicode lists as
// pictographs (©, ™) pass; that is the letter of the rule, not a bug.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

const ZWJ = '‍';
// Characters that ride along inside one emoji: ZWJ, variation selector 16, the
// keycap combiner, skin tones and the tag letters of subdivision flags.
const MODIFIER = /^[‍️⃣\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
const SKIN = /^[\u{1f3fb}-\u{1f3ff}]$/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const REGION = /^\p{Regional_Indicator}$/u;
const KEYCAP = '⃣';
const KEYCAP_BASE = /^[0-9#*]$/;
const MAX_POINTS = 10; // the longest common emoji (two people, a heart and a kiss, each with a skin tone)
const MAX_PARTS = 4; // joined by ZWJ: a family of four

/** Number of graphemes in `text` (a flag or a family is 1; "ab" is 2). */
export function graphemeCount(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

// Each ZWJ-joined part carries one base and at most one skin tone.
function wellFormed(text) {
  const parts = text.split(ZWJ);
  if (parts.length > MAX_PARTS) return false;
  return parts.every((part) => part !== '' && [...part].filter((c) => SKIN.test(c)).length <= 1);
}

/** True when `text` is exactly one emoji. */
export function isOneEmoji(text) {
  if (graphemeCount(text) !== 1) return false;
  const points = [...text];
  if (points.length > MAX_POINTS || !wellFormed(text)) return false;
  const base = points.filter((c) => !MODIFIER.test(c));
  if (base.length === 0) return false;
  if (base.every((c) => REGION.test(c))) return base.length === 2;
  if (text.includes(KEYCAP)) return base.length === 1 && KEYCAP_BASE.test(base[0]);
  return base.every((c) => PICTO.test(c));
}
```

- [ ] **Step 4: `scripts/lib/stories.mjs` and `scripts/lib/spec.mjs`**

`stories.mjs`, replace `resolveEnds`:

```js
/**
 * The edge a beat's from/to names. The direction given wins: one edge from
 * `from` to `to` plays forward (a two-headed edge counts as forward either
 * way); failing that, one edge the other way plays in reverse (the dot runs
 * to -> from, for replies). Returns { link, reverse } or { error } (the
 * message; the caller adds the path). `what` is "edge" or "message".
 */
export function resolveEnds(from, to, links, what = 'edge') {
  const forward = links.filter((l) => (l.from === from && l.to === to) || (l.both && l.from === to && l.to === from));
  const found = forward.length ? forward : links.filter((l) => l.from === to && l.to === from);
  if (found.length === 1) return { link: found[0], reverse: forward.length === 0 };
  if (found.length === 0) return { error: `no ${what} between ${q(from)} and ${q(to)}; add one, or name ${what === 'edge' ? 'an' : 'a'} ${what} with "edge"` };
  return { error: `${found.length} ${what}s connect ${q(from)} and ${q(to)} (${found.map((l) => l.id).join(', ')}); name one with "edge"` };
}
```

In `checkTarget`, change the `focus` branch and the lone `from`/`to` branch:

```js
  if (beat.focus !== undefined) {
    if (beat.focus.length === 0) errors.push({ path: pathJoin(p, 'focus'), message: 'at least one id is required' });
    checkRefs(errors, beat.focus, pathJoin(p, 'focus'), ctx.focusable);
    return;
  }
  if (pair.length === 1) {
    const missing = pair[0] === 'from' ? 'to' : 'from';
    errors.push({ path: pathJoin(p, missing), message: `required with ${pair[0]} — name the other end, or target the edge with "edge"` });
    return;
  }
```

Update the `checkStories` doc comment: `ctx.focusable` the ids focus may name (groups and nodes; participants in a sequence); `ctx.known` is kept for callers that pass it.

`spec.mjs:244` (graph): `checkStories(errors, spec, { endpoints: ctx.endpoints, focusable: [...groupIds, ...nodeIds], known: [...seen.keys()] });`
`spec.mjs:333` (sequence): `checkStories(errors, spec, { endpoints: participantIds, focusable: participantIds, known: [...seen.keys()] });`

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/emoji.test.mjs test/stories.test.mjs test/spec.test.mjs` — expected: all pass (the story example's `focus: ["core"]` names a group, still valid). Then `npm test` — green.

- [ ] **Step 6: Commit**

Message: `fix(make-diagram): emoji structure cap, focus names nodes only, both edges play forward, clearer target errors` — the orchestrator commits (Part A with Task 1); do not run git commit.

---

### Task 3: full screen with the window-filling fallback; `F` → full screen, `0` → fit

**Files:**
- Create: `plugins/portable-artifacts/skills/make-diagram/template/fullscreen.js`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/runtime.mjs:7`
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js` (header comment, `mount` options, `state`, `onKey`, the return object)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/toolbar.js` (`sync`, the button wiring)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.html` (a button, the `pa-fill` rules, the Fit title)
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/runtime.test.mjs`, `test/browser.test.mjs:128,141,178-196`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/fullscreen-browser.test.mjs`

**Interfaces:**
- Consumes: `openPage(url, { init })` (Task 1); `PADiagram.dict` is not needed (no id-keyed data here).
- Produces: `PADiagram.fullscreen(root, { onChange })` → `{ enter, exit, toggle, isOn, isFill }`. `isOn()` is true in real full screen on `root` or while the fallback class `pa-fill` is on `root`; `isFill()` only for the fallback. `onChange` runs after every change, including the browser's own exit (`fullscreenchange`). `PADiagram.mount` gains the option `root` (default `document.documentElement`); `ctl.state()` gains `fullscreen` and `fill`; `ctl` gains `enterFullscreen`, `exitFullscreen`, `toggleFullscreen`. Page chrome: `[data-pa-full]` (`aria-pressed`; text `Full screen` / `Exit full screen`). Keys: `F` full screen, `0` fit. Task 4 passes `root: dialog`.

- [ ] **Step 1: Write the failing tests**

`test/runtime.test.mjs`: the first test's list becomes `['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'fullscreen.js', 'viewer.js']` and its title `'the runtime is camera, route, explore, panel, story, transport, fullscreen, then viewer, joined in that order'`; the factories map in the third test gains `'fullscreen.js': 'fullscreen'`.

`test/browser.test.mjs`: in "a single node with no edges fits…" (line 128) and "a stage with no size…" (line 141) change `press('f')` to `press('0')`; rename "pan: drag and arrow keys move the view; F, the Fit button and a double click restore it" to `'pan: drag and arrow keys move the view; 0, the Fit button and a double click restore it'` and change its `page.keyboard.press('f')` to `page.keyboard.press('0')`.

Create `test/fullscreen-browser.test.mjs`:

```js
// Full screen: F or the button ask the browser for full screen on the page's
// root; where that is refused or absent the page switches to the window-filling
// pa-fill layer. Real full screen cannot be seen in a headless run, so the API
// is stubbed: once granting (and reporting through fullscreenchange), once
// refusing. A sandbox="allow-scripts" iframe refuses by itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage, example, launchBrowser } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle } from './helpers/page.mjs';

let own; // the browser the iframe test launches itself (openPage waits for a top-level paReady, which a host page never sets)
after(async () => { await own?.close(); await closeBrowser(); });

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `fs-${name}` }));

const fillOn = (page) => page.evaluate(() => document.documentElement.classList.contains('pa-fill'));
const button = (page) => page.evaluate(() => { const b = document.querySelector('[data-pa-full]'); return { text: b.textContent, pressed: b.getAttribute('aria-pressed') }; });
const zoom = (page) => page.evaluate(() => Number(document.getElementById('pa-stage').getAttribute('data-zoom')));
const shown = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
const bodyHidden = (page) => page.evaluate(() => document.querySelector('[data-pa-panel-body]').hidden);

// A browser that grants: the request resolves and fullscreenchange reports the element.
const GRANTS = () => {
  let current = null;
  Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true });
  Object.defineProperty(document, 'fullscreenEnabled', { get: () => true, configurable: true });
  Element.prototype.requestFullscreen = function () { current = this; return Promise.resolve().then(() => document.dispatchEvent(new Event('fullscreenchange'))); };
  document.exitFullscreen = () => { current = null; return Promise.resolve().then(() => document.dispatchEvent(new Event('fullscreenchange'))); };
};
// A browser that refuses: the request rejects (what a page gets without a permission).
const REFUSES = () => {
  Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); };
};

test('F enters real full screen on the page root when the browser grants it, the button follows, Escape leaves; 0 fits, F no longer does', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: GRANTS });
  assert.deepEqual(await button(page), { text: 'Full screen', pressed: 'false' });
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true, 'the page root is the fullscreen element');
  assert.equal(await fillOn(page), false, 'no fallback when the browser granted');
  assert.deepEqual(await button(page), { text: 'Exit full screen', pressed: 'true' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'false');
  await page.keyboard.press('+');
  assert.ok(Math.abs((await zoom(page)) - 1.25) < 0.01);
  await page.keyboard.press('0');
  await settle(page);
  assert.ok(Math.abs((await zoom(page)) - 1) < 0.001, '0 fits');
  await page.keyboard.press('+');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  assert.ok(Math.abs((await zoom(page)) - 1.25) < 0.01, 'F is full screen now, not fit');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a refused request falls back to the pa-fill layer: the title and the export tools hide, the tabs and Find stay, Escape leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: REFUSES });
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(await button(page), { text: 'Exit full screen', pressed: 'true' });
  assert.equal(await shown(page, '.titles'), false, 'the title block goes');
  assert.equal(await shown(page, '[data-export="svg"]'), false, 'export goes');
  assert.equal(await shown(page, '[data-theme-toggle]'), false, 'the theme toggle goes');
  assert.equal(await shown(page, '[data-pa-mode="play"]'), true, 'the tabs stay');
  assert.equal(await shown(page, '[data-pa-find]'), true, 'Find stays');
  assert.equal(await shown(page, '[data-pa-full]'), true, 'and the way out stays');
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false);
  assert.equal(await shown(page, '.titles'), true);
  assert.deepEqual(await button(page), { text: 'Full screen', pressed: 'false' });
  assert.deepEqual(problems, []);
  await context.close();
});

test('inside a sandbox="allow-scripts" iframe the browser refuses by itself and the fallback fires; F toggles it from the keyboard', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { html } = built('story');
  const host = `<!doctype html><title>host</title><iframe sandbox="allow-scripts" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display:block;width:1000px;height:700px;border:0"></iframe>`;
  own ??= await launchBrowser();
  const context = await own.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.setContent(host);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  assert.equal(await frame.evaluate(() => document.fullscreenEnabled), false, 'the sandbox grants no fullscreen permission');
  await frame.click('[data-pa-full]');
  await frame.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(await frame.evaluate(() => { const b = document.querySelector('[data-pa-full]'); return { text: b.textContent, pressed: b.getAttribute('aria-pressed') }; }), { text: 'Exit full screen', pressed: 'true' });
  await page.keyboard.press('Escape'); // focus sits on the button inside the frame
  await frame.waitForFunction(() => !document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('f');
  await frame.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('f');
  await frame.waitForFunction(() => !document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(problems, []);
  await context.close();
});

test('Escape closes the panel before it leaves the fallback, and leaves the fallback before it leaves Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: REFUSES });
  await page.click('.pa-node[data-id="orders"]');
  assert.equal(await bodyHidden(page), false, 'the panel describes orders');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('Escape');
  assert.equal(await bodyHidden(page), true, 'the panel closed first');
  assert.equal(await fillOn(page), true, 'the layer stayed');
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false, 'then the layer went');
  await page.keyboard.press('p');
  assert.equal(await page.isVisible('[data-pa-caption]'), true);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false);
  assert.equal(await page.isVisible('[data-pa-caption]'), true, 'still in Play');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'now Play ends');
  assert.deepEqual(problems, []);
  await context.close();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/runtime.test.mjs test/fullscreen-browser.test.mjs test/browser.test.mjs`
Expected: `runtime` fails on the list; every `fullscreen-browser` test fails at its first `[data-pa-full]` lookup (`null`, the button does not exist) or on `aria-pressed`; in `browser.test.mjs` the three edited tests fail because `0` does nothing yet (zoom stays 1.25; the solo test's viewBox assertions still pass, so only the pan test fails).

- [ ] **Step 3: `template/fullscreen.js`**

```js
// make-diagram viewer, full screen: asks the browser for full screen on `root`
// and, where that is refused or absent (a sandboxed iframe, an old browser),
// falls back to the class pa-fill on root, which the page styles as a
// window-filling layer. Registered as PADiagram.fullscreen and composed by
// viewer.js.
//
//   var fs = PADiagram.fullscreen(root, { onChange });
//   // -> { enter, exit, toggle, isOn, isFill }
//
// onChange runs after every change, the browser's own exit included (Esc in
// real full screen never reaches the page as a key; fullscreenchange does).
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.fullscreen = function (root, hooks) {
    hooks = hooks || {};
    var doc = global.document;
    var fill = false;
    var changed = function () { if (hooks.onChange) hooks.onChange(); };
    var real = function () { return !!doc.fullscreenElement && doc.fullscreenElement === root; };
    var isOn = function () { return fill || real(); };

    function fallback() {
      if (fill || real()) return;
      fill = true;
      root.classList.add('pa-fill');
      changed();
    }
    function enter() {
      if (isOn()) return;
      if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== 'function') { fallback(); return; }
      var p;
      try { p = root.requestFullscreen(); } catch (e) { fallback(); return; }
      if (p && typeof p.then === 'function') p.then(null, fallback);
      else global.setTimeout(function () { if (!real()) fallback(); }, 0); // no promise (an old browser): look after a tick
    }
    function exit() {
      if (fill) {
        fill = false;
        root.classList.remove('pa-fill');
        changed();
      }
      if (real() && typeof doc.exitFullscreen === 'function') {
        var p;
        try { p = doc.exitFullscreen(); } catch (e) { /* already out */ }
        if (p && typeof p.then === 'function') p.then(null, function () {});
      }
    }
    function toggle() { if (isOn()) exit(); else enter(); }
    doc.addEventListener('fullscreenchange', changed);

    return { enter: enter, exit: exit, toggle: toggle, isOn: isOn, isFill: function () { return fill; } };
  };
})(window);
```

`scripts/lib/runtime.mjs:7`: `export const RUNTIME_FILES = ['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'fullscreen.js', 'viewer.js'];`

- [ ] **Step 4: `template/viewer.js`**

Header comment: the mount line becomes `//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, chapters, panel, tip, find, found, root, onChange });` and after the `find` line add `// root          element full screen is asked for, and that carries pa-fill when the browser refuses (default: the document element).`; the Keys line becomes `// Keys: Space plays and pauses, arrows step the beats, P enters Play, E leaves` / `// it, F is full screen, 0 fits, / focuses Find, Escape closes the panel, else` / `// leaves full screen, else leaves Play, else clears.`

In `mount`, after `var doc = global.document;` add:

```js
    var root = options.root || doc.documentElement;
    var fs = PADiagram.fullscreen(root, { onChange: emit });
```

In `state()` after `reducedMotion: camera.reduced(),` add `fullscreen: fs.isOn(),` and `fill: fs.isFill(),`.

In `onKey`, the comment block becomes: `// Space plays and pauses (on the canvas and on every transport control; a` / `// button elsewhere keeps Space for itself); arrows, PageUp/PageDown, Home` / `// and End move between beats; P enters Play, E leaves it; F is full screen;` / `// 0 fits; A toggles the edge animation; / focuses Find; Escape closes the` / `// panel, else leaves full screen, else leaves Play, else clears the Find` / `// filter, else clears the trace. In Play any key but Space pauses, in a form field too.`

Replace `if (k === 'f' || k === 'F') camera.fit();` with:

```js
      if (k === '0') camera.fit();
      else if (k === 'f' || k === 'F') fs.toggle();
```

In the Escape branch, after `if (trace.selected() || trace.routed()) closeSelection(t, true);` insert `else if (fs.isOn()) fs.exit();` (before `else if (inPlay) story.exit();`).

In the return object, after `setAnimate: setAnimate, toggleAnimate: toggleAnimate,` add `enterFullscreen: fs.enter, exitFullscreen: fs.exit, toggleFullscreen: fs.toggle,`.

- [ ] **Step 5: `template/toolbar.js` and `template/viewer.html`**

`toolbar.js`: after `var zoomLabel = one('[data-zoom-label]');` add `var fullButton = one('[data-pa-full]');`. In `sync`, before `setHash(state);`:

```js
    if (fullButton) {
      fullButton.textContent = state.fullscreen ? 'Exit full screen' : 'Full screen';
      fullButton.setAttribute('aria-pressed', String(state.fullscreen));
    }
```

After the `modes.explore` click line: `if (fullButton) fullButton.addEventListener('click', function () { ctl.toggleFullscreen(); });`

`viewer.html`: the Fit button becomes `<button type="button" class="tool" data-act="fit" title="Fit to screen (0)">Fit</button>`. After the Animate button add:

```html
<button type="button" class="tool" data-pa-full aria-pressed="false" title="Full screen (F)">Full screen</button>
```

In the page `<style>`, after the `.tool:disabled` rule add:

```css
/* The window-filling fallback (the browser refused full screen, as inside a sandboxed iframe): the chrome full screen would have hidden goes, the canvas takes the room; the tabs, Find, the chapters and the way out stay. */
html.pa-fill .titles, html.pa-fill [data-act], html.pa-fill .zoom-label, html.pa-fill [data-export], html.pa-fill [data-theme-toggle] { display: none; }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/runtime.test.mjs test/fullscreen-browser.test.mjs test/browser.test.mjs` — expected: all pass. Then `npm test` — green; `wc -l template/*.js template/viewer.html` — every file under 400. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (the overlay has no `[data-pa-full]` yet; `root` defaults to the document element and nothing presses `F` inside the dialog).

If the iframe test reports a console problem that only the sandbox produces (an `about:srcdoc` storage or history message the page's own try/catch does not cover), do not filter the assertion: read the message, fix the page so it stays silent there, and say so in the task report.

- [ ] **Step 7: Guard proofs**

1. In `fullscreen.js` `enter`, delete `p.then(null, fallback);` (keep the `if`); run `node --test --test-name-pattern="refused request" test/fullscreen-browser.test.mjs` — expected: FAIL waiting for `pa-fill`. Revert.
2. In `viewer.js`, move `else if (fs.isOn()) fs.exit();` above the `trace.selected()` line (make it the first Escape case); run `--test-name-pattern="closes the panel before"` — expected: FAIL at `the panel closed first`. Revert.
3. In `viewer.html`, delete the `html.pa-fill` rule; run `--test-name-pattern="refused request"` — expected: FAIL at `the title block goes`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 8: Commit**

Message: `feat(make-diagram): full screen on F with a window-filling fallback; 0 fits` — the orchestrator commits; do not run git commit.

---

### Task 4: make-explainer's overlay runs the full viewer

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-explainer/scripts/lib/render/diagram.mjs` (`prepare` keeps the prefix; `overlay` rewritten; `render` passes the prefix)
- Modify: `plugins/portable-artifacts/skills/make-explainer/template/diagram.css` (overlay rules replace the `.dg-cap-*` caption rules)
- Modify: `plugins/portable-artifacts/skills/make-explainer/template/diagram.js` (replace the whole file)
- Modify: `plugins/portable-artifacts/skills/make-explainer/test/diagram.test.mjs:539-545`, `test/diagram-browser.test.mjs:75-110,141-168`
- Modify: `plugins/portable-artifacts/skills/make-explainer/references/sections.md:47`
- Regenerate: `plugins/portable-artifacts/skills/make-explainer/test/golden/recap.body.html` (once, this task)

**Interfaces:**
- Consumes: `PADiagram.mount(stage, data, { keys, root, caption, chapters, panel, tip, find, found, onChange })`, `ctl.state().{presenting, steps, selected, route, fullscreen}`, `ctl.present/exit/toggleFullscreen/exitFullscreen` (Tasks 1–3 and phases 1–2); `transport.js` paints every `data-pa-*` part it finds and moves focus off a button it disables (Task 1).
- Produces: the overlay markup below, with the same hooks as `viewer.html` and class names prefixed `dg-`; the scrubber's `<datalist>` id is `<prefix>-ticks` (`dg_<i>-ticks`). `diagram.js` wires `[data-pa-mode]`, `[data-pa-full]`, focus-on-open to `[data-pa-play]`, and defers Escape to the viewer while a selection, a route or full screen is on.

- [ ] **Step 1: Write the failing tests**

`test/diagram.test.mjs`: replace the test "the diagram figure carries its caption, a Present button and the dialog" with:

```js
test('the diagram figure carries its caption, a Present button and a dialog holding the whole viewer', async () => {
  const { html } = await build([section(flow('Request path'), { caption: 'How a **request** flows' })]);
  assert.match(html, /<figcaption>How a <strong>request<\/strong> flows<\/figcaption>/);
  assert.match(html, /<button type="button" class="btn dg-present" data-dg-present aria-haspopup="dialog"[^>]*>Present/);
  assert.match(html, /<dialog class="dg-overlay" data-dg-dialog aria-label="Diagram presentation: Request path"/);
  for (const part of ['data-pa-mode="play"', 'data-pa-mode="explore"', 'data-pa-find', 'data-pa-full', 'data-dg-close', 'data-pa-chapters', 'data-pa-found', 'data-pa-tip', 'data-pa-panel', 'data-pa-panel-title', 'data-pa-panel-close', 'data-pa-tally', 'data-pa-panel-body',
    'data-pa-caption', 'data-pa-line', 'data-pa-beats', 'data-pa-prev-chapter', 'data-pa-prev', 'data-pa-play', 'data-pa-next', 'data-pa-next-chapter', 'data-pa-scrub', 'data-pa-ticks', 'data-pa-count', 'data-pa-speed', 'data-pa-loop']) assert.ok(html.includes(part), part);
  assert.ok(!html.includes('data-pa-title') && !html.includes('data-pa-note'), 'the caption line replaces the older title and note parts');
  assert.match(html, /<input type="range" class="dg-scrub" data-pa-scrub[^>]* list="dg_0-ticks">/);
  assert.match(html, /<datalist id="dg_0-ticks" data-pa-ticks><\/datalist>/);
});

test('each figure prefixes its scrubber datalist id, so two overlays share no id', async () => {
  const { html } = await build([section(flow('First')), text, section(flow('Second'))]);
  assert.match(html, /id="dg_0-ticks"/);
  assert.match(html, /id="dg_2-ticks"/);
  assert.equal((html.match(/data-pa-ticks/g) ?? []).length, 2);
});
```

`test/diagram-browser.test.mjs`: at the top add `import fs from 'node:fs';` and `import { fileURLToPath } from 'node:url';`, and after `const deck = …`:

```js
const STORY = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../make-diagram/references/examples/story.diagram.json', import.meta.url)), 'utf8'));
const storyPage = () => buildSpec(doc({}, [{ type: 'diagram', title: 'Orders', diagram: STORY, caption: 'An order.' }]));
const DLG = '[data-dg-dialog]';
const line = (page) => page.locator(`${DLG} [data-pa-line]`).textContent();
const dialogHas = (page, cls) => page.evaluate((c) => document.querySelector('[data-dg-dialog]').classList.contains(c), cls);
const REFUSES = () => { Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); }; };
```

Rewrite the body of "Present opens the overlay, steps forward and back, and Esc closes it with focus back" between `assert.equal(await stageParent(page), 'body', …)` and `await page.keyboard.press('Escape');`:

```js
  assert.equal(await count(page), `1 / ${STEPS}`);
  assert.equal(await line(page), '01 / 04 · WALKTHROUGH · Client calls');
  assert.equal(await page.locator('[data-pa-prev]').isDisabled(), true);
  assert.equal(await activeIs(page, '[data-pa-play]'), true, 'focus starts on Play');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="play"]`, 'aria-pressed'), 'true');

  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), `2 / ${STEPS}`);
  assert.equal(await line(page), '02 / 04 · WALKTHROUGH · Server answers');
  await page.keyboard.press('ArrowRight'); // Space is play/pause now, so a second step key
  assert.equal(await count(page), `3 / ${STEPS}`);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), `2 / ${STEPS}`);
  await page.locator('[data-pa-next]').click();
  await page.locator('[data-pa-next]').click();
  assert.equal(await count(page), `4 / ${STEPS}`);
  assert.equal(await page.locator('[data-pa-next]').isDisabled(), true);
  assert.equal(await activeIs(page, '[data-pa-play]'), true, 'Next went disabled under the pointer: focus moved to Play, not to the page');
  assert.equal(await line(page), '04 / 04 · WALKTHROUGH · Audit records it — Last step.');
  await page.locator('[data-pa-prev]').click();
  assert.equal(await count(page), `3 / ${STEPS}`);
  assert.equal(await page.locator(`${FIG} .pa-hidden`).count() > 0, true, 'steps not reached yet stay hidden');
```

In "slides: the overlay takes the keys…" replace the two commented lines and the `End`/`Home` loop (lines 156–159) with:

```js
  for (const key of ['End', 'Home']) await page.keyboard.press(key);
  assert.equal(await count(page), `1 / ${STEPS}`, 'End then Home: both reached the viewer (focus stayed inside the overlay when Next went disabled)');
  assert.equal(await open(page), true);
  assert.equal(await slide(), 3, 'the deck did not move');
```

Append:

```js
// ---- phase 4: the overlay runs the whole viewer -------------------------------------------------

test('the overlay plays a story: tabs, chapter chips, the transport with its dot, then Explore with the panel and Find', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { reducedMotion: 'no-preference' });
  await page.locator('[data-dg-present]').click();
  assert.equal(await open(page), true);
  assert.equal(await count(page), '1 / 9');
  assert.deepEqual(await page.locator(`${DLG} [data-pa-chapter]`).allTextContents(), ['Place the order', 'Fulfil it']);
  assert.equal(await line(page), '01 / 09 · PLACE THE ORDER · The shopper taps Buy — The app builds the order from the basket.');
  assert.equal(await activeIs(page, `${DLG} [data-pa-play]`), true);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-dg-stage]').classList.contains('pa-playing'));
  await page.waitForFunction(() => !!document.querySelector('[data-dg-stage] .pa-dot.pa-dot-on'), null, { timeout: 5000 });
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.querySelector('[data-dg-stage]').classList.contains('pa-playing')), false, 'Space pauses');
  await page.keyboard.press('e');
  assert.equal(await page.locator(`${DLG} [data-pa-caption]`).isHidden(), true, 'E leaves to Explore');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="explore"]`, 'aria-pressed'), 'true');
  await page.locator(`${FIG} .pa-node[data-id="orders"]`).click();
  assert.equal(await page.locator(`${DLG} [data-pa-panel-title]`).textContent(), 'Orders service');
  assert.ok((await page.locator(`${DLG} [data-pa-sends] .pa-row`).count()) >= 2, 'Sends to lists its edges');
  await page.keyboard.press('/');
  assert.equal(await activeIs(page, `${DLG} [data-pa-find]`), true, '/ focuses Find');
  await page.keyboard.type('ware');
  assert.equal(await page.locator(`${DLG} [data-pa-pick]`).count(), 1, 'one match: Warehouse');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), true, 'Escape in Find clears the box; the overlay stays');
  assert.equal(await page.inputValue(`${DLG} [data-pa-find]`), '');
  // The Find box blurred to the body, so this Escape reaches the dialog as the browser's cancel, not as a keydown; closeOverlay runs either way.
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false, 'with nothing of its own left to close, Escape closes the overlay');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Escape closes the panel before the overlay; reopening starts clean on beat 1 in Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('e');
  await page.locator(`${FIG} .pa-node[data-id="orders"]`).click();
  assert.equal(await page.locator(`${DLG} [data-pa-panel-body]`).isHidden(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(`${DLG} [data-pa-panel-body]`).isHidden(), true, 'the panel closed');
  assert.equal(await open(page), true, 'the overlay stayed');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false);
  await page.locator('[data-dg-present]').click();
  assert.equal(await count(page), '1 / 9');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="play"]`, 'aria-pressed'), 'true');
  assert.equal(await page.locator(`${DLG} [data-pa-panel]`).isHidden(), true, 'no panel over Play');
  await page.keyboard.press('/');
  await page.keyboard.type('ware');
  assert.equal(await page.locator(`${DLG} [data-pa-pick]`).count(), 1);
  await page.locator('[data-dg-close]').click();
  await page.locator('[data-dg-present]').click();
  assert.equal(await page.inputValue(`${DLG} [data-pa-find]`), '', 'closing cleared the Find box');
  assert.equal(await page.locator(`${DLG} [data-pa-found]`).isHidden(), true, 'and its matches');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('full screen in the overlay: a refused request puts pa-fill on the dialog; Escape leaves it first; Close drops it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { init: REFUSES });
  await page.locator('[data-dg-present]').click();
  await page.locator(`${DLG} [data-pa-full]`).click();
  await page.waitForFunction(() => document.querySelector('[data-dg-dialog]').classList.contains('pa-fill'));
  assert.equal(await page.locator(`${DLG} [data-pa-full]`).textContent(), 'Exit full screen');
  await page.keyboard.press('Escape');
  assert.equal(await dialogHas(page, 'pa-fill'), false, 'Escape left full screen');
  assert.equal(await open(page), true, 'and the overlay stayed');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-dg-dialog]').classList.contains('pa-fill'));
  await page.locator('[data-dg-close]').click();
  assert.equal(await open(page), false);
  assert.equal(await dialogHas(page, 'pa-fill'), false, 'closing drops the layer');
  assert.deepEqual(problems, []);
  await context.close();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && node --test test/diagram.test.mjs test/diagram-browser.test.mjs`
Expected: the two render tests fail on the missing hooks (`data-pa-mode="play"`) and the datalist; "Present opens the overlay…" fails at `[data-pa-line]` (no such element: `textContent()` times out — use the failure as the RED signal); the slides test fails at `End then Home` (count stays `4 / 4`: focus fell to the body); the three new tests fail at their first dialog lookups.

- [ ] **Step 3: `scripts/lib/render/diagram.mjs`**

In `prepare`, change the `items.set` line to `diagrams.items.set(section, { built, title: source.spec.title, prefix: idPrefix(i) });`.

Replace `overlay` with:

```js
// The side panel, with the hooks panel.js paints (make-diagram's viewer.html has the same ones).
function panel() {
  return `<aside class="dg-panel" data-pa-panel aria-label="Details">
<div class="dg-panel-head"><h2 class="dg-panel-title" data-pa-panel-title tabindex="-1" aria-live="polite">Map</h2><button type="button" class="btn" data-pa-panel-close aria-label="Close details (Esc)" hidden>Close</button></div>
<div class="dg-panel-empty" data-pa-empty><div class="dg-counts" data-pa-tally role="list" aria-label="What the map holds"></div><p class="dg-hint">Click a node or edge. Shift-click a second node to trace a path.</p></div>
<div class="dg-panel-body" data-pa-panel-body hidden></div>
</aside>`;
}

// The transport, with the hooks transport.js paints. The scrubber's datalist id is prefixed per figure.
function transport(prefix) {
  return `<div class="dg-cap" data-pa-caption aria-label="Story player" hidden>
<p class="dg-cap-line" data-pa-line aria-live="polite"></p>
<div class="dg-beats" data-pa-beats role="group" aria-label="Beats"></div>
<div class="dg-transport" role="group" aria-label="Transport">
<button type="button" class="btn" data-pa-prev-chapter title="Previous chapter">Prev chapter</button>
<button type="button" class="btn" data-pa-prev title="Previous beat (Left)">Prev</button>
<button type="button" class="btn" data-pa-play title="Play or pause (Space)">Play</button>
<button type="button" class="btn" data-pa-next title="Next beat (Right)">Next</button>
<button type="button" class="btn" data-pa-next-chapter title="Next chapter">Next chapter</button>
<input type="range" class="dg-scrub" data-pa-scrub min="0" max="0" step="1" value="0" aria-label="Beat" list="${prefix}-ticks">
<datalist id="${prefix}-ticks" data-pa-ticks></datalist>
<span class="dg-cap-count">Beat <span data-pa-count></span></span>
<button type="button" class="btn" data-pa-speed aria-label="Speed 1×; change speed" title="Playback speed">1×</button>
<button type="button" class="btn" data-pa-loop aria-pressed="false" title="Loop the story">Loop</button>
</div>
</div>`;
}

// The Present overlay: the whole viewer (tabs, Find, full screen, chapters, the stage with its
// tooltip, the panel, the transport) around the stage that diagram.js moves in while it is open.
function overlay(title, prefix) {
  return `<dialog class="dg-overlay" data-dg-dialog aria-label="Diagram presentation: ${esc(title)}">
<div class="dg-top">
<span class="dg-top-title">${esc(title)}</span>
<span class="dg-tools">
<span class="dg-modes" role="group" aria-label="Mode"><button type="button" class="btn" data-pa-mode="play" aria-pressed="true" title="Play the story (P)">Play story</button><button type="button" class="btn" data-pa-mode="explore" aria-pressed="false" title="Explore the diagram (E)">Explore</button></span>
<input type="search" class="dg-find" data-pa-find placeholder="Find a node" aria-label="Find a node" aria-keyshortcuts="/" autocomplete="off" spellcheck="false">
<button type="button" class="btn" data-pa-full aria-pressed="false" title="Full screen (F)">Full screen</button>
<button type="button" class="btn" data-dg-close>Close <span class="dg-key" aria-hidden="true">Esc</span></button>
</span>
</div>
<div class="dg-chapters" data-pa-chapters role="group" aria-label="Chapters" hidden></div>
<div class="dg-found" data-pa-found role="group" aria-label="Matching nodes" aria-live="polite" hidden></div>
<div class="dg-main">
<div class="dg-body" data-dg-body><div class="dg-tip" data-pa-tip role="tooltip" hidden></div></div>
${panel()}
</div>
${transport(prefix)}
</dialog>`;
}
```

In `render`, destructure `const { built, title, prefix } = entry;` and call `${overlay(title, prefix)}`. The file's header comment: "a Present button and an overlay that runs make-diagram's whole viewer (Play story, Explore, full screen)".

- [ ] **Step 4: `template/diagram.css`**

Delete the rules `.dg-cap-text`, `.dg-cap-title`, `.dg-cap-note`, `.dg-cap-note[hidden]`, `.dg-cap-nav`, and change `.dg-cap-nav .btn, .dg-top .btn { … }` to `.dg-top .btn, .dg-transport .btn { padding: 4px 14px; font-size: 0.85rem; }` and `.dg-cap-nav .btn:disabled` to `.dg-overlay .btn:disabled`. Replace the `.dg-cap` rule and add the rest, between `.dg-body > .dg-stage { … }` and the `.slide-diagram` rule:

```css
/* the overlay's chrome: the same hooks as make-diagram's own page, styled here under .dg-overlay */
.dg-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dg-modes { display: inline-flex; gap: 4px; }
.dg-overlay .btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.dg-overlay .btn:disabled { opacity: 0.6; cursor: default; }
.dg-find { font: inherit; color: inherit; width: 10em; padding: 2px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
.dg-chapters, .dg-found { flex: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.dg-chapters[hidden], .dg-found[hidden] { display: none; }
.dg-main { flex: 1 1 0; min-height: 0; display: flex; }
.dg-body { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; }
.dg-tip { position: absolute; z-index: 2; max-width: 260px; padding: 4px 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 0.8rem; pointer-events: none; overflow-wrap: anywhere; }
.dg-tip[hidden] { display: none; }
.dg-panel { flex: none; width: 300px; min-height: 0; overflow: auto; padding: 12px 16px; background: var(--surface); border-left: 1px solid var(--line); font-size: 0.9rem; }
.dg-panel[hidden] { display: none; }
.dg-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dg-panel-title { margin: 0; font: 600 1.05rem/1.3 var(--font-display); overflow-wrap: anywhere; }
.dg-panel-body[hidden], .dg-panel-empty[hidden], .dg-panel [data-pa-panel-close][hidden] { display: none; }
.dg-counts { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.dg-hint { margin: 8px 0 0; color: var(--text-2); }
.dg-panel .panel-icon { margin: 8px 0; font-size: 1.6rem; line-height: 1; }
.dg-panel .panel-glyph { width: 24px; height: 24px; color: var(--text-2); }
.dg-panel .panel-kind, .dg-panel h3 { margin: 0; color: var(--text-3); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
.dg-panel h3 { margin: 14px 0 4px; }
.dg-panel .panel-note, .dg-panel .panel-detail { margin: 8px 0 0; color: var(--text-2); overflow-wrap: anywhere; }
.dg-panel ul { margin: 0; padding: 0; list-style: none; }
.dg-panel ol { margin: 0; padding-left: 1.4em; }
.dg-panel li { overflow-wrap: anywhere; }
.dg-panel .panel-arrow, .dg-panel .panel-none, .dg-found .panel-none { color: var(--text-3); }
.dg-overlay .pa-row { display: block; width: 100%; margin: 0; padding: 4px 6px; background: none; border: 0; border-radius: 6px; color: inherit; font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.dg-overlay .pa-row:hover { background: var(--accent-soft); }
.dg-overlay .pa-chip { background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; cursor: pointer; color: var(--text-2); font: inherit; font-size: 0.8rem; line-height: 1.4; white-space: nowrap; }
.dg-overlay .pa-chip[aria-current="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); font-weight: 600; }
.dg-cap { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; background: var(--surface); border-top: 1px solid var(--line); }
.dg-cap[hidden] { display: none; }
.dg-cap-line { margin: 0; font-size: 0.95rem; line-height: 1.4; overflow-wrap: anywhere; }
.dg-beats { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.dg-transport { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dg-scrub { flex: 1 1 160px; min-width: 120px; margin: 0; }
.dg-cap-count { color: var(--text-3); font-size: 0.8rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (max-width: 719px) { .dg-main { flex-direction: column; } .dg-panel { width: auto; max-height: 36%; border-left: 0; border-top: 1px solid var(--line); } }
```

The old `.dg-body` rule (`position: relative; flex: 1 1 0; min-height: 0;`) is replaced by the one above; `.dg-body > .dg-stage` stays. `.dg-overlay.pa-fill` gets no rule: the dialog already fills the window, and the button's text and `aria-pressed` carry the state.

- [ ] **Step 5: `template/diagram.js`** (replace the whole file)

```js
// Diagram sections: mounts make-diagram's viewer (PADiagram, inlined just
// before this script) on each inline figure and runs the Present overlay.
//
// One SVG and one controller per figure. Inline, the viewer gives hover and
// focus tracing and click-to-select; wheel and drag are held back so the page
// still scrolls. Present opens a modal <dialog>, moves the stage into it and
// starts the story on its first beat. The dialog holds the whole viewer (the
// Play story / Explore tabs, Find, full screen, the transport with its chips,
// the side panel), on the same data-pa-* hooks make-diagram's own page uses;
// the viewer's keys element is that dialog, so its shortcuts exist only while
// it is open (and never reach a slide deck underneath). Esc closes the panel,
// then leaves full screen, then closes the dialog; focus goes back to the
// Present button.
(function () {
  var PAD = window.PADiagram;

  function setup(figure) {
    var stage = figure.querySelector('[data-dg-stage]');
    var slot = figure.querySelector('[data-dg-slot]');
    var dialog = figure.querySelector('[data-dg-dialog]');
    var body = dialog.querySelector('[data-dg-body]');
    var presentButton = figure.querySelector('[data-dg-present]');
    var closeButton = dialog.querySelector('[data-dg-close]');
    var playButton = dialog.querySelector('[data-pa-play]');
    var fullButton = dialog.querySelector('[data-pa-full]');
    var findBox = dialog.querySelector('[data-pa-find]');
    var modes = {};
    [].forEach.call(dialog.querySelectorAll('[data-pa-mode]'), function (b) { modes[b.getAttribute('data-pa-mode')] = b; });
    // Present does nothing without a mounted viewer, so it is hidden unless mounting succeeds.
    presentButton.hidden = true;
    if (!PAD) return;
    var data;
    try { data = JSON.parse(figure.querySelector('script[data-dg-data]').textContent); } catch (e) { return; }
    var isOpen = false;
    var controller = null;

    // Capture phase on the figure, before the viewer's own listeners on the stage run. This also hides
    // wheel and pointermove over a figure from any listener further up the page (none exists today; the
    // viewer's listeners sit on the stage itself, so the hold-back cannot be narrower than a stop here).
    function holdBack(event) { if (!isOpen) event.stopPropagation(); }
    figure.addEventListener('wheel', holdBack, true);
    figure.addEventListener('pointermove', holdBack, true);

    // Registered before the viewer's key handler, so it runs first. Esc closes the overlay only when the
    // viewer has nothing of its own to close: a selection or route (the panel) and full screen come
    // first and the viewer handles them; the Find box handles its own Esc (defaultPrevented by then).
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      var s = controller ? controller.state() : {};
      if (s.selected || s.route || s.fullscreen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOverlay();
    });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeOverlay(); });

    // The tabs and the full-screen button mirror the controller.
    function sync(state) {
      if (modes.play) { modes.play.setAttribute('aria-pressed', String(state.presenting)); modes.play.disabled = state.steps === 0; }
      if (modes.explore) modes.explore.setAttribute('aria-pressed', String(!state.presenting));
      if (fullButton) {
        fullButton.textContent = state.fullscreen ? 'Exit full screen' : 'Full screen';
        fullButton.setAttribute('aria-pressed', String(state.fullscreen));
      }
    }
    controller = PAD.mount(stage, data, {
      keys: dialog, root: dialog, onChange: sync,
      caption: dialog.querySelector('[data-pa-caption]'), chapters: dialog.querySelector('[data-pa-chapters]'),
      panel: dialog.querySelector('[data-pa-panel]'), tip: dialog.querySelector('[data-pa-tip]'),
      find: findBox, found: dialog.querySelector('[data-pa-found]'),
    });
    if (!controller) return;
    presentButton.hidden = false;
    if (modes.play) modes.play.addEventListener('click', function () { if (!controller.state().presenting) controller.present(0); });
    if (modes.explore) modes.explore.addEventListener('click', function () { controller.exit(); });
    if (fullButton) fullButton.addEventListener('click', function () { controller.toggleFullscreen(); });

    // Inline, nodes trace on hover and click but are not tab stops (a big diagram would add dozens
    // before the next section); in Present they are.
    var nodes = [].slice.call(stage.querySelectorAll('.pa-node'));
    function tabStops(on) { nodes.forEach(function (n) { n.tabIndex = on ? 0 : -1; }); }
    tabStops(false);

    // A diagram wider than the column keeps its text size and scrolls inside its slot: then the slot is a
    // labelled, focusable region (so the arrow keys scroll it, in a deck too).
    function syncRegion() {
      var scrolls = slot.scrollWidth > slot.clientWidth + 1;
      if (scrolls) {
        slot.setAttribute('role', 'region');
        slot.setAttribute('aria-label', slot.getAttribute('data-dg-label') + ' (scrolls sideways)');
        slot.tabIndex = 0;
      } else {
        slot.removeAttribute('role');
        slot.removeAttribute('aria-label');
        slot.tabIndex = -1;
      }
    }
    syncRegion();
    if (window.ResizeObserver) new window.ResizeObserver(syncRegion).observe(slot);
    else window.addEventListener('resize', syncRegion);

    var sideways = 0; // the slot's scrollLeft while the stage is away
    function openOverlay() {
      if (isOpen) return;
      dialog.showModal();
      isOpen = true;
      sideways = slot.scrollLeft;
      slot.style.height = slot.offsetHeight + 'px'; // the page below does not jump while the stage is away
      body.appendChild(stage);
      tabStops(true);
      controller.present(0);
      (playButton || closeButton).focus(); // Play: Space and the arrows work at once
    }
    // The stage goes home before the presentation ends, so the final fit is measured inline. Full
    // screen and the Find text go too, so the next Present starts clean (entering Play drops the
    // selection by itself).
    function restore() {
      if (!isOpen) return;
      isOpen = false;
      controller.exitFullscreen();
      if (findBox) { findBox.value = ''; findBox.dispatchEvent(new Event('input')); }
      slot.appendChild(stage);
      slot.style.height = '';
      tabStops(false);
      controller.exit();
      syncRegion();
      slot.scrollLeft = sideways; // an empty slot scrolled back to 0; the reader's place is restored
    }
    function closeOverlay() {
      restore();
      if (dialog.open) dialog.close();
    }
    dialog.addEventListener('close', function () {
      restore();
      presentButton.focus();
    });
    presentButton.addEventListener('click', openOverlay);
    closeButton.addEventListener('click', closeOverlay);
  }

  [].forEach.call(document.querySelectorAll('[data-diagram]'), setup);
})();
```

Why the `cancel` handler is not a hole in the Escape order: Chromium raises a modal dialog's `cancel` from the Escape keydown's default action, so a keydown the viewer `preventDefault`ed (closing the panel, leaving full screen) never reaches `cancel`; `cancel` fires only when no keydown listener claimed the key, as when focus has left the dialog (the Find box blurs to the body), and then closing is right. The browser tests above prove both halves.

`references/sections.md:47` becomes: `- Hover traces edges. A Present button opens make-diagram's whole viewer in an overlay: Play story (the transport, chapter and beat chips, the travelling dot), Explore (a side panel for a node or edge, Find, shift-click routes) and full screen. In a deck the keys belong to the overlay while it is open; Esc closes the panel, then leaves full screen, then closes the overlay.`

- [ ] **Step 6: Run the tests; regenerate the recap golden once**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && node --test test/diagram.test.mjs test/diagram-browser.test.mjs` — expected: all pass. Then `npm test` — expected: every test green except `golden: body markup of the recap example is unchanged` (the recap example embeds a diagram; its figure's overlay markup moved). Read the diff: only the `<dialog>` block inside `<figure class="dg">` changes. Then run once: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && UPDATE_GOLDEN=1 node --test test/golden.test.mjs`, then `npm test` — green. Then `node scripts/check.mjs` on the built recap example (`node scripts/build.mjs references/examples/recap.explainer.json --out /private/tmp/claude-501/-Users-abhijitbansal-projects-claude-skills/bed33bab-d0b4-4db1-8160-1bc98623e9ab/scratchpad/recap.html` then `node scripts/check.mjs /private/tmp/claude-501/-Users-abhijitbansal-projects-claude-skills/bed33bab-d0b4-4db1-8160-1bc98623e9ab/scratchpad/recap.html`) — expected: `check: ok` (one Esc after opening still closes the overlay). `wc -l template/diagram.js template/diagram.css` — under 400.

- [ ] **Step 7: Guard proofs**

1. In `diagram.js`, delete `if (s.selected || s.route || s.fullscreen) return;`; run `node --test --test-name-pattern="closes the panel before the overlay" test/diagram-browser.test.mjs` — expected: FAIL at `the overlay stayed`. Revert.
2. In `diagram.js` `restore`, delete the `if (findBox) { … }` line; run `--test-name-pattern="reopening starts clean"` — expected: FAIL at `closing cleared the Find box`. Revert.
3. In `render/diagram.mjs` `transport`, change `id="${prefix}-ticks"` to `id="pa-ticks"`; run `node --test test/diagram.test.mjs` — expected: FAIL on `id="dg_2-ticks"` and on the "share no ids" test. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 8: Commit**

Message: `feat(make-explainer): the diagram overlay runs the full viewer (recap golden regenerated)` — body: `The Present overlay mounts make-diagram's tabs, Find, full screen, chapter and beat chips, transport and side panel on the page's own data-pa-* hooks; Back/Next and the title/note caption go. The recap golden is regenerated once because the <dialog> markup inside the figure changed; nothing else in the body moved.` The orchestrator commits; do not run git commit.

---

### Task 5: docs — SKILL.md teaches stories, emoji and detail; schema.md, kinds.md and README follow the code

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/SKILL.md` (replace the whole file)
- Modify: `plugins/portable-artifacts/skills/make-diagram/references/schema.md` (root and node tables, a `stories[]` section, the steps heading, Limits, Output)
- Modify: `plugins/portable-artifacts/skills/make-diagram/references/kinds.md` (a colour-family section)
- Modify: `plugins/portable-artifacts/skills/make-diagram/README.md` (features, the key table, the steps paragraph)
- Modify: `plugins/portable-artifacts/README.md:12`, `docs/catalog.html:211,213`, `docs/skills-catalog.md:170`, `docs/features/portable-artifacts.html:73` (the one-line description of make-diagram, hand-written in each)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/docs.test.mjs`

**Interfaces:**
- Consumes: `SCHEMA`, `LIMITS` (`scripts/lib/schema.mjs`), `FAMILIES` (`scripts/lib/kinds.mjs`: `['person', 'service', 'data', 'queue', 'external', 'decision']`).
- Produces: the docs Task 6's eval prompts rely on (the model reads SKILL.md); `test/docs.test.mjs` pins them to the schema.

- [ ] **Step 1: Write the failing test**

Create `test/docs.test.mjs`:

```js
// The docs follow the code: every schema property is named in schema.md, the
// limits in its table are the schema's, SKILL.md teaches stories and not steps,
// and the key tables say F is full screen and 0 fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHEMA, LIMITS } from '../scripts/lib/schema.mjs';
import { FAMILIES } from '../scripts/lib/kinds.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const schemaDoc = read('references/schema.md');
const skill = read('SKILL.md');
const readme = read('README.md');
const kinds = read('references/kinds.md');

test('schema.md names every root, node, participant and beat property', () => {
  const beat = SCHEMA.properties.stories.items.properties.beats.items.properties;
  const names = [...Object.keys(SCHEMA.properties), ...Object.keys(SCHEMA.properties.nodes.items.properties), ...Object.keys(SCHEMA.properties.participants.items.properties), ...Object.keys(beat)];
  for (const name of new Set(names)) assert.ok(schemaDoc.includes(`\`${name}\``), `schema.md names \`${name}\``);
});

test('schema.md carries the story limits from the schema and marks steps as the older form', () => {
  assert.ok(schemaDoc.includes(`| stories / beats in all | ${LIMITS.stories} / ${LIMITS.beats} |`), 'stories and beats row');
  assert.ok(schemaDoc.includes(`| story title / beat title / caption | ${LIMITS.storyTitle} / ${LIMITS.beatTitle} / ${LIMITS.caption} characters |`), 'story lengths row');
  assert.ok(schemaDoc.includes(`| detail | ${LIMITS.detail} characters |`), 'detail row');
  assert.match(schemaDoc, /^## steps\[\] \(the older form\)$/m);
  assert.match(schemaDoc, /`F` .*full screen/);
  assert.match(schemaDoc, /`0`.*fit/);
});

test('SKILL.md teaches stories, emoji and detail and no longer teaches steps', () => {
  assert.match(skill, /^## Stories$/m);
  assert.ok(!/^## Presentation steps$/m.test(skill), 'the steps section is gone');
  for (const word of ['`emoji`', '`detail`', '`autoplay`', '"stories"', '"beats"', '"caption"', '"from"', '"to"', '"focus"']) assert.ok(skill.includes(word), word);
  const fm = skill.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(fm, /^description: .*stories/m, 'the description sells stories');
  assert.ok(!fm.includes('step-by-step'));
});

test('README says F is full screen and 0 fits; kinds.md describes every colour family', () => {
  assert.match(readme, /\| `F` \| full screen/);
  assert.match(readme, /\| `0`, double-click \| fit/);
  assert.ok(!/\| `F`, double-click \| fit/.test(readme), 'the old row is gone');
  for (const f of FAMILIES) assert.match(kinds, new RegExp(`^\\| \`${f}\` \\|`, 'm'), `kinds.md has a row for ${f}`);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/docs.test.mjs`
Expected: all four fail (`autoplay`, `stories`, `emoji`, `detail`, `caption`, `edge` missing from schema.md; no `## Stories`; the README row reads `` `F`, double-click ``; no family rows).

- [ ] **Step 3: `SKILL.md`** (replace the whole file)

````markdown
---
name: make-diagram
description: Use when the user wants an architecture diagram, flowchart, sequence diagram or state diagram as a polished offline HTML page that plays named stories of beats along its edges with a transport bar, lets the reader explore nodes and routes in a side panel, goes full screen and exports; the agent writes a small JSON topology and scripts lay it out with ELK and render it.
argument-hint: what to draw, e.g. "checkout request path from browser to orders DB, with the order story"
model: haiku
effort: low
---

# make-diagram

You write one JSON file, `diagram.json`: a title, a type, nodes with edges (or participants with messages), and usually one or two stories: named chapters of beats, each beat one hop along an edge with a title and a caption. Scripts lay it out with ELK, check the geometry and build one offline HTML page with a story player, an Explore panel and full screen. You never write coordinates, CSS, SVG or HTML.

`<skill-dir>` is the folder that contains this SKILL.md. Run every command from the project folder (where `diagram.json` lives), using the full path to the scripts. If the request is empty, ask what to draw.

Run every step yourself, in this same turn. Do not end your reply after showing the JSON: keep going until validate prints `valid` and the HTML exists.

First use: if `<skill-dir>/node_modules` is missing, say it is a one-time local install and run `npm ci --omit=dev --prefix <skill-dir>`.

## Workflow

1. Pick the type and write `diagram.json` (examples below; every field in `<skill-dir>/references/schema.md`; ready-made files in `<skill-dir>/references/examples/`, `story.diagram.json` among them).
2. Icons and emoji are optional. Find an icon: `node <skill-dir>/scripts/icons.mjs search <word>` prints refs like `lucide:database` or `brand:postgresql`. Use a ref exactly as printed. Skip icons if unsure: most kinds have a default icon (see `<skill-dir>/references/kinds.md`); flow `start`, `end`, `decision` and state `start`, `end`, `choice` are drawn as shapes and take no icon or emoji.
3. `node <skill-dir>/scripts/validate.mjs diagram.json`. Fix every line it prints (a JSON path, the problem, the fix) and rerun until it says `valid`. Exit 0 ok, 1 spec errors, 2 usage error.
4. `node <skill-dir>/scripts/build.mjs diagram.json` prints the HTML path. Default folder is `~/.agent/diagrams/` (or `$PA_OUTPUT_DIR`); `--out <file.html|dir>` picks another; `--theme paper|blueprint|ink|editorial` overrides the theme (default `blueprint`).
5. `node <skill-dir>/scripts/check.mjs <printed path>` opens the page at desktop and phone width and fails on overflow or console errors. It skips cleanly (exit 0) when Playwright or a browser is missing; do not install either for it.
6. Report: the HTML path, one line on what the diagram shows, and "Play story (or `P`) plays it, `E` explores, `F` is full screen".

For a change ("rename the cache", "add a beat for the retry"), edit only those fields of `diagram.json`, then validate and build again.

## Types and kinds

- `architecture`: `service` (default), `client`, `user`, `database`, `storage`, `queue`, `cache`, `function`, `gateway`, `external`, `other`. Optional `groups` (nest up to 3 deep); an edge may end at a group.
- `flow`: `step` (default), `start`, `end`, `decision`, `io`, `subprocess`, `wait`. Default direction is down.
- `state`: `state` (default), `start`, `end`, `choice`. A transition from a state to itself is allowed.
- `sequence`: participants of kind `service` (default), `actor`, `database`, `queue`, `external`; messages of kind `sync` (default), `async`, `reply`, `self` (from = to).

Every node and participant may carry `emoji` (exactly one emoji, drawn in the icon tile instead of the icon; not on the bare shapes above) and `detail` (up to 400 characters of plain text, shown in the Explore panel when the reader clicks the node). Each kind has a colour family that tints its card and its outgoing edges (`<skill-dir>/references/kinds.md`); `tone` (neutral, accent, good, warn, bad) overrides only the border and icon.

Writing rules: labels are nouns ("Orders DB"), edge and message labels are verbs ("writes order"). Labels stay under 48 characters, notes under 60 (one line), edge labels under 40, the title under 120 and the subtitle under 160. Ids are lowercase letters, digits, `-`, `_`, starting with a letter. At most 12 nodes reads best; split a bigger system into several diagrams (hard limits: 60 nodes, 120 edges, 12 participants, 60 messages). `direction` (right or down) applies to graph types, not sequence.

## Architecture example

```json
{
  "title": "Checkout request path",
  "type": "architecture",
  "groups": [{ "id": "vpc", "label": "Private VPC" }],
  "nodes": [
    { "id": "web", "label": "Web app", "kind": "client", "emoji": "🛒" },
    { "id": "api", "label": "Checkout API", "group": "vpc", "detail": "Owns the order. Writes it, then answers the app." },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "vpc", "icon": "brand:postgresql" }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "posts order" },
    { "from": "api", "to": "db", "label": "writes order", "style": "async" }
  ],
  "stories": [
    { "id": "order", "title": "Place an order", "beats": [
      { "title": "The app posts the order", "from": "web", "to": "api", "caption": "One POST with an idempotency key." },
      { "title": "The API writes it", "from": "api", "to": "db", "caption": "Committed before the app hears back." },
      { "title": "The app gets its answer", "from": "api", "to": "web", "caption": "Against the arrow: a reply plays backwards." }
    ] }
  ]
}
```

Edge `style`: `solid` (default), `dashed`, `async`; `"both": true` draws arrows at both ends.

## Stories

`stories` is up to 8 chapters `{ "id", "title", "beats" }` (title up to 40 characters: the chapter chip), 60 beats in all, played as one timeline. Each beat has a `title` (up to 48 characters) and an optional `caption` (up to 160: the one sentence the reader hears while the camera holds), and exactly one target:

- `"from"` and `"to"`: the one edge between two nodes (a group counts in architecture; participants in a sequence). Naming the ends against the arrow plays the hop backwards, for replies. Two edges between the same ends, or none, is an error that asks for `"edge"`.
- `"edge"`: an edge id (an edge without an id is `edge-<index>`), or a message id in a sequence.
- `"focus"`: node, group or participant ids the camera fits and lights, with no travelling dot: an establishing or closing shot.

Write one story for the main path (3 to 8 beats) and one per side path (the retry, the failure, the event). Beat titles are short present-tense sentences ("The app calls the API"); captions add the one fact the title leaves out. Leave `stories` out only when there is nothing to narrate: the build then makes one beat per layout layer (per message in a sequence). `"autoplay": true` starts the player when the page opens (ignored under reduced motion). `steps` is the older walkthrough form; do not write it for new diagrams (`references/schema.md` still documents it).

## Sequence example

```json
{
  "title": "Login",
  "type": "sequence",
  "participants": [
    { "id": "user", "label": "User", "kind": "actor", "emoji": "🧑" },
    { "id": "api", "label": "Auth API" },
    { "id": "db", "label": "Users DB", "kind": "database" }
  ],
  "messages": [
    { "id": "m1", "from": "user", "to": "api", "label": "sends credentials" },
    { "id": "m2", "from": "api", "to": "db", "label": "looks up user" },
    { "id": "m3", "from": "api", "to": "user", "label": "returns token", "kind": "reply" }
  ],
  "frames": [{ "kind": "opt", "label": "user found", "messages": ["m3"] }],
  "stories": [{ "id": "login", "title": "Log in", "beats": [
    { "title": "Credentials go in", "edge": "m1" },
    { "title": "The user is looked up", "edge": "m2", "caption": "One indexed read." },
    { "title": "A token comes back", "edge": "m3" }
  ] }]
}
```

Frames (`loop`, `alt`, `opt`, `par`) cover one unbroken run of message ids; they may nest. `notes` put a short text over participants after a message. In a sequence a beat's `edge` is a message id.

## Degraded mode

If you cannot run shell commands, write `diagram.json` and give the user the exact commands from steps 3, 4 and 5 with the real `<skill-dir>` path.

## Security

Labels, captions and ids are escaped in the page, never read as markup. Specs accept no URLs, CSS, SVG or HTML. The page makes no network requests, and its CSP blocks them. Keep secrets out of labels and captions.
````

Check the frontmatter: one `key: value` per line, no `: ` inside a plain value (the description's colons are absent; the hint's quotes are inside a plain value, which the registry parser allows because the value does not start with a quote). `python3 -m pytest -q tests/pytest/test_skill_frontmatter.py` must pass.

- [ ] **Step 4: `references/schema.md`**

Root table: after the `animate` row add

```markdown
| `autoplay` | boolean | `false` | start the story player when the page opens; ignored under `prefers-reduced-motion: reduce`; loop defaults on |
```

and change the `steps` row to

```markdown
| `stories` | array, up to 8 | built from the layout | named chapters of beats, played as one timeline (below) |
| `steps` | array, up to 25 | | the older walkthrough form; a spec with both `stories` and `steps` is an error |
```

`nodes[]` table: after the `tone` row add

```markdown
| `emoji` | exactly one emoji (a pictograph with its skin tone or joins, a flag, a keycap); drawn in the icon tile instead of the icon. Not on kinds drawn as bare shapes |
| `detail` | up to 400 characters of plain text, shown in the Explore panel |
```

`participants[]` line: `- participants[]: id, label (required), kind (service default, actor, database, queue, external), icon, emoji, detail.` (keep the existing backticks).

Add before `## steps[]`:

```markdown
## stories[]

Up to 8 stories `{ "id", "title", "beats" }`; `title` up to 40 characters (the chapter chip); story ids follow the id rule and are unique among stories (they may equal a node id). All stories hold at most 60 beats and play as one timeline in array order. A beat:

| field | notes |
|---|---|
| `title` | required, up to 48 characters |
| `caption` | up to 160 characters; the caption line reads `06 / 13 · CHAPTER · Title — caption` |
| `edge` | an edge id (an edge without one is `edge-<index>`), or a message id in a sequence. Exactly one of `edge`, `from` + `to`, `focus` |
| `from`, `to` | node ids (groups too in architecture; participants in a sequence). The one edge from `from` to `to` plays forward; if none runs that way, the one edge the other way plays backwards (the dot travels `to` → `from`), for replies. A two-headed edge plays forward either way. No edge, or more than one, is an error naming both ends and asking for `edge` |
| `focus` | node, group or participant ids; the camera fits and lights them, no dot |

A hop beat glides the camera to both ends (600 ms), runs a dot along the edge (1200 ms) and holds for 2.5 s plus 40 ms per caption character, up to 6 s; every duration divides by the speed (0.5× to 2×). Everything outside the beat dims. With no `stories` the build makes one beat per layout layer (per message in a sequence; see steps below) in one chapter titled `Walkthrough`.
```

Change the `## steps[]` heading to `## steps[] (the older form)` and add as its first sentence: `Prefer stories. A spec with both is an error (use stories; steps is the older form). Each step becomes one beat of a Walkthrough chapter; its note (up to 200 characters) is the beat's caption.`

Limits table: add the rows

```markdown
| stories / beats in all | 8 / 60 |
| story title / beat title / caption | 40 / 48 / 160 characters |
| detail | 400 characters |
```

Output paragraph (the last one) becomes:

```markdown
In the page: wheel or pinch to zoom, drag to pan, `0`, the Fit button or double-click to fit, `+` and `-` to zoom, arrow keys to pan. `F` or the Full screen button goes full screen (where the browser refuses, as inside a sandboxed iframe, the page fills its window instead); `Esc` leaves. Play story (`P`): Space plays and pauses, ←/→ step the beats, Home/End jump to the first and last, chapter chips and the scrubber jump, the speed button cycles 0.5× to 2×, Loop restarts the timeline; a click, drag or wheel on the canvas pauses. Explore (`E`): hover for a tooltip, click a node or edge for the side panel (what it sends and receives, the beats that use an edge), shift-click a second node for the shortest route, `/` for Find. `A` toggles edge-flow animation. The toolbar exports SVG or PNG and cycles the colour mode (auto, light, dark). `Esc` closes the panel, then leaves full screen, then leaves Play, then clears Find, then clears the trace.
```

- [ ] **Step 5: `references/kinds.md` and `README.md`**

`kinds.md`: after the first paragraph add

```markdown
## Colour families

Each kind belongs to one family; the family's hue (a theme token, `--k-<family>`) tints the card, its border, the icon tile, the small-caps kind label, the node's outgoing edges and its legend swatch. `tone` overrides only the border and icon. Bare shapes (flow `start`, `end`; state `start`, `end`) keep the neutral card.

| family | kinds | reads as |
|---|---|---|
| `person` | `user`; sequence `actor` | amber: people |
| `service` | `service`, `client`, `function`, `gateway`, `cache`, `other`; flow `step`, `io`, `subprocess`, `wait` | cyan: things that run |
| `data` | `database`, `storage` | violet: things that keep |
| `queue` | `queue` | teal: things that carry |
| `external` | `external` | grey: things you do not run |
| `decision` | flow `decision`; state `state`, `choice` | indigo: branches and states |

An `emoji` replaces the icon in the tile and keeps the family tint.
```

`README.md`: the "A page worth opening" bullet becomes `- **A page worth opening**: a story player (named chapters of beats, a travelling dot along each hop, a transport bar with speed and loop), an Explore panel (what a node sends and receives, the shortest route between two nodes, Find), kind-coloured cards with emoji tiles, lanes and a legend, light and dark, full screen, SVG and PNG export.` The key table becomes:

```markdown
| Key | Does |
|---|---|
| `P` / `E` | Play story / Explore |
| Space | play or pause the story |
| ←/→, Page Up/Down, Home/End | step the beats; first and last beat |
| `F` | full screen (`Esc` leaves; a sandboxed page fills its window instead) |
| `0`, double-click | fit the diagram |
| `+` / `-`, wheel, pinch | zoom |
| arrows (Explore), drag | pan |
| hover, click, shift-click | tooltip; the side panel; the shortest route; `Esc` closes the panel |
| `/` | Find a node |
| `A` | toggle edge-flow animation (off under reduced motion) |
```

The paragraph after it becomes: `Beats come from the spec's stories, or, with none, from the layout (one per layer, one per message in a sequence). The camera never zooms past twice the fit. Reduced-motion settings turn off the travelling dot, camera glides and autoplay.`

- [ ] **Step 5b: the four hand-written echoes of the old one-liner**

Four pages describe make-diagram in prose with "a step-by-step presentation mode"; they are hand-written (no generator), so edit each in place (`python3 -m pytest -q` pins counts, not this text):

- `plugins/portable-artifacts/README.md:12` — the cell `… zoom, hover tracing, a step-by-step presentation mode and export. …` becomes `… zoom, hover tracing, a story player (named chapters of beats with a travelling dot), an Explore panel, full screen and export. …`.
- `docs/catalog.html:213` — in the `<div class="dc">` text, `Zoom and pan, hover tracing, a step-by-step presentation mode and PNG/SVG export.` becomes `Zoom and pan, hover tracing, a story player with chapters and beats, an Explore panel, full screen and PNG/SVG export.`; in the same row's `data-search` attribute (line 211) append ` story player explore full screen` before the closing quote.
- `docs/skills-catalog.md:170` — `zoom and pan, hover tracing, a step-by-step presentation mode and PNG/SVG export.` becomes `zoom and pan, hover tracing, a story player with chapters and beats, an Explore panel, full screen and PNG/SVG export.`
- `docs/features/portable-artifacts.html:73` — `with zoom, hover tracing and a step-by-step presentation mode.` becomes `with zoom, hover tracing, a story player that follows a request hop by hop, an Explore panel and full screen.`

Then `grep -rl "step-by-step presentation mode" /Users/abhijitbansal/projects/claude-skills/plugins /Users/abhijitbansal/projects/claude-skills/docs/catalog.html /Users/abhijitbansal/projects/claude-skills/docs/skills-catalog.md /Users/abhijitbansal/projects/claude-skills/docs/features` — expected: no output (the older plan and spec under `docs/superpowers/` keep their history and are not edited).

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/docs.test.mjs` — expected: pass. Then `npm test` — green. Then `cd /Users/abhijitbansal/projects/claude-skills && python3 -m pytest -q` — green (the frontmatter is single-line `key: value`; the registry parser reads the description).

- [ ] **Step 7: Commit**

Message: `docs(make-diagram): stories, emoji, detail and full screen in the skill, schema, kinds and README` — the orchestrator commits (Part D); do not run git commit.

---

### Task 6: eval — a story prompt and an emoji prompt; the run; the pin decision

**Files:**
- Modify: `plugins/portable-artifacts/eval/prompts/diagram.json`
- Modify: `plugins/portable-artifacts/eval/test/lib.test.mjs:190-202`
- Create: `plugins/portable-artifacts/eval/results/summary-diagram-stories-2026-10-14.md`
- Modify (only if the gate fails): `plugins/portable-artifacts/skills/make-diagram/SKILL.md` frontmatter

**Interfaces:**
- Consumes: the eval harness (`eval/run-eval.mjs`, `eval/lib.mjs`: `SKILLS.diagram`, `prepareWorkdir`, `scoreRun`), SKILL.md from Task 5.
- Produces: prompt ids `order-story`, `emoji-map`; the summary file; the pin decision (spec §4: keep `model: haiku` / `effort: low` only at 10/10 valid builds with median validate runs ≤ 2).

- [ ] **Step 1: Write the failing test**

In `eval/test/lib.test.mjs` replace the test "diagram prompts: two per type and one edit prompt whose seed exists":

```js
test('diagram prompts: two per type, a story prompt, an emoji prompt, and one edit prompt whose seed exists', () => {
  const prompts = readJson('prompts', 'diagram.json');
  assert.equal(prompts.length, 10);
  assert.equal(new Set(prompts.map((p) => p.id)).size, 10);
  const seeded = prompts.filter((p) => p.seed);
  assert.deepEqual(seeded.map((p) => p.seed), ['seeds/diagram.json']);
  const seed = readJson('fixtures', seeded[0].seed);
  assert.equal(seed.type, 'architecture');
  const typeOf = (p) => (p.seed ? seed.type : ['architecture', 'flowchart', 'sequence', 'state'].find((t) => new RegExp(t, 'i').test(p.prompt)));
  const counts = {};
  for (const p of prompts) counts[typeOf(p)] = (counts[typeOf(p)] ?? 0) + 1;
  assert.deepEqual(counts, { architecture: 3, flowchart: 2, sequence: 3, state: 2 });
  const story = prompts.find((p) => p.id === 'order-story');
  assert.match(story.prompt, /story/i);
  assert.match(story.prompt, /caption/i);
  const emoji = prompts.find((p) => p.id === 'emoji-map');
  assert.match(emoji.prompt, /emoji/i);
  assert.match(emoji.prompt, /detail/i);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node --test "eval/test/*.test.mjs"`
Expected: FAIL at `prompts.length` (8).

- [ ] **Step 3: The prompts**

Append to the array in `eval/prompts/diagram.json` (after `edit-existing`):

```json
  { "id": "order-story", "prompt": "Draw an architecture diagram of placing an order: a Shopper (user) uses a Mobile app (client) that posts to an API gateway, which forwards to an Orders service; Orders writes to a Postgres Orders DB and publishes order.placed on an Event bus (queue) that a Warehouse system (external) consumes. Add a story titled 'Place an order' whose beats follow the request hop by hop from the shopper to the database, each beat with a one-sentence caption, and a second short story for the event reaching the warehouse." },
  { "id": "emoji-map", "prompt": "Draw a sequence diagram of a password reset: the User asks the Web app to reset, the app asks the Auth service for a token, Auth stores it in the Tokens DB and sends an email through an external Mail provider, which replies with a delivery receipt. Give every participant one emoji and a one-sentence detail saying what it owns, and add a story that plays the messages in order." }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node --test "eval/test/*.test.mjs"` — expected: green.

- [ ] **Step 5: The run (orchestrator only)**

The executor stops here and reports "prompts ready; the run is the orchestrator's". The orchestrator, after confirming the spend with the user (ten `claude -p` Haiku sessions, up to 900 s each), runs exactly:

`cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node eval/run-eval.mjs --skill diagram --host claude --model haiku --timeout 900`

The harness prints `▶ <id>` per prompt and writes `eval/results/<stamp>/claude-diagram/{results.json,summary.md,<id>/…}`. Then copy the folder for the record (it is gitignored; only the summary below is committed): `cp -R /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/eval/results/<stamp> /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/eval/results/diagram-stories-haiku-2026-10-14`.

- [ ] **Step 6: The summary**

Create `eval/results/summary-diagram-stories-2026-10-14.md` from the run's `summary.md` and `results.json`. Every value in angle brackets below is a **measured** cell copied from those files; none may stay in the committed file:

```markdown
# make-diagram eval — stories and emoji — 2026-10-14

10 prompts: the 8 from 2026-10-12 (two per type; `edit-existing` edits `seeds/diagram.json`) plus `order-story` (an architecture diagram with two stories and captions) and `emoji-map` (a sequence diagram with an emoji and a detail per participant, and a story). SKILL.md now teaches `stories`, `emoji` and `detail` and no longer teaches `steps`.

Measured with `node eval/run-eval.mjs --skill diagram --host claude --model haiku --timeout 900` from `plugins/portable-artifacts`; raw results in `eval/results/diagram-stories-haiku-2026-10-14/claude-diagram/` (gitignored, kept on the machine that ran it).

| Host / model | Valid builds | Median validate runs | Median seconds | Results |
|---|---|---|---|---|
| claude / haiku | **<valid>/10** | <median runs> | <median seconds> | `diagram-stories-haiku-2026-10-14/` |

## Gate

- Keep `model: haiku` / `effort: low` only at 10/10 valid builds with median validate runs ≤ 2 (spec §4): **<pass | fail>** (<valid>/10, <median runs>). <"The pin stays." | "The pin is lifted: SKILL.md no longer names a model or effort.">
- `order-story`: <did the spec carry `stories`; how many chapters and beats; which validate errors came back first, if any (quote the message)>.
- `emoji-map`: <did every participant carry one `emoji` and a `detail`; did `stories` name messages by `edge` or by `from`/`to`; first validate errors, if any>.
- The other eight against 2026-10-12 (8/8, median 1): <same | what changed>.

## Failures

<one line per failed or slow case: id, what the host wrote, the validate message; or "none">
```

- [ ] **Step 7: The pin**

If the gate failed, remove the two lines `model: haiku` and `effort: low` from `SKILL.md`'s frontmatter (nothing else), run `cd /Users/abhijitbansal/projects/claude-skills && python3 -m pytest -q` (frontmatter still parses) and say so in the summary. If it passed, SKILL.md is untouched.

- [ ] **Step 8: Commit**

Message: `test(make-diagram): eval over the story and emoji prompts` (body: the gate result in one line) — the orchestrator commits (Part D); do not run git commit.

---

### Task 7: the gallery sample plays a story

**Files:**
- Modify: `docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/diagram.json` (replace the whole file)
- Regenerate: `docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html`, `thumb.jpg`
- Modify: `docs/features/portable-artifacts.html:825,829` (the card text and the footnote)
- Scratch (gitignored, not committed): `.scratch/thumb-pipeline.mjs`

**Interfaces:**
- Consumes: `scripts/build.mjs`, `scripts/check.mjs` (make-diagram), `launchBrowser` from `scripts/lib/browser.mjs`.
- Produces: a sample that validates, builds under 400 KB, passes `check.mjs`, and a 1280×720 JPEG of its Play story view.

- [ ] **Step 1: The failing check**

Run: `cd /Users/abhijitbansal/projects/claude-skills && node plugins/portable-artifacts/skills/make-diagram/scripts/validate.mjs docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/diagram.json` — expected today: `valid` (the sample still uses `steps`). The RED signal for this task is `grep -c 'Write and check' docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html` printing `0` (and exiting 1): the built page carries no chapter of that name.

- [ ] **Step 2: `diagram.json`** (replace the whole file)

```json
{
  "title": "How a request becomes a finished page",
  "subtitle": "The portable-artifacts pipeline, from one request to one offline HTML page",
  "type": "architecture",
  "theme": "ink",
  "direction": "down",
  "animate": false,
  "groups": [
    { "id": "buildtime", "label": "Build-time pieces" }
  ],
  "nodes": [
    { "id": "request", "label": "Person's request", "kind": "user", "emoji": "🙋", "detail": "One sentence in chat: what to draw, for whom." },
    { "id": "agent", "label": "Claude Haiku agent", "kind": "service", "emoji": "🤖", "note": "Writes JSON only", "detail": "Reads SKILL.md, writes diagram.json, then runs validate, build and check in the same turn. Never writes coordinates, CSS, SVG or HTML." },
    { "id": "spec", "label": "JSON spec file", "kind": "other", "emoji": "📄", "note": "diagram.json" },
    { "id": "validate", "label": "validate.mjs", "kind": "service", "group": "buildtime", "emoji": "✅", "note": "Names the exact fix", "detail": "Schema and limits first, then a full layout and a geometry lint, so a spec that validates is buildable. Every error is a JSON path, the problem and the fix." },
    { "id": "build", "label": "build.mjs", "kind": "service", "group": "buildtime", "emoji": "🏗️" },
    { "id": "elk", "label": "ELK layout engine", "kind": "service", "group": "buildtime", "emoji": "🧭", "note": "Runs locally, computes every position" },
    { "id": "dashboard", "label": "make-dashboard renderer", "kind": "service", "group": "buildtime", "emoji": "📊", "note": "Draws chart cards" },
    { "id": "motion", "label": "make-motion renderer", "kind": "service", "group": "buildtime", "emoji": "🎬", "note": "Renders MP4 video" },
    { "id": "themes", "label": "Shared themes", "kind": "storage", "group": "buildtime", "emoji": "🎨", "note": "paper, blueprint, ink, editorial" },
    { "id": "page", "label": "Offline HTML page", "kind": "client", "tone": "good", "emoji": "🌐", "note": "No network requests", "detail": "Inline CSS, fonts and icons behind a strict CSP. The same spec and versions give the same bytes." }
  ],
  "edges": [
    { "from": "request", "to": "agent", "label": "asks for a diagram" },
    { "from": "agent", "to": "spec", "label": "writes one file" },
    { "from": "spec", "to": "validate", "label": "is checked" },
    { "from": "validate", "to": "agent", "label": "returns the exact fix", "style": "dashed" },
    { "from": "validate", "to": "build", "label": "passes the spec on" },
    { "from": "build", "to": "elk", "label": "asks for layout" },
    { "from": "build", "to": "dashboard", "label": "renders chart cards", "style": "dashed" },
    { "from": "build", "to": "motion", "label": "renders video scenes", "style": "dashed" },
    { "from": "themes", "to": "build", "label": "supplies colours" },
    { "from": "build", "to": "page", "label": "writes one HTML file" }
  ],
  "stories": [
    {
      "id": "write",
      "title": "Write and check",
      "beats": [
        { "title": "Someone asks for a diagram", "from": "request", "to": "agent", "caption": "One sentence is enough; the agent plans the spec from it." },
        { "title": "The agent writes one JSON file", "from": "agent", "to": "spec", "caption": "A title, a type, nodes and edges. No coordinates, CSS, SVG or HTML." },
        { "title": "Validate reads the spec", "from": "spec", "to": "validate", "caption": "Schema and limits, then a full layout and a geometry lint." },
        { "title": "Validate names the exact fix", "from": "validate", "to": "agent", "caption": "A JSON path, the problem and the fix; the agent edits one field and runs it again." }
      ]
    },
    {
      "id": "build",
      "title": "Build the page",
      "beats": [
        { "title": "The spec passes to build", "from": "validate", "to": "build" },
        { "title": "ELK lays everything out", "from": "build", "to": "elk", "caption": "Every position comes from the layout engine, on this machine." },
        { "title": "Themes supply the colours", "from": "themes", "to": "build", "caption": "paper, blueprint, ink or editorial: one spec, four looks." },
        { "title": "Charts and video have their own renderers", "focus": ["dashboard", "motion"], "caption": "An explainer asks for them; a plain diagram never does." },
        { "title": "One offline HTML page", "from": "build", "to": "page", "caption": "Opens in any browser with no network; the CSP blocks requests." }
      ]
    }
  ]
}
```

(`steps` is gone: a spec with both is an error. `"theme": "ink"` keeps the card's "ink theme" true without a build flag. `agent` and `elk` drop their icons: the emoji takes the tile.)

- [ ] **Step 3: Validate, build, check**

Run, from `/Users/abhijitbansal/projects/claude-skills`:

`node plugins/portable-artifacts/skills/make-diagram/scripts/validate.mjs docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/diagram.json` — expected: `valid`. If a label no longer fits its card (the emoji tile took room), shorten the label the message names, not the limit.

`node plugins/portable-artifacts/skills/make-diagram/scripts/build.mjs docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/diagram.json --out docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html` — expected: `wrote …/index.html`.

`node plugins/portable-artifacts/skills/make-diagram/scripts/check.mjs docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html` — expected: `check: ok (2 viewports, 9 beats)`.

`grep -c 'Write and check' docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html` — expected: `1` (the chapter title in the data block). `wc -c docs/features/showcase/portable-artifacts/gallery/pipeline-diagram/index.html` — under 409600.

- [ ] **Step 4: The thumbnail**

Write `.scratch/thumb-pipeline.mjs` (the folder is gitignored; create it if absent):

```js
// A 1280x720 JPEG of the pipeline sample one beat into its story, in dark mode (the glow look).
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '/Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram/scripts/lib/browser.mjs';

const DIR = '/Users/abhijitbansal/projects/claude-skills/docs/features/showcase/portable-artifacts/gallery/pipeline-diagram';
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark', deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(pathToFileURL(`${DIR}/index.html`).href);
await page.waitForFunction(() => window.paReady === true);
await page.click('[data-pa-mode="play"]');
await page.keyboard.press('ArrowRight'); // beat 2: the agent writes the spec
await page.waitForTimeout(900); // the 600 ms glide has ended
await page.screenshot({ path: `${DIR}/thumb.jpg`, type: 'jpeg', quality: 82 });
await browser.close();
```

Run: `cd /Users/abhijitbansal/projects/claude-skills && node .scratch/thumb-pipeline.mjs`. Open `thumb.jpg` (Read it) and look: the dark canvas, the transport bar with `Beat 2 / 9`, the lit `agent → spec` edge and dimmed rest. If the panel or legend covers the lit edge, press `Escape` and retake at beat 1; say which beat the picture shows in the task report.

- [ ] **Step 5: The gallery page**

`docs/features/portable-artifacts.html`: line 825 becomes

```html
          <p>The pipeline from request to page, laid out by ELK. Press Play story to follow a request hop by hop with a travelling dot and captions, or Explore to click a node for what it sends and receives.</p>
```

Line 829 (the footnote) gains a sentence at its end, inside the `<p>`: ` The diagram's stories, emoji and details were written by hand for the stories release (2026-10-14); its nodes and edges are the Haiku original.`

- [ ] **Step 6: Run the repo tests**

Run: `cd /Users/abhijitbansal/projects/claude-skills && python3 -m pytest -q` — expected: green (no test counts gallery files; this confirms nothing else broke). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green.

- [ ] **Step 7: Commit**

Message: `docs(portable-artifacts): pipeline diagram sample plays a story` (body: `Rebuilt with stories, emoji and details; theme ink in the spec; thumbnail retaken in dark mode at beat 2.`) — the orchestrator commits (Part D); `.scratch/` is not committed. Do not run git commit.

---

## Phase 4 close-out

After Task 7, with everything on disk:

- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green.
- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green, with the recap golden regenerated once in Task 4.
- `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — green (nothing in `shared/` changed); `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node bin/sync-shared.mjs --check` — in sync.
- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts && node --test "eval/test/*.test.mjs"` — green.
- `cd /Users/abhijitbansal/projects/claude-skills && python3 -m pytest -q` — green.
- `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js plugins/portable-artifacts/skills/make-diagram/template/viewer.html plugins/portable-artifacts/skills/make-explainer/template/diagram.js plugins/portable-artifacts/skills/make-explainer/template/diagram.css` — every file under 400; the built story example and the gallery sample under 400 KB.
- Spec coverage this phase delivers: §2 Full screen (the button or `F` calls `requestFullscreen` on the viewer root; refusal or absence switches to the fixed window-filling layer; Esc leaves) and the keyboard line's `F`; §2 Inside make-explainer (the overlay mounts the full viewer: Play, Explore, panel, full screen; Back / Next replaced by the viewer's transport); §1's last paragraph (SKILL.md teaches `stories`, `emoji`, `detail` and no longer `steps`; schema.md documents both, `steps` marked older); §4 Tests (make-explainer: a page embedding a story diagram builds, `check.mjs` passes, the overlay plays a beat; the eval over 8 + 2 prompts with the pin rule and the summary file); §5 phase 4 (the gallery sample rebuilt with stories and emoji, thumbnail refreshed). The four deferred phase-4 findings and the Low items are handled per the table above.
- Left for the branch's end (the orchestrator, per the global manual-test rule): the manual-test checklist. Items this phase adds to it: real full screen in a real browser window (headless cannot show it; check Chrome, Safari and Firefox, and that Esc returns the page), the fallback inside the deployed site's sandboxed iframe, emoji rendering per OS in the tile and the panel, the gallery card and thumbnail on the deployed page.
- Then a fresh reviewer reads the phase diff and reports every finding (the report-everything sentence from `code-review.md` goes in its prompt); CRITICAL and HIGH findings are fixed before the orchestrator commits and pushes.

## Commit parts

Consecutive groups; each leaves every suite green and is one coherent commit. Four parts rather than three: Part C depends on Part A (the focus fix the overlay's End/Home test needs) and Part B (the full-screen controller it wires), and a fix commit reads better apart from the feature it enables.

| part | tasks | commit |
|---|---|---|
| A | Tasks 1, 2 | `fix(make-diagram): a resize keeps the beat, the hash writes once per beat, chip rows scroll alone, focus survives a disabled button` (body: the Low fixes from Task 2: emoji structure cap and escapes; focus names nodes, groups and participants only; a two-headed edge plays forward; the "required with" error names its fix; story and beat unknown-property messages pinned) |
| B | Task 3 | `feat(make-diagram): full screen on F with a window-filling fallback; 0 fits` |
| C | Task 4 | `feat(make-explainer): the diagram overlay runs the full viewer (recap golden regenerated)` |
| D | Tasks 5, 6, 7 | `docs(make-diagram): stories, emoji, detail and full screen in the skill, schema, kinds, README, eval and the gallery sample` (body: the eval gate result in one line, the summary path, and the sample's rebuild) |

If the orchestrator prefers one commit per task, the per-task messages above apply as written; Task 6's commit waits for the eval run, so Tasks 5 and 7 may land before it.

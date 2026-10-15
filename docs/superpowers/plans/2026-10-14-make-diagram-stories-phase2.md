# make-diagram stories — Phase 2 Implementation Plan (Explore)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Explore mode of the story viewer: a click opens a side panel describing a node (emoji or icon, kind, label, note, detail, "Sends to", "Receives from") or an edge (label, style, both ends, the beats that use it); a shift-click traces the shortest route between two nodes; hover shows a tooltip; a Find box filters nodes by label; with nothing selected the panel shows count chips and a hint. Two phase-1 review findings tagged for this phase are fixed first (Space on a focused transport control, the scrubber's arrow keys while playing).

**Architecture:** Everything Explore needs is already in the page data (`info`, `directed`, `adjacency`, `edges`, `beats`). `data.mjs` gains group entries in `info` (a route and the lists can name a group an edge ends at) and keys edge info by id. A new pure module `template/route.js` holds the BFS (`PADiagram.route`), unit-tested in Node by loading it with a bare `window`. `template/explore.js` (the trace) grows a selection model, route painting, a Find filter and the counts; a new `template/panel.js` paints the panel, the tooltip and the Find results with `textContent`; `template/viewer.js` wires shift-click, `/`, the panel's Escape and focus return; `template/viewer.html` adds the panel, tooltip, Find box and results row; `scripts/lib/css.mjs` adds plain `pa-selected` / `pa-route` state rules (phase 3 styles the look). `make-explainer`'s overlay passes no panel and keeps working: every new mount option is optional.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, Playwright 1.64 (dev; browser tests skip without a browser). Browser code is ES5-style IIFEs inlined into the page. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-make-diagram-stories-design.md` §2 Explore (and the keyboard line of §2 Play story), §4, phase 2 of §5. Master plan: `docs/superpowers/plans/2026-10-14-make-diagram-stories.md` (file map, contracts, decisions 1–15, "Deferred review findings"). Phase 1 plan (format and conventions): `docs/superpowers/plans/2026-10-14-make-diagram-stories-phase1.md`.

## Global Constraints

- Branch `feat/diagram-stories`. Implementers do **not** run `git commit`/`git push`; each task ends with the commit message and the orchestrator commits.
- Plain ESM Node (Node 20); no new npm dependencies. Page code: no inline event handlers, no `eval`/`new Function`, no external requests; CSP stays `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. (Test code may use `new Function` to load a template module; the ban is on page code.)
- Every file under `template/` stays under 400 lines; every other file under 800 (`test/runtime.test.mjs` pins the template budget). Expected sizes after this phase: `route.js` ≈ 56, `explore.js` ≈ 176, `panel.js` ≈ 203, `viewer.js` ≈ 309, `viewer.html` ≈ 154, `toolbar.js` ≈ 192 (measured on a scratch build of this plan, which also ran the whole make-diagram suite green: 489 tests).
- `scripts/lib/api.mjs` exports exactly `buildDiagram`, `validateSpec`, `viewerRuntime` (pinned by `test/api.test.mjs`); no change to it this phase.
- `viewerData` keys do not change (`test/api.test.mjs:221`, `test/build.test.mjs:150` stay as they are); `info` gains group entries (additive) and keys edges by id.
- Every string from the spec reaches the panel, tooltip, rows and chips through `textContent`, never markup.
- Every control has an accessible name; a panel close returns focus to the node; colour is never the only signal (`pa-selected` and `pa-route` thicken the stroke, like `pa-hl`).
- The look stays plain: the new CSS in `viewer.html` and `css.mjs` is layout and one accent rule per state class. Phase 3 restyles.
- Every existing test stays green except where this phase changes behaviour; each such change is named in its task: the Play button loses `aria-pressed` (Task 1), `RUNTIME_FILES` grows (Tasks 3 and 4), `ctl.state()` replaces `pinned` with `selected` and `route` (Task 4), `test/build.test.mjs:141` hook list grows (Tasks 4 and 6).
- Verification commands (exact, bare, no pipes): `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test`; one file: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/<file>.test.mjs`; `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test`; `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`. This phase does not touch `plugins/portable-artifacts/shared/`, so `node bin/sync-shared.mjs` is not run.
- Guard proofs: each new browser assertion is shown failing against a deliberately broken page (phase 1's Step-10 style) before it is trusted; every doctoring edit is reverted and `npm test` rerun.

## Review Focus

Inputs §2 implies but no test would otherwise exercise, most likely to bite first. Each line names the task that pins it.

1. **A route or a list that passes through a group** (architecture `web ↔ vpc` is a two-headed edge onto a group; `directed` keys `vpc` while `info` had no group entry): the panel row names the group, selecting it fits the group's box, BFS walks through it. Pinned in Task 2 (`info` holds every id in `built.ids`), Task 3 (BFS through `g`), Task 4 (the `→ Private VPC` row selects the group) and Task 5 (hops through a group).
2. **A self edge and two edges between the same ends**: a self edge is never a hop and appears in both lists; `gateway ⇄ orders` gives two separate rows. Pinned in Task 3 (`loop` on `constructor`) and Task 4 (gateway's two "Receives from" rows).
3. **Ids named like `Object.prototype` members** in `info`, `directed`, the BFS visited map and the panel: a group named `constructor` at a two-headed edge end. Pinned in Task 2 (`PROTOTYPE_NAMED_SPECS` gains the spec; `ids.test.mjs` asserts `Object.hasOwn(data.info, 'constructor')`), Task 3 (BFS) and Task 4 (panel rows).
4. **A node with no edges and a pair with no route**: both lists say "nothing", no crash; shift-click says "No route between A and D."; against the arrows the route says "ignores arrow direction". Pinned in Tasks 4 and 5.
5. **Hostile and regex-like text** (`<b>&"x"`, `Cache [hot]`) in labels, notes, details, edge labels: reaches the panel, rows, tooltip and route list as text; Find matches `[h` literally (no `RegExp`). Pinned in Tasks 4 and 6.

## Drift from the master plan (the code wins; recorded here)

- **Runtime files.** The master plan names one new module (`panel.js`). The BFS gets its own DOM-free `route.js` so Node can unit-test it, and `explore.js` stays under 200 lines. `RUNTIME_FILES` becomes `['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'viewer.js']`.
- **Keyboard map.** The master plan's "Space play/pause (in Play mode; on a focused button the button wins)" narrows: on a focused **transport** control (anything inside the `caption` or `chapters` holders: the buttons, the chips) Space is play/pause and Enter activates the control; a button elsewhere (toolbar, tabs) keeps Space. This is the deferred phase-2 finding. In Play, any key but Space pauses even when a form field has focus (the scrubber, the Find box).
- **Trace API.** `pin`/`pinned` become `select`/`toggle`/`selected`; `ctl.state()` carries `selected` and `route` instead of `pinned` (nothing read `pinned`). The master's `PADiagram.trace` return list is superseded by Task 4's Interfaces block.
- **Mount options.** `PADiagram.mount` gains `panel`, `tip`, `find`, `found` (all optional). The master's hook list gains `[data-pa-panel-title]`, `[data-pa-panel-body]`, `[data-pa-empty]`, `[data-pa-found]`, rows `button.pa-row[data-pa-go="<id>"]`, `[data-pa-beat-go="<i>"]`, lists `[data-pa-sends]`, `[data-pa-receives]`, `[data-pa-ends]`, `[data-pa-used]`, `[data-pa-hops]`, and Find chips `button.pa-chip[data-pa-pick="<id>"]`.
- **Count-chips hook.** The master plan names `[data-pa-counts]`; the page uses `[data-pa-tally]`, because `data-pa-counts` contains `data-pa-count` and the panel sits before the caption in the document: `test/check.test.mjs` doctors a page by replacing the first `data-pa-count`, which would then hit the chips container and leave the caption whole.
- **Count chips** use the spec's kind names ("1 user · 1 client · … · 2 stories · 9 beats"), not the reference's "human/system" grouping; the stories chip appears only for an authored timeline (not for the step-derived Walkthrough).
- **Play button a11y.** `[data-pa-play]` keeps its Play/Pause label and drops `aria-pressed` (a control that announces its state in its label does not also toggle `aria-pressed`). `stage.pa-playing` and `ctl.state().playing` stay the programmatic signal.

## Deferred review findings handled here

| finding (master plan, "Deferred review findings") | handling |
|---|---|
| `data.directed` can key a group id while `data.info` has no group entries | **Fixed, Task 2**: `info` gains `{ label, kind: 'group' }` per group; Tasks 3–5 route and list through groups. |
| Space on a focused transport button activates the button; scrubber arrow keys move the beat while play continues | **Fixed, Task 1**: Space on a transport control is play/pause (keydown `preventDefault` stops the native activation); the scrubber's `input` handler pauses before it jumps. |
| Low: `data.mjs` `infoOf` pairs spec edges with geometry links by index | **Fixed, Task 2** (file touched): keyed through `linksOf(spec)`. |
| Low: scrubber has no `aria-valuetext`; the Play button toggles both label and `aria-pressed` | **Fixed, Task 1** (file touched): `aria-valuetext="Beat n of N"`; `aria-pressed` dropped from Play. |
| Low: `ids.test.mjs` prototype assertion cannot fail | **Fixed, Task 2** (file touched): replaced by `Object.hasOwn(data.info, 'constructor')` and a JSON round trip. |
| Low: each template module merges into an existing `window.PADiagram` instead of replacing it | **Not changed, by design**: the modules register factories on one shared namespace in bundle order; replacing it would drop the earlier ones. `route.js` and `panel.js` use the same idiom. |
| Low: `prevChapter` reads `chapters[c].start` without a guard | **Not touched**: `story.js` is not changed this phase; data from `beatsOf` always carries a chapter. Stays deferred. |
| Low: `loop` is on when `autoplay` is set even if a deep link or reduced motion suppressed autoplay | **Not changed**: spec §2 says loop defaults on when `autoplay` is true, unconditionally. Stays as is. |
| Low items in `emoji.mjs`, `stories.mjs`, step-note length, `stories.test.mjs` wording, the 5 s one-beat wait | **Not touched** this phase (files unchanged). Stay deferred. |

---

## File structure (this phase)

Paths are relative to `plugins/portable-artifacts/skills/make-diagram/`. **C** = create, **M** = modify.

| | file | responsibility |
|---|---|---|
| M | `template/viewer.js` | Task 1: Space on transport controls, pause on keys in fields. Task 4: panel, tooltip and selection wiring, Escape order, focus return, `select` on the controller. Task 5: shift-click route. Task 6: Find wiring and `/`. |
| M | `template/transport.js` | Task 1: scrubber pauses before jumping, `aria-valuetext`, Play button label only |
| M | `template/viewer.html` | Task 1: Play button loses `aria-pressed`. Task 4: `.body` row holding the stage and `aside[data-pa-panel]`, `[data-pa-tip]` inside the stage, plain CSS. Task 6: `input[data-pa-find]`, `[data-pa-found]`, the empty-state block with `[data-pa-tally]` and the hint |
| M | `scripts/lib/data.mjs` | Task 2: `info` holds groups; edges keyed through `linksOf` |
| C | `template/route.js` | Task 3: `PADiagram.route(data, from, to)` |
| M | `scripts/lib/runtime.mjs` | Task 3: `route.js` after `camera.js`. Task 4: `panel.js` after `explore.js` |
| M | `template/explore.js` | Task 4: selection, route painting, Find filter, `links`, `counts` |
| C | `template/panel.js` | Task 4: `PADiagram.panel`: panel views, tooltip, Find results, count chips |
| M | `template/toolbar.js` | Task 4: passes `panel` and `tip`; export strips `pa-selected`/`pa-route`. Task 6: passes `find` and `found` |
| M | `scripts/lib/css.mjs` | Task 4: `.pa-selected`, `.pa-route` state rules |
| C | `test/data.test.mjs`, `test/route.test.mjs`, `test/explore-browser.test.mjs` | tests |
| M | `test/story-browser.test.mjs`, `test/ids.test.mjs`, `test/helpers/prototype-ids.mjs`, `test/runtime.test.mjs`, `test/render.test.mjs`, `test/build.test.mjs` | behaviour changes and new hooks |

---

### Task 1: Space on the transport, the scrubber pauses, the Play button announces one way

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js:166-202` (`onKey`, plus two helpers at module scope)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/transport.js:78-82,90,106`
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.html:97` (the Play button)
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/story-browser.test.mjs`

**Interfaces:**
- Consumes: `PADiagram.story` (`pause`, `goTo`, `togglePlay`, `isPlaying`), the transport holders `options.caption` / `options.chapters` already passed to `mount`.
- Produces: in Play, Space on any element inside `options.caption` or `options.chapters` toggles play (the control does not activate); any key but Space / Tab / Shift / CapsLock pauses even when a form field has focus; `[data-pa-scrub]` carries `aria-valuetext="Beat n of N"` and pauses before it jumps; `[data-pa-play]` has no `aria-pressed` and reads `Play` / `Pause`.
- Behaviour the phase changes: two assertions in the test `Space plays and pauses, the Play button mirrors it…` read `aria-pressed` on `[data-pa-play]`; they become label and `aria-pressed === null` checks.

- [ ] **Step 1: Write the failing tests**

In `test/story-browser.test.mjs`, in the test `Space plays and pauses, the Play button mirrors it, speed cycles 1×, 1.5×, 2×, 0.5×, loop toggles`, replace the two `pressed(page, '[data-pa-play]')` assertions:

```js
  assert.equal(await playing(page), false);
  assert.equal(await page.getAttribute('[data-pa-play]', 'aria-pressed'), null, 'a button whose label says Play or Pause carries no aria-pressed');
  assert.equal(await page.textContent('[data-pa-play]'), 'Play');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  assert.equal(await page.textContent('[data-pa-play]'), 'Pause');
```

(the lines `assert.equal(await pressed(page, '[data-pa-play]'), 'false');` and `assert.equal(await pressed(page, '[data-pa-play]'), 'true');` go away; the rest of the test is unchanged).

Append after the test `a pointer on the canvas pauses: click, wheel and drag; the beat stays`:

```js
test('Space on a focused transport control is play/pause, not the control; Enter still activates it; a toolbar button keeps Space', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.focus('[data-pa-next]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on Next plays');
  assert.equal(await count(page), '1 / 9', 'and does not step');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.equal(await count(page), '1 / 9');
  await page.focus('[data-pa-play]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on Play toggles once, not twice');
  assert.equal(await page.textContent('[data-pa-play]'), 'Pause');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  await page.focus('[data-pa-beat="2"]');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true, 'Space on a beat chip plays');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Enter');
  assert.equal(await count(page), '3 / 9', 'Enter activates the chip');
  assert.equal(await playing(page), false, 'and, as any key but Space, pauses');
  await page.focus('[data-pa-mode="explore"]');
  await page.keyboard.press('Space');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'outside the transport the button wins: the Explore tab leaves Play');
  assert.deepEqual(problems, []);
  await context.close();
});

test('arrow keys on the scrubber move the beat and pause; the scrubber announces the beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-valuetext'), 'Beat 1 of 9');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  await page.focus('[data-pa-scrub]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '2 / 9', 'the arrow moved the beat');
  assert.equal(await playing(page), false, 'and paused');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-valuetext'), 'Beat 2 of 9');
  assert.deepEqual(problems, []);
  await context.close();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-browser.test.mjs`
Expected: `Space plays and pauses…` fails at `a button whose label says Play or Pause carries no aria-pressed` (actual `'false'`); `Space on a focused transport control…` fails at `Space on Next plays` (actual `false`: Space activated Next, so `count` is `2 / 9`); `arrow keys on the scrubber…` fails at `aria-valuetext` (actual `null`). The other tests pass.

- [ ] **Step 3: Implement**

`template/viewer.js` — add two helpers after `elementsOf` (module scope, before `function mount`):

```js
  var within = function (el, holder) { return !!(holder && el && holder.contains(el)); };
  var isField = function (el) { return !!(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)); };
```

In `onKey`, replace the opening lines and the Space line. Before:

```js
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var k = e.key;
      var inPlay = story.isPresenting();
      if (inPlay && !KEEPS_PLAYING[k]) story.pause(); // Space is the play/pause key itself; Tab and lone modifiers act on nothing
      var handled = true;
```

After:

```js
      var t = e.target;
      var k = e.key;
      var inPlay = story.isPresenting();
      if (inPlay && !KEEPS_PLAYING[k]) story.pause(); // Space is the play/pause key itself; Tab and lone modifiers act on nothing; a form field pauses too
      if (isField(t)) return;
      var inTransport = within(t, options.caption) || within(t, options.chapters);
      var handled = true;
```

Before:

```js
      } else if (inPlay && k === ' ' && !(t && t.tagName === 'BUTTON')) story.togglePlay();
```

After:

```js
      } else if (inPlay && k === ' ' && (!(t && t.tagName === 'BUTTON') || inTransport)) story.togglePlay();
```

Update the comment above `KEEPS_PLAYING`:

```js
    // Space plays and pauses (on the canvas and on every transport control; a
    // button elsewhere keeps Space for itself); arrows, PageUp/PageDown, Home
    // and End move between beats; P enters Play, E leaves it; F fits; A toggles
    // the edge animation; Escape leaves Play, else clears the trace. In Play any
    // key but Space pauses, in a form field too.
```

`handled` stays true for the Space branch, so `e.preventDefault()` runs on the keydown: Chromium and Firefox skip the button's Space activation when its keydown was default-prevented (the button never enters its active state, so the keyup fires no click). If the browser test shows a double toggle on the Play button, add on `(options.keys || stage)` a `keyup` listener that calls `e.preventDefault()` when `e.key === ' '` and `within(e.target, options.caption) || within(e.target, options.chapters)`; the plan expects this not to be needed.

`template/transport.js` — the Play button paints its label only; the scrubber announces and pauses:

```js
      var play = part('data-pa-play');
      if (play) play.textContent = story.isPlaying() ? 'Pause' : 'Play';
```

```js
      if (scrub) {
        if (scrub.value !== String(i)) scrub.value = String(i);
        scrub.setAttribute('aria-valuetext', 'Beat ' + (i + 1) + ' of ' + n);
      }
```

```js
    // A scrub, by pointer or arrow key, lands on a beat and holds there: it pauses first.
    if (scrub) scrub.addEventListener('input', function () { story.pause(); story.goTo(Number(scrub.value)); });
```

Update the header comment's `data-pa-play (aria-pressed; Play / Pause)` to `data-pa-play (its label reads Play or Pause)` and `data-pa-scrub (an <input type="range">)` to `data-pa-scrub (an <input type="range"> with aria-valuetext "Beat n of N")`.

`template/viewer.html:97` — the Play button loses `aria-pressed="false"`:

```html
<button type="button" class="tool" data-pa-play title="Play or pause (Space)">Play</button>
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/story-browser.test.mjs` — expected: all pass. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green (`check.test.mjs`'s doctored `function next()` string is in `story.js`, untouched). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (its overlay has no transport buttons; its `ArrowRight` steps are unchanged).

- [ ] **Step 5: Guard proofs** (revert each edit before moving on)

1. In `viewer.js`, change `|| inTransport` back to nothing (`!(t && t.tagName === 'BUTTON')` alone); run `node --test --test-name-pattern="focused transport control" test/story-browser.test.mjs` — expected: FAIL at `Space on Next plays`. Revert.
2. In `transport.js`, delete `story.pause();` from the scrub handler; run `--test-name-pattern="arrow keys on the scrubber"` — expected: FAIL at `and paused`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 6: Commit**

Message: `fix(make-diagram): Space on the transport is play/pause; the scrubber pauses and announces its beat` — the orchestrator commits; do not run git commit.

---

### Task 2: `info` names groups and keys edges by id

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/data.mjs:53-74,115`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/data.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/ids.test.mjs:12-18`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/helpers/prototype-ids.mjs` (one more spec)

**Interfaces:**
- Consumes: `linksOf(spec)` from `scripts/lib/stories.mjs` (`[{ id, from, to, both }]` in spec order; ids as `edgeIds` assigns them).
- Produces: `data.info[groupId] = { label, kind: 'group' }` for every group (graph types); node, participant and edge entries unchanged in shape. Later tasks read `info[id].kind === 'group'` to leave groups out of Find and the counts.
- Behaviour the phase changes: none visible; `test/api.test.mjs` and `test/build.test.mjs` key lists are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `test/data.test.mjs`:

```js
// viewerData's per-id `info`: what the panel, the Find box and the count chips read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { viewerData } from '../scripts/lib/data.mjs';

const example = (name) => JSON.parse(fs.readFileSync(new URL(`../references/examples/${name}.diagram.json`, import.meta.url), 'utf8'));

test('info names every id a step can name: groups as kind "group", so a route or a row can name a group an edge ends at', async () => {
  const { data, ids } = await buildDiagram(example('architecture'));
  for (const id of ids) assert.ok(Object.hasOwn(data.info, id), `info for ${id}`);
  assert.deepEqual(data.info.vpc, { label: 'Private VPC', kind: 'group' });
  assert.deepEqual(data.info.aws, { label: 'AWS us-east-1', kind: 'group' });
  assert.deepEqual(data.directed.vpc, ['edge-3'], 'the two-headed edge leaves the group too');
  assert.deepEqual(data.info['edge-3'], { style: 'dashed' }, 'an unlabelled edge has a style only');
  assert.deepEqual(data.info.web, { label: 'Web app', kind: 'client' });
});

test('a sequence has no groups: info is participants and messages', async () => {
  const { data } = await buildDiagram(example('sequence'));
  assert.ok(Object.values(data.info).every((e) => e.kind !== 'group'));
  assert.equal(data.info.m1.style, 'sync');
});

test('info keys edges by their ids, whatever order the geometry lists them in', async () => {
  const spec = example('story');
  const built = await buildDiagram(spec);
  const reversed = { ...built.geometry, edges: [...built.geometry.edges].reverse() };
  const data = viewerData(spec, { geometry: reversed, steps: built.steps, ids: built.ids, width: built.width, height: built.height, beats: built.data.beats, chapters: built.data.chapters });
  assert.deepEqual(data.info.place, { label: 'POST /orders', style: 'solid' });
  assert.deepEqual(data.info['edge-6'], { label: '201 Created', style: 'dashed' });
  assert.deepEqual(data.info['edge-4'], { label: 'order.placed', style: 'async' });
});
```

`test/helpers/prototype-ids.mjs` — add an entry (Review Focus 3; the edge `a → b` keeps the browser suite's "with two connected nodes, nothing dims" hover check true):

```js
  'a group named constructor at a two-headed edge end': {
    title: 'GE', type: 'architecture',
    groups: [{ id: 'constructor', label: 'Group' }],
    nodes: [{ id: 'a', label: 'A', group: 'constructor' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'constructor', both: true }],
  },
```

`test/ids.test.mjs` — replace the loop body's prototype assertion (the `for (const map of […]) assert.equal(Object.getPrototypeOf(map), Object.prototype, …)` line, which could never fail) with:

```js
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data, 'plain JSON-shaped data: nothing lost on the way into the page');
    assert.ok(Object.hasOwn(data.info, 'constructor'), 'info has an own entry for the id named constructor');
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/data.test.mjs test/ids.test.mjs`
Expected: `data.test.mjs` first test fails with `AssertionError … info for aws`; the third fails on `data.info.place` (the reversed geometry pairs `edge-6`'s label with `place`); `ids.test.mjs` fails for `a group named constructor` and the new `a group named constructor at a two-headed edge end` at `info has an own entry for the id named constructor`. The sequence test passes already.

- [ ] **Step 3: Implement**

`scripts/lib/data.mjs` — import `linksOf` and rewrite `infoOf`:

```js
import { linksOf } from './stories.mjs';
```

```js
// id -> what the panel, the chips and the legend read: label and kind (plus
// emoji, note and detail when set) for a node or participant; label and kind
// "group" for a group (an edge may end at one); style and label (when set) for
// an edge or message. Edges are keyed through linksOf, so an unnamed edge gets
// the same `edge-<i>` id the layout draws it with, whatever order the geometry lists.
function infoOf(spec) {
  const info = new Map();
  const sequence = spec.type === 'sequence';
  for (const n of sequence ? spec.participants : spec.nodes) {
    const entry = { label: oneLine(n.label), kind: n.kind ?? KINDS[spec.type].default };
    if (n.emoji !== undefined) entry.emoji = n.emoji;
    if (n.note !== undefined) entry.note = oneLine(n.note);
    if (n.detail !== undefined) entry.detail = String(n.detail).trim();
    info.set(n.id, entry);
  }
  for (const g of sequence ? [] : spec.groups ?? []) info.set(g.id, { label: oneLine(g.label), kind: 'group' });
  const links = linksOf(spec);
  (sequence ? spec.messages ?? [] : spec.edges ?? []).forEach((e, i) => {
    const entry = { style: sequence ? e.kind ?? 'sync' : e.style ?? 'solid' };
    if (e.label !== undefined) entry.label = oneLine(e.label);
    info.set(links[i].id, entry);
  });
  return Object.fromEntries(info);
}
```

In `viewerData`, the call becomes `info: infoOf(spec),`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/data.test.mjs test/ids.test.mjs` — expected: pass. Then `npm test` — green (the browser suite's prototype loop builds the new spec too). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green, recap golden included: its diagram is a flow with no groups, so its data block is byte-identical (verified: the make-explainer suite ran green, 593 tests, against a scratch build of this whole phase).

- [ ] **Step 5: Commit**

Message: `feat(make-diagram): viewer info names groups and keys edges by id` — the orchestrator commits; do not run git commit.

---

### Task 3: `route.js`, the shortest route over the page data

**Files:**
- Create: `plugins/portable-artifacts/skills/make-diagram/template/route.js`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/runtime.mjs:7`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/route.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/runtime.test.mjs`

**Interfaces:**
- Consumes: `PADiagram.dict` (camera.js, earlier in the bundle); `data.edges`, `data.directed`, `data.adjacency`.
- Produces: `PADiagram.route(data, from, to)` → `{ from, to, hops: [{ edge, from, to }], directed: boolean }`. `hops` is `[]` when nothing joins the two ids (or `from === to`); `directed` is `false` when the arrows had to be ignored. Hops carry the traversal direction, so a list reads `from → to` even against an arrow. Groups are vertices; a self edge is never a hop.
- Produces: `RUNTIME_FILES = ['camera.js', 'route.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js']` (Task 4 inserts `panel.js`).

- [ ] **Step 1: Write the failing tests**

Create `test/route.test.mjs`:

```js
// PADiagram.route (template/route.js) is DOM-free: it loads here with a bare
// `window`, in this realm (so deepEqual compares plain objects, not vm ones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagram } from '../scripts/lib/api.mjs';

const src = ['camera.js', 'route.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');
const load = () => { const win = {}; new Function('window', src)(win); return win.PADiagram; };
const example = (name) => JSON.parse(fs.readFileSync(new URL(`../references/examples/${name}.diagram.json`, import.meta.url), 'utf8'));

// a -> b -> c and a -> c, with the undirected adjacency viewerData would build; d stands alone.
const triangle = {
  edges: { e1: ['a', 'b'], e2: ['b', 'c'], e3: ['a', 'c'] },
  directed: { a: ['e1', 'e3'], b: ['e2'] },
  adjacency: { a: { nodes: ['b', 'c'], edges: ['e1', 'e3'] }, b: { nodes: ['a', 'c'], edges: ['e1', 'e2'] }, c: { nodes: ['b', 'a'], edges: ['e2', 'e3'] }, d: { nodes: [], edges: [] } },
};

test('a directed route follows the arrows and takes the fewest hops', () => {
  const PAD = load();
  assert.deepEqual(PAD.route(triangle, 'a', 'c'), { from: 'a', to: 'c', hops: [{ edge: 'e3', from: 'a', to: 'c' }], directed: true });
  assert.deepEqual(PAD.route(triangle, 'a', 'b').hops, [{ edge: 'e1', from: 'a', to: 'b' }]);
  assert.deepEqual(PAD.route(triangle, 'b', 'c').hops, [{ edge: 'e2', from: 'b', to: 'c' }]);
});

test('against the arrows it falls back to ignoring direction and says so; nothing joining them gives no hops', () => {
  const PAD = load();
  assert.deepEqual(PAD.route(triangle, 'c', 'a'), { from: 'c', to: 'a', hops: [{ edge: 'e3', from: 'c', to: 'a' }], directed: false });
  assert.deepEqual(PAD.route(triangle, 'a', 'd'), { from: 'a', to: 'd', hops: [], directed: false });
  assert.deepEqual(PAD.route(triangle, 'b', 'b'), { from: 'b', to: 'b', hops: [], directed: true });
});

test('a route passes through a group an edge ends at, and a two-headed edge is walked from both ends', () => {
  const PAD = load();
  const grouped = { edges: { e1: ['a', 'g'], e2: ['g', 'b'], e3: ['b', 'c'] }, directed: { a: ['e1'], g: ['e2'], b: ['e3'], c: ['e3'] }, adjacency: {} };
  assert.deepEqual(PAD.route(grouped, 'a', 'c').hops, [{ edge: 'e1', from: 'a', to: 'g' }, { edge: 'e2', from: 'g', to: 'b' }, { edge: 'e3', from: 'b', to: 'c' }]);
  assert.deepEqual(PAD.route(grouped, 'c', 'b'), { from: 'c', to: 'b', hops: [{ edge: 'e3', from: 'c', to: 'b' }], directed: true });
});

test('a self edge is never a hop, and ids named like Object.prototype members work', () => {
  const PAD = load();
  const proto = {
    edges: { loop: ['constructor', 'constructor'], e: ['constructor', 'b'] },
    directed: { constructor: ['loop', 'e'] },
    adjacency: { constructor: { nodes: ['b'], edges: ['loop', 'e'] }, b: { nodes: ['constructor'], edges: ['e'] } },
  };
  assert.deepEqual(PAD.route(proto, 'constructor', 'b'), { from: 'constructor', to: 'b', hops: [{ edge: 'e', from: 'constructor', to: 'b' }], directed: true });
  assert.deepEqual(PAD.route(proto, 'b', 'constructor'), { from: 'b', to: 'constructor', hops: [{ edge: 'e', from: 'b', to: 'constructor' }], directed: false });
  assert.deepEqual(PAD.route({ edges: {}, directed: {}, adjacency: {} }, 'toString', 'valueOf').hops, [], 'empty data answers for nothing');
});

test('on the architecture example: web reaches db in two hops along the arrows; pay reaches web only ignoring them; web reaches the vpc group', async () => {
  const PAD = load();
  const { data } = await buildDiagram(example('architecture'));
  assert.deepEqual(PAD.route(data, 'web', 'db'), { from: 'web', to: 'db', hops: [{ edge: 'edge-0', from: 'web', to: 'api' }, { edge: 'edge-1', from: 'api', to: 'db' }], directed: true });
  assert.deepEqual(PAD.route(data, 'pay', 'web'), { from: 'pay', to: 'web', hops: [{ edge: 'edge-2', from: 'pay', to: 'api' }, { edge: 'edge-0', from: 'api', to: 'web' }], directed: false });
  assert.deepEqual(PAD.route(data, 'web', 'vpc'), { from: 'web', to: 'vpc', hops: [{ edge: 'edge-3', from: 'web', to: 'vpc' }], directed: true });
  assert.deepEqual(PAD.route(data, 'pay', 'vpc').hops.map((h) => h.edge), ['edge-2', 'edge-0', 'edge-3']);
});
```

`test/runtime.test.mjs` — the order test and the factories map:

```js
test('the runtime is camera, route, explore, story, transport, then viewer, joined in that order', () => {
  assert.deepEqual(RUNTIME_FILES, ['camera.js', 'route.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js']);
```

```js
  const factories = { 'camera.js': 'camera', 'route.js': 'route', 'explore.js': 'trace', 'story.js': 'story', 'transport.js': 'transport' };
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/route.test.mjs test/runtime.test.mjs`
Expected: `route.test.mjs` fails at import time with `Error: ENOENT: no such file or directory, open '…/template/route.js'`; `runtime.test.mjs` fails the order test with the `deepEqual` diff (`route.js` missing from `RUNTIME_FILES`); its factories test still loops the old list and passes until the list changes.

- [ ] **Step 3: Implement**

Create `template/route.js`:

```js
// make-diagram viewer, route: the shortest path between two ids over the page
// data, for Explore's shift-click. Pure (no DOM), so a Node test can load it
// with a bare `window`. Registered as PADiagram.route; camera.js, which defines
// PADiagram.dict, comes before it in the bundle (scripts/lib/runtime.mjs).
//
//   var r = PADiagram.route(data, from, to);
//   // -> { from, to, hops: [{ edge, from, to }], directed }; hops is [] when nothing joins them
//
// The first pass walks data.directed (the edges leaving an id along the arrow;
// a two-headed edge leaves both ends). When that reaches nothing, a second pass
// walks data.adjacency ignoring direction and reports directed: false. Groups
// are vertices like nodes: an edge ending at a group reaches the group, and the
// group's own edges carry on from there. A self edge never counts as a hop.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  // Breadth-first from `from` to `to`; next(id) lists the edge ids that may be
  // walked from id. Returns the hops in order, or null when `to` is unreachable.
  function search(from, to, edges, next) {
    var prev = PADiagram.dict(); // id -> { at, edge } that reached it first
    var seen = PADiagram.dict();
    seen[from] = true;
    var queue = [from];
    while (queue.length) {
      var at = queue.shift();
      if (at === to) break;
      var out = next(at);
      for (var i = 0; i < out.length; i++) {
        var ends = edges[out[i]];
        if (!ends) continue;
        var other = ends[0] === at ? ends[1] : ends[0];
        if (seen[other]) continue;
        seen[other] = true;
        prev[other] = { at: at, edge: out[i] };
        queue.push(other);
      }
    }
    if (!seen[to]) return null;
    var hops = [];
    for (var id = to; id !== from; id = prev[id].at) hops.unshift({ edge: prev[id].edge, from: prev[id].at, to: id });
    return hops;
  }

  PADiagram.route = function (data, from, to) {
    var edges = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var adjacency = PADiagram.dict(data.adjacency);
    var along = function (id) { return directed[id] || []; };
    var any = function (id) { return adjacency[id] ? adjacency[id].edges : []; };
    var hops = search(from, to, edges, along);
    if (hops) return { from: from, to: to, hops: hops, directed: true };
    hops = search(from, to, edges, any);
    return { from: from, to: to, hops: hops || [], directed: false };
  };
})(window);
```

`scripts/lib/runtime.mjs:7`:

```js
export const RUNTIME_FILES = ['camera.js', 'route.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js'];
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/route.test.mjs test/runtime.test.mjs` — expected: pass. Then `npm test` — green (the bundle gains a module nothing calls yet; every page still mounts). Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (its page embeds `viewerRuntime()`, now with `route.js`; the recap golden does not change: the inlined runtime is not part of the normalised body, verified against a scratch build of the whole phase).

- [ ] **Step 5: Commit**

Message: `feat(make-diagram): shortest route over the viewer data (route.js)` — the orchestrator commits; do not run git commit.

---

### Task 4: Explore: selection, the node and edge panel, the tooltip, Escape and focus

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/explore.js` (rewritten)
- Create: `plugins/portable-artifacts/skills/make-diagram/template/panel.js`
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js` (rewritten; Task 1's changes included)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.html` (the `.body` row, the panel, the tooltip, plain CSS)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/toolbar.js:70,100`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/css.mjs:55-67`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/runtime.mjs:7`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/explore-browser.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/runtime.test.mjs`, `test/render.test.mjs:339-346`, `test/build.test.mjs:141`

**Interfaces:**
- Consumes: `data.info` with group entries (Task 2), `PADiagram.route` (Task 3; called only from Task 5's shift-click), `PADiagram.camera` (`boxOf`, `cameraFor`, `moveTo`, `unfit`), `PADiagram.story` (`isPresenting`, `present`, `exit`).
- Produces: `PADiagram.trace(svg, data, els, { isOff })` → `{ refresh, idAt, hover, focus, select(id), toggle(id), route(from, to), find(text), links(id), counts(), selected(), routed(), finding(), active(), hasFocus(), clear() }`. `links(id)` → `{ sends: [{ edge, other }], receives: [{ edge, other }] }`. `find(text)` → `[{ id, label }]` (≤ 8) and sets the canvas filter. `counts()` → `['1 user', …, '2 stories', '9 beats']`.
- Produces: `PADiagram.panel({ panel, tip, found }, data, els, trace, { isOff, onPick(id), onBeat(i), onClose(byKeyboard) })` → `{ paint, tipFor(id, x, y), tipMove(x, y), found(hits, query) }`. `byKeyboard` is true when a key pressed the close button (`click.detail === 0`); only then does focus return to the node.
- Produces: `PADiagram.mount(stage, data, { keys, caption, chapters, panel, tip, find, found, onChange })`; `ctl` gains `select(id)` and `closePanel()`; `ctl.state()` gains `selected` and `route` and loses `pinned`.
- Produces: page hooks `aside[data-pa-panel]` holding `[data-pa-panel-title]`, `[data-pa-panel-close]`, `[data-pa-panel-body]`; `[data-pa-tip]` inside `#pa-stage`; inside the body: `.panel-icon` (emoji text or `svg.panel-glyph`), `.panel-kind`, `.panel-note`, `.panel-detail`, `h3` + `ul[data-pa-sends]` / `ul[data-pa-receives]` / `ul[data-pa-ends]` / `ul[data-pa-used]` of `li > button.pa-row[data-pa-go="<id>"]` or `button.pa-row[data-pa-beat-go="<i>"]`, `li.panel-none` for an empty list, `span.panel-arrow` (`→` or `↔`) between the ends. State classes `pa-selected` (the selected node, group or edge) and `pa-route` (Task 5 paints it).
- Behaviour the phase changes: `ctl.state().pinned` is gone (nothing read it). The hover trace, focus trace, click-to-select toggle and Escape keep phase 1's observable behaviour, so `test/browser.test.mjs` `click pins the trace, another click on the node and Escape release it` stays green unchanged.

- [ ] **Step 1: Write the failing tests**

Create `test/explore-browser.test.mjs`:

```js
// Explore: the side panel for a node or an edge, the hover tooltip, Escape and
// focus. Task 5 appends the route tests, Task 6 the Find and count-chip tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle, viewBox, boxOf, holds } from './helpers/page.mjs';
import { PROTOTYPE_NAMED_SPECS } from './helpers/prototype-ids.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `explore-${name}` }));

const title = (page) => page.textContent('[data-pa-panel-title]');
const texts = (page, sel) => page.locator(sel).allTextContents();
const bodyHidden = (page) => page.isHidden('[data-pa-panel-body]');
const selectedIds = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-selected')].map((e) => e.dataset.id).sort());
const dimmedNodes = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-node.pa-dim')].map((n) => n.dataset.id).sort());
const activeId = (page) => page.evaluate(() => document.activeElement?.dataset?.id ?? document.activeElement?.tagName ?? null);
const playing = (page) => page.evaluate(() => document.getElementById('pa-stage').classList.contains('pa-playing'));
// A click that no real mouse can land (a thin edge path): the pointer events the stage listens for, on the element itself.
const tap = async (page, sel) => {
  await page.dispatchEvent(sel, 'pointerdown', { pointerId: 7, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
  await page.dispatchEvent(sel, 'pointerup', { pointerId: 7, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
};

test('a node click opens the panel: emoji, kind, label, detail, Sends to and Receives from; the selection and its neighbours stay lit', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isVisible('[data-pa-panel]'), true, 'the panel is there in Explore');
  assert.equal(await title(page), 'Map');
  assert.equal(await bodyHidden(page), true);
  assert.equal(await page.isHidden('[data-pa-panel-close]'), true);
  await page.click('.pa-node[data-id="orders"]');
  assert.equal(await title(page), 'Orders service');
  assert.equal(await page.textContent('.panel-icon'), '📦');
  assert.equal(await page.textContent('.panel-kind'), 'service');
  assert.ok((await page.textContent('.panel-detail')).startsWith('Owns the order lifecycle.'));
  assert.equal(await page.locator('.panel-note').count(), 0, 'no note, no note line');
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), ['→ Orders DB · writes order', '→ Event bus · order.placed', '→ API gateway · 201 Created']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← API gateway · forwards']);
  assert.deepEqual(await selectedIds(page), ['orders']);
  assert.deepEqual(await dimmedNodes(page), ['app', 'shopper', 'warehouse'], 'neighbours stay lit');
  await page.mouse.move(2, 2);
  assert.deepEqual(await selectedIds(page), ['orders'], 'the selection outlives the pointer');
  assert.equal(await page.isVisible('[data-pa-panel-close]'), true);
  await page.click('[data-pa-panel-close]');
  assert.equal(await title(page), 'Map');
  assert.equal(await bodyHidden(page), true);
  assert.deepEqual(await selectedIds(page), []);
  assert.equal(await page.locator('.pa-dim').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('an icon node shows a copy of its icon; a Sends to row jumps to the other end, selects it and fits the camera', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-node[data-id="orders"]');
  await page.click('[data-pa-go="db"]');
  assert.equal(await title(page), 'Orders DB');
  assert.equal(await page.locator('.panel-icon svg.panel-glyph .pa-icon').count(), 1, 'the diagram icon, copied');
  assert.equal(await page.textContent('.panel-icon'), '', 'no emoji text');
  assert.equal(await page.textContent('.panel-kind'), 'database');
  assert.deepEqual(await selectedIds(page), ['db']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← Orders service · writes order']);
  assert.deepEqual(await texts(page, '[data-pa-sends] .panel-none'), ['nothing']);
  await settle(page);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['db'])), 'the camera fits the picked node');
  assert.deepEqual(problems, []);
  await context.close();
});

test('two edges between the same ends are two rows; a group at an edge end is a row that selects the group', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const story = await openPage(built('story').url);
  await story.page.click('.pa-node[data-id="gateway"]');
  assert.equal(await story.page.textContent('.panel-note'), 'auth, rate limits');
  assert.deepEqual(await texts(story.page, '[data-pa-sends] .pa-row'), ['→ Orders service · forwards']);
  assert.deepEqual(await texts(story.page, '[data-pa-receives] .pa-row'), ['← Mobile app · POST /orders', '← Orders service · 201 Created']);
  assert.deepEqual(story.problems, []);
  await story.context.close();

  const arch = await openPage(built('architecture').url);
  await arch.page.click('.pa-node[data-id="web"]');
  assert.deepEqual(await texts(arch.page, '[data-pa-sends] .pa-row'), ['→ Checkout API · POST /checkout', '→ Private VPC'], 'the two-headed edge onto the group, unlabelled');
  await arch.page.click('[data-pa-go="vpc"]');
  assert.equal(await title(arch.page), 'Private VPC');
  assert.equal(await arch.page.textContent('.panel-kind'), 'group');
  assert.ok(await arch.page.evaluate(() => document.querySelector('.pa-group[data-id="vpc"]').classList.contains('pa-selected')));
  assert.deepEqual(await texts(arch.page, '[data-pa-sends] .pa-row'), ['→ Web app']);
  await settle(arch.page);
  assert.ok(holds(await viewBox(arch.page), await boxOf(arch.page, ['vpc'])));
  assert.deepEqual(arch.problems, []);
  await arch.context.close();
});

test('Enter on a focused node opens the panel; Escape inside the panel closes it and returns focus to the node; a second Escape ends the focus trace', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.focus('.pa-node[data-id="gateway"]');
  await page.keyboard.press('Enter');
  assert.equal(await title(page), 'API gateway');
  await page.focus('[data-pa-panel-close]');
  assert.equal(await activeId(page), 'BUTTON');
  await page.keyboard.press('Escape');
  assert.equal(await bodyHidden(page), true, 'Escape in the panel closes it');
  assert.equal(await activeId(page), 'gateway', 'focus is back on the node');
  assert.ok((await page.locator('.pa-dim').count()) > 0, 'the focused node traces');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pa-dim').count(), 0, 'a second Escape clears the focus trace');
  assert.notEqual(await activeId(page), 'gateway');
  await page.focus('.pa-node[data-id="gateway"]');
  await page.keyboard.press('Enter');
  await page.focus('[data-pa-panel-close]');
  await page.keyboard.press('Enter');
  assert.equal(await bodyHidden(page), true, 'Enter on Close closes');
  assert.equal(await activeId(page), 'gateway', 'and, pressed from the keyboard, returns focus to the node');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an edge click shows its label, style, ends and the beats that use it; a beat row enters Play paused at that beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-edge-label[data-edge="edge-0"]');
  assert.equal(await title(page), 'taps Buy');
  assert.equal(await page.textContent('.panel-kind'), 'solid');
  assert.deepEqual(await texts(page, '[data-pa-ends] .pa-row'), ['Shopper', 'Mobile app']);
  assert.equal(await page.textContent('[data-pa-ends] .panel-arrow'), '→');
  assert.deepEqual(await texts(page, '[data-pa-used] .pa-row'), ['01 The shopper taps Buy', '06 The shopper sees a receipt'], 'the forward hop and the reverse one');
  assert.deepEqual(await selectedIds(page), ['edge-0']);
  await page.click('[data-pa-beat-go="5"]');
  assert.equal(await page.textContent('[data-pa-count]'), '6 / 9');
  assert.equal(await playing(page), false, 'paused on the beat');
  assert.equal(await page.isHidden('[data-pa-panel]'), true, 'the panel hides in Play');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await page.isVisible('[data-pa-panel]'), true);
  assert.equal(await title(page), 'Map', 'entering Play dropped the selection');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an unlabelled two-headed edge: title "Edge", a ↔ between the ends, "no beat"; in a sequence a message says its kind', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const arch = await openPage(built('architecture').url);
  await tap(arch.page, '.pa-edge[data-id="edge-3"]');
  assert.equal(await title(arch.page), 'Edge');
  assert.equal(await arch.page.textContent('.panel-kind'), 'dashed');
  assert.deepEqual(await texts(arch.page, '[data-pa-ends] .pa-row'), ['Web app', 'Private VPC']);
  assert.equal(await arch.page.textContent('[data-pa-ends] .panel-arrow'), '↔');
  assert.deepEqual(await texts(arch.page, '[data-pa-used] .panel-none'), ['no beat'], 'a step-derived timeline has no hops');
  assert.deepEqual(arch.problems, []);
  await arch.context.close();

  const seq = await openPage(built('sequence').url);
  await seq.page.click('.pa-edge-label[data-edge="m1"]');
  assert.equal(await seq.page.textContent('.panel-kind'), 'sync');
  assert.equal(await seq.page.textContent('[data-pa-ends] .panel-arrow'), '→');
  await seq.page.click('.pa-node[data-id="shopper"]');
  assert.ok((await seq.page.locator('[data-pa-sends] .pa-row').count()) >= 1, 'a participant lists the messages it sends');
  assert.deepEqual(seq.problems, []);
  await seq.context.close();
});

test('hover shows a tooltip: "label — note" for a node, the label for an edge, both ends for one without; it hides on leaving, while dragging and in Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isHidden('[data-pa-tip]'), true);
  await page.hover('.pa-node[data-id="gateway"]');
  assert.equal(await page.isVisible('[data-pa-tip]'), true);
  assert.equal(await page.textContent('[data-pa-tip]'), 'API gateway — auth, rate limits');
  assert.equal(await page.getAttribute('[data-pa-tip]', 'role'), 'tooltip');
  const tipBox = await page.locator('[data-pa-tip]').boundingBox();
  const stageBox = await page.locator('#pa-stage').boundingBox();
  assert.ok(tipBox.x >= stageBox.x && tipBox.x + tipBox.width <= stageBox.x + stageBox.width + 1, 'the tip stays inside the stage');
  await page.hover('.pa-node[data-id="shopper"]');
  assert.equal(await page.textContent('[data-pa-tip]'), 'Shopper', 'no note, no dash');
  await page.hover('.pa-edge-label[data-edge="place"]');
  assert.equal(await page.textContent('[data-pa-tip]'), 'POST /orders');
  await page.mouse.move(2, 2);
  assert.equal(await page.isHidden('[data-pa-tip]'), true, 'leaving the diagram hides it');
  await page.keyboard.press('p');
  await page.dispatchEvent('.pa-node[data-id="db"]', 'pointerover');
  assert.equal(await page.isHidden('[data-pa-tip]'), true, 'no tooltip in Play');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an edge with no label tips both ends', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.dispatchEvent('.pa-edge[data-id="edge-3"]', 'pointerover');
  assert.equal(await page.textContent('[data-pa-tip]'), 'Web app → Private VPC');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a node with no edges: both lists say nothing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'Lonely', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'lonely' }).url);
  await page.click('.pa-node[data-id="c"]');
  assert.equal(await title(page), 'C');
  assert.deepEqual(await texts(page, '[data-pa-sends] .panel-none'), ['nothing']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .panel-none'), ['nothing']);
  assert.deepEqual(await dimmedNodes(page), ['a', 'b']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a prototype-named group at a two-headed edge end is listed both ways', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = PROTOTYPE_NAMED_SPECS['a group named constructor at a two-headed edge end'];
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'proto-group' }).url);
  await page.click('.pa-node[data-id="b"]');
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), ['→ Group']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← A', '← Group']);
  await page.click('[data-pa-go="constructor"]');
  assert.equal(await title(page), 'Group');
  assert.equal(await page.textContent('.panel-kind'), 'group');
  assert.deepEqual(problems, []);
  await context.close();
});

test('hostile text in label, note, detail and an edge label reaches the panel, the rows and the tooltip as text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const evil = '<b>&"x"';
  const spec = {
    title: 'Evil explore', type: 'architecture',
    nodes: [{ id: 'a', label: evil, note: evil, detail: evil }, { id: 'b', label: 'B [x]' }],
    edges: [{ from: 'a', to: 'b', label: evil }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'evil-explore' }).url);
  await page.click('.pa-node[data-id="a"]');
  assert.equal(await page.locator('b').count(), 0);
  assert.equal(await title(page), evil);
  assert.equal(await page.textContent('.panel-note'), evil);
  assert.equal(await page.textContent('.panel-detail'), evil);
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), [`→ B [x] · ${evil}`]);
  await page.hover('.pa-node[data-id="a"]');
  assert.equal(await page.textContent('[data-pa-tip]'), `${evil} — ${evil}`);
  assert.equal(await page.locator('b').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('exports carry no explore state: no pa-selected, no pa-dim, no pa-on', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-node[data-id="orders"]');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  assert.ok(!/class="[^"]*\bpa-(selected|route|dim|on)\b/.test(text), 'no viewer state on any element');
  assert.deepEqual(problems, []);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`the panel open with a selection at ${width} px: no console problems, no overflow, a finite camera`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { width, height: width === 390 ? 780 : 800 });
    await page.click('.pa-node[data-id="orders"]');
    assert.equal(await title(page), 'Orders service');
    await settle(page);
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth <= window.innerWidth, h: document.documentElement.scrollHeight <= window.innerHeight }));
    assert.ok(fit.w, 'no horizontal overflow');
    assert.ok(fit.h, 'no vertical overflow');
    assert.ok((await viewBox(page)).every(Number.isFinite));
    assert.deepEqual(problems, []);
    await context.close();
  });
}
```

`test/runtime.test.mjs` — the list gains `panel.js` after `explore.js`:

```js
test('the runtime is camera, route, explore, panel, story, transport, then viewer, joined in that order', () => {
  assert.deepEqual(RUNTIME_FILES, ['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'viewer.js']);
```

```js
  const factories = { 'camera.js': 'camera', 'route.js': 'route', 'explore.js': 'trace', 'panel.js': 'panel', 'story.js': 'story', 'transport.js': 'transport' };
```

`test/render.test.mjs` — in `diagramCss holds the viewer state rules: dim, hidden, highlight`, append:

```js
  assert.match(css, /\.pa-selected \.pa-shape\{[^}]*stroke:var\(--accent\)/, 'a selected node outlines in the accent');
  assert.match(css, /\.pa-selected > \.pa-group-box\{[^}]*stroke:var\(--accent\)/, 'a selected group too');
  assert.match(css, /\.pa-edge\.pa-selected path\{[^}]*stroke-width:2\.5/, 'a selected edge is thicker, not only coloured');
  assert.match(css, /\.pa-route \.pa-shape\{[^}]*stroke:var\(--accent\)/);
  assert.match(css, /\.pa-edge\.pa-route path\{[^}]*stroke-width:2\.5/);
```

`test/build.test.mjs:141` — add to the hook list: `'data-pa-panel'`, `'data-pa-panel-title'`, `'data-pa-panel-close'`, `'data-pa-panel-body'`, `'data-pa-tip'`:

```js
  for (const hook of ['data-act="fit"', 'data-act="zoom-in"', 'data-act="zoom-out"', 'data-pa-mode="play"', 'data-pa-mode="explore"', 'data-pa-chapters', 'data-pa-line', 'data-pa-scrub', 'data-act="animate"', 'data-export="svg"', 'data-export="png"', 'data-theme-toggle aria-label="Theme: Auto. Change theme">Theme: Auto</button>', 'data-pa-caption', 'id="pa-stage"', 'data-pa-panel', 'data-pa-panel-title', 'data-pa-panel-close', 'data-pa-panel-body', 'data-pa-tip']) {
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/explore-browser.test.mjs test/runtime.test.mjs test/render.test.mjs test/build.test.mjs`
Expected: every explore test fails, the first at `page.isVisible('[data-pa-panel]')` (actual `false`: no such element) and the hover test at `page.isHidden('[data-pa-tip]')`; `runtime.test.mjs` fails its `deepEqual` (no `panel.js`) and the factories test; `render.test.mjs` fails at `a selected node outlines in the accent`; `build.test.mjs` fails at `data-pa-panel`.

- [ ] **Step 3: Implement the trace (`template/explore.js`, rewritten)**

```js
// make-diagram viewer, explore: what the reader is looking at. Hover, keyboard
// focus and a click light a node (or an edge) and what it touches, the rest
// dims (pa-dim / pa-on); the clicked one is the selection (pa-selected) the
// panel describes; a shift-click on a second node asks route.js for the way
// between them (pa-route); the Find box filters nodes by label. Registered as
// PADiagram.trace and composed by viewer.js; panel.js paints what this holds.
//
//   var trace = PADiagram.trace(svg, data, els, { isOff });
//
// isOff() true (the story is on) leaves the diagram untouched, since the beat's
// own dimming would otherwise fight the trace's. Painting precedence: a route,
// else the selected / hovered / focused id, else the Find filter.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var FIND_MAX = 8; // matches listed under the Find box

  PADiagram.trace = function (svg, data, els, hooks) {
    hooks = hooks || {};
    var adjacency = PADiagram.dict(data.adjacency);
    var edgeEnds = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var info = PADiagram.dict(data.info);
    var hoverId = null;
    var focusId = null;
    var selectId = null;
    var routeState = null; // PADiagram.route's answer while a route shows
    var findIds = null; // node ids matching the Find text, or null for no filter
    var traced = []; // elements carrying state classes, to reset cheaply

    var otherEnd = function (e, id) { var ends = edgeEnds[e] || []; return ends[0] === id ? ends[1] : ends[0]; };
    var isNode = function (id) { return !!(els.nodes[id] && info[id] && info[id].kind && info[id].kind !== 'group'); };

    function relation(id) {
      if (edgeEnds[id]) return { nodes: edgeEnds[id].slice(), edges: [id], on: [] };
      var a = adjacency[id] || { nodes: [], edges: [] };
      return { nodes: [id].concat(a.nodes), edges: a.edges, on: [id] };
    }
    function paint(el, dim, on, cls) {
      el.classList.toggle('pa-dim', dim);
      el.classList.toggle('pa-on', on);
      if (cls) el.classList.add(cls);
      traced.push(el);
    }
    function reset() {
      traced.forEach(function (el) { el.classList.remove('pa-dim', 'pa-on', 'pa-selected', 'pa-route'); });
      traced = [];
    }
    // The id and what touches it stay lit; the selected one is also marked.
    function paintRelation(id) {
      var rel = relation(id);
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], rel.nodes.indexOf(n) < 0, rel.on.indexOf(n) >= 0, n === selectId ? 'pa-selected' : null); });
      if (els.groups[selectId]) paint(els.groups[selectId], false, false, 'pa-selected');
      Object.keys(els.edges).forEach(function (e) {
        var incident = rel.edges.indexOf(e) >= 0;
        paint(els.edges[e], !incident, incident, e === selectId ? 'pa-selected' : null);
        if (els.labels[e]) paint(els.labels[e], !incident, false, null);
      });
    }
    // Both ends and every hop stay lit (a group among them too); the rest dims.
    function paintRoute(r) {
      var on = PADiagram.dict();
      var via = PADiagram.dict();
      on[r.from] = true;
      on[r.to] = true;
      r.hops.forEach(function (h) { on[h.from] = true; on[h.to] = true; via[h.edge] = true; });
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], !on[n], false, on[n] ? 'pa-route' : null); });
      Object.keys(els.groups).forEach(function (g) { if (on[g]) paint(els.groups[g], false, false, 'pa-route'); });
      Object.keys(els.edges).forEach(function (e) {
        paint(els.edges[e], !via[e], false, via[e] ? 'pa-route' : null);
        if (els.labels[e]) paint(els.labels[e], !via[e], false, null);
      });
    }
    // Nodes whose label matches stay lit, with the edges between two of them.
    function paintFind(ids) {
      var hit = PADiagram.dict();
      ids.forEach(function (id) { hit[id] = true; });
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], !hit[n], false, null); });
      Object.keys(els.edges).forEach(function (e) {
        var ends = edgeEnds[e] || [];
        var on = !!hit[ends[0]] && !!hit[ends[1]];
        paint(els.edges[e], !on, false, null);
        if (els.labels[e]) paint(els.labels[e], !on, false, null);
      });
    }
    function refresh() {
      reset();
      var off = hooks.isOff && hooks.isOff();
      var id = off ? null : (selectId || hoverId || focusId);
      var route = off ? null : routeState;
      var found = off ? null : findIds;
      svg.classList.toggle('pa-tracing', !!(id || route || found));
      if (route) paintRoute(route);
      else if (id) paintRelation(id);
      else if (found) paintFind(found);
    }
    // The node or edge id under a pointer or focus target, or null.
    function idAt(target) {
      var el = target && target.closest ? target.closest('.pa-node,.pa-edge,.pa-edge-label') : null;
      if (!el) return null;
      return el.getAttribute('data-id') || el.getAttribute('data-edge');
    }

    // ---- selection, route, find ---------------------------------------------------------------
    function select(id) { selectId = id || null; routeState = null; refresh(); }
    function toggle(id) { select(id && id !== selectId ? id : null); }
    function route(from, to) {
      routeState = PADiagram.route(data, from, to);
      selectId = null;
      refresh();
      return routeState;
    }
    // Node ids whose label holds `text` (case-insensitive), as [{ id, label }]
    // for the Find list (FIND_MAX at most). Sets the filter the canvas shows;
    // empty text, or no match, clears it.
    function find(text) {
      var q = String(text || '').trim().toLowerCase();
      var hits = [];
      if (q) {
        Object.keys(info).forEach(function (id) {
          if (isNode(id) && info[id].label.toLowerCase().indexOf(q) >= 0) hits.push({ id: id, label: info[id].label });
        });
      }
      findIds = hits.length ? hits.map(function (h) { return h.id; }) : null;
      refresh();
      return hits.slice(0, FIND_MAX);
    }
    // What leaves `id` along the arrows and what arrives, as [{ edge, other }]
    // (a two-headed or self edge appears in both lists).
    function links(id) {
      var sends = (directed[id] || []).map(function (e) { return { edge: e, other: otherEnd(e, id) }; });
      var incident = adjacency[id] ? adjacency[id].edges : [];
      var receives = incident.filter(function (e) { return (directed[otherEnd(e, id)] || []).indexOf(e) >= 0; })
        .map(function (e) { return { edge: e, other: otherEnd(e, id) }; });
      return { sends: sends, receives: receives };
    }
    // "1 user", "5 service", ... in order of first appearance, then the stories
    // (when authored) and the beats: what the panel shows while nothing is selected.
    function counts() {
      var order = [];
      var n = PADiagram.dict();
      Object.keys(info).forEach(function (id) {
        if (!isNode(id)) return;
        var k = info[id].kind;
        if (!n[k]) { n[k] = 0; order.push(k); }
        n[k] += 1;
      });
      var out = order.map(function (k) { return n[k] + ' ' + k; });
      var beats = data.beats || [];
      var chapters = data.chapters || [];
      if (beats.length && beats[0].kind !== 'step') out.push(chapters.length + (chapters.length === 1 ? ' story' : ' stories'));
      out.push(beats.length + (beats.length === 1 ? ' beat' : ' beats'));
      return out;
    }

    return {
      refresh: refresh,
      idAt: idAt,
      hover: function (id) { if (id === hoverId) return; hoverId = id; refresh(); },
      focus: function (id) { focusId = id; refresh(); },
      select: select,
      toggle: toggle,
      route: route,
      find: find,
      links: links,
      counts: counts,
      selected: function () { return selectId; },
      routed: function () { return routeState; },
      finding: function () { return !!findIds; },
      active: function () { return selectId || hoverId || focusId; },
      hasFocus: function () { return !!focusId; },
      clear: function () { selectId = null; routeState = null; hoverId = null; refresh(); },
    };
  };
})(window);
```

(`route`, `find` and `counts` are complete here; Task 5 wires the shift-click that calls `route`, Task 6 the Find box and the counts container. Nothing reaches them before that.)

- [ ] **Step 4: Implement the panel (`template/panel.js`, new)**

```js
// make-diagram viewer, panel: paints the Explore side panel, the hover tooltip
// and the Find results from what the trace (explore.js) holds. Every holder is
// optional (make-explainer passes none yet). Text goes in as textContent,
// never markup. Registered as PADiagram.panel and composed by viewer.js.
//
//   var panel = PADiagram.panel({ panel, tip, found }, data, els, trace, { isOff, onPick, onBeat, onClose });
//
// panel   aside[data-pa-panel] with data-pa-panel-title, data-pa-panel-close,
//         data-pa-empty (holding data-pa-tally) and data-pa-panel-body inside it.
// tip     [data-pa-tip], positioned inside the stage.
// found   the row the Find matches go in (buttons that pick a node).
// isOff() true hides the panel and the tooltip (the story is on).
// onPick(id) selects and shows a node named in a row; onBeat(i) enters Play at
// beat i; onClose(byKeyboard) runs when the close button is pressed.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var TIP_GAP = 12; // px between the pointer and the tooltip
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  PADiagram.panel = function (holders, data, els, trace, hooks) {
    hooks = hooks || {};
    var doc = global.document;
    var panelEl = holders.panel || null;
    var tip = holders.tip || null;
    var foundEl = holders.found || null;
    var info = PADiagram.dict(data.info);
    var edgeEnds = PADiagram.dict(data.edges);
    var directed = PADiagram.dict(data.directed);
    var beats = data.beats || [];
    var isSequence = data.type === 'sequence';
    var part = function (name) { return panelEl ? panelEl.querySelector('[' + name + ']') : null; };
    var titleEl = part('data-pa-panel-title');
    var closeEl = part('data-pa-panel-close');
    var emptyEl = part('data-pa-empty');
    var bodyEl = part('data-pa-panel-body');
    var countsEl = part('data-pa-tally');
    var off = function () { return !!(hooks.isOff && hooks.isOff()); };
    var labelOf = function (id) { return info[id] ? info[id].label : id; };

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    // A button row: `attr` names what it stands for (a node id, a beat index).
    function row(text, attr, value, onClick) {
      var b = el('button', 'pa-row', text);
      b.type = 'button';
      b.setAttribute(attr, String(value));
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
      return b;
    }
    function section(heading, attr, items, none) {
      bodyEl.appendChild(el('h3', null, heading));
      var ul = el('ul');
      ul.setAttribute(attr, '');
      if (!items.length) ul.appendChild(el('li', 'panel-none', none));
      items.forEach(function (item) { var li = el('li'); li.appendChild(item); ul.appendChild(li); });
      bodyEl.appendChild(ul);
    }
    var edgeText = function (e) { var it = info[e]; return it && it.label ? ' · ' + it.label : ''; };
    var pickRow = function (prefix, id, edge) { return row(prefix + labelOf(id) + edgeText(edge), 'data-pa-go', id, function () { hooks.onPick(id); }); };

    // ---- the views ---------------------------------------------------------------------------
    // A node: its emoji (else a copy of the icon drawn in the diagram), kind, note, detail, and who it talks to.
    function paintNode(id) {
      var it = info[id] || { label: id, kind: '' };
      titleEl.textContent = it.label;
      var glyph = el('div', 'panel-icon');
      if (it.emoji) glyph.textContent = it.emoji;
      else {
        var icon = els.nodes[id] ? els.nodes[id].querySelector('.pa-icon') : null;
        if (icon) {
          var s = doc.createElementNS(icon.namespaceURI, 'svg');
          s.setAttribute('class', 'panel-glyph');
          s.setAttribute('viewBox', '0 0 24 24');
          s.setAttribute('aria-hidden', 'true');
          var copy = icon.cloneNode(true);
          copy.removeAttribute('transform');
          s.appendChild(copy);
          glyph.appendChild(s);
        }
      }
      bodyEl.appendChild(glyph);
      bodyEl.appendChild(el('p', 'panel-kind', it.kind || ''));
      if (it.note) bodyEl.appendChild(el('p', 'panel-note', it.note));
      if (it.detail) bodyEl.appendChild(el('p', 'panel-detail', it.detail));
      var l = trace.links(id);
      section('Sends to', 'data-pa-sends', l.sends.map(function (x) { return pickRow('→ ', x.other, x.edge); }), 'nothing');
      section('Receives from', 'data-pa-receives', l.receives.map(function (x) { return pickRow('← ', x.other, x.edge); }), 'nothing');
    }
    // An edge or message: label, style, both ends, and the beats that travel it.
    function paintEdge(id) {
      var it = info[id] || {};
      var ends = edgeEnds[id];
      var both = !isSequence && ends[0] !== ends[1] && (directed[ends[1]] || []).indexOf(id) >= 0;
      titleEl.textContent = it.label || (isSequence ? 'Message' : 'Edge');
      bodyEl.appendChild(el('p', 'panel-kind', it.style || ''));
      section('Between', 'data-pa-ends', [pickRow('', ends[0]), el('span', 'panel-arrow', both ? '↔' : '→'), pickRow('', ends[1])], 'nothing');
      var used = [];
      beats.forEach(function (b, i) {
        if (b.edge === id) used.push(row(pad2(i + 1) + ' ' + b.title, 'data-pa-beat-go', i, function () { hooks.onBeat(i); }));
      });
      section('Used in', 'data-pa-used', used, 'no beat');
    }
    // A route: both ends, each hop in order, and whether the arrows were ignored.
    function paintRoute(r) {
      titleEl.textContent = 'Route';
      bodyEl.appendChild(el('p', 'panel-kind', labelOf(r.from) + ' → ' + labelOf(r.to)));
      if (!r.hops.length) {
        bodyEl.appendChild(el('p', 'panel-note', 'No route between ' + labelOf(r.from) + ' and ' + labelOf(r.to) + '.'));
        return;
      }
      if (!r.directed) bodyEl.appendChild(el('p', 'panel-note', 'ignores arrow direction'));
      var ol = el('ol');
      ol.setAttribute('data-pa-hops', '');
      r.hops.forEach(function (h) { ol.appendChild(el('li', null, labelOf(h.from) + ' → ' + labelOf(h.to) + edgeText(h.edge))); });
      bodyEl.appendChild(ol);
    }

    // ---- painting -----------------------------------------------------------------------------
    if (countsEl) {
      trace.counts().forEach(function (text) {
        var chip = el('span', 'pa-chip', text);
        chip.setAttribute('role', 'listitem');
        countsEl.appendChild(chip);
      });
    }
    // A click's detail is 0 when a key (Enter, Space) pressed the button: then focus should go back to the node.
    if (closeEl) closeEl.addEventListener('click', function (e) { e.stopPropagation(); if (hooks.onClose) hooks.onClose(e.detail === 0); });

    // Repaint from the trace: a route, a selected edge or node, or the empty
    // state. Focus inside the panel moves to the close button, so a repaint
    // under the keyboard never drops focus to the page.
    function paint() {
      if (!panelEl) return;
      panelEl.hidden = off();
      if (!bodyEl || !titleEl) return;
      var hadFocus = panelEl.contains(doc.activeElement);
      var r = trace.routed();
      var id = trace.selected();
      var something = !!(r || id);
      empty(bodyEl);
      bodyEl.hidden = !something;
      if (emptyEl) emptyEl.hidden = something;
      if (closeEl) closeEl.hidden = !something;
      if (r) paintRoute(r);
      else if (id && edgeEnds[id]) paintEdge(id);
      else if (id) paintNode(id);
      else titleEl.textContent = 'Map';
      if (hadFocus && something && closeEl) closeEl.focus();
    }

    // ---- the tooltip ----------------------------------------------------------------------------
    function tipText(id) {
      var it = info[id];
      if (!it) return id;
      if (edgeEnds[id]) return it.label || (labelOf(edgeEnds[id][0]) + ' → ' + labelOf(edgeEnds[id][1]));
      return it.note ? it.label + ' — ' + it.note : it.label;
    }
    // Keep the tip inside its host (the stage): flip to the other side of the pointer when it would overflow.
    function tipMove(x, y) {
      if (!tip || tip.hidden) return;
      var host = tip.parentNode;
      var left = x + TIP_GAP;
      var top = y + TIP_GAP;
      if (host && left + tip.offsetWidth > host.clientWidth) left = Math.max(0, x - tip.offsetWidth - TIP_GAP);
      if (host && top + tip.offsetHeight > host.clientHeight) top = Math.max(0, y - tip.offsetHeight - TIP_GAP);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    function tipFor(id, x, y) {
      if (!tip) return;
      if (!id || off()) { tip.hidden = true; return; }
      tip.textContent = tipText(id);
      tip.hidden = false;
      tipMove(x, y);
    }

    // ---- the Find matches -----------------------------------------------------------------------
    function found(hits, query) {
      if (!foundEl) return;
      empty(foundEl);
      foundEl.hidden = !String(query || '').trim();
      if (foundEl.hidden) return;
      if (!hits.length) { foundEl.appendChild(el('span', 'panel-none', 'No node matches')); return; }
      hits.forEach(function (h) {
        var b = el('button', 'pa-chip', h.label);
        b.type = 'button';
        b.setAttribute('data-pa-pick', h.id);
        b.addEventListener('click', function () { hooks.onPick(h.id); });
        foundEl.appendChild(b);
      });
    }

    paint();
    return { paint: paint, tipFor: tipFor, tipMove: tipMove, found: found };
  };
})(window);
```

- [ ] **Step 5: Implement the core (`template/viewer.js`, rewritten; includes Task 1)**

```js
// make-diagram viewer core: PADiagram.mount wires the camera (camera.js), the
// trace (explore.js), the panel (panel.js), the story (story.js) and the
// transport (transport.js) around one rendered diagram, and owns pointer and
// keyboard handling, edge animation and the controller's state. No toolbar or
// page chrome in here: the page's own script (toolbar.js) and make-explainer
// drive it through the controller that mount returns.
//
//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, chapters, panel, tip, onChange });
//
// stageElement  holds the diagram <svg> (from buildDiagram) and sizes it.
// data          buildDiagram(spec).data (scripts/lib/data.mjs); nothing is fetched.
// keys          element that receives the keyboard shortcuts (default: stageElement).
// caption       the transport element (see transport.js for its data-pa-* children; every one optional).
// chapters      element the chapter chips are appended to (optional).
// panel         the Explore side panel (see panel.js; optional).
// tip           the hover tooltip element, inside the stage (optional).
// onChange      called with ctl.state() after any change.
//
// Keys: Space plays and pauses, arrows step the beats, P enters Play, E leaves
// it, Escape closes the panel, else leaves Play, else clears the trace.
// Every state class (pa-dim, pa-on, pa-hl, pa-hidden, pa-active, pa-selected,
// pa-route, pa-animate, and pa-playing on the stage) is styled by diagramCss()
// or the page; the modules only toggle them.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var DRAG_PX = 4;
  var PAN_PX = 80;
  var KEY_ZOOM = 1.25;

  // The drawn elements by id (nodes, groups, edges, labels) and in lists (lifelines, frames, notes).
  function elementsOf(svg) {
    var els = { nodes: PADiagram.dict(), groups: PADiagram.dict(), edges: PADiagram.dict(), labels: PADiagram.dict() };
    svg.querySelectorAll('.pa-node[data-id]').forEach(function (el) { els.nodes[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-group[data-id]').forEach(function (el) { els.groups[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge[data-id]').forEach(function (el) { els.edges[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge-label[data-edge]').forEach(function (el) { els.labels[el.getAttribute('data-edge')] = el; });
    els.lifelines = Array.prototype.slice.call(svg.querySelectorAll('.pa-lifeline[data-for]'));
    els.frames = Array.prototype.slice.call(svg.querySelectorAll('.pa-frame[data-messages]'));
    els.notes = Array.prototype.slice.call(svg.querySelectorAll('.pa-seq-note[data-over]'));
    return els;
  }
  var within = function (el, holder) { return !!(holder && el && holder.contains(el)); };
  var isField = function (el) { return !!(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)); };

  function mount(stage, data, options) {
    options = options || {};
    var svg = stage.querySelector('svg');
    if (!svg) return null;
    var doc = global.document;
    var els = elementsOf(svg);
    var camera = PADiagram.camera(stage, svg, data, { onApply: emit });
    var trace = PADiagram.trace(svg, data, els, { isOff: function () { return story.isPresenting(); } });
    // Entering Play drops the selection and the route (the panel hides with them); each beat repaints the chrome.
    var story = PADiagram.story(stage, svg, data, els, camera, { onStep: function () { if (story.isPresenting()) trace.clear(); transport.paint(); trace.refresh(); panel.paint(); emit(); } });
    var transport = PADiagram.transport({ caption: options.caption || null, chapters: options.chapters || null }, data, story);
    var panel = PADiagram.panel({ panel: options.panel || null, tip: options.tip || null, found: null }, data, els, trace, {
      isOff: function () { return story.isPresenting(); },
      onPick: pick,
      onBeat: function (i) { story.present(i); },
      onClose: function (byKeyboard) { closeSelection(null, byKeyboard); },
    });

    // ---- animation ----------------------------------------------------------------------
    var animateOn = !!data.animate && !camera.reduced();
    function syncAnimate() {
      if (camera.reduced()) animateOn = false;
      svg.classList.toggle('pa-animate', animateOn);
    }
    function setAnimate(on) { animateOn = !!on && !camera.reduced(); syncAnimate(); emit(); }
    function toggleAnimate() { setAnimate(!animateOn); }
    if (camera.reduceQuery) {
      var onMotion = function () { syncAnimate(); emit(); };
      if (camera.reduceQuery.addEventListener) camera.reduceQuery.addEventListener('change', onMotion); else camera.reduceQuery.addListener(onMotion);
    }

    // ---- state -----------------------------------------------------------------------------
    function state() {
      return {
        zoom: camera.zoom(),
        presenting: story.isPresenting(),
        step: story.index(),
        steps: story.count(),
        chapter: story.chapter(),
        playing: story.isPlaying(),
        speed: story.speed(),
        loop: story.loop(),
        animate: animateOn,
        reducedMotion: camera.reduced(),
        selected: trace.selected(),
        route: trace.routed(),
      };
    }
    function emit() { if (options.onChange) options.onChange(state()); }

    // ---- explore: select, close ---------------------------------------------------------------
    // Select `id` (a node, or a group named in a panel row) and bring the camera to it; leaves Play first.
    function pick(id) {
      if (story.isPresenting()) story.exit();
      trace.select(id);
      camera.unfit();
      camera.moveTo(camera.cameraFor(camera.boxOf([id])));
      panel.paint();
      emit();
    }
    // Drop the selection or route. Closed from the keyboard while focus is in the
    // panel, focus goes back to the node it described (a mouse click on Close does
    // not move focus); a focused node under the keyboard blurs, as before, so its
    // focus trace ends too.
    function closeSelection(target, keyboard) {
      var id = trace.selected();
      var r = trace.routed();
      var back = els.nodes[id] || els.groups[id] || (r ? els.nodes[r.from] : null);
      var inPanel = within(doc.activeElement, options.panel);
      var hadFocus = trace.hasFocus();
      trace.clear();
      if (keyboard && inPanel && back && back.focus) back.focus();
      else if (hadFocus && target && target.blur) target.blur(); // focusout clears the focus trace
      panel.paint();
      emit();
    }

    // ---- pointer: pan, pinch, click, hover ------------------------------------------------
    var pointers = {};
    var dragging = false;
    var downAt = null;
    var downTarget = null;
    var lastPinch = 0;

    function pointerCount() { return Object.keys(pointers).length; }
    var stagePoint = function (e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      story.pause(); // a hand on the canvas stops the story (nothing happens when it is not running)
      if (pointerCount() === 1) { downAt = { x: e.clientX, y: e.clientY }; downTarget = e.target; dragging = false; }
      lastPinch = 0;
    });
    stage.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x;
      var dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointerCount() === 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        var r = stage.getBoundingClientRect();
        if (lastPinch > 0 && dist > 0) camera.zoomAt(dist / lastPinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        lastPinch = dist;
        dragging = true;
        return;
      }
      if (!dragging && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_PX) {
        dragging = true;
        stage.classList.add('pa-grabbing');
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer: no capture */ }
        trace.hover(null);
        panel.tipFor(null);
      }
      if (dragging) camera.panBy(-dx, -dy);
    });
    function release(e, cancelled) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      if (pointerCount() > 0) return;
      var wasDrag = dragging;
      dragging = false;
      stage.classList.remove('pa-grabbing');
      if (!wasDrag && !cancelled) click(downTarget);
      downAt = null;
      downTarget = null;
    }
    stage.addEventListener('pointerup', function (e) { release(e, false); });
    stage.addEventListener('pointercancel', function (e) { release(e, true); });

    // In Play a click on the canvas selects nothing (its pointerdown paused the
    // story). In Explore it selects the node or edge under it (again: deselects;
    // empty canvas: deselects).
    function click(target) {
      if (story.isPresenting()) return;
      trace.toggle(trace.idAt(target));
      panel.paint();
      emit();
    }
    stage.addEventListener('dblclick', function () { if (!story.isPresenting()) camera.fit(); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      story.pause();
      var r = stage.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      camera.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerover', function (e) {
      if (dragging) return;
      var id = trace.idAt(e.target);
      var p = stagePoint(e);
      trace.hover(id);
      panel.tipFor(id, p.x, p.y);
    });
    svg.addEventListener('pointermove', function (e) { if (!dragging) { var p = stagePoint(e); panel.tipMove(p.x, p.y); } });
    svg.addEventListener('pointerleave', function () { trace.hover(null); panel.tipFor(null); });
    svg.addEventListener('focusin', function (e) {
      var id = trace.idAt(e.target);
      if (!id) return;
      if (!story.isPresenting()) camera.ensureVisible(id);
      trace.focus(id);
    });
    svg.addEventListener('focusout', function () { trace.focus(null); });

    // ---- keyboard --------------------------------------------------------------------------
    // Space plays and pauses (on the canvas and on every transport control; a
    // button elsewhere keeps Space for itself); arrows, PageUp/PageDown, Home
    // and End move between beats; P enters Play, E leaves it; F fits; A toggles
    // the edge animation; Escape closes the panel, else leaves Play, else clears
    // the trace. In Play any key but Space pauses, in a form field too.
    var KEEPS_PLAYING = { ' ': true, Tab: true, Shift: true, CapsLock: true };
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      var k = e.key;
      var inPlay = story.isPresenting();
      if (inPlay && !KEEPS_PLAYING[k]) story.pause(); // Space is the play/pause key itself; Tab and lone modifiers act on nothing; a form field pauses too
      if (isField(t)) return;
      var inTransport = within(t, options.caption) || within(t, options.chapters);
      var handled = true;
      if (k === 'f' || k === 'F') camera.fit();
      else if (k === '+' || k === '=') camera.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') camera.zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') { if (!inPlay) story.present(0); }
      else if (k === 'e' || k === 'E') story.exit();
      else if (k === 'a' || k === 'A') { if (!camera.reduced()) toggleAnimate(); }
      else if (k === 'Escape') {
        if (trace.selected() || trace.routed()) closeSelection(t, true);
        else if (inPlay) story.exit();
        else if (trace.active()) {
          var hadFocus = trace.hasFocus();
          trace.clear();
          if (hadFocus && t && t.blur) t.blur(); // focusout clears the focus trace
          emit();
        } else handled = false;
      } else if (inPlay && k === ' ' && (!(t && t.tagName === 'BUTTON') || inTransport)) story.togglePlay();
      else if (inPlay && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown')) story.next();
      else if (inPlay && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')) story.prev();
      else if (inPlay && k === 'Home') story.first();
      else if (inPlay && k === 'End') story.last();
      else if (k === 'ArrowLeft') camera.panBy(-PAN_PX, 0);
      else if (k === 'ArrowRight') camera.panBy(PAN_PX, 0);
      else if (k === 'ArrowUp') camera.panBy(0, -PAN_PX);
      else if (k === 'ArrowDown') camera.panBy(0, PAN_PX);
      else if ((k === 'Enter' || k === ' ') && t && t.classList && t.classList.contains('pa-node')) click(t);
      else handled = false;
      if (handled) e.preventDefault();
    }
    (options.keys || stage).addEventListener('keydown', onKey);

    // ---- resize ----------------------------------------------------------------------------
    function onResize() {
      if (story.isPresenting()) story.goTo(story.index()); else camera.onResize();
    }
    if (global.ResizeObserver) new global.ResizeObserver(onResize).observe(stage);
    else global.addEventListener('resize', onResize);

    syncAnimate();
    camera.refit();

    return {
      svg: svg, stage: stage, state: state,
      fit: camera.fit, zoomBy: camera.zoomBy, panBy: camera.panBy,
      select: pick, closePanel: function () { closeSelection(null, false); },
      present: story.present, goTo: story.goTo, next: story.next, prev: story.prev, first: story.first, last: story.last,
      nextChapter: story.nextChapter, prevChapter: story.prevChapter, exit: story.exit, togglePresent: story.togglePresent,
      play: story.play, pause: story.pause, togglePlay: story.togglePlay, setSpeed: story.setSpeed, cycleSpeed: story.cycleSpeed,
      setLoop: story.setLoop, toggleLoop: story.toggleLoop,
      setAnimate: setAnimate, toggleAnimate: toggleAnimate,
    };
  }

  PADiagram.mount = mount;
})(window);
```

Notes for the implementer: `pick` and `closeSelection` are function declarations, so the `panel` hooks above them resolve; `panel` and `transport` are read inside closures that only run after `mount` finished building them. The story's `onStep` calls `trace.clear()` while presenting, so a selection or route never survives into Play and Escape in Play leaves Play (its first branch is false then).

- [ ] **Step 6: Implement the page (`template/viewer.html`, `template/toolbar.js`, `scripts/lib/css.mjs`, `scripts/lib/runtime.mjs`)**

`template/viewer.html` — in the `<style>` block, replace the `.stage` rules and add the panel and tip rules. Replace:

```css
.stage { position: relative; flex: 1 1 0; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
.stage.pa-grabbing { cursor: grabbing; }
.stage > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
```

with:

```css
.body { flex: 1 1 0; min-height: 0; display: flex; }
.stage { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
.stage.pa-grabbing { cursor: grabbing; }
.stage > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.tip { position: absolute; z-index: 2; max-width: 260px; padding: 4px 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 0.8rem; pointer-events: none; overflow-wrap: anywhere; }
.tip[hidden] { display: none; }
.panel { flex: none; width: 300px; min-height: 0; overflow: auto; padding: 12px 16px; background: var(--surface); border-left: 1px solid var(--line); font-size: 0.9rem; }
.panel[hidden] { display: none; }
@media (max-width: 719px) { .body { flex-direction: column; } .panel { width: auto; max-height: 36%; border-left: 0; border-top: 1px solid var(--line); } }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.panel-title { margin: 0; font: 600 1.05rem/1.3 var(--font-display); overflow-wrap: anywhere; }
.panel-body[hidden], .panel-empty[hidden], .panel-close[hidden] { display: none; }
.panel-icon { margin: 8px 0; font-size: 1.6rem; line-height: 1; }
.panel-glyph { width: 24px; height: 24px; color: var(--text-2); }
.panel-kind { margin: 0; color: var(--text-3); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
.panel-note, .panel-detail { margin: 8px 0 0; color: var(--text-2); overflow-wrap: anywhere; }
.panel h3 { margin: 14px 0 4px; color: var(--text-3); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
.panel ul { margin: 0; padding: 0; list-style: none; }
.panel ol { margin: 0; padding-left: 1.4em; }
.panel li { overflow-wrap: anywhere; }
.pa-row { display: block; width: 100%; margin: 0; padding: 4px 6px; background: none; border: 0; border-radius: 6px; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.pa-row:hover { background: var(--accent-soft); }
.panel-arrow, .panel-none { color: var(--text-3); }
```

In the body, replace:

```html
<main class="stage" id="pa-stage">
<!--@SVG-->
</main>
```

with:

```html
<div class="body">
<main class="stage" id="pa-stage">
<!--@SVG-->
<div class="tip" data-pa-tip role="tooltip" hidden></div>
</main>
<aside class="panel" data-pa-panel aria-label="Details">
<div class="panel-head">
<h2 class="panel-title" data-pa-panel-title>Map</h2>
<button type="button" class="tool panel-close" data-pa-panel-close aria-label="Close details (Esc)" hidden>Close</button>
</div>
<div class="panel-body" data-pa-panel-body hidden></div>
</aside>
</div>
```

(The `.panel-kind` text is uppercase through CSS; `textContent` keeps the kind word as the data has it, so tests read `service`.)

`template/toolbar.js:70` — pass the panel and the tip:

```js
  var ctl = window.PADiagram.mount(stage, data, { keys: document, caption: one('[data-pa-caption]'), chapters: one('[data-pa-chapters]'), panel: one('[data-pa-panel]'), tip: one('[data-pa-tip]'), onChange: sync });
```

`template/toolbar.js:100` — the export strips the new state classes:

```js
    clone.querySelectorAll('.pa-hidden,.pa-dim,.pa-on,.pa-hl,.pa-active,.pa-selected,.pa-route').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-dim', 'pa-on', 'pa-hl', 'pa-active', 'pa-selected', 'pa-route'); });
```

`scripts/lib/css.mjs` — in `state`, after the `.pa-edge.pa-active .pa-arrow-open` rule and before `.pa-dot`:

```js
  // Explore: the selected node, group or edge, and a traced route (plain accent; phase 3 styles them)
  '.pa-selected .pa-shape{stroke:var(--accent);stroke-width:2.5}',
  '.pa-selected > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-selected path{stroke:var(--accent);stroke-width:2.5}',
  '.pa-edge.pa-selected .pa-arrow-fill{fill:var(--accent)}',
  '.pa-edge.pa-selected .pa-arrow-open{stroke:var(--accent)}',
  '.pa-route .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-route > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-route path{stroke:var(--accent);stroke-width:2.5}',
  '.pa-edge.pa-route .pa-arrow-fill{fill:var(--accent)}',
  '.pa-edge.pa-route .pa-arrow-open{stroke:var(--accent)}',
```

`scripts/lib/runtime.mjs:7`:

```js
export const RUNTIME_FILES = ['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'viewer.js'];
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/explore-browser.test.mjs test/runtime.test.mjs test/render.test.mjs test/build.test.mjs` — expected: pass. Then `npm test` — green: `browser.test.mjs` (`click pins the trace…`, `Tab walks the toolbar…`, the prototype loop with the new spec), `story-browser.test.mjs`, `check.test.mjs` (the 390 px check passes with the panel stacked under the stage; the story page stays under 400 KB). `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js` — every file under 400. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green (its overlay passes no panel; a click on an inline node now adds `pa-selected`, which make-diagram's stylesheet in the page styles; the recap golden does not change). A golden failure here is a bug in the change, never a reason to regenerate.

- [ ] **Step 8: Guard proofs** (revert each edit before moving on)

1. In `panel.js` `paintNode`, swap `l.sends` and `l.receives` between the two `section(...)` calls; run `node --test --test-name-pattern="a node click opens the panel" test/explore-browser.test.mjs` — expected: FAIL on the `[data-pa-sends] .pa-row` deepEqual. Revert.
2. In `viewer.js` `closeSelection`, delete the line `if (keyboard && inPanel && back && back.focus) back.focus();` and the following `else`; run `--test-name-pattern="returns focus to the node"` — expected: FAIL at `focus is back on the node` (actual `BODY`). Revert.
3. In `panel.js` `tipText`, change the last line to `return it.label;`; run `--test-name-pattern="hover shows a tooltip"` — expected: FAIL at `'API gateway — auth, rate limits'`. Revert.
4. In `toolbar.js`, remove `.pa-selected` from both lists on line 100; run `--test-name-pattern="exports carry no explore state"` — expected: FAIL at `no viewer state on any element`. Revert.
5. In `viewer.js` the story's `onStep`, delete `if (story.isPresenting()) trace.clear();`; run `--test-name-pattern="beat row enters Play"` — expected: FAIL at `entering Play dropped the selection` (title is `taps Buy`). Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 9: Commit**

Message: `feat(make-diagram): explore panel with sends-to, receives-from, edge beats and hover tooltips` — the orchestrator commits; do not run git commit.

---

### Task 5: Shift-click traces the shortest route

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js` (pointerdown, `release`, `click`, the Enter key)
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/explore-browser.test.mjs` (append)

**Interfaces:**
- Consumes: `trace.route(from, to)` and `trace.selected()` (Task 4), `PADiagram.route` (Task 3), `panel.paint` (the route view is already in panel.js).
- Produces: a shift-click (or Shift+Enter on a focused node) with a node selected traces the route from the selection to that node; `ctl.state().route` carries it; `pa-route` on both ends, every hop's ends (groups too) and hop edges, `pa-dim` on the rest; the panel titled `Route` lists `[data-pa-hops] li` as `A → B · label`, says `ignores arrow direction` or `No route between A and B.`.

- [ ] **Step 1: Write the failing tests**

Append to `test/explore-browser.test.mjs`:

```js
// ---- routes (Task 5) --------------------------------------------------------------------------

const routeIds = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-route')].map((e) => e.dataset.id).sort());

test('shift-click traces the shortest route along the arrows: hops listed in order, both ends and the hops lit, the rest dim', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.click('.pa-node[data-id="web"]');
  await page.click('.pa-node[data-id="db"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'Route');
  assert.equal(await page.textContent('.panel-kind'), 'Web app → Orders DB');
  assert.deepEqual(await texts(page, '[data-pa-hops] li'), ['Web app → Checkout API · POST /checkout', 'Checkout API → Orders DB · writes order']);
  assert.equal(await page.locator('.panel-note').count(), 0, 'along the arrows: no caveat');
  assert.deepEqual(await routeIds(page), ['api', 'db', 'edge-0', 'edge-1', 'web']);
  assert.deepEqual(await dimmedNodes(page), ['pay']);
  assert.deepEqual(await selectedIds(page), [], 'a route replaces the selection');
  await page.click('.pa-node[data-id="pay"]');
  assert.equal(await title(page), 'Payments', 'a plain click ends the route and selects');
  assert.deepEqual(await routeIds(page), []);
  assert.deepEqual(problems, []);
  await context.close();
});

test('against the arrows the route ignores direction and says so; Shift+Enter on a focused node routes too', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.click('.pa-node[data-id="pay"]');
  await page.click('.pa-node[data-id="web"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'Route');
  assert.equal(await page.textContent('.panel-note'), 'ignores arrow direction');
  assert.deepEqual(await texts(page, '[data-pa-hops] li'), ['Payments → Checkout API · charges card', 'Checkout API → Web app · POST /checkout']);
  await page.click('.pa-node[data-id="web"]');
  await page.focus('.pa-node[data-id="db"]');
  await page.keyboard.press('Shift+Enter');
  assert.equal(await title(page), 'Route');
  assert.equal(await page.textContent('.panel-kind'), 'Web app → Orders DB');
  await page.keyboard.press('Escape');
  assert.equal(await title(page), 'Map', 'Escape closes the route');
  assert.deepEqual(await routeIds(page), []);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a route through a group names the group and lights it; two nodes nothing joins say so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Via a group', type: 'architecture',
    groups: [{ id: 'g', label: 'The group' }],
    nodes: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C', group: 'g' }, { id: 'b', label: 'B' }, { id: 'd', label: 'D' }],
    edges: [{ from: 'a', to: 'g', label: 'in' }, { from: 'g', to: 'b', label: 'out' }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'via-group' }).url);
  await page.click('.pa-node[data-id="a"]');
  await page.click('.pa-node[data-id="b"]', { modifiers: ['Shift'] });
  assert.deepEqual(await texts(page, '[data-pa-hops] li'), ['A → The group · in', 'The group → B · out']);
  assert.deepEqual(await routeIds(page), ['a', 'b', 'edge-0', 'edge-1', 'g']);
  assert.ok(await page.evaluate(() => document.querySelector('.pa-group[data-id="g"]').classList.contains('pa-route')));
  await page.click('.pa-node[data-id="a"]');
  await page.click('.pa-node[data-id="d"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'Route');
  assert.equal(await page.textContent('.panel-note'), 'No route between A and D.');
  assert.equal(await page.locator('[data-pa-hops]').count(), 0);
  assert.deepEqual(await routeIds(page), ['a', 'd'], 'both ends stay lit');
  assert.deepEqual(problems, []);
  await context.close();
});

test('shift-click with nothing selected, on the selected node itself, or on an edge selects instead of routing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-node[data-id="app"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'Mobile app', 'nothing was selected: a plain select');
  await page.click('.pa-node[data-id="app"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'Map', 'the same node: toggled off');
  await page.click('.pa-node[data-id="app"]');
  await page.click('.pa-edge-label[data-edge="place"]', { modifiers: ['Shift'] });
  assert.equal(await title(page), 'POST /orders', 'an edge is selected, never routed to');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a route export carries no pa-route', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.click('.pa-node[data-id="web"]');
  await page.click('.pa-node[data-id="db"]', { modifiers: ['Shift'] });
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  assert.ok(!/class="[^"]*\bpa-(selected|route|dim|on)\b/.test(text));
  assert.deepEqual(problems, []);
  await context.close();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test --test-name-pattern="route|shift-click" test/explore-browser.test.mjs`
Expected: the first three fail at `title(page) === 'Route'` (actual `Orders DB`, `Web app`, `B`: a shift-click only toggled the selection); `shift-click with nothing selected…` passes already (a plain select is today's behaviour); `a route export…` passes (nothing was routed).

- [ ] **Step 3: Implement**

`template/viewer.js` — remember Shift at pointerdown and hand it to the click. Declare the variable with the pointer state:

```js
    var downTarget = null;
    var downShift = false;
```

In `pointerdown`:

```js
      if (pointerCount() === 1) { downAt = { x: e.clientX, y: e.clientY }; downTarget = e.target; downShift = e.shiftKey; dragging = false; }
```

In `release`:

```js
      if (!wasDrag && !cancelled) click(downTarget, downShift);
```

Replace `click`:

```js
    // In Play a click on the canvas selects nothing (its pointerdown paused the
    // story). In Explore it selects the node or edge under it (again: deselects;
    // empty canvas: deselects); with Shift and a node already selected, it asks
    // for the route from that node to this one.
    function click(target, shift) {
      if (story.isPresenting()) return;
      var id = trace.idAt(target);
      var from = trace.selected();
      if (shift && id && from && id !== from && els.nodes[id] && els.nodes[from]) trace.route(from, id);
      else trace.toggle(id);
      panel.paint();
      emit();
    }
```

The Enter key line:

```js
      else if ((k === 'Enter' || k === ' ') && t && t.classList && t.classList.contains('pa-node')) click(t, e.shiftKey);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/explore-browser.test.mjs` — expected: pass. Then `npm test` — green. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green.

- [ ] **Step 5: Guard proofs** (revert each edit before moving on)

1. In `route.js`, change the last line of `PADiagram.route` to `return { from: from, to: to, hops: hops || [], directed: true };`; run `node --test --test-name-pattern="against the arrows" test/explore-browser.test.mjs` — expected: FAIL at `.panel-note` (no element; the note is missing). Also `node --test test/route.test.mjs` fails. Revert.
2. In `explore.js` `paintRoute`, change both `'pa-route'` strings to `'pa-rout'`; run `--test-name-pattern="shift-click traces"` — expected: FAIL at the `routeIds` deepEqual (actual `[]`). Revert.
3. In `viewer.js` `click`, change `els.nodes[id] && els.nodes[from]` to `true`; run `--test-name-pattern="selects instead of routing"` — expected: FAIL at `an edge is selected, never routed to`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 6: Commit**

Message: `feat(make-diagram): shift-click traces the shortest route, with an undirected fallback` — the orchestrator commits; do not run git commit.

---

### Task 6: Find box, count chips and the hint

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.html` (the Find input in the tools, the results row, the empty-state block)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js` (Find wiring, `/`, Escape clears the filter, `found` holder)
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/toolbar.js:70`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/explore-browser.test.mjs` (append), `test/build.test.mjs:141`

**Interfaces:**
- Consumes: `trace.find(text)`, `trace.finding()`, `trace.counts()`, `panel.found(hits, query)` (Task 4), `pick(id)` (Task 4).
- Produces: `PADiagram.mount` options `find` (the `<input>`) and `found` (the results row); `/` focuses Find (not typed); typing filters the canvas (`pa-dim` on non-matching nodes and on edges not between two matches) and lists up to 8 `button.pa-chip[data-pa-pick="<id>"]` in `[data-pa-found]` (or `span.panel-none` "No node matches"); Enter selects the first match and fits the camera (leaving Play first); Escape in the field clears it; Escape on the stage clears a lingering filter when nothing else is open. `[data-pa-empty]` holds `[data-pa-tally]` (`span.pa-chip[role=listitem]` per count) and `p.hint`.

- [ ] **Step 1: Write the failing tests**

Append to `test/explore-browser.test.mjs`:

```js
// ---- Find and the count chips (Task 6) --------------------------------------------------------

const chips = (page) => texts(page, '[data-pa-tally] .pa-chip');
const foundTexts = (page) => texts(page, '[data-pa-found] .pa-chip');

test('nothing selected: count chips by kind, the stories and the beats, and the hint; a walkthrough has no stories chip', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const story = await openPage(built('story').url);
  assert.deepEqual(await chips(story.page), ['1 user', '1 client', '1 gateway', '1 service', '1 database', '1 queue', '1 external', '2 stories', '9 beats']);
  assert.equal(await story.page.textContent('[data-pa-empty] .hint'), 'Click a node or edge. Shift-click a second node to trace a path.');
  await story.page.click('.pa-node[data-id="orders"]');
  assert.equal(await story.page.isHidden('[data-pa-empty]'), true, 'the empty state gives way to the selection');
  await story.page.click('[data-pa-panel-close]');
  assert.equal(await story.page.isVisible('[data-pa-empty]'), true);
  assert.deepEqual(story.problems, []);
  await story.context.close();

  const arch = await openPage(built('architecture').url);
  assert.deepEqual(await chips(arch.page), ['1 client', '1 service', '1 database', '1 external', '3 beats'], 'groups are not a kind; a step-derived timeline is not a story');
  await arch.context.close();
});

test('/ focuses Find; typing filters the canvas and lists matches; Enter selects the first and fits the camera; a chip picks; Escape clears', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isHidden('[data-pa-found]'), true);
  await page.keyboard.press('/');
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('[data-pa-find]')), '/ focuses the box');
  assert.equal(await page.inputValue('[data-pa-find]'), '', 'and is not typed into it');
  await page.keyboard.type('or');
  assert.deepEqual(await foundTexts(page), ['Orders service', 'Orders DB']);
  assert.deepEqual(await dimmedNodes(page), ['app', 'bus', 'gateway', 'shopper', 'warehouse']);
  const litEdges = await page.evaluate(() => [...document.querySelectorAll('.pa-edge:not(.pa-dim)')].map((e) => e.dataset.id));
  assert.deepEqual(litEdges, ['edge-3'], 'only the edge between two matches stays lit');
  await page.keyboard.press('Enter');
  assert.equal(await title(page), 'Orders service', 'Enter selects the first match');
  assert.deepEqual(await selectedIds(page), ['orders']);
  await settle(page);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['orders'])), 'and fits the camera on it');
  await page.focus('[data-pa-find]');
  await page.keyboard.press('Escape');
  assert.equal(await page.inputValue('[data-pa-find]'), '', 'Escape in the box clears it');
  assert.equal(await page.isHidden('[data-pa-found]'), true);
  assert.ok(await page.evaluate(() => document.activeElement !== document.querySelector('[data-pa-find]')), 'and leaves it');
  assert.equal(await title(page), 'Orders service', 'the selection stays');
  await page.fill('[data-pa-find]', 'bus');
  await page.click('[data-pa-pick="bus"]');
  assert.equal(await title(page), 'Event bus', 'a result chip picks its node');
  await page.fill('[data-pa-find]', 'zz');
  assert.deepEqual(await texts(page, '[data-pa-found] .panel-none'), ['No node matches']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('Find matches regex characters literally; a match found while in Play leaves Play; Escape on the stage clears a lingering filter', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Caches', type: 'architecture',
    nodes: [{ id: 'hot', label: 'Cache [hot]', kind: 'cache' }, { id: 'cold', label: 'Cache (cold)', kind: 'cache' }, { id: 'api', label: 'API' }],
    edges: [{ from: 'api', to: 'hot' }, { from: 'api', to: 'cold' }],
    stories: [{ id: 's', title: 'S', beats: [{ title: 'Warm', from: 'api', to: 'hot' }] }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'find-regex' }).url);
  await page.fill('[data-pa-find]', '[h');
  assert.deepEqual(await foundTexts(page), ['Cache [hot]']);
  await page.fill('[data-pa-find]', '(c');
  assert.deepEqual(await foundTexts(page), ['Cache (cold)']);
  await page.fill('[data-pa-find]', 'CACHE');
  assert.deepEqual(await foundTexts(page), ['Cache [hot]', 'Cache (cold)'], 'case does not matter');
  assert.deepEqual(await dimmedNodes(page), ['api']);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Escape');
  assert.deepEqual(await dimmedNodes(page), [], 'Escape on the stage clears the filter');
  assert.equal(await page.inputValue('[data-pa-find]'), '');
  await page.keyboard.press('p');
  assert.equal(await page.isVisible('[data-pa-caption]'), true);
  await page.fill('[data-pa-find]', 'cold');
  await page.keyboard.press('Enter');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'picking a match leaves Play');
  assert.equal(await title(page), 'Cache (cold)');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Tab still reaches the nodes after the Find box', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('flow').url);
  let reached = false;
  for (let i = 0; i < 24 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => !!document.activeElement?.classList?.contains('pa-node'));
  }
  assert.ok(reached, 'a node takes focus within 24 Tabs');
  assert.deepEqual(problems, []);
  await context.close();
});
```

`test/build.test.mjs:141` — add `'data-pa-find'`, `'data-pa-found'`, `'data-pa-empty'`, `'data-pa-tally'` to the hook list.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test --test-name-pattern="count chips|Find|Tab still" test/explore-browser.test.mjs test/build.test.mjs`
Expected: `nothing selected: count chips…` fails at the first `chips` deepEqual (actual `[]`: no `[data-pa-tally]`); `/ focuses Find…` fails at `page.isHidden('[data-pa-found]')` (no element: Playwright reports hidden as `true` for a missing element, so the failure lands at `/ focuses the box`); `Find matches regex…` fails at `page.fill` with `Timeout … waiting for locator('[data-pa-find]')`; `Tab still reaches the nodes` passes already; `build.test.mjs` fails at `data-pa-find`.

- [ ] **Step 3: Implement**

`template/viewer.html` — in the tools, before the Export group:

```html
<input type="search" class="find" data-pa-find placeholder="Find a node" aria-label="Find a node (/)" autocomplete="off" spellcheck="false">
```

After the `.chapters` row inside `<header class="bar">`:

```html
<div class="found" data-pa-found role="group" aria-label="Matching nodes" hidden></div>
```

In the panel, between `.panel-head` and `.panel-body`:

```html
<div class="panel-empty" data-pa-empty>
<div class="counts" data-pa-tally role="list" aria-label="What the map holds"></div>
<p class="hint">Click a node or edge. Shift-click a second node to trace a path.</p>
</div>
```

In the `<style>` block, after `.pa-chip[aria-current="true"] …`:

```css
.find { font: inherit; color: inherit; width: 11em; padding: 4px 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.bar .found { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 6px; }
.found[hidden] { display: none; }
.counts { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.hint { margin: 8px 0 0; color: var(--text-2); }
```

`template/viewer.js` — the mount header comment gains `find` and `found`:

```js
//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, chapters, panel, tip, find, found, onChange });
```

```js
// find          the Find <input> (optional); found: the row its matches go in (optional).
```

and the keys line: `// it, / focuses Find, Escape closes the panel, else leaves Play, else clears.`

In `mount`, after `var els = elementsOf(svg);`:

```js
    var findEl = options.find || null;
```

The panel holders pass the results row: `{ panel: options.panel || null, tip: options.tip || null, found: options.found || null }`.

After `closeSelection`, the Find wiring:

```js
    function applyFind() { panel.found(trace.find(findEl.value), findEl.value); emit(); }
    function clearFind() {
      if (findEl) findEl.value = '';
      trace.find('');
      panel.found([], '');
      emit();
    }
    if (findEl) {
      findEl.addEventListener('input', applyFind);
      // The field keeps its own keys: onKey below steps aside for form fields.
      findEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var hits = trace.find(findEl.value);
          if (hits.length) { e.preventDefault(); pick(hits[0].id); }
        } else if (e.key === 'Escape') { e.preventDefault(); clearFind(); findEl.blur(); }
      });
    }
```

In `onKey`, after the `a`/`A` branch:

```js
      else if (k === '/' && findEl) findEl.focus();
```

and in the Escape branch, between `else if (inPlay) story.exit();` and `else if (trace.active()) {`:

```js
        else if (trace.finding()) clearFind();
```

Update the keyboard comment: `// the edge animation; / focuses Find; Escape closes the panel, else leaves` / `// Play, else clears the Find filter, else clears the trace. In Play any key` / `// but Space pauses, in a form field too.`

`template/toolbar.js:70`:

```js
  var ctl = window.PADiagram.mount(stage, data, { keys: document, caption: one('[data-pa-caption]'), chapters: one('[data-pa-chapters]'), panel: one('[data-pa-panel]'), tip: one('[data-pa-tip]'), find: one('[data-pa-find]'), found: one('[data-pa-found]'), onChange: sync });
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && node --test test/explore-browser.test.mjs test/build.test.mjs` — expected: pass. Then `npm test` — green (`browser.test.mjs` `Tab walks the toolbar…` still finds two nodes within 20 Tabs: the toolbar has ten stops now; `check.test.mjs` 390 px). `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js` — every file under 400; `viewer.html` under 400 too. Then `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green. From the repo root: `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — green (shared untouched).

- [ ] **Step 5: Guard proofs** (revert each edit before moving on)

1. In `explore.js` `find`, change `isNode(id) &&` to `!isNode(id) &&`; run `node --test --test-name-pattern="focuses Find" test/explore-browser.test.mjs` — expected: FAIL at the `foundTexts` deepEqual (actual `[]`). Revert.
2. In `explore.js` `counts`, delete the `if (beats.length && beats[0].kind !== 'step') out.push(…)` line; run `--test-name-pattern="count chips"` — expected: FAIL at the first `chips` deepEqual (no `2 stories`). Revert.
3. In `viewer.js`, delete the `else if (k === '/' && findEl) findEl.focus();` line; run `--test-name-pattern="focuses Find"` — expected: FAIL at `/ focuses the box`. Revert.
4. In `viewer.js` the Find `keydown` handler, delete the `Enter` branch; run `--test-name-pattern="regex characters"` — expected: FAIL at `picking a match leaves Play`. Revert.

Run `npm test` once more after the reverts — green.

- [ ] **Step 6: Commit**

Message: `feat(make-diagram): find box, count chips and the explore hint` — the orchestrator commits; do not run git commit.

---

## Phase 2 close-out

After Task 6, with everything on disk:

- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-diagram && npm test` — green.
- `cd /Users/abhijitbansal/projects/claude-skills/plugins/portable-artifacts/skills/make-explainer && npm test` — green with no golden regeneration (the recap golden does not change in this phase).
- `cd /Users/abhijitbansal/projects/claude-skills && node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` — green (nothing in `shared/` changed, so `node bin/sync-shared.mjs` was not run).
- `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js plugins/portable-artifacts/skills/make-diagram/template/viewer.html` — every file under 400; the built story example under 400 KB (`check.test.mjs`).
- Spec coverage this phase delivers (§2 Explore): hover tooltip "label — note"; node panel with emoji or icon, kind in small caps, label, note, detail, Sends to / Receives from (edge label and the other end; a click jumps and selects); upstream and downstream highlighted while selected; edge panel with label, both ends, style and Used in (a click enters Play at that beat); shift-click shortest route along arrows, the undirected fallback that says so, "no route" said; Find filtering as you type with Enter or a click fitting and selecting; count chips and the hint when nothing is selected; keys `/` and Escape-closes-the-panel-first; nodes reachable with Tab, Enter opens the panel, closing returns focus. Deferred phase-2 findings fixed (Task 1, Task 2). Left to later phases: the look (3: the panel, chips, tooltip and the selected/route styling are plain here), full screen, the make-explainer overlay mounting the panel, docs, eval, the gallery sample (4).
- Then a fresh reviewer reads the phase diff and reports every finding (the report-everything sentence from `code-review.md` goes in its prompt); CRITICAL and HIGH findings are fixed before the orchestrator commits and pushes.

## Commit parts

Consecutive groups; each leaves every suite green and is one coherent commit.

| part | tasks | commit |
|---|---|---|
| A | Task 1 | `fix(make-diagram): Space on the transport is play/pause; the scrubber pauses and announces its beat` |
| B | Tasks 2, 3, 4 | `feat(make-diagram): explore panel with sends-to, receives-from, edge beats and hover tooltips` (body: `info` names groups and keys edges by id; `route.js` added) |
| C | Tasks 5, 6 | `feat(make-diagram): shift-click routes, the find box and count chips` |

If the orchestrator prefers one commit per task, the per-task messages above apply as written.

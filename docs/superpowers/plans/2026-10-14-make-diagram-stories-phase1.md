# make-diagram stories — Phase 1 Implementation Plan (spec format and story player)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `diagram.json` gains `stories` (chapters of beats), `emoji`, `detail` and `autoplay`; the build resolves every beat to an edge id and direction and ships the timeline in the page data; the viewer runtime is split into modules and gains a story player with a transport bar, chapter and beat chips, a travelling dot, speed, loop, autoplay and the keyboard map.

**Architecture:** Validation grows in `scripts/lib/stories.mjs` (sharing the error helpers moved into `checks.mjs`); `beatsOf` turns stories (or the older `steps`) into `viewerData.beats`/`chapters`; `data.mjs` adds `info` and `directed` for phase 2. The 521-line `template/viewer.js` is split first, behaviour-preserving, into `camera.js`, `explore.js` (the trace), `story.js`, `transport.js` and a slim `viewer.js` that composes them (`scripts/lib/runtime.mjs` fixes the inline order); then `story.js`/`transport.js` are rewritten around beats and the page gets tabs and the transport. The look is untouched (phase 3): the dot and the active edge get one plain accent rule each.

**Tech Stack:** Node ≥ 20 ESM, `node --test`, `ajv@8.20.0`, `elkjs@0.12.0`, Playwright 1.64 (dev). Browser code is ES5-style IIFEs inlined into the page. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-14-make-diagram-stories-design.md` §1, §2, §4 and phase 1 of §5. Master plan: `docs/superpowers/plans/2026-10-14-make-diagram-stories.md` (file map, contracts, decisions 1–15).

## Global Constraints

- Branch `feat/diagram-stories`. Implementers do **not** run `git commit`/`git push`; each task ends with the commit message and the orchestrator commits.
- Plain ESM Node (Node 20); no new npm dependencies. Page code: no inline event handlers, no `eval`/`new Function`, no external requests; CSP stays `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`.
- Every file under `template/` stays under 400 lines; every other file under 800 (`test/runtime.test.mjs` pins the template budget).
- `scripts/lib/api.mjs` exports exactly `buildDiagram`, `validateSpec`, `viewerRuntime` (pinned by `test/api.test.mjs`); new helpers go in other modules.
- Existing `viewerData` keys keep their shapes; new keys are additive: `autoplay`, `beats`, `chapters`, `info`, `directed`.
- Limits (spec §1): `stories` ≤ 8, beats in all ≤ 60, story title ≤ 40, beat title ≤ 48, caption ≤ 160, `detail` ≤ 400, `emoji` exactly one emoji grapheme.
- Errors: JSON path, problem, fix, did-you-mean over closed sets; the same wording style as spec.mjs (`label is 53 characters; the limit is 48 — shorten it`, `"apii" not found; did you mean "api"?`).
- Every existing test stays green except where the spec changes behaviour (Space is play/pause, a canvas click pauses instead of stepping, the data key lists grow, the `[data-pa-title]`/`[data-pa-note]` page elements give way to `[data-pa-line]`). Each such change is named in its task.
- The look stays as it is: no new colours, fonts or layout rules beyond a plain `.pa-dot` and `.pa-active` accent rule and plain transport markup.
- Timings (spec §2): glide 600 ms, dot 1200 ms, hold 2500 ms + 40 ms per caption character capped at 6000 ms, all divided by the speed (0.5×, 1×, 1.5×, 2×). Reduced motion: no dot, instant camera, `autoplay` ignored.
- Verification commands (exact): `cd plugins/portable-artifacts/skills/make-diagram && npm test`; `cd plugins/portable-artifacts/skills/make-explainer && npm test`; `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (repo root); `python3 -m pytest -q` (repo root); `cd plugins/portable-artifacts && node bin/sync-shared.mjs --check`. One test file: `node --test test/<file>.test.mjs` from the skill folder.

## Review Focus

1. **A reply pair** (`gateway → orders` and `orders → gateway` both exist) named by `from`/`to`: the direction given plays forward, never an ambiguity error; only a missing direction plays in reverse. Pinned in Task 2 (`resolveEnds`) and Task 3 (the story example's beats 3 and 5).
2. **A hop or focus whose id is a group**: the camera box is the group's box, members light with it, and the dot still finds the edge path. Pinned in Task 3 (`ids` holds the group id) and Task 5 (the focus-on-`core` browser test; `resolveEnds('g', 'a')` in Task 2).
3. **Ids named like `Object.prototype` members** in stories, beats, `info` and `directed`. Pinned in Task 3 (`test/ids.test.mjs` loops `info` and `directed`) and Task 5 (`PROTOTYPE_NAMED_SPECS` gains a story whose id and node are `constructor`).
4. **A one-beat timeline**: prev/next/Home/End clamp, the scrubber has `max="0"`, play ends at once, loop replays. Pinned in Task 5 (clamp) and Task 6 (play, loop).
5. **Hostile text** (`<b>&"x"`) in story titles, beat titles and captions reaches the caption line and every chip as text. Pinned in Task 5.

---

### Task 1: `emoji`, `detail` and `autoplay` fields

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/schema.mjs`
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/emoji.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/spec.mjs`
- Create: `plugins/portable-artifacts/skills/make-diagram/test/emoji.test.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/test/spec.test.mjs`

**Interfaces:**
- Produces: `emoji.mjs` → `graphemeCount(text): number`, `isOneEmoji(text): boolean`.
- Produces: `LIMITS` gains `stories: 8, beats: 60, detail: 400, storyTitle: 40, beatTitle: 48, caption: 160` (Task 2 reads the story ones).
- Produces: schema accepts root `autoplay` (boolean) and `emoji`/`detail` (text) on `nodes[]` and `participants[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/emoji.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOneEmoji, graphemeCount } from '../scripts/lib/emoji.mjs';

test('one emoji: a pictograph, with a skin tone, a ZWJ family, a flag, a keycap, a variation selector', () => {
  for (const s of ['🛒', '👍🏽', '👨‍👩‍👧', '🧑‍💻', '🇯🇵', '1️⃣', '#️⃣', '❤️', '🏳️‍🌈']) assert.equal(isOneEmoji(s), true, s);
});

test('not one emoji: letters, digits, two emoji, a lone regional indicator, a trailing space, empty', () => {
  for (const s of ['A', 'ab', 'ok', '1', '#', '👍👍', '🇯', '💳 ', '', ' ']) assert.equal(isOneEmoji(s), false, JSON.stringify(s));
});

test('graphemeCount counts what a reader sees as one character', () => {
  assert.equal(graphemeCount('👨‍👩‍👧'), 1);
  assert.equal(graphemeCount('🇯🇵'), 1);
  assert.equal(graphemeCount('👍👍'), 2);
  assert.equal(graphemeCount('ab'), 2);
  assert.equal(graphemeCount(''), 0);
});
```

Append to `test/spec.test.mjs` (after the "edges between a group and its own contents" tests):

```js
// ---- emoji, detail, autoplay -------------------------------------------------

test('emoji: one emoji grapheme is valid on nodes and participants; text and two emoji are not', async () => {
  for (const emoji of ['🛒', '👍🏽', '👨‍👩‍👧', '🇯🇵', '1️⃣']) {
    assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].emoji = emoji; }), [], emoji);
    assert.deepEqual(await mutated('sequence', (s) => { s.participants[0].emoji = emoji; }), [], emoji);
  }
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].emoji = 'A'; }), [{ path: 'nodes[0].emoji', message: '"A" is not an emoji; use exactly one emoji, like "🛒"' }]);
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].emoji = '👍👍'; }), [{ path: 'nodes[0].emoji', message: '"👍👍" is 2 characters; use exactly one emoji, like "🛒"' }]);
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].emoji = 'ok'; }), [{ path: 'nodes[0].emoji', message: '"ok" is 2 characters; use exactly one emoji, like "🛒"' }]);
  assert.deepEqual(await mutated('sequence', (s) => { s.participants[1].emoji = '1'; }), [{ path: 'participants[1].emoji', message: '"1" is not an emoji; use exactly one emoji, like "🛒"' }]);
});

test('emoji on a kind drawn as a bare shape is rejected like an icon', async () => {
  const flow = await mutated('flow', (s) => { s.nodes[1].kind = 'decision'; s.nodes[1].emoji = '🛒'; });
  assert.deepEqual(flow, [{ path: 'nodes[1].emoji', message: 'kind "decision" is drawn as a shape without an icon; remove emoji or use kind "step"' }]);
  const state = await mutated('state', (s) => { s.nodes[1].kind = 'choice'; s.nodes[1].emoji = '🛒'; });
  assert.deepEqual(state, [{ path: 'nodes[1].emoji', message: 'kind "choice" is drawn as a shape without an icon; remove emoji or use kind "state"' }]);
});

test('emoji and icon may both be set (the emoji is the one drawn)', async () => {
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[1].emoji = '🧾'; }), []); // nodes[1] already carries icon brand:nodedotjs
});

test('detail is plain text up to 400 characters', async () => {
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].detail = 'd'.repeat(400); }), []);
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].detail = 'd'.repeat(401); }), [{ path: 'nodes[0].detail', message: 'detail is 401 characters; the limit is 400 — shorten it' }]);
  assert.deepEqual(await mutated('sequence', (s) => { s.participants[2].detail = 'd'.repeat(401); }), [{ path: 'participants[2].detail', message: 'detail is 401 characters; the limit is 400 — shorten it' }]);
  assert.deepEqual(await mutated('architecture', (s) => { s.nodes[0].detail = '  '; }), [{ path: 'nodes[0].detail', message: 'must contain at least one non-space character' }]);
});

test('autoplay is a boolean', async () => {
  assert.deepEqual(await mutated('flow', (s) => { s.autoplay = true; }), []);
  assert.deepEqual(await mutated('flow', (s) => { s.autoplay = 'yes'; }), [{ path: 'autoplay', message: 'must be boolean' }]);
});
```

Also change the existing expectation in `unknown property inside a node is rejected` (spec.test.mjs:69) to the new allowed list:

```js
  assert.match(e[0].message, /^unknown property; allowed: id, label, kind, icon, group, note, tone, emoji, detail$/);
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `plugins/portable-artifacts/skills/make-diagram`): `node --test test/emoji.test.mjs test/spec.test.mjs`
Expected: `emoji.test.mjs` fails with `Cannot find module '…/scripts/lib/emoji.mjs'`; in spec.test.mjs the new tests fail with `unknown property; allowed: id, label, kind, icon, group, note, tone` (emoji is rejected by the schema) and `autoplay` with `unknown property`; the edited allowed-list test fails too.

- [ ] **Step 3: Implement**

`scripts/lib/schema.mjs` — replace `LIMITS` and extend the schema:

```js
export const LIMITS = Object.freeze({
  nodes: 60,
  edges: 120,
  steps: 25,
  participants: 12,
  messages: 60,
  stories: 8,
  beats: 60,
  title: 120,
  subtitle: 160,
  label: 48,
  note: 60,
  detail: 400,
  edgeLabel: 40,
  stepTitle: 60,
  stepNote: 200,
  storyTitle: 40,
  beatTitle: 48,
  caption: 160,
  groupDepth: 3,
});
```

In `SCHEMA`: after `animate: { type: 'boolean' },` add `autoplay: { type: 'boolean' },`. In `nodes.items` change the property list to `id: text, label: text, kind: text, icon: text, group: text, note: text, tone: { enum: TONES }, emoji: text, detail: text,`. In `participants.items`: `{ id: text, label: text, kind: text, icon: text, emoji: text, detail: text }`.

Create `scripts/lib/emoji.mjs`:

```js
// What `emoji` may hold: exactly one emoji grapheme. Intl.Segmenter counts the
// graphemes a reader sees; the rest of the rule says what the one grapheme may
// be made of (a pictograph with its modifiers and joins, a two-letter flag, a
// keycap). Symbols Unicode lists as pictographs (©, ™) pass; that is the letter
// of the rule, not a bug.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Characters that ride along inside one emoji: ZWJ, variation selector 16, the
// keycap combiner, skin tones and the tag letters of subdivision flags.
const MODIFIER = /^[‍️⃣\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const REGION = /^\p{Regional_Indicator}$/u;
const KEYCAP_BASE = /^[0-9#*]$/;

/** Number of graphemes in `text` (a flag or a family is 1; "ab" is 2). */
export function graphemeCount(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** True when `text` is exactly one emoji. */
export function isOneEmoji(text) {
  if (graphemeCount(text) !== 1) return false;
  const base = [...text].filter((c) => !MODIFIER.test(c));
  if (base.length === 0) return false;
  if (base.every((c) => REGION.test(c))) return base.length === 2;
  if (text.includes('⃣')) return base.length === 1 && KEYCAP_BASE.test(base[0]);
  return base.every((c) => PICTO.test(c));
}
```

`scripts/lib/spec.mjs` — add the import and the check, and extend `checkEntity`:

```js
import { isOneEmoji, graphemeCount } from './emoji.mjs';
```

```js
// One emoji in the icon tile. The grapheme rule lives in emoji.mjs; here the
// kind must have a tile at all (the same rule as checkIcon).
function checkEmoji(errors, item, p, type) {
  if (item.emoji === undefined) return;
  const at = pathJoin(p, 'emoji');
  if (item.kind !== undefined && Object.hasOwn(KINDS[type].kinds, item.kind) && !canHoldIcon(type, item.kind)) {
    errors.push({ path: at, message: `kind ${q(item.kind)} is drawn as a shape without an icon; remove emoji or use kind ${q(KINDS[type].default)}` });
    return;
  }
  if (isOneEmoji(item.emoji)) return;
  const n = graphemeCount(item.emoji);
  const problem = n === 1 ? `${q(item.emoji)} is not an emoji` : `${q(item.emoji)} is ${n} characters`;
  errors.push({ path: at, message: `${problem}; use exactly one emoji, like "🛒"` });
}

// Kind, icon, emoji and the text limits shared by nodes and participants.
function checkEntity(errors, item, p, type, noteField) {
  checkKind(errors, item, p, type);
  checkIcon(errors, item, p, type);
  checkEmoji(errors, item, p, type);
  checkLength(errors, item, 'label', p, LIMITS.label);
  if (noteField) checkLength(errors, item, noteField, p, LIMITS.note);
  checkLength(errors, item, 'detail', p, LIMITS.detail);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test test/emoji.test.mjs test/spec.test.mjs` — expected: all pass. Then `npm test` — expected: green (no other test lists node properties).

- [ ] **Step 5: Commit**

Message: `feat(make-diagram): emoji, detail and autoplay fields` — the orchestrator commits; do not run git commit.

---

### Task 2: `stories` validation and beat target resolution

**Files:**
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/checks.mjs` (helpers moved out of spec.mjs, unchanged behaviour)
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/stories.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/schema.mjs` (the `stories` schema)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/spec.mjs` (import the helpers; call `checkStories`; the stories-and-steps error)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/layout-graph.mjs:193` (`export function edgeIds`)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/stories.test.mjs`

**Interfaces:**
- Consumes: `LIMITS.stories/beats/storyTitle/beatTitle/caption` (Task 1), `edgeIds(spec)` (layout-graph.mjs: authored id, else `edge-<i>`, `_` appended while taken).
- Produces: `checks.mjs` → `suggestion(value, candidates, label)`, `notFound(id, candidates, what)`, `checkLength(errors, item, field, base, limit)`, `checkCount(errors, spec, field, limit)`, `checkRefs(errors, ids, base, candidates)`, `registerIds(errors, lists, seen = new Map())`.
- Produces: `stories.mjs` → `linksOf(spec)`, `resolveEnds(from, to, links, what = 'edge')`, `checkStories(errors, spec, { endpoints, known })`. Task 3 adds `beatsOf`.

- [ ] **Step 1: Write the failing tests**

Create `test/stories.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { linksOf, resolveEnds } from '../scripts/lib/stories.mjs';

const errorsOf = async (spec) => (await validateSpec(spec, { layout: false })).errors;

// a -> b (named "ab"), b -> c, c -> b (a reply pair), a -> group g; d stands alone.
const graph = (stories, extra = {}) => ({
  title: 'T',
  type: 'architecture',
  groups: [{ id: 'g', label: 'G' }],
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'g' }, { id: 'c', label: 'C', group: 'g' }, { id: 'd', label: 'D' }],
  edges: [{ id: 'ab', from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }, { from: 'a', to: 'g' }],
  stories,
  ...extra,
});
const story = (beats, id = 's1') => ({ id, title: 'Story', beats });
const beat = (target, title = 'Beat') => ({ title, ...target });

test('linksOf names unnamed edges edge-<i>, as the layout does, and carries both', () => {
  assert.deepEqual(linksOf(graph([])), [
    { id: 'ab', from: 'a', to: 'b', both: false },
    { id: 'edge-1', from: 'b', to: 'c', both: false },
    { id: 'edge-2', from: 'c', to: 'b', both: false },
    { id: 'edge-3', from: 'a', to: 'g', both: false },
  ]);
  const spec = graph([]);
  spec.edges[0].both = true;
  assert.equal(linksOf(spec)[0].both, true);
  assert.deepEqual(linksOf({ type: 'sequence', messages: [{ id: 'm1', from: 'x', to: 'y' }] }), [{ id: 'm1', from: 'x', to: 'y', both: false }]);
});

test('resolveEnds: the direction given wins; the other way plays in reverse; none or several ask for edge', () => {
  const links = linksOf(graph([]));
  assert.deepEqual(resolveEnds('b', 'c', links), { link: links[1], reverse: false });
  assert.deepEqual(resolveEnds('c', 'b', links), { link: links[2], reverse: false }, 'a reply pair is never ambiguous');
  assert.deepEqual(resolveEnds('b', 'a', links), { link: links[0], reverse: true });
  assert.deepEqual(resolveEnds('g', 'a', links), { link: links[3], reverse: true }, 'a group end works like a node');
  assert.deepEqual(resolveEnds('a', 'd', links), { error: 'no edge between "a" and "d"; add one, or name an edge with "edge"' });
  const twice = [...links, { id: 'again', from: 'a', to: 'b', both: false }];
  assert.deepEqual(resolveEnds('a', 'b', twice), { error: '2 edges connect "a" and "b" (ab, again); name one with "edge"' });
  assert.deepEqual(resolveEnds('b', 'a', twice), { error: '2 edges connect "b" and "a" (ab, again); name one with "edge"' }, 'reverse candidates can be ambiguous too');
  const m1 = { id: 'm1', from: 'y', to: 'x', both: false };
  assert.deepEqual(resolveEnds('x', 'y', [m1], 'message'), { link: m1, reverse: true });
  assert.equal(resolveEnds('x', 'x', [], 'message').error, 'no message between "x" and "x"; add one, or name a message with "edge"');
});

test('a valid story: hops by edge, by from/to forwards and backwards, and a focus shot', async () => {
  const spec = graph([story([beat({ edge: 'ab' }), beat({ from: 'b', to: 'c' }), beat({ from: 'b', to: 'a' }), beat({ focus: ['g', 'd'] })])]);
  assert.deepEqual(await errorsOf(spec), []);
});

test('a beat needs exactly one target', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({})])])), [{ path: 'stories[0].beats[0]', message: 'a beat needs one target: "edge", "from" and "to", or "focus"' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab', focus: ['a'] })])])), [{ path: 'stories[0].beats[0]', message: 'a beat takes one target; this one has "edge" and "focus" — keep one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab', from: 'a', to: 'b', focus: ['a'] })])])), [{ path: 'stories[0].beats[0]', message: 'a beat takes one target; this one has "edge", "from and to" and "focus" — keep one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a' })])])), [{ path: 'stories[0].beats[0].to', message: 'required with from' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ to: 'a' })])])), [{ path: 'stories[0].beats[0].from', message: 'required with to' }]);
});

test('edge must name an edge: did-you-mean over authored and generated ids', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'abb' })])])), [{ path: 'stories[0].beats[0].edge', message: '"abb" not found; did you mean "ab"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'edge-1' })])])), [], 'an unnamed edge is addressable as edge-<i>');
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'nope_nope' })])])), [{ path: 'stories[0].beats[0].edge', message: '"nope_nope" not found; available: ab, edge-1, edge-2, edge-3' }]);
});

test('from and to name nodes (groups too in architecture); no edge or several between them names both ends', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a', to: 'bb' })])])), [{ path: 'stories[0].beats[0].to', message: '"bb" not found; did you mean "b"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ from: 'a', to: 'd' })])])), [{ path: 'stories[0].beats[0]', message: 'no edge between "a" and "d"; add one, or name an edge with "edge"' }]);
  const spec = graph([story([beat({ from: 'a', to: 'b' })])]);
  spec.edges.push({ from: 'a', to: 'b', label: 'again' });
  assert.deepEqual(await errorsOf(spec), [{ path: 'stories[0].beats[0]', message: '2 edges connect "a" and "b" (ab, edge-4); name one with "edge"' }]);
  const flow = { title: 'T', type: 'flow', groups: [{ id: 'grp', label: 'G' }], nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'grp' }], edges: [{ from: 'a', to: 'b' }], stories: [story([beat({ from: 'a', to: 'grp' })])] };
  const e = await errorsOf(flow);
  assert.equal(e.length, 1);
  assert.equal(e[0].path, 'stories[0].beats[0].to');
  assert.match(e[0].message, /^"grp" not found; /, 'outside architecture a group is not an end');
});

test('focus names known ids and is not empty', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ focus: ['a', 'dd'] })])])), [{ path: 'stories[0].beats[0].focus[1]', message: '"dd" not found; did you mean "d"?' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ focus: [] })])])), [{ path: 'stories[0].beats[0].focus', message: 'at least one id is required' }]);
});

test('limits: 8 stories, 60 beats in all, titles 40 and 48, caption 160', async () => {
  const one = (id) => story([beat({ edge: 'ab' })], id);
  assert.deepEqual(await errorsOf(graph(Array.from({ length: 9 }, (_, i) => one(`s${i}`)))), [{ path: 'stories', message: 'stories has 9 entries; the limit is 8 — merge chapters' }]);
  assert.deepEqual(await errorsOf(graph(Array.from({ length: 8 }, (_, i) => one(`s${i}`)))), []);
  const many = (n, id) => story(Array.from({ length: n }, () => beat({ edge: 'ab' })), id);
  assert.deepEqual(await errorsOf(graph([many(31, 's1'), many(30, 's2')])), [{ path: 'stories', message: 'the stories hold 61 beats in all; the limit is 60 — drop or merge beats' }]);
  assert.deepEqual(await errorsOf(graph([many(30, 's1'), many(30, 's2')])), []);
  const long = graph([{ id: 's1', title: 't'.repeat(41), beats: [{ title: 'b'.repeat(49), caption: 'c'.repeat(161), edge: 'ab' }] }]);
  assert.deepEqual(await errorsOf(long), [
    { path: 'stories[0].title', message: 'title is 41 characters; the limit is 40 — shorten it' },
    { path: 'stories[0].beats[0].title', message: 'title is 49 characters; the limit is 48 — shorten it' },
    { path: 'stories[0].beats[0].caption', message: 'caption is 161 characters; the limit is 160 — shorten it' },
  ]);
});

test('story ids: spelled like other ids, unique among stories, free to match a node id', async () => {
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 'Bad Id')])), [{ path: 'stories[0].id', message: 'id "Bad Id" is invalid; use lowercase letters, digits, - and _, starting with a letter' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 's1'), story([beat({ edge: 'ab' })], 's1')])), [{ path: 'stories[1].id', message: 'duplicate id "s1"; first used at stories[0].id; rename one' }]);
  assert.deepEqual(await errorsOf(graph([story([beat({ edge: 'ab' })], 'a')])), []);
});

test('stories and steps together: use stories', async () => {
  const e = await errorsOf(graph([story([beat({ edge: 'ab' })])], { steps: [{ title: 'S', show: ['a'] }] }));
  assert.deepEqual(e, [{ path: 'steps', message: 'use stories; steps is the older form' }]);
});

test('an empty stories list and a story with no beats are errors', async () => {
  assert.deepEqual(await errorsOf(graph([])), [{ path: 'stories', message: 'at least one story is required — or remove stories' }]);
  assert.deepEqual(await errorsOf(graph([story([])])), [{ path: 'stories[0].beats', message: 'at least one beat is required' }]);
});

test('unknown properties in a story or a beat are rejected with the allowed list', async () => {
  const e = await errorsOf(graph([{ id: 's1', title: 'S', color: 'red', beats: [{ title: 'B', edge: 'ab', zoom: 2 }] }]));
  assert.deepEqual(e.map((x) => x.path).sort(), ['stories[0].beats[0].zoom', 'stories[0].color']);
  assert.match(e.find((x) => x.path.endsWith('zoom')).message, /^unknown property; allowed: title, caption, edge, from, to, focus$/);
});

test('a sequence resolves from/to among messages the same way', async () => {
  const seq = {
    title: 'S', type: 'sequence',
    participants: [{ id: 'u', label: 'User' }, { id: 'app', label: 'App' }, { id: 'auth', label: 'Auth' }],
    messages: [{ id: 'm1', from: 'u', to: 'app' }, { id: 'm2', from: 'app', to: 'auth' }, { id: 'm3', from: 'auth', to: 'app', kind: 'reply' }, { id: 'm4', from: 'app', to: 'app', kind: 'self' }, { id: 'm5', from: 'app', to: 'auth' }],
  };
  const withStory = (beats) => ({ ...seq, stories: [story(beats)] });
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'u', to: 'app' }), beat({ from: 'app', to: 'u' }), beat({ from: 'app', to: 'app' }), beat({ edge: 'm3' })])), []);
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'app', to: 'auth' })])), [{ path: 'stories[0].beats[0]', message: '2 messages connect "app" and "auth" (m2, m5); name one with "edge"' }]);
  assert.deepEqual(await errorsOf(withStory([beat({ edge: 'm9' })])), [{ path: 'stories[0].beats[0].edge', message: '"m9" not found; did you mean "m1"?' }]);
  assert.deepEqual(await errorsOf(withStory([beat({ from: 'u', to: 'auth' })])), [{ path: 'stories[0].beats[0]', message: 'no message between "u" and "auth"; add one, or name a message with "edge"' }]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/stories.test.mjs`
Expected: `Cannot find module '…/scripts/lib/stories.mjs'`.

- [ ] **Step 3: Move the shared helpers into `checks.mjs`**

Create `scripts/lib/checks.mjs`:

```js
// Error helpers shared by the semantic checks (spec.mjs, stories.mjs): every
// message names the value and the fix, with a did-you-mean over a closed set.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { ID_PATTERN } from './schema.mjs';

const MAX_LISTED = 12;
const q = (v) => JSON.stringify(v);

export function suggestion(value, candidates, label = 'available') {
  const hint = didYouMean(value, candidates);
  if (hint) return `did you mean ${q(hint)}?`;
  const shown = candidates.slice(0, MAX_LISTED).join(', ');
  return `${label}: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

export function notFound(id, candidates, what = 'ids') {
  if (candidates.length === 0) return `${q(id)} not found; no ${what} are defined`;
  return `${q(id)} not found; ${suggestion(id, candidates)}`;
}

export function checkLength(errors, item, field, base, limit) {
  const value = item[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit} — shorten it` });
}

export function checkCount(errors, spec, field, limit) {
  const n = spec[field]?.length ?? 0;
  if (n > limit) errors.push({ path: field, message: `${field} has ${n} entries; the limit is ${limit} — split the diagram` });
}

export function checkRefs(errors, ids, base, candidates) {
  (ids ?? []).forEach((id, i) => {
    if (!candidates.includes(id)) errors.push({ path: pathJoin(base, i), message: notFound(id, candidates) });
  });
}

// Registers ids from [listName, items] pairs into `seen` (id -> path of first
// use) and reports bad spelling and duplicates. Items without an id are skipped.
export function registerIds(errors, lists, seen = new Map()) {
  for (const [list, items] of lists) {
    (items ?? []).forEach((item, i) => {
      if (item.id === undefined) return;
      const p = pathJoin(pathJoin(list, i), 'id');
      if (!ID_PATTERN.test(item.id)) {
        errors.push({ path: p, message: `id ${q(item.id)} is invalid; use lowercase letters, digits, - and _, starting with a letter` });
      }
      if (seen.has(item.id)) errors.push({ path: p, message: `duplicate id ${q(item.id)}; first used at ${seen.get(item.id)}; rename one` });
      else seen.set(item.id, p);
    });
  }
  return seen;
}
```

In `spec.mjs`: delete the local `MAX_LISTED`, `suggestion`, `notFound`, `checkLength`, `checkCount`, `checkRefs` and `registerIds` (lines 19 and 39–86), keep `const q = (v) => JSON.stringify(v);`, change the imports to:

```js
import { pathJoin } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { listThemes, loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';
import { KINDS, canHoldIcon } from './kinds.mjs';
import { hasIcon, iconSvg, IconError } from './icons.mjs';
import { SCHEMA, LIMITS, NON_SPACE } from './schema.mjs';
import { suggestion, notFound, checkLength, checkCount, checkRefs, registerIds } from './checks.mjs';
import { isOneEmoji, graphemeCount } from './emoji.mjs';
import { checkStories } from './stories.mjs';
import { lintGeometry } from './lint.mjs';
```

Run `node --test test/spec.test.mjs` — expected: still green (pure move) once stories.mjs exists (Step 4); until then the import fails, so do Step 4 before running.

- [ ] **Step 4: Schema, `edgeIds` export and `stories.mjs`**

`scripts/lib/schema.mjs` — add after `steps`:

```js
  stories: {
    type: 'array',
    items: object(['id', 'title', 'beats'], {
      id: text,
      title: text,
      beats: {
        type: 'array',
        items: object(['title'], { title: text, caption: text, edge: text, from: text, to: text, focus: ids }),
      },
    }),
  },
```

`scripts/lib/layout-graph.mjs:193` — `function edgeIds(spec)` becomes `export function edgeIds(spec)`; extend its comment's first line to `// Every edge's id (stories.mjs resolves beats against the same ids): the authored one, else \`edge-<index>\`, extended with \`_\` while`.

Create `scripts/lib/stories.mjs`:

```js
// stories[]: validation and beat resolution. A story is a chapter of beats; a
// beat is one hop along an edge (or message) or a camera shot on some ids.
// Targets resolve here, at build time, so the page never meets a dangling beat.
// Errors follow spec.mjs: a JSON path, the problem, the fix, a did-you-mean.
import { pathJoin } from '../../shared/errors.mjs';
import { LIMITS } from './schema.mjs';
import { notFound, checkLength, checkRefs, registerIds } from './checks.mjs';
import { edgeIds } from './layout-graph.mjs';

const q = (v) => JSON.stringify(v);
const TARGETS = ['edge', 'from', 'to', 'focus'];
// '"a", "b" and "c"'
const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const linkWord = (spec) => (spec.type === 'sequence' ? 'message' : 'edge');

/** Every edge or message as the viewer knows it: { id, from, to, both }, in spec order. */
export function linksOf(spec) {
  if (spec.type === 'sequence') return (spec.messages ?? []).map((m) => ({ id: m.id, from: m.from, to: m.to, both: false }));
  const ids = edgeIds(spec);
  return (spec.edges ?? []).map((e, i) => ({ id: ids[i], from: e.from, to: e.to, both: e.both === true }));
}

/**
 * The edge a beat's from/to names. The direction given wins: one edge from
 * `from` to `to` plays forward; failing that, one edge the other way plays in
 * reverse (the dot runs to -> from, for replies). Returns { link, reverse } or
 * { error } (the message; the caller adds the path). `what` is "edge" or "message".
 */
export function resolveEnds(from, to, links, what = 'edge') {
  const forward = links.filter((l) => l.from === from && l.to === to);
  const found = forward.length ? forward : links.filter((l) => l.from === to && l.to === from);
  if (found.length === 1) return { link: found[0], reverse: forward.length === 0 };
  if (found.length === 0) return { error: `no ${what} between ${q(from)} and ${q(to)}; add one, or name ${what === 'edge' ? 'an' : 'a'} ${what} with "edge"` };
  return { error: `${found.length} ${what}s connect ${q(from)} and ${q(to)} (${found.map((l) => l.id).join(', ')}); name one with "edge"` };
}

// Exactly one of: edge | from + to | focus. Then the target must exist and resolve.
function checkTarget(errors, beat, p, spec, links, ctx) {
  const set = TARGETS.filter((f) => beat[f] !== undefined);
  const pair = set.filter((f) => f === 'from' || f === 'to');
  const kinds = [...(set.includes('edge') ? ['"edge"'] : []), ...(pair.length ? ['"from and to"'] : []), ...(set.includes('focus') ? ['"focus"'] : [])];
  if (kinds.length === 0) {
    errors.push({ path: p, message: 'a beat needs one target: "edge", "from" and "to", or "focus"' });
    return;
  }
  if (kinds.length > 1) {
    errors.push({ path: p, message: `a beat takes one target; this one has ${list(kinds)} — keep one` });
    return;
  }
  if (beat.edge !== undefined) {
    const ids = links.map((l) => l.id);
    if (!ids.includes(beat.edge)) errors.push({ path: pathJoin(p, 'edge'), message: notFound(beat.edge, ids, `${linkWord(spec)}s`) });
    return;
  }
  if (beat.focus !== undefined) {
    if (beat.focus.length === 0) errors.push({ path: pathJoin(p, 'focus'), message: 'at least one id is required' });
    checkRefs(errors, beat.focus, pathJoin(p, 'focus'), ctx.known);
    return;
  }
  if (pair.length === 1) {
    const missing = pair[0] === 'from' ? 'to' : 'from';
    errors.push({ path: pathJoin(p, missing), message: `required with ${pair[0]}` });
    return;
  }
  let sound = true;
  for (const field of ['from', 'to']) {
    if (ctx.endpoints.includes(beat[field])) continue;
    sound = false;
    errors.push({ path: pathJoin(p, field), message: notFound(beat[field], ctx.endpoints) });
  }
  if (!sound) return;
  const { error } = resolveEnds(beat.from, beat.to, links, linkWord(spec));
  if (error) errors.push({ path: p, message: error });
}

/**
 * Validate `stories`: counts and lengths, story ids (their own id space), and
 * every beat's target. `ctx.endpoints` are the ids from/to may name (nodes, plus
 * groups in architecture; participants in a sequence); `ctx.known` the ids
 * focus may name (what steps may name).
 */
export function checkStories(errors, spec, ctx) {
  const stories = spec.stories;
  if (stories === undefined) return;
  if (stories.length === 0) {
    errors.push({ path: 'stories', message: 'at least one story is required — or remove stories' });
    return;
  }
  if (stories.length > LIMITS.stories) errors.push({ path: 'stories', message: `stories has ${stories.length} entries; the limit is ${LIMITS.stories} — merge chapters` });
  const total = stories.reduce((n, s) => n + s.beats.length, 0);
  if (total > LIMITS.beats) errors.push({ path: 'stories', message: `the stories hold ${total} beats in all; the limit is ${LIMITS.beats} — drop or merge beats` });
  registerIds(errors, [['stories', stories]]);
  const links = linksOf(spec);
  stories.forEach((story, i) => {
    const p = pathJoin('stories', i);
    checkLength(errors, story, 'title', p, LIMITS.storyTitle);
    if (story.beats.length === 0) errors.push({ path: pathJoin(p, 'beats'), message: 'at least one beat is required' });
    story.beats.forEach((beat, j) => {
      const bp = pathJoin(pathJoin(p, 'beats'), j);
      checkLength(errors, beat, 'title', bp, LIMITS.beatTitle);
      checkLength(errors, beat, 'caption', bp, LIMITS.caption);
      checkTarget(errors, beat, bp, spec, links, ctx);
    });
  });
}
```

`scripts/lib/spec.mjs` — wire it in. At the end of `checkGraph` (after `checkSteps(...)`):

```js
  checkStories(errors, spec, { endpoints: ctx.endpoints, known: [...seen.keys()] });
```

At the end of `checkSequence` (after `checkSteps(...)`):

```js
  checkStories(errors, spec, { endpoints: participantIds, known: [...seen.keys()] });
```

Add next to `wrongFamilyFields`:

```js
// stories replaced steps: a spec with both would describe two timelines.
function olderSteps(spec) {
  return spec.stories !== undefined && spec.steps !== undefined ? [{ path: 'steps', message: 'use stories; steps is the older form' }] : [];
}
```

and in `validateSpec`: `const errors = [...wrongFamilyFields(spec), ...olderSteps(spec)];`

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test test/stories.test.mjs test/spec.test.mjs` — expected: all pass. Then `npm test` — expected: green.

- [ ] **Step 6: Commit**

Message: `feat(make-diagram): stories validate with resolved beat targets` — the orchestrator commits; do not run git commit.

---

### Task 3: beats, chapters and the new `viewerData` keys

**Files:**
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/stories.mjs` (append `beatsOf`)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/data.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/api.mjs`
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/check.mjs`
- Create: `plugins/portable-artifacts/skills/make-diagram/references/examples/story.diagram.json`
- Modify: `test/stories.test.mjs`, `test/api.test.mjs:221`, `test/build.test.mjs:150`, `test/ids.test.mjs:14`, `test/check.test.mjs:42,54`

**Interfaces:**
- Consumes: `linksOf`, `resolveEnds` (Task 2); `buildDiagram`'s `steps` (api.mjs `stepsOf`, "Everything" included).
- Produces: `beatsOf(spec, steps) -> { beats, chapters }` with beat `{ kind: 'hop'|'focus'|'step', chapter, title, caption?, edge, reverse, ids, reveal, highlight }` and chapter `{ id, title, start, end }` (end exclusive).
- Produces: `viewerData` keys `autoplay` (boolean), `beats`, `chapters`, `info` (`{ [id]: { label, kind, emoji?, note?, detail? } | { style, label? } }`), `directed` (`{ [id]: [edgeId, …] }`, only ids something leaves).
- Produces: `check.mjs` counts beats and reports `check: ok (2 viewports, N beats)`; JSON `beats`.

- [ ] **Step 1: Write the failing tests**

Append to `test/stories.test.mjs` (add `import fs from 'node:fs'; import { fileURLToPath } from 'node:url'; import { buildDiagram } from '../scripts/lib/api.mjs';` and change the stories import to `import { linksOf, resolveEnds, beatsOf } from '../scripts/lib/stories.mjs';`):

```js
const example = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url)), 'utf8'));

test('the story example validates, layout included', async () => {
  assert.deepEqual((await validateSpec(example('story'))).errors, []);
});

test('beatsOf: stories become hop and focus beats in array order, one chapter per story', () => {
  const spec = graph([
    story([beat({ edge: 'ab' }, 'By edge'), { title: 'Back', caption: 'A reply.', from: 'b', to: 'a' }, beat({ from: 'a', to: 'g' }, 'To a group')], 'one'),
    story([beat({ focus: ['g', 'd'] }, 'Shot')], 'two'),
  ]);
  const { beats, chapters } = beatsOf(spec, []);
  assert.deepEqual(chapters, [{ id: 'one', title: 'Story', start: 0, end: 3 }, { id: 'two', title: 'Story', start: 3, end: 4 }]);
  assert.deepEqual(beats, [
    { kind: 'hop', chapter: 0, title: 'By edge', edge: 'ab', reverse: false, ids: ['a', 'b'], reveal: [], highlight: [] },
    { kind: 'hop', chapter: 0, title: 'Back', caption: 'A reply.', edge: 'ab', reverse: true, ids: ['a', 'b'], reveal: [], highlight: [] },
    { kind: 'hop', chapter: 0, title: 'To a group', edge: 'edge-3', reverse: false, ids: ['a', 'g'], reveal: [], highlight: [] },
    { kind: 'focus', chapter: 1, title: 'Shot', edge: null, reverse: false, ids: ['g', 'd'], reveal: [], highlight: [] },
  ]);
  assert.notEqual(beats[3].ids, spec.stories[1].beats[0].focus, 'copied, not shared');
});

test('beatsOf: a self-edge hop fits one id', () => {
  const spec = graph([story([beat({ from: 'a', to: 'a' })])]);
  spec.edges.push({ id: 'loop', from: 'a', to: 'a' });
  assert.deepEqual(beatsOf(spec, []).beats[0].ids, ['a']);
});

test('beatsOf: without stories, steps become step beats in one Walkthrough chapter', () => {
  const steps = [{ title: 'One', note: 'First.', show: ['a', 'b'] }, { title: 'Two', show: ['c'], focus: ['b', 'c'], highlight: ['c'] }, { title: 'Everything', show: ['d'], focus: ['g', 'a', 'b', 'c', 'd'] }];
  const { beats, chapters } = beatsOf(graph(undefined), steps);
  assert.deepEqual(chapters, [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: 3 }]);
  assert.deepEqual(beats[0], { kind: 'step', chapter: 0, title: 'One', caption: 'First.', edge: null, reverse: false, ids: [], reveal: ['a', 'b'], highlight: [] });
  assert.deepEqual(beats[1], { kind: 'step', chapter: 0, title: 'Two', edge: null, reverse: false, ids: ['b', 'c'], reveal: ['c'], highlight: ['c'] });
  assert.notEqual(beats[1].ids, steps[1].focus, 'copied');
});

test('buildDiagram data: autoplay, beats, chapters, info and directed for the story example', async () => {
  const { data, steps } = await buildDiagram(example('story'));
  assert.equal(data.autoplay, false);
  assert.equal(data.beats.length, 9);
  assert.deepEqual(data.chapters, [{ id: 'placing', title: 'Place the order', start: 0, end: 6 }, { id: 'fulfilling', title: 'Fulfil it', start: 6, end: 9 }]);
  assert.deepEqual(data.beats[1], { kind: 'hop', chapter: 0, title: 'The app calls the API', caption: 'One POST with an idempotency key.', edge: 'place', reverse: false, ids: ['app', 'gateway'], reveal: [], highlight: [] });
  assert.deepEqual([data.beats[4].edge, data.beats[4].reverse], ['edge-6', false], 'orders -> gateway: the direction given, not the gateway -> orders edge');
  assert.deepEqual([data.beats[5].edge, data.beats[5].reverse], ['edge-0', true], 'app -> shopper runs the shopper -> app edge backwards');
  assert.deepEqual(data.beats[8], { kind: 'focus', chapter: 1, title: 'The whole core', caption: 'Three services, one database, one bus.', edge: null, reverse: false, ids: ['core'], reveal: [], highlight: [] });
  assert.ok(steps.length > 0 && data.steps === steps, 'steps stay in the data');
  assert.deepEqual(data.info.orders, { label: 'Orders service', kind: 'service', emoji: '📦', detail: 'Owns the order lifecycle. Writes every state change to the orders table and emits an event per transition.' });
  assert.deepEqual(data.info.gateway, { label: 'API gateway', kind: 'gateway', note: 'auth, rate limits' });
  assert.deepEqual(data.info.place, { style: 'solid', label: 'POST /orders' });
  assert.deepEqual(data.info['edge-4'], { style: 'async', label: 'order.placed' });
  assert.deepEqual(data.directed.orders, ['edge-3', 'edge-4', 'edge-6']);
  assert.deepEqual(data.directed.app, ['place']);
  assert.equal(data.directed.warehouse, undefined, 'nothing leaves the warehouse');
});

test('without stories the data holds step beats matching steps; a sequence carries message styles', async () => {
  const arch = await buildDiagram(example('architecture'));
  assert.equal(arch.data.beats.length, arch.steps.length);
  assert.deepEqual(arch.data.beats.map((b) => b.title), arch.steps.map((s) => s.title));
  assert.ok(arch.data.beats.every((b) => b.kind === 'step'));
  assert.deepEqual(arch.data.chapters, [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: arch.steps.length }]);
  assert.deepEqual(arch.data.directed.web, ['edge-0', 'edge-3']);
  assert.deepEqual(arch.data.directed.vpc, ['edge-3'], 'a both edge leaves the group end too');
  const seq = await buildDiagram(example('sequence'));
  assert.deepEqual(seq.data.info.m5, { style: 'reply', label: 'declined' });
  assert.deepEqual(seq.data.info.shopper, { label: 'Shopper', kind: 'actor' });
  assert.deepEqual(seq.data.directed.psp, ['m5', 'm8']);
});
```

Edit the key lists: `test/api.test.mjs:221` and `test/build.test.mjs:150` both become

```js
['adjacency', 'animate', 'autoplay', 'beats', 'boxes', 'chapters', 'directed', 'edges', 'frames', 'height', 'ids', 'info', 'parents', 'stem', 'steps', 'title', 'type', 'width']
```

`test/ids.test.mjs:14`: `for (const map of [data.adjacency, data.edges, data.parents, data.boxes, data.info, data.directed])`.

`test/check.test.mjs`: line 42 regex → `/^check: ok \(2 viewports, \d+ beats\)\n$/`; line 54 → `assert.ok(body.beats > 0);`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/stories.test.mjs test/api.test.mjs test/build.test.mjs test/ids.test.mjs`
Expected: `beatsOf` is not exported (`SyntaxError: The requested module './stories.mjs' does not provide an export named 'beatsOf'`); after a temporary stub the key-list assertions fail with the five missing keys, and the story example read fails with `ENOENT`.

- [ ] **Step 3: The story example**

Create `references/examples/story.diagram.json`:

```json
{
  "title": "Order fulfilment",
  "subtitle": "From a tap in the app to a parcel on its way",
  "type": "architecture",
  "autoplay": false,
  "groups": [
    { "id": "edge", "label": "Edge" },
    { "id": "core", "label": "Core services" }
  ],
  "nodes": [
    { "id": "shopper", "label": "Shopper", "kind": "user", "emoji": "🧑‍💻", "detail": "Places the order from the mobile app." },
    { "id": "app", "label": "Mobile app", "kind": "client", "group": "edge", "emoji": "📱" },
    { "id": "gateway", "label": "API gateway", "kind": "gateway", "group": "edge", "note": "auth, rate limits" },
    { "id": "orders", "label": "Orders service", "group": "core", "emoji": "📦", "detail": "Owns the order lifecycle. Writes every state change to the orders table and emits an event per transition." },
    { "id": "db", "label": "Orders DB", "kind": "database", "group": "core", "icon": "brand:postgresql" },
    { "id": "bus", "label": "Event bus", "kind": "queue", "group": "core", "emoji": "🚌" },
    { "id": "warehouse", "label": "Warehouse", "kind": "external", "emoji": "🏭", "tone": "warn" }
  ],
  "edges": [
    { "from": "shopper", "to": "app", "label": "taps Buy" },
    { "id": "place", "from": "app", "to": "gateway", "label": "POST /orders" },
    { "from": "gateway", "to": "orders", "label": "forwards" },
    { "from": "orders", "to": "db", "label": "writes order" },
    { "from": "orders", "to": "bus", "label": "order.placed", "style": "async" },
    { "from": "bus", "to": "warehouse", "label": "pick and pack", "style": "async" },
    { "from": "orders", "to": "gateway", "label": "201 Created", "style": "dashed" }
  ],
  "stories": [
    {
      "id": "placing",
      "title": "Place the order",
      "beats": [
        { "title": "The shopper taps Buy", "from": "shopper", "to": "app", "caption": "The app builds the order from the basket." },
        { "title": "The app calls the API", "edge": "place", "caption": "One POST with an idempotency key." },
        { "title": "The gateway forwards it", "from": "gateway", "to": "orders", "caption": "After checking the token and the rate limit." },
        { "title": "The order is written", "from": "orders", "to": "db" },
        { "title": "201 goes back", "from": "orders", "to": "gateway", "caption": "The reply carries the order id." },
        { "title": "The shopper sees a receipt", "from": "app", "to": "shopper", "caption": "This hop plays backwards: the reply runs against the arrow." }
      ]
    },
    {
      "id": "fulfilling",
      "title": "Fulfil it",
      "beats": [
        { "title": "An event leaves the core", "from": "orders", "to": "bus", "caption": "order.placed, published once the write commits." },
        { "title": "The warehouse picks it up", "from": "bus", "to": "warehouse" },
        { "title": "The whole core", "focus": ["core"], "caption": "Three services, one database, one bus." }
      ]
    }
  ]
}
```

Run `node scripts/validate.mjs references/examples/story.diagram.json` — expected `valid`. If the geometry lint objects to a label, shorten that label only; keep every id, edge and beat as written (the tests pin them).

- [ ] **Step 4: `beatsOf`**

Append to `scripts/lib/stories.mjs`:

```js
// ---- the timeline -------------------------------------------------------------

const copy = (list) => (list ? [...list] : []);

// A step as a beat. It keeps today's semantics (reveal what it shows, emphasise
// what it highlights, hide the rest), so kind 'step' tells the player apart.
function stepBeat(step) {
  const beat = { kind: 'step', chapter: 0, title: step.title, edge: null, reverse: false, ids: copy(step.focus), reveal: copy(step.show), highlight: copy(step.highlight) };
  if (step.note !== undefined) beat.caption = step.note;
  return beat;
}

// A story beat: a hop (its edge, direction and both ends) or a focus shot. The
// spec passed validation, so the target resolves.
function storyBeat(beat, chapter, links) {
  const out = { kind: 'focus', chapter, title: beat.title, edge: null, reverse: false, ids: [], reveal: [], highlight: [] };
  if (beat.caption !== undefined) out.caption = beat.caption;
  if (beat.focus !== undefined) return { ...out, ids: [...beat.focus] };
  const hop = beat.edge !== undefined ? { link: links.find((l) => l.id === beat.edge), reverse: false } : resolveEnds(beat.from, beat.to, links);
  const ends = hop.link.from === hop.link.to ? [hop.link.from] : [hop.link.from, hop.link.to];
  return { ...out, kind: 'hop', edge: hop.link.id, reverse: hop.reverse, ids: ends };
}

/**
 * The timeline the player runs: { beats, chapters }. With `stories`, their
 * beats in array order and one chapter per story (`end` exclusive). Without,
 * `steps` (buildDiagram's, "Everything" included) become one chapter titled
 * Walkthrough, so Play always has something to run.
 */
export function beatsOf(spec, steps) {
  if (!spec.stories?.length) {
    const beats = steps.map(stepBeat);
    return { beats, chapters: [{ id: 'walkthrough', title: 'Walkthrough', start: 0, end: beats.length }] };
  }
  const links = linksOf(spec);
  const beats = [];
  const chapters = spec.stories.map((story, c) => {
    const start = beats.length;
    for (const b of story.beats) beats.push(storyBeat(b, c, links));
    return { id: story.id, title: story.title, start, end: beats.length };
  });
  return { beats, chapters };
}
```

- [ ] **Step 5: `data.mjs`, `api.mjs`, `check.mjs`**

`scripts/lib/data.mjs` — add `import { KINDS } from './kinds.mjs';`, the two builders, and the keys:

```js
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

// id -> what the panel, the chips and the legend read: label and kind (plus
// emoji, note and detail when set) for a node or participant; style and label
// (when set) for an edge or message. `links` run in spec order, like the spec arrays.
function infoOf(spec, links) {
  const info = new Map();
  const sequence = spec.type === 'sequence';
  for (const n of sequence ? spec.participants : spec.nodes) {
    const entry = { label: oneLine(n.label), kind: n.kind ?? KINDS[spec.type].default };
    if (n.emoji !== undefined) entry.emoji = n.emoji;
    if (n.note !== undefined) entry.note = oneLine(n.note);
    if (n.detail !== undefined) entry.detail = String(n.detail).trim();
    info.set(n.id, entry);
  }
  (sequence ? spec.messages ?? [] : spec.edges ?? []).forEach((e, i) => {
    const entry = { style: sequence ? e.kind ?? 'sync' : e.style ?? 'solid' };
    if (e.label !== undefined) entry.label = oneLine(e.label);
    info.set(links[i].id, entry);
  });
  return Object.fromEntries(info);
}

// id -> the edges that leave it along the arrow (a two-headed edge leaves both
// ends). Only ids something leaves appear; the other end of an edge is edges[e].
function directedOf(links) {
  const out = new Map();
  const add = (id, edge) => {
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(edge);
  };
  for (const l of links) {
    add(l.from, l.id);
    if (l.both && l.to !== l.from) add(l.to, l.id);
  }
  return Object.fromEntries(out);
}
```

In `viewerData`, update the doc comment to `built` carries `{ geometry, steps, ids, width, height, beats, chapters }` and add after `frames: …,`:

```js
    autoplay: spec.autoplay === true,
    beats: built.beats,
    chapters: built.chapters,
    info: infoOf(spec, links),
    directed: directedOf(links),
```

`scripts/lib/api.mjs` — `import { beatsOf } from './stories.mjs';`, and in `buildDiagram`:

```js
  const steps = stepsOf(spec, geometry, ids);
  const { beats, chapters } = beatsOf(spec, steps);
  const width = geometry.width;
  const height = geometry.height;
  return {
    svg: renderSvg(geometry, spec, { theme: resolved, ...(idPrefix ? { idPrefix } : {}) }),
    css: diagramCss(),
    width,
    height,
    steps,
    ids,
    data: viewerData(spec, { geometry, steps, ids, width, height, beats, chapters }),
    geometry,
  };
```

Extend the JSDoc: "`data` … also carries the story timeline (`beats`, `chapters`), per-id `info`, `directed` out-edges and `autoplay`".

`scripts/check.mjs` — count beats. Line 4 comment: `… or a story that cannot reach its last beat.` In `checkViewport` replace the `steps` reads:

```js
    const beats = await page.evaluate(() => (JSON.parse(document.getElementById('pa-data').textContent).beats || []).length);
    if (beats > 0) await checkPresentation(page, beats, label, problems);
    return { problems, beats };
```

and the two early returns to `return { problems, beats: 0 };`. `checkPresentation(page, beats, label, problems)`: comment `// Enter the story, step to the end with the arrow key, and require the count to read "N / N".`, loop `for (let i = 1; i < beats; i++)`, expected `` `${beats} / ${beats}` ``. In `checkPage`: skipped → `beats: 0`, ok → `beats: Math.max(...results.map((r) => r.beats))`, timed out → `beats: 0`. In `report`: `steps: result.steps` → `beats: result.beats`; text → `` `check: ok (${result.viewports} viewports, ${result.beats} beats)\n` ``. The JSDoc line: `{ status, viewports, beats, problems, reason? }`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test test/stories.test.mjs test/api.test.mjs test/build.test.mjs test/ids.test.mjs test/check.test.mjs` — expected: pass (check tests skip without a browser). Then `npm test` — expected: green. Note: the story example is not yet in `EXAMPLES` (Task 5 adds it once the player exists).

Then `cd ../make-explainer && npm test`. Its `test/golden/recap.body.html` holds the recap example's body markup, diagram data block included, so the five new data keys change it and `golden: body markup of the recap example is unchanged` goes red. That is the intended change: read the diff (only the `data-dg-data` JSON gains `autoplay`, `beats`, `chapters`, `info`, `directed`), regenerate with `UPDATE_GOLDEN=1 node --test test/golden.test.mjs` from `skills/make-explainer`, and name the regeneration in the commit body. Nothing else in the explainer suite may change.

- [ ] **Step 7: Commit**

Message: `feat(make-diagram): viewer data carries beats, chapters, info and directed edges` — the orchestrator commits; do not run git commit.

---

### Task 4: behaviour-preserving template split

**Files:**
- Create: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/runtime.mjs`
- Create: `plugins/portable-artifacts/skills/make-diagram/template/camera.js`, `template/explore.js`, `template/story.js`, `template/transport.js`
- Modify: `plugins/portable-artifacts/skills/make-diagram/template/viewer.js` (rewritten slim; same behaviour)
- Modify: `plugins/portable-artifacts/skills/make-diagram/scripts/lib/viewer.mjs` (`CORE` from `runtimeSource()`), `scripts/lib/api.mjs` (`viewerRuntime()` from `runtimeSource()`)
- Create: `plugins/portable-artifacts/skills/make-diagram/test/runtime.test.mjs`

**Interfaces:**
- Produces: `RUNTIME_FILES = ['camera.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js']`, `runtimeSource()`.
- Produces: `PADiagram.dict`, `PADiagram.camera`, `PADiagram.trace`, `PADiagram.story`, `PADiagram.transport`, `PADiagram.mount` with the signatures in the master plan's contracts. `els = { nodes, groups, edges, labels, lifelines, frames, notes }`.
- Behaviour: identical to today's viewer.js. Every existing browser test (`test/browser.test.mjs`, `test/embed.test.mjs`, `test/check.test.mjs`, make-explainer's `diagram-browser.test.mjs`) stays green without edits. `check.test.mjs:80` still finds the exact substring `function next() { if (presenting) goTo(stepIndex + 1); }` (it lives in story.js now).

- [ ] **Step 1: Write the failing test**

Create `test/runtime.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES, runtimeSource } from '../scripts/lib/runtime.mjs';
import { viewerRuntime } from '../scripts/lib/api.mjs';

const template = (name) => fileURLToPath(new URL(`../template/${name}`, import.meta.url));
const lines = (name) => fs.readFileSync(template(name), 'utf8').split('\n').length;

test('the runtime is camera, explore, story, transport, then viewer, joined in that order', () => {
  assert.deepEqual(RUNTIME_FILES, ['camera.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js']);
  const src = runtimeSource();
  let at = -1;
  for (const f of RUNTIME_FILES) {
    const i = src.indexOf(fs.readFileSync(template(f), 'utf8'));
    assert.ok(i > at, `${f} follows the file before it`);
    at = i;
  }
  assert.equal(viewerRuntime(), src, 'embedders get the same bundle as the page');
  assert.doesNotThrow(() => new Function(src), 'valid JavaScript');
});

test('every template file stays under 400 lines', () => {
  for (const f of [...RUNTIME_FILES, 'toolbar.js', 'viewer.html']) assert.ok(lines(f) < 400, `${f}: ${lines(f)} lines`);
});

test('each module registers a factory on window.PADiagram and viewer.js composes mount', () => {
  for (const f of RUNTIME_FILES.slice(0, -1)) assert.match(fs.readFileSync(template(f), 'utf8'), /PADiagram\.\w+ = function/, f);
  assert.ok(fs.readFileSync(template('viewer.js'), 'utf8').includes('PADiagram.mount = mount;'));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/runtime.test.mjs` — expected: `Cannot find module '…/scripts/lib/runtime.mjs'`.

- [ ] **Step 3: `runtime.mjs` and the two call sites**

Create `scripts/lib/runtime.mjs`:

```js
// The viewer runtime: the template/ modules inlined in one fixed order. Each
// module registers a factory on window.PADiagram; viewer.js, last, composes
// them into PADiagram.mount. Shared by the page builder (viewer.mjs) and the
// embedding API (api.mjs viewerRuntime), so embedders get the same bundle.
import fs from 'node:fs';

export const RUNTIME_FILES = ['camera.js', 'explore.js', 'story.js', 'transport.js', 'viewer.js'];
const TEMPLATE = new URL('../../template/', import.meta.url);

/** The concatenated runtime source. */
export function runtimeSource() {
  return RUNTIME_FILES.map((f) => fs.readFileSync(new URL(f, TEMPLATE), 'utf8')).join('\n');
}
```

`scripts/lib/api.mjs`: replace `const VIEWER_JS = …` and the body of `viewerRuntime` with `import { runtimeSource } from './runtime.mjs';` and `return runtimeSource();`; the JSDoc becomes `/** The viewer's core script (camera, trace, story, transport and the mount that wires them) without toolbar chrome, for embedding. */`. Drop the now unused `fs` import if nothing else uses it (nothing does).

`scripts/lib/viewer.mjs`: `import { runtimeSource } from './runtime.mjs';`, delete `const CORE = …`, and `CORE: inlineCode(runtimeSource()),`. Update the header comment: `the inlined runtime (template/*.js in the order scripts/lib/runtime.mjs fixes, then template/toolbar.js chrome)`.

- [ ] **Step 4: `template/camera.js`**

```js
// make-diagram viewer, camera: zoom, pan, fit and the glide between views for
// one diagram <svg>. The camera is a centre in diagram units and a scale in px
// per unit; the viewBox is derived from it and the stage size. Registered as
// PADiagram.camera and composed by viewer.js. This file comes first in the
// bundle (scripts/lib/runtime.mjs), so it also defines PADiagram.dict.
//
//   var camera = PADiagram.camera(stage, svg, data, { onApply });
//
// onApply runs after every viewBox change (viewer.js emits its state from it).
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var MAX_FIT_SCALE = 1.25; // a small diagram is not blown up past this to fill a big stage
  var FIT_MARGIN = 16;
  var FOCUS_PAD = 48;
  var MAX_FOCUS_SCALE = 1.6; // px per diagram unit when a beat zooms in on a few nodes
  var MAX_FOCUS_ZOOM = 2; // and never past this multiple of the fit
  var CAMERA_MS = 300;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };
  var round = function (v) { return Math.round(v * 100) / 100; };

  // Ids are model-provided keys: every id-keyed map has no prototype, so an id
  // like "constructor" is just a key (a plain {} would answer for it).
  PADiagram.dict = function (source) {
    var d = Object.create(null);
    Object.keys(source || {}).forEach(function (k) { d[k] = source[k]; });
    return d;
  };

  PADiagram.camera = function (stage, svg, data, hooks) {
    hooks = hooks || {};
    var W = Math.max(1, finite(data.width, 1));
    var H = Math.max(1, finite(data.height, 1));
    var boxes = PADiagram.dict(data.boxes);
    var reduceQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = function () { return !!(reduceQuery && reduceQuery.matches); };
    var cam = { cx: W / 2, cy: H / 2, s: 1 };
    var fitted = true;
    var tween = 0;

    // A stage with no size (hidden, not laid out yet) is treated as the
    // diagram's own size, so nothing divides by zero.
    function size() {
      var r = stage.getBoundingClientRect();
      return { w: r.width > 0 ? r.width : W, h: r.height > 0 ? r.height : H };
    }
    function fitScale(sz) {
      var s = Math.min(sz.w / (W + 2 * FIT_MARGIN), sz.h / (H + 2 * FIT_MARGIN));
      return s > 0 && isFinite(s) ? Math.min(s, MAX_FIT_SCALE) : 1;
    }
    function fitCamera() { return { cx: W / 2, cy: H / 2, s: fitScale(size()) }; }

    function apply() {
      var sz = size();
      var w = sz.w / cam.s;
      var h = sz.h / cam.s;
      svg.setAttribute('viewBox', [cam.cx - w / 2, cam.cy - h / 2, w, h].map(round).join(' '));
      stage.setAttribute('data-zoom', (cam.s / fitScale(sz)).toFixed(3));
      if (hooks.onApply) hooks.onApply();
    }
    function cancelTween() {
      if (tween && global.cancelAnimationFrame) global.cancelAnimationFrame(tween);
      tween = 0;
    }
    // Glide to `target` over options.ms (CAMERA_MS by default); at once when
    // options.instant is set, under reduced motion, or without requestAnimationFrame.
    function moveTo(target, options) {
      options = options || {};
      cancelTween();
      var to = { cx: finite(target.cx, cam.cx), cy: finite(target.cy, cam.cy), s: finite(target.s, cam.s) };
      if (options.instant || reduced() || !global.requestAnimationFrame) { cam = to; apply(); return; }
      var ms = Math.max(1, finite(options.ms, CAMERA_MS));
      var from = { cx: cam.cx, cy: cam.cy, s: cam.s };
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var e = 1 - Math.pow(1 - k, 3); // ease-out
        cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: from.s * Math.pow(to.s / from.s, e) };
        apply();
        tween = k < 1 ? global.requestAnimationFrame(tick) : 0;
      };
      tween = global.requestAnimationFrame(tick);
    }

    function fit() { fitted = true; moveTo(fitCamera()); }
    // The fit view at once, no glide (first paint, and a resize of a fitted view).
    function refit() { fitted = true; cam = fitCamera(); apply(); }
    function zoomAt(factor, px, py) {
      cancelTween();
      fitted = false;
      var sz = size();
      var fs = fitScale(sz);
      var ns = clamp(cam.s * factor, fs * MIN_ZOOM, fs * MAX_ZOOM);
      var wx = cam.cx + (px - sz.w / 2) / cam.s;
      var wy = cam.cy + (py - sz.h / 2) / cam.s;
      cam = { cx: clamp(wx - (px - sz.w / 2) / ns, 0, W), cy: clamp(wy - (py - sz.h / 2) / ns, 0, H), s: ns };
      apply();
    }
    function zoomBy(factor) { var sz = size(); zoomAt(factor, sz.w / 2, sz.h / 2); }
    function panBy(dx, dy) {
      cancelTween();
      fitted = false;
      cam = { cx: clamp(cam.cx + dx / cam.s, 0, W), cy: clamp(cam.cy + dy / cam.s, 0, H), s: cam.s };
      apply();
    }

    // The union of the boxes of `ids` as { x, y, w, h }, or null when none has a box.
    function boxOf(ids) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      (ids || []).forEach(function (id) {
        var b = boxes[id];
        if (!b || !b.every(function (v) { return isFinite(v); })) return;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
      });
      return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function unionBox(a, b) {
      if (!a) return b;
      var x0 = Math.min(a.x, b.x);
      var y0 = Math.min(a.y, b.y);
      return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }
    // Camera showing `box` with FOCUS_PAD around it. A box of zero width or height
    // (one message line, a lone dot) still has the padding, so the scale is finite.
    function cameraFor(box) {
      if (!box) return fitCamera();
      var sz = size();
      var fs = fitScale(sz);
      var s = Math.min(sz.w / (box.w + 2 * FOCUS_PAD), sz.h / (box.h + 2 * FOCUS_PAD));
      s = clamp(isFinite(s) && s > 0 ? s : fs, fs * MIN_ZOOM, Math.max(fs * MIN_ZOOM, Math.min(fs * MAX_FOCUS_ZOOM, MAX_FOCUS_SCALE)));
      return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, s: s };
    }
    // Keyboard focus on a node scrolled out of view brings it to the middle.
    function ensureVisible(id) {
      var b = boxes[id];
      if (!b) return;
      var sz = size();
      var halfW = sz.w / cam.s / 2;
      var halfH = sz.h / cam.s / 2;
      var inside = b[0] >= cam.cx - halfW && b[0] + b[2] <= cam.cx + halfW && b[1] >= cam.cy - halfH && b[1] + b[3] <= cam.cy + halfH;
      if (!inside) { fitted = false; moveTo({ cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, s: cam.s }, { instant: true }); }
    }
    // On a resize a fitted view refits; any other view keeps its camera.
    function onResize() {
      if (fitted) cam = fitCamera();
      apply();
    }

    return {
      size: size, fitScale: fitScale, fitCamera: fitCamera, apply: apply, moveTo: moveTo, cancelTween: cancelTween,
      fit: fit, refit: refit, zoomAt: zoomAt, zoomBy: zoomBy, panBy: panBy,
      boxOf: boxOf, unionBox: unionBox, cameraFor: cameraFor, ensureVisible: ensureVisible,
      reduced: reduced, reduceQuery: reduceQuery,
      zoom: function () { return cam.s / fitScale(size()); },
      isFitted: function () { return fitted; },
      unfit: function () { fitted = false; },
      onResize: onResize,
    };
  };
})(window);
```

- [ ] **Step 5: `template/explore.js` (the trace)**

```js
// make-diagram viewer, trace: hover, keyboard focus and a pinning click light a
// node (or an edge) and what it touches; the rest dims (pa-dim / pa-on, styled
// by diagramCss()). Registered as PADiagram.trace and composed by viewer.js.
// Phase 2 grows this file into Explore (panel, route, find).
//
//   var trace = PADiagram.trace(svg, data, els, { isOff });
//
// isOff() true (the story is on) leaves the diagram untouched, since the beat's
// own dimming would otherwise fight the trace's.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.trace = function (svg, data, els, hooks) {
    hooks = hooks || {};
    var adjacency = PADiagram.dict(data.adjacency);
    var edgeEnds = PADiagram.dict(data.edges);
    var hoverId = null;
    var focusId = null;
    var pinId = null;
    var traced = []; // elements carrying pa-dim / pa-on, to reset cheaply

    function relation(id) {
      if (edgeEnds[id]) return { nodes: edgeEnds[id].slice(), edges: [id], on: [] };
      var a = adjacency[id] || { nodes: [], edges: [] };
      return { nodes: [id].concat(a.nodes), edges: a.edges, on: [id] };
    }
    function paint(el, dim, on) {
      el.classList.toggle('pa-dim', dim);
      el.classList.toggle('pa-on', on);
      traced.push(el);
    }
    function refresh() {
      traced.forEach(function (el) { el.classList.remove('pa-dim', 'pa-on'); });
      traced = [];
      var id = hooks.isOff && hooks.isOff() ? null : (pinId || hoverId || focusId);
      svg.classList.toggle('pa-tracing', !!id);
      if (!id) return;
      var rel = relation(id);
      Object.keys(els.nodes).forEach(function (n) { paint(els.nodes[n], rel.nodes.indexOf(n) < 0, rel.on.indexOf(n) >= 0); });
      Object.keys(els.edges).forEach(function (e) {
        var incident = rel.edges.indexOf(e) >= 0;
        paint(els.edges[e], !incident, incident);
        if (els.labels[e]) paint(els.labels[e], !incident, false);
      });
    }
    // The node or edge id under a pointer or focus target, or null.
    function idAt(target) {
      var el = target && target.closest ? target.closest('.pa-node,.pa-edge,.pa-edge-label') : null;
      if (!el) return null;
      return el.getAttribute('data-id') || el.getAttribute('data-edge');
    }

    return {
      refresh: refresh,
      idAt: idAt,
      hover: function (id) { if (id === hoverId) return; hoverId = id; refresh(); },
      focus: function (id) { focusId = id; refresh(); },
      pin: function (id) { pinId = id && id !== pinId ? id : null; refresh(); },
      pinned: function () { return pinId; },
      active: function () { return pinId || hoverId || focusId; },
      hasFocus: function () { return !!focusId; },
      clear: function () { pinId = null; hoverId = null; refresh(); },
    };
  };
})(window);
```

- [ ] **Step 6: `template/story.js` (the step engine, moved)**

```js
// make-diagram viewer, story: the step-by-step presentation over data.steps.
// A step reveals its show, focus and highlight ids (plus each node's ancestor
// groups and the participants of a revealed message), hides the rest, and the
// camera fits what it focuses. Registered as PADiagram.story and composed by
// viewer.js. (scripts/lib/steps.mjs applies the same reveal rules when it
// builds the closing "Everything" step.)
//
//   var story = PADiagram.story(stage, svg, data, els, camera, { onStep });
//
// onStep runs after every change of step or mode, before the camera moves.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };

  PADiagram.story = function (stage, svg, data, els, camera, hooks) {
    hooks = hooks || {};
    var steps = data.steps || [];
    var edgeEnds = PADiagram.dict(data.edges);
    var parents = PADiagram.dict(data.parents);
    var frameData = data.frames || [];
    var isSequence = data.type === 'sequence';
    var words = function (el, name) { var v = el.getAttribute(name); return v ? v.split(' ') : []; };
    var presenting = false;
    var stepIndex = 0;

    // What the steps up to `n` reveal.
    function revealedThrough(n) {
      var seen = PADiagram.dict();
      var add = function (id) {
        for (var at = id; at !== undefined && !seen[at]; at = parents[at]) seen[at] = true;
      };
      for (var i = 0; i <= n; i++) {
        var s = steps[i];
        [].concat(s.show || [], s.focus || [], s.highlight || []).forEach(add);
      }
      Object.keys(edgeEnds).forEach(function (e) {
        if (isSequence && seen[e]) { add(edgeEnds[e][0]); add(edgeEnds[e][1]); }
      });
      return seen;
    }
    function applyReveal() {
      var seen = revealedThrough(stepIndex);
      var step = steps[stepIndex];
      var hide = function (el, hidden) { if (el) el.classList.toggle('pa-hidden', hidden); };
      Object.keys(els.nodes).forEach(function (id) { hide(els.nodes[id], !seen[id]); });
      Object.keys(els.groups).forEach(function (id) { hide(els.groups[id], !seen[id]); });
      Object.keys(els.edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        var shown = isSequence ? !!seen[id] : !!seen[ends[0]] && !!seen[ends[1]];
        hide(els.edges[id], !shown);
        hide(els.labels[id], !shown);
      });
      els.lifelines.forEach(function (el) { hide(el, !seen[el.getAttribute('data-for')]); });
      els.frames.forEach(function (el) { hide(el, !words(el, 'data-messages').some(function (m) { return seen[m]; })); });
      els.notes.forEach(function (el) {
        var after = el.getAttribute('data-after');
        hide(el, after ? !seen[after] : !words(el, 'data-over').every(function (p) { return seen[p]; }));
      });
      var hl = PADiagram.dict();
      (step.highlight || []).forEach(function (id) { hl[id] = true; });
      [els.nodes, els.groups, els.edges, els.labels].forEach(function (group) {
        Object.keys(group).forEach(function (id) { group[id].classList.toggle('pa-hl', !!hl[id]); });
      });
      return seen;
    }
    function clearReveal() {
      svg.querySelectorAll('.pa-hidden,.pa-hl').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-hl'); });
    }
    // A step with no focus fits what it shows. In a sequence that also keeps the
    // headers of every shown message's participants and the frames around the
    // messages in view, so the reader still knows who is talking.
    function defaultFocus(step) {
      var ids = (step.show || []).slice();
      if (!isSequence) return { ids: ids, boxes: [] };
      var framed = [];
      (step.show || []).forEach(function (id) {
        if (edgeEnds[id]) ids.push(edgeEnds[id][0], edgeEnds[id][1]);
        frameData.forEach(function (f) { if (f.messages.indexOf(id) >= 0) framed.push(f.box); });
      });
      return { ids: ids, boxes: framed };
    }
    function stepFocusBox(seen) {
      var step = steps[stepIndex];
      var box;
      if (step.focus && step.focus.length) box = camera.boxOf(step.focus);
      else {
        var d = defaultFocus(step);
        box = camera.boxOf(d.ids);
        d.boxes.forEach(function (b) { box = camera.unionBox(box, { x: b[0], y: b[1], w: b[2], h: b[3] }); });
      }
      if (!box) box = camera.boxOf(step.highlight);
      return box || camera.boxOf(Object.keys(seen));
    }
    // A step that frames every id (the closing "Everything" step) shows the whole
    // diagram, which is the fit camera, not a padded focus box.
    function framesEverything(step) {
      var named = step.focus && step.focus.length ? step.focus : (step.show || []);
      var all = data.ids || [];
      return all.length > 0 && all.every(function (id) { return named.indexOf(id) >= 0; });
    }

    function goTo(i) {
      if (!steps.length) return;
      presenting = true;
      stepIndex = clamp(Math.round(finite(i, 0)), 0, steps.length - 1);
      stage.classList.add('pa-presenting');
      var seen = applyReveal();
      if (hooks.onStep) hooks.onStep();
      camera.unfit();
      camera.moveTo(framesEverything(steps[stepIndex]) ? camera.fitCamera() : camera.cameraFor(stepFocusBox(seen)));
    }
    function present(i) { goTo(i || 0); }
    function next() { if (presenting) goTo(stepIndex + 1); }
    function prev() { if (presenting) goTo(stepIndex - 1); }
    function exit() {
      if (!presenting) return;
      presenting = false;
      stage.classList.remove('pa-presenting');
      clearReveal();
      if (hooks.onStep) hooks.onStep();
      camera.fit();
    }
    function togglePresent() { if (presenting) exit(); else present(0); }

    return {
      isPresenting: function () { return presenting; },
      index: function () { return stepIndex; },
      count: function () { return steps.length; },
      current: function () { return steps[stepIndex] || null; },
      goTo: goTo, present: present, next: next, prev: prev, exit: exit, togglePresent: togglePresent,
    };
  };
})(window);
```

- [ ] **Step 7: `template/transport.js` (the caption painter, moved)**

```js
// make-diagram viewer, transport: paints the caption element an embedder passes
// (children found by their data-pa-* attributes, every one optional) and wires
// its buttons. Registered as PADiagram.transport and composed by viewer.js.
//
//   var transport = PADiagram.transport({ caption }, data, story);
//
// Hooks: data-pa-count ("n / N"), data-pa-title, data-pa-note (hidden when the
// step has none), data-pa-prev and data-pa-next (disabled at the ends), data-pa-exit.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.transport = function (holders, data, story) {
    var caption = holders.caption || null;
    var part = function (name) { return caption ? caption.querySelector('[' + name + ']') : null; };

    function paint() {
      if (!caption) return;
      var presenting = story.isPresenting();
      caption.hidden = !presenting;
      if (!presenting) return;
      var step = story.current();
      var i = story.index();
      var n = story.count();
      var title = part('data-pa-title');
      var note = part('data-pa-note');
      var count = part('data-pa-count');
      var prev = part('data-pa-prev');
      var next = part('data-pa-next');
      if (title) title.textContent = step.title || '';
      if (note) { note.textContent = step.note || ''; note.hidden = !step.note; }
      if (count) count.textContent = (i + 1) + ' / ' + n;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === n - 1;
    }
    function wire(name, fn) {
      var b = part(name);
      if (b) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    }
    wire('data-pa-prev', story.prev);
    wire('data-pa-next', story.next);
    wire('data-pa-exit', story.exit);
    paint();
    return { paint: paint };
  };
})(window);
```

- [ ] **Step 8: the slim `template/viewer.js`** (replace the whole file)

```js
// make-diagram viewer core: PADiagram.mount wires the camera (camera.js), the
// trace (explore.js), the story (story.js) and the transport (transport.js)
// around one rendered diagram, and owns pointer and keyboard handling, edge
// animation and the controller's state. No toolbar or page chrome in here: the
// page's own script (toolbar.js) and make-explainer drive it through the
// controller that mount returns.
//
//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, onChange });
//
// stageElement  holds the diagram <svg> (from buildDiagram) and sizes it.
// data          buildDiagram(spec).data (scripts/lib/data.mjs); nothing is fetched.
// keys          element that receives the keyboard shortcuts (default: stageElement).
// caption       element with [data-pa-title] [data-pa-note] [data-pa-count] [data-pa-prev]
//               [data-pa-next] [data-pa-exit] children; every one is optional.
// onChange      called with ctl.state() after any change.
//
// Every state class (pa-dim, pa-on, pa-hl, pa-hidden, pa-animate) is styled by
// diagramCss(); the modules only toggle them.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var DOUBLE_CLICK_MS = 300; // a second click this soon after one that stepped is part of a double click
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

  function mount(stage, data, options) {
    options = options || {};
    var svg = stage.querySelector('svg');
    if (!svg) return null;
    var els = elementsOf(svg);
    var camera = PADiagram.camera(stage, svg, data, { onApply: emit });
    var trace = PADiagram.trace(svg, data, els);
    var story = PADiagram.story(stage, svg, data, els, camera, { onStep: function () { transport.paint(); trace.refresh(); emit(); } });
    var transport = PADiagram.transport({ caption: options.caption || null }, data, story);

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
        animate: animateOn,
        reducedMotion: camera.reduced(),
        pinned: trace.pinned(),
      };
    }
    function emit() { if (options.onChange) options.onChange(state()); }

    // ---- pointer: pan, pinch, click, hover ------------------------------------------------
    var pointers = {};
    var dragging = false;
    var downAt = null;
    var downTarget = null;
    var lastPinch = 0;

    function pointerCount() { return Object.keys(pointers).length; }
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
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

    var lastStepClick = 0;
    function click(target) {
      if (story.isPresenting()) {
        var now = Date.now();
        if (now - lastStepClick < DOUBLE_CLICK_MS) return; // the second click of a double click
        lastStepClick = now;
        story.next();
        return;
      }
      trace.pin(trace.idAt(target));
      emit();
    }
    stage.addEventListener('dblclick', function () { if (!story.isPresenting()) camera.fit(); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      camera.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerover', function (e) { if (!dragging) trace.hover(trace.idAt(e.target)); });
    svg.addEventListener('pointerleave', function () { trace.hover(null); });
    svg.addEventListener('focusin', function (e) {
      var id = trace.idAt(e.target);
      if (!id) return;
      if (!story.isPresenting()) camera.ensureVisible(id);
      trace.focus(id);
    });
    svg.addEventListener('focusout', function () { trace.focus(null); });

    // ---- keyboard --------------------------------------------------------------------------
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var onButton = !!t && t.tagName === 'BUTTON';
      var k = e.key;
      var presenting = story.isPresenting();
      var handled = true;
      if (k === 'f' || k === 'F') camera.fit();
      else if (k === '+' || k === '=') camera.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') camera.zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') story.togglePresent();
      else if (k === 'a' || k === 'A') { if (!camera.reduced()) toggleAnimate(); }
      else if (k === 'Escape') {
        if (presenting) story.exit();
        else if (trace.active()) {
          var hadFocus = trace.hasFocus();
          trace.clear();
          if (hadFocus && t && t.blur) t.blur(); // focusout clears the focus trace
          emit();
        } else handled = false;
      } else if (presenting && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !onButton))) story.next();
      else if (presenting && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')) story.prev();
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
      present: story.present, goTo: story.goTo, next: story.next, prev: story.prev, exit: story.exit, togglePresent: story.togglePresent,
      setAnimate: setAnimate, toggleAnimate: toggleAnimate,
    };
  }

  PADiagram.mount = mount;
})(window);
```

`emit` is a hoisted function declaration, so the camera hook may name it before its line; nothing applies the camera until `camera.refit()` at the end, when every module exists. `transport` is assigned before any `onStep` can run.

- [ ] **Step 9: Run every test**

Run: `npm test` (make-diagram) — expected: green, including `test/runtime.test.mjs`, every browser test unchanged, `check.test.mjs` (its doctor string still matches `story.js`). Then `cd ../make-explainer && npm test` — expected: every behaviour test green (its overlay mounts the new bundle through `viewerRuntime()`). Verify `golden.test.mjs`: the recap golden is normalised body markup; if the inlined runtime sits inside the body and the split moved its text, the recap golden changes — read the diff, confirm only script text moved, regenerate with `UPDATE_GOLDEN=1 node --test test/golden.test.mjs`, and say so in the commit body. `wc -l template/*.js` — every file under 400.

- [ ] **Step 10: Commit**

Message: `refactor(make-diagram): split the viewer runtime into camera, trace, story and transport modules` — the orchestrator commits; do not run git commit.

---

### Task 5: the story player — beats, lighting, transport, chips, tabs, keyboard

**Files:**
- Modify: `template/story.js` (rewritten around `data.beats`), `template/transport.js` (rewritten: caption line, chips, scrubber, chapter buttons), `template/viewer.js` (keyboard map, click, state, options, controller), `template/viewer.html` (tabs, chapter row, transport bar, plain CSS), `template/toolbar.js` (mode buttons, export strip)
- Modify: `scripts/lib/css.mjs` (`.pa-active`)
- Create: `test/helpers/page.mjs`, `test/story-browser.test.mjs`
- Modify: `test/helpers/browser.mjs:14` (`EXAMPLES` gains `story`), `test/helpers/prototype-ids.mjs` (a story spec), `test/browser.test.mjs` (the cases the spec changes), `test/build.test.mjs:141` (hook list)
- Modify: `plugins/portable-artifacts/skills/make-explainer/test/diagram-browser.test.mjs:89` (`Space` → `ArrowRight`: Space is play/pause from now on)

**Interfaces:**
- Consumes: `data.beats`, `data.chapters` (Task 3); `PADiagram.camera/trace` (Task 4).
- Produces: `PADiagram.story(...)` → `{ isPresenting, index, count, current, chapter, goTo, present, next, prev, first, last, nextChapter, prevChapter, exit, togglePresent }` (Task 6 adds play, pause, togglePlay, isPlaying, speed, setSpeed, cycleSpeed, loop, setLoop, toggleLoop).
- Produces: `PADiagram.transport({ caption, chapters }, data, story)`; hooks `data-pa-line`, `data-pa-beats`, `data-pa-chapters`, `data-pa-prev-chapter`, `data-pa-next-chapter`, `data-pa-scrub`, `data-pa-ticks`, plus the older `data-pa-count` (`n / N`), `data-pa-title`, `data-pa-note`, `data-pa-prev`, `data-pa-next`, `data-pa-exit`; chips `button.pa-chip[data-pa-beat|data-pa-chapter]` with `aria-current="true"` on the active one.
- Produces: `PADiagram.mount(stage, data, { keys, caption, chapters, onChange })`; `ctl` gains `first, last, nextChapter, prevChapter`; `state()` gains `chapter`.
- Produces: page hooks `[data-pa-mode="play"]`, `[data-pa-mode="explore"]` (aria-pressed); state classes `pa-active` (the hop's edge), `pa-dim`/`pa-hl` on story beats.
- Behaviour the spec changes (browser tests rewritten, not deleted): a canvas click in Play no longer steps; Space no longer steps (it becomes play/pause in Task 6; in this task it does nothing in Play); the page's caption shows `[data-pa-line]` instead of `[data-pa-title]`/`[data-pa-note]`; `P` enters Play and does nothing inside it; `[data-act="present"]` becomes the two `[data-pa-mode]` tabs. The hover trace is off while in Play (master decision 11).

- [ ] **Step 1: Test helpers**

Create `test/helpers/page.mjs`:

```js
// Shared by the story and explore browser suites: open a built page with the
// console watched, wait for the camera to settle, read the viewBox and boxes.
import { launchBrowser, haveBrowser } from './browser.mjs';

let browser;
export async function closeBrowser() { await browser?.close(); browser = undefined; }

export async function skipUnlessBrowser(t) {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
}

/** Opens `url`; collects every console error and warning and every page error in `problems`. */
export async function openPage(url, { width = 1440, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', hash = '' } = {}) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url + hash);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

export const viewBox = (page) => page.evaluate(() => document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number));

// Waits until the viewBox has held still for QUIET_MS (a glide has finished); polls every frame.
const QUIET_MS = 100;
export async function settle(page) {
  await page.evaluate(() => { delete window.__settle; });
  await page.waitForFunction((quiet) => {
    const now = performance.now();
    const vb = document.querySelector('#pa-stage svg').getAttribute('viewBox');
    const s = (window.__settle ??= { vb, at: now });
    if (s.vb !== vb) { s.vb = vb; s.at = now; }
    return now - s.at >= quiet;
  }, QUIET_MS, { polling: 'raf', timeout: 10000 });
}

/** [x, y, w, h] of the union of the data boxes of `ids`. */
export const boxOf = (page, ids) => page.evaluate((list) => {
  const data = JSON.parse(document.getElementById('pa-data').textContent);
  const bs = list.map((id) => data.boxes[id]);
  const x0 = Math.min(...bs.map((b) => b[0]));
  const y0 = Math.min(...bs.map((b) => b[1]));
  return [x0, y0, Math.max(...bs.map((b) => b[0] + b[2])) - x0, Math.max(...bs.map((b) => b[1] + b[3])) - y0];
}, ids);

/** Whether the viewBox holds `box` with `pad` around it (1 px of rounding allowed). */
export const holds = (vb, box, pad = 48) => vb[0] <= box[0] - pad + 1 && vb[1] <= box[1] - pad + 1 && vb[0] + vb[2] >= box[0] + box[2] + pad - 1 && vb[1] + vb[3] >= box[1] + box[3] + pad - 1;

export const stageCentre = async (page) => {
  const r = await page.locator('#pa-stage').boundingBox();
  return { x: r.x + r.width / 2, y: r.y + 5 };
};
```

`test/helpers/browser.mjs:14`: `export const EXAMPLES = ['architecture', 'flow', 'state', 'sequence', 'story'];` (the story example now renders, screenshots, fits text, passes `check.mjs` and the size budget with the others).

`test/helpers/prototype-ids.mjs` — add an entry:

```js
  'a story named constructor hopping from a node named constructor': {
    title: 'St', type: 'flow',
    nodes: [{ id: 'constructor', label: 'Ctor' }, { id: 'b', label: 'B' }],
    edges: [{ id: 'hop', from: 'constructor', to: 'b' }],
    stories: [{ id: 'constructor', title: 'Ctor', beats: [{ title: 'go', from: 'constructor', to: 'b' }, { title: 'look', focus: ['constructor'] }] }],
  },
```

- [ ] **Step 2: Write the failing browser tests**

Create `test/story-browser.test.mjs`:

```js
// The story player: the Play story / Explore tabs, the transport, chapter and
// beat chips, the caption line, lighting and dimming, and the keyboard map.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle, viewBox, boxOf, holds } from './helpers/page.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name }));
const N = 9; // beats in the story example

const count = (page) => page.textContent('[data-pa-count]');
const line = (page) => page.textContent('[data-pa-line]');
const pressed = (page, sel) => page.getAttribute(sel, 'aria-pressed');
const dimmedNodes = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-node.pa-dim')].map((n) => n.dataset.id).sort());
const activeEdges = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-edge.pa-active')].map((e) => e.dataset.id));
const hasClass = (page, sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
const current = (page, attr) => page.evaluate((a) => document.querySelector(`[${a}][aria-current="true"]`)?.getAttribute(a) ?? null, attr);
const LINE_1 = '01 / 09 · PLACE THE ORDER · The shopper taps Buy — The app builds the order from the basket.';

test('the Play story tab enters the player on beat 1: count, caption line, chapter and beat chips, scrubber', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await page.isVisible('[data-pa-chapters]'), false);
  assert.equal(await pressed(page, '[data-pa-mode="explore"]'), 'true');
  await page.click('[data-pa-mode="play"]');
  assert.equal(await page.isVisible('[data-pa-caption]'), true);
  assert.equal(await pressed(page, '[data-pa-mode="play"]'), 'true');
  assert.equal(await pressed(page, '[data-pa-mode="explore"]'), 'false');
  assert.equal(await count(page), `1 / ${N}`);
  assert.equal(await line(page), LINE_1);
  assert.equal(await page.getAttribute('[data-pa-line]', 'aria-live'), 'polite');
  assert.deepEqual(await page.locator('[data-pa-chapter]').allTextContents(), ['Place the order', 'Fulfil it']);
  assert.equal(await current(page, 'data-pa-chapter'), '0');
  assert.equal(await page.locator('[data-pa-beat]').count(), N);
  assert.equal(await page.textContent('[data-pa-beat="1"]'), '02 The app calls the API');
  assert.equal(await current(page, 'data-pa-beat'), '0');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'max'), String(N - 1));
  assert.equal(await page.inputValue('[data-pa-scrub]'), '0');
  assert.equal(await page.locator('[data-pa-ticks] option').count(), N);
  await page.click('[data-pa-mode="explore"]');
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await pressed(page, '[data-pa-mode="play"]'), 'false');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a hop beat lights its edge and both ends, dims the rest, and the camera holds both ends with 48 px around', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await settle(page);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  assert.deepEqual(await dimmedNodes(page), ['bus', 'db', 'gateway', 'orders', 'warehouse']);
  assert.equal(await page.locator('.pa-edge.pa-dim').count(), 6, 'every other edge dims');
  assert.equal(await page.locator('.pa-edge-label.pa-dim').count(), 6, 'and its label with it');
  assert.equal(await page.locator('.pa-node.pa-hl').count(), 0, 'a hop does not outline its ends');
  assert.ok(holds(await viewBox(page), await boxOf(page, ['shopper', 'app'])), 'the camera fits both ends');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  assert.deepEqual(await activeEdges(page), ['place']);
  assert.deepEqual(await dimmedNodes(page), ['bus', 'db', 'orders', 'shopper', 'warehouse']);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['app', 'gateway'])));
  await page.hover('.pa-node[data-id="db"]');
  assert.deepEqual(await activeEdges(page), ['place'], 'hovering in Play changes nothing');
  await page.mouse.move(5, 5); // off the diagram, so no hover trace repaints once Play ends
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pa-dim, .pa-active, .pa-hl').count(), 0, 'leaving clears the lighting');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a focus beat on a group lights the group, its members and the edges between them', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.keyboard.press('End');
  await settle(page);
  assert.equal(await count(page), `${N} / ${N}`);
  assert.equal(await line(page), '09 / 09 · FULFIL IT · The whole core — Three services, one database, one bus.');
  assert.ok(await hasClass(page, '.pa-group[data-id="core"]', 'pa-hl'));
  assert.deepEqual(await dimmedNodes(page), ['app', 'gateway', 'shopper', 'warehouse']);
  assert.equal(await page.locator('.pa-node.pa-hl').count(), 3, 'orders, db and bus are lit');
  const lit = await page.evaluate(() => [...document.querySelectorAll('.pa-edge:not(.pa-dim)')].map((e) => e.dataset.id).sort());
  assert.deepEqual(lit, ['edge-3', 'edge-4'], 'orders -> db and orders -> bus sit inside the core');
  assert.deepEqual(await activeEdges(page), [], 'no travelling edge on a focus shot');
  assert.ok(holds(await viewBox(page), await boxOf(page, ['core'])));
  assert.deepEqual(problems, []);
  await context.close();
});

test('keys: arrows and PageDown step, Home and End jump, P enters Play and is idle inside it, E and Escape leave', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '2 / 9');
  await page.keyboard.press('PageDown');
  assert.equal(await count(page), '3 / 9');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '2 / 9');
  await page.keyboard.press('End');
  assert.equal(await count(page), '9 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '9 / 9', 'clamped at the last beat');
  await page.keyboard.press('Home');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '1 / 9', 'clamped at the first beat');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('p');
  assert.equal(await count(page), '2 / 9', 'P inside Play does nothing');
  await page.keyboard.press('e');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'E leaves to Explore');
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 9', 'P starts over at beat 1');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'Escape leaves too');
  assert.equal(await page.locator('.pa-dim').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('chapter chips and the chapter buttons jump between stories; beat chips jump to a beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.click('[data-pa-chapter="1"]');
  assert.equal(await count(page), '7 / 9');
  assert.ok((await line(page)).startsWith('07 / 09 · FULFIL IT · '));
  assert.equal(await current(page, 'data-pa-chapter'), '1');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '1 / 9', "from a chapter's first beat, the chapter before");
  await page.click('[data-pa-next-chapter]');
  assert.equal(await count(page), '7 / 9');
  await page.click('[data-pa-next]');
  assert.equal(await count(page), '8 / 9');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '7 / 9', 'from inside a chapter, its first beat');
  await page.click('[data-pa-next-chapter]');
  assert.equal(await count(page), '9 / 9', 'past the last chapter, the last beat');
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  await page.click('[data-pa-beat="3"]');
  assert.equal(await count(page), '4 / 9');
  assert.equal(await current(page, 'data-pa-beat'), '3');
  assert.equal(await page.isDisabled('[data-pa-prev]'), false);
  await page.click('[data-pa-prev]');
  assert.equal(await count(page), '3 / 9');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the scrubber jumps to a beat and follows the beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.locator('[data-pa-scrub]').evaluate((el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await count(page), '5 / 9');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.inputValue('[data-pa-scrub]'), '5');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'aria-label'), 'Beat');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the older steps form plays as one Walkthrough chapter: reveal as before, no dimming, "Beat n / N"', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.keyboard.press('p');
  assert.deepEqual(await page.locator('[data-pa-chapter]').allTextContents(), ['Walkthrough']);
  assert.equal(await line(page), '01 / 03 · WALKTHROUGH · The browser calls the API — TLS ends at the load balancer.');
  assert.equal(await page.textContent('.cap-count'), 'Beat 1 / 3');
  assert.equal(await page.locator('.pa-dim').count(), 0, 'step beats hide, they do not dim');
  assert.ok((await page.locator('.pa-hidden').count()) > 0);
  await page.keyboard.press('ArrowRight');
  assert.equal(await line(page), '02 / 03 · WALKTHROUGH · The API writes the order', 'no caption, no dash');
  assert.ok(await hasClass(page, '.pa-node[data-id="db"]', 'pa-hl'));
  assert.deepEqual(problems, []);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`the story example plays at ${width} px with no console problems and no overflow`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { width, height: width === 390 ? 780 : 800 });
    await page.keyboard.press('p');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth <= window.innerWidth, h: document.documentElement.scrollHeight <= window.innerHeight }));
    assert.ok(fit.w, 'no horizontal overflow');
    assert.ok(fit.h, 'no vertical overflow');
    assert.ok((await viewBox(page)).every(Number.isFinite));
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('hostile text in story and beat titles and captions renders as text in the chips and the caption line', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const evil = '<b>&"x"';
  const spec = {
    title: 'Evil story', type: 'flow',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
    stories: [{ id: 's', title: evil, beats: [{ title: evil, caption: evil, from: 'a', to: 'b' }] }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'evil-story' }).url);
  await page.keyboard.press('p');
  assert.equal(await page.locator('b').count(), 0);
  assert.equal(await line(page), `01 / 01 · ${evil.toUpperCase()} · ${evil} — ${evil}`);
  assert.equal(await page.textContent('[data-pa-beat="0"]'), `01 ${evil}`);
  assert.equal(await page.textContent('[data-pa-chapter="0"]'), evil);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a one-beat story: prev and next clamp, the scrubber has max 0, the chapter buttons stay put', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'One beat', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', label: 'go' }], stories: [{ id: 's', title: 'S', beats: [{ title: 'Only', edge: 'edge-0' }] }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'one-beat' }).url);
  await page.keyboard.press('p');
  assert.equal(await count(page), '1 / 1');
  assert.equal(await page.getAttribute('[data-pa-scrub]', 'max'), '0');
  for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) {
    await page.keyboard.press(key);
    assert.equal(await count(page), '1 / 1', key);
  }
  await page.click('[data-pa-next-chapter]');
  await page.click('[data-pa-prev-chapter]');
  assert.equal(await count(page), '1 / 1');
  assert.equal(await page.isDisabled('[data-pa-prev]'), true);
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('exports carry no story state: no pa-active, no pa-dim, no pa-hl', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowRight');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  // the embedded stylesheet names these classes; no element may carry them
  assert.ok(!/class="[^"]*\bpa-(active|dim|hl|dot)\b/.test(text), 'no viewer state on any element');
  assert.ok(!/<circle[^>]*pa-dot/.test(text), 'no dot element');
  assert.deepEqual(problems, []);
  await context.close();
});
```

Rewrite these cases in `test/browser.test.mjs` (spec §2 changes their behaviour):

`presentation: P toggles, caption shows title, note and n / N, arrows, Space and click step` (lines 277–307) becomes:

```js
test('Play: P enters, the caption line and count show the beat, arrows and the buttons step, a canvas click does not, Escape leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), false);
  await page.keyboard.press('p');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), true);
  assert.equal(await page.textContent('[data-pa-line]'), '01 / 03 · WALKTHROUGH · The browser calls the API — TLS ends at the load balancer.');
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 3');
  assert.equal(await page.getAttribute('[data-pa-mode="play"]', 'aria-pressed'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3');
  assert.equal(await page.textContent('[data-pa-line]'), '02 / 03 · WALKTHROUGH · The API writes the order', 'a beat with no caption shows none');
  await page.keyboard.press('ArrowRight');
  assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'));
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3');
  await page.click('[data-pa-next]');
  assert.equal(await page.textContent('[data-pa-count]'), '3 / 3');
  assert.equal(await page.isDisabled('[data-pa-next]'), true);
  await page.click('[data-pa-prev]');
  const c = await stageCentre(page);
  await page.mouse.click(c.x, c.y + 60);
  assert.equal(await page.textContent('[data-pa-count]'), '2 / 3', 'a click on the canvas no longer steps');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), false);
  assert.equal(await page.getAttribute('[data-pa-mode="play"]', 'aria-pressed'), 'false');
  assert.equal(await page.locator('.pa-hidden').count(), 0, 'leaving shows everything again');
  assert.deepEqual(problems, []);
  await context.close();
});
```

`a double click in presentation advances one step, not two` (lines 584–596) becomes:

```js
test('a double click on the canvas in Play neither steps nor leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('architecture').url);
  await page.keyboard.press('p');
  const c = await stageCentre(page);
  await page.mouse.dblclick(c.x, c.y + 60);
  assert.equal(await page.textContent('[data-pa-count]'), '1 / 3');
  assert.equal(await page.locator('[data-pa-caption]').isVisible(), true);
  assert.deepEqual(problems, []);
  await context.close();
});
```

Point reads of `[data-pa-title]` at the line instead: line 392 → `assert.ok((await page.textContent('[data-pa-line]')).includes(example('architecture').steps[1].title));`; line 484 → `assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'), name);`; line 557 → `assert.ok((await page.textContent('[data-pa-line]')).endsWith('· Everything'));`; line 828 → `assert.ok((await page.textContent('[data-pa-line]')).includes(evil));`.

`test/build.test.mjs:141` hook list: replace `'data-act="present"'` with `'data-pa-mode="play"', 'data-pa-mode="explore"', 'data-pa-chapters', 'data-pa-line', 'data-pa-scrub'`.

`make-explainer/test/diagram-browser.test.mjs:89`: `await page.keyboard.press('Space');` → `await page.keyboard.press('ArrowRight');` (its comment: Space is the play/pause key from here on).

- [ ] **Step 3: Run the new and changed tests to see them fail**

Run: `node --test test/story-browser.test.mjs test/browser.test.mjs test/build.test.mjs`
Expected (with a browser): the story-browser tests fail at `[data-pa-mode="play"]` / `[data-pa-line]` (no such element; Playwright times out or `textContent` returns null), the rewritten browser tests fail the same way, build.test fails on the missing hooks. Without a browser only build.test fails; that is the RED run then.

- [ ] **Step 4: `template/story.js` — the beat engine** (replace the whole file)

```js
// make-diagram viewer, story: the timeline of beats (data.beats, grouped into
// data.chapters) the player steps through. A hop beat fits both ends of its
// edge and lights the edge; a focus beat fits and lights its ids (a group
// lights its members); everything else dims. A step beat (from the older
// steps[] form) reveals what it shows and hides the rest, as before, with no
// dimming. Registered as PADiagram.story and composed by viewer.js.
//
//   var story = PADiagram.story(stage, svg, data, els, camera, { onStep });
//
// onStep runs after every change of beat or mode, before the camera moves.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var GLIDE_MS = 600; // the camera's glide to a beat

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };

  PADiagram.story = function (stage, svg, data, els, camera, hooks) {
    hooks = hooks || {};
    var beats = data.beats || [];
    var chapters = data.chapters || [];
    var edgeEnds = PADiagram.dict(data.edges);
    var parents = PADiagram.dict(data.parents);
    var frameData = data.frames || [];
    var isSequence = data.type === 'sequence';
    var stepMode = beats.length > 0 && beats[0].kind === 'step'; // a timeline is all steps or no steps
    var words = function (el, name) { var v = el.getAttribute(name); return v ? v.split(' ') : []; };
    var presenting = false;
    var stepIndex = 0;

    // ---- step beats: reveal, hide, emphasise (the older steps[] form) ---------------------
    // What the beats up to `n` reveal: their reveal, ids and highlight lists, each
    // node's ancestor groups, and the participants of a revealed message
    // (scripts/lib/steps.mjs applies the same rules for the closing "Everything" step).
    function revealedThrough(n) {
      var seen = PADiagram.dict();
      var add = function (id) {
        for (var at = id; at !== undefined && !seen[at]; at = parents[at]) seen[at] = true;
      };
      for (var i = 0; i <= n; i++) {
        var b = beats[i];
        [].concat(b.reveal, b.ids, b.highlight).forEach(add);
      }
      Object.keys(edgeEnds).forEach(function (e) {
        if (isSequence && seen[e]) { add(edgeEnds[e][0]); add(edgeEnds[e][1]); }
      });
      return seen;
    }
    function applyReveal() {
      var seen = revealedThrough(stepIndex);
      var beat = beats[stepIndex];
      var hide = function (el, hidden) { if (el) el.classList.toggle('pa-hidden', hidden); };
      Object.keys(els.nodes).forEach(function (id) { hide(els.nodes[id], !seen[id]); });
      Object.keys(els.groups).forEach(function (id) { hide(els.groups[id], !seen[id]); });
      Object.keys(els.edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        var shown = isSequence ? !!seen[id] : !!seen[ends[0]] && !!seen[ends[1]];
        hide(els.edges[id], !shown);
        hide(els.labels[id], !shown);
      });
      els.lifelines.forEach(function (el) { hide(el, !seen[el.getAttribute('data-for')]); });
      els.frames.forEach(function (el) { hide(el, !words(el, 'data-messages').some(function (m) { return seen[m]; })); });
      els.notes.forEach(function (el) {
        var after = el.getAttribute('data-after');
        hide(el, after ? !seen[after] : !words(el, 'data-over').every(function (p) { return seen[p]; }));
      });
      var hl = PADiagram.dict();
      beat.highlight.forEach(function (id) { hl[id] = true; });
      [els.nodes, els.groups, els.edges, els.labels].forEach(function (group) {
        Object.keys(group).forEach(function (id) { group[id].classList.toggle('pa-hl', !!hl[id]); });
      });
      return seen;
    }
    function clearReveal() {
      svg.querySelectorAll('.pa-hidden,.pa-hl').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-hl'); });
    }
    // A step beat with no focus fits what it reveals. In a sequence that also keeps
    // the headers of every shown message's participants and the frames around the
    // messages in view, so the reader still knows who is talking.
    function defaultFocus(beat) {
      var ids = beat.reveal.slice();
      if (!isSequence) return { ids: ids, boxes: [] };
      var framed = [];
      beat.reveal.forEach(function (id) {
        if (edgeEnds[id]) ids.push(edgeEnds[id][0], edgeEnds[id][1]);
        frameData.forEach(function (f) { if (f.messages.indexOf(id) >= 0) framed.push(f.box); });
      });
      return { ids: ids, boxes: framed };
    }
    function stepFocusBox(beat, seen) {
      var box;
      if (beat.ids.length) box = camera.boxOf(beat.ids);
      else {
        var d = defaultFocus(beat);
        box = camera.boxOf(d.ids);
        d.boxes.forEach(function (b) { box = camera.unionBox(box, { x: b[0], y: b[1], w: b[2], h: b[3] }); });
      }
      if (!box) box = camera.boxOf(beat.highlight);
      return box || camera.boxOf(Object.keys(seen));
    }
    // A step beat that frames every id (the closing "Everything" step) shows the
    // whole diagram, which is the fit camera, not a padded focus box.
    function framesEverything(beat) {
      var named = beat.ids.length ? beat.ids : beat.reveal;
      var all = data.ids || [];
      return all.length > 0 && all.every(function (id) { return named.indexOf(id) >= 0; });
    }

    // ---- story beats: light the beat, dim the rest -------------------------------------------
    var styled = []; // elements carrying pa-dim / pa-hl / pa-active, to reset cheaply
    function unlight() {
      styled.forEach(function (el) { el.classList.remove('pa-dim', 'pa-hl', 'pa-active'); });
      styled = [];
    }
    function light(beat) {
      unlight();
      var lit = PADiagram.dict();
      beat.ids.forEach(function (id) { lit[id] = true; });
      var inLit = function (id) { // the id itself, or a group around it, is lit
        for (var at = id; at !== undefined; at = parents[at]) if (lit[at]) return true;
        return false;
      };
      var set = function (el, on, cls) {
        el.classList.toggle('pa-dim', !on);
        if (on && cls) el.classList.add(cls);
        styled.push(el);
      };
      Object.keys(els.nodes).forEach(function (id) { set(els.nodes[id], inLit(id), beat.kind === 'focus' ? 'pa-hl' : null); });
      Object.keys(els.groups).forEach(function (id) { if (lit[id]) set(els.groups[id], true, 'pa-hl'); });
      Object.keys(els.edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        // a hop lights its own edge only; a focus shot lights the edges between lit ends
        var on = beat.kind === 'hop' ? id === beat.edge : inLit(ends[0]) && inLit(ends[1]);
        set(els.edges[id], on, beat.kind === 'hop' ? 'pa-active' : null);
        if (els.labels[id]) set(els.labels[id], on, null);
      });
    }

    // ---- moving between beats -----------------------------------------------------------------
    function targetOf(beat, seen) {
      if (beat.kind === 'step') return framesEverything(beat) ? camera.fitCamera() : camera.cameraFor(stepFocusBox(beat, seen));
      return camera.cameraFor(camera.boxOf(beat.ids));
    }
    function show(beat, seen) {
      camera.unfit();
      camera.moveTo(targetOf(beat, seen), { ms: GLIDE_MS });
    }
    // onStep runs before the beat paints: the trace (off in Play) drops its own
    // pa-dim marks first, so the beat's dimming is not undone by it.
    function goTo(i) {
      if (!beats.length) return;
      presenting = true;
      stepIndex = clamp(Math.round(finite(i, 0)), 0, beats.length - 1);
      stage.classList.add('pa-presenting');
      var beat = beats[stepIndex];
      if (hooks.onStep) hooks.onStep();
      var seen = stepMode ? applyReveal() : null;
      if (!stepMode) light(beat);
      show(beat, seen);
    }
    function present(i) { goTo(i || 0); }
    function next() { if (presenting) goTo(stepIndex + 1); }
    function prev() { if (presenting) goTo(stepIndex - 1); }
    function first() { if (presenting) goTo(0); }
    function last() { if (presenting) goTo(beats.length - 1); }
    function chapterAt(i) {
      for (var c = 0; c < chapters.length; c++) if (i >= chapters[c].start && i < chapters[c].end) return c;
      return 0;
    }
    function nextChapter() {
      if (!presenting) return;
      var c = chapterAt(stepIndex);
      goTo(c + 1 < chapters.length ? chapters[c + 1].start : beats.length - 1);
    }
    // From inside a chapter, back to its first beat; from its first beat, to the chapter before.
    function prevChapter() {
      if (!presenting) return;
      var c = chapterAt(stepIndex);
      goTo(stepIndex > chapters[c].start || c === 0 ? chapters[c].start : chapters[c - 1].start);
    }
    function exit() {
      if (!presenting) return;
      presenting = false;
      stage.classList.remove('pa-presenting');
      clearReveal();
      unlight();
      if (hooks.onStep) hooks.onStep();
      camera.fit();
    }
    function togglePresent() { if (presenting) exit(); else present(0); }

    return {
      isPresenting: function () { return presenting; },
      index: function () { return stepIndex; },
      count: function () { return beats.length; },
      current: function () { return beats[stepIndex] || null; },
      chapter: function () { return chapterAt(stepIndex); },
      goTo: goTo, present: present, next: next, prev: prev, first: first, last: last,
      nextChapter: nextChapter, prevChapter: prevChapter, exit: exit, togglePresent: togglePresent,
    };
  };
})(window);
```

`check.test.mjs:80` keeps matching: the line `function next() { if (presenting) goTo(stepIndex + 1); }` is unchanged.

- [ ] **Step 5: `template/transport.js` — line, chips, scrubber, buttons** (replace the whole file)

```js
// make-diagram viewer, transport: paints the player controls an embedder passes
// (`caption`: the bar with the line, chips and buttons; `chapters`: where the
// chapter chips go), each child found by its data-pa-* attribute and every one
// optional, and wires the buttons. Registered as PADiagram.transport.
//
//   var transport = PADiagram.transport({ caption, chapters }, data, story);
//
// Hooks: data-pa-line ("06 / 13 · CHAPTER · Title — caption"), data-pa-count
// ("n / N"), data-pa-title and data-pa-note (the older caption parts),
// data-pa-beats and data-pa-chapters (chip rows, filled here with buttons that
// jump), data-pa-scrub (an <input type="range">) and data-pa-ticks (its
// <datalist>), data-pa-prev, data-pa-next, data-pa-prev-chapter,
// data-pa-next-chapter, data-pa-exit. Text goes in as textContent, never markup.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  PADiagram.transport = function (holders, data, story) {
    var caption = holders.caption || null;
    var chaptersEl = holders.chapters || null;
    var doc = global.document;
    var beats = data.beats || [];
    var chapters = data.chapters || [];
    var part = function (name) { return caption ? caption.querySelector('[' + name + ']') : null; };
    var text = function (el, value) { if (el) el.textContent = value; };

    // One chip per beat or chapter: a button that jumps there. Built once.
    function chip(attr, i, label, onClick) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'pa-chip';
      b.setAttribute(attr, String(i));
      b.textContent = label;
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
      return b;
    }
    var beatRow = part('data-pa-beats');
    var beatChips = beatRow ? beats.map(function (b, i) { return beatRow.appendChild(chip('data-pa-beat', i, pad2(i + 1) + ' ' + b.title, function () { story.goTo(i); })); }) : [];
    var chapterChips = chaptersEl ? chapters.map(function (ch, i) { return chaptersEl.appendChild(chip('data-pa-chapter', i, ch.title, function () { story.goTo(ch.start); })); }) : [];
    var ticks = part('data-pa-ticks');
    if (ticks) beats.forEach(function (_, i) { var o = doc.createElement('option'); o.value = String(i); ticks.appendChild(o); });
    var scrub = part('data-pa-scrub');
    if (scrub) { scrub.min = '0'; scrub.max = String(Math.max(0, beats.length - 1)); scrub.step = '1'; }

    function line(beat, i, n) {
      var ch = chapters[story.chapter()];
      var head = pad2(i + 1) + ' / ' + pad2(n) + (ch ? ' · ' + ch.title.toUpperCase() : '') + ' · ' + beat.title;
      return beat.caption ? head + ' — ' + beat.caption : head;
    }
    function mark(chips, active) {
      chips.forEach(function (c, i) {
        if (i === active) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });
      if (chips[active] && chips[active].scrollIntoView) chips[active].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function paint() {
      var presenting = story.isPresenting();
      if (caption) caption.hidden = !presenting;
      if (chaptersEl) chaptersEl.hidden = !presenting;
      if (!presenting) return;
      var beat = story.current();
      var i = story.index();
      var n = story.count();
      text(part('data-pa-count'), (i + 1) + ' / ' + n);
      text(part('data-pa-title'), beat.title);
      var note = part('data-pa-note');
      if (note) { note.textContent = beat.caption || ''; note.hidden = !beat.caption; }
      text(part('data-pa-line'), line(beat, i, n));
      var prev = part('data-pa-prev');
      if (prev) prev.disabled = i === 0;
      var next = part('data-pa-next');
      if (next) next.disabled = i === n - 1;
      if (scrub && scrub.value !== String(i)) scrub.value = String(i);
      mark(beatChips, i);
      mark(chapterChips, story.chapter());
    }
    function wire(name, fn) {
      var b = part(name);
      if (b) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    }
    wire('data-pa-prev', story.prev);
    wire('data-pa-next', story.next);
    wire('data-pa-exit', story.exit);
    wire('data-pa-prev-chapter', story.prevChapter);
    wire('data-pa-next-chapter', story.nextChapter);
    if (scrub) scrub.addEventListener('input', function () { story.goTo(Number(scrub.value)); });
    paint();
    return { paint: paint };
  };
})(window);
```

- [ ] **Step 6: `template/viewer.js` changes**

Header comment: the signature line becomes `//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, chapters, onChange });` and the `caption` lines become:

```js
// caption       the transport element (see transport.js for its data-pa-* children; every one optional).
// chapters      element the chapter chips are appended to (optional).
```

Delete `var DOUBLE_CLICK_MS = …` and `var lastStepClick = 0;`. In `mount`, construct the modules so:

```js
    var trace = PADiagram.trace(svg, data, els, { isOff: function () { return story.isPresenting(); } });
    var story = PADiagram.story(stage, svg, data, els, camera, { onStep: function () { transport.paint(); trace.refresh(); emit(); } });
    var transport = PADiagram.transport({ caption: options.caption || null, chapters: options.chapters || null }, data, story);
```

(`isOff` runs only on later events, when `story` is assigned.) `state()` gains `chapter: story.chapter(),`. `click` becomes:

```js
    // In Play a click on the canvas selects nothing (Task 6 makes it pause); in Explore it pins the trace.
    function click(target) {
      if (story.isPresenting()) return;
      trace.pin(trace.idAt(target));
      emit();
    }
```

`onKey` becomes (the whole function):

```js
    // Space plays and pauses (Task 6); arrows, PageUp/PageDown, Home and End move
    // between beats; P enters Play, E leaves it; F fits; A toggles the edge
    // animation; Escape leaves Play, else clears the trace.
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var k = e.key;
      var inPlay = story.isPresenting();
      var handled = true;
      if (k === 'f' || k === 'F') camera.fit();
      else if (k === '+' || k === '=') camera.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') camera.zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') { if (!inPlay) story.present(0); }
      else if (k === 'e' || k === 'E') story.exit();
      else if (k === 'a' || k === 'A') { if (!camera.reduced()) toggleAnimate(); }
      else if (k === 'Escape') {
        if (inPlay) story.exit();
        else if (trace.active()) {
          var hadFocus = trace.hasFocus();
          trace.clear();
          if (hadFocus && t && t.blur) t.blur(); // focusout clears the focus trace
          emit();
        } else handled = false;
      } else if (inPlay && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown')) story.next();
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
```

The returned controller gains `first: story.first, last: story.last, nextChapter: story.nextChapter, prevChapter: story.prevChapter,`.

- [ ] **Step 7: `scripts/lib/css.mjs`** — add to the `state` list (the look is phase 3's; this is the plain accent):

```js
  '.pa-edge.pa-active path{stroke:var(--accent);stroke-width:2.5}',
  '.pa-edge.pa-active .pa-arrow-fill{fill:var(--accent)}',
  '.pa-edge.pa-active .pa-arrow-open{stroke:var(--accent)}',
```

- [ ] **Step 8: `template/viewer.html`**

Replace the `.caption`, `.cap-text`, `.cap-count`, `.cap-title`, `.cap-note` and `.cap-nav` rules with:

```css
.bar .chapters { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 6px; }
.chapters[hidden] { display: none; }
.pa-chip { background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; cursor: pointer; color: var(--text-2); font-size: 0.8rem; line-height: 1.4; white-space: nowrap; }
.pa-chip:hover { color: var(--text); }
.pa-chip[aria-current="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.caption { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; background: var(--surface); border-top: 1px solid var(--line); }
.caption[hidden] { display: none; }
.cap-line { margin: 0; font-size: 0.95rem; line-height: 1.4; overflow-wrap: anywhere; }
.beats { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.transport { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.scrub { flex: 1 1 160px; min-width: 120px; margin: 0; }
.cap-count { color: var(--text-3); font-size: 0.8rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
```

In the header, replace the `Present` button with a Mode group placed first in `.tools`, and add the chapter row after `.tools` (still inside `<header>`):

```html
<span class="group" role="group" aria-label="Mode">
<button type="button" class="tool" data-pa-mode="play" aria-pressed="false" title="Play the story (P)">Play story</button>
<button type="button" class="tool" data-pa-mode="explore" aria-pressed="true" title="Explore the diagram (E)">Explore</button>
</span>
```

```html
<div class="chapters" data-pa-chapters role="group" aria-label="Chapters" hidden></div>
```

Replace the `<aside class="caption" …>…</aside>` block with:

```html
<aside class="caption" data-pa-caption aria-label="Story player" hidden>
<p class="cap-line" data-pa-line aria-live="polite"></p>
<div class="beats" data-pa-beats role="group" aria-label="Beats"></div>
<div class="transport" role="group" aria-label="Transport">
<button type="button" class="tool" data-pa-prev-chapter title="Previous chapter">Prev chapter</button>
<button type="button" class="tool" data-pa-prev title="Previous beat (Left)">Prev</button>
<button type="button" class="tool" data-pa-next title="Next beat (Right)">Next</button>
<button type="button" class="tool" data-pa-next-chapter title="Next chapter">Next chapter</button>
<input type="range" class="scrub" data-pa-scrub min="0" max="0" step="1" value="0" aria-label="Beat" list="pa-ticks">
<datalist id="pa-ticks" data-pa-ticks></datalist>
<span class="cap-count">Beat <span data-pa-count></span></span>
<button type="button" class="tool" data-pa-exit title="Leave the story (Esc)">Exit</button>
</div>
</aside>
```

- [ ] **Step 9: `template/toolbar.js`**

After `var buttons = {}; …` add:

```js
  var modes = {};
  document.querySelectorAll('[data-pa-mode]').forEach(function (b) { modes[b.getAttribute('data-pa-mode')] = b; });
```

In `sync(state)` replace the `if (buttons.present) {…}` block with:

```js
    if (modes.play) {
      modes.play.setAttribute('aria-pressed', String(state.presenting));
      modes.play.disabled = state.steps === 0;
    }
    if (modes.explore) modes.explore.setAttribute('aria-pressed', String(!state.presenting));
```

Mount with the chapter row: `var ctl = window.PADiagram.mount(stage, data, { keys: document, caption: one('[data-pa-caption]'), chapters: one('[data-pa-chapters]'), onChange: sync });`. Remove `present: function () { ctl.togglePresent(); },` from `act` and add after the `act` wiring:

```js
  // The tabs: Play story enters the player on its first beat (the transport's Play starts it); Explore leaves it.
  if (modes.play) modes.play.addEventListener('click', function () { if (!ctl.state().presenting) ctl.present(0); });
  if (modes.explore) modes.explore.addEventListener('click', function () { ctl.exit(); });
```

In `standaloneSvg`, strip the active class too: `clone.querySelectorAll('.pa-hidden,.pa-dim,.pa-on,.pa-hl,.pa-active').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-dim', 'pa-on', 'pa-hl', 'pa-active'); });`.

- [ ] **Step 10: Run the tests to see them pass**

Run: `npm test` (make-diagram) — expected: green: `story-browser.test.mjs`, the rewritten cases, every other suite, `check.test.mjs` (story example included via `EXAMPLES`, `check: ok (2 viewports, 9 beats)`), `runtime.test.mjs` (every template file under 400 lines — `wc -l template/*.js`). Then `cd ../make-explainer && npm test` — expected: green with the one-line `ArrowRight` edit. Then `python3 -m pytest -q` from the repo root — green.

- [ ] **Step 11: Commit**

Message: `feat(make-diagram): story player with transport, chapter and beat chips` — the orchestrator commits; do not run git commit.

---

### Task 6: play — timers, the travelling dot, speed, loop, pause on interaction, autoplay, reduced motion

**Files:**
- Modify: `template/story.js` (play loop, dot), `template/transport.js` (play, speed, loop controls), `template/viewer.js` (Space, pause on pointer and keys), `template/viewer.html` (three buttons), `template/toolbar.js` (autoplay on ready; export strips the dot)
- Modify: `scripts/lib/css.mjs` (`.pa-dot`)
- Modify: `test/story-browser.test.mjs` (play tests)

**Interfaces:**
- Produces: `story` gains `isPlaying, speed, loop, play, pause, togglePlay, setSpeed, cycleSpeed, setLoop, toggleLoop`; `state()` gains `playing, speed, loop`; `ctl` gains `play, pause, togglePlay, setSpeed, cycleSpeed, setLoop, toggleLoop`.
- Produces: hooks `[data-pa-play]` (aria-pressed; text `Play`/`Pause`), `[data-pa-speed]` (text `0.5×|1×|1.5×|2×`), `[data-pa-loop]` (aria-pressed); stage class `pa-playing`; `circle.pa-dot` (class `pa-dot-on` while it travels).
- Timings: `GLIDE_MS 600`, `DOT_MS 1200`, `HOLD_MS 2500 + 40/char ≤ 6000`, all `/ speed`; speeds `[0.5, 1, 1.5, 2]`; loop defaults to `data.autoplay`; a focus or step beat holds without a dot. Reduced motion: no dot, instant camera, autoplay ignored.

- [ ] **Step 1: Write the failing tests** — append to `test/story-browser.test.mjs` (add `stageCentre` to the page.mjs import):

```js
// ---- play -------------------------------------------------------------------------------------

const playing = (page) => page.evaluate(() => document.getElementById('pa-stage').classList.contains('pa-playing'));
const dotAt = (page) => page.evaluate(() => { const d = document.querySelector('.pa-dot.pa-dot-on'); return d ? { x: Number(d.getAttribute('cx')), y: Number(d.getAttribute('cy')) } : null; });
const centreOf = (page, id) => page.evaluate((i) => { const b = JSON.parse(document.getElementById('pa-data').textContent).boxes[i]; return { x: b[0] + b[2] / 2, y: b[1] + b[3] / 2 }; }, id);
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const waitCount = (page, text) => page.waitForFunction((want) => document.querySelector('[data-pa-count]').textContent === want, text, { timeout: 10000 });
const waitPlaying = (page, want) => page.waitForFunction((w) => document.getElementById('pa-stage').classList.contains('pa-playing') === w, want, { timeout: 10000 });
const waitDotOn = (page) => page.waitForFunction(() => !!document.querySelector('.pa-dot.pa-dot-on'), null, { timeout: 5000 });
const waitDotMoved = (page, from) => page.waitForFunction(([x, y]) => { const d = document.querySelector('.pa-dot'); return Math.hypot(Number(d.getAttribute('cx')) - x, Number(d.getAttribute('cy')) - y) > 15; }, [from.x, from.y], { timeout: 5000 });

test('Space plays and pauses, the Play button mirrors it, speed cycles 1×, 1.5×, 2×, 0.5×, loop toggles', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  assert.equal(await playing(page), false);
  assert.equal(await pressed(page, '[data-pa-play]'), 'false');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  assert.equal(await pressed(page, '[data-pa-play]'), 'true');
  assert.equal(await page.textContent('[data-pa-play]'), 'Pause');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.equal(await page.textContent('[data-pa-play]'), 'Play');
  await page.click('[data-pa-play]');
  assert.equal(await playing(page), true);
  await page.click('[data-pa-play]');
  assert.equal(await playing(page), false);
  assert.equal(await page.textContent('[data-pa-speed]'), '1×');
  for (const next of ['1.5×', '2×', '0.5×', '1×']) {
    await page.click('[data-pa-speed]');
    assert.equal(await page.textContent('[data-pa-speed]'), next);
  }
  await page.evaluate(() => document.activeElement.blur()); // later Space presses must reach the stage, not the button
  assert.equal(await pressed(page, '[data-pa-loop]'), 'false');
  await page.click('[data-pa-loop]');
  assert.equal(await pressed(page, '[data-pa-loop]'), 'true');
  assert.deepEqual(problems, []);
  await context.close();
});

test('play advances beats at 2× and stops on the last beat; with loop on it starts over', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  await page.click('[data-pa-speed]');
  await page.click('[data-pa-speed]');
  assert.equal(await page.textContent('[data-pa-speed]'), '2×');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), '8 / 9');
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take Space itself
  await page.keyboard.press('Space');
  await waitCount(page, '9 / 9');
  await waitPlaying(page, false);
  assert.equal(await count(page), '9 / 9', 'the timeline stops on the last beat');
  await page.click('[data-pa-loop]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await waitCount(page, '1 / 9');
  assert.equal(await playing(page), true, 'loop keeps going');
  await page.keyboard.press('Space');
  assert.equal(await playing(page), false);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the dot travels along the hop edge from its start, and backwards for a reverse hop', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  for (let i = 0; i < 3; i++) await page.click('[data-pa-speed]'); // 0.5×: glide 1200 ms, dot 2400 ms
  assert.equal(await page.textContent('[data-pa-speed]'), '0.5×');
  const shopper = await centreOf(page, 'shopper');
  const app = await centreOf(page, 'app');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft'); // beat 1 again, now at 0.5×
  await waitDotOn(page);
  const p1 = await dotAt(page);
  await waitDotMoved(page, p1);
  const p2 = await dotAt(page);
  assert.ok(dist(p1, shopper) < dist(p2, shopper) && dist(p2, app) < dist(p1, app), `forward, shopper -> app: ${JSON.stringify([p1, p2])}`);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '6 / 9');
  await waitDotOn(page);
  const r1 = await dotAt(page);
  await waitDotMoved(page, r1);
  const r2 = await dotAt(page);
  assert.ok(dist(r1, app) < dist(r2, app) && dist(r2, shopper) < dist(r1, shopper), `reverse, app -> shopper: ${JSON.stringify([r1, r2])}`);
  assert.deepEqual(await activeEdges(page), ['edge-0']);
  await page.keyboard.press('End');
  await settle(page);
  assert.equal(await dotAt(page), null, 'a focus beat has no dot');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a pointer on the canvas pauses: click, wheel and drag; the beat stays', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.keyboard.press('p');
  const c = await stageCentre(page);
  await page.keyboard.press('Space');
  assert.equal(await playing(page), true);
  await page.mouse.click(c.x, c.y + 60);
  assert.equal(await playing(page), false, 'a click pauses');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Space');
  await page.mouse.move(c.x, c.y + 60);
  await page.mouse.wheel(0, 120);
  assert.equal(await playing(page), false, 'the wheel pauses');
  await page.keyboard.press('Space');
  await page.mouse.move(c.x, c.y + 200);
  await page.mouse.down();
  await page.mouse.move(c.x + 80, c.y + 200, { steps: 4 });
  await page.mouse.up();
  assert.equal(await playing(page), false, 'a drag pauses');
  assert.equal(await count(page), '1 / 9');
  await page.keyboard.press('Space');
  await page.keyboard.press('f');
  assert.equal(await playing(page), false, 'any key but Space pauses');
  assert.equal(await page.locator('.pa-dot.pa-dot-on').count(), 0, 'pausing hides the dot');
  assert.deepEqual(problems, []);
  await context.close();
});

test('autoplay starts the story playing with loop on; a #step-N link wins; reduced motion leaves it off and drops the dot', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildPage({ ...example('story'), autoplay: true }, { name: 'story-autoplay' });
  const auto = await openPage(url);
  assert.equal(await playing(auto.page), true);
  assert.equal(await pressed(auto.page, '[data-pa-loop]'), 'true');
  assert.match(await count(auto.page), /^\d \/ 9$/);
  await auto.page.keyboard.press('Space');
  assert.equal(await playing(auto.page), false);
  assert.deepEqual(auto.problems, []);
  await auto.context.close();

  const linked = await openPage(url, { hash: '#step-3' });
  assert.equal(await count(linked.page), '3 / 9');
  assert.equal(await playing(linked.page), false, 'a deep link opens paused on its beat');
  await linked.context.close();

  const reduced = await openPage(url, { reducedMotion: 'reduce' });
  assert.equal(await reduced.page.isVisible('[data-pa-caption]'), false, 'autoplay is ignored');
  await reduced.page.keyboard.press('p');
  assert.ok(holds(await viewBox(reduced.page), await boxOf(reduced.page, ['shopper', 'app'])), 'the camera jumped at once');
  await reduced.page.keyboard.press('Space');
  await waitCount(reduced.page, '2 / 9');
  assert.equal(await reduced.page.locator('.pa-dot.pa-dot-on').count(), 0, 'no dot under reduced motion');
  await reduced.page.keyboard.press('Space');
  assert.deepEqual(reduced.problems, []);
  await reduced.context.close();
});

test('a one-beat story plays to its end at once and loops when asked', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'One beat', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }], stories: [{ id: 's', title: 'S', beats: [{ title: 'Only', edge: 'edge-0' }] }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'one-beat-play' }).url);
  await page.keyboard.press('p');
  await page.click('[data-pa-speed]');
  await page.click('[data-pa-speed]'); // 2×: glide 300, dot 600, hold 1250
  await page.evaluate(() => document.activeElement.blur()); // a focused button would take Space itself
  await page.keyboard.press('Space');
  await waitPlaying(page, false);
  assert.equal(await count(page), '1 / 1');
  await page.click('[data-pa-loop]');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForTimeout(5000); // two full cycles at 2×: still looping (the one fixed wait in this suite; it asserts persistence, not arrival)
  assert.equal(await playing(page), true);
  await page.keyboard.press('Space');
  assert.deepEqual(problems, []);
  await context.close();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/story-browser.test.mjs`
Expected: the new tests fail — `[data-pa-play]` missing (null attribute), `pa-playing` never set, `waitDotOn` times out after 5 s, autoplay page not playing.

- [ ] **Step 3: `template/story.js` — the play loop**

Replace `var GLIDE_MS = 600; // the camera's glide to a beat` with:

```js
  var GLIDE_MS = 600; // the camera's glide to a beat
  var DOT_MS = 1200; // the dot along a hop's edge
  var HOLD_MS = 2500; // then the caption holds...
  var HOLD_PER_CHAR_MS = 40; // ...longer for a longer caption...
  var HOLD_MAX_MS = 6000; // ...up to this
  var SPEEDS = [0.5, 1, 1.5, 2];
  var DOT_RADIUS = 5;
  var SVG_NS = 'http://www.w3.org/2000/svg';
```

Update the header comment's second paragraph: `Playing runs each beat as glide, then (a hop, motion allowed) the dot, then a hold, and moves on; every duration divides by the speed; reduced motion drops the dot and the glide.` After `var stepIndex = 0;` add:

```js
    var playing = false;
    var speed = 1;
    var loop = !!data.autoplay; // a page that starts by itself keeps going
```

Add a new section before `// ---- moving between beats`:

```js
    // ---- the dot ---------------------------------------------------------------------------
    var dot = null;
    var dotFrame = 0;
    function dotEl() {
      if (!dot) {
        dot = global.document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'pa-dot');
        dot.setAttribute('r', String(DOT_RADIUS));
        svg.appendChild(dot); // last child: drawn over everything
      }
      return dot;
    }
    function hideDot() {
      if (dotFrame && global.cancelAnimationFrame) global.cancelAnimationFrame(dotFrame);
      dotFrame = 0;
      if (dot) dot.classList.remove('pa-dot-on');
    }
    // Slide the dot along the beat's edge over `ms` (backwards for a reverse hop), then call done.
    function travel(beat, ms, done) {
      var path = els.edges[beat.edge] ? els.edges[beat.edge].querySelector('path') : null;
      if (!path || !path.getTotalLength || !global.requestAnimationFrame) { done(); return; }
      var length = path.getTotalLength();
      var el = dotEl();
      el.classList.add('pa-dot-on');
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var p = path.getPointAtLength((beat.reverse ? 1 - k : k) * length);
        el.setAttribute('cx', String(p.x));
        el.setAttribute('cy', String(p.y));
        if (k < 1) { dotFrame = global.requestAnimationFrame(tick); return; }
        dotFrame = 0;
        done();
      };
      dotFrame = global.requestAnimationFrame(tick);
    }

    // ---- running a beat --------------------------------------------------------------------
    var run = 0; // bumps on every goTo, pause and exit, so a stale timer or frame does nothing
    var timer = 0;
    function cancelRun() {
      run += 1;
      if (timer) global.clearTimeout(timer);
      timer = 0;
      hideDot();
    }
    var later = function (token, ms, fn) {
      timer = global.setTimeout(function () { timer = 0; if (token === run) fn(); }, ms);
    };
    function holdMs(beat) {
      var chars = beat.caption ? beat.caption.length : 0;
      return Math.min(HOLD_MAX_MS, HOLD_MS + HOLD_PER_CHAR_MS * chars) / speed;
    }
```

Replace `show(beat, seen)` with:

```js
    // Show the beat: glide, then (a hop, motion allowed) the dot, then hold. While
    // playing, the hold ends in the next beat, the first again on loop, or a pause.
    function show(beat, seen) {
      var token = run;
      var instant = camera.reduced();
      camera.unfit();
      camera.moveTo(targetOf(beat, seen), { ms: GLIDE_MS / speed });
      var hold = function () {
        later(token, holdMs(beat), function () {
          if (!playing) return;
          if (stepIndex < beats.length - 1) goTo(stepIndex + 1);
          else if (loop) goTo(0);
          else pause();
        });
      };
      later(token, instant ? 0 : GLIDE_MS / speed, function () {
        if (beat.kind === 'hop' && !instant) travel(beat, DOT_MS / speed, hold); else hold();
      });
    }
```

In `goTo`, insert `cancelRun();` as the first line after `if (!beats.length) return;`. Replace `exit()` with:

```js
    function exit() {
      if (!presenting) return;
      cancelRun();
      presenting = false;
      playing = false;
      stage.classList.remove('pa-presenting', 'pa-playing');
      clearReveal();
      unlight();
      if (hooks.onStep) hooks.onStep();
      camera.fit();
    }
```

Add after `togglePresent`:

```js
    // ---- play, pause, speed, loop ---------------------------------------------------------------
    function play() {
      if (!beats.length || playing) return;
      playing = true;
      stage.classList.add('pa-playing');
      goTo(presenting ? stepIndex : 0); // runs the beat again from its glide
    }
    function pause() {
      if (!playing) return;
      cancelRun();
      playing = false;
      stage.classList.remove('pa-playing');
      if (hooks.onStep) hooks.onStep();
    }
    function togglePlay() { if (playing) pause(); else play(); }
    // A new speed applies from the next glide, dot or hold; the one under way keeps its clock.
    function setSpeed(v) { speed = SPEEDS.indexOf(v) >= 0 ? v : 1; if (hooks.onStep) hooks.onStep(); }
    function cycleSpeed() { setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]); }
    function setLoop(on) { loop = !!on; if (hooks.onStep) hooks.onStep(); }
    function toggleLoop() { setLoop(!loop); }
```

Extend the returned object with:

```js
      isPlaying: function () { return playing; },
      speed: function () { return speed; },
      loop: function () { return loop; },
      play: play, pause: pause, togglePlay: togglePlay,
      setSpeed: setSpeed, cycleSpeed: cycleSpeed, setLoop: setLoop, toggleLoop: toggleLoop,
```

- [ ] **Step 4: `template/transport.js`** — in `paint()` after the `next` lines add:

```js
      var play = part('data-pa-play');
      if (play) {
        play.setAttribute('aria-pressed', String(story.isPlaying()));
        play.textContent = story.isPlaying() ? 'Pause' : 'Play';
      }
      var speed = part('data-pa-speed');
      if (speed) {
        speed.textContent = story.speed() + '×';
        speed.setAttribute('aria-label', 'Speed ' + story.speed() + '×; change speed');
      }
      var loopButton = part('data-pa-loop');
      if (loopButton) loopButton.setAttribute('aria-pressed', String(story.loop()));
```

and after the existing `wire(...)` calls:

```js
    wire('data-pa-play', story.togglePlay);
    wire('data-pa-speed', story.cycleSpeed);
    wire('data-pa-loop', story.toggleLoop);
```

Extend the header comment's hook list with `data-pa-play (aria-pressed; Play / Pause), data-pa-speed (0.5× … 2×), data-pa-loop (aria-pressed)`.

- [ ] **Step 5: `template/viewer.js`** — `state()` gains `playing: story.isPlaying(), speed: story.speed(), loop: story.loop(),`. In the `pointerdown` handler, after the button check: `story.pause(); // a hand on the canvas stops the story (nothing happens when it is not running)`. In the `wheel` handler, after `e.preventDefault();`: `story.pause();`. In `onKey`, after `var inPlay = story.isPresenting();` add:

```js
      if (inPlay && k !== ' ') story.pause(); // any key but Space pauses; Space is the play/pause key itself
```

and before the `inPlay && (k === 'ArrowRight' …` branch add the Space branch (a focused button keeps its own Space):

```js
      } else if (inPlay && k === ' ' && !(t && t.tagName === 'BUTTON')) story.togglePlay();
      else if (inPlay && (k === 'ArrowRight' || ...
```

The controller gains `play: story.play, pause: story.pause, togglePlay: story.togglePlay, setSpeed: story.setSpeed, cycleSpeed: story.cycleSpeed, setLoop: story.setLoop, toggleLoop: story.toggleLoop,`. Header comment: add `Space plays and pauses` to the keyboard line; mention `pa-playing` among the stage classes.

- [ ] **Step 6: `template/viewer.html`** — in `.transport`, between the `Prev` and `Next` buttons:

```html
<button type="button" class="tool" data-pa-play aria-pressed="false" title="Play or pause (Space)">Play</button>
```

and between the `.cap-count` span and the `Exit` button:

```html
<button type="button" class="tool" data-pa-speed aria-label="Speed 1×; change speed" title="Playback speed">1×</button>
<button type="button" class="tool" data-pa-loop aria-pressed="false" title="Loop the story">Loop</button>
```

- [ ] **Step 7: `template/toolbar.js`** — the ready block becomes:

```js
    .then(function () {
      fromHash();
      // autoplay starts the story by itself, unless a deep link picked a beat or motion is reduced.
      if (data.autoplay && !stepRe.test(location.hash) && !ctl.state().reducedMotion) ctl.play();
      window.paReady = true;
    });
```

In `standaloneSvg`, after the class strip: `clone.querySelectorAll('.pa-dot').forEach(function (el) { el.remove(); });`.

- [ ] **Step 8: `scripts/lib/css.mjs`** — add to the `state` list:

```js
  '.pa-dot{fill:var(--accent);stroke:none;pointer-events:none;visibility:hidden}',
  '.pa-dot.pa-dot-on{visibility:visible}',
```

- [ ] **Step 9: Run the tests to see them pass**

Run: `node --test test/story-browser.test.mjs` — expected: pass. Then `npm test` — green (`check.test.mjs`: the story page passes `check.mjs`; `runtime.test.mjs`: every template file under 400 lines — if `story.js` crosses 400, move `revealedThrough/applyReveal/clearReveal/defaultFocus/stepFocusBox/framesEverything` into `template/reveal.js` as `PADiagram.reveal(svg, data, els, camera)` returning those functions, add it to `RUNTIME_FILES` before `story.js`, and update `runtime.test.mjs` accordingly). Then `cd ../make-explainer && npm test` — green. From the repo root: `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`, `python3 -m pytest -q`, `cd plugins/portable-artifacts && node bin/sync-shared.mjs --check` — all green (phase 1 never touched shared/).

- [ ] **Step 10: Guard proofs** (each new browser assertion is shown catching a broken page; revert each edit before moving on)

1. In `story.js` `light()`, change `'pa-active'` to `'pa-activ'`; run `node --test --test-name-pattern="hop beat lights" test/story-browser.test.mjs` — expected: FAIL on `activeEdges`. Revert.
2. In `travel`, swap `(beat.reverse ? 1 - k : k)` for `(beat.reverse ? k : 1 - k)`; run `--test-name-pattern="dot travels"` — expected: FAIL on the forward assertion. Revert.
3. In `viewer.js` `pointerdown`, delete `story.pause();`; run `--test-name-pattern="pointer on the canvas pauses"` — expected: FAIL at `a click pauses`. Revert.
4. In `toolbar.js`, delete the `ctl.play()` line; run `--test-name-pattern="autoplay"` — expected: FAIL at `playing === true`. Revert.
5. In `show()`, replace `else if (loop) goTo(0);` with `else if (false) goTo(0);`; run `--test-name-pattern="advances beats"` — expected: FAIL waiting for `1 / 9`. Revert.

Run `npm test` once more after the reverts — green. Record in the task report which proof failed how.

- [ ] **Step 11: Commit**

Message: `feat(make-diagram): play, speed, loop, the travelling dot, autoplay and reduced motion` — the orchestrator commits; do not run git commit.

---

## Phase 1 close-out

After Task 6, with everything on disk:

- `cd plugins/portable-artifacts/skills/make-diagram && npm test` — green.
- `cd plugins/portable-artifacts/skills/make-explainer && npm test` — green; where a task changed the embedded data block or runtime text, its recap golden was regenerated in that task's commit with the reason in the commit body (Tasks 3–6 each check this).
- `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"` (repo root) — green.
- `python3 -m pytest -q` (repo root) — green.
- `cd plugins/portable-artifacts && node bin/sync-shared.mjs --check` — `shared/ copies are in sync`.
- `wc -l plugins/portable-artifacts/skills/make-diagram/template/*.js` — every file under 400; the built story example under 400 KB (asserted by `check.test.mjs`).
- Spec coverage this phase delivers: §1 every field and limit, the stories-and-steps error, step-derived beats and layer steps as the fallback timeline; §2 Play story (transport, scrubber, count, speed, loop, caption line, beat chips, hop and focus beats with their timings, stop or loop at the end, pause on canvas interaction and on any key but Space, the keyboard map except `F` full screen and `/` Find), reduced motion, `autoplay`; §4 `stories.mjs`, the `viewerData` keys, the template split, `api.mjs` contract kept. Left to later phases: Explore (2), the look and the emoji tile (3), full screen, the make-explainer overlay transport, docs, eval, the gallery sample (4).
- Then a fresh reviewer reads the phase diff and reports every finding (the report-everything sentence from `code-review.md` goes in its prompt); CRITICAL and HIGH findings are fixed before the orchestrator commits and pushes.

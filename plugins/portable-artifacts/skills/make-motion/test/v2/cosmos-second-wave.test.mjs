// The second-wave kinds in `cosmos` (the looks phase, owner decision: every look gets every kind): media, screen, map,
// diagram, timeline, code and feed each have cosmos data, their example builds at 16:9 and 9:16 in both of cosmos's modes
// (pro and viral) with no finding from the frame review (auditFrame, every rule, on frames every 0.5 s), and no tall
// composition leaves more than 35 percent of its height empty (the plan's ban 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { lookForFormat, supportsKind, isParkedKind } from '../../engine/looks/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { barInput, drawnLeaves, contentOf, snapshotOf } from './helpers/bar.mjs';
import { expandIn, filmOf, canvasOf } from './helpers/kinds.mjs';

const LOOK = 'cosmos';
export const KINDS = Object.freeze(['media', 'screen', 'map', 'diagram', 'timeline', 'code', 'feed']);
const PREPARED = Object.freeze(['map', 'code']); // kinds whose example needs the prepare step
const COMBOS = Object.freeze([
  { mode: 'pro', format: '16:9' }, { mode: 'pro', format: '9:16' },
  { mode: 'viral', format: '16:9' }, { mode: 'viral', format: '9:16' },
]);
const AUDIT_STEP = 0.5; // s between audited frames
const MAX_EMPTY = 0.35; // of the tall composition height
const timesOf = (duration) => [...Array.from({ length: Math.floor(duration / AUDIT_STEP) + 1 }, (_, i) => i * AUDIT_STEP), duration];

// the example of each kind with its picture swapped for the test's stand-in screenshot
const exampleOf = (kind) => {
  const raw = registries.kinds.get(kind).example;
  return raw.src === undefined ? raw : { ...raw, src: 'shot.png' };
};

// The shot as buildFilm expands it in `mode` at `format` (the map and code kinds with their prepared data).
export function expandKind(kind, shot, { mode, format }) {
  const film = filmOf([shot], LOOK, format, { mode });
  const prepared = PREPARED.includes(kind) ? prepareFilm(film, { filmDir: '.' }).prepared : {};
  return { film, ...expandIn(film, 0, { prepared }) };
}

// The sheet round a map is a rounded card: the land stays inside it at both formats (the first tall sheets showed Asia
// and Australia running past the card's right edge: a map that fills the area is cropped by the frame, not by the card).
const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
for (const format of ['16:9', '9:16']) {
  test(`cosmos map at ${format}: the land lies inside its card`, () => {
    const out = expandKind('map', exampleOf('map'), { mode: format === '16:9' ? 'pro' : 'viral', format });
    const snap = flatten(snapshotOf(sampleGraph(out.nodes, out.timing.duration)));
    const land = snap.find((n) => n.id === 'reach.map').bbox, card = snap.find((n) => n.id === 'reach.sheet.paper').bbox;
    const slack = 2; // px
    assert.ok(land[0] >= card[0] - slack && land[1] >= card[1] - slack && land[0] + land[2] <= card[0] + card[2] + slack && land[1] + land[3] <= card[1] + card[3] + slack,
      `land ${land.map(Math.round)} vs card ${card.map(Math.round)}`);
  });
}

test('cosmos map at 16:9: the title runs across the top, over a map more than half the frame wide (not squeezed beside a 232-unit title)', () => {
  const out = expandKind('map', exampleOf('map'), { mode: 'pro', format: '16:9' });
  const snap = flatten(snapshotOf(sampleGraph(out.nodes, out.timing.duration)));
  const map = snap.find((n) => n.id === 'reach.map').bbox, title = snap.find((n) => n.id === 'reach.title').bbox;
  assert.ok(map[1] >= title[1] + title[3] - 1, 'the map under the title');
  assert.ok(map[2] > 0.5 * out.canvas.w, `map ${Math.round(map[2])} px of ${out.canvas.w}`);
});

// The camera drifts the frame by `camera.drift` units across a shot (10 here, 5 either side of rest), and a glyph such as
// the W of "Where" overhangs its box: a hero set flush on the room's left edge leaves the safe area for a few pixels
// late in the shot (the real-glyph sweep in the browser found it on the tall map title and the tall code hero).
for (const [kind, id] of [['map', 'reach.title'], ['code', 'total.hero']]) {
  test(`cosmos ${kind} at 9:16: the hero starts inside the safe left edge by the camera's drift, so no glyph leaves it`, () => {
    const out = expandKind(kind, exampleOf(kind), { mode: 'viral', format: '9:16' });
    const hero = flatten(out.nodes).find((n) => n.id === id);
    const drift = registries.looks.get(LOOK).camera.drift * out.ctx.unit;
    const inside = hero.props.x + (hero.props.layout.lines[0].x ?? 0) - compositionRect(out.ctx).left;
    assert.ok(inside >= drift - 1e-6, `${id} starts ${inside.toFixed(1)} px inside the room (the drift is ${drift})`);
  });
}

// Text on the new surfaces holds 4.5:1 (computed with shared/contrast.mjs): the feed's bubbles under the dimmed (ink2)
// and spoken (ink) messages, the code panel and its lit-line band under the token colours, the map's land under its labels.
test('cosmos second-wave surfaces: every text colour on them holds 4.5:1', () => {
  const look = registries.looks.get(LOOK);
  const hex = (key) => look.palette[key] ?? key;
  const { feed, code, map } = look.kinds;
  const pairs = [
    ['ink2 on the me bubble', hex('ink2'), feed.me.fill], ['ink on the me bubble', hex('ink'), feed.me.fill],
    ['ink2 on the them bubble', hex('ink2'), feed.them.fill], ['ink on the them bubble', hex('ink'), feed.them.fill],
    ['ink2 on the code panel', hex('ink2'), look.devices.card.fill], ['ink on the code panel', hex('ink'), look.devices.card.fill],
    ['blue keyword on the lit band', hex(code.roles.keyword), code.highlight.band], ['ink2 comment on the lit band', hex('ink2'), code.highlight.band],
    ['ink label on the land', hex('ink'), map.land],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(contrastRatio(hex(fg), hex(bg)) >= 4.5, `${name}: ${contrastRatio(hex(fg), hex(bg)).toFixed(2)}:1`);
});

test('cosmos diagram at 9:16: the node cards run across the composition width (the column is not a narrow strip)', () => {
  const out = expandKind('diagram', exampleOf('diagram'), { mode: 'viral', format: '9:16' });
  const rect = compositionRect(out.ctx);
  const snap = flatten(snapshotOf(sampleGraph(out.nodes, out.timing.duration)));
  const widths = snap.filter((n) => /^flow\.node\d\.card\.paper$/.test(n.id)).map((n) => n.bbox[2]);
  assert.equal(widths.length, 3);
  assert.ok(Math.min(...widths) >= 0.8 * rect.w, `cards ${widths.map(Math.round)} px in a ${Math.round(rect.w)} px room`);
});

test('cosmos diagram: every node card and every arrow is on screen from frame 0 (no half-built diagram on the first frame)', () => {
  for (const format of ['16:9', '9:16']) {
    const out = expandKind('diagram', exampleOf('diagram'), { mode: 'pro', format });
    const shown = new Set(drawnLeaves(sampleGraph(out.nodes, 0)).map((l) => l.node.id));
    for (const id of ['flow.node0.card.paper', 'flow.node1.card.paper', 'flow.node2.card.paper', 'flow.edge0.line', 'flow.edge1.line']) assert.ok(shown.has(id), `${id} at ${format}`);
  }
});

test('cosmos has data for the seven second-wave kinds, none of them parked', () => {
  const look = registries.looks.get(LOOK);
  for (const kind of KINDS) {
    assert.ok(supportsKind(look, kind), `${kind}: cosmos has kinds.${kind} data`);
    assert.equal(isParkedKind(look, kind), false, `${kind} is not parked in cosmos`);
  }
});

// The kind's own review and rules on its example (the creative findings make.mjs prints, e.g. a timeline whose dates
// cannot be held at three times its events' words), which auditFrame does not run.
for (const format of ['16:9', '9:16']) {
  for (const kind of KINDS) {
    test(`cosmos ${kind} at ${format}: the kind's own review and rules give no finding on its example`, () => {
      const { findings } = barInput(kind, exampleOf(kind), { look: LOOK, format, prepare: PREPARED.includes(kind) });
      assert.deepEqual(findings.map((f) => `${f.path}: ${f.message}`), []);
    });
  }
}

for (const { mode, format } of COMBOS) {
  for (const kind of KINDS) {
    test(`cosmos ${kind} in ${mode} at ${format}: the example builds with no finding from the frame review`, () => {
      const shot = exampleOf(kind);
      const out = expandKind(kind, shot, { mode, format });
      const resolved = lookForFormat(registries.looks.get(LOOK), format);
      const canvas = canvasOf(format);
      const ctx = { look: resolved, canvas, mode: registries.modes.get(mode), shotId: shot.id, shotIndex: 0, safe: safeRectFor(canvas, resolved), regionMarks: regionMarkIds(shot) };
      const findings = timesOf(out.timing.duration).flatMap((t) => auditFrame(snapshotOf(sampleGraph(out.nodes, t)), { ...ctx, t })
        .map((f) => `at ${t.toFixed(2)} s: ${f.kind} ${f.rule}: ${f.message}`));
      assert.deepEqual([...new Set(findings)], []);
    });

    if (format !== '9:16') continue;
    test(`cosmos ${kind} in ${mode} at 9:16 leaves at most 35 percent of the composition height empty`, () => {
      const out = expandKind(kind, exampleOf(kind), { mode, format });
      // the composition area of a tall frame is cosmos's band inside the platform sides (compositionRect), not the margins
      const rect = compositionRect(out.ctx);
      const [top, bottom] = [rect.top, rect.top + rect.h];
      const boxes = contentOf(drawnLeaves(sampleGraph(out.nodes, out.timing.duration)), out.canvas).map((l) => l.box);
      const first = Math.max(top, Math.min(...boxes.map((b) => b[1]))), last = Math.min(bottom, Math.max(...boxes.map((b) => b[1] + b[3])));
      const empty = 1 - (last - first) / (bottom - top);
      assert.ok(empty <= MAX_EMPTY, `${(100 * empty).toFixed(0)}% of the height is empty (at most ${100 * MAX_EMPTY}%)`);
    });
  }
}

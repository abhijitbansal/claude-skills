// Every kind in `ledger` (looks-four plan, Task 4): each kind's example builds at 16:9 and 9:16 with no finding from the
// frame review (auditFrame, every rule, on frames every 0.5 s), and the data honesty the look promises: bars start at
// zero, a line whose axis does not start at zero labels it, no direct label meets another mark, exactly one mark holds
// the accent while the others take `dim`, the annotation's leader ends on the spoken mark, and no tall composition
// leaves more than 35 percent of its height empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { lookForFormat } from '../../engine/looks/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { barInput, drawnLeaves, contentOf, snapshotOf } from './helpers/bar.mjs';
import { expandShot } from './helpers/kinds.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';

const LOOK = 'ledger';
const FORMATS = Object.freeze(['16:9', '9:16']);
const AUDIT_STEP = 0.5; // s between audited frames
const MAX_EMPTY = 0.35; // of the tall composition height
const PREPARED = Object.freeze(['map', 'code']); // kinds whose example needs the prepare step
// A kind parked in ledger (isParkedKind: number) is not held to the sweep or the tall rule: parking is what a failure
// there leads to (looks-four plan, Global Constraints).
const PARKED_IN_LEDGER = Object.freeze(['number']);
const look = () => registries.looks.get(LOOK);
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const timesOf = (duration) => [...Array.from({ length: Math.floor(duration / AUDIT_STEP) + 1 }, (_, i) => i * AUDIT_STEP), duration];

// The example of every kind ledger supports (from the registry: a hidden look is in no listing), its picture swapped for
// the test's stand-in screenshot.
const EXAMPLES = Object.freeze(registries.kinds.names().map((kind) => {
  const entry = listEntries('kinds').find((e) => e.name === kind);
  const example = entry?.example ?? registries.kinds.get(kind).example;
  return { kind, shot: example.src === undefined ? example : { ...example, src: 'shot.png' } };
}));

test('the sweep covers all sixteen kinds', () => {
  assert.equal(EXAMPLES.length, 16);
  assert.ok(EXAMPLES.every(({ kind }) => registries.kinds.get(kind).example !== undefined || listEntries('kinds').some((e) => e.name === kind)));
});

for (const format of FORMATS) {
  for (const { kind, shot } of EXAMPLES.filter((e) => !PARKED_IN_LEDGER.includes(e.kind))) {
    test(`ledger ${kind} at ${format}: the example builds with no finding from the frame review`, () => {
      const input = barInput(kind, shot, { look: LOOK, format, prepare: PREPARED.includes(kind) });
      const resolved = lookForFormat(input.look, format);
      // regionMarks: a mark the example draws on a region is held inside the frame (regions.mjs region-off-frame)
      const ctx = { look: resolved, canvas: input.canvas, mode: registries.modes.get('pro'), shotId: shot.id, shotIndex: 0, safe: safeRectFor(input.canvas, resolved), regionMarks: regionMarkIds(shot) };
      const findings = timesOf(input.duration).flatMap((t) => auditFrame(snapshotOf(sampleGraph(input.nodes, t)), { ...ctx, t })
        .map((f) => `at ${t.toFixed(2)} s: ${f.kind} ${f.rule}: ${f.message}`));
      assert.deepEqual([...new Set(findings)], []);
    });
  }
}

// free draws only what its author gives it (its example is one bar): no look composes it.
test('the kinds parked in ledger are exactly the ones this file exempts', () => {
  assert.deepEqual(registries.kinds.names().filter((kind) => look().kinds[kind]?.experimental === true), [...PARKED_IN_LEDGER]);
});
for (const { kind, shot } of EXAMPLES.filter((e) => e.kind !== 'free' && !PARKED_IN_LEDGER.includes(e.kind))) {
  test(`ledger ${kind} at 9:16 leaves at most 35 percent of the composition height empty`, () => {
    const input = barInput(kind, shot, { look: LOOK, format: '9:16', prepare: PREPARED.includes(kind) });
    const margin = lookForFormat(input.look, '9:16').grid.margin * input.unit;
    const [top, bottom] = [margin, input.canvas.h - margin];
    const boxes = contentOf(drawnLeaves(sampleGraph(input.nodes, input.duration)), input.canvas).map((l) => l.box);
    const first = Math.max(top, Math.min(...boxes.map((b) => b[1]))), last = Math.min(bottom, Math.max(...boxes.map((b) => b[1] + b[3])));
    const empty = 1 - (last - first) / (bottom - top);
    assert.ok(empty <= MAX_EMPTY, `${(100 * empty).toFixed(0)}% of the height is empty (at most ${100 * MAX_EMPTY}%)`);
  });
}

const BARS = Object.freeze({ id: 'regions', show: 'chart', type: 'bar', title: 'The North leads', say: 'The North leads with one hundred and eighty two orders.',
  data: [{ label: 'North', value: 182 }, { label: 'South', value: 121 }, { label: 'East', value: 97 }, { label: 'West', value: 59 }], highlight: 'North' });
const COLUMNS = Object.freeze({ ...BARS, id: 'cols', type: 'column', title: 'The North led' });
const FPS = 30;
// every frame of a shot at FPS, the last one included (the stray tick showed for two frames: a 0.5 s step missed it)
const frameTimes = (duration) => Array.from({ length: Math.floor(duration * FPS) + 1 }, (_, i) => i / FPS);

// The drawn bars of a chart shot at `t`: { k, box } for each mark path (not its overlays), box in canvas pixels.
function marksOf(nodes, id, t) {
  const mark = new RegExp(`^${id}\\.mark\\.(\\d+)$`);
  return flat(snapshotOf(sampleGraph(nodes, t))).filter((n) => mark.test(n.id)).map((n) => ({ k: Number(mark.exec(n.id)[1]), box: n.bbox }));
}

for (const format of FORMATS) {
  test(`ledger bar chart at ${format}: every bar starts on the baseline value 0 (lengths in the values' ratio)`, () => {
    const { nodes, timing } = expandShot(BARS, LOOK, format);
    const bars = marksOf(nodes, BARS.id, timing.duration);
    assert.equal(bars.length, BARS.data.length);
    const lefts = bars.map((b) => b.box[0]);
    assert.ok(lefts.every((x) => Math.abs(x - lefts[0]) < 0.5), 'one baseline');
    const [a, b] = [bars.find((m) => m.k === 0), bars.find((m) => m.k === 3)];
    assert.ok(Math.abs(a.box[2] / b.box[2] - 182 / 59) < 0.02, `bar lengths ${a.box[2].toFixed(1)} and ${b.box[2].toFixed(1)} keep 182:59`);
  });

  test(`ledger chart at ${format}: exactly one mark holds the accent while the others take dim`, () => {
    const { nodes, timing } = expandShot(BARS, LOOK, format);
    const sampled = flat(sampleGraph(nodes, timing.duration));
    const dims = sampled.filter((n) => /\.mark\.\d+\.dim$/.test(n.id) && n.visible);
    assert.deepEqual(dims.map((n) => n.props.fill), Array(BARS.data.length - 1).fill(look().palette.dim), 'every other mark under the dim colour');
    assert.equal(dims.some((n) => n.id === `${BARS.id}.mark.0.dim`), false, 'the highlighted mark keeps its colour');
    const accents = sampled.filter((n) => /\.mark\.\d+\.accent$/.test(n.id) && n.visible);
    assert.deepEqual(accents.map((n) => [n.id, n.props.fill]), [[`${BARS.id}.mark.0.accent`, look().palette.accent]], 'one mark, the spoken one, in the accent');
  });

  test(`ledger chart at ${format}: no direct label meets another mark`, () => {
    const { nodes, timing } = expandShot(BARS, LOOK, format);
    const sampled = flat(sampleGraph(nodes, timing.duration));
    const marks = marksOf(nodes, BARS.id, timing.duration);
    const texts = snapshotOf(sampleGraph(nodes, timing.duration));
    const labels = flat(texts).filter((n) => n.type === 'text' && n.id.startsWith(`${BARS.id}.`) && n.id !== `${BARS.id}.title` && n.visible);
    const meets = (p, q) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3];
    for (const lbl of labels) {
      const own = /\.(?:value|label|annotation)\.(\d+)/.exec(lbl.id)?.[1];
      for (const m of marks.filter((mk) => String(mk.k) !== own)) assert.equal(meets(lbl.bbox, m.box), false, `${lbl.id} meets mark ${m.k}`);
    }
    assert.ok(sampled.length > 0);
  });

  // gate-ledger-3 (F5): a short horizontal leader between a bar's end and its note read as a minus sign ("182" as
  // "-182"), and drew on before the note, a stray dash. A bar's note stands where its value would, with no tick.
  test(`ledger bar chart at ${format}: no tick before the note: no leader or dot between the bar's end and it, on any frame`, () => {
    const { nodes, timing } = expandShot(BARS, LOOK, format);
    for (const t of frameTimes(timing.duration)) {
      const ticks = flat(sampleGraph(nodes, t)).filter((n) => /\.annotation\.(leader|dot)$/.test(n.id));
      assert.deepEqual(ticks.map((n) => n.id), [], `at ${t.toFixed(2)} s`);
    }
    assert.ok(flat(sampleGraph(nodes, timing.duration)).some((n) => n.id === `${BARS.id}.annotation.text` && n.visible), 'the note is there');
  });

  // a column's note stands over it on a vertical leader joined to the column (gate-ledger-3 F5: the leader drew from the
  // note's end first, a stray dot above the column before the note showed)
  test(`ledger column chart at ${format}: the annotation's leader is vertical, grows from the spoken mark and never shows before its note`, () => {
    const { nodes, timing } = expandShot(COLUMNS, LOOK, format);
    const final = flat(sampleGraph(nodes, timing.duration));
    const leader = final.find((n) => n.id === `${COLUMNS.id}.annotation.leader`);
    assert.ok(leader, 'an annotation with a leader');
    const points = pathPoints(leader.props.d);
    const [x, y, w, h] = marksOf(nodes, COLUMNS.id, timing.duration).find((m) => m.k === 0).box;
    const onMark = ([px, py]) => px >= x - 0.5 && px <= x + w + 0.5 && py >= y - 0.5 && py <= y + h + 0.5;
    assert.ok(points.every(([px]) => Math.abs(px - points[0][0]) < 0.5), `vertical: ${JSON.stringify(points)}`);
    assert.ok(onMark(points[0]), `it starts (draws from) ${points[0]} on the North column ${[x, y, w, h].map((v) => v.toFixed(0))}`);
    for (const t of frameTimes(timing.duration)) {
      const at = flat(sampleGraph(nodes, t));
      const line = at.find((n) => n.id === leader.id), note = at.find((n) => n.id === `${COLUMNS.id}.annotation.text`);
      if (line.visible && line.draw > 0) assert.ok(note.opacity > 0, `at ${t.toFixed(2)} s the leader shows (draw ${line.draw.toFixed(2)}) before its note`);
    }
  });
}

const textBox = (nodes, t, id) => flat(snapshotOf(sampleGraph(nodes, t))).find((n) => n.id === id).bbox;

test('ledger bar chart: the note stands where the value would, the chart\'s gap past its bar\'s end', () => {
  const { nodes, timing } = expandShot(BARS, LOOK, '16:9');
  const bar = marksOf(nodes, BARS.id, timing.duration).find((m) => m.k === 0).box;
  const note = textBox(nodes, timing.duration, `${BARS.id}.annotation.text`);
  const other = textBox(nodes, timing.duration, `${BARS.id}.value.1`), otherBar = marksOf(nodes, BARS.id, timing.duration).find((m) => m.k === 1).box;
  const gap = other[0] - (otherBar[0] + otherBar[2]);
  assert.ok(Math.abs(note[0] - (bar[0] + bar[2]) - gap) < 1, `note ${(note[0] - bar[0] - bar[2]).toFixed(1)} px past its bar, values ${gap.toFixed(1)} px`);
});

test('ledger column chart: the note over the tallest column keeps off every column', () => {
  const shot = { id: 'peak', show: 'chart', type: 'column', title: 'Q3 was the peak', say: 'Q3 was the peak quarter.', highlight: 'Q3',
    data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 40 }, { label: 'Q4', value: 24 }] };
  for (const format of FORMATS) {
    const { nodes, timing } = expandShot(shot, LOOK, format);
    const note = textBox(nodes, timing.duration, `${shot.id}.annotation.text`);
    const meets = (p, q) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3];
    for (const m of marksOf(nodes, shot.id, timing.duration)) assert.equal(meets(note, m.box), false, `${format}: the note meets column ${m.k}`);
  }
});

test('ledger statement with a kicker at 16:9: the claim hangs right under the tag\'s rule (the top third), unnarrowed', () => {
  const shot = { id: 'hook', show: 'statement', say: 'Numbers need *sources*.', kicker: 'The problem' };
  const { nodes, timing } = expandShot(shot, LOOK, '16:9');
  const snap = flat(snapshotOf(sampleGraph(nodes, timing.duration)));
  const tag = snap.find((n) => n.id === `${shot.id}.slug`).bbox, claim = snap.find((n) => n.id === `${shot.id}.text`).bbox;
  const gutter = look().grid.gutter;
  assert.ok(claim[1] >= tag[1] + tag[3], 'under the tag');
  assert.ok(claim[1] - (tag[1] + tag[3]) <= 4 * gutter, `${(claim[1] - tag[1] - tag[3]).toFixed(0)} px under the tag (at most four gutters)`);
  assert.ok(claim[1] + claim[3] <= 1080 - look().grid.margin, 'inside the bottom margin');
});

for (const format of FORMATS) {
  test(`ledger quote at ${format}: the quotation in the serif with a 4-unit accent rule down its left`, () => {
    const shot = { id: 'voice', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' };
    const { nodes, timing } = expandShot(shot, LOOK, format);
    const snap = flat(snapshotOf(sampleGraph(nodes, timing.duration)));
    const text = snap.find((n) => n.id === 'voice.text'), bar = snap.find((n) => n.id === 'voice.bar');
    assert.equal(text.props.font.family, look().fonts.text.family);
    assert.ok(bar, 'a rule down the left');
    assert.equal(bar.props.fill, look().palette.accent);
    assert.ok(Math.abs(bar.bbox[2] - 4) < 0.5, `four units wide: ${bar.bbox[2]}`);
    assert.ok(bar.bbox[0] + bar.bbox[2] <= text.bbox[0], 'left of the quotation');
    assert.ok(bar.bbox[3] >= text.bbox[3] * 0.9, 'down the quotation\'s height');
  });

  test(`ledger end at ${format}: the ask in the serif, the mark on the look's tag`, () => {
    const shot = { id: 'close', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion' };
    const { nodes, timing } = expandShot(shot, LOOK, format);
    const snap = flat(snapshotOf(sampleGraph(nodes, timing.duration)));
    const ask = snap.find((n) => n.type === 'text' && n.props.layout.lines.some((l) => l.words.some((w) => w.text === 'today')));
    assert.equal(ask.props.font.family, look().fonts.text.family, 'the ask in the serif');
    const plate = snap.find((n) => n.id === 'close.mark.plate');
    assert.ok(plate, 'the mark on a tag plate');
    assert.equal(plate.props.fill, look().palette.accent);
    assert.equal(snap.find((n) => n.id === 'close.mark.text').props.fill, look().palette.paper);
  });
}

test('ledger draws reference lines for line and area charts only: bars and columns carry their values', () => {
  const data = [{ label: 'Mar', value: 92 }, { label: 'Apr', value: 97 }, { label: 'May', value: 104 }, { label: 'Jun', value: 118 }];
  const refsOf = (type) => {
    const shot = { id: 'r', show: 'chart', type, title: 'Orders climbed', say: 'Orders climbed every month.', data };
    const { nodes, timing } = expandShot(shot, LOOK, '16:9');
    return flat(sampleGraph(nodes, timing.duration)).filter((n) => /^r\.(ref|tick)\./.test(n.id)).length;
  };
  assert.ok(refsOf('line') > 0, 'line: reference lines');
  assert.ok(refsOf('area') > 0, 'area: reference lines');
  assert.equal(refsOf('bar'), 0, 'bar: none');
  assert.equal(refsOf('column'), 0, 'column: none');
});

test('ledger line chart whose axis does not start at zero labels its baseline value', () => {
  const shot = { id: 'temp', show: 'chart', type: 'line', title: 'Orders climbed', say: 'Orders climbed every month.', data: [{ label: 'Mar', value: 92 }, { label: 'Apr', value: 97 }, { label: 'May', value: 104 }, { label: 'Jun', value: 118 }] };
  const { nodes, timing } = expandShot(shot, LOOK, '16:9');
  const texts = flat(sampleGraph(nodes, timing.duration)).filter((n) => n.type === 'text' && n.visible);
  const words = texts.flatMap((n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)));
  const numbers = words.map(Number).filter(Number.isFinite);
  assert.ok(numbers.some((v) => v > 0 && v <= 92), `an axis label at or under the lowest value: ${numbers.join(', ')}`);
});

// The chart kind: its scale (nice ticks, value text, numerals in fixed advances), the marks each type builds, the
// honesty findings, the highlight timing and its land event, and the desk and pop compositions with the fake measure.
// Pure scene-graph work; label measurement with the real fonts is in kinds-chart-browser.test.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { niceTicks, valueText, numeralLayout } from '../../engine/kinds/chart-scale.mjs';
import { measure, near } from './helpers/kinds.mjs';

// ---- scale ----

test('nice ticks: steps of 1, 2, 2.5 or 5 times a power of ten that cover the range in about `count` steps', () => {
  assert.deepEqual(niceTicks(0, 87, 3).ticks, [0, 50, 100]);
  assert.deepEqual(niceTicks(0, 1234, 4).ticks, [0, 500, 1000, 1500]);
  assert.deepEqual(niceTicks(0.2, 0.9, 3).ticks, [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(niceTicks(0.2, 0.9, 3).decimals, 2);
});

test('nice ticks: negative ranges, a range across zero, one value, all equal and all zero', () => {
  assert.deepEqual(niceTicks(-40, 60, 4).ticks, [-50, -25, 0, 25, 50, 75]);
  assert.deepEqual(niceTicks(-30, -10, 3).ticks, [-30, -20, -10]);
  assert.deepEqual(niceTicks(5, 5, 3).ticks, [0, 2, 4, 6], 'one value: the range runs from zero to it');
  assert.deepEqual(niceTicks(-5, -5, 3).ticks, [-6, -4, -2, 0]);
  assert.deepEqual(niceTicks(0, 0, 3).ticks, [0, 0.5, 1], 'all zero: a unit range');
  for (const [lo, hi] of [[0, 87], [-40, 60], [3, 3], [0.001, 0.002], [1e6, 9e6]]) {
    const t = niceTicks(lo, hi, 3);
    assert.ok(t.lo <= Math.min(lo, hi === lo ? 0 : lo) && t.hi >= hi, `${lo}..${hi} is covered by ${t.lo}..${t.hi}`);
    assert.ok(t.ticks.every((v) => Number.isFinite(v)));
  }
});

test('value text: thousands grouped, the scale\'s decimals, a currency unit before the number, % after it, other units after a space', () => {
  assert.equal(valueText(1200, 0), '1,200');
  assert.equal(valueText(1200, 0, '%'), '1,200%');
  assert.equal(valueText(12.5, 1, '$'), '$12.5');
  assert.equal(valueText(-3, 0, '€'), '-€3');
  assert.equal(valueText(40, 0, 'ms'), '40 ms');
  assert.equal(valueText(0.25, 2), '0.25');
});

test('numerals in fixed advances: every digit sits centred in a cell of the widest digit, separators at their own width', () => {
  const font = { family: 'X', size: 100, weight: 400, tracking: 0 };
  const wide = (text, f) => ({ ...measure(text, f), width: (text === '1' ? 0.3 : 0.55) * f.size * [...text].length });
  const layout = numeralLayout('1,180', font, wide);
  const words = layout.lines[0].words;
  assert.deepEqual(words.map((w) => w.text), ['1', ',', '1', '8', '0']);
  const cell = 55;
  near(words[0].x, (cell - 30) / 2, 'a narrow 1 is centred in its cell');
  near(words[3].x - words[2].x, cell - (cell - 30) / 2 + (cell - 55) / 2, 'the 8 starts one cell after the 1');
  near(layout.width, 4 * cell + 55, 'four cells and the comma at its own width');
});

// ---- marks ----

test('column marks (hand computed): plot 600 x 400 at (100, 100), values 10, 20, 40, baseline 0: bands of 200, columns 124 wide centred at 200, 400, 600, from y 500 up to 400, 300, 100', async () => {
  const { chartData, valueScale, columnMarks } = await import('../../engine/kinds/chart-marks.mjs');
  const shot = { type: 'column', data: [{ label: 'A', value: 10 }, { label: 'B', value: 20 }, { label: 'C', value: 40 }] };
  const data = chartData(shot);
  const scale = valueScale(shot, data);
  assert.deepEqual([scale.lo, scale.hi, scale.references], [0, 40, [20, 40]]);
  const marks = columnMarks(data.items, { x: 100, y: 100, w: 600, h: 400 }, scale);
  for (const [k, [x, tip]] of [[200, 400], [400, 300], [600, 100]].entries()) {
    near(marks[k].x, x, `column ${k} centre`);
    near(marks[k].tip, tip, `column ${k} tip`);
    near(marks[k].base, 500, `column ${k} base`);
    near(marks[k].width, 124, `column ${k} width`);
  }
});

test('the value scale: a non-zero baseline starts the scale exactly there; a line fits its values; at most three reference lines, the top one kept', async () => {
  const { chartData, valueScale, MAX_REFERENCE_LINES } = await import('../../engine/kinds/chart-marks.mjs');
  const based = { type: 'bar', baseline: 32, data: [{ label: 'A', value: 35 }, { label: 'B', value: 50 }] };
  const s = valueScale(based, chartData(based));
  assert.deepEqual([s.lo, s.hi, s.references, s.baseline], [32, 50, [40, 50], 32]);
  const line = { type: 'line', data: [{ x: 1, y: 0.2 }, { x: 2, y: 0.9 }] };
  const l = valueScale(line, chartData(line));
  assert.equal(l.lo, 0);
  assert.ok(l.ticks.length > MAX_REFERENCE_LINES + 1, 'more ticks than lines');
  assert.ok(l.references.length <= MAX_REFERENCE_LINES && l.references.at(-1) === l.hi, `${l.references}`);
});

test('bar, line, area and donut marks: bars grow right from the baseline, lines pass their points left to right, a donut goes clockwise from twelve and closes', async () => {
  const { chartData, valueScale, barMarks, lineMarks, donutMarks, arcPoints } = await import('../../engine/kinds/chart-marks.mjs');
  const plot = { x: 0, y: 0, w: 400, h: 200 };
  const bar = { type: 'bar', data: [{ label: 'A', value: 5 }, { label: 'B', value: 10 }] };
  const bars = barMarks(chartData(bar).items, plot, valueScale(bar, chartData(bar)));
  assert.ok(bars.every((b) => b.base === 0 && b.tip > b.base), 'right of the baseline');
  assert.ok(bars[0].y < bars[1].y, 'first row on top');
  const line = { type: 'line', data: { series: [{ name: 'Us', points: [{ x: 'Jan', y: 1 }, { x: 'Feb', y: 3 }, { x: 'Mar', y: 2 }] }] } };
  const { lines, xs } = lineMarks(chartData(line).series, plot, valueScale(line, chartData(line)));
  assert.deepEqual(xs.map((x) => x.x), ['Jan', 'Feb', 'Mar']);
  assert.deepEqual(lines[0].points.map((p) => p[0]), [0, 200, 400]);
  assert.ok(lines[0].points[1][1] < lines[0].points[0][1], 'a higher value is higher up');
  const donut = { type: 'donut', data: [{ label: 'A', value: 1 }, { label: 'B', value: 3 }] };
  const ring = donutMarks(chartData(donut).items, plot);
  near(ring.segments[0].from, -Math.PI / 2, 'from twelve');
  near(ring.segments.at(-1).to, 1.5 * Math.PI, 'all the way round');
  near(ring.segments[1].share, 0.75, 'share');
  const arc = arcPoints(0, 0, 10, 0, Math.PI);
  near(arc.at(-1)[0], -10, 'half a turn');
});

test('bad data still yields marks with finite numbers: one point, one value, a negative donut value, nothing at all', async () => {
  const { chartData, valueScale, columnMarks, lineMarks, donutMarks } = await import('../../engine/kinds/chart-marks.mjs');
  const plot = { x: 0, y: 0, w: 400, h: 200 };
  // every coordinate and scale number is finite; `value` and `values` echo the input as given (the honesty finding names them)
  const finite = (o) => JSON.stringify(o, (k, v) => { if (k === 'value' || k === 'values') return undefined; if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k}: ${v}`); return v; });
  for (const shot of [
    { type: 'line', data: [{ x: 1, y: 4 }] },
    { type: 'column', data: [{ label: 'A', value: 4 }] },
    { type: 'column', data: [] },
    { type: 'donut', data: [{ label: 'A', value: -2 }, { label: 'B', value: 3 }] },
    { type: 'donut', data: [{ label: 'A', value: 0 }] },
    { type: 'column', data: [{ label: 'A', value: Infinity }, { label: 'B', value: 2 }] },
  ]) {
    const data = chartData(shot), scale = valueScale(shot, data);
    finite(scale);
    if (shot.type === 'line') finite(lineMarks(data.series, plot, scale));
    else if (shot.type === 'donut') finite(donutMarks(data.items, plot));
    else finite(columnMarks(data.items, plot, scale));
  }
});

// ---- the kind ----

const kindOf = async () => {
  await import('../../engine/kinds/index.mjs');
  const { registries } = await import('../../engine/registry.mjs');
  return registries.kinds.get('chart');
};
const helpers = () => import('./helpers/kinds.mjs');
const COLUMNS = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.',
  data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q3', ...extra,
});
const LINES = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'line', title: 'Files overtook servers', say: 'Both grew for a year. Then files pulled ahead.',
  data: { series: [{ name: 'Files', points: [{ x: 'Jan', y: 2 }, { x: 'Apr', y: 5 }, { x: 'Jul', y: 9 }] }, { name: 'Servers', points: [{ x: 'Jan', y: 3 }, { x: 'Apr', y: 4 }, { x: 'Jul', y: 5 }] }] },
  highlight: 'Files', ...extra,
});
const BARS = (extra = {}) => ({ ...COLUMNS(), type: 'bar', ...extra });
const AREA = (extra = {}) => ({ ...LINES(), type: 'area', ...extra });
const DONUT = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'donut', title: 'Most of it is video', say: 'Here is where the time goes. Video takes most of it.',
  data: [{ label: 'Video', value: 62 }, { label: 'Docs', value: 23 }, { label: 'Mail', value: 15 }], unit: '%', highlight: 'Video', ...extra,
});
const ALL = () => [COLUMNS(), BARS(), LINES(), AREA(), DONUT()];
// the edge cases the overlap rules must also hold for: a broken bar scale, negative columns and a negative area
const EDGES = () => [
  BARS({ baseline: 2 }), COLUMNS({ baseline: 10 }),
  COLUMNS({ data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: -6 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }] }),
  AREA({ highlight: undefined, data: ['Jan', 'Feb', 'Mar', 'Apr'].map((x, i) => ({ x, y: [-4, 2, 6, 9][i] })) }),
];

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-chart-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));
const errorsOf = async (shot, mode = 'pro') => {
  const { validateFilm } = await import('../../scripts/v2/spec.mjs');
  return validateFilm({ version: 2, mode, shots: [shot] }, { specDir }).errors;
};

test('chart: the example and every type validate in both looks; a highlight naming no mark and data of the wrong shape are refused with what to write', async () => {
  const kind = await kindOf();
  const { listEntries } = await import('../../scripts/v2/list.mjs');
  assert.ok(listEntries('kinds').some((e) => e.name === 'chart'));
  for (const shot of [kind.example, ...ALL()]) {
    assert.deepEqual(await errorsOf(shot), [], `${shot.type} pro`);
    assert.deepEqual(await errorsOf(shot, 'viral'), [], `${shot.type} viral`);
  }
  const missing = await errorsOf(COLUMNS({ highlight: 'Q5' }));
  assert.ok(missing.some((e) => e.path === 'shots[0].highlight' && /Q1, Q2, Q3, Q4/.test(e.message)), JSON.stringify(missing));
  // the type picks the shape (review B I9): a line reads points, so items are refused key by key, never as a list of shapes
  const shape = await errorsOf(COLUMNS({ type: 'line' }));
  assert.ok(shape.some((e) => e.path === 'shots[0].data[0].label' && /allowed: x, y/.test(e.message)), JSON.stringify(shape));
  assert.ok(!shape.some((e) => /must be object/.test(e.message)), 'no error from the series shape');
  const many = await errorsOf(COLUMNS({ data: Array.from({ length: 13 }, (_, i) => ({ label: `L${i}`, value: i })), highlight: undefined }));
  assert.ok(many.some((e) => /data/.test(e.path)), JSON.stringify(many));
});

test('chart honesty: each rule is a mechanical finding of the kind, at the field to fix', async () => {
  const kind = await kindOf();
  const review = (shot) => kind.review(shot, { look: null, timing: { words: [], sentences: [], duration: 3 }, at: () => 0 });
  const cases = [
    [DONUT({ data: [{ label: 'A', value: 5 }], highlight: undefined }), 'data', /2 to 6/],
    [DONUT({ data: [{ label: 'A', value: -5 }, { label: 'B', value: 5 }], highlight: undefined }), 'data[0].value', /negative/],
    [LINES({ data: { series: [{ name: 'Files', points: [{ x: 1, y: 2 }] }] } }), 'data.series[0].points', /at least 2 points/],
    [COLUMNS({ baseline: 15 }), 'data[0].value', /below the baseline/],
    [COLUMNS({ data: [{ label: 'Q1', value: Infinity }, { label: 'Q3', value: 2 }] }), 'data[0].value', /finite/],
  ];
  for (const [shot, at, message] of cases) {
    const found = review(shot);
    assert.ok(found.some((f) => f.kind === 'mechanical' && f.path === at && message.test(f.message)), `${at}: ${JSON.stringify(found)}`);
  }
  assert.deepEqual(ALL().flatMap(review), [], 'the fixtures are honest');
});

test('a bar or column chart whose baseline is not 0 shows a broken-axis mark and says the baseline in a label (by construction), in both looks', async () => {
  const { expandShot, all } = await helpers();
  for (const look of ['desk', 'pop']) {
    for (const shot of [COLUMNS({ baseline: 10 }), BARS({ baseline: 10 })]) {
      const nodes = all(expandShot(shot, look, '16:9').nodes);
      assert.ok(nodes.some((n) => n.id === 'g.break'), `${look} ${shot.type}: the break`);
      const label = nodes.find((n) => n.id === 'g.baseline');
      assert.ok(label && label.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join('').includes('10'), `${look} ${shot.type}: the baseline label`);
    }
    assert.ok(!all(expandShot(COLUMNS(), look, '16:9').nodes).some((n) => n.id === 'g.break'), `${look}: no break from zero`);
  }
});

test('timing: marks grow from the baseline over the first sentence; the highlighted mark turns accent and the rest dim on the word that names it; its value lands then, the land event', async () => {
  const kind = await kindOf();
  const { expandShot, all } = await helpers();
  const { sample } = await import('../../engine/time/track.mjs');
  const { nodes, timing } = expandShot(COLUMNS(), 'desk', '16:9');
  const named = timing.words.find((w) => w.text.replace(/\W/g, '') === 'Q3').start;
  const land = kind.landing(COLUMNS(), timing);
  near(land, named, 'the land event is the naming word');
  const tree = all(nodes);
  const grow = tree.find((n) => n.id === 'g.mark.0');
  assert.equal(sample(grow.tracks.scaleY, 0), 0, 'from the baseline');
  assert.equal(sample(grow.tracks.scaleY, timing.sentences[0].end), 1, 'grown by the end of the first sentence');
  const accent = tree.find((n) => n.id === 'g.mark.2.accent');
  assert.equal(sample(accent.tracks.opacity, land - 0.05), 0);
  assert.equal(sample(accent.tracks.opacity, timing.duration), 1);
  const other = tree.find((n) => n.id === 'g.mark.1');
  assert.ok(sample(other.tracks.opacity, timing.duration) < 1, 'the rest dim');
  const value = tree.find((n) => n.id === 'g.value.2');
  assert.equal(sample(value.tracks.opacity, land - 0.05), 0, 'the highlighted value is not there before');
  assert.ok(sample(value.tracks.opacity, timing.duration) === 1, 'and lands');
  for (const shot of [COLUMNS({ highlight: undefined }), { ...COLUMNS(), say: undefined, hold: 3 }, DONUT(), LINES()]) {
    const t = expandShot(shot, 'pop', '9:16').timing;
    assert.ok(Number.isFinite(kind.landing(shot, t)) && kind.landing(shot, t) <= t.duration, `${shot.type} lands inside the shot`);
  }
});

// The boxes of a text node's lines, cap height to descent, in canvas px: its own place plus its groups' offsets (the
// tag and the numeral sit in upright entrance groups; the plot is placed absolutely).
const lineBoxes = (n) => n.props.layout.lines.map((l) => [(n.ox ?? 0) + n.props.x + l.x, (n.oy ?? 0) + n.props.y + l.y - 0.74 * n.props.font.size, l.width, 0.96 * n.props.font.size]);
const placedTexts = (nodes, ox = 0, oy = 0) => nodes.flatMap((n) => {
  if (n.type === 'text') return [{ ...n, ox, oy }];
  return placedTexts(n.children ?? [], ox + (n.type === 'group' ? n.props?.x ?? 0 : 0), oy + (n.type === 'group' ? n.props?.y ?? 0 : 0));
});
const overlaps = (a, b) => a[0] < b[0] + b[2] - 0.5 && b[0] < a[0] + a[2] - 0.5 && a[1] < b[1] + b[3] - 0.5 && b[1] < a[1] + a[3] - 0.5;

test('labels never overlap each other or leave the frame, for every type in both looks and formats; at most three sizes, the largest three times the smallest', async () => {
  const { expandShot, all } = await helpers();
  for (const look of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16']) {
      for (const shot of [...ALL(), ...EDGES()]) {
        const { nodes, canvas } = expandShot(shot, look, format);
        const texts = placedTexts(nodes).filter((n) => n.id.startsWith('g.'));
        const boxes = texts.flatMap((n) => lineBoxes(n).map((b) => ({ id: n.id, b })));
        for (const { id, b } of boxes) assert.ok(b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= canvas.w && b[1] + b[3] <= canvas.h, `${look} ${format} ${shot.type}: ${id} ${b} inside`);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].id === boxes[j].id) continue;
            assert.ok(!overlaps(boxes[i].b, boxes[j].b), `${look} ${format} ${shot.type}: ${boxes[i].id} meets ${boxes[j].id}`);
          }
        }
        const sizes = [...new Set(texts.filter((n) => n.props.role !== 'tag').map((n) => Math.round(n.props.font.size)))].sort((a, b) => a - b);
        assert.ok(new Set(texts.map((n) => Math.round(n.props.font.size))).size <= 3, `${look} ${format} ${shot.type}: sizes ${sizes}`);
        if (sizes.length > 1) assert.ok(sizes.at(-1) >= 3 * sizes[0] - 1, `${look} ${format} ${shot.type}: hero ${sizes}`);
      }
    }
  }
});

test('labels that cannot fit say so: twelve long column labels on 9:16 either fit without meeting or carry the fit flag', async () => {
  const { expandShot, all } = await helpers();
  const shot = COLUMNS({ highlight: undefined, data: Array.from({ length: 12 }, (_, i) => ({ label: `Department ${i + 1}`, value: i + 1 })) });
  const texts = all(expandShot(shot, 'desk', '9:16').nodes).filter((n) => n.type === 'text' && n.id.startsWith('g.label.'));
  const flagged = texts.some((n) => n.props.layout.overflow === true);
  const boxes = texts.flatMap((n) => lineBoxes(n).map((b) => ({ id: n.id, b })));
  const meet = boxes.some((a, i) => boxes.some((c, j) => j > i && a.id !== c.id && overlaps(a.b, c.b)));
  assert.ok(flagged || !meet, 'fits, or says it does not');
});

test('no gridlines beyond the baseline: at most three light reference lines, direct labels and never a legend', async () => {
  const { expandShot, all } = await helpers();
  for (const look of ['desk', 'pop']) {
    for (const shot of ALL()) {
      const tree = all(expandShot(shot, look, '16:9').nodes);
      assert.ok(tree.filter((n) => /^g\.ref\.\d+$/.test(n.id)).length <= 3, `${look} ${shot.type}`);
      assert.ok(!tree.some((n) => /legend/.test(n.id)), 'no legend');
    }
  }
  const lines = all(expandShot(LINES(), 'desk', '16:9').nodes);
  assert.ok(lines.some((n) => n.id === 'g.series.0') && lines.some((n) => n.id === 'g.series.1'), 'each line names itself');
});

test('chart nodeField: labels, values, series names, the title, the source and the baseline label point at their fields', async () => {
  const kind = await kindOf();
  assert.equal(kind.nodeField(COLUMNS(), 'g.label.2'), 'data[2].label');
  assert.equal(kind.nodeField(COLUMNS(), 'g.value.1'), 'data[1].value');
  assert.equal(kind.nodeField(LINES(), 'g.series.1'), 'data.series[1].name');
  assert.equal(kind.nodeField(COLUMNS(), 'g.title'), 'title');
  assert.equal(kind.nodeField(COLUMNS(), 'g.source'), 'source');
  assert.equal(kind.nodeField(COLUMNS(), 'g.baseline'), 'baseline');
  assert.equal(kind.nodeField(COLUMNS(), 'g.tick.1'), null);
  assert.equal(kind.nodeField(COLUMNS(), 'g.captions.0'), undefined);
});

test('x labels under a line or area keep at least a gap between neighbours, dropping to first, middle and last when they cannot', async () => {
  const { expandShot, all } = await helpers();
  const { kindData } = await import('../../engine/looks/index.mjs');
  for (const look of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16']) {
      const shot = AREA({ highlight: undefined, data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((x, i) => ({ x, y: 400 + 80 * i })) });
      const { nodes, ctx } = expandShot(shot, look, format);
      const gap = kindData(ctx.look, 'chart').gap * ctx.unit;
      const xs = all(nodes).filter((n) => /^g\.x\.\d+$/.test(n.id)).map((n) => lineBoxes(n)[0]).sort((a, b) => a[0] - b[0]);
      assert.ok(xs.length >= 2, `${look} ${format}: first and last at least`);
      for (let k = 1; k < xs.length; k++) assert.ok(xs[k][0] >= xs[k - 1][0] + xs[k - 1][2] + gap - 0.5, `${look} ${format}: x label ${k} a gap clear`);
    }
  }
});

test('the highlight lands on the word that names it, inside a sentence, not at the sentence start', async () => {
  const kind = await kindOf();
  const { expandShot } = await helpers();
  const shot = COLUMNS({ say: 'Sales rose every quarter. The best of them was Q3 by far.' });
  const { timing } = expandShot(shot, 'desk', '16:9');
  const named = timing.words.find((w) => w.text.replace(/\W/g, '') === 'Q3').start;
  assert.ok(named > timing.sentences[1].start, 'the fixture names it mid-sentence');
  near(kind.landing(shot, timing), named, 'on the naming word');
});

test('on devices aim at the chart, its title or one mark: a desk highlight and circle on a mark, a pop underline on a mark', async () => {
  const { expandShot, all } = await helpers();
  const desk = COLUMNS({ on: [{ at: 'word:best', do: 'circle', target: 'mark:2' }, { at: 'word:rose', do: 'highlight', target: 'title' }], say: 'Sales rose every quarter. The best of them was Q3 by far.' });
  const pop = COLUMNS({ on: [{ at: 'word:Q3', do: 'underline', target: 'mark:1' }] });
  assert.deepEqual(await errorsOf(desk), []);
  assert.deepEqual(await errorsOf(pop, 'viral'), []);
  const bad = await errorsOf(COLUMNS({ on: [{ at: 'word:Q3', do: 'circle', target: 'mark:9' }] }));
  assert.ok(bad.some((e) => /target/.test(e.path)), JSON.stringify(bad));
  const deskNodes = all(expandShot(desk, 'desk', '16:9').nodes);
  assert.ok(deskNodes.some((n) => n.id.startsWith('g.on0')) && deskNodes.some((n) => n.id.startsWith('g.on1')), 'both desk devices drawn');
  assert.ok(all(expandShot(pop, 'pop', '9:16').nodes).some((n) => n.id.startsWith('g.on0')), 'the pop underline drawn');
});

// ---- fix round 1: director's notes ----

test('(a) desk chart: the claim\'s cap line sits where a statement\'s slug does (14% of the height), not on the top margin', async () => {
  const { expandShot, all } = await helpers();
  for (const format of ['16:9', '9:16']) {
    const { nodes, canvas } = expandShot(COLUMNS(), 'desk', format);
    const title = all(nodes).find((n) => n.id === 'g.title');
    const { CAP_HEIGHT } = await import('../../engine/kinds/shared.mjs');
    near(title.props.y + title.props.layout.lines[0].y - CAP_HEIGHT * title.props.font.size, 0.14 * canvas.h, `${format} cap line`);
  }
});

test('(b) pop chart at 9:16: the plot starts right under the claim tag and fills most of the stack area; the numeral sits in it, not above it', async () => {
  const { expandShot, all } = await helpers();
  const { stackArea } = await import('../../engine/kinds/stack.mjs');
  for (const shot of [COLUMNS(), BARS(), LINES(), DONUT()]) {
    const { boxes, nodes, ctx } = expandShot(shot, 'pop', '9:16');
    const area = stackArea(ctx);
    assert.ok(boxes.chart[3] >= 0.6 * area.h, `${shot.type}: plot ${Math.round(boxes.chart[3])} of ${Math.round(area.h)}`);
    const numeral = all(nodes).find((n) => n.id === 'g.numeral.punch');
    assert.ok(numeral.props.y >= boxes.chart[1] - 1, `${shot.type}: the numeral inside the plot box`);
  }
});

test('(c) desk chart: with captions off the plot uses the caption band', async () => {
  const { filmOf, expandIn } = await helpers();
  const on = expandIn(filmOf([COLUMNS()], 'desk', '16:9', { captions: true })).boxes.chart;
  const off = expandIn(filmOf([COLUMNS()], 'desk', '16:9', { captions: false })).boxes.chart;
  assert.ok(off[1] + off[3] > on[1] + on[3] + 20, `off ${off[1] + off[3]} below on ${on[1] + on[3]}`);
});

test('(d) desk chart: a mark\'s box holds its value and category labels, so an on circle around it never crosses them', async () => {
  const { expandShot, all } = await helpers();
  const { boxes, nodes } = expandShot(COLUMNS(), 'desk', '16:9');
  const box = boxes['mark:2'];
  for (const id of ['g.value.2', 'g.label.2']) {
    const n = all(nodes).find((m) => m.id === id);
    const [x, y, w, h] = lineBoxes(n)[0];
    const slack = 0.15 * n.props.font.size; // the test's cap and descent shares against the kind's
    assert.ok(x >= box[0] - slack && y >= box[1] - slack && x + w <= box[0] + box[2] + slack && y + h <= box[1] + box[3] + slack, `${id} ${[x, y, w, h].map(Math.round)} inside the mark box ${box.map(Math.round)}`);
  }
});

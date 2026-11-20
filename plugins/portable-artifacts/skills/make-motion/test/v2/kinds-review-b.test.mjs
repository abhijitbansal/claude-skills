// Branch review B fix round (shot kinds and chart): one test per ruling, written before its fix. Chart honesty for every
// type, tick text, the count's sound landing, true roles for the hero rule, stack fit flags, plot minimums and the chart
// schema's per-type errors.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { niceTicks, valueText } from '../../engine/kinds/chart-scale.mjs';
import { valueDecimals, baselineText } from '../../engine/kinds/chart-draw.mjs';
import { composeStack, stackArea } from '../../engine/kinds/stack.mjs';
import { MIN_HERO_RATIO } from '../../engine/review/frame.mjs';
import { expandShot, all, measure } from './helpers/kinds.mjs';

const chart = () => registries.kinds.get('chart');
const words = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
const COLUMNS = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.',
  data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q3', ...extra,
});
const AREA = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'area', title: 'Load held over forty', say: 'Load rose all year.',
  data: [{ x: 'Jan', y: 45 }, { x: 'Apr', y: 55 }, { x: 'Jul', y: 62 }], ...extra,
});
const DONUT = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'donut', title: 'Most of it is video', say: 'Here is where the time goes. Video takes most of it.',
  data: [{ label: 'Video', value: 62 }, { label: 'Docs', value: 23 }, { label: 'Mail', value: 15 }], unit: '%', highlight: 'Video', ...extra,
});
const LINES = (extra = {}) => ({
  id: 'g', show: 'chart', type: 'line', title: 'Files overtook servers', say: 'Both grew for a year. Then files pulled ahead.',
  data: { series: [{ name: 'Files', points: [{ x: 'Jan', y: 2 }, { x: 'Apr', y: 5 }, { x: 'Jul', y: 9 }] }, { name: 'Servers', points: [{ x: 'Jan', y: 3 }, { x: 'Apr', y: 4 }, { x: 'Jul', y: 5 }] }] },
  highlight: 'Files', ...extra,
});
const review = (shot) => chart().review(shot, { look: null, timing: { words: [], sentences: [], duration: 3 }, at: () => 0 });

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-review-b-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));
const errorsOf = async (shot, mode = 'pro') => {
  const { validateFilm } = await import('../../scripts/v2/spec.mjs');
  return validateFilm({ version: 2, mode, shots: [shot] }, { specDir }).errors;
};

// ---- I1: tick and baseline labels ----

test('I1: a tick step of 25 x 10^k shows no decimals: 0..70 and -40..60 read 25, 50, 75; 2.5 keeps one, 0.25 two', () => {
  assert.equal(niceTicks(0, 70, 3).decimals, 0);
  assert.equal(niceTicks(-40, 60, 4).decimals, 0);
  assert.equal(valueText(niceTicks(0, 70, 3).ticks[1], niceTicks(0, 70, 3).decimals), '25');
  assert.equal(niceTicks(0, 7, 3).decimals, 1, 'step 2.5');
  assert.equal(niceTicks(0, 0.7, 3).decimals, 2, 'step 0.25');
  assert.equal(niceTicks(0, 7000, 3).decimals, 0, 'step 2500');
  assert.equal(baselineText({ lo: 40, decimals: niceTicks(40, 115, 3).decimals }), 'from 40');
});

// ---- I2: area honesty ----

test('I2: an area with a non-zero baseline draws the broken-axis mark and says the baseline, in desk and pop', () => {
  for (const [look, format] of [['desk', '16:9'], ['desk', '9:16'], ['pop', '9:16'], ['pop', '16:9']]) {
    const nodes = all(expandShot(AREA({ baseline: 40 }), look, format).nodes);
    assert.ok(nodes.some((n) => n.id === 'g.break'), `${look} ${format}: the break mark`);
    const label = nodes.find((n) => n.id === 'g.baseline');
    assert.ok(label && /40/.test(words(label)), `${look} ${format}: the baseline said`);
  }
});

test('I2: an area value under its baseline is a mechanical finding at the point; baseline on a line or donut is refused naming the types that use it', async () => {
  const under = review(AREA({ baseline: 40, data: [{ x: 'Jan', y: 45 }, { x: 'Apr', y: 30 }, { x: 'Jul', y: 62 }] }));
  assert.ok(under.some((f) => f.kind === 'mechanical' && f.path === 'data[1].y' && /below the baseline 40/.test(f.message)), JSON.stringify(under));
  const series = review(LINES({ type: 'area', baseline: 3 }));
  assert.ok(series.some((f) => f.path === 'data.series[1].points[0].y' || f.path === 'data.series[0].points[0].y'), JSON.stringify(series));
  for (const shot of [LINES({ baseline: 1 }), DONUT({ baseline: 1 })]) {
    const errors = await errorsOf(shot);
    assert.ok(errors.some((e) => e.path === 'shots[0].baseline' && /bar, column, area/.test(e.message)), `${shot.type}: ${JSON.stringify(errors)}`);
  }
  assert.deepEqual(await errorsOf(AREA({ baseline: 40 })), [], 'an area may set one');
});

// ---- I3: a donut of nothing ----

test('I3: a donut whose values are all 0 is a mechanical finding at data (nothing to show)', () => {
  const found = review(DONUT({ data: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }], highlight: undefined }));
  assert.ok(found.some((f) => f.kind === 'mechanical' && f.path === 'data' && /total above 0/.test(f.message)), JSON.stringify(found));
  assert.deepEqual(review(DONUT()), []);
});

// ---- I4: no value labelled 0 that is not 0, no magnitude past 1e15 ----

test('I4: the shown decimals come from the number, not its string: 1e-7 asks for the most, a value never reads -0', () => {
  assert.equal(valueDecimals([1e-7]), 3);
  assert.equal(valueDecimals([12, 0.5]), 1);
  assert.equal(valueDecimals([1.25, 2]), 2);
  assert.equal(valueText(-0.0001, 3), '0.000');
  assert.equal(valueText(-1.5, 1, '%'), '-1.5%');
});

test('I4: a chart value that would be labelled 0 without being 0, or a magnitude of 1e15 or more, is refused as compare refuses it', async () => {
  const tiny = await errorsOf(COLUMNS({ data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 0.0004 }], highlight: undefined }));
  assert.ok(tiny.some((e) => e.path === 'shots[0].data[1].value' && /would show as "0.000"/.test(e.message)), JSON.stringify(tiny));
  const exp = await errorsOf(LINES({ data: [{ x: 1, y: 1e-7 }, { x: 2, y: 3 }], highlight: undefined }));
  assert.ok(exp.some((e) => e.path === 'shots[0].data[0].y' && /would show as/.test(e.message)), JSON.stringify(exp));
  const huge = await errorsOf(COLUMNS({ data: [{ label: 'Q1', value: 1e15 }, { label: 'Q2', value: 2 }], highlight: undefined }));
  assert.ok(huge.some((e) => e.path === 'shots[0].data[0].value'), JSON.stringify(huge));
  const compare = await errorsOf({ id: 'c', show: 'compare', say: 'A. B.', left: { title: 'A', value: 0.0004 }, right: { title: 'B', value: 2 } });
  assert.ok(compare.some((e) => e.path === 'shots[0].left.value' && /would show as "0.000"/.test(e.message)), JSON.stringify(compare));
});

// ---- I8: a plot never collapses silently ----

test('I8: a donut squeezed under the look\'s minimum by long labels keeps that minimum and flags its labels (shorten them); none is cut', () => {
  const long = 'Background processing jobs';
  for (const look of ['desk', 'pop']) {
    const shot = DONUT({ data: [{ label: long.slice(0, 24), value: 62 }, { label: 'Docs', value: 23 }, { label: 'Mail', value: 15 }], highlight: 'Docs' });
    const { nodes, ctx } = expandShot(shot, look, '9:16');
    const ring = all(nodes).filter((n) => n.id.startsWith('g.mark.') && !n.id.endsWith('.accent'));
    const min = registries.looks.get(look).kinds.chart.minPlot;
    assert.ok(Number.isFinite(min) && min > 0, `${look}: minPlot is look data`);
    const width = Math.max(...ring.flatMap((n) => [...n.props.d.matchAll(/[ML](-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Number(m[1])))) - Math.min(...ring.flatMap((n) => [...n.props.d.matchAll(/[ML](-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Number(m[1]))));
    assert.ok(width > 0.2 * ctx.canvas.w, `${look}: the ring is ${Math.round(width)} px across, not a dot`);
    const label = all(nodes).find((n) => n.id === 'g.label.0');
    assert.ok(label.props.layout.overflow, `${look}: the long label says it does not fit`);
    assert.equal(all(nodes).find((n) => n.id === 'g.label.1').props.layout.overflow, false, `${look}: "Docs" fits its side and is not told to shorten`);
    assert.equal(words(label).replace(/ /g, ''), (look === 'pop' ? long.slice(0, 24).toUpperCase() : long.slice(0, 24).toUpperCase()).replace(/ /g, ''), 'never truncated');
  }
});

test('I8: a line plot squeezed under the minimum by long series names flags the names', () => {
  const shot = LINES({ data: { series: [{ name: 'Background processing', points: [{ x: 'Jan', y: 2 }, { x: 'Jul', y: 9 }] }, { name: 'Interactive requests', points: [{ x: 'Jan', y: 3 }, { x: 'Jul', y: 5 }] }] }, highlight: 'Interactive requests' });
  const { nodes } = expandShot(shot, 'pop', '9:16');
  const names = all(nodes).filter((n) => /^g\.series\.\d$/.test(n.id));
  assert.ok(names.length > 0 && names.every((n) => n.props.layout.overflow), JSON.stringify(names.map((n) => n.props.layout.overflow)));
});

// ---- I9: per-type errors ----

test('I9: a misspelled key inside a column chart\'s data gets one error, from the branch its type reads', async () => {
  const errors = await errorsOf(COLUMNS({ data: [{ label: 'Q1', vale: 12 }, { label: 'Q2', value: 3 }], highlight: undefined }));
  assert.deepEqual(errors, [{ path: 'shots[0].data[0].vale', message: 'unknown property; did you mean "value"?' }]);
  const line = await errorsOf(LINES({ data: [{ x: 1, yy: 2 }, { x: 2, y: 3 }], highlight: undefined }));
  assert.deepEqual(line, [{ path: 'shots[0].data[0].yy', message: 'unknown property; did you mean "y"?' }]);
  const series = await errorsOf(LINES({ data: { series: [{ name: 'A', point: [] }] }, highlight: undefined }));
  assert.deepEqual(series, [{ path: 'shots[0].data.series[0].point', message: 'unknown property; did you mean "points"?' }]);
});

// ---- M1, M3: x order and duplicates ----

test('M1: a line whose numeric x does not rise is refused at the point that steps back; categories keep their order', async () => {
  const errors = await errorsOf(LINES({ data: [{ x: 2024, y: 1 }, { x: 2022, y: 2 }, { x: 2023, y: 3 }], highlight: undefined }));
  assert.ok(errors.some((e) => e.path === 'shots[0].data[1].x' && /2022 comes after 2024/.test(e.message)), JSON.stringify(errors));
  assert.deepEqual(await errorsOf(LINES()), []);
});

test('M3: duplicate labels and duplicate series names are refused', async () => {
  const labels = await errorsOf(COLUMNS({ data: [{ label: 'Q1', value: 1 }, { label: 'Q1', value: 2 }], highlight: undefined }));
  assert.ok(labels.some((e) => e.path === 'shots[0].data[1].label' && /Q1/.test(e.message)), JSON.stringify(labels));
  const names = await errorsOf(LINES({ data: { series: [{ name: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }, { name: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }] }, highlight: undefined }));
  assert.ok(names.some((e) => e.path === 'shots[0].data.series[1].name'), JSON.stringify(names));
});

// ---- M30: the broken bar's baseline label on a row of its own ----

test('M30: a broken bar scale with ticks puts its baseline label on its own row under the tick row', () => {
  const { nodes } = expandShot({ ...COLUMNS({ baseline: 10 }), type: 'bar' }, 'desk', '16:9');
  const base = all(nodes).find((n) => n.id === 'g.baseline');
  const ticks = all(nodes).filter((n) => /^g\.tick\.\d$/.test(n.id));
  assert.ok(ticks.length > 0, 'ticks drawn');
  const baselineOf = (n) => n.props.y + n.props.layout.lines[0].y;
  for (const t of ticks) assert.ok(baselineOf(base) >= baselineOf(t) + 0.8 * t.props.font.size, `baseline label ${baselineOf(base)} under tick ${baselineOf(t)}`);
});

// ---- I5: the count's sound lands with the count ----

test('I5: the number kind\'s landing (the sound) is the time the count shows its value (the picture), a number spoken first included', () => {
  const shots = [
    { id: 'n', show: 'number', value: 9, label: 'shot kinds', say: 'Nine shot kinds, two looks, one engine.' },
    { id: 'n', show: 'number', value: 459, label: 'rows', say: 'We kept every one of the 459 rows in one file.' },
  ];
  for (const shot of shots) {
    for (const look of ['desk', 'pop']) {
      const { nodes, timing } = expandShot(shot, look, look === 'pop' ? '9:16' : '16:9');
      const digits = all(nodes).find((n) => n.id === 'n.value.digits');
      const land = registries.kinds.get('number').landing(shot, timing);
      assert.ok(Math.abs(land - digits.props.steps.at(-1).t) < 1e-9, `${look} "${shot.say}": sound ${land} vs picture ${digits.props.steps.at(-1).t}`);
    }
  }
});

// ---- I7: a stack line too wide at the floor keeps its flag ----

test('I7: a stack line wider than the area at the smallest stack size keeps its overflow flag through the ratio and the hook', () => {
  const long = 'Supercalifragilisticexpialidocious';
  const text = `Then ${long} | ${long}`; // two lines (a forced break), each wider than the area at step 3
  for (const hook of [false, true]) {
    const ctx = expandShot({ id: 's', show: 'statement', say: 'Hi there.', text: 'Hi there' }, 'pop', '16:9').ctx;
    const placed = composeStack(text, { id: 's' }, ctx, stackArea(ctx), { hook });
    assert.ok(placed.lines.length >= 2, `hook ${hook}: ${placed.lines.length} lines`);
    const wide = placed.lines.find((l) => l.width > stackArea(ctx).w + 1);
    assert.ok(wide, `hook ${hook}: a line is wider than the area (${placed.lines.map((l) => Math.round(l.width))} vs ${stackArea(ctx).w})`);
    assert.equal(wide.layout.overflow, true, `hook ${hook}: it says so`);
  }
});

// ---- I6, I10: true roles, honest compositions ----

// The review's hero rule over a set of text nodes: stacks one class at their largest, affixes, tags and furniture out,
// sizes within 1.1 one cluster; the largest over the smallest.
function heroRatio(texts) {
  const judged = texts.filter((n) => !['affix', 'tag'].includes(n.props.role) && n.props.furniture !== true);
  const classes = new Map();
  for (const n of judged) {
    const key = n.props.stack ?? n.id;
    classes.set(key, Math.max(classes.get(key) ?? 0, n.props.font.size));
  }
  const sizes = [...classes.values()].sort((a, b) => a - b);
  const clusters = sizes.reduce((g, s) => (g.length && s / g.at(-1).at(-1) <= 1.1 ? [...g.slice(0, -1), [...g.at(-1), s]] : [...g, [s]]), []);
  return { clusters: clusters.length, ratio: clusters.length < 2 ? Infinity : clusters.at(-1).at(-1) / clusters[0][0] };
}
const textsUnder = (nodes, prefix) => all(nodes).filter((n) => n.type === 'text' && n.id.startsWith(prefix));

test('I6: desk compare points are their own size class (no stack), a third of the title or less, in both formats', () => {
  const shots = [registries.kinds.get('compare').example, { id: 's', show: 'compare', say: 'Before, a long one. After, short.', left: { title: 'A long way round the houses', points: ['Durations', 'Positions'] }, right: { title: 'Short', points: ['Words'] } }];
  for (const shot of shots) {
    for (const format of ['16:9', '9:16']) {
      const { nodes } = expandShot(shot, 'desk', format);
      for (const side of ['left', 'right']) {
        const texts = textsUnder(nodes, `${shot.id}.${side}.`);
        assert.ok(texts.every((n) => n.props.stack === undefined), `${format} ${side}: no stack (${texts.map((n) => n.props.stack)})`);
        const { ratio } = heroRatio(texts);
        assert.ok(ratio >= MIN_HERO_RATIO - 1e-6, `${format} ${side}: hero ratio ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('I6: a pop compare value is its own size class: at its side\'s title size (one cluster, honestly) or a third of it, wide and tall', () => {
  const shots = [
    { id: 'v', show: 'compare', say: 'A server costs this. One file costs nothing.', left: { title: 'A server', value: '$40' }, right: { title: 'One file', value: '0' } },
    { id: 'v', show: 'compare', say: 'A server costs this. One file costs nothing.', left: { title: 'A server', value: 12, points: ['Every month'] }, right: { title: 'One file', value: 0, points: ['Once'] } },
    // titles set smaller than the value would fit: the value comes down to their size
    { id: 'v', show: 'compare', say: 'A rented server costs this. One file costs nothing.', left: { title: 'A rented server in a rack', value: '$40' }, right: { title: 'One shared file on a phone', value: '0' } },
  ];
  for (const shot of shots) {
    for (const format of ['16:9', '9:16']) {
      const { nodes } = expandShot(shot, 'pop', format);
      for (const side of ['left', 'right']) {
        const value = all(nodes).find((n) => n.id === `v.${side}.value`);
        assert.equal(value.props.stack, undefined, `${format} ${side}: the value carries no stack`);
        const { ratio, clusters } = heroRatio(textsUnder(nodes, `v.${side}.`));
        assert.ok(clusters < 2 || ratio >= MIN_HERO_RATIO - 1e-6, `${format} ${side}: ${clusters} clusters, ratio ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('I10: the pop end ask, the plate-less number delta and the pop chart claim carry roles the hero rule judges, and their frames pass it', () => {
  const end = expandShot({ id: 'e', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion' }, 'pop', '9:16');
  const ask = all(end.nodes).find((n) => n.id === 'e.ask.text');
  assert.notEqual(ask.props.role, 'tag');
  assert.ok(heroRatio(textsUnder(end.nodes, 'e.')).ratio >= MIN_HERO_RATIO - 1e-6, 'end: hero ratio');
  for (const look of ['desk', 'pop']) {
    const num = expandShot(registries.kinds.get('number').example, look, look === 'pop' ? '9:16' : '16:9');
    const delta = all(num.nodes).find((n) => n.id === 'rows.delta.text');
    assert.notEqual(delta.props.role, 'tag', `${look}: delta role`);
    assert.ok(heroRatio(textsUnder(num.nodes, 'rows.')).ratio >= MIN_HERO_RATIO - 1e-6, `${look}: number hero ratio`);
  }
  for (const shot of [COLUMNS(), COLUMNS({ highlight: undefined })]) {
    for (const format of ['9:16', '16:9']) {
      const pop = expandShot(shot, 'pop', format);
      const claim = all(pop.nodes).find((n) => n.id === 'g.title.text');
      assert.notEqual(claim.props.role, 'tag', 'chart claim role');
      // before the numeral punches in, the claim is the largest text on the frame: three times the labels
      const labelSize = all(pop.nodes).find((n) => n.id === 'g.label.0').props.font.size;
      assert.ok(claim.props.font.size >= MIN_HERO_RATIO * labelSize - 1e-6, `${format}: claim ${claim.props.font.size} over labels ${labelSize}`);
      const { ratio } = heroRatio(textsUnder(pop.nodes, 'g.'));
      assert.ok(ratio >= MIN_HERO_RATIO - 1e-6, `pop chart ${format} highlight ${shot.highlight}: hero ratio ${ratio.toFixed(2)}`);
    }
  }
});

test('I10: a pop end whose title sits at the stack floor still holds the ask a third of it', () => {
  const title = 'Every single number in this film comes with the source it was taken from';
  const end = expandShot({ id: 'e', show: 'end', title, say: `${title}.`, ask: 'Start today' }, 'pop', '9:16');
  const { ratio } = heroRatio(textsUnder(end.nodes, 'e.'));
  const ask = all(end.nodes).find((n) => n.id === 'e.ask.text');
  const smallest = registries.looks.get('pop').scale[0] * end.ctx.unit;
  // three times or more; else the ask is already at the smallest step it may take, and the review's hero rule says so
  assert.ok(ratio >= MIN_HERO_RATIO - 1e-6 || Math.abs(ask.props.font.size - smallest) < 1e-6, `ratio ${ratio.toFixed(2)}, ask ${ask.props.font.size}`);
  assert.ok(ask.props.font.size < 1.5 * registries.looks.get('pop').scale[1] * end.ctx.unit, `a long title takes a smaller ask (${ask.props.font.size})`);
});

// ---- M13: the tall pop compare turn bar ----

test('M13: the tall pop compare turn bar keeps clear of side A\'s value and points and side B\'s tag', () => {
  // both halves full: side A's value and points run far under its title (three points that wrap), side B's tag sits at
  // the top of its half, so the midpoint of the two titles falls inside A's points
  const long = ['Every single month of the year, without fail', 'Plus all the logins for everyone on the team', 'Plus the nightly backups that someone must check'];
  const shot = { id: 'v', show: 'compare', say: 'A server costs this. One file costs nothing.', left: { title: 'A server', value: 12, points: long }, right: { title: 'One shared file that opens on any phone you own', value: 0, points: long } };
  const { nodes, boxes } = expandShot(shot, 'pop', '9:16');
  const [, y, , h] = boxes.turn;
  const points = all(nodes).find((n) => n.id === 'v.left.points');
  const pointsBottom = points.props.y + points.props.layout.lines.at(-1).y;
  const value = all(nodes).find((n) => n.id === 'v.left.value');
  assert.ok(y >= pointsBottom && y >= value.props.y + value.props.layout.lines[0].y, `bar top ${y} under A's value and points (${pointsBottom})`);
  // B's tag: the plate's top, from the right side's block (tag, title, value, points)
  assert.ok(boxes.rightBlock, 'the right side\'s whole block is boxed');
  assert.ok(y + h <= boxes.rightBlock[1] + 1e-6, `bar bottom ${y + h} over B's tag at ${boxes.rightBlock[1]}`);
  assert.ok(boxes.leftBlock[1] + boxes.leftBlock[3] <= y + 1e-6, 'under the whole left block');
  const mid = (boxes.leftBlock[1] + boxes.leftBlock[3] + boxes.rightBlock[1]) / 2;
  assert.ok(Math.abs(y + h / 2 - mid) < 1e-6, `centred between the whole blocks (${y + h / 2} vs ${mid}), not between the titles`);
});

// ---- minors ----

test('M6: a donut in % whose values do not add up to 100 is a mechanical finding at data', () => {
  const found = review(DONUT({ data: [{ label: 'Video', value: 62 }, { label: 'Docs', value: 20 }] }));
  assert.ok(found.some((f) => f.kind === 'mechanical' && f.path === 'data' && /add up to 100/.test(f.message)), JSON.stringify(found));
  assert.deepEqual(review(DONUT()), [], '62 + 23 + 15');
  assert.deepEqual(review(DONUT({ unit: undefined, data: [{ label: 'A', value: 3 }, { label: 'B', value: 4 }], highlight: undefined })), [], 'no unit: any total');
});

test('M7: the highlight lands on the words that name it, not an earlier word sharing its first word', async () => {
  const { chartTimes } = await import('../../engine/kinds/chart-time.mjs');
  const words = ['North', 'grew', 'slowly', 'but', 'North', 'America', 'won'].map((text, i) => ({ text, start: 1 + i * 0.4 }));
  const timing = { words, sentences: [{ start: 1, end: 1.8 }, { start: 2.6, end: 3.8 }], duration: 6 };
  assert.ok(Math.abs(chartTimes({ highlight: 'North America' }, timing).highlightAt - words[4].start) < 1e-9);
  assert.ok(Math.abs(chartTimes({ highlight: 'North' }, timing).highlightAt - Math.max(words[0].start, chartTimes({}, timing).growEnd)) < 1e-9);
});

test('M8: a pop numeral held at its floor (three times the labels) wider than its room says so', () => {
  const shot = DONUT({ data: [{ label: 'Video', value: 1234567 }, { label: 'Docs', value: 2345678 }], unit: undefined, highlight: 'Video' });
  const numeral = all(expandShot(shot, 'pop', '9:16').nodes).find((n) => n.id === 'g.numeral');
  assert.equal(numeral.props.layout.overflow, true);
  const fits = all(expandShot(DONUT(), 'pop', '9:16').nodes).find((n) => n.id === 'g.numeral');
  assert.equal(fits.props.layout.overflow, false, 'a numeral that fits its hole is not flagged');
});

test('M9: a source line too wide for the frame is flagged (pop and desk), never left to run off', () => {
  const source = 'Annual report of the northern and southern regional offices';
  for (const [look, format] of [['pop', '9:16'], ['desk', '16:9'], ['pop', '16:9']]) {
    const { nodes, canvas } = expandShot(COLUMNS({ source }), look, format);
    const n = all(nodes).find((m) => m.id === 'g.source');
    assert.ok(n.props.layout.overflow || n.props.x + n.props.layout.width <= canvas.w, `${look} ${format}: ${n.props.x + n.props.layout.width} of ${canvas.w}`);
  }
  const { nodes } = expandShot(COLUMNS({ source: 'Annual report of the northern and southern regional offices, by quarter and by year' .slice(0, 60) }), 'pop', '9:16');
  assert.equal(all(nodes).find((m) => m.id === 'g.source').props.layout.overflow, true, 'pop 9:16: 60 characters at step 1 do not fit the safe width');
});

test('M10: two-line category labels reserve one line pitch, not an extra ascent: their last line ends on the area\'s bottom', () => {
  const data = ['North region', 'South region', 'East region', 'West region'].map((label, i) => ({ label, value: 10 + i }));
  const { nodes, boxes } = expandShot(COLUMNS({ data, highlight: undefined, source: undefined }), 'desk', '9:16');
  const label = all(nodes).find((m) => m.id === 'g.label.0');
  assert.equal(label.props.layout.lines.length, 2, 'the labels wrap to two lines');
  const bottom = label.props.y + label.props.layout.lines[1].y + 0.12 * label.props.font.size;
  const area = boxes.chart;
  assert.ok(Math.abs(bottom - (area[1] + area[3])) < 1, `label bottom ${bottom} vs area bottom ${area[1] + area[3]}`);
});

test('M11: the pop numeral and a line\'s x labels point at the fields they show', () => {
  const kind = chart();
  assert.equal(kind.nodeField(COLUMNS(), 'g.numeral'), 'data[2].value');
  assert.equal(kind.nodeField(LINES(), 'g.numeral'), 'data.series[0].points[2].y');
  assert.equal(kind.nodeField(LINES(), 'g.x.1'), 'data.series[0].points[1].x');
  assert.equal(kind.nodeField(AREA(), 'g.x.2'), 'data[2].x');
});

test('M15: a one-word first line that is a whole sentence is not charged as an orphan', async () => {
  const { stackLines } = await import('../../engine/text/breaks.mjs');
  const w = ['Shipped.', 'We', 'built', 'it'];
  assert.deepEqual(stackLines(w)[0], [0], JSON.stringify(stackLines(w)));
});

test('M18: a compare kicker a stack look does not draw is a creative finding at kicker; desk draws it', () => {
  const compare = registries.kinds.get('compare');
  const shot = { id: 'c', show: 'compare', kicker: 'The swap', say: 'Before, a server. After, one file.', left: { title: 'A server' }, right: { title: 'One file' } };
  const { timing } = expandShot(shot, 'pop', '9:16');
  const pop = compare.review(shot, { look: registries.looks.get('pop'), timing, at: () => 0, canvas: { w: 1080, h: 1920 } });
  assert.ok(pop.some((f) => f.path === 'kicker' && /does not draw/.test(f.message)), JSON.stringify(pop));
  const desk = compare.review(shot, { look: registries.looks.get('desk'), timing, at: () => 0, canvas: { w: 1920, h: 1080 } });
  assert.deepEqual(desk.filter((f) => f.path === 'kicker'), []);
});

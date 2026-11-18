// The `keynote` look's devices and emphasis (looks-four plan, Task 9): the weight sweep (each emphasised word to 800 by
// its spoken end, in spoken order, no word box moving, no per-letter tracks), the band of light (crosses its target once,
// ends at alpha 0, the only screened node), the elevated card (a two-layer soft shadow with no blur filter), the pill
// caption (the spoken word at the look's caption weight, no recolour), and a film accent override reaching the ring,
// the highlighted chart mark and the arrow. desk, pop and cosmos are proven unchanged by the frozen fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { applyAccent } from '../../engine/looks/index.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { EMPHASIS, emphasisOf } from '../../engine/kinds/emphasis.mjs';
import { measure as kindsMeasure, filmOf, canvasOf, expandIn, FPS } from './helpers/kinds.mjs';

const look = () => registries.looks.get('keynote');
const device = (name) => registries.devices.get(name);
const UNIT = 1;
const HEAVY = 800;
const LIGHT = 500; // the plan's fallback from 300 (a light word looked indented in its heavy room on the first sheets)
const NEW_ACCENT = '#00aa55';
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

// A measure whose advance follows the weight (a variable face's does), with the kinds helper's ink.
const weighted = (text, font) => {
  const m = kindsMeasure(text, font);
  const k = (font.weight ?? 400) / 400;
  return { ...m, width: m.width * k, inkRight: m.width * k - 0.02 * font.size };
};

function statementIn(say, format = '16:9') {
  const film = filmOf([{ id: 's', show: 'statement', say }], 'keynote', format);
  const timeline = buildTimeline(film, { fps: FPS });
  const ctx = shotContext({ film, index: 0, timeline, canvas: canvasOf(format), measure: weighted });
  return { out: registries.kinds.get('statement').expand(film.shots[0], ctx), timing: timeline.shots[0] };
}

test('weight-sweep is an emphasis entry reserving the sweep\'s heavy end; emphasisOf returns it for keynote', () => {
  assert.equal(emphasisOf(look()), EMPHASIS['weight-sweep']);
  // `flush` 'start' (n2 ruling 2): a line's first word at its room's start, measured at the heavy end as before
  assert.deepEqual(EMPHASIS['weight-sweep'].reserve(look()), { weight: HEAVY, flush: 'start' });
  assert.deepEqual({ ...look().sweep }, { from: LIGHT, to: HEAVY, flush: 'start' });
});

test('the weight sweep takes each emphasised word to 800 by that word\'s end, in spoken order, and moves no word box', () => {
  const { out, timing } = statementIn('Meet the *fastest build we have* ever made.');
  const text = flat(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.deepEqual(text.props.layout.reserve, { weight: HEAVY, flush: 'start' }, 'measured at the heavy end, a line\'s first word at its room\'s start');
  const words = text.props.layout.lines.flatMap((l) => l.words);
  const spoken = timing.words.filter((w) => w.emphasis);
  assert.equal(spoken.length, 4);
  const reached = spoken.map((sw) => {
    const w = words.find((x) => x.text.replace(/[^a-z]/gi, '') === sw.text.replace(/[^a-z]/gi, ''));
    const track = text.wordTracks[w.index].weight;
    assert.ok(track, `"${sw.text}" has a weight track`);
    assert.equal(sample(track, sw.start - 0.001), LIGHT, `"${sw.text}" is light before it is spoken`);
    assert.equal(sample(track, sw.end), HEAVY, `"${sw.text}" is at 800 by its end`);
    return track.points.findLast((p) => p.v === LIGHT).t; // when it starts to ramp
  });
  assert.deepEqual(reached, [...reached].sort((a, b) => a - b), 'the words ramp in spoken order');
  const plain = words.filter((w) => !spoken.some((sw) => w.text.replace(/[^a-z]/gi, '') === sw.text.replace(/[^a-z]/gi, '')));
  assert.ok(plain.every((w) => text.wordTracks[w.index]?.weight === undefined), 'the other words keep the display weight');
  // a word's room is its advance at 800, whatever weight it is drawn at: nothing re-flows over the shot
  const { font } = text.props;
  for (const w of words) {
    const room = weighted(w.text, { ...font, weight: HEAVY }).width + font.tracking * font.size * [...w.text].length;
    assert.ok(Math.abs(w.width - room) < 1e-6, `"${w.text}" is measured at 800`);
  }
  const lay0 = JSON.stringify(sampleGraph([text], 0)[0].layout), layEnd = JSON.stringify(sampleGraph([text], timing.duration)[0].layout);
  assert.equal(lay0, layEnd, 'the layout is the same at the first and last frame');
});

test('no word has per-letter tracks: the sweep moves whole words (type moves by word in keynote)', () => {
  const { out } = statementIn('Meet the *fastest build* ever made.');
  for (const n of flat(out.nodes).filter((x) => x.type === 'text')) {
    const words = n.props.layout.lines.flatMap((l) => l.words);
    assert.ok(n.wordTracks.length <= words.length, `${n.id}: at most one track map per word`);
    assert.ok(flat(out.nodes).every((x) => x.props.letters === undefined), 'no letters prop');
  }
});

test('a sweep band crosses its target once and ends at alpha 0', () => {
  const box = [200, 300, 1200, 260];
  const { nodes } = device('sweep').build({ id: 'sw', box, at: 2, look: look(), unit: UNIT, seed: 3 });
  const [band] = nodes;
  assert.equal(band.props.blend, 'screen');
  const xs = band.tracks.x.points.map((p) => p.v);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'one pass, left to right');
  const end = band.tracks.opacity.points.at(-1);
  assert.equal(end.v, 0, 'ends at alpha 0');
  assert.equal(sample(band.tracks.opacity, end.t + 5), 0, 'and stays there');
  assert.ok(band.children.every((c) => c.props.fill.toLowerCase() === '#ffffff'), 'a white band of light');
});

test('the end card\'s wordmark gets the band of light, and no other node of a keynote shot has a screen blend', () => {
  const screened = (nodes) => flat(nodes).filter((n) => n.props.blend === 'screen');
  for (const kind of ['statement', 'end', 'quote', 'list', 'number']) {
    const example = registries.kinds.get(kind).example;
    const { nodes } = expandIn(filmOf([example], 'keynote', '16:9'));
    const bands = screened(nodes);
    assert.ok(bands.every((n) => n.id.endsWith('.sweep')), `${kind}: only a sweep is screened (${bands.map((n) => n.id).join(', ')})`);
    if (kind === 'end') assert.equal(bands.length, 1, 'the end card has one band of light');
  }
});

test('an elevated card: white, rounded, two soft shadow layers of stacked rings, and no blur filter anywhere', () => {
  const { nodes } = device('card').build({ id: 'c', box: [100, 100, 800, 500], at: 0, look: look(), unit: UNIT, seed: 1 });
  const all = flat(nodes);
  assert.ok(all.every((n) => n.props.blur === undefined), 'no blur filter, so nothing is redrawn blurred every frame');
  assert.ok(all.every((n) => n.props.glow === undefined), 'no glow');
  const layers = all.filter((n) => /\.shadow\d$/.test(n.id));
  assert.equal(layers.length, 2, 'two shadow layers');
  assert.ok(layers.every((l) => l.type === 'group' && l.children.length > 1), 'each a soft-edged group of rings');
  assert.equal(all.find((n) => n.id === 'c.paper').props.fill, '#ffffff');
  assert.ok(/Q/.test(all.find((n) => n.id === 'c.paper').props.d), 'rounded corners');
});

test('the pill caption sets the spoken word at the look\'s caption weight with no recolour, its room reserved', () => {
  const pill = registries.captions.get('pill');
  const film = filmOf([{ id: 'm', show: 'statement', say: 'Here is the new *dashboard* in use.' }], 'keynote', '16:9');
  const { ctx, timing } = expandIn(film);
  const words = timing.words.map((w) => ({ ...w, heard: { start: w.start, end: w.end } }));
  const nodes = pill.compose(words, { ...ctx, timing, fps: FPS, captionId: 'cap', hero: 's.text', filmStart: 0, gridX: (c) => ctx.gridX?.(c) ?? 120 + (c - 1) * 150 });
  const caption = flat(nodes).find((n) => n.type === 'text' && n.props.role === 'caption');
  assert.ok(caption, 'a caption line');
  assert.deepEqual(caption.props.layout.reserve, { weight: look().captionWeight });
  assert.ok(caption.wordTracks.every((w) => w.fill === undefined), 'no word is recoloured');
  assert.ok(caption.wordTracks.some((w) => w.weight !== undefined), 'the spoken word steps in weight');
});

test('a film accent override recolours the ring, the highlighted chart mark and the arrow', () => {
  const recoloured = applyAccent(look(), NEW_ACCENT);
  const box = [200, 200, 400, 300];
  const ring = flat(device('circle').build({ id: 'r', box, at: 1, look: recoloured, unit: UNIT, seed: 2 }).nodes);
  assert.ok(ring.some((n) => n.props.stroke === NEW_ACCENT), 'the ring');
  const arrow = flat(device('arrow').build({ id: 'a', box, at: 1, look: recoloured, unit: UNIT, seed: 2, from: [100, 100] }).nodes);
  assert.ok(arrow.some((n) => n.props.stroke === NEW_ACCENT || n.props.fill === NEW_ACCENT), 'the arrow');
  const chart = { id: 'k', show: 'chart', type: 'bar', title: 'Build time fell', say: 'Build time fell to forty seconds.',
    data: [{ label: 'Before', value: 120 }, { label: 'Now', value: 40 }], highlight: 'Now' };
  const { nodes } = expandIn(filmOf([chart], 'keynote', '16:9', { accent: NEW_ACCENT }));
  const fills = flat(nodes).map((n) => n.props.fill).filter(Boolean);
  assert.ok(fills.includes(NEW_ACCENT), 'the highlighted bar');
  assert.ok(!fills.includes(look().palette.accent), 'nothing left in the old accent');
});

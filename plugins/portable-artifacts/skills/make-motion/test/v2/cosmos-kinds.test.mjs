// Each kind in the cosmos look: the one device it designs (engine/looks/cosmos.mjs kinds data) and its place inside the
// 9:16 platform safe zone. The orbit ring of a number, the dot rail of a list, the opening mark and attribution pill of
// a quote, the rounded marks and highlight light of a chart, the slow ring of an end, the glow and round region frame
// of a clipping; desk keeps none of them. Every text inside the safe zone in the browser is the review sweep's job
// (review-browser.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { compositionRect, runInk } from '../../engine/kinds/shared.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { editorialBounds } from '../../engine/kinds/editorial.mjs';
import { expandIn, filmOf, all, measure, near } from './helpers/kinds.mjs';

const example = (name) => {
  const raw = listEntries('kinds').find((e) => e.name === name).example;
  return raw.src ? { ...raw, src: 'shot.png' } : raw;
};
const cosmosTall = (shot) => expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
const cosmosWide = (shot) => expandIn(filmOf([shot], 'cosmos', '16:9', { mode: 'pro' }));
const deskWide = (shot) => expandIn(filmOf([shot], 'desk', '16:9'));
const byId = (nodes, id) => all(nodes).find((n) => n.id === id);
const endsWith = (nodes, suffix) => all(nodes).filter((n) => n.id.endsWith(suffix));
const numbers = (d) => d.match(/-?[\d.]+/g).map(Number);
const xsOf = (d) => numbers(d).filter((_, i) => i % 2 === 0);
const ysOf = (d) => numbers(d).filter((_, i) => i % 2 === 1);
const unit = (out) => out.ctx.unit;

// ---- number ----

const orbitOf = (out, id) => ({ group: byId(out.nodes, `${id}.orbit`), ring: byId(out.nodes, `${id}.orbit.ring`), spin: byId(out.nodes, `${id}.orbit.spin`) });
// The orbit ellipse's half axes from its path (M0 -b ... a 0 ...).
const axesOf = (ring) => { const v = numbers(ring.props.d); return { a: Math.max(...v.filter((_, i) => i % 2 === 0)), b: -v[1] }; };
const NINE = { id: 'n', show: 'number', say: 'Nine kinds.', value: 9, label: 'kinds of shot' };

test('number: a tilted orbit in the accent, faint from the first frame, lit at the landing, its dot circling once over the count', () => {
  const out = cosmosWide(NINE);
  const look = registries.looks.get('cosmos');
  const { group, ring, spin } = orbitOf(out, 'n');
  assert.ok(group && ring && spin, 'an orbit');
  assert.equal(group.props.rotate, look.kinds.number.orbit.tilt);
  assert.equal(ring.props.stroke, look.palette.accent);
  assert.equal(sample(ring.tracks.opacity, 0), look.kinds.number.orbit.faint, 'visible, faint, on the first frame');
  assert.equal(sample(ring.tracks.opacity, out.timing.duration), look.kinds.number.orbit.lit);
  const turn = spin.tracks.rotate.points;
  assert.equal(turn[0].v, 0);
  assert.equal(turn.find((p) => p.v === 360).t > turn[1].t, true, 'one whole turn as the count runs');
  assert.ok(turn.at(-1).v > 360 && turn.at(-1).t >= out.timing.duration - 1e-9, 'and it keeps circling to the end of the shot');
  // the sun at its focus: cosmos-sun.test.mjs
  assert.equal(byId(deskWide(NINE).nodes, 'n.orbit'), undefined, 'desk has none');
});

test('number: the orbit holds the figure with air, every corner of its cap box well inside the ellipse', () => {
  for (const shot of [NINE, example('number')]) {
    const out = cosmosTall(shot);
    const { group, ring } = orbitOf(out, shot.id);
    const { a, b } = axesOf(ring);
    const [x, y, w, h] = out.boxes.value;
    const t = (group.props.rotate * Math.PI) / 180;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const dx = px - group.props.x, dy = py - group.props.y;
      const u = dx * Math.cos(t) + dy * Math.sin(t), v = -dx * Math.sin(t) + dy * Math.cos(t);
      assert.ok((u / a) ** 2 + (v / b) ** 2 < 0.9, `${shot.id}: corner ${Math.round(px)},${Math.round(py)} inside with air`);
    }
  }
});

test('number: the figure opens in ink, counting, never fading in grey', () => {
  const out = cosmosWide(NINE);
  const value = byId(out.nodes, 'n.value');
  assert.equal(value.tracks.opacity, undefined, 'no fade on the figure');
});

test('list: a dot rail, one dot per item, the current item lit in the accent, the rail growing with the items', () => {
  const shot = example('list');
  const out = cosmosWide(shot);
  const n = shot.items.length;
  const look = registries.looks.get('cosmos');
  const dots = endsWith(out.nodes, '.dot0').length + endsWith(out.nodes, '.dot1').length;
  assert.equal(dots, 2);
  assert.equal(all(out.nodes).filter((x) => /\.lit\d+$/.test(x.id)).length, n);
  assert.equal(all(out.nodes).filter((x) => /\.rail\d+$/.test(x.id)).length, n - 1, 'a segment between each pair');
  const lit = all(out.nodes).filter((x) => /\.lit\d+$/.test(x.id));
  assert.ok(lit.every((x) => x.props.fill === look.palette.accent));
  // at the last item's arrival plus a beat, only its dot is lit
  const at = out.timing.duration - 0.05;
  const shown = lit.map((x) => sample(x.tracks.opacity, at));
  assert.deepEqual(shown.map((v) => v > 0.5), lit.map((_, k) => k === n - 1), shown.join(','));
  assert.equal(all(deskWide(shot).nodes).filter((x) => /\.lit\d+$/.test(x.id)).length, 0, 'desk keeps its figures');
});

// ---- quote ----

const HOME = { id: 'home', show: 'quote', say: 'That is here. That is home. That is us.', by: 'Carl Sagan', role: 'Pale Blue Dot, 1994' };

test('quote: matching large accent opening and closing marks, one short sentence per line, plain lavender attribution', () => {
  const out = cosmosWide(HOME);
  const look = registries.looks.get('cosmos');
  const open = byId(out.nodes, 'home.mark'), close = byId(out.nodes, 'home.close'), text = byId(out.nodes, 'home.text');
  assert.ok(open && close && text);
  assert.equal(close.props.font.size, open.props.font.size, 'matching marks');
  assert.equal(close.props.fill, look.palette.accent);
  assert.deepEqual(linesOf(text), ['That is here.', 'That is home.', 'That is us.']);
  assert.equal(byId(out.nodes, 'home.pill'), undefined, 'no pill');
  assert.equal(byId(out.nodes, 'home.by').props.fill, look.palette.ink2, 'plain lavender text');
  assert.equal(byId(deskWide(HOME).nodes, 'home.close'), undefined, 'desk keeps its inline marks');
});

// ---- chart ----

test('chart: marks in the lavender (accent2 is the lavender) with rounded far ends, gold only the highlight (with its light)', () => {
  const shot = example('chart');
  const out = cosmosWide(shot);
  const look = registries.looks.get('cosmos');
  const marks = all(out.nodes).filter((x) => /\.mark\.\d+$/.test(x.id));
  assert.ok(marks.length === shot.data.length);
  assert.ok(marks.every((m) => m.props.fill === look.palette.ink2), 'lavender marks');
  const dims = all(out.nodes).filter((x) => /\.mark\.\d+\.dim$/.test(x.id));
  assert.equal(dims.length, shot.data.length - 1, 'every other mark turns');
  assert.ok(dims.every((m) => m.props.fill === look.palette.ink2), 'to the one lavender dim');
  assert.ok(marks.every((m) => /Q/.test(m.props.d)), 'rounded far ends');
  const hl = shot.data.findIndex((d) => d.label === shot.highlight);
  const glow = byId(out.nodes, `${shot.id}.mark.${hl}.glow`);
  assert.equal(glow.props.blend, 'screen');
  assert.deepEqual({ ...glow.props.glow }, { color: look.palette.accent, alpha: glow.props.glow.alpha, radius: look.kinds.chart.glow * unit(out) });
  assert.equal(byId(out.nodes, `${shot.id}.mark.${hl}.accent`).props.fill, look.palette.accent);
  assert.equal(byId(deskWide(shot).nodes, `${shot.id}.mark.${hl}.glow`), undefined);
});

test('chart at 9:16: the title and source are inside the composition band', () => {
  const out = cosmosTall(example('chart'));
  const rect = compositionRect(out.ctx);
  assert.ok(rect.safe);
  const title = byId(out.nodes, `${example('chart').id}.title`);
  const up = runInk(title.props.layout.lines[0], title.props.font, measure).up;
  near(title.props.y + title.props.layout.lines[0].y - up, rect.top, 'the title ink starts on the band top');
});

// ---- end ----

test('end: a wordmark in the display weight with no pill outline, the ask readable and clear of the title descenders', () => {
  const look = registries.looks.get('cosmos');
  for (const expand of [cosmosWide, cosmosTall]) {
    const shot = example('end');
    const out = expand(shot);
    const mark = byId(out.nodes, `${shot.id}.mark.text`);
    assert.equal(mark.props.font.weight, look.fonts.display.weight, 'display weight');
    assert.equal(byId(out.nodes, `${shot.id}.mark.ring`), undefined, 'no outline round the mark: not a button');
    const title = byId(out.nodes, `${shot.id}.title`) ?? all(out.nodes).find((n) => n.props.role === 'hero');
    const ask = byId(out.nodes, `${shot.id}.ask`);
    if (!ask) { assert.deepEqual(title.props.dropped, ['ask'], 'an ask left out is said so'); continue; }
    assert.ok(ask.props.font.size >= look.secondary.min * out.ctx.unit - 1e-9, `ask ${ask.props.font.size}`);
    const descent = title.props.y + title.props.layout.lines.at(-1).y + 0.25 * title.props.font.size;
    const askCap = ask.props.y + ask.props.layout.lines[0].y - 0.72 * ask.props.font.size;
    assert.ok(askCap - descent >= 0.2 * title.props.font.size, `${askCap} vs descenders at ${descent}`);
    assert.ok(Math.abs(mark.props.x + mark.props.layout.lines[0].x + mark.props.layout.lines[0].width / 2 - out.canvas.w / 2) < 0.05 * out.canvas.w, 'centred on the frame');
  }
});

test('clipping: the picture on the rounded card, square, a smooth accent glow under it, a round region frame', () => {
  const shot = { ...example('clipping'), on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const out = cosmosWide(shot);
  const look = registries.looks.get('cosmos');
  const glow = byId(out.nodes, `${shot.id}.image.glow`);
  assert.ok(glow, 'a glow');
  assert.equal(glow.props.blend, 'screen');
  assert.deepEqual({ ...glow.props.glow, alpha: 0 }, { color: look.palette.accent, alpha: 0, radius: look.kinds.clipping.glow * unit(out) });
  const sides = all(out.nodes).filter((x) => /\.side\d$/.test(x.id));
  assert.equal(sides.length, 4);
  assert.ok(sides.every((s) => /Q/.test(s.props.d) && s.props.lineCap === 'round'), 'round corners');
  const deskSides = all(deskWide(shot).nodes).filter((x) => /\.side\d$/.test(x.id));
  assert.ok(deskSides.every((s) => !/Q/.test(s.props.d)), 'desk keeps its square frame');
});

test('clipping at 9:16: the caption card sits inside the composition band', () => {
  const out = cosmosTall(example('clipping'));
  const rect = compositionRect(out.ctx);
  const [x, y, w, h] = out.boxes.caption;
  assert.ok(x >= rect.left - 1e-6 && x + w <= rect.left + rect.w + 1e-6 && y >= rect.top - 1e-6 && y + h <= rect.top + rect.h + 1e-6, JSON.stringify([x, y, w, h]));
});

// ---- statement ----

test('statement in a viral 9:16 film: the hero composes inside the safe zone band', () => {
  const out = cosmosTall(example('statement'));
  const rect = compositionRect(out.ctx);
  assert.ok(rect.safe);
  const [x, y, w, h] = out.boxes.text;
  assert.ok(x >= rect.left && x + w <= rect.left + rect.w && y >= rect.top && y + h <= rect.top + rect.h, JSON.stringify(out.boxes.text));
});

// ---- compare ----

test('compare: two rounded cards, the unspoken side under a deep scrim, an arrow between them', () => {
  const out = cosmosTall(example('compare'));
  const look = registries.looks.get('cosmos');
  const id = example('compare').id;
  for (const side of ['left', 'right']) {
    assert.equal(byId(out.nodes, `${id}.${side}.paper`).props.fill, look.devices.card.fill);
    assert.equal(byId(out.nodes, `${id}.${side}.scrim`).props.fill, look.palette.deep);
  }
  assert.ok(byId(out.nodes, `${id}.arrow`));
  const [l, r] = [out.boxes.left, out.boxes.right];
  assert.ok(l[1] + l[3] < r[1], 'stacked on a tall frame, apart');
});

// ---- director's round ----

// values as written (not numbers): the cards, not the discs
const SIZES = { id: 'sizes', show: 'compare', say: 'Earth is small. Jupiter is eleven Earths wide.', left: { title: 'Earth', value: '12,742 km', points: ['kilometres across'] }, right: { title: 'Jupiter', value: '139,820 km', points: ['kilometres across'] } };

test('compare: a vs pill in the look weight, points without a dash, the value in the accent only while its side is spoken', () => {
  const out = cosmosWide(SIZES);
  const look = registries.looks.get('cosmos');
  assert.ok(byId(out.nodes, 'sizes.vs'), 'a vs pill (the look tag)');
  assert.equal(all(out.nodes).filter((n) => /\.vs\.[vs]$/.test(n.id)).length, 0, 'no hand-drawn strokes');
  const points = byId(out.nodes, 'sizes.left.points');
  assert.ok(!/^–/.test(points.props.layout.lines[0].words[0].text), 'no dash glyph');
  const turn = out.timing.duration / 2;
  const [left, right] = ['left', 'right'].map((k) => byId(out.nodes, `sizes.${k}.value`).wordTracks[0].fill);
  assert.equal(sample(left, 0), look.palette.accent);
  assert.equal(sample(right, 0), look.palette.ink);
  assert.equal(sample(left, out.timing.duration), look.palette.ink);
  assert.equal(sample(right, out.timing.duration), look.palette.accent);
  assert.ok(turn > 0);
});

test('compare: the spoken card has a rim light that moves to the other card at the turn; the cards are at least `fill` tall', () => {
  const out = cosmosWide(SIZES);
  const [l, r] = ['left', 'right'].map((k) => byId(out.nodes, `sizes.${k}.rim`));
  assert.equal(l.props.blend, 'screen');
  assert.equal(sample(l.tracks.opacity, 0), 1);
  assert.equal(sample(r.tracks.opacity, 0), 0);
  assert.equal(sample(l.tracks.opacity, out.timing.duration), 0);
  assert.equal(sample(r.tracks.opacity, out.timing.duration), 1);
  assert.ok(out.boxes.left[3] >= 0.45 * out.canvas.h, `cards ${out.boxes.left[3]} of ${out.canvas.h}`);
  assert.equal(byId(deskWide(SIZES).nodes, 'sizes.left.rim'), undefined, 'desk has none');
});

const GIANTS = { id: 'g', show: 'chart', type: 'column', title: 'Jupiter dwarfs the rest', say: 'Neptune, four Earths. Saturn, nine. Jupiter beats them all.', data: [{ label: 'Earth', value: 13 }, { label: 'Neptune', value: 49 }, { label: 'Saturn', value: 116 }, { label: 'Jupiter', value: 140 }], highlight: 'Jupiter', source: 'Width in thousand km, NASA planetary fact sheet, 2026 edition' };

test('chart: every mark labelled directly: no axis, gridlines or ticks; every category keeps its label; marks fill most of their band', () => {
  const out = cosmosTall(GIANTS);
  assert.equal(byId(out.nodes, 'g.axis'), undefined);
  assert.equal(all(out.nodes).filter((n) => /\.(ref|tick)\.\d+$/.test(n.id)).length, 0);
  assert.equal(all(out.nodes).filter((n) => /^g\.label\.\d+$/.test(n.id)).length, 4, 'no label thinned');
  assert.ok(byId(deskWide(GIANTS).nodes, 'g.axis'), 'desk keeps its axis');
});

test('chart at 9:16: a long source line stays inside the safe zone (wrapped at the floor), or is left out and said so', () => {
  const out = cosmosTall(GIANTS);
  const rect = compositionRect(out.ctx);
  const source = byId(out.nodes, 'g.source');
  if (!source) { assert.deepEqual(byId(out.nodes, 'g.title').props.dropped, ['source']); return; }
  const right = source.props.x + source.props.layout.width;
  assert.ok(right <= rect.left + rect.w + 1e-6, `source right ${right} vs ${rect.left + rect.w}`);
});

test('number: a counter counts from its first non-zero step, and its unit sits on the figure baseline (never raised like an exponent)', () => {
  const out = cosmosWide({ id: 'd', show: 'number', say: 'One hundred fifty million kilometres.', value: 150, suffix: 'M km', label: 'from the Sun to Earth' });
  const digits = byId(out.nodes, 'd.value.digits');
  assert.notEqual(digits.props.steps[0].text, '0');
  const suffix = byId(out.nodes, 'd.value.suffix');
  near(suffix.props.y + suffix.props.layout.lines[0].y, digits.props.y + digits.props.layout.lines[0].y, 'one baseline');
});

test('statement on a tall frame may take five lines (maxLinesTall), so a six-word hook is set large', () => {
  const out = cosmosTall({ id: 'h', show: 'statement', say: 'This sunlight is *eight minutes* old.' });
  const hero = byId(out.nodes, 'h.text');
  assert.ok(hero.props.layout.lines.length <= 5);
  assert.ok(out.boxes.text[3] >= 0.3 * out.canvas.h, `block ${out.boxes.text[3]} of ${out.canvas.h}`);
});

test('slug at 9:16: a short kicker stays on one line (no line ends on an article)', () => {
  const out = cosmosTall({ id: 'p', show: 'statement', kicker: 'On the way', say: 'Past Mercury, past Venus, then you.' });
  const kicker = byId(out.nodes, 'p.kicker');
  assert.equal(kicker.props.layout.lines.length, 1, kicker.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' / '));
});

// ---- gate review 1 ----

const LIGHT = { id: 'l', show: 'statement', say: 'The sunlight on your face is *eight minutes* old.' };
const linesOf = (text) => text.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' '));

test('statement at 16:9: across the frame in at most two lines, the emphasised phrase never split across lines', () => {
  const out = cosmosWide(LIGHT);
  const lines = linesOf(byId(out.nodes, 'l.text'));
  assert.ok(lines.length <= 2, lines.join(' / '));
  assert.ok(lines.some((l) => l.includes('eight minutes')), `phrase whole: ${lines.join(' / ')}`);
  assert.ok(out.boxes.text[0] + out.boxes.text[2] > out.canvas.w / 2, 'the block reaches into the right half');
});

test('statement: the look sun lights as the emphasised words are spoken (its place: cosmos-sun.test.mjs)', () => {
  const out = cosmosWide(LIGHT);
  const sun = byId(out.nodes, 'l.sun');
  assert.ok(sun, 'a sun');
  assert.equal(sample(sun.tracks.opacity, 0), 0);
  assert.equal(byId(deskWide(LIGHT).nodes, 'l.sun'), undefined, 'desk has none');
});

const PATH = { id: 'p', show: 'list', kicker: 'On the way', say: 'Past Mercury. Past Venus. Then you.', items: ['Mercury', 'Venus', 'You'] };

test('list: no slug badge; every item there from frame 0 in lavender, lit while current, lavender again after', () => {
  const out = cosmosTall(PATH);
  const look = registries.looks.get('cosmos');
  assert.equal(byId(out.nodes, 'p.kicker'), undefined, 'no badge');
  const items = [0, 1, 2].map((k) => byId(out.nodes, `p.item${k}`));
  for (const item of items) {
    assert.equal(item.tracks.opacity, undefined, 'there from frame 0');
    assert.equal(sample(item.wordTracks[0].fill, 0), look.palette.ink2, 'upcoming: lavender');
  }
  const atOne = items[1].wordTracks[0].fill.points[2].t; // item 1 lit
  assert.equal(sample(items[1].wordTracks[0].fill, atOne), look.palette.ink, 'current: lit');
  assert.equal(sample(items[0].wordTracks[0].fill, atOne + 1), look.palette.ink2, 'past: lavender');
});

test('list: the path runs the block height from frame 0, light travels down it from the sun at its start', () => {
  const out = cosmosTall(PATH);
  const rails = all(out.nodes).filter((n) => /^p\.rail\d+$/.test(n.id));
  assert.equal(rails.length, 2);
  assert.ok(rails.every((r) => sample(r.tracks.opacity, 0) > 0), 'the whole rail on frame 0');
  const lit = all(out.nodes).filter((n) => /^p\.path\d+$/.test(n.id));
  assert.equal(lit.length, 2);
  assert.equal(sample(lit[0].tracks.opacity, 0), 0, 'light not yet down the path');
  assert.ok(byId(out.nodes, 'p.sun'), 'the sun at the path start');
});

// ---- compare as scale ----

const SUN = { id: 'sun', show: 'compare', say: 'Earth is twelve thousand kilometres across. The Sun is one hundred and nine Earths.', left: { title: 'Earth', value: 12742 }, right: { title: 'The Sun', value: 1392700 } };
const radiusOf = (n) => { const v = numbers(n.props.d); return Math.max(...v.map(Math.abs)); };

test('compare with two numbers draws scale: the dot and the sun in the true ratio, the smaller at least a visible dot, the ratio printed', () => {
  for (const out of [cosmosWide(SUN), cosmosTall(SUN)]) {
    const look = registries.looks.get('cosmos');
    const small = byId(out.nodes, 'sun.left.dot'), big = byId(out.nodes, 'sun.right.sun');
    assert.ok(small && big, 'a dot and the sun');
    const ratio = big.props.radial.r / radiusOf(small);
    assert.ok(Math.abs(ratio - 1392700 / 12742) / (1392700 / 12742) < 0.01, `true ratio: ${ratio.toFixed(1)}`);
    assert.ok(2 * radiusOf(small) >= look.kinds.compare.discs.minDot * out.ctx.unit - 1e-6, 'a visible dot');
    assert.equal(byId(out.nodes, 'sun.ratio').props.layout.lines[0].words.map((w) => w.text).join(' '), '109\u00d7');
    assert.equal(byId(out.nodes, 'sun.vs'), undefined, 'no cards, no vs');
  }
});

test('compare as scale: the sun runs off the frame like a horizon (right on wide, bottom on tall); desk keeps its cards', () => {
  const out = cosmosWide(SUN);
  const big = byId(out.nodes, 'sun.right.sun');
  assert.ok(big.props.x + big.props.radial.r > out.canvas.w, 'off the right edge');
  const tall = cosmosTall(SUN);
  const bigTall = byId(tall.nodes, 'sun.right.sun');
  assert.ok(bigTall.props.y + bigTall.props.radial.r > tall.canvas.h, 'off the bottom of a tall frame');
  assert.equal(byId(deskWide(SUN).nodes, 'sun.right.sun'), undefined, 'desk keeps its cards');
});

test('compare: plainly numeric strings ("12,742") draw scale too; values with words stay cards', () => {
  const out = cosmosWide({ ...SUN, left: { title: 'Earth', value: '12,742' }, right: { title: 'The Sun', value: '1,392,700' } });
  assert.ok(byId(out.nodes, 'sun.right.sun'), 'scale for numeric strings');
  assert.equal(byId(cosmosWide(SIZES).nodes, 'sizes.right.sun'), undefined, 'cards for "139,820 km"');
});

test('statement at 16:9: a longer emphasised run stays on one line when any size allows it', () => {
  const out = cosmosWide({ id: 'r', show: 'statement', say: 'The sunlight on *your face is eight minutes* old.' });
  const lines = linesOf(byId(out.nodes, 'r.text'));
  assert.ok(lines.some((l) => l.includes('your face is eight minutes')), lines.join(' / '));
});

test('quote: short sentences each take their own line even where two would fit on one', () => {
  const out = cosmosWide({ id: 'g', show: 'quote', say: 'Go. Look up. See it.', by: 'Someone' });
  assert.deepEqual(linesOf(byId(out.nodes, 'g.text')), ['Go.', 'Look up.', 'See it.']);
});

test('number at 9:16: the example figure with a delta fits its tall orbit', () => {
  const out = cosmosTall(example('number'));
  assert.equal(byId(out.nodes, 'rows.value.digits').props.layout.overflow, false);
});

test('list at 9:16: the widely spaced block keeps a share of the band clear above and below it', () => {
  const shot = { id: 'how', show: 'list', title: 'How it works', style: 'steps', say: 'Write the film as JSON. Render it in one command. Share the MP4.', items: ['Write the film as JSON', 'Render it in one command', 'Share the MP4'] };
  const out = cosmosTall(shot);
  const band = editorialBounds(out.ctx);
  const first = byId(out.nodes, 'how.item0');
  const capTop = first.props.y + first.props.layout.lines[0].y - 0.7 * first.props.font.size;
  assert.ok(capTop >= band.top + 0.04 * (band.bottom - band.top), `${capTop} vs band top ${band.top}`);
});

test('quote at 9:16: with no room past the widest line, the closing mark sits under the block, flush with its right', () => {
  const out = cosmosTall({ id: 'v', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' });
  const text = byId(out.nodes, 'v.text'), close = byId(out.nodes, 'v.close');
  const right = text.props.x + text.props.layout.width;
  // its ink flush with the block (the advance runs a little past the ink)
  assert.ok(close.props.x + close.props.layout.width <= right + 0.1 * close.props.layout.width, `${close.props.x + close.props.layout.width} vs ${right}`);
  // its baseline (its ink hangs from the attribution's cap line) below the last line's baseline
  assert.ok(close.props.y + close.props.layout.lines[0].y > text.props.y + text.props.layout.lines.at(-1).y, 'under the last line');
});

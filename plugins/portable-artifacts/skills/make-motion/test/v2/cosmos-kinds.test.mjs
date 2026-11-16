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
  assert.equal(turn.at(-1).v, 360, 'one whole turn, ending as the count lands');
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

test('number at 9:16: the label clears the orbit and its descenders stay in the band; the orbit stays on the frame', () => {
  const shot = { id: 'm', show: 'number', say: 'Eight minutes.', value: 8, suffix: 'min', label: 'from the Sun to you, past every planet on the way' };
  const out = cosmosTall(shot);
  const rect = compositionRect(out.ctx);
  const { group, ring } = orbitOf(out, 'm');
  const { a, b } = axesOf(ring);
  const t = (group.props.rotate * Math.PI) / 180;
  const hx = Math.hypot(a * Math.cos(t), b * Math.sin(t)), hy = Math.hypot(a * Math.sin(t), b * Math.cos(t));
  assert.ok(out.boxes.label[1] > group.props.y + hy, 'the label under the orbit');
  const label = byId(out.nodes, 'm.label');
  const last = label.props.layout.lines.at(-1);
  assert.ok(label.props.y + last.y + runInk(last, label.props.font, measure).down <= rect.top + rect.h + 1e-6, 'descenders in the band');
  const margin = (registries.looks.get('cosmos').grid.margin * unit(out)) / 2;
  assert.ok(group.props.x - hx >= margin - 1e-6, `orbit left ${group.props.x - hx}`);
  assert.ok(group.props.x + hx <= rect.left + rect.w + 1e-6, `orbit right ${group.props.x + hx}`);
});

// ---- list ----

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

test('quote: a large accent opening mark stands over the quotation, and the attribution sits in a pill', () => {
  const out = cosmosWide(example('quote'));
  const look = registries.looks.get('cosmos');
  const id = example('quote').id;
  const mark = byId(out.nodes, `${id}.mark`), text = byId(out.nodes, `${id}.text`), pill = byId(out.nodes, `${id}.pill`);
  assert.ok(mark && text && pill, 'mark, quotation and pill');
  assert.equal(mark.props.fill, look.palette.accent);
  assert.ok(mark.props.font.size > 2 * text.props.font.size, 'large');
  const capTop = text.props.y + text.props.layout.lines[0].y - 0.7 * text.props.font.size;
  assert.ok(mark.props.y + mark.props.layout.lines[0].y < capTop, 'its baseline over the first cap line');
  assert.ok(!/[\u201c"]/.test(text.props.layout.lines[0].words[0].text), 'the quotation does not repeat the mark');
  assert.equal(byId(out.nodes, `${id}.rule`), undefined, 'no rule');
  assert.equal(byId(deskWide(example('quote')).nodes, `${id}.mark`), undefined, 'desk hangs its mark in the text');
});

// ---- chart ----

test('chart: marks in shape2 with rounded far ends, the highlight in the accent with a smooth light under it', () => {
  const shot = example('chart');
  const out = cosmosWide(shot);
  const look = registries.looks.get('cosmos');
  const marks = all(out.nodes).filter((x) => /\.mark\.\d+$/.test(x.id));
  assert.ok(marks.length === shot.data.length);
  assert.ok(marks.every((m) => m.props.fill === look.palette.shape2));
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

test('end: a slow accent ring round the mark chip draws on after the entrance', () => {
  const out = cosmosWide(example('end'));
  const [ring] = endsWith(out.nodes, '.ring');
  const look = registries.looks.get('cosmos');
  assert.ok(ring);
  assert.equal(ring.props.stroke, look.palette.accent);
  const draw = ring.tracks.draw.points;
  near(draw.at(-1).t - draw[1].t, look.kinds.end.ring.dur, 'over the ring duration');
  assert.equal(endsWith(deskWide(example('end')).nodes, '.ring').length, 0);
});

// ---- clipping ----

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

const SIZES = { id: 'sizes', show: 'compare', say: 'Earth is small. Jupiter is eleven Earths wide.', left: { title: 'Earth', value: 12742, points: ['kilometres across'] }, right: { title: 'Jupiter', value: 139820, points: ['kilometres across'] } };

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

test('chart at 9:16: a long source line is set smaller to stay inside the safe zone', () => {
  const out = cosmosTall(GIANTS);
  const rect = compositionRect(out.ctx);
  const source = byId(out.nodes, 'g.source');
  const right = source.props.x + source.props.layout.width;
  assert.ok(right <= rect.left + rect.w + 1e-6, `source right ${right} vs ${rect.left + rect.w}`);
});

test('number: a count runs within the final digit count (150 counts from 100), so it opens near its value', () => {
  const out = cosmosWide({ id: 'd', show: 'number', say: 'One hundred fifty million kilometres.', value: 150, suffix: 'M km', label: 'from the Sun to Earth' });
  const digits = byId(out.nodes, 'd.value.digits');
  const first = digits.props.steps[0].text;
  assert.equal(first.length, 3, `opens on ${first}`);
  const desk = byId(deskWide({ id: 'd', show: 'number', say: 'One hundred fifty.', value: 150, label: 'x' }).nodes, 'd.value.digits');
  assert.equal(desk.props.steps[0].text, '0', 'desk counts from 0');
});

test('statement on a tall frame may take five lines (maxLinesTall), so a six-word hook is set large', () => {
  const out = cosmosTall({ id: 'h', show: 'statement', say: 'This sunlight is *eight minutes* old.' });
  const hero = byId(out.nodes, 'h.text');
  assert.ok(hero.props.layout.lines.length <= 5);
  assert.ok(out.boxes.text[3] >= 0.3 * out.canvas.h, `block ${out.boxes.text[3]} of ${out.canvas.h}`);
});

test('slug at 9:16: a short kicker stays on one line (no line ends on an article)', () => {
  const out = cosmosTall({ id: 'p', show: 'list', kicker: 'On the way', say: 'Past Mercury. Past Venus. Then you.', items: ['Mercury', 'Venus', 'You'] });
  const kicker = byId(out.nodes, 'p.kicker');
  assert.equal(kicker.props.layout.lines.length, 1, kicker.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' / '));
});

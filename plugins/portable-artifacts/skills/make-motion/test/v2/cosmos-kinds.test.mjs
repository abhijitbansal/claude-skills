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

test('number: an orbit ring in the accent draws on from the count start to its landing, round the figure', () => {
  const out = cosmosWide({ id: 'n', show: 'number', say: 'Nine kinds.', value: 9, label: 'kinds of shot' });
  const ring = byId(out.nodes, 'n.ring');
  assert.ok(ring, 'a ring');
  assert.equal(ring.props.stroke, registries.looks.get('cosmos').palette.accent);
  assert.equal(ring.props.lineCap, 'round');
  const draw = ring.tracks.draw.points;
  assert.equal(draw[0].v, 0);
  assert.equal(draw.at(-1).v, 1);
  assert.ok(draw.at(-1).t > draw[1].t, 'it draws over the count');
  assert.equal(byId(deskWide({ id: 'n', show: 'number', say: 'Nine kinds.', value: 9, label: 'kinds of shot' }).nodes, 'n.ring'), undefined, 'desk has none');
});

test('number: one digit takes an ellipse (cubic arcs), a wide figure a stadium (lines and round ends) that holds it', () => {
  const one = byId(cosmosWide({ id: 'n', show: 'number', say: 'Nine.', value: 9, label: 'kinds' }).nodes, 'n.ring');
  assert.match(one.props.d, /C/, 'an ellipse');
  const out = cosmosTall(example('number'));
  const wide = byId(out.nodes, 'rows.ring');
  assert.match(wide.props.d, /L.*Q/, 'a stadium');
  const value = out.boxes.value;
  assert.ok(Math.min(...xsOf(wide.props.d)) < value[0] && Math.max(...xsOf(wide.props.d)) > value[0] + value[2], 'round the whole row');
});

test('number at 9:16: the label clears the ring, the ring stays at least half a margin from the frame edge', () => {
  const out = cosmosTall({ id: 'n', show: 'number', say: 'Nine kinds.', value: 9, label: 'kinds of shot' });
  const ring = byId(out.nodes, 'n.ring');
  const bottom = Math.max(...ysOf(ring.props.d));
  assert.ok(out.boxes.label[1] > bottom, `label top ${out.boxes.label[1]} under the ring ${bottom}`);
  const margin = registries.looks.get('cosmos').grid.margin * unit(out) / 2;
  assert.ok(Math.min(...xsOf(ring.props.d)) >= margin - 1e-6, `ring left ${Math.min(...xsOf(ring.props.d))}`);
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

// Gate round 3 of the cosmos look (gate review 3 and the code review left with the parked look): one sun that lights by
// growing, never by fading through grey; light colours that follow a film's accent; one Earth mark everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { applyAccent } from '../../engine/looks/index.mjs';
import { sunNodes, sunBody, earthNodes, lightColour, sunAnchor } from '../../engine/devices/sun.mjs';
import { glowStyle } from '../../engine/devices/glow.mjs';
import { sample } from '../../engine/time/track.mjs';
import { toOklab } from '../../engine/color/oklab.mjs';
import { expandIn, filmOf, all, measure } from './helpers/kinds.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';

const look = registries.looks.get('cosmos');
const FONT = { family: 'Nunito', weight: 800, size: 136 };

// ---- one sun, lit by growing ----

test('sun: it lights by scaling in from a point, never by an opacity fade (a half-faded disc read as a grey planet)', () => {
  const [sun] = sunNodes('s', look, { cx: 100, cy: 100, r: 200, at: 1 });
  assert.equal(sun.tracks.opacity, undefined, 'no opacity track: the disc is never translucent');
  assert.equal(sample(sun.tracks.scale, 0), 0, 'nothing before it lights');
  assert.equal(sample(sun.tracks.scale, 1), 0);
  assert.ok(sample(sun.tracks.scale, 1 + look.sun.lift / 2) > 0, 'growing');
  assert.equal(sample(sun.tracks.scale, 1 + look.sun.lift), 1, 'full size once lit');
  assert.ok(sun.props.radial.stops.filter(([at]) => at <= look.sun.disc).every(([, a]) => a === 1), 'the disc at full strength on every frame');
});

test('sun: lit from frame 0 when no time is given (no tracks)', () => {
  const [sun] = sunNodes('s', look, { cx: 0, cy: 0, r: 200 });
  assert.deepEqual(sun.tracks ?? {}, {});
});

// ---- light colours follow the accent ----

const hexes = (stops) => stops.map(([, , c]) => c);

test('accent: with the look\'s own accent the light colours are the look data, exactly', () => {
  for (const key of ['core', 'color', 'limb']) assert.equal(lightColour(look, look.sun[key]), look.sun[key]);
  assert.equal(glowStyle(look, FONT, 1).glow.color, look.glow.color);
});

test('accent: a film accent override moves the sun and the glyph glow with it (the gold stop is the new accent)', () => {
  const blue = applyAccent(look, '#66ccff');
  const [sun] = sunNodes('s', blue, { cx: 0, cy: 0, r: 200 });
  assert.ok(hexes(sun.props.radial.stops).includes('#66ccff'), 'the body is the accent');
  const [base] = sunNodes('s', look, { cx: 0, cy: 0, r: 200 });
  assert.ok(hexes(sun.props.radial.stops).every((c, i) => c !== hexes(base.props.radial.stops)[i] || c === undefined), 'every light colour moved');
  // the limb stays deeper than the body and the core lighter, as designed
  const L = (hex) => toOklab(hex)[0];
  assert.ok(L(lightColour(blue, look.sun.core)) > L('#66ccff') && L(lightColour(blue, look.sun.limb)) < L('#66ccff'));
  const glow = glowStyle(blue, FONT, 1).glow.color;
  assert.notEqual(glow, look.glow.color, 'the glyph glow follows');
  const [body] = sunBody('b', blue, { cx: 0, cy: 0, r: 2000, visible: 600 }).slice(-1);
  assert.ok(hexes(body.props.radial.stops).includes('#66ccff'), 'the large disc too');
});

// ---- the sun at scale shows its core and its limb ----

test('sun body: the part on screen runs from a hot inner colour to the gold limb at its edge (never a flat yellow wall)', () => {
  const r = 3000, visible = 700;
  const nodes = sunBody('b', look, { cx: 0, cy: 0, r, visible });
  const body = nodes.find((n) => n.id === 'b');
  const stops = body.props.radial.stops;
  const onScreen = stops.filter(([at]) => at >= 1 - visible / r - 1e-9);
  assert.ok(onScreen.some(([, , c]) => c === look.sun.core), 'the core colour inside the visible depth');
  assert.equal(stops.at(-1)[2], look.sun.limb, 'the limb at the edge');
  assert.ok(nodes.find((n) => n.id === 'b.bloom'), 'and a bloom past it');
});

// ---- what the shared draw layer and review changes may reach ----

// The glow and radial drawing (engine/page/draw.mjs) and the light grounds of the contrast review read only
// props.glow and props.radial: no desk or pop node carries either, so neither change can reach those looks' pixels or
// findings (their scene graphs are compared before and after in .scratch/cosmos3).
test('no desk or pop node carries props.glow or props.radial, in any kind\'s example at either format', () => {
  const carriers = [];
  for (const lookName of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16']) {
      for (const kind of registries.kinds.names()) {
        const example = registries.kinds.get(kind).example;
        if (!example) continue;
        // pictures by the helpers' stand-in (a 1600 x 1000 shot.png)
        const shot = JSON.parse(JSON.stringify({ id: 'x', ...example }).replace(/"src":"[^"]*"/g, '"src":"shot.png"'));
        const film = filmOf([shot], lookName, format);
        const { nodes } = expandIn(film, 0, { prepared: prepareFilm(film, { filmDir: '.' }).prepared }); // a map needs its prepared data
        carriers.push(...all(nodes).filter((n) => n.props.glow !== undefined || n.props.radial !== undefined).map((n) => `${lookName} ${format} ${kind}: ${n.id}`));
      }
    }
  }
  assert.deepEqual(carriers, []);
});

// ---- one Earth ----

test('earth: a small blue dot with a ring round it, the same at any place', () => {
  const a = earthNodes('e', look, { cx: 100, cy: 200, unit: 1 });
  const b = earthNodes('f', look, { cx: 900, cy: 50, unit: 1 });
  const parts = (nodes) => nodes[0].children.map((n) => ({ d: n.props.d, fill: n.props.fill, stroke: n.props.stroke }));
  assert.deepEqual(parts(a), parts(b), 'one drawing');
  const dot = a[0].children.find((n) => n.id === 'e.dot'), ring = a[0].children.find((n) => n.id === 'e.ring');
  assert.equal(dot.props.fill, look.palette.shape2, 'blue: the pale blue dot');
  assert.ok(ring.props.stroke && !ring.props.fill, 'a ring');
  assert.deepEqual([a[0].props.x, a[0].props.y], [100, 200]);
});

// ---- the contrast check sees light as ground (code review: the sun, its bloom and glows) ----

const CANVAS = { w: 1920, h: 1080 };
const reviewCtx = () => {
  const base = { look, canvas: CANVAS, mode: 'pro', shotId: 'x', shotIndex: 0, t: 0.5 };
  return { safe: safeRectFor(CANVAS, look), ...base };
};
const at = (box) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0 });
const fieldNode = () => ({ ...at([-60, -60, 2040, 1200]), type: 'field', id: 'field', depth: 1, props: { field: 'cosmos', palette: look.palette } });
const sunAt = (cx, cy, r) => ({ ...at([cx - r, cy - r, 2 * r, 2 * r]), type: 'path', id: 'sun', props: { d: 'M0 0Z', radial: sunNodes('s', look, { cx, cy, r })[0].props.radial } });
const glowPath = (box, glow, extra = {}) => ({ ...at(box), type: 'path', id: 'glow', props: { d: 'M0 0Z', fill: '#2e2770', glow, ...extra } });
function inkText({ fill = look.palette.ink, box = [200, 400, 384, 110], glow, share = 0 } = {}) {
  const size = 96, width = box[2];
  const line = { x: 0, y: size * 0.9, width, words: [{ text: 'word', index: 0, x: 0, width: width / 2 }, { text: 'word', index: 1, x: width / 2, width: width / 2 }] };
  return {
    ...at(box), type: 'text', id: 't', props: { fill, ...(glow ? { glow } : {}) },
    words: [0, 1].map(() => ({ opacity: 1, x: 0, y: 0, scale: 1, glow: share })), layout: { size, width, height: box[3], overflow: false, lines: [line] },
  };
}
const contrastOf = (tree) => auditFrame(tree, reviewCtx()).filter((f) => f.rule === 'contrast');

test('contrast: ink over the sun\'s core is judged against the core (its brightest pixel), not the field', () => {
  const found = contrastOf([fieldNode(), sunAt(300, 450, 240), inkText()]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, new RegExp(look.sun.core));
});

test('contrast: the same ink clear of the sun\'s light is judged against the field as before', () => {
  assert.deepEqual(contrastOf([fieldNode(), sunAt(300, 450, 240), inkText({ box: [1200, 400, 384, 110] })]), []);
});

test('contrast: lavender inside a strong glow\'s reach is judged against the glow over the field', () => {
  const glow = { color: '#ffd166', alpha: 0.95, radius: 60, only: true };
  const text = inkText({ fill: look.palette.ink2, box: [400, 420, 384, 110] });
  assert.deepEqual(contrastOf([fieldNode(), text]), [], 'on the field alone it reads');
  assert.equal(contrastOf([fieldNode(), glowPath([380, 400, 440, 160], glow), text]).length, 1, 'inside the glow it does not');
  assert.deepEqual(contrastOf([fieldNode(), glowPath([380, 1000, 440, 40], glow), text]), [], 'a glow out of reach is not under it');
});

test('contrast: a text\'s own glyph glow counts once it is lit', () => {
  const glow = { color: look.palette.accent, alpha: 1, radius: 30 };
  assert.deepEqual(contrastOf([fieldNode(), inkText({ fill: look.palette.accent, glow, share: 0 })]), [], 'unlit: the field');
  assert.equal(contrastOf([fieldNode(), inkText({ fill: look.palette.accent, glow, share: 1 })]).length, 1, 'lit to full gold: gold on gold');
});

// ---- the end wordmark is judged by the hero rule ----

const wideFilm = (shot) => expandIn(filmOf([shot], 'cosmos', '16:9', { mode: 'pro' }));
const tallFilm = (shot) => expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
const byId = (nodes, id) => all(nodes).find((n) => n.id === id);

test('end: the wordmark is not frame furniture, and the title is at least three times it (with or without the ask)', () => {
  for (const expand of [wideFilm, tallFilm]) {
    for (const shot of [
      { id: 'e', show: 'end', say: 'Scale changes everything.', ask: 'Look up tonight.', mark: 'cosmos' },
      { id: 'e', show: 'end', say: 'Light is old.', mark: 'cosmos' },
    ]) {
      const out = expand(shot);
      const mark = byId(out.nodes, 'e.mark.text');
      const title = all(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
      if (mark === undefined) {
        // a title too long to set at the hero floor drops the mark (and the ask) and says so: a review finding
        assert.ok(title.props.dropped.includes('mark'), 'said so');
        continue;
      }
      assert.notEqual(mark.props.furniture, true, 'judged with the other texts');
      assert.ok(title.props.font.size >= 3 * mark.props.font.size, `${title.props.font.size} vs ${mark.props.font.size}`);
    }
  }
});

// ---- the number: a line from the Sun to Earth, never an orbit with the Sun on its rim ----

const DISTANCE = { id: 'n', show: 'number', say: 'One hundred fifty million kilometres.', value: 150, suffix: 'million km', label: 'from the Sun to Earth' };
const MINUTES = { id: 'n', show: 'number', say: 'Eight minutes. That is how long sunlight takes to reach you.', value: 8, suffix: 'min', label: 'from the Sun to you' };
const segmentsOf = (nodes) => all(nodes).filter((n) => /^n\.line\d$/.test(n.id));
const ends = (seg) => { const v = seg.props.d.match(/-?[\d.]+/g).map(Number); return [[v[0], v[1]], [v[2], v[3]]]; };

test('number: no orbit; a straight line runs from the sun\'s disc to the Earth mark, in the lavender (gold is only light)', () => {
  for (const [expand, shot] of [[wideFilm, DISTANCE], [tallFilm, MINUTES]]) {
    const out = expand(shot);
    assert.equal(all(out.nodes).some((n) => /orbit/.test(n.id)), false, 'no orbit');
    const sun = sunAnchor(look, out.ctx);
    const earth = byId(out.nodes, 'n.earth');
    assert.ok(earth, 'the Earth mark at the far end');
    const segs = segmentsOf(out.nodes);
    assert.ok(segs.length >= 1);
    for (const s of segs) assert.equal(s.props.stroke, look.palette.ink2, 'a lavender line');
    const pts = segs.flatMap(ends);
    const along = isWideOut(out) ? (p) => p[0] : (p) => p[1];
    const across = isWideOut(out) ? (p) => p[1] : (p) => p[0];
    const [start, stop] = [Math.min(...pts.map(along)), Math.max(...pts.map(along))];
    const earthAt = isWideOut(out) ? earth.props.x : earth.props.y;
    const sunAt = isWideOut(out) ? sun.cx : sun.cy;
    assert.ok(start > sunAt + look.sun.disc * sun.r - 1 && stop < earthAt, 'from the disc to Earth');
    assert.ok(pts.every((p) => Math.abs(across(p) - (isWideOut(out) ? sun.cy : sun.cx)) < 1e-6), 'straight, on the sun\'s axis');
    assert.ok(Math.abs((isWideOut(out) ? earth.props.y : earth.props.x) - (isWideOut(out) ? sun.cy : sun.cx)) < 1e-6, 'Earth on the same axis');
  }
});
const isWideOut = (out) => out.canvas.w > out.canvas.h;

test('number: the figure and its label never cross the line (above and below it on a wide frame, in a gap of it on a tall one)', () => {
  for (const [expand, shot] of [[wideFilm, DISTANCE], [tallFilm, MINUTES]]) {
    const out = expand(shot);
    const boxes = [out.boxes.value, out.boxes.label];
    for (const s of segmentsOf(out.nodes)) {
      const [[x0, y0], [x1, y1]] = ends(s);
      const seg = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
      for (const b of boxes) assert.ok(!(seg[0] < b[0] + b[2] && b[0] < seg[0] + seg[2] && seg[1] <= b[1] + b[3] && b[1] <= seg[1] + seg[3]), `${s.id} crosses ${JSON.stringify(b)}`);
    }
    if (isWideOut(out)) {
      const y = sunAnchor(look, out.ctx).cy;
      assert.ok(out.boxes.value[1] + out.boxes.value[3] < y && out.boxes.label[1] > y, 'figure over the line, label under it');
    }
  }
});

test('number: light travels the line from the sun to Earth as the figure counts, drawn as the sun is', () => {
  for (const [expand, shot] of [[wideFilm, DISTANCE], [tallFilm, MINUTES]]) {
    const out = expand(shot);
    const light = byId(out.nodes, 'n.light');
    assert.ok(light, 'a light');
    const disc = light.children.find((c) => c.props.radial);
    assert.equal(disc.props.radial.stops[0][2], look.sun.core, 'the one light');
    const key = isWideOut(out) ? 'x' : 'y';
    const pos = light.tracks[key].points;
    assert.ok(pos.at(-1).v > pos[0].v, 'toward Earth');
    assert.ok(byId(out.nodes, 'n.earth')[isWideOut(out) ? 'props' : 'props'][key] > pos.at(-1).v - 1, 'it reaches Earth');
  }
});

test('number: everything inside the title-safe band (a tenth in from each edge on 16:9)', () => {
  const out = wideFilm(DISTANCE);
  for (const b of [out.boxes.value, out.boxes.label]) assert.ok(b[1] >= 0.1 * out.canvas.h && b[1] + b[3] <= 0.9 * out.canvas.h, JSON.stringify(b));
});

// ---- the statement keeps the sun's column (16:9) and its axis (9:16) ----

const LIGHT = { id: 's', show: 'statement', say: 'The sunlight on your face is *eight minutes* old.' };
const HOOK = { id: 's', show: 'statement', say: 'The sunlight on your face is *eight minutes* old.' };
const lineCentres = (n) => n.props.layout.lines.map((l) => n.props.x + l.x + l.width / 2);

test('statement at 16:9: the sun has a column of its own: the text starts clear of its light, the light inside the frame', () => {
  const out = wideFilm(LIGHT);
  const sun = sunAnchor(look, out.ctx);
  const text = byId(out.nodes, 's.text') ?? all(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.ok(textLeft(text) >= sun.cx + look.sun.clear * sun.r - 1, `${textLeft(text)} vs ${sun.cx + look.sun.clear * sun.r}`);
  assert.ok(sun.cx - sun.r >= -1, 'no glow cut by the frame edge');
});

test('statement at 9:16: centred on the sun\'s axis, under its disc', () => {
  const out = tallFilm(HOOK);
  const sun = sunAnchor(look, out.ctx);
  const text = all(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  for (const c of lineCentres(text)) assert.ok(Math.abs(c - sun.cx) < 2, `line centred on the sun: ${c} vs ${sun.cx}`);
  // under the disc and its bright bloom (look.sun.clear of the light's radius)
  const below = sun.cy + look.sun.clear * sun.r;
  assert.ok(out.boxes.text[1] >= below - 1, `under the light: ${out.boxes.text[1]} vs ${below}`);
  // a long hook fills most of the band: it still starts there
  for (const say of ['Every bit of the light that falls on your face tonight left the Sun *eight minutes* ago.', 'Light. Is. So. Very. Old. Now.']) {
    const long = tallFilm({ id: 's', show: 'statement', say });
    assert.ok(long.boxes.text[1] >= below - 1, `a tall hook under the light: ${long.boxes.text[1]}`);
  }
});

// ---- the list: the sun is its own node, not Mercury's bullet ----

const PATH = { id: 'p', show: 'list', say: 'It passes Mercury. Then Venus. Then it reaches Earth.', items: ['Mercury', 'Venus', 'Earth'] };
const centreOf = (n) => ({ x: n.props.x, y: n.props.y });

test('list: the sun stands on its own above the first item, the first item keeps an ordinary dot, and a lit rail joins them', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(PATH);
    const sun = byId(out.nodes, 'p.sun');
    const first = byId(out.nodes, 'p.dot0');
    const firstText = byId(out.nodes, 'p.item0');
    const discR = look.sun.disc * sun.props.radial.r;
    const dot = numbersOf(first.props.d);
    const dotTop = Math.min(...dot.filter((_, i) => i % 2 === 1));
    assert.ok(sun.props.y + discR < dotTop, `the sun's disc above the first dot: ${sun.props.y + discR} vs ${dotTop}`);
    assert.ok(sun.props.y + discR < firstText.props.y + firstText.props.layout.lines[0].y - 0.72 * firstText.props.font.size, 'and above the first item');
    assert.equal(first.props.fill, look.palette.ink2, 'Mercury has an ordinary bullet');
    assert.ok(byId(out.nodes, 'p.path.sun'), 'the light runs from the sun to the first item');
  }
});

test('list: the current item\'s halo is a soft gold light (a radial falling to nothing), never a flat screened disc', () => {
  const out = wideFilm(PATH);
  const halos = all(out.nodes).filter((n) => /^p\.halo\d$/.test(n.id));
  assert.equal(halos.length, 3);
  for (const h of halos) {
    assert.ok(h.props.radial, 'a radial light');
    assert.equal(h.props.blend, undefined, 'not a screened flat disc');
    assert.equal(h.props.radial.stops.at(-1)[1], 0, 'falling to nothing');
  }
});
const numbersOf = (d) => d.match(/-?[\d.]+/g).map(Number);

// ---- the quote: plain type on the sky, lavender marks, the pale blue dot ----

const HOME = { id: 'home', show: 'quote', say: 'That\'s here. That\'s home. That\'s us.', by: 'Carl Sagan', role: 'Pale Blue Dot, 1994' };

test('quote: no card (plain type on the field), the marks in the lavender, the opening mark on screen from frame 0', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(HOME);
    assert.equal(all(out.nodes).some((n) => /\.(paper|sheen|edge|shadow|ground)$/.test(n.id)), false, 'no card parts');
    const [open, close] = [byId(out.nodes, 'home.mark'), byId(out.nodes, 'home.close')];
    assert.equal(open.props.fill, look.palette.ink2, 'gold is only for light');
    assert.equal(close.props.fill, look.palette.ink2);
    assert.equal(sample(open.tracks.opacity ?? { points: [{ t: 0, v: 1 }] }, 0), 1, 'the frame never opens on the field alone');
  }
});

test('quote: the pale blue dot (the Earth mark) arrives with the attribution, hung before it on its cap middle', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(HOME);
    // on 9:16 this quotation keeps its hero size by dropping the attribution (said so: a review finding), and the dot with it
    if (out.boxes.by === undefined) continue;
    const earth = byId(out.nodes, 'home.earth');
    assert.ok(earth, 'the Earth mark');
    const [bx, by, , bh] = out.boxes.by;
    const at = worldPoint(out.nodes, 'home.earth');
    assert.ok(at.x < bx, 'before the attribution');
    assert.ok(Math.abs(at.y - (by + bh / 2)) < bh / 2, 'on its cap middle');
  }
});
// A node's origin in the frame through its groups' translations (the quote's groups carry no scale or turn at rest).
function worldPoint(nodes, id, base = { x: 0, y: 0 }) {
  for (const n of nodes) {
    const here = { x: base.x + (n.props.x ?? 0), y: base.y + (n.props.y ?? 0) };
    if (n.id === id) return here;
    const found = worldPoint(n.children ?? [], id, here);
    if (found) return found;
  }
  return null;
}

// ---- the chart: the data owns the frame; gold only as light ----

const GIANTS = {
  id: 'g', show: 'chart', type: 'bar', title: 'Jupiter is widest', say: 'Neptune is four Earths wide. Saturn, nine. Jupiter beats them all.',
  data: [{ label: 'Earth', value: 12742 }, { label: 'Neptune', value: 49244 }, { label: 'Saturn', value: 116460 }, { label: 'Jupiter', value: 139820 }],
  highlight: 'Jupiter', unit: 'km', source: 'NASA planetary fact sheet',
};
const ysOf = (n) => numbersOf(n.props.d).filter((_, i) => i % 2 === 1).map((y) => y + (n.props.y ?? 0));
const capTopOf = (n) => n.props.y + n.props.layout.lines[0].y - 0.72 * n.props.font.size;
const baseOf = (n) => n.props.y + n.props.layout.lines.at(-1).y;

test('chart: the highlighted bar is not gold: it lights in ink, with gold only in its glow (light)', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(GIANTS);
    assert.equal(byId(out.nodes, 'g.mark.3.accent').props.fill, look.palette.ink, 'the lit bar in ink');
    assert.equal(byId(out.nodes, 'g.mark.3.glow').props.glow.color, look.palette.accent, 'its light gold');
    const gold = all(out.nodes).filter((n) => n.props.fill === look.palette.accent && !n.props.glow);
    assert.deepEqual(gold.map((n) => n.id), [], 'no other gold fill');
  }
});

test('chart at 16:9: the headline is smaller than the chart, and the labels read on a phone (1.5 times the secondary floor)', () => {
  const out = wideFilm(GIANTS);
  const title = byId(out.nodes, 'g.title');
  const titleH = baseOf(title) - capTopOf(title);
  assert.ok(titleH < 0.5 * out.boxes.chart[3], `title ${titleH} vs chart ${out.boxes.chart[3]}`);
  assert.equal(title.props.layout.lines.length, 1, 'one line');
  const labelSize = byId(out.nodes, 'g.label.0').props.font.size;
  assert.ok(labelSize >= 1.5 * look.secondary.min * out.ctx.unit - 1e-9, `labels at ${labelSize}`);
  assert.ok(byId(out.nodes, 'g.source').props.font.size < labelSize, 'the source quieter than the labels');
});

test('chart at 9:16: each label sits with its own bar (twice the room above it as under it), values after their labels, the headline on the chart\'s left edge', () => {
  const out = tallFilm(GIANTS);
  const marks = [0, 1, 2, 3].map((k) => byId(out.nodes, `g.mark.${k}`));
  const labels = [0, 1, 2, 3].map((k) => byId(out.nodes, `g.label.${k}`));
  for (let k = 1; k < 4; k++) {
    const above = capTopOf(labels[k]) - Math.max(...ysOf(marks[k - 1]));
    const below = Math.min(...ysOf(marks[k])) - baseOf(labels[k]);
    assert.ok(above >= 1.8 * below, `label ${k}: ${above} above, ${below} under`);
  }
  const values = [0, 1, 2, 3].map((k) => byId(out.nodes, `g.value.${k}`));
  const gaps = values.map((v, k) => v.props.x - (labels[k].props.x + labels[k].props.layout.width));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1 && gaps[0] > 0, `one rule: every value after its label (${gaps})`);
  // the headline's ink on the chart's left edge (its first glyph's ink, which may start off its advance)
  const title = byId(out.nodes, 'g.title');
  const firstLine = title.props.layout.lines[0].words.map((w) => w.text).join(' ');
  const inkLeft = measure(firstLine, title.props.font).inkLeft;
  assert.ok(Math.abs(title.props.x + inkLeft - labels[0].props.x) < 1, 'the headline on the chart\'s left edge');
});

// ---- the to-scale compare: Earth first, then the Sun grows in; one axis; inside title-safe ----

const SIZES = {
  id: 'z', show: 'compare', say: 'Earth is small. The Sun is one hundred nine Earths wide.', ratioLabel: '× wider',
  left: { title: 'Earth', value: '12,742', points: ['kilometres across'] }, right: { title: 'The Sun', value: '1,392,700', points: ['kilometres across'] },
};
const textsOf = (nodes) => all(nodes).filter((n) => n.type === 'text');
const opacityOf = (n, t) => (n.tracks?.opacity ? sample(n.tracks.opacity, t) : 1);
const wordsText = (n) => n.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' ');

test('sizes: the headline names its subject ("The Sun is 109× wider")', () => {
  for (const expand of [wideFilm, tallFilm]) assert.equal(wordsText(byId(expand(SIZES).nodes, 'z.ratio')), 'The Sun is 109× wider');
});

test('sizes: a reveal: Earth on the first frame, the Sun off the frame until it is spoken, then grown in from the edge with its group', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(SIZES);
    const wide = isWideOut(out);
    const rise = byId(out.nodes, 'z.right.rise');
    const key = wide ? 'x' : 'y';
    const body = byId(out.nodes, 'z.right.sun');
    const nearEdge = (t) => (wide ? body.props.x : body.props.y) - body.props.radial.r + sample(rise.tracks[key], t);
    const bloom = byId(out.nodes, 'z.right.sun.bloom');
    assert.ok(nearEdge(0) - (bloom.props.radial.r - body.props.radial.r) >= (wide ? out.canvas.w : out.canvas.h), 'off the frame on the first frame, its bloom too');
    const end = out.timing.duration;
    assert.ok(nearEdge(end) < (wide ? out.canvas.w : out.canvas.h) * 0.8, 'grown in by the end');
    const turnStart = rise.tracks[key].points.find((p, i, ps) => i > 0 && p.v !== ps[0].v)?.t ?? 0;
    assert.ok(turnStart > 0.3, `it starts moving when the Sun is spoken, not on frame 0 (${turnStart})`);
    for (const id of ['z.left.title', 'z.left.value']) assert.equal(opacityOf(byId(out.nodes, id), 0), 1, `${id} on the first frame`);
    assert.equal(opacityOf(byId(out.nodes, 'z.right.value'), 0), 0, 'the Sun\'s number waits for the Sun');
    assert.equal(opacityOf(byId(out.nodes, 'z.right.value'), end), 1);
  }
});

test('sizes: the frame keeps its hero before the Sun arrives (the headline set from frame 0, unspoken words ghosted)', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(SIZES);
    const head = byId(out.nodes, 'z.ratio');
    assert.equal(opacityOf(head, 0), 1);
    assert.ok(head.wordTracks.every((w) => sample(w.ghost, 0) === 1), 'ghosted on frame 0, so no contrast is asked of it yet');
    assert.ok(head.wordTracks.every((w) => sample(w.ghost, out.timing.duration) === 0), 'lit by the end');
  }
});

test('sizes: one alignment axis for the texts (a left edge on 16:9, a centre on 9:16), all inside title-safe, clear of the Sun\'s bloom', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(SIZES);
    const wide = isWideOut(out);
    const texts = textsOf(out.nodes);
    const axis = texts.map((n) => (wide ? textLeft(n) : textCentre(n)));
    assert.ok(Math.max(...axis) - Math.min(...axis) < 1.5, `one axis: ${axis.map(Math.round)}`);
    const body = byId(out.nodes, 'z.right.sun');
    const reach = body.props.radial.r * (1 + look.sun.body.bloom);
    for (const n of texts) {
      const size = n.props.font.size, l = n.props.layout;
      const box = [n.props.x + Math.min(...l.lines.map((x) => x.x)), n.props.y + l.lines[0].y - 0.72 * size, l.width, l.lines.at(-1).y - l.lines[0].y + 0.92 * size];
      assert.ok(box[1] >= (wide ? 0.1 : 0.15) * out.canvas.h && box[1] + box[3] <= (wide ? 0.9 : 0.75) * out.canvas.h, `${n.id} inside title-safe: ${box.map(Math.round)}`);
      const nx = Math.max(box[0], Math.min(body.props.x, box[0] + box[2])), ny = Math.max(box[1], Math.min(body.props.y, box[1] + box[3]));
      assert.ok(Math.hypot(nx - body.props.x, ny - body.props.y) >= reach, `${n.id} clear of the bloom`);
    }
  }
});

test('sizes: Earth is the one Earth mark, the small blue dot with its ring', () => {
  for (const expand of [wideFilm, tallFilm]) {
    const out = expand(SIZES);
    const dot = byId(out.nodes, 'z.left.earth.dot');
    assert.ok(dot, 'the Earth mark');
    assert.equal(dot.props.fill, look.palette.shape2);
  }
});

// ---- the end card on its sun's axis ----

const textLeft = (n) => n.props.x + Math.min(...n.props.layout.lines.map((l) => l.x));
const textCentre = (n) => n.props.x + n.props.layout.lines[0].x + n.props.layout.lines[0].width / 2;
const CLOSE = { id: 'e', show: 'end', say: 'Scale changes everything.', ask: 'Look up tonight.', mark: 'cosmos' };

test('end at 16:9: left-aligned beside its sun, as the opening statement is: one left edge, clear of the sun\'s light', () => {
  const out = wideFilm(CLOSE);
  const sun = sunAnchor(look, out.ctx);
  const texts = ['e.title', 'e.ask', 'e.mark.text'].map((id) => byId(out.nodes, id) ?? all(out.nodes).find((n) => n.props.role === 'hero'));
  const lefts = texts.map(textLeft);
  assert.ok(Math.max(...lefts) - Math.min(...lefts) < 1, `one axis: ${lefts}`);
  assert.ok(Math.min(...lefts) >= sun.cx + look.sun.clear * sun.r - 1, 'the text starts clear of the sun\'s light');
  assert.ok(sun.cx - look.sun.disc * sun.r >= 0 && sun.cx - sun.r >= -1, 'the sun\'s light is not cut by the frame edge');
});

test('end at 9:16: centred under its sun, the block below the disc', () => {
  const out = tallFilm({ ...CLOSE, say: 'Light is old.', ask: 'Eight minutes old.' });
  const sun = sunAnchor(look, out.ctx);
  const title = all(out.nodes).find((n) => n.props.role === 'hero' && n.type === 'text');
  for (const n of [title, byId(out.nodes, 'e.ask'), byId(out.nodes, 'e.mark.text')]) assert.ok(Math.abs(textCentre(n) - sun.cx) < 2, `${n.id} centred on the sun`);
  // a tall block (a four-line close) would centre up into the sun: it starts under the disc instead
  for (const say of ['Light is old.', 'Every bit of light you see tonight left long ago.']) {
    const shot = tallFilm({ ...CLOSE, say, ask: 'Eight minutes old.' });
    assert.ok(shot.boxes.title[1] >= sun.cy + look.sun.disc * sun.r, `${say}: under the disc`);
  }
});

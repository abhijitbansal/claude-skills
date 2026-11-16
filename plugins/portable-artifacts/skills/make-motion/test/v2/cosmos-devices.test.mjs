// The cosmos look's device styles (plan 2026-11-16-pa2-look-cosmos, Task 2), each chosen by look data, never by the
// look's name: a rounded card (faint inner sheen, a 1-unit lighter edge, no tilt, no tape), a pill tag, a glow-pill
// highlight, smooth round-capped circle, underline and arrow, the field-coloured scrim, and the pill caption style.
// Pure scene-graph builders: everything runs in Node with a fake text measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/fields/index.mjs';
import { scrimColour, roundedRect, SOFT_RINGS } from '../../engine/devices/shared.mjs';
import { GLOW_REACH_SHARE } from '../../engine/devices/highlight.mjs';
import { pill } from '../../engine/captions/pill.mjs';
import { mix } from '../../engine/fields/color.mjs';
import { sample } from '../../engine/time/track.mjs';
import { contrastRatio as contrast } from '../../shared/contrast.mjs';
import { SAFE_MARGIN_PX } from '../../template/formats.mjs';
import { measure, canvasOf } from './helpers/kinds.mjs';

const cosmos = registries.looks.get('cosmos');
const desk = registries.looks.get('desk');
const pop = registries.looks.get('pop');
const BOX = [300, 200, 600, 120];
const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
const part = (nodes, suffix) => all(nodes).find((n) => n.id === `d.${suffix}`);
const build = (name, look, over = {}) => registries.devices.get(name).build({ id: 'd', box: BOX, at: 1, look, unit: 1, seed: 1, ...over });
const pairs = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i], n[2 * i + 1]]);
};
const bboxOf = (d) => {
  const p = pairs(d), xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const subpaths = (d) => (d.match(/M/g) ?? []).length;
// A soft-edged group (devices/shared.mjs softRoundedRect): its rings, outermost first; the alpha where all overlap; how
// far the outermost reaches past the innermost.
const ringsOf = (group) => group.children;
const stacked = (group) => 1 - ringsOf(group).reduce((left, ring) => left * (1 - ring.props.opacity), 1);
// Canvas compositing in sRGB, per channel in 0..1: source-over is b + a (s - b); screen is b + a s (1 - b).
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (cs) => `#${cs.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const composite = (backdrop, source, alpha, blend) => {
  const b = channels(backdrop), s = channels(source);
  return toHex(b.map((bc, i) => (blend === 'screen' ? bc + alpha * s[i] * (1 - bc) : bc + alpha * (s[i] - bc))));
};
// Every ring of a soft group drawn over `backdrop` where they all overlap (the brightest point of the glow).
const throughRings = (backdrop, group) => ringsOf(group).reduce((b, ring) => composite(b, ring.props.fill, ring.props.opacity, group.props.blend), backdrop);
const outer = (group) => bboxOf(ringsOf(group)[0].props.d);
const inner = (group) => bboxOf(ringsOf(group).at(-1).props.d);
const reachOf = (group) => inner(group)[1] - outer(group)[1];
// The field's lightest point under text (engine/fields/cosmos.mjs plan.peak) for the look's palette.
const fieldPeak = registries.fields.get('cosmos').plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette: cosmos.palette, params: {} }).peak;
// Nunito 800 ink, measured in Chromium 156 (.scratch/cosmos/metrics.mjs): ascenders and figures 0.716 em, descenders 0.191 em.
const NUNITO = Object.freeze({ up: 0.716, down: 0.191 });
const HIGHLIGHT_PAST_INK = 0.06; // em: engine/kinds/shared.mjs bandBox, how far the band box reaches past the run's ink
const BAND_HEIGHT = 1.18; // engine/devices/highlight.mjs: the band is this much taller than its box

// ---- every style is chosen by look data ----

test('cosmos styles the card, tag, highlight, circle, underline and arrow, and names a field-coloured scrim', () => {
  for (const name of ['card', 'tag', 'highlight', 'circle', 'underline', 'arrow']) {
    assert.equal(registries.devices.get(name).supports(cosmos), true, name);
  }
  assert.deepEqual({ ...cosmos.devices.card, ground: { ...cosmos.devices.card.ground } }, { edge: 'rounded', radius: 28, fill: '#2e2770', ground: { color: 'ink2', alpha: 0.3, blur: 64, dy: 28 } });
  assert.equal(cosmos.devices.tag.shape, 'pill');
  assert.equal(cosmos.devices.highlight.shape, 'pill');
  for (const mark of ['circle', 'underline', 'arrow']) assert.equal(cosmos.devices[mark].cap, 'round', mark);
  assert.equal(cosmos.devices.focus.scrim, 'deep');
});

test('scrimColour: the colour a look names for its scrims, its paper when it names none (desk, pop)', () => {
  assert.equal(scrimColour(cosmos), cosmos.palette.deep);
  assert.equal(scrimColour(desk), desk.palette.paper);
  assert.equal(scrimColour(pop), pop.palette.paper);
});

// ---- card ----

test('rounded card: an exact rounded rectangle of the look radius, square (no tilt), no tape, the paper id kept', () => {
  const { nodes: [group] } = build('card', cosmos);
  assert.equal(group.props.rotate, undefined, 'no tilt');
  assert.equal(all([group]).some((n) => n.props.tape === true), false, 'no tape');
  const paper = part([group], 'paper');
  assert.equal(paper.props.d, roundedRect(-300, -60, 600, 120, 28));
  assert.equal(paper.props.fill, '#2e2770');
  assert.equal(part([group], 'shadow').props.d, paper.props.d);
});

test('rounded card: a faint lighter soft sheen whose edge stays inside the card, and a 1-unit lighter edge stroke', () => {
  const unit = 2;
  const { nodes: [group] } = build('card', cosmos, { unit, box: [100, 100, 800, 300] });
  const [px, py, pw, ph] = bboxOf(part([group], 'paper').props.d);
  const sheen = part([group], 'sheen');
  assert.equal(sheen.type, 'group');
  assert.equal(ringsOf(sheen).length, SOFT_RINGS);
  assert.ok(stacked(sheen) > 0 && stacked(sheen) <= 0.6, `soft and faint: ${stacked(sheen)}`);
  assert.ok(reachOf(sheen) > 0, 'a soft edge');
  const [sx, sy, sw, sh] = outer(sheen);
  assert.ok(sx >= px - 1e-9 && sy >= py - 1e-9 && sx + sw <= px + pw + 1e-9 && sy + sh <= py + ph + 1e-9, 'the soft edge stays inside the card');
  const sheenFill = ringsOf(sheen)[0].props.fill;
  assert.ok(contrast(sheenFill, '#000000') > contrast('#2e2770', '#000000'), 'the sheen is lighter than the card');
  const edge = part([group], 'edge');
  assert.equal(edge.props.d, part([group], 'paper').props.d);
  assert.equal(edge.props.fill, undefined);
  assert.equal(edge.props.strokeWidth, 1 * unit);
  assert.ok(contrast(edge.props.stroke, '#000000') > contrast(sheenFill, '#000000'), 'the edge is lighter still');
  const order = group.children.map((n) => n.id);
  assert.deepEqual(order, ['d.ground', 'd.shadow', 'd.paper', 'd.sheen', 'd.edge']);
  // the ground glow: the card's outline set down, screened, with a soft ink2 light (depth from light)
  const ground = part([group], 'ground');
  assert.equal(ground.props.d, part([group], 'paper').props.d);
  assert.equal(ground.props.blend, 'screen');
  assert.equal(ground.props.glow.color, cosmos.palette.ink2);
  assert.ok(ground.props.y > 0 && ground.props.glow.alpha <= 0.3, 'set down, faint');
});

test('ink on the rounded card holds 4.5:1 against the card at its sheen', () => {
  const { nodes: [group] } = build('card', cosmos);
  const sheen = part([group], 'sheen');
  const brightest = mix('#2e2770', ringsOf(sheen)[0].props.fill, stacked(sheen));
  for (const key of ['ink', 'ink2']) assert.ok(contrast(cosmos.palette[key], brightest) >= 4.5, `${key}: ${contrast(cosmos.palette[key], brightest).toFixed(2)}`);
});

test('no cosmos device asks the draw layer for a blur filter (about 7 ms a frame each); only the look\'s card shadow blurs', () => {
  const nodes = ['card', 'tag', 'highlight', 'circle', 'underline'].flatMap((name) => build(name, cosmos, name === 'tag' ? { text: 'x', measure } : {}).nodes);
  const blurred = all(nodes).filter((n) => n.props.blur !== undefined).map((n) => n.id);
  assert.deepEqual(blurred, ['d.shadow']);
});

// ---- tag ----

test('pill tag: the plate is a rounded rectangle whose radius is half its height', () => {
  const { nodes: [group], boxes } = build('tag', cosmos, { text: 'Light years', measure });
  const [, , w, h] = boxes.tag;
  assert.equal(part([group], 'plate').props.d, roundedRect(-w / 2, -h / 2, w, h, h / 2));
  assert.equal(part([group], 'text').props.fill, cosmos.palette.deep);
  assert.ok(contrast(cosmos.palette.deep, cosmos.palette.accent) >= 4.5);
});

// ---- highlight ----

test('glow-pill highlight: a deep pill band behind the phrase and a soft screened accent glow round it, both under the text', () => {
  const { nodes } = build('highlight', cosmos);
  assert.deepEqual(nodes.map((n) => n.id), ['d.glow', 'd']);
  const [glow, band] = nodes;
  const band0 = BOX[3] * BAND_HEIGHT;
  const top = BOX[1] - (band0 - BOX[3]) / 2;
  assert.equal(band.props.d, roundedRect(BOX[0], top, BOX[2], band0, band0 / 2));
  assert.equal(band.props.fill, cosmos.palette.deep);
  assert.equal(ringsOf(glow).at(-1).props.d, band.props.d, 'the glow is whole under the band');
  assert.ok(ringsOf(glow).every((ring) => ring.props.fill === cosmos.palette.accent));
  assert.equal(glow.props.blend, 'screen', 'the glow only brightens');
  assert.equal(band.props.under, true);
  assert.equal(glow.props.under, true);
  assert.equal(band.props.opacity, cosmos.devices.highlight.alpha);
  assert.ok(Math.abs(stacked(glow) - cosmos.devices.highlight.glowAlpha) < 1e-9, `glow alpha ${stacked(glow)}`);
  const PATH_PRECISION = 0.01; // px: devices write path coordinates to 0.01
  assert.ok(reachOf(glow) > 0 && reachOf(glow) <= GLOW_REACH_SHARE * band0 + PATH_PRECISION, `reach ${reachOf(glow)}`);
  assert.equal(band.props.blend, undefined, 'no multiply on a dark field');
});

test('glow-pill highlight: the band wipes in smoothly; the glow stays dark until the band is whole, then lights up', () => {
  const stops = [{ at: 0.8, x: 600 }, { at: 1.4, x: 900 }];
  const { nodes: [glow, band] } = build('highlight', cosmos, { at: 0.8, stops });
  assert.equal(band.step, undefined, 'not stepped');
  assert.equal(sample(band.tracks.reveal, 1.4), 1);
  for (const t of [0, 0.8, 1.0, 1.4]) assert.equal(sample(glow.tracks.opacity, t), 0, `dark at ${t}, while the band wipes in`);
  assert.ok(sample(glow.tracks.opacity, 1.4 + cosmos.moves.emphasize.dur / 2) > 0);
  assert.equal(sample(glow.tracks.opacity, 1.4 + cosmos.moves.emphasize.dur), 1);
});

// The band box statement/quote give the highlight for a line of Nunito 800 at `size` px (kinds/shared.mjs bandBox).
function bandBoxAt(size, baseline) {
  const top = baseline - NUNITO.up * size - HIGHLIGHT_PAST_INK * size, bottom = baseline + NUNITO.down * size + HIGHLIGHT_PAST_INK * size;
  const h = (bottom - top) / BAND_HEIGHT;
  return [100, (top + bottom) / 2 - h / 2, 900, h];
}

test('glow-pill highlight: band and glow hold the phrase ink and never reach the lines above or below, at 76, 136 and 232 units', () => {
  for (const unit of [1, 2]) {
    for (const step of [76, 136, 232]) {
      const size = step * unit, baseline = 1000 * unit, pitch = cosmos.lineHeight.display * size;
      const { nodes: [glow, band] } = build('highlight', cosmos, { unit, box: bandBoxAt(size, baseline) });
      const [, y, , h] = bboxOf(band.props.d), reach = reachOf(glow);
      assert.ok(y <= baseline - NUNITO.up * size && y + h >= baseline + NUNITO.down * size, `${step}: the band holds the ink`);
      const below = baseline + pitch - NUNITO.up * size, above = baseline - pitch + NUNITO.down * size;
      assert.ok(y + h + reach < below, `${step}@${unit}: glow ${(y + h + reach).toFixed(1)} reaches the next line at ${below.toFixed(1)}`);
      assert.ok(y - reach > above, `${step}@${unit}: glow ${(y - reach).toFixed(1)} reaches the line above at ${above.toFixed(1)}`);
      assert.ok(reach < SAFE_MARGIN_PX * unit, `${step}@${unit}: the glow reaches ${reach} px, inside the safe margin, so it stays in frame`);
    }
  }
});

test('ink on the glow-pill highlight holds 4.5:1 against its brightest pixel (band over every glow ring over the field peak)', () => {
  const { nodes: [glow, band] } = build('highlight', cosmos);
  const brightest = composite(throughRings(fieldPeak, glow), band.props.fill, band.props.opacity, band.props.blend);
  const ratio = contrast(cosmos.palette.ink, brightest);
  assert.ok(ratio >= 4.5, `ink on ${brightest}: ${ratio.toFixed(2)}`);
});

test('the screen composite the contrast tests use matches source-over at no blend and only brightens with screen', () => {
  assert.equal(composite('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(composite('#202020', '#ffd166', 0), '#202020');
  const screened = composite('#2f285c', '#ffd166', 0.6, 'screen');
  assert.ok(contrast(screened, '#000000') > contrast('#2f285c', '#000000'));
  assert.equal(composite('#ffffff', '#ffd166', 1, 'screen'), '#ffffff');
});

// ---- marks ----

test('circle, underline and arrow: smooth exact geometry in one continuous stroke with round caps, never stepped', () => {
  for (const name of ['circle', 'underline', 'arrow']) {
    const { nodes: [mark] } = build(name, cosmos, name === 'arrow' ? { from: [1400, 800] } : {});
    assert.equal(mark.props.lineCap, 'round', name);
    assert.equal(mark.step, undefined, `${name} is not stepped`);
    assert.equal(subpaths(mark.props.d), 1, `${name} is one pen stroke`);
    const draw = mark.tracks.draw;
    assert.deepEqual([draw.points[0].v, draw.points.at(-1).v], [0, 1], `${name} draws on 0 to 1`);
    assert.equal(draw.points.length, 2, `${name} draws in one continuous move`);
  }
  const { nodes: [circle] } = build('circle', cosmos);
  assert.match(circle.props.d, /^M[^L]*C/, 'the circle is an exact ellipse of cubic curves');
});

test('desk and pop marks keep their caps: round hand strokes in desk, butt ends in pop', () => {
  for (const name of ['circle', 'underline']) {
    assert.equal(build(name, desk).nodes[0].props.lineCap, 'round');
    assert.equal(build(name, pop).nodes[0].props.lineCap, 'butt');
  }
});

// ---- the pill caption style ----

function captionCtx(format) {
  const canvas = canvasOf(format);
  const unit = Math.min(canvas.w, canvas.h) / 1080;
  return {
    look: cosmos, canvas, unit, measure, fps: 30, seed: 1, captionId: 'cap', hero: null, filmStart: 0, avoid: [], marks: [], markIds: [],
    timing: { duration: 4, index: 1 }, viralInsets: null, mode: registries.modes.get('pro'),
    gridX: (column) => cosmos.grid.margin * unit + (column - 1) * ((canvas.w - 2 * cosmos.grid.margin * unit - 11 * cosmos.grid.gutter * unit) / 12 + cosmos.grid.gutter * unit),
  };
}
const WORDS = ['Every', 'star', 'you', 'can', 'see', 'is', 'a', 'sun'].map((text, i) => ({ text, start: 0.3 + i * 0.4, end: 0.6 + i * 0.4, emphasis: text === 'sun' }));

test('pill caption: a pill plate at the bottom of the grid, inside its zone, the spoken words on it', () => {
  for (const format of ['16:9', '9:16']) {
    const ctx = captionCtx(format);
    const zone = pill.zone(ctx);
    const [card] = pill.compose(WORDS, ctx);
    const plate = all([card]).find((n) => n.id === 'cap.paper');
    const [, , w, h] = bboxOf(plate.props.d);
    assert.equal(plate.props.d, roundedRect(-w / 2, -h / 2, w, h, h / 2), `${format}: the plate is a pill`);
    assert.equal(card.props.fixed, true);
    const [cx, cy] = [card.props.x, card.props.y];
    assert.ok(cx - w / 2 >= zone[0] - 1e-6 && cx + w / 2 <= zone[0] + zone[2] + 1e-6, `${format}: inside the zone across`);
    assert.ok(cy + h / 2 <= zone[1] + zone[3] + 1e-6, `${format}: inside the zone at the bottom`);
    assert.ok(zone[1] + zone[3] <= ctx.canvas.h - cosmos.grid.margin * ctx.unit + 1e-6, `${format}: on the bottom margin`);
    const texts = all([card]).filter((n) => n.type === 'text');
    assert.ok(texts.length > 0 && texts.every((t) => t.props.role === 'caption' && t.props.caption), `${format}: caption texts`);
  }
});

test('pill caption: each word turns to the accent while it is spoken and back to ink after; an emphasised word stays accent', () => {
  const ctx = captionCtx('16:9');
  const [card] = pill.compose(WORDS, ctx);
  const text = all([card]).find((n) => n.type === 'text');
  const words = text.props.layout.lines.flatMap((l) => l.words);
  const every = words.findIndex((w) => w.text === 'Every');
  const fill = text.wordTracks[every].fill;
  assert.equal(sample(fill, 0.2), cosmos.palette.ink);
  assert.equal(sample(fill, 0.45), cosmos.palette.accent);
  assert.equal(sample(fill, 0.9), cosmos.palette.ink);
  const groups = all([card]).filter((n) => n.type === 'text');
  const withSun = groups.find((t) => t.props.layout.lines.flatMap((l) => l.words).some((w) => w.text === 'sun'));
  const sun = withSun.props.layout.lines.flatMap((l) => l.words).findIndex((w) => w.text === 'sun');
  assert.equal(sample(withSun.wordTracks[sun].fill, 3.9), cosmos.palette.accent, 'the emphasised word stays in the accent');
});

test('pill caption: ink and the accent hold 4.5:1 on the plate', () => {
  const ctx = captionCtx('16:9');
  const [card] = pill.compose(WORDS, ctx);
  const plate = all([card]).find((n) => n.id === 'cap.paper');
  assert.equal(plate.props.opacity ?? 1, 1, 'an opaque plate: the review measures text against it');
  for (const key of ['ink', 'accent']) assert.ok(contrast(cosmos.palette[key], plate.props.fill) >= 4.5, key);
});

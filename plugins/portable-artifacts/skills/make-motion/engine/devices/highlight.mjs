// The `highlight` device: a marker swipe behind a phrase. One path node. It carries props.under: true as a plain
// marker; the draw layer ignores it, so THE CALLER MUST PLACE THIS NODE BEFORE THE TEXT IT SITS BEHIND in the node
// list (nodes draw in order). A look may ask for props.blend ('multiply' in desk) so the ink shows through.
// In a hand look (desk) it is an uneven band: corners jittered and each long edge a
// shallow two-segment curve; in a crisp look (pop) it is an exact rectangle. Either way it wipes in left to right
// (`reveal`): landing on `at`, or, over a run of words, following them (the optional `stops` param: [{ at, x }], the
// landing time and right edge of each word) so the band is never longer than the words on screen.
// A look whose highlight style says `shape: 'pill'` (cosmos) gets a glow pill instead: the band is a pill of the style's
// colour at its `alpha`, wiping in the same way, with a soft copy of it behind (`<id>.glow`, also under: the band in
// `glowColor` at `glowAlpha`, composited with `glowBlend` when given, its edge falling off over the style's `glow`
// units, capped at GLOW_REACH_SHARE of the band's height so it stays in the line gap a display line height leaves)
// that stays dark until the band is whole and then lights up over the look's emphasize move. Cosmos sets a deep pill
// with a screened accent glow round it: a neon pill. The
// soft edge is stacked rings (shared.mjs softRoundedRect), not a blur filter. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import {
  checkParams, isHand, styleOf, colourOf, deviceRng, spread, landing, polyline, roundedRect, softRoundedRect, at2, styledBy,
} from './shared.mjs';

export const BAND_HEIGHT = 1.18; // of the box height: the band is this much taller than the box it is given
const DEFAULT_WOBBLE = 3; // units: the corner jitter when the look gives none
const SWIPE_OVERSHOOT = 5; // units: a hand swipe runs a little past the text at each end
const EDGE_BOW = 0.6; // of the wobble: how far the middle of a long edge sits off the straight line
const MID_JITTER = 0.08; // of the width: where along the edge the two segments meet
const QUARTER = 0.25;
const THREE_QUARTERS = 0.75;
const HALF = 0.5;

const lerp = (a, b, f) => a + (b - a) * f;

// A long edge from a to b through a seeded middle point, as two quadratic segments. The control points sit a
// quarter and three quarters along, pushed off the line by the same seeded amounts.
function edge(a, b, rng, bow) {
  const mid = [lerp(a[0], b[0], HALF + spread(rng, MID_JITTER)), lerp(a[1], b[1], HALF) + spread(rng, bow)];
  const c1 = [lerp(a[0], b[0], QUARTER), lerp(a[1], b[1], QUARTER) + spread(rng, bow)];
  const c2 = [lerp(a[0], b[0], THREE_QUARTERS), lerp(a[1], b[1], THREE_QUARTERS) + spread(rng, bow)];
  return `Q${at2(c1)} ${at2(mid)}Q${at2(c2)} ${at2(b)}`;
}

function handBand([x, top, w, band], unit, wobble, rng) {
  const j = wobble * unit, overshoot = SWIPE_OVERSHOOT * unit, bow = j * EDGE_BOW;
  const corner = (cx, cy) => [cx + spread(rng, j), cy + spread(rng, j)];
  const tl = corner(x - overshoot, top), tr = corner(x + w + overshoot, top);
  const br = corner(x + w + overshoot, top + band), bl = corner(x - overshoot, top + band);
  return `M${at2(tl)}${edge(tl, tr, rng, bow)}L${at2(br)}${edge(br, bl, rng, bow)}Z`;
}

const FRAME_EPSILON = 1e-9;

// A reveal that follows the words under the band: `stops` is [{ at, x }], the time each word lands and its right edge
// in canvas pixels, in order. The band grows over word k from the moment that word starts to arrive (`move.dur` before it
// lands, but not before the word before it has landed) to its landing, holds in between, and never runs ahead of the
// last word that is on screen. `reach` is how far the band extends past each end of the box.
function revealFollowing(stops, { x, w }, reach, move, step) {
  const settled = (t) => (step === undefined ? t : Math.floor(t * step + FRAME_EPSILON) / step);
  const total = w + 2 * reach;
  const keys = [];
  let held = 0, shown = 0;
  stops.forEach((stop, k) => {
    const last = k === stops.length - 1;
    const fraction = last ? 1 : Math.min(1, Math.max(0, (reach + stop.x - x) / total));
    const start = Math.max(held, stop.at - move.dur);
    keys.push({ t: start, v: shown }, { t: Math.max(start, settled(stop.at)), v: fraction, ease: move.ease });
    held = Math.max(start, stop.at);
    shown = fraction;
  });
  return track(keys);
}

export const GLOW_REACH_SHARE = 0.08; // the glow's soft edge reaches at most this share of the band's height past it
const DEFAULT_GLOW = 24; // units of soft edge, when a pill style names none
const DEFAULT_PILL_ALPHA = 0.28;
const DEFAULT_GLOW_ALPHA = 0.25;

// The glow pill: the band as a pill wiping in like a crisp band, and its soft copy behind fading in by the time the
// band is whole (the last stop's landing, or `at`).
function pillHighlight({ id, box, at, look, unit, stops }, style) {
  const [x, y, w, h] = box;
  const band = h * BAND_HEIGHT;
  const rect = [x, y - (band - h) / 2, w, band];
  const fill = colourOf(look, style.color ?? 'accent');
  const following = Array.isArray(stops) && stops.length > 0;
  const reveal = following ? revealFollowing(stops, { x, w }, 0, look.moves.draw, undefined) : landing(at, look.moves.draw, 0, 1);
  const whole = following ? stops.at(-1).at : at;
  const reach = Math.min((style.glow ?? DEFAULT_GLOW) * unit, GLOW_REACH_SHARE * band);
  const glow = softRoundedRect({
    id: `${id}.glow`, rect, pill: true, reach, alpha: style.glowAlpha ?? DEFAULT_GLOW_ALPHA, fill: colourOf(look, style.glowColor ?? style.color ?? 'accent'),
    props: { under: true, ...(style.glowBlend === undefined ? {} : { blend: style.glowBlend }) },
    // dark until the band is whole (a glow ahead of the wipe showed its core under the words), then it lights up
    opts: { tracks: { opacity: track([{ t: 0, v: 0 }, { t: whole, v: 0 }, { t: whole + look.moves.emphasize.dur, v: 1, ease: look.moves.emphasize.ease }]) } },
  });
  const pillBand = node('path', id, { d: roundedRect(...rect, band / 2), fill, under: true, opacity: style.alpha ?? DEFAULT_PILL_ALPHA }, { tracks: { reveal } });
  return { nodes: [glow, pillBand] };
}

function buildHighlight(params) {
  const { id, box, at, look, unit, seed } = checkParams('highlight', params, ['stops']);
  const { stops } = params;
  const style = styleOf(look, 'highlight');
  if (style.shape === 'pill') return pillHighlight({ id, box, at, look, unit, stops }, style);
  const [x, y, w, h] = box;
  // style.fit: the band is the box itself, not taller (poster: a bar over a stack's cap box, whose lines are set close,
  // would reach the line above and below)
  const band = h * (style.fit === true ? 1 : BAND_HEIGHT);
  const area = [x, y - (band - h) / 2, w, band];
  const hand = isHand(look);
  const d = hand
    ? handBand(area, unit, style.wobble ?? DEFAULT_WOBBLE, deviceRng(seed, id, 'highlight'))
    : polyline([[x, area[1]], [x + w, area[1]], [x + w, area[1] + band], [x, area[1] + band]], true);
  const props = { d, fill: colourOf(look, style.color ?? 'accent'), under: true };
  if (style.blend !== undefined) props.blend = style.blend;
  const step = hand ? look.moves.draw.step : undefined;
  const reach = hand ? SWIPE_OVERSHOOT * unit : 0;
  const reveal = Array.isArray(stops) && stops.length > 0 ? revealFollowing(stops, { x, w }, reach, look.moves.draw, step) : landing(at, look.moves.draw, 0, 1, step);
  const tracks = { reveal };
  return { nodes: [node('path', id, props, { tracks, step })] };
}

export const highlight = Object.freeze({
  name: 'highlight',
  summary: 'A marker swipe that wipes in behind a phrase.',
  supports: styledBy('highlight'),
  // an emphasis device: a look that does not draw it gives its target word the look's own emphasis instead
  // (kinds/emphasis-fallback.mjs)
  emphasis: true,
  build: buildHighlight,
});

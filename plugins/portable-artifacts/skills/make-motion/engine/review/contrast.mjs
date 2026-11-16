// Contrast (design 8.5): each text on screen against what is drawn directly under it, by WCAG 2 contrast ratio.
// Under MIN_CONTRAST (3:1, the WCAG floor for large text; every text the kinds set is large at video sizes) is a
// mechanical finding naming both colours. Pure and DOM-free: it reads the colours the snapshot carries, never pixels.
//
// The ground of a text is the last thing drawn before it that lies under all of its ink: an opaque filled shape (a
// path with a #rrggbb fill, at full opacity, fully drawn, not blended: a card's paper, a tag's plate) whose box holds
// the text's ink box; else the film's field (its palette's paper, drawn under everything); else the shot's background
// (ctx.background). A picture (an image node) under the text's centre makes the ground unknown.
//
// Which words count: those on screen at opacity 1 in a text at accumulated opacity 1 (a fade blends with whatever is
// behind it). A word's colour is its sampled `fill`, else the text's. A ghost word (an unspoken word in a mode that reads
// from frame 0) is exempt while its kind marks it so: its sampled `ghost` value is above 0 (kinds/shared.mjs
// ghostTracks), never decided by its colour.
//
// Light counts as ground (gate round 3): a disc of light (a path with props.radial: a look's sun and its bloom), the
// soft light round a shape (a path with props.glow) and a text's own glyph glow (props.glow on the text, lit by its
// words' glow tracks) are composited, in draw order, over that ground, each at its brightest pixel behind the text:
// the radial's stops at the point of the text's ink nearest its centre, a glow's full strength inside its shape and
// falling off over its radius outside. Source-over, or screen and lighter where the node blends so.
//
// What escapes: a text over a picture or over a translucent or blended shape that is not light, a colour that is not
// #rrggbb, a ground that lies under only part of a text (a highlight marker behind some of its words: the text is
// judged against what lies under all of it), and texts still fading in.
import { colourChannels } from '../time/track.mjs';
import { GLOW_EDGE } from '../devices/glow.mjs';

export const MIN_CONTRAST = 3;
const DEFAULT_TEXT_FILL = '#ffffff'; // engine/page/draw.mjs draws a text without a fill in white
const CHANNEL_MAX = 255;
const LINEAR_KNEE = 0.03928;
const LINEAR_SLOPE = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA = 2.4;
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
const FLARE = 0.05;
const RATIO_DECIMALS = 2;
const HALF = 2;
const HEX_RADIX = 16;

const isBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite);

// WCAG 2 relative luminance of a #rrggbb colour.
function luminance(channels) {
  return channels.reduce((sum, c, i) => {
    const s = c / CHANNEL_MAX;
    return sum + LUMA[i] * (s <= LINEAR_KNEE ? s / LINEAR_SLOPE : ((s + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA);
  }, 0);
}

/** The WCAG 2 contrast ratio of two #rrggbb colours (1 to 21), or null when either is not #rrggbb. */
export function contrastRatio(a, b) {
  const ca = colourChannels(a), cb = colourChannels(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + FLARE) / (lo + FLARE);
}

// A light a path casts, or null: { order, blend, alpha (the node's opacity), radial: { cx, cy, r, stops, colour } } for a
// props.radial disc, { order, blend, alpha, glow: { box, radius, colour, strength, inside } } for a props.glow shape.
function lightOf(n, order, o) {
  if (n.type !== 'path' || !isBox(n.bbox) || n.bbox[2] <= 0) return null;
  const blend = n.props?.blend;
  const { radial, glow } = n.props ?? {};
  if (radial && Array.isArray(radial.stops)) {
    const [x, y, w, h] = n.bbox;
    return { order, blend, alpha: o, radial: { cx: x + w / HALF, cy: y + h / HALF, r: w / HALF, stops: radial.stops, colour: radial.color } };
  }
  if (glow && colourChannels(glow.color)) {
    // inside the shape: its own fill where it draws one (screened or not), else the glow's full strength
    const inside = !glow.only && colourChannels(n.props.fill) ? n.props.fill : null;
    return { order, blend, alpha: o, glow: { box: n.bbox, radius: glow.radius ?? 0, colour: glow.color, strength: GLOW_EDGE * (glow.alpha ?? 0), inside } };
  }
  return null;
}

// What could lie under a text, in draw order: { order, colour (null: unknown, a picture), box (null: the whole frame) },
// the lights drawn (lightOf), and where each text is drawn (id -> order).
function groundsOf(sampled) {
  const grounds = [], lights = [], textOrder = new Map();
  let order = 0;
  const walk = (n, opacity) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0) return;
    order += 1;
    const opaque = o >= 1 && (n.draw ?? 1) >= 1 && (n.reveal ?? 1) >= 1 && n.props?.blend === undefined;
    const light = lightOf(n, order, o);
    if (light) lights.push(light);
    if (n.type === 'field' && opaque && colourChannels(n.props?.palette?.paper)) grounds.push({ order, colour: n.props.palette.paper, box: null });
    if (n.type === 'path' && opaque && !light && colourChannels(n.props?.fill) && isBox(n.bbox)) grounds.push({ order, colour: n.props.fill, box: n.bbox });
    if (n.type === 'image' && isBox(n.bbox)) grounds.push({ order, colour: null, box: n.bbox, picture: true });
    if (n.type === 'text') textOrder.set(n.id, order);
    (n.children ?? []).forEach((child) => walk(child, o));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1));
  return { grounds, lights, textOrder };
}

const holds = (box, [x, y, w, h]) => box[0] <= x && box[1] <= y && box[0] + box[2] >= x + w && box[1] + box[3] >= y + h;
const holdsPoint = (box, [px, py]) => px >= box[0] && py >= box[1] && px <= box[0] + box[2] && py <= box[1] + box[3];

// How far the box [x, y, w, h] is from the point (px, py): 0 when it holds it.
const distanceTo = ([x, y, w, h], px, py) => Math.hypot(Math.max(x - px, 0, px - (x + w)), Math.max(y - py, 0, py - (y + h)));
// How far apart two boxes are: 0 when they meet.
const gapBetween = (a, b) => Math.hypot(Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])), Math.max(0, a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3])));

const hexOf = (channels) => `#${channels.map((c) => Math.round(Math.min(CHANNEL_MAX, Math.max(0, c))).toString(HEX_RADIX).padStart(HALF, '0')).join('')}`;

// `colour` (#rrggbb) at `alpha` composited onto `ground` (#rrggbb) with the canvas `blend`, as #rrggbb.
function composite(ground, colour, alpha, blend) {
  const g = colourChannels(ground).map((c) => c / CHANNEL_MAX), s = colourChannels(colour).map((c) => c / CHANNEL_MAX);
  const mixed = g.map((b, i) => {
    if (blend === 'screen') return b + alpha * s[i] * (1 - b);
    if (blend === 'lighter') return b + alpha * s[i];
    return b + alpha * (s[i] - b);
  });
  return hexOf(mixed.map((c) => c * CHANNEL_MAX));
}

// A radial's colour and alpha at share `at` of its radius: its stops interpolated (a stop's colour, else the radial's).
function radialAt({ stops, colour }, at) {
  const colourOfStop = (stop) => (colourChannels(stop[2]) ? stop[2] : colour);
  const next = stops.findIndex((s) => s[0] >= at);
  if (next <= 0) return next === 0 ? { colour: colourOfStop(stops[0]), alpha: stops[0][1] } : { colour: colourOfStop(stops.at(-1)), alpha: stops.at(-1)[1] };
  const [a, b] = [stops[next - 1], stops[next]];
  const t = b[0] > a[0] ? (at - a[0]) / (b[0] - a[0]) : 1;
  const [ca, cb] = [colourChannels(colourOfStop(a)), colourChannels(colourOfStop(b))];
  return { colour: hexOf(ca.map((c, i) => c + (cb[i] - c) * t)), alpha: a[1] + (b[1] - a[1]) * t };
}

// The light's brightest colour and alpha behind the ink box, or null when its light does not reach it.
function lightBehind(light, ink) {
  if (light.radial) {
    const { cx, cy, r } = light.radial;
    const d = distanceTo(ink, cx, cy);
    if (d >= r) return null;
    return radialAt(light.radial, d / r);
  }
  const { box, radius, colour, strength, inside } = light.glow;
  const gap = gapBetween(box, ink);
  if (gap === 0) return inside ? { colour: inside, alpha: 1 } : { colour, alpha: strength };
  if (gap >= radius) return null;
  return { colour, alpha: strength * (1 - gap / radius) };
}

// The colour directly under a text's ink, null when unknown (a picture, or nothing known at all): the last ground that
// holds it, then every light drawn after that ground and before the text, at its brightest behind the ink.
function groundUnder(ink, order, { grounds, lights }, background) {
  const centre = [ink[0] + ink[2] / HALF, ink[1] + ink[3] / HALF];
  const under = grounds.filter((g) => g.order < order && (g.box === null || (g.picture ? holdsPoint(g.box, centre) : holds(g.box, ink))));
  const base = under.length > 0 ? under.at(-1) : (colourChannels(background) ? { order: 0, colour: background } : null);
  if (base === null || base.colour === null) return null;
  return lights.filter((l) => l.order > base.order && l.order < order).reduce((colour, light) => {
    const behind = lightBehind(light, ink);
    return behind === null ? colour : composite(colour, behind.colour, behind.alpha * light.alpha, light.blend);
  }, base.colour);
}

// A text's own glyph glow (props.glow, lit by its words' glow tracks) over its ground: screened (draw.mjs), at its full
// strength times the most lit word's share.
function withGlyphGlow(node, ground) {
  const glow = node.props?.glow;
  if (!glow || !colourChannels(glow.color) || ground === null) return ground;
  const share = Math.max(0, ...(node.words ?? []).map((w) => Math.min(1, w?.glow ?? 0)));
  return share > 0 ? composite(ground, glow.color, GLOW_EDGE * (glow.alpha ?? 0) * share, 'screen') : ground;
}

// The distinct colours of the words a viewer reads on this frame: on screen at opacity 1 and not an unspoken ghost.
function wordColours(node) {
  const base = node.props?.fill ?? DEFAULT_TEXT_FILL;
  const indices = node.layout.lines.flatMap((line) => line.words.map((w) => w.index));
  const shown = indices.map((i) => node.words?.[i] ?? {}).filter((w) => (w.opacity ?? 1) >= 1 && !((w.ghost ?? 0) > 0));
  return [...new Set(shown.map((w) => w.fill ?? base))];
}

/**
 * Contrast findings for the texts of one frame. `texts` are the frame review's visible texts ({ node, ink, role,
 * opacity }); `finding(kind, rule, node, message, role)` builds a finding in the frame review's shape.
 */
export function contrastFindings(texts, sampled, ctx, finding) {
  const drawn = groundsOf(sampled);
  return texts.filter((t) => t.opacity >= 1).flatMap((t) => {
    const ground = withGlyphGlow(t.node, groundUnder(t.ink, drawn.textOrder.get(t.node.id) ?? Infinity, drawn, ctx.background));
    if (ground === null) return [];
    const worst = wordColours(t.node).map((fill) => ({ fill, ratio: contrastRatio(fill, ground) })).filter((c) => c.ratio !== null)
      .reduce((low, c) => (low === null || c.ratio < low.ratio ? c : low), null);
    if (worst === null || worst.ratio >= MIN_CONTRAST) return [];
    const ratio = worst.ratio.toFixed(RATIO_DECIMALS);
    return [finding('mechanical', 'contrast', t.node.id, `text "${t.node.id}" is ${worst.fill} on ${ground}, a contrast of ${ratio}:1; it needs at least ${MIN_CONTRAST}:1, so change its colour (the film's accent, or the look) or what lies under it`, t.role)];
  });
}

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
// What escapes: a text over a picture or over a translucent or blended shape, a colour that is not #rrggbb, a ground
// that lies under only part of a text (a highlight marker behind some of its words: the text is judged against what
// lies under all of it), and texts still fading in.
import { colourChannels } from '../time/track.mjs';

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

// What could lie under a text, in draw order: { order, colour (null: unknown, a picture), box (null: the whole frame) },
// and where each text is drawn (id -> order).
function groundsOf(sampled) {
  const grounds = [], textOrder = new Map();
  let order = 0;
  const walk = (n, opacity) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0) return;
    order += 1;
    const opaque = o >= 1 && (n.draw ?? 1) >= 1 && (n.reveal ?? 1) >= 1 && n.props?.blend === undefined;
    if (n.type === 'field' && opaque && colourChannels(n.props?.palette?.paper)) grounds.push({ order, colour: n.props.palette.paper, box: null });
    if (n.type === 'path' && opaque && colourChannels(n.props?.fill) && isBox(n.bbox)) grounds.push({ order, colour: n.props.fill, box: n.bbox });
    if (n.type === 'image' && isBox(n.bbox)) grounds.push({ order, colour: null, box: n.bbox, picture: true });
    if (n.type === 'text') textOrder.set(n.id, order);
    (n.children ?? []).forEach((child) => walk(child, o));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1));
  return { grounds, textOrder };
}

const holds = (box, [x, y, w, h]) => box[0] <= x && box[1] <= y && box[0] + box[2] >= x + w && box[1] + box[3] >= y + h;
const holdsPoint = (box, [px, py]) => px >= box[0] && py >= box[1] && px <= box[0] + box[2] && py <= box[1] + box[3];

// The colour directly under a text's ink, null when unknown (a picture, or nothing known at all).
function groundUnder(ink, order, grounds, background) {
  const centre = [ink[0] + ink[2] / HALF, ink[1] + ink[3] / HALF];
  const under = grounds.filter((g) => g.order < order && (g.box === null || (g.picture ? holdsPoint(g.box, centre) : holds(g.box, ink))));
  if (under.length > 0) return under.at(-1).colour;
  return colourChannels(background) ? background : null;
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
  const { grounds, textOrder } = groundsOf(sampled);
  return texts.filter((t) => t.opacity >= 1).flatMap((t) => {
    const ground = groundUnder(t.ink, textOrder.get(t.node.id) ?? Infinity, grounds, ctx.background);
    if (ground === null) return [];
    const worst = wordColours(t.node).map((fill) => ({ fill, ratio: contrastRatio(fill, ground) })).filter((c) => c.ratio !== null)
      .reduce((low, c) => (low === null || c.ratio < low.ratio ? c : low), null);
    if (worst === null || worst.ratio >= MIN_CONTRAST) return [];
    const ratio = worst.ratio.toFixed(RATIO_DECIMALS);
    return [finding('mechanical', 'contrast', t.node.id, `text "${t.node.id}" is ${worst.fill} on ${ground}, a contrast of ${ratio}:1; it needs at least ${MIN_CONTRAST}:1, so change its colour (the film's accent, or the look) or what lies under it`, t.role)];
  });
}

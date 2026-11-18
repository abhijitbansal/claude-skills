// The device frames of the `screen` kind, drawn from paths and styled by the look (look.kinds.screen): a browser (a
// title row with window dots and the `title`, an address row with the `url` in a pill), a window (the title row only),
// a phone (a bezel round the screen and a speaker slot) or none. Chrome sizes in units, copied from version 1's
// browser frame block (browser-window in template/blocks, deleted at cut-over; title row 72, address row 88, corner radius 20). The title and the url are the
// author's words: set at the format's reading floor, one size; one that does not fit its row is cut to what fits and
// says so (props.dropped, the frame review's "left out its ..." finding). The url is display text, never fetched.
// Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf, roundedRect } from '../devices/shared.mjs';
import { elevatedShadow } from '../devices/card.mjs';
import { fontFor, sizeAt, isWide } from './shared.mjs';

// units; from version 1's browser frame block (browser-window in template/blocks, deleted at cut-over): title row 72, address row 88, corner radius 20
const CHROME = Object.freeze({
  browser: Object.freeze({ top: 160, side: 0, bottom: 0, radius: 20, title: 72, address: 88 }),
  window: Object.freeze({ top: 72, side: 0, bottom: 0, radius: 20, title: 72, address: 0 }),
  phone: Object.freeze({ top: 56, side: 24, bottom: 56, radius: 64, title: 0, address: 0 }),
  none: Object.freeze({ top: 0, side: 0, bottom: 0, radius: 0, title: 0, address: 0 }),
});
export const FRAMES = Object.freeze(Object.keys(CHROME));
const DOT = Object.freeze({ r: 8, gap: 26, left: 28 }); // units: the window dots
const PILL_INSET = 14; // units round the address pill
const TEXT_PAD = 20; // units before a chrome text
const SLOT = Object.freeze({ w: 0.28, h: 12 }); // the phone's speaker slot: share of the width, units tall
const NO_WRAP = 1e6;
const HALF = 2;

/** The frame a picture gets by default: a browser when it is wider than tall, a phone otherwise. */
export const defaultFrame = (picture) => (picture.width > picture.height ? 'browser' : 'phone');

/** The chrome of `frame` in px: rows above, the bezel at the sides and below, the corner radius, the title and address rows. */
export function chromeOf(frame, unit) {
  return Object.fromEntries(Object.entries(CHROME[frame]).map(([k, v]) => [k, v * unit]));
}

// A chrome text at the format's reading floor in the label face, as many leading pieces as fit `maxWidth` (words of a
// title; the host, then the path, of a url): { layout, font, cut } where `cut` says something was left out.
function chromeText(text, pieces, ctx, maxWidth) {
  const { look, unit, measure, canvas } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, isWide(canvas) ? 1 : 2, unit), unit);
  const set = (t) => layoutText({ text: t, font, maxWidth: NO_WRAP, measure });
  const whole = set(text);
  if (whole.width <= maxWidth) return { layout: whole, font, cut: false };
  const kept = pieces.reduce((acc, piece) => (acc.done || set(acc.text + piece).width > maxWidth ? { ...acc, done: true } : { text: acc.text + piece, done: false }), { text: '', done: false });
  return { layout: set(kept.text.trim() || pieces[0]), font, cut: true };
}

const titlePieces = (title) => title.split(/(?<=\s)/);
const urlPieces = (url) => url.split(/(?=\/)/);

function textNode(id, set, x, rowTop, rowH, fill, field) {
  const y = rowTop + (rowH - set.layout.height) / HALF;
  return node('text', id, { x, y, layout: set.layout, font: set.font, fill, ...(set.cut ? { dropped: [field] } : {}) });
}

// The title row: three dots and the title after them.
function titleRow(shot, ctx, style, [x, y, w], rowH) {
  const { look, unit } = ctx;
  const dots = [0, 1, 2].map((i) => {
    const cx = x + (DOT.left + i * DOT.gap) * unit, cy = y + rowH / HALF, r = DOT.r * unit;
    return node('path', `${shot.id}.dot${i}`, { d: roundedRect(cx - r, cy - r, HALF * r, HALF * r, r), fill: colourOf(look, style.dots) });
  });
  if (shot.title === undefined) return dots;
  const left = x + (DOT.left + 3 * DOT.gap + TEXT_PAD) * unit;
  const set = chromeText(shot.title, titlePieces(shot.title), ctx, x + w - left - TEXT_PAD * unit);
  return [...dots, textNode(`${shot.id}.title`, set, left, y, rowH, colourOf(look, style.text), 'title')];
}

// The address row: a pill with the url in it.
function addressRow(shot, ctx, style, [x, y, w], rowH) {
  const { look, unit } = ctx;
  const inset = PILL_INSET * unit;
  const pill = [x + inset, y + inset / HALF, w - HALF * inset, rowH - inset];
  const nodes = [node('path', `${shot.id}.pill`, { d: roundedRect(...pill, pill[3] / HALF), fill: colourOf(look, style.pill) })];
  if (shot.url === undefined) return nodes;
  const set = chromeText(shot.url, urlPieces(shot.url), ctx, pill[2] - HALF * TEXT_PAD * unit);
  return [...nodes, textNode(`${shot.id}.url`, set, pill[0] + TEXT_PAD * unit, pill[1], pill[3], colourOf(look, style.urlText), 'url')];
}

// An elevated frame (data.elevated, keynote): the look's elevated card shadow (devices/card.mjs elevatedShadow, the one
// builder every elevated surface uses) under the frame's outer box, rounded as the frame is.
function elevatedNodes(id, box, radius, ctx) {
  const { look, unit } = ctx;
  return elevatedShadow(id, box, radius, look, unit, look.devices.card?.layers ?? []);
}

// The look's shadow under the frame: its outline again, offset, in the shadow colour (blurred where the look's is).
function shadowNode(id, d, look, unit) {
  const { dx, dy, blur, alpha, color } = look.shadow;
  return node('path', `${id}.shadow`, { d, fill: colourOf(look, color), opacity: alpha, x: dx * unit, y: dy * unit, ...(blur > 0 ? { blur: (blur * unit) / HALF } : {}) });
}

/** The outer box of a frame around an image box [x, y, w, h]. */
export function outerOf(frame, unit, [x, y, w, h]) {
  const c = chromeOf(frame, unit);
  return [x - c.side, y - c.top, w + HALF * c.side, h + c.top + c.bottom];
}

/**
 * The frame's nodes in canvas pixels around the screenshot at `image` ([x, y, w, h]): the shadow, the body (outlined),
 * the chrome and its texts, then `content` (the screenshot node) on top. `data` is look.kinds.screen.
 */
export function frameNodes(shot, ctx, { frame, image, data, content }) {
  const { look, unit } = ctx;
  const c = chromeOf(frame, unit);
  const outer = outerOf(frame, unit, image);
  if (frame === 'none') return [shadowNode(`${shot.id}.frame`, roundedRect(...image, 0), look, unit), content];
  const d = roundedRect(...outer, c.radius);
  const body = node('path', `${shot.id}.frame.body`, { d, fill: colourOf(look, data.fill) });
  const line = node('path', `${shot.id}.frame.line`, { d, stroke: colourOf(look, data.line), strokeWidth: data.lineWidth * unit });
  const chrome = [];
  if (c.title > 0) chrome.push(...titleRow(shot, ctx, data, [outer[0], outer[1], outer[2]], c.title));
  if (c.address > 0) chrome.push(...addressRow(shot, ctx, data, [outer[0], outer[1] + c.title, outer[2]], c.address));
  if (frame === 'phone') {
    const sw = SLOT.w * outer[2], sh = SLOT.h * unit;
    chrome.push(node('path', `${shot.id}.slot`, { d: roundedRect(outer[0] + (outer[2] - sw) / HALF, outer[1] + (c.top - sh) / HALF, sw, sh, sh / HALF), fill: colourOf(look, data.dots) }));
  }
  const depth = data.elevated === true ? elevatedNodes(`${shot.id}.frame`, outer, c.radius, ctx) : [shadowNode(`${shot.id}.frame`, d, look, unit)];
  return [...depth, body, ...chrome, content, line];
}

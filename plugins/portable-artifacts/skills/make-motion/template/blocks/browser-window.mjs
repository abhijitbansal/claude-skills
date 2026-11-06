// browser-window: a browser window (title bar, address bar, content area), optionally holding a screenshot. The block
// stands alone: form-fields, tab-switch, button-state and side-panel are placed over its content area by coordinates
// (`contentRect`, printed by blocks.mjs show), since blocks do not nest.
import { unit, contentWidth, freeBand, textPart, rectPart, ellipsePart, enter, slot, squeeze, blockGroup, abovePlace, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 32 },
    title: { type: 'string', minLength: 1, maxLength: 24 },
    image: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const MAX_WIDTH = 1560; // px at 1080
const MAX_ASPECT = 1.25; // the window is at most this much taller than wide
const TITLE_ROW = 72; // px at 1080: the dots and the page title
const ADDRESS_ROW = 88; // px at 1080: the address pill
const RADIUS = 20;
const IMAGE_INSET = 16; // keeps a screenshot's square corners off the window's rounded ones
const DOT = 20;
const DOT_STEP = 36;
const PILL_PAD = 28;
const DOT_COLOURS = ['cat1', 'cat3', 'cat2'];

/** The window's size in canvas px and the height of its two bars, for the block at its place (`insets`: a viral spec's). */
export function windowBox(size, format, insets = null) {
  const u = unit(size);
  const band = freeBand({ size, format, captions: true, insets }); // always above the caption zone, with or without captions
  const width = contentWidth(size, MAX_WIDTH * u, 0, insets);
  return { u, width, height: Math.min(band.bottom - band.top, width * MAX_ASPECT), bars: (TITLE_ROW + ADDRESS_ROW) * u };
}

/** The content area under the bars for the block at its place: { x, y } its centre in canvas px, and its size. */
export function contentRect(size, format, insets = null) {
  const { x, y } = abovePlace(size, format, insets);
  const { width, height, bars } = windowBox(size, format, insets);
  return { x, y: y + bars / 2, width, height: height - bars };
}

function expand(el, ctx) {
  const { size, format, sceneDuration, insets } = ctx;
  const { url, title, image } = el.params;
  const { u, width: W, height: H, bars } = windowBox(size, format, insets);
  const id = (part) => `${el.id}/${part}`;
  const fontSize = Math.max(1, Math.round(MIN_TEXT * u));
  const stroke = Math.max(1, Math.round(2 * u));
  const top = -H / 2;
  const at = squeeze(sceneDuration, slot(3)[1]);
  const span = (k) => slot(k).map(at);
  const titleY = top + (TITLE_ROW * u) / 2;
  const pillH = (ADDRESS_ROW - 24) * u;
  const pillW = W - 2 * PILL_PAD * u;
  const pillY = top + TITLE_ROW * u + (ADDRESS_ROW * u) / 2;
  const pillLeft = -pillW / 2;
  const frame = rectPart(id('frame'), 0, 0, W, H, { fill: 'surface', stroke: 'line', strokeWidth: stroke, radius: Math.round(RADIUS * u), elevated: true });
  const bar = rectPart(id('bar'), 0, top + bars / 2, W - 2 * stroke, bars - stroke, { fill: 'line', radius: Math.round(RADIUS * u) });
  const dots = DOT_COLOURS.map((fill, i) => ellipsePart(id(`dot-${i + 1}`), -W / 2 + (40 + i * DOT_STEP) * u, titleY, DOT * u, { fill }));
  const pageTitle = title ? [textPart(id('title'), title, 0, titleY, { fontSize, maxWidth: W - 300 * u, fontWeight: 600, color: 'text2' })] : [];
  const pill = rectPart(id('url-pill'), 0, pillY, pillW, pillH, { fill: 'surface', radius: Math.round(pillH / 2) });
  const secure = ellipsePart(id('secure'), pillLeft + PILL_PAD * u, pillY, 14 * u, { fill: 'good' });
  const address = textPart(id('url'), url, pillLeft + 2 * PILL_PAD * u, pillY, { fontSize, maxWidth: pillW - 3 * PILL_PAD * u, fontWeight: 500, align: 'left', anchor: 'left', color: 'text' });
  const picture = image ? [{ id: id('image'), type: 'image', src: image, x: 0, y: Math.round(bars / 2), width: Math.round(W - 2 * IMAGE_INSET * u), height: Math.round(H - bars - 2 * IMAGE_INSET * u), fit: 'cover' }] : [];
  const parts = [
    enter(frame, span(0)),
    ...[bar, ...dots, ...pageTitle].map((part) => enter(part, span(1))),
    ...[pill, secure, address].map((part) => enter(part, span(2))),
    ...picture.map((part) => enter(part, span(3))),
  ];
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a browser window: title bar, address bar and a content area, optionally with a screenshot in it',
  params,
  describe: {
    url: 'the address shown in the address bar, up to 32 characters',
    title: 'the page title in the title bar, up to 24 characters',
    image: 'a screenshot (png, jpg, svg) shown in the content area, relative to the spec file; without it the area is empty for form-fields, tab-switch, button-state and side-panel to sit in',
  },
  example: { url: 'app.example.com/settings', title: 'Settings', image: 'swipe-after.png' },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  // The content area as a rectangle at the block's place; moving the block moves it the same way.
  contentRect,
  assets: ['image'],
  expand,
});

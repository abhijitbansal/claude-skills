// side-panel: a docked panel (title, then a list of rows) that slides in from the left or right edge. Its place is the
// right (or left) end of browser-window's content area, so the two stand side by side at their places.
import { unit, contentWidth, squeeze, slot, textPart, rectPart, ellipsePart, linePart, enter, blockGroup, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';
import { contentRect } from './browser-window.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'rows'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 18 },
    rows: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 18 } },
    side: { enum: ['left', 'right'], default: 'right' },
  },
};

const PANEL_WIDTH = 560; // px at 1080
const TITLE_SIZE = 44; // px at 1080; rows take MIN_TEXT
const PAD = 28;
const ROW_PAD = 12;
const BULLET = 14;
const SLIDE_SHARE = 0.4; // of the panel's width: how far outside its place it starts
const ROW_SLOT = 3; // rows follow once the panel (slot 0, 0.6 s) has landed

const panelWidth = (size, insets) => contentWidth(size, PANEL_WIDTH * unit(size), 0, insets);
const sideOf = (side) => side ?? params.properties.side.default;

// The panel at the window's content area: its centre x, the content's y, and the content's height.
function dock(size, format, side, insets) {
  const rect = contentRect(size, format, insets);
  const half = (rect.width - panelWidth(size, insets)) / 2;
  return { x: rect.x + (sideOf(side) === 'left' ? -half : half), y: rect.y, height: rect.height };
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { title, rows } = el.params;
  const left = sideOf(el.params.side) === 'left';
  const id = (part) => `${el.id}/${part}`;
  const width = panelWidth(size, ctx.insets);
  const { height } = dock(size, ctx.format, el.params.side, ctx.insets);
  const rowFs = Math.max(1, Math.round(MIN_TEXT * u));
  const titleFs = Math.max(1, Math.round(TITLE_SIZE * u));
  const top = -height / 2;
  const dividerY = top + PAD * u + titleFs * LINE_HEIGHT.sans + 14 * u;
  const rowH = rowFs * LINE_HEIGHT.sans + 2 * ROW_PAD * u;
  const at = squeeze(sceneDuration, slot(ROW_SLOT + rows.length - 1)[1]);
  const slide = { dx: (left ? -1 : 1) * SLIDE_SHARE * width };
  const stroke = Math.max(1, Math.round(2 * u));
  const parts = [
    rectPart(id('panel'), 0, 0, width, height, { fill: 'surface', stroke: 'line', strokeWidth: stroke, radius: Math.round(16 * u), elevated: true }),
    textPart(id('title'), title, -width / 2 + PAD * u, top + PAD * u + (titleFs * LINE_HEIGHT.sans) / 2, { fontSize: titleFs, maxWidth: width - 2 * PAD * u, fontWeight: 700, align: 'left', anchor: 'left', color: 'text' }),
    linePart(id('divider'), 0, dividerY, width - 2 * PAD * u, { stroke: 'line', strokeWidth: stroke }),
  ].map((part) => enter(part, slot(0).map(at), slide));
  rows.forEach((text, i) => {
    const y = dividerY + 14 * u + rowH * (i + 0.5);
    const span = slot(ROW_SLOT + i).map(at);
    parts.push(
      enter(ellipsePart(id(`dot-${i + 1}`), -width / 2 + (PAD + BULLET / 2) * u, y, BULLET * u, { fill: 'accent' }), span, { dy: 16 * u }),
      enter(textPart(id(`row-${i + 1}`), text, -width / 2 + (PAD + 36) * u, y, { fontSize: rowFs, maxWidth: width - (2 * PAD + 36) * u, fontWeight: 500, align: 'left', anchor: 'left', color: 'text' }), span, { dy: 16 * u }),
    );
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a docked panel with a title and a list of rows, sliding in from the left or right edge',
  params,
  describe: {
    title: 'the panel heading, up to 18 characters',
    rows: '2 to 5 short rows, each up to 18 characters, each with an accent dot, arriving one by one after the panel',
    side: 'left or right (default right): the edge it slides in from, and the end of the browser-window content area it is placed at',
  },
  example: { title: 'Activity', rows: ['Draft saved', 'Teammate joined', 'Export ready'] },
  // The end of browser-window's content area (see its content rectangle) on `side`; the panel is as tall as that area.
  place: (size, format, side, insets) => {
    const { x, y } = dock(size, format, side, insets);
    return { x, y };
  },
  paramOf: (part) => (/^row-(\d+)$/.test(part) ? `rows[${Number(part.split('-')[1]) - 1}]` : null),
  expand,
});

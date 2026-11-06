// tab-switch: a row of 2 to 4 tabs over a panel. The first tab is active; every `switchAfter` seconds the underline slides
// to the next tab, the old panel text fades out completely, and only then the new one fades in, in the same place.
import { unit, contentWidth, fitText, squeeze, slot, textPart, rectPart, linePart, enter, blockGroup, stack, abovePlace, LINE_HEIGHT, ENTER_SECONDS, MIN_TEXT } from './layout.mjs';
import { fadeOut } from './exit.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['tabs'],
  properties: {
    tabs: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'body'],
        properties: { label: { type: 'string', minLength: 1, maxLength: 8 }, body: { type: 'string', minLength: 1, maxLength: 48 } },
      },
    },
    switchAfter: { type: 'number', minimum: 1.5, maximum: 20, default: 2 },
  },
};

const BODY_SIZE = 44; // px at 1080; labels take MIN_TEXT
const PAD = 28; // px at 1080 inside the panel
const UNDERLINE = 6; // px at 1080
const OUT_SECONDS = 0.2; // the old panel text fades out over this long
const SLIDE_SECONDS = 0.4; // the underline's move

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { tabs } = el.params;
  const every = el.params.switchAfter ?? params.properties.switchAfter.default;
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 1100 * u, 40 * u, ctx.insets);
  const slotW = width / tabs.length;
  const labelFs = Math.max(1, Math.round(MIN_TEXT * u));
  const innerW = width - 2 * PAD * u;
  const fits = tabs.map((t) => fitText(t.body, { size: BODY_SIZE * u, min: MIN_TEXT * u, maxWidth: innerW, maxLines: 3 }));
  const bodyFs = Math.min(...fits.map((f) => f.fontSize));
  const bodyLines = Math.max(...tabs.map((t) => fitText(t.body, { size: bodyFs, min: bodyFs, maxWidth: innerW, maxLines: 3 }).lines));
  const rowH = labelFs * LINE_HEIGHT.sans + 24 * u;
  const cardH = bodyLines * bodyFs * LINE_HEIGHT.sans + 2 * PAD * u;
  const [rowY, cardY] = stack([rowH, cardH], [12 * u]);
  const tabX = (i) => (i - (tabs.length - 1) / 2) * slotW;
  // Switch k (1-based) starts at `k * every`: the underline moves, the old text is gone OUT_SECONDS later, then the new one enters.
  const switchAt = (k) => k * every;
  const lastEnd = switchAt(tabs.length - 1) + OUT_SECONDS + ENTER_SECONDS;
  const at = squeeze(sceneDuration, Math.max(slot(2)[1], lastEnd));
  const parts = [enter(rectPart(id('card'), 0, cardY, width, cardH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(16 * u), elevated: true }), slot(0).map(at))];
  tabs.forEach((t, i) => parts.push(enter(textPart(id(`tab-${i + 1}`), t.label, tabX(i), rowY - 12 * u, { fontSize: labelFs, maxWidth: slotW - 8 * u, fontWeight: 600, color: 'text' }), slot(1).map(at))));
  const underlineY = rowY - 12 * u + (labelFs * LINE_HEIGHT.sans) / 2 + 14 * u;
  const slide = tabs.flatMap((_, i) => (i === 0 ? [] : [{ t: at(switchAt(i)), x: Math.round(tabX(i - 1)) }, { t: at(switchAt(i) + SLIDE_SECONDS), x: Math.round(tabX(i)), ease: 'move' }]));
  const underline = linePart(id('underline'), tabX(0), underlineY, slotW - 24 * u, { stroke: 'accent', strokeWidth: Math.max(1, Math.round(UNDERLINE * u)), cap: 'round' });
  const drawn = enter(underline, slot(1).map(at));
  parts.push({ ...drawn, keyframes: [...drawn.keyframes, ...slide] });
  tabs.forEach((t, i) => {
    const arrives = i === 0 ? slot(2).map(at) : [switchAt(i) + OUT_SECONDS, switchAt(i) + OUT_SECONDS + ENTER_SECONDS].map(at);
    const body = enter(textPart(id(`body-${i + 1}`), t.body, -innerW / 2, cardY, { fontSize: bodyFs, maxWidth: innerW, fontWeight: 500, align: 'left', anchor: 'left', color: 'text' }), arrives);
    parts.push(i < tabs.length - 1 ? fadeOut(body, [switchAt(i + 1), switchAt(i + 1) + OUT_SECONDS].map(at)) : body);
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a row of tabs over a panel: the active tab changes one at a time, the old panel text fading out before the new one comes in',
  params,
  describe: {
    tabs: '2 to 4 tabs; each { label up to 8 characters, body up to 48 }; the first is active at the start',
    switchAfter: 'seconds between one switch and the next, 1.5 to 20 (default 2): the first tab stays active that long, then each following tab does',
  },
  example: { tabs: [{ label: 'Profile', body: 'Name, photo and a short bio' }, { label: 'Billing', body: 'Plan, invoices and cards' }, { label: 'Team', body: 'Invite people and set roles' }] },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (/^(tab|body)-(\d+)$/.test(part) ? `tabs[${Number(part.split('-')[1]) - 1}].${part.startsWith('tab') ? 'label' : 'body'}` : null),
  expand,
});

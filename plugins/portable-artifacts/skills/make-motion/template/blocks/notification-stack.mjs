// notification-stack: 1 to 5 notification cards (app icon, app name, title, body) that slide in one after another, newest
// at the bottom. When the cards do not all fit the room above the captions, the oldest fade out as new ones
// arrive, so what shows always fits.
import { unit, contentWidth, fitText, fitHeight, sizeLadder, lineCount, squeeze, textPart, rectPart, ellipsePart, blockGroup, freeBand, roomAt, ENTER_SECONDS, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const item = {
  type: 'object',
  additionalProperties: false,
  required: ['app', 'title', 'body'],
  properties: {
    app: { type: 'string', minLength: 1, maxLength: 24 },
    title: { type: 'string', minLength: 1, maxLength: 40 },
    body: { type: 'string', minLength: 1, maxLength: 80 },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 5, items: item },
    stagger: { type: 'number', minimum: 0.2, maximum: 1.5, default: 0.3 },
  },
};

const TITLE_SIZES = [48, 44, MIN_TEXT]; // px at 1080, largest first
const BODY_SIZES = [44, MIN_TEXT];
const TIERS = [{ pad: 28, gap: 8, between: 24 }, { pad: 20, gap: 6, between: 16 }, { pad: 14, gap: 4, between: 12 }]; // px at 1080
const ICON = 88; // px at 1080: the app icon's diameter
const ICON_GAP = 24;
const INITIAL = /\p{L}|\p{N}/u;

// The first letter or digit of `app`, upper-cased, for the icon.
const initialOf = (app) => (Array.from(app).find((ch) => INITIAL.test(ch)) ?? '•').toUpperCase();

function cardLayout(items, { u, textW, tier }) {
  const title = Math.min(...items.map((i) => fitHeight(i.title, { sizes: sizeLadder(TITLE_SIZES, u), maxWidth: textW, maxHeight: Infinity, lineHeight: LINE_HEIGHT.sans }).fontSize));
  const body = Math.min(...items.map((i) => fitHeight(i.body, { sizes: sizeLadder(BODY_SIZES, u), maxWidth: textW, maxHeight: Infinity }).fontSize));
  const app = Math.max(1, Math.round(MIN_TEXT * u));
  const heights = items.map((i) => ({
    app: app * LINE_HEIGHT.sans,
    title: lineCount(i.title, title, textW) * title * LINE_HEIGHT.sans,
    body: lineCount(i.body, body, textW) * body * LINE_HEIGHT.sans,
  }));
  const content = Math.max(...heights.map((h) => h.app + h.title + h.body + 2 * tier.gap * u));
  return { app, title, body, heights, cardH: Math.max(ICON * u, content) + 2 * tier.pad * u };
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { items } = el.params;
  const n = items.length;
  const stagger = el.params.stagger ?? params.properties.stagger.default;
  const id = (part) => `${el.id}/${part}`;
  const cardW = contentWidth(size, 1100 * u, 0, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  let fit;
  for (const tier of TIERS) {
    const pad = tier.pad * u;
    const textW = Math.max(1, cardW - 2 * pad - ICON * u - ICON_GAP * u);
    fit = { ...cardLayout(items, { u, textW, tier }), tier, textW };
    if (n * fit.cardH + (n - 1) * tier.between * u <= room) break;
  }
  const { tier, textW, cardH } = fit;
  const between = tier.between * u;
  const pitch = cardH + between;
  // How many cards show at once: all of them, or as many as fit (at least one) with the oldest sliding out.
  const shows = Math.min(n, Math.max(1, Math.floor((room + between) / pitch)));
  const slotY = (s) => (s - (shows - 1) / 2) * pitch;
  const slotOf = (j, m) => j - Math.max(0, m - shows + 1); // card j's slot once card m has arrived
  const nominalEnd = (n - 1) * stagger + ENTER_SECONDS;
  const at = squeeze(sceneDuration, nominalEnd);
  const parts = [];
  items.forEach((it, j) => {
    const k = j + 1;
    const startSlot = slotOf(j, j);
    const cy = slotY(startSlot);
    const pad = tier.pad * u;
    const iconX = -cardW / 2 + pad + (ICON * u) / 2;
    const textX = iconX + (ICON * u) / 2 + ICON_GAP * u + textW / 2;
    const h = fit.heights[j];
    const top = -(h.app + h.title + h.body + 2 * tier.gap * u) / 2;
    const card = [ // positions relative to the card's centre
      rectPart(id(`card-${k}`), 0, 0, cardW, cardH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(28 * u), elevated: true }),
      ellipsePart(id(`icon-${k}`), iconX, 0, ICON * u, { fill: 'accent' }),
      textPart(id(`initial-${k}`), initialOf(it.app), iconX, 0, { fontSize: Math.max(1, Math.round(MIN_TEXT * u)), maxWidth: ICON * u, fontWeight: 800, color: 'surface' }),
      textPart(id(`app-${k}`), it.app, textX, top + h.app / 2, { fontSize: fit.app, maxWidth: textW, fontWeight: 600, color: 'text2' }),
      textPart(id(`title-${k}`), it.title, textX, top + h.app + tier.gap * u + h.title / 2, { fontSize: fit.title, maxWidth: textW, fontWeight: 700, color: 'text' }),
      textPart(id(`body-${k}`), it.body, textX, top + h.app + h.title + 2 * tier.gap * u + h.body / 2, { fontSize: fit.body, maxWidth: textW, fontWeight: 500, color: 'text' }),
    ];
    const start = j * stagger;
    // Enter from the right at its slot; later arrivals past `shows` move it up a slot each, and the one that would take it
    // off the top fades it out where it is (it never leaves the room the block was laid out in).
    const moves = [];
    for (let m = j + 1; m < n; m++) {
      const s = slotOf(j, m);
      if (s === slotOf(j, m - 1)) continue;
      moves.push({ t: at(m * stagger + ENTER_SECONDS), slot: s < 0 ? slotOf(j, m - 1) : s, out: s < 0 });
      if (s < 0) break;
    }
    for (const part of card) {
      const x = Math.round(part.x);
      const y = Math.round(cy + part.y);
      const keyframes = [
        { t: at(start), opacity: 0, x: x + Math.round(64 * u), y },
        { t: at(start + ENTER_SECONDS), opacity: 1, x, y, ease: 'enter' },
        ...moves.map((mv) => ({ t: mv.t, y: Math.round(slotY(mv.slot) + part.y), ...(mv.out ? { opacity: 0 } : {}), ease: 'move' })),
      ];
      parts.push({ ...part, x, y, keyframes });
    }
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: '1 to 5 notification cards (app icon, app, title, body) that slide in one after another; the oldest fade out when they do not all fit',
  params,
  describe: {
    items: '1 to 5 of { app (up to 24 characters), title (up to 40), body (up to 80) }, in the order they arrive; the app\'s first letter is the icon',
    stagger: 'seconds between one notification arriving and the next, 0.2 to 1.5 (default 0.3)',
  },
  example: {
    items: [
      { app: 'Calendar', title: 'Design review at 3 pm', body: 'Room 4B, bring the new mockups' },
      { app: 'Messages', title: 'Priya', body: 'The render finished, it looks great' },
      { app: 'Deploys', title: 'Production is live', body: 'Version 2.4 shipped without errors' },
    ],
  },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    const [, kind, n] = /^(app|title|body)-(\d+)$/.exec(part) ?? [];
    return kind ? `items[${Number(n) - 1}].${kind}` : null;
  },
  expand,
});

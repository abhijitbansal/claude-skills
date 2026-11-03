// cta-soft: a closing line and 1 to 3 pills that ask for the soft actions short-form viewers give (save, send, follow,
// comment, part 2); no button, no address. cta-close is the hard ask.
import { unit, contentWidth, textWidth, fitHeight, sizeLadder, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, centrePlace } from './layout.mjs';

// What each action says on its pill. Looked up with Object.hasOwn: an action is a key of this table, nothing else.
export const ACTION_LABELS = Object.freeze({
  save: 'Save for later',
  send: 'Send this to someone',
  follow: 'Follow for more',
  comment: 'Tell me below',
  'part-2': 'Part 2 is next',
});
const ACTIONS = Object.keys(ACTION_LABELS);

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['line', 'actions'],
  properties: {
    line: { type: 'string', minLength: 1, maxLength: 40 },
    actions: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ACTIONS } },
  },
};

const LINE_SIZES = [88, 72, 60, 52, 44, MIN_TEXT]; // px at 1080, largest first
const LINE_GAP = 48; // px at 1080 between the line and the first pill
const PILL_SIZE = 44; // the pill label's size at 1080; MIN_TEXT when the room is short
// Pill height padding and the gap between pills (px at 1080), roomiest first: the stack takes the first that fits.
const TIERS = [{ padY: 20, gap: 24, pillSize: PILL_SIZE }, { padY: 14, gap: 16, pillSize: MIN_TEXT }, { padY: 8, gap: 10, pillSize: MIN_TEXT }];

const labelOf = (action) => (Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action] : action);

// The stack for one spacing tier: the line takes the largest size that leaves the pills their room (`room` tall).
function layout(el, ctx, tier, room) {
  const u = unit(ctx.size);
  const width = contentWidth(ctx.size, 1200 * u, 40 * u, ctx.insets);
  const padX = 36 * u;
  const labels = el.params.actions.map(labelOf);
  const labelSize = Math.max(1, Math.round(tier.pillSize * u));
  const labelFit = labels.map((label) => fitHeight(label, { sizes: [labelSize], maxWidth: width - 2 * padX, maxHeight: Infinity }));
  const pillH = Math.max(...labelFit.map((f) => f.height)) + 2 * tier.padY * u;
  const pillW = Math.min(width, Math.max(320 * u, ...labels.map((label, i) => textWidth(label, labelFit[i].fontSize) + 2 * padX)));
  const pillGaps = labels.slice(1).map(() => tier.gap * u);
  const pillsH = labels.length * pillH + pillGaps.reduce((a, g) => a + g, 0);
  const lineGap = LINE_GAP * u;
  const lineFit = fitHeight(el.params.line, { sizes: sizeLadder(LINE_SIZES, u), maxWidth: width, maxHeight: room - pillsH - lineGap, lineHeight: LINE_HEIGHT.title });
  const heights = [lineFit.height, ...labels.map(() => pillH)];
  const gaps = [lineGap, ...pillGaps];
  const total = heights.reduce((a, h) => a + h, 0) + gaps.slice(0, heights.length - 1).reduce((a, g) => a + g, 0);
  return { u, width, padX, labels, labelFit, pillH, pillW, lineFit, heights, gaps, total };
}

function expand(el, ctx) {
  const room = roomAt(freeBand(ctx), el.y);
  let fit;
  for (const tier of TIERS) {
    fit = layout(el, ctx, tier, room);
    if (fit.total <= room) break;
  }
  const { u, width, padX, labels, labelFit, pillH, pillW, lineFit, heights, gaps } = fit;
  const id = (part) => `${el.id}/${part}`;
  const ys = stack(heights, gaps);
  const at = squeeze(ctx.sceneDuration, slot(labels.length)[1]);
  const span = (i) => slot(i).map(at);
  const parts = [
    enter(textPart(id('line'), el.params.line, 0, ys[0], { fontSize: lineFit.fontSize, maxWidth: width, fontWeight: 700, role: 'title', color: 'text' }), span(0), { dy: 24 * u }),
  ];
  labels.forEach((label, i) => {
    const k = i + 1;
    const pill = rectPart(id(`pill-${k}`), 0, ys[k], pillW, pillH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(pillH / 2), elevated: true });
    const text = textPart(id(`label-${k}`), label, 0, ys[k], { fontSize: labelFit[i].fontSize, maxWidth: pillW - 2 * padX, fontWeight: 600, color: 'text' });
    parts.push(enter(pill, span(k), { scale: 0.9 }), enter(text, span(k), { scale: 0.9 }));
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a soft closing ask: a line and 1 to 3 pills such as "Save for later" or "Follow for more", no button or address',
  params,
  describe: {
    line: 'the closing line above the pills, up to 40 characters',
    actions: `1 to 3 different ones of ${ACTIONS.join(', ')}, in order; each draws a pill (${ACTIONS.map((a) => `${a}: "${ACTION_LABELS[a]}"`).join('; ')})`,
  },
  example: { line: 'Liked this? Do one thing', actions: ['save', 'follow'] },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  // A pill's words are fixed by its action, so a finding about one gets no param to shorten (only `line` does).
  paramOf: (part) => (part === 'line' ? part : null),
  expand,
});

// chat-thread: 1 to 8 chat bubbles, "me" on the right in the accent colour and "them" on the left, arriving one at a time;
// with typingDots a three-dot bubble shows where each "them" message will land, just before it. A thread too tall for
// the room grows upward from the band's floor, so it never reaches the captions.
import { unit, contentWidth, textWidth, lineCount, squeeze, slot, textPart, rectPart, ellipsePart, enter, blockGroup, stack, freeBand, roomAt, abovePlace, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';
import { fadeOut, bottomShift } from './exit.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'text'],
        properties: { from: { enum: ['me', 'them'] }, text: { type: 'string', minLength: 1, maxLength: 160 } },
      },
    },
    typingDots: { type: 'boolean', default: false },
  },
};

const TEXT_SIZES = [48, 44, MIN_TEXT]; // px at 1080, largest first
const TIERS = [{ padY: 16, gap: 16 }, { padY: 12, gap: 10 }, { padY: 8, gap: 8 }]; // bubble padding and spacing, roomiest first
const PAD_X = 28; // px at 1080
const MESSAGE_SLOTS = 3; // a message comes in this many stagger slots (0.6 s) after the one before
const TYPING_SLOTS = 5; // dots lead their message by this many slots (1 s): 0.6 s to come in, a beat, 0.2 s to go, all before it lands
const DOT = 16;
const DOT_GAP = 14;
const DOTS_GONE_SECONDS = 0.2;

// The bubbles at text size `fs` px and spacing `tier`: each { width, height, lines }.
function bubbles(messages, u, bubbleMax, fs, tier) {
  const inner = bubbleMax - 2 * PAD_X * u;
  return messages.map(({ text }) => {
    const lines = lineCount(text, fs, inner);
    const width = lines === 1 ? Math.min(bubbleMax, textWidth(text, fs) + 2 * PAD_X * u) : bubbleMax;
    return { width, height: lines * fs * LINE_HEIGHT.sans + 2 * tier.padY * u, lines };
  });
}

function fitThread(messages, u, bubbleMax, room) {
  let fit;
  for (const base of TEXT_SIZES) {
    const fs = Math.max(1, Math.round(base * u));
    for (const tier of TIERS) {
      const sized = bubbles(messages, u, bubbleMax, fs, tier);
      fit = { fs, tier, sized, gap: tier.gap * u };
      const total = sized.reduce((a, b) => a + b.height, 0) + (messages.length - 1) * fit.gap;
      if (total <= room) return fit;
    }
  }
  return fit;
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { messages } = el.params;
  const typing = el.params.typingDots ?? params.properties.typingDots.default;
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 1200 * u, 40 * u, ctx.insets);
  const bubbleMax = 0.8 * width;
  const { fs, tier, sized, gap } = fitThread(messages, u, bubbleMax, roomAt(freeBand(ctx), el.y));
  const height = sized.reduce((a, b) => a + b.height, 0) + (messages.length - 1) * gap;
  const shift = bottomShift(ctx, el.y, height);
  const ys = stack(sized.map((b) => b.height), messages.map(() => gap)).map((y) => y + shift);
  // The schedule: message i comes in at stagger slot `at[i]`; a typing bubble leads a "them" message by TYPING_SLOTS.
  let next = 0;
  const slots = messages.map(({ from }) => {
    const dots = typing && from === 'them' ? next : null;
    const message = dots === null ? next : next + TYPING_SLOTS;
    next = message + MESSAGE_SLOTS;
    return { dots, message };
  });
  const lastSlot = Math.max(...slots.map((s) => s.message));
  const at = squeeze(sceneDuration, slot(lastSlot)[1]);
  const parts = [];
  messages.forEach(({ from, text }, i) => {
    const k = i + 1;
    const mine = from === 'me';
    const b = sized[i];
    const x = mine ? width / 2 - b.width / 2 : -width / 2 + b.width / 2;
    const radius = Math.round(Math.min(28 * u, b.height / 2));
    const bubble = rectPart(id(`bubble-${k}`), x, ys[i], b.width, b.height, mine
      ? { fill: 'accent', radius }
      : { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius });
    const words = textPart(id(`text-${k}`), text, x, ys[i], { fontSize: fs, maxWidth: b.width - 2 * PAD_X * u, fontWeight: 500, align: 'left', color: mine ? 'surface' : 'text' });
    const span = slot(slots[i].message).map(at);
    for (const part of [bubble, words]) parts.push(enter(part, span, { dy: 24 * u }));
    if (slots[i].dots !== null) {
      const dotsSpan = slot(slots[i].dots).map(at);
      const dotsW = 2 * PAD_X * u + 3 * DOT * u + 2 * DOT_GAP * u;
      const dotsH = fs * LINE_HEIGHT.sans + 2 * tier.padY * u;
      const dy = ys[i] - b.height / 2 + dotsH / 2; // top-aligned with the message that replaces it
      const dx = -width / 2 + dotsW / 2;
      const arrives = slot(slots[i].message)[0]; // the dots are gone by the time the message starts to come in
      const gone = [arrives - DOTS_GONE_SECONDS, arrives].map(at);
      parts.push(fadeOut(enter(rectPart(id(`typing-${k}`), dx, dy, dotsW, dotsH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(Math.min(28 * u, dotsH / 2)) }), dotsSpan), gone));
      for (let d = 0; d < 3; d++) {
        const cx = dx + (d - 1) * (DOT + DOT_GAP) * u;
        parts.push(fadeOut(enter(ellipsePart(id(`typing-${k}-${d + 1}`), cx, dy, DOT * u, { fill: 'text2' }), dotsSpan), gone));
      }
    }
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a chat or messaging thread: bubbles arriving one by one, yours on the right and theirs on the left',
  params,
  describe: {
    messages: '1 to 8 messages in order; each { from: "me" | "them", text } with text up to 160 characters; "me" is the accent bubble on the right',
    typingDots: 'true shows a three-dot typing bubble just before each "them" message (default false); it adds 0.6 s per such message',
  },
  example: {
    messages: [
      { from: 'them', text: 'Did the release go out?' },
      { from: 'me', text: 'Yes, 2.4 shipped an hour ago.' },
      { from: 'them', text: 'Great. Captions work offline now?' },
      { from: 'me', text: 'They do, and so does the whole render.' },
    ],
    typingDots: true,
  },
  // Centred across, and in the band between the safe area top and the caption zone, so the thread fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (/^text-(\d+)$/.test(part) ? `messages[${Number(part.split('-')[1]) - 1}].text` : null),
  expand,
});

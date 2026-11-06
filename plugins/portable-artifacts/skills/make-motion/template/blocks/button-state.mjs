// button-state: one button that changes its label and/or colour once, at `at`: the old face fades out completely, then the
// new one comes in over it, in the same place and at the same size, so the two labels are never drawn over each other.
import { unit, contentWidth, fitText, textWidth, squeeze, textPart, rectPart, enter, blockGroup, abovePlace, LINE_HEIGHT, ENTER_SECONDS, MIN_TEXT } from './layout.mjs';
import { fadeOut } from './exit.mjs';

const face = {
  type: 'object',
  additionalProperties: false,
  required: ['label'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 16 },
    tone: { enum: ['accent', 'good', 'neutral'] },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: face,
    to: face,
    at: { type: 'number', minimum: 1, maximum: 58, default: 2 },
  },
};

const LABEL_SIZES = [48, 44, MIN_TEXT]; // px at 1080, largest first
const PAD_X = 40; // px at 1080 between the button's edge and its label
const PAD_Y = 20;
const MIN_WIDTH = 260; // px at 1080
const OUT_SECONDS = 0.2; // the old face is gone this long after `at`; the new one takes ENTER_SECONDS
const POP = 0.94; // the new face grows from this scale

// How each tone draws: the button's fill (and stroke), and the label colour on it. Theme tokens only.
const TONES = {
  accent: () => ({ bg: { fill: 'accent' }, text: 'surface' }),
  good: () => ({ bg: { fill: 'good' }, text: 'surface' }),
  neutral: (strokeWidth) => ({ bg: { fill: 'surface', stroke: 'line', strokeWidth, elevated: true }, text: 'text' }),
};
const PART_PARAMS = { 'from-label': 'from.label', 'to-label': 'to.label' }; // part -> param, for check.mjs hints

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { from, to } = el.params;
  const changeAt = el.params.at ?? params.properties.at.default;
  const id = (part) => `${el.id}/${part}`;
  const cap = contentWidth(size, 800 * u, 40 * u, ctx.insets);
  const inner = cap - 2 * PAD_X * u;
  const fontSize = Math.min(...[from, to].map((f) => fitText(f.label, { size: LABEL_SIZES[0] * u, min: MIN_TEXT * u, maxWidth: inner, maxLines: 1 }).fontSize));
  const width = Math.min(cap, Math.max(MIN_WIDTH * u, ...[from, to].map((f) => textWidth(f.label, fontSize) + 2 * PAD_X * u)));
  const height = fontSize * LINE_HEIGHT.sans + 2 * PAD_Y * u;
  const at = squeeze(sceneDuration, changeAt + OUT_SECONDS + ENTER_SECONDS);
  const stroke = Math.max(1, Math.round(2 * u));
  const parts = [];
  const faceParts = (name, f, [start, end], extra) => {
    const look = TONES[f.tone ?? 'accent'](stroke);
    const bg = rectPart(id(`${name}-bg`), 0, 0, width, height, { ...look.bg, radius: Math.round(height / 2) });
    const label = textPart(id(`${name}-label`), f.label, 0, 0, { fontSize, maxWidth: width - 2 * PAD_X * u, fontWeight: 700, color: look.text });
    return [bg, label].map((part) => extra(enter(part, [start, end], name === 'to' ? { scale: POP } : {})));
  };
  parts.push(...faceParts('from', from, [0, ENTER_SECONDS].map(at), (part) => fadeOut(part, [changeAt, changeAt + OUT_SECONDS].map(at))));
  // The new face starts as the old one is gone, so the two labels are never drawn over each other.
  parts.push(...faceParts('to', to, [changeAt + OUT_SECONDS, changeAt + OUT_SECONDS + ENTER_SECONDS].map(at), (part) => part));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a button that changes its label or colour once, the old face fading out as the new one comes in',
  params,
  describe: {
    from: 'the button at the start: { label up to 16 characters, tone? accent | good | neutral (default accent) }',
    to: 'the button after the change, the same way; it keeps the first one\'s place and size',
    at: 'scene seconds at which the change starts, 1 to 58 (default 2); the old face is gone 0.2 s later and the new one is in 0.8 s after `at`',
  },
  example: { from: { label: 'Save changes' }, to: { label: 'Saved', tone: 'good' } },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (Object.hasOwn(PART_PARAMS, part) ? PART_PARAMS[part] : null),
  expand,
});

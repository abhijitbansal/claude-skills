// form-fields: 2 to 4 labelled fields that appear together, then fill one at a time (each value lands after the one before
// is in), optionally typed character by character. It stands alone: place it over browser-window's content rectangle.
import { unit, contentWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, abovePlace, LINE_HEIGHT, ENTER_SECONDS, MIN_TEXT } from './layout.mjs';
import { bottomShift } from './exit.mjs';
import { TYPING_SECONDS_PER_CHAR, typingLength } from '../defaults.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string', minLength: 1, maxLength: 16 }, value: { type: 'string', minLength: 1, maxLength: 24 } },
      },
    },
    typing: { type: 'boolean', default: false },
  },
};

const VALUE_SIZE = 44; // px at 1080; the labels take MIN_TEXT
const TIERS = [{ gap: 22, pad: 14, labelGap: 8 }, { gap: 12, pad: 8, labelGap: 4 }]; // roomiest first
const FIELD_PAD_X = 24; // px at 1080 between a field's edge and its value
const FILL_PAUSE = 0.3; // seconds between one typed value ending and the next starting
const FILL_STEP = 0.8; // seconds from one faded-in value to the next (it takes ENTER_SECONDS)
const T_DECIMALS = 1e4;

// Keyframes in time order, those at one time merged into one (a typed value's opacity and character count may share one).
function merged(list) {
  const byTime = new Map();
  for (const kf of list) byTime.set(Math.round(kf.t * T_DECIMALS), { ...byTime.get(Math.round(kf.t * T_DECIMALS)), ...kf });
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([, kf]) => kf);
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { fields } = el.params;
  const typed = el.params.typing ?? params.properties.typing.default;
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 900 * u, 40 * u, ctx.insets);
  const labelFs = Math.max(1, Math.round(MIN_TEXT * u));
  const valueFs = Math.min(...fields.map((f) => fitText(f.value, { size: VALUE_SIZE * u, min: MIN_TEXT * u, maxWidth: width - 2 * FIELD_PAD_X * u, maxLines: 1 }).fontSize));
  const room = roomAt(freeBand(ctx), el.y);
  const rowOf = (tier) => {
    const labelH = labelFs * LINE_HEIGHT.sans;
    const fieldH = valueFs * LINE_HEIGHT.sans + 2 * tier.pad * u;
    return { labelH, fieldH, height: labelH + tier.labelGap * u + fieldH, tier };
  };
  const row = TIERS.map(rowOf).find((r) => fields.length * r.height + (fields.length - 1) * r.tier.gap * u <= room) ?? rowOf(TIERS.at(-1));
  const total = fields.length * row.height + (fields.length - 1) * row.tier.gap * u;
  const shift = bottomShift(ctx, el.y, total);
  const centres = stack(fields.map(() => row.height), fields.map(() => row.tier.gap * u)).map((y) => y + shift);
  // The labels and fields come in 0.2 s apart; then the values fill in order, each starting after the one before has ended.
  const fillFrom = slot(fields.length - 1)[1];
  const seconds = (f) => (typed ? typingLength(f.value) * TYPING_SECONDS_PER_CHAR : ENTER_SECONDS);
  const starts = fields.reduce((acc, f, i) => [...acc, i === 0 ? fillFrom : acc[i - 1] + seconds(fields[i - 1]) + (typed ? FILL_PAUSE : FILL_STEP - ENTER_SECONDS)], []);
  const at = squeeze(sceneDuration, starts.at(-1) + Math.max(seconds(fields.at(-1)), ENTER_SECONDS));
  const parts = [];
  fields.forEach((f, i) => {
    const k = i + 1;
    const top = centres[i] - row.height / 2;
    const fieldY = top + row.labelH + row.tier.labelGap * u + row.fieldH / 2;
    const left = -width / 2;
    const label = textPart(id(`label-${k}`), f.label, left, top + row.labelH / 2, { fontSize: labelFs, maxWidth: width, fontWeight: 500, align: 'left', anchor: 'left', color: 'text2' });
    const field = rectPart(id(`field-${k}`), 0, fieldY, width, row.fieldH, { stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(14 * u) });
    for (const part of [label, field]) parts.push(enter(part, slot(i).map(at), { dy: 16 * u }));
    const value = textPart(id(`value-${k}`), f.value, left + FIELD_PAD_X * u, fieldY, { fontSize: valueFs, maxWidth: width - 2 * FIELD_PAD_X * u, fontWeight: 600, align: 'left', anchor: 'left', color: 'text' });
    const [start, end] = [at(starts[i]), at(starts[i] + ENTER_SECONDS)];
    const fade = enter(value, [start, end]);
    parts.push(typed
      ? { ...fade, typing: true, keyframes: merged([...fade.keyframes, { t: start, value: 0 }, { t: at(starts[i] + seconds(f)), value: typingLength(f.value) }]) }
      : fade);
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a form: labelled fields that come in, then fill one at a time, each value typed or faded in after the one before',
  params,
  describe: {
    fields: '2 to 4 rows in fill order; each { label up to 16 characters, value up to 24 }',
    typing: 'true types each value character by character (0.035 s each) instead of fading it in (default false)',
  },
  example: { fields: [{ label: 'Name', value: 'Ada Lovelace' }, { label: 'Email', value: 'ada@example.com' }, { label: 'Role', value: 'Engineer' }], typing: true },
  // Centred across and above the captions; to sit inside a browser-window, use that block's content rectangle instead.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (/^(label|value)-(\d+)$/.test(part) ? `fields[${Number(part.split('-')[1]) - 1}].${part.split('-')[0]}` : null),
  expand,
});

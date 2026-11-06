// form-fields: 2 to 4 labelled fields that appear together, then fill one at a time (each value lands after the one before
// is in), optionally typed character by character. It stands alone: place it over browser-window's content rectangle.
// A typed value is a typing text (`typing-k`, with the caret) while its row is the one being filled; when the next row
// starts, a static copy (`value-k`) takes its place, so one caret shows at a time, in the row being typed.
import { unit, contentWidth, fitText, fitSchedule, slot, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, abovePlace, LINE_HEIGHT, ENTER_SECONDS, MIN_TEXT } from './layout.mjs';
import { bottomShift } from './exit.mjs';
import { TYPING_SECONDS_PER_CHAR, typingLength } from '../defaults.mjs';
import { scheduleErrors } from './schedule-check.mjs';

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
const TYPE_PAUSE = 0.7; // seconds the caret stays on a typed value before the next row starts (long enough to read a one-word value)
const FADE_GAP = 0.2; // seconds between one faded-in value ending and the next starting
const SWAP_STEP = 0.001; // seconds a typed value takes to hand over to its static copy: between two frames
const HOLD_SECONDS = 1; // the finished form stays on screen at least this long

const isTyped = (p) => p.typing ?? params.properties.typing.default;
const fillSeconds = (p, f) => (isTyped(p) ? typingLength(f.value) * TYPING_SECONDS_PER_CHAR : ENTER_SECONDS);

// When each value starts and ends filling, and when the last one ends, at full speed (scene seconds).
function timing(p) {
  const gap = isTyped(p) ? TYPE_PAUSE : FADE_GAP;
  const starts = [];
  p.fields.forEach((f, i) => starts.push(i === 0 ? slot(p.fields.length - 1)[1] : starts[i - 1] + fillSeconds(p, p.fields[i - 1]) + gap));
  const ends = starts.map((s, i) => s + fillSeconds(p, p.fields[i]));
  return { starts, ends, end: ends.at(-1) };
}

const minDuration = (p) => timing(p).end + HOLD_SECONDS;

// The scene must hold every fill and then the finished form.
const validate = (p, ctx) => scheduleErrors(ctx, { path: 'fields', what: `${p.fields.length} fields ${isTyped(p) ? 'typed' : 'faded in'} in turn`, end: timing(p).end, minimum: minDuration(p) });

// The keyframes of the typing text of row i (times already mapped into the scene): it appears as typing starts, types to
// the end at `te`, and, unless it is the last row, is gone at `tn` (the next row's start) as its static copy lands.
function typingKeyframes(ts, te, tn, chars, gap) {
  const kfs = [{ t: ts, opacity: 0, value: 0 }, { t: ts + gap, opacity: 1 }, { t: te, value: chars }];
  return tn === null ? kfs : [...kfs, { t: tn - gap, opacity: 1 }, { t: tn, opacity: 0 }];
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { fields } = el.params;
  const typed = isTyped(el.params);
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
  // The labels and fields come in 0.2 s apart; then the values fill in order, each starting after the one before is done.
  const { starts, ends, end } = timing(el.params);
  const at = fitSchedule(sceneDuration, end, minDuration(el.params));
  const parts = [];
  fields.forEach((f, i) => {
    const k = i + 1;
    const top = centres[i] - row.height / 2;
    const fieldY = top + row.labelH + row.tier.labelGap * u + row.fieldH / 2;
    const left = -width / 2;
    const label = textPart(id(`label-${k}`), f.label, left, top + row.labelH / 2, { fontSize: labelFs, maxWidth: width, fontWeight: 500, align: 'left', anchor: 'left', color: 'text2' });
    const field = rectPart(id('field-' + k), 0, fieldY, width, row.fieldH, { stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(14 * u) });
    for (const part of [label, field]) parts.push(enter(part, slot(i).map(at), { dy: 16 * u }));
    const value = (name, extra) => textPart(id(`${name}-${k}`), f.value, left + FIELD_PAD_X * u, fieldY, { fontSize: valueFs, maxWidth: width - 2 * FIELD_PAD_X * u, fontWeight: 600, align: 'left', anchor: 'left', color: 'text', ...extra });
    if (!typed) {
      parts.push(enter(value('value'), [starts[i], starts[i] + ENTER_SECONDS].map(at)));
      return;
    }
    const [ts, te] = [at(starts[i]), at(ends[i])];
    const tn = i < fields.length - 1 ? at(starts[i + 1]) : null;
    const gap = Math.min(SWAP_STEP, (te - ts) / 3, tn === null ? Infinity : (tn - te) / 3);
    parts.push(value('typing', { typing: true, keyframes: typingKeyframes(ts, te, tn, typingLength(f.value), gap) }));
    if (tn !== null) parts.push(value('value', { keyframes: [{ t: tn - gap, opacity: 0 }, { t: tn, opacity: 1 }] }));
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a form: labelled fields that come in, then fill one at a time, each value typed or faded in after the one before',
  params,
  describe: {
    fields: '2 to 4 rows in fill order; each { label up to 16 characters, value up to 24 }',
    typing: 'true types each value character by character (0.035 s each) with the caret on the row being typed, instead of fading it in (default false); the scene must last until the last value is in, and 1 s more',
  },
  example: { fields: [{ label: 'Name', value: 'Ada Lovelace' }, { label: 'Email', value: 'ada@example.com' }, { label: 'Role', value: 'Engineer' }], typing: true },
  // Centred across and above the captions; to sit inside a browser-window, use that block's content rectangle instead.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  minDuration,
  validate,
  paramOf: (part) => (/^(label|value|typing)-(\d+)$/.test(part) ? `fields[${Number(part.split('-')[1]) - 1}].${part.startsWith('label') ? 'label' : 'value'}` : null),
  expand,
});

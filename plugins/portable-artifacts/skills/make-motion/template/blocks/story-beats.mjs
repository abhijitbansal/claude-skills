// story-beats: a short story told in five beats in one place, one at a time: hook, problem, reveal, proof (with an
// optional number counting up under it) and a call to action that stays. Beat i starts at i x beatSeconds.
import { unit, contentWidth, textWidth, fitHeight, sizeLadder, fitSchedule, textPart, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, centrePlace } from './layout.mjs';
import { DEFAULT_FPS } from '../defaults.mjs';
import { gridOf, frameCutoff } from '../frames.mjs';
import { hookKeyframes } from '../viral.mjs';

const short = { type: 'string', minLength: 1, maxLength: 6 };
const LIMIT = 999999999999;
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'problem', 'reveal', 'proof', 'cta'],
  properties: {
    hook: { type: 'string', minLength: 1, maxLength: 48 },
    problem: { type: 'string', minLength: 1, maxLength: 80 },
    reveal: { type: 'string', minLength: 1, maxLength: 80 },
    proof: { type: 'string', minLength: 1, maxLength: 80 },
    proofNumber: {
      type: 'object',
      additionalProperties: false,
      required: ['to'],
      properties: {
        to: { type: 'number', minimum: -LIMIT, maximum: LIMIT },
        prefix: short,
        suffix: short,
        decimals: { type: 'integer', minimum: 0, maximum: 4, default: 0 },
      },
    },
    cta: { type: 'string', minLength: 1, maxLength: 40 },
    beatSeconds: { type: 'number', minimum: 1.5, maximum: 4, default: 2.4 },
  },
};

export const BEATS = 5;
const FADE_SECONDS = 0.3; // each later beat fades in over this, and out over this before the next
const HOOK_SIZES = [112, 96, 80, 68, 56, 48, MIN_TEXT]; // px at 1080, largest first
const BEAT_SIZES = [88, 76, 64, 56, 48, 44, MIN_TEXT];
const COUNTER_SIZE = 160; // px at 1080: the proof number's largest size
const COUNTER_GAP = 24; // px at 1080 between the proof text and its number
const COUNTER_LINE = 1.1;
const EPSILON = 1e-9;

const beatSeconds = (p) => p.beatSeconds ?? params.properties.beatSeconds.default;
const minDuration = (p) => BEATS * beatSeconds(p);
const lastBeatIn = (p) => (BEATS - 1) * beatSeconds(p) + FADE_SECONDS;

// The scene must hold every beat, and its last rendered frame (frames.mjs) must come after the last beat is in: at a low
// render --fps the last frame can fall short of it.
function validate(p, ctx) {
  const { sceneDuration } = ctx;
  if (sceneDuration + EPSILON < minDuration(p)) return [{ path: 'beatSeconds', message: `${BEATS} beats × ${num(beatSeconds(p))}s need a scene of at least ${num(minDuration(p))}s` }];
  const fps = ctx.fps ?? DEFAULT_FPS;
  const fix = frameCutoff(gridOf({ ...ctx, fps }), { end: lastBeatIn(p), minimum: minDuration(p), tolerance: EPSILON });
  return fix === null ? [] : [{ path: 'beatSeconds', message: `${BEATS} beats × ${num(beatSeconds(p))}s: the last beat is in at ${num(lastBeatIn(p))}s, after the last frame at ${fps} fps; the scene must last at least ${fix}s` }];
}
const num = (n) => Number(n.toFixed(2));
// The number as the counter shows it, for sizing it so the widest value never wraps.
const shown = (n, { prefix = '', suffix = '', decimals = 0 }) => `${prefix}${n.toFixed(decimals)}${suffix}`;

function expand(el, ctx) {
  const { size, sceneDuration, fps } = ctx;
  const u = unit(size);
  const p = el.params;
  const b = beatSeconds(p);
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 1500 * u, 40 * u, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  const counterSize = p.proofNumber && Math.max(1, Math.round(MIN_TEXT * u), Math.floor(Math.min(COUNTER_SIZE * u, width / textWidth(shown(p.proofNumber.to, p.proofNumber), 1))));
  const counterH = (counterSize ?? 0) * COUNTER_LINE;
  const proofRoom = room - (counterSize ? counterH + COUNTER_GAP * u : 0);
  const fit = (text, sizes, maxHeight, lineHeight) => fitHeight(text, { sizes, maxWidth: width, maxHeight, lineHeight });
  const hookFit = fit(p.hook, sizeLadder(HOOK_SIZES, u), room, LINE_HEIGHT.title);
  // One size for the three middle beats and the call to action: the largest at which each fits its room.
  const rooms = { problem: room, reveal: room, proof: proofRoom, cta: room };
  const fontSize = Math.min(...Object.entries(rooms).map(([key, maxHeight]) => fit(p[key], sizeLadder(BEAT_SIZES, u), maxHeight).fontSize));
  const at = fitSchedule(sceneDuration, (BEATS - 1) * b + FADE_SECONDS, minDuration(p));
  // Beat i's opacity: in over [i b, i b + FADE], out over [(i + 1) b - FADE, (i + 1) b] (the last beat has no out).
  const fadeIn = (i) => [{ t: at(i * b), opacity: 0 }, { t: at(i * b + FADE_SECONDS), opacity: 1, ease: 'enter' }];
  const fadeOut = (i) => [{ t: at((i + 1) * b - FADE_SECONDS), opacity: 1 }, { t: at((i + 1) * b), opacity: 0, ease: 'exit' }];
  const [proofY, counterY] = counterSize ? stack([fit(p.proof, [fontSize], Infinity).height, counterH], [COUNTER_GAP * u]) : [0, 0];
  const beat = (key, i, y, color) => ({
    ...textPart(id(key), p[key], 0, y, { fontSize, maxWidth: width, fontWeight: 700, color }),
    keyframes: [...fadeIn(i), ...(i < BEATS - 1 ? fadeOut(i) : [])],
  });
  // The hook is on from t 0 with the viral hook entrance (a spec that is not viral gets it too), then fades out.
  const hook = textPart(id('hook'), p.hook, 0, 0, { fontSize: hookFit.fontSize, maxWidth: width, fontWeight: 800, role: 'title', color: 'text' });
  hook.keyframes = [...hookKeyframes(hook, sceneDuration, fps), ...fadeOut(0)].sort((x, y) => x.t - y.t);
  const parts = [hook, beat('problem', 1, 0, 'text'), beat('reveal', 2, 0, 'accent'), beat('proof', 3, proofY, 'text')];
  if (counterSize) {
    const n = p.proofNumber;
    const counter = { id: id('proof-number'), type: 'counter', x: 0, y: Math.round(counterY), from: 0, to: n.to, decimals: n.decimals ?? 0, fontSize: counterSize, fontWeight: 800, color: 'accent' };
    if (n.prefix !== undefined) counter.prefix = n.prefix;
    if (n.suffix !== undefined) counter.suffix = n.suffix;
    // The count runs while the proof is up: from the end of its fade-in until FADE before its fade-out begins.
    counter.keyframes = [
      { t: at(3 * b), opacity: 0, value: 0 },
      { t: at(3 * b + FADE_SECONDS), opacity: 1, ease: 'enter' },
      { t: at(4 * b - 2 * FADE_SECONDS), value: n.to, ease: 'outCubic' },
      ...fadeOut(3),
    ];
    parts.push(counter);
  }
  parts.push(beat('cta', 4, 0, 'accent'));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a five-beat story told one beat at a time in one place: hook, problem, reveal, proof (with an optional counting number) and a call to action',
  params,
  describe: {
    hook: 'the first beat, up to 48 characters; on screen from the first frame, so keep it to 3 to 7 words',
    problem: 'the second beat, up to 80 characters',
    reveal: 'the third beat, up to 80 characters',
    proof: 'the fourth beat, up to 80 characters',
    proofNumber: 'a number that counts up under the proof: { to, prefix?, suffix?, decimals? } (prefix and suffix up to 6 characters, decimals 0 to 4)',
    cta: 'the last beat, up to 40 characters; it stays to the end of the scene',
    beatSeconds: 'seconds each beat lasts, 1.5 to 4; the scene must last at least 5 beats',
  },
  example: { hook: 'Your edits take forever', problem: 'Every cut costs you another hour', reveal: 'One JSON file makes the video', proof: 'Time saved on every edit', proofNumber: { to: 63, suffix: '%' }, cta: 'Follow for the full workflow' },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  paramOf: (part) => (part === 'proof-number' ? 'proofNumber' : (Object.hasOwn(params.properties, part) ? part : null)),
  minDuration,
  validate,
  expand,
});

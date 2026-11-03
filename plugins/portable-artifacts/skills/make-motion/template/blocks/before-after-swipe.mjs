// before-after-swipe: two images (or two clips) in the same frame; the "after" slides in from the right over the
// "before" behind a vertical line, with a label pill on each corner. before-after (two counters) compares numbers.
import { unit, contentWidth, textWidth, fitText, fitHeight, sizeLadder, fitSchedule, slot, textPart, rectPart, linePart, enter, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';
import { DEFAULT_FPS } from '../defaults.mjs';
import { gridOf, frameCutoff } from '../frames.mjs';
import { isVideoSrc } from '../media.mjs';

const side = {
  type: 'object',
  additionalProperties: false,
  required: ['src', 'label'],
  properties: {
    src: { type: 'string', minLength: 1, maxLength: 80 },
    label: { type: 'string', minLength: 1, maxLength: 16 },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['before', 'after'],
  properties: {
    before: side,
    after: side,
    headline: { type: 'string', minLength: 1, maxLength: 40 },
    swipeAt: { type: 'number', minimum: 0, maximum: 58 },
  },
};

const SWIPE_SHARE = 0.4; // of the scene: the default `swipeAt`
const SWIPE_SECONDS = 0.6;
const HOLD_SECONDS = 0.4; // the finished swipe stays on screen at least this long before the scene ends
const SHOW_STEP = 0.001; // seconds after the swipe starts at which the waiting after frame and line show (between two frames)
const EPSILON = 1e-9;
const MAX_ASPECT = 1.25; // the frame is at most this much taller than wide
const HEADLINE_SIZES = [64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const LABEL_SIZE = 44; // px at 1080
const LINE_WIDTH = 6; // px at 1080: the leading edge's width
const GAP = 24; // px at 1080 between the headline and the frame, and from the frame's edge to a pill
const PILL_PAD = { x: 20, y: 10 };
const PARAM_OF = { 'before-label': 'before.label', 'after-label': 'after.label', headline: 'headline' }; // part -> param, for check.mjs hints

// A media element for `src`: a `video` (muted, so two clips do not talk over each other) when its extension is a video
// one, else an `image`; cover-fitted into width x height.
function media(id, src, x, y, width, height) {
  const base = { id, src, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), fit: 'cover' };
  return isVideoSrc(src) ? { ...base, type: 'video', mute: true } : { ...base, type: 'image' };
}

const num = (n) => Number(n.toFixed(2));
// The scene must hold the swipe, then HOLD_SECONDS of the finished frame.
const minDuration = (p) => (p.swipeAt ?? 0) + SWIPE_SECONDS + HOLD_SECONDS;
// When the swipe starts in a scene of `sceneDuration` (expand's rule), and when the last motion ends.
const swipeStart = (p, sceneDuration) => p.swipeAt ?? Math.max(0, Math.min(SWIPE_SHARE * sceneDuration, sceneDuration - SWIPE_SECONDS - HOLD_SECONDS));
const lastMotion = (p, sceneDuration) => Math.max(swipeStart(p, sceneDuration) + SWIPE_SECONDS, slot(p.headline ? 2 : 1)[1]);

// The scene must hold the swipe and the finished frame, and its last rendered frame (frames.mjs) must come after the swipe
// ends: at a low render --fps the last frame can fall short of it.
function validate(p, ctx) {
  const { sceneDuration } = ctx;
  if (sceneDuration + EPSILON < minDuration(p)) {
    return [{ path: 'swipeAt', message: `${p.swipeAt === undefined ? '' : `swipeAt ${num(p.swipeAt)}s + `}the ${SWIPE_SECONDS}s swipe and ${HOLD_SECONDS}s to show the result need a scene of at least ${num(minDuration(p))}s${p.swipeAt === undefined ? '' : `; use a swipeAt of at most ${num(Math.max(0, sceneDuration - SWIPE_SECONDS - HOLD_SECONDS))}s or a longer scene`}` }];
  }
  const fps = ctx.fps ?? DEFAULT_FPS;
  const fix = frameCutoff(gridOf({ ...ctx, fps }), { end: (d) => lastMotion(p, d), minimum: minDuration(p), tolerance: EPSILON });
  return fix === null ? [] : [{ path: 'swipeAt', message: `the swipe ends at ${num(lastMotion(p, sceneDuration))}s, after the last frame at ${fps} fps; the scene must last at least ${fix}s` }];
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { before, after, headline } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const frameW = contentWidth(size, 1700 * u, 0, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  const headFit = headline && fitHeight(headline, { sizes: sizeLadder(HEADLINE_SIZES, u), maxWidth: frameW, maxHeight: room / 3, lineHeight: LINE_HEIGHT.title });
  const frameH = Math.max(1, Math.min(frameW * MAX_ASPECT, room - (headFit ? headFit.height + GAP * u : 0)));
  const ys = stack([...(headFit ? [headFit.height] : []), frameH], [GAP * u]);
  const frameY = ys.at(-1);
  // A pill per label, side by side in the frame's top corners: each at most half the frame less the gaps.
  const pillTextW = Math.max(1, (frameW - 3 * GAP * u) / 2 - 2 * PILL_PAD.x * u);
  const labels = [before, after].map((s) => fitText(s.label, { size: LABEL_SIZE * u, min: MIN_TEXT * u, maxWidth: pillTextW, maxLines: 2 }));
  const pillH = Math.max(...labels.map((f) => f.height)) + 2 * PILL_PAD.y * u;
  const pillW = (i) => Math.min(pillTextW + 2 * PILL_PAD.x * u, textWidth(i ? after.label : before.label, labels[i].fontSize) + 2 * PILL_PAD.x * u);
  const pillY = frameY - frameH / 2 + GAP * u + pillH / 2;
  const pillX = (i) => (i ? 1 : -1) * (frameW / 2 - GAP * u - pillW(i) / 2);
  // The schedule: headline and the before frame come in first; the after frame slides in at swipeAt over SWIPE_SECONDS
  // while its label fades in. The validator demands room for all of it, and a scene that has it keeps these times.
  const swipeAt = el.params.swipeAt ?? Math.max(0, Math.min(SWIPE_SHARE * sceneDuration, sceneDuration - SWIPE_SECONDS - HOLD_SECONDS));
  const k = headFit ? 1 : 0; // the headline takes the first slot, the before frame and its pill follow
  const at = fitSchedule(sceneDuration, Math.max(swipeAt + SWIPE_SECONDS, slot(k + 1)[1]), minDuration(el.params));
  const span = (i) => slot(i).map(at);
  const offscreen = 1.5 * size[0] - el.x; // the after frame's centre while waiting, left of nothing on the canvas
  const slide = (part, from, to) => ({ ...part, keyframes: [{ t: at(swipeAt), x: Math.round(from) }, { t: at(swipeAt + SWIPE_SECONDS), x: Math.round(to), ease: 'move' }] });
  const stroke = Math.max(1, Math.round(LINE_WIDTH * u));
  const line = linePart(id('swipe-line'), 0, frameY, frameH, { stroke: 'accent', strokeWidth: stroke, rotate: 90 });
  const afterTo = 0;
  const lineTo = -frameW / 2 + stroke / 2; // inside the frame's left edge, so the line never leaves the safe area
  // The after frame and the line wait off the canvas, where a scene camera that zooms out or pans would show them; so they
  // sit in a group at opacity 0 until the swipe starts, and show in full SHOW_STEP later (a step, not a fade: the slide is
  // still off the canvas then, so a scene without a camera draws the same pixels as before).
  const shownAt = Math.min(at(swipeAt) + SHOW_STEP, (at(swipeAt) + at(swipeAt + SWIPE_SECONDS)) / 2);
  const swipeSide = {
    id: id('swipe'), type: 'group', x: 0, y: 0,
    children: [slide(media(id('after'), after.src, afterTo, frameY, frameW, frameH), offscreen, afterTo), slide(line, offscreen + lineTo, lineTo)],
    keyframes: [{ t: at(swipeAt), opacity: 0 }, { t: shownAt, opacity: 1 }],
  };
  const parts = [];
  if (headFit) parts.push(enter(textPart(id('headline'), headline, 0, ys[0], { fontSize: headFit.fontSize, maxWidth: frameW, fontWeight: 700, role: 'title', color: 'text' }), span(0), { dy: 24 * u }));
  // Both frames and the line first, then the pills on top, so neither label is ever covered by the swipe.
  parts.push(
    enter(media(id('before'), before.src, 0, frameY, frameW, frameH), span(k)),
    swipeSide,
    enter(rectPart(id('before-pill'), pillX(0), pillY, pillW(0), pillH, { fill: 'surface', radius: Math.round(pillH / 2), elevated: true }), span(k + 1)),
    enter(textPart(id('before-label'), before.label, pillX(0), pillY, { fontSize: labels[0].fontSize, maxWidth: pillW(0) - 2 * PILL_PAD.x * u, fontWeight: 700, color: 'text' }), span(k + 1)),
  );
  const landed = [swipeAt, swipeAt + SWIPE_SECONDS].map(at);
  parts.push(
    enter(rectPart(id('after-pill'), pillX(1), pillY, pillW(1), pillH, { fill: 'surface', radius: Math.round(pillH / 2), elevated: true }), landed),
    enter(textPart(id('after-label'), after.label, pillX(1), pillY, { fontSize: labels[1].fontSize, maxWidth: pillW(1) - 2 * PILL_PAD.x * u, fontWeight: 700, color: 'text' }), landed),
  );
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'two images or clips in one frame: the "after" slides in over the "before" behind a line, each with a label pill',
  params,
  describe: {
    before: '{ src, label }: the first picture or clip, relative to the spec file (png, jpg, svg; mp4, mov, webm or m4v is drawn as a muted video), and its label up to 16 characters',
    after: '{ src, label }: the second picture or clip, the same way; it slides in from the right over the first',
    headline: 'a line above the frame, up to 40 characters',
    swipeAt: 'scene seconds at which the swipe starts, 0 to 58 (default 0.4 of the scene); it takes 0.6 s and the scene must last 0.4 s past it',
  },
  example: { before: { src: 'swipe-before.png', label: 'Before' }, after: { src: 'swipe-after.png', label: 'After' } },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  assets: ['before.src', 'after.src'],
  minDuration,
  validate,
  paramOf: (part) => (Object.hasOwn(PARAM_OF, part) ? PARAM_OF[part] : null),
  expand,
});

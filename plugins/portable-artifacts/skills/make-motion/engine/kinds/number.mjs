// The `number` kind: one hero figure that counts up to its value, landing on the spoken figure, with a label and an
// optional delta. The figure is one text node whose words are the digits of every step of the count, each in a fixed
// numeral advance and shown by a stepped opacity track, so the count never jitters and needs no special drawing.
// An editorial composition (desk) sets it flush left on column 2 with the label in caps beside or under it and the
// kicker on a slug (slug.mjs); a stack (pop) sets it flush left on the stack's edge over a label tag and a delta tag.
// Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { ease } from '../time/ease.mjs';
import { layoutText, numeralAdvance } from '../text/layout.mjs';
import { gridX } from '../looks/index.mjs';
import { entrance, colourOf } from '../devices/shared.mjs';
import { glowStyle } from '../devices/glow.mjs';
import { track } from '../time/track.mjs';
import { editorialSpan, editorialBounds, editorialRight } from './editorial.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, setCase, inkBox, shownFrom,
  isEditorial, heroProblems, fieldNode, enterTracks, pulseScale, runInk, inkExtent,
  defaultCamera, onDevices, placeDevices, deviceCamera, openingLanding, plainTag, formatValue, NOT_BLANK, assertNoBlanks,
} from './shared.mjs';

export { formatValue } from './shared.mjs'; // where it lives now
import { NUMBER_WORDS, ONES, TENS } from './words.mjs';
import { stackArea, centredTop } from './stack.mjs';
import { slugNodes } from './slug.mjs';
import { orbitGeometry, orbitNodes, WIDE_SHARE } from './number-orbit.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const AFFIX_MAX = 8;
const LABEL_MAX = 60;
const DELTA_MAX = 24;
const KICKER_MAX = 40;
const DECIMALS_MAX = 3;
const FIGURE_STEP = 5;
const BESIDE_ROOM = 4; // the label beside the figure needs a quarter of the span
const ALL_DIGITS = '0123456789'; // every glyph a count shows, for the figure's tallest ink
const AFFIX_SHARE = 0.45; // prefix and suffix size, of the figure size
const AFFIX_GAP = 0.04; // em of the figure between the figure and a prefix or suffix
const COUNT_FALLBACK = 0.6; // of the shot: when the count lands with no spoken number
const MAX_COUNT_STEPS = 24; // distinct values a count may show on its way up
const BY_ONES = 20; // a whole number under this counts 0, 1, 2 ... to it
const MIN_COUNT = 0.5; // seconds: the least a count runs, landing no earlier than this into the shot
const LABEL_ROOM = 1.2; // seconds a shot keeps after the count lands, for the label to arrive and settle
const STEP_EPSILON = 1e-6;
// desk figure: up to 820 units for one or two digits (560 for more) across columns 2 to 9 (2 to 11 when not wide),
// baseline at 72%; the label in ink at step 4 over the delta, the delta's cap line 24 units under the label's baseline,
// the pair beside the figure (48 units after its ink) or under it (the label's ink 40 below the baseline)
const DESK = Object.freeze({ max: 560, maxShort: 820, toWide: 9, toTall: 11, baseline: 0.72, labelStep: 4, labelFromStep: 2, besideGap: 48, underGap: 40, deltaGap: 24 });
// pop figure: up to 900 units for one or two digits (760 for more) across the available width; label tag at step 3
// (step 2 at the least) 40 under the baseline; the delta's cap line 16 under the label tag; a kicker tag at step 2, 28
// over the figure's cap line
const POP = Object.freeze({ max: 760, maxShort: 900, tagGap: 40, tagStep: 3, tagFromStep: 2, deltaGap: 16, kickerStep: 2, kickerGap: 28 });
// the delta in either look: label caps at step 3 in ink2, on no plate
const DELTA = Object.freeze({ step: 3, text: 'ink2' }); // step 3: 1.25 times the label step or more (look review 2)
const SHORT_DIGITS = 2;
const RIGHT_EDGE = 13; // gridX's column for the right edge of column 12
const FIT_EPSILON = 1e-6;
const DELTA_LAG = 0.15; // seconds after the label lands
const FIT_TRIES = 6;
const NO_WRAP = 1e6;
const HALF = 2;
const DIGIT = /\d/;
const VALUE_LIMIT = 1e15; // larger figures lose integer precision and no layout holds them
// Words that start a spoken number by themselves; "one" and "a" start one only before a number word or unit.
const COUNT_WORDS = new Set([...ONES.filter((w) => w !== 'one'), ...TENS.filter(Boolean)]);
const WEAK_STARTS = new Set(['one', 'a']);
const NOT_DIGIT = /\D/g;
const NOT_LETTER = /[^a-z]/g;

// ---- the count ----

// A spoken word's lower-case letter parts, split on hyphens ("forty-one" -> forty, one).
const parts = (word) => word.text.toLowerCase().split('-').map((part) => part.replace(NOT_LETTER, '')).filter(Boolean);
const isNumberWord = (word) => word !== undefined && parts(word).some((part) => NUMBER_WORDS.has(part));

// Does a spoken number start at word i? A count word does; "one" or "a" only before a number word or unit, or when
// hyphenated to one ("one-hundred").
function startsNumber(words, i) {
  const [lead, ...rest] = parts(words[i]);
  if (lead === undefined) return false;
  if (WEAK_STARTS.has(lead)) return rest.some((part) => NUMBER_WORDS.has(part)) || isNumberWord(words[i + 1]);
  return COUNT_WORDS.has(lead) || rest.some((part) => COUNT_WORDS.has(part));
}

/**
 * When the count lands, on the best spoken match for the figure: a word whose digits equal the value's digits first,
 * then the first spoken number (so "in 2024, forty one percent" lands on "forty"), then any word with a digit, else
 * COUNT_FALLBACK of the shot.
 */
export function countLanding(timing, value, decimals) {
  const words = timing.words;
  const target = formatValue(Math.abs(value), decimals).replace(NOT_DIGIT, '');
  const exact = words.find((w) => DIGIT.test(w.text) && w.text.replace(NOT_DIGIT, '') === target);
  const spelt = words.find((_, i) => startsNumber(words, i));
  const anyDigit = words.find((w) => DIGIT.test(w.text));
  const best = exact ?? spelt ?? anyDigit;
  return best ? best.start : COUNT_FALLBACK * timing.duration;
}

// Shot-local seconds at which a number shot's figure reaches its value: the one place the landing is computed, read by
// expand (the picture) and by the kind's `landing` hook (scripts/v2/sound/events.mjs, the sound).
const landingOf = (shot, timing) => countLanding(timing, shot.value, shot.decimals ?? 0);

// A value part way through the count, cut toward zero at `decimals` so it never shows the final value early.
function partial(value, share, decimals) {
  const scale = 10 ** decimals;
  return Math.trunc(value * Math.min(1, share) * scale) / scale;
}

// The texts the count shows and when each appears, eased by the look's count ease from `start` to `land` (the final
// value exactly on `land`): `rate` steps a second and at most MAX_COUNT_STEPS values in all (the start value and the
// final one included), a step equal to the one before it merged into it. Each step shows from its time until the next
// one's, so exactly one is visible at any moment.
export function countSteps({ value, decimals, start, land, rate, curve }) {
  // a small whole number counts by ones (look review 2: a count of 0 then 9 never read as counting), evenly
  if (decimals === 0 && Number.isInteger(value) && value > 0 && value < BY_ONES) {
    return Array.from({ length: value + 1 }, (_, k) => ({ t: k === 0 ? 0 : start + ((land - start) * k) / value, text: formatValue(k, 0) }));
  }
  // floor, not ceil: the steps never come faster than `rate` (STEP_EPSILON keeps 0.6 s * 30 from flooring to 17)
  const frames = Math.min(MAX_COUNT_STEPS - 1, Math.max(1, Math.floor((land - start) * rate + STEP_EPSILON)));
  const final = formatValue(value, decimals);
  const steps = [];
  for (let k = 0; k <= frames; k++) {
    const text = k === frames ? final : formatValue(partial(value, curve(k / frames), decimals), decimals);
    const shown = k < frames && text === final ? steps.at(-1)?.text ?? formatValue(0, decimals) : text;
    if (steps.length === 0 || shown !== steps.at(-1).text) steps.push({ t: k === 0 ? 0 : start + ((land - start) * k) / frames, text: shown });
  }
  return steps;
}

// One text node holding every step's digits: each digit centred in a fixed advance, separators at their own width.
// In a centred composition every step is centred on the final value's ink centre, so the count grows from the middle.
// `right`: every step set flush with the final value's right edge (cosmos: a counter grows leftward from the unit, so
// the unit never stands apart from a short early value).
function digitsLayout(steps, font, measure, centred, right = false) {
  const tracking = (font.tracking ?? 0) * font.size;
  const advance = numeralAdvance(measure, font) + tracking;
  const words = [], wordTracks = [], meta = [];
  steps.forEach((step, k) => {
    const indexes = [];
    let x = 0;
    for (const ch of step.text) {
      const glyph = measure(ch, font).width;
      const cell = DIGIT.test(ch) ? advance : glyph + tracking;
      indexes.push(words.length);
      words.push({ text: ch, index: words.length, x: x + (cell - glyph) / HALF, width: glyph });
      wordTracks.push({ opacity: shownFrom(step.t, steps[k + 1]?.t) });
      x += cell;
    }
    meta.push({ text: step.text, t: step.t, words: indexes, width: x });
  });
  if (centred) centreSteps(words, meta);
  else if (right) meta.forEach((m) => { const shift = meta.at(-1).width - m.width; m.words.forEach((i) => { words[i] = { ...words[i], x: words[i].x + shift }; }); });
  const { ascent, descent } = measure('0', font);
  const width = meta.at(-1).width;
  const layout = { size: font.size, width, height: ascent + descent, lines: [{ x: 0, y: ascent, width, words }], overflow: false };
  // The final value's ink edges: the figure is aligned and the suffix set by these, not by the cells, so a narrow
  // first or last digit (a 1) leaves no hole at the margin or before the suffix.
  // Measured ink when the measure reports it (the page's canvas does), else the glyph's advance box.
  const final = meta.at(-1).words.map((i) => words[i]);
  const edges = (w) => {
    const m = measure(w.text, font);
    return { left: Number.isFinite(m.inkLeft) ? m.inkLeft : 0, right: Number.isFinite(m.inkRight) ? m.inkRight : w.width };
  };
  const inkLeft = final[0].x + edges(final[0]).left;
  return { layout, wordTracks, steps: meta, advance, ascent, inkLeft, inkWidth: final.at(-1).x + edges(final.at(-1)).right - inkLeft };
}

// Shift each step's words so its ink is centred where the final value's ink is.
function centreSteps(words, meta) {
  const centre = (step) => (words[step.words[0]].x + words[step.words.at(-1)].x + words[step.words.at(-1)].width) / HALF;
  const target = centre(meta.at(-1));
  for (const step of meta.slice(0, -1)) {
    const shift = target - centre(step);
    for (const i of step.words) words[i] = { ...words[i], x: words[i].x + shift };
  }
}

// ---- composition ----

function affix(text, font, measure) {
  if (text === undefined || text === '') return null;
  return layoutText({ text, font, maxWidth: NO_WRAP, measure });
}

// The figure at the largest size in [minSize, maxSize] whose row (prefix, digits, suffix) is at most `maxWidth`: it
// starts at maxSize and scales down in proportion until it fits. A row still too wide at minSize keeps that size and
// says so (its digits layout has overflow: true), as a statement that cannot fit does.
function figureAt(shot, ctx, { maxWidth, minSize, maxSize, steps }) {
  const { look, unit, measure } = ctx;
  const caps = (s) => (s === undefined ? s : setCase(look, 'display', s));
  const at = (size) => {
    const font = fontFor(look, 'display', size, unit);
    const small = fontFor(look, 'display', AFFIX_SHARE * size, unit);
    const digits = digitsLayout(steps, font, measure, look.composition === 'centred', look.kinds?.number?.countAlign === 'right');
    const prefix = affix(caps(shot.prefix), small, measure), suffix = affix(caps(shot.suffix), small, measure);
    const gap = AFFIX_GAP * size;
    const preW = prefix ? prefix.width + gap : 0, sufW = suffix ? suffix.width + gap : 0;
    return { size, font, small, digits, prefix, suffix, preW, total: preW + digits.inkWidth + sufW };
  };
  let fig = at(Math.floor(maxSize));
  for (let i = 0; i < FIT_TRIES && fig.total > maxWidth + FIT_EPSILON && fig.size > minSize; i++) {
    fig = at(Math.max(Math.ceil(minSize), Math.min(fig.size - 1, Math.floor((fig.size * maxWidth) / fig.total))));
  }
  if (fig.total <= maxWidth + FIT_EPSILON) return fig;
  return { ...fig, digits: { ...fig.digits, layout: { ...fig.digits.layout, overflow: true } } };
}

// The figure as a group at (left, baseline): prefix and suffix on the cap line. The group's origin, which its pop and
// pulse scale about, is the middle of its ink box in a centred composition and the middle of its left edge otherwise, so
// a flush-left figure grows from the edge it is set on and never leaves it.
function figureGroup(shot, ctx, fig, { left, baseline, tracks }) {
  const { look } = ctx;
  const hero = heroId(shot, 'value');
  const capTop = baseline - CAP_HEIGHT * fig.size;
  const gx = look.composition === 'centred' ? left + fig.total / HALF : left, gy = baseline - (CAP_HEIGHT * fig.size) / HALF;
  // a prefix or suffix on the figure's cap line, or on its baseline (look.kinds.number.affix 'baseline', cosmos: a unit
  // beside a figure, never an exponent)
  const onBaseline = look.kinds?.number?.affix === 'baseline';
  const affixY = (layout) => (onBaseline ? baseline - layout.lines[0].y : capTop + CAP_HEIGHT * layout.size - layout.lines[0].y) - gy;
  const digitsX = left + fig.preW - fig.digits.inkLeft;
  const inkRight = left + fig.preW + fig.digits.inkWidth;
  const children = [
    ...(fig.prefix ? [node('text', `${hero}.prefix`, { x: left - gx, y: affixY(fig.prefix), layout: fig.prefix, font: fig.small, fill: look.palette.ink, role: 'affix' })] : []),
    node('text', `${hero}.digits`, {
      x: digitsX - gx, y: baseline - fig.digits.ascent - gy, layout: fig.digits.layout, font: fig.font, fill: look.palette.ink, role: 'hero',
      steps: fig.digits.steps, advance: fig.digits.advance, ...(fig.digits.glowProps ?? {}),
    }, { wordTracks: fig.digits.wordTracks }),
    ...(fig.suffix ? [node('text', `${hero}.suffix`, { x: inkRight + AFFIX_GAP * fig.size - gx, y: affixY(fig.suffix), layout: fig.suffix, font: fig.small, fill: look.palette.ink, role: 'affix' })] : []),
  ];
  const group = node('group', hero, { x: gx, y: gy }, { tracks, children });
  return { group, hero, box: [left, capTop, fig.total, CAP_HEIGHT * fig.size] };
}

// A tag built twice when it must be placed by its size: first to measure, then at place(w, h, baseline), where
// `baseline` is how far its text baseline sits below its top (read from the tag's own text node).
function placedTag(ctx, id, text, at, place) {
  const tag = registries.devices.get('tag');
  const params = { id, text, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure };
  const probe = tag.build({ ...params, box: [0, 0, 1, 1] });
  const [, , w, h] = probe.boxes.tag;
  const label = probe.nodes[0].children.find((n) => n.type === 'text');
  const [x, y] = place(w, h, label.props.y + h / HALF + label.props.layout.lines[0].y);
  return tag.build({ ...params, box: [x, y, w, h] });
}

// ---- desk ----

// The figure with its glyph glow (devices/glow.mjs) lighting as it lands.
function glowingFigure(fig, ctx, times) {
  const { look, unit } = ctx;
  const glow = track([{ t: 0, v: 0 }, { t: times.land, v: 0 }, { t: times.land + look.moves.emphasize.dur, v: 1, ease: look.moves.emphasize.ease }]);
  return { ...fig, digits: { ...fig.digits, wordTracks: fig.digits.wordTracks.map((w) => ({ ...w, glow })), glowProps: glowStyle(look, fig.font, unit) } };
}

// The number of digits in the final value: one or two take the larger cap.
const digitCount = (steps) => steps.at(-1).text.replace(NOT_DIGIT, '').length;

// How far a laid-out text's first line reaches above its baseline and where its ink starts (the label caps' real ink).
const firstLineInk = (layout, font, measure) => runInk(layout.lines[0], font, measure);

// The delta: label caps at DELTA.step in DELTA.text on no plate, its ink flush left at `left` and its cap line at `top`,
// wrapped to `maxWidth`; it enters as a tag does (an object entrance about its centre). Its box runs from its ink edge
// and its cap line to just under its last baseline (WORD_DESCENT), as inkBox does.
function plainDelta(ctx, id, words, { left, top, maxWidth, at }) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, DELTA.step, unit), unit);
  const layout = layoutText({ text: setCase(look, 'label', words), font, maxWidth, measure });
  const x = left - firstLineInk(layout, font, measure).left, y = top + CAP_HEIGHT * font.size - layout.lines[0].y;
  const advance = inkBox(x, y, layout);
  const box = [left, advance[1], advance[0] + advance[2] - left, advance[3]]; // from the ink, which starts at `left`
  const cx = box[0] + box[2] / HALF, cy = box[1] + box[3] / HALF;
  const text = node('text', `${id}.text`, { x: x - cx, y: y - cy, layout, font, fill: colourOf(look, DELTA.text), role: 'tag' });
  return { nodes: [entrance({ id, at, look, unit, cx, cy, children: [text] })], box, descent: WORD_DESCENT * font.size };
}

// The label in the display face at scale step `step`, in ink, with its ink starting at `left`, wrapped to the right
// edge `right` (look review 1: mono capitals at headline size read as borrowed from another system).
function deskLabel(shot, ctx, left, step, right) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'display', sizeAt(look, step, unit), unit);
  const layout = layoutText({ text: setCase(look, 'display', shot.label), font, maxWidth: right - left, measure });
  const ink = firstLineInk(layout, font, measure);
  // up: first line's ink top to the last baseline
  return { font, layout, x: left - ink.left, up: ink.up + layout.lines.at(-1).y - layout.lines[0].y };
}

// desk: the figure flush left on column 2 by its ink, fitted to columns 2 to 9 (2 to 11 on vertical formats) between
// scale step 5 and DESK.maxShort units for one or two digits (DESK.max for more), its baseline at DESK.baseline of the
// height; no hairline. The label (label caps at step 4, in ink) over the delta (plain label caps at step 2, in ink2), the
// delta's cap line DESK.deltaGap under the label's baseline, so it reads figure, label, delta. When the figure is
// narrower than half the span the block stands beside it, DESK.besideGap after its ink, bottom-aligned on its baseline;
// otherwise it goes under it, the label's ink DESK.underGap below the baseline, all inside the bottom margin; a label
// too long for that at step 4, or too large beside a narrow figure, is set a step smaller, down to DESK.labelFromStep, so
// the figure keeps its top margin and is at least MIN_HERO_RATIO times the label.
// The desk figure, fitted to its span: columns 2 to DESK.toWide / toTall, or inside the 9:16 safe zone the whole safe
// width (columns 1 to the last), where a look may let the figure go down to scale step `fromStep`
// (look.kinds.number.fromStep), never under MIN_HERO_RATIO times the delta. With an orbit (number-orbit.mjs) the group
// is centred across the whole grid (columns 1 to the last) and the orbit kept inside it: the figure is fitted, refitted
// smaller in proportion when its orbit is too wide, and at the size floor set in an upright orbit (WIDE_SHARE).
function deskFigure(shot, ctx, { bounds, orbit, maxSize, steps }) {
  const { look, canvas, unit } = ctx;
  const deltaFloor = shot.delta === undefined ? 0 : Math.ceil(MIN_HERO_RATIO * sizeAt(look, DELTA.step, unit)) + 1;
  const minSize = bounds.safe ? Math.max(sizeAt(look, look.kinds?.number?.fromStep ?? FIGURE_STEP, unit), deltaFloor) : sizeAt(look, FIGURE_STEP, unit);
  const span = bounds.safe ? editorialSpan(ctx, 1, look.grid.columns) : editorialSpan(ctx, 2, isWide(canvas) ? DESK.toWide : DESK.toTall);
  if (orbit) return orbitFigure(shot, ctx, { span: editorialSpan(ctx, 1, look.grid.columns), orbit, minSize, maxSize, steps });
  return { left: span.x, span, fig: figureAt(shot, ctx, { maxWidth: span.w, minSize, maxSize, steps }) };
}

// The figure in an orbit centred in `span`, the orbit inside it; when the orbit is too wide for that, it may reach half a
// margin in from the frame's left edge (the platform's left band carries no buttons), the group set as far left as needed.
function orbitFigure(shot, ctx, { span, orbit, minSize, maxSize, steps }) {
  const right = span.x + span.w, minLeft = (ctx.look.grid.margin * ctx.unit) / HALF, room = right - minLeft;
  const first = figureAt(shot, ctx, { maxWidth: span.w, minSize, maxSize, steps });
  const geometryOf = (fig) => orbitGeometry({ width: fig.total, height: CAP_HEIGHT * fig.size }, orbit, room / HALF);
  const share = Math.min(1, room / (HALF * orbitGeometry({ width: first.total, height: CAP_HEIGHT * first.size }, orbit).hx));
  let fig = share < 1 ? figureAt(shot, ctx, { maxWidth: first.total * share, minSize, maxSize, steps }) : first;
  // at the size floor a tilted orbit cannot fit: the figure takes up to WIDE_SHARE of the room in an upright one
  if (fig.size <= minSize + 1) fig = figureAt(shot, ctx, { maxWidth: Math.min(first.total, WIDE_SHARE * room), minSize, maxSize, steps });
  const geometry = geometryOf(fig);
  const reach = geometry.hx - fig.total / HALF;
  const left = Math.min(Math.max(span.x + (span.w - fig.total) / HALF, minLeft + reach), right - reach - fig.total);
  return { left, span: { x: left, w: right - left }, fig, geometry };
}

function deskParts(shot, ctx, steps, times) {
  const { look, canvas, unit } = ctx;
  const extra = look.kinds?.number ?? {}; // look data a number may carry (cosmos): besideGap, orbit, glow, fromStep
  const bounds = editorialBounds(ctx);
  const rightEdge = bounds.safe ? editorialRight(ctx) : gridX(look, canvas, RIGHT_EDGE);
  const maxSize = (digitCount(steps) <= SHORT_DIGITS ? DESK.maxShort : DESK.max) * unit;
  const { left, span, fig, geometry } = deskFigure(shot, ctx, { bounds, orbit: extra.orbit, maxSize, steps });
  // how far the orbit reaches past the figure's cap box: right of it, and under its baseline
  const orbit = geometry ?? null;
  const past = orbit ? { x: orbit.hx - fig.total / HALF, y: orbit.hy - (CAP_HEIGHT * fig.size) / HALF } : { x: 0, y: 0 };
  // where the label's and delta's ink start: beside, its gap clear of the orbit as well
  const besideGap = (extra.besideGap ?? DESK.besideGap) * unit + past.x;
  // beside when the figure is under half the span and leaves a quarter of it for the label (an orbit's reach can eat it)
  const beside = fig.total < span.w / HALF && rightEdge - (left + fig.total + besideGap) >= span.w / BESIDE_ROOM;
  const blockLeft = beside ? left + fig.total + besideGap : left;
  const labelAt = times.land + look.moves.enter.dur;
  const deltaAt = (top) => plainDelta(ctx, `${shot.id}.delta`, shot.delta, { left: blockLeft, top, maxWidth: rightEdge - blockLeft, at: labelAt + DELTA_LAG });
  const probe = shot.delta === undefined ? null : deltaAt(0);
  const deltaUp = probe === null ? 0 : DESK.deltaGap * unit + probe.box[3] - probe.descent; // label baseline to delta baseline
  // under the figure, the label clears the orbit as well (it reaches that far below the baseline)
  const underGap = DESK.underGap * unit + past.y;
  const placeAt = (step) => {
    const label = deskLabel(shot, ctx, blockLeft, step, rightEdge);
    // in the safe zone the label's real descenders (from the Sun to you) stay over the band's bottom
    const labelDown = bounds.safe ? runInk(label.layout.lines.at(-1), label.font, ctx.measure).down : WORD_DESCENT * label.font.size;
    const below = beside ? 0 : underGap + label.up + deltaUp + (probe?.descent ?? labelDown);
    return { label, baseline: Math.min(bounds.at(DESK.baseline), bounds.bottom - below) };
  };
  // the figure keeps its top margin and stays MIN_HERO_RATIO times the label (the review hero rule)
  // in the safe zone the digits' own ink (a round 0 6 8 9 rises over the cap line) is held under the band's top
  const figUp = bounds.safe ? inkExtent(ALL_DIGITS, fig.font, ctx.measure).up : CAP_HEIGHT * fig.size;
  const clearsTop = ({ label, baseline }) => baseline - figUp >= bounds.top && fig.size >= MIN_HERO_RATIO * label.font.size;
  let placed = placeAt(DESK.labelStep);
  for (let step = DESK.labelStep - 1; step >= DESK.labelFromStep && !clearsTop(placed); step--) placed = placeAt(step);
  const { label, baseline } = placed;
  // the label's last baseline: over the delta, which sits on the figure baseline (beside), or under the figure
  const labelBaseline = beside ? baseline - deltaUp : baseline + underGap + label.up;
  const y = labelBaseline - label.layout.lines.at(-1).y;
  // with an orbit the figure opens in ink, counting (never a grey figure fading in)
  const fade = times.matched || orbit ? {} : { opacity: openingLanding(shot, ctx, times.start + look.moves.enter.dur, look.moves.enter, 0, 1) };
  const figure = figureGroup(shot, ctx, extra.glow ? glowingFigure(fig, ctx, times) : fig, { left, baseline, tracks: fade });
  const labelNode = node('text', `${shot.id}.label`, { x: label.x, y, layout: label.layout, font: label.font, fill: look.palette.ink, role: 'label' }, { tracks: enterTracks(look, unit, labelAt, { y }) });
  const boxes = { value: figure.box, label: inkBox(label.x, y, label.layout) };
  const orbitBox = { left: figure.box[0], width: figure.box[2], baseline, size: fig.size };
  const nodes = [...(orbit ? orbitNodes(shot.id, ctx, orbitBox, times, extra.orbit, orbit) : []), figure.group, labelNode];
  if (probe === null) return { nodes, boxes, hero: figure.hero };
  const delta = deltaAt(labelBaseline + DESK.deltaGap * unit);
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}

// ---- pop ----

// The area shrunk toward the frame's centre so that a camera punch the shot asks for (an `on` punch: a zoom about the
// frame's centre) keeps the block inside it at its peak (look review 2's taller band reaches near the safe edges).
function punchRoom(area, shot, ctx) {
  if (!(shot.on ?? []).some((e) => e.do === 'punch')) return area;
  const zoom = ctx.look.devices.punch?.scale ?? 1;
  const cx = ctx.canvas.w / HALF, cy = ctx.canvas.h / HALF;
  const left = cx - (cx - area.left) / zoom, top = cy - (cy - area.top) / zoom;
  const right = cx + (area.left + area.w - cx) / zoom, bottom = cy + (area.top + area.h - cy) / zoom;
  return { left, top, w: right - left, h: bottom - top };
}

// pop: the figure flush left on the stack's edge, filling the available width (the platform safe width on 9:16,
// columns 1 to 12 otherwise) between scale step 5 and POP.maxShort units for one or two digits (POP.max for more); the
// label a tag at step 3 POP.tagGap under its baseline; the delta plain label caps (plainDelta) POP.deltaGap under that;
// a kicker, when given, a tag at step 2 POP.kickerGap over the figure's cap line (as a stack statement sets it); all
// flush left, the block centred in the available height.
function popParts(shot, ctx, steps, times) {
  const { look, unit } = ctx;
  const area = punchRoom(stackArea(ctx), shot, ctx);
  const widest = (digitCount(steps) <= SHORT_DIGITS ? POP.maxShort : POP.max) * unit;
  const labelAt = times.land + look.moves.enter.dur;
  const style = look.devices.tag ?? {};
  const tagOf = (id, words, top, at, [fromStep, toStep]) => plainTag(ctx, id, words, {
    left: area.left, top, maxWidth: area.w, at, fromStep, toStep, fill: style.fill ?? 'ink', text: style.text ?? 'paper',
  });
  const labelTag = (top) => tagOf(`${shot.id}.label`, shot.label, top, labelAt, [POP.tagFromStep, POP.tagStep]);
  const kickerTag = (top) => tagOf(`${shot.id}.kicker`, shot.kicker, top, look.moves.enter.dur, [POP.kickerStep, POP.kickerStep]);
  const deltaTag = (top) => plainDelta(ctx, `${shot.id}.delta`, shot.delta, { left: area.left, top, maxWidth: area.w, at: labelAt + DELTA_LAG });
  // Measure the parts over and under the figure first, so the block is centred whole.
  const kickerH = shot.kicker === undefined ? 0 : kickerTag(0).box[3] + POP.kickerGap * unit;
  const labelH = labelTag(0).box[3];
  const deltaH = shot.delta === undefined ? 0 : POP.deltaGap * unit + deltaTag(0).box[3];
  // the figure no taller than the area leaves it, with room for a punch's scale (a tall band no longer caps it by width)
  const room = (area.h - kickerH - POP.tagGap * unit - labelH - deltaH) / (CAP_HEIGHT * (look.devices.punch?.scale ?? 1));
  const maxSize = Math.max(sizeAt(look, FIGURE_STEP, unit), Math.min(widest, room));
  const fig = figureAt(shot, ctx, { maxWidth: area.w, minSize: sizeAt(look, FIGURE_STEP, unit), maxSize, steps });
  const blockH = kickerH + CAP_HEIGHT * fig.size + POP.tagGap * unit + labelH + deltaH;
  const baseline = centredTop(area, blockH, ctx) + kickerH + CAP_HEIGHT * fig.size; // on the optical centre when tall
  const enterAt = times.start + look.moves.enter.dur;
  const tracks = times.matched
    ? { scale: pulseScale(look, { pulse: times.land }) }
    : { opacity: openingLanding(shot, ctx, enterAt, look.moves.enter, 0, 1), scale: pulseScale(look, { enterAt, pulse: times.land }) };
  const figure = figureGroup(shot, ctx, fig, { left: area.left, baseline, tracks });
  const label = labelTag(baseline + POP.tagGap * unit);
  const kicker = shot.kicker === undefined ? null : kickerTag(baseline - CAP_HEIGHT * fig.size - kickerH);
  const boxes = { value: figure.box, label: label.box, ...(kicker ? { kicker: kicker.box } : {}) };
  const nodes = [...(kicker ? kicker.nodes : []), figure.group, ...label.nodes];
  if (shot.delta === undefined) return { nodes, boxes, hero: figure.hero };
  const delta = deltaTag(label.box[1] + label.box[3] + POP.deltaGap * unit);
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}

function expandNumber(given, ctx) {
  assertNoBlanks(given, 'number'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit, fps } = ctx;
  // A negative value with a prefix reads "-$5": the minus goes in front of the prefix and the figure counts its size.
  const shot = given.value < 0 && given.prefix !== undefined ? { ...given, value: -given.value, prefix: `-${given.prefix}` } : given;
  // a count spoken at the very start still runs for MIN_COUNT seconds, so it is seen counting (look review 2), unless
  // that would leave the label under LABEL_ROOM seconds to land and hold before the shot ends
  const spoken = landingOf(shot, timing);
  const land = Math.max(spoken, Math.min(MIN_COUNT, timing.duration - LABEL_ROOM));
  const start = Math.max(0, land - Math.max(look.moves.count.dur, MIN_COUNT));
  // The count changes at the look's own rhythm: a hand look (desk) on its 12 fps step, a crisp one (pop) every frame.
  const rate = look.moves.draw.step ?? fps;
  const steps = countSteps({ value: shot.value, decimals: shot.decimals ?? 0, start, land, rate, curve: ease(look.moves.count.ease) });
  const times = { land, start, matched: arrivesMatched(shot, ctx) };
  const parts = isEditorial(look) ? deskParts(shot, ctx, steps, times) : popParts(shot, ctx, steps, times);
  const devices = onDevices(shot, ctx, { boxes: parts.boxes, defaultTarget: 'value' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...slugNodes(shot, ctx), ...parts.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: parts.boxes,
    hero: parts.hero,
    background: look.palette.paper,
  };
}

registries.kinds.add('number', {
  summary: 'One big figure that counts up to its value, with a label beside or under it, an optional change badge and an optional kicker (a slug in desk).',
  example: { id: 'rows', show: 'number', say: 'Four hundred fifty nine rows. One file.', value: 459, suffix: 'rows', label: 'in one file', delta: '+12%' },
  schema: {
    required: ['value', 'label'],
    properties: {
      value: { type: 'number', exclusiveMinimum: -VALUE_LIMIT, exclusiveMaximum: VALUE_LIMIT },
      prefix: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: AFFIX_MAX },
      suffix: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: AFFIX_MAX },
      decimals: { type: 'integer', minimum: 0, maximum: DECIMALS_MAX },
      label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX },
      delta: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: DELTA_MAX },
      kicker: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: KICKER_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'value',
  targets: (shot) => ['value', 'label', ...(shot.delta === undefined ? [] : ['delta'])],
  ids: (shot) => [heroId(shot, 'value')],
  validate: heroProblems,
  expand: expandNumber,
  landing: landingOf, // when the figure reaches its value, as expand lands it (read by scripts/v2/sound/events.mjs)
  numbered: true, // counts toward the slug numbers of a film
  showsWords: true, // the figure, its label and delta restate the narration: never captioned (engine/captions)
});

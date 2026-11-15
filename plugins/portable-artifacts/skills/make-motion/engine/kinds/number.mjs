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
import { gridSpan, gridX } from '../looks/index.mjs';
import { entrance, colourOf, polyline } from '../devices/shared.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, typeset, setCase, inkBox, shownFrom,
  isEditorial, requireDevice, heroProblems, fieldNode, enterTracks, pulseScale, runInk,
  defaultCamera, onDevices, placeDevices, deviceCamera,
} from './shared.mjs';
import { NUMBER_WORDS, ONES, TENS } from './words.mjs';
import { stackArea } from './stack.mjs';
import { slugNodes } from './slug.mjs';

const AFFIX_MAX = 8;
const LABEL_MAX = 60;
const DELTA_MAX = 24;
const KICKER_MAX = 40;
const DECIMALS_MAX = 3;
const FIGURE_STEP = 5;
const AFFIX_SHARE = 0.45; // prefix and suffix size, of the figure size
const AFFIX_GAP = 0.04; // em of the figure between the figure and a prefix or suffix
const COUNT_FALLBACK = 0.6; // of the shot: when the count lands with no spoken number
const MAX_COUNT_STEPS = 24; // distinct values a count may show on its way up
const STEP_EPSILON = 1e-6;
// desk figure: up to 820 units for one or two digits (560 for more) across columns 2 to 9 (2 to 11 when not wide),
// baseline at 72%; label caps at step 3 beside it (48 units on) or under it (40 below the baseline); delta tag 12 above
// the label, or 32 to its right
const DESK = Object.freeze({ max: 560, maxShort: 820, toWide: 9, toTall: 11, baseline: 0.72, labelStep: 3, besideGap: 48, underGap: 40, tagGap: 12, deltaGap: 32, deltaDrop: 16 });
// pop figure: up to 900 units for one or two digits (760 for more) across the available width; label tag at step 3
// (step 2 at the least) 40 under the baseline; delta tag at step 2 on a rule plate in ink, 16 under the label
const POP = Object.freeze({ max: 760, maxShort: 900, tagGap: 40, tagStep: 3, tagFromStep: 2, deltaGap: 16, deltaStep: 2, deltaFill: 'rule', deltaText: 'ink' });
const SHORT_DIGITS = 2;
const RIGHT_EDGE = 13; // gridX's column for the right edge of column 12
const TAG = Object.freeze({ padX: 0.32, padY: 0.2 }); // em of the tag's own size
const FIT_EPSILON = 1e-6;
const DELTA_LAG = 0.15; // seconds after the label lands
const FIT_TRIES = 6;
const NO_WRAP = 1e6;
const HALF = 2;
const DIGIT = /\d/;
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;
const VALUE_LIMIT = 1e15; // larger figures lose integer precision and no layout holds them
// Words that start a spoken number by themselves; "one" and "a" start one only before a number word or unit.
const COUNT_WORDS = new Set([...ONES.filter((w) => w !== 'one'), ...TENS.filter(Boolean)]);
const WEAK_STARTS = new Set(['one', 'a']);
const NOT_DIGIT = /\D/g;
const NOT_LETTER = /[^a-z]/g;

// ---- the count ----

/** The value as shown: fixed decimals, thousands grouped with commas, a leading minus for a negative value. */
export function formatValue(value, decimals) {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const sign = value < 0 && Number(Math.abs(value).toFixed(decimals)) !== 0 ? '-' : '';
  return `${sign}${whole.replace(THOUSANDS, ',')}${fraction === undefined ? '' : `.${fraction}`}`;
}

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
function digitsLayout(steps, font, measure, centred) {
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
    const digits = digitsLayout(steps, font, measure, look.composition === 'centred');
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
  const affixY = (layout) => capTop + CAP_HEIGHT * layout.size - layout.lines[0].y - gy;
  const digitsX = left + fig.preW - fig.digits.inkLeft;
  const inkRight = left + fig.preW + fig.digits.inkWidth;
  const children = [
    ...(fig.prefix ? [node('text', `${hero}.prefix`, { x: left - gx, y: affixY(fig.prefix), layout: fig.prefix, font: fig.small, fill: look.palette.ink, role: 'affix' })] : []),
    node('text', `${hero}.digits`, {
      x: digitsX - gx, y: baseline - fig.digits.ascent - gy, layout: fig.digits.layout, font: fig.font, fill: look.palette.ink, role: 'hero',
      steps: fig.digits.steps, advance: fig.digits.advance,
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

// The number of digits in the final value: one or two take the larger cap.
const digitCount = (steps) => steps.at(-1).text.replace(NOT_DIGIT, '').length;

// How far a laid-out text's first line reaches above its baseline and where its ink starts (the label caps' real ink).
const firstLineInk = (layout, font, measure) => runInk(layout.lines[0], font, measure);

// desk: the figure flush left on column 2 by its ink, fitted to columns 2 to 9 (2 to 11 on vertical formats) between
// scale step 5 and DESK.maxShort units for one or two digits (DESK.max for more), its baseline at DESK.baseline of the
// height; no hairline. The label in label caps at step 3: beside the figure on its baseline, DESK.besideGap after its
// ink, when the figure is narrower than half the span, with the delta tag DESK.tagGap above it; otherwise under it, its
// ink DESK.underGap below the baseline, with the delta tag DESK.deltaGap to its right on its last line (under it when
// that would pass the right margin).
function deskParts(shot, ctx, steps, times) {
  const { look, canvas, unit, measure } = ctx;
  const span = gridSpan(look, canvas, 2, isWide(canvas) ? DESK.toWide : DESK.toTall);
  const left = span.x;
  const maxSize = (digitCount(steps) <= SHORT_DIGITS ? DESK.maxShort : DESK.max) * unit;
  const fig = figureAt(shot, ctx, { maxWidth: span.w, minSize: sizeAt(look, FIGURE_STEP, unit), maxSize, steps });
  const beside = fig.total < span.w / HALF;
  const font = fontFor(look, 'label', sizeAt(look, DESK.labelStep, unit), unit);
  const labelLeft = beside ? left + fig.total + DESK.besideGap * unit : left; // where the label's ink starts
  const right = gridX(look, canvas, RIGHT_EDGE);
  const layout = layoutText({ text: setCase(look, 'label', shot.label), font, maxWidth: right - labelLeft, measure });
  const ink = firstLineInk(layout, font, measure);
  const x = labelLeft - ink.left;
  const below = beside ? 0 : DESK.underGap * unit + ink.up + layout.lines.at(-1).y - layout.lines[0].y + font.size * WORD_DESCENT;
  const deltaRoom = beside || shot.delta === undefined ? 0 : DESK.deltaDrop * unit + tagHeight(ctx, shot.delta);
  const baseline = Math.min(DESK.baseline * canvas.h, canvas.h - look.grid.margin * unit - below - deltaRoom);
  const y = beside ? baseline - layout.lines.at(-1).y : baseline + DESK.underGap * unit + ink.up - layout.lines[0].y;
  const fade = times.matched ? {} : { opacity: enterTracks(look, unit, times.start + look.moves.enter.dur).opacity };
  const figure = figureGroup(shot, ctx, fig, { left, baseline, tracks: fade });
  const labelAt = times.land + look.moves.enter.dur;
  const label = node('text', `${shot.id}.label`, { x, y, layout, font, fill: look.palette.ink2, role: 'label' }, { tracks: enterTracks(look, unit, labelAt, { y }) });
  const boxes = { value: figure.box, label: inkBox(x, y, layout) };
  const nodes = [figure.group, label];
  if (shot.delta === undefined) return { nodes, boxes, hero: figure.hero };
  requireDevice(look, 'tag', 'number');
  const at = labelAt + DELTA_LAG;
  const delta = beside
    ? deltaAbove(shot, ctx, { left: labelLeft, inkTop: y + layout.lines[0].y - ink.up, at })
    : deltaBeside(shot, ctx, { x, y, line: layout.lines.at(-1), below: boxes.label, left: labelLeft, right, at });
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}

// The height of the tag device's plate for `text` (it sizes itself from its text).
function tagHeight(ctx, text) {
  const params = { id: 'probe', text: typeset(text), at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure, box: [0, 0, 1, 1] };
  return registries.devices.get('tag').build(params).boxes.tag[3];
}

// The delta tag directly over the label: flush with its ink, DESK.tagGap above its first line's ink.
function deltaAbove(shot, ctx, { left, inkTop, at }) {
  const tag = placedTag(ctx, `${shot.id}.delta`, typeset(shot.delta), at, (w, h) => [left, inkTop - DESK.tagGap * ctx.unit - h]);
  return { nodes: tag.nodes, box: tag.boxes.tag };
}

// The delta tag DESK.deltaGap after the label's last line, its text on that line's baseline; under the label, flush
// with its ink, when that would pass the right margin.
function deltaBeside(shot, ctx, { x, y, line, below, left, right, at }) {
  const tag = placedTag(ctx, `${shot.id}.delta`, typeset(shot.delta), at, (w, h, tagBaseline) => {
    const beside = [x + line.x + line.width + DESK.deltaGap * ctx.unit, y + line.y - tagBaseline];
    return beside[0] + w <= right ? beside : [left, below[1] + below[3] + DESK.deltaDrop * ctx.unit];
  });
  return { nodes: tag.nodes, box: tag.boxes.tag };
}

// ---- pop ----

// A tag built from plain nodes at a chosen scale step (the tag device sets every tag at step 2): `fill` behind label
// caps in `text` colour (palette keys), at `toStep`, set smaller (down to `fromStep`) and then wrapped when it is wider
// than `maxWidth`. Its plate's top left at (left, top); it enters as an object device does.
function plainTag(ctx, id, words, { left, top, maxWidth, at, fromStep, toStep, fill, text }) {
  const { look, unit, measure } = ctx;
  const shown = setCase(look, 'label', words);
  const padded = (size, width) => width + HALF * TAG.padX * size;
  const oneLine = (size) => layoutText({ text: shown, font: fontFor(look, 'label', size, unit), maxWidth: NO_WRAP, measure });
  let size = sizeAt(look, toStep, unit);
  const first = padded(size, oneLine(size).width);
  if (first > maxWidth) size = Math.max(sizeAt(look, fromStep, unit), Math.floor((size * maxWidth) / first));
  const font = fontFor(look, 'label', size, unit);
  const layout = layoutText({ text: shown, font, maxWidth: maxWidth - HALF * TAG.padX * size, measure });
  const w = padded(size, layout.width), h = layout.height + HALF * TAG.padY * size;
  const corners = [[-w / HALF, -h / HALF], [w / HALF, -h / HALF], [w / HALF, h / HALF], [-w / HALF, h / HALF]];
  const plate = node('path', `${id}.plate`, { d: polyline(corners, true), fill: colourOf(look, fill) });
  const label = node('text', `${id}.text`, {
    x: -w / HALF + TAG.padX * size, y: -h / HALF + TAG.padY * size, layout, font, fill: colourOf(look, text), role: 'tag',
  });
  const group = entrance({ id, at, look, unit, cx: left + w / HALF, cy: top + h / HALF, children: [plate, label] });
  return { nodes: [group], box: [left, top, w, h] };
}

// pop: the figure flush left on the stack's edge, filling the available width (the platform safe width on 9:16,
// columns 1 to 12 otherwise) between scale step 5 and POP.maxShort units for one or two digits (POP.max for more); the
// label a tag at step 3 POP.tagGap under its baseline; the delta a second tag (rule plate, ink text) POP.deltaGap under
// that; all flush left, the block centred in the available height.
function popParts(shot, ctx, steps, times) {
  const { look, unit } = ctx;
  const area = stackArea(ctx);
  const maxSize = (digitCount(steps) <= SHORT_DIGITS ? POP.maxShort : POP.max) * unit;
  const fig = figureAt(shot, ctx, { maxWidth: area.w, minSize: sizeAt(look, FIGURE_STEP, unit), maxSize, steps });
  const labelAt = times.land + look.moves.enter.dur;
  const style = look.devices.tag ?? {};
  const labelTag = (top) => plainTag(ctx, `${shot.id}.label`, shot.label, {
    left: area.left, top, maxWidth: area.w, at: labelAt, fromStep: POP.tagFromStep, toStep: POP.tagStep, fill: style.fill ?? 'ink', text: style.text ?? 'paper',
  });
  const deltaTag = (top) => plainTag(ctx, `${shot.id}.delta`, shot.delta, {
    left: area.left, top, maxWidth: area.w, at: labelAt + DELTA_LAG, fromStep: POP.deltaStep, toStep: POP.deltaStep, fill: POP.deltaFill, text: POP.deltaText,
  });
  // Measure the parts under the figure first, so the block is centred whole.
  const labelH = labelTag(0).box[3];
  const deltaH = shot.delta === undefined ? 0 : POP.deltaGap * unit + deltaTag(0).box[3];
  const blockH = CAP_HEIGHT * fig.size + POP.tagGap * unit + labelH + deltaH;
  const baseline = area.top + (area.h - blockH) / HALF + CAP_HEIGHT * fig.size;
  const enterAt = times.start + look.moves.enter.dur;
  const tracks = times.matched
    ? { scale: pulseScale(look, { pulse: times.land }) }
    : { opacity: enterTracks(look, unit, enterAt).opacity, scale: pulseScale(look, { enterAt, pulse: times.land }) };
  const figure = figureGroup(shot, ctx, fig, { left: area.left, baseline, tracks });
  const label = labelTag(baseline + POP.tagGap * unit);
  const boxes = { value: figure.box, label: label.box };
  const nodes = [figure.group, ...label.nodes];
  if (shot.delta === undefined) return { nodes, boxes, hero: figure.hero };
  const delta = deltaTag(label.box[1] + label.box[3] + POP.deltaGap * unit);
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}

function expandNumber(given, ctx) {
  const { look, timing, unit, fps } = ctx;
  // A negative value with a prefix reads "-$5": the minus goes in front of the prefix and the figure counts its size.
  const shot = given.value < 0 && given.prefix !== undefined ? { ...given, value: -given.value, prefix: `-${given.prefix}` } : given;
  const land = countLanding(timing, shot.value, shot.decimals ?? 0);
  const start = Math.max(0, land - look.moves.count.dur);
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
      prefix: { type: 'string', minLength: 1, maxLength: AFFIX_MAX },
      suffix: { type: 'string', minLength: 1, maxLength: AFFIX_MAX },
      decimals: { type: 'integer', minimum: 0, maximum: DECIMALS_MAX },
      label: { type: 'string', minLength: 1, maxLength: LABEL_MAX },
      delta: { type: 'string', minLength: 1, maxLength: DELTA_MAX },
      kicker: { type: 'string', minLength: 1, maxLength: KICKER_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'value',
  targets: (shot) => ['value', 'label', ...(shot.delta === undefined ? [] : ['delta'])],
  ids: (shot) => [heroId(shot, 'value')],
  validate: heroProblems,
  expand: expandNumber,
  numbered: true, // counts toward the slug numbers of a film
});

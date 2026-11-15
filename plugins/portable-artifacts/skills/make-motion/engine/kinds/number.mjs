// The `number` kind: one hero figure that counts up to its value, landing on the spoken figure, with a label and an
// optional delta. The figure is one text node whose words are the digits of every step of the count, each in a fixed
// numeral advance and shown by a stepped opacity track, so the count never jitters and needs no special drawing.
// `desk` sets it flush left on column 2 over a hairline and a label; `pop` centres it over a label tag. Pure and
// DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { ease } from '../time/ease.mjs';
import { layoutText, numeralAdvance } from '../text/layout.mjs';
import { gridX, gridSpan } from '../looks/index.mjs';
import {
  CAP_HEIGHT, WORD_DESCENT, HERO_SCHEMA, sizeAt, fontFor, heroId, arrivesMatched, typeset, fieldNode, enterTracks, pulseScale, wipeIn,
  rectPath, defaultCamera, onDevices, placeDevices, deviceCamera, unionBox,
} from './shared.mjs';

const AFFIX_MAX = 8;
const LABEL_MAX = 60;
const DELTA_MAX = 24;
const DECIMALS_MAX = 3;
const FIGURE_STEP = 5;
const LABEL_STEP = 2;
const AFFIX_SHARE = 0.45; // prefix and suffix size, of the figure size
const AFFIX_GAP = 0.04; // em of the figure between the figure and a prefix or suffix
const COUNT_FALLBACK = 0.6; // of the shot: when the count lands with no spoken number
const MAX_COUNT_STEPS = 24; // distinct values a count may show on its way up
const STEP_EPSILON = 1e-6;
const DESK = Object.freeze({ baseline: 0.56, ruleGap: 28, rule: 2, labelGap: 24, labelTo: 8, deltaGap: 24, deltaDrop: 16 });
const POP = Object.freeze({ tagGap: 40, deltaGap: 16 });
const DELTA_LAG = 0.15; // seconds after the label lands
const FIT_TRIES = 4;
const NO_WRAP = 1e6;
const HALF = 2;
const DIGIT = /\d/;
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'percent',
]);

// ---- the count ----

/** The value as shown: fixed decimals, thousands grouped with commas, a leading minus for a negative value. */
export function formatValue(value, decimals) {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const sign = value < 0 && Number(Math.abs(value).toFixed(decimals)) !== 0 ? '-' : '';
  return `${sign}${whole.replace(THOUSANDS, ',')}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** When the count lands: the first spoken word holding a digit or a number word, else COUNT_FALLBACK of the shot. */
export function countLanding(timing) {
  const spoken = timing.words.find((w) => DIGIT.test(w.text) || NUMBER_WORDS.has(w.text.toLowerCase().replace(/[^a-z]/g, '')));
  return spoken ? spoken.start : COUNT_FALLBACK * timing.duration;
}

// A value part way through the count, cut toward zero at `decimals` so it never shows the final value early.
function partial(value, share, decimals) {
  const scale = 10 ** decimals;
  return Math.trunc(value * Math.min(1, share) * scale) / scale;
}

// The texts the count shows and when each appears, eased by the look's count ease from `start` to `land` (the final
// value exactly on `land`): `rate` steps a second, at most MAX_COUNT_STEPS, a step equal to the one before it merged
// into it. Each step shows from its time until the next one's, so exactly one is visible at any moment.
function countSteps({ value, decimals, start, land, rate, curve }) {
  // floor, not ceil: the steps never come faster than `rate` (STEP_EPSILON keeps 0.6 s * 30 from flooring to 17)
  const frames = Math.min(MAX_COUNT_STEPS, Math.max(1, Math.floor((land - start) * rate + STEP_EPSILON)));
  const final = formatValue(value, decimals);
  const steps = [];
  for (let k = 0; k <= frames; k++) {
    const text = k === frames ? final : formatValue(partial(value, curve(k / frames), decimals), decimals);
    const shown = k < frames && text === final ? steps.at(-1)?.text ?? formatValue(0, decimals) : text;
    if (steps.length === 0 || shown !== steps.at(-1).text) steps.push({ t: k === 0 ? 0 : start + ((land - start) * k) / frames, text: shown });
  }
  return steps;
}

// A stepped 0/1 track: shown from `from` until `to` (forever when `to` is undefined).
function shownBetween(from, to) {
  const keys = from === 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: from, v: 0 }, { t: from, v: 1 }];
  if (to !== undefined) keys.push({ t: to, v: 1 }, { t: to, v: 0 });
  return { opacity: track(keys) };
}

// One text node holding every step's digits: each digit centred in a fixed advance, separators at their own width.
function digitsLayout(steps, font, measure) {
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
      wordTracks.push(shownBetween(step.t, steps[k + 1]?.t));
      x += cell;
    }
    meta.push({ text: step.text, t: step.t, words: indexes, width: x });
  });
  const { ascent, descent } = measure('0', font);
  const width = meta.at(-1).width;
  const layout = { size: font.size, width, height: ascent + descent, lines: [{ x: 0, y: ascent, width, words }], overflow: false };
  // The final value's ink edges: the figure is aligned and the suffix set by these, not by the cells, so a narrow
  // first or last digit (a 1) leaves no hole at the margin or before the suffix.
  const final = meta.at(-1).words.map((i) => words[i]);
  const inkLeft = final[0].x;
  return { layout, wordTracks, steps: meta, advance, ascent, inkLeft, inkWidth: final.at(-1).x + final.at(-1).width - inkLeft };
}

// ---- composition ----

function affix(text, font, measure) {
  if (text === undefined || text === '') return null;
  return layoutText({ text, font, maxWidth: NO_WRAP, measure });
}

// The figure at its size: digits, prefix and suffix, fitted down until the whole row is at most `maxWidth`.
function figureAt(shot, ctx, { maxWidth, steps }) {
  const { look, unit, measure } = ctx;
  const caps = (s) => {
    if (s === undefined) return s;
    return look.caps.display ? typeset(s).toUpperCase() : typeset(s);
  };
  let size = sizeAt(look, FIGURE_STEP, unit);
  for (let i = 0; i < FIT_TRIES; i++) {
    const font = fontFor(look, 'display', size, unit);
    const small = fontFor(look, 'display', AFFIX_SHARE * size, unit);
    const digits = digitsLayout(steps, font, measure);
    const prefix = affix(caps(shot.prefix), small, measure), suffix = affix(caps(shot.suffix), small, measure);
    const gap = AFFIX_GAP * size;
    const preW = prefix ? prefix.width + gap : 0, sufW = suffix ? suffix.width + gap : 0;
    const total = preW + digits.inkWidth + sufW;
    if (total <= maxWidth || i === FIT_TRIES - 1) return { size, font, small, digits, prefix, suffix, preW, total };
    size = Math.floor((size * maxWidth) / total);
  }
  throw new Error('unreachable');
}

// The figure as a group centred on its ink box at (left, baseline): prefix and suffix on the cap line.
function figureGroup(shot, ctx, fig, { left, baseline, tracks }) {
  const { look } = ctx;
  const hero = heroId(shot, 'value');
  const capTop = baseline - CAP_HEIGHT * fig.size;
  const gx = left + fig.total / HALF, gy = baseline - (CAP_HEIGHT * fig.size) / HALF;
  const affixY = (layout) => capTop + CAP_HEIGHT * layout.size - layout.lines[0].y - gy;
  const digitsX = left + fig.preW - fig.digits.inkLeft;
  const inkRight = left + fig.preW + fig.digits.inkWidth;
  const children = [
    ...(fig.prefix ? [node('text', `${hero}.prefix`, { x: left - gx, y: affixY(fig.prefix), layout: fig.prefix, font: fig.small, fill: look.palette.ink })] : []),
    node('text', `${hero}.digits`, {
      x: digitsX - gx, y: baseline - fig.digits.ascent - gy, layout: fig.digits.layout, font: fig.font, fill: look.palette.ink,
      steps: fig.digits.steps, advance: fig.digits.advance,
    }, { wordTracks: fig.digits.wordTracks }),
    ...(fig.suffix ? [node('text', `${hero}.suffix`, { x: inkRight + AFFIX_GAP * fig.size - gx, y: affixY(fig.suffix), layout: fig.suffix, font: fig.small, fill: look.palette.ink })] : []),
  ];
  const group = node('group', hero, { x: gx, y: gy }, { tracks, children });
  return { group, hero, box: [left, capTop, fig.total, CAP_HEIGHT * fig.size] };
}

const textBox = (x, y, layout) => unionBox(layout.lines.map((l) => [x + l.x, y + l.y - CAP_HEIGHT * layout.size, l.width, (CAP_HEIGHT + WORD_DESCENT) * layout.size]));

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

function deskParts(shot, ctx, steps, times) {
  const { look, canvas, unit, measure } = ctx;
  const left = gridX(look, canvas, 2);
  const fig = figureAt(shot, ctx, { maxWidth: gridX(look, canvas, 12) - look.grid.gutter * unit - left, steps });
  const baseline = DESK.baseline * canvas.h;
  const fade = times.matched ? {} : { opacity: enterTracks(look, unit, times.start + look.moves.enter.dur).opacity };
  const figure = figureGroup(shot, ctx, fig, { left, baseline, tracks: fade });
  const span = gridSpan(look, canvas, 2, DESK.labelTo);
  const ruleY = baseline + DESK.ruleGap * unit;
  const font = fontFor(look, 'text', sizeAt(look, LABEL_STEP, unit), unit);
  const layout = layoutText({ text: typeset(shot.label), font, maxWidth: span.w, measure });
  const y = ruleY + (DESK.rule + DESK.labelGap) * unit - (layout.lines[0].y - CAP_HEIGHT * font.size);
  const labelAt = times.land + look.moves.enter.dur;
  const label = node('text', `${shot.id}.label`, { x: left, y, layout, font, fill: look.palette.ink2 }, { tracks: enterTracks(look, unit, labelAt, { y }) });
  const boxes = { value: figure.box, label: textBox(left, y, layout) };
  const delta = shot.delta === undefined ? null : deskDelta(shot, ctx, { left, y, line: layout.lines[0], below: boxes.label, at: labelAt + DELTA_LAG });
  // The hairline spans columns 2 to 8, stopping short of a delta tag that rises into it.
  const ruleEnd = delta && delta.box[1] < ruleY + DESK.rule * unit + DESK.labelGap * unit ? Math.min(left + span.w, delta.box[0] - DESK.deltaGap * unit) : left + span.w;
  const rule = node('path', `${shot.id}.rule`, { x: left, y: ruleY, d: rectPath(ruleEnd - left, DESK.rule * unit), fill: look.palette.rule }, { tracks: wipeIn(look, times.land + look.moves.draw.dur) });
  const nodes = [figure.group, rule, label, ...(delta ? delta.nodes : [])];
  return { nodes, boxes: delta ? { ...boxes, delta: delta.box } : boxes, hero: figure.hero };
}

// The delta tag beside the label's first line, its text on the label's baseline; under the label when the line
// leaves no room before the right margin.
function deskDelta(shot, ctx, { left, y, line, below, at }) {
  const { look, canvas, unit } = ctx;
  const right = canvas.w - look.grid.margin * unit;
  const tag = placedTag(ctx, `${shot.id}.delta`, typeset(shot.delta), at, (w, h, tagBaseline) => {
    const beside = left + line.x + line.width + DESK.deltaGap * unit;
    if (beside + w <= right) return [beside, y + line.y - tagBaseline];
    return [left, below[1] + below[3] + DESK.deltaDrop * unit];
  });
  return { nodes: tag.nodes, box: tag.boxes.tag };
}

// ---- pop ----

// The label as a tag when it fits the measure, else as centred caps label text.
function popLabel(shot, ctx, { span, top, at }) {
  const { look, unit, measure } = ctx;
  const tag = placedTag(ctx, `${shot.id}.label`, typeset(shot.label), at, (w) => [span.x + (span.w - w) / HALF, top]);
  if (tag.boxes.tag[2] <= span.w) return { nodes: tag.nodes, box: tag.boxes.tag };
  const font = fontFor(look, 'label', sizeAt(look, LABEL_STEP, unit), unit);
  const layout = layoutText({ text: look.caps.label ? typeset(shot.label).toUpperCase() : typeset(shot.label), font, maxWidth: span.w, align: 'center', measure });
  const y = top - (layout.lines[0].y - CAP_HEIGHT * font.size);
  const text = node('text', `${shot.id}.label`, { x: span.x, y, layout, font, fill: look.palette.ink }, { tracks: enterTracks(look, unit, at) });
  return { nodes: [text], box: textBox(span.x, y, layout) };
}

function popDelta(shot, ctx, { span, top, at }) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, LABEL_STEP, unit), unit);
  const layout = layoutText({ text: look.caps.label ? typeset(shot.delta).toUpperCase() : typeset(shot.delta), font, maxWidth: span.w, align: 'center', measure });
  const y = top - (layout.lines[0].y - CAP_HEIGHT * font.size);
  const text = node('text', `${shot.id}.delta`, { x: span.x, y, layout, font, fill: look.palette.ink2 }, { tracks: enterTracks(look, unit, at) });
  return { nodes: [text], box: textBox(span.x, y, layout) };
}

function popParts(shot, ctx, steps, times) {
  const { look, canvas, unit } = ctx;
  const span = gridSpan(look, canvas, 2, 11);
  const fig = figureAt(shot, ctx, { maxWidth: span.w, steps });
  const labelAt = times.land + look.moves.enter.dur;
  // Measure the parts under the figure first, so figure, label and delta are centred together.
  const probeLabel = popLabel(shot, ctx, { span, top: 0, at: labelAt });
  const probeDelta = shot.delta === undefined ? null : popDelta(shot, ctx, { span, top: 0, at: labelAt + DELTA_LAG });
  const below = POP.tagGap * unit + probeLabel.box[3] + (probeDelta ? POP.deltaGap * unit + probeDelta.box[3] : 0);
  const capTop = (canvas.h - CAP_HEIGHT * fig.size - below) / HALF;
  const baseline = capTop + CAP_HEIGHT * fig.size;
  const enterAt = times.start + look.moves.enter.dur;
  const tracks = times.matched
    ? { scale: pulseScale(look, { pulse: times.land }) }
    : { opacity: enterTracks(look, unit, enterAt).opacity, scale: pulseScale(look, { enterAt, pulse: times.land }) };
  const figure = figureGroup(shot, ctx, fig, { left: canvas.w / HALF - fig.total / HALF, baseline, tracks });
  const label = popLabel(shot, ctx, { span, top: baseline + POP.tagGap * unit, at: labelAt });
  const boxes = { value: figure.box, label: label.box };
  const nodes = [figure.group, ...label.nodes];
  if (!probeDelta) return { nodes, boxes, hero: figure.hero };
  const delta = popDelta(shot, ctx, { span, top: label.box[1] + label.box[3] + POP.deltaGap * unit, at: labelAt + DELTA_LAG });
  return { nodes: [...nodes, ...delta.nodes], boxes: { ...boxes, delta: delta.box }, hero: figure.hero };
}

function expandNumber(shot, ctx) {
  const { look, timing, unit, fps } = ctx;
  const land = countLanding(timing);
  const start = Math.max(0, land - look.moves.count.dur);
  // The count changes at the look's own rhythm: a hand look (desk) on its 12 fps step, a crisp one (pop) every frame.
  const rate = look.moves.draw.step ?? fps;
  const steps = countSteps({ value: shot.value, decimals: shot.decimals ?? 0, start, land, rate, curve: ease(look.moves.count.ease) });
  const times = { land, start, matched: arrivesMatched(shot, ctx) };
  const parts = look.emphasis === 'highlight' ? deskParts(shot, ctx, steps, times) : popParts(shot, ctx, steps, times);
  const devices = onDevices(shot, ctx, { boxes: parts.boxes, defaultTarget: 'value' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...parts.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: parts.boxes,
    hero: parts.hero,
    background: look.palette.paper,
  };
}

registries.kinds.add('number', {
  schema: {
    required: ['value', 'label'],
    properties: {
      value: { type: 'number' },
      prefix: { type: 'string', minLength: 1, maxLength: AFFIX_MAX },
      suffix: { type: 'string', minLength: 1, maxLength: AFFIX_MAX },
      decimals: { type: 'integer', minimum: 0, maximum: DECIMALS_MAX },
      label: { type: 'string', minLength: 1, maxLength: LABEL_MAX },
      delta: { type: 'string', minLength: 1, maxLength: DELTA_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'value',
  targets: (shot) => ['value', 'label', ...(shot.delta === undefined ? [] : ['delta'])],
  ids: (shot) => [heroId(shot, 'value')],
  expand: expandNumber,
});

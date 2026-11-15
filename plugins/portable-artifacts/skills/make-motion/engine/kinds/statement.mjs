// The `statement` kind: a line of type as the whole frame, its words arriving as they are spoken. An editorial
// composition (desk) sets it flush left on column 2, sized to carry the frame, its ink centred at 50% of the height,
// with the kicker on a slug card in the top right (slug.mjs); a centred one centres it on the composition with the
// kicker above; a stack (pop) sets each line at its own size to fill the width (stack.mjs). Emphasis follows the look's
// emphasis system: a highlight behind each emphasised run (desk), or a recolour (with a pulse for recolor-scale).
// In a mode that reads from frame 0 (viral) every word is on screen from the first frame as a ghost (ink at 0.4) and
// lights as it is spoken. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridSpan } from '../looks/index.mjs';
import { ease } from '../time/ease.mjs';
import { landing } from '../devices/shared.mjs';
import { parseSay, SayError } from '../script/say.mjs';
import {
  CAP_HEIGHT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, wordsOf, fitDisplay, inkSpan, setCase, capBox,
  isEditorial, requireDevice, heroProblems, compositionRect, fieldNode, enterTracks, pulseScale,
  defaultCamera, onDevices, placeDevices, deviceCamera, unionBox, runInk, ghostTracks,
} from './shared.mjs';
import { wordTimes } from './words.mjs';
import { slugBox, slugNodes, SLUG } from './slug.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { composeStack, stackNodes } from './stack.mjs';
import { BAND_HEIGHT } from '../devices/highlight.mjs';

const TEXT_MAX = 200;
const KICKER_MAX = 40;
// desk: fitted between scale step 3 and 300 units, its block at most 64% of the height, ink centred at 50%; columns 2
// to 9 (2 to 11 on vertical formats), and with a slug no narrower than columns 2 to 5, trading size for a better break
// no lower than 3 times its kicker
const DESK = Object.freeze({ centre: 0.5, height: 0.64, fromStep: 3, max: 300, toWide: 9, toTall: 11, minTo: 5 });
const POP = Object.freeze({ fromStep: 3, toStep: 5 }); // so a long word can shrink the block
const FIRST_COLUMN = 2;
const CENTRED_TO = 11;
const KICKER = Object.freeze({ step: 1, gap: 28, ruleGap: 12, rule: 2 }); // a centred look's kicker above the text
// The highlighter band behind a run reaches this far (em of the text) past the run's highest and lowest ink.
const HIGHLIGHT_PAST_INK = 0.06;
const EMPHASIS_SHARE = 0.5; // emphasis on this share of a statement's words or more is a creative finding (highlight looks)
const FILL_EASE = 'outCubic';
const HALF = 2;

function sourceText(shot, look) {
  const text = shot.text ?? (shot.say === undefined ? undefined : parseSay(shot.say).plain);
  if (typeof text !== 'string' || wordsOf(text).length === 0) throw new Error(`statement: shot "${shot.id}" needs text or say`);
  return setCase(look, 'display', text);
}

// The kicker's height above the text's cap line, so the text is fitted with room for it.
const kickerRoom = (look, unit) => (KICKER.gap + look.scale[KICKER.step - 1] * CAP_HEIGHT + KICKER.ruleGap + KICKER.rule) * unit;

// together[i]: on-screen word i and the next are both emphasised, so a highlight look's fit keeps them on one line when
// a slightly smaller size allows (fitText): a highlight that breaks across lines paints more than it points.
function highlightTogether(text, ctx) {
  if (ctx.look.emphasis !== 'highlight') return [];
  const times = wordTimes(wordsOf(text), ctx.timing);
  const emphasised = times.map(({ spoken }) => spoken !== null && ctx.timing.words[spoken].emphasis);
  return emphasised.map((on, i) => on && emphasised[i + 1] === true);
}

// The text fitted to columns FIRST_COLUMN..`to` and centred on DESK.centre of the height: { layout, font, x, y, span }.
// `tradeFloor`: the fit gives up size for a better break (fitText) only down to this size; `clear` (the slug card grown
// by a gutter, or null): the fit prefers a layout whose block, so placed, stays off it.
function fitEditorial(text, ctx, to, tradeFloor, clear) {
  const { look, canvas, unit } = ctx;
  const span = gridSpan(look, canvas, FIRST_COLUMN, to);
  const min = sizeAt(look, DESK.fromStep, unit), max = DESK.max * unit;
  const font = fontFor(look, 'display', max, unit);
  const place = (layout, at) => ({ layout, font: at, x: span.x, y: DESK.centre * canvas.h - (inkSpan(layout).top + inkSpan(layout).bottom) / HALF, span });
  const accept = clear ? (layout) => !overlaps(clear, blockInk(place(layout, { ...font, size: layout.size }), ctx.measure)) : undefined;
  const opts = { text, font, maxWidth: span.w, align: 'left', measure: ctx.measure, optical: true, together: highlightTogether(text, ctx), accept };
  const fitted = fitDisplay(opts, { min, max, maxHeight: DESK.height * canvas.h, maxLines: look.maxLines.display, tradeFloor }, look, unit);
  return place(fitted.layout, fitted.font);
}

// The block a placed text's glyphs cover in canvas pixels, ascenders and descenders included.
function blockInk(placed, measure) {
  const { layout, font, x, y } = placed;
  const inks = layout.lines.map((line) => ({ line, ink: runInk(line, font, measure) }));
  const left = x + Math.min(...inks.map(({ ink }) => ink.left)), right = x + Math.max(...inks.map(({ ink }) => ink.right));
  const top = y + layout.lines[0].y - inks[0].ink.up, bottom = y + layout.lines.at(-1).y + inks.at(-1).ink.down;
  return [left, top, right - left, bottom - top];
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const grown = ([x, y, w, h], by) => [x - by, y - by, w + HALF * by, h + HALF * by];

// `placed` moved down until its block clears `clear` (the slug card grown by a gutter), as far as the bottom margin allows
// (never up).
function dropBelow(placed, clear, ctx) {
  const { look, canvas, unit, measure } = ctx;
  const block = blockInk(placed, measure);
  const room = Math.max(0, canvas.h - look.grid.margin * unit - (block[1] + block[3]));
  return { ...placed, y: placed.y + Math.min(room, clear[1] + clear[3] - block[1]) };
}

// desk: the type carries the frame, fitted to columns 2 to 9 (2 to 11 on vertical formats); with a slug, the span stops
// a column earlier, and earlier again, until the block clears the card by a gutter. Narrowing stops before the text
// would overflow (a long sentence on a square frame), and before it falls under the review's hero ratio over the slug's
// kicker when dropping the block below the card clears it; a block that still meets the card then drops below it (the
// frame review reports text left over a card: card-overlap).
function composeEditorial(text, shot, ctx) {
  const { look, canvas, unit, measure } = ctx;
  const last = isWide(canvas) ? DESK.toWide : DESK.toTall;
  const slug = slugBox(shot, ctx);
  const clear = slug ? grown(slug.turned, look.grid.gutter * unit) : null;
  // a statement stays three times the slug's kicker (the hero ratio the review asks of a frame's own texts; the slug is
  // frame furniture, which the review leaves out)
  const floor = slug ? MIN_HERO_RATIO * sizeAt(look, SLUG.kickerStep, unit) : 0;
  const clears = (p) => !overlaps(clear, blockInk(p, measure));
  let placed = fitEditorial(text, ctx, last, floor, clear);
  for (let to = last - 1; clear && to >= DESK.minTo && !clears(placed); to--) {
    const narrower = fitEditorial(text, ctx, to, floor, clear);
    if (narrower.layout.overflow && !placed.layout.overflow) break;
    if (narrower.font.size < floor && placed.font.size >= floor && clears(dropBelow(placed, clear, ctx))) break;
    placed = narrower;
  }
  if (!clear || clears(placed)) return placed;
  return dropBelow(placed, clear, ctx);
}

// Where the text goes and at what size: { layout, font, x, y, span }.
function compose(text, shot, ctx) {
  const { look, unit } = ctx;
  if (isEditorial(look)) return composeEditorial(text, shot, ctx);
  // a centred look on 9:16 composes in the platform safe zone: its width, centred on its centre
  const rect = compositionRect(ctx);
  const span = rect.safe ? { x: rect.left, w: rect.w } : gridSpan(look, ctx.canvas, FIRST_COLUMN, CENTRED_TO);
  const margin = rect.safe ? 0 : look.grid.margin * unit;
  const above = shot.kicker === undefined ? 0 : kickerRoom(look, unit);
  const maxHeight = HALF * Math.min(rect.cy - rect.top - margin - above, rect.top + rect.h - rect.cy - margin);
  const min = sizeAt(look, POP.fromStep, unit), max = sizeAt(look, POP.toStep, unit);
  const opts = { text, font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: 'center', measure: ctx.measure, optical: true };
  const { layout, font } = fitDisplay(opts, { min, max, maxHeight, maxLines: look.maxLines.display }, look, unit);
  const ink = inkSpan(layout);
  return { layout, font, x: span.x, y: rect.cy - (ink.top + ink.bottom) / HALF, span };
}

const placedWords = (layout) => layout.lines.flatMap((line) => line.words.map((word) => ({ line, word })));

// One word's box in canvas pixels: cap line to just under the baseline.
const wordBox = (at, { line, word }, size) => capBox(at.x + line.x + word.x, at.y + line.y, word.width, size);

const EASE_SAMPLES = 100;
// The highest value an ease reaches between 0 and 1 (1 for one that does not overshoot).
const easePeak = (name) => Math.max(1, ...Array.from({ length: EASE_SAMPLES + 1 }, (_, i) => ease(name)(i / EASE_SAMPLES)));

// How far a word's pulse may scale it (about its centre): the look's peak, but never so far that its ink meets a
// neighbour on its line, also when that neighbour is at its own peak. Each side of the word may grow by half the gap.
export function pulsePeaks(words, look) {
  const cap = look.moves.emphasize.scale ?? 1;
  const overshoot = easePeak(look.moves.emphasize.ease); // a spring runs past its target: the track's real maximum
  const peaks = new Map();
  for (const { line, word } of words) {
    peaks.set(word.index, Math.max(1, Math.min(cap, 1 + roomAround(line, word) / (word.width * overshoot))));
  }
  return peaks;
}

// The smaller of the gaps either side of a word on its line (Infinity for a word alone on its line).
function roomAround(line, word) {
  const at = line.words.findIndex((w) => w.index === word.index);
  const gaps = [line.words[at - 1] && word.x - (line.words[at - 1].x + line.words[at - 1].width), line.words[at + 1] && line.words[at + 1].x - (word.x + word.width)];
  return Math.min(...gaps.filter((g) => typeof g === 'number'), Infinity);
}

// Where a word's entrance pop starts so its spring, which runs past 1 on the way in, never grows the word into a
// neighbour: the look's start scale, or the nearest to 1 that keeps the whole track within the gap.
export function enterStarts(words, look) {
  const { scale, ease: easeName } = look.moves.enter;
  const starts = new Map();
  const overshoot = scale === undefined ? 1 : easePeak(easeName);
  for (const { line, word } of words) {
    const allowed = 1 + roomAround(line, word) / word.width; // the most the word may reach
    const start = overshoot <= allowed || overshoot <= 1 ? scale : Math.max(scale, (overshoot - allowed) / (overshoot - 1));
    starts.set(word.index, start);
  }
  return starts;
}

// A mode with `hookFromFrameZero` (viral) reads from the first frame: in every statement of a recolour look every word
// is on screen from frame 0 as a ghost (ink at 0.4, shared.mjs ghostTracks) and takes its own colour when it is spoken.
export const ghostWords = (ctx) => ctx.mode.hookFromFrameZero === true && ctx.look.emphasis !== 'highlight';

// A ghost word that lights to `to` when spoken at `at`, pulsing as it does when `peak` is given.
function hookTracks(look, at, to, peak) {
  const ghost = ghostTracks(look, at, to);
  return peak === undefined ? ghost : { ...ghost, scale: pulseScale(look, { pulse: at, peak }) };
}

// Word tracks: the entrance on each word's time (none for a matched hero), and in a recolour look the emphasis (a pulse
// as well for recolor-scale). In a mode that reads from frame 0 there is no entrance at all (see ghostWords).
function wordTracksFor(words, times, ctx, matched) {
  const { look, unit, timing } = ctx;
  const peaks = pulsePeaks(words, look);
  const recolour = look.emphasis === 'recolor-scale';
  const starts = recolour ? enterStarts(words, look) : new Map();
  const hook = ghostWords(ctx);
  return words.map((w, i) => {
    const { at, spoken } = times[i];
    const emphasised = spoken !== null && timing.words[spoken].emphasis;
    if (hook) return hookTracks(look, at, emphasised ? look.palette.accent : look.palette.ink, recolour ? peaks.get(w.word.index) : undefined);
    const tracks = matched ? {} : enterTracks(look, unit, at);
    if (recolour && !matched && look.moves.enter.scale !== undefined) tracks.scale = landing(at, look.moves.enter, starts.get(w.word.index), 1);
    if (!recolour || !emphasised) return tracks;
    return {
      ...tracks,
      scale: pulseScale(look, { enterAt: matched ? undefined : at, enterFrom: starts.get(w.word.index), pulse: at, peak: peaks.get(w.word.index) }),
      fill: track([{ t: at, v: look.palette.ink }, { t: at + look.moves.emphasize.dur, v: look.palette.accent, ease: FILL_EASE }]),
    };
  });
}

// Runs of adjacent emphasised words on one line, each [first, last] word index.
function emphasisRuns(layout, times, timing) {
  const emphasised = (index) => times[index].spoken !== null && timing.words[times[index].spoken].emphasis;
  return layout.lines.flatMap((line) => line.words.reduce((runs, word) => {
    if (!emphasised(word.index)) return runs;
    const open = runs.at(-1);
    if (open && open.last === word.index - 1) return [...runs.slice(0, -1), { ...open, last: word.index }];
    return [...runs, { line, first: word.index, last: word.index }];
  }, []));
}

// The box to give the highlight device for a run, so that the band it draws (BAND_HEIGHT times the box, about the same
// middle) runs from HIGHLIGHT_PAST_INK above the run's highest ink to HIGHLIGHT_PAST_INK below its lowest: it holds the
// words, descenders included, and with the look's display line height it clears the lines above and below.
function bandBox(placed, line, run, measure) {
  const { font, x, y } = placed;
  const a = line.words.find((w) => w.index === run.first), b = line.words.find((w) => w.index === run.last);
  const ink = runInk(line, font, measure, run.first, run.last);
  const baseline = y + line.y;
  const top = baseline - ink.up - HIGHLIGHT_PAST_INK * font.size, bottom = baseline + ink.down + HIGHLIGHT_PAST_INK * font.size;
  const h = (bottom - top) / BAND_HEIGHT;
  const left = x + line.x + a.x;
  return [left, (top + bottom) / HALF - h / HALF, x + line.x + b.x + b.width - left, h];
}

function highlights(shot, ctx, placed, times) {
  const { look, unit, seed, timing, measure } = ctx;
  if (look.emphasis !== 'highlight') return [];
  const { layout } = placed;
  const at = placed;
  const runs = emphasisRuns(layout, times, timing);
  if (runs.length > 0) requireDevice(look, 'highlight', 'statement');
  const device = registries.devices.get('highlight');
  return runs.flatMap(({ line, first, last }, k) => {
    const box = bandBox(placed, line, { first, last }, measure);
    // the band grows with the words: each word's landing time and right edge
    const stops = line.words.filter((w) => w.index >= first && w.index <= last).map((w) => ({ at: times[w.index].at, x: at.x + line.x + w.x + w.width }));
    return device.build({ id: `${shot.id}.hl${k}`, box, at: times[first].at, look, unit, seed, stops }).nodes;
  });
}

// The kicker: on a slug card in an editorial composition (slug.mjs); above the text, centred, in a centred one, landing
// with the first word.
function kickerNodes(shot, ctx, placed, landAt) {
  if (shot.kicker === undefined) return [];
  const { look, unit, measure } = ctx;
  if (isEditorial(look)) return slugNodes(shot, ctx);
  const font = fontFor(look, 'label', sizeAt(look, KICKER.step, unit), unit);
  const layout = layoutText({ text: setCase(look, 'label', shot.kicker), font, maxWidth: placed.span.w, align: 'center', measure });
  const capLine = placed.y + placed.layout.lines[0].y - CAP_HEIGHT * placed.font.size;
  const y = capLine - KICKER.gap * unit - layout.lines[0].y;
  return [node('text', `${shot.id}.kicker`, { x: placed.span.x, y, layout, font, fill: look.palette.ink2, role: 'kicker' }, { tracks: enterTracks(look, unit, landAt, { y }) })];
}

// The most laid-out lines one unbroken run of emphasised words spans (a run follows word order across lines), or
// undefined when nothing is emphasised: the frame review's highlight-lines rule reads it from the text node.
function highlightLines(layout, times, timing) {
  const lineOf = new Map(layout.lines.flatMap((line, k) => line.words.map((w) => [w.index, k])));
  const emphasised = (i) => times[i] !== undefined && times[i].spoken !== null && timing.words[times[i].spoken].emphasis;
  let most, first = null;
  for (let i = 0; i <= times.length; i++) {
    if (i < times.length && emphasised(i)) { first ??= i; continue; }
    if (first !== null) most = Math.max(most ?? 0, lineOf.get(i - 1) - lineOf.get(first) + 1);
    first = null;
  }
  return most;
}

function boxesFor(placed, words) {
  const { layout, font, x, y } = placed;
  const wordBoxes = words.map((w) => wordBox({ x, y }, w, font.size));
  return Object.fromEntries([['text', unionBox(wordBoxes)], ...wordBoxes.map((box, i) => [`word:${i}`, box])]);
}

// A stack (stack.mjs): one text node per line inside the hero group, the kicker as a tag over the first line.
function expandStacked(shot, ctx) {
  const { look, unit, timing } = ctx;
  const placed = composeStack(sourceText(shot, look), shot, ctx);
  const texts = placed.lines.flatMap((line) => line.layout.lines[0].words.map((w) => w.text));
  const times = wordTimes(texts, timing).map(({ at, spoken }) => ({ at, emphasised: spoken !== null && timing.words[spoken].emphasis }));
  const hero = heroId(shot, 'text');
  const { group, kicker, boxes } = stackNodes(shot, ctx, placed, { times, ghost: ghostWords(ctx), matched: arrivesMatched(shot, ctx), hero });
  const behind = Object.fromEntries(Object.keys(boxes).map((target) => [target, hero]));
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'text', behind });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...kicker, group], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

function expandStatement(shot, ctx) {
  const { look, unit, timing } = ctx;
  if (look.composition === 'stack') return expandStacked(shot, ctx);
  const placed = compose(sourceText(shot, look), shot, ctx);
  const words = placedWords(placed.layout).sort((a, b) => a.word.index - b.word.index);
  const times = wordTimes(words.map((w) => w.word.text), timing);
  const matched = arrivesMatched(shot, ctx);
  const hero = heroId(shot, 'text');
  const span = look.emphasis === 'highlight' ? highlightLines(placed.layout, times, timing) : undefined;
  const text = node('text', hero, {
    x: placed.x, y: placed.y, layout: placed.layout, font: placed.font, fill: look.palette.ink, role: 'hero', ...(span === undefined ? {} : { highlightLines: span }),
  }, {
    wordTracks: wordTracksFor(words, times, ctx, matched),
  });
  const boxes = boxesFor(placed, words);
  const behind = Object.fromEntries(Object.keys(boxes).map((target) => [target, hero]));
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'text', behind });
  const firstAt = times.length > 0 ? Math.min(look.moves.enter.dur, times[0].at) : 0;
  const base = [fieldNode(shot, ctx), ...kickerNodes(shot, ctx, placed, firstAt), ...highlights(shot, ctx, placed, times), text];
  return {
    nodes: placeDevices(base, devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

// A say that does not parse has its own validation error; its targets are then just `text`.
function plainSay(say) {
  try {
    return parseSay(say).plain;
  } catch (err) {
    if (err instanceof SayError) return '';
    throw err;
  }
}

// Emphasis is a pointer, not a paint job: in a highlight look a statement whose emphasised words are EMPHASIS_SHARE of
// its spoken words or more gets a creative finding at its say. (A run that breaks across lines is the other half of the
// rule; it needs the layout, so the text node carries it as props.highlightLines and the frame review reports it.)
function emphasisFindings(shot, { look }) {
  if (look.emphasis !== 'highlight' || typeof shot.say !== 'string') return [];
  let tokens;
  try {
    tokens = parseSay(shot.say).tokens;
  } catch (err) {
    if (err instanceof SayError) return []; // the validator reports a say that does not parse
    throw err;
  }
  const marked = tokens.filter((t) => t.emphasis).length;
  if (marked < EMPHASIS_SHARE * tokens.length) return [];
  return [{ path: 'say', at: 0, message: `emphasis covers ${marked} of ${tokens.length} words; mark fewer` }];
}

function statementTargets(shot) {
  const text = shot.text ?? (typeof shot.say === 'string' ? plainSay(shot.say) : '');
  return ['text', ...wordsOf(text).map((_, i) => `word:${i}`)];
}

registries.kinds.add('statement', {
  summary: 'A line of type as the whole frame, its words arriving as they are spoken; *starred* words are emphasised. An optional kicker is set as the look has it: a numbered slug card (desk) or a tag over the text (pop).',
  example: { id: 'hook', show: 'statement', say: 'Numbers need *sources*.', kicker: 'The problem' },
  schema: {
    properties: {
      text: { type: 'string', minLength: 1, maxLength: TEXT_MAX },
      kicker: { type: 'string', minLength: 1, maxLength: KICKER_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'text',
  targets: statementTargets,
  ids: (shot) => [heroId(shot, 'text')],
  validate: heroProblems,
  expand: expandStatement,
  review: emphasisFindings,
  numbered: true, // a slug shows its place among the film's numbered shots
});

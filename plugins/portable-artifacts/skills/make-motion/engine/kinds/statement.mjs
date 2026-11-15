// The `statement` kind: a line of type as the whole frame, its words arriving as they are spoken. An editorial
// composition (desk) sets it flush left on column 2 with its ink centred at 44% of the height; a centred one (pop)
// centres it on the composition. Emphasis follows the look's emphasis system: a highlight behind each emphasised run
// (desk), or a recolour and pulse of each emphasised word (pop). An optional kicker sits above it. Pure and DOM-free.
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
  isEditorial, requireDevice, heroProblems, compositionRect, fieldNode, enterTracks, pulseScale, wipeIn, rectPath,
  defaultCamera, onDevices, placeDevices, deviceCamera, unionBox,
} from './shared.mjs';
import { wordTimes } from './words.mjs';

const TEXT_MAX = 200;
const KICKER_MAX = 40;
const DESK = Object.freeze({ centre: 0.44, fromStep: 3, toStep: 5 });
const POP = Object.freeze({ fromStep: 3, toStep: 5 }); // so a long word can shrink the block
const FIRST_COLUMN = 2;
const KICKER = Object.freeze({ step: 1, gap: 28, ruleGap: 12, rule: 2, ruleLength: 96 });
// The highlighter band behind a run, in em of the text: from this far above the baseline, this tall.
const HIGHLIGHT_TOP = 0.6;
const HIGHLIGHT_HEIGHT = 0.68;
const FILL_EASE = 'outCubic';
const NO_WRAP = 1e6;
const HALF = 2;

function sourceText(shot, look) {
  const text = shot.text ?? (shot.say === undefined ? undefined : parseSay(shot.say).plain);
  if (typeof text !== 'string' || wordsOf(text).length === 0) throw new Error(`statement: shot "${shot.id}" needs text or say`);
  return setCase(look, 'display', text);
}

// The kicker's height above the text's cap line, so the text is fitted with room for it.
const kickerRoom = (look, unit) => (KICKER.gap + look.scale[KICKER.step - 1] * CAP_HEIGHT + KICKER.ruleGap + KICKER.rule) * unit;

// Where the text goes and at what size: { layout, font, x, y, span }.
function compose(text, shot, ctx) {
  const { look, canvas, unit } = ctx;
  const desk = isEditorial(look);
  const plan = desk ? DESK : POP;
  // pop on 9:16 composes in the platform safe zone: its width, centred on its centre
  const rect = compositionRect(ctx);
  const span = rect.safe ? { x: rect.left, w: rect.w } : gridSpan(look, canvas, FIRST_COLUMN, desk && isWide(canvas) ? 9 : 11);
  const margin = rect.safe ? 0 : look.grid.margin * unit;
  const above = shot.kicker === undefined ? 0 : kickerRoom(look, unit);
  const centre = desk ? plan.centre * canvas.h : rect.cy;
  const maxHeight = HALF * Math.min(centre - rect.top - margin - above, rect.top + rect.h - centre - margin);
  const min = sizeAt(look, plan.fromStep, unit), max = sizeAt(look, plan.toStep, unit);
  const opts = { text, font: fontFor(look, 'display', max, unit), maxWidth: span.w, align: desk ? 'left' : 'center', measure: ctx.measure, optical: true };
  const { layout, font } = fitDisplay(opts, { min, max, maxHeight, maxLines: look.maxLines.display }, look, unit);
  const ink = inkSpan(layout);
  return { layout, font, x: span.x, y: centre - (ink.top + ink.bottom) / HALF, span };
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

// The look's `hookFromFrameZero` mode reads from the first frame: in the first shot every word is on screen from frame 0
// in the quiet colour (ink2) and takes its own when it is spoken, with the emphasize pulse.
const isHook = (ctx) => ctx.mode.hookFromFrameZero === true && ctx.timing.index === 0;

// A word that turns from the quiet colour to `to` when spoken at `at`, pulsing as it does.
function hookTracks(look, at, to, peak) {
  const { emphasize } = look.moves;
  return {
    fill: track([{ t: 0, v: look.palette.ink2 }, { t: at, v: look.palette.ink2 }, { t: at + emphasize.dur, v: to, ease: FILL_EASE }]),
    scale: pulseScale(look, { pulse: at, peak }),
  };
}

// Word tracks: the entrance on each word's time (none for a matched hero), and in a recolour look the emphasis. In a
// mode that reads from frame 0 the first shot has no entrance at all (see isHook).
function wordTracksFor(words, times, ctx, matched) {
  const { look, unit, timing } = ctx;
  const peaks = pulsePeaks(words, look);
  const recolour = look.emphasis === 'recolor-scale';
  const starts = recolour ? enterStarts(words, look) : new Map();
  const hook = isHook(ctx) && recolour;
  return words.map((w, i) => {
    const { at, spoken } = times[i];
    const emphasised = spoken !== null && timing.words[spoken].emphasis;
    if (hook) return hookTracks(look, at, emphasised ? look.palette.accent : look.palette.ink, peaks.get(w.word.index));
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

function highlights(shot, ctx, placed, times) {
  const { look, unit, seed, timing } = ctx;
  if (look.emphasis !== 'highlight') return [];
  const { layout, font } = placed;
  const at = placed;
  const runs = emphasisRuns(layout, times, timing);
  if (runs.length > 0) requireDevice(look, 'highlight', 'statement');
  const device = registries.devices.get('highlight');
  return runs.flatMap(({ line, first, last }, k) => {
    const a = line.words.find((w) => w.index === first), b = line.words.find((w) => w.index === last);
    const left = at.x + line.x + a.x;
    const box = [left, at.y + line.y - HIGHLIGHT_TOP * font.size, at.x + line.x + b.x + b.width - left, HIGHLIGHT_HEIGHT * font.size];
    // the band grows with the words: each word's landing time and right edge
    const stops = line.words.filter((w) => w.index >= first && w.index <= last).map((w) => ({ at: times[w.index].at, x: at.x + line.x + w.x + w.width }));
    return device.build({ id: `${shot.id}.hl${k}`, box, at: times[first].at, look, unit, seed, stops }).nodes;
  });
}

// The kicker line and, in an editorial composition (desk), the hairline over it. Both land with the first word.
function kickerNodes(shot, ctx, placed, landAt) {
  if (shot.kicker === undefined) return [];
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'label', sizeAt(look, KICKER.step, unit), unit);
  const text = setCase(look, 'label', shot.kicker);
  const desk = isEditorial(look);
  const layout = layoutText({ text, font, maxWidth: desk ? NO_WRAP : placed.span.w, align: desk ? 'left' : 'center', measure });
  const capLine = placed.y + placed.layout.lines[0].y - CAP_HEIGHT * placed.font.size;
  const baseline = capLine - KICKER.gap * unit;
  const x = desk ? placed.x : placed.span.x;
  const y = baseline - layout.lines[0].y;
  const kicker = node('text', `${shot.id}.kicker`, { x, y, layout, font, fill: look.palette.ink2, role: 'kicker' }, { tracks: enterTracks(look, unit, landAt, { y }) });
  if (!desk) return [kicker];
  const ruleY = baseline - CAP_HEIGHT * font.size - KICKER.ruleGap * unit - KICKER.rule * unit;
  const rule = node('path', `${shot.id}.rule`, { x, y: ruleY, d: rectPath(KICKER.ruleLength * unit, KICKER.rule * unit), fill: look.palette.rule }, { tracks: wipeIn(look, landAt) });
  return [rule, kicker];
}

function boxesFor(placed, words) {
  const { layout, font, x, y } = placed;
  const wordBoxes = words.map((w) => wordBox({ x, y }, w, font.size));
  return Object.fromEntries([['text', unionBox(wordBoxes)], ...wordBoxes.map((box, i) => [`word:${i}`, box])]);
}

function expandStatement(shot, ctx) {
  const { look, unit, timing } = ctx;
  const placed = compose(sourceText(shot, look), shot, ctx);
  const words = placedWords(placed.layout).sort((a, b) => a.word.index - b.word.index);
  const times = wordTimes(words.map((w) => w.word.text), timing);
  const matched = arrivesMatched(shot, ctx);
  const hero = heroId(shot, 'text');
  const text = node('text', hero, { x: placed.x, y: placed.y, layout: placed.layout, font: placed.font, fill: look.palette.ink, role: 'hero' }, {
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

function statementTargets(shot) {
  const text = shot.text ?? (typeof shot.say === 'string' ? plainSay(shot.say) : '');
  return ['text', ...wordsOf(text).map((_, i) => `word:${i}`)];
}

registries.kinds.add('statement', {
  summary: 'A line of type as the whole frame, its words arriving as they are spoken; *starred* words are emphasised. An optional kicker sits above it.',
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
});

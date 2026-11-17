// The `statement` kind: a line of type as the whole frame, its words arriving as they are spoken. An editorial
// composition (desk) sets it flush left on column 2, sized to carry the frame, its ink centred at 50% of the height,
// with the kicker on a slug card in the top right (slug.mjs); a centred one centres it on the composition with the
// kicker above; a stack (pop) sets each line at its own size to fill the width (stack.mjs). Emphasis follows the look's
// emphasis system: a highlight behind each emphasised run (desk), or a recolour (with a pulse for recolor-scale).
// In a mode that reads from frame 0 (viral) every word is on screen from the first frame as a ghost (opaque, ink mixed
// 40% into paper) and
// lights as it is spoken. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText, unclean } from '../text/layout.mjs';
import { gridSpan } from '../looks/index.mjs';
import { landing } from '../devices/shared.mjs';
import { glowStyle } from '../devices/glow.mjs';
import { sunNodes, sunAnchor, hasSun, besideSun, belowSun } from '../devices/sun.mjs';
import { parseSay, SayError } from '../script/say.mjs';
import {
  CAP_HEIGHT, HERO_SCHEMA, sizeAt, fontFor, heroId, isWide, arrivesMatched, cutReveal, wordsOf, fitDisplay, inkSpan, setCase, capBox, isEditorial, heroProblems, compositionRect, fieldNode, enterTracks, pulseScale, onDevices, placeDevices, deviceCamera, unionBox, runInk, ghostTracks, easePeak, ghostWords, plainSay, overlaps, NOT_BLANK, assertNoBlanks,
} from './shared.mjs';
import { defaultCamera, driftReach } from './camera.mjs';
import { highlightBands } from './highlighter.mjs';
import { emphasisOf } from './emphasis.mjs';
import { emphasisFlags } from './emphasis-flags.mjs';
import { wordTimes } from './words.mjs';
import { slugBox, slugNodes, SLUG } from './slug.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { composeStack, stackNodes, widerKeyword } from './stack.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { unmarked, opensSet } from './shared.mjs';

const TEXT_MAX = 200;
const KICKER_MAX = 40;
// desk: fitted between scale step 3 and 300 units, its block at most 64% of the height, ink centred at 50%; columns 2
// to 9 (2 to 11 on vertical formats), and with a slug no narrower than columns 2 to 5, trading size for a better break
// no lower than 3 times its kicker
const DESK = Object.freeze({ centre: 0.5, height: 0.64, fromStep: 3, max: 300, toWide: 9, toTall: 11, minTo: 5 });
const POP = Object.freeze({ fromStep: 3, toStep: 5 }); // so a long word can shrink the block
const FIRST_COLUMN = 2;
const SLUG_CLEAR = 2; // gutters between a statement's ink and the slug card, its tape included (look gate fix pass F4)
const CENTRED_TO = 11;
const KICKER = Object.freeze({ step: 1, gap: 28, ruleGap: 12, rule: 2 }); // a centred look's kicker above the text
const HALF = 2;

function sourceText(shot, look) {
  const text = shot.text ?? (shot.say === undefined ? undefined : parseSay(shot.say).plain);
  if (typeof text !== 'string' || wordsOf(text).length === 0) throw new Error(`statement: shot "${shot.id}" needs text or say`);
  return setCase(look, 'display', text);
}

// The statement's validate hook: a reserved hero id, and a statement with no words to show (sourceText would throw in
// the page with no path; a `say` that does not parse already has its own error).
function statementProblems(shot) {
  const missing = shot.text === undefined && shot.say === undefined;
  const empty = typeof shot.text === 'string' && wordsOf(shot.text).length === 0;
  const words = missing || empty ? [{ path: 'text', message: 'a statement needs words to show: write "text" or "say"' }] : [];
  return [...heroProblems(shot), ...words];
}

// The kicker's height above the text's cap line, so the text is fitted with room for it.
const kickerRoom = (look, unit) => (KICKER.gap + look.scale[KICKER.step - 1] * CAP_HEIGHT + KICKER.ruleGap + KICKER.rule) * unit;

// together[i]: on-screen word i and the next are both emphasised, so a highlight look's fit keeps them on one line when
// a slightly smaller size allows (fitText): a highlight that breaks across lines paints more than it points.
function highlightTogether(text, ctx) {
  // a glow look may keep its emphasised phrases whole on a wide frame (look.kinds.statement.together, cosmos): the
  // emphasis style says (emphasis.mjs together)
  if (!emphasisOf(ctx.look).together(ctx)) return [];
  const times = wordTimes(wordsOf(text), ctx.timing);
  const emphasised = times.map(({ spoken }) => spoken !== null && ctx.timing.words[spoken].emphasis);
  return emphasised.map((on, i) => on && emphasised[i + 1] === true);
}

// The text fitted to columns FIRST_COLUMN..`to` and centred on DESK.centre of the height: { layout, font, x, y, span }.
// `tradeFloor`: the fit gives up size for a better break (fitText) only down to this size; `clear` (slugClearance, or
// null): the fit prefers a layout whose block, so placed, stays off it.
function fitEditorial(text, ctx, to, tradeFloor, clear) {
  const { look, unit } = ctx;
  const data = look.kinds?.statement ?? {}; // look data (cosmos): tallFrom, tallHeight, linesWide, toWide, together, fromSun, tallAlign
  const wide = isWide(ctx.canvas);
  // with a sun (data.fromSun, cosmos): on a wide frame the text starts at the column the sun leaves free; on a tall one
  // it is set centred on the sun's axis (data.tallAlign), on the band's centre, under its disc (cosmos-gate3.test.mjs)
  const sunny = data.fromSun === true && hasSun(look);
  const first = wide ? (sunny ? besideSun(look, ctx).from : FIRST_COLUMN) : data.tallFrom ?? FIRST_COLUMN;
  const align = !wide && data.tallAlign === 'center' ? 'center' : 'left';
  // a centred text takes every column, so it centres on the sun's axis
  const span = editorialSpan(ctx, first, align === 'center' ? look.grid.columns : to);
  const bounds = editorialBounds(ctx);
  // on a tall frame with a sun the block keeps out of its bright light: never higher than belowSun
  const top = !wide && sunny ? Math.max(bounds.top, belowSun(look, ctx)) : -Infinity;
  const min = sizeAt(look, DESK.fromStep, unit), max = DESK.max * unit;
  const font = fontFor(look, 'display', max, unit);
  // a claim that hangs under its tag on a wide frame (kinds.statement.hang, ledger) is fitted where it will stand: its
  // ink from the slug's clearance down to the bottom margin. Fitted centred, a larger block met the tag and was refused,
  // so the claim stayed at the desk height share and left the lower third of the frame empty (gate-ledger-3 F4).
  const hangTop = wide && clear && data.hang === true ? clear[1] + clear[3] : null;
  const place = (layout, at) => {
    if (hangTop !== null) return { layout, font: at, x: span.x, y: hangTop - blockInk({ layout, font: at, x: span.x, y: 0 }, ctx.measure)[1], span };
    const ink = inkSpan(layout);
    return { layout, font: at, x: span.x, y: Math.max(bounds.at(DESK.centre) - (ink.top + ink.bottom) / HALF, top - ink.top), span };
  };
  const together = highlightTogether(text, ctx);
  // with data.together (cosmos, wide) a layout that breaks inside an emphasised run is refused, not just ranked lower
  const whole = (layout) => !(data.together && wide) || !layout.lines.some((line) => together[line.words.at(-1).index]);
  const clears = (layout) => !clear || !overlaps(clear, blockInk(place(layout, { ...font, size: layout.size }), ctx.measure));
  const accept = clear || (data.together && wide) ? (layout) => clears(layout) && whole(layout) : undefined;
  // an emphasis that changes a word's weight measures every word at the weight it reaches (emphasis.mjs reserve)
  const reserve = emphasisOf(look).reserve?.(look);
  const opts = { text, font, maxWidth: span.w, align, measure: ctx.measure, optical: true, together, accept, ...(reserve === undefined ? {} : { reserve }) };
  // a look may allow more lines and more of the band's height on a tall frame (look.maxLinesTall, kinds.statement
  // tallHeight, cosmos: a wide face would set the hook small), and ask a wide frame for at most `linesWide` lines; a
  // hanging claim may take all the room under its tag
  const maxLines = !wide && look.maxLinesTall ? look.maxLinesTall.display : look.maxLines.display;
  const maxHeight = hangTop !== null ? bounds.bottom - hangTop
    : Math.min(bounds.height(!wide && data.tallHeight ? data.tallHeight : DESK.height), bounds.bottom - Math.max(bounds.top, top));
  // a phrase kept whole may cost size: the fit looks down to the kind's floor for a layout that keeps it
  const floor = data.together && wide ? Math.max(tradeFloor, min) : tradeFloor;
  const fit = (lines) => fitDisplay(opts, { min, max, maxHeight, maxLines: lines, tradeFloor: floor }, look, unit);
  const fewer = wide && data.linesWide ? fit(data.linesWide) : null;
  const fitted = fewer && !fewer.layout.overflow && whole(fewer.layout) ? fewer : fit(maxLines);
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


// The room a statement's ink keeps from the slug: the card's paper and tape grown by SLUG_CLEAR gutters on every side,
// and across by the camera drift as well (the slug is fixed to the frame; the text drifts with the camera).
function slugClearance(slug, ctx) {
  const { look, unit } = ctx;
  const by = SLUG_CLEAR * look.grid.gutter * unit;
  const drift = driftReach(look, unit);
  const [x, y, w, h] = slug.inked;
  return [x - by - drift, y - by, w + HALF * (by + drift), h + HALF * by];
}

// `placed` moved down until its block clears `clear` (slugClearance), as far as the bottom margin allows (never up).
function dropBelow(placed, clear, ctx) {
  const block = blockInk(placed, ctx.measure);
  const room = Math.max(0, editorialBounds(ctx).bottom - (block[1] + block[3]));
  return { ...placed, y: placed.y + Math.min(room, clear[1] + clear[3] - block[1]) };
}

// desk: the type carries the frame, fitted to columns 2 to 9 (2 to 11 on vertical formats); with a slug, the span stops
// a column earlier, and earlier again, until the block clears the card (slugClearance). Narrowing stops before the text
// would overflow (a long sentence on a square frame), and, when dropping the block below the card clears it, before it
// falls under the review's hero ratio over the slug's kicker or breaks worse than the wider span (a sentence ending
// mid-line, a highlight run split: layout.mjs unclean); a block that still meets the card then drops below it (the
// frame review reports text left over a card: card-overlap).
function composeEditorial(text, shot, ctx) {
  const { look, canvas, unit, measure } = ctx;
  const last = isWide(canvas) ? look.kinds?.statement?.toWide ?? DESK.toWide : DESK.toTall;
  const slug = slugBox(shot, ctx);
  const clear = slug ? slugClearance(slug, ctx) : null;
  // a statement stays three times the slug's kicker (the hero ratio the review asks of a frame's own texts; the slug is
  // frame furniture, which the review leaves out)
  const floor = slug ? MIN_HERO_RATIO * sizeAt(look, SLUG.kickerStep, unit) : 0;
  const clears = (p) => !overlaps(clear, blockInk(p, measure));
  const together = highlightTogether(text, ctx);
  let placed = fitEditorial(text, ctx, last, floor, clear);
  for (let to = last - 1; clear && to >= DESK.minTo && !clears(placed); to--) {
    const narrower = fitEditorial(text, ctx, to, floor, clear);
    if (narrower.layout.overflow && !placed.layout.overflow) break;
    const dropped = clears(dropBelow(placed, clear, ctx));
    if (narrower.font.size < floor && placed.font.size >= floor && dropped) break;
    // a narrower span that breaks worse (a sentence ending mid-line, a highlight run split) gives way to the drop
    if (unclean(narrower.layout, together) && !unclean(placed.layout, together) && dropped) break;
    placed = narrower;
  }
  // a look whose claim hangs under its tag on a wide frame (look.kinds.statement.hang, ledger: the top third) moves up
  // to it too; a tall frame keeps its claim centred in the band
  const hang = clear && isWide(canvas) && look.kinds?.statement?.hang === true;
  if (!clear || (clears(placed) && !hang)) return placed;
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
// is on screen from frame 0 as a ghost (opaque, ink mixed 40% into paper, shared.mjs ghostTracks) and takes its own
// colour when it is spoken.

// A ghost word that lights to `to` when spoken at `at`, pulsing as it does when `peak` is given.
function hookTracks(look, at, to, peak) {
  const ghost = ghostTracks(look, at, to);
  return peak === undefined ? ghost : { ...ghost, scale: pulseScale(look, { pulse: at, peak }) };
}

// Word tracks: the entrance on each word's time (none for a matched hero), and in a recolour look the emphasis (a pulse
// as well for recolor-scale). In a mode that reads from frame 0 there is no entrance at all (see ghostWords).
function wordTracksFor(words, times, ctx, matched) {
  const { look, unit, timing } = ctx;
  const style = emphasisOf(look);
  const peaks = pulsePeaks(words, look);
  const scales = style.scales === true;
  const starts = scales ? enterStarts(words, look) : new Map();
  const hook = ghostWords(ctx);
  return words.map((w, i) => {
    const { at, spoken } = times[i];
    const emphasised = spoken !== null && timing.words[spoken].emphasis;
    const word = { emphasised, matched, start: starts.get(w.word.index), peak: peaks.get(w.word.index) };
    // a look whose hook opens at full ink (look.hookInk, cosmos): every word in ink from frame 0, the emphasis by the glow
    if (hook && look.hookInk) return style.inkTracks(look, word, at);
    if (hook) {
      const lit = hookTracks(look, at, emphasised ? look.palette.accent : look.palette.ink, scales ? word.peak : undefined);
      return style.hookTracks(look, { ...word, tracks: lit }, at);
    }
    // a look that opens composed (shared.mjs opensSet, ledger) sets every word from frame 0, as a matched hero does; the
    // emphasis still lands on its spoken word
    const entered = matched || opensSet(look) ? {} : enterTracks(look, unit, at);
    const lands = scales && !matched && look.moves.enter.scale !== undefined;
    const tracks = lands ? { ...entered, scale: landing(at, look.moves.enter, word.start, 1) } : entered;
    return style.wordTracks(look, { ...word, tracks }, at, ctx);
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

function boxesFor(placed, words) {
  const { layout, font, x, y } = placed;
  const wordBoxes = words.map((w) => wordBox({ x, y }, w, font.size));
  return Object.fromEntries([['text', unionBox(wordBoxes)], ...wordBoxes.map((box, i) => [`word:${i}`, box])]);
}

// What an emphasis that leads (poster's scale, emphasis-flags.mjs) asks of a stack: the emphasised word indexes, whose
// rows take the large size, and the keyword one step wider than the display face, which a one-line stack is measured at
// so its emphasised word can step to it. {} for every other emphasis.
function stackEmphasis(shot, text, ctx) {
  const flags = emphasisFlags(ctx.look);
  if (flags.leads !== true) return {};
  const words = text.split(/\s+/).filter((w) => w !== '' && w !== '|').map((w) => w.replace(/\|$/, ''));
  const times = wordTimes(words, ctx.timing, cutReveal(shot, ctx));
  const lead = new Set(times.flatMap(({ spoken }, i) => (spoken !== null && ctx.timing.words[spoken].emphasis ? [i] : [])));
  return { lead, ...(flags.widens === true && lead.size > 0 ? { widen: widerKeyword(ctx.look.fonts.display.width) } : {}) };
}

// A look whose highlight styles the words over its bar (look.devices.highlight.text, poster: the bar's own ink, 4.5:1 on
// it): word index -> the time its bar lands (the earliest, when several do), for a highlight on a word or on the text.
function barTimes(shot, ctx, count) {
  const bars = new Map();
  if (ctx.look.devices?.highlight?.text === undefined) return bars;
  (shot.on ?? []).forEach((item) => {
    if (item.do !== 'highlight') return;
    const target = item.target ?? 'text';
    const word = /^word:(\d+)$/.exec(target);
    const covered = word !== null ? [Number(word[1])] : target === 'text' ? Array.from({ length: count }, (_, i) => i) : [];
    const at = ctx.at(item.at);
    covered.forEach((i) => bars.set(i, Math.min(at, bars.get(i) ?? at)));
  });
  return bars;
}

// A stack (stack.mjs): one text node per line inside the hero group, the kicker as a tag over the first line.
function expandStacked(shot, ctx) {
  const { look, unit, timing } = ctx;
  // a viral film's first statement (the hook, read from frame 0) may be set a word a line, larger (stack.mjs hookLines)
  const hook = timing.index === 0 && ctx.mode.hookFromFrameZero === true;
  // a statement may be turned on a tall frame it leaves short (look.stack.turn; stack-turn.mjs)
  const placed = composeStack(sourceText(shot, look), shot, ctx, undefined, { hook, turn: true, ...stackEmphasis(shot, sourceText(shot, look), ctx) });
  const texts = placed.lines.flatMap((line) => line.layout.lines[0].words.map((w) => w.text));
  const times = wordTimes(texts, timing, cutReveal(shot, ctx)).map(({ at, spoken }) => ({ at, emphasised: spoken !== null && timing.words[spoken].emphasis }));
  const hero = heroId(shot, 'text');
  const { group, kicker, boxes } = stackNodes(shot, ctx, placed, { times, ghost: ghostWords(ctx), matched: arrivesMatched(shot, ctx), hero, bars: barTimes(shot, ctx, texts.length) });
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
  assertNoBlanks(shot, 'statement'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, unit, timing } = ctx;
  if (look.composition === 'stack') return expandStacked(shot, ctx);
  const placed = compose(sourceText(shot, look), shot, ctx);
  const words = placedWords(placed.layout).sort((a, b) => a.word.index - b.word.index);
  const times = wordTimes(words.map((w) => w.word.text), timing, cutReveal(shot, ctx));
  const matched = arrivesMatched(shot, ctx);
  const hero = heroId(shot, 'text');
  const span = emphasisOf(look).span?.(placed.layout, times, timing);
  const text = node('text', hero, {
    x: placed.x, y: placed.y, layout: placed.layout, font: placed.font, fill: look.palette.ink, role: 'hero', ...(span === undefined ? {} : { highlightLines: span }),
    ...glowStyle(look, placed.font, unit),
  }, {
    wordTracks: wordTracksFor(words, times, ctx, matched),
  });
  const boxes = boxesFor(placed, words);
  const behind = Object.fromEntries(Object.keys(boxes).map((target) => [target, hero]));
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'text', behind });
  const firstAt = times.length > 0 ? Math.min(look.moves.enter.dur, times[0].at) : 0;
  const base = [fieldNode(shot, ctx), ...statementSun(shot, ctx, times), ...kickerNodes(shot, ctx, placed, firstAt), ...highlightBands(shot.id, placed, times, ctx, 'statement'), text];
  return {
    nodes: placeDevices(base, devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes,
    hero,
    background: look.palette.paper,
  };
}

// The look's sun on its anchored place for the format (sun.mjs sunAnchor: the same sky at every cut), its bloom times
// kinds.statement.sun.strength, lighting as the first emphasised word is spoken (the words take their light from it), or
// with the first word when none is. [] without a sun.
function statementSun(shot, ctx, times) {
  const { look, timing } = ctx;
  const data = look.kinds?.statement?.sun;
  if (!data || !hasSun(look) || times.length === 0) return [];
  const lit = times.find(({ spoken }) => spoken !== null && timing.words[spoken].emphasis) ?? times[0];
  return sunNodes(`${shot.id}.sun`, look, { ...sunAnchor(look, ctx), strength: data.strength, at: lit.at });
}

// Emphasis is a pointer, not a paint job: in a highlight look a statement whose emphasised words are the style's maxShare of
// its spoken words or more gets a creative finding at its say. (A run that breaks across lines is the other half of the
// rule; it needs the layout, so the text node carries it as props.highlightLines and the frame review reports it.)
function emphasisFindings(shot, { look }) {
  const share = emphasisOf(look).maxShare; // the highlighter's cap (emphasis.mjs); the other styles have none
  if (share === undefined || typeof shot.say !== 'string') return [];
  let tokens;
  try {
    tokens = parseSay(shot.say).tokens;
  } catch (err) {
    if (err instanceof SayError) return []; // the validator reports a say that does not parse
    throw err;
  }
  const marked = tokens.filter((t) => t.emphasis).length;
  if (marked < share * tokens.length) return [];
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
      text: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TEXT_MAX },
      kicker: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: KICKER_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'text',
  targets: statementTargets,
  ids: (shot) => [heroId(shot, 'text')],
  validate: statementProblems,
  expand: (shot, ctx) => expandStatement(unmarked(shot), ctx),
  review: emphasisFindings,
  numbered: true, // a slug shows its place among the film's numbered shots
  showsWords: true, // its narration is the picture: never captioned (engine/captions)
  hookText: true, // as a viral film's first shot, all of its hero's words are on screen on frame 0 (review hookFindings)
});

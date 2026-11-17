// The `feed` kind's layout (plan 2026-11-16-pa2-shot-kinds-b, Task 9): one text size for every bubble, card, name and the
// title (the largest of look.kinds.feed.steps from the format's reading floor at which every message holds in maxLines
// and, where it can, the whole thread fits the room). chat: bubbles down one column in the order given, `me` on the
// right, `them` on the left led by typing dots; when the thread passes the room's foot the thread slides up with the
// look's settle move and a message that would leave the room's top is taken off. notifications: cards, the newest on
// top, the older ones settling down; one pushed past the foot is taken off. Every arrival is a step on its time.
// The frames are the look's own: nothing imitates a named platform's interface. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf, roundedRect } from '../devices/shared.mjs';
import { fontFor, sizeAt, setCase, shownFrom, isWide } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { slugBox, slugNodes, tagSlugOf } from './slug.mjs';
import { wordForm } from './words.mjs';

const HALF = 2;
const DOTS = 0.4; // s the typing dots lead a `them` message
const MIN_DOTS = 0.15; // s: shorter than this, no dots
const DOT_R = 0.12; // of the text size: a typing dot's radius
const DOTS_SPAN = 8; // radii: three dots, each 2 wide, a radius apart
const DISC = 1.6; // of the text size: an app disc's diameter, room for its initial at the one text size (1.15 let it spill)
const DISC_GAP = 0.4; // of the text size: between the disc and the app's name
const FRAME = 1 / 30;

/** The format's reading floor as a 1-based step: the second at 9:16, the first at 16:9. */
export const floorStep = (canvas) => (isWide(canvas) ? 1 : HALF);

const isChat = (shot) => (shot.style ?? 'chat') === 'chat';

const ORPHAN_STEP = 0.94; // a ruled row re-set this much narrower, each try, until its last line holds two words
const ORPHAN_TRIES = 8;

// `text` laid out at `maxWidth`, or, for ruled rows (data.rows, ledger), at the widest of a few narrower widths at which
// no line holds a lone word (no orphan: gate-ledger-1 ruling 1, every line); the first try when none does.
function layNoOrphan(lay, text, font, maxWidth) {
  const first = lay(text, font, maxWidth);
  let width = maxWidth;
  for (let i = 0, set = first; i < ORPHAN_TRIES; i++, width *= ORPHAN_STEP, set = lay(text, font, width)) {
    if (set.lines.length < HALF || set.lines.every((l) => l.words.length >= HALF)) return set;
  }
  return first;
}

// A ruled row's indent in px (data.indent units, ledger: gate-ledger-2 ruling 1): a `me` message starts that far in, so the
// two speakers read apart without bubbles or invented names; 0 for `them`, for bubbles and in a look without it.
const indentOf = (item, data, unit) => (data.rows && data.indent && item.from === 'me' ? data.indent * unit : 0);
// A chat message's side padding in px: a ruled row has no body to pad, so its text runs from the row's edge (the
// hairline's start); a bubble keeps data.pad.
const sidePad = (data, unit) => (data.rows ? 0 : data.pad * unit);

// Each item's text laid out at `size`, with its box height: { text, app?, w, h } in px.
function itemsAt(shot, ctx, data, room, size) {
  const { look, unit, measure } = ctx;
  const face = data.face ?? 'text'; // the messages' face: the look's `face`, else its text face
  const font = fontFor(look, face, size, unit);
  const bold = { ...font, weight: data.bold };
  const pad = data.pad * unit;
  const width = room.w * data.share;
  const plain = (text, f, maxWidth) => layoutText({ text: setCase(look, face, text), font: f, maxWidth, measure });
  const lay = data.rows ? (text, f, maxWidth) => layNoOrphan(plain, text, f, maxWidth) : plain;
  return shot.items.map((item) => {
    if (isChat(shot)) {
      const inset = indentOf(item, data, unit);
      const text = lay(item.text, font, width - inset - HALF * sidePad(data, unit));
      // a ruled row runs the full width (from its indent); a bubble is as wide as its text
      return { text, w: data.rows ? width - inset : text.width + HALF * pad, h: text.height + HALF * pad };
    }
    const app = lay(item.app, bold, width - HALF * pad - (DISC + DISC_GAP) * size);
    const text = lay(item.text, font, width - HALF * pad);
    const header = Math.max(app.height, DISC * size); // the disc sits inside the header row, clear of the text
    return { app, text, header, w: width, h: header + text.height + HALF * pad };
  });
}

/** The size the feed is set at and its items laid out: { size, font, bold, items, title, fits } (fits: the finished
 *  thread fits the room). The largest whole-unit size, from the largest of data.steps down to the format's floor, at
 *  which every message holds in maxLines and the thread fits; else the largest at which the messages hold (the thread
 *  then scrolls); else the floor. Between steps rather than on one: a step's jump left a tall frame 59% filled. */
export function feedFit(shot, ctx, data, room) {
  const { look, unit, canvas } = ctx;
  const least = Math.round(sizeAt(look, floorStep(canvas), unit) / unit);
  // ruled rows set the title MIN_HERO_RATIO times the messages, at most data.titleMax units: the messages no larger;
  // a title on the look's slug (data.titleSlug) caps nothing: the messages are the hero
  const capped = data.rows && !data.titleSlug ? Math.floor(data.titleMax / MIN_HERO_RATIO) : Infinity;
  const most = Math.min(capped, Math.round(sizeAt(look, Math.max(...data.steps), unit) / unit));
  const tries = [];
  for (let units = most; units >= least; units -= 1) {
    const t = tryAt(shot, ctx, data, room, units * unit);
    if (t.fits) return t;
    tries.push(t);
  }
  return tries.find((t) => t.holds) ?? tries.at(-1);
}

// The items, title and fit at `size` px.
function tryAt(shot, ctx, data, room, size) {
  const { look, unit, measure } = ctx;
  const items = itemsAt(shot, ctx, data, room, size);
  const face = data.face ?? 'text';
  const bold = { ...fontFor(look, face, size, unit), weight: data.bold };
  // the title in the look's `titleFace` (desk: the label face, a speaker tag) at its own weight, else bold messages' face
  // ruled rows (data.rows): the title over the body in the hierarchy, MIN_HERO_RATIO times the messages
  const titleFace = data.titleFace ?? face;
  const titleSize = data.rows ? MIN_HERO_RATIO * size : size;
  const titleFont = data.titleFace ? fontFor(look, titleFace, titleSize, unit) : bold;
  const title = shot.title === undefined || data.titleSlug ? null : layoutText({ text: setCase(look, titleFace, shot.title), font: titleFont, maxWidth: room.w, measure });
  const height = (title ? title.height + data.gap * unit : 0) + items.reduce((h, it) => h + it.h, 0) + (items.length - 1) * data.gap * unit;
  // ruled rows also hold only where no line of a message is one word (gate-ledger-1 ruling 1, every line, not the last)
  const lone = (it) => data.rows && it.text.lines.length > 1 && it.text.lines.some((l) => l.words.length < HALF);
  const holds = items.every((it) => it.text.lines.length <= data.maxLines && !lone(it) && (!it.app || it.app.lines.length === 1));
  return { size, font: fontFor(look, face, size, unit), bold, titleFont, items, title, holds, fits: holds && height <= room.h };
}

// A slip or bubble at `box`: the look's shadow (desk), the body, and its outline (pop); for ruled rows (data.rows,
// ledger) only a hairline across the row's top, no body.
function plate(id, box, style, ctx, data) {
  const { look, unit } = ctx;
  if (data.rows) {
    const [x, y, w] = box;
    return [node('path', `${id}.rule`, { d: `M${x} ${y}H${x + w}`, stroke: colourOf(look, data.line), strokeWidth: data.lineWidth * unit })];
  }
  const d = roundedRect(...box, data.radius * unit);
  const out = [];
  if (data.shadow) {
    const { dx, dy, blur, alpha, color } = look.shadow;
    out.push(node('path', `${id}.shadow`, { d, fill: colourOf(look, color), opacity: alpha, x: (dx * unit) / HALF, y: (dy * unit) / HALF, ...(blur > 0 ? { blur: (blur * unit) / HALF } : {}) }));
  }
  out.push(node('path', `${id}.plate`, { d, fill: colourOf(look, style.fill) }));
  if (data.lineWidth > 0) out.push(node('path', `${id}.line`, { d, stroke: colourOf(look, data.line), strokeWidth: data.lineWidth * unit }));
  return out;
}

// One item's nodes with its box's top-left at (x, y).
function itemNodes(id, item, shot, k, { x, y }, ctx, data, fit) {
  const { look, unit } = ctx;
  const pad = data.pad * unit;
  const chat = isChat(shot);
  const style = chat ? data[shot.items[k].from] : data.card;
  const box = [x, y, item.w, item.h];
  const fill = colourOf(look, style.text);
  if (chat) {
    const lit = data.lit ? { wordTracks: item.text.lines.flatMap((line) => line.words.map(() => ({ fill: fit.lit[k] }))) } : {};
    return [...plate(id, box, style, ctx, data), node('text', `${id}.text`, { x: x + sidePad(data, unit), y: y + pad, layout: item.text, font: fit.font, fill }, lit)];
  }
  const discD = DISC * fit.size, cy = y + pad + item.header / HALF;
  const discFill = colourOf(look, data.discs[appIndex(shot, k) % data.discs.length]);
  const initial = layoutText({ text: setCase(look, 'text', shot.items[k].app.trim()[0].toUpperCase()), font: fit.bold, maxWidth: 1e6, measure: ctx.measure });
  return [
    ...plate(id, box, style, ctx, data),
    node('path', `${id}.disc`, { d: roundedRect(x + pad, cy - discD / HALF, discD, discD, discD / HALF), fill: discFill }),
    node('text', `${id}.initial`, { x: x + pad + (discD - initial.width) / HALF, y: cy - initial.height / HALF, layout: initial, font: fit.bold, fill: colourOf(look, data.discText) }),
    node('text', `${id}.app`, { x: x + pad + discD + DISC_GAP * fit.size, y: cy - item.app.height / HALF, layout: item.app, font: fit.bold, fill }),
    node('text', `${id}.text`, { x: x + pad, y: y + pad + item.header, layout: item.text, font: fit.font, fill }),
  ];
}

// The index of an item's app among the distinct apps, in order of first appearance (its disc colour).
const appIndex = (shot, k) => [...new Set(shot.items.map((i) => i.app))].indexOf(shot.items[k].app);

// Typing dots in a small `them` bubble at (x, y), shown from `from` until `to`.
function dotsNodes(id, { x, y }, ctx, data, fit, from, to) {
  const { look, unit } = ctx;
  const r = DOT_R * fit.size, pad = data.pad * unit;
  const w = HALF * pad + DOTS_SPAN * r, h = fit.font.lineHeight * fit.size + HALF * pad;
  const dots = [0, 1, 2].map((i) => node('path', `${id}.dot${i}`, { d: roundedRect(x + pad + r + i * 3 * r, y + h / HALF - r, HALF * r, HALF * r, r), fill: colourOf(look, data.dots) }));
  return [node('group', id, {}, { tracks: { opacity: shownFrom(from, to) }, children: [...plate(id, [x, y, w, h], data.them, ctx, data), ...dots] })];
}

// A track holding `values[0]` and moving to each next value with the settle move from its time in `times`.
function settling(values, times, look) {
  const move = look.moves.settle;
  const keys = [{ t: 0, v: values[0] }];
  let end = 0;
  values.slice(1).forEach((v, i) => {
    const from = keys.at(-1).v;
    if (v === from) return;
    const at = Math.max(times[i + 1], end);
    keys.push({ t: at, v: from }, { t: at + move.dur, v, ease: move.ease });
    end = at + move.dur;
  });
  return track(keys);
}

/** When each item appears: one per sentence when the counts match, else on the spoken word that begins it (`texts`, the
 *  items' texts: a message of two sentences arrives on its first; poster gate render 1 held the first of two messages
 *  3.7 s when the second waited for the end of the narration), else evenly over the narration (or the shot); the
 *  first on frame 0 and every later one when it is spoken (lead ruling 4, round 2: narration timing wins over the old
 *  0.8 s "no lone first message" beat of gate-kinds-b-1), every one landed by `latest`. */
export function feedTimes(n, timing, latest, texts = null) {
  const sentences = timing.sentences ?? [];
  const end = Math.min(latest, timing.words?.length ? timing.words.at(-1).end ?? latest : latest);
  if (sentences.length === n) return sentences.map((s, k) => (k === 0 ? 0 : Math.min(s.start, latest)));
  const even = Array.from({ length: n }, (_, k) => (n <= 1 ? 0 : (k * end) / (n - 1)));
  return Array.isArray(texts) && texts.length === n ? spokenTimes(texts, timing, latest) ?? even : even;
}

// Each text on the first spoken word, after the one before it, that is its own first word; null when a text's first word
// is not spoken (in order), so the caller keeps its even spacing. The first text is on frame 0.
function spokenTimes(texts, timing, latest) {
  const spoken = (timing.words ?? []).map((w) => ({ form: wordForm(w.text), start: w.start }));
  let from = 0;
  const times = [];
  for (const [k, text] of texts.entries()) {
    const first = wordForm(String(text).split(/\s+/).find(Boolean) ?? '');
    const at = spoken.findIndex((w, i) => i >= from && w.form === first);
    if (at < 0) return null;
    times.push(k === 0 ? 0 : Math.min(Math.max(0, spoken[at].start), latest));
    from = at + 1;
  }
  return times;
}

/** When a `them` message's dots show, or null: DOTS before it, after the message before it, never on frame 0. */
export function dotsWindow(shot, k, times) {
  if (!isChat(shot) || k === 0 || shot.items[k].from !== 'them') return null;
  const from = Math.max(times[k] - DOTS, times[k - 1] + FRAME);
  return times[k] - from >= MIN_DOTS ? [from, times[k]] : null;
}

/** The feed's nodes and boxes: { nodes, boxes, times } (times: when each item appears). */
export function feedLayout(shot, ctx, data, given, times) {
  const { look, unit } = ctx;
  const { room, slug } = slugRoom(shot, ctx, data, given);
  const fit = { ...feedFit(shot, ctx, data, room), lit: data.lit ? shot.items.map((_, k) => litTrack(look, data.lit, k, times)) : null };
  const gap = data.gap * unit;
  const titleNodes = fit.title ? [node('text', `${shot.id}.title`, { x: room.x, y: room.y, layout: fit.title, font: fit.titleFont, fill: colourOf(look, data.title) })] : [];
  const top = room.y + (fit.title ? fit.title.height + gap : 0);
  const bottom = room.y + room.h;
  const laid = isChat(shot) ? chatThread(shot, ctx, data, fit, { room, top, bottom, gap, times }) : cardStack(shot, ctx, data, fit, { room, top, bottom, gap, times });
  return { nodes: [...slug, ...titleNodes, ...laid.nodes], boxes: laid.boxes, times };
}

// The room the feed composes in and the slug over it: with data.titleSlug (ledger, gate-ledger-2 ruling 1) the title is
// set as the look's slug (the tag at the top left, kinds/slug.mjs, the one builder every kind's slug uses) and the
// messages take the room under it, data.titleGap units down; else the given room and no slug.
function slugRoom(shot, ctx, data, room) {
  const staged = { ...shot, kicker: shot.title };
  if (!data.titleSlug || shot.title === undefined) return { room, slug: [] };
  // a look with no slug of its own (a stack look, poster) sets the title on its tag as the slug (slug.mjs tagSlugOf)
  const own = slugBox(staged, ctx);
  const placed = own ?? tagSlugOf(staged, ctx);
  const top = placed.box[1] + placed.box[3] + data.titleGap * ctx.unit;
  return { room: { ...room, y: top, h: room.y + room.h - top }, slug: own === null ? placed.nodes : slugNodes(staged, ctx) };
}

// A message's colour track when the spoken one is lit (data.lit, ledger): `spoken` while it is current (from its time
// to the next message's), `other` before and after, mixed in the look's colour space over its emphasize move; the first
// message is lit on frame 0. Opaque colours, never an alpha (ban 6).
function litTrack(look, lit, k, times) {
  const on = colourOf(look, lit.spoken), off = colourOf(look, lit.other);
  const { dur, ease } = look.moves.emphasize;
  const keys = k === 0 ? [{ t: 0, v: on }] : [{ t: 0, v: off }, { t: times[k], v: off }, { t: times[k] + dur, v: on, ease }];
  if (times[k + 1] !== undefined) keys.push({ t: times[k + 1], v: on }, { t: times[k + 1] + dur, v: off, ease });
  return track(keys, { space: look.colorSpace });
}

// Ruled rows (data.rows) share the room's spare height between them, so the thread fills the frame; 0 otherwise.
function rowSpread(fit, data, { top, bottom, gap }) {
  if (!data.rows) return 0;
  const used = fit.items.reduce((h, it) => h + it.h, 0) + (fit.items.length - 1) * gap;
  return Math.max(0, bottom - top - used) / fit.items.length;
}

function chatThread(shot, ctx, data, fit, { room, top, bottom, gap, times }) {
  const step = gap + rowSpread(fit, data, { top, bottom, gap });
  const ys = fit.items.reduce((acc, it, k) => [...acc, k === 0 ? top : acc[k - 1] + fit.items[k - 1].h + step], []);
  const starts = times.map((t, k) => dotsWindow(shot, k, times)?.[0] ?? t); // when each takes its place
  const offsets = fit.items.map((it, k) => Math.max(0, ys[k] + it.h - bottom));
  const hideAt = fit.items.map((_, k) => starts.find((s, j) => j > k && ys[k] < top + offsets[j] - 1e-6));
  const xOf = (k) => (shot.items[k].from === 'me' && !data.rows ? room.x + room.w - fit.items[k].w : room.x + indentOf(shot.items[k], data, ctx.unit));
  const children = fit.items.flatMap((it, k) => {
    const id = `${shot.id}.item${k}`;
    // ruled rows have no typing dots (a bubble's device); lit rows (data.lit) are all set from frame 0, the spoken one lit
    const win = data.rows ? null : dotsWindow(shot, k, times);
    const dots = win ? dotsNodes(`${id}.dots`, { x: room.x, y: ys[k] }, ctx, data, fit, win[0], win[1]) : [];
    const shown = shownFrom(data.lit ? 0 : times[k], hideAt[k]);
    return [...dots, node('group', id, {}, { tracks: { opacity: shown }, children: itemNodes(id, it, shot, k, { x: xOf(k), y: ys[k] }, ctx, data, fit) })];
  });
  const thread = node('group', `${shot.id}.thread`, {}, { tracks: { y: settling(offsets.map((o) => -o), starts, ctx.look) }, children });
  const last = offsets.at(-1);
  const boxes = Object.fromEntries(fit.items.map((it, k) => [`item:${k}`, [xOf(k), ys[k] - last, it.w, it.h]]));
  return { nodes: [thread], boxes };
}

function cardStack(shot, ctx, data, fit, { room, top, bottom, gap, times }) {
  const n = fit.items.length;
  // where item k stands once item j (j >= k) has arrived: under the newer ones
  const yAt = (k, j) => top + fit.items.slice(k + 1, j + 1).reduce((h, it) => h + it.h + gap, 0);
  const nodes = fit.items.map((it, k) => {
    const id = `${shot.id}.item${k}`;
    const steps = Array.from({ length: n - k }, (_, i) => yAt(k, k + i) - yAt(k, k));
    const pushed = steps.findIndex((dy) => yAt(k, k) + dy + it.h > bottom + 1e-6);
    // older cards make room first: each move lands as the newer card arrives (never before the card before it)
    const room0 = times.map((t, j) => (j === 0 ? t : Math.max(times[j - 1], t - ctx.look.moves.settle.dur)));
    const hide = pushed < 0 ? undefined : room0[k + pushed];
    const y = settling(steps, room0.slice(k), ctx.look);
    return node('group', id, {}, { tracks: { opacity: shownFrom(times[k], hide), y }, children: itemNodes(id, it, shot, k, { x: room.x, y: yAt(k, k) }, ctx, data, fit) });
  });
  const boxes = Object.fromEntries(fit.items.map((it, k) => [`item:${k}`, [room.x, yAt(k, n - 1), it.w, it.h]]));
  return { nodes, boxes };
}

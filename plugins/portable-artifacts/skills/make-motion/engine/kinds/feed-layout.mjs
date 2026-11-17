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

// Each item's text laid out at `size`, with its box height: { text, app?, w, h } in px.
function itemsAt(shot, ctx, data, room, size) {
  const { look, unit, measure } = ctx;
  const face = data.face ?? 'text'; // the messages' face: the look's `face`, else its text face
  const font = fontFor(look, face, size, unit);
  const bold = { ...font, weight: data.bold };
  const pad = data.pad * unit;
  const width = room.w * data.share;
  const lay = (text, f, maxWidth) => layoutText({ text: setCase(look, face, text), font: f, maxWidth, measure });
  return shot.items.map((item) => {
    if (isChat(shot)) {
      const text = lay(item.text, font, width - HALF * pad);
      return { text, w: text.width + HALF * pad, h: text.height + HALF * pad };
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
  const most = Math.round(sizeAt(look, Math.max(...data.steps), unit) / unit);
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
  const titleFace = data.titleFace ?? face;
  const titleFont = data.titleFace ? fontFor(look, titleFace, size, unit) : bold;
  const title = shot.title === undefined ? null : layoutText({ text: setCase(look, titleFace, shot.title), font: titleFont, maxWidth: room.w, measure });
  const height = (title ? title.height + data.gap * unit : 0) + items.reduce((h, it) => h + it.h, 0) + (items.length - 1) * data.gap * unit;
  const holds = items.every((it) => it.text.lines.length <= data.maxLines && (!it.app || it.app.lines.length === 1));
  return { size, font: fontFor(look, face, size, unit), bold, titleFont, items, title, holds, fits: holds && height <= room.h };
}

// A slip or bubble at `box`: the look's shadow (desk), the body, and its outline (pop).
function plate(id, box, style, ctx, data) {
  const { look, unit } = ctx;
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
  if (chat) return [...plate(id, box, style, ctx, data), node('text', `${id}.text`, { x: x + pad, y: y + pad, layout: item.text, font: fit.font, fill })];
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

/** When each item appears: one per sentence when the counts match, else evenly over the narration (or the shot); the
 *  first on frame 0, the second by FIRST_BEAT (a lone first message held for a whole sentence read as an unfinished
 *  frame: gate-kinds-b-1), every one landed by `latest`. */
export function feedTimes(n, timing, latest) {
  const sentences = timing.sentences ?? [];
  const end = Math.min(latest, timing.words?.length ? timing.words.at(-1).end ?? latest : latest);
  const times = sentences.length === n
    ? sentences.map((s, k) => (k === 0 ? 0 : Math.min(s.start, latest)))
    : Array.from({ length: n }, (_, k) => (n <= 1 ? 0 : (k * end) / (n - 1)));
  return times.map((t, k) => (k === 1 ? Math.min(t, FIRST_BEAT, latest) : t));
}
const FIRST_BEAT = 0.8; // s: the longest a feed shows its first item alone

/** When a `them` message's dots show, or null: DOTS before it, after the message before it, never on frame 0. */
export function dotsWindow(shot, k, times) {
  if (!isChat(shot) || k === 0 || shot.items[k].from !== 'them') return null;
  const from = Math.max(times[k] - DOTS, times[k - 1] + FRAME);
  return times[k] - from >= MIN_DOTS ? [from, times[k]] : null;
}

/** The feed's nodes and boxes: { nodes, boxes, times } (times: when each item appears). */
export function feedLayout(shot, ctx, data, room, times) {
  const { look, unit } = ctx;
  const fit = feedFit(shot, ctx, data, room);
  const gap = data.gap * unit;
  const titleNodes = fit.title ? [node('text', `${shot.id}.title`, { x: room.x, y: room.y, layout: fit.title, font: fit.titleFont, fill: colourOf(look, data.title) })] : [];
  const top = room.y + (fit.title ? fit.title.height + gap : 0);
  const bottom = room.y + room.h;
  const laid = isChat(shot) ? chatThread(shot, ctx, data, fit, { room, top, bottom, gap, times }) : cardStack(shot, ctx, data, fit, { room, top, bottom, gap, times });
  return { nodes: [...titleNodes, ...laid.nodes], boxes: laid.boxes, times };
}

function chatThread(shot, ctx, data, fit, { room, top, bottom, gap, times }) {
  const ys = fit.items.reduce((acc, it, k) => [...acc, k === 0 ? top : acc[k - 1] + fit.items[k - 1].h + gap], []);
  const starts = times.map((t, k) => dotsWindow(shot, k, times)?.[0] ?? t); // when each takes its place
  const offsets = fit.items.map((it, k) => Math.max(0, ys[k] + it.h - bottom));
  const hideAt = fit.items.map((_, k) => starts.find((s, j) => j > k && ys[k] < top + offsets[j] - 1e-6));
  const xOf = (k) => (shot.items[k].from === 'me' ? room.x + room.w - fit.items[k].w : room.x);
  const children = fit.items.flatMap((it, k) => {
    const id = `${shot.id}.item${k}`;
    const win = dotsWindow(shot, k, times);
    const dots = win ? dotsNodes(`${id}.dots`, { x: room.x, y: ys[k] }, ctx, data, fit, win[0], win[1]) : [];
    return [...dots, node('group', id, {}, { tracks: { opacity: shownFrom(times[k], hideAt[k]) }, children: itemNodes(id, it, shot, k, { x: xOf(k), y: ys[k] }, ctx, data, fit) })];
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

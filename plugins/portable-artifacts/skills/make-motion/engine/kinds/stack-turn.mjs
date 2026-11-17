// The turned stack (poster's `turn`, look.stack.turn): on a tall frame a statement whose upright stack leaves its area
// short of the look's share is set turned 90 degrees, so its lines run the frame's long side. Each line reads bottom to
// top up the frame (rotate -90 about its layout's top-left corner), the first line leftmost, every line flush on the
// area's bottom edge (the kicker on its top edge); the lines stack left to right across the area's width, their layout
// boxes touching and inside the area, so no advance or descent crosses it. The kicker tag stays upright over the longest
// line. The rows are the stack's own or a word a line, whichever sets the smallest line larger; the lines keep the
// stack's two sizes (keepRatio). Pure and DOM-free.
import { stackLines } from '../text/breaks.mjs';
import { sizeAt, capBox } from './shared.mjs';
import { STACK, lineAt, fitLine, keepRatio, kickerHeight, bare } from './stack.mjs';

const TURN = -90; // degrees: the line reads bottom to top
const FIT_PASSES = 3;
const EPSILON = 1e-6;

// Where each line's layout box starts across the area, from 0, the boxes touching (a turned line's box is what the frame
// review's overlap rule sees, so the lines are spaced box to box; the ascent above the capitals and the descent below
// them are the gap); `end`: where the last box ends.
function across(lines) {
  const starts = [];
  let end = 0;
  for (const l of lines) {
    starts.push(end);
    end += l.layout.height;
  }
  return { starts, end };
}
const thickness = (lines) => across(lines).end;
// Along the frame: the longest line's advance.
const longest = (lines) => Math.max(...lines.map((l) => l.layout.width));

// The rows' lines fitted to `length` and kept to two sizes, then set smaller in proportion until the longest advance
// fits `length` and the lines together fit `across`. null when a line falls under scale step 3 or overflows.
function fitTurned(rows, words, { length, across, limits }, ctx, lead) {
  const texts = rows.map((row) => row.map((i) => bare(words[i])));
  let lines = keepRatio(texts.map((t) => fitLine(t, length, limits, ctx)), rows, words, ctx, lead);
  for (let i = 0; i < FIT_PASSES; i++) {
    const share = Math.min(1, length / longest(lines), across / thickness(lines));
    if (share >= 1 - EPSILON) break;
    lines = lines.map((line, k) => lineAt(texts[k], line.font.size * share, ctx));
  }
  const fails = lines.some((l) => l.layout.overflow === true || l.font.size < limits.min - EPSILON);
  return fails || longest(lines) > length + 1 || thickness(lines) > across + 1 ? null : lines;
}

/**
 * The stack turned in `area`: { rows, lines [{ font, layout, ink, x, baseline, turn: { x, y, rotate } }], area, kicker },
 * or null when no set of rows fits turned. `words`: the marked words (stack.mjs markedWords); `lead`: keepRatio's.
 */
export function turnedStack(words, shot, ctx, area, { lead } = {}) {
  const { look, unit } = ctx;
  const tag = kickerHeight(shot, ctx);
  const above = tag === 0 ? 0 : tag + STACK.kickerGap * unit;
  const room = { length: area.h - above, across: area.w, limits: { min: sizeAt(look, STACK.fromStep, unit), max: STACK.max * unit } };
  const own = stackLines(words);
  const single = words.map((_, i) => [i]);
  const candidates = (own.length === single.length ? [own] : [own, single])
    .map((rows) => ({ rows, lines: fitTurned(rows, words, room, ctx, lead) }))
    .filter((c) => c.lines !== null);
  if (candidates.length === 0) return null;
  const smallest = (c) => Math.min(...c.lines.map((l) => l.font.size));
  const best = candidates.reduce((a, c) => (smallest(c) > smallest(a) + EPSILON ? c : a));
  const bottom = area.top + area.h;
  const { starts } = across(best.lines);
  const lines = best.lines.map((line, k) => {
    const turn = { x: area.left + starts[k], y: bottom, rotate: TURN };
    return { ...line, x: turn.x, baseline: turn.y, turn };
  });
  // the kicker on the area's top edge, where the longest line ends when its length binds: every turned stack of a shot
  // (a list's items) shares one tag line
  const kicker = tag === 0 ? null : { top: area.top, left: area.left };
  return { rows: best.rows, lines, area, kicker };
}

/** A box [x, y, w, h] in a turned line's own space (origin its layout's top-left) as a canvas box. */
export function turnedBox(turn, [x, y, w, h]) {
  return [turn.x + y, turn.y - (x + w), h, w];
}

/** The canvas box of word `w` (its ink from `inkLeft` to `inkRight`) on a turned line. */
export function turnedWordBox(line, w, ink) {
  const baseline = line.layout.lines[0].y;
  return turnedBox(line.turn, capBox(w.x + ink.left, baseline, ink.right - ink.left, line.font.size));
}

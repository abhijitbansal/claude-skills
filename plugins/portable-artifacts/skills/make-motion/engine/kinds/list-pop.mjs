// The `list` kind in a stack composition (pop): the list is a sequence of hits, not a column. Each item is a stack
// (stack.mjs) under a count tag, "2 / 5" ("STEP 2 / 5" for steps), shown whole from its arrival until the next item
// arrives (a hard cut: one item on screen at a time). The title, when given, runs beside the count in the label face in
// ink2, as a running head, at most a third of the stack's largest line. A note sits under its item in the text face at
// the largest of look.kinds.list.smallSteps the stack stays three times, its cap line `noteGap` under the stack. Pure
// and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, setCase, shownFrom, stepUnder, stepsUnder } from './shared.mjs';
import { composeStack, stackNodes, stackArea } from './stack.mjs';
import { FORCE_MARK, PREPOSITIONS } from '../text/breaks.mjs';
import { restack } from './stack.mjs';
import { tagBox } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';
import { itemsOf } from './list-items.mjs';

const TAG_STEP = 2; // the tag device sets its text at scale step 2; the running head matches it
const HEAD_STEPS = [TAG_STEP, 1]; // the running head steps down to fit beside the count
const STEPS_WORD = 'STEP';
const HIT_MAX_WORDS = 3; // the most words the stack would set on one line
const SHORT_WORD = 4; // letters: a shorter word is not left alone on a line of its own
const NOT_LETTER_RE = /[^\p{L}\p{N}]/gu;
const NO_WRAP = 1e6;
const EPSILON = 1e-6;

/**
 * An item set as a hit: a short item (two or three words, no `|` of its own) broken over two lines, so each line fills
 * the width and the hit fills the frame (the stack would set three words on one small line). Three words break before
 * a preposition, else after the first word, or after the second when the first is short; two words break only when
 * both have SHORT_WORD letters or more, so no short word stands alone at the stack's full size.
 */
export function hitText(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.includes(FORCE_MARK) || words.length < 2 || words.length > HIT_MAX_WORDS) return text;
  const letters = (w) => w.replace(NOT_LETTER_RE, '').length;
  if (words.length === 2 && words.some((w) => letters(w) < SHORT_WORD)) return text;
  const before = words.findIndex((w, i) => i > 0 && PREPOSITIONS.has(w.toLowerCase().replace(NOT_LETTER_RE, '')));
  const at = before > 0 ? before : letters(words[0]) < SHORT_WORD ? HIT_MAX_WORDS - 1 : 1;
  return [...words.slice(0, at - 1), `${words[at - 1]}${FORCE_MARK}`, ...words.slice(at)].join(' ');
}

/** The count tag's text for item k of n: "k / n", "STEP k / n" for steps (1-based). */
export const countText = (shot, k, n) => `${shot.style === 'steps' ? `${STEPS_WORD} ` : ''}${k + 1} / ${n}`;

// The note's size: the largest of data.smallSteps the stack's largest line stays MIN_HERO_RATIO times, else the smallest.
function noteSize(look, data, lines, unit) {
  const largest = Math.max(...lines.map((line) => line.font.size));
  return sizeAt(look, stepUnder(look, data.smallSteps, unit, [{ size: largest, ratio: MIN_HERO_RATIO }]), unit);
}

// The note laid out under the stack: { layout, font, room } where room runs from the last line's ink to the note's last
// baseline plus its descent.
function noteFor(text, lines, area, ctx, data) {
  const { look, unit, measure } = ctx;
  const font = fontFor(look, 'text', noteSize(look, data, lines, unit), unit);
  const layout = layoutText({ text: setCase(look, 'text', text), font, maxWidth: area.w, measure });
  const room = data.noteGap * unit + CAP_HEIGHT * font.size + layout.lines.at(-1).y - layout.lines[0].y + WORD_DESCENT * font.size;
  return { layout, font, room };
}

// The running head: the title in label caps in ink2, a gutter after the count tag, on the tag's text baseline, at the
// largest of HEAD_STEPS that the stack's largest line stays MIN_HERO_RATIO times and that fits the width left; one that
// still does not fit says so (overflow: the review's creative fit finding). It is judged like any text (no furniture).
function runningHead(shot, id, { tag, plate, lines }, area, ctx) {
  const { look, unit, measure } = ctx;
  const label = tag.children.find((n) => n.type === 'text');
  const baseline = tag.props.y + label.props.y + label.props.layout.lines[0].y;
  const left = plate[0] + plate[2] + look.grid.gutter * unit;
  const width = area.left + area.w - left;
  const largest = Math.max(...lines.map((line) => line.font.size));
  const ratioed = stepsUnder(look, HEAD_STEPS, unit, [{ size: largest, ratio: MIN_HERO_RATIO }]);
  const steps = ratioed.length > 0 ? ratioed : [HEAD_STEPS.at(-1)];
  const at = (step) => {
    const font = fontFor(look, 'label', sizeAt(look, step, unit), unit);
    return { font, layout: layoutText({ text: setCase(look, 'label', shot.title), font, maxWidth: NO_WRAP, measure }) };
  };
  const set = steps.map(at).find((s) => s.layout.width <= width + EPSILON) ?? at(steps.at(-1));
  const layout = set.layout.width <= width + EPSILON ? set.layout : { ...set.layout, overflow: true };
  return node('text', id, { x: left, y: baseline - layout.lines[0].y, layout, font: set.font, fill: look.palette.ink2, role: 'kicker' });
}

// One item: its wrapper's children (the count tag, the running head, the stack, the note) and its box.
function itemParts(shot, item, k, n, ctx, data) {
  const { look, unit } = ctx;
  const area = stackArea(ctx);
  const staged = { ...shot, id: `${shot.id}.item${k}`, kicker: countText(shot, k, n) };
  const text = hitText(setCase(look, 'display', item.text));
  const first = composeStack(text, staged, ctx);
  const note = item.note === null ? null : noteFor(item.note, first.lines, area, ctx, data);
  const placed = restack(first, ctx, { below: note === null ? 0 : note.room });
  const hero = `${staged.id}.text`;
  const words = placed.rows.flat();
  const built = stackNodes(staged, ctx, placed, { times: words.map(() => ({ at: 0, emphasised: false })), ghost: false, matched: true, hero });
  const children = [...built.kicker, built.group];
  if (shot.title !== undefined) {
    const plate = tagBox(ctx, `${staged.id}.kicker`, staged.kicker, placed.kicker.left, placed.kicker.top);
    children.push(runningHead(shot, `${staged.id}.title`, { tag: built.kicker[0], plate, lines: placed.lines }, area, ctx));
  }
  if (note !== null) {
    const last = placed.lines.at(-1);
    const y = last.baseline + last.ink.down + data.noteGap * unit + CAP_HEIGHT * note.font.size - note.layout.lines[0].y;
    children.push(node('text', `${staged.id}.note`, { x: area.left, y, layout: note.layout, font: note.font, fill: look.palette.ink2, role: 'body' }));
  }
  return { id: staged.id, children, box: built.boxes.text };
}

/**
 * The pop list: { nodes: [], group: null, itemBoxes, wrappers } where each wrapper { id, tracks, children } is shown from
 * its item's arrival until the next one's (list.mjs puts each item's `on` devices inside it).
 * @param {number[]} times when each item arrives (listTimes)
 */
export function expandPopList(shot, ctx, data, times) {
  const items = itemsOf(shot);
  const parts = items.map((item, k) => itemParts(shot, item, k, items.length, ctx, data));
  const wrappers = parts.map((p, k) => ({ id: p.id, tracks: { opacity: shownFrom(times[k], times[k + 1]) }, children: p.children }));
  return { nodes: [], group: null, itemBoxes: parts.map((p) => p.box), wrappers };
}

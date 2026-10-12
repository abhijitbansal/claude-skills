import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  layoutSequence, ROW_HEIGHT, MIN_COLUMN_GAP, LABEL_CLEARANCE, FRAME_PAD, LOOP_WIDTH, ARROW_OFFSET, FRAME_HEAD,
} from '../scripts/lib/layout-sequence.mjs';
import { nodeSize, edgeLabelSize, fonts } from '../scripts/lib/sizes.mjs';
import { KINDS } from '../scripts/lib/kinds.mjs';
import { DEFAULT_ICON } from '../scripts/lib/icons.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { measure } from '../shared/text.mjs';

const theme = loadTheme('paper');
const MARGIN = 24;
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => JSON.parse(fs.readFileSync(here(rel), 'utf8'));
const example = () => read('../references/examples/sequence.diagram.json');
const fixture = () => read('./fixtures/sequence.diagram.json');
const layout = (spec) => layoutSequence(spec, theme);

const right = (b) => b.x + b.width;
const bottom = (b) => b.y + b.height;
const within = (inner, outer) => inner.x >= outer.x - 0.05 && inner.y >= outer.y - 0.05 && right(inner) <= right(outer) + 0.05 && bottom(inner) <= bottom(outer) + 0.05;
const lineY = (m) => m.points[0].y;
const part = (g, id) => g.participants.find((p) => p.id === id);
const msg = (g, id) => g.messages.find((m) => m.id === id);
const spec = (extra) => ({
  type: 'sequence',
  participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  messages: [],
  ...extra,
});

test('the shipped example and fixture are valid sequence specs', async () => {
  assert.deepEqual((await validateSpec(example())).errors, []);
  assert.deepEqual((await validateSpec(fixture())).errors, []);
});

test('example: geometry matches the golden file', () => {
  const g = layout(example());
  const file = here('./golden/sequence.layout.json');
  if (process.env.PA_WRITE_GOLDEN === '1') {
    fs.mkdirSync(here('./golden'), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(g, null, 2)}\n`);
  }
  assert.deepEqual(g, JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('two runs give identical geometry', () => {
  assert.deepEqual(layout(example()), layout(example()));
});

test('coordinates are rounded to 0.1 px', () => {
  const g = layout(example());
  const nums = [g.width, g.height,
    ...g.participants.flatMap((p) => [p.x, p.y, p.width, p.height, p.lifeline.x, p.lifeline.y1, p.lifeline.y2]),
    ...g.messages.flatMap((m) => [...m.points.flatMap((p) => [p.x, p.y]), ...(m.label ? [m.label.x, m.label.y, m.label.width] : [])]),
    ...g.frames.flatMap((f) => [f.x, f.y, f.width, f.height]),
    ...g.notes.flatMap((n) => [n.x, n.y, n.width, n.height])];
  for (const v of nums) assert.equal(Math.round(v * 10) / 10, v);
});

test('everything sits inside the canvas with the 24 px margin', () => {
  for (const s of [example(), fixture()]) {
    const g = layout(s);
    const canvas = { x: 0, y: 0, width: g.width, height: g.height };
    const boxes = [...g.participants, ...g.frames, ...g.notes, ...g.messages.flatMap((m) => (m.label ? [m.label] : []))];
    for (const b of boxes) assert.ok(within(b, canvas), 'inside canvas');
    assert.ok(Math.min(...boxes.map((b) => b.x)) >= MARGIN - 0.05, 'left margin');
    assert.ok(Math.min(...g.participants.map((p) => p.y)) >= MARGIN - 0.05, 'top margin');
    assert.ok(Math.max(...boxes.map(right)) <= g.width - MARGIN + 0.05, 'right margin');
    assert.ok(g.participants.every((p) => p.lifeline.y2 <= g.height - MARGIN + 0.05), 'bottom margin');
    for (const m of g.messages) for (const p of m.points) assert.ok(p.x >= 0 && p.x <= g.width && p.y <= g.height, 'points inside');
  }
});

test('participants share one header row and each lifeline starts under it', () => {
  const g = layout(spec({ participants: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'A much longer participant name that wraps onto two lines', kind: 'database' },
    { id: 'c', label: 'C', kind: 'actor' },
  ] }));
  assert.equal(new Set(g.participants.map((p) => p.y)).size, 1);
  assert.equal(new Set(g.participants.map((p) => p.height)).size, 1);
  for (const p of g.participants) {
    assert.equal(p.lifeline.y1, p.y + p.height);
    assert.equal(p.lifeline.x, p.x + p.width / 2);
  }
  assert.equal(new Set(g.participants.map((p) => p.lifeline.y2)).size, 1);
});

test('participant boxes are sized by sizes.mjs, labels wrap to at most two lines', () => {
  const s = spec({ participants: [{ id: 'a', label: 'A much longer participant name that wraps onto two lines' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] });
  const g = layout(s);
  const sized = nodeSize(s.participants[0], KINDS.sequence.kinds.service, theme);
  assert.equal(part(g, 'a').width, sized.width);
  assert.deepEqual(part(g, 'a').lines, sized.lines);
  assert.ok(part(g, 'a').lines.length <= 2);
});

test('participants carry the resolved icon: explicit, else the kind default', () => {
  const g = layout(fixture());
  assert.equal(part(g, 'auth').icon, 'lucide:lock');
  assert.equal(part(g, 'u').icon, DEFAULT_ICON.actor);
  assert.equal(part(g, 'app').icon, DEFAULT_ICON.service);
  assert.equal(part(g, 'u').kind, 'actor');
  assert.equal(part(g, 'app').kind, 'service');
  for (const p of layout(example()).participants) assert.ok(p.icon, `${p.id} keeps an icon`);
});

test('adjacent participant boxes keep the 64 px minimum gap and lifelines run left to right', () => {
  const g = layout(example());
  g.participants.slice(1).forEach((p, i) => {
    const prev = g.participants[i];
    assert.ok(p.x - right(prev) >= MIN_COLUMN_GAP - 0.05, `${prev.id} to ${p.id}`);
    assert.ok(p.lifeline.x > prev.lifeline.x);
  });
});

test('a long message label widens the column gap instead of clipping', () => {
  const short = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b', label: 'ok' }] }));
  const long = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b', label: 'a considerably longer label that needs room' }] }));
  const gap = (g) => part(g, 'b').lifeline.x - part(g, 'a').lifeline.x;
  assert.ok(gap(long) > gap(short));
  const need = edgeLabelSize('a considerably longer label that needs room', theme).width + LABEL_CLEARANCE;
  assert.ok(gap(long) >= need);
  const l = msg(long, 'm').label;
  assert.ok(l.x >= part(long, 'a').lifeline.x && right(l) <= part(long, 'b').lifeline.x, 'label between its lifelines');
});

test('a label over a non-adjacent span fits between the outer lifelines', () => {
  const label = 'a label that is wider than either column on its own gap';
  const g = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'c', label }] }));
  const l = msg(g, 'm').label;
  assert.ok(l.x >= part(g, 'a').lifeline.x && right(l) <= part(g, 'c').lifeline.x);
});

test('every message label is laid out on a single line plate', () => {
  const g = layout(example());
  const edgeFont = fonts(theme).edge;
  for (const m of g.messages) {
    assert.ok(m.label, m.id);
    assert.ok(m.label.width >= measure(m.label.text, edgeFont), `${m.id} plate holds its text`);
  }
});

test('a message without a label has label null', () => {
  const g = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b' }] }));
  assert.equal(msg(g, 'm').label, null);
});

test('messages run strictly down the page, one row each, self messages two', () => {
  const g = layout(example());
  g.messages.slice(1).forEach((m, i) => {
    const prev = g.messages[i];
    assert.ok(lineY(m) > lineY(prev), `${prev.id} then ${m.id}`);
    assert.ok(m.row > prev.row);
  });
  const self = msg(g, 'm6');
  const next = msg(g, 'm7');
  assert.equal(next.row - self.row, 2, 'a self message takes two rows');
  assert.equal(msg(g, 'm1').row, 0);
  const rowsUsed = g.messages.length + 1 /* the self message's second row */ + g.notes.length;
  assert.equal(g.rows, rowsUsed);
});

test('rows are ROW_HEIGHT apart when no frame or note intervenes', () => {
  const g = layout(spec({ messages: [{ id: 'm1', from: 'a', to: 'b' }, { id: 'm2', from: 'b', to: 'c' }, { id: 'm3', from: 'c', to: 'a' }] }));
  assert.equal(lineY(msg(g, 'm2')) - lineY(msg(g, 'm1')), ROW_HEIGHT);
  assert.equal(lineY(msg(g, 'm3')) - lineY(msg(g, 'm2')), ROW_HEIGHT);
  assert.equal(g.rows, 3);
});

test('arrows run from the sender lifeline to the receiver lifeline, in either direction', () => {
  const g = layout(spec({ messages: [{ id: 'm1', from: 'a', to: 'c' }, { id: 'm2', from: 'c', to: 'a', kind: 'reply' }] }));
  const ax = part(g, 'a').lifeline.x;
  const cx = part(g, 'c').lifeline.x;
  assert.deepEqual(msg(g, 'm1').points.map((p) => p.x), [ax, cx]);
  assert.deepEqual(msg(g, 'm2').points.map((p) => p.x), [cx, ax]);
  for (const m of g.messages) assert.equal(m.points[0].y, m.points[1].y, 'horizontal');
});

test('message kinds are preserved so the renderer can dash replies', () => {
  const g = layout(example());
  assert.deepEqual(g.messages.map((m) => m.kind), ['sync', 'sync', 'sync', 'async', 'reply', 'self', 'sync', 'reply', 'sync', 'reply', 'reply']);
  assert.equal(layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b' }] })).messages[0].kind, 'sync');
});

test('a self message loops to the right of its lifeline and returns to it', () => {
  const g = layout(example());
  const m = msg(g, 'm6');
  const x = part(g, 'orders').lifeline.x;
  assert.equal(m.points.length, 4);
  assert.equal(m.points[0].x, x);
  assert.equal(m.points[3].x, x);
  assert.equal(m.points[1].x, x + LOOP_WIDTH);
  assert.equal(m.points[2].x, x + LOOP_WIDTH);
  assert.ok(m.points[2].y > m.points[1].y);
  assert.ok(m.label.x >= x + LOOP_WIDTH, 'label right of the loop');
  assert.ok(right(m.label) <= part(g, 'db').lifeline.x, 'label stops before the next lifeline');
});

test('a self message on the last participant widens the canvas rather than clipping', () => {
  const g = layout(spec({ messages: [{ id: 'm', from: 'c', to: 'c', kind: 'self', label: 'a long self message label on the edge' }] }));
  assert.ok(right(msg(g, 'm').label) <= g.width - MARGIN + 0.05);
});

const framesOf = (g) => g.frames.map((f) => ({ f, rows: f.messages.map((id) => msg(g, id)) }));

test('each frame encloses exactly its messages', () => {
  const g = layout(example());
  for (const { f, rows } of framesOf(g)) {
    const first = rows[0];
    const last = rows.at(-1);
    const lastBottom = last.kind === 'self' ? Math.max(...last.points.map((p) => p.y)) : lineY(last);
    assert.ok(f.y < first.label.y, 'top above the first label');
    assert.ok(bottom(f) > lastBottom, 'bottom below the last arrow');
    for (const m of rows) {
      const xs = m.points.map((p) => p.x);
      assert.ok(Math.min(...xs) >= f.x && Math.max(...xs) <= right(f), `${m.id} within frame width`);
      assert.ok(within(m.label, f), `${m.id} label inside frame`);
    }
    const outside = g.messages.filter((m) => !f.messages.includes(m.id));
    for (const m of outside) assert.ok(lineY(m) < f.y || lineY(m) > bottom(f), `${m.id} is outside the frame`);
    assert.ok(bottom(f) - lastBottom >= FRAME_PAD, 'FRAME_PAD below the last arrow');
  }
});

test('a frame keeps 12 px of padding left and right of the lifelines it covers', () => {
  const g = layout(spec({
    messages: [{ id: 'm1', from: 'a', to: 'b', label: 'x' }],
    frames: [{ kind: 'opt', messages: ['m1'] }],
  }));
  const [f] = g.frames;
  assert.equal(part(g, 'a').lifeline.x - f.x, FRAME_PAD);
  assert.equal(right(f) - part(g, 'b').lifeline.x, FRAME_PAD);
  assert.equal(f.label, null);
  assert.equal(f.labelBox, undefined);
});

test('a frame pads 12 px below its last row and leaves a head for the tab above its first', () => {
  const g = layout(spec({
    messages: [{ id: 'm1', from: 'a', to: 'b', label: 'x' }],
    frames: [{ kind: 'opt', messages: ['m1'] }],
  }));
  const [f] = g.frames;
  assert.equal(bottom(f) - lineY(msg(g, 'm1')), ROW_HEIGHT - ARROW_OFFSET + FRAME_PAD);
  assert.equal(lineY(msg(g, 'm1')) - f.y, FRAME_HEAD + ARROW_OFFSET);
});

test('a nested frame sits strictly inside the frame that contains it', () => {
  const g = layout(example());
  const [outer, inner] = g.frames;
  assert.equal(outer.kind, 'loop');
  assert.equal(inner.kind, 'alt');
  assert.ok(inner.x > outer.x && right(inner) < right(outer));
  assert.ok(inner.y > outer.y && bottom(inner) < bottom(outer));
});

test('consecutive frames do not overlap', () => {
  const g = layout(spec({
    messages: [{ id: 'm1', from: 'a', to: 'b' }, { id: 'm2', from: 'b', to: 'a' }, { id: 'm3', from: 'a', to: 'c' }],
    frames: [{ kind: 'loop', label: 'first', messages: ['m1', 'm2'] }, { kind: 'opt', label: 'second', messages: ['m3'] }],
  }));
  assert.ok(bottom(g.frames[0]) < g.frames[1].y);
});

test('a frame label tab holds the kind and the label, and the frame is wide enough for both', () => {
  const g = layout(spec({
    participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    messages: [{ id: 'm1', from: 'a', to: 'b', label: 'x' }],
    frames: [{ kind: 'alt', label: 'a frame label that is far wider than the lifelines it covers', messages: ['m1'] }],
  }));
  const [f] = g.frames;
  assert.ok(f.tab.width >= measure('alt', fonts(theme).group));
  assert.ok(f.labelBox.x >= f.x + f.tab.width);
  assert.ok(right(f.labelBox) <= right(f) + 0.05, 'label fits inside the frame');
  assert.ok(right(f) <= g.width - MARGIN + 0.05);
});

test('notes span their over participants and sit in the row after their message', () => {
  const g = layout(example());
  const stored = g.notes.find((n) => n.after === 'm3');
  const key = g.notes.find((n) => n.after === 'm4');
  assert.deepEqual(key.over, ['orders', 'psp']);
  assert.ok(key.x <= part(g, 'orders').lifeline.x && right(key) >= part(g, 'psp').lifeline.x, 'spans both lifelines');
  assert.ok(stored.x <= part(g, 'db').lifeline.x && right(stored) >= part(g, 'db').lifeline.x, 'covers its lifeline');
  assert.ok(stored.y > lineY(msg(g, 'm3')) && stored.y < lineY(msg(g, 'm4')), 'between m3 and m4');
  assert.ok(key.y > lineY(msg(g, 'm4')) && key.y < lineY(msg(g, 'm5')), 'between m4 and m5');
});

test('note text wraps to the note width and the box grows to hold every line', () => {
  const text = 'a note that is far too long to sit on a single line above one narrow participant column';
  const g = layout(spec({
    participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    messages: [{ id: 'm', from: 'a', to: 'b' }],
    notes: [{ over: ['a'], text, after: 'm' }],
  }));
  const [n] = g.notes;
  assert.ok(n.lines.length >= 2, 'wrapped');
  assert.equal(n.lines.join(' '), text);
  const f = fonts(theme).note;
  for (const line of n.lines) assert.ok(measure(line, f) <= n.width, 'line fits the box');
  assert.ok(n.height >= n.lines.length * 15);
  assert.ok(right(n) < part(g, 'b').lifeline.x, 'does not cross the neighbouring lifeline');
  assert.ok(n.x >= MARGIN - 0.05);
});

test('a note with no after goes above the first message', () => {
  const g = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b' }], notes: [{ over: ['a', 'b'], text: 'first' }] }));
  assert.ok(g.notes[0].y < lineY(msg(g, 'm')));
  assert.equal(g.rows, 2);
});

test('zero messages is a valid diagram with a lifeline per participant', () => {
  const g = layout(spec({}));
  assert.equal(g.messages.length, 0);
  assert.equal(g.rows, 0);
  assert.equal(g.frames.length, 0);
  assert.equal(g.notes.length, 0);
  for (const p of g.participants) assert.ok(p.lifeline.y2 > p.lifeline.y1);
  assert.ok(g.width > 0 && g.height > g.participants[0].lifeline.y2);
});

test('a single participant lays out', () => {
  const g = layout({ type: 'sequence', participants: [{ id: 'a', label: 'Only' }], messages: [{ id: 'm', from: 'a', to: 'a', kind: 'self', label: 'think' }] });
  assert.equal(g.participants.length, 1);
  assert.equal(g.participants[0].x, MARGIN);
  assert.ok(right(msg(g, 'm').label) <= g.width - MARGIN + 0.05);
});

test('a message, note and frame at the limits (12 participants, 60 messages) still lay out inside the canvas', () => {
  const participants = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `Participant ${i}` }));
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, from: `p${i % 12}`, to: `p${(i * 5 + 3) % 12}`, label: `message ${i}`, ...(i % 12 === (i * 5 + 3) % 12 ? { kind: 'self' } : {}) }));
  const g = layout({ type: 'sequence', participants, messages, frames: [{ kind: 'par', messages: ['m3', 'm4', 'm5'] }], notes: [{ over: ['p0', 'p11'], text: 'wide', after: 'm10' }] });
  assert.equal(g.messages.length, 60);
  for (let i = 1; i < g.messages.length; i++) assert.ok(lineY(g.messages[i]) > lineY(g.messages[i - 1]));
  const canvas = { x: 0, y: 0, width: g.width, height: g.height };
  for (const m of g.messages) assert.ok(within(m.label, canvas));
});

test('special characters in labels pass through as plain text', () => {
  const g = layout(spec({ messages: [{ id: 'm', from: 'a', to: 'b', label: '<b> & "x"' }] }));
  assert.equal(msg(g, 'm').label.text, '<b> & "x"');
});

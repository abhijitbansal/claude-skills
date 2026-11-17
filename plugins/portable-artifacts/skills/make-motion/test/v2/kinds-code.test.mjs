// The `code` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 8): type, diff and run modes in the look's mono, one size, the
// largest step at which every line fits; the reading-floor table as arithmetic on the look data; validation and the
// review's fit findings; timing; the font seam; the bar in both looks and formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { sizeAt } from '../../engine/kinds/shared.mjs';
import { roomOf } from '../../engine/kinds/arrivals.mjs';
import { reviewRoom, innerOf, holds } from '../../engine/kinds/code-fit.mjs';
import { facesFor } from '../../engine/page/fonts-shared.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { expandIn, filmOf, all, canvasOf, platformOf } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const code = registries.kinds.get('code');
const look = (name) => registries.looks.get(name);
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const expand = (shot, lookName = 'desk', format = '16:9') => {
  const film = filmOf([shot], lookName, format);
  return expandIn(film, 0, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
};
const texts = (out) => all(out.nodes).filter((n) => n.type === 'text');
const shownAt = (n, t) => (n.tracks.opacity ? sample(n.tracks.opacity, t) : 1);
const reviewOf = (shot, lookName, format) => code.review(shot, { look: look(lookName), canvas: canvasOf(format), viralInsets: platformOf(canvasOf(format)) });
const JS = { id: 'c', show: 'code', lang: 'js', code: 'const a = 1;\nconst b = 2;\nreturn a + b;' };

// ---- the reading-floor table ----

test('the table: characters a line holds at the smallest step, from the look data (90, 44, 79, 32)', () => {
  const cases = [['desk', '16:9', 90], ['desk', '9:16', 44], ['pop', '16:9', 79], ['pop', '9:16', 32]];
  for (const [name, format, chars] of cases) {
    const l = look(name), canvas = canvasOf(format), unit = Math.min(canvas.w, canvas.h) / 1080;
    const inner = innerOf(reviewRoom(l, canvas, platformOf(canvas)), l.kinds.code, unit);
    assert.equal(holds(inner, l.kinds.code, sizeAt(l, 1, unit)).chars, chars, `${name} ${format}`);
  }
});

test('the review builds the room the kind composes in from the safe-zone insets it is passed (scripts/v2/review.mjs)', () => {
  for (const [name, format] of [['desk', '16:9'], ['desk', '9:16'], ['pop', '16:9'], ['pop', '9:16']]) {
    const out = expand(JS, name, format);
    const room = roomOf(out.ctx), est = reviewRoom(look(name), canvasOf(format), platformOf(canvasOf(format)));
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(room[k] - est[k]) < 0.5, `${name} ${format} ${k}: ${room[k]} vs ${est[k]}`);
  }
});

test('short code is set large: one size for every text, as large as the lines and rows fit, up to the top step', () => {
  const out = expand(JS, 'desk', '16:9');
  const sizes = new Set(texts(out).map((n) => n.props.layout.size));
  assert.equal(sizes.size, 1);
  assert.equal([...sizes][0], sizeAt(look('desk'), 3, 1), 'three short lines at desk 16:9 take the top code step (72)');
  const size = (shot, name, format) => texts(expand(shot, name, format))[0].props.layout.size;
  assert.equal(size({ ...JS, code: 'x'.repeat(60) }, 'desk', '16:9'), 45, 'floor(1632 / (0.6 x 60)) = 45');
  assert.equal(size({ ...JS, code: 'x'.repeat(70) }, 'desk', '16:9'), 38, 'floor(1632 / (0.6 x 70)) = 38');
  assert.equal(size({ ...code.example }, 'pop', '16:9'), 47, 'a title and 12 lines in 872: floor(872 / (1.4 x 13)) = 47, not the floor step 36');
});

test('tall frames: the title is the hero over the card (at least 3x the code), the card takes the room\'s width; a run without a title heroes its command', () => {
  for (const name of ['desk', 'pop']) {
    const out = expand(code.example, name, '9:16');
    const hero = all(out.nodes).find((n) => n.id === 'total.hero');
    const runSize = texts(out).find((n) => /^total\.l1\./.test(n.id)).props.layout.size;
    assert.equal(hero.props.role, 'hero');
    assert.ok(hero.props.layout.size >= 3 * runSize - 1e-6, `${name}: hero ${hero.props.layout.size} vs code ${runSize}`);
    assert.ok(!texts(out).some((n) => /^total\.title\.c/.test(n.id)), `${name}: no title row in the card`);
    assert.ok(Math.abs(out.boxes.code[2] - roomOf(out.ctx).w) < 1e-6, `${name}: the card spans the room`);
    assert.equal(code.nodeField(code.example, 'total.hero'), 'title');
    const wide = expand(code.example, name, '16:9');
    assert.equal(all(wide.nodes).find((n) => n.id === 'total.hero'), undefined, `${name}: no hero at 16:9`);
  }
  const run = expand({ id: 'r', show: 'code', mode: 'run', command: 'npm test', output: 'ran 12 tests\nall passed', hold: 3 }, 'pop', '9:16');
  assert.ok(all(run.nodes).some((n) => n.id === 'r.hero'), 'the command is the hero');
  assert.ok(!all(run.nodes).some((n) => /^r\.cmd\./.test(n.id)), 'and is not repeated in the card');
});

test('runs keep their columns: each run starts at its column times the measured advance', () => {
  const out = expand({ id: 'c', show: 'code', code: 'a  bb c' }, 'desk', '16:9');
  const runs = texts(out).filter((n) => /^c\.l1\.c\d+$/.test(n.id));
  const adv = runs[0].props.layout.size * 0.55; // the fake measure's advance
  assert.deepEqual(runs.map((n) => Math.round((n.props.x - runs[0].props.x) / adv)), [0, 3, 6]);
});

// ---- validation ----

test('validation: a field of another mode, a missing field, lang did-you-mean, line limits, highlight ranges', () => {
  const at = (shot, path) => errorsOf(shot).filter((e) => e.path === `shots[0].${path}`).map((e) => e.message);
  assert.deepEqual(at({ ...JS, before: 'x' }, 'before'), ['belongs to mode "diff"; this shot\'s mode is "type"']);
  assert.deepEqual(at({ id: 'c', show: 'code', mode: 'diff', before: 'x' }, 'after'), ['mode "diff" needs after']);
  assert.match(at({ ...JS, lang: 'pyhton' }, 'lang')[0], /^no language "pyhton"; did you mean "python"\?/);
  assert.match(at({ ...JS, code: Array(13).fill('x').join('\n') }, 'code')[0], /^13 lines; a code shot shows at most 12/);
  assert.deepEqual(at({ ...JS, code: 'y'.repeat(81) }, 'code'), ['line 1 is 81 characters; a line holds at most 80']);
  assert.deepEqual(at({ ...JS, highlight: [[2, 5]] }, 'highlight[0]'), ['[2,5] is not a line or a range of lines of code (1 to 3)']);
  assert.ok(errorsOf({ ...JS, command: 'ls' }).some((e) => e.path === 'shots[0].command'));
  assert.ok(errorsOf({ id: 'r', show: 'code', mode: 'run', command: 'a\nb' }).some((e) => e.path === 'shots[0].command'), 'a command is one line');
  assert.deepEqual(errorsOf({ ...JS, title: 'sum.js', highlight: [3, [1, 2]] }), []);
  assert.deepEqual(errorsOf({ id: 'r', show: 'code', mode: 'run', command: 'npm test', output: '3 passed' }), []);
});

// ---- the review ----

test('review: a line longer than the format holds is a finding at its field; the same line at 16:9 is fine', () => {
  const shot = { id: 'c', show: 'code', code: `const x = "${'a'.repeat(45)}";` };
  const found = reviewOf(shot, 'desk', '9:16');
  assert.ok(found.some((f) => f.path === 'code' && f.message === 'line 1 is 58 characters; at 9:16 in the desk look a line holds 44: break it or cut it'), JSON.stringify(found));
  assert.deepEqual(reviewOf(shot, 'desk', '16:9'), []);
});

test('review: on a tall frame a block under 70% of the height says to shorten lines or add lines; the example says nothing in any case', () => {
  const found = reviewOf(JS, 'desk', '9:16');
  assert.ok(found.some((f) => f.path === 'code' && /shorten the lines so the type can grow, or add the lines that matter/.test(f.message)), JSON.stringify(found));
  for (const name of ['desk', 'pop']) for (const format of ['16:9', '9:16']) assert.deepEqual(reviewOf(code.example, name, format), [], `${name} ${format}`);
});

// ---- timing ----

test('type: the panel, the title and the first line on frame 0; the rest types on and has landed by the narration\'s end', () => {
  const shot = { ...JS, title: 'sum.js', say: 'We add two numbers and return the sum.' };
  const out = expand(shot);
  const line1 = texts(out).filter((n) => /^c\.l1\./.test(n.id) || /^c\.title\./.test(n.id));
  assert.ok(line1.every((n) => shownAt(n, 0) === 1), 'line 1 and the title on frame 0');
  const rest = texts(out).filter((n) => /^c\.l[23]\./.test(n.id));
  assert.ok(rest.every((n) => shownAt(n, 0) === 0), 'the rest not yet');
  const end = out.timing.words.at(-1).end;
  assert.ok(rest.every((n) => shownAt(n, end + 1e-6) === 1), 'all typed by the narration\'s end');
  assert.ok(Math.abs(code.landing(shot, out.timing) - end) < 1e-6, 'the land event when the last run lands');
});

test('type with two sentences or more: typing lands by the last sentence, which is said over the finished code and its highlight', () => {
  const out = expand(code.example);
  const last = out.timing.sentences.at(-1).start;
  const runs = texts(out).filter((n) => /^total\.l\d+\.c\d+$/.test(n.id));
  assert.ok(runs.every((n) => shownAt(n, last + 1e-6) === 1), 'every run on screen by the last sentence');
  assert.ok(Math.abs(code.landing(code.example, out.timing) - last) < 1e-6);
  const mark = all(out.nodes).find((n) => n.id === 'total.l6.mark');
  assert.equal(shownAt(mark, last - 1e-3), 0);
  assert.equal(shownAt(mark, last + 1e-6), 1, 'the highlight on the last sentence');
});

test('diff: before whole on frame 0; removed lines struck at the change, then gone; added lines after; one change event', () => {
  const shot = { id: 'd', show: 'code', mode: 'diff', lang: 'js', before: 'let a = 1;\nlet b = 2;', after: 'let a = 1;\nlet b = 3;', say: 'This was two. Now it is three.' };
  const out = expand(shot);
  const [event] = code.events(shot, out.timing);
  assert.equal(event.device, 'change');
  assert.ok(Math.abs(event.t - out.timing.sentences[1].start) < 1e-6, 'on the second sentence');
  const removed = all(out.nodes).find((n) => n.id === 'd.d1');
  const strike = all(out.nodes).find((n) => n.id === 'd.d1.strike');
  const added = texts(out).filter((n) => /^d\.d2\.c/.test(n.id));
  assert.equal(shownAt(removed, 0), 1);
  assert.equal(shownAt(strike, 0), 0);
  assert.equal(shownAt(strike, event.t), 1);
  assert.equal(shownAt(removed, code.landing(shot, out.timing)), 0);
  assert.ok(added.every((n) => shownAt(n, 0) === 0 && shownAt(n, code.landing(shot, out.timing)) === 1));
  assert.ok(code.landing(shot, out.timing) <= out.timing.duration - 0.6 + 1e-6);
});

test('run: the prompt on frame 0, the command typed over the first sentence, output after; the output event on its first line', () => {
  const shot = { id: 'r', show: 'code', mode: 'run', command: 'npm test -- --watch', output: 'ran 12 tests\nall passed', say: 'Run the tests. Twelve run, and all pass.' };
  const out = expand(shot);
  const prompt = texts(out).find((n) => n.id === 'r.prompt');
  assert.equal(shownAt(prompt, 0), 1);
  const [event] = code.events(shot, out.timing);
  assert.equal(event.device, 'output');
  const firstOut = texts(out).filter((n) => /^r\.out1\./.test(n.id));
  assert.ok(firstOut.every((n) => shownAt(n, event.t) === 1 && shownAt(n, event.t - 0.05) === 0));
  const cmd = texts(out).filter((n) => /^r\.cmd\./.test(n.id));
  assert.ok(cmd.every((n) => shownAt(n, out.timing.sentences[0].end + 1e-6) === 1), 'the command typed by the first sentence\'s end');
});

// ---- the font seam ----

test('facesFor loads the look\'s code mono for a film with a code shot (pop loads none of its own), and only then', () => {
  const families = (film) => facesFor({ film, fonts: look(film.look).fonts }).map((f) => f.family);
  assert.ok(families({ look: 'pop', mode: 'viral', shots: [JS] }).includes('JetBrains Mono'));
  assert.ok(!families({ look: 'pop', mode: 'viral', shots: [{ id: 's', show: 'statement', text: 'Hi' }] }).includes('JetBrains Mono'));
});

// ---- the bar (code's own floor: the look's smallest step) ----

const full = () => ({ ...code.example, title: 'total.py', highlight: [7, [3, 4]] });
const DIFF = { id: 'd', show: 'code', mode: 'diff', lang: 'python', title: 'price.py', say: 'The old price was fixed. Now it reads the table.',
  before: 'def price(item):\n  return 10', after: 'def price(item):\n  p = table[item]\n  return p' };
const RUN = { id: 'r', show: 'code', mode: 'run', title: 'terminal', command: 'npm test', output: 'ran 12 tests\nall passed', say: 'Run the tests. Twelve run, and all pass.' };
for (const name of ['desk', 'pop']) {
  const floor = look(name).scale[0];
  for (const format of ['16:9', '9:16']) {
    test(`code bar: the example in ${name} at ${format}`, () => assertBar('code', code.example, { look: name, format, floor, prepare: true }));
    test(`code bar: the full fixture in ${name} at ${format}`, () => assertBar('code', full(), { look: name, format, floor, prepare: true }));
  }
  test(`code bar: a diff and a run in ${name} at 16:9`, () => {
    assertBar('code', DIFF, { look: name, format: '16:9', floor, prepare: true });
    assertBar('code', RUN, { look: name, format: '16:9', floor, prepare: true });
  });
  test(`code at 9:16 in ${name}: a short diff and a short run are told to grow, not padded to fill`, () => {
    for (const shot of [DIFF, RUN]) assert.ok(reviewOf(shot, name, '9:16').some((f) => /shorten the lines so the type can grow/.test(f.message)), shot.id);
  });
}

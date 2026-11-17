// The turned stack (looks-four plan, Task 6 `turn`, carried to tall frames by the Task 7 round three ruling): a poster
// statement whose upright stack leaves its 9:16 composition area short of look.stack.turn is turned 90 degrees, its lines
// read bottom to top up the frame, the kicker upright above; a statement that fills the frame upright, every wide frame
// and every look without stack.turn data is not turned. Also the scale emphasis's two sizes when the emphasised row is
// the widest (the viral hook): the emphasised row large, the others the ratio smaller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { snapshotOf } from './helpers/bar.mjs';
import { filmOf, filmFor, expandIn, all, FILLER } from './helpers/kinds.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';

const STATEMENT = Object.freeze({ id: 'hook', show: 'statement', say: 'Numbers need *sources*.', kicker: 'The problem' });
const LONG = Object.freeze({ id: 'long', show: 'statement', say: 'Every chart in the film shows where each of its numbers came from today.' });
const EPS = 1;
const SAMPLE_AT = 0.5; // s into the shot: every word is set (poster opens set)

// The hero's line nodes as sampled at t (canvas boxes), and the area the stack composes in.
function heroLines(shots, look, format, mode, index = 0) {
  const built = filmFor(shots, look, format, { mode });
  const shot = shots[index];
  const nodes = all(snapshotOf(built.sampleShot(index, SAMPLE_AT)));
  const lines = nodes.filter((n) => n.type === 'text' && n.props.stack === `${shot.id}.text`);
  const { ctx, boxes } = expandIn(filmOf(shots, look, format, { mode }), index);
  return { lines, area: stackArea(ctx), boxes };
}
const turned = (lines) => lines.filter((n) => Math.abs((n.rotate ?? 0) + 90) < 1e-9);

// the turned cases: a pro statement, and a viral statement after the hook (the lead's ruling: the hook never turns)
const TURNED = Object.freeze([['pro', [STATEMENT], 0], ['viral', [FILLER, STATEMENT], 1]]);

test('poster: the viral hook (a viral film\'s first statement) at 9:16 stays upright on frame 0', () => {
  const { lines } = heroLines([STATEMENT], 'poster', '9:16', 'viral');
  assert.ok(lines.length > 0);
  assert.equal(turned(lines).length, 0, `rotations ${lines.map((n) => n.rotate)}`);
});

for (const [mode, shots, index] of TURNED) {
  test(`poster: a short statement at 9:16 in ${mode} (not a hook) is turned, every line up the frame`, () => {
    const { lines } = heroLines(shots, 'poster', '9:16', mode, index);
    assert.ok(lines.length > 0);
    assert.equal(turned(lines).length, lines.length, `rotations ${lines.map((n) => n.rotate)}`);
  });

  test(`poster: a turned statement at 9:16 in ${mode} keeps every line's layout box inside its area`, () => {
    const { lines, area } = heroLines(shots, 'poster', '9:16', mode, index);
    for (const n of lines) {
      const [x, y, w, h] = n.bbox;
      assert.ok(x >= area.left - EPS && y >= area.top - EPS && x + w <= area.left + area.w + EPS && y + h <= area.top + area.h + EPS,
        `${n.id} at ${n.bbox.map(Math.round)} leaves ${JSON.stringify(area)}`);
    }
  });

  test(`poster: the word targets of a turned statement at 9:16 in ${mode} are the turned words`, () => {
    const { lines, boxes } = heroLines(shots, 'poster', '9:16', mode, index);
    const within = (b, o) => b[0] >= o[0] - EPS && b[1] >= o[1] - EPS && b[0] + b[2] <= o[0] + o[2] + EPS && b[1] + b[3] <= o[1] + o[3] + EPS;
    for (let i = 0; i < 3; i++) {
      const box = boxes[`word:${i}`];
      assert.ok(box[3] > box[2], `word ${i} box ${box.map(Math.round)} runs up the frame`);
      assert.ok(lines.some((n) => within(box, n.bbox)), `word ${i} box ${box.map(Math.round)} lies on a turned line`);
    }
  });
}

test('poster: a statement that fills the tall frame upright is not turned', () => {
  const { lines } = heroLines([LONG], 'poster', '9:16', 'pro');
  assert.equal(turned(lines).length, 0);
});

for (const mode of ['pro', 'viral']) {
  test(`poster: a statement at 16:9 in ${mode} is not turned`, () => {
    const { lines } = heroLines([STATEMENT], 'poster', '16:9', mode);
    assert.equal(turned(lines).length, 0);
  });
}

test('pop (no stack.turn data): a short statement at 9:16 is not turned', () => {
  assert.equal(registries.looks.get('pop').stack.turn, undefined);
  const { lines } = heroLines([STATEMENT], 'pop', '9:16', 'viral');
  assert.equal(turned(lines).length, 0);
});

test('poster: the viral hook sets its emphasised row large when it is the widest row, the others the ratio smaller', () => {
  const { lines } = heroLines([STATEMENT], 'poster', '9:16', 'viral');
  const sizes = lines.map((n) => n.props.font.size);
  const lead = lines.findIndex((n) => n.props.layout.lines[0].words.some((w) => /SOURCES/.test(w.text)));
  const others = sizes.filter((_, k) => k !== lead);
  const ratio = registries.looks.get('poster').stack.ratio;
  for (const s of others) assert.ok(Math.abs(sizes[lead] / s - ratio) < 0.01, `sizes ${sizes.map((v) => v.toFixed(1))}: the lead ${sizes[lead].toFixed(1)} over ${s.toFixed(1)}`);
});

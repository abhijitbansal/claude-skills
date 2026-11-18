// The fix items of gate review 4 (.superpowers/sdd/2026-11-16-pa2-look-cosmos/gate-review-4.md) that the looks phase
// fixes in cosmos's data and the small engine options it names: glow only on light (the figure of a number carries none),
// no overshoot on a chart's bars (a data mark never shows a wrong value), a plain to-scale Earth in the compare (the
// ringed dot reads as a radio button and doubles the dot's apparent size). Each test names the item it holds. (The
// 9:16 hook's split "eight minutes" was tried and reverted: whole, the hook falls from 174 to 76 units.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../../engine/time/track.mjs';
import { editorialSpan } from '../../engine/kinds/editorial.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';

const wide = (shot) => expandIn(filmOf([shot], 'cosmos', '16:9', { mode: 'pro' }));
const tall = (shot) => expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
const byId = (nodes, id) => all(nodes).find((n) => n.id === id);
const FPS = 30;

// review 4 S2 / shot 2 / shot 5: "white glow on the numerals is light logic leaking"
test('number: the figure carries no glow (glow is for light: the sun, the line and the emphasised words)', () => {
  for (const expand of [wide, tall]) {
    const out = expand({ id: 'd', show: 'number', say: 'One hundred fifty million kilometres.', value: 150, suffix: 'M km', label: 'from the Sun to Earth' });
    const digits = byId(out.nodes, 'd.value.digits');
    assert.ok(digits, 'the figure is drawn');
    assert.equal(digits.wordTracks.some((w) => w.glow !== undefined), false, 'no glow track on the figure');
    assert.equal(digits.props.glow, undefined, 'no glow style on the figure');
  }
});

// review 4 shot 5: "the bars overshoot on entry ... a spring on data bars shows wrong values for a moment"
const GIANTS = { id: 'g', show: 'chart', type: 'column', title: 'Jupiter dwarfs the rest', say: 'Neptune, four Earths. Saturn, nine. Jupiter beats them all.', data: [{ label: 'Earth', value: 13 }, { label: 'Neptune', value: 49 }, { label: 'Saturn', value: 116 }, { label: 'Jupiter', value: 140 }], highlight: 'Jupiter', source: 'NASA planetary fact sheet' };
const BARS = { ...GIANTS, id: 'b', type: 'bar' };

test('chart: no bar is ever longer than its final length while it grows (no overshoot on data marks)', () => {
  // wide columns grow up (scaleY), bars and a tall frame's columns grow across (scaleX)
  for (const [expand, shot] of [[wide, GIANTS], [tall, GIANTS], [wide, BARS]]) {
    const out = expand(shot);
    const marks = all(out.nodes).filter((n) => new RegExp(`^${shot.id}\\.mark\\.\\d+$`).test(n.id));
    assert.equal(marks.length, shot.data.length);
    for (const mark of marks) {
      const track = mark.tracks.scaleX ?? mark.tracks.scaleY;
      assert.ok(track, `${mark.id} grows on a scale track`);
      const final = sample(track, out.timing.duration);
      for (let i = 0; i <= Math.round(out.timing.duration * FPS * 4); i++) {
        const v = sample(track, i / (FPS * 4));
        assert.ok(v <= final + 1e-9, `${mark.id} at ${(i / (FPS * 4)).toFixed(3)} s is ${v} over its final ${final}`);
      }
    }
  }
});

// review 4 S3 / sizes shots: "draw Earth as a plain disc at true scale with no ring"
const SUN = { id: 'sun', show: 'compare', say: 'Earth is twelve thousand kilometres across. The Sun is one hundred and nine Earths.', left: { title: 'Earth', value: 12742 }, right: { title: 'The Sun', value: 1392700 } };

test('compare as scale: the Earth is a plain disc with no ring, in both formats', () => {
  for (const expand of [wide, tall]) {
    const out = expand(SUN);
    assert.ok(byId(out.nodes, 'sun.left.earth.dot'), 'the Earth disc');
    assert.equal(all(out.nodes).filter((n) => /^sun\.left\..*ring$/.test(n.id)).length, 0, 'no ring round it');
  }
});

test('compare as scale on a wide frame: with no ring the disc stands on the column edge (no room kept for a ring)', () => {
  const out = wide(SUN);
  const earth = byId(out.nodes, 'sun.left.earth');
  const r = (out.ctx.look.kinds.compare.discs.minDot / 2) * out.ctx.unit;
  const edge = editorialSpan(out.ctx, 1, out.ctx.look.grid.columns).x;
  assert.ok(Math.abs(earth.props.x - r - edge) < 1, `disc left edge ${earth.props.x - r} vs the column edge ${edge}`);
});

test('the Earth keeps its ring where it is a marker, not a measured body (the number line, the quote)', () => {
  const out = wide({ id: 'n', show: 'number', say: 'Nine kinds.', value: 9, label: 'kinds of shot' });
  assert.ok(all(out.nodes).some((n) => /earth\.ring$/.test(n.id)), 'the number line ends on the ringed Earth');
});


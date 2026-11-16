// EXPERIMENTAL LOOK (cosmos) and shipped desk: the items of branch review C this fix round takes. A counter that never
// opens on a wrong value, the compare discs' printed ratio and fall back to cards, a list title or numbering a look
// does not draw reported, and the desk chart claim fitted as before the cosmos work. One test per ruling, written first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { sample } from '../../engine/time/track.mjs';
import { drawsDiscs, discSizes, ratioText } from '../../engine/kinds/compare-discs.mjs';
import { expandShot, all } from './helpers/kinds.mjs';

const cosmos = () => registries.looks.get('cosmos');
const textAt = (digits, t) => digits.props.steps.find((s) => s.words.every((i) => sample(digits.wordTracks[i].opacity, t) === 1))?.text ?? '';
const digitCount = (text) => text.replace(/\D/g, '').length;

// ---- C-I11: the counter's opening ----

test('C-I11: a counter never opens on a wrong intermediate value: 150, 8 and 459 show no figure on the first frame, then the count from its first step of the final digit count', () => {
  const shots = [
    { id: 'n', show: 'number', value: 150, suffix: 'M km', label: 'from the Sun', say: 'The Earth sits 150 million kilometres from the Sun.' },
    { id: 'n', show: 'number', value: 8, label: 'planets', say: 'Eight planets go round it.' },
    { id: 'n', show: 'number', value: 459, label: 'rows', say: 'Four hundred fifty nine rows. One file.' },
  ];
  for (const shot of shots) {
    for (const format of ['16:9', '9:16']) {
      const { nodes, timing } = expandShot(shot, 'cosmos', format);
      const digits = all(nodes).find((n) => n.id === 'n.value.digits');
      assert.equal(textAt(digits, 0), '', `${shot.value} ${format}: no figure on the first frame (${textAt(digits, 0)})`);
      const first = digits.props.steps[0];
      assert.equal(digitCount(first.text), digitCount(String(shot.value)), `${shot.value} ${format}: opens on "${first.text}"`);
      const land = registries.kinds.get('number').landing(shot, timing);
      const start = Math.max(0, land - Math.max(cosmos().moves.count.dur, 0.5));
      assert.ok(first.t >= start - 1e-9, `${shot.value} ${format}: shown at ${first.t}, the count starts at ${start}`);
      assert.equal(textAt(digits, first.t), first.text, `${shot.value} ${format}: in ink from then`);
      assert.equal(digits.props.steps.at(-1).text, String(shot.value), 'lands on the value');
      const suffix = all(nodes).find((n) => n.id === 'n.value.suffix');
      if (suffix) assert.equal(sample(suffix.tracks.opacity, 0), 0, `${format}: the unit is hidden with the figure`);
      // the first frame is still composed (the empty-first-frame rule): the look's sun, its line to Earth and Earth are
      // on screen (gate round 3: the line replaced the orbit)
      for (const id of ['n.sun', 'n.line0', 'n.earth']) {
        const device = all(nodes).find((n) => n.id === id);
        assert.ok(device && (device.tracks?.opacity ? sample(device.tracks.opacity, 0) : 1) > 0, `${shot.value} ${format}: ${id} on the first frame`);
      }
    }
  }
});

test('C-I11: in desk and pop (no fromFirst) the count still opens on 0 on its first frame', () => {
  for (const look of ['desk', 'pop']) {
    const { nodes } = expandShot({ id: 'n', show: 'number', value: 150, label: 'x', say: 'One hundred fifty of them.' }, look, '16:9');
    assert.equal(textAt(all(nodes).find((n) => n.id === 'n.value.digits'), 0), '0', look);
  }
});

// ---- C-I6, C-I7, C-I8: compare discs ----

test('C-I6: the printed ratio keeps one decimal under 10, groups thousands above 999, never prints an exponent (capped "more than" from look data)', () => {
  const data = cosmos().kinds.compare.discs;
  assert.equal(ratioText(2.49, data), '2.5');
  assert.equal(ratioText(9.94, data), '9.9');
  assert.equal(ratioText(109.2, data), '109');
  assert.equal(ratioText(1392700, data), '1,392,700');
  assert.match(ratioText(1e21, data), new RegExp(`^${data.more} [\\d,]+$`));
  assert.ok(!/e\+/.test(ratioText(1e21, data)));
});

test('C-I7, C-I8: near-equal values, or a look with no sun, fall back to the cards; the large disc has a size cap', () => {
  const data = cosmos().kinds.compare;
  const shot = (a, b) => ({ id: 'c', show: 'compare', say: 'One. Two.', left: { title: 'A', value: a }, right: { title: 'B', value: b } });
  assert.equal(drawsDiscs(shot(1, 1.5), data, cosmos()), false, 'under the threshold');
  assert.equal(drawsDiscs(shot(1, 109), data, cosmos()), true);
  assert.equal(drawsDiscs(shot(1, 109), data, { ...cosmos(), sun: undefined }), false, 'no sun');
  for (const format of ['16:9', '9:16']) {
    const near = expandShot(shot(100, 120), 'cosmos', format);
    assert.ok(!all(near.nodes).some((n) => /\.sun/.test(n.id)), `${format}: cards, no discs`);
    assert.ok(all(near.nodes).some((n) => n.id === 'c.left.title'), `${format}: the card titles`);
    const { ctx } = expandShot(shot(1, 109), 'cosmos', format);
    assert.doesNotThrow(() => registries.kinds.get('compare').expand(shot(1, 109), { ...ctx, look: { ...ctx.look, sun: undefined } }), `${format}: no sun, no throw`);
  }
  // the large disc at most `bigCap` times the room (past that its arc on the frame is a straight edge anyway)
  const huge = discSizes(1e-6, 1e14, 900, data.discs, 1);
  assert.ok(Number.isFinite(data.discs.bigCap) && huge.big <= data.discs.bigCap * 900 + 1e-6, `the big disc is capped (${huge.big})`);
});

// ---- C-C1: a list title or numbering the look does not draw ----

test('C-C1: in a look with no list slug the title is a creative finding at title, and numbering a dot rail does not show is one at style / numbered; desk and pop draw both', () => {
  const list = registries.kinds.get('list');
  const shot = { id: 'l', show: 'list', title: 'On the way', style: 'steps', items: ['Mercury', 'Venus'], say: 'Mercury first. Then Venus.' };
  for (const format of ['16:9', '9:16']) {
    const { timing } = expandShot(shot, 'cosmos', format);
    const found = list.review(shot, { look: cosmos(), timing, at: () => 0 });
    assert.ok(found.some((f) => f.kind !== 'mechanical' && f.path === 'title' && /does not draw/.test(f.message)), JSON.stringify(found));
    assert.ok(found.some((f) => f.path === 'style' && /numbers/.test(f.message)), JSON.stringify(found));
    const numbered = list.review({ ...shot, style: undefined, numbered: true }, { look: cosmos(), timing, at: () => 0 });
    assert.ok(numbered.some((f) => f.path === 'numbered'), JSON.stringify(numbered));
    for (const look of ['desk', 'pop']) {
      const own = list.review(shot, { look: registries.looks.get(look), timing, at: () => 0 });
      assert.deepEqual(own.filter((f) => ['title', 'style', 'numbered'].includes(f.path)), [], look);
    }
  }
});

// ---- C-I9: desk's chart claim fitted as before the cosmos work ----

test('C-I9: a desk chart claim at its floor is exactly three times the labels (as at 9ea68e6); only a look that sets titleMargin (cosmos) keeps a hair over', () => {
  const title = 'Every quarter the northern stores carried the whole region through a slow year';
  const shot = { id: 'c', show: 'chart', type: 'column', title, say: `${title}.`, data: [{ label: 'North', value: 12 }, { label: 'South', value: 18 }], source: 'Ledger' };
  for (const format of ['16:9', '9:16']) {
    const nodes = all(expandShot(shot, 'desk', format).nodes);
    const t = nodes.find((n) => n.id === 'c.title'), l = nodes.find((n) => n.id === 'c.label.0');
    assert.ok(Math.abs(t.props.font.size / l.props.font.size - 3) < 1e-9, `${format}: ${t.props.font.size / l.props.font.size}`);
  }
  assert.equal(registries.looks.get('desk').kinds.chart.titleMargin, undefined);
  assert.equal(cosmos().kinds.chart.titleMargin, 1.03);
});

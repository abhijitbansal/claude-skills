// Gate revision 2 of the cosmos look, the measurable rules for the frame: the 9:16 chart's bars across the safe width
// with their labels over them and the band's lower third used, the list's rail down the whole band, one minimum size for
// secondary text, the quote card at its final size from the first frame on the optical centre, and a 16:9 statement
// with equal margins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { editorialSpan, editorialBounds } from '../../engine/kinds/editorial.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';

const look = registries.looks.get('cosmos');
const wide = (shot) => expandIn(filmOf([shot], 'cosmos', '16:9', { mode: 'pro' }));
const tall = (shot) => expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
const byId = (nodes, id) => all(nodes).find((n) => n.id === id);
const numbers = (d) => d.match(/-?[\d.]+/g).map(Number);
const floorOf = (out) => look.secondary.min * out.ctx.unit;

const GIANTS = {
  id: 'g', show: 'chart', type: 'bar', title: 'Jupiter is the widest planet', say: 'Neptune, four Earths. Saturn, nine. Jupiter beats them all.',
  data: [{ label: 'Earth', value: 12742 }, { label: 'Neptune', value: 49244 }, { label: 'Saturn', value: 116460 }, { label: 'Jupiter', value: 139820 }],
  highlight: 'Jupiter', unit: ' km', source: 'NASA planetary fact sheet',
};

test('chart at 9:16: each label over its bar, the bars across the safe width, the band’s lower third used', () => {
  const out = tall(GIANTS);
  const span = editorialSpan(out.ctx, 1, look.grid.columns), band = editorialBounds(out.ctx);
  const marks = [0, 1, 2, 3].map((k) => byId(out.nodes, `g.mark.${k}`));
  const labels = [0, 1, 2, 3].map((k) => byId(out.nodes, `g.label.${k}`));
  marks.forEach((m, k) => {
    const ys = numbers(m.props.d).filter((_, i) => i % 2 === 1).map((y) => y + m.props.y);
    const labelBase = labels[k].props.y + labels[k].props.layout.lines[0].y;
    assert.ok(labelBase < Math.min(...ys), `label ${k} over its bar`);
    assert.ok(Math.abs(labels[k].props.x - span.x) < 1, 'flush with the safe left edge');
  });
  const value = byId(out.nodes, 'g.value.3');
  assert.ok(value.props.x + value.props.layout.width >= span.x + 0.85 * span.w, 'the longest bar and its value run across the width');
  const lastYs = numbers(marks[3].props.d).filter((_, i) => i % 2 === 1).map((y) => y + marks[3].props.y);
  assert.ok(Math.max(...lastYs) >= band.top + (2 / 3) * (band.bottom - band.top), 'the lower third holds the comparison');
});

test('chart: the marks grow in the lavender, gold only for the highlighted one; no teal anywhere in the look', () => {
  for (const expand of [wide, tall]) {
    const out = expand(GIANTS);
    assert.equal(byId(out.nodes, 'g.mark.0').props.fill, look.palette.ink2);
    assert.equal(byId(out.nodes, 'g.mark.3.accent').props.fill, look.palette.accent);
  }
  assert.ok(!Object.values(look.palette).includes('#4de2c5'), 'teal dropped');
});

test('secondary text (labels, source, attribution, ask, compare names and units) is never under the look floor', () => {
  const shots = [
    GIANTS,
    { id: 'q', show: 'quote', say: 'That is here. That is home. That is us.', by: 'Carl Sagan', role: 'Pale Blue Dot, 1994' },
    { id: 'e', show: 'end', say: 'Scale changes everything.', ask: 'Look up tonight.', mark: 'cosmos' },
    { id: 'n', show: 'number', say: 'Eight minutes.', value: 8, suffix: 'min', label: 'from the Sun to you' },
  ];
  for (const expand of [wide, tall]) {
    for (const shot of shots) {
      const out = expand(shot);
      for (const n of all(out.nodes).filter((m) => m.type === 'text' && ['label', 'ask', 'attribution', 'value'].includes(m.props.role))) {
        assert.ok(n.props.font.size >= floorOf(out) - 1e-9, `${n.id} (${n.props.role}) is ${n.props.font.size}`);
      }
    }
  }
});

test('list at 9:16: the rail runs the content band, sun at its top, the last item low', () => {
  const out = tall({ id: 'p', show: 'list', say: 'Past Mercury. Past Venus. Then you.', items: ['Mercury', 'Venus', 'You'] });
  const band = editorialBounds(out.ctx), h = band.bottom - band.top;
  const midY = (n) => { const ys = numbers(n.props.d).filter((_, i) => i % 2 === 1); return (Math.min(...ys) + Math.max(...ys)) / 2; };
  const dots = all(out.nodes).filter((n) => /^p\.dot\d+$/.test(n.id)).map((n) => ({ props: { y: midY(n) } }));
  assert.equal(dots.length, 3);
  assert.ok(dots[0].props.y <= band.top + 0.15 * h, `first dot at ${dots[0].props.y}`);
  assert.ok(dots.at(-1).props.y >= band.bottom - 0.15 * h, `last dot at ${dots.at(-1).props.y}`);
});

test('quote: the card at its final size from the first frame, on the optical centre', () => {
  for (const expand of [wide, tall]) {
    const out = expand({ id: 'q', show: 'quote', say: 'That is here. That is home. That is us.', by: 'Carl Sagan', role: 'Pale Blue Dot, 1994' });
    const grow = byId(out.nodes, 'q.card.grow');
    if (grow) assert.equal(sample(grow.tracks.scaleY, 0), 1, 'no growing card');
    const [x, y, w, h] = out.boxes.card;
    const span = editorialSpan(out.ctx, 1, look.grid.columns), band = editorialBounds(out.ctx);
    assert.ok(Math.abs(x + w / 2 - (span.x + span.w / 2)) < 0.03 * out.ctx.canvas.w, 'centred across');
    const mid = y + h / 2, centre = band.at(look.kinds.quote.centre);
    assert.ok(Math.abs(mid - centre) < 0.05 * out.ctx.canvas.h, `on the optical centre (${mid} vs ${centre})`);
  }
});

test('statement at 16:9: equal left and right margins', () => {
  const out = wide({ id: 's', show: 'statement', say: 'The sunlight on your face is *eight minutes* old.' });
  const [x, , w] = out.boxes.text;
  const right = out.ctx.canvas.w - (x + w);
  assert.ok(Math.abs(right - x) <= 0.1 * x, `left ${x} right ${right}`);
});

test('chart at 9:16: every bar shows (at least half a label tall); the source goes, said so, when the rows need its room', () => {
  const out = tall(GIANTS);
  const label = byId(out.nodes, 'g.label.0').props.font.size;
  for (const k of [0, 1, 2, 3]) {
    const ys = numbers(byId(out.nodes, `g.mark.${k}`).props.d).filter((_, i) => i % 2 === 1);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= label / 2, `bar ${k} is ${Math.max(...ys) - Math.min(...ys)} tall`);
  }
  const title = byId(out.nodes, 'g.title');
  if (!byId(out.nodes, 'g.source')) assert.deepEqual(title.props.dropped, ['source']);
});

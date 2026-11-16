// The `glow` emphasis (engine/devices/glow.mjs): an emphasised word takes the accent as it is spoken and its glyphs
// glow behind it (the draw layer's glyph shadow, props.glow on the text, a `glow` word track 0 to 1). No halo node, so
// the ink box the review measures is the text's alone; the radius is a third of the cap height, capped at the safe
// margin. test/v2/cosmos-glow-browser.test.mjs measures the contrast against the brightest glow pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import { glowFill, glowStyle } from '../../engine/devices/glow.mjs';
import { fontFor, CAP_HEIGHT } from '../../engine/kinds/shared.mjs';
import { sample } from '../../engine/time/track.mjs';
import { expandShot, expandIn, filmOf, all, textNode, FILLER } from './helpers/kinds.mjs';

const cosmos = registries.looks.get('cosmos');
const desk = registries.looks.get('desk');
const pop = registries.looks.get('pop');
const SAFE_MARGIN_UNITS = 60; // template/formats.mjs SAFE_MARGIN_PX at 1080

test('glowFill: the word turns from ink to the accent and its glow rises from 0 to 1 over the emphasize move from when it is spoken', () => {
  const { fill, glow } = glowFill(cosmos, 2);
  const end = 2 + cosmos.moves.emphasize.dur;
  assert.deepEqual([sample(fill, 0), sample(fill, 2), sample(fill, end)], [cosmos.palette.ink, cosmos.palette.ink, cosmos.palette.accent]);
  assert.deepEqual([sample(glow, 0), sample(glow, 2), sample(glow, end)], [0, 0, 1]);
});

test('glowStyle: cosmos gives a faint warm glow at a third of the cap height, at most maxRadius units; desk and pop give none', () => {
  const small = fontFor(cosmos, 'display', 76, 1);
  assert.deepEqual(glowStyle(cosmos, small, 1), { glow: { color: '#ffb040', alpha: 0.45, radius: (CAP_HEIGHT * 76) / 3 } });
  const font = fontFor(cosmos, 'display', 136, 1);
  assert.deepEqual(glowStyle(cosmos, font, 1), { glow: { color: '#ffb040', alpha: 0.45, radius: cosmos.glow.maxRadius } }, 'capped: a counter keeps the field');
  for (const look of [desk, pop]) assert.deepEqual(glowStyle(look, fontFor(look, 'display', 136, 1), 1), {});
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(cosmos.glow.color.slice(i, i + 2), 16));
  assert.ok(r > g && g > b, 'warm: more red than green, more green than blue');
});

test('glowStyle: the radius never passes the safe margin, so the glow of a text inside the safe area stays in the frame', () => {
  for (const unit of [0.5, 1, 2]) {
    for (const size of [76, 136, 232, 300, 420]) {
      const { glow } = glowStyle(cosmos, fontFor(cosmos, 'display', size * unit, unit), unit);
      assert.ok(glow.radius <= SAFE_MARGIN_UNITS * unit + 1e-9, `${size}@${unit}: ${glow.radius}`);
    }
  }
});

const SHOT = { id: 's', show: 'statement', say: 'Scale changes *everything* we know.' };
const glowWords = (text) => text.wordTracks.map((w, i) => (w.glow ? i : -1)).filter((i) => i >= 0);

test('a cosmos statement: its hero carries props.glow, only the emphasised word glows, and no halo or extra node is built', () => {
  const { nodes } = expandShot(SHOT, 'cosmos', '16:9');
  const text = textNode(nodes, 's.text');
  assert.equal(text.props.glow.color, '#ffb040');
  const words = text.props.layout.lines.flatMap((l) => l.words);
  assert.deepEqual(glowWords(text), [words.findIndex((w) => w.text === 'everything')]);
  assert.equal(all(nodes).filter((n) => n.type === 'text').length, 1, 'one text node: the glow is not a node');
  assert.equal(all(nodes).some((n) => /glow/.test(n.id)), false);
});

test('a viral cosmos hook (read from frame 0): the emphasised word lights to the accent with its glow', () => {
  const { nodes } = expandIn(filmOf([SHOT], 'cosmos', '9:16', { mode: 'viral' }));
  const text = textNode(nodes, 's.text');
  assert.equal(glowWords(text).length, 1);
  const second = expandIn(filmOf([FILLER, SHOT], 'cosmos', '9:16', { mode: 'viral' }), 1);
  assert.equal(glowWords(textNode(second.nodes, 's.text')).length, 1);
});

test('desk and pop statements carry no glow', () => {
  for (const [look, format] of [['desk', '16:9'], ['pop', '9:16']]) {
    const text = textNode(expandShot(SHOT, look, format).nodes);
    assert.equal(text.props.glow, undefined, look);
    assert.ok(text.wordTracks.every((w) => w.glow === undefined), look);
  }
});

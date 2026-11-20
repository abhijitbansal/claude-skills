// The frame review's `dropped` rule (engine/review/frame.mjs): a text whose kind left out a secondary line to keep its
// secondary text at the look's floor (props.dropped, kinds/secondary.mjs) is a creative finding that names what went.
// Review C I2: the rule existed with no test that it fires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = () => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'c', shotIndex: 0, t: 1.2 };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};

// A text node as annotate() reports it (as review.test.mjs builds them): one line of `words` words, ascent 0.9 em.
function textNode({ id, size, x, y, words = 2, props = {} }) {
  const line = { x: 0, y: size * 0.9, width: words * size * 2, words: Array.from({ length: words }, (_, k) => ({ text: 'word', index: k, x: k * size * 2, width: size * 2 })) };
  return {
    type: 'text', id, depth: 0, props, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    words: Array.from({ length: words }, () => ({ opacity: 1, x: 0, y: 0, scale: 1 })),
    layout: { size, width: line.width, height: line.y + size * 0.25, overflow: false, lines: [line] },
    bbox: [x, y, line.width, line.y + size * 0.25], spread: 0,
  };
}

test('a text that left out a line (props.dropped) is a creative "dropped" finding naming the text and what went', () => {
  const title = textNode({ id: 'c.title', size: 160, x: 200, y: 120, props: { role: 'hero', dropped: ['source'] } });
  const label = textNode({ id: 'c.label.0', size: 52, x: 200, y: 700, words: 1, props: { role: 'label' } });
  const found = auditFrame([title, label], ctx()).filter((f) => f.rule === 'dropped');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].node, 'c.title');
  assert.match(found[0].message, /left out its source/);
});

test('no dropped finding without props.dropped, or with an empty list', () => {
  for (const props of [{ role: 'hero' }, { role: 'hero', dropped: [] }]) {
    const title = textNode({ id: 'c.title', size: 160, x: 200, y: 120, props });
    assert.deepEqual(auditFrame([title], ctx()).filter((f) => f.rule === 'dropped'), []);
  }
});

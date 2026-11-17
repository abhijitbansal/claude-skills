// The emphasis styles as a table (engine/kinds/emphasis.mjs): a look names one, statement.mjs and the stack caption read
// its entry instead of comparing the name, so a new emphasis system is one more entry (looks-four Task 1). Behaviour is
// unchanged: the frozen fixtures (kinds-frozen.test.mjs) are the proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { EMPHASIS, emphasisOf } from '../../engine/kinds/emphasis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '../../engine');
const look = (name) => registries.looks.get(name);

test('the four existing styles are entries and emphasisOf returns them for desk, pop and cosmos', () => {
  for (const name of ['highlight', 'recolor-scale', 'recolor', 'glow']) {
    assert.equal(typeof EMPHASIS[name]?.wordTracks, 'function', `${name} is an entry with wordTracks`);
  }
  assert.ok(Object.isFrozen(EMPHASIS), 'the table is frozen');
  assert.equal(emphasisOf(look('desk')), EMPHASIS.highlight);
  assert.equal(emphasisOf(look('pop')), EMPHASIS.recolor);
  assert.equal(emphasisOf(look('cosmos')), EMPHASIS.glow);
});

test('an unknown emphasis name throws with the names it has', () => {
  assert.throws(() => emphasisOf({ name: 'test-look', emphasis: 'glo' }), (err) => {
    assert.match(err.message, /test-look/);
    assert.match(err.message, /"glo"/);
    for (const name of Object.keys(EMPHASIS)) assert.ok(err.message.includes(name), `names ${name}`);
    assert.match(err.message, /did you mean "glow"/);
    return true;
  });
});

test('statement.mjs holds no comparison on look.emphasis', () => {
  const source = readFileSync(path.join(ENGINE, 'kinds/statement.mjs'), 'utf8');
  assert.deepEqual(source.split('\n').filter((line) => /look\.emphasis/.test(line)), []);
});

test('the stack caption holds no comparison on look.emphasis', () => {
  const source = readFileSync(path.join(ENGINE, 'captions/stack.mjs'), 'utf8');
  assert.deepEqual(source.split('\n').filter((line) => /look\.emphasis/.test(line)), []);
});

test('only highlight caps the emphasised share; only highlight and glow keep runs together', () => {
  const wide = { look: look('cosmos'), canvas: { w: 1920, h: 1080 } };
  const tall = { look: look('cosmos'), canvas: { w: 1080, h: 1920 } };
  assert.equal(EMPHASIS.highlight.maxShare, 0.5);
  for (const name of ['recolor-scale', 'recolor', 'glow']) assert.equal(EMPHASIS[name].maxShare, undefined, name);
  assert.equal(EMPHASIS.highlight.together(wide), true);
  assert.equal(EMPHASIS.glow.together(wide), true, 'cosmos keeps its phrases whole on a wide frame');
  assert.equal(EMPHASIS.glow.together(tall), false, 'and not on a tall one');
  assert.equal(EMPHASIS.recolor.together(wide), false);
  assert.equal(EMPHASIS['recolor-scale'].together(wide), false);
});

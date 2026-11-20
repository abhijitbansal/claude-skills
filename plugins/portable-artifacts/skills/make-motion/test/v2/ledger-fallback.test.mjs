// A film naming an emphasis device its look does not draw (looks-four Task 4b, controller ruling): in ledger an `on`
// highlight is not refused; its target word takes the look's own emphasis (weight 800, the accent) and make says so in
// one info line. In desk the same film draws its highlight as before. Any other device the look does not style is still
// refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { withLookEmphasis, fallbackNotice } from '../../engine/kinds/emphasis-fallback.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { filmFor } from './helpers/kinds.mjs';

const SHOT = Object.freeze({ id: 'hook', show: 'statement', say: 'Numbers need sources.', on: [{ at: 'word:2', do: 'highlight', target: 'word:2' }] });
const film = (look, shot = SHOT) => ({ version: 2, mode: 'pro', look, format: '16:9', shots: [shot] });
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

test('ledger: a highlight on a word validates (not refused)', () => {
  const { ok, errors } = validateFilm(film('ledger'), { specDir: '.' });
  assert.equal(ok, true, errors.map((e) => e.message).join('; '));
});

test('ledger: the highlight is taken out and its word starred, so the look\'s emphasis marks it', () => {
  const { film: out, moved } = withLookEmphasis(film('ledger'));
  assert.equal(out.shots[0].say, 'Numbers need *sources*.');
  assert.deepEqual(out.shots[0].on, []);
  assert.deepEqual(moved, [{ shot: 'hook', index: 0, device: 'highlight', target: 'word:2', starred: true }]);
  assert.match(fallbackNotice('ledger', moved[0]), /look "ledger" does not draw "highlight"; word:2 takes the look's own emphasis/);
});

test('ledger: the built statement shows the word heavy and in the accent, and draws no highlight', () => {
  const built = filmFor([SHOT], 'ledger', '16:9');
  const nodes = flat(built.sampleShot(0, built.duration - 0.05));
  assert.equal(nodes.some((n) => /\.on0/.test(n.id)), false, 'no highlight band');
  const text = nodes.find((n) => n.id === 'hook.text');
  assert.equal(text.words[2].weight, 800);
  assert.equal(text.words[2].fill, registries.looks.get('ledger').palette.accent);
});

test('desk: the same film keeps its highlight (the look draws it), and the film is returned as it is', () => {
  const given = film('desk');
  assert.equal(withLookEmphasis(given).film, given);
  const built = filmFor([SHOT], 'desk', '16:9');
  assert.ok(flat(built.sampleShot(0, built.duration - 0.05)).some((n) => n.id.startsWith('hook.on0')), 'the highlight is drawn');
});

test('ledger: a device it does not style and that is no emphasis is still refused', () => {
  const shot = { ...SHOT, on: [{ at: 'word:2', do: 'sticker', target: 'word:2' }] };
  const { ok } = validateFilm(film('ledger', shot), { specDir: '.' });
  assert.equal(ok, false);
});

test('ledger: a highlight on a non-word target moves out without starring anything', () => {
  const shot = { ...SHOT, on: [{ at: 'word:2', do: 'highlight', target: 'text' }] };
  const { film: out, moved } = withLookEmphasis(film('ledger', shot));
  assert.equal(out.shots[0].say, SHOT.say);
  assert.equal(moved[0].starred, false);
});

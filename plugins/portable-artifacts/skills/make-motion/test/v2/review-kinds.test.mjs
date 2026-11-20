// A kind's own review findings as the film review reads them (scripts/v2/review.mjs kindFinding): creative unless the
// kind says mechanical, and any other kind value an error, never a silently softer finding (branch review A, Minor 23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kindFinding } from '../../scripts/v2/review.mjs';

const SHOT = { id: 'c', show: 'chart' };
const TIMING = { start: 2 };

test('kindFinding: no kind is creative, "mechanical" stays mechanical, with the shot\'s path and film time', () => {
  assert.deepEqual(kindFinding(SHOT, 3, TIMING, { path: 'axis', at: 0.5, message: 'm' }),
    { kind: 'creative', shot: 'c', path: 'shots[3].axis', t: 2.5, rule: 'kind', node: 'axis', message: 'm' });
  assert.equal(kindFinding(SHOT, 3, TIMING, { path: 'axis', at: 0, message: 'm', kind: 'mechanical' }).kind, 'mechanical');
  assert.equal(kindFinding(SHOT, 3, TIMING, { path: 'axis', at: 0, message: 'm', kind: 'creative' }).kind, 'creative');
});

test('kindFinding: any other kind value names the kind and the value, instead of reading as creative', () => {
  for (const kind of ['Mechanical', 'mechnical', true, null]) {
    assert.throws(() => kindFinding(SHOT, 0, TIMING, { path: 'axis', at: 0, message: 'm', kind }), /kind "chart" review: a finding's kind is .*, not "mechanical" or "creative"/, JSON.stringify(kind));
  }
});

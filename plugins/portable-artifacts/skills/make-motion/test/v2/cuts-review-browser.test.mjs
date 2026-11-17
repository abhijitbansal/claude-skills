// Transitions Task 7: inside a cut's window the review audits the incoming shot alone, so the contrast audit (which reads
// the laid-out tree and the shot's own background, engine/review/contrast.mjs, never the rendered pixels) never judges a
// half-wiped or half-slid frame. Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const DARK = '#101820', LIGHT = '#f0f0f0';
const text = (id, fill) => ({ type: 'text', id, props: { x: 300, y: 400, text: 'Plain words', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 1200, fill } });

// a: light words on dark; b: dark words on light. Each passes on its own background; a's words on b's background
// (#f0f0f0 on #f0f0f0) would fail, which is what a frame of the window holds when audited whole.
const film = (cut) => ({ version: 2, fps: 30, shots: [
  { id: 'a', show: 'free', hold: 2, background: DARK, nodes: [text('out', LIGHT)] },
  { id: 'b', show: 'free', hold: 2, background: LIGHT, cut, nodes: [text('in', DARK)] },
] });

for (const cut of [{ type: 'wipe', direction: 'left' }, { type: 'slide', direction: 'left' }]) {
  test(`inside a ${cut.type}'s window the outgoing words are not judged against the incoming background: no contrast finding`, async (t) => {
    const session = await sessionOrNull(film(cut));
    if (!session) { t.skip('no browser'); return; }
    t.after(() => session.close());
    const found = await reviewFilm({ session });
    assert.deepEqual(found.filter((f) => f.kind === 'mechanical').map((f) => `${f.rule} ${f.shot} ${f.node}: ${f.message}`), []);
  });
}

// The `marker` quote with real glyphs (looks-four Task 13, m2): the quotation's ink keeps clear of the drawn card's edge on
// every side (at least INK_GAP units inside it) at 16:9 and 9:16; the sheets showed "should" meeting the right line.
// Needs a browser (skips without one); run with --test-concurrency=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const FPS = 30;
const INK_GAP = 12; // units between a written line's ink and the card's drawn edge
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const example = () => listEntries('kinds').find((e) => e.name === 'quote')?.example ?? registries.kinds.get('quote').example;

for (const format of ['16:9', '9:16']) {
  test(`marker quote at ${format} with real glyphs: the written lines keep ${INK_GAP} units clear of the card's edge`, async (t) => {
    const film = { version: 2, mode: 'pro', look: 'marker', format, fps: FPS, seed: 3, shots: [example()] };
    const session = await sessionOrNull(film, { specDir: HERE });
    if (!session) { t.skip('no browser'); return; }
    t.after(() => session.close());
    const last = buildTimeline(film, { fps: FPS }).frameCount - 1;
    const nodes = flat(await session.page.evaluate((i) => window.__snapshot(i), last));
    const edge = nodes.find((n) => n.type === 'path' && /card\.edge$/.test(n.id));
    assert.ok(edge, 'the card edge is on the board');
    const [ex, ey, ew, eh] = edge.bbox;
    const lines = nodes.filter((n) => n.type === 'text' && n.layout && /\.text/.test(n.id)).flatMap((n) => n.layout.lines.map((line) => ({ id: n.id, right: n.x + line.x + line.width, left: n.x + line.x })));
    assert.ok(lines.length > 0, 'the quotation is written');
    const tooClose = lines.filter((l) => l.right > ex + ew - INK_GAP || l.left < ex + INK_GAP).map((l) => `${l.id}: ink ${l.left.toFixed(0)}..${l.right.toFixed(0)} in a card ${ex.toFixed(0)}..${(ex + ew).toFixed(0)}`);
    assert.deepEqual(tooClose, []);
    assert.ok(eh > 0 && ey >= 0);
    assert.deepEqual(session.errors, []);
  });
}

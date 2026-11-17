// The feed kind in the page (plan 2026-11-16-pa2-shot-kinds-b, Task 9): with the real faces a 90-character message holds
// in the look's maxLines at or above the reading floor, in both looks and formats, beside five more long messages (the
// worst case for the size), and the example and a notifications feed review clean. Run with --test-concurrency=1;
// skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const LONG = 'This message is ninety characters long, which is the most a feed item may carry in a shot.';
const film = (look, format, shot) => ({ version: 2, mode: look === 'pop' ? 'viral' : 'pro', look, format, fps: 30, seed: 3, shots: [shot] });

async function withSession(t, f, run) {
  const session = await sessionOrNull(f);
  if (!session) { t.skip('no browser'); return; }
  try { await run(session); } finally { await session.close(); }
}

for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`a 90-character message holds in maxLines at or above the floor in ${look} at ${format}`, async (t) => {
      const items = Array.from({ length: 6 }, (_, k) => ({ from: k % 2 ? 'me' : 'them', text: LONG }));
      await withSession(t, film(look, format, { id: 'f', show: 'feed', items, hold: 6 }), async (session) => {
        const tree = await session.page.evaluate((i) => window.__snapshot(i), session.timeline.frameCount - 1);
        const flat = []; const walk = (n) => { flat.push(n); (n.children ?? []).forEach(walk); }; tree.forEach(walk);
        const l = registries.looks.get(look);
        const unit = Math.min(...(format === '9:16' ? [1080, 1920] : [1920, 1080])) / 1080;
        for (const n of flat.filter((x) => /^f\.item\d\.text$/.test(x.id))) {
          assert.ok(n.layout.lines.length <= l.kinds.feed.maxLines, `${n.id}: ${n.layout.lines.length} lines`);
          assert.ok(n.layout.size / unit >= l.scale[format === '9:16' ? 1 : 0] - 1e-6, `${n.id}: ${n.layout.size}`);
        }
        assert.deepEqual(session.errors, []);
      });
    });
    test(`the feed example and a notifications feed review clean in ${look} at ${format}`, async (t) => {
      const shots = [registries.kinds.get('feed').example, { id: 'n', show: 'feed', style: 'notifications', title: 'This morning', say: 'An invoice came in. Then a reminder. Then two replies.',
        items: [{ app: 'Mail', text: 'Your invoice is ready' }, { app: 'Calendar', text: 'Standup in ten minutes' }, { app: 'Mail', text: 'Two new replies' }] }];
      for (const shot of shots) {
        await withSession(t, film(look, format, shot), async (session) => {
          const findings = await reviewFilm({ session });
          assert.deepEqual(findings.map((f) => `${f.kind}: ${f.message}`), [], shot.id);
          assert.deepEqual(session.errors, []);
        });
      }
    });
  }
}

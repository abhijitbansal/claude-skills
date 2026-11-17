// The code kind in the page (plan 2026-11-16-pa2-shot-kinds-b, Task 8): the look's mono is loaded in a desk film and in a
// pop film (pop has no mono of its own; fonts-shared.mjs facesFor adds it for a code shot) and its advance is 0.6 em within
// 1 percent, the figure the kind's fit arithmetic uses; a 12-line block stays inside its panel at each look and format;
// a run and a diff review clean at 16:9. Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const ADVANCE = 0.6;
const TOLERANCE = 0.01;
const film = (look, format, shot) => ({ version: 2, mode: look === 'pop' ? 'viral' : 'pro', look, format, fps: 30, seed: 3, shots: [shot] });

async function open(t, f) {
  const session = await sessionOrNull(f);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

const TWELVE = { id: 'c', show: 'code', lang: 'js', title: 'rows.js', hold: 3,
  code: Array.from({ length: 12 }, (_, i) => `const row${i} = load(${i}); // row ${i}`).join('\n') };

for (const look of ['desk', 'pop']) {
  test(`the mono is loaded in a ${look} film and advances 0.6 em`, async (t) => {
    const session = await open(t, film(look, '16:9', TWELVE)); if (!session) return;
    const font = { ...registries.looks.get(look).kinds.code.font, size: 100, tracking: 0, lineHeight: 1.4 };
    const width = await session.page.evaluate((f) => window.__measure('0123456789', f).width, font);
    const loaded = await session.page.evaluate((f) => document.fonts.check(`${f.weight} 100px "${f.family}"`), font);
    assert.ok(loaded, `${font.family} is loaded`);
    assert.ok(Math.abs(width / 1000 - ADVANCE) <= ADVANCE * TOLERANCE, `advance ${width / 1000} em`);
    assert.deepEqual(session.errors, []);
  });
  for (const format of ['16:9', '9:16']) {
    test(`a 12-line block stays inside its panel in ${look} at ${format}`, async (t) => {
      const session = await open(t, film(look, format, TWELVE)); if (!session) return;
      const last = session.timeline.frameCount - 1;
      const tree = await session.page.evaluate((i) => window.__snapshot(i), last);
      const flat = [];
      const walk = (n) => { flat.push(n); (n.children ?? []).forEach(walk); };
      tree.forEach(walk);
      const panel = flat.find((n) => n.id === 'c.panel.body' || n.id === 'c.panel.card.paper') ?? flat.find((n) => n.id === 'c.panel.card');
      assert.ok(panel, 'the panel is drawn');
      const [px, py, pw, ph] = panel.bbox;
      const outside = flat.filter((n) => n.type === 'text' && /^c\.(l\d+|title)\./.test(n.id)).filter((n) => {
        const [x, y, w, h] = n.bbox;
        return x < px - 0.5 || y < py - 0.5 || x + w > px + pw + 0.5 || y + h > py + ph + 0.5;
      });
      assert.deepEqual(outside.map((n) => n.id), []);
    });
  }
  test(`a diff and a run review clean in ${look} at 16:9`, async (t) => {
    for (const shot of [
      { id: 'd', show: 'code', mode: 'diff', lang: 'python', title: 'price.py', say: 'The old price was fixed. Now it reads the table.', before: 'def price(item):\n  return 10', after: 'def price(item):\n  p = table[item]\n  return p' },
      { id: 'r', show: 'code', mode: 'run', title: 'terminal', command: 'npm test', output: 'ran 12 tests\nall passed', say: 'Run the tests. Twelve run, and all pass.' },
    ]) {
      const session = await sessionOrNull(film(look, '16:9', shot));
      if (!session) { t.skip('no browser'); return; }
      try {
        const findings = await reviewFilm({ session });
        assert.deepEqual(findings.map((f) => `${f.kind}: ${f.message}`), [], shot.id);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    }
  });
}

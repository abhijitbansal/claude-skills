// Captions in the render page, with the real fonts: an emphasised caption word at the edge of its zone is never clipped
// (the measured ink, frame by frame, through the caption rules), and both gate films with captions on come back from the
// film review with no finding at all. Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { canvasSize } from '../../template/formats.mjs';
import { reviewFilm, safeRectFor } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const GATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references/examples/v2');
const CAPTION_RULES = new Set(['caption-zone', 'caption-hero', 'caption-late', 'caption-clipped']);
const gate = (name, extra = {}) => ({ ...JSON.parse(readFileSync(path.join(GATE_DIR, `${name}.json`), 'utf8')), fps: FPS, ...extra });

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir: GATE_DIR });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

// Every spoken-caption text on screen in a snapshot (its accumulated opacity above 0).
const captionTexts = (nodes, opacity = 1) => nodes.flatMap((n) => {
  const o = opacity * n.opacity;
  return [...(n.type === 'text' && n.props.caption && o > 0 ? [n] : []), ...captionTexts(n.children, o)];
});

const COMBOS = [['pop', '9:16'], ['pop', '16:9'], ['desk', '16:9'], ['desk', '9:16']].flatMap(([look, format]) => [[look, format, undefined], [look, format, 'It shows its work.']]);
for (const [look, format, own] of COMBOS) {
  test(`${look} at ${format}${own ? ' with the clipping\'s own caption' : ''}: with the real fonts an emphasised caption word at the zone's edge is never clipped and no caption rule fires, on any frame`, async (t) => {
    const say = '*Everything* stays on your machine. Nothing leaves it, *ever*.';
    const shot = { id: 'c', show: 'clipping', src: 'clipping.png', say, ...(own ? { caption: own } : {}) };
    const film = { version: 2, mode: look === 'pop' ? 'viral' : 'pro', look, format, fps: FPS, seed: 3, captions: true, shots: [shot] };
    const session = await open(t, film); if (!session) return;
    const [w, h] = canvasSize(film);
    const canvas = { w, h };
    const lookData = registries.looks.get(look);
    const frames = buildTimeline(film, { fps: FPS }).frameCount;
    let edgeSeen = false;
    for (let f = 0; f < frames; f++) {
      const tree = await session.page.evaluate((i) => window.__snapshot(i), f);
      const ctx = { look: lookData, canvas, safe: safeRectFor(canvas, lookData), mode: film.mode, shotId: 'c', shotIndex: 0, t: f / FPS, isFirstShot: true };
      const found = auditFrame(tree, ctx).filter((x) => CAPTION_RULES.has(x.rule));
      assert.deepEqual(found.map((x) => `frame ${f}: ${x.message}`), []);
      for (const n of captionTexts(tree).filter((x) => x.props.caption.emphasis.includes(0))) {
        const first = n.layout.lines[0];
        const ink = n.lineInk?.[0]?.words?.[0];
        if (look === 'pop' && ink) {
          const left = n.x + first.x + first.words[0].x + ink.left; // a pop caption is a top-level text, upright, at scale 1
          assert.ok(Math.abs(left - n.props.caption.zone[0]) <= 1.5, `frame ${f}: the emphasised first word's measured ink starts on the zone edge (${left} vs ${n.props.caption.zone[0]})`);
        }
        edgeSeen = true;
      }
    }
    assert.ok(edgeSeen, 'an emphasised word at the start of a group was on screen');
    assert.deepEqual(session.errors, []);
  });
}

for (const [name, extra] of [['gate-desk', { captions: true }], ['gate-pop', { captions: true }]]) {
  test(`${name} with captions on has no review finding`, async (t) => {
    const film = gate(name, extra);
    const session = await open(t, film); if (!session) return;
    const proof = buildTimeline(film, { fps: FPS }).shots.find((s) => s.id === 'proof');
    const snapshot = await session.page.evaluate((i) => window.__snapshot(i), Math.round((proof.start + 0.3) * FPS));
    assert.ok(captionTexts(snapshot).length > 0, 'the clipping is captioned');
    const findings = await reviewFilm({ session });
    assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} at ${f.t}: ${f.message}`), []);
    assert.deepEqual(session.errors, []);
  });
}

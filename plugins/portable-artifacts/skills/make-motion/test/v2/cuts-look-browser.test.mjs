// Transitions Task 9 look fixes, read off the visible canvas after the post pass. Run with --test-concurrency=1; skips
// without a browser or without WebGL2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sessionOrNull } from './helpers/session.mjs';
import { sessionFindings } from '../../scripts/v2/review.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';

const EXAMPLES = fileURLToPath(new URL('../../references/examples/v2/', import.meta.url));
// The test session option the 2D post test uses: the page gets no WebGL2 context.
const NO_GL = "const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };";

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const BORDER = 4; // px: a white frame round each shot
const BARS = [`M0 0H1920V${BORDER}H0Z`, `M0 ${1080 - BORDER}H1920V1080H0Z`, `M0 0H${BORDER}V1080H0Z`, `M${1920 - BORDER} 0H1920V1080H${1920 - BORDER}Z`];
const border = (id) => BARS.map((d, k) => ({ type: 'path', id: `${id}${k}`, props: { d, fill: '#ffffff' } }));
const flat = (id, background, cut) => ({ id, show: 'free', hold: 1, background, nodes: border(`${id}.frame`), ...(cut ? { cut } : {}) });
const film = (cut) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [flat('a', '#ff0000'), flat('b', '#0000ff', cut)] });

// How far white runs in from each edge along the centre row and column, in px, at `progress` of the cut.
const whiteRuns = (s, progress) => s.page.evaluate(([i, p]) => {
  window.__seek(i, { progress: p });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, stage.width, stage.height);
  const white = (x, y) => { const k = (y * width + x) * 4; return data[k] > 200 && data[k + 1] > 200 && data[k + 2] > 200; };
  const run = (step) => { let n = 0; while (n < 400 && step(n)) n += 1; return n; };
  const cx = width >> 1, cy = height >> 1;
  return { top: run((n) => white(cx, n)), bottom: run((n) => white(cx, height - 1 - n)), left: run((n) => white(n, cy)), right: run((n) => white(width - 1 - n, cy)) };
}, [START + 9, progress]);

test('glitch-memories never smears the picture\'s edge rows across the frame: the white border stays a border at every progress', async (t) => {
  const s = await sessionOrNull(film('glitch-memories'));
  if (!s) { t.skip('no browser'); return; }
  t.after(() => s.close());
  if (s.info.post !== 'webgl2') { t.skip('this browser has no WebGL2'); return; }
  await s.page.evaluate((zero) => window.__setPost(zero), ZERO);
  const worst = { top: 0, bottom: 0, left: 0, right: 0 };
  for (const p of [0.02, 0.04, 0.06, 0.1, 0.15, 0.2, 0.3, 0.45]) {
    const runs = await whiteRuns(s, p);
    for (const edge of Object.keys(worst)) worst[edge] = Math.max(worst[edge], runs[edge]);
  }
  // a mirrored read shows the 4 px border at most twice over; a read clamped to the edge repeats it far into the frame
  for (const [edge, px] of Object.entries(worst)) assert.ok(px <= 3 * BORDER, `${edge}: white runs ${px} px in`);
});

test('cuts-desk.json without WebGL2: every shader cut it uses is replaced and named in a creative finding, and each window draws its stand-in', async (t) => {
  const film = JSON.parse(readFileSync(`${EXAMPLES}cuts-desk.json`, 'utf8'));
  const s = await sessionOrNull(film, { specDir: EXAMPLES, initScript: NO_GL });
  if (!s) { t.skip('no browser'); return; }
  t.after(() => s.close());
  const shaders = film.shots.map((_, i) => resolveShotCut(film, i)).filter((cut) => cut?.family === 'shader').map((cut) => cut.name);
  assert.ok(shaders.length >= 5, `the film uses shader cuts: ${shaders}`);
  assert.equal(s.info.post, '2d');
  assert.deepEqual([...s.info.cuts.replaced].sort(), [...new Set(shaders)].sort());
  assert.deepEqual(s.info.cuts.ran, []);
  const finding = sessionFindings(s).find((f) => /shader cuts replaced/.test(f.message));
  assert.equal(finding?.kind, 'creative');
  // the middle frame of each shader window draws (the stand-in, composed in 2D) without a page error
  const middles = s.timeline.shots.flatMap((shot, i) => (resolveShotCut(film, i)?.family === 'shader' ? [Math.round(shot.start * s.timeline.fps) + 9] : []));
  for (const frame of middles) await s.page.evaluate((i) => window.__seek(i), frame);
  assert.deepEqual(s.errors, []);
});

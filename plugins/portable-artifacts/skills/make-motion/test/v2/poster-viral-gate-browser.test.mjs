// The poster gate's 9:16 viral film (gate-poster-tall, render 1) with real glyphs: its opening hook and its turned
// steps list, reviewed in the browser. Render 1 found the six-word hook's second row under the stack's floor (overflow:
// "GET THE FILM." at 83 units) and the list's third item outside the safe area (the review read the "4"'s overhang past
// its advance, along the turned line, as across it). Both shots are copied here, not read from the gate film.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const FPS = 30;
const STEP_3 = 104; // units: poster's scale step 3, the stack's floor (looks/poster.mjs scale)
const SHOTS = Object.freeze([
  { id: 'hook', show: 'statement', say: 'Write the *script*. Get the film.' },
  {
    id: 'how', show: 'list', title: 'Three steps', style: 'steps',
    say: 'Write the shots as JSON. Run one command. Get an MP4.',
    items: ['Write the shots as JSON', 'Run one command', 'Get an MP4'],
  },
]);
const film = () => ({ version: 2, mode: 'viral', look: 'poster', format: '9:16', fps: FPS, seed: 37, shots: SHOTS });
const all = (ns) => ns.flatMap((n) => [n, ...all(n.children ?? [])]);

test('poster viral 9:16: the six-word hook and the turned steps list have no fit or safe-area finding with real glyphs', async (t) => {
  const session = await sessionOrNull(film(), { specDir: HERE });
  if (!session) { t.skip('no browser'); return; }
  t.after(() => session.close());
  const findings = (await reviewFilm({ session })).filter((f) => ['overflow', 'safe-area', 'min-size'].includes(f.rule));
  assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} ${f.path} ${f.node}`), [], findings.map((f) => f.message).join('\n'));
  assert.deepEqual(session.errors, []);
});

test('poster viral 9:16: the hook is set at or over the floor, its emphasised row the largest, every row upright', async (t) => {
  const session = await sessionOrNull(film(), { specDir: HERE });
  if (!session) { t.skip('no browser'); return; }
  t.after(() => session.close());
  const tree = await session.page.evaluate(() => window.__snapshot(3));
  // a beat's knockout copy (props.beatOf, gate-poster-2 ruling 3) stands in for a row and is not one of the stack's rows
  const rows = all(tree).filter((n) => n.type === 'text' && n.props?.stack === 'hook.text' && n.props?.beatOf === undefined);
  const unit = 1; // 1080 x 1920: one unit is one pixel
  const sizes = rows.map((n) => n.layout.size / unit);
  const texts = rows.map((n) => n.layout.lines[0].words.map((w) => w.text).join(' '));
  t.diagnostic(`hook rows: ${texts.map((s, k) => `${s} (${sizes[k].toFixed(1)})`).join(' / ')}`);
  assert.ok(rows.length >= 3, texts.join(' / '));
  assert.ok(rows.every((n) => (n.rotate ?? 0) === 0));
  assert.ok(sizes.every((s) => s >= STEP_3 - 1e-6), `sizes ${sizes.map((s) => s.toFixed(1))}`);
  const lead = texts.findIndex((s) => s.includes('SCRIPT'));
  sizes.forEach((s, k) => k !== lead && assert.ok(sizes[lead] > s));
});

// gate-poster-1 ruling 4: the hook fills the band. Before it (render 1 of this film, sheet pixels) the block was about
// 345 units tall, 28 percent of the band; at least 70 percent (860 units) is about two and a half times that
const BAND = (0.78 - 0.14) * 1920;
const FILL = 0.7;
test('poster viral 9:16: the hook block fills at least 70 percent of the band with real glyphs, SCRIPT. on a row of its own', async (t) => {
  const session = await sessionOrNull(film(), { specDir: HERE });
  if (!session) { t.skip('no browser'); return; }
  t.after(() => session.close());
  const tree = await session.page.evaluate(() => window.__snapshot(0));
  const rows = all(tree).filter((n) => n.type === 'text' && n.props?.stack === 'hook.text');
  const top = Math.min(...rows.map((n) => n.bbox[1])), bottom = Math.max(...rows.map((n) => n.bbox[1] + n.bbox[3]));
  const texts = rows.map((n) => n.layout.lines[0].words.map((w) => w.text).join(' '));
  t.diagnostic(`hook block ${Math.round(bottom - top)} of ${Math.round(BAND)}: ${texts.map((s, k) => `${s} (${rows[k].layout.size.toFixed(1)})`).join(' / ')}`);
  assert.ok(texts.includes('SCRIPT.'), texts.join(' / '));
  assert.ok(bottom - top >= FILL * BAND, `block ${Math.round(bottom - top)}`);
});

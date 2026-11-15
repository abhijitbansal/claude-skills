// The review rules against the designed kinds: every example `--list kinds` prints, in both looks and both of 16:9 and
// 9:16, reviewed at the sheet moments, must come back with no finding at all. A kind that trips its own look's rules is
// a bug in the rule or in the kind. Also the number kind's stacked count and the "landed" rule. Run with
// --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listEntries } from '../../scripts/v2/list.mjs';
import { reviewFilm, hiddenWordsIn } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const COMBOS = Object.freeze([
  { mode: 'pro', look: 'desk', format: '16:9' },
  { mode: 'pro', look: 'desk', format: '9:16' },
  { mode: 'viral', look: 'pop', format: '16:9' },
  { mode: 'viral', look: 'pop', format: '9:16' },
]);

// A striped PNG, built by hand so a browser can decode it: a stand-in screenshot.
function stripedPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(Math.floor(y / 10) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-review-browser-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(640, 400));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

// The example shot with a device the look has (desk circles, pop underlines).
const exampleFor = (entry, look) => ({
  ...entry.example,
  ...(entry.example.on ? { on: entry.example.on.map((item) => ({ ...item, do: look === 'pop' ? 'underline' : item.do })) } : {}),
});

for (const { mode, look, format } of COMBOS) {
  for (const entry of listEntries('kinds')) {
    test(`the ${entry.name} example in ${look} at ${format} has no review finding`, async (t) => {
      const film = { version: 2, mode, look, format, fps: FPS, seed: 3, shots: [exampleFor(entry, look)] };
      const session = await open(t, film); if (!session) return;
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind}: ${f.message}`), []);
      assert.deepEqual(session.errors, []);
    });
  }
}

// ---- the stacked count and "landed" ----

const keys = (...pairs) => ({ keys: pairs.map(([t, v]) => ({ t, v })) });
// Three words, the first two shown until 0.5 s and the last from then on: a count, as the number kind stacks it.
const countText = (x) => ({
  type: 'text', id: 'count',
  props: { x, y: 400, text: 'Alpha Bravo Omega', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 3000, fill: '#ffffff' },
  wordTracks: [
    { opacity: keys([0, 1], [0.5, 1], [0.51, 0]) },
    { opacity: keys([0, 1], [0.5, 1], [0.51, 0]) },
    { opacity: keys([0, 0], [0.5, 0], [0.51, 1]) },
  ],
});
const countFilm = (x) => ({ version: 2, fps: FPS, shots: [{ id: 'count', show: 'free', hold: 2, background: '#101820', nodes: [countText(x)] }] });

test('the words at opacity 0 on a shot last frame are the hidden ones', async (t) => {
  const session = await open(t, countFilm(200)); if (!session) return;
  const last = await session.page.evaluate((i) => window.__snapshot(i), session.timeline.frameCount - 1);
  assert.deepEqual([...hiddenWordsIn(last).get('count')], [0, 1]);
});

test('a stacked count is audited at its final value: hidden words outside the safe area are not a finding', async (t) => {
  // x = 10: "Alpha" starts outside the safe area but is a hidden step; the shown word "Omega" is inside it
  const session = await open(t, countFilm(10)); if (!session) return;
  assert.deepEqual((await reviewFilm({ session })).filter((f) => f.kind === 'mechanical'), []);
});

test('a stacked count whose final value is outside the safe area is a mechanical finding', async (t) => {
  const session = await open(t, countFilm(1500)); if (!session) return;
  const mechanical = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.equal(mechanical.length, 1);
  assert.equal(mechanical[0].rule, 'safe-area');
  assert.equal(mechanical[0].node, 'count');
});

test('the number kind keeps one word per digit of its value on screen at the end of the shot and hides every earlier step', async (t) => {
  const number = listEntries('kinds').find((e) => e.name === 'number').example;
  const session = await open(t, { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: FPS, seed: 3, shots: [number] }); if (!session) return;
  const last = await session.page.evaluate((i) => window.__snapshot(i), session.timeline.frameCount - 1);
  const hidden = hiddenWordsIn(last).get('rows.value.digits');
  const words = (function find(nodes) { return nodes.flatMap((n) => (n.id === 'rows.value.digits' ? [n] : find(n.children))); })(last)[0].words;
  const shown = words.flatMap((w, i) => (w.opacity === 1 ? [i] : []));
  assert.equal(shown.length, 3, '459 is three digits');
  assert.deepEqual([...hidden].sort((a, b) => a - b), words.map((_, i) => i).filter((i) => !shown.includes(i)), 'every other step is hidden');
  assert.ok(hidden.size >= 1);
});

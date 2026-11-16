// The chart kind in the page, with the real fonts: every type, in both looks and both formats, reviewed at the sheet
// moments, comes back with no finding (labels measured by the page never meet, never leave the frame, never fall under a
// caption); twelve long labels say they do not fit rather than overlapping; and an honesty finding fails a real run
// (make exits 1 with a mechanical finding at the field). Run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const MAKE = fileURLToPath(new URL('../../scripts/make.mjs', import.meta.url));
const COMBOS = Object.freeze([
  { mode: 'pro', look: 'desk', format: '16:9' },
  { mode: 'pro', look: 'desk', format: '9:16' },
  { mode: 'viral', look: 'pop', format: '16:9' },
  { mode: 'viral', look: 'pop', format: '9:16' },
]);
const SHOTS = Object.freeze({
  column: { type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.', data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q3', source: 'Sales ledger, 2026' },
  bar: { type: 'bar', title: 'Video takes the most time', say: 'We timed every task for a week. Video took the longest.', data: [{ label: 'Video', value: 14.5 }, { label: 'Email', value: 9 }, { label: 'Meetings', value: 7.5 }, { label: 'Docs', value: 4 }], unit: 'h', highlight: 'Video' },
  line: { type: 'line', title: 'Files overtook servers', say: 'Both grew for a year. Then files pulled ahead.', data: { series: [{ name: 'Files', points: [{ x: 'Jan', y: 2 }, { x: 'Apr', y: 5 }, { x: 'Jul', y: 9 }, { x: 'Oct', y: 14 }] }, { name: 'Servers', points: [{ x: 'Jan', y: 3 }, { x: 'Apr', y: 4 }, { x: 'Jul', y: 5 }, { x: 'Oct', y: 6 }] }] }, highlight: 'Files' },
  area: { type: 'area', title: 'Weekly users doubled', say: 'Every week brought more people. By June, users had doubled.', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((x, i) => ({ x, y: [410, 470, 520, 610, 700, 830][i] })), source: 'Product analytics' },
  donut: { type: 'donut', title: 'Most of it is video', say: 'Here is where the time goes. Video takes most of it.', data: [{ label: 'Video', value: 62 }, { label: 'Docs', value: 23 }, { label: 'Mail', value: 15 }], unit: '%', highlight: 'Video' },
  brokenbar: { type: 'bar', title: 'Video still leads', say: 'We timed every task again. Video still took the longest.', data: [{ label: 'Video', value: 14.5 }, { label: 'Email', value: 9 }, { label: 'Meetings', value: 7.5 }, { label: 'Docs', value: 4 }], unit: 'h', baseline: 2, highlight: 'Video' },
  negative: { type: 'column', title: 'Only Q2 lost money', say: 'Three quarters made money. Q2 lost six.', data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: -6 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q2' },
  broken: { type: 'column', title: 'Scores barely moved', say: 'The axis starts at forty. The change is small.', data: [{ label: '2023', value: 52 }, { label: '2024', value: 54 }, { label: '2025', value: 55 }], baseline: 40, highlight: '2025' },
});

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-chart-browser-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}
const filmOf = ({ mode, look, format }, shot, extra = {}) => ({ version: 2, mode, look, format, fps: FPS, seed: 3, shots: [{ id: 'g', show: 'chart', ...shot }], ...extra });

for (const combo of COMBOS) {
  for (const [name, shot] of Object.entries(SHOTS)) {
    test(`the ${name} chart in ${combo.look} at ${combo.format}, measured with the real fonts, has no review finding`, async (t) => {
      const session = await open(t, filmOf(combo, shot));
      if (!session) return;
      assert.deepEqual(await reviewFilm({ session }), []);
    });
  }
  test(`the column chart with captions on in ${combo.look} at ${combo.format} keeps its plot clear of them: no finding`, async (t) => {
    const session = await open(t, filmOf(combo, SHOTS.column, { captions: true }));
    if (!session) return;
    assert.deepEqual(await reviewFilm({ session }), []);
  });
}

test('twelve long column labels on 9:16 say they do not fit (a creative finding) and never overlap (no mechanical finding)', async (t) => {
  const shot = { ...SHOTS.column, highlight: undefined, data: Array.from({ length: 12 }, (_, i) => ({ label: `Department ${i + 1}`, value: i + 1 })) };
  const session = await open(t, filmOf(COMBOS[1], shot));
  if (!session) return;
  const findings = await reviewFilm({ session });
  assert.deepEqual(findings.filter((f) => f.kind === 'mechanical'), [], JSON.stringify(findings));
  assert.ok(findings.some((f) => f.kind === 'creative' && /data\[\d+\]\.label/.test(f.path)), JSON.stringify(findings));
});

test('an honesty finding fails a real run: a one-value donut makes make exit 1 with a mechanical finding at shots[0].data', async (t) => {
  const probe = await sessionOrNull(filmOf(COMBOS[0], SHOTS.column), { specDir });
  if (!probe) { t.skip('no browser'); return; }
  await probe.close();
  const file = path.join(specDir, 'donut.json');
  writeFileSync(file, JSON.stringify(filmOf(COMBOS[0], { ...SHOTS.donut, data: [{ label: 'Video', value: 62 }] })));
  const run = await promisify(execFile)('node', [MAKE, file, '--sheets-only', '--json']).then(() => ({ code: 0, stdout: '' }), (err) => ({ code: err.code, stdout: err.stdout }));
  assert.equal(run.code, 1);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.kind === 'mechanical' && f.path === 'shots[0].data' && /2 to 6/.test(f.message)), JSON.stringify(report.findings));
});

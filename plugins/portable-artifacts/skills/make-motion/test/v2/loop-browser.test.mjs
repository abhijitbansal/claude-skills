// Root `loop: true` (version 1's `viral.loop`): the review compares the film's last frame with its first and, when they
// differ by more than LOOP_DIFF_MAX (mean absolute per-channel difference over 255, version 1's 0.12), says so as a
// creative finding, so a looping clip ends on its opening picture. Browser tests skip without one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, HERE } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { LOOP_DIFF_MAX } from '../../scripts/v2/review.mjs';

const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const shot = (id, background, cut) => ({ id, show: 'free', hold: 1, background, ...(cut ? { cut } : {}), nodes: [BAR] });
const RED = '#c0392b';
const BLUE = '#1f4e8c';

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-loop-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const run = async (name, film) => {
  const specPath = path.join(dir, `${name}.json`);
  writeFileSync(specPath, JSON.stringify(film));
  return runMake({ specPath, out: path.join(dir, `out-${name}`, 'film.mp4'), exact: false, noRender: true, outline: false });
};
const loopFinding = (report) => report.findings.find((f) => f.path === 'loop');

test('LOOP_DIFF_MAX is version 1\'s 0.12, and loop takes a boolean', () => {
  assert.equal(LOOP_DIFF_MAX, 0.12);
  assert.equal(validateFilm({ version: 2, loop: true, shots: [shot('a', RED)] }, { specDir: HERE }).ok, true);
  assert.ok(validateFilm({ version: 2, loop: 'yes', shots: [shot('a', RED)] }, { specDir: HERE }).errors.some((e) => e.path === 'loop'));
});

test('loop: a last frame unlike the first is a creative finding naming the difference', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report } = await run('apart', { version: 2, loop: true, shots: [shot('a', RED), shot('b', BLUE, 'cut')] });
  const finding = loopFinding(report);
  assert.ok(finding, JSON.stringify(report.findings));
  assert.equal(finding.kind, 'creative');
  assert.equal(finding.shot, 'b');
  assert.match(finding.message, /^the last frame does not match the first \(difference 0\.\d\d\); end on the opening picture again so the film loops$/);
  return undefined;
});

test('loop: a film that ends on its opening picture has no loop finding', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report } = await run('back', { version: 2, loop: true, shots: [shot('a', RED), shot('b', BLUE, 'cut'), shot('c', RED, 'cut')] });
  assert.equal(loopFinding(report), undefined, JSON.stringify(report.findings));
  return undefined;
});

test('without loop nothing is compared', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report } = await run('noloop', { version: 2, shots: [shot('a', RED), shot('b', BLUE, 'cut')] });
  assert.equal(loopFinding(report), undefined);
  return undefined;
});

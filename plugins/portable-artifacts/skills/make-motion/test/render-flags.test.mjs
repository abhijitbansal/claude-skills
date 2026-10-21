import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../scripts/lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const EXAMPLE = path.join(root, 'references/examples/q3-revenue.json');
const run = (args, env = {}) => spawnSync(process.execPath, [RENDER, EXAMPLE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('render: a hostile --model exits 1 before ffmpeg is needed and writes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-'));
  const r = run(['--out', path.join(dir, 'o.mp4'), '--model', 'x"><script>'], { FFMPEG_PATH: path.join(dir, 'no-such-ffmpeg') });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout + r.stderr, /generatedBy\.model/);
  assert.deepEqual(readdirSync(dir), []);
});

test('render: a typing text that fits at the spec fps but not at --fps is refused before anything renders, naming the fix', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-'));
  // 27 characters take 0.945 s; at 30 fps the last frame is 1/30 s before the 1 s scene ends, at 10 fps 1/10 s.
  const motion = { size: [160, 90], fps: 30, scenes: [{ id: 's', duration: 1, elements: [{ id: 't', type: 'text', text: 'x'.repeat(27), typing: true, x: 80, y: 45, fontSize: 20 }] }] };
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const slow = spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), '--out', path.join(dir, 'o.mp4'), '--fps', '10'], { encoding: 'utf8' });
  assert.equal(slow.status, 1, slow.stdout + slow.stderr);
  assert.match(slow.stdout + slow.stderr, /scenes\[0\]\.elements\[0\]\.text: typing 27 characters takes 0\.95s but scene "s" lasts 1s .*at 10 fps\); shorten the text or lengthen the scene to at least 1\.05s/);
  assert.deepEqual(readdirSync(dir), ['m.json'], 'nothing was written');
});

test('render: an unknown option exits 2', () => {
  assert.equal(run(['--modle', 'x']).status, 2);
});

test('render: --model/--effort/--agent reach the ffmpeg metadata args', async (t) => {
  try { await (await launchBrowser({ quiet: true })).close(); } catch { return t.skip('browser unavailable'); }
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-'));
  const log = path.join(dir, 'args.txt');
  const fake = path.join(dir, 'ffmpeg');
  // Stand-in encoder: records its argv, drains the frames, creates the output file.
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\ncat > /dev/null\nfor last; do :; done\n: > "$last"\n`);
  chmodSync(fake, 0o755);
  const r = run(['--out', path.join(dir, 'o.mp4'), '--fps', '1', '--model', 'Claude Opus 5.5', '--effort', 'high', '--agent', 'Claude Code'], { FFMPEG_PATH: fake });
  assert.equal(r.status, 0, r.stderr);
  const args = readFileSync(log, 'utf8').split('\n');
  assert.ok(args.some((a) => /^comment=make-motion · Claude Opus 5\.5 · high effort · Claude Code · /.test(a)), args.join('|'));
  assert.ok(args.includes('artist=Claude Opus 5.5'));
  assert.ok(existsSync(path.join(dir, 'o.mp4')));
});

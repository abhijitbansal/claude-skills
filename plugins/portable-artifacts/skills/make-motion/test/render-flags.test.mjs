import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

// A fake ffmpeg whose mix probe takes a while: render.mjs has written the cue folder and is blocked inside it, which is
// when an interrupt used to kill the process with no handler installed and leave the folder behind.
test('render: an interrupt while the cue folder exists removes it (exit 130, no motion-cues-* left)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-'));
  const scratch = mkdtempSync(path.join(tmpdir(), 'rf-tmp-'));
  const slow = path.join(dir, 'ffmpeg');
  writeFileSync(slow, '#!/bin/sh\nsleep 2\n');
  chmodSync(slow, 0o755);
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [] }], cues: [{ cue: 'pop', at: 0 }] }));
  const child = spawn(process.execPath, [RENDER, path.join(dir, 'm.json'), '--out', path.join(dir, 'o.mp4')], { env: { ...process.env, FFMPEG_PATH: slow, TMPDIR: scratch } });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 10000;
  while (!readdirSync(scratch).some((f) => f.startsWith('motion-cues-')) && Date.now() < deadline) await new Promise((r) => { setTimeout(r, 25); });
  assert.ok(readdirSync(scratch).some((f) => f.startsWith('motion-cues-')), 'the cue folder was written');
  child.kill('SIGINT');
  const { code, signal } = await closed;
  assert.deepEqual([code, signal], [130, null], 'the handler ran and exited 130');
  assert.deepEqual(readdirSync(scratch), [], 'the cue folder is gone');
});

test('render: an interrupt during browser launch waits for that browser to close', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-launch-'));
  const skill = path.join(dir, 'skill');
  cpSync(root, skill, { recursive: true, filter: (file) => !['node_modules', 'test'].includes(path.basename(file)) });
  symlinkSync(path.join(root, 'node_modules'), path.join(skill, 'node_modules'), 'dir');
  const ready = path.join(dir, 'launch-ready');
  const closedFile = path.join(dir, 'browser-closed');
  // A launch that has acquired resources but has not returned a browser yet.
  writeFileSync(path.join(skill, 'scripts/lib/browser.mjs'), `
import { writeFileSync } from 'node:fs';
export async function launchBrowser() {
  writeFileSync(${JSON.stringify(ready)}, '');
  await new Promise(resolve => process.once('SIGINT', resolve));
  return {
    async close() { writeFileSync(${JSON.stringify(closedFile)}, ''); },
    async newPage() { throw new Error('render continued after the interrupt'); },
  };
}
export function guardNetwork() {}
`);
  const fake = path.join(dir, 'ffmpeg');
  writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  chmodSync(fake, 0o755);
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [] }] }));
  const child = spawn(process.execPath, [path.join(skill, 'scripts/render.mjs'), spec, '--out', path.join(dir, 'o.mp4')],
    { env: { ...process.env, FFMPEG_PATH: fake } });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 10000;
  while (!existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(existsSync(ready), 'browser launch started');
  child.kill('SIGINT');
  const { code, signal } = await closed;
  assert.deepEqual([code, signal], [130, null]);
  assert.ok(existsSync(closedFile), 'the browser acquired during launch was closed before exit');
  assert.equal(existsSync(path.join(dir, 'o.mp4')), false);
});

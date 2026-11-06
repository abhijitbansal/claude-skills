import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { writeWav } from './helpers/wav.mjs';

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
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined; // a fake ffmpeg stands in below, so only the browser is needed
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

// ---- --no-provenance ---------------------------------------------------------------------------------------------------

const GEN = { model: 'Claude Opus 5.5', agent: 'Claude Code' };
const tinySpec = (extra = {}) => ({ size: [160, 90], fps: 24, generatedBy: GEN, scenes: [{ id: 's', duration: 1, elements: [{ id: 't', type: 'text', text: 'Hi', x: 80, y: 45, fontSize: 20 }] }], ...extra });

function tinyFile(motion, withTone = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-np-'));
  if (withTone) writeWav(path.join(dir, 'tone.wav'), { seconds: 1 });
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  return { dir, spec: path.join(dir, 'm.json'), out: path.join(dir, 'o.mp4') };
}

// The container tags of an MP4 as { tag: value }; ffprobe sits beside the ffmpeg render.mjs finds.
function tags(ffprobe, file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).format.tags ?? {};
}

const renderTiny = (f, args) => spawnSync(process.execPath, [RENDER, f.spec, '--out', f.out, ...args], { encoding: 'utf8' });

test('render: by default both authoring tags are written (guards the base behaviour)', async (t) => {
  const tools = await requireRender(t, { need: ['browser', 'ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const f = tinyFile(tinySpec());
  const r = renderTiny(f, []);
  assert.equal(r.status, 0, r.stderr);
  const got = tags(tools.ffprobe, f.out);
  assert.match(got.comment, /^make-motion · Claude Opus 5\.5 · /);
  assert.equal(got.artist, 'Claude Opus 5.5');
});

test('render: --no-provenance removes the comment and artist tags', async (t) => {
  const tools = await requireRender(t, { need: ['browser', 'ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const f = tinyFile(tinySpec());
  const r = renderTiny(f, ['--no-provenance']);
  assert.equal(r.status, 0, r.stderr);
  const got = tags(tools.ffprobe, f.out);
  assert.equal(got.comment, undefined, JSON.stringify(got));
  assert.equal(got.artist, undefined, JSON.stringify(got));
});

test('render: root "provenance": false does the same, through the loudness path', async (t) => {
  const tools = await requireRender(t, { need: ['browser', 'ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const f = tinyFile(tinySpec({ provenance: false, audio: [{ src: 'tone.wav' }] }), true);
  const r = renderTiny(f, ['--loudness', '-14']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^loudness: target -14 LUFS/m, 'the second pass ran');
  const got = tags(tools.ffprobe, f.out);
  assert.equal(got.comment, undefined, JSON.stringify(got));
  assert.equal(got.artist, undefined, JSON.stringify(got));
});

test('render: --no-provenance with --contact-sheet is a usage error (exit 2) and writes nothing', () => {
  const f = tinyFile(tinySpec());
  const r = spawnSync(process.execPath, [RENDER, f.spec, '--contact-sheet', '--no-provenance', '--out', path.join(f.dir, 'sheets')], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /--no-provenance does not apply to --contact-sheet/);
  assert.deepEqual(readdirSync(f.dir), ['m.json']);
});

test('render: a misspelt --no-provenance suggests the real flag', () => {
  const r = run(['--no-provenence']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /did you mean --no-provenance\?/);
});

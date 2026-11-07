import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import { writeWav } from './helpers/wav.mjs';
import { startServer } from '../scripts/lib/server.mjs';
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

// ---- --poster ----------------------------------------------------------------------------------------------------------

const POSTER_SRT = '1\n00:00:00,000 --> 00:00:07,000\nHello poster world\n';
const POSTER_AT = 5; // frame 120 at 24 fps, once all three items are on screen
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// A listicle low on the canvas: with captions its room is the band above the caption zone, so a captioned spec lays it out
// smaller than the same spec without them. The poster must keep that layout and still leave the captions out.
const posterSpec = (extra = {}) => ({
  size: [640, 360], fps: 24, captions: [{ src: 'c.srt' }],
  scenes: [{ id: 's', duration: 7, elements: [{ id: 'b', type: 'block', x: 320, y: 230, block: 'listicle', params: { title: 'Three tricks for faster edits', items: ['Cut on the beat', 'Keep captions short', 'Hook in one second'] } }] }],
  ...extra,
});

function posterFile(motion = posterSpec()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-poster-'));
  writeFileSync(path.join(dir, 'c.srt'), POSTER_SRT);
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  return { dir, spec: path.join(dir, 'm.json'), png: path.join(dir, 'p.png') };
}

const renderPoster = (f, args = ['--poster', String(POSTER_AT), '--poster-out', f.png]) => spawnSync(process.execPath, [RENDER, f.spec, ...args], { encoding: 'utf8' });

// The film's frame at `sec`, drawn the way render.mjs draws it (same viewport, same launch arguments), with the captions layer hidden.
async function frameWithoutCaptions(specPath, size, sec) {
  const server = await startServer({ specPath, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion, null, { timeout: 0 });
    await page.evaluate(() => window.__motion.ready);
    await page.evaluate((s) => window.__motion.seek(s), sec);
    await page.evaluate(() => { for (const n of document.querySelectorAll('#stage > .captions')) n.style.visibility = 'hidden'; });
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
    await server.close();
  }
}

test('render: poster equals the film\'s frame with the captions layer hidden', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const f = posterFile();
  const r = renderPoster(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.split('\n').includes(f.png), `the path is printed: ${r.stdout}`);
  const expected = await frameWithoutCaptions(f.spec, [640, 360], POSTER_AT);
  assert.ok(readFileSync(f.png).equals(expected), 'the poster is the hidden-captions frame, byte for byte');
});

test('render: poster keeps the captioned block layout', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const withCaptions = posterFile();
  const { captions, ...bare } = posterSpec();
  const without = posterFile(bare);
  assert.equal(renderPoster(withCaptions).status, 0);
  assert.equal(renderPoster(without).status, 0);
  assert.ok(!readFileSync(withCaptions.png).equals(readFileSync(without.png)), 'the block is laid out above the caption zone only when the spec has captions');
});

test('render: poster keeps grain and vignette', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const plain = posterFile();
  const vignetteOnly = posterFile(posterSpec({ texture: { vignette: true } }));
  const grainOnly = posterFile(posterSpec({ texture: { grain: 0.15 } }));
  for (const f of [plain, vignetteOnly, grainOnly]) assert.equal(renderPoster(f).status, 0);
  assert.ok(!readFileSync(vignetteOnly.png).equals(readFileSync(plain.png)), 'vignette alone changes the poster');
  assert.ok(!readFileSync(grainOnly.png).equals(readFileSync(plain.png)), 'grain alone changes the poster');
});

test('render: --poster alone writes <spec dir>/out/poster.jpg (a JPEG) and no MP4', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const f = posterFile();
  const r = renderPoster(f, ['--poster', '1']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(path.join(f.dir, 'out')), ['poster.jpg'], 'writes no MP4');
  const jpg = readFileSync(path.join(f.dir, 'out', 'poster.jpg'));
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG signature');
  assert.ok(r.stdout.split('\n').includes(path.join(f.dir, 'out', 'poster.jpg')), r.stdout);
});

// Size and centre pixel of an image file, as a browser decodes it: proof that the bytes are a real picture.
async function decodeInBrowser(file, mime) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ([data, type]) => {
      const img = new Image();
      img.src = `data:${type};base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, centre: [...ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data] };
    }, [readFileSync(file).toString('base64'), mime]);
  } finally {
    await browser.close();
  }
}

test('render: a poster inside a GL transition window is the composed frame without captions, as a PNG or a decodable JPEG', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const scenes = [{ id: 'a', duration: 2, background: '#cc0000', elements: [] }, { id: 'b', duration: 2, background: '#0000cc', transition: { type: 'gl-ripple', duration: 1 }, elements: [] }];
  const base = { size: [320, 180], fps: 24, scenes }; // scene b starts at 2 s; the window is 2-3 s
  const withCaptions = posterFile({ ...base, captions: [{ src: 'c.srt' }] });
  writeFileSync(path.join(withCaptions.dir, 'c.srt'), '1\n00:00:00,000 --> 00:00:04,000\nHello poster world\n'); // the video is 4 s
  const without = posterFile(base);
  const png = renderPoster(withCaptions, ['--poster', '2.5', '--poster-out', withCaptions.png]);
  assert.equal(png.status, 0, png.stdout + png.stderr);
  assert.equal(renderPoster(without, ['--poster', '2.5', '--poster-out', without.png]).status, 0);
  assert.deepEqual([...readFileSync(withCaptions.png).subarray(1, 4)], [0x50, 0x4e, 0x47], 'PNG signature');
  assert.ok(readFileSync(withCaptions.png).equals(readFileSync(without.png)), 'a captioned spec gives the poster of the same spec without captions: none are drawn in the window');
  const plain = path.join(withCaptions.dir, 'plain.png');
  assert.equal(renderPoster(withCaptions, ['--poster', '0.5', '--poster-out', plain]).status, 0);
  assert.ok(!readFileSync(plain).equals(readFileSync(withCaptions.png)), 'the window frame is not the outgoing scene');
  const jpg = path.join(withCaptions.dir, 'p.jpg');
  const r = renderPoster(withCaptions, ['--poster', '2.5', '--poster-out', jpg]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([...readFileSync(jpg).subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG signature');
  const decodedJpg = await decodeInBrowser(jpg, 'image/jpeg');
  const decodedPng = await decodeInBrowser(withCaptions.png, 'image/png');
  assert.deepEqual([decodedJpg.width, decodedJpg.height], [320, 180], 'the JPEG decodes at the video size');
  decodedJpg.centre.forEach((channel, i) => assert.ok(Math.abs(channel - decodedPng.centre[i]) <= 16, `the JPEG centre pixel ${decodedJpg.centre} is the PNG's ${decodedPng.centre}`));
});

test('render: --poster past the end is a usage error', () => {
  const f = posterFile();
  const r = renderPoster(f, ['--poster', '40']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--poster 40: past the end \(the video is 7 s\)/);
  assert.deepEqual(readdirSync(f.dir).sort(), ['c.srt', 'm.json'], 'nothing written');
});

test('render: --poster just under the length rounds onto a frame that does not exist, and the message says which frames do', () => {
  const f = posterFile();
  const r = renderPoster(f, ['--poster', '6.99']); // 6.99 x 24 rounds to frame 168 of 168 (frames 0-167)
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--poster 6\.99: past the end \(the video is 7 s, 168 frames, last frame 167\)/);
  const exact = renderPoster(f, ['--poster', '7']);
  assert.equal(exact.status, 2);
  assert.match(exact.stderr, /--poster 7: past the end \(the video is 7 s\)\n$/, 'at the length itself the note is the plain one');
});

test('render: poster flag combinations that cannot work are usage errors (exit 2) and write nothing', () => {
  const f = posterFile();
  const cases = [
    [['--poster-out', f.png], /--poster-out needs --poster/],
    [['--poster', '1', '--batch', path.join(f.dir, 'rows.json')], /--batch does not apply to --poster/],
    [['--poster', '1', '--contact-sheet'], /--contact-sheet does not apply to --poster/],
    [['--poster', '1', '--poster-out', path.join(f.dir, 'p.gif')], /--poster-out must end in \.jpg, \.jpeg or \.png/],
    [['--poster', '1', '--poster-out', path.join(f.dir, 'p')], /--poster-out must end in \.jpg, \.jpeg or \.png/],
    [['--poster', '1', '--out', path.join(f.dir, 'o.mp4')], /--out does not apply to --poster/],
    [['--poster', '1', '--workers', '2'], /--workers does not apply to --poster/],
    [['--poster', '1', '--loudness', '-14'], /--loudness does not apply to --poster/],
    [['--poster', '1', '--true-peak', '-1'], /--true-peak does not apply to --poster/],
    [['--poster', '1', '--no-provenance'], /--no-provenance does not apply to --poster/],
    [['--poster', '1', '--model', 'Claude'], /--model does not apply to --poster/],
    [['--poster', '1', '--effort', 'high'], /--effort does not apply to --poster/],
    [['--poster', '1', '--agent', 'Claude Code'], /--agent does not apply to --poster/],
    [['--poster', 'soon'], /--poster must be a number of seconds/],
    [['--poster', '-1'], /--poster must be a number of seconds/],
  ];
  for (const [args, message] of cases) {
    const r = renderPoster(f, args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message, args.join(' '));
  }
  assert.deepEqual(readdirSync(f.dir).sort(), ['c.srt', 'm.json'], 'nothing written');
});

test('render: --poster-out may not overwrite an image the spec reads', () => {
  const motion = posterSpec();
  motion.scenes[0].elements.push({ id: 'img', type: 'image', src: 'pic.png', x: 100, y: 100, width: 40, height: 40 });
  const f = posterFile(motion);
  writeFileSync(path.join(f.dir, 'pic.png'), PIXEL_PNG);
  const r = renderPoster(f, ['--poster', '1', '--poster-out', path.join(f.dir, 'pic.png')]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--poster-out: pic\.png is a file this render reads/);
  assert.deepEqual(readFileSync(path.join(f.dir, 'pic.png')), PIXEL_PNG, 'the image is untouched');
});

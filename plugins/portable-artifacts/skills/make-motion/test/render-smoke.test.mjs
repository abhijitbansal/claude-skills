import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFfmpeg } from '../scripts/lib/ffmpeg.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { writeWav } from './helpers/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const EXAMPLE = path.join(root, 'references/examples/q3-revenue.json');
const BG = [11, 13, 18];
const tmp = (p) => mkdtempSync(path.join(tmpdir(), p));

async function haveBrowser() {
  try { await (await launchBrowser({ quiet: true })).close(); return true; } catch { return false; }
}
async function haveFfmpeg() { try { return await findFfmpeg(); } catch { return null; } }
function ffprobeFor(ff) {
  const sibling = path.join(path.dirname(ff), 'ffprobe');
  if (existsSync(sibling)) return sibling;
  return spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0 ? 'ffprobe' : null;
}

// Share of pixels that differ from the background, decoded in the browser.
async function nonBackgroundRatio(png) {
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const url = `data:image/png;base64,${readFileSync(png).toString('base64')}`;
    return await page.evaluate(async ({ url: src, bg }) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) n++;
      }
      return n / (d.length / 4);
    }, { url, bg: BG });
  } finally { await browser.close(); }
}

const render = (args, env = {}) => spawnSync(process.execPath, [RENDER, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('render q3-revenue at 320x180 / 10 fps, probe it, and the frame is not blank', async (t) => {
  const ff = await haveFfmpeg();
  if (!ff || !(await haveBrowser())) return t.skip('browser or ffmpeg unavailable');
  const probeBin = ffprobeFor(ff);
  const dir = tmp('rnd-');
  const out = path.join(dir, 'v.mp4');
  const r = render([EXAMPLE, '--out', out, '--fps', '10', '--size', '320x180']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(dir), ['v.mp4'], 'partial file must be renamed away');
  const frame = path.join(dir, 'f.png');
  assert.equal(spawnSync(ff, ['-y', '-ss', '8', '-i', out, '-frames:v', '1', frame]).status, 0);
  assert.ok(await nonBackgroundRatio(frame) > 0.01, 'frame at 8s is blank');
  if (!probeBin) return t.diagnostic('ffprobe missing: skipped probe assertions');
  const probe = spawnSync(probeBin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,nb_frames:format=duration', '-of', 'json', out], { encoding: 'utf8' });
  const info = JSON.parse(probe.stdout);
  assert.equal(info.streams[0].width, 320);
  assert.equal(info.streams[0].height, 180);
  assert.ok(Math.abs(Number(info.format.duration) - 10) <= 0.1 + 1e-6, `duration ${info.format.duration}`);
  assert.equal(Number(info.streams[0].nb_frames), 100);
  return undefined;
});

const DURATION_SLACK_S = 0.2;
const SECONDS_PER_MINUTE = 60;
const SCENE_SECONDS = 2;

function audioSpec() {
  const scene = (id) => ({ id, duration: SCENE_SECONDS, elements: [] });
  return {
    size: [160, 90],
    scenes: [scene('one'), scene('two')],
    audio: [
      { src: 'music.wav', scene: 'one', at: 0.5, volume: 0.5, fadeIn: 0.3, fadeOut: 0.3 },
      { src: 'voice.wav', scene: 'two', at: 0, duration: 1 },
    ],
  };
}

function containerDuration(stderr) {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  return Number(m[1]) * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE + Number(m[2]) * SECONDS_PER_MINUTE + Number(m[3]);
}

test('render with two audio tracks muxes one AAC stream and keeps the spec length', async (t) => {
  const ff = await haveFfmpeg();
  if (!ff || !(await haveBrowser())) return t.skip('browser or ffmpeg unavailable');
  const dir = tmp('aud-');
  writeWav(path.join(dir, 'music.wav'), { seconds: 3 });
  writeWav(path.join(dir, 'voice.wav'), { seconds: 1 });
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(audioSpec()));
  const out = path.join(dir, 'v.mp4');
  const r = render([path.join(dir, 'm.json'), '--out', out, '--fps', '10', '--size', '160x90']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const info = spawnSync(ff, ['-i', out], { encoding: 'utf8' }).stderr;
  assert.match(info, /Audio: aac/);
  assert.match(info, /Audio: aac.*stereo/, 'the mix is always stereo, even from mono inputs');
  assert.ok(containerDuration(info) <= SCENE_SECONDS * 2 + DURATION_SLACK_S, `duration ${containerDuration(info)}`);
  return undefined;
});

const SILENCE_DB = -60;
const meanDb = (ff, file, filters) => {
  const r = spawnSync(ff, ['-i', file, '-af', `${filters}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : Number.NaN;
};

test('a stereo track listed after a mono one keeps its channels and sample rate, and tracks start where the spec says', async (t) => {
  const ff = await haveFfmpeg();
  if (!ff || !(await haveBrowser())) return t.skip('browser or ffmpeg unavailable');
  const dir = tmp('mix-');
  writeWav(path.join(dir, 'voice.wav'), { seconds: 1, sampleRate: 24000 }); // what voice.mjs writes
  writeWav(path.join(dir, 'music.wav'), { seconds: 3, sampleRate: 44100, channels: 2, leftOnly: true });
  const spec = { size: [160, 90], scenes: [{ id: 'one', duration: 4, elements: [] }],
    audio: [{ src: 'voice.wav', at: 0 }, { src: 'music.wav', at: 2.5 }] }; // mono voice first: the collapse trigger
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec));
  const out = path.join(dir, 'v.mp4');
  const r = render([path.join(dir, 'm.json'), '--out', out, '--fps', '10', '--size', '160x90']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const right = meanDb(ff, out, 'atrim=2.6:4,pan=mono|c0=c1,');
  assert.ok(right < SILENCE_DB, `right channel should stay silent during left-only music, got ${right} dB`);
  const left = meanDb(ff, out, 'atrim=2.6:4,pan=mono|c0=c0,');
  assert.ok(left > -30, `left channel should carry the music, got ${left} dB`);
  const gap = meanDb(ff, out, 'atrim=1.2:2.4,');
  assert.ok(gap < SILENCE_DB, `nothing should play between the voice and the music (adelay), got ${gap} dB`);
  return undefined;
});

test('render fails before launching a browser when an audio file cannot be decoded', async (t) => {
  const ff = await haveFfmpeg();
  if (!ff) return t.skip('ffmpeg unavailable');
  const dir = tmp('badaud-');
  writeFileSync(path.join(dir, 'voice.wav'), 'not audio');
  const spec = { scenes: [{ id: 's', duration: 1, elements: [] }], audio: [{ src: 'voice.wav' }] };
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec));
  const r = render([path.join(dir, 'm.json'), '--out', path.join(dir, 'v.mp4')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /audio\[0\]\.src: ffmpeg cannot decode voice\.wav: /);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.mp4')), []);
  return undefined;
});

test('--contact-sheet ignores audio, even an undecodable file', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('csaud-');
  writeFileSync(path.join(dir, 'voice.wav'), 'not audio');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ scenes: [{ id: 's', duration: 1, elements: [] }], audio: [{ src: 'voice.wav' }] }));
  const r = render([path.join(dir, 'm.json'), '--contact-sheet', '--out', dir, '--size', '160x90']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return undefined;
});

test('--contact-sheet writes one non-blank PNG per scene (no ffmpeg needed)', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('cs-');
  const r = render([EXAMPLE, '--contact-sheet', '--out', dir, '--size', '480x270'], { PATH: '/nonexistent' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(path.join(dir, 'contact')).sort(), ['bars.png', 'intro.png']);
  assert.ok(await nonBackgroundRatio(path.join(dir, 'contact', 'intro.png')) > 0.02, 'intro is blank');
  return undefined;
});

test('a scene with background "art" renders the theme art: not the flat scene, and the same bytes every time', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('art-');
  const scene = (background) => ({ theme: 'poster', size: [480, 270], scenes: [{ id: 'cover', duration: 1, background,
    elements: [{ id: 'h', type: 'text', role: 'title', text: 'Art', x: 240, y: 135, fontSize: 64 }] }] });
  const sheet = (name, motion) => {
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(motion));
    const out = path.join(dir, name);
    const r = render([path.join(dir, `${name}.json`), '--contact-sheet', '--out', out, '--size', '480x270']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return readFileSync(path.join(out, 'contact', 'cover.png'));
  };
  const art = sheet('art', scene('art'));
  const again = sheet('again', scene('art'));
  const flat = sheet('flat', scene('#0d0e0c')); // poster's own page colour, so only the art differs
  assert.deepEqual(again, art, 'two renders of the same spec give byte-identical frames');
  assert.notDeepEqual(art, flat, 'the art scene is not the flat colour');
  assert.ok(await nonBackgroundRatio(path.join(dir, 'art', 'contact', 'cover.png')) > 0.1, 'the art covers the frame');
  return undefined;
});

test('ffmpeg dying early: clean non-zero exit, ffmpeg stderr shown, no partial file', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('epipe-');
  const fake = path.join(dir, 'ffmpeg-fake');
  writeFileSync(fake, '#!/usr/bin/env node\nprocess.stderr.write("fake ffmpeg: boom\\n");process.stdin.destroy();process.exit(3);\n');
  chmodSync(fake, 0o755);
  const out = path.join(dir, 'v.mp4');
  const r = render([EXAMPLE, '--out', out, '--fps', '10', '--size', '320x180'], { FFMPEG_PATH: fake });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fake ffmpeg: boom/);
  assert.doesNotMatch(r.stderr, /unhandled|EPIPE.*\n\s+at /i);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.mp4')), []);
  return undefined;
});

test('SIGTERM mid-render exits 143 and leaves no output', async (t) => {
  const ff = await haveFfmpeg();
  if (!ff || !(await haveBrowser())) return t.skip('browser or ffmpeg unavailable');
  const dir = tmp('sig-');
  const out = path.join(dir, 'v.mp4');
  const child = spawn(process.execPath, [RENDER, EXAMPLE, '--out', out, '--fps', '60', '--size', '320x180'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let sent = false;
  child.stdout.on('data', (c) => { if (!sent && /%/.test(String(c))) { sent = true; child.kill('SIGTERM'); } });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.ok(sent, 'render finished before SIGTERM could be sent');
  assert.equal(code, 143);
  assert.deepEqual(readdirSync(dir), []);
  return undefined;
});

test('usage errors exit 2 without launching anything', () => {
  const dir = tmp('use-');
  const tiny = path.join(dir, 'm.json');
  writeFileSync(tiny, JSON.stringify({ scenes: [{ id: 's', duration: 0.2, elements: [] }] }));
  const cases = [
    [[EXAMPLE, '--fps'], /--fps needs a value/],
    [[EXAMPLE, '--out', '--contact-sheet'], /--out needs a value/],
    [[EXAMPLE, '--size', '15x16'], /--size/],
    [[EXAMPLE, '--size', '3842x1080'], /--size/],
    [[EXAMPLE, '--size', '321x180'], /even/],
    [[tiny, '--fps', '1'], /no frames/],
  ];
  for (const [args, re] of cases) {
    const r = render(args);
    assert.equal(r.status, 2, `${args.join(' ')} -> ${r.status} ${r.stderr}`);
    assert.match(r.stderr, re);
  }
});

test('guardNetwork aborts non-local requests and reports them', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const other = http.createServer((_q, res) => { res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end('hi'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const otherUrl = `http://127.0.0.1:${other.address().port}/x`;
  const dir = tmp('net-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ scenes: [{ id: 's', duration: 1, elements: [] }] }));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const blocked = [];
    await guardNetwork(page, new URL(srv.url).origin, (u) => blocked.push(u));
    const tryFetch = (u) => page.evaluate((x) => fetch(x).then(() => 'loaded', () => 'blocked'), u);
    // about:blank has no CSP, so only the route guard can stop this request
    await page.goto('about:blank');
    assert.equal(await tryFetch(otherUrl), 'blocked');
    assert.deepEqual(blocked, [otherUrl]);
    await page.goto(srv.url);
    await page.evaluate(() => window.__motion.ready);
    assert.equal(await page.evaluate(() => fetch('/spec.json').then((r) => r.status)), 200);
    // on the real page the CSP (connect-src 'self') blocks it as well
    assert.equal(await tryFetch(otherUrl), 'blocked');
  } finally { await browser.close(); await srv.close(); other.close(); }
  return undefined;
});

test('renderer fails visibly (once) on an unknown element type', async (t) => {
  if (!(await haveBrowser())) return t.skip('browser unavailable');
  const dir = tmp('bog-');
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ scenes: [{ id: 's', duration: 1, elements: [{ id: 'b', type: 'bogus', x: 0, y: 0 }] }] }));
  const srv = await startServer({ specPath: path.join(dir, 'm.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    const msg = await page.evaluate(() => window.__motion.ready.then(() => 'ok', (e) => e.message));
    assert.match(msg, /unknown element type "bogus"/);
    assert.match(await page.textContent('#error'), /unknown element type "bogus"/);
    assert.deepEqual(pageErrors, [], 'error must not also surface as an uncaught page error');
  } finally { await browser.close(); await srv.close(); }
  return undefined;
});

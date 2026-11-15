// scripts/make.mjs, the one command: its flags and exit codes, the --json report, --list, --outline, the review rules
// seen through it, and the render (held frames, both capture modes, a stop in the middle). Tests that need a browser or
// ffmpeg skip without them (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull, headlessPids, probeVideo } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { jpegInput } from '../../scripts/v2/render.mjs';
import { encodeArgs } from '../../scripts/lib/ffmpeg.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const FPS = 30;
const GRAIN_FPS = 12;
const STILL_BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const PALETTE = { paper: '#f3eee3', ink: '#15130f', ink2: '#5b554a', accent: '#ffe14a', accent2: '#d63a2f', rule: '#cfc7b6' };
const MESH = { type: 'field', id: 'f', props: { field: 'mesh', params: {}, w: 1920, h: 1080, unit: 1, seed: 1, palette: PALETTE } };
const meshShot = (id, hold) => ({ id, show: 'free', hold, background: '#000000', nodes: [MESH] });
const still = (id, hold) => ({ id, show: 'free', hold, background: '#f3eee3', nodes: [STILL_BAR] });

const FILMS = {
  gate: { version: 2, mode: 'pro', shots: [
    { id: 'hook', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.' },
    { id: 'rows', show: 'number', cut: 'slide', say: 'Four hundred fifty nine rows. One file.', value: 459, label: 'in one file' },
  ] },
  held: { version: 2, fps: FPS, shots: [still('held', 2)] },
  off: { version: 2, shots: [{ id: 'off', show: 'free', hold: 1, background: '#101820', nodes: [
    { type: 'text', id: 'edge', props: { x: 10, y: 400, text: 'Off the edge', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 900, fill: '#ffffff' } },
  ] }] },
  stillLong: { version: 2, shots: [still('long', 8), still('end', 1)] },
  stillLast: { version: 2, shots: [still('first', 1), still('last', 8)] },
  meshLong: { version: 2, shots: [meshShot('mesh', 7), meshShot('end', 1)] },
  meshShort: { version: 2, fps: FPS, shots: [meshShot('mesh', 2)] },
  invalid: { version: 2, shots: [{ id: 'a', show: 'nope', hold: 1 }] },
  v1: { version: 1, scenes: [] },
  long: { version: 2, mode: 'pro', shots: [
    { id: 'hook', show: 'statement', say: 'Most dashboards cannot tell you where a number came from, or which query made it, or who changed the file last.' },
  ] },
};

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-make-'));
  for (const [name, film] of Object.entries(FILMS)) writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(film));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const filmPath = (name) => path.join(dir, `${name}.json`);
const outPath = (name, file = 'film.mp4') => path.join(dir, `out-${name}`, file);
const make = (args, env = {}) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 240_000 });
const parse = (run) => JSON.parse(run.stdout);

// A machine with no ffmpeg and no bundled browser: --outline must not need either.
const BARE = { PATH: '', FFMPEG_PATH: '/nonexistent/ffmpeg', PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' };

async function needs(t, { ffmpeg = false } = {}) {
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  if (ffmpeg && !await ffmpegOrNull()) { t.skip('no ffmpeg'); return false; }
  if (ffmpeg && spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return false; }
  return true;
}

// ---- no browser needed ----

test('--outline needs no browser and no ffmpeg, and prints one line per shot', () => {
  const run = make([filmPath('gate'), '--outline'], BARE);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, FILMS.gate.shots.length);
  assert.match(lines[0], /^hook {2}statement {2}0\.00–\d+\.\d\ds {2}"Most dashboards cannot tell you where a number came from\."$/, 'plain narration, no emphasis marks');
  assert.match(lines[1], /^rows {2}number {2}\d+\.\d\d–\d+\.\d\ds {2}"Four hundred fifty nine rows\. One file\."$/);
});

test('--outline --json is one object with a line per shot', () => {
  const report = parse(make([filmPath('gate'), '--outline', '--json'], BARE));
  assert.equal(report.ok, true);
  assert.deepEqual(report.outline.map((s) => s.id), ['hook', 'rows']);
  assert.equal(report.outline[0].start, 0);
});

test('an unknown flag exits 2 and lists the accepted ones', () => {
  const run = make([filmPath('gate'), '--fast']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--out, --json, --sheets-only, --outline, --list/);
  assert.match(run.stderr, /--fast/);
  assert.equal(run.stdout, '');
});

test('a misspelled flag suggests the right one; with --json the usage error is one JSON object', () => {
  const run = make([filmPath('gate'), '--outlin', '--json']);
  assert.equal(run.status, 2);
  const report = parse(run);
  assert.equal(report.ok, false);
  assert.match(report.errors[0].message, /did you mean '--outline'/);
});

test('no film path, two film paths and a bad --out exit 2', () => {
  assert.equal(make([]).status, 2);
  assert.match(make([]).stderr, /film \.json file/);
  assert.equal(make([filmPath('gate'), filmPath('held')]).status, 2);
  const out = make([filmPath('gate'), '--out', 'film.mov']);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /\.mp4/);
});

test('an unknown --list value exits 2 listing the accepted ones', () => {
  const run = make(['--list', 'moves']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /kinds, looks, modes, devices, cuts, fields/);
});

test('a missing film file exits 2 and names the file', () => {
  const run = make([path.join(dir, 'missing.json'), '--no-render']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /missing\.json/);
  assert.equal(run.stdout, '');
});

test('an invalid film exits 1 and renders nothing; --json carries its errors as mechanical findings with their json paths', () => {
  const run = make([filmPath('invalid'), '--json', '--out', outPath('invalid')]);
  assert.equal(run.status, 1);
  const report = parse(run);
  assert.equal(report.ok, false);
  assert.equal(report.output, null);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', false]]);
  assert.ok(report.findings.length > 0 && report.findings.every((f) => f.kind === 'mechanical'));
  assert.ok(report.findings.some((f) => f.path === 'shots[0].show' && /unknown kind "nope"/.test(f.message)), JSON.stringify(report.findings));
  assert.equal(existsSync(path.dirname(outPath('invalid'))), false, 'nothing is written for an invalid film');
});

test('an invalid film in text mode says invalid, then one line per finding', () => {
  const run = make([filmPath('invalid'), '--out', outPath('invalid')]);
  assert.equal(run.status, 1);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines[0], 'invalid');
  assert.match(lines[1], /^mechanical: shots\[0\]\.show: unknown kind/);
});

test('a version 1 spec exits 1 with the validator single version 1 message', () => {
  const run = make([filmPath('v1'), '--json']);
  assert.equal(run.status, 1);
  const report = parse(run);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0].message, /^this is a version 1 spec/);
});

// ---- --list ----

test('--list kinds gives each kind its summary, fields and an example, and each example is a valid shot', () => {
  const run = make(['--list', 'kinds', '--json']);
  assert.equal(run.status, 0);
  const { entries, common } = parse(run);
  assert.deepEqual(entries.map((e) => e.name), registries.kinds.names());
  assert.ok(common.some((f) => f.name === 'id' && f.required));
  const specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-list-'));
  try {
    for (const entry of entries) {
      assert.ok(entry.summary.length > 10, `${entry.name} has a summary`);
      assert.ok(Array.isArray(entry.fields) && entry.fields.every((f) => f.name && f.type), `${entry.name} lists its fields with types`);
      assert.equal(entry.example.show, entry.name, `${entry.name} has an example of itself`);
      for (const field of registries.kinds.get(entry.name).srcFields) {
        for (const src of [entry.example[field]].flat().filter((s) => typeof s === 'string')) {
          mkdirSync(path.dirname(path.join(specDir, src)), { recursive: true });
          writeFileSync(path.join(specDir, src), 'placeholder');
        }
      }
      const { ok, errors } = validateFilm({ version: 2, shots: [entry.example] }, { specDir });
      assert.deepEqual(errors, [], `the example of ${entry.name} validates`);
      assert.ok(ok);
    }
  } finally {
    rmSync(specDir, { recursive: true, force: true });
  }
});

test('every registered look, mode, device, cut and field has a summary, and the text form lists them', () => {
  for (const list of ['looks', 'modes', 'devices', 'cuts', 'fields']) {
    const entries = listEntries(list);
    assert.ok(entries.length > 0, list);
    for (const entry of entries) assert.ok(entry.summary.length > 10, `${list}: ${entry.name} has a summary`);
    const text = make(['--list', list]);
    assert.equal(text.status, 0);
    for (const entry of entries) assert.match(text.stdout, new RegExp(`^${entry.name} {2}`, 'm'));
  }
});

test('--list kinds in text lists the fields and the example of each kind', () => {
  const run = make(['--list', 'kinds']);
  assert.match(run.stdout, /^number {2}.+\n {2}fields: value\*: number/m);
  assert.match(run.stdout, /^ {2}example: \{"id":"rows","show":"number"/m);
});

// ---- the review through the command ----

test('--json prints exactly one object, with stages, findings and the report keys, and progress goes to stderr', async (t) => {
  if (!await needs(t)) return;
  const run = make([filmPath('gate'), '--no-render', '--json', '--out', outPath('gate')]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim().split('\n').length, 1, 'one line on stdout');
  const report = parse(run);
  assert.deepEqual(Object.keys(report).sort(), ['captured', 'capture', 'findings', 'frames', 'msPerFrame', 'ok', 'output', 'post', 'sheets', 'stages', 'timed'].sort());
  assert.equal(report.msPerFrame, null, 'nothing was rendered');
  assert.equal(report.ok, true);
  assert.equal(report.timed, 'estimated');
  assert.match(report.post, /^(webgl2|2d)$/);
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline', 'review']);
  assert.ok(report.stages.every((s) => s.ok === true && typeof s.seconds === 'number'));
  assert.equal(report.output, null);
  assert.equal(report.capture, null);
  assert.equal(report.captured, 0);
  assert.deepEqual(report.sheets.map((f) => path.basename(f)).sort(), ['cut-hook-rows.png', 'hook.png', 'rows.png']);
  for (const sheet of report.sheets) assert.ok(readPngWidth(sheet) <= 2400, `${sheet} is at most 2400 px wide`);
  assert.match(run.stderr, /make:/);
});

// Width of a PNG from its IHDR chunk.
const readPngWidth = (file) => readFileSync(file).readUInt32BE(16);

test('--sheets-only is --no-render', async (t) => {
  if (!await needs(t)) return;
  const run = make([filmPath('held'), '--sheets-only', '--json', '--out', outPath('sheets-only')]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(parse(run).output, null);
  assert.equal(existsSync(outPath('sheets-only')), false);
});

test('text mode prints valid, a line per finding, then the sheets, output and frame counts', async (t) => {
  if (!await needs(t)) return;
  const run = make([filmPath('off'), '--no-render', '--out', outPath('text')]);
  assert.equal(run.status, 1);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines[0], 'valid');
  assert.match(lines[1], /^mechanical: shots\[off\]: text "edge" is outside the safe area.* \(at 0\.00 s\)$/);
  assert.match(lines.at(-3), /^sheets: .+ \(1 file\)$/);
  assert.match(lines.at(-2), /^output: none/);
  assert.equal(lines.at(-1), 'frames: 30');
});

test('the mechanical gate fires: text forced off the canvas makes ok false and exit 1, and the MP4 is still rendered', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const run = make([filmPath('off'), '--json', '--out', outPath('off')]);
  assert.equal(run.status, 1, run.stderr);
  const report = parse(run);
  assert.equal(report.ok, false);
  const [finding] = report.findings.filter((f) => f.kind === 'mechanical');
  assert.equal(finding.shot, 'off');
  assert.equal(finding.path, 'shots[off]');
  assert.equal(finding.t, 0);
  assert.ok(existsSync(report.output), 'the video exists');
  assert.equal(probeVideo(report.output).frames, report.frames);
});

test('a shot that holds still longer than the mode allows is a creative finding naming the shot and the stretch', async (t) => {
  if (!await needs(t)) return;
  const run = make([filmPath('stillLong'), '--no-render', '--json', '--out', outPath('still-long')]);
  assert.equal(run.status, 0, 'a creative finding does not fail the run');
  const found = parse(run).findings.filter((f) => /holds still/.test(f.message));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].shot, 'long');
  assert.match(found[0].message, /8\.00 s from 0\.00 s; the pro mode allows 6 s/);
});

test('a film on a mesh field is not reported as still, and every frame of it is captured', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const sheets = make([filmPath('meshLong'), '--no-render', '--json', '--out', outPath('mesh-long')]);
  assert.deepEqual(parse(sheets).findings.filter((f) => /holds still/.test(f.message)), [], 'a 7 s mesh shot moves');
  const run = make([filmPath('meshShort'), '--json', '--out', outPath('mesh-short')]);
  assert.equal(run.status, 0, run.stderr);
  const report = parse(run);
  assert.equal(report.captured, report.frames, 'the picture changes every frame, so none is reused');
  assert.equal(report.frames, 60);
  assert.equal(typeof report.msPerFrame, 'number');
  assert.ok(report.msPerFrame > 0);
});

test('every registered field says whether it is painted from the time', () => {
  for (const name of registries.fields.names()) assert.equal(typeof registries.fields.get(name).animated, 'boolean', name);
  assert.equal(registries.fields.get('mesh').animated, true);
  assert.equal(registries.fields.get('paper').animated, false);
  assert.equal(registries.fields.get('halftone').animated, false);
});

test('the final shot of a film may hold still', async (t) => {
  if (!await needs(t)) return;
  const run = make([filmPath('stillLast'), '--no-render', '--json', '--out', outPath('still-last')]);
  assert.deepEqual(parse(run).findings.filter((f) => /holds still/.test(f.message)), []);
});

// ---- render ----

test('a full run renders an H.264 yuv420p MP4 of the film, one frame per film frame, leaving no temp files', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const run = make([filmPath('gate'), '--json', '--out', outPath('gate')]);
  assert.equal(run.status, 0, run.stderr);
  const report = parse(run);
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline', 'review', 'render']);
  assert.equal(report.capture, 'fast');
  const video = probeVideo(report.output);
  assert.equal(video.codec, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.frames, report.frames);
  assert.ok(Math.abs(video.duration - report.frames / FPS) < 0.05, `duration ${video.duration}`);
  assert.deepEqual([video.width, video.height], [1920, 1080]);
  assert.deepEqual(readdirSync(path.dirname(report.output)).filter((f) => f !== 'sheets' && f !== 'film.mp4'), []);
});

test('a held shot is not re-captured every frame: captured is one per grain pattern, and the MP4 still has every frame', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const run = make([filmPath('held'), '--json', '--out', outPath('held')]);
  assert.equal(run.status, 0, run.stderr);
  const report = parse(run);
  const patterns = new Set(Array.from({ length: report.frames }, (_, i) => Math.floor((i * GRAIN_FPS) / FPS))).size;
  assert.equal(report.frames, 60);
  assert.equal(report.captured, patterns, 'a frame is captured when its picture or its grain pattern changes');
  assert.ok(report.captured < report.frames);
  assert.equal(probeVideo(report.output).frames, report.frames);
});

test('fast and exact renders of the same film are both H.264 yuv420p of the expected duration', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  for (const [flags, capture] of [[[], 'fast'], [['--exact'], 'exact']]) {
    const run = make([filmPath('held'), '--json', ...flags, '--out', outPath(`mode-${capture}`)]);
    assert.equal(run.status, 0, run.stderr);
    const report = parse(run);
    assert.equal(report.capture, capture);
    const video = probeVideo(report.output);
    assert.equal(video.codec, 'h264');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.frames, 60);
    assert.ok(Math.abs(video.duration - 2) < 0.05, `${capture}: duration ${video.duration}`);
  }
});

test('the fast mode reads JPEG frames and scales them to limited range; the exact mode keeps the version 1 arguments', () => {
  const exact = encodeArgs({ fps: FPS, out: 'x.mp4' });
  const fast = jpegInput(exact);
  const input = fast.indexOf('-i');
  assert.deepEqual(fast.slice(fast.indexOf('-c:v') + 1, fast.indexOf('-c:v') + 2), ['mjpeg']);
  assert.deepEqual(fast.slice(input, input + 4), ['-i', '-', '-vf', 'scale=in_range=pc:out_range=tv']);
  assert.ok(fast.includes('libx264') && fast.includes('yuv420p'));
  assert.deepEqual(fast.filter((a) => a !== 'mjpeg' && a !== '-vf' && a !== 'scale=in_range=pc:out_range=tv'), exact.filter((a) => a !== 'png'), 'nothing else changes');
  assert.throws(() => jpegInput(['-i', 'x']), /jpegInput/);
});

test('no ffmpeg exits 2 before anything is captured, saying how to install it', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([filmPath('held'), '--out', outPath('no-ffmpeg')], BARE);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /ffmpeg not found.*brew install ffmpeg/);
  assert.equal(existsSync(outPath('no-ffmpeg')), false);
});

// ---- stopping ----

const until = async (check, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

test('SIGINT during a render leaves no temp files and no browser behind', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const before = headlessPids();
  const out = outPath('sigint');
  const child = spawn(process.execPath, [MAKE, filmPath('long'), '--json', '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  assert.ok(await until(() => /render \d+\/\d+ frames/.test(stderr), 120_000), `the render never started: ${stderr}`);
  const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  child.kill('SIGINT');
  assert.equal(await closed, 130);
  const left = existsSync(path.dirname(out)) ? readdirSync(path.dirname(out)).filter((f) => f !== 'sheets') : [];
  assert.deepEqual(left, [], 'no partial or finished video');
  assert.ok(await until(() => [...headlessPids()].every((pid) => before.has(pid)), 10_000), 'a headless browser is still running');
});

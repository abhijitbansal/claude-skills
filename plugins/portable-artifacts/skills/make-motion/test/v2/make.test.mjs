// scripts/make.mjs, the one command: its flags and exit codes, the --json report, --list, --outline, the review rules
// seen through it, and the render (held frames, both capture modes, a stop in the middle). Tests that need a browser or
// ffmpeg skip without them (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HERE, browserAvailable, ffmpegOrNull, headlessPids, probeVideo } from './helpers/session.mjs';
import { registries } from '../../engine/registry.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { encoderArgs, ENCODER, sweepPartials } from '../../scripts/v2/render.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { formatText } from '../../scripts/v2/report.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import { roundTime, sentencesOf } from '../../scripts/v2/voice/sidecar.mjs';
import { INSTALL_HINT } from '../../scripts/v2/voice/worker.mjs';

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
  assert.match(report.error.message, /did you mean '--outline'/);
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
  assert.deepEqual(Object.keys(report).sort(), [...REPORT_KEYS].sort());
  assert.equal(report.bytes, null); assert.equal(report.mbps, null);
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
  assert.match(lines[1], /^mechanical: shots\[0\]: text "edge" is outside the safe area.* \(at 0\.00 s\)$/);
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
  assert.equal(finding.path, 'shots[0]');
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
  assert.equal(report.bytes, statSync(report.output).size);
  assert.ok(Math.abs(report.mbps - (report.bytes * 8) / (report.frames / FPS) / 1e6) < 1e-9, 'mbps is bytes over the video duration');
  assert.ok(Math.abs(video.duration - report.frames / FPS) < 0.05, `duration ${video.duration}`);
  assert.deepEqual([video.width, video.height], [1920, 1080]);
  assert.deepEqual(readdirSync(path.dirname(report.output)).filter((f) => f !== 'film.sheets' && f !== 'film.mp4'), []);
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

test('the encoder arguments: PNG or JPEG frames from a pipe into H.264 yuv420p at crf 23 with the film tune; JPEG is scaled to limited range', () => {
  const exact = encoderArgs({ fps: FPS, out: 'x.mp4', exact: true });
  const fast = encoderArgs({ fps: FPS, out: 'x.mp4', exact: false });
  const after = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal(exact[exact.indexOf('-c:v') + 1], 'png');
  assert.equal(fast[fast.indexOf('-c:v') + 1], 'mjpeg');
  for (const args of [exact, fast]) {
    assert.equal(after(args, '-crf'), String(ENCODER.crf));
    assert.equal(after(args, '-tune'), 'film');
    assert.equal(after(args, '-pix_fmt'), 'yuv420p');
    assert.equal(args.at(-1), 'x.mp4');
    assert.ok(args.includes('libx264') && args.includes('+faststart'));
  }
  assert.ok(!exact.includes('-vf') && fast.includes('scale=in_range=pc:out_range=tv'));
  assert.deepEqual(ENCODER, { preset: 'medium', crf: 23, tune: 'film' });
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
  let stderr = '', stdout = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  assert.ok(await until(() => /render \d+\/\d+ frames/.test(stderr), 120_000), `the render never started: ${stderr}`);
  const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  child.kill('SIGINT');
  assert.equal(await closed, 130);
  const left = existsSync(path.dirname(out)) ? readdirSync(path.dirname(out)).filter((f) => f !== 'film.sheets') : [];
  assert.deepEqual(left, [], 'no partial or finished video');
  assert.ok(await until(() => [...headlessPids()].every((pid) => before.has(pid)), 10_000), 'a headless browser is still running');
  const report = JSON.parse(stdout);
  assert.deepEqual(Object.keys(report).sort(), [...REPORT_KEYS, 'error'].sort(), 'the same shape, with an error');
  assert.equal(report.error.message, 'interrupted');
  assert.equal(report.ok, false);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['timeline', true], ['review', true], ['render', false]], 'what ran before the stop stays');
  assert.equal(report.sheets.length, 1, 'the sheets already written stay');
});

// ---- the --json contract on every path ----

const REPORT_KEYS = ['audio', 'bytes', 'captured', 'capture', 'findings', 'frames', 'mbps', 'msPerFrame', 'ok', 'output', 'post', 'seconds', 'sheets', 'stages', 'timed', 'voice'];
const shapeOf = (run) => {
  assert.equal(run.stdout.trim().split('\n').length, 1, `one line on stdout, got ${JSON.stringify(run.stdout)}`);
  const report = parse(run);
  assert.deepEqual(Object.keys(report).filter((k) => k !== 'error').sort(), [...REPORT_KEYS].sort());
  return report;
};

test('a missing film file: the full report shape with an error, exit 2', () => {
  const run = make([path.join(dir, 'missing.json'), '--json']);
  assert.equal(run.status, 2);
  const report = shapeOf(run);
  assert.equal(report.ok, false);
  assert.match(report.error.message, /^cannot read .*missing\.json/);
  assert.match(report.error.hint, /existing film/);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', false]]);
});

test('no ffmpeg: the report keeps the stages that ran, and says how to install it', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([filmPath('held'), '--json', '--out', outPath('json-no-ffmpeg')], BARE);
  assert.equal(run.status, 2);
  const report = shapeOf(run);
  assert.equal(report.error.message, 'ffmpeg not found');
  assert.match(report.error.hint, /brew install ffmpeg/);
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline']);
  assert.equal(report.frames, 60, 'the timeline is known');
  assert.equal(report.timed, 'estimated');
});

test('an ffmpeg that exits non-zero: the error carries its words, the sheets and findings stay, nothing is left behind', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const out = outPath('json-ffmpeg-fails');
  const run = make([filmPath('off'), '--json', '--out', out], { FFMPEG_PATH: '/usr/bin/false' });
  assert.equal(run.status, 2, run.stderr);
  const report = shapeOf(run);
  assert.match(report.error.message, /^ffmpeg failed/);
  assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['validate', true], ['timeline', true], ['review', true], ['render', false]]);
  assert.equal(report.sheets.length, 1);
  assert.ok(report.findings.some((f) => f.kind === 'mechanical'), 'the findings already found stay');
  assert.equal(report.ok, false);
  assert.deepEqual(readdirSync(path.dirname(out)).filter((f) => f !== 'film.sheets'), [], 'no partial video');
});

test('an ffmpeg error keeps the last 5 lines ffmpeg said', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const script = path.join(dir, 'noisy-ffmpeg.sh');
  writeFileSync(script, '#!/bin/sh\nfor n in 1 2 3 4 5 6 7 8; do echo "line $n" >&2; done\nexit 1\n', { mode: 0o755 });
  const run = make([filmPath('held'), '--json', '--out', outPath('json-noisy')], { FFMPEG_PATH: script });
  const report = shapeOf(run);
  assert.match(report.error.message, /line 4 \| line 5 \| line 6 \| line 7 \| line 8$/);
  assert.doesNotMatch(report.error.message, /line 3/);
});

test('a usage error under --json is the same shape with an error', () => {
  const report = shapeOf(make([filmPath('gate'), '--fast', '--json']));
  assert.match(report.error.message, /Unknown option '--fast'/);
  assert.match(report.error.hint, /exit codes: 0 ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted/);
});

test('a film the page cannot draw is a finding, not an error: ok false, exit 1, the shape intact', async (t) => {
  if (!await needs(t)) return;
  const film = { version: 2, shots: [{ id: 'bad', show: 'free', hold: 1, nodes: [{ type: 'path', id: 'b', props: { d: 'M0 0H10V10Z', fill: '#fff', blend: 'dodge' } }] }] };
  writeFileSync(path.join(dir, 'throws.json'), JSON.stringify(film));
  const run = make([path.join(dir, 'throws.json'), '--json', '--no-render', '--out', outPath('throws')]);
  assert.equal(run.status, 1, run.stderr);
  const report = shapeOf(run);
  assert.equal(report.error, undefined);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.kind === 'mechanical' && /^page: .*blend must be one of/.test(f.message)), JSON.stringify(report.findings));
});

// ---- where things go ----

test('sheets go to a folder named for the video: films in one folder do not share them, and a stale sheet is removed', async (t) => {
  if (!await needs(t)) return;
  const [one, two] = ['one', 'two'].map((name) => outPath('shared', `${name}.mp4`));
  mkdirSync(path.dirname(one), { recursive: true });
  mkdirSync(`${one.slice(0, -4)}.sheets`, { recursive: true });
  writeFileSync(path.join(`${one.slice(0, -4)}.sheets`, 'stale-shot.png'), 'old');
  writeFileSync(path.join(`${one.slice(0, -4)}.sheets`, 'notes.txt'), 'mine');
  const a = parse(make([filmPath('gate'), '--json', '--no-render', '--out', one]));
  const b = parse(make([filmPath('held'), '--json', '--no-render', '--out', two]));
  assert.deepEqual(a.sheets.map((f) => path.dirname(f)), Array(3).fill(`${one.slice(0, -4)}.sheets`));
  assert.deepEqual(b.sheets.map((f) => path.dirname(f)), [`${two.slice(0, -4)}.sheets`]);
  assert.deepEqual(readdirSync(`${one.slice(0, -4)}.sheets`).sort(), ['cut-hook-rows.png', 'hook.png', 'notes.txt', 'rows.png'], 'the stale png is gone, a file that is not a png is left');
  assert.deepEqual(readdirSync(`${two.slice(0, -4)}.sheets`), ['held.png']);
});

test('paths in the report are as the user gave them: relative stay relative to the current directory', async (t) => {
  if (!await needs(t)) return;
  const run = spawnSync(process.execPath, [MAKE, 'held.json', '--json', '--no-render', '--out', 'rel/held.mp4'], { encoding: 'utf8', cwd: dir });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(parse(run).sheets, [path.join('rel', 'held.sheets', 'held.png')]);
  const absolute = parse(make([filmPath('held'), '--json', '--no-render', '--out', outPath('abs')]));
  assert.ok(path.isAbsolute(absolute.sheets[0]));
});

test('the default output is out/<film name>.mp4 beside the film, and its sheets out/<film name>.sheets', async (t) => {
  if (!await needs(t)) return;
  const run = spawnSync(process.execPath, [MAKE, 'held.json', '--json', '--no-render'], { encoding: 'utf8', cwd: dir });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(parse(run).sheets, [path.join('out', 'held.sheets', 'held.png')]);
});

test('a partial video left by a killed run is swept when older than an hour, and a fresh one is not', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'mm-v2-sweep-'));
  try {
    const old = path.join(folder, '.film.mp4.partial-111.mp4'), fresh = path.join(folder, '.film.mp4.partial-222.mp4'), other = path.join(folder, 'film.mp4');
    for (const file of [old, fresh, other]) writeFileSync(file, 'x');
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(other, longAgo, longAgo);
    assert.deepEqual(sweepPartials(folder), ['.film.mp4.partial-111.mp4']);
    assert.deepEqual(readdirSync(folder).sort(), ['.film.mp4.partial-222.mp4', 'film.mp4']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// ---- a crash nobody caught ----

test('an uncaught exception or a stray rejection winds the run down and the report carries it as its error', async (t) => {
  if (!await needs(t)) return;
  const before = headlessPids();
  for (const [name, code] of [['thrown', "throw new Error('boom thrown')"], ['rejected', "Promise.reject(new Error('boom rejected'))"]]) {
    const hook = path.join(dir, `crash-${name}.mjs`);
    writeFileSync(hook, `setTimeout(() => { ${code}; }, 250);\n`);
    const run = make([filmPath('gate'), '--json', '--no-render', '--out', outPath(`crash-${name}`)], { NODE_OPTIONS: `--import=${pathToFileURL(hook).href}` });
    assert.equal(run.status, 2, `${name}: ${run.stderr}`);
    const report = shapeOf(run);
    assert.equal(report.error.message, `boom ${name}`);
    assert.equal(report.ok, false);
  }
  assert.ok(await until(() => [...headlessPids()].every((pid) => before.has(pid)), 10_000), 'a headless browser is still running');
});

test('a stalled ffmpeg does not hold the first interrupt', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const script = path.join(dir, 'stalled-ffmpeg.sh');
  writeFileSync(script, '#!/bin/sh\nexec sleep 120\n', { mode: 0o755 }); // reads nothing: the pipe fills and a write waits
  const before = headlessPids();
  const child = spawn(process.execPath, [MAKE, filmPath('long'), '--json', '--out', outPath('stalled')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FFMPEG_PATH: script } });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '', stdout = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  assert.ok(await until(() => /render started/.test(stderr), 120_000), `the render never started: ${stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 1500)); // long enough for the pipe to fill and a write to wait
  const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  child.kill('SIGINT');
  const code = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve('still running'), 20_000))]);
  assert.equal(code, 130);
  assert.equal(JSON.parse(stdout).error.message, 'interrupted');
  assert.ok(await until(() => [...headlessPids()].every((pid) => before.has(pid)), 10_000), 'a headless browser is still running');
});

// ---- a voiced film: the voice stage, through runMake with a fake synthesiser ----

const VOICED_SHOTS = [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
];
const FAKE_MODEL = { id: 'fake-model', commit: 'c0ffee', file: 'model.onnx', sha256: 'abc' };
const FAKE_STEP = 0.12;
const FAKE_SPAN = 0.1;
const FAKE_PAD = 0.025;

// The sidecar a synthesiser would return for `film`: word k at k * FAKE_STEP, far quicker than the estimate.
function fakeSidecar(film) {
  const shots = film.shots.map((shot, index) => {
    if (shot.say === undefined) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const { tokens } = parseSay(shot.say);
    const words = tokens.map((t, k) => ({ text: t.text, start: k * FAKE_STEP, end: k * FAKE_STEP + FAKE_SPAN, emphasis: t.emphasis, aside: t.aside }));
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: words.at(-1).end + FAKE_PAD, sentences: sentencesOf(tokens, words) };
  });
  return { version: 1, model: FAKE_MODEL, voice: 'af_heart', sampleRate: 24000, shots };
}

function fakeSynthesiser({ fail = null } = {}) {
  const calls = [];
  const synthesise = async (film, options) => {
    calls.push({ film, options });
    if (fail) throw fail;
    return { dir: path.join(options.outDir, '.voice', 'fake'), sidecar: fakeSidecar(film), cached: false };
  };
  return { synthesise, calls };
}

const writeVoiced = (name, extra = {}, shots = VOICED_SHOTS) => {
  writeFileSync(filmPath(name), JSON.stringify({ version: 2, mode: 'pro', voice: { name: 'af_heart' }, shots, ...extra }));
  return filmPath(name);
};
const runVoiced = (specPath, synthesise, flags = {}) => runMake(
  { specPath, out: outPath(path.basename(specPath, '.json')), exact: false, noRender: true, outline: false, ...flags },
  { synthesise },
);
const stagesOf = (report) => report.stages.map((s) => [s.name, s.ok]);

test('a voiced film runs the voice stage before the timeline and its timeline is measured (no browser: --outline)', async () => {
  const fake = fakeSynthesiser();
  const specPath = writeVoiced('voiced-outline');
  const { report, exitCode, outline } = await runVoiced(specPath, fake.synthesise, { outline: true });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.deepEqual(Object.keys(report).sort(), [...REPORT_KEYS].sort());
  assert.equal(report.timed, 'measured');
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', true], ['timeline', true]]);
  const sidecar = fakeSidecar({ shots: VOICED_SHOTS });
  assert.deepEqual(report.voice, { cached: false, seconds: roundTime(sidecar.shots.reduce((n, s) => n + s.seconds, 0)), model: FAKE_MODEL });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.voice, 'af_heart');
  assert.equal(fake.calls[0].options.outDir, path.dirname(outPath('voiced-outline')), 'the voice cache sits beside the video');
  const measured = Math.ceil((sidecar.shots[0].sentences[0].words.at(-1).end + registries.modes.get('pro').tail) * FPS - 1e-6) / FPS;
  assert.equal(outline[1].start, Math.max(1, measured), 'the second shot starts where the measured first one ends');
});

test('a silent film has no voice stage and reports voice: null', async () => {
  const fake = fakeSynthesiser();
  const { report, exitCode } = await runVoiced(filmPath('gate'), fake.synthesise, { outline: true });
  assert.equal(exitCode, 0);
  assert.equal(report.voice, null);
  assert.equal(report.timed, 'estimated');
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true]]);
  assert.equal(fake.calls.length, 0);
});

test('make --no-render on a voiced film with a fake synthesiser reports timed: "measured"', async (t) => {
  if (!await needs(t)) return;
  const fake = fakeSynthesiser();
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-review'), fake.synthesise);
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.ok, true);
  assert.equal(report.timed, 'measured');
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'voice', 'timeline', 'review']);
  assert.equal(report.output, null);
});

test('a synthesiser that throws the install hint is exit 2, ok false, with the hint; nothing after the voice stage runs', async () => {
  const fake = fakeSynthesiser({ fail: new Error(INSTALL_HINT) });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-missing'), fake.synthesise);
  assert.equal(exitCode, 2);
  assert.equal(report.ok, false);
  assert.equal(report.error.message, 'the optional voice package is not installed');
  assert.match(report.error.hint, /^Run: .+/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', false]]);
  assert.equal(report.timed, null, 'no silent fall back to estimated times');
  assert.equal(report.voice, null);
  assert.equal(report.output, null);
  assert.deepEqual(report.findings, []);
});

test('a voice that times out is exit 2 with a hint', async () => {
  const timedOut = Object.assign(new Error('the voice worker did not finish within 600 s and was killed'), { timedOut: true });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-timeout'), fakeSynthesiser({ fail: timedOut }).synthesise);
  assert.equal(exitCode, 2);
  assert.equal(report.error.message, 'the voice worker did not finish within 600 s and was killed');
  assert.match(report.error.hint, /run again/);
});

const synthError = (message, fields) => Object.assign(new Error(message), { name: 'VoiceSynthError', ...fields });

test('a voice error of kind machine is exit 2 and carries its own hint', async () => {
  const fail = synthError('the voice model could not be fetched', { kind: 'machine', hint: 'check the network, or copy the model files in by hand' });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-machine'), fakeSynthesiser({ fail }).synthesise);
  assert.equal(exitCode, 2);
  assert.equal(report.ok, false);
  assert.deepEqual(report.error, { message: 'the voice model could not be fetched', hint: 'check the network, or copy the model files in by hand' });
  assert.deepEqual(report.findings, []);
});

test('a voice error of kind film that names a shot is an invalid film at that shot\'s say: exit 1', async () => {
  const fail = synthError('shot "rows": narration of 600 tokens in one clause, over the 512 the voice takes', { kind: 'film', hint: 'split the sentence' });
  const { report, exitCode } = await runVoiced(writeVoiced('voiced-film-error'), fakeSynthesiser({ fail }).synthesise);
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.equal(report.ok, false);
  assert.equal(report.error, undefined, 'the film\'s fault is a finding, not a machine error');
  assert.deepEqual(report.findings, [{
    kind: 'mechanical', shot: null, path: 'shots[1].say',
    message: 'shot "rows": narration of 600 tokens in one clause, over the 512 the voice takes; split the sentence',
  }]);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', false]]);
  assert.equal(report.timed, null);
});

test('a voice error of kind film that names a shot by its shot field, or none, finds its path; a timeout is machine trouble', async () => {
  const byField = synthError('the narration has a character the voice cannot say', { kind: 'film', hint: '', shot: 'hook' });
  const named = await runVoiced(writeVoiced('voiced-film-field'), fakeSynthesiser({ fail: byField }).synthesise);
  assert.equal(named.exitCode, 1);
  assert.deepEqual(named.report.findings.map((f) => [f.path, f.message]), [['shots[0].say', 'the narration has a character the voice cannot say']]);
  const filmWide = synthError('the film has no narration to voice', { kind: 'film' });
  const wide = await runVoiced(writeVoiced('voiced-film-wide'), fakeSynthesiser({ fail: filmWide }).synthesise);
  assert.equal(wide.exitCode, 1);
  assert.deepEqual(wide.report.findings.map((f) => f.path), ['voice']);
  const timedOut = synthError('the voice worker did not finish within 600 s and was killed', { kind: 'film', timedOut: true });
  assert.equal((await runVoiced(writeVoiced('voiced-film-timeout'), fakeSynthesiser({ fail: timedOut }).synthesise)).exitCode, 2);
});

test('a voice from your own recording ({ src, words }) is not built yet: exit 2, and the synthesiser is not called', async () => {
  const fake = fakeSynthesiser();
  const specPath = writeVoiced('voiced-own', { voice: { src: 'vo.wav', words: 'vo.json' } });
  const { report, exitCode } = await runVoiced(specPath, fake.synthesise);
  assert.equal(exitCode, 2);
  assert.equal(report.ok, false);
  assert.match(report.error.message, /own recording .*is not built yet/);
  assert.match(report.error.hint, /"name": "af_heart"/);
  assert.equal(fake.calls.length, 0);
});

test('an anchor valid on estimated times but outside its shot on measured ones is an invalid film: exit 1, path form', async () => {
  const say = 'Every row has a source, and every source has a file.';
  const estimated = buildTimeline({ mode: 'pro', shots: [{ id: 'hook', say }] }, { fps: FPS }).shots[0].duration;
  const at = Math.round((estimated - 0.1) * 100) / 100;
  const shots = [{ id: 'hook', show: 'statement', say, on: [{ at, do: 'underline', target: 'text' }] }];
  const specPath = writeVoiced('voiced-late', {}, shots);
  const { report, exitCode } = await runVoiced(specPath, fakeSynthesiser().synthesise);
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'shots[0].on[0].at']]);
  assert.match(report.findings[0].message, /outside the shot/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['voice', true], ['timeline', false]]);
  assert.equal(report.output, null);
  assert.equal(formatText(report, { sheetsDir: null }).split('\n')[0], 'invalid');
});

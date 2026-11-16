// The provenance stamp (scripts/v2/stamp.mjs): the MP4's comment and artist tags, from the film's generatedBy and the
// --model, --effort and --agent flags, left out with --no-provenance or root provenance: false. The render tests need a
// browser, ffmpeg and ffprobe and skip without them (PA_REQUIRE_BROWSER=1 makes that a failure). Run with
// --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { stampArgs, stampTags, withStamp } from '../../scripts/v2/stamp.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import '../../scripts/v2/list.mjs'; // registers the kinds, as make.mjs does
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { UsageError } from '../../shared/cli.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const DATE = new Date(Date.UTC(2026, 10, 16));
const FULL = { model: 'claude-opus-5-5', effort: 'high', agent: 'Claude Code' };
const STILL = (id) => ({ id, show: 'free', hold: 1, background: '#f3eee3', nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] });

// ---- stampArgs, pure ----

test('a full generatedBy gives the comment line and the model as artist, each one argument after -metadata', () => {
  const args = stampArgs({ generatedBy: FULL, date: DATE });
  assert.deepEqual(args, [
    '-metadata', 'comment=make-motion · claude-opus-5-5 · high effort · Claude Code · 16 Nov 2026',
    '-metadata', 'artist=claude-opus-5-5',
  ]);
});

test('a partial generatedBy says "not reported" for what is missing, and no artist without a model', () => {
  assert.deepEqual(stampArgs({ generatedBy: { agent: 'Codex' }, date: DATE }), [
    '-metadata', 'comment=make-motion · model not reported · effort not reported · Codex · 16 Nov 2026',
  ]);
});

test('no generatedBy still stamps the skill and "not reported"', () => {
  assert.deepEqual(stampArgs({ date: DATE }), ['-metadata', 'comment=make-motion · model not reported · effort not reported · agent not reported · 16 Nov 2026']);
});

test('provenance: false, or the --no-provenance flag, stamps nothing', () => {
  assert.deepEqual(stampArgs({ generatedBy: FULL, provenance: false, date: DATE }), []);
  assert.deepEqual(stampArgs({ generatedBy: FULL, flags: { noProvenance: true }, date: DATE }), []);
  assert.deepEqual(stampTags({ generatedBy: FULL, provenance: false, date: DATE }), { comment: null, artist: null });
});

test('a flag overrides its own field and leaves the others', () => {
  const tags = stampTags({ generatedBy: FULL, flags: { effort: 'low' }, date: DATE });
  assert.equal(tags.comment, 'make-motion · claude-opus-5-5 · low effort · Claude Code · 16 Nov 2026');
  assert.equal(tags.artist, 'claude-opus-5-5');
  assert.equal(stampTags({ generatedBy: FULL, flags: { model: 'other' }, date: DATE }).artist, 'other');
});

test('a value holding a quote, a newline or = arrives as one argument, unchanged', () => {
  const model = 'a"b\nc=d';
  const args = stampArgs({ generatedBy: { model }, date: DATE });
  assert.equal(args.length, 4);
  assert.equal(args[3], `artist=${model}`);
  assert.ok(args[1].includes(model));
});

test('the input objects are not mutated', () => {
  const generatedBy = { ...FULL };
  const flags = { model: 'x' };
  stampArgs({ generatedBy, flags, date: DATE });
  assert.deepEqual(generatedBy, FULL);
  assert.deepEqual(flags, { model: 'x' });
});

test('withStamp puts the stamp just before the output path, in a new array', () => {
  const args = ['-i', 'a.mp4', '-c', 'copy', 'out.mp4'];
  assert.deepEqual(withStamp(args, ['-metadata', 'comment=x']), ['-i', 'a.mp4', '-c', 'copy', '-metadata', 'comment=x', 'out.mp4']);
  assert.deepEqual(args, ['-i', 'a.mp4', '-c', 'copy', 'out.mp4']);
  assert.equal(withStamp(args, []), args);
});

// ---- the flags and the film field ----

test('--model, --effort and --agent are parsed; --no-provenance too', () => {
  const options = parseMakeArgs(['f.json', '--model', 'm', '--effort', 'e', '--agent', 'a']);
  assert.deepEqual(options.provenance, { model: 'm', effort: 'e', agent: 'a', noProvenance: false });
  assert.equal(parseMakeArgs(['f.json', '--no-provenance']).provenance.noProvenance, true);
});

test('--no-provenance with any of --model, --effort or --agent is a usage error', () => {
  for (const flag of ['--model', '--effort', '--agent']) {
    assert.throws(() => parseMakeArgs(['f.json', '--no-provenance', flag, 'x']), (err) => err instanceof UsageError && /--no-provenance/.test(err.message));
  }
});

test('a flag value outside the generatedBy pattern is a usage error, as it would be in the film', () => {
  assert.throws(() => parseMakeArgs(['f.json', '--model', 'a\nb']), (err) => err instanceof UsageError && /--model/.test(err.message));
  assert.throws(() => parseMakeArgs(['f.json', '--agent', 'x'.repeat(61)]), UsageError);
});

test('root provenance takes a boolean and nothing else', () => {
  assert.equal(validateFilm({ version: 2, provenance: false, shots: [STILL('a')] }, { specDir: HERE }).ok, true);
  const bad = validateFilm({ version: 2, provenance: 'no', shots: [STILL('a')] }, { specDir: HERE });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === 'provenance'), JSON.stringify(bad.errors));
});

// ---- rendered: the tags in the file ----

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-stamp-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 240_000, env: { ...process.env, SOURCE_DATE_EPOCH: '1794787200' } });
const formatTags = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout).format.tags ?? {};
const videoHash = (ffmpeg, file) => spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).stdout.trim();

async function needs(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return null; }
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg) { t.skip('no ffmpeg'); return null; }
  if (spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return null; }
  return ffmpeg;
}

test('a silent film: stamped, the tags are in the file and the report; --no-provenance has neither; the video packets match', async (t) => {
  const ffmpeg = await needs(t);
  if (!ffmpeg) return;
  const film = writeFilm('silent', { version: 2, generatedBy: { model: 'claude-opus-5-5', agent: 'Claude Code' }, shots: [STILL('a'), STILL('b')] });
  const stamped = path.join(dir, 'stamped.mp4');
  const bare = path.join(dir, 'bare.mp4');
  const one = make([film, '--out', stamped, '--json', '--exact', '--effort', 'high']);
  assert.equal(one.status, 0, one.stderr);
  const two = make([film, '--out', bare, '--json', '--exact', '--no-provenance']);
  assert.equal(two.status, 0, two.stderr);
  const comment = 'make-motion · claude-opus-5-5 · high effort · Claude Code · 16 Nov 2026';
  assert.equal(formatTags(stamped).comment, comment);
  assert.equal(formatTags(stamped).artist, 'claude-opus-5-5');
  assert.deepEqual(JSON.parse(one.stdout).provenance, { comment, artist: 'claude-opus-5-5' });
  assert.equal(formatTags(bare).comment, undefined);
  assert.equal(formatTags(bare).artist, undefined);
  assert.deepEqual(JSON.parse(two.stdout).provenance, { comment: null, artist: null });
  assert.equal(videoHash(ffmpeg, stamped), videoHash(ffmpeg, bare), 'the stamp touches the container only');
});

test('a film with sound is stamped at the mux; root provenance: false leaves both tags out', async (t) => {
  const ffmpeg = await needs(t);
  if (!ffmpeg) return;
  const shots = [STILL('a'), STILL('b')];
  const music = { bed: 'drift', bpm: 92 };
  const on = path.join(dir, 'sound-on.mp4');
  const off = path.join(dir, 'sound-off.mp4');
  const first = make([writeFilm('sound', { version: 2, music, shots }), '--out', on, '--json', '--model', 'm1']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(formatTags(on).artist, 'm1');
  assert.match(formatTags(on).comment, /^make-motion · m1 · effort not reported · agent not reported · /);
  const second = make([writeFilm('sound-off', { version: 2, music, provenance: false, generatedBy: { model: 'm1' }, shots }), '--out', off, '--json']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(formatTags(off).comment, undefined);
  assert.equal(formatTags(off).artist, undefined);
});

test('no path, user name or host name reaches the tags', async (t) => {
  const ffmpeg = await needs(t);
  if (!ffmpeg) return;
  const out = path.join(dir, 'leak.mp4');
  const run = make([writeFilm('leak', { version: 2, shots: [STILL('a')] }), '--out', out, '--json']);
  assert.equal(run.status, 0, run.stderr);
  const text = JSON.stringify(formatTags(out));
  for (const secret of [dir, path.basename(dir), process.env.USER, (await import('node:os')).hostname()].filter(Boolean)) {
    assert.ok(!text.includes(secret), `${secret} leaked into ${text}`);
  }
});

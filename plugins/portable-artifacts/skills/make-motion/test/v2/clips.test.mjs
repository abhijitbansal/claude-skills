// Video clips in `media` (scripts/v2/clips.mjs, the media kind): the file contained in the film's folder, probed before
// use against the allow-lists, decoded once by ffmpeg at the film's fps (deterministic), its audio placed at the shot, and
// the kind's validation of a clip's fields. Tests that need ffmpeg skip without it.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import '../../scripts/v2/list.mjs';
import { validateFilm, SpecError } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { isClipSrc, probeClip, clipProblem, prepareClips, clipAudioTracks, clipFrameIndex } from '../../scripts/v2/clips.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIP = path.resolve(HERE, '../../references/examples/v2/media-clip.mp4');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const shotOf = (extra) => ({ id: 'reel', show: 'media', src: 'clip.mp4', hold: 1, ...extra });
const filmOf = (...shots) => ({ version: 2, fps: 30, look: 'desk', shots });

let dir, work;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-clips-'));
  work = mkdtempSync(path.join(tmpdir(), 'mm-clips-work-'));
  copyFileSync(CLIP, path.join(dir, 'clip.mp4'));
  if (hasFfmpeg) {
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'mute.mp4')]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=2', path.join(dir, 'tone.wav')]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, 'silent.mp4')]);
  }
  copyFileSync(path.join(dir, 'clip.mp4'), path.join(dir, 'tone-named.mp4'));
  writeFileSync(path.join(dir, 'concat.mp4'), "ffconcat version 1.0\nfile '/etc/hosts'\n");
  mkdirSync(path.join(dir, 'inner'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const prepared = (film, sub = 'w', extra = {}) => prepareClips({ film, specDir: dir, timeline: buildTimeline(film, { fps: film.fps }), cacheDir: extra.cacheDir ?? mkdtempSync(path.join(work, sub)), canvas: { w: 1920, h: 1080 }, ...extra });

test('the frames are cached beside the voice cache: a second run reuses them, new trims or a changed file never do, and the cache is bounded', { skip: !hasFfmpeg }, async () => {
  const cacheDir = mkdtempSync(path.join(work, 'cache-'));
  const film = filmOf(shotOf({ in: 0.5, out: 1.5 }));
  const [first] = await prepared(film, 'x', { cacheDir });
  const [again] = await prepared(film, 'x', { cacheDir });
  assert.deepEqual([first.cached, again.cached, again.dir], [false, true, first.dir]);
  const [trimmed] = await prepared(filmOf(shotOf({ in: 0.5, out: 2 })), 'x', { cacheDir });
  assert.notEqual(trimmed.dir, first.dir, 'new trims, new frames');
  copyFileSync(path.join(dir, 'mute.mp4'), path.join(dir, 'swap.mp4'));
  const [before] = await prepared(filmOf(shotOf({ src: 'swap.mp4', out: 1 })), 'x', { cacheDir });
  copyFileSync(path.join(dir, 'silent.mp4'), path.join(dir, 'swap.mp4'));
  const [after] = await prepared(filmOf(shotOf({ src: 'swap.mp4', out: 1 })), 'x', { cacheDir });
  assert.equal(after.cached, false, 'a changed file under the same name is decoded again');
  assert.notEqual(after.dir, before.dir);
  const [bounded] = await prepared(film, 'x', { cacheDir, maxCacheBytes: 1 });
  assert.deepEqual(readdirSync(cacheDir).filter((f) => !f.startsWith('.')), [path.basename(bounded.dir)], 'only the entry in use is kept over the bound');
});

test('a clip src is one of the clip containers by its extension', () => {
  assert.deepEqual(['a.mp4', 'b.MOV', 'c.webm', 'd.mkv', 'e.m4v', 'f.png', 'g.avi'].map(isClipSrc), [true, true, true, true, true, false, false]);
});

test('the media kind takes a clip with in, out and muted; a still refuses them; a treatment on a clip is refused', () => {
  assert.equal(validateFilm(filmOf(shotOf({ in: 0.5, out: 2, muted: true })), { specDir: dir }).ok, true);
  const problems = (shot) => validateFilm(filmOf(shot), { specDir: dir }).errors.map((e) => e.path);
  assert.deepEqual(problems(shotOf({ in: 2, out: 1 })), ['shots[0].out']);
  assert.deepEqual(problems({ id: 's', show: 'media', src: 'photo.png', in: 1, hold: 1 }).filter((p) => p !== 'shots[0].src'), ['shots[0].in']);
  assert.deepEqual(problems(shotOf({ treatment: 'duotone' })), ['shots[0].treatment']);
  const avi = validateFilm(filmOf(shotOf({ src: 'clip.avi' })), { specDir: dir }).errors;
  assert.ok(avi.some((e) => e.path === 'shots[0].src' && /or a clip \(mp4, mov, m4v, webm, mkv\)/.test(e.message)), JSON.stringify(avi));
});

test('probe: an H.264 clip with one audio stream passes; audio, a concat script and a PNG named .mp4 are refused', { skip: !hasFfmpeg }, async () => {
  const ok = await probeClip({ file: path.join(dir, 'clip.mp4') });
  assert.equal(clipProblem(ok), null);
  assert.deepEqual([ok.width, ok.height, ok.audio, Math.round(ok.duration)], [640, 360, true, 4]);
  copyFileSync(path.join(dir, 'tone.wav'), path.join(dir, 'tone.mp4'));
  assert.match(clipProblem(await probeClip({ file: path.join(dir, 'tone.mp4') })), /not on the list|no video stream/);
  assert.match(clipProblem(await probeClip({ file: path.join(dir, 'concat.mp4') })), /not on the list|cannot be read/);
});

test('a clip outside the film\'s folder, or a link that leads out, is refused at its src', { skip: !hasFfmpeg }, async () => {
  symlinkSync(CLIP, path.join(dir, 'inner', 'away.mp4'));
  const outside = filmOf(shotOf({ src: 'inner/away.mp4' }));
  await assert.rejects(prepared(outside, 'a'), (err) => err instanceof SpecError && err.errors[0].path === 'shots[0].src');
});

test('in or out past the clip\'s end is the film\'s error at that field', { skip: !hasFfmpeg }, async () => {
  await assert.rejects(prepared(filmOf(shotOf({ in: 3, out: 9 })), 'b'), (err) => err instanceof SpecError && err.errors[0].path === 'shots[0].out' && /4\.0 s/.test(err.errors[0].message));
  await assert.rejects(prepared(filmOf(shotOf({ in: 5 })), 'c'), (err) => err.errors?.[0].path === 'shots[0].in');
});

test('decode: the used range at the film\'s fps, once per file, the same bytes every time', { skip: !hasFfmpeg }, async () => {
  const film = filmOf(shotOf({ in: 0.5, out: 1.5 }), shotOf({ id: 'again', in: 1, out: 2 }));
  const one = await prepared(film, 'd');
  assert.equal(one.length, 1, 'one decode for one file');
  assert.deepEqual([one[0].from, one[0].count, one[0].width, one[0].height], [0.5, 45, 640, 360]);
  const two = await prepared(film, 'e');
  const files = readdirSync(one[0].dir).filter((f) => f.endsWith('.png')).sort();
  assert.equal(files.length, 45);
  for (const f of files) assert.ok(readFileSync(path.join(one[0].dir, f)).equals(readFileSync(path.join(two[0].dir, f))), f);
});

test('clipFrameIndex: the shot\'s time at the film\'s fps from its in, held on the last frame', () => {
  const clip = { from: 0.5, fps: 30, count: 45 };
  assert.equal(clipFrameIndex(clip, { in: 0.5 }, 0), 0);
  assert.equal(clipFrameIndex(clip, { in: 1 }, 0), 15);
  assert.equal(clipFrameIndex(clip, { in: 1 }, 10 / 30), 25);
  assert.equal(clipFrameIndex(clip, { in: 1 }, 5), 44);
});

test('clip audio: one track at the shot\'s start for a clip with sound; none when muted, silent or without audio', { skip: !hasFfmpeg }, async () => {
  const film = filmOf(shotOf({ id: 'a', in: 1, out: 2 }), shotOf({ id: 'b', muted: true }), shotOf({ id: 'c', src: 'mute.mp4' }), shotOf({ id: 'd', src: 'silent.mp4' }));
  const timeline = buildTimeline(film, { fps: 30 });
  const out = mkdtempSync(path.join(work, 'f'));
  const clips = await prepareClips({ film, specDir: dir, timeline, cacheDir: out, canvas: { w: 1920, h: 1080 } });
  const tracks = await clipAudioTracks({ clips, film, timeline, work: out });
  assert.equal(tracks.length, 1);
  assert.deepEqual([tracks[0].at, tracks[0].recording, tracks[0].fadeFrom], [0, true, null]);
  const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tracks[0].file], { encoding: 'utf8' }).stdout);
  assert.ok(Math.abs(seconds - 1) < 0.03, `the shot's length of sound, got ${seconds}`);
});

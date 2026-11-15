// The framemd5 diagnostics fire on an altered MP4 (PA-42): a guardrail is only trusted once it has been shown failing.
// No browser: the two MP4s are made with ffmpeg's own test sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from '../scripts/lib/ffmpeg.mjs';
import { assertSameRender, differingPngFrames, firstDifferingFrame, framemd5Of } from './helpers/framemd5.mjs';

const ffmpeg = await findFfmpeg().catch(() => null);
const NEEDS_FFMPEG = { skip: ffmpeg ? false : 'no ffmpeg' };

const dir = mkdtempSync(path.join(tmpdir(), 'fm-'));
// Four frames; `altered` changes only the colour of frames after the second one, so frames 0 and 1 match.
function clip(name, filter) {
  const out = path.join(dir, name);
  const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x224466:size=64x36:rate=10:duration=0.4', '-vf', filter, '-pix_fmt', 'yuv420p', '-y', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { out, sha256: createHash('sha256').update(readFileSync(out)).digest('hex') };
}

test('firstDifferingFrame names the first differing line, a count difference, or -1', () => {
  const a = '#h\n0, 0, 0, 1, 10, aaa\n0, 1, 1, 1, 10, bbb\n';
  assert.equal(firstDifferingFrame(a, a), -1);
  assert.equal(firstDifferingFrame(a, a.replace('bbb', 'ccc')), 1);
  assert.equal(firstDifferingFrame(a, '#h\n0, 0, 0, 1, 10, aaa\n'), 1);
});

test('framemd5Of lists one line per frame', NEEDS_FFMPEG, () => {
  const lines = framemd5Of(ffmpeg, clip('a.mp4', 'null').out).split('\n').filter((l) => l && !l.startsWith('#'));
  assert.equal(lines.length, 4);
});

test('assertSameRender passes silently for the same bytes and writes nothing', NEEDS_FFMPEG, () => {
  const a = clip('same.mp4', 'null');
  const out = path.join(dir, 'quiet');
  assertSameRender(a, a, { ffmpeg, label: 'same', dir: out });
  assert.equal(existsSync(out), false);
});

test('assertSameRender on an altered MP4 dumps both framemd5 files and names the first differing frame', NEEDS_FFMPEG, () => {
  const plain = clip('plain.mp4', 'null');
  const altered = clip('altered.mp4', "geq=lum='if(gte(N,2),255,lum(X,Y))':cb='cb(X,Y)':cr='cr(X,Y)'");
  assert.notEqual(altered.sha256, plain.sha256, 'the altered clip differs');
  const out = path.join(dir, 'dumps');
  assert.throws(() => assertSameRender(plain, altered, { ffmpeg, label: 'push loop / 1', dir: out }), (e) => {
    assert.match(e.message, /not byte-identical/);
    assert.match(e.message, /the first decoded frame that differs is 2 \(approximate:/);
    return true;
  });
  for (const file of ['push_loop_1-first.framemd5', 'push_loop_1-second.framemd5']) {
    assert.ok(existsSync(path.join(out, file)), `${file} is written`);
  }
  assert.match(readFileSync(path.join(out, 'push_loop_1-second.framemd5'), 'utf8'), /^0,\s+0,\s+0,\s+1,\s+\d+,\s+[0-9a-f]{32}$/m);
});

// Stand-ins for the PNG folders render writes under PA_KEEP_FRAMES: <frame>.png, one file per frame.
function pngFolder(name, bodies) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  bodies.forEach((body, i) => writeFileSync(path.join(folder, `${i}.png`), body));
  return folder;
}

test('differingPngFrames names the frames whose PNG bytes differ, and a frame only one side has', () => {
  const a = pngFolder('png-a', ['f0', 'f1', 'f2']);
  assert.deepEqual(differingPngFrames(a, pngFolder('png-same', ['f0', 'f1', 'f2'])), []);
  assert.deepEqual(differingPngFrames(a, pngFolder('png-b', ['f0', 'F1', 'f2'])), [1]);
  assert.deepEqual(differingPngFrames(a, pngFolder('png-short', ['f0', 'f1'])), [2]);
});

test('assertSameRender with kept PNGs names the captured frames that differ and copies both PNGs of each', NEEDS_FFMPEG, () => {
  const plain = { ...clip('plain-k.mp4', 'null'), frames: pngFolder('k-first', ['f0', 'f1', 'f2', 'f3']) };
  const altered = { ...clip('altered-k.mp4', "geq=lum='if(gte(N,2),255,lum(X,Y))':cb='cb(X,Y)':cr='cr(X,Y)'"), frames: pngFolder('k-second', ['f0', 'f1', 'F2', 'F3']) };
  const out = path.join(dir, 'dumps-k');
  assert.throws(() => assertSameRender(plain, altered, { ffmpeg, label: 'blur', dir: out }), (e) => {
    assert.match(e.message, /the captured PNGs differ at frames 2, 3 \(exact, before the encode\); copies:/);
    return true;
  });
  assert.equal(readFileSync(path.join(out, 'blur-first-2.png'), 'utf8'), 'f2');
  assert.equal(readFileSync(path.join(out, 'blur-second-3.png'), 'utf8'), 'F3');
  assert.equal(existsSync(path.join(out, 'blur-first-1.png')), false, 'a frame that matches is not copied');
});

test('assertSameRender with kept PNGs that all match says the difference is in the encode', NEEDS_FFMPEG, () => {
  const frames = ['f0', 'f1', 'f2', 'f3'];
  const plain = { ...clip('plain-e.mp4', 'null'), frames: pngFolder('e-first', frames) };
  const altered = { ...clip('altered-e.mp4', "geq=lum='if(gte(N,2),255,lum(X,Y))':cb='cb(X,Y)':cr='cr(X,Y)'"), frames: pngFolder('e-second', frames) };
  assert.throws(() => assertSameRender(plain, altered, { ffmpeg, label: 'enc', dir: path.join(dir, 'dumps-e') }), /every captured PNG matches, so the difference is in the encode/);
});

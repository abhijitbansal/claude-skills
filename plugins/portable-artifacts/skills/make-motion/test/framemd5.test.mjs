// The framemd5 diagnostics fire on an altered MP4 (PA-42): a guardrail is only trusted once it has been shown failing.
// No browser: the two MP4s are made with ffmpeg's own test sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg } from '../scripts/lib/ffmpeg.mjs';
import { assertSameRender, firstDifferingFrame, framemd5Of } from './helpers/framemd5.mjs';

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
    assert.match(e.message, /the first frame that differs is 2;/);
    return true;
  });
  for (const file of ['push_loop_1-first.framemd5', 'push_loop_1-second.framemd5']) {
    assert.ok(existsSync(path.join(out, file)), `${file} is written`);
  }
  assert.match(readFileSync(path.join(out, 'push_loop_1-second.framemd5'), 'utf8'), /^0,\s+0,\s+0,\s+1,\s+\d+,\s+[0-9a-f]{32}$/m);
});

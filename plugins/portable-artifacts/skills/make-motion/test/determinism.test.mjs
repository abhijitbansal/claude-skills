import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, renderHash, assertRendersIdentically, makeTestVideo } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/q3-revenue.json');
const NEED_ALL = { need: ['browser', 'ffmpeg', 'ffprobe'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayStamp = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

const commentTag = (ffprobe, file) => JSON.parse(spawnSync(ffprobe,
  ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'json', file], { encoding: 'utf8' }).stdout).format.tags.comment;

test('q3-revenue renders byte-identical twice at 320x180 / 10 fps', async (t) => {
  if (!await requireRender(t)) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

test('without SOURCE_DATE_EPOCH the comment tag carries today, with it 30 Oct 2026', async (t) => {
  const tools = await requireRender(t, NEED_ALL);
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'det-'));
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [] }] }));
  const args = ['--fps', '10', '--size', '160x90'];
  const before = dayStamp(new Date());
  const dated = await renderHash(spec, args, { env: { SOURCE_DATE_EPOCH: '' } });
  const pinned = await renderHash(spec, args);
  const after = dayStamp(new Date());
  const today = commentTag(tools.ffprobe, dated.out);
  assert.ok(today.endsWith(before) || today.endsWith(after), `dated comment "${today}" should end in ${before} or ${after}`);
  assert.ok(commentTag(tools.ffprobe, pinned.out).endsWith('30 Oct 2026'), 'pinned comment should end in 30 Oct 2026');
});

test('makeTestVideo writes a video, with an audio stream only when asked', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'mtv-'));
  const streams = (file) => JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames',
    '-of', 'json', file], { encoding: 'utf8' }).stdout).streams;
  const silent = path.join(dir, 'a.mp4');
  makeTestVideo(tools.ffmpeg, silent);
  assert.deepEqual(streams(silent).map((s) => s.codec_type), ['video']);
  assert.equal(streams(silent)[0].width, 320);
  assert.equal(Number(streams(silent)[0].nb_frames), 20, '2 s at 10 fps');
  const withAudio = path.join(dir, 'b.mp4');
  makeTestVideo(tools.ffmpeg, withAudio, { seconds: 1, source: 'smptebars', audio: true });
  assert.deepEqual(streams(withAudio).map((s) => s.codec_type).sort(), ['audio', 'video']);
});

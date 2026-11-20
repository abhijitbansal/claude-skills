// ensurePinnedFile: the one download-and-verify routine behind the cutout weights and the Kokoro model files.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensurePinnedFile } from '../scripts/lib/pinned-file.mjs';

const made = [];
const tmp = (prefix) => { const d = mkdtempSync(path.join(tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const BYTES = Buffer.from('pinned bytes');
const URL_ = 'https://example.invalid/f.bin';
const opts = (dir, fetchImpl) => ({ url: URL_, sha256: sha256(BYTES), bytes: BYTES.length, file: path.join(dir, 'sub', 'f.bin'), label: 'test file', fetchImpl });
const answer = (body, init = {}) => async () => new Response(body, { status: 200, ...init });

test('downloads once into a new folder, verifies, and never fetches again while the file is good', async () => {
  const dir = tmp('pinned-file-');
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.equal(url, URL_); return new Response(BYTES); };
  const file = await ensurePinnedFile(opts(dir, fetchImpl));
  assert.equal(file, path.join(dir, 'sub', 'f.bin'));
  assert.deepEqual(readFileSync(file), BYTES);
  assert.equal(await ensurePinnedFile(opts(dir, fetchImpl)), file);
  assert.equal(calls, 1);
  assert.deepEqual(readdirSync(path.join(dir, 'sub')), ['f.bin']);
});

test('keeps nothing on a sha256 mismatch and names both hashes', async () => {
  const dir = tmp('pinned-file-');
  const o = opts(dir, answer('x'.repeat(BYTES.length)));
  await assert.rejects(() => ensurePinnedFile(o), /sha256 mismatch for the test file from https:\/\/example\.invalid\/f\.bin: expected [0-9a-f]{64}, got [0-9a-f]{64}; nothing was kept/);
  assert.equal(existsSync(o.file), false);
});

test('replaces a truncated file and ignores a stray partial', async () => {
  const dir = tmp('pinned-file-');
  const o = opts(dir, answer(BYTES));
  mkdirSync(path.dirname(o.file), { recursive: true });
  writeFileSync(o.file, BYTES.subarray(0, 4));
  writeFileSync(`${o.file}.partial-999-abcd`, 'junk');
  const file = await ensurePinnedFile(o);
  assert.deepEqual(readFileSync(file), BYTES);
});

test('offline: a fetch that throws names the URL and keeps nothing', async () => {
  const dir = tmp('pinned-file-');
  const o = opts(dir, async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => ensurePinnedFile(o), /test file download failed: fetch failed \(https:\/\/example\.invalid\/f\.bin\); check the connection and rerun/);
  assert.equal(existsSync(o.file), false);
});

test('refuses an HTTP error and a body over twice the expected size', async () => {
  const dir = tmp('pinned-file-');
  await assert.rejects(() => ensurePinnedFile(opts(dir, async () => new Response('no', { status: 503 }))), /test file download failed: HTTP 503 from/);
  await assert.rejects(() => ensurePinnedFile(opts(dir, answer(Buffer.alloc(BYTES.length * 3)))), /larger than the expected 12 bytes/);
  assert.equal(existsSync(path.join(dir, 'sub', 'f.bin')), false);
});

test('logs one line before a download and none when the file is already good', async () => {
  const dir = tmp('pinned-file-');
  const lines = [];
  const o = { ...opts(dir, answer(BYTES)), log: (l) => lines.push(l) };
  await ensurePinnedFile(o);
  await ensurePinnedFile(o);
  assert.deepEqual(lines, ['downloading the test file (1 KB, once) from https://example.invalid/f.bin']);
});

test('the size in the log line is KB under 1 MB and MB from there up', async () => {
  const sizes = async (bytes) => {
    const lines = [];
    await ensurePinnedFile({ ...opts(tmp('pinned-file-'), answer(BYTES)), bytes, log: (l) => lines.push(l) });
    return /\((.*?), once\)/.exec(lines[0])[1];
  };
  assert.equal(await sizes(44), '1 KB');
  assert.equal(await sizes(500_000), '500 KB');
  assert.equal(await sizes(25_888_640), '26 MB');
});

test('a response with no body is a labelled error, and nothing is kept', async () => {
  const dir = tmp('pinned-file-');
  const o = opts(dir, async () => new Response(null, { status: 200 }));
  await assert.rejects(() => ensurePinnedFile(o), /test file download failed: the response from https:\/\/example\.invalid\/f\.bin has no body; rerun later/);
  assert.equal(existsSync(o.file), false);
});

test('the partial file is created exclusively, so a planted file or link at that name is never written through', () => {
  const source = readFileSync(new URL('../scripts/lib/pinned-file.mjs', import.meta.url), 'utf8');
  assert.match(source, /writeFileSync\(partial, body, \{ flag: 'wx' \}\)/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHeroImage, ImageHookError } from '../scripts/lib/image-hook.mjs';

const KEY = 'sk-test-DISTINCTIVE-9f3a1c';
const ENDPOINT = 'https://img.example.com/v1/gen';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 3)]);
const reply = (body, type, init = {}) => async () => new Response(body, { status: 200, headers: type ? { 'content-type': type } : {}, ...init });
const call = (over = {}) => fetchHeroImage({ prompt: 'A title', endpoint: ENDPOINT, key: KEY, ...over });
const rejects = (over, pattern) => assert.rejects(call(over), (e) => e instanceof ImageHookError && pattern.test(e.message) && !e.message.includes(KEY));

test('endpoint: only a valid https URL without credentials', async () => {
  await rejects({ endpoint: 'http://img.example.com/x', fetchImpl: reply(PNG, 'image/png') }, /https/);
  await rejects({ endpoint: 'ftp://img.example.com/x' }, /https/);
  await rejects({ endpoint: 'https://user:pw@img.example.com/x' }, /credentials/);
  await rejects({ endpoint: 'https://user@img.example.com/x' }, /credentials/);
  await rejects({ endpoint: '' }, /empty/);
  await rejects({ endpoint: undefined }, /empty/);
  await rejects({ endpoint: 42 }, /empty/);
  await rejects({ endpoint: 'not a url' }, /valid URL/);
});

test('missing key names PA_IMAGE_API_KEY; empty prompt is refused', async () => {
  for (const key of [undefined, '', '   ']) await assert.rejects(call({ key }), /PA_IMAGE_API_KEY/);
  await assert.rejects(call({ prompt: ' ' }), /prompt is empty/);
});

test('request shape: POST JSON, bearer key, no redirects, abort signal', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(PNG, { headers: { 'content-type': 'image/png' } }); };
  await call({ fetchImpl, prompt: 'Hello world' });
  assert.equal(seen.url, ENDPOINT);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  assert.equal(seen.init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(seen.init.body), { prompt: 'Hello world', width: 1280, height: 720 });
  assert.equal(seen.init.redirect, 'error');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('success: png, jpeg and webp with matching magic bytes', async () => {
  for (const [mime, bytes] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/webp', WEBP]]) {
    const r = await call({ fetchImpl: reply(bytes, `${mime}; charset=binary`) });
    assert.equal(r.mime, mime);
    assert.deepEqual(r.bytes, bytes);
  }
});

test('declared png with other magic bytes is rejected', async () => {
  await rejects({ fetchImpl: reply(JPEG, 'image/png') }, /not a valid image\/png/);
  await rejects({ fetchImpl: reply('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png') }, /not a valid image\/png/);
});

test('svg, html and json content-types are rejected without echoing the body', async () => {
  const SECRET_BODY = `leaked ${KEY} BODY-MARKER`;
  for (const type of ['image/svg+xml', 'text/html', 'application/json', undefined]) {
    await assert.rejects(call({ fetchImpl: reply(SECRET_BODY, type) }), (e) => e instanceof ImageHookError && /content-type/.test(e.message) && !e.message.includes('BODY-MARKER') && !e.message.includes(KEY));
  }
});

test('non-ok status: message has the status, not the key or the body', async () => {
  const fetchImpl = async () => new Response(`denied ${KEY} BODY-MARKER`, { status: 401, headers: { 'content-type': 'text/plain' } });
  await assert.rejects(call({ fetchImpl }), (e) => /401/.test(e.message) && !e.message.includes(KEY) && !e.message.includes('BODY-MARKER'));
});

test('oversized stream: rejected, and the reader is cancelled before every chunk is read', async () => {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1024).fill(7)); if (pulled === 1) c.enqueue(PNG); },
    cancel() { cancelled = true; },
  });
  await rejects({ maxBytes: 4096, fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }) }, /larger than/);
  assert.ok(cancelled);
  assert.ok(pulled < 20, `pulled ${pulled} chunks`);
});

test('oversized content-length is rejected up front', async () => {
  await rejects({ maxBytes: 10, fetchImpl: reply(PNG, 'image/png', { headers: { 'content-type': 'image/png', 'content-length': '999999' } }) }, /larger than/);
});

test('timeout aborts a request that never answers', async () => {
  const fetchImpl = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error(`aborted with ${KEY}`))));
  await rejects({ timeoutMs: 20, fetchImpl }, /did not answer/);
});

test('network failure: names the host and strips the key', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { cause: { code: `E-${KEY}` } }); };
  await assert.rejects(call({ fetchImpl }), (e) => /img\.example\.com/.test(e.message) && !e.message.includes(KEY) && !e.message.includes('ECONNREFUSED'));
});

test('the key never appears in any error (message or stack) across failure modes', async () => {
  const cases = [
    { endpoint: 'http://x' }, { endpoint: 'https://u:p@x.example' }, { prompt: '' },
    { fetchImpl: reply(KEY, 'text/html') }, { fetchImpl: reply(JPEG, 'image/png') },
    { fetchImpl: async () => new Response(KEY, { status: 500 }) },
    { fetchImpl: async () => { throw new Error(KEY); } },
  ];
  for (const c of cases) {
    await assert.rejects(call(c), (e) => !JSON.stringify([e.message, e.stack, e.name]).includes(KEY));
  }
});

import { heroPrompt } from '../scripts/lib/image-hook.mjs';

test('heroPrompt cuts by code points, never leaving a lone surrogate', () => {
  const title = `${'a'.repeat(399)}😀tail`;
  const prompt = heroPrompt({ title });
  assert.equal([...prompt].length, 400);
  assert.ok(prompt.endsWith('😀'));
  assert.equal(prompt.isWellFormed(), true);
  assert.equal(JSON.parse(JSON.stringify({ prompt })).prompt, prompt);
});

test('a key with surrounding whitespace is trimmed; a whitespace-only key is the missing-key error', async () => {
  let auth;
  const fetchImpl = async (_u, init) => { auth = init.headers.authorization; return new Response(PNG, { headers: { 'content-type': 'image/png' } }); };
  await call({ key: `  ${KEY}\n`, fetchImpl });
  assert.equal(auth, `Bearer ${KEY}`);
  await assert.rejects(call({ key: '\n' }), /PA_IMAGE_API_KEY/);
});

test('a redirect is reported as such, without echoing URLs', async () => {
  const fetchImpl = async () => { throw new TypeError(`fetch failed https://evil.example/${KEY}`, { cause: new Error('unexpected redirect') }); };
  await assert.rejects(call({ fetchImpl }), (e) => /redirected; redirects are not followed/.test(e.message) && !e.message.includes('evil') && !e.message.includes(KEY));
});

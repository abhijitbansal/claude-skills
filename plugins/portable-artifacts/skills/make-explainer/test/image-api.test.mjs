import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const KEY = 'sk-test-DISTINCTIVE-77aa';
const ENDPOINT = 'https://img.example.com/v1/gen?token=QUERY-SECRET';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 5)]);
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-imgapi-')));
  made.push(dir);
  const spec = path.join(dir, 'explainer.json');
  fs.writeFileSync(spec, JSON.stringify({ title: 'Search now ignores case', subtitle: 'A small change', theme: 'dusk', sections: [{ type: 'text', text: 'Body text.' }] }));
  return { dir, spec, out: path.join(dir, 'out.html') };
}
const okFetch = (log = []) => async (url, init) => { log.push({ url, init }); return new Response(PNG, { headers: { 'content-type': 'image/png' } }); };
const heroOf = (html) => html.match(/<div class="hero-art"[^>]*>[\s\S]*?<\/div>/)?.[0];

function captureStderr() {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  return { lines, restore: () => { process.stderr.write = orig; } };
}

test('with --image-api the hero is a data: URI img, no procedural svg, no key or query in the page', async () => {
  const f = fixture();
  const log = [];
  const err = captureStderr();
  let r;
  try {
    r = await build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: okFetch(log), env: { ...process.env, PA_IMAGE_API_KEY: KEY } });
  } finally { err.restore(); }
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const html = fs.readFileSync(f.out, 'utf8');
  const hero = heroOf(html);
  assert.match(hero, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="" role="presentation">/);
  assert.doesNotMatch(hero, /<svg/);
  assert.ok(!html.includes(KEY));
  assert.ok(!html.includes('QUERY-SECRET'));
  assert.ok(!html.includes('img.example.com'));
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0].init.body), { prompt: 'Search now ignores case. A small change', width: 1280, height: 720 });
  assert.deepEqual(err.lines, ['image-api: sending the title and subtitle to img.example.com (leaves this machine)\n']);
});

test('the stderr notice is printed before the fetch happens', async () => {
  const f = fixture();
  const order = [];
  const err = captureStderr();
  const orig = err.lines.push.bind(err.lines);
  err.lines.push = (...a) => { order.push('notice'); return orig(...a); };
  try {
    await build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: async () => { order.push('fetch'); return new Response(PNG, { headers: { 'content-type': 'image/png' } }); }, env: { PA_IMAGE_API_KEY: KEY } });
  } finally { err.restore(); }
  assert.deepEqual(order, ['notice', 'fetch']);
});

test('same spec and same bytes give the same HTML', async () => {
  const f = fixture();
  const err = captureStderr();
  try {
    await build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: okFetch(), env: { PA_IMAGE_API_KEY: KEY, SOURCE_DATE_EPOCH: '1700000000' } });
    const a = fs.readFileSync(f.out, 'utf8');
    await build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: okFetch(), env: { PA_IMAGE_API_KEY: KEY, SOURCE_DATE_EPOCH: '1700000000' } });
    assert.equal(fs.readFileSync(f.out, 'utf8'), a);
  } finally { err.restore(); }
});

test('an image failure fails the build and writes no page; the key is not in the error', async () => {
  const f = fixture();
  const err = captureStderr();
  try {
    await assert.rejects(
      build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: async () => new Response('nope', { status: 500 }), env: { PA_IMAGE_API_KEY: KEY } }),
      (e) => e.name === 'ImageHookError' && /500/.test(e.message) && !e.message.includes(KEY),
    );
  } finally { err.restore(); }
  assert.equal(fs.existsSync(f.out), false);
});

test('default build makes zero fetch calls and keeps the procedural svg hero', async () => {
  const f = fixture();
  const fetchImpl = async () => { throw new Error('network touched'); };
  const r = await build(f.spec, { out: f.out, fetchImpl, env: { ...process.env, PA_IMAGE_API_KEY: KEY } });
  assert.equal(r.ok, true);
  const hero = heroOf(fs.readFileSync(f.out, 'utf8'));
  assert.match(hero, /<svg/);
  assert.doesNotMatch(hero, /<img/);
});

const run = (args, env = {}) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', PA_IMAGE_API_KEY: '', ...env } });

test('CLI: --image-api http://x exits 2 and says https', () => {
  const f = fixture();
  const r = run([f.spec, '--out', f.out, '--image-api', 'http://x'], { PA_IMAGE_API_KEY: KEY });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /https/);
  assert.equal(fs.existsSync(f.out), false);
});

test('CLI: --image-api https://x with no key exits 2 naming PA_IMAGE_API_KEY, before any network', () => {
  const f = fixture();
  const r = run([f.spec, '--out', f.out, '--image-api', 'https://x.invalid/gen']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PA_IMAGE_API_KEY/);
  assert.doesNotMatch(r.stderr, /image-api: sending/);
});

test('CLI: unknown flags still list the usage, which now shows --image-api', () => {
  const f = fixture();
  const r = run([f.spec, '--image-apii', 'https://x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /did you mean '--image-api'/);
});

// ---- fix round 1: refuse before any request ----------------------------------------------------

function refusal(specOver) {
  const f = fixture();
  const base = JSON.parse(fs.readFileSync(f.spec, 'utf8'));
  fs.writeFileSync(f.spec, JSON.stringify({ ...base, ...specOver }));
  return f;
}
async function refused(f, pattern) {
  let calls = 0;
  const err = captureStderr();
  try {
    await assert.rejects(
      build(f.spec, { out: f.out, imageApi: ENDPOINT, fetchImpl: async () => { calls++; throw new Error('network touched'); }, env: { PA_IMAGE_API_KEY: KEY } }),
      (e) => e.name === 'ImageHookError' && pattern.test(e.message),
    );
  } finally { err.restore(); }
  assert.equal(calls, 0);
  assert.deepEqual(err.lines, []);
  assert.equal(fs.existsSync(f.out), false);
}

test('--image-api on a slide deck is refused before the notice and any request', async () => {
  await refused(refusal({ mode: 'slides' }), /only applies to explainer pages, not slide decks/);
});

test('--image-api on a classic theme is refused before the notice and any request', async () => {
  for (const theme of ['paper', 'blueprint', 'ink', 'editorial']) await refused(refusal({ theme }), new RegExp(`needs a dusk, press or poster page \\(got ${theme}\\)`));
});

test('CLI: deck and classic refusals exit 2', () => {
  for (const [over, re] of [[{ mode: 'slides' }, /not slide decks/], [{ theme: 'paper' }, /got paper/]]) {
    const f = refusal(over);
    const r = run([f.spec, '--out', f.out, '--image-api', ENDPOINT], { PA_IMAGE_API_KEY: KEY });
    assert.equal(r.status, 2);
    assert.match(r.stderr, re);
    assert.doesNotMatch(r.stderr, /image-api: sending/);
  }
});

test('buildPage asks for the image only after every local step succeeded', async () => {
  const { buildPage, BuildError } = await import('../scripts/lib/page.mjs');
  let asked = 0;
  const provider = async () => { asked++; return { mime: 'image/png', bytes: PNG }; };
  const bad = { title: 'T', theme: 'dusk', sections: [{ type: 'nope' }] };
  await assert.rejects(buildPage(bad, { heroImage: provider }), BuildError);
  assert.equal(asked, 0);
  const good = { title: 'T', theme: 'dusk', sections: [{ type: 'text', text: 'x' }] };
  const { html } = await buildPage(good, { heroImage: provider });
  assert.equal(asked, 1);
  assert.match(html, /<img src="data:image\/png/);
});

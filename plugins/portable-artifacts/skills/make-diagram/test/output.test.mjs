import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveOutput, slugify } from '../scripts/lib/output.mjs';

const home = '/home/someone';

test('slugify: lowercase [a-z0-9-], at most 60 chars, fallback "diagram"', () => {
  assert.equal(slugify('Checkout request path'), 'checkout-request-path');
  assert.equal(slugify('  A -- B / C!! '), 'a-b-c');
  assert.equal(slugify('注文確認🙂'), 'diagram');
  assert.equal(slugify(''), 'diagram');
  assert.equal(slugify(undefined), 'diagram');
  const long = slugify('word '.repeat(40));
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
  assert.match(slugify('x'.repeat(100)), /^x{60}$/);
});

test('--out ending in .html is the file itself', () => {
  assert.equal(resolveOutput({ out: '/tmp/x/my.html', title: 'T', env: {}, home }), '/tmp/x/my.html');
  assert.equal(resolveOutput({ out: 'rel/my.html', title: 'T', env: {}, home }), path.resolve('rel/my.html'));
});

test('--out otherwise is a directory that receives <slug>.html', () => {
  assert.equal(resolveOutput({ out: '/tmp/x', title: 'My Title', env: {}, home }), '/tmp/x/my-title.html');
});

test('default is PA_OUTPUT_DIR, else <home>/.agent/diagrams', () => {
  assert.equal(resolveOutput({ title: 'My Title', env: { PA_OUTPUT_DIR: '/var/out' }, home }), '/var/out/my-title.html');
  assert.equal(resolveOutput({ title: 'My Title', env: {}, home }), '/home/someone/.agent/diagrams/my-title.html');
  assert.equal(resolveOutput({ title: 'My Title', env: { PA_OUTPUT_DIR: '' }, home }), '/home/someone/.agent/diagrams/my-title.html');
});

test('--out wins over PA_OUTPUT_DIR', () => {
  assert.equal(resolveOutput({ out: '/a/b.html', title: 'T', env: { PA_OUTPUT_DIR: '/var/out' }, home }), '/a/b.html');
});

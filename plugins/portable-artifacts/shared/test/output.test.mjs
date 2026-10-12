import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, resolveOutput } from '../output.mjs';

const home = '/home/someone';

test('slugify keeps [a-z0-9-], caps at 60 and uses the caller fallback', () => {
  assert.equal(slugify('A -- B / C!!'), 'a-b-c');
  assert.equal(slugify('🙂'), 'diagram');
  assert.equal(slugify('🙂', 'explainer'), 'explainer');
  assert.match(slugify('x'.repeat(100)), /^x{60}$/);
});

test('resolveOutput: file, directory, PA_OUTPUT_DIR and home default', () => {
  assert.equal(resolveOutput({ out: '/a/b.html', title: 'T', env: { PA_OUTPUT_DIR: '/v' }, home }), '/a/b.html');
  assert.equal(resolveOutput({ out: '/a', title: 'My T', env: {}, home }), '/a/my-t.html');
  assert.equal(resolveOutput({ title: 'My T', env: { PA_OUTPUT_DIR: '/v' }, home }), '/v/my-t.html');
  assert.equal(resolveOutput({ title: '', fallback: 'explainer', env: {}, home }), '/home/someone/.agent/diagrams/explainer.html');
});

// PA-03: the pure half of the checklist persistence probe. The browser half (tick, reload, reset over loopback http)
// is listed for the serial browser run; what a broken storage key looks like to it is decided here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judgeTick, judgeReset, KEY_PREFIX, servedPage } from '../scripts/lib/persistence-probe.mjs';

const runtime = fs.readFileSync(new URL('../template/runtime.js', import.meta.url), 'utf8');

test('the probe reads the same entry name the page script writes', () => {
  assert.equal(KEY_PREFIX, 'pa-checklist:');
  assert.ok(runtime.includes(`'${KEY_PREFIX}' + box.getAttribute('data-key')`), 'runtime.js builds the entry name from data-key with this prefix');
});

test('a tick that saved nothing, or saved under another name, is a problem that names the expected entry', () => {
  const missing = judgeTick(null, 'abc', 'my-key');
  assert.match(missing, /saved nothing under "pa-checklist:my-key"/);
  assert.match(judgeTick(undefined, 'abc', 'my-key'), /saved nothing/);
});

test('a tick is fine only when the entry is a JSON object that holds the ticked id', () => {
  assert.equal(judgeTick('{"abc":true}', 'abc', 'k'), null);
  assert.equal(judgeTick('{"abc":true,"def":true}', 'abc', 'k'), null);
  assert.match(judgeTick('{"def":true}', 'abc', 'k'), /does not hold the item that was ticked/);
  assert.match(judgeTick('{"abc":false}', 'abc', 'k'), /does not hold the item/);
  assert.match(judgeTick('not json', 'abc', 'k'), /not a JSON object/);
  assert.match(judgeTick('["abc"]', 'abc', 'k'), /not a JSON object/);
});

test('after Reset a removed entry or an empty object is fine; any tick left is a problem', () => {
  assert.equal(judgeReset(null, 'k'), null);
  assert.equal(judgeReset('{}', 'k'), null);
  assert.match(judgeReset('{"abc":true}', 'k'), /Reset left ticks in "pa-checklist:k"/);
  assert.match(judgeReset('garbage', 'k'), /Reset left ticks/);
});

test('the served folder is the page\'s own, so relative files load beside it', () => {
  assert.deepEqual(servedPage('/tmp/pages/a b.html'), { root: '/tmp/pages', name: 'a b.html' });
});

// PA-21, the parts of --shots that need no browser: how the PNGs are named and how the folder argument is read. The frames themselves are taken by the browser check (check.test.mjs, run serially).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseShotsDir, shotName, SCHEMES } from '../scripts/lib/shots.mjs';

test('shot names carry the page, the width, the scheme and the beat', () => {
  assert.equal(shotName('/x/Commits Per Folder.html', { width: 1440, scheme: 'dark' }), 'commits-per-folder-1440-dark.png');
  assert.equal(shotName('/x/a.html', { width: 390, scheme: 'light', beat: 3 }), 'a-390-light-beat-03.png');
  assert.equal(shotName('/x/!!!.html', { width: 390, scheme: 'light' }), 'scene-390-light.png', 'a name with nothing left gets "scene"');
});

test('both colour schemes are shot, light first', () => {
  assert.deepEqual(SCHEMES, ['light', 'dark']);
});

test('--shots needs a folder: an empty value is a usage error, a path is resolved', () => {
  assert.throws(() => parseShotsDir('  '), /--shots needs a folder/);
  assert.throws(() => parseShotsDir(''), /--shots needs a folder/);
  assert.equal(parseShotsDir('out/shots'), path.resolve('out/shots'));
  assert.equal(parseShotsDir(undefined), null);
});

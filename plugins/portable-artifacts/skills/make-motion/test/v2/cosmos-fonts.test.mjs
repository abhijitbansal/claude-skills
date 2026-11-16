// The cosmos look's rounded sans (Nunito, variable weight) in engine/fonts: the file is there and is a WOFF2, its
// SOURCES row pins an exact version and its hash, its licence text is the OFL, the FONTS table lists it with the
// weight axis canvas reaches, the stage can load it, and all the engine's new font bytes stay within the 600 KB budget.
// Node only: no browser (test/v2/fonts-browser.test.mjs measures the reach flags for every FONTS entry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS, fontFaces } from '../../engine/fonts/index.mjs';
import { facesFor } from '../../engine/page/fonts-shared.mjs';

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/fonts');
const FAMILY = 'Nunito';
const FILE = 'nunito-latin-wght-normal.woff2';
const BUDGET_BYTES = 600 * 1024; // the design's budget for new font bytes in make-motion
const BYTES_BEFORE_COSMOS = 211120; // Fraunces + Archivo (SOURCES.md)
const WOFF2_MAGIC = 'wOF2';
const SHA256_RE = /^[0-9a-f]{64}$/;

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// The SOURCES.md row for FILE as an array of its cells, or undefined.
function sourcesRow() {
  const lines = readFileSync(path.join(FONTS_DIR, 'SOURCES.md'), 'utf8').split('\n').filter((line) => line.startsWith(`| ${FILE} `));
  return lines.map((line) => line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')))[0];
}

test('the Nunito file is in engine/fonts and is a WOFF2', () => {
  const bytes = readFileSync(path.join(FONTS_DIR, FILE));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), WOFF2_MAGIC);
});

test('its SOURCES row names the Fontsource package at an exact version, the hash of the file and the OFL', () => {
  const row = sourcesRow();
  assert.ok(row, `SOURCES.md has a row for ${FILE}`);
  const [file, pkg, version, source, hash, licence] = row;
  assert.equal(file, FILE);
  assert.equal(pkg, '@fontsource-variable/nunito');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'an exact version');
  assert.equal(source, `files/${FILE}`);
  assert.match(hash, SHA256_RE);
  assert.equal(hash, sha256(path.join(FONTS_DIR, FILE)), 'the recorded hash is the file on disk');
  assert.equal(licence, 'OFL-1.1');
});

test('the licence text is the SIL Open Font License for Nunito', () => {
  const text = readFileSync(path.join(FONTS_DIR, 'LICENSES', 'nunito.txt'), 'utf8');
  assert.match(text, /SIL OPEN FONT LICENSE/);
  assert.match(text, /Nunito/);
});

test('FONTS lists Nunito with its weight axis, which canvas reaches through ctx.font, and no other axis', () => {
  const entry = FONTS.find((f) => f.family === FAMILY);
  assert.ok(entry, 'a FONTS entry for Nunito');
  assert.equal(entry.file, FILE);
  assert.deepEqual({ ...entry.axes }, { wght: [200, 1000] });
  assert.deepEqual({ ...entry.reach }, { wght: true, wdth: false, opsz: false, SOFT: false });
  assert.equal(entry.fixed, undefined);
});

test('the stage can load Nunito: fontFaces and facesFor serve it from /engine/fonts/', () => {
  const face = fontFaces().find((f) => f.family === FAMILY);
  assert.equal(face.url, `/engine/fonts/${FILE}`);
  assert.deepEqual(facesFor({ font: { family: FAMILY } }).map((f) => f.family), [FAMILY]);
});

test('new font bytes stay within the 600 KB budget, with Nunito the only addition since Fraunces and Archivo', () => {
  const files = readdirSync(FONTS_DIR).filter((name) => name.endsWith('.woff2'));
  const total = files.reduce((sum, name) => sum + statSync(path.join(FONTS_DIR, name)).size, 0);
  const nunito = statSync(path.join(FONTS_DIR, FILE)).size;
  assert.equal(total, BYTES_BEFORE_COSMOS + nunito, `files: ${files.join(', ')}`);
  assert.ok(total <= BUDGET_BYTES, `${total} bytes against ${BUDGET_BYTES}`);
});

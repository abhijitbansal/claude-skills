// The new display faces in engine/fonts: each file has a SOURCES row with a matching hash and a licence file, the
// total stays under budget, and the FONTS table in index.mjs is well formed. Node only: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS, STRETCH_KEYWORDS, fontFaces } from '../../engine/fonts/index.mjs';

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine/fonts');
const BUDGET_BYTES = 600 * 1024;
const LICENCE_MARKER = 'SIL OPEN FONT LICENSE';
const AXIS_TAGS = ['wght', 'wdth', 'opsz', 'SOFT'];
const SOURCES_COLUMNS = ['File', 'Package', 'Version', 'Source file in package', 'SHA-256', 'Licence'];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fontFiles = (dir) => readdirSync(dir).filter((name) => name.endsWith('.woff2')).sort();
// 'fraunces-latin-full-normal.woff2' -> 'fraunces': the family key the licence file is named by.
const familyKey = (file) => file.split('-latin-')[0];

// The data rows of SOURCES.md as { file, package, version, source, sha256, licence }.
function parseSources(dir) {
  const rows = readFileSync(path.join(dir, 'SOURCES.md'), 'utf8').split('\n').filter((line) => line.startsWith('|'));
  const cells = rows.map((line) => line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')));
  assert.deepEqual(cells[0], SOURCES_COLUMNS, 'SOURCES.md table header');
  return cells.slice(2).map(([file, pkg, version, source, hash, licence]) => ({ file, package: pkg, version, source, sha256: hash, licence }));
}

// Every way a font directory can disagree with its SOURCES.md; [] when it is consistent.
function auditFontDir(dir) {
  const problems = [];
  const rows = parseSources(dir);
  const onDisk = fontFiles(dir);
  for (const file of onDisk) if (!rows.some((r) => r.file === file)) problems.push(`${file}: no SOURCES row`);
  for (const row of rows) {
    if (!onDisk.includes(row.file)) { problems.push(`${row.file}: listed but missing`); continue; }
    if (sha256(path.join(dir, row.file)) !== row.sha256) problems.push(`${row.file}: sha256 mismatch`);
    if (row.licence !== 'OFL-1.1') problems.push(`${row.file}: licence ${row.licence} is not OFL-1.1`);
    if (!/^\d+\.\d+\.\d+$/.test(row.version)) problems.push(`${row.file}: version "${row.version}" is not exact`);
    const licenceFile = path.join(dir, 'LICENSES', `${familyKey(row.file)}.txt`);
    let text = '';
    try { text = readFileSync(licenceFile, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (!text.includes(LICENCE_MARKER)) problems.push(`${row.file}: LICENSES/${familyKey(row.file)}.txt missing or not the ${LICENCE_MARKER}`);
  }
  return problems;
}

test('every bundled font file has a SOURCES row with a matching sha256 and a licence file', () => {
  assert.deepEqual(auditFontDir(FONTS_DIR), []);
  assert.ok(fontFiles(FONTS_DIR).length >= 2, 'expected the two display families');
});

test('the audit catches a bad hash, a missing row, a missing licence and a non-OFL row', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fonts-audit-'));
  try {
    mkdirSync(path.join(dir, 'LICENSES'));
    const [file] = fontFiles(FONTS_DIR);
    copyFileSync(path.join(FONTS_DIR, file), path.join(dir, file));
    copyFileSync(path.join(FONTS_DIR, 'LICENSES', `${familyKey(file)}.txt`), path.join(dir, 'LICENSES', `${familyKey(file)}.txt`));
    const row = (hash, licence) => `| ${file} | pkg | 1.0.0 | files/${file} | ${hash} | ${licence} |`;
    const header = `| ${SOURCES_COLUMNS.join(' | ')} |\n|---|---|---|---|---|---|\n`;
    const write = (body) => writeFileSync(path.join(dir, 'SOURCES.md'), header + body);
    const good = sha256(path.join(dir, file));
    write(`${row(good, 'OFL-1.1')}\n`);
    assert.deepEqual(auditFontDir(dir), [], 'a consistent directory passes');
    write(`${row('0'.repeat(64), 'OFL-1.1')}\n`);
    assert.match(auditFontDir(dir).join('\n'), /sha256 mismatch/);
    write('');
    assert.match(auditFontDir(dir).join('\n'), /no SOURCES row/);
    write(`${row(good, 'MIT')}\n`);
    assert.match(auditFontDir(dir).join('\n'), /not OFL-1\.1/);
    rmSync(path.join(dir, 'LICENSES', `${familyKey(file)}.txt`));
    write(`${row(good, 'OFL-1.1')}\n`);
    assert.match(auditFontDir(dir).join('\n'), /missing or not the SIL OPEN FONT LICENSE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('new font files total at most 600 KB', () => {
  const totalBytes = fontFiles(FONTS_DIR).reduce((sum, file) => sum + statSync(path.join(FONTS_DIR, file)).size, 0);
  assert.ok(totalBytes > 0 && totalBytes <= BUDGET_BYTES, `${totalBytes} bytes`);
});

// The keynote look's neutral sans (looks-four plan, Task 9): one variable file with a wght axis, registered as
// "Geist Variable" so it never collides with the static shared "Geist" (engine/page/fonts-shared.mjs).
const GEIST_FILE = 'geist-latin-wght-normal.woff2';
const GEIST_FAMILY = 'Geist Variable';
test('keynote: the Geist Variable file is present, its hash matches its SOURCES row, its licence is there, and the total is within budget', () => {
  const row = parseSources(FONTS_DIR).find((r) => r.file === GEIST_FILE);
  assert.ok(row, `a SOURCES row for ${GEIST_FILE}`);
  assert.equal(row.package, '@fontsource-variable/geist');
  assert.equal(sha256(path.join(FONTS_DIR, GEIST_FILE)), row.sha256);
  const licence = readFileSync(path.join(FONTS_DIR, 'LICENSES', 'geist.txt'), 'utf8');
  assert.ok(licence.includes(LICENCE_MARKER) && licence.includes('Geist'), 'the SIL OFL text for Geist');
  const totalBytes = fontFiles(FONTS_DIR).reduce((sum, file) => sum + statSync(path.join(FONTS_DIR, file)).size, 0);
  assert.ok(totalBytes <= BUDGET_BYTES, `${totalBytes} bytes against ${BUDGET_BYTES}`);
  const entry = FONTS.find((f) => f.family === GEIST_FAMILY);
  assert.ok(entry, 'a FONTS entry named Geist Variable');
  assert.deepEqual({ file: entry.file, axes: { ...entry.axes }, wght: entry.reach.wght }, { file: GEIST_FILE, axes: { wght: [100, 900] }, wght: true });
});

// The marker look's handwriting (looks-four plan, Task 12): Caveat's variable file, wght 400-700, from the pinned package.
const CAVEAT_FILE = 'caveat-latin-wght-normal.woff2';
test('marker: the Caveat variable file is present, its hash matches its SOURCES row, its licence is there, and the total is within budget', () => {
  const row = parseSources(FONTS_DIR).find((r) => r.file === CAVEAT_FILE);
  assert.ok(row, `a SOURCES row for ${CAVEAT_FILE}`);
  assert.equal(row.package, '@fontsource-variable/caveat');
  assert.equal(row.version, '5.3.0');
  assert.equal(sha256(path.join(FONTS_DIR, CAVEAT_FILE)), row.sha256);
  const licence = readFileSync(path.join(FONTS_DIR, 'LICENSES', 'caveat.txt'), 'utf8');
  assert.ok(licence.includes(LICENCE_MARKER) && licence.includes('Caveat'), 'the SIL OFL text for Caveat');
  const totalBytes = fontFiles(FONTS_DIR).reduce((sum, file) => sum + statSync(path.join(FONTS_DIR, file)).size, 0);
  assert.ok(totalBytes <= BUDGET_BYTES, `${totalBytes} bytes against ${BUDGET_BYTES}`);
  const entry = FONTS.find((f) => f.family === 'Caveat');
  assert.ok(entry, 'a FONTS entry named Caveat');
  assert.deepEqual({ file: entry.file, axes: { ...entry.axes }, wght: entry.reach.wght }, { file: CAVEAT_FILE, axes: { wght: [400, 700] }, wght: true });
});

test('FONTS entries are well formed and point at files on disk', () => {
  const families = FONTS.map((f) => f.family);
  assert.equal(new Set(families).size, families.length, 'family names are unique');
  for (const font of FONTS) {
    assert.ok(fontFiles(FONTS_DIR).includes(font.file), `${font.family}: ${font.file} is not in engine/fonts`);
    assert.deepEqual(Object.keys(font.reach).sort(), [...AXIS_TAGS].sort(), `${font.family}: reach names the four axes`);
    for (const tag of AXIS_TAGS) assert.equal(typeof font.reach[tag], 'boolean', `${font.family}: reach.${tag}`);
    for (const [tag, [lo, hi]] of Object.entries(font.axes)) {
      assert.ok(AXIS_TAGS.includes(tag), `${font.family}: unknown axis ${tag}`);
      assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && lo < hi, `${font.family}: axes.${tag} is [min, max] with min < max`);
    }
  }
});

test('a derived entry names its base, shares its file, and pins axes the base declares', () => {
  const derived = FONTS.filter((f) => f.fixed);
  assert.ok(derived.length >= 1, 'at least one derived family (Fraunces Soft)');
  for (const font of derived) {
    const base = FONTS.find((f) => f.family === font.of);
    assert.ok(base && !base.fixed, `${font.family}: of "${font.of}" must be a base entry`);
    assert.equal(font.file, base.file);
    for (const [tag, value] of Object.entries(font.fixed)) {
      const [lo, hi] = base.axes[tag] ?? [];
      assert.ok(value >= lo && value <= hi, `${font.family}: fixed ${tag} ${value} is outside the base range ${lo}..${hi}`);
      assert.equal(font.axes[tag], undefined, `${font.family}: ${tag} is pinned, so it is not a free axis`);
    }
  }
  assert.ok(FONTS.some((f) => f.family === 'Fraunces Soft' && f.fixed.SOFT === 100));
});

test('fontFaces gives one { family, url, descriptors } per entry, with derived settings as variationSettings', () => {
  const faces = fontFaces();
  assert.equal(faces.length, FONTS.length);
  faces.forEach((face, i) => {
    assert.equal(face.family, FONTS[i].family);
    assert.equal(face.url, `/engine/fonts/${FONTS[i].file}`);
    assert.equal(face.descriptors.style, 'normal');
    assert.equal(face.descriptors.weight, '100 900', 'every entry carries the full weight range');
    if (FONTS[i].fixed) assert.match(face.descriptors.variationSettings, /^"(opsz|SOFT)" \d+$/);
    else assert.equal(face.descriptors.variationSettings, undefined);
  });
  const archivo = faces.find((f) => f.family === 'Archivo');
  assert.equal(archivo.descriptors.stretch, '62% 125%');
});

test('fontFaces returns fresh objects each call, so a caller cannot change the table', () => {
  const first = fontFaces();
  first[0].descriptors.weight = 'changed';
  assert.notEqual(fontFaces()[0].descriptors.weight, 'changed');
  assert.throws(() => { FONTS[0].reach.wght = !FONTS[0].reach.wght; }, TypeError);
});

test('STRETCH_KEYWORDS maps each width percentage canvas can reach to a ctx.fontStretch keyword', () => {
  assert.deepEqual(STRETCH_KEYWORDS, [
    [62.5, 'extra-condensed'], [75, 'condensed'], [87.5, 'semi-condensed'],
    [100, 'normal'], [112.5, 'semi-expanded'], [125, 'expanded'],
  ]);
});

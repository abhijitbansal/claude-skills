// Final fix wave C: the build must never delete a user's own files in <slug>.assets/, plus the
// KPI grouping rule, JSON error positions, the SIGTERM->SIGKILL path of a stopped build,
// the SVG sanitiser's prefix pattern and the table-rows lint exemption.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { loadSpec, lintSpec } from '../scripts/lib/spec.mjs';
import { svgProblem } from '../scripts/lib/image.mjs';
import { SECTIONS } from '../scripts/lib/sections.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(SKILL, 'test/fixtures');
const MANIFEST = '.pa-assets.json';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix = 'explainer-c-') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const put = (file, content = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const doc = (sections) => ({ title: 'T', sections });
const listing = (dir) => fs.readdirSync(dir).sort();

// A spec folder holding demo.json; the page is written next to it as demo.html, assets in demo.assets/.
function project(sections) {
  const root = tmp();
  const specFile = path.join(root, 'demo.json');
  const write = (s) => fs.writeFileSync(specFile, JSON.stringify(doc(s)));
  write(sections);
  return { root, specFile, write, out: path.join(root, 'demo.html'), assets: path.join(root, 'demo.assets') };
}
const rebuild = async (p) => {
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};

// ---- 1. a build never deletes the user's own files in <slug>.assets/ ------------------------

test('an image kept in <slug>.assets/ survives two rebuilds, and the build keeps succeeding', async () => {
  const p = project([{ type: 'image', src: 'demo.assets/shot.png', alt: 'shot' }]);
  copy(path.join(FIXTURES, 'pixel.png'), path.join(p.assets, 'shot.png'));
  const bytes = fs.readFileSync(path.join(p.assets, 'shot.png'));
  for (let i = 0; i < 2; i++) await rebuild(p);
  assert.deepEqual(fs.readFileSync(path.join(p.assets, 'shot.png')), bytes);
  assert.deepEqual(listing(p.assets), ['shot.png'], 'no manifest is written when the build wrote nothing');
});

test('a video and a poster kept in <slug>.assets/ survive; only the copy the build made is listed in the manifest', async () => {
  const p = project([{ type: 'motion', title: 'Tour', video: 'demo.assets/source.mp4', poster: 'demo.assets/poster.png' }]);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.assets, 'source.mp4'));
  copy(path.join(FIXTURES, 'poster.png'), path.join(p.assets, 'poster.png'));
  for (let i = 0; i < 2; i++) await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'poster.png', 'source.mp4', 'tour.mp4']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.assets, MANIFEST), 'utf8')).files, ['tour.mp4']);
  assert.deepEqual(fs.readFileSync(path.join(p.assets, 'source.mp4')), fs.readFileSync(path.join(FIXTURES, 'demo.mp4')));
});

test('a video that is already the destination file is not copied over itself, not listed and not pruned', async () => {
  const p = project([{ type: 'motion', title: 'Tour', video: 'demo.assets/tour.mp4' }]);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.assets, 'tour.mp4'));
  const bytes = fs.readFileSync(path.join(p.assets, 'tour.mp4'));
  const first = await rebuild(p);
  assert.deepEqual(first.assets, [path.join(p.assets, 'tour.mp4')], 'the page still reports it');
  assert.deepEqual(fs.readFileSync(path.join(p.assets, 'tour.mp4')), bytes);
  assert.equal(fs.existsSync(path.join(p.assets, MANIFEST)), false, 'the build wrote nothing, so no manifest');
  p.write([{ type: 'text', text: 'No video now.' }]);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['tour.mp4'], 'a build that writes no assets leaves the folder alone');
});

test('a file an earlier build wrote is kept when this spec now reads it as an input', async () => {
  const p = project([{ type: 'motion', title: 'Tour', video: 'v.mp4' }]);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.root, 'v.mp4'));
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'tour.mp4']);
  p.write([{ type: 'motion', title: 'Other', video: 'demo.assets/tour.mp4' }]);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'other.mp4', 'tour.mp4'], 'tour.mp4 is this build\'s input');
});

test('a folder named <slug>.assets that the user made, with no manifest, is untouched by a build that writes no assets', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  put(path.join(p.assets, 'notes.txt'), 'mine');
  put(path.join(p.assets, 'sub', 'deep.txt'), 'mine too');
  await rebuild(p);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['notes.txt', 'sub']);
  assert.equal(fs.readFileSync(path.join(p.assets, 'sub', 'deep.txt'), 'utf8'), 'mine too');
});

test('an empty folder the user made is not removed by a build that writes no assets', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  fs.mkdirSync(p.assets);
  await rebuild(p);
  assert.ok(fs.existsSync(p.assets));
});

test('a renamed motion section: its old asset is pruned through the manifest, the user\'s files stay, and the folder goes only when empty', async () => {
  const p = project([{ type: 'motion', title: 'Tour', video: 'v.mp4' }]);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.root, 'v.mp4'));
  put(path.join(p.assets, 'notes.txt'), 'mine');
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'notes.txt', 'tour.mp4']);

  p.write([{ type: 'motion', title: 'Walkthrough', video: 'v.mp4' }]);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'notes.txt', 'walkthrough.mp4']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.assets, MANIFEST), 'utf8')).files, ['walkthrough.mp4']);

  p.write([{ type: 'text', text: 'No video.' }]);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['notes.txt'], 'asset and manifest gone, the user\'s file and folder stay');

  fs.rmSync(path.join(p.assets, 'notes.txt'));
  p.write([{ type: 'motion', title: 'Back', video: 'v.mp4' }]);
  await rebuild(p);
  p.write([{ type: 'text', text: 'No video.' }]);
  await rebuild(p);
  assert.equal(fs.existsSync(p.assets), false, 'nothing of the user\'s is left: the folder is removed');
});

test('a symlink inside the folder is never followed or deleted, even when the manifest names it', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  const outside = path.join(p.root, 'outside');
  put(path.join(outside, 'precious.txt'), 'keep me');
  put(path.join(p.assets, 'old.mp4'));
  fs.symlinkSync(path.join(outside, 'precious.txt'), path.join(p.assets, 'link-file'));
  fs.symlinkSync(outside, path.join(p.assets, 'link-dir'));
  put(path.join(p.assets, MANIFEST), JSON.stringify({ version: 1, files: ['old.mp4', 'link-file', 'link-dir/precious.txt'] }));
  await rebuild(p);
  assert.equal(fs.existsSync(path.join(p.assets, 'old.mp4')), false, 'the real listed file is pruned');
  assert.ok(fs.lstatSync(path.join(p.assets, 'link-file')).isSymbolicLink());
  assert.ok(fs.lstatSync(path.join(p.assets, 'link-dir')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me');
});

test('manifest entries that leave the folder (../, absolute, nested ..) are ignored', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  const victim = path.join(p.root, 'victim.txt');
  put(victim, 'keep me');
  put(path.join(p.assets, 'old.mp4'));
  put(path.join(p.assets, MANIFEST), JSON.stringify({ version: 1, files: ['../victim.txt', victim, 'a/../../victim.txt', 'old.mp4', 42, null] }));
  await rebuild(p);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(p.assets, 'old.mp4')), false);
});

test('an unreadable or malformed manifest prunes nothing', async () => {
  for (const content of ['{not json', '[]', '{"files": "old.mp4"}', '{"files": {"0": "old.mp4"}}']) {
    const p = project([{ type: 'text', text: 'Plain.' }]);
    put(path.join(p.assets, 'old.mp4'));
    put(path.join(p.assets, MANIFEST), content);
    await rebuild(p);
    assert.ok(fs.existsSync(path.join(p.assets, 'old.mp4')), content);
  }
});

test('a build will not write through a symlink at an asset\'s destination', async () => {
  const p = project([{ type: 'motion', title: 'Tour', video: 'v.mp4' }]);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.root, 'v.mp4'));
  const outside = path.join(p.root, 'outside.mp4');
  put(outside, 'keep me');
  fs.mkdirSync(p.assets);
  fs.symlinkSync(outside, path.join(p.assets, 'tour.mp4'));
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /tour\.mp4: a symlink or a file is in the way/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
});

// ---- 2. KPI grouping starts at 10,000 ------------------------------------------------------------

const ctx = { dir: FIXTURES, icons: null, theme: null, mode: 'page', slug: 'page', assetsDir: FIXTURES, idFor: () => 'sec' };
const kpiValues = (values) => [...SECTIONS.kpis.render({ type: 'kpis', items: values.map((value, i) => ({ label: `l${i}`, value })) }, ctx).matchAll(/<dd class="kpi-value">([^<]*)<\/dd>/g)].map((m) => m[1]);

test('KPI integers get thousands separators from 10,000 only; a year stays a year', () => {
  assert.deepEqual(kpiValues([2026, 1107, 9999, 10000, 51301, 1234567, -9999, -10000, 0, 7]), ['2026', '1107', '9999', '10,000', '51,301', '1,234,567', '-9999', '-10,000', '0', '7']);
  assert.deepEqual(kpiValues([1234.5, 12345.5, 0.25]), ['1234.5', '12,345.5', '0.25']);
});

// ---- 3. JSON error positions ---------------------------------------------------------------------

const jsonError = (content) => {
  const file = path.join(tmp(), 'bad.json');
  fs.writeFileSync(file, content);
  try { loadSpec(file); } catch (e) { return e; }
  return assert.fail('should throw');
};

test('JSON end of input after a trailing newline points at the last non-empty line', () => {
  const e = jsonError('{\n  "title": "T",\n  "sections": [\n');
  assert.match(e.message, /unexpected end of input at line 3, column 16/);
  assert.equal(e.snippet, '  "sections": [\n  ' + ' '.repeat(13) + '^');
  const blank = jsonError('{\n  "title": "T",\n\n\n  \n');
  assert.match(blank.message, /line 2, column 16/);
  assert.equal(blank.snippet.split('\n')[0], '  "title": "T",');
});

test('JSON column and caret count characters, not UTF-16 units: correct after CJK and an astral emoji', () => {
  const e = jsonError('{"title": "日本語のタイトル😀", x}');
  assert.match(e.message, /unexpected "x" at line 1, column 24[;,]/);
  const [line, caret] = e.snippet.split('\n');
  // CJK takes two terminal cells and so does the emoji: the caret is padded by display width.
  assert.equal(caret.indexOf('^'), 2 + 11 + 8 * 2 + 2 + 3);
  assert.equal(line.slice(2), '{"title": "日本語のタイトル😀", x}');

  const accent = jsonError('{"a": "éé", x}'); // combining accents are part of their letter
  assert.match(accent.message, /column 13/);
  assert.equal(accent.snippet.split('\n')[1].indexOf('^'), 2 + 12);
});

test('JSON snippet trimming never splits a surrogate pair', () => {
  const e = jsonError(`{"t": "${'😀'.repeat(200)}", x}`);
  const [line] = e.snippet.split('\n');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line), JSON.stringify(line));
});

// ---- 4. a stopped build takes its motion children down with SIGKILL after the grace ---------------

const NO_GROUPS = process.platform === 'win32';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async (pid, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
};
const readPid = async (file) => {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (/^\d+$/.test(text)) return Number(text);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the grandchild never wrote its pid');
};

test('a build stopped with SIGTERM kills a motion child that ignores SIGTERM, after the grace, then dies of the signal', { skip: NO_GROUPS }, async () => {
  const dir = tmp('c-sigterm-');
  const pidFile = path.join(dir, 'pid');
  const child = path.join(dir, 'child.sh');
  fs.writeFileSync(child, `#!/bin/sh\ntrap '' TERM\nsleep 60 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwhile true; do sleep 1; done\n`, { mode: 0o755 });
  const driver = path.join(dir, 'driver.mjs');
  const lib = new URL('../scripts/lib/motion-render.mjs', import.meta.url).href;
  fs.writeFileSync(driver, `import { runChild } from ${JSON.stringify(lib)};\nawait runChild(${JSON.stringify(child)}, [], { cwd: ${JSON.stringify(dir)}, env: process.env, timeoutMs: 60000, graceMs: 400 });\n`);
  const parent = spawn(process.execPath, [driver], { stdio: 'ignore' });
  const exited = new Promise((resolve) => parent.on('exit', (code, signal) => resolve({ code, signal })));
  const grandchild = await readPid(pidFile);
  const t0 = Date.now();
  parent.kill('SIGTERM');
  const result = await exited;
  try {
    assert.equal(result.signal, 'SIGTERM', 'the parent still dies of the signal');
    assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms: the grace is the child\'s, not the default`);
    assert.equal(await gone(grandchild), true, 'the grandchild is gone');
  } finally {
    try { process.kill(grandchild, 'SIGKILL'); } catch { /* already gone */ }
  }
});

// ---- 5. SVG sanitiser: any XML name start character in a prefix ----------------------------------

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

test('svg: a non-ASCII namespace prefix does not hide script or foreignObject', () => {
  assert.match(svgProblem(svg('<é:script xmlns:é="http://www.w3.org/2000/svg">alert(1)</é:script>')), /<script/);
  assert.match(svgProblem(svg('<日本:foreignObject xmlns:日本="http://www.w3.org/2000/svg"/>')), /foreignObject/);
  assert.match(svgProblem(svg('<a·b.c-d:xé:script/>')), /<script/);
  assert.equal(svgProblem(svg('<é:g xmlns:é="http://www.w3.org/2000/svg"><rect width="1" height="1"/></é:g>')), null);
});

// ---- 6. the table-rows exemption is the table section's rows only ----------------------------------

test('banned phrases are exempt in a table section\'s rows, not in any other field named rows', () => {
  const banned = (sections) => lintSpec(doc(sections)).errors.filter((e) => /banned phrase "leverage"/.test(e.message)).map((e) => e.path);
  assert.deepEqual(banned([{ type: 'table', columns: ['Command'], rows: [['git leverage']] }]), []);
  assert.deepEqual(banned([{ type: 'text', text: 'Body.', rows: ['We leverage this'] }]), ['sections[0].rows[0]']);
  assert.deepEqual(banned([{ type: 'checklist', items: [{ text: 'Do it', rows: ['We leverage this'] }] }]), ['sections[0].items[0].rows[0]']);
  assert.deepEqual(banned([{ type: 'text', text: 'Fine.' }, { type: 'table', columns: ['A'], rows: [['x']], caption: 'We leverage this' }]), ['sections[1].caption']);
});

// ---- 7. a build never overwrites a file it did not write ----------------------------------------------

const motions = (...titles) => titles.map((title) => ({ type: 'motion', title, video: 'v.mp4' }));
const withVideo = (p) => copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.root, 'v.mp4'));

test('a file at an asset\'s target name that no build wrote fails the build with a path-keyed error, and nothing is written', async () => {
  const p = project(motions('Alpha', 'Tour'));
  withVideo(p);
  put(path.join(p.assets, 'tour.mp4'), 'my own video');
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'sections[1]');
  assert.match(r.errors[0].message, /demo\.assets\/tour\.mp4 already exists and no build wrote it; move it, or rename the section/);
  assert.equal(fs.readFileSync(path.join(p.assets, 'tour.mp4'), 'utf8'), 'my own video');
  assert.deepEqual(listing(p.assets), ['tour.mp4'], 'the free target (alpha.mp4) was not written either, and no manifest');
  assert.equal(fs.existsSync(p.out), false, 'no page either');
});

test('the failure also reaches the CLI as a normal build failure (exit 1)', () => {
  const p = project(motions('Tour'));
  withVideo(p);
  put(path.join(p.assets, 'tour.mp4'), 'my own video');
  const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts/build.mjs'), p.specFile, '--out', p.out], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^sections\[0\]: .*tour\.mp4 already exists/);
});

test('a file the previous manifest lists is overwritten without complaint', async () => {
  const p = project(motions('Tour'));
  withVideo(p);
  await rebuild(p);
  fs.writeFileSync(path.join(p.assets, 'tour.mp4'), 'stale');
  await rebuild(p);
  assert.deepEqual(fs.readFileSync(path.join(p.assets, 'tour.mp4')), fs.readFileSync(path.join(FIXTURES, 'demo.mp4')));
});

test('a file with the bytes the build would write is accepted, left alone and not claimed by the manifest', async () => {
  const p = project(motions('Tour'));
  withVideo(p);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(p.assets, 'tour.mp4'));
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['tour.mp4'], 'no manifest: the file was there first');
  p.write([{ type: 'text', text: 'No video.' }]);
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['tour.mp4'], 'and so it is never pruned');
});

test('a directory at an asset\'s target name is a conflict too', async () => {
  const p = project(motions('Tour'));
  withVideo(p);
  put(path.join(p.assets, 'tour.mp4', 'inside.txt'));
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /tour\.mp4 already exists/);
});

test('an interactive dashboard\'s files are protected the same way (content assets)', async () => {
  const root = tmp();
  fs.cpSync(path.join(FIXTURES, 'chart'), root, { recursive: true });
  const specFile = path.join(root, 'doc.json');
  fs.writeFileSync(specFile, JSON.stringify(doc([{ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', interactive: true }])));
  const out = path.join(root, 'page.html');
  put(path.join(root, 'page.assets', 'by-region', 'index.html'), 'my own page');
  const r = await build(specFile, { out });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'sections[0]');
  assert.match(r.errors[0].message, /page\.assets\/by-region\/index\.html already exists/);
  assert.equal(fs.readFileSync(path.join(root, 'page.assets', 'by-region', 'index.html'), 'utf8'), 'my own page');
  assert.equal(fs.existsSync(out), false);
});

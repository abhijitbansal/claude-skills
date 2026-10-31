// Final fix wave D: the asset sync's remaining holes (symlinked or plain-file <slug>.assets, write order and
// atomic page, stale manifest tmp, folders the user made, prose that spells a path, case variants of the
// manifest's name), `.htm` output, a second Ctrl-C during the SIGKILL grace, and check.mjs's Present probe.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { specInputs } from '../scripts/lib/assets.mjs';
import { checkPage } from '../scripts/check.mjs';
import { buildSpec, haveBrowser, closeSharedBrowser } from './helpers/browser.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(SKILL, 'test/fixtures');
const MANIFEST = '.pa-assets.json';
const made = [];
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};
after(async () => {
  await closeSharedBrowser();
  for (const d of made) {
    try { fs.chmodSync(d, 0o755); } catch { /* gone */ }
    fs.rmSync(d, { recursive: true, force: true });
  }
});
const tmp = (prefix = 'explainer-d-') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const put = (file, content = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const listing = (dir) => fs.readdirSync(dir).sort();
const motions = (...titles) => titles.map((title) => ({ type: 'motion', title, video: 'v.mp4' }));

function project(sections, { out = 'demo.html' } = {}) {
  const root = tmp();
  const specFile = path.join(root, 'demo.json');
  const write = (s) => fs.writeFileSync(specFile, JSON.stringify({ title: 'T', sections: s }));
  write(sections);
  copy(path.join(FIXTURES, 'demo.mp4'), path.join(root, 'v.mp4'));
  return { root, specFile, write, out: path.join(root, out), assets: path.join(root, 'demo.assets') };
}
const rebuild = async (p) => {
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r;
};
const manifestOf = (p) => JSON.parse(fs.readFileSync(path.join(p.assets, MANIFEST), 'utf8'));

// ---- Important 1: a symlinked <slug>.assets is refused, not written through ---------------------------------

test('a symlinked <slug>.assets fails the build with a path-keyed error and writes nothing, the user\'s file included', async () => {
  const p = project(motions('Alpha', 'Tour'));
  const real = path.join(p.root, 'real-folder');
  put(path.join(real, 'tour.mp4'), 'my own video');
  fs.symlinkSync(real, p.assets);
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => /^sections\[[01]\]$/.test(e.path)), JSON.stringify(r.errors));
  assert.match(r.errors[0].message, /demo\.assets is a symlink/);
  assert.equal(fs.readFileSync(path.join(real, 'tour.mp4'), 'utf8'), 'my own video');
  assert.deepEqual(listing(real), ['tour.mp4'], 'nothing else was written through the link');
  assert.equal(fs.existsSync(p.out), false, 'and no page');
});

test('a dangling symlink at <slug>.assets is refused too', async () => {
  const p = project(motions('Tour'));
  fs.symlinkSync(path.join(p.root, 'nowhere'), p.assets);
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /demo\.assets is a symlink/);
  assert.equal(fs.existsSync(path.join(p.root, 'nowhere')), false);
});

test('a symlinked <slug>.assets is no problem for a spec that writes no assets', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  const real = path.join(p.root, 'real-folder');
  fs.mkdirSync(real);
  fs.symlinkSync(real, p.assets);
  await rebuild(p);
  assert.deepEqual(listing(real), []);
});

// ---- Minor 3: a plain file named <slug>.assets --------------------------------------------------------------

test('a plain file named <slug>.assets fails with a clear error before the page is written', async () => {
  const p = project(motions('Tour'));
  put(p.assets, 'i am a file');
  const r = await build(p.specFile, { out: p.out });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'sections[0]');
  assert.match(r.errors[0].message, /demo\.assets is a file, not a folder/);
  assert.equal(fs.readFileSync(p.assets, 'utf8'), 'i am a file');
  assert.equal(fs.existsSync(p.out), false, 'the page was not written');
});

// ---- Important 2: assets, manifest, then the page; any failure names its path and keeps the old page --------

const canChmod = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

test('a write failure while syncing assets names the failing path and leaves the previous page, assets and manifest alone', { skip: !canChmod }, async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  const page = fs.readFileSync(p.out);
  const manifest = fs.readFileSync(path.join(p.assets, MANIFEST));
  p.write(motions('Walk'));
  fs.chmodSync(p.assets, 0o555);
  try {
    await assert.rejects(build(p.specFile, { out: p.out }), (e) => {
      assert.equal(e.name, 'UsageError');
      assert.ok(e.message.includes(path.join(p.assets, 'walk.mp4')), e.message);
      assert.ok(!e.message.includes(`cannot write ${p.out}`), e.message);
      return true;
    });
  } finally {
    fs.chmodSync(p.assets, 0o755);
  }
  assert.deepEqual(fs.readFileSync(p.out), page, 'the old page is still there, byte for byte');
  assert.deepEqual(listing(p.assets), [MANIFEST, 'tour.mp4']);
  assert.deepEqual(fs.readFileSync(path.join(p.assets, MANIFEST)), manifest);
  assert.deepEqual(listing(p.root).filter((n) => n.includes('tmp')), [], 'no temp page left behind');
});

test('a failure writing the page happens after the assets and keeps the old page; nothing is pruned', { skip: !canChmod }, async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  const page = fs.readFileSync(p.out);
  p.write(motions('Walk'));
  fs.chmodSync(p.root, 0o555); // the page cannot be replaced, the assets folder (its own permissions) can be written
  try {
    await assert.rejects(build(p.specFile, { out: p.out }), (e) => {
      assert.equal(e.name, 'UsageError');
      assert.ok(e.message.includes(p.out) || e.message.includes('demo.html'), e.message);
      return true;
    });
  } finally {
    fs.chmodSync(p.root, 0o755);
  }
  assert.deepEqual(fs.readFileSync(p.out), page, 'the old page is untouched');
  assert.deepEqual(listing(p.assets), [MANIFEST, 'tour.mp4', 'walk.mp4'], 'the new asset is there, the old one is not pruned');
  assert.deepEqual(manifestOf(p).files, ['tour.mp4', 'walk.mp4'], 'and both stay listed, so a later build can still clean tour.mp4');
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'walk.mp4'], 'the next good build prunes the old one');
});

test('the page is replaced atomically: no temp file is left after a good build', async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  await rebuild(p);
  assert.deepEqual(listing(p.root), ['demo.assets', 'demo.html', 'demo.json', 'v.mp4']);
});

// ---- Minor 1: a stale manifest temp file ---------------------------------------------------------------------

test('a stale .pa-assets.json.tmp is cleaned by the next build and never counts as a user file', async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  put(path.join(p.assets, `${MANIFEST}.tmp`), '{"half');
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'tour.mp4'], 'cleaned while writing assets');

  put(path.join(p.assets, `${MANIFEST}.tmp`), '{"half');
  p.write([{ type: 'text', text: 'No video.' }]);
  await rebuild(p);
  assert.equal(fs.existsSync(p.assets), false, 'the folder goes with it: only a build\'s files were in it');
});

test('a stale manifest temp file in a folder with no manifest is cleaned and nothing else is touched', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  put(path.join(p.assets, `${MANIFEST}.tmp`), '{"half');
  put(path.join(p.assets, 'notes.txt'), 'mine');
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['notes.txt']);
});

// ---- Minor 4: only real path fields shield a stale asset ------------------------------------------------------

test('specInputs lists the path fields only: image src, motion video/poster/spec, diagram and chart files', () => {
  const dir = '/spec';
  const inputs = specInputs({
    title: 'demo.assets/title.png',
    sections: [
      { type: 'image', src: 'a.png', alt: 'demo.assets/alt.png', caption: 'demo.assets/caption.png' },
      { type: 'motion', title: 'demo.assets/t.mp4', video: 'b.mp4', poster: 'c.png', spec: 'd.motion.json' },
      { type: 'diagram', title: 'x', diagram: 'e.diagram.json' },
      { type: 'diagram', title: 'inline', diagram: { nodes: [] } },
      { type: 'chart', dashboard: 'f.dashboard.json', chart: 'demo.assets/chart-id' },
      { type: 'text', text: 'demo.assets/tour.mp4' },
    ],
  }, dir);
  assert.deepEqual(inputs.sort(), ['/spec/a.png', '/spec/b.mp4', '/spec/c.png', '/spec/d.motion.json', '/spec/e.diagram.json', '/spec/f.dashboard.json'].sort());
});

test('prose that spells an asset path does not shield the stale asset from pruning', async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  assert.deepEqual(listing(p.assets), [MANIFEST, 'tour.mp4']);
  p.write([{ type: 'text', text: 'demo.assets/tour.mp4' }]);
  await rebuild(p);
  assert.equal(fs.existsSync(p.assets), false, 'tour.mp4 was pruned, and the folder with it');
});

// ---- Minor 5: only folders a build created are removed ---------------------------------------------------------

test('a subfolder the user made stays when pruning empties it; one a build created goes', async () => {
  const p = project([{ type: 'text', text: 'Plain.' }]);
  put(path.join(p.assets, 'old.mp4'));
  put(path.join(p.assets, 'mine', 'old2.mp4'));
  put(path.join(p.assets, MANIFEST), JSON.stringify({ version: 1, files: ['old.mp4', 'mine/old2.mp4'] }));
  await rebuild(p);
  assert.deepEqual(listing(p.assets), ['mine'], 'mine/ is the user\'s and stays, though now empty');
  assert.deepEqual(listing(path.join(p.assets, 'mine')), []);
});

test('a subfolder a build created is removed with its asset, and the folder with it when nothing else is there', async () => {
  const root = tmp();
  fs.cpSync(path.join(FIXTURES, 'chart'), root, { recursive: true });
  const specFile = path.join(root, 'doc.json');
  const write = (s) => fs.writeFileSync(specFile, JSON.stringify({ title: 'T', sections: s }));
  write([{ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', interactive: true }]);
  const out = path.join(root, 'page.html');
  assert.equal((await build(specFile, { out })).ok, true);
  assert.ok(fs.existsSync(path.join(root, 'page.assets', 'by-region', 'index.html')));
  write([{ type: 'text', text: 'No chart.' }]);
  assert.equal((await build(specFile, { out })).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'page.assets')), false);
});

test('a subfolder a build created is recorded in the manifest and removed once it is empty', async () => {
  const root = tmp();
  fs.cpSync(path.join(FIXTURES, 'chart'), root, { recursive: true });
  const specFile = path.join(root, 'doc.json');
  const write = (s) => fs.writeFileSync(specFile, JSON.stringify({ title: 'T', sections: s }));
  write([{ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', interactive: true }]);
  const out = path.join(root, 'page.html');
  const first = await build(specFile, { out });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const assets = path.join(root, 'page.assets');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, MANIFEST), 'utf8')).dirs, ['by-region']);
  put(path.join(assets, 'by-region', 'notes.txt'), 'mine');
  write([{ type: 'text', text: 'No chart.' }]);
  assert.equal((await build(specFile, { out })).ok, true);
  assert.deepEqual(listing(assets), ['by-region'], 'the user\'s note keeps the folder, and the folder keeps the assets root');
  assert.deepEqual(listing(path.join(assets, 'by-region')), ['notes.txt']);
  fs.rmSync(path.join(assets, 'by-region', 'notes.txt'));
  assert.equal((await build(specFile, { out })).ok, true);
  assert.deepEqual(listing(assets), ['by-region'], 'with no manifest left, nothing tells the build the empty folder was its own');
});

// ---- Minor 9: case variants of the manifest's own name --------------------------------------------------------------

test('a manifest entry that is a case variant of the manifest or its temp name is never unlinked', async () => {
  const p = project(motions('Tour'));
  await rebuild(p);
  const caseInsensitive = fs.existsSync(path.join(p.assets, MANIFEST.toUpperCase()));
  if (!caseInsensitive) {
    put(path.join(p.assets, MANIFEST.toUpperCase()), 'mine');
    put(path.join(p.assets, `${MANIFEST.toUpperCase()}.TMP`), 'mine');
  }
  put(path.join(p.assets, MANIFEST), JSON.stringify({ version: 1, files: ['tour.mp4', MANIFEST.toUpperCase(), `${MANIFEST.toUpperCase()}.TMP`, `${MANIFEST}.tmp`] }));
  const unlinked = [];
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (f, ...rest) => { unlinked.push(String(f)); return realUnlink(f, ...rest); };
  try {
    p.write(motions('Walk'));
    await rebuild(p);
  } finally {
    fs.unlinkSync = realUnlink;
  }
  const names = unlinked.map((f) => path.basename(f).toLowerCase());
  assert.ok(!names.includes(MANIFEST) && !names.includes(`${MANIFEST}.tmp`), `unlinked: ${unlinked.join(', ')}`);
  if (!caseInsensitive) {
    assert.equal(fs.readFileSync(path.join(p.assets, MANIFEST.toUpperCase()), 'utf8'), 'mine');
    assert.equal(fs.readFileSync(path.join(p.assets, `${MANIFEST.toUpperCase()}.TMP`), 'utf8'), 'mine');
  }
  assert.equal(fs.existsSync(path.join(p.assets, 'tour.mp4')), false, 'the real stale asset is still pruned');
});

// ---- Minor 8: .htm output ----------------------------------------------------------------------------------------------

for (const ext of ['.htm', '.HTML']) {
  test(`${ext} output uses <name>.assets/ like .html`, async () => {
    const p = project(motions('Tour'), { out: `demo${ext}` });
    const r = await rebuild(p);
    assert.deepEqual(r.assets, [path.join(p.root, 'demo.assets', 'tour.mp4')]);
    assert.deepEqual(listing(p.root).filter((n) => n.endsWith('.assets')), ['demo.assets']);
    assert.match(fs.readFileSync(p.out, 'utf8'), /demo\.assets\/tour\.mp4/);
  });
}

// ---- Minor 6: a second Ctrl-C during the grace wait ends in SIGKILL, not an orphan ---------------------------------------

const NO_GROUPS = process.platform === 'win32';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
};

test('a second stop signal during the grace wait SIGKILLs the children at once and the parent still dies of the signal', { skip: NO_GROUPS }, async () => {
  const dir = tmp('d-twice-');
  const pidFile = path.join(dir, 'pid');
  const child = path.join(dir, 'child.sh');
  fs.writeFileSync(child, `#!/bin/sh\ntrap '' TERM\nsleep 60 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwhile true; do sleep 1; done\n`, { mode: 0o755 });
  const driver = path.join(dir, 'driver.mjs');
  const lib = new URL('../scripts/lib/motion-render.mjs', import.meta.url).href;
  // A long grace: only the second signal can end the wait.
  fs.writeFileSync(driver, `import { runChild } from ${JSON.stringify(lib)};\nawait runChild(${JSON.stringify(child)}, [], { cwd: ${JSON.stringify(dir)}, env: process.env, timeoutMs: 600000, graceMs: 60000 });\n`);
  const parent = spawn(process.execPath, [driver], { stdio: 'ignore' });
  const exited = new Promise((resolve) => parent.on('exit', (code, signal) => resolve({ code, signal })));
  let grandchild;
  try {
    assert.equal(await until(() => /^\d+$/.test(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '')), true, 'the grandchild wrote its pid');
    grandchild = Number(fs.readFileSync(pidFile, 'utf8').trim());
    parent.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400)); // the first signal is in the parent's hands, the grace (60 s) is running
    assert.equal(alive(grandchild), true, 'the child ignores SIGTERM, so it is still there');
    parent.kill('SIGTERM');
    let deadline;
    const result = await Promise.race([exited, new Promise((r) => { deadline = setTimeout(() => r('timeout'), 8000); })]);
    clearTimeout(deadline);
    assert.notEqual(result, 'timeout', 'the parent died');
    assert.equal(result.signal, 'SIGTERM');
    assert.equal(await until(() => !alive(grandchild)), true, 'the grandchild is gone: SIGKILL followed the second signal');
  } finally {
    parent.kill('SIGKILL');
    if (grandchild) { try { process.kill(grandchild, 'SIGKILL'); } catch { /* gone */ } }
  }
});

// ---- Minor 16: the Present probe waits for a slow button and tells slow from covered ---------------------------------------

const flow = (title) => ({
  title,
  type: 'flow',
  nodes: [{ id: 'a', label: 'Start', kind: 'start' }, { id: 'b', label: 'Do it' }, { id: 'c', label: 'Done', kind: 'end' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
});
let extras = 0;
// A built page with one diagram and `extra` markup placed before </body>.
function builtWith(extra) {
  const built = buildSpec({ title: 'Figures', sections: [{ type: 'text', text: 'Intro.' }, { type: 'diagram', title: 'Path', diagram: flow('Path') }] });
  const file = path.join(path.dirname(built.file), `extra-${(extras += 1)}.html`);
  fs.writeFileSync(file, built.html.replace('</body>', `${extra}\n</body>`));
  return file;
}

test('check: a Present button that becomes clickable after a couple of seconds is fine', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const slow = '<script>{ const b = document.querySelector("[data-dg-present]"); b.disabled = true; setTimeout(() => { b.disabled = false; }, 2600); }</script>';
  const result = await checkPage(builtWith(slow));
  assert.equal(result.status, 'ok', result.problems.join('\n'));
  assert.equal(result.presented, 1, 'the overlay opened and closed');
});

test('check: a Present button that never becomes clickable is reported as slow or disabled, not as covered', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const never = '<script>document.querySelector("[data-dg-present]").disabled = true;</script>';
  const result = await checkPage(builtWith(never));
  assert.equal(result.status, 'failed');
  const lines = result.problems.filter((p) => /Present button/.test(p));
  assert.equal(lines.length, 3, result.problems.join('\n'));
  for (const line of lines) {
    assert.match(line, /^\d+px: the Present button of diagram 1 did not become clickable within 5 s/);
    assert.doesNotMatch(line, /covered/);
  }
});

test('check: a covered Present button says it is covered', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const cover = '<div style="position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999"></div>';
  const result = await checkPage(builtWith(cover));
  const lines = result.problems.filter((p) => /Present button/.test(p));
  assert.equal(lines.length, 3, result.problems.join('\n'));
  for (const line of lines) assert.match(line, /^\d+px: the Present button of diagram 1 is covered by another element$/);
});

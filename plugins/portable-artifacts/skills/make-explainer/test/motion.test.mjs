import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage, BuildError, contentSecurityPolicy } from '../scripts/lib/page.mjs';
import { build } from '../scripts/build.mjs';
import { renderFailure, runChild, posterFrame, renderMotion, motionArgs } from '../scripts/lib/motion-render.mjs';
import { findFfmpeg } from '../../make-motion/scripts/lib/ffmpeg.mjs';
import { haveBrowser } from './helpers/browser.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(SKILL, 'test/fixtures');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A fresh spec folder holding the fixture video, poster and motion spec, plus any extra files.
function folder(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-motion-')));
  made.push(dir);
  for (const f of ['demo.mp4', 'poster.png', 'motion.json']) fs.copyFileSync(path.join(FIXTURES, f), path.join(dir, f));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  return dir;
}

const doc = (sections, extra = {}) => ({ title: 'Doc', sections, ...extra });
const text = { type: 'text', text: 'x' };
const video = (extra = {}) => ({ type: 'motion', title: 'Demo', video: 'demo.mp4', ...extra });
const result = async (spec, dir) => validateSpec(spec, { dir });
const errorsOf = async (spec, dir) => (await result(spec, dir)).errors.map((e) => `${e.path}: ${e.message}`);
const out = (dir, name = 'page') => path.join(dir, `${name}.html`);
const make = (sections, dir = folder(), extra = {}) => buildPage(doc(sections, extra), { dir, out: out(dir) });
const NO_RENDER = process.platform === 'win32';

// ---- validation: paths ---------------------------------------------------------------------

test('a video with a poster, and a spec on its own, both validate', async () => {
  const dir = folder();
  assert.deepEqual(await errorsOf(doc([video({ poster: 'poster.png', caption: 'Tour' })]), dir), []);
  assert.deepEqual(await errorsOf(doc([{ type: 'motion', spec: 'motion.json' }]), dir), []);
});

test('video path rules: outside the folder, absolute, missing, wrong extension, a symlink', async () => {
  const dir = folder({ 'clip.mov': 'x' });
  const at = async (src) => errorsOf(doc([video({ video: src })]), dir);
  assert.match((await at('../demo.mp4'))[0], /^sections\[0\]\.video: "\.\.\/demo\.mp4" is outside the spec folder/);
  assert.match((await at('/etc/hosts'))[0], /^sections\[0\]\.video: "\/etc\/hosts" is absolute/);
  assert.match((await at('nope.mp4'))[0], /^sections\[0\]\.video: file not found: "nope\.mp4"/);
  assert.match((await at('clip.mov'))[0], /^sections\[0\]\.video: must be a \.mp4 file; got "\.mov"/);
  fs.symlinkSync(path.join(dir, 'demo.mp4'), path.join(dir, 'link.mp4'));
  assert.match((await at('link.mp4'))[0], /^sections\[0\]\.video: "link\.mp4" goes through a symlink/);
});

test('a symlinked folder inside the spec folder is refused too', async () => {
  const dir = folder();
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-motion-out-')));
  made.push(elsewhere);
  fs.copyFileSync(path.join(FIXTURES, 'demo.mp4'), path.join(elsewhere, 'demo.mp4'));
  fs.symlinkSync(elsewhere, path.join(dir, 'media'));
  assert.match((await errorsOf(doc([video({ video: 'media/demo.mp4' })]), dir))[0], /goes through a symlink/);
});

test('a video whose bytes are not an MP4 is refused, whatever the extension says', async () => {
  const dir = folder({ 'fake.mp4': 'this is a script, not a movie', 'short.mp4': 'abc' });
  assert.match((await errorsOf(doc([video({ video: 'fake.mp4' })]), dir))[0], /^sections\[0\]\.video: file content is not an MP4 video; check the extension/);
  assert.match((await errorsOf(doc([video({ video: 'short.mp4' })]), dir))[0], /not an MP4 video/);
});

test('a video over the size cap names the size and the limit', async () => {
  const dir = folder();
  const big = path.join(dir, 'big.mp4');
  fs.copyFileSync(path.join(dir, 'demo.mp4'), big);
  fs.truncateSync(big, 51 * 1024 * 1024);
  assert.match((await errorsOf(doc([video({ video: 'big.mp4' })]), dir))[0], /^sections\[0\]\.video: video is 51\.0 MB; the limit is 50 MB/);
});

test('poster path rules and content: outside, wrong extension, lying content, svg', async () => {
  const dir = folder({
    'poster.gif': 'x',
    'fake.png': 'not a png',
    'evil.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  });
  const at = async (poster) => errorsOf(doc([video({ poster })]), dir);
  assert.match((await at('../poster.png'))[0], /^sections\[0\]\.poster: "\.\.\/poster\.png" is outside the spec folder/);
  assert.match((await at('nope.png'))[0], /^sections\[0\]\.poster: file not found/);
  assert.match((await at('poster.gif'))[0], /^sections\[0\]\.poster: must be a \.png/);
  assert.match((await at('fake.png'))[0], /^sections\[0\]\.poster: file content is not a png image/);
  assert.match((await at('evil.svg'))[0], /^sections\[0\]\.poster: must be a \.png, \.jpg, \.jpeg, \.webp file; got "\.svg"/);
  fs.symlinkSync(path.join(dir, 'poster.png'), path.join(dir, 'link.png'));
  assert.match((await at('link.png'))[0], /^sections\[0\]\.poster: "link\.png" goes through a symlink/);
});

test('spec path rules: outside, missing, wrong extension, symlink, not JSON, not an object', async () => {
  const dir = folder({ 'notes.txt': 'x', 'broken.json': '{ nope', 'list.json': '[1]' });
  const at = async (spec) => errorsOf(doc([{ type: 'motion', spec }]), dir);
  assert.match((await at('../motion.json'))[0], /^sections\[0\]\.spec: "\.\.\/motion\.json" is outside the spec folder/);
  assert.match((await at('nope.json'))[0], /^sections\[0\]\.spec: file not found/);
  assert.match((await at('notes.txt'))[0], /^sections\[0\]\.spec: must be a \.json file/);
  assert.match((await at('broken.json'))[0], /^sections\[0\]\.spec: "broken\.json" is not valid JSON/);
  assert.match((await at('list.json'))[0], /^sections\[0\]\.spec: "list\.json" must hold one JSON object/);
  fs.symlinkSync(path.join(dir, 'motion.json'), path.join(dir, 'link.json'));
  assert.match((await at('link.json'))[0], /^sections\[0\]\.spec: "link\.json" goes through a symlink/);
});

// ---- validation: the motion spec itself ----------------------------------------------------

test("a motion spec's errors are make-motion's own, re-pathed under the section's spec field", async () => {
  const dir = folder({
    'bad.json': { size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0, fontSize: 'big' }] }] },
    'dup.json': { size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0 }, { id: 'a', type: 'shape', shape: 'ellipse', x: 0, y: 0 }] }] },
    'empty.json': {},
    'img.json': { scenes: [{ id: 's', duration: 1, elements: [{ id: 'i', type: 'image', src: '../outside.png', width: 10, height: 10, x: 0, y: 0 }] }] },
  });
  const at = async (spec) => errorsOf(doc([text, { type: 'motion', spec }]), dir);
  assert.deepEqual(await at('bad.json'), [
    'sections[1].spec.scenes[0].elements[0].fontSize: must be number (in bad.json)',
  ]);
  assert.deepEqual(await at('dup.json'), [
    'sections[1].spec.scenes[0].elements[1].id: duplicate id "a" (first used at scenes[0].elements[0].id) (in dup.json)',
  ]);
  assert.deepEqual(await at('empty.json'), ['sections[1].spec.scenes: required (in empty.json)']);
  const [img] = await at('img.json');
  assert.match(img, /^sections\[1\]\.spec\.scenes\[0\]\.elements\[0\]\.src: must stay inside the spec folder \(in img\.json\)$/);
});

test("a motion spec's images resolve against the motion spec's own folder", async () => {
  const dir = folder({
    'media/m.json': { size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [{ id: 'i', type: 'image', src: 'p.png', width: 16, height: 9, x: 80, y: 45 }] }] },
  });
  fs.copyFileSync(path.join(FIXTURES, 'poster.png'), path.join(dir, 'media/p.png'));
  assert.deepEqual(await errorsOf(doc([{ type: 'motion', spec: 'media/m.json' }]), dir), []);
});

test('video and spec together: the video wins, with a warning that the spec is not used', async () => {
  const dir = folder();
  const r = await result(doc([video({ spec: 'motion.json' })]), dir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.path), ['sections[0].spec']);
  assert.match(r.warnings[0].message, /not used: the video is shown; remove one of them/);
});

test('with video set, a broken spec file is not even read', async () => {
  const dir = folder({ 'broken.json': '{ nope' });
  const r = await result(doc([video({ spec: 'broken.json' })]), dir);
  assert.equal(r.ok, true);
});

test('the example clip spec stays valid for make-motion', async () => {
  const dir = path.join(SKILL, 'references/examples');
  assert.deepEqual(await errorsOf(doc([{ type: 'motion', spec: 'clip.motion.json' }]), dir), []);
});

// ---- make-motion missing -------------------------------------------------------------------

// The skill copied next to no make-motion: the sibling lookup fails the way an install without it would.
function skillWithoutSibling() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-nomotion-')));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  for (const name of ['scripts', 'shared', 'template', 'references', 'package.json']) fs.cpSync(path.join(SKILL, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  for (const f of ['demo.mp4', 'poster.png', 'motion.json']) fs.copyFileSync(path.join(FIXTURES, f), path.join(root, f));
  return { root, copy };
}
const INSTALL = 'npx skills add abhijitbansal/claude-skills --skill make-explainer make-motion';

test('without make-motion, a spec section fails validation with the install command; a video never needs it', () => {
  const { root, copy } = skillWithoutSibling();
  const spec = path.join(root, 'a.explainer.json');
  const run = (sections) => {
    fs.writeFileSync(spec, JSON.stringify(doc(sections)));
    return spawnSync(process.execPath, [path.join(copy, 'scripts/validate.mjs'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  };
  const r = run([{ type: 'motion', spec: 'motion.json' }]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('sections[0].spec: make-motion skill not found next to make-explainer'), r.stdout);
  assert.ok(r.stdout.includes(`install it with: ${INSTALL}`), r.stdout);
  assert.equal(run([video({ poster: 'poster.png' })]).status, 0);
});

test('without make-motion, buildPage lets the SiblingError through for a spec section', async () => {
  const { root, copy } = skillWithoutSibling();
  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  await assert.rejects(page.buildPage(doc([{ type: 'motion', spec: 'motion.json' }]), { dir: root, out: out(root) }), (e) => {
    assert.equal(e.name, 'SiblingError');
    assert.equal(e.command, INSTALL);
    return true;
  });
  assert.match((await page.buildPage(doc([video()]), { dir: root, out: out(root) })).html, /<video /);
});

// ---- rendering a video ---------------------------------------------------------------------

test('the page embeds the video with controls, metadata preload and a relative src, and inlines the poster (the CSP allows images from data: only)', async () => {
  const dir = folder();
  const { html, assets } = await make([text, video({ poster: 'poster.png', caption: 'A **tour**' })], dir);
  assert.match(html, /<video controls preload="metadata" playsinline poster="data:image\/png;base64,[A-Za-z0-9+/=]+" src="page\.assets\/demo\.mp4" aria-label="Demo">/);
  assert.ok(html.includes(`poster="data:image/png;base64,${fs.readFileSync(path.join(dir, 'poster.png')).toString('base64')}"`), 'the poster is the given picture, inlined');
  assert.ok(!/autoplay/i.test(html), 'a video never autoplays');
  assert.match(html, /<figcaption>A <strong>tour<\/strong><\/figcaption>/);
  assert.match(html, /<a href="page\.assets\/demo\.mp4">Download the video<\/a>/);
  assert.deepEqual(assets.map((a) => [path.basename(path.dirname(a.to)), path.basename(a.to)]), [['page.assets', 'demo.mp4']], 'the poster is inlined, so only the video is copied');
  assert.equal(assets[0].from, path.join(dir, 'demo.mp4'));
  assert.equal(assets[0].to.startsWith(path.join(dir, 'page.assets') + path.sep), true);
});

test('the video has an accessible name: the section title, else the caption, else "Video"', async () => {
  const dir = folder();
  const label = async (extra) => /aria-label="([^"]*)"/.exec((await make([video({ title: undefined, ...extra })], dir)).html.split('<video')[1])[1];
  assert.equal(await label({ title: 'Demo run' }), 'Demo run');
  assert.equal(await label({ caption: 'A *tour*' }), 'A tour');
  assert.equal(await label({}), 'Video');
});

test('two motion sections never share an asset name, even from the same file', async () => {
  const dir = folder();
  const { assets } = await make([video(), video({ title: 'Again' })], dir);
  assert.equal(assets.length, 2);
  assert.notEqual(assets[0].to, assets[1].to);
});

test('the slug is URL-encoded in the src, like the chart links', async () => {
  const dir = folder();
  const { html } = await buildPage(doc([video()]), { dir, out: path.join(dir, 'my page.html') });
  assert.match(html, /src="my%20page\.assets\/[^"/]+\.mp4"/);
});

test('slides mode embeds the video too, named after the slide', async () => {
  const dir = folder();
  const { html, assets } = await buildPage(doc([text, video()], { mode: 'slides' }), { dir, out: out(dir) });
  assert.match(html, /<section class="slide slide-motion" id="slide-3"/);
  assert.match(html, /src="page\.assets\/slide-3\.mp4"/);
  assert.equal(path.basename(assets[0].to), 'slide-3.mp4');
});

test('CSP: media-src is on the page exactly when a motion section is', async () => {
  const dir = folder();
  assert.match((await make([text, video()], dir)).html, /; media-src &#39;self&#39; file: blob:"/);
  assert.ok(!(await make([text], dir)).html.includes('media-src'));
  assert.ok(contentSecurityPolicy(doc([video()])).endsWith("; media-src 'self' file: blob:"));
  assert.ok(!contentSecurityPolicy(doc([text])).includes('media-src'));
});

test('the motion stylesheet ships once, and only on a page with a motion section', async () => {
  const dir = folder();
  const withTwo = (await make([video(), video()], dir)).html;
  assert.ok(withTwo.includes('.mo video'));
  assert.equal((withTwo.match(/\/\* motion \*\//g) ?? []).length, 1);
  assert.ok(!(await make([text], dir)).html.includes('/* motion */'));
});

test('build() copies the video next to the page', async () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'a.explainer.json'), JSON.stringify(doc([video({ poster: 'poster.png' })])));
  const target = path.join(dir, 'dist', 'a.html');
  const r = await build(path.join(dir, 'a.explainer.json'), { out: target });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const copied = fs.readdirSync(path.join(dir, 'dist', 'a.assets')).sort();
  assert.equal(copied.length, 1);
  const [mp4] = copied;
  assert.deepEqual(fs.readFileSync(path.join(dir, 'dist', 'a.assets', mp4)), fs.readFileSync(path.join(dir, 'demo.mp4')));
  assert.match(fs.readFileSync(target, 'utf8'), new RegExp(`src="a\\.assets/${mp4.replace('.', '\\.')}"`));
});

test('a render with a missing file still fails loudly (a spec that skipped validation)', async () => {
  const dir = folder();
  await assert.rejects(make([text, video({ video: 'gone.mp4' })], dir), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[1].video');
    assert.match(e.errors[0].message, /file not found/);
    return true;
  });
});

// ---- rendering a spec ----------------------------------------------------------------------

async function canRender() {
  if (NO_RENDER) return 'not supported on this platform';
  try { await findFfmpeg(); } catch { return 'no ffmpeg'; }
  return (await haveBrowser()) ? null : 'no browser (bundled Chromium or system Chrome)';
}

test('a spec section is rendered by make-motion into a video and a poster frame; nothing else is left behind', async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const dir = folder();
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('explainer-motion-render')));
  const { html, assets } = await buildPage(doc([text, { type: 'motion', title: 'Hello', spec: 'motion.json' }]), { dir, out: out(dir) });
  const [mp4, ...rest] = assets;
  assert.equal(path.basename(mp4.to), 'hello.mp4');
  assert.deepEqual(rest, [], 'the poster frame is inlined in the page');
  assert.ok(Buffer.isBuffer(mp4.content) && mp4.content.length > 500, 'the rendered video is held for the build to write');
  assert.equal(mp4.content.toString('latin1', 4, 8), 'ftyp');
  assert.match(html, /poster="data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+"/, 'a frame of the rendered video, as a PNG');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['demo.mp4', 'motion.json', 'poster.png'], 'nothing written into the spec folder');
  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('explainer-motion-render') && !before.has(f));
  assert.deepEqual(after, [], 'the temporary render folder is removed');
  return undefined;
});

test('a given poster wins over the extracted frame', async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const dir = folder();
  const { html } = await make([{ type: 'motion', spec: 'motion.json', poster: 'poster.png' }], dir);
  assert.ok(html.includes(`poster="data:image/png;base64,${fs.readFileSync(path.join(dir, 'poster.png')).toString('base64')}"`));
  return undefined;
});

test('a page that fails after the render leaves nothing behind: no files, no temporary folder', async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const dir = folder();
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('explainer-motion-render')));
  // buildPage is called on a spec that skipped validation, so the later section fails only at render time.
  await assert.rejects(make([{ type: 'motion', spec: 'motion.json' }, { type: 'image', src: 'gone.png', alt: 'x' }], dir), BuildError);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['demo.mp4', 'motion.json', 'poster.png']);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('explainer-motion-render') && !before.has(f)), []);
  return undefined;
});

// ---- when make-motion cannot run -----------------------------------------------------------

const BUILD = path.join(SKILL, 'scripts/build.mjs');
const runBuild = (spec, env) => spawnSync(process.execPath, [BUILD, spec, '--out', path.join(path.dirname(spec), 'a.html')], {
  encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', ...env },
});

test('with no ffmpeg the build fails at the section with what is missing and make-motion\'s own install hint', () => {
  const dir = folder();
  const spec = path.join(dir, 'a.explainer.json');
  fs.writeFileSync(spec, JSON.stringify(doc([text, { type: 'motion', spec: 'motion.json' }])));
  const r = runBuild(spec, { PATH: '/nonexistent', FFMPEG_PATH: '' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^sections\[1\]\.spec: make-motion cannot render this spec: it needs ffmpeg and a Chromium browser\./m);
  assert.match(r.stdout, /ffmpeg not found\. Install it \(macOS: brew install ffmpeg/);
  assert.ok(!fs.existsSync(path.join(dir, 'a.html')));
});

test('a render that outlives its time limit is stopped, and the error says so and how to raise the limit', () => {
  const dir = folder();
  const spec = path.join(dir, 'a.explainer.json');
  fs.writeFileSync(spec, JSON.stringify(doc([{ type: 'motion', spec: 'motion.json' }])));
  const r = runBuild(spec, { PA_MOTION_TIMEOUT_MS: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^sections\[0\]\.spec: make-motion did not finish within 1 ms; .*PA_MOTION_TIMEOUT_MS/m);
});

test('renderFailure names ffmpeg, the browser or both, and passes any other failure through', () => {
  const ffmpeg = renderFailure({ status: 1, stderr: 'ffmpeg not found. Install it (macOS: brew install ffmpeg)\n' });
  assert.match(ffmpeg, /^make-motion cannot render this spec: it needs ffmpeg and a Chromium browser\. ffmpeg not found\./);
  assert.match(ffmpeg, /brew install ffmpeg/);
  const browser = renderFailure({ status: 1, stderr: 'No browser available. Run: npx playwright install chromium\n(bundled Chromium: x)\n' });
  assert.match(browser, /needs ffmpeg and a Chromium browser\. No browser available\. Run: npx playwright install chromium/);
  assert.equal(renderFailure({ status: null, signal: 'SIGKILL', stderr: '' }), 'make-motion was stopped by SIGKILL');
  assert.match(renderFailure({ error: Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }), stderr: '' }), /^make-motion could not start: spawn x ENOENT/);
  assert.match(renderFailure({ timedOut: true, signal: 'SIGKILL' }, { timeoutMs: 5 }), /^make-motion did not finish within 5 ms; .*PA_MOTION_TIMEOUT_MS/);
});

test('renderFailure shows a bounded tail of the output, not just the last line', () => {
  const stderr = `${Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  const text = renderFailure({ status: 1, stderr });
  assert.match(text, /^make-motion failed \(exit 1\); the end of its output:\n/);
  assert.ok(text.includes('line 30') && text.includes('line 25'), text);
  assert.ok(!text.includes('line 20\n') && !text.includes('line 1\n'), 'older lines are cut');
  assert.ok(text.split('\n').length <= 10);
  const spec = renderFailure({ status: 1, stderr: '', stdout: 'sections\nscenes[0].duration: required\nm.json: 1 error\n' });
  assert.match(spec, /scenes\[0\]\.duration: required\n.*m\.json: 1 error$/s, 'the output of a failed validation is shown whole, not just its summary line');
  const long = renderFailure({ status: 1, stderr: `${'x'.repeat(2000)}\n` });
  assert.ok(long.length < 600, 'a very long line is cut');
});

// ---- child processes: a time limit that holds ------------------------------------------------------

const stub = (body) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-stub-')));
  made.push(dir);
  const file = path.join(dir, 'stub.mjs');
  fs.writeFileSync(file, body);
  return { file, dir };
};
const IGNORES_SIGTERM = "process.on('SIGTERM', () => {}); process.stderr.write('started\\n'); setInterval(() => {}, 1000);";

test('runChild: SIGTERM first, then SIGKILL after the grace period, so a child that ignores SIGTERM cannot hang the build', async () => {
  const { file, dir } = stub(IGNORES_SIGTERM);
  const t0 = Date.now();
  const r = await runChild(process.execPath, [file], { cwd: dir, timeoutMs: 300, graceMs: 300 });
  const took = Date.now() - t0;
  assert.equal(r.timedOut, true);
  assert.equal(r.signal, 'SIGKILL');
  assert.ok(took >= 550 && took < 4000, `took ${took} ms`);
  assert.match(r.stderr, /started/);
});

test('runChild: a child that exits on SIGTERM is not killed harder', async () => {
  const { file, dir } = stub("process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1000);");
  const r = await runChild(process.execPath, [file], { cwd: dir, timeoutMs: 200, graceMs: 5000 });
  assert.equal(r.timedOut, true);
  assert.equal(r.status, 7);
});

test('runChild: success, failure and a spawn error are reported, and lots of output is kept only as a bounded tail', async () => {
  const { file, dir } = stub("process.stdout.write('a'.repeat(20 * 1024 * 1024)); process.stdout.write('\\nEND\\n'); process.stderr.write('warn\\n'); process.exitCode = process.argv[2] === 'fail' ? 3 : 0;");
  const ok = await runChild(process.execPath, [file], { cwd: dir, timeoutMs: 20000 });
  assert.equal(ok.status, 0);
  assert.equal(ok.timedOut, false);
  assert.ok(ok.stdout.endsWith('END\n') && ok.stdout.length < 200 * 1024, `kept ${ok.stdout.length} bytes`);
  assert.equal(ok.stderr, 'warn\n');
  assert.equal((await runChild(process.execPath, [file, 'fail'], { cwd: dir, timeoutMs: 20000 })).status, 3);
  const missing = await runChild(path.join(dir, 'no-such-program'), [], { cwd: dir, timeoutMs: 1000 });
  assert.equal(missing.error.code, 'ENOENT');
});

test('posterFrame: an ffmpeg that hangs and ignores SIGTERM is stopped, and there is no poster instead of a hung build', async () => {
  const { file, dir } = stub(`#!${process.execPath}\n${IGNORES_SIGTERM}`);
  fs.chmodSync(file, 0o755);
  const saved = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = file;
  try {
    const t0 = Date.now();
    assert.equal(await posterFrame(path.join(dir, 'v.mp4'), dir, 1, { timeoutMs: 300, graceMs: 300 }), undefined);
    assert.ok(Date.now() - t0 < 4000);
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved;
  }
});

test('a rendered video gets the same size cap as a user video', async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const dir = folder();
  await assert.rejects(renderMotion(path.join(dir, 'motion.json'), { scenes: [{ duration: 1 }] }, process.env, { maxBytes: 100 }), (e) => {
    assert.equal(e.errors[0].path, 'spec');
    assert.match(e.errors[0].message, /^rendered video is \d+\.\d+ MB; the limit is \S+ MB — shorten it or lower the size in the spec/);
    return true;
  });
  return undefined;
});

// ---- the page theme reaches the embedded motion spec -------------------------------------------------

test('motionArgs: a motion spec without a theme is rendered with the page theme, one with its own keeps it', () => {
  assert.deepEqual(motionArgs('/s/m.json', '/t/v.mp4', {}, 'ink'), ['/s/m.json', '--out', '/t/v.mp4', '--theme', 'ink']);
  assert.deepEqual(motionArgs('/s/m.json', '/t/v.mp4', { theme: 'paper' }, 'ink'), ['/s/m.json', '--out', '/t/v.mp4']);
  assert.deepEqual(motionArgs('/s/m.json', '/t/v.mp4', {}, undefined), ['/s/m.json', '--out', '/t/v.mp4']);
});

test('end to end: the poster frame follows the page theme, and a motion spec with its own theme ignores it', async (t) => {
  const why = await canRender();
  if (why) return t.skip(why);
  const frame = async (motion, theme) => {
    const dir = folder({ 'm.json': motion });
    const { html } = await buildPage(doc([{ type: 'motion', spec: 'm.json' }], { theme }), { dir, out: out(dir) });
    return /poster="([^"]+)"/.exec(html)[1];
  };
  const base = { size: [160, 90], scenes: [{ id: 's', duration: 1, elements: [] }] };
  assert.notEqual(await frame(base, 'blueprint'), await frame(base, 'paper'), 'no theme in the spec: the page theme paints the video');
  const own = { ...base, theme: 'ink' };
  assert.equal(await frame(own, 'blueprint'), await frame(own, 'paper'), 'a theme in the spec wins');
  return undefined;
});


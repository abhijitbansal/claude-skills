// Task 21: the `lottie` element. lottie-web's light SVG build (no expression engine) plays a Lottie JSON file the spec
// names, seeked per frame with goToAndStop; template/lottie-guard.mjs refuses remote assets, remote fonts, non-raster
// data URLs, external segments and expressions, in the validator and again in the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lottieProblems, lottieFrame, stripDomNames, MAX_LOTTIE_BYTES, MAX_LOTTIE_DEPTH, MAX_LOTTIE_ASSETS, LOTTIE_SPEED } from '../template/lottie-guard.mjs';
import { MAX_REPEATER_COPIES, MAX_ZIGZAG_RIDGES, MAX_STAR_POINTS, MAX_GRADIENT_STOPS, MAX_LOTTIE_ELEMENTS } from '../template/lottie-budget.mjs';
import { readyBudget, waitReady } from '../scripts/lib/ready.mjs';
import { validateSpec, loadSpec } from '../scripts/lib/spec.mjs';
import { startServer, assetSrcs } from '../scripts/lib/server.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { withDefaults } from '../template/defaults.mjs';
import { framed, probed, pixelsOf } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically, renderHash } from './helpers/render.mjs';
import { solidPng } from './helpers/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/lottie-badge.json');
const BADGE = path.join(root, 'references/examples/data/badge.lottie.json');
const FIXTURES = path.join(root, 'test/fixtures/data');
const CHECK = path.join(root, 'scripts/check.mjs');
const SMALL = ['--fps', '10', '--size', '320x180'];
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));
const said = (problems) => problems.map((p) => `${p.path}: ${p.message}`);

// ---- Lottie documents built in the tests ---------------------------------------------------------------------------------

const still = (k) => ({ a: 0, k });
const TRANSFORM = { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) };
// A square of `size` px in colour `rgb` (0-1), centred, turning from 0 to `turn` degrees across the layer.
function squareLayer({ ind = 1, rgb = [1, 1, 1], ip = 0, op = 30, size = 60, turn = 0, w = 100, h = 100 } = {}) {
  const r = turn ? { a: 1, k: [{ t: ip, s: [0], o: { x: [0.5], y: [0.5] }, i: { x: [0.5], y: [0.5] } }, { t: op, s: [turn] }] } : still(0);
  return {
    ddd: 0, ind, ty: 4, nm: `square ${ind}`, sr: 1, ao: 0, ip, op, st: 0, bm: 0,
    ks: { o: still(100), r, p: still([w / 2, h / 2, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) },
    shapes: [{ ty: 'gr', nm: 'square', it: [{ ty: 'rc', d: 1, p: still([0, 0]), s: still([size, size]), r: still(0) }, { ty: 'fl', c: still([...rgb, 1]), o: still(100), r: 1 }, TRANSFORM] }],
  };
}
const doc = (extra = {}) => ({ v: '5.7.4', fr: 30, ip: 0, op: 30, w: 100, h: 100, ddd: 0, assets: [], layers: [squareLayer()], ...extra });
const PNG_DATA = `data:image/png;base64,${solidPng(4, 4, [20, 200, 90]).toString('base64')}`;
const imageAsset = (p, extra = {}) => ({ id: 'image_0', w: 4, h: 4, u: '', p, e: 1, ...extra });
const imageLayer = (refId = 'image_0') => ({ ddd: 0, ind: 9, ty: 2, nm: 'picture', refId, sr: 1, ao: 0, ip: 0, op: 30, st: 0, bm: 0,
  ks: { o: still(100), r: still(0), p: still([50, 50, 0]), a: still([2, 2, 0]), s: still([1000, 1000, 100]) } });

// ---- lottieProblems -------------------------------------------------------------------------------------------------------

test('lottieProblems: the remote-asset fixture names the asset whose p is a URL', () => {
  assert.deepEqual(said(lottieProblems(readJson(path.join(FIXTURES, 'lottie-remote.json')))), ['assets[2].p: remote assets are not allowed; embed the image as a data URL']);
});

test('lottieProblems: the expression fixture names the property that carries one', () => {
  assert.deepEqual(said(lottieProblems(readJson(path.join(FIXTURES, 'lottie-expression.json')))), ['layers[0].ks.p.x: expressions are not supported']);
});

test('lottieProblems: a string x on an object with no k (a layer, the text layer, the root) is not an expression', () => {
  const layer = { ...squareLayer(), t: { d: { k: [{ s: { t: 'Hi', f: 'Arial', s: 20 }, t: 0 }] }, x: 'exporter note' }, x: 'a note' };
  assert.deepEqual(lottieProblems(doc({ layers: [layer] })), []);
  assert.deepEqual(lottieProblems(doc({ layers: [squareLayer()], x: 'root note' })), []);
});

test('lottieProblems: every form lottie-web\'s full build evaluates is an expression: { k, x } with no a, a text document t.d.x, and an x a slot merges in', () => {
  const noA = { ...squareLayer(), ks: { ...squareLayer().ks, o: { k: 100, x: 'time * 10' } } };
  const text = { ...squareLayer(), t: { d: { k: [{ s: { t: 'Hi', f: 'Arial', s: 20 }, t: 0 }], x: 'thisLayer.name' } } };
  assert.deepEqual(said(lottieProblems(doc({ layers: [noA, text], slots: { s1: { p: { x: 'wiggle(1, 1)' } } } }))), [
    'layers[0].ks.o.x: expressions are not supported',
    'layers[1].t.d.x: expressions are not supported',
    'slots.s1.p.x: expressions are not supported',
  ]);
});

test('lottieProblems: an expression is found at any depth, in a keyframed property, a precomp and a slot', () => {
  const deep = squareLayer();
  deep.shapes[0].it[0].s = { a: 1, k: [{ t: 0, s: [10, 10] }, { t: 30, s: [60, 60] }], x: 'loopOut()' };
  const precomp = { id: 'comp_0', layers: [{ ...squareLayer(), ks: { ...squareLayer().ks, o: { a: 0, k: 100, x: 'thisComp.layer(1)' } } }] };
  assert.deepEqual(said(lottieProblems(doc({ layers: [deep], assets: [precomp], slots: { tint: { p: { a: 0, k: [1, 0, 0, 1], x: 'time' } } } }))), [
    'assets[0].layers[0].ks.o.x: expressions are not supported', // document order: doc() writes assets before layers
    'layers[0].shapes[0].it[0].s.x: expressions are not supported',
    'slots.tint.p.x: expressions are not supported',
  ]);
});

test('lottieProblems: a file without v, fr, ip, op, layers, w or h is not a Lottie file', () => {
  for (const key of ['v', 'fr', 'ip', 'op', 'layers', 'w', 'h']) {
    const { [key]: _gone, ...rest } = doc();
    assert.deepEqual(said(lottieProblems(rest)), [`(root): not a Lottie file (missing ${key})`], key);
  }
  for (const value of [null, [], 'x', 3]) assert.deepEqual(said(lottieProblems(value)), ['(root): not a Lottie file (not a JSON object)'], JSON.stringify(value));
  assert.deepEqual(said(lottieProblems(doc({ fr: 0 }))), ['fr: must be a number above 0']);
  assert.deepEqual(said(lottieProblems(doc({ op: 0 }))), ['op: must be a number above ip (0)']);
  assert.deepEqual(said(lottieProblems(doc({ w: '100' }))), ['w: must be a number above 0']);
  assert.deepEqual(said(lottieProblems(doc({ layers: {} }))), ['layers: must be an array']);
  assert.deepEqual(said(lottieProblems(doc({ assets: {} }))), ['assets: must be an array']);
});

test('lottieProblems: an asset with a non-empty u, or a p that is not a data URL, is remote; a precomp has neither and passes', () => {
  assert.deepEqual(lottieProblems(doc({ assets: [{ id: 'comp', layers: [squareLayer()] }, imageAsset(PNG_DATA)], layers: [imageLayer()] })), []);
  const remote = 'remote assets are not allowed; embed the image as a data URL';
  assert.deepEqual(said(lottieProblems(doc({ assets: [imageAsset('img_0.png', { u: 'images/', e: 0 })] }))), [`assets[0].u: ${remote}`, `assets[0].p: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ assets: [imageAsset(PNG_DATA, { u: 'https://cdn.example/' })] }))), [`assets[0].u: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ assets: [imageAsset('//cdn.example/a.png')] }))), [`assets[0].p: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'x', w: 1, h: 1 }] }))), [`assets[0].p: ${remote}`], 'an image asset with no p');
});

test('lottieProblems: only PNG, JPEG and WebP data URLs may be embedded; svg+xml, gif, html and audio are refused', () => {
  for (const ok of [PNG_DATA, 'data:image/jpeg;base64,AAAA', 'data:image/webp;base64,AAAA', 'data:image/PNG;base64,AAAA']) {
    assert.deepEqual(lottieProblems(doc({ assets: [imageAsset(ok)] })), [], ok);
  }
  for (const bad of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/svg+xml,<svg onload="x()"/>', 'data:image/gif;base64,AAAA', 'data:text/html,<script>x</script>',
    'data:audio/mpeg;base64,AAAA', 'data:image/pngx;base64,AAAA', 'data:,hello', 'data:image/png']) {
    assert.deepEqual(said(lottieProblems(doc({ assets: [imageAsset(bad)] }))), ['assets[0].p: only PNG, JPEG or WebP images can be embedded (data:image/png, data:image/jpeg or data:image/webp)'], bad);
  }
});

test('lottieProblems: a data asset (t 3) and external segments are refused: lottie-web would fetch them', () => {
  assert.deepEqual(said(lottieProblems(doc({ assets: [imageAsset('data:application/json,{}', { t: 3 })] }))), ['assets[0].t: data assets (t 3) are not supported; keep the data in the layers']);
  assert.deepEqual(said(lottieProblems(doc({ segments: [{ time: 1 }] }))), ['segments: external segment files are not allowed; export the animation as one file']);
});

test('lottieProblems: an image slot is held to the asset rules', () => {
  assert.deepEqual(lottieProblems(doc({ slots: { pic: { p: { p: PNG_DATA, u: '', e: 1 } } } })), []);
  assert.deepEqual(said(lottieProblems(doc({ slots: { pic: { p: { p: 'https://x.example/a.png', u: '' } } } }))), ['slots.pic.p.p: remote assets are not allowed; embed the image as a data URL']);
  assert.deepEqual(said(lottieProblems(doc({ slots: { pic: { p: { p: 'data:image/svg+xml,<svg/>' } } } }))), ['slots.pic.p.p: only PNG, JPEG or WebP images can be embedded (data:image/png, data:image/jpeg or data:image/webp)']);
});

test('lottieProblems: remote fonts are refused; a system family (fOrigin n, no fPath) and embedded glyphs pass', () => {
  const font = (extra) => ({ fName: 'Sans', fFamily: 'Arial', fStyle: 'Regular', ascent: 70, ...extra });
  assert.deepEqual(lottieProblems(doc({ fonts: { list: [font({ fOrigin: 'n', fPath: '' }), font({ origin: 0 }), font({})] } })), []);
  assert.deepEqual(lottieProblems(doc({ fonts: { list: [font({ fOrigin: 'n' })] }, chars: [{ ch: 'A', fFamily: 'Arial', size: 10, style: 'Regular', w: 60, data: { shapes: [] } }] })), []);
  const remote = 'remote fonts are not allowed; use a system font (fOrigin "n", no fPath) or embed the glyphs (chars)';
  assert.deepEqual(said(lottieProblems(doc({ fonts: { list: [font({ fOrigin: 'g', fPath: 'https://fonts.googleapis.com/css?family=Roboto' })] } }))), [`fonts.list[0].fPath: ${remote}`, `fonts.list[0].fOrigin: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ fonts: { list: [font({ fPath: 'fonts/a.woff' })] } }))), [`fonts.list[0].fPath: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ fonts: { list: [font({ fOrigin: 't' })] } }))), [`fonts.list[0].fOrigin: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ fonts: { list: [font({ origin: 3 })] } }))), [`fonts.list[0].origin: ${remote}`]);
  assert.deepEqual(said(lottieProblems(doc({ fonts: { list: 'x' } }))), ['fonts.list: must be an array']);
});

test('lottieProblems: a __proto__ key anywhere is refused, and no lookup reaches Object.prototype', () => {
  const hostile = JSON.parse('{"v":"5","fr":30,"ip":0,"op":30,"w":10,"h":10,"layers":[{"ks":{"__proto__":{"x":"evil()"},"p":{"a":0,"k":[0,0]}}}]}');
  assert.deepEqual(said(lottieProblems(hostile)), ['layers[0].ks.__proto__: the key "__proto__" is not allowed']);
  const inherits = Object.create({ a: 1, k: 2, x: 'inherited()' });
  assert.deepEqual(lottieProblems(doc({ layers: [{ ...squareLayer(), ks: { p: inherits } }] })), [], 'only own keys count');
  assert.deepEqual(said(lottieProblems(JSON.parse('{"__proto__":{"fr":30},"v":"5","ip":0,"op":30,"w":10,"h":10,"layers":[]}'))), ['(root): not a Lottie file (missing fr)']);
});

test('lottieProblems: nesting is capped without recursion, and so is the asset count', () => {
  let deep = { a: 0, k: 1 };
  for (let i = 0; i < 200000; i++) deep = [deep];
  const problems = said(lottieProblems(doc({ layers: [{ ...squareLayer(), deep }] })));
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^layers\\[0\\]\\.deep(\\[0\\])+: nested more than ${MAX_LOTTIE_DEPTH} levels deep; this is not a Lottie file an exporter writes$`));
  const assets = Array.from({ length: MAX_LOTTIE_ASSETS + 1 }, (_, i) => ({ id: `c${i}`, layers: [] }));
  assert.deepEqual(said(lottieProblems(doc({ assets }))), [`assets: ${MAX_LOTTIE_ASSETS + 1} assets; at most ${MAX_LOTTIE_ASSETS}`]);
  assert.deepEqual(lottieProblems(doc({ assets: assets.slice(1) })), []);
});

test('lottieProblems: the badge example is clean', () => {
  assert.deepEqual(lottieProblems(readJson(BADGE)), []);
});

// ---- lottieFrame -----------------------------------------------------------------------------------------------------------

test('lottieFrame: (t - offset) x speed x fr from the in point, held at the in point before and at the last frame (op - 1) after', () => {
  const timing = { fr: 30, ip: 0, op: 60 };
  assert.equal(lottieFrame(0.5, {}, timing), 15);
  assert.equal(lottieFrame(0.5, { offset: 0.2 }, timing), 9, 'rounded to a millionth of a frame, so float noise never reaches the page');
  assert.equal(lottieFrame(0.1, { offset: 0.2 }, timing), 0, 'before the offset it holds the in point');
  assert.equal(lottieFrame(0.5, { speed: 2 }, timing), 30);
  assert.equal(lottieFrame(0.5, { speed: 0.25 }, timing), 3.75, 'a fraction is kept: lottie-web draws sub-frames');
  assert.equal(lottieFrame(5, {}, timing), 59, 'the last frame is op - 1: at op the layers that end there are gone');
  assert.equal(lottieFrame(1, {}, { fr: 24, ip: 10, op: 40 }), 24, 'relative to ip, as goToAndStop counts');
  assert.equal(lottieFrame(9, {}, { fr: 24, ip: 10, op: 40 }), 29);
  assert.equal(lottieFrame(0, {}, { fr: 30, ip: 0, op: 0.5 }), 0, 'a file shorter than one frame stays at its first');
  assert.deepEqual(LOTTIE_SPEED, [0.25, 4]);
});

// ---- validation ------------------------------------------------------------------------------------------------------------

const lottieEl = (extra = {}) => ({ id: 'l', type: 'lottie', src: 'anim.json', x: 160, y: 90, width: 100, height: 100, ...extra });
const one = (el, extra = {}) => ({ size: [320, 180], background: '#000000', scenes: [{ id: 's', duration: 2, elements: [el] }], ...extra });
// A folder holding anim.json (`lottie`, an object or raw text) and motion.json; returns the folder.
function folder(lottie = doc(), motion = one(lottieEl())) {
  const dir = tmp('lottie-');
  writeFileSync(path.join(dir, 'anim.json'), typeof lottie === 'string' ? lottie : JSON.stringify(lottie));
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
  return dir;
}
const errs = (motion, dir) => validateSpec(motion, { dir }).errors.map((e) => `${e.path}: ${e.message}`);

test('a lottie element with src, width and height validates; offset and speed are optional; each required field is named', () => {
  const dir = folder();
  assert.deepEqual(errs(one(lottieEl()), dir), []);
  assert.deepEqual(errs(one(lottieEl({ offset: 0.5, speed: 0.25, opacity: 0.8, scale: 1.1, rotate: 4, hold: true, keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1, x: 170 }] })), dir), []);
  const { src: _s, width: _w, height: _h, ...bare } = lottieEl();
  assert.deepEqual(errs(one(bare), dir), ['scenes[0].elements[0].src: required for type lottie', 'scenes[0].elements[0].width: required for type lottie', 'scenes[0].elements[0].height: required for type lottie']);
  assert.match(errs(one(lottieEl({ fit: 'cover' })), dir)[0], /^scenes\[0\]\.elements\[0\]\.fit: not valid on lottie; allowed: .*src, width, height, offset, speed$/);
});

test('speed is 0.25 to 4 and offset at least 0; a grade, a value keyframe or a draw keyframe is refused', () => {
  const dir = folder();
  assert.deepEqual(errs(one(lottieEl({ speed: 0.2 })), dir), ['scenes[0].elements[0].speed: must be >= 0.25']);
  assert.deepEqual(errs(one(lottieEl({ speed: 4.5 })), dir), ['scenes[0].elements[0].speed: must be <= 4']);
  assert.deepEqual(errs(one(lottieEl({ speed: 4, offset: 0 })), dir), []);
  assert.deepEqual(errs(one(lottieEl({ offset: -1 })), dir), ['scenes[0].elements[0].offset: must be >= 0']);
  assert.deepEqual(errs(one(lottieEl({ grade: { preset: 'warm' } })), dir), ['scenes[0].elements[0].grade: only valid on image or video elements']);
  assert.deepEqual(errs(one(lottieEl({ keyframes: [{ t: 0, value: 1 }] })), dir), ['scenes[0].elements[0].keyframes[0].value: not animatable on lottie; animatable: opacity, x, y, scale, rotate']);
  assert.match(errs(one({ ...lottieEl(), speed: 2, type: 'image' }), dir)[0], /speed: not valid on image/);
});

test('offset and speed may come from vars; "beat:<n>" is not an offset (it times keyframes and cues only)', () => {
  const dir = folder();
  const motion = { vars: { delay: { type: 'number', default: 0.5 }, rate: { type: 'number', default: 2 } }, ...one(lottieEl({ offset: '{{delay}}', speed: '{{rate}}' })) };
  assert.deepEqual(errs(motion, dir), []);
  const el = withDefaults(motion).scenes[0].elements[0];
  assert.deepEqual([el.offset, el.speed], [0.5, 2]);
  assert.deepEqual(errs(one(lottieEl({ offset: 'beat:2' })), dir), ['scenes[0].elements[0].offset: must be number']);
});

test('the lottie src follows the asset path rules: relative, inside the spec folder, no symlink out, no dotfile', () => {
  const dir = folder();
  const outside = tmp('lottie-outside-');
  writeFileSync(path.join(outside, 'x.json'), JSON.stringify(doc()));
  symlinkSync(path.join(outside, 'x.json'), path.join(dir, 'link.json'));
  writeFileSync(path.join(dir, '.hidden.json'), JSON.stringify(doc()));
  const at = (src) => errs(one(lottieEl({ src })), dir);
  assert.deepEqual(at('../x.json'), ['scenes[0].elements[0].src: must stay inside the spec folder']);
  assert.deepEqual(at('link.json'), ['scenes[0].elements[0].src: must stay inside the spec folder']);
  assert.deepEqual(at('.hidden.json'), ['scenes[0].elements[0].src: hidden files are not allowed']);
  assert.deepEqual(at('https://example.com/a.json'), ['scenes[0].elements[0].src: must be a path relative to the spec file']);
  assert.deepEqual(at('missing.json'), ['scenes[0].elements[0].src: file not found: missing.json']);
});

test('a .lottie archive or another extension is refused with what to export; a file that is not JSON says so', () => {
  const dir = folder();
  writeFileSync(path.join(dir, 'a.lottie'), 'PK');
  writeFileSync(path.join(dir, 'a.txt'), '{}');
  assert.deepEqual(errs(one(lottieEl({ src: 'a.lottie' })), dir), ['scenes[0].elements[0].src: a .lottie archive is not supported; export the animation as Lottie JSON (.json)']);
  assert.deepEqual(errs(one(lottieEl({ src: 'a.txt' })), dir), ['scenes[0].elements[0].src: unsupported lottie format ".txt"; use a Lottie JSON file (.json)']);
  const broken = folder('{ "v": ');
  assert.match(errs(one(lottieEl()), broken)[0], /^scenes\[0\]\.elements\[0\]\.src: anim\.json is not valid JSON: /);
});

test('a lottie file over the size cap is refused before it is parsed', () => {
  const big = `{"pad":"${'x'.repeat(MAX_LOTTIE_BYTES)}"}`;
  const dir = folder(big);
  assert.deepEqual(errs(one(lottieEl()), dir), [`scenes[0].elements[0].src: anim.json is ${big.length} bytes; a Lottie file may be at most ${MAX_LOTTIE_BYTES} bytes (4 MiB)`]);
});

test('the guard\'s problems reach the validator at the element\'s src, naming the file; more than five are summarised', () => {
  const dir = folder();
  for (const name of ['lottie-remote.json', 'lottie-expression.json']) writeFileSync(path.join(dir, name), readFileSync(path.join(FIXTURES, name)));
  assert.deepEqual(errs(one(lottieEl({ src: 'lottie-remote.json' })), dir), ['scenes[0].elements[0].src: assets[2].p: remote assets are not allowed; embed the image as a data URL (in lottie-remote.json)']);
  assert.deepEqual(errs(one(lottieEl({ src: 'lottie-expression.json' })), dir), ['scenes[0].elements[0].src: layers[0].ks.p.x: expressions are not supported (in lottie-expression.json)']);
  const many = doc({ layers: Array.from({ length: 8 }, (_, i) => ({ ...squareLayer({ ind: i + 1 }), ks: { ...squareLayer().ks, o: { a: 0, k: 100, x: 'time' } } })) });
  const dirMany = folder(many);
  const got = errs(one(lottieEl()), dirMany);
  assert.equal(got.length, 6);
  assert.equal(got[5], 'scenes[0].elements[0].src: and 3 more problems in anim.json');
});

test('a lottie inside a group validates, and the server lists its src as an asset', () => {
  const dir = folder();
  const motion = one({ id: 'g', type: 'group', x: 160, y: 90, children: [lottieEl({ x: 0, y: 0 })] });
  assert.deepEqual(errs(motion, dir), []);
  assert.deepEqual(assetSrcs(motion), ['anim.json']);
});

// ---- the server ----------------------------------------------------------------------------------------------------------

function get(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function withServer(dir, fn) {
  const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  try { await fn(srv); } finally { await srv.close(); }
}

test('the server serves the light lottie build alone, locked down; every other file of lottie-web is 404', () => withServer(folder(), async (srv) => {
  const light = await get(srv.url, '/vendor/lottie-web/lottie_light.min.js');
  assert.equal(light.status, 200);
  assert.equal(light.headers['x-content-type-options'], 'nosniff');
  assert.equal(light.headers['content-security-policy'], "default-src 'none'");
  assert.match(light.headers['content-type'], /^text\/javascript/);
  assert.doesNotMatch(light.body, /\beval\s*\(|new\s+Function\b|\bFunction\s*\(/, 'the served build has no dynamic code evaluation');
  for (const p of ['/vendor/lottie-web/lottie.min.js', '/vendor/lottie-web/lottie_svg.min.js', '/vendor/lottie-web/lottie_light_html.min.js', '/vendor/lottie-web/../lottie.js',
    '/vendor/lottie-web/..%2f..%2f..%2fpackage.json', '/vendor/lottie-web/%2e%2e/lottie_svg.js', '/vendor/lottie-web/lottie%5Flight.min.js', '/vendor/lottie-web/', '/vendor/lottie-web/LICENSE.md']) {
    assert.equal((await get(srv.url, p)).status, 404, p);
  }
}));

test('the page CSP allows no eval, and its importmap maps lottie-web to the light build', () => withServer(folder(), async (srv) => {
  const page = await get(srv.url, '/');
  const csp = page.headers['content-security-policy'];
  assert.doesNotMatch(csp, /unsafe-eval|wasm-unsafe-eval/);
  assert.match(csp, /script-src 'self' 'sha256-/);
  const imports = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page.body)[1]).imports;
  assert.equal(imports['lottie-web'], '/vendor/lottie-web/lottie_light.min.js');
}));

test('the lottie file is served from /assets only when the spec names it', () => {
  const dir = folder();
  writeFileSync(path.join(dir, 'other.json'), JSON.stringify(doc()));
  return withServer(dir, async (srv) => {
    const named = await get(srv.url, '/assets/anim.json');
    assert.equal(named.status, 200);
    assert.equal(named.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(JSON.parse(named.body), doc());
    assert.equal((await get(srv.url, '/assets/other.json')).status, 404);
    assert.equal((await get(srv.url, '/assets/motion.json')).status, 404);
  });
});

test('a symlink named as the lottie src is not served', () => {
  const outside = tmp('lottie-out-');
  writeFileSync(path.join(outside, 'secret.json'), JSON.stringify(doc()));
  const dir = folder(doc(), one(lottieEl({ src: 'link.json' })));
  symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'link.json'));
  return withServer(dir, async (srv) => assert.equal((await get(srv.url, '/assets/link.json')).status, 404));
});

// ---- the page --------------------------------------------------------------------------------------------------------------

// Opens the spec `file` (a folder: its motion.json) on the render page with guardNetwork on; returns what `probe` found,
// every request path, the blocked URLs, failed requests, page errors, CSP violations and the ready result (true, or the
// rejection message).
async function inPage(file, probe = () => null, { wait = 0 } = {}) {
  const specPath = file.endsWith('.json') ? file : path.join(file, 'motion.json');
  const srv = await startServer({ specPath, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const seen = { requests: [], blocked: [], failed: [], errors: [] };
    await guardNetwork(page, new URL(srv.url).origin, (url) => seen.blocked.push(url));
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    page.on('request', (r) => seen.requests.push(r.url().startsWith(srv.url) ? `/${r.url().slice(srv.url.length)}` : r.url()));
    page.on('requestfailed', (r) => seen.failed.push(r.url()));
    page.on('pageerror', (e) => seen.errors.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    const ready = await page.evaluate(() => window.__motion.ready.then(() => true, (e) => String(e?.message ?? e)));
    if (wait) await page.waitForTimeout(wait);
    const found = await page.evaluate(probe);
    const csp = await page.evaluate(() => window.__csp);
    return { ...seen, ready, found, csp };
  } finally { await browser.close(); await srv.close(); }
}

test('the render page makes no blocked request and fetches nothing for the lottie beyond /vendor and /assets; only the light build loads', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const got = await inPage(EXAMPLE, () => ({
    registered: window.bodymovin.getRegisteredAnimations().length,
    scanned: document.querySelectorAll('.lottie, .bodymovin').length,
    svgs: [...document.querySelectorAll('#stage .el[data-id="badge"] svg, #stage .el[data-id="fast"] svg')].filter((s) => !s.parentElement.closest('svg')).length,
  }), { wait: 400 });
  assert.equal(got.ready, true);
  assert.deepEqual(got.errors, []);
  assert.deepEqual(got.blocked, [], 'guardNetwork blocked nothing');
  assert.deepEqual(got.failed, [], 'no request failed');
  assert.deepEqual(got.csp, [], 'no CSP violation');
  const PAGE = /^\/(|template\/.*|theme\/.*|spec\.json|frames\.json|shared\/nowrap\.mjs|vendor\/(animejs|vega|vega-lite|vega-util|vega-interpreter)\/.*)$/;
  const extra = got.requests.filter((r) => !PAGE.test(r));
  assert.deepEqual([...new Set(extra)].sort(), ['/assets/data/badge.lottie.json', '/vendor/lottie-web/lottie_light.min.js'], 'the lottie adds its file (once per element) and the light build, nothing else (no worker blob, no font, no segment)');
  // lottie-web scans the page for class "lottie" or "bodymovin" 100 ms after it loads and starts a player on each match;
  // whether the stage is in the page by then is a race, so no node of ours may carry either class
  assert.equal(got.found.scanned, 0, 'no node the load-time scan would pick up');
  assert.equal(got.found.registered, 2, 'one animation per lottie element');
  assert.equal(got.found.svgs, 2, 'one <svg> per element');
});

test('a preview reload replaces the players instead of adding to them', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const srv = await startServer({ specPath: EXAMPLE, mode: 'preview' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const count = () => page.evaluate(() => [window.bodymovin.getRegisteredAnimations().length, document.querySelectorAll('#stage .el.lottie-player svg').length - document.querySelectorAll('#stage .el.lottie-player svg svg').length]);
    assert.deepEqual(await count(), [2, 2]);
    await page.evaluate(() => window.__reload());
    await page.evaluate(() => window.__reload());
    assert.deepEqual(await count(), [2, 2], 'two reloads later: still one player and one <svg> per element');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await srv.close(); }
});

test('a spec without a lottie element never loads lottie-web', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(doc(), one({ id: 't', type: 'text', text: 'Hi', x: 160, y: 90 }));
  const got = await inPage(dir);
  assert.equal(got.ready, true);
  assert.deepEqual(got.requests.filter((r) => r.startsWith('/vendor/lottie-web/') || r.startsWith('/assets/')), []);
});

test('the page refuses a remote-asset or expression file even when the validator was skipped, before lottie-web sees it', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const [name, message] of [['lottie-remote.json', 'assets[2].p: remote assets are not allowed; embed the image as a data URL'], ['lottie-expression.json', 'layers[0].ks.p.x: expressions are not supported']]) {
    const dir = folder(readJson(path.join(FIXTURES, name)));
    const got = await inPage(dir, () => document.getElementById('error').textContent);
    assert.equal(got.ready, `lottie anim.json: ${message}`, name);
    assert.equal(got.found, `lottie anim.json: ${message}`);
    assert.deepEqual(got.blocked, [], `${name}: nothing was fetched from outside`);
    assert.deepEqual(got.csp, [], `${name}: nothing was even attempted (a CSP block would hide it from guardNetwork)`);
    assert.equal(got.requests.filter((r) => r.includes('example.com')).length, 0);
  }
});

test('the page refuses a lottie file over the size cap', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const got = await inPage(folder(`{"pad":"${'x'.repeat(MAX_LOTTIE_BYTES)}"}`));
  assert.match(String(got.ready), /^lottie anim\.json is \d+ bytes; a Lottie file may be at most 4194304 bytes \(4 MiB\)$/);
});

test('the badge draws different frames at 0.5 s and 1.5 s, and the same frame twice', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = one(lottieEl({ src: 'data/badge.lottie.json', width: 160, height: 160 }));
  const files = { 'data/badge.lottie.json': readFileSync(BADGE) };
  const early = await framedIn(motion, 0.5, files);
  const late = await framedIn(motion, 1.5, files);
  const again = await framedIn(motion, 0.5, files);
  assert.notDeepEqual(early, late, 'the animation moved');
  assert.deepEqual(again, early, 'the same moment draws the same bytes');
});

// `framed` with files in a data/ subfolder (render-probe writes beside the spec only).
async function framedIn(motion, sec, files) {
  const dir = tmp('lottie-framed-');
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), body);
  }
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
  const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: motion.size[0], height: motion.size[1] }, deviceScaleFactor: 1 });
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    await page.evaluate((s) => window.__motion.seek(s), sec);
    return await page.screenshot({ type: 'png' });
  } finally { await browser.close(); await srv.close(); }
}

test('goToAndStop counts from the in point: a file with ip 10 shows frame 10 at t 0 and holds its last frame (op - 1) after the end', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // red from frame 10 to 20, blue from 20 to 40: frame 10 is red; frame 20 (what a double count of ip would draw) is blue
  const anim = doc({ ip: 10, op: 40, layers: [squareLayer({ ind: 1, rgb: [1, 0, 0], ip: 10, op: 20, size: 100 }), squareLayer({ ind: 2, rgb: [0, 0, 1], ip: 20, op: 40, size: 100 })] });
  const motion = one(lottieEl({ x: 160, y: 90, width: 180, height: 180 }), { size: [320, 180] });
  motion.scenes[0].duration = 3;
  const at = async (sec) => (await pixelsOf(await framed(motion, sec, { 'anim.json': JSON.stringify(anim) }), [[160, 90]]))[0];
  assert.deepEqual(await at(0), [255, 0, 0], 'frame ip is drawn at t 0');
  assert.deepEqual(await at(0.5), [0, 0, 255], 'frame ip + 15');
  assert.deepEqual(await at(2.9), [0, 0, 255], 'held at op - 1 after the end, not blank');
});

test('offset holds the first frame, speed scales the playhead: the page reports the frame it drew', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = one(lottieEl({ offset: 0.5, speed: 2 }));
  motion.scenes[0].elements.push(lottieEl({ id: 'plain', x: 60 }));
  const walk = async () => {
    const out = [];
    for (const sec of [0, 0.4, 0.75, 1, 1.9]) {
      await window.__motion.seek(sec);
      out.push([...document.querySelectorAll('#stage .el')].map((n) => n.dataset.frame));
    }
    return out;
  };
  const got = await probed(motion, `(${walk})()`, { 'anim.json': JSON.stringify(doc({ op: 30 })) });
  assert.deepEqual(got, [['0', '0'], ['0', '12'], ['15', '22.5'], ['29', '29'], ['29', '29']]);
});

test('in a render the lottie svg has no compositor hint: no 3D transform, no will-change, no content-visibility', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const got = await probed(one(lottieEl({ keyframes: [{ t: 0, opacity: 0.3 }, { t: 1, opacity: 1 }] })), () => [...document.querySelectorAll('#stage .el[data-id="l"], #stage .el[data-id="l"] *')].map((n) => {
    const s = getComputedStyle(n);
    const hints = [/3d/.test(n.style.transform) || s.transform.startsWith('matrix3d') ? `transform ${s.transform}` : '', s.willChange === 'auto' ? '' : `will-change ${s.willChange}`,
      s.contentVisibility === 'visible' ? '' : `content-visibility ${s.contentVisibility}`].filter(Boolean);
    return hints.length ? `${n.tagName}: ${hints.join(', ')}` : '';
  }).filter(Boolean), { 'anim.json': JSON.stringify(doc()) });
  assert.deepEqual(got, []);
});

test('renewal keeps the lottie intact: a walk that changes its pose and frame ends on the bytes a fresh seek gives', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const anim = doc({ op: 60, layers: [squareLayer({ turn: 90, op: 60, rgb: [0.9, 0.6, 0.1] })] });
  const motion = one(lottieEl({ keyframes: [{ t: 0, opacity: 0.2, x: 150 }, { t: 1, opacity: 1, x: 160, ease: 'outCubic' }, { t: 2, opacity: 0.9, x: 162 }] }));
  const files = { 'anim.json': JSON.stringify(anim) };
  const walked = await (async () => {
    const dir = tmp('lottie-walk-');
    writeFileSync(path.join(dir, 'anim.json'), files['anim.json']);
    writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
    const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
    const browser = await launchBrowser({ quiet: true });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
      await page.goto(srv.url);
      await page.waitForFunction(() => window.__motion);
      await page.evaluate(() => window.__motion.ready);
      for (const sec of [0.1, 1.7, 0.55, 0.9, 1.99, 0.3]) await page.evaluate((s) => window.__motion.seek(s), sec);
      await page.evaluate((s) => window.__motion.seek(s), 1.3);
      return await page.screenshot({ type: 'png' });
    } finally { await browser.close(); await srv.close(); }
  })();
  assert.deepEqual(walked, await framed(motion, 1.3, files));
});

// ---- check.mjs -------------------------------------------------------------------------------------------------------------

const runCheck = (dir) => spawnSync(process.execPath, [CHECK, path.join(dir, 'motion.json'), '--json'], { encoding: 'utf8' });

test('check: a lottie that animates is change for the dead-stretch audit; the same element with nothing to play is not', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = { size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 8, elements: [lottieEl({ x: 960, y: 540, width: 600, height: 600 })] }] };
  const playing = runCheck(folder(doc({ op: 180, layers: [squareLayer({ turn: 360, op: 180 })] }), motion));
  const dead = (r) => (JSON.parse(r.stdout).errors ?? []).filter((e) => /nothing changes/.test(e.message));
  assert.deepEqual(dead(playing), [], playing.stdout + playing.stderr);
  const short = runCheck(folder(doc({ op: 15, layers: [squareLayer({ turn: 360, op: 15 })] }), motion));
  assert.equal(dead(short).length, 1, 'a half-second animation held for 7.5 s is a dead stretch');
});

test('check: a lottie under a camera move and a slide transition, beside a graded image, passes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(doc({ op: 90, layers: [squareLayer({ turn: 180, op: 90 })] }));
  writeFileSync(path.join(dir, 'photo.png'), solidPng(16, 9, [30, 30, 30]));
  const caption = (id) => ({ id, type: 'text', text: 'Badge earned', x: 960, y: 900, fontSize: 72, fontWeight: 700, hold: true });
  const motion = { size: [1920, 1080], fps: 30, scenes: [
    { id: 'a', duration: 3, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.1 }] }, elements: [
      { id: 'photo', type: 'image', src: 'photo.png', x: 960, y: 540, width: 1920, height: 1080, fit: 'fill', hold: true, grade: { preset: 'film' } },
      lottieEl({ id: 'l1', x: 960, y: 450, width: 500, height: 500, hold: true }), caption('c1')] },
    { id: 'b', duration: 3, transition: { type: 'slide', direction: 'left', duration: 0.6 }, elements: [lottieEl({ id: 'l2', x: 960, y: 450, width: 500, height: 500, speed: 0.5, hold: true }), caption('c2')] }] };
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
  assert.deepEqual(errs(motion, dir), []);
  const r = runCheck(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

// ---- determinism -----------------------------------------------------------------------------------------------------------

test('a lottie with an embedded PNG, under a fade, a camera and keyframes, renders byte-identical twice and at 1 and 4 workers', async (t) => {
  if (!(await requireRender(t))) return;
  const anim = doc({ op: 45, assets: [imageAsset(PNG_DATA)], layers: [squareLayer({ turn: 120, op: 45, rgb: [0.2, 0.4, 1] }), imageLayer()] });
  const motion = { size: [320, 180], fps: 30, scenes: [
    { id: 'a', duration: 2, elements: [lottieEl({ keyframes: [{ t: 0, opacity: 0, x: 150 }, { t: 0.7, opacity: 1, x: 160, ease: 'outCubic' }, { t: 1.8, scale: 1.05 }] }),
      { id: 'title', type: 'text', text: 'Lottie', x: 160, y: 160, fontSize: 24 }] },
    { id: 'b', duration: 1.5, transition: 'fade', camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 1.5, zoom: 1.2, rotate: 2 }] }, elements: [lottieEl({ id: 'again', speed: 1.5, offset: 0.2 })] }] };
  const file = path.join(folder(anim, motion), 'motion.json');
  const first = await assertRendersIdentically(t, file, ['--fps', '10']);
  const one1 = await renderHash(file, ['--fps', '10', '--workers', '1']);
  const four = await renderHash(file, ['--fps', '10', '--workers', '4']);
  assert.equal(one1.sha256, first, 'workers 1 is the default render');
  assert.equal(four.sha256, one1.sha256, 'workers 4 is the same bytes');
});

// ---- the example -------------------------------------------------------------------------------------------------------------

test('lottie-badge.json validates, is 15 s or less, uses offset and speed, and passes check with nothing on stderr', async (t) => {
  const { spec } = loadSpec(EXAMPLE);
  assert.deepEqual(validateSpec(spec, { dir: path.dirname(EXAMPLE) }).errors, []);
  const lotties = spec.scenes.flatMap((s) => s.elements).filter((el) => el.type === 'lottie');
  assert.ok(lotties.some((el) => el.offset > 0) && lotties.some((el) => el.speed !== undefined && el.speed !== 1));
  assert.ok(lotties.every((el) => el.src === 'data/badge.lottie.json'));
  assert.ok(spec.scenes.reduce((n, s) => n + s.duration, 0) <= 15);
  const badge = readJson(BADGE);
  assert.equal((badge.op - badge.ip) / badge.fr, 2, 'the badge is a 2 s animation');
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('the eval fixture data/badge.lottie.json is the example badge, byte for byte', () => {
  assert.deepEqual(readFileSync(path.join(root, '../../eval/fixtures/data/badge.lottie.json')), readFileSync(BADGE));
});

test('lottie-badge.json renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, SMALL);
});

test('the docs name the element: schema.md and SKILL.md describe lottie, the licences table names lottie-web', () => {
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const pa = readFileSync(path.join(root, '../../README.md'), 'utf8');
  assert.match(schema, /\| `lottie` \|/);
  assert.match(readme, /\| `lottie` \|/);
  for (const text of [schema, skill]) for (const word of ['lottie', 'offset', 'speed', 'expressions']) assert.ok(text.includes(word), word);
  assert.match(pa, /\| \[lottie-web\]\(https:\/\/github\.com\/airbnb\/lottie-web\) 5\.13\.0 .*\| MIT \|/);
  assert.match(pa, /make-motion.*Lottie/);
});

// ---- fix round 1: what lottie-web would build too much of, and the bounded wait for the page ----------------------------

const RENDER = path.join(root, 'scripts/render.mjs');
const BOMB = path.join(FIXTURES, 'lottie-repeater-bomb.json');
const repeater = (copies) => ({ ty: 'rp', c: copies, o: still(0), m: 1, tr: { ty: 'tr', p: still([1, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), so: still(100), eo: still(100) } });
// A layer whose one group holds a square, its fill, then `items` (a repeater repeats what is before it in the group).
const repeatedLayer = (...items) => { const l = squareLayer(); l.shapes[0].it.splice(2, 0, ...items); return l; };

test('budget: the reviewer\'s 792-byte repeater bomb is refused, naming the repeater and the cap', () => {
  assert.deepEqual(said(lottieProblems(readJson(BOMB))), [`layers[0].shapes[1].c: 200000 repeater copies; at most ${MAX_REPEATER_COPIES}`]);
});

test('budget: a repeater\'s copies are read from a static value, keyframes and a slot; at the cap it passes', () => {
  assert.deepEqual(lottieProblems(doc({ layers: [repeatedLayer(repeater(still(MAX_REPEATER_COPIES)))] })), []);
  const keyed = { a: 1, k: [{ t: 0, s: [3] }, { t: 10, s: [5000] }] };
  assert.deepEqual(said(lottieProblems(doc({ layers: [repeatedLayer(repeater(keyed))] }))), [`layers[0].shapes[0].it[2].c: 5000 repeater copies; at most ${MAX_REPEATER_COPIES}`]);
  const slotted = { a: 0, k: 2, sid: 'n' };
  assert.deepEqual(said(lottieProblems(doc({ layers: [repeatedLayer(repeater(slotted))], slots: { n: { p: { a: 0, k: 9000 } } } }))), [`layers[0].shapes[0].it[2].c: 9000 repeater copies; at most ${MAX_REPEATER_COPIES}`]);
  assert.deepEqual(said(lottieProblems(doc({ layers: [repeatedLayer(repeater({ a: 0, k: 'many' }))] }))), ['layers[0].shapes[0].it[2].c: must be a number']);
});

test('budget: zig-zag ridges, star points and gradient stops are capped (each is a loop lottie-web runs per frame)', () => {
  const zz = { ty: 'zz', s: still(5), r: still(MAX_ZIGZAG_RIDGES + 1), pt: still(1) };
  const star = { ty: 'sr', sy: 1, d: 1, pt: still(MAX_STAR_POINTS + 1), p: still([0, 0]), r: still(0), ir: still(10), is: still(0), or: still(20), os: still(0) };
  const grad = { ty: 'gf', o: still(100), r: 1, s: still([0, 0]), e: still([10, 0]), t: 1, g: { p: MAX_GRADIENT_STOPS + 1, k: still([0, 1, 1, 1]) } };
  assert.deepEqual(said(lottieProblems(doc({ layers: [repeatedLayer(zz, star, grad)] }))), [
    `layers[0].shapes[0].it[2].r: ${MAX_ZIGZAG_RIDGES + 1} zig-zag ridges; at most ${MAX_ZIGZAG_RIDGES}`,
    `layers[0].shapes[0].it[3].pt: ${MAX_STAR_POINTS + 1} star points; at most ${MAX_STAR_POINTS}`,
    `layers[0].shapes[0].it[4].g.p: ${MAX_GRADIENT_STOPS + 1} gradient stops; at most ${MAX_GRADIENT_STOPS}`,
  ]);
});

test('budget: nested repeaters and repeated precomps are multiplied out against one cap on what lottie-web builds', () => {
  assert.deepEqual(said(lottieProblems(doc({ layers: [repeatedLayer(repeater(still(300)), repeater(still(300)))] }))),
    [`(root): lottie-web would build about 180002 shapes and layers (repeaters, precomps and glyphs multiplied out); at most ${MAX_LOTTIE_ELEMENTS}`]);
  const comp = (id, inner) => ({ id, w: 100, h: 100, layers: Array.from({ length: 30 }, (_, i) => (inner ? { ...squareLayer({ ind: i + 1 }), ty: 0, refId: inner, shapes: [] } : squareLayer({ ind: i + 1 }))) });
  const deep = doc({ assets: [comp('a', null), comp('b', 'a'), comp('c', 'b')], layers: Array.from({ length: 30 }, () => ({ ...squareLayer(), ty: 0, refId: 'c', shapes: [] })) });
  assert.match(said(lottieProblems(deep))[0], /^\(root\): lottie-web would build about \d+ shapes and layers/);
  assert.deepEqual(lottieProblems(readJson(BADGE)), [], 'the badge is far inside the budget');
});

test('budget: a precomp that contains itself, and a layer whose refId names no asset, are refused by name', () => {
  const ref = (refId) => ({ ...squareLayer(), ty: 0, refId, shapes: [] });
  const loop = { id: 'loop', w: 100, h: 100, layers: [ref('loop')] };
  assert.deepEqual(said(lottieProblems(doc({ assets: [loop], layers: [ref('loop')] }))), ['assets[0]: precomp "loop" contains itself (through a layer refId)']);
  const a = { id: 'a', layers: [ref('b')] };
  const b = { id: 'b', layers: [ref('a')] };
  assert.deepEqual(said(lottieProblems(doc({ assets: [a, b], layers: [ref('a')] }))), ['assets[0]: precomp "a" contains itself (through a layer refId)']);
  assert.deepEqual(said(lottieProblems(doc({ layers: [imageLayer('nope')] }))), ['layers[0].refId: no asset has the id "nope"']);
});

test('M1: every asset is checked whatever its layers: a precomp names no file, and layers must be an array', () => {
  const precompFile = ['assets[0].u: a precomp names no file; remove u', 'assets[0].p: a precomp names no file; remove p'];
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: [], u: 'http://example.com/', p: 'precomp.png', w: 4, h: 4 }], layers: [imageLayer('c')] }))), precompFile);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: [], u: '/assets/', p: 'selfprobe.png' }] }))), precompFile);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: 0, u: '', p: 'http://example.com/l.png', w: 4, h: 4 }] }))), ['assets[0].layers: must be an array']);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: false, t: 3, u: '/assets/', p: 'selfprobe.json' }] }))), ['assets[0].layers: must be an array']);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: null }] }))), ['assets[0].layers: must be an array']);
  assert.deepEqual(said(lottieProblems(doc({ assets: [{ id: 'c', layers: [], t: 3 }] }))), ['assets[0].t: data assets (t 3) are not supported; keep the data in the layers']);
  assert.deepEqual(lottieProblems(doc({ assets: [{ id: 'c', layers: [], u: '', p: '' }] })), [], 'an empty u and p on a precomp name nothing');
});

test('M1: the reviewer\'s four bypass shapes are refused in the page too: no request beyond /vendor and the file, no CSP violation', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const shapes = [
    [{ id: 'c', layers: [], u: 'http://example.com/', p: 'precomp.png', w: 4, h: 4 }, imageLayer('c'), 'assets[0].u: a precomp names no file; remove u'],
    [{ id: 'c', layers: [], u: '/assets/', p: 'selfprobe.png', w: 4, h: 4 }, imageLayer('c'), 'assets[0].u: a precomp names no file; remove u'],
    [{ id: 'c', layers: 0, u: '', p: 'http://example.com/layers0.png', w: 4, h: 4 }, squareLayer(), 'assets[0].layers: must be an array'],
    [{ id: 'c', layers: false, t: 3, u: '/assets/', p: 'selfprobe.json' }, squareLayer(), 'assets[0].layers: must be an array'],
  ];
  for (const [asset, layer, message] of shapes) {
    const got = await inPage(folder(doc({ assets: [asset], layers: [layer] })));
    assert.equal(got.ready, `lottie anim.json: ${message}`);
    assert.deepEqual(got.csp, []);
    assert.deepEqual(got.blocked, []);
    assert.deepEqual(got.requests.filter((r) => r.startsWith('/assets/') && r !== '/assets/anim.json'), []);
    assert.deepEqual(got.requests.filter((r) => !r.startsWith('/')), []);
  }
});

test('M3/M4: stripDomNames removes every ln and cl lottie-web would write as an id or class, and fClass; a mask\'s cl (closed) stays', () => {
  const shape = { ty: 'gr', ln: 'stage', cl: 'el', it: [{ ty: 'rc', ln: 'grade-0', cl: 'text', d: 1, p: still([0, 0]), s: still([4, 4]), r: still(0) }, TRANSFORM] };
  const layer = { ...squareLayer(), ln: 'grade-0', cl: 'el text lottie', shapes: [shape], masksProperties: [{ cl: true, mode: 'a', pt: still({ i: [], o: [], v: [], c: true }), o: still(100) }] };
  const data = doc({ assets: [{ id: 'p', layers: [{ ...squareLayer(), ln: 'x', cl: 'y' }] }], layers: [layer], fonts: { list: [{ fName: 'A', fFamily: 'Arial', fStyle: 'Regular', fClass: 'el' }] },
    chars: [{ ch: 'A', fFamily: 'Arial', size: 10, style: 'Regular', w: 60, data: { shapes: [{ ty: 'gr', ln: 'g', cl: 'c', it: [] }] } }] });
  const out = stripDomNames(data);
  assert.equal(out, data, 'it strips the freshly parsed copy in place and returns it');
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /"ln"|"fClass"/);
  assert.equal((text.match(/"cl"/g) ?? []).length, 1, 'only the mask cl is left');
  assert.equal(out.layers[0].masksProperties[0].cl, true);
});

test('M3: a file\'s ln of "grade-0" no longer steals the grade filter: the graded image is grey and grade-0 is the filter', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const anim = doc({ layers: [{ ...squareLayer(), ln: 'grade-0', cl: 'grade-0' }] });
  const motion = { size: [320, 180], background: '#000000', scenes: [{ id: 's', duration: 2, elements: [lottieEl({ x: 60 }),
    { id: 'pic', type: 'image', src: 'pic.png', x: 240, y: 90, width: 100, height: 100, grade: { preset: 'mono' } }] }] };
  const files = { 'anim.json': JSON.stringify(anim), 'pic.png': solidPng(4, 4, [20, 200, 90]) };
  const found = await probed(motion, () => ({
    owners: [...document.querySelectorAll('[id="grade-0"]')].map((n) => n.tagName),
    fileNames: [...document.querySelectorAll('.lottie-player [id], .lottie-player [class]')].map((n) => `${n.id}|${n.getAttribute('class') ?? ''}`).filter((v) => !v.startsWith('__lottie_element_')),
  }), files);
  assert.deepEqual(found.owners, ['filter']);
  assert.deepEqual(found.fileNames, [], 'no id or class from the file reaches the page');
  const [r, g, b] = (await pixelsOf(await framed(motion, 1, files), [[240, 90]]))[0];
  assert.ok(r === g && g === b, `the image is graded grey, got ${r},${g},${b}`);
});

test('M4: a file\'s cl of "el text lottie" and ln of "stage" no longer crash check.mjs', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(doc({ layers: [{ ...squareLayer(), cl: 'el text lottie', ln: 'stage' }] }), { size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 2, elements: [lottieEl({ x: 960, y: 540, width: 400, height: 400, hold: true })] }] });
  const r = runCheck(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /crashed/);
});

test('L8: an embedded PNG data URL whose bytes do not decode fails the page instead of drawing nothing', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const got = await inPage(folder(doc({ assets: [imageAsset('data:image/png;base64,AAAA')], layers: [imageLayer()] })));
  assert.equal(got.ready, 'lottie anim.json: an embedded image failed to load');
});

test('L4: a stage whose second lottie fails destroys the player the first one started', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder();
  writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(doc({ assets: [imageAsset('data:image/png;base64,AAAA')], layers: [imageLayer()] })));
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify({ size: [320, 180], scenes: [{ id: 's', duration: 2, elements: [lottieEl(), lottieEl({ id: 'bad', src: 'bad.json', x: 60 })] }] }));
  const got = await inPage(dir, () => window.bodymovin?.getRegisteredAnimations().length ?? 0);
  assert.equal(got.ready, 'lottie bad.json: an embedded image failed to load');
  assert.equal(got.found, 0);
});

test('L5: a Lottie file that starts with a byte-order mark is read by the validator as the page reads it', () => {
  assert.deepEqual(errs(one(lottieEl()), folder(`﻿${JSON.stringify(doc())}`)), []);
});

test('L7: the badge draws its disc on frame 0, so the example opens on something', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = one(lottieEl({ src: 'data/badge.lottie.json', width: 160, height: 160 }));
  const shot = await framedIn(motion, 0, { 'data/badge.lottie.json': readFileSync(BADGE) });
  const [[r, g, b]] = await pixelsOf(shot, [[160, 90]]);
  assert.ok(b > 120 && r < 140, `the purple disc at the centre on frame 0, got ${r},${g},${b}`);
});

// ---- H1: the bounded wait -------------------------------------------------------------------------------------------------

test('readyBudget: 30 s plus 5 s per element that loads something, at most 300 s, naming each lottie', () => {
  const spec = { scenes: [{ id: 's', duration: 2, elements: [lottieEl(), { id: 't', type: 'text', text: 'x', x: 0, y: 0 },
    { id: 'g', type: 'group', x: 0, y: 0, children: [lottieEl({ id: 'inner', src: 'b.json' }), { id: 'i', type: 'image', src: 'p.png', x: 0, y: 0, width: 1, height: 1 }] }] }] };
  const budget = readyBudget(spec, {});
  assert.equal(budget.ms, 30000 + 3 * 5000);
  assert.equal(budget.hint, '; a lottie file too heavy to draw stops the page: "l" (anim.json), "inner" (b.json)');
  const many = { scenes: [{ id: 's', duration: 2, elements: Array.from({ length: 100 }, (_, i) => lottieEl({ id: `l${i}` })) }] };
  assert.equal(readyBudget(many, {}).ms, 300000);
  assert.deepEqual(readyBudget({ scenes: [{ id: 's', duration: 1, elements: [] }] }, {}), { ms: 30000, hint: '' });
  assert.equal(readyBudget(spec, { PA_READY_MS: '10' }).ms, 10, 'the test-only override');
  for (const bad of ['', '-1', '1e3', '0x10', ' 5', 'ten', '0']) assert.equal(readyBudget(spec, { PA_READY_MS: bad }).ms, 45000, `ignored: ${JSON.stringify(bad)}`);
});

test('H1: with both guards bypassed the bomb blocks the page, and waitReady still fails in time, naming the lottie; the browser closes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dir = folder(readJson(BOMB));
  const spec = readJson(path.join(dir, 'motion.json'));
  const guard = readFileSync(path.join(root, 'template/lottie-guard.mjs'), 'utf8').replace('export function lottieProblems(json) {', 'export function lottieProblems(json) { return [];');
  assert.ok(guard.includes('{ return [];'), 'the bypass took');
  const srv = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  const started = Date.now();
  try {
    const page = await browser.newPage();
    await page.route('**/template/lottie-guard.mjs', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: guard }));
    await page.goto(srv.url);
    const { hint } = readyBudget(spec, {});
    await assert.rejects(waitReady(page, 3000, hint), (e) => e.message === 'the page did not become ready within 3 s (any page error is printed above); a lottie file too heavy to draw stops the page: "l" (anim.json)');
    assert.ok(Date.now() - started < 20000, `${Date.now() - started} ms`);
  } finally { await browser.close(); await srv.close(); }
  assert.ok(Date.now() - started < 30000, 'and the browser closed promptly');
});

test('H1: the guard refuses the bomb at validate, so render.mjs exits 1 at once instead of hanging', () => {
  const dir = folder(readJson(BOMB));
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), '--out', path.join(dir, 'v.mp4'), ...SMALL], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /layers\[0\]\.shapes\[1\]\.c: 200000 repeater copies; at most 1000 \(in anim\.json\)/);
});

test('H1: render, the contact sheet and check all bound their wait for the page (PA_READY_MS forces the timeout)', async (t) => {
  if (!(await requireRender(t))) return;
  const dir = folder();
  const env = { ...process.env, PA_READY_MS: '10' };
  const message = /the page did not become ready within 0\.01 s \(any page error is printed above\); a lottie file too heavy to draw stops the page: "l" \(anim\.json\)/;
  for (const args of [['--out', path.join(dir, 'v.mp4'), ...SMALL], ['--contact-sheet', '--out', path.join(dir, 'sheet')]]) {
    const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), ...args], { encoding: 'utf8', env, timeout: 60000 });
    assert.equal(r.status, 1, `${args[0]}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, message, args[0]);
  }
  const c = spawnSync(process.execPath, [CHECK, path.join(dir, 'motion.json'), '--json'], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(c.status, 1, c.stdout + c.stderr);
  assert.match(JSON.parse(c.stdout).errors[0].message, message);
});

// Task 20: colour grade presets, plus exposure, contrast and saturation, on image and video elements. A grade is one
// SVG <filter> (template/grade.mjs) in a single <svg><defs> on the stage; the element's picture takes `filter: url(#grade-<n>)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gradeFilter, gradeId, GRADE_PRESETS } from '../template/grade.mjs';
import { validateSpec, loadSpec } from '../scripts/lib/spec.mjs';
import { probed, framed, meanLuma, pixelsOf } from './render-probe.mjs';
import { requireRender, assertRendersIdentically, renderHash, makeTestVideo, BROWSER_ONLY } from './helpers/render.mjs';
import { makePng, solidPng } from './helpers/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/graded-photo.json');
const PHOTO = path.join(root, 'references/examples/photo.png');
const CHECK = path.join(root, 'scripts/check.mjs');
const SIZE = [320, 180];
const CENTRE = [160, 90];
const RENDER_TOOLS = { need: ['browser', 'ffmpeg', 'ffprobe'] };
const SMALL = ['--fps', '10', '--size', '320x180'];

const ORANGE = [200, 120, 40];
const image = (grade, extra = {}) => ({ id: 'photo', type: 'image', src: 'photo.png', x: 160, y: 90, width: 320, height: 180, fit: 'fill', ...(grade ? { grade } : {}), ...extra });
const one = (el, extra = {}) => ({ size: SIZE, background: '#000000', scenes: [{ id: 's', duration: 2, elements: [el] }], ...extra });
const errs = (motion, dir) => validateSpec(motion, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));

// A folder holding photo.png (`png`) and motion.json; returns the motion.json path.
function specFile(motion, png = solidPng(16, 9, ORANGE)) {
  const dir = tmp('grade-');
  writeFileSync(path.join(dir, 'photo.png'), png);
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
  return path.join(dir, 'motion.json');
}
const centreOf = async (motion, png, sec = 1) => (await pixelsOf(await framed(motion, sec, { 'photo.png': png }), [CENTRE]))[0];

// ---- the filter markup ----------------------------------------------------------------------------

const RGB = (slope, intercept) => ['R', 'G', 'B'].map((c) => `<feFunc${c} type="linear" slope="${slope}" intercept="${intercept}"/>`).join('');
const open = (id) => `<filter id="${id}" color-interpolation-filters="sRGB">`;
const saturate = (v) => `<feColorMatrix type="saturate" values="${v}"/>`;
const linear = (slope, intercept) => `<feComponentTransfer>${RGB(slope, intercept)}</feComponentTransfer></filter>`;

test('gradeFilter: the markup for { preset: "warm" } is exact', () => {
  assert.equal(gradeFilter('grade-0', { preset: 'warm' }),
    open('grade-0') + saturate(1)
    + '<feColorMatrix type="matrix" values="1.08 0 0 0 0.02 0 1.02 0 0 0 0 0 0.9 0 -0.02 0 0 0 1 0"/>'
    + linear(1, 0));
});

test('gradeFilter: cool is its own matrix; mono is saturation 0 with contrast x 1.1; film is saturation x 0.85, contrast x 1.15 and a black lift', () => {
  assert.equal(gradeFilter('g', { preset: 'cool' }),
    open('g') + saturate(1) + '<feColorMatrix type="matrix" values="0.92 0 0 0 -0.02 0 1 0 0 0 0 0 1.1 0 0.02 0 0 0 1 0"/>' + linear(1, 0));
  assert.equal(gradeFilter('g', { preset: 'mono' }), open('g') + saturate(0) + linear(1.1, -0.05));
  const lift = `<feComponentTransfer>${['R', 'G', 'B'].map((c) => `<feFunc${c} type="table" tableValues="0.06 1"/>`).join('')}</feComponentTransfer>`;
  assert.equal(gradeFilter('g', { preset: 'film' }), open('g') + saturate(0.85) + linear(1.15, -0.075).replace('</filter>', '') + lift + '</filter>', 'the lift comes after the linear step');
});

test('gradeFilter: exposure is 2^stops of gain, contrast pivots on mid-grey, saturation multiplies the preset\'s; none of it needs a preset', () => {
  assert.equal(gradeFilter('g', { exposure: 1, contrast: 1.5, saturation: 0.5 }), open('g') + saturate(0.5) + linear(3, -0.25));
  assert.equal(gradeFilter('g', { exposure: -1 }), open('g') + saturate(1) + linear(0.5, 0));
  assert.equal(gradeFilter('g', { exposure: 0.5 }), open('g') + saturate(1) + linear(1.414214, 0));
  assert.equal(gradeFilter('g', { preset: 'film', saturation: 2, contrast: 2, exposure: 1 }).includes(saturate(1.7)), true, 'film x 2 saturation');
  assert.equal(gradeFilter('g', { preset: 'film', saturation: 2, contrast: 2, exposure: 1 }).includes('slope="4.6" intercept="-0.65"'), true, '2^1 x 2 x 1.15, 0.5 - 0.5 x 2.3');
  assert.equal(gradeFilter('g', { preset: 'mono', saturation: 2 }).includes(saturate(0)), true, 'mono stays mono');
  assert.equal(gradeFilter('g', {}), open('g') + saturate(1) + linear(1, 0));
});

test('gradeFilter: an id that could break out of an SVG id or a CSS url() is refused', () => {
  for (const hostile of ['a"b', "a'b", 'a b', 'a)b', 'a(b', 'a#b', 'a\\b', 'a"><script>x</script>', '', '1a', 'grade-0"/><x', 'a\nb', 'a;b']) {
    assert.throws(() => gradeFilter(hostile, { preset: 'warm' }), /filter id/, JSON.stringify(hostile));
  }
  assert.match(gradeFilter('grade-12', { preset: 'warm' }), /^<filter id="grade-12" /);
  assert.equal(gradeId(7), 'grade-7');
});

test('gradeFilter: a preset name is looked up as an own property, and anything else names the presets', () => {
  assert.deepEqual([...GRADE_PRESETS], ['warm', 'cool', 'mono', 'film']);
  for (const odd of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'Warm', 'sepia', '', 5, null]) {
    assert.throws(() => gradeFilter('g', { preset: odd }), /unknown grade preset .*warm, cool, mono, film/, String(odd));
  }
});

test('gradeFilter: no grade at all (undefined or null) is the idle grade', () => {
  assert.equal(gradeFilter('g'), gradeFilter('g', {}));
  assert.equal(gradeFilter('g', null), gradeFilter('g', {}));
});

test('gradeFilter: a number that is not a finite number is refused, so no text can reach the markup through one', () => {
  for (const bad of ['1', null, Number.NaN, Infinity, '1"/><x', {}, []]) {
    for (const key of ['exposure', 'contrast', 'saturation']) assert.throws(() => gradeFilter('g', { [key]: bad }), new RegExp(`grade ${key}`), `${key}: ${String(bad)}`);
  }
});

// ---- validation -----------------------------------------------------------------------------------

test('a grade with a preset, exposure, contrast and saturation validates on an image; the limits are inclusive', () => {
  const dir = path.dirname(specFile(one(image())));
  const at = (grade) => errs(one(image(grade)), dir);
  assert.deepEqual(at({ preset: 'warm', exposure: 0.5, contrast: 1.2, saturation: 0.8 }), []);
  for (const preset of GRADE_PRESETS) assert.deepEqual(at({ preset }), [], preset);
  assert.deepEqual(at({ exposure: -2, contrast: 0.5, saturation: 0 }), []);
  assert.deepEqual(at({ exposure: 2, contrast: 2, saturation: 2 }), []);
});

test('a grade out of range, with an unknown preset or an unknown key is an error that names the limit or the choices', () => {
  const dir = path.dirname(specFile(one(image())));
  const at = (grade) => errs(one(image(grade)), dir);
  const base = 'scenes[0].elements[0].grade';
  assert.deepEqual(at({ exposure: 2.5 }), [`${base}.exposure: must be <= 2`]);
  assert.deepEqual(at({ exposure: -2.1 }), [`${base}.exposure: must be >= -2`]);
  assert.deepEqual(at({ contrast: 0.4 }), [`${base}.contrast: must be >= 0.5`]);
  assert.deepEqual(at({ contrast: 2.1 }), [`${base}.contrast: must be <= 2`]);
  assert.deepEqual(at({ saturation: -0.1 }), [`${base}.saturation: must be >= 0`]);
  assert.deepEqual(at({ saturation: 2.1 }), [`${base}.saturation: must be <= 2`]);
  assert.deepEqual(at({ preset: 'cold' }), [`${base}.preset: must be one of "warm", "cool", "mono", "film"; did you mean "cool"?`]);
  assert.deepEqual(at({ preset: 'warm', brightness: 1 }), [`${base}.brightness: unknown property; allowed: preset, exposure, contrast, saturation`]);
  assert.deepEqual(at('warm'), [`${base}: must be object`]);
});

test('a grade that changes nothing is an error that says what to set', () => {
  const dir = path.dirname(specFile(one(image())));
  const said = 'scenes[0].elements[0].grade: this grade changes nothing; set a preset, or an exposure away from 0, a contrast away from 1 or a saturation away from 1';
  for (const idle of [{}, { exposure: 0 }, { exposure: 0, contrast: 1, saturation: 1 }]) assert.deepEqual(errs(one(image(idle)), dir), [said], JSON.stringify(idle));
  assert.deepEqual(errs(one(image({ saturation: 1.01 })), dir), []);
  assert.deepEqual(errs(one(image({ preset: 'warm', contrast: 1 })), dir), []);
});

test('a grade on any other type is an error that names the types that take one', () => {
  const dir = path.dirname(specFile(one(image())));
  const grade = { preset: 'warm' };
  const others = {
    text: { type: 'text', text: 'Hi' },
    counter: { type: 'counter', to: 5 },
    shape: { type: 'shape', shape: 'rect' },
    chart: { type: 'chart', width: 100, height: 100, vegaLite: { mark: 'bar', data: { values: [{ a: 1 }] }, encoding: { x: { field: 'a', type: 'quantitative' } } } },
    code: { type: 'code', code: 'x', lang: 'text', width: 200 },
    group: { type: 'group', children: [{ id: 'c', type: 'text', text: 'c', x: 0, y: 0 }] },
  };
  for (const [type, el] of Object.entries(others)) {
    const got = errs(one({ id: 'e', x: 10, y: 10, grade, ...el }), dir);
    assert.ok(got.includes('scenes[0].elements[0].grade: only valid on image or video elements'), `${type}: ${got.join(' | ')}`);
  }
  const inGroup = errs(one({ id: 'g', type: 'group', x: 0, y: 0, children: [{ id: 'c', type: 'text', text: 'c', x: 0, y: 0, grade }] }), dir);
  assert.deepEqual(inGroup, ['scenes[0].elements[0].children[0].grade: only valid on image or video elements']);
  assert.deepEqual(errs(one({ id: 'g', type: 'group', x: 0, y: 0, children: [image(grade, { id: 'in', x: 0, y: 0 })] }), dir), [], 'an image in a group takes one');
});

test('a grade is not animatable: a keyframe cannot carry it', () => {
  const dir = path.dirname(specFile(one(image())));
  assert.match(errs(one(image({ preset: 'warm' }, { keyframes: [{ t: 0, grade: 1 }] })), dir).join('\n'), /keyframes\[0\]\.grade: unknown property/);
});

test('a grade on a video validates, and a video example needs ffprobe for the clip', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const dir = tmp('grade-video-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'));
  const clip = { id: 'clip', type: 'video', src: 'clip.mp4', x: 160, y: 90, width: 320, height: 180, grade: { preset: 'cool', saturation: 0.7 } };
  assert.deepEqual(errs(one(clip), dir), []);
  assert.deepEqual(errs(one({ ...clip, grade: { exposure: 3 } }), dir), ['scenes[0].elements[0].grade.exposure: must be <= 2']);
});

// ---- the page --------------------------------------------------------------------------------------

test('saturation 0 gives R == G == B at the frame centre, where the same picture ungraded is orange', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const png = solidPng(16, 9, ORANGE);
  const [r, g, b] = await centreOf(one(image({ saturation: 0 })), png);
  assert.ok(r === g && g === b, `grey expected, got ${r},${g},${b}`);
  assert.ok(r > 100 && r < 160, `the luma of the orange, got ${r}`);
  const plain = await centreOf(one(image()), png);
  assert.deepEqual(plain, ORANGE, 'ungraded, the picture is exactly the file');
});

test('mono is grey whatever the saturation asked for, and warm and cool tilt a grey the way their matrices say', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const [mr, mg, mb] = await centreOf(one(image({ preset: 'mono', saturation: 2 })), solidPng(16, 9, ORANGE));
  assert.ok(mr === mg && mg === mb, `mono: ${mr},${mg},${mb}`);
  const grey = solidPng(16, 9, [128, 128, 128]);
  const [wr, wg, wb] = await centreOf(one(image({ preset: 'warm' })), grey);
  assert.ok(wr > wg && wg > wb, `warm: ${wr},${wg},${wb}`);
  assert.ok(Math.abs(wr - 143) <= 2 && Math.abs(wg - 130) <= 2 && Math.abs(wb - 110) <= 2, `warm: 1.08 x 128 + 5, 1.02 x 128, 0.9 x 128 - 5; got ${wr},${wg},${wb}`);
  const [cr, cg, cb] = await centreOf(one(image({ preset: 'cool' })), grey);
  assert.ok(cb > cg && cg > cr, `cool: ${cr},${cg},${cb}`);
});

test('film takes some colour out and moves a mid-grey up a little', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  const film = await centreOf(one(image({ preset: 'film' })), solidPng(16, 9, ORANGE));
  assert.ok(spread(film) < spread(ORANGE), `film ${film} is less saturated than ${ORANGE}`);
  const [grey] = await centreOf(one(image({ preset: 'film' })), solidPng(16, 9, [128, 128, 128]));
  assert.ok(grey > 130 && grey < 145, `1.15 x 0.502 - 0.075 = 0.502, then 0.06 + 0.94 x 0.502 = 0.532: 135, got ${grey}`);
});

test('film lifts pure black to about 0.06 x 255 (15), keeps white at 255 and holds the floor at any exposure', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const valueAt = async (grade, v) => (await centreOf(one(image(grade)), solidPng(16, 9, [v, v, v])))[0];
  const black = await valueAt({ preset: 'film' }, 0);
  assert.ok(black >= 12 && black <= 18, `black should read about 15, got ${black}`);
  assert.equal(await valueAt({ preset: 'film' }, 255), 255, 'white stays white');
  const mid = await valueAt({ preset: 'film' }, 128);
  assert.ok(mid >= 130 && mid <= 140, `mid-grey barely moves (about 135), got ${mid}`);
  const dark = await valueAt({ preset: 'film', exposure: -2 }, 0);
  assert.ok(dark >= 12 && dark <= 18, `black at exposure -2 still reads about 15, got ${dark}`);
  const dim = await valueAt({ preset: 'film', exposure: -2 }, 255);
  assert.ok(dim >= 60, `white at exposure -2 is above the floor, got ${dim}`);
  assert.ok(await valueAt({ preset: 'warm' }, 0) < 8, 'a preset without a lift keeps black black');
});

test('exposure 1 raises the mean luma of a mid-grey picture to about twice, within 10%; exposure -1 halves it', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const grey = solidPng(16, 9, [100, 100, 100]);
  const lumaOf = async (grade) => meanLuma(await framed(one(image(grade)), 1, { 'photo.png': grey }));
  const base = await lumaOf(undefined);
  const bright = await lumaOf({ exposure: 1 });
  const dim = await lumaOf({ exposure: -1 });
  assert.ok(Math.abs(base - 100) < 2, `the premise: mean luma ${base}`);
  assert.ok(Math.abs(bright / base - 2) <= 0.2, `exposure 1: x${(bright / base).toFixed(3)}`);
  assert.ok(Math.abs(dim / base - 0.5) <= 0.05, `exposure -1: x${(dim / base).toFixed(3)}`);
});

test('contrast pivots on mid-grey: more pushes a dark and a light half apart, less pulls them together', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const halves = makePng(32, 18, (x) => (x < 16 ? [64, 64, 64] : [192, 192, 192]));
  const at = async (grade) => (await pixelsOf(await framed(one(image(grade)), 1, { 'photo.png': halves }), [[40, 90], [280, 90]])).map(([v]) => v);
  const [plainDark, plainLight] = await at(undefined);
  assert.deepEqual([plainDark, plainLight], [64, 192]);
  const [hardDark, hardLight] = await at({ contrast: 2 });
  assert.ok(hardDark <= 3 && hardLight >= 252, `contrast 2: ${hardDark}, ${hardLight}`);
  const [softDark, softLight] = await at({ contrast: 0.5 });
  assert.ok(Math.abs(softDark - 96) <= 2 && Math.abs(softLight - 160) <= 2, `contrast 0.5: ${softDark}, ${softLight}`);
});

// Runs in the page: what the grade left in the DOM.
const READ_GRADES = () => {
  const stage = document.getElementById('stage');
  const defs = [...stage.querySelectorAll(':scope > svg')];
  return {
    svgCount: defs.length,
    svgInEl: stage.querySelectorAll('.el svg defs').length,
    filterIds: [...stage.querySelectorAll(':scope > svg filter')].map((f) => f.id),
    svgMarkup: defs.map((d) => d.outerHTML).join(''),
    mediaFilters: [...stage.querySelectorAll('.el.image > img, .el.video > img, .el.video > video')].map((m) => m.style.filter),
    mediaWillChange: [...stage.querySelectorAll('.el > img')].map((m) => getComputedStyle(m).willChange),
    nodeFilters: [...stage.querySelectorAll('.el')].map((n) => n.style.filter),
  };
};

test('a graded element gets one filter in one <svg> on the stage, outside every element node; a spec without a grade gets none', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const png = solidPng(16, 9, ORANGE);
  const two = one(image({ preset: 'warm' }));
  two.scenes[0].elements.push(image({ saturation: 0 }, { id: 'second', x: 80, width: 100, height: 50 }), image(undefined, { id: 'plain', x: 240, width: 100, height: 50 }));
  const got = await probed(two, `(${READ_GRADES})()`, { 'photo.png': png });
  assert.equal(got.svgCount, 1, 'one <svg> for every grade');
  assert.equal(got.svgInEl, 0, 'not inside any element node, which a renewal takes out of layout');
  assert.deepEqual(got.filterIds, ['grade-0', 'grade-1']);
  assert.deepEqual(got.mediaFilters, ['url("#grade-0")', 'url("#grade-1")', ''], 'the ungraded picture has no filter');
  assert.deepEqual(got.mediaWillChange, ['auto', 'auto', 'auto'], 'no will-change in render mode');
  assert.deepEqual(got.nodeFilters, ['', '', ''], 'the filter sits on the picture, not on the element node that moves and fades');
  const none = await probed(one(image()), `(${READ_GRADES})()`, { 'photo.png': png });
  assert.equal(none.svgCount, 0, 'nothing is added to a spec without a grade');
});

test('a hostile element id never reaches the filter id, the markup or the style', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const hostile = 'a"onload="alert(1)" b) url(#x) \\ \'</svg><script>alert(2)</script>#';
  const got = await probed(one(image({ preset: 'warm', saturation: 0.5 }, { id: hostile })), `(${READ_GRADES})()`, { 'photo.png': solidPng(16, 9, ORANGE) });
  assert.deepEqual(got.filterIds, ['grade-0']);
  assert.deepEqual(got.mediaFilters, ['url("#grade-0")']);
  assert.doesNotMatch(got.svgMarkup, /alert|onload|script|hostile/);
  const [r, g, b] = await centreOf(one(image({ saturation: 0 }, { id: hostile })), solidPng(16, 9, ORANGE));
  assert.ok(r === g && g === b, 'and the grade still applies');
});

test('the grade survives renewal: poses that change opacity and position keep the defs in place and the picture graded', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = one(image({ saturation: 0 }, { keyframes: [{ t: 0, opacity: 0.2, x: 150 }, { t: 1, opacity: 1, x: 160, ease: 'outCubic' }, { t: 2, opacity: 0.9, x: 162 }] }));
  const walk = async () => {
    const out = [];
    for (const sec of [0.1, 0.55, 0.9, 1.3, 0.3, 1.99]) {
      await window.__motion.seek(sec);
      const stage = document.getElementById('stage');
      out.push([stage.querySelectorAll(':scope > svg filter').length, stage.querySelector('.el > img').style.filter]);
    }
    return out;
  };
  const got = await probed(motion, `(${walk})()`, { 'photo.png': solidPng(16, 9, ORANGE) });
  for (const [count, filter] of got) assert.deepEqual([count, filter], [1, 'url("#grade-0")']);
  const [r, g, b] = await centreOf(motion, solidPng(16, 9, ORANGE), 1.3);
  assert.ok(r === g && g === b, `${r},${g},${b}`);
});

test('a grade composes with a group, a camera and a blur transition: the picture is still graded in each', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const grey = { preset: 'mono' };
  const motion = { size: SIZE, background: '#000000', scenes: [
    { id: 'a', duration: 2, background: '#aa0000', elements: [{ id: 'g', type: 'group', x: 160, y: 90, scale: 1, children: [image(grey, { id: 'in', x: 0, y: 0, width: 640, height: 360 })] }] },
    { id: 'b', duration: 2, transition: { type: 'blur', duration: 1 }, camera: { keyframes: [{ t: 0, zoom: 1.3, rotate: 3 }] }, elements: [image(grey, { id: 'second', width: 640, height: 360 })] }] };
  const png = solidPng(16, 9, ORANGE);
  for (const sec of [1, 2.4, 3.5]) {
    const [r, g, b] = await centreOf(motion, png, sec);
    assert.ok(r === g && g === b && r > 60 && r < 200, `${sec}s: ${r},${g},${b}`);
  }
});

// ---- the camera, transitions and check.mjs still work with a grade ---------------------------------

const runCheck = (motion, png) => spawnSync(process.execPath, [CHECK, specFile(motion, png), '--json'], { encoding: 'utf8' });
const verdict = (motion, png) => JSON.parse(runCheck(motion, png).stdout);
const messages = (list = []) => list.map((e) => `${e.path}: ${e.message}`);
const caption = { id: 'cap', type: 'text', text: 'Graded backdrop', x: 960, y: 540, fontSize: 80, fontWeight: 700, hold: true };
const backdrop = (grade) => ({ size: [1920, 1080], fps: 30, scenes: [{ id: 's', duration: 3, elements: [
  { id: 'photo', type: 'image', src: 'photo.png', x: 960, y: 540, width: 1920, height: 1080, fit: 'fill', hold: true, ...(grade ? { grade } : {}) }, caption] }] });

test('check: a text over a graded photo is judged on the graded pixels, in both directions', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const dark = solidPng(16, 9, [50, 50, 50]);
  const light = solidPng(16, 9, [240, 240, 240]);
  const contrast = (v) => messages(v.errors).filter((m) => /contrast against its backdrop/.test(m));
  assert.deepEqual(contrast(verdict(backdrop(undefined), dark)), [], 'light text on a dark photo reads');
  assert.equal(contrast(verdict(backdrop({ exposure: 2 }), dark)).length, 1, 'the same photo graded up to a light grey does not');
  assert.equal(contrast(verdict(backdrop(undefined), light)).length, 1, 'light text on a light photo does not');
  assert.deepEqual(contrast(verdict(backdrop({ exposure: -2 }), light)), [], 'the same photo graded down to a dark grey reads');
  assert.deepEqual(contrast(verdict(backdrop({ preset: 'mono', contrast: 2 }), dark)), []);
});

test('check: a graded image under a camera move and a transition is measured and passes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const photo = (id, grade) => ({ id, type: 'image', src: 'photo.png', x: 960, y: 540, width: 1920, height: 1080, fit: 'fill', hold: true, grade });
  const motion = { size: [1920, 1080], fps: 30, scenes: [
    { id: 'a', duration: 3, camera: { keyframes: [{ t: 0, zoom: 1 }, { t: 3, zoom: 1.1 }] }, elements: [photo('p1', { preset: 'warm' }), { ...caption, id: 'c1' }] },
    { id: 'b', duration: 3, transition: { type: 'slide', direction: 'left', duration: 0.6 }, elements: [photo('p2', { preset: 'film' }), { ...caption, id: 'c2' }] }] };
  const result = runCheck(motion, solidPng(16, 9, [30, 30, 30]));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
});

// ---- determinism ------------------------------------------------------------------------------------

// A picture with all three channels moving across it, so a filter has something to do at every pixel.
const gradient = makePng(64, 36, (x, y) => [Math.round((x / 63) * 255), Math.round((y / 35) * 255), Math.round(((x + y) / 98) * 200)]);
const moving = (grade) => ({ size: SIZE, fps: 30, scenes: [
  { id: 'a', duration: 2, elements: [image(grade, { keyframes: [{ t: 0, opacity: 0, x: 150 }, { t: 0.7, opacity: 1, x: 160, ease: 'outCubic' }, { t: 1.8, scale: 1.05 }] }),
    { id: 'title', type: 'text', text: 'Graded', x: 160, y: 150, fontSize: 24 }] },
  { id: 'b', duration: 1, transition: 'fade', elements: [image({ preset: 'film', exposure: -0.5 }, { id: 'again', x: 160, y: 90 })] }] });

test('a graded image renders byte-identical twice, and at 1 and 4 workers', async (t) => {
  if (!(await requireRender(t))) return;
  const file = specFile(moving({ preset: 'warm', exposure: 0.4, contrast: 1.2, saturation: 0.8 }), gradient);
  const first = await assertRendersIdentically(t, file, ['--fps', '10']);
  const one4 = await renderHash(file, ['--fps', '10', '--workers', '1']);
  const four = await renderHash(file, ['--fps', '10', '--workers', '4']);
  assert.equal(one4.sha256, first, 'workers 1 is the default render');
  assert.equal(four.sha256, one4.sha256, 'workers 4 is the same bytes');
  const plain = await renderHash(specFile(moving(undefined), gradient), ['--fps', '10']);
  assert.notEqual(plain.sha256, first, 'and the grade changed the picture');
});

test('a graded video renders byte-identical twice, and at 1 and 4 workers', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('grade-clip-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1.7 });
  const clip = (grade) => ({ id: 'clip', type: 'video', src: 'clip.mp4', x: 160, y: 90, width: 320, height: 180, ...(grade ? { grade } : {}), keyframes: [{ t: 0, opacity: 0 }, { t: 0.5, opacity: 1 }] });
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({ size: SIZE, fps: 30, scenes: [{ id: 'a', duration: 2, elements: [clip({ preset: 'cool', saturation: 0.6, contrast: 1.3 })] }] }));
  const first = await assertRendersIdentically(t, file, SMALL);
  const one1 = await renderHash(file, [...SMALL, '--workers', '1']);
  const four = await renderHash(file, [...SMALL, '--workers', '4']);
  assert.equal(one1.sha256, first);
  assert.equal(four.sha256, one1.sha256);
  const plainFile = path.join(dir, 'plain.json');
  writeFileSync(plainFile, JSON.stringify({ size: SIZE, fps: 30, scenes: [{ id: 'a', duration: 2, elements: [clip(undefined)] }] }));
  assert.notEqual((await renderHash(plainFile, SMALL)).sha256, first, 'and the grade changed the picture');
});

test('a graded video is graded in the MP4: a frame of the clip is grey at saturation 0 and coloured without a grade', async (t) => {
  const tools = await requireRender(t, RENDER_TOOLS);
  if (!tools) return;
  const dir = tmp('grade-clip-px-');
  makeTestVideo(tools.ffmpeg, path.join(dir, 'clip.mp4'), { seconds: 1.5 });
  const centre = async (grade) => {
    const file = path.join(dir, `${grade ? 'graded' : 'plain'}.json`);
    const clip = { id: 'clip', type: 'video', src: 'clip.mp4', x: 160, y: 90, width: 320, height: 180, ...(grade ? { grade } : {}) };
    writeFileSync(file, JSON.stringify({ size: SIZE, fps: 30, scenes: [{ id: 'a', duration: 1.5, elements: [clip] }] }));
    const { out } = await renderHash(file, SMALL);
    const frame = path.join(dir, `${grade ? 'graded' : 'plain'}.png`);
    const r = spawnSync(tools.ffmpeg, ['-y', '-v', 'error', '-i', out, '-frames:v', '1', frame], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return (await pixelsOf(readFileSync(frame), [[160, 150]]))[0]; // the clip's 0x224466 background: the box starts at the top left
  };
  const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  assert.ok(spread(await centre(undefined)) > 30, 'the premise: the clip is coloured');
  const grey = await centre({ saturation: 0 });
  assert.ok(spread(grey) <= 3, `grey expected (yuv rounding aside), got ${grey}`);
});

// ---- the example -------------------------------------------------------------------------------------

test('references/examples/photo.png is a small PNG, and graded-photo.json validates, uses every preset and passes check with no output on stderr', async (t) => {
  const png = readFileSync(PHOTO);
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.ok(statSync(PHOTO).size < 200 * 1024, `${statSync(PHOTO).size} bytes`);
  const spec = loadSpec(EXAMPLE).spec;
  assert.deepEqual(validateSpec(spec, { dir: path.dirname(EXAMPLE) }).errors, []);
  const grades = spec.scenes.flatMap((s) => s.elements).filter((el) => el.grade).map((el) => el.grade);
  for (const preset of GRADE_PRESETS) assert.ok(grades.some((g) => g.preset === preset), `the example grades with ${preset}`);
  assert.ok(grades.some((g) => g.exposure !== undefined && g.contrast !== undefined && g.saturation !== undefined), 'and sets all three controls');
  assert.ok(spec.scenes.reduce((n, s) => n + s.duration, 0) <= 15);
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('graded-photo.json renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, SMALL);
});

test('the docs name the field: schema.md has the grade row and SKILL.md the image and video bullets', () => {
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  assert.match(schema, /`grade`/);
  for (const text of [schema, skill]) {
    for (const word of ['warm', 'cool', 'mono', 'film', 'exposure', 'contrast', 'saturation']) assert.ok(text.includes(word), word);
  }
});

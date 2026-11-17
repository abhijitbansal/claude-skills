// The shader cuts in Node (transitions plan Task 4): the registry entries, the uniform maths, the stand-ins, and what the
// report and the review say about a shader cut that was replaced. The browser half is in cuts-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { defineShaderCut, shaderUniforms, standInOf, SHADER_MODULES, SHADER_DUR } from '../../engine/cuts/shaders/index.mjs';
import { resolveCut } from '../../engine/cuts/resolve.mjs';
import { sessionFindings } from '../../scripts/v2/review.mjs';
import { wrapTransition } from '../../engine/page/post-cut.mjs';
import { reportOf, formatText } from '../../scripts/v2/report.mjs';

const CANVAS = { w: 320, h: 180 }; // version 1's test size
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-12, `${label}: ${a} vs ${b}`);
const cube = (p, direction = 'left', canvas = CANVAS) => shaderUniforms(SHADER_MODULES.cube, { p, direction, canvas });
const ripple = (p) => shaderUniforms(SHADER_MODULES.ripple, { p, canvas: CANVAS });

test('ripple and cube are registered shader cuts of 0.6 s; cube takes the four edges, left first; ripple none', () => {
  for (const name of ['ripple', 'cube']) {
    const entry = registries.cuts.get(name);
    assert.equal(entry.family, 'shader', name);
    assert.equal(entry.dur, SHADER_DUR, name);
    assert.equal(entry.smearable, false, name);
    assert.equal(entry.shader, SHADER_MODULES[name], name);
  }
  assert.equal(SHADER_DUR, 0.6);
  assert.deepEqual(registries.cuts.get('cube').directions, ['left', 'right', 'up', 'down']);
  assert.equal(registries.cuts.get('ripple').directions, null);
  assert.deepEqual([resolveCut('cube').direction, resolveCut('cube').dur], ['left', 0.6]);
});

// The six cases below are version 1's numbers, copied from test/gl-transitions.test.mjs ("glUniforms: the cube turns 0
// to 90 degrees ..." and "glUniforms: progress outside 0 to 1 is clamped ..."), for the same progress, direction and size.
// The face turned away is shaded to 0.35 (version 1: 0.55; look review gate-cuts-1 P6 found the faces alike).
const AWAY = 0.35;

test('cube uniforms at progress 0: no turn, no pull, the front face lit and the other in shade', () => {
  const start = cube(0);
  assert.deepEqual([start.uSin, start.uCos, start.uPull, start.uShadeFrom], [0, 1, 0, 1]);
  near(start.uShadeTo, AWAY, 'shade to');
});

test('cube uniforms at progress 1: a quarter turn, the pull back to 0, the shades swapped', () => {
  const end = cube(1);
  assert.equal(end.uSin, 1);
  assert.ok(Math.abs(end.uCos) < 1e-12 && Math.abs(end.uPull) < 1e-12);
  near(end.uShadeFrom, AWAY, 'shade from'); near(end.uShadeTo, 1, 'shade to');
});

test('cube uniforms at progress 0.5 are version 1\'s: an eighth of a turn with the largest pull', () => {
  const middle = cube(0.5);
  near(middle.uSin, Math.SQRT1_2, 'sin'); near(middle.uCos, Math.SQRT1_2, 'cos');
  near(middle.uPull, 0.5, 'pull');
});

test('cube swap and flip per direction: version 1\'s across, and up and down name the way the box turns (edges.mjs)', () => {
  assert.deepEqual([cube(0.5, 'left').uSwap, cube(0.5, 'left').uFlip], [0, 0]);
  assert.deepEqual([cube(0.5, 'right').uSwap, cube(0.5, 'right').uFlip], [0, 1]);
  assert.deepEqual([cube(0.5, 'up').uSwap, cube(0.5, 'up').uFlip], [1, 1]);
  assert.deepEqual([cube(0.5, 'down').uSwap, cube(0.5, 'down').uFlip], [1, 0]);
});

test('cube uRatio is version 1\'s: the face across the turn in units of its extent along it', () => {
  assert.equal(cube(0.5, 'left').uRatio, 180 / 320);
  assert.equal(cube(0.5, 'up').uRatio, 320 / 180);
});

test('progress outside 0 to 1 is clamped, as version 1 clamped it; ripple runs at half version 1\'s amplitude, frequency and shine (gate-cuts-1 P7)', () => {
  assert.equal(ripple(-3).progress, 0);
  assert.equal(ripple(7).progress, 1);
  assert.equal(cube(9).uSin, 1);
  const r = ripple(0.3);
  assert.deepEqual([r.progress, r.amplitude, r.frequency, r.speed, r.shine], [0.3, 0.015, 14, 14, 0.03]);
  assert.equal(r.ratio, 320 / 180);
});

// Every uniform a body declares, by name.
const declared = (source) => new Set([...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
const firstDirection = (module) => (module.directions ? Object.keys(module.directions)[0] : null);

// The uniforms the wrapper declares and shaderUniforms sets for every module (engine/page/post-cut.mjs).
const WRAPPER_SET = ['uGround', 'uClearFrom', 'uClearTo', 'uHashCell'];

test('every shader body declares exactly the uniforms its module sets (a typo would be a silent zero), and none of the wrapper\'s', () => {
  const wrapper = declared(wrapTransition('vec4 transition(vec2 uv) { return vec4(0.0); }'));
  for (const name of WRAPPER_SET) assert.ok(wrapper.has(name), `the wrapper declares ${name}`);
  for (const [name, module] of Object.entries(SHADER_MODULES)) {
    const set = Object.keys(shaderUniforms(module, { p: 0.5, direction: firstDirection(module), canvas: CANVAS })).filter((k) => k !== 'progress' && k !== 'ratio' && !WRAPPER_SET.includes(k));
    assert.deepEqual([...declared(module.source)].sort(), [...new Set(set)].sort(), name);
    for (const reserved of ['progress', 'ratio', 'uFrom', 'uTo', 'uRes', 'uSeed', ...WRAPPER_SET]) assert.ok(!declared(module.source).has(reserved), `${name} declares ${reserved}`);
  }
});

test('every shader cut stands in with a registered layer cut, which takes the shader cut\'s direction when it has it', () => {
  for (const name of registries.cuts.names().filter((n) => registries.cuts.get(n).family === 'shader')) {
    const entry = registries.cuts.get(name);
    assert.equal(registries.cuts.get(entry.standIn).family, 'layer', name);
  }
  assert.deepEqual(['up', 'down', 'left', 'right'].map((d) => standInOf(registries.cuts.get('cube'), d)).map((s) => [s.name, s.direction]),
    [['wipe', 'up'], ['wipe', 'down'], ['wipe', 'left'], ['wipe', 'right']]);
  const r = standInOf(registries.cuts.get('ripple'), null);
  assert.deepEqual([r.name, r.direction], ['crossfade', null]);
  // a stand-in that takes directions, for a shader cut that names one it does not have: the stand-in's default
  assert.equal(standInOf({ standIn: 'wipe' }, 'in').direction, 'left');
});

test('a module whose source declares no transition() is refused, as is a stand-in that is not crossfade or wipe', () => {
  const base = { name: 'bad', source: 'vec4 transition(vec2 uv) { return getToColor(uv); }', params: {}, standIn: 'crossfade', license: null };
  assert.equal(defineShaderCut(base).family, 'shader');
  assert.throws(() => defineShaderCut({ ...base, source: 'vec4 main(vec2 uv) { return vec4(1.0); }' }), /shader cut "bad": its source must declare vec4 transition\(vec2 uv\)/);
  assert.throws(() => defineShaderCut({ ...base, standIn: 'slide' }), /shader cut "bad": standIn must be one of crossfade, wipe, got "slide"/);
  assert.throws(() => defineShaderCut({ ...base, name: '' }), /a shader cut needs a name/);
});

test('the wrapper writes alpha 1 whatever a body returns, flips the pictures to the bottom-left uv, and hashes with integers only', () => {
  const source = wrapTransition('vec4 transition(vec2 uv) { return vec4(0.0); }');
  assert.match(source, /outColor = vec4\(transition\(uv\)\.rgb, 1\.0\);/);
  assert.match(source, /vec4 getFromColor\(vec2 uv\) \{\n {2}vec4 c = texture\(uFrom, vec2\(uv\.x, 1\.0 - uv\.y\)\);/);
  assert.match(source, /vec4 getToColor\(vec2 uv\) \{\n {2}vec4 c = texture\(uTo, vec2\(uv\.x, 1\.0 - uv\.y\)\);/);
  assert.doesNotMatch(source.replace(/vec4 transition[\s\S]*$/, ''), /\bsin\(/, 'no sin() in the wrapper');
  for (const module of Object.values(SHADER_MODULES)) assert.doesNotMatch(module.source, /fract\(sin\(dot\(/, `${module.name}: no sin() hash left`);
});

// ---- the review and the report ----

test('a replaced shader cut is a creative page finding that names the cuts, the stand-ins and why', () => {
  const found = sessionFindings({ info: { cuts: { ran: [], replaced: ['ripple', 'cube'], reason: 'this browser has no WebGL2' } }, errors: [], blocked: [] });
  assert.deepEqual(found.map((f) => [f.kind, f.shot, f.path]), [['creative', null, '']]);
  assert.equal(found[0].message, 'post: shader cuts replaced: ripple (drawn as crossfade), cube (drawn as wipe), because this browser has no WebGL2');
  assert.deepEqual(sessionFindings({ info: { cuts: { ran: ['ripple'], replaced: [], reason: null } }, errors: [], blocked: [] }), []);
  assert.deepEqual(sessionFindings({ info: {}, errors: [], blocked: [] }), [], 'a film with no shader cut says nothing');
});

const state = (extra) => ({
  validated: true, error: null, stages: [{ name: 'validate', ok: true }], findings: [], sheets: [], output: '/x.mp4', timed: 'estimated', voice: null, audio: null,
  post: 'webgl2', capture: 'fast', frames: 10, captured: 10, seconds: 1, msPerFrame: 100, bytes: 1e6, mbps: 1, ...extra,
});

test('the report carries cuts only for a film with shader cuts, and the text form\'s frames line says what ran', () => {
  assert.equal('cuts' in reportOf(state({})), false, 'no shader cut: no key');
  assert.equal('cuts' in reportOf(state({ cuts: { ran: [], replaced: [], reason: null } })), false, 'an empty list: no key');
  const ran = reportOf(state({ cuts: { ran: ['ripple', 'cube', 'wind'], replaced: [], reason: null } }));
  assert.deepEqual(ran.cuts, { ran: ['ripple', 'cube', 'wind'], replaced: [], reason: null });
  assert.match(formatText(ran, { sheetsDir: '/s' }), /\(capture fast, post webgl2, shader cuts: 3, 100\.0 ms per frame\)/);
  const replaced = reportOf(state({ post: '2d', cuts: { ran: [], replaced: ['ripple', 'cube'], reason: 'this browser has no WebGL2' } }));
  assert.match(formatText(replaced, { sheetsDir: '/s' }), /\(capture fast, post 2d, shader cuts replaced: ripple, cube \(this browser has no WebGL2\), 100\.0 ms per frame\)/);
  assert.match(formatText(reportOf(state({})), { sheetsDir: '/s' }), /\(capture fast, post webgl2, 100\.0 ms per frame\)/);
});

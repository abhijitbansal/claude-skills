// Task 12: push, slide, wipe, zoom, blur and iris beside none, fade and crossfade. A transition is a name or
// { type, direction?, duration? }; layerStyles says how the two layers look at progress p of its window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TRANSITIONS, normalizeTransition, layerStyles, layerUnder, directionsOf } from '../template/transitions.mjs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import { changeGaps } from '../template/viral.mjs';
import { probed, framed, meanLuma } from './render-probe.mjs';
import { requireRender, assertRendersIdentically, renderHash, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/transitions.json');
const CHECK = path.join(root, 'scripts/check.mjs');
const SIZE = [480, 270];
const none = { opacity: null, transform: null, clipPath: null, filter: null };
const label = (id, extra = {}) => ({ id, type: 'text', text: id, x: 240, y: 135, fontSize: 40, ...extra });
const scenes = (second = {}, first = {}) => [
  { id: 's1', duration: 3, elements: [label('a')], ...first },
  { id: 's2', duration: 3, elements: [label('b')], ...second },
];
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const styles = (transition, p) => layerStyles(transition, p, SIZE);

// ---- the pure pieces ---------------------------------------------------------------------------

test('TRANSITIONS lists the nine names in order', () => {
  assert.deepEqual([...TRANSITIONS], ['none', 'fade', 'crossfade', 'push', 'slide', 'wipe', 'zoom', 'blur', 'iris']);
});

test('normalizeTransition reads a name or an object and fills the defaults of each type', () => {
  assert.deepEqual(normalizeTransition('fade'), { type: 'fade', direction: null, duration: 0.4 });
  assert.deepEqual(normalizeTransition('push'), { type: 'push', direction: 'left', duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'slide', direction: 'down', duration: 1 }), { type: 'slide', direction: 'down', duration: 1 });
  assert.deepEqual(normalizeTransition({ type: 'zoom' }), { type: 'zoom', direction: 'in', duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'iris', direction: 'out' }), { type: 'iris', direction: 'out', duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'blur', direction: 'left' }), { type: 'blur', direction: null, duration: 0.4 });
  assert.deepEqual(normalizeTransition({ type: 'wipe', duration: 9 }), { type: 'wipe', direction: 'left', duration: 2 });
  assert.deepEqual(normalizeTransition({ type: 'wipe', duration: 0.01 }).duration, 0.1);
});

test('normalizeTransition treats anything unknown as none, including names an object inherits', () => {
  for (const odd of [undefined, null, 5, [], {}, 'spin', { type: 'constructor' }, { type: '__proto__' }, 'toString']) {
    assert.deepEqual(normalizeTransition(odd), { type: 'none', direction: null, duration: 0.4 }, JSON.stringify(odd));
  }
  assert.equal(normalizeTransition({ type: 'push', direction: 'constructor' }).direction, 'left', 'an inherited name is not a direction');
  assert.equal(directionsOf('constructor'), null);
  assert.equal(directionsOf('toString'), null);
});

test('push: the outgoing scene leaves by the canvas size as the incoming one comes in from the named edge', () => {
  assert.deepEqual(styles('push', 0), { incoming: { ...none, transform: 'translate(-480px, 0px)' }, outgoing: { ...none, transform: 'translate(0px, 0px)' } });
  assert.deepEqual(styles('push', 0.5), { incoming: { ...none, transform: 'translate(-240px, 0px)' }, outgoing: { ...none, transform: 'translate(240px, 0px)' } });
  assert.deepEqual(styles('push', 1), { incoming: { ...none, transform: 'translate(0px, 0px)' }, outgoing: { ...none, transform: 'translate(480px, 0px)' } });
  assert.deepEqual(styles({ type: 'push', direction: 'down' }, 0.25), { incoming: { ...none, transform: 'translate(0px, 202.5px)' }, outgoing: { ...none, transform: 'translate(0px, -67.5px)' } });
});

test('push: every direction at p 0, 0.5 and 1 (incoming from the edge, outgoing out the opposite side)', () => {
  const T = (x, y) => ({ ...none, transform: `translate(${x}px, ${y}px)` });
  const table = {
    left: [[T(-480, 0), T(0, 0)], [T(-240, 0), T(240, 0)], [T(0, 0), T(480, 0)]],
    right: [[T(480, 0), T(0, 0)], [T(240, 0), T(-240, 0)], [T(0, 0), T(-480, 0)]],
    up: [[T(0, -270), T(0, 0)], [T(0, -135), T(0, 135)], [T(0, 0), T(0, 270)]],
    down: [[T(0, 270), T(0, 0)], [T(0, 135), T(0, -135)], [T(0, 0), T(0, -270)]],
  };
  for (const [direction, rows] of Object.entries(table)) {
    [0, 0.5, 1].forEach((p, n) => assert.deepEqual(styles({ type: 'push', direction }, p), { incoming: rows[n][0], outgoing: rows[n][1] }, `${direction} at ${p}`));
  }
});

test('slide: only the incoming scene moves, from the named edge', () => {
  for (const [direction, at0, at5] of [['left', 'translate(-480px, 0px)', 'translate(-240px, 0px)'], ['right', 'translate(480px, 0px)', 'translate(240px, 0px)'],
    ['up', 'translate(0px, -270px)', 'translate(0px, -135px)'], ['down', 'translate(0px, 270px)', 'translate(0px, 135px)']]) {
    assert.deepEqual(styles({ type: 'slide', direction }, 0), { incoming: { ...none, transform: at0 }, outgoing: none }, direction);
    assert.deepEqual(styles({ type: 'slide', direction }, 0.5), { incoming: { ...none, transform: at5 }, outgoing: none }, direction);
    assert.deepEqual(styles({ type: 'slide', direction }, 1), { incoming: { ...none, transform: 'translate(0px, 0px)' }, outgoing: none }, direction);
  }
});

test('wipe: the incoming scene is clipped to a rectangle growing from the named edge', () => {
  const clip = (direction, p) => styles({ type: 'wipe', direction }, p).incoming.clipPath;
  assert.equal(clip('left', 0), 'inset(0% 100% 0% 0%)');
  assert.equal(clip('left', 0.5), 'inset(0% 50% 0% 0%)');
  assert.equal(clip('left', 1), 'inset(0% 0% 0% 0%)');
  assert.equal(clip('down', 0.25), 'inset(75% 0% 0% 0%)');
  const edges = { right: ['inset(0% 0% 0% 100%)', 'inset(0% 0% 0% 50%)'], up: ['inset(0% 0% 100% 0%)', 'inset(0% 0% 50% 0%)'], down: ['inset(100% 0% 0% 0%)', 'inset(50% 0% 0% 0%)'] };
  for (const [direction, [at0, at5]] of Object.entries(edges)) {
    assert.equal(clip(direction, 0), at0, `${direction} at 0`);
    assert.equal(clip(direction, 0.5), at5, `${direction} at 0.5`);
    assert.equal(clip(direction, 1), 'inset(0% 0% 0% 0%)', `${direction} at 1`);
  }
  assert.deepEqual(styles('wipe', 0.5), { incoming: { ...none, clipPath: 'inset(0% 50% 0% 0%)' }, outgoing: none }, 'left is the default');
});

test('zoom: the incoming scene scales to 1 from 1.2 (in) or 0.8 (out) while it fades in', () => {
  assert.deepEqual(styles('zoom', 0), { incoming: { ...none, transform: 'scale(1.2)', opacity: 0 }, outgoing: none });
  assert.deepEqual(styles('zoom', 0.5), { incoming: { ...none, transform: 'scale(1.1)', opacity: 0.5 }, outgoing: none });
  assert.deepEqual(styles('zoom', 1), { incoming: { ...none, transform: 'scale(1)', opacity: 1 }, outgoing: none });
  assert.deepEqual(styles({ type: 'zoom', direction: 'out' }, 0), { incoming: { ...none, transform: 'scale(0.8)', opacity: 0 }, outgoing: none });
  assert.deepEqual(styles({ type: 'zoom', direction: 'out' }, 0.5), { incoming: { ...none, transform: 'scale(0.9)', opacity: 0.5 }, outgoing: none });
  assert.deepEqual(styles({ type: 'zoom', direction: 'out' }, 1), { incoming: { ...none, transform: 'scale(1)', opacity: 1 }, outgoing: none });
});

test('blur: the incoming scene sharpens from 24 px to none while it fades in', () => {
  assert.deepEqual(styles('blur', 0), { incoming: { ...none, filter: 'blur(24px)', opacity: 0 }, outgoing: none });
  assert.deepEqual(styles('blur', 0.5), { incoming: { ...none, filter: 'blur(12px)', opacity: 0.5 }, outgoing: none });
  assert.deepEqual(styles('blur', 1), { incoming: { ...none, filter: 'blur(0px)', opacity: 1 }, outgoing: none });
});

test('iris in opens the incoming scene as a growing circle; iris out closes the outgoing one over it', () => {
  assert.deepEqual(styles('iris', 0), { incoming: { ...none, clipPath: 'circle(0% at 50% 50%)' }, outgoing: none });
  assert.deepEqual(styles('iris', 0.5), { incoming: { ...none, clipPath: 'circle(35.5% at 50% 50%)' }, outgoing: none });
  assert.deepEqual(styles({ type: 'iris', direction: 'in' }, 1), { incoming: { ...none, clipPath: 'circle(71% at 50% 50%)' }, outgoing: none });
  assert.deepEqual(styles({ type: 'iris', direction: 'out' }, 0), { incoming: none, outgoing: { ...none, clipPath: 'circle(71% at 50% 50%)' } });
  assert.deepEqual(styles({ type: 'iris', direction: 'out' }, 0.5), { incoming: none, outgoing: { ...none, clipPath: 'circle(35.5% at 50% 50%)' } });
  assert.deepEqual(styles({ type: 'iris', direction: 'out' }, 1), { incoming: none, outgoing: { ...none, clipPath: 'circle(0% at 50% 50%)' } });
  assert.equal(layerUnder('iris'), null);
  assert.equal(layerUnder({ type: 'iris', direction: 'out' }), 'incoming', 'the outgoing layer is drawn over the incoming one');
  assert.equal(layerUnder('push'), null);
});

test('none, fade and crossfade set no layer style', () => {
  for (const name of ['none', 'fade', 'crossfade']) assert.deepEqual(styles(name, 0.5), { incoming: none, outgoing: none }, name);
});

// ---- validation and defaults -------------------------------------------------------------------

test('every name and the object form validate on a scene (not the first) and as the root default', () => {
  for (const name of TRANSITIONS) {
    assert.deepEqual(errs({ scenes: scenes({ transition: name }) }), [], name);
    assert.deepEqual(errs({ transition: name, scenes: scenes() }), [], `root ${name}`);
  }
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'push', direction: 'up', duration: 0.8 } }) }), []);
  assert.deepEqual(errs({ transition: { type: 'iris', direction: 'out' }, scenes: scenes() }), []);
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'blur' } }) }), []);
});

test('an unknown direction is an error that lists the directions of that type', () => {
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'push', direction: 'sideways' } }) }),
    ['scenes[1].transition.direction: must be one of "left", "right", "up", "down" for push; got "sideways"']);
  assert.deepEqual(errs({ transition: { type: 'zoom', direction: 'left' }, scenes: scenes() }),
    ['transition.direction: must be one of "in", "out" for zoom; got "left"']);
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'iris', direction: 'up' } }) }),
    ['scenes[1].transition.direction: must be one of "in", "out" for iris; got "up"']);
});

test('a type that takes no direction refuses one, and an inherited name is no direction', () => {
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'blur', direction: 'left' } }) }), ['scenes[1].transition.direction: blur takes no direction; remove it']);
  assert.deepEqual(errs({ scenes: scenes({ transition: { type: 'crossfade', direction: 'in' } }) }), ['scenes[1].transition.direction: crossfade takes no direction; remove it']);
  assert.equal(errs({ scenes: scenes({ transition: { type: 'push', direction: 'constructor' } }) }).length, 1);
  assert.equal(errs({ scenes: scenes({ transition: { type: 'push', direction: '__proto__' } }) }).length, 1);
});

test('the object form is checked: a type is required, an unknown type or key or a duration out of range is named', () => {
  assert.match(errs({ scenes: scenes({ transition: { direction: 'left' } }) }).join('\n'), /scenes\[1\]\.transition\.type: required/);
  const e = errs({ scenes: scenes({ transition: { type: 'spin' } }) });
  assert.equal(e.length, 1);
  assert.match(e[0], /^scenes\[1\]\.transition\.type: must be one of "none", "fade", "crossfade", "push", "slide", "wipe", "zoom", "blur", "iris"/);
  assert.equal(errs({ scenes: scenes({ transition: { type: 'constructor' } }) }).length, 1);
  assert.match(errs({ scenes: scenes({ transition: { type: 'push', ease: 'linear' } }) }).join('\n'), /scenes\[1\]\.transition\.ease: unknown property/);
  assert.match(errs({ scenes: scenes({ transition: { type: 'push', duration: 0.05 } }) }).join('\n'), /scenes\[1\]\.transition\.duration: must be >= 0\.1/);
  assert.match(errs({ scenes: scenes({ transition: { type: 'push', duration: 3 } }) }).join('\n'), /scenes\[1\]\.transition\.duration: must be <= 2/);
  assert.match(errs({ scenes: scenes({ transition: 5 }) }).join('\n'), /scenes\[1\]\.transition: must be one of "none"/);
});

test('an unknown name says the nine names', () => {
  const e = errs({ transition: 'spin', scenes: scenes() });
  assert.equal(e.length, 1);
  assert.match(e[0], /^transition: must be one of "none", "fade", "crossfade", "push", "slide", "wipe", "zoom", "blur", "iris"/);
});

test('every name but none and fade on the first scene is the "needs a previous scene" error; a root default is not', () => {
  for (const name of ['crossfade', 'push', 'slide', 'wipe', 'zoom', 'blur', 'iris']) {
    const e = errs({ scenes: scenes({}, { transition: name }) });
    assert.equal(e.length, 1, name);
    assert.match(e[0], new RegExp(`^scenes\\[0\\]\\.transition: ${name} needs a previous scene to .+; use "fade" or "none" on the first scene$`), name);
    assert.deepEqual(errs({ transition: name, scenes: scenes() }), [], `root ${name}`);
  }
  assert.match(errs({ scenes: scenes({}, { transition: { type: 'push', direction: 'up' } }) })[0], /^scenes\[0\]\.transition: push needs a previous scene/);
  assert.deepEqual(errs({ scenes: scenes({}, { transition: 'none' }) }), []);
  assert.deepEqual(errs({ scenes: scenes({}, { transition: 'fade' }) }), []);
  assert.deepEqual(errs({ scenes: scenes({}, { transition: { type: 'fade', duration: 1 } }) }), []);
});

test('the root transition, name or object, is the default of every scene that sets none, and the first scene cuts for every overlapping type', () => {
  const object = { type: 'push', direction: 'up', duration: 0.6 };
  const d = withDefaults({ transition: object, scenes: [...scenes(), { id: 's3', duration: 1, transition: 'none', elements: [label('c')] }] });
  assert.deepEqual(d.scenes.map((s) => s.transition), ['none', object, 'none']);
  assert.deepEqual(withDefaults({ transition: 'zoom', scenes: scenes() }).scenes.map((s) => s.transition), ['none', 'zoom']);
  assert.deepEqual(withDefaults({ transition: { type: 'fade', duration: 1 }, scenes: scenes() }).scenes.map((s) => s.transition), [{ type: 'fade', duration: 1 }, { type: 'fade', duration: 1 }]);
  assert.deepEqual(withDefaults({ transition: 'iris', scenes: scenes({ transition: { type: 'iris', direction: 'out' } }) }).scenes.map((s) => s.transition), ['none', { type: 'iris', direction: 'out' }]);
});

// ---- timeline ----------------------------------------------------------------------------------

test('overlaps carries every window with its type; crossfades keeps the crossfade ones in their old shape', () => {
  const built = buildTimeline({ scenes: [...scenes({ transition: 'push' }), { id: 's3', duration: 3, transition: 'crossfade', elements: [label('c')] },
    { id: 's4', duration: 3, transition: { type: 'iris', duration: 1.5 }, elements: [label('d')] }, { id: 's5', duration: 3, transition: 'fade', elements: [label('e')] }] });
  assert.deepEqual(built.overlaps, [
    { from: 0, to: 1, start: 3, end: 3.4, type: 'push' },
    { from: 1, to: 2, start: 6, end: 6.4, type: 'crossfade' },
    { from: 2, to: 3, start: 9, end: 10.5, type: 'iris' },
  ]);
  assert.deepEqual(built.crossfades, [{ from: 1, to: 2, start: 6, end: 6.4 }]);
});

test('no transition, fade and a transition on the first scene leave overlaps empty', () => {
  assert.deepEqual(buildTimeline({ scenes: scenes() }).overlaps, []);
  assert.deepEqual(buildTimeline({ scenes: scenes({ transition: 'fade' }) }).overlaps, []);
  assert.deepEqual(buildTimeline({ scenes: scenes({}, { transition: 'wipe' }) }).overlaps, []);
});

test('a window is the transition duration, capped at the length of the scene it brings in', () => {
  assert.deepEqual(buildTimeline({ scenes: scenes({ transition: { type: 'slide', duration: 1.5 } }) }).overlaps, [{ from: 0, to: 1, start: 3, end: 4.5, type: 'slide' }]);
  const short = buildTimeline({ scenes: [...scenes(), { id: 's3', duration: 0.2, transition: 'zoom', elements: [label('c')] }] });
  assert.deepEqual(short.overlaps, [{ from: 1, to: 2, start: 6, end: 6.2, type: 'zoom' }]);
  const faded = buildTimeline({ scenes: scenes({ transition: { type: 'crossfade', duration: 1 } }) });
  assert.deepEqual(faded.overlaps, [{ from: 0, to: 1, start: 3, end: 4, type: 'crossfade' }]);
});

test('the progress of a window runs 0 to 1 with inOutCubic; the opacity of the incoming scene stays 1', () => {
  const { timeline, states } = buildTimeline({ scenes: scenes({ transition: { type: 'push', duration: 1 } }) });
  const at = (sec) => { seekTo(timeline, sec); const s = states.get('scene:s2'); return [s.p, s.opacity]; };
  assert.deepEqual(at(2.9), [0, 1]);
  assert.deepEqual(at(3), [0, 1]);
  const [quarter] = at(3.25);
  assert.ok(Math.abs(quarter - 0.0625) < 1e-6, `inOutCubic(0.25) = 0.0625, got ${quarter}`);
  const [half] = at(3.5);
  assert.ok(Math.abs(half - 0.5) < 1e-6, `got ${half}`);
  assert.deepEqual(at(4), [1, 1]);
  assert.deepEqual(at(5), [1, 1]);
  assert.deepEqual(at(2.9), [0, 1], 'seeking back restores the start');
});

test('a scene with no moving transition has no progress', () => {
  const { states } = buildTimeline({ scenes: scenes({ transition: 'crossfade' }) });
  assert.equal(states.get('scene:s2').p, undefined);
});

// ---- viral mode --------------------------------------------------------------------------------

test('viral auto cues put a swoosh on a cut into a scene with the object form or a new transition, as on a crossfade', () => {
  const swooshes = (transition) => withDefaults({ mode: 'viral', format: '9:16', scenes: [
    { id: 'a', duration: 4, elements: [label('hook one two three')] },
    { id: 'b', duration: 4, transition, elements: [label('b')] }] }).cues.filter((c) => c.cue === 'swoosh').map((c) => c.scene);
  for (const transition of ['none', 'crossfade', 'push', { type: 'push', direction: 'up' }, { type: 'iris', direction: 'out' }]) {
    assert.deepEqual(swooshes(transition), ['b'], JSON.stringify(transition));
  }
  assert.deepEqual(errs({ mode: 'viral', format: '9:16', transition: { type: 'slide', direction: 'up' }, scenes: scenes() }).filter((m) => m.includes('transition')), []);
});

// ---- the page ----------------------------------------------------------------------------------

const everyKind = () => [
  { id: 'base', duration: 1.2, elements: [label('base-text', { x: 160, y: 90, fontSize: 28 })] },
  ...[['push', 'left'], ['push', 'down'], ['slide', 'right'], ['wipe', 'up'], ['zoom', 'out'], ['blur'], ['iris', 'out'], ['iris', 'in']].map(([type, direction], i) => ({
    id: `t${i}`, duration: 1.2, background: i % 2 ? '#13324a' : '#4a1d2e', transition: direction ? { type, direction } : { type }, elements: [label(`${type}${i}-text`, { x: 160, y: 90, fontSize: 28 })],
  })),
];

// Runs in the page: for each of `secs`, the inline look of every scene layer that is up, [opacity, transform, clip-path,
// filter, z-index], and null for a hidden one. Passed to probed() as source, since a closure does not travel.
const READ_LAYERS = async (secs) => {
  const looks = [];
  for (const sec of secs) {
    await window.__motion.seek(sec);
    looks.push([...document.getElementById('stage').querySelectorAll(':scope > .scene')].map((l) => (getComputedStyle(l).display === 'none'
      ? null : [l.style.opacity, l.style.transform, l.style.clipPath, l.style.filter, l.style.zIndex])));
  }
  return looks;
};
const looksAt = (motion, ...secs) => probed(motion, `(${READ_LAYERS})(${JSON.stringify(secs)})`);

test('push mid-window: both layers are up, the old one beside the new one, and a layer outside any window has no styles', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const [before, mid, after, back] = await looksAt({ size: SIZE, scenes: scenes({ transition: { type: 'push', duration: 1 } }) }, 2.9, 3.5, 4.5, 3.5);
  assert.deepEqual(before, [['1', '', '', '', ''], null]);
  assert.deepEqual(mid, [['1', 'translate(240px, 0px)', '', '', ''], ['1', 'translate(-240px, 0px)', '', '', '']]);
  assert.deepEqual(after, [null, ['1', '', '', '', '']], 'after the window the layer is clean');
  assert.deepEqual(back, mid, 'seeking back to the same moment restores the same look');
  return undefined;
});

test('iris out draws the incoming layer beneath the closing outgoing one; zoom and blur fade the layer in', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return undefined;
  const [iris] = await looksAt({ size: SIZE, scenes: scenes({ transition: { type: 'iris', direction: 'out', duration: 1 } }) }, 3.5);
  assert.deepEqual(iris, [['1', '', 'circle(35.5% at 50% 50%)', '', ''], ['1', '', '', '', '-1']]);
  const [zoom] = await looksAt({ size: SIZE, scenes: scenes({ transition: { type: 'zoom', duration: 1 } }) }, 3.5);
  assert.deepEqual(zoom, [['1', '', '', '', ''], ['0.5', 'scale(1.1)', '', '', '']]);
  const [blur] = await looksAt({ size: SIZE, scenes: scenes({ transition: { type: 'blur', duration: 1 } }) }, 3.5);
  assert.deepEqual(blur, [['1', '', '', '', ''], ['0.5', '', '', 'blur(12px)', '']]);
  return undefined;
});

test('references/examples/transitions.json: seven scenes of 1.2 s, one per new transition, and it passes check with no output on stderr', async (t) => {
  const spec = loadSpec(EXAMPLE).spec;
  assert.equal(spec.scenes.length, 7);
  assert.ok(spec.scenes.every((s) => s.duration === 1.2));
  assert.deepEqual(spec.scenes.slice(1).map((s) => normalizeTransition(s.transition).type), ['push', 'slide', 'wipe', 'zoom', 'blur', 'iris']);
  assert.deepEqual(validateSpec(spec, { dir: path.dirname(EXAMPLE) }).errors, []);
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('transitions.json renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

for (const [name, transition] of [['push', { type: 'push', direction: 'down' }], ['slide', { type: 'slide', direction: 'up' }], ['wipe', { type: 'wipe', direction: 'right' }],
  ['zoom out', { type: 'zoom', direction: 'out' }], ['blur', { type: 'blur' }], ['iris in', { type: 'iris' }], ['iris out', { type: 'iris', direction: 'out' }]]) {
  test(`${name}: two renders of a scene pair with grain, vignette and text in the window renders byte-identical`, async (t) => {
    if (!(await requireRender(t))) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'tr-'));
    const file = path.join(dir, 'm.json');
    writeFileSync(file, JSON.stringify({ size: [320, 180], fps: 30, texture: { grain: 0.05, vignette: true }, scenes: [
      { id: 'a', duration: 1, background: '#10243a', elements: [label('first', { x: 160, y: 60, fontSize: 28 })] },
      { id: 'b', duration: 1.2, background: '#3a1f33', transition: { ...transition, duration: 0.6 }, elements: [label('second', { x: 160, y: 120, fontSize: 28 })] }] }));
    await assertRendersIdentically(t, file, ['--fps', '10', '--size', '320x180']);
  });
}

test('every kind in one spec renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'tr-'));
  const file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify({ size: [320, 180], fps: 30, scenes: everyKind() }));
  await assertRendersIdentically(t, file, ['--fps', '10', '--size', '320x180']);
});

// ---- check -------------------------------------------------------------------------------------

const check = (scenesList, extra = []) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tr-check-'));
  const file = path.join(dir, 'm.json');
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, scenes: scenesList }));
  return spawnSync(process.execPath, [CHECK, file, ...extra], { encoding: 'utf8' });
};
const word = (id, extra = {}) => ({ id, type: 'text', text: id, x: 960, y: 540, fontSize: 64, ...extra });

test('check: texts of the two scenes that overlap in a zoom, blur, wipe or iris window are a warning that names the type', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const transition of ['zoom', 'blur', 'iris', 'wipe']) {
    const r = check([{ id: 'a', duration: 2, elements: [word('first')] }, { id: 'b', duration: 2, transition, elements: [word('second')] }]);
    assert.equal(r.status, 0, `${transition}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^warning: scenes\\[1\\]\\.elements\\[0\\]: text "second" overlaps text "first" of the outgoing scene "a" during the ${transition} at \\d\\.\\d\\ds; move one of them, or let the outgoing text exit first\\n$`), transition);
  }
});

test('check: a push never puts the two layers over each other, so it has no overlap warning', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = check([{ id: 'a', duration: 2, elements: [word('first')] }, { id: 'b', duration: 2, transition: { type: 'push', duration: 1 }, elements: [word('second')] }]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('check: the scene is judged where it settles, not where the transition has moved it', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  // The opacity keyframes add a sheet moment at 0.5 s, halfway through a 1 s window: a pushed-in layer is then half a
  // canvas to the side, and its text must not read as leaving the safe area.
  const settled = { keyframes: [{ t: 0.4, opacity: 1 }, { t: 0.45, opacity: 1 }] };
  for (const transition of [{ type: 'push', direction: 'right', duration: 1 }, { type: 'slide', direction: 'down', duration: 1 }, { type: 'zoom', duration: 1 }]) {
    const r = check([{ id: 'a', duration: 2, elements: [word('first', { y: 300 })] }, { id: 'b', duration: 2, transition, elements: [word('second', { y: 760, ...settled })] }]);
    assert.equal(r.status, 0, `${transition.type}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '', transition.type);
  }
});

test('check: a real problem in the incoming scene is still reported inside a transition window', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = check([{ id: 'a', duration: 2, elements: [word('first')] }, { id: 'b', duration: 2, transition: { type: 'slide', duration: 1 }, elements: [word('one', { y: 300 }), word('two', { y: 300 })] }]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^scenes\[1\]\.elements\[1\]: text "two" overlaps text "one"/m);
});

test('check: a first scene that fades in warns that frame 0 is blank when the fade is the object form too', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = check([{ id: 'intro', duration: 2, transition: { type: 'fade', duration: 1 }, elements: [word('hello')] }]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /the scene fades in from the background/);
});

// ---- backward compatibility ---------------------------------------------------------------------

test('a name and its object form render the same bytes (fade, crossfade, none), and a crossfade is not a cut', async (t) => {
  if (!(await requireRender(t))) return;
  const hashOf = async (transition) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tr-same-'));
    const file = path.join(dir, 'm.json');
    writeFileSync(file, JSON.stringify({ size: [320, 180], fps: 30, scenes: [
      { id: 'a', duration: 1, background: '#10243a', elements: [label('first', { x: 160, y: 60, fontSize: 28 })] },
      { id: 'b', duration: 1, background: '#3a1f33', transition, elements: [label('second', { x: 160, y: 120, fontSize: 28 })] }] }));
    return (await renderHash(file, ['--fps', '10', '--size', '320x180'])).sha256;
  };
  for (const name of ['fade', 'crossfade', 'none']) assert.equal(await hashOf({ type: name }), await hashOf(name), `${name} as an object`);
  assert.notEqual(await hashOf('crossfade'), await hashOf('none'), 'a crossfade is not a cut');
});

// ---- fix round 1 -------------------------------------------------------------------------------

// F1: scenes that set no `background` inherit the root one. A layer that comes in over (or closes over) another must
// paint it, or the old scene shows through the whole window and drops out in one frame.
const rect = (id, extra) => ({ id, type: 'shape', shape: 'rect', fill: '#ffffff', ...extra });
const coveredScenes = (transition, background) => [
  { id: 'a', duration: 3, ...(background && { background }), elements: [rect('old', { x: 180, y: 135, width: 60, height: 60 })] },
  { id: 'b', duration: 3, ...(background && { background }), transition, elements: [rect('new', { x: 330, y: 135, width: 60, height: 60, fill: '#808080' })] },
];

for (const transition of [{ type: 'wipe', direction: 'left' }, { type: 'slide', direction: 'left' }, { type: 'iris', direction: 'in' }, { type: 'iris', direction: 'out' }, { type: 'zoom' }, { type: 'blur' }]) {
  test(`${transition.type}${transition.direction ? ` ${transition.direction}` : ''} mid-window: scenes that inherit the root background draw the same pixels as scenes that set it`, async (t) => {
    if (!(await requireRender(t, BROWSER_ONLY))) return;
    const window1 = { ...transition, duration: 1 };
    const inherited = await framed({ size: SIZE, background: '#000000', scenes: coveredScenes(window1) }, 3.5);
    const explicit = await framed({ size: SIZE, background: '#000000', scenes: coveredScenes(window1, '#000000') }, 3.5);
    const [a, b] = [await meanLuma(inherited), await meanLuma(explicit)];
    assert.ok(Math.abs(a - b) < 0.5, `inherited ${a.toFixed(2)} vs explicit ${b.toFixed(2)}: the old scene must not show through`);
  });
}

// A see-through scene background (`transparent`, an rgba() or hsla() under alpha 1) is painted over an opaque base in the
// window, the root colour and, if that is see-through too, the theme's page colour, so the old scene still cannot show.
for (const seeThrough of ['transparent', 'rgba(0, 0, 0, 0.3)', 'hsla(0, 0%, 0%, 0.5)']) {
  test(`a scene background of ${seeThrough} covers the old scene in a wipe window as an opaque one does`, async (t) => {
    if (!(await requireRender(t, BROWSER_ONLY))) return;
    const wipe = { type: 'wipe', direction: 'left', duration: 1 };
    const clear = await framed({ size: SIZE, background: '#000000', scenes: coveredScenes(wipe, seeThrough) }, 3.5);
    const solid = await framed({ size: SIZE, background: '#000000', scenes: coveredScenes(wipe, '#000000') }, 3.5);
    const [a, b] = [await meanLuma(clear), await meanLuma(solid)];
    assert.ok(Math.abs(a - b) < 0.5, `${seeThrough}: ${a.toFixed(2)} vs opaque ${b.toFixed(2)}: the old scene must not show through`);
  });
}

test('a see-through root background falls back to the theme page colour in the window, and the same frame comes out', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const wipe = { type: 'wipe', direction: 'left', duration: 1 };
  const theme = await probed({ size: SIZE, scenes: coveredScenes('none') }, () => document.getElementById('stage').style.background);
  const clear = await framed({ size: SIZE, background: 'transparent', scenes: coveredScenes(wipe, 'transparent') }, 3.5);
  const solid = await framed({ size: SIZE, background: theme, scenes: coveredScenes(wipe, theme) }, 3.5);
  const [a, b] = [await meanLuma(clear), await meanLuma(solid)];
  assert.ok(Math.abs(a - b) < 0.5, `transparent ${a.toFixed(2)} vs the theme colour ${b.toFixed(2)} (${theme})`);
});

test('scenes that inherit the theme page colour (no root background either) cover the old scene in a window', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const wipe = { type: 'wipe', direction: 'left', duration: 1 };
  const theme = await probed({ size: SIZE, scenes: coveredScenes('none') }, () => document.getElementById('stage').style.background);
  const inherited = await framed({ size: SIZE, scenes: coveredScenes(wipe) }, 3.5);
  const explicit = await framed({ size: SIZE, background: theme, scenes: coveredScenes(wipe, theme) }, 3.5);
  const [a, b] = [await meanLuma(inherited), await meanLuma(explicit)];
  assert.ok(Math.abs(a - b) < 0.5, `inherited ${a.toFixed(2)} vs explicit ${b.toFixed(2)} (${theme})`);
});

test('an art scene coming in covers the old scene with its plate: the old content makes no difference to the frame', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const slide = { type: 'slide', direction: 'left', duration: 1 };
  const build = (oldElements) => [
    { id: 'a', duration: 3, elements: oldElements },
    { id: 'b', duration: 3, background: 'art', transition: slide, elements: [] }];
  const withOld = await framed({ size: SIZE, background: '#000000', scenes: build([rect('old', { x: 180, y: 135, width: 60, height: 60 })]) }, 3.5);
  const without = await framed({ size: SIZE, background: '#000000', scenes: build([]) }, 3.5);
  const [a, b] = [await meanLuma(withOld), await meanLuma(without)];
  assert.ok(Math.abs(a - b) < 0.5, `with the old square ${a.toFixed(2)}, without ${b.toFixed(2)}`);
});

// F2: a transition window is motion, whatever it does to the layer. 3.4 s of a still scene with a 0.6 s window is 2.8 s still.
const STILL_THREE = (transition) => [
  { id: 'a', duration: 2, elements: [word('first', { y: 300 })] },
  { id: 'b', duration: 3.4, transition, elements: [word('second', { y: 760 })] },
  { id: 'c', duration: 3.2, elements: [word('third', { y: 300 })] },
];
const EVERY_WINDOW = [{ type: 'crossfade', duration: 0.6 }, { type: 'push', duration: 0.6 }, { type: 'slide', duration: 0.6 }, { type: 'wipe', duration: 0.6 },
  { type: 'zoom', duration: 0.6 }, { type: 'blur', duration: 0.6 }, { type: 'iris', duration: 0.6 }, { type: 'iris', direction: 'out', duration: 0.6 }];

test('check: a 0.6 s window of every transition counts as motion, so 3.4 s of a still scene is not a dead stretch; a plain cut is', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const transition of EVERY_WINDOW) {
    const r = check(STILL_THREE(transition));
    assert.equal(r.status, 0, `${transition.type} ${transition.direction ?? ''}: ${r.stdout}${r.stderr}`);
  }
  const cut = check(STILL_THREE('none'));
  assert.equal(cut.status, 1, 'guardrail: with no window the same spec is a dead stretch');
  assert.match(cut.stdout, /nothing changes from 2\.00s to 5\.40s/);
});

test('check under viral mode: a transition window is not part of a still stretch either', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const viral = (transition) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tr-viral-'));
    const file = path.join(dir, 'm.json');
    writeFileSync(file, JSON.stringify({ mode: 'viral', fps: 30, scenes: STILL_THREE(transition).slice(0, 2).map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e, x: 540, y: 900, fontSize: 80 })) })) }));
    return spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
  };
  // Two scenes, the last one still for 3.4 s: viral's own stretch warning (no tail exemption) fires for the cut, not for a window.
  assert.match(viral('none').stderr, /viral: nothing changes from 2\.00s to 5\.40s/, 'guardrail: the cut shows the viral still warning');
  for (const transition of [{ type: 'push', duration: 0.6 }, { type: 'iris', duration: 0.6 }, { type: 'wipe', duration: 0.6 }]) {
    assert.doesNotMatch(viral(transition).stderr, /nothing changes/, transition.type);
  }
});

test('changeGaps (viral, no page): a transition window is a change span from the scene start', () => {
  const gapsOf = (transition) => changeGaps(withDefaults({ mode: 'viral', scenes: STILL_THREE(transition).slice(0, 2) }));
  assert.deepEqual(gapsOf('none'), [{ from: 2, to: 5.4 }]);
  for (const transition of EVERY_WINDOW) assert.deepEqual(gapsOf(transition), [], `${transition.type}`);
});

// F3: the backdrop is read from a screenshot of the whole stage, so inside a window it is two layers. A text is not
// judged for contrast while its scene is coming in, as it is not judged inside an opacity tween of its own.
const CONTRAST = (transition, extra = {}) => [
  { id: 'a', duration: 2, background: '#f4f4f4', elements: [word('first', { y: 300, color: '#101010' })] },
  { id: 'b', duration: 4, background: '#101010', transition, elements: [word('second', { y: 760, color: '#f4f4f4', keyframes: [{ t: 0.3, opacity: 1 }, { t: 0.31, opacity: 1 }], ...extra })] },
];

test('check: text on the incoming scene is not judged against the outgoing scene during its window (iris out, blur, zoom, crossfade)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const transition of [{ type: 'iris', direction: 'out', duration: 2 }, { type: 'blur', duration: 2 }, { type: 'zoom', duration: 2 }, { type: 'crossfade', duration: 0.8 }]) {
    const r = check(CONTRAST(transition));
    assert.equal(r.status, 0, `${transition.type}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /contrast/, `${transition.type}: ${r.stderr}`);
  }
});

test('check: contrast is still judged outside the window, in a scene that has a transition', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const bad = CONTRAST({ type: 'iris', direction: 'out', duration: 0.4 }, { color: '#101010' }); // dark text on the dark scene
  const r = check(bad);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /text "second" has 1\.\d:1 contrast against its backdrop/);
});

// F4: `crossfades` keeps its old meaning on the built timeline and on the page; `overlaps` holds every window.
test('window.__motion.crossfades holds the crossfade windows only, as built.crossfades does; overlaps holds all of them', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const found = await probed({ size: SIZE, scenes: [...scenes({ transition: 'push' }), { id: 's3', duration: 3, transition: 'crossfade', elements: [label('c')] }] },
    () => ({ crossfades: window.__motion.crossfades, overlaps: window.__motion.overlaps }));
  assert.deepEqual(found.crossfades, [{ from: 1, to: 2, start: 6, end: 6.4 }]);
  assert.deepEqual(found.overlaps.map((w) => w.type), ['push', 'crossfade']);
});

// F13: a root object default is not shared between scenes.
test('a root transition object is copied into each scene, not shared', () => {
  const root = { type: 'push', direction: 'up' };
  const d = withDefaults({ transition: root, scenes: [...scenes(), { id: 's3', duration: 1, elements: [label('c')] }] });
  assert.notStrictEqual(d.scenes[1].transition, root);
  assert.notStrictEqual(d.scenes[1].transition, d.scenes[2].transition);
  assert.deepEqual(d.scenes[2].transition, root);
});

// A text that gets no judged contrast sample because of a window is said so, as an info line (never a failure).
test('check: a text whose every shown moment is inside its scene\'s window gets an info line, and one with a later moment does not', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const pair = (duration) => [{ id: 'a', duration: 2, elements: [word('first', { y: 300 })] },
    { id: 'b', duration, transition: { type: 'push', duration: 2 }, elements: [word('second', { y: 760 })] }];
  const short = check(pair(1.2));
  assert.equal(short.status, 0, short.stdout + short.stderr);
  assert.match(short.stderr, /^info: scenes\[1\]\.elements\[0\]: text "second" was not judged for contrast: every moment it shows in falls inside the push window of its scene; lengthen the scene or shorten the transition$/m);
  const json = JSON.parse(check(pair(1.2), ['--json']).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.info.filter((i) => i.message.includes('not judged for contrast')).length, 1);
  assert.equal(json.info.find((i) => i.message.includes('not judged for contrast')).path, 'scenes[1].elements[0]');
  assert.doesNotMatch(check(pair(4)).stderr, /not judged for contrast/, 'a later moment is judged');
});

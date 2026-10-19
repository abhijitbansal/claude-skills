// Per-theme kinetic type: a `role: "title"` text with no keyframes gets its theme's preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_PRESETS, MOTION_THEME, presetKeyframes, withDefaults } from '../template/defaults.mjs';
import { MOTION_THEME as SCRIPTS_MOTION_THEME } from '../scripts/lib/default-theme.mjs';
import { buildTimeline, seekTo } from '../template/timeline.mjs';
import { validateSpec, ANIMATABLE } from '../scripts/lib/spec.mjs';

const DURATIONS = [0.2, 0.5, 1, 3, 12];
const FPS = [24, 25, 30, 60];
const title = (extra = {}) => ({ id: 'h', type: 'text', role: 'title', text: 'Launch', x: 960, y: 500, fontSize: 120, ...extra });
const one = (el, extra = {}) => ({ scenes: [{ id: 's', duration: 3, elements: [el] }], ...extra });

test('TYPE_PRESETS names one preset per new theme; dusk is the default theme in both places', () => {
  assert.deepEqual(TYPE_PRESETS, { dusk: 'rise', press: 'ink-in', poster: 'slam' });
  assert.equal(MOTION_THEME, 'dusk');
  assert.equal(SCRIPTS_MOTION_THEME, MOTION_THEME);
});

for (const name of Object.values(TYPE_PRESETS)) {
  test(`${name}: sorted, ends one frame before the scene end, deterministic, settles on the base pose`, () => {
    for (const duration of DURATIONS) {
      for (const fps of FPS) {
        const el = title({ opacity: 0.9, scale: 1.1 });
        const kfs = presetKeyframes(name, el, duration, fps);
        assert.ok(kfs.length >= 2, `${name} ${duration}s`);
        assert.equal(kfs[0].t, 0);
        for (let i = 1; i < kfs.length; i++) assert.ok(kfs[i].t >= kfs[i - 1].t, `${name} ${duration}s ${fps}fps sorted`);
        assert.ok(kfs.at(-1).t <= duration - 1 / fps + 1e-9, `${name} ${duration}s ${fps}fps: last t ${kfs.at(-1).t}`);
        assert.deepEqual(presetKeyframes(name, el, duration, fps), kfs, 'same input, same keyframes');
        for (const kf of kfs) for (const k of Object.keys(kf)) assert.ok(k === 't' || k === 'ease' || ANIMATABLE.text.includes(k), k);
        // the last keyframe that sets each prop lands on the element's own value
        const last = (prop) => kfs.filter((kf) => kf[prop] !== undefined).at(-1)?.[prop];
        assert.equal(last('opacity'), 0.9);
        if (last('scale') !== undefined) assert.equal(last('scale'), 1.1);
        if (last('y') !== undefined) assert.equal(last('y'), 500);
        const spec = one({ ...title(), keyframes: kfs }, { fps });
        spec.scenes[0].duration = duration;
        assert.deepEqual(validateSpec(spec).errors, [], `${name} ${duration}s validates`);
      }
    }
  });
}

test('the three presets move differently: rise travels, ink-in only fades and settles, slam starts big', () => {
  const [rise, inkIn, slam] = ['rise', 'ink-in', 'slam'].map((n) => presetKeyframes(n, title(), 3, 30));
  assert.ok(rise.some((kf) => kf.y !== undefined && kf.y > 500), 'rise starts below its place');
  assert.ok(inkIn.every((kf) => kf.x === undefined && kf.y === undefined), 'ink-in has no movement');
  assert.equal(inkIn[0].scale, 1.04);
  assert.equal(slam[0].scale, 1.35);
  const span = (kfs) => kfs.at(-1).t;
  assert.ok(span(slam) < span(rise) && span(slam) < span(inkIn), 'slam is the fastest');
});

test('withDefaults gives an un-keyframed title its theme preset; no theme means dusk', () => {
  const kf = (spec) => withDefaults(spec).scenes[0].elements[0].keyframes;
  assert.deepEqual(kf(one(title())), presetKeyframes('rise', title(), 3, 30));
  assert.deepEqual(kf(one(title(), { theme: 'press' })), presetKeyframes('ink-in', title(), 3, 30));
  assert.deepEqual(kf(one(title(), { theme: 'poster', fps: 60 })), presetKeyframes('slam', title(), 3, 60));
  assert.equal(withDefaults(one(title())).theme, 'dusk');
});

test('a preset never overrides explicit keyframes, and legacy themes get none', () => {
  const own = [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }];
  assert.deepEqual(withDefaults(one(title({ keyframes: own }), { theme: 'poster' })).scenes[0].elements[0].keyframes, own);
  assert.deepEqual(withDefaults(one(title({ keyframes: [] }))).scenes[0].elements[0].keyframes, [], 'an explicit empty list opts out');
  for (const theme of ['paper', 'ink', 'blueprint', 'editorial']) {
    assert.deepEqual(withDefaults(one(title(), { theme })).scenes[0].elements[0].keyframes, [], theme);
  }
  const plain = { id: 'p', type: 'text', text: 'body', x: 1, y: 1 };
  assert.deepEqual(withDefaults(one(plain)).scenes[0].elements[0].keyframes, [], 'only role:title text gets a preset');
});

test('the preset drives the timeline: hidden at the scene start, fully in by the last frame', () => {
  const { timeline, states } = buildTimeline(one(title(), { theme: 'poster' }));
  seekTo(timeline, 0);
  assert.equal(states.get('h').opacity, 0);
  assert.equal(states.get('h').scale, 1.35);
  seekTo(timeline, 3 - 1 / 30);
  assert.equal(states.get('h').opacity, 1);
  assert.ok(Math.abs(states.get('h').scale - 1) < 1e-6);
});

// ---- opt-in exits -------------------------------------------------------------------------------

// Two scenes: the title sits in the first (not the last scene), `duration` seconds long.
const twoScenes = (el, { duration = 6, theme, fps } = {}) => ({
  ...(theme ? { theme } : {}), ...(fps ? { fps } : {}),
  scenes: [{ id: 'a', duration, elements: [el] }, { id: 'b', duration: 2, elements: [{ id: 'p', type: 'text', text: 'next', x: 1, y: 1 }] }],
});
const firstKeyframes = (spec) => withDefaults(spec).scenes[0].elements[0].keyframes;

test('exit: true appends the theme exit after 0.9 x duration, ending on opacity 0 one frame before the scene end', () => {
  for (const [theme, fps] of [['dusk', 30], ['press', 25], ['poster', 60]]) {
    for (const duration of [3, 6, 12]) {
      const entrance = firstKeyframes(twoScenes(title(), { duration, theme, fps }));
      const kfs = firstKeyframes(twoScenes(title({ exit: true }), { duration, theme, fps }));
      assert.deepEqual(kfs.slice(0, entrance.length), entrance, `${theme} ${duration}s: the entrance is untouched`);
      const exit = kfs.slice(entrance.length);
      assert.ok(exit.length >= 2, `${theme} ${duration}s has an exit`);
      assert.ok(exit[0].t >= 0.9 * duration - 1e-9, `${theme} ${duration}s exit starts at ${exit[0].t}`);
      assert.ok(exit[0].t >= entrance.at(-1).t, 'the exit starts after the entrance lands');
      assert.ok(exit.at(-1).t <= duration - 1 / fps + 1e-9, `${theme} ${duration}s exit ends at ${exit.at(-1).t}`);
      assert.equal(exit.at(-1).opacity, 0);
      assert.equal(exit.at(-1).ease, 'exit');
      for (let i = 1; i < kfs.length; i++) assert.ok(kfs[i].t >= kfs[i - 1].t, 'sorted');
      const spec = twoScenes({ ...title(), keyframes: kfs }, { duration, theme, fps });
      assert.deepEqual(validateSpec(spec).errors, [], `${theme} ${duration}s validates`);
    }
  }
});

test('each theme exits in its own way: rise drops out, ink-in grows slightly, slam snaps down', () => {
  const exitOf = (theme) => {
    const entrance = firstKeyframes(twoScenes(title(), { theme }));
    return firstKeyframes(twoScenes(title({ exit: true }), { theme })).slice(entrance.length);
  };
  assert.ok(exitOf('dusk').at(-1).y > 500, 'rise drops below its place');
  assert.ok(exitOf('press').at(-1).scale > 1 && exitOf('press').every((kf) => kf.y === undefined), 'ink-in grows, never moves');
  assert.ok(exitOf('poster').at(-1).scale < 1, 'slam snaps down');
});

test('exit is never added on the last scene, over author keyframes, on a too-short scene, or without exit: true', () => {
  assert.deepEqual(firstKeyframes(one(title({ exit: true }))), firstKeyframes(one(title())), 'the only scene is the last scene');
  const own = [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }];
  assert.deepEqual(firstKeyframes(twoScenes(title({ exit: true, keyframes: own }))), own, 'author keyframes win');
  assert.deepEqual(firstKeyframes(twoScenes(title({ exit: true }), { duration: 0.5 })), firstKeyframes(twoScenes(title(), { duration: 0.5 })), 'too short');
  assert.deepEqual(firstKeyframes(twoScenes(title({ exit: false }))), firstKeyframes(twoScenes(title())), 'exit: false');
  assert.deepEqual(firstKeyframes(twoScenes(title(), { theme: 'paper' })), [], 'a theme without a preset gets no exit either');
  assert.deepEqual(firstKeyframes(twoScenes(title({ exit: true }), { theme: 'paper' })), []);
});

test('an exit leaves the 85 % contact frame fully in and the last frame gone', () => {
  const { timeline, states, sceneStarts } = buildTimeline(twoScenes(title({ exit: true }), { duration: 6 }));
  seekTo(timeline, sceneStarts[0] + 0.85 * 6);
  assert.equal(states.get('h').opacity, 1);
  seekTo(timeline, sceneStarts[0] + 6 - 1 / 30);
  assert.ok(states.get('h').opacity < 1e-6, `opacity at the last frame is ${states.get('h').opacity}`);
});

test('withDefaults marks a title whose exit was applied (exitPreset: true), and only that title', () => {
  const marked = (spec) => withDefaults(spec).scenes[0].elements[0].exitPreset;
  assert.equal(marked(twoScenes(title({ exit: true }))), true, 'applied');
  assert.equal(marked(twoScenes(title({ exit: true }), { duration: 0.5 })), undefined, 'dropped: too short');
  assert.equal(marked(one(title({ exit: true }))), undefined, 'dropped: last scene');
  assert.equal(marked(twoScenes(title({ exit: true, keyframes: [{ t: 0, opacity: 1 }] }))), undefined, 'author keyframes');
  assert.equal(marked(twoScenes(title())), undefined, 'no exit');
});

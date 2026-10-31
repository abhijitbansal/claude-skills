// Pure, DOM-free: compiles a motion spec into one paused anime.js timeline that
// animates a plain state object per element. Runs unchanged in Node and the browser.
// The root `captions` tracks are not on it: nothing about them animates, and what a captions layer shows is a pure
// function of the time (template/captions.mjs captionState, applied by the renderer on every seek).
import { createTimeline, cubicBezier } from 'animejs';
import { withDefaults, EASE_CURVES, TYPING_SECONDS_PER_CHAR, typingLength, counterSeconds } from './defaults.mjs';
import { flattenElements } from './groups.mjs';
import { normalizeTransition, comesInOver } from './transitions.mjs';
import { CAMERA_PROPS, CAMERA_REST } from './camera.mjs';

const MS = 1000;
const MIN_SEGMENT_MS = 1;
const TRANSITION_EASE = 'inOutCubic'; // the progress of push, slide, wipe, zoom, blur and iris

// The named eases as anime.js easing functions; every other name is one of anime's own (a string it resolves).
const NAMED_EASES = Object.fromEntries(Object.entries(EASE_CURVES).map(([name, points]) => [name, cubicBezier(...points)]));
const easeOf = (name) => NAMED_EASES[name] ?? name ?? 'linear';

// Keyframes that set `prop`, as [{t, value, ease}] in order.
function track(keyframes, prop) {
  return keyframes
    .filter((kf) => kf[prop] !== undefined)
    .map((kf) => ({ t: kf.t, value: kf[prop], ease: easeOf(kf.ease) }));
}

// A counter with no `value` keyframes counts from -> to at the start of its scene.
function counterDefaultTrack(el, sceneDuration) {
  return [{ t: 0, value: el.from ?? 0, ease: 'linear' }, { t: counterSeconds(sceneDuration), value: el.to, ease: 'outCubic' }];
}

// A `typing` text types its characters from the start of its scene at TYPING_SECONDS_PER_CHAR each.
function typingDefaultTrack(el) {
  const chars = typingLength(el.text);
  return [{ t: 0, value: 0, ease: 'linear' }, { t: chars * TYPING_SECONDS_PER_CHAR, value: chars, ease: 'linear' }];
}

function elementTrack(el, prop, sceneDuration) {
  const points = track(el.keyframes, prop);
  if (prop === 'value' && el.type === 'counter' && !points.length) return counterDefaultTrack(el, sceneDuration);
  if (prop === 'value' && el.type === 'text' && el.typing && !points.length) return typingDefaultTrack(el);
  return points;
}

function addTrack(tl, state, prop, points, sceneStart) {
  if (!points.length) return;
  state[prop] = points[0].value; // hold before the first keyframe
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const duration = Math.max(MIN_SEGMENT_MS, (to.t - from.t) * MS);
    tl.add(state, {
      [prop]: { from: from.value, to: to.value, duration, ease: to.ease },
      composition: 'none',
    }, (sceneStart + from.t) * MS);
  }
}

export function buildTimeline(input) {
  const spec = withDefaults(input);
  const timeline = createTimeline({ autoplay: false, defaults: { ease: 'linear' } });
  const states = new Map();
  const sceneOf = new Map();
  const sceneStarts = [];
  const overlaps = []; // {from, to, start, end, type}: scene `from` stays visible under scene `to` until `end` (seconds)
  let cursor = 0;

  spec.scenes.forEach((scene, si) => {
    const start = cursor;
    sceneStarts.push(start);

    const transition = normalizeTransition(scene.transition);
    const comesIn = si > 0 && comesInOver(transition.type); // the first scene has nothing to come in over
    const fadesIn = transition.type === 'fade' || (comesIn && transition.type === 'crossfade');
    const moves = comesIn && !fadesIn; // push, slide, wipe, zoom, blur, iris: the renderer styles the layers from `p`
    const sceneState = { opacity: fadesIn ? 0 : 1 };
    if (moves) sceneState.p = 0;
    states.set(`scene:${scene.id}`, sceneState);
    if (fadesIn || moves) {
      const duration = Math.min(transition.duration, scene.duration) * MS;
      if (fadesIn) timeline.add(sceneState, { opacity: { from: 0, to: 1, duration }, composition: 'none' }, start * MS);
      else timeline.add(sceneState, { p: { from: 0, to: 1, duration, ease: easeOf(TRANSITION_EASE) }, composition: 'none' }, start * MS);
      // The previous scene is not faded: it stays at full opacity under the incoming one until the window ends, so
      // the stage colour never shows through (two layers fading together would dip towards it).
      if (comesIn) overlaps.push({ from: si - 1, to: si, start, end: start + duration / MS, type: transition.type });
    }

    if (scene.camera) { // the keyframed pose; the shake is added by the renderer, as a function of the time alone
      const pose = { ...CAMERA_REST };
      states.set(`camera:${scene.id}`, pose);
      for (const prop of CAMERA_PROPS) addTrack(timeline, pose, prop, track(scene.camera.keyframes ?? [], prop), start);
    }

    for (const { el } of flattenElements(scene.elements)) { // a group's children are elements of the scene too
      sceneOf.set(el.id, si);
      const state = {
        x: el.x, y: el.y, opacity: el.opacity, scale: el.scale, rotate: el.rotate,
        draw: el.draw, reveal: el.reveal, value: el.value,
      };
      states.set(el.id, state);
      for (const prop of Object.keys(state)) {
        addTrack(timeline, state, prop, elementTrack(el, prop, scene.duration), start);
      }
    }
    cursor += scene.duration;
  });

  // `crossfades` is the crossfade windows alone, as they were before the other transitions (no `type`).
  const crossfades = overlaps.filter((w) => w.type === 'crossfade').map(({ type, ...window }) => window);
  return { timeline, states, duration: cursor, sceneStarts, sceneOf, overlaps, crossfades };
}

// Seek to `sec` seconds. Deterministic: same input time gives the same state.
export function seekTo(timeline, sec) {
  timeline.seek(Math.max(0, sec) * MS);
}

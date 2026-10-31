// Pure, DOM-free: compiles a motion spec into one paused anime.js timeline that
// animates a plain state object per element. Runs unchanged in Node and the browser.
// The root `captions` tracks are not on it: nothing about them animates, and what a captions layer shows is a pure
// function of the time (template/captions.mjs captionState, applied by the renderer on every seek).
import { createTimeline, cubicBezier } from 'animejs';
import { withDefaults, FADE_SECONDS, EASE_CURVES, TYPING_SECONDS_PER_CHAR, typingLength, counterSeconds } from './defaults.mjs';
import { flattenElements } from './groups.mjs';

const MS = 1000;
const MIN_SEGMENT_MS = 1;

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
  const crossfades = []; // {from, to, start, end}: scene `from` stays visible under scene `to` until `end` (seconds)
  let cursor = 0;

  spec.scenes.forEach((scene, si) => {
    const start = cursor;
    sceneStarts.push(start);

    const blends = scene.transition === 'crossfade' && si > 0; // the first scene has nothing to fade out
    const fadesIn = scene.transition === 'fade' || blends;
    const sceneState = { opacity: fadesIn ? 0 : 1 };
    states.set(`scene:${scene.id}`, sceneState);
    if (fadesIn) {
      const duration = Math.min(FADE_SECONDS, scene.duration) * MS;
      timeline.add(sceneState, { opacity: { from: 0, to: 1, duration }, composition: 'none' }, start * MS);
      // The previous scene is not faded: it stays at full opacity under the incoming one until the window ends, so
      // the stage colour never shows through (two layers fading together would dip towards it).
      if (blends) crossfades.push({ from: si - 1, to: si, start, end: start + duration / MS });
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

  return { timeline, states, duration: cursor, sceneStarts, sceneOf, crossfades };
}

// Seek to `sec` seconds. Deterministic: same input time gives the same state.
export function seekTo(timeline, sec) {
  timeline.seek(Math.max(0, sec) * MS);
}

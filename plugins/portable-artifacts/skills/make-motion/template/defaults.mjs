// Browser-safe (no Node imports): shared by spec validation, timeline and renderer.
// No `background` default: the page fills it from the theme's page colour (see renderer fetchSpec).
const DEFAULTS = Object.freeze({ size: [1920, 1080], fps: 30 });
export const FADE_SECONDS = 0.4;

// make-motion's default theme (scripts/lib/default-theme.mjs re-exports it). The shared
// DEFAULT_THEME stays `paper` for make-dashboard.
export const MOTION_THEME = 'dusk';

// Per-theme kinetic type for `role: "title"` text that sets no keyframes. Themes not listed
// (paper, ink, blueprint, editorial) get no preset.
export const TYPE_PRESETS = Object.freeze({ dusk: 'rise', press: 'ink-in', poster: 'slam' });

// Seconds each preset takes when the scene is long enough; a shorter scene compresses it.
const PRESET_SECONDS = Object.freeze({ rise: 0.9, 'ink-in': 1.1, slam: 0.5 });
const RISE_OPACITY_SHARE = 0.6; // the fade settles before the travel: a soft stagger
const RISE_TRAVEL = 0.35; // of the font size
const INK_SCALE = 1.04;
const SLAM_SCALE = 1.35;
const SLAM_SNAP_SHARE = 0.25; // opacity snaps in over the first quarter
const DEFAULT_FONT_SIZE = 48;
const T_DECIMALS = 1e4;

const round = (t) => Math.round(t * T_DECIMALS) / T_DECIMALS;

const GENERATORS = {
  // dusk: a soft rise into place, the fade leading the travel.
  rise: (el, end) => [
    { t: 0, opacity: 0, y: el.y + Math.round((el.fontSize ?? DEFAULT_FONT_SIZE) * RISE_TRAVEL) },
    { t: round(end * RISE_OPACITY_SHARE), opacity: el.opacity ?? 1, ease: 'outCubic' },
    { t: end, y: el.y, ease: 'outQuart' },
  ],
  // press: ink settling on paper; no movement, a barely-there scale.
  'ink-in': (el, end) => [
    { t: 0, opacity: 0, scale: INK_SCALE * (el.scale ?? 1) },
    { t: end, opacity: el.opacity ?? 1, ease: 'inOutSine' },
    { t: end, scale: el.scale ?? 1, ease: 'outQuart' },
  ],
  // poster: thrown at the wall; a quick opacity snap and a big scale that lands with a bounce.
  slam: (el, end) => [
    { t: 0, opacity: 0, scale: SLAM_SCALE * (el.scale ?? 1) },
    { t: round(end * SLAM_SNAP_SHARE), opacity: el.opacity ?? 1, ease: 'outQuad' },
    { t: end, scale: el.scale ?? 1, ease: 'outBack' },
  ],
};

/**
 * The keyframes of preset `name` for text element `el` in a scene of `sceneDuration` seconds.
 * Pure: the same arguments always give the same keyframes. The last one lands at least one
 * frame (1/fps) before the scene end, so the final pose is always shown.
 */
export function presetKeyframes(name, el, sceneDuration, fps) {
  const end = round(Math.min(PRESET_SECONDS[name], Math.floor((sceneDuration - 1 / fps) * T_DECIMALS) / T_DECIMALS));
  return GENERATORS[name](el, end);
}

function presetFor(el, theme, sceneDuration, fps) {
  const name = TYPE_PRESETS[theme];
  if (!name || el.type !== 'text' || el.role !== 'title' || el.keyframes !== undefined) return el.keyframes;
  return presetKeyframes(name, el, sceneDuration, fps);
}

// Pure copy with every optional root and element base value filled in.
export function withDefaults(spec) {
  const out = structuredClone(spec);
  out.size ??= [...DEFAULTS.size];
  out.fps ??= DEFAULTS.fps;
  out.theme ??= MOTION_THEME;
  out.audio = (out.audio ?? []).map((track) => ({ at: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...track }));
  for (const scene of out.scenes) {
    scene.transition ??= 'none';
    for (const el of scene.elements) {
      el.keyframes = presetFor(el, out.theme, scene.duration, out.fps);
      el.opacity ??= 1;
      el.scale ??= 1;
      el.rotate ??= 0;
      el.draw = 1;
      el.reveal = 1;
      el.value = el.type === 'counter' ? (el.from ?? 0) : 0;
      el.keyframes ??= [];
    }
  }
  return out;
}

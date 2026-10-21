// Browser-safe (no Node imports): shared by spec validation, timeline and renderer.
// No `background` default: the page fills it from the theme's page colour (see renderer fetchSpec).
const DEFAULTS = Object.freeze({ size: [1920, 1080], fps: 30 });
export const FADE_SECONDS = 0.4;

// make-motion's default theme (scripts/lib/default-theme.mjs re-exports it). The shared
// DEFAULT_THEME stays `paper` for make-dashboard.
export const MOTION_THEME = 'dusk';

// Theme colour tokens a shape `fill`/`stroke` or a text `color` may name instead of a hex; each resolves to the
// active theme's dark colour of that name (see renderer themedLook).
export const COLOR_TOKENS = Object.freeze(['surface', 'line', 'accent', 'accentSoft', 'good', 'bad', 'warn', 'text', 'text2', 'text3', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6']);

// `value` as a colour: a token becomes the theme's colour, anything else (already validated) passes through.
export const resolveColor = (value, colors) => (COLOR_TOKENS.includes(value) ? colors[value] : value);

// Per-theme kinetic type for `role: "title"` text that sets no keyframes. Themes not listed
// (paper, ink, blueprint, editorial) get no preset.
export const TYPE_PRESETS = Object.freeze({ dusk: 'rise', press: 'ink-in', poster: 'slam' });

// Named eases: cubic-Bézier control points (x1, y1, x2, y2). template/timeline.mjs turns each into an anime.js
// cubicBezier function (an ease *string* such as 'cubicBezier(...)' is silently linear in anime 4.5).
// enter: fast out, gentle settle (entrances). exit: slow start, accelerating away (exits). move: symmetric
// in-out (a move between two places). land: like move, overshooting by about 1 % before it lands (one hero moment).
export const EASE_CURVES = Object.freeze({
  enter: Object.freeze([0.16, 1, 0.3, 1]),
  exit: Object.freeze([0.6, 0, 0.9, 0.35]),
  move: Object.freeze([0.65, 0, 0.35, 1]),
  land: Object.freeze([0.55, 0, 0.2, 1.12]),
});

// Seconds each preset takes when the scene is long enough; a shorter scene compresses it.
const PRESET_SECONDS = Object.freeze({ rise: 0.9, 'ink-in': 1.1, slam: 0.5 });
const EXIT_SHARE = 0.5; // an exit takes about half its entrance
const EXIT_EARLIEST = 0.9; // of the scene: an exit never starts before this, so the 85 % contact frame is fully in
const SLAM_EXIT_SCALE = 0.85;
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

// Exits: from a hold on the element's own pose at `start` to its exit pose at `end`, with the `exit` ease.
const EXITS = {
  // dusk: the rise reversed, fading as it drops away.
  rise: (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, y: el.y },
    { t: end, opacity: 0, y: el.y + Math.round((el.fontSize ?? DEFAULT_FONT_SIZE) * RISE_TRAVEL), ease: 'exit' },
  ],
  // press: the ink lifting off the page; it fades as it grows by the same hair it settled from.
  'ink-in': (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, scale: el.scale ?? 1 },
    { t: end, opacity: 0, scale: INK_SCALE * (el.scale ?? 1), ease: 'exit' },
  ],
  // poster: a snap down and out.
  slam: (el, start, end) => [
    { t: start, opacity: el.opacity ?? 1, scale: el.scale ?? 1 },
    { t: end, opacity: 0, scale: SLAM_EXIT_SCALE * (el.scale ?? 1), ease: 'exit' },
  ],
};

/**
 * The exit keyframes of preset `name` for a title whose entrance (`entrance`, from presetKeyframes) is already set,
 * or [] when there is no room. The exit lands one frame (1/fps) before the scene end and takes half the entrance's
 * full length, but never starts before 0.9 x the scene (a shorter scene gets a shorter exit), nor before the
 * entrance has landed. Pure.
 */
export function exitKeyframes(name, el, sceneDuration, fps, entrance) {
  const end = round(Math.floor((sceneDuration - 1 / fps) * T_DECIMALS) / T_DECIMALS);
  const start = round(Math.max(end - PRESET_SECONDS[name] * EXIT_SHARE, sceneDuration * EXIT_EARLIEST));
  if (start >= end || start < entrance.at(-1).t) return [];
  return EXITS[name](el, start, end);
}

/**
 * The keyframes of preset `name` for text element `el` in a scene of `sceneDuration` seconds.
 * Pure: the same arguments always give the same keyframes. The last one lands at least one
 * frame (1/fps) before the scene end, so the final pose is always shown.
 */
export function presetKeyframes(name, el, sceneDuration, fps) {
  const end = round(Math.min(PRESET_SECONDS[name], Math.floor((sceneDuration - 1 / fps) * T_DECIMALS) / T_DECIMALS));
  return GENERATORS[name](el, end);
}

// `exits`: whether an `exit: true` title may leave (every scene but the spec's last). Returns the keyframes and
// whether an exit was appended.
function presetFor(el, theme, sceneDuration, fps, exits) {
  const name = TYPE_PRESETS[theme];
  if (!name || el.type !== 'text' || el.role !== 'title' || el.keyframes !== undefined) return { keyframes: el.keyframes, exited: false };
  const entrance = presetKeyframes(name, el, sceneDuration, fps);
  const exit = el.exit === true && exits ? exitKeyframes(name, el, sceneDuration, fps, entrance) : [];
  return { keyframes: [...entrance, ...exit], exited: exit.length > 0 };
}

// Pure copy with every optional root and element base value filled in.
export function withDefaults(spec) {
  const out = structuredClone(spec);
  out.size ??= [...DEFAULTS.size];
  out.fps ??= DEFAULTS.fps;
  out.theme ??= MOTION_THEME;
  out.audio = (out.audio ?? []).map((track) => ({ at: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...track }));
  const transition = out.transition ?? 'none';
  out.scenes.forEach((scene, si) => {
    scene.transition ??= si === 0 && transition === 'crossfade' ? 'none' : transition; // the first scene has nothing to fade out
    for (const el of scene.elements) {
      const preset = presetFor(el, out.theme, scene.duration, out.fps, si < out.scenes.length - 1);
      el.keyframes = preset.keyframes;
      if (preset.exited) el.exitPreset = true; // check.mjs: this title leaves on purpose (it opted in with `exit`)
      el.opacity ??= 1;
      el.scale ??= 1;
      el.rotate ??= 0;
      el.draw = 1;
      el.reveal = 1;
      el.value = el.type === 'counter' ? (el.from ?? 0) : 0;
      el.keyframes ??= [];
    }
  });
  return out;
}

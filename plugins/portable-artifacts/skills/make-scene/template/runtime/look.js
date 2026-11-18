// The scene's look as named numbers: one light set per sky, three material roles, one fog rule. Pure (no three, no DOM),
// so node:test can import it; render.js applies it. Edit a number here, not in render.js.

export const SKY_SPACE = 'space';

/** The smallest key-to-fill ratio a set may have: a key that is not clearly stronger than its fill reads flat. */
export const MIN_KEY_FILL_RATIO = 2;

const SUN = { base: '#fff4e0', tint: 'page', share: 0.12 }; // a warm key that still follows the theme a little
const MOON = '#8fa6e8';
const MOON_RIM = '#6f86d8'; // cool, a step off the moon, so the edge light reads as a second source

/**
 * One set per sky. `key` is the sun (or moon), `fill` the sky-and-ground hemisphere, `ambient` a floor so nothing goes
 * black; `rim` is a low light from behind the scene (night only) that picks out the far edges of the masses.
 */
export const LIGHT_SETS = {
  day: { key: 3.0, fill: 1.0, ambient: 0.1, keyColour: SUN, rim: null },
  dim: { key: 1.6, fill: 0.62, ambient: 0.1, keyColour: SUN, rim: null },
  night: { key: 0.9, fill: 0.4, ambient: 0.1, keyColour: MOON, rim: { intensity: 0.9, colour: MOON_RIM } },
  space: { key: 2.6, fill: 0.8, ambient: 0.1, keyColour: SUN, rim: null },
};

/**
 * Where the key and the rim stand, as multiples of the scene's diagonal from its centre. The key rakes from the right of
 * the example cameras (which sit at +x, +z); the rim comes from the opposite flank, low, so it lights the walls the key
 * leaves dim with a cool second colour, instead of faces nobody sees.
 */
export const KEY_DIRECTION = [0.85, 0.9, 0.5];
export const RIM_DIRECTION = [-0.6, 0.35, 0.9];

/** Which light set a graph's sky and the page's mode ask for. */
export function lightSetName(env, isDark) {
  if (env.sky === SKY_SPACE) return 'space';
  if (isDark && env.nightLights) return 'night';
  if (isDark) return 'dim';
  return 'day';
}

/**
 * Three roles, so the eye can tell ground from mass from accent: the ground is the roughest and takes the light
 * flat, a mass (towers, trees, planets) has a soft sheen, an accent (links, self-lit bodies) is the glossiest.
 * Water is its own thing. A material's role is stamped on `userData.role`.
 */
export const MATERIAL_ROLES = {
  ground: { roughness: 0.95, metalness: 0 },
  mass: { roughness: 0.68, metalness: 0.04 },
  accent: { roughness: 0.4, metalness: 0.15 },
  water: { roughness: 0.2, metalness: 0.1 },
};

/**
 * Fog colour is the page, so far things dissolve into it (set by retint). Its range follows the scene: it starts a
 * quarter of the extent in front of the fitted camera distance (the scene's near face is about half an extent in
 * front of it) and ends well behind the far face, so the far side is hazed, never erased.
 */
export const FOG = { nearShare: 0.25, farShare: 1.6, minNearShare: 0.2 };

/** { near, far } fog distances for a camera `fit` away from a scene `diag` across. Both scale with the extent. */
export function fogRange(fit, diag) {
  return { near: Math.max(fit * FOG.minNearShare, fit - FOG.nearShare * diag), far: fit + FOG.farShare * diag };
}

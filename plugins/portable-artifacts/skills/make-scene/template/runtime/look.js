// The scene's look as named numbers: one light set per sky, material roles, one fog rule, one contact pool. Pure (no
// three, no DOM), so node:test can import it; render.js applies it. Edit a number here, not in render.js.

export const SKY_SPACE = 'space';

/** The smallest key-to-fill ratio a set may have: a key that is not clearly stronger than its fill reads flat. */
export const MIN_KEY_FILL_RATIO = 3;

/**
 * The smallest brightest-to-dimmest ratio between two faces the default camera sees (a lit wall and a shaded one, or a
 * wall and the top). Light ratios are linear, and the display's gamma flattens them, so this is deliberately high.
 */
export const MIN_FACE_RATIO = 2.5;

const SUN = { base: '#fff4e0', tint: 'page', share: 0.12 }; // a warm key that still follows the theme a little
const MOON = '#8fa6e8';
const RIM_COOL = '#6fb4ff'; // a rim a clear step off the warm key...
// ...and, against the cool moon, a rim of the theme's own light (its window glow, mostly): it matches the lit windows, so it never
// clashes with a tower's colour the way a fixed warm one did on blue towers.
const RIM_GLOW = { base: '#fff6ec', tint: 'glow', share: 0.5 };

/**
 * One set per sky. `key` is the sun (or moon), `fill` the sky-and-ground hemisphere, `ambient` a floor so nothing goes
 * black; `rim` is a second light from the opposite flank in a different hue, in every dark set, that edges the masses.
 */
export const LIGHT_SETS = {
  day: { key: 3.8, fill: 1.2, skyWhite: 0.55, ambient: 0.05, keyColour: SUN, rim: null },
  dim: { key: 2.5, fill: 0.8, skyWhite: 0.2, ambient: 0.05, keyColour: SUN, rim: { intensity: 2.0, colour: RIM_COOL } },
  night: { key: 3.6, fill: 0.6, skyWhite: 0.2, ambient: 0.05, keyColour: MOON, rim: { intensity: 1.8, colour: RIM_GLOW } },
  space: { key: 3.4, fill: 0.7, skyWhite: 0.7, ambient: 0.04, keyColour: SUN, rim: { intensity: 3.0, colour: RIM_COOL } },
};

/**
 * Where the key and the rim stand, from the camera. `from` is the vector from the scene's target to the camera, and the
 * lights are placed in the camera's own frame so that what the viewer sees is always lit the same way: the key comes
 * from the viewer's right and above, raking the walls that face right and leaving the ones that face left to the fill;
 * the rim comes from the left and a little behind the scene, low, so the shaded side is edged in a second hue.
 * Both are unit vectors, as { key, rim }.
 */
export const KEY_FRAME = { right: 1, toward: 0.12, up: 1.1 };
export const RIM_FRAME = { right: -0.7, toward: -0.7, up: 0.2 };

/**
 * The edge light on boxes, in dark sets only: a thin band of the rim colour along the edges that make a box's outline (an edge
 * with a face the camera cannot see on its far side; never the edge between two faces it sees, never the foot). A flat wall has
 * no silhouette for a rim light to catch, so a tower seen from the front would show none; this gives it the edge. `strength`
 * is its brightness, `widthShare` its width as a share of the scene's diagonal (never under `minWidth`, never more than
 * `maxShare` of a box's own smallest side); a box thinner than `minSide` (a gridline) is not edged at all.
 */
export const EDGE = { strength: 1.1, widthShare: 0.005, minWidth: 0.025, maxShare: 0.25, minSide: 0.12 };

/**
 * The same band for everything that is not a box (spheres, trunks, canopies, links, the terrain), in dark sets only: the
 * rim colour grows towards the silhouette, as `(1 - facing) ^ power` times `strength`, where `facing` is how squarely
 * the surface looks at the camera. A directional rim light alone leaves a lit crescent only on one flank; this edges the
 * whole outline, whichever way the viewer has turned the scene.
 */
export const FRESNEL = { strength: 0.6, power: 3, groundPower: 7 };

export function lightDirections(from) {
  const flat = Math.hypot(from[0], from[2]);
  const f = flat < 1e-9 ? [0, 0, 1] : [from[0] / flat, 0, from[2] / flat]; // toward the viewer, in the floor plane
  const r = [f[2], 0, -f[0]]; // the viewer's right
  const place = ({ right, toward, up }) => {
    const v = [right * r[0] + toward * f[0], up, right * r[2] + toward * f[2]];
    const len = Math.hypot(...v);
    return v.map((c) => c / len);
  };
  return { key: place(KEY_FRAME), rim: place(RIM_FRAME) };
}

/** Which light set a graph's sky and the page's mode ask for. */
export function lightSetName(env, isDark) {
  if (env.sky === SKY_SPACE) return 'space';
  if (isDark && env.nightLights) return 'night';
  if (isDark) return 'dim';
  return 'day';
}

/**
 * Four roles, so the eye can tell ground from mass from accent: the ground is fully matte and takes the light flat, a
 * mass (towers, trees, bars) has a satin sheen, an accent (links) is glossy, and a body (a self-lit sphere) is rough
 * enough to shade as a smooth ball, never with a point highlight. Water is its own thing. A material's role is
 * stamped on `userData.role`.
 */
export const MATERIAL_ROLES = {
  ground: { roughness: 1, metalness: 0 },
  mass: { roughness: 0.5, metalness: 0.08 },
  accent: { roughness: 0.25, metalness: 0.2 },
  body: { roughness: 0.9, metalness: 0 },
  water: { roughness: 0.2, metalness: 0.1 },
};

/** At night the sea is this share of its day colour, so it sits a step below the land and the land is the focal point. */
export const WATER_DARK_LEVEL = 0.5;

/**
 * Fog colour is the page, so far things dissolve into it (set by retint). Its range follows the scene: it starts a
 * little behind the fitted camera distance (past the middle of the masses, so a bar's colour is never lifted) and ends
 * well behind the far face, so only the far ground and the horizon take the haze.
 */
export const FOG = { nearShare: -0.2, farShare: 2.2, minNearShare: 0.2 };

/** { near, far } fog distances for a camera `fit` away from a scene `diag` across. Both scale with the extent. */
export function fogRange(fit, diag) {
  return { near: Math.max(fit * FOG.minNearShare, fit - FOG.nearShare * diag), far: fit + FOG.farShare * diag };
}

/**
 * The contact pool under the masses: a soft disc of the theme's glow colour on the ground, so the scene sits on its
 * ground instead of floating. A warm pool of light in light mode; in dark mode the same glow, dimmer, as light spilling
 * from the windows, and only where there are windows (a forest at night has no light to spill). `reach` is its radius
 * as a share of the footprint's half-diagonal; `opacity` is its strength at the centre.
 */
export const POOL = {
  reach: 1.25,
  light: { colour: { base: '#fff3d0', tint: 'glow', share: 0.12 }, opacity: 0.85 },
  dark: { colour: { base: '#ff9a6a', tint: 'glow', share: 0.5 }, opacity: 0.34 },
};

/**
 * The contact glow of a lifted chart or diagram: a soft disc under each mass that stands on the floor or a platform, so a bar or
 * a node sits on its ground instead of hovering. `reach` times the footprint's half-width, plus `margin`, is the disc's radius;
 * `floorTolerance` is how far from the floor a bar's foot may be and still count as standing on it.
 */
export const CONTACT = { reach: 1.7, margin: 0.15, floorTolerance: 0.02, light: { colour: 'shadow', opacity: 0.3 }, dark: { colour: POOL.dark.colour, opacity: 0.4 } };

/**
 * { colour, opacity } of a contact disc for the page's mode. By night it is the pool's warm glow, a spill of light round the foot;
 * by day a pale glow would vanish on a pale page, so it is the theme's shadow colour, a soft shadow at the foot.
 */
export const contactStyle = (isDark) => CONTACT[isDark ? 'dark' : 'light'];

/**
 * Where the contact discs go, as [{ x, y, z, r }] (y is the foot of the mass): a lifted chart's bars that stand on the floor, a
 * lifted diagram's nodes (the lowest slab of each), and nothing in any other graph: a city and a forest have their pool.
 */
export function contactFootings(graph) {
  if (graph.kind !== 'chart' && graph.kind !== 'diagram') return [];
  const lowest = new Map(); // item index -> the foot of its lowest instance
  for (const batch of graph.batches ?? []) {
    if (batch.shape === 'ring') continue;
    for (const [x, y, z, sx, sy, sz, item] of batch.instances) {
      if (!(item >= 0)) continue; // a floor, a gridline, a platform: not a mass
      const foot = y - sy / 2;
      if (!lowest.has(item) || foot < lowest.get(item).y) lowest.set(item, { x, y: foot, z, r: (Math.max(sx, sz) / 2) * CONTACT.reach + CONTACT.margin });
    }
  }
  const feet = [...lowest.values()];
  return graph.kind === 'chart' ? feet.filter((f) => Math.abs(f.y) <= CONTACT.floorTolerance) : feet;
}

/** { colour, opacity } of the pool for a graph's sky and the page's mode; opacity 0 where the pool is not drawn. */
export function poolStyle(env, isDark) {
  if (!isDark) return POOL.light;
  return env.nightLights ? POOL.dark : { ...POOL.dark, opacity: 0 };
}

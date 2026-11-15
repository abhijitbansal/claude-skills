// Key decisions the camera controls and the chrome must agree on. Pure (no three, no DOM) so they are unit-tested.

const STEPPING = new Set(['ArrowLeft', 'ArrowRight']);
const ORBITING = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * What Escape closes: 'panels' (the Explore panel and full screen, together), else 'tour' while the tour is open,
 * else null (the key is not ours). A panel that is open goes first, so the tour stays up behind it.
 */
export function escapeAction({ exploreOpen, fullscreenOn, touring }) {
  if (exploreOpen || fullscreenOn) return 'panels';
  return touring ? 'tour' : null;
}

/**
 * Who owns an arrow key pressed on the canvas: 'tour' for Left and Right while the tour is open (they step beats,
 * so they must reach the chrome's key handler), 'camera' for every other arrow (orbit), null for any other key.
 */
export function arrowOwner(key, { touring }) {
  if (!ORBITING.has(key)) return null;
  return touring && STEPPING.has(key) ? 'tour' : 'camera';
}

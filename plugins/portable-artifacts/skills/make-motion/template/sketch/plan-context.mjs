// Browser-safe: what planScene is told about scene `sceneIndex` of a spec beyond the scene itself. The page (renderer.mjs
// loadSketch), the length check (scripts/lib/sketch-check.mjs) and check.mjs all plan a scene through this one function, so
// they cannot disagree about when the drawing may begin.
import { ERASE, normalizeTransition, windowSeconds } from '../transitions.mjs';

/**
 * The ctx of planScene for `scene` (the `sceneIndex`th of `spec`): { size, seed, pace, icons, sceneIndex, startAfter, erase }.
 * `startAfter` is every second the transition into the scene takes (push, fade, erase, any of them: a stroke drawn while the
 * picture is still coming in would be hidden). `erase` says the hand sweeps across during it. The scene's transition may be
 * unresolved (expandSpec leaves the root default where it is), so it is read the way withDefaults fills it in.
 * `size`: [w, h], `icons`: planScene's ctx.icons.
 */
export function planContext(spec, scene, sceneIndex, { size, icons }) {
  const transition = scene.transition ?? spec.transition ?? 'none';
  const startAfter = windowSeconds({ transition, duration: scene.duration }, sceneIndex);
  const { seed, pace } = spec.sketch ?? {};
  return { size, seed, pace, icons, sceneIndex, startAfter, erase: startAfter > 0 && normalizeTransition(transition).type === ERASE };
}

// The stroke plan of each scene drawn by hand (null for the others), made as the page makes it: the same planScene, planContext
// (seed, pace, the transition's startAfter) and icons (template/renderer.mjs loadSketch), so the spans a plan names are the page's.
// The icons are a megabyte, so a spec with no hand-drawn scene never loads them. `spec`: after withDefaults. Shared by check.mjs
// (which judges the drawing from it) and render.mjs (a contact sheet samples it mid-draw); neither needs the other.
import { isSketchScene, specHasSketch } from '../../template/sketch/style.mjs';
import { planScene } from '../../template/sketch/plan.mjs';
import { planContext } from '../../template/sketch/plan-context.mjs';

export async function sketchPlans(spec) {
  if (!specHasSketch(spec)) return spec.scenes.map(() => null);
  const { default: icons } = await import('../../template/sketch/lucide.mjs');
  return spec.scenes.map((scene, sceneIndex) => (isSketchScene(spec, scene) ? planScene(scene, planContext(spec, scene, sceneIndex, { size: spec.size, icons })) : null));
}

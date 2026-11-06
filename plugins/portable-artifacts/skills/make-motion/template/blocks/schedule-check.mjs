// Browser-safe (no Node imports): the `validate` every block with its own schedule shares (listicle, before-after-swipe,
// ...): the scene must hold the schedule and the finished state (`minimum` seconds), and its last rendered frame
// (frames.mjs) must come after the schedule's last motion at `end` seconds. -> [{ path, message }], at most one, naming
// the shortest scene that passes.
import { DEFAULT_FPS } from '../defaults.mjs';
import { gridOf, frameCutoff } from '../frames.mjs';

const EPSILON = 1e-9;
const num = (n) => Number(n.toFixed(2));

export function scheduleErrors(ctx, { path, what, end, minimum }) {
  if (ctx.sceneDuration + EPSILON < minimum) return [{ path, message: `${what} need a scene of at least ${num(minimum)}s` }];
  const fps = ctx.fps ?? DEFAULT_FPS;
  const fix = frameCutoff(gridOf({ ...ctx, fps }), { end, minimum, tolerance: EPSILON });
  return fix === null ? [] : [{ path, message: `${what}: the last motion ends at ${num(end)}s, after the last frame at ${fps} fps; the scene must last at least ${fix}s` }];
}

// The throwaway look that carries `hand` data until the marker look exists (looks-four Task 12): desk's data under
// another name, experimental, with a hand. Registered only by the tests and the spike driver that import it.
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/kinds/index.mjs';

export const HAND = Object.freeze({
  rest: 0.8, // s with no stroke before the hand goes to its rest point
  maxSpeed: 1500, // units a second the tip may draw at most
  // degrees the hand hangs below the line it writes: at 55 every point of its outline is below the tip, so it never
  // covers the writing above (spike round 1 at 32 covered the heading while drawing the rule under it)
  angle: 55,
  scale: 1,
  shape: 'hand',
  restAt: Object.freeze({ wide: Object.freeze([0.9, 0.9]), tall: Object.freeze([0.82, 0.93]) }),
  wobble: Object.freeze({ amp: 2.2, wave: 60, step: 7 }),
  colours: Object.freeze({ skin: '#eec39d', shade: '#d9a680', outline: 'ink', barrel: '#2b2e33', cap: 'accent2', nib: 'ink' }),
});

/** Registers (once) and returns the name of a desk copy with `hand` data, `extra` merged over HAND. */
export function handLook(name = 'hand-test', extra = {}) {
  if (!registries.looks.has(name)) {
    const desk = registries.looks.get('desk');
    const hand = Object.freeze({ ...HAND, ...extra });
    const cuts = registries.cuts.has('erase') ? [...desk.cuts.filter((c) => c !== 'erase'), 'erase'] : desk.cuts;
    const sounds = Object.freeze({ ...desk.sounds, cut: Object.freeze({ ...desk.sounds.cut, ...(registries.cuts.has('erase') ? { erase: 'erase' } : {}) }) });
    registries.looks.add(name, Object.freeze({ ...desk, name, experimental: true, hand, cuts, sounds }));
  }
  return name;
}

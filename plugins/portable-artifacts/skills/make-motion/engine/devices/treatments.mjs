// The photo treatments `duotone` and `halftone`: an image node carries props.treatment ({ type, dark, light, cell? })
// with its colours resolved from the look's palette when the kind builds the node (so a film's accent override reaches
// them through the accented look), and the page turns the picture into the treated bitmap once (engine/page/treat.mjs).
// Both are registered layout devices (on: false: kinds build them, an `on` event cannot place them), so --list devices
// shows them and a look styles each it draws (`devices.duotone` / `devices.halftone`: { dark, light, cell? }, palette
// keys, cell in units). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { checkParams, checkImage, styleOf, colourOf, styledBy } from './shared.mjs';

export const TREATMENTS = Object.freeze(['duotone', 'halftone']);
const DEFAULT_CELL = 12; // units between halftone dots

/**
 * The treatment `type` ('none', 'duotone' or 'halftone') in `look`, as an image node's props.treatment: null for none;
 * the colours from the look's styling (palette keys, so an accented look's accent), a halftone's cell in px.
 */
export function treatmentFor(look, type, unit) {
  if (type === 'none') return null;
  if (!TREATMENTS.includes(type)) throw new Error(`treatment must be one of none, ${TREATMENTS.join(', ')}, got ${JSON.stringify(type)}`);
  const style = styleOf(look, type);
  const colours = { type, dark: colourOf(look, style.dark ?? 'ink'), light: colourOf(look, style.light ?? 'paper') };
  return type === 'halftone' ? { ...colours, cell: (style.cell ?? DEFAULT_CELL) * unit } : colours;
}

/** The treatments a look draws: 'none' and each it styles. */
export const treatmentsOf = (look) => ['none', ...TREATMENTS.filter((t) => styledBy(t)(look))];

const treatmentDevice = (name, summary) => Object.freeze({
  name,
  summary,
  supports: styledBy(name),
  on: false, // a layout device: kinds build it, an on event cannot place it
  // build({ id, box, at, look, unit, image }): the image node again with its treatment
  build(params) {
    const { id, look, unit } = checkParams(name, params, ['image']);
    const image = checkImage(params.image);
    return { nodes: [node('image', id, { ...image.props, treatment: treatmentFor(look, name, unit) })] };
  },
});

export const duotone = treatmentDevice('duotone', 'A photo printed in two colours of the look: its lights in one, its darks in the other.');
export const halftone = treatmentDevice('halftone', 'A photo printed as a grid of dots, larger where it is darker.');

// What the hand-drawn style refuses, on the spec as written (validateSpec calls checkSketch after the schema and the block
// params pass): elements the pencil cannot draw, fields the drawing owns, characters Caveat lacks, unknown icons, and
// sketch scenes in a viral spec. Node only: the icon names come from template/sketch/lucide.mjs, which the page never loads.
import { pathJoin, didYouMean } from '../../shared/errors.mjs';
import { flattenElements } from '../../template/groups.mjs';
import { BLOCKS, BLOCK_NAMES } from '../../template/blocks/index.mjs';
import { VIRAL_MODE } from '../../template/viral.mjs';
import { isSketchScene, SCRIBBLE_FILL } from '../../template/sketch/style.mjs';
import caveat from '../../template/sketch/caveat-metrics.mjs';
import lucide from '../../template/sketch/lucide.mjs';

const SKETCH_TYPES = ['text', 'shape', 'icon', 'group', 'block'];
const SKETCH_ALLOWED = `allowed: ${SKETCH_TYPES.join(', ').replace(/block$/, 'block (sketch blocks only)')}`;
const STANDARD_HINT = 'put it in a standard scene (omit "style" on the scene, or set "style": "standard")';
const SET_SKETCH = 'set "style": "sketch" on the scene, or at the root';
const STILL_VALID = 'opacity, hold, drawAt';
const ICON_SEARCH = 'node scripts/sketch-icons.mjs search <word>';
const DRAW_AT = /^sentence:\d+$/;

const DRAWING_OWNS = 'the drawing decides how an element appears';
const REFUSED = {
  keyframes: DRAWING_OWNS,
  typing: DRAWING_OWNS,
  role: DRAWING_OWNS,
  exit: DRAWING_OWNS,
  scale: 'the hand follows world coordinates, so a scaled element would be drawn away from the pencil tip',
  rotate: 'the hand follows world coordinates, so a rotated element would be drawn away from the pencil tip',
};

/** The names of the blocks that draw only in a sketch scene (their definitions say `sketchOnly: true`). */
export const SKETCH_BLOCK_NAMES = Object.freeze(BLOCK_NAMES.filter((name) => BLOCKS[name].sketchOnly === true));
const ICON_NAMES = Object.keys(lucide);

const display = (ch) => (/[\p{C}\p{M}]/u.test(ch) ? `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : ch);

function checkGlyphs(el, base, errors) {
  if (typeof el.text !== 'string') return; // a missing `text` is reported as required (checkFields)
  const missing = [...new Set([...el.text].filter((ch) => ch !== '\n' && !Object.hasOwn(caveat.advance, ch)))];
  if (!missing.length) return;
  const many = missing.length > 1;
  errors.push({ path: pathJoin(base, 'text'), message: `${missing.map((ch) => JSON.stringify(display(ch))).join(', ')} ${many ? 'are' : 'is'} not in the handwriting font; remove ${many ? 'them' : 'it'} or use a standard scene` });
}

function checkDrawAt(el, base, sketch, errors) {
  if (el.drawAt === undefined) return;
  const at = pathJoin(base, 'drawAt');
  if (!sketch) {
    errors.push({ path: at, message: `drawAt is for sketch scenes (${SET_SKETCH}); a standard scene starts elements with keyframes` });
  } else if (!((typeof el.drawAt === 'number' && el.drawAt >= 0) || (typeof el.drawAt === 'string' && DRAW_AT.test(el.drawAt)))) {
    errors.push({ path: at, message: 'drawAt must be a number of seconds (0 or more) or "sentence:<n>"' });
  }
}

function checkIcon(el, base, errors) {
  if (typeof el.name !== 'string' || Object.hasOwn(lucide, el.name)) return;
  const near = didYouMean(el.name, ICON_NAMES);
  const message = near ? `unknown icon ${JSON.stringify(el.name)}; did you mean ${JSON.stringify(near)}? (find names: ${ICON_SEARCH})` : `unknown icon ${JSON.stringify(el.name)}; find names: ${ICON_SEARCH}`;
  errors.push({ path: pathJoin(base, 'name'), message });
}

// A block on the wrong side: a sketch block in a standard scene, or a standard block in a sketch scene.
function checkBlockSide(el, base, sketch, sketchBlocks, errors) {
  if (typeof el.block !== 'string') return;
  const isSketchBlock = sketchBlocks.includes(el.block);
  if (sketch && !isSketchBlock) {
    errors.push({ path: pathJoin(base, 'block'), message: `${el.block} is not a sketch block; blocks a sketch scene takes: ${sketchBlocks.join(', ') || 'none yet'}; ${STANDARD_HINT}` });
  } else if (!sketch && isSketchBlock) {
    errors.push({ path: pathJoin(base, 'block'), message: `${el.block} is a sketch block; it draws only in a sketch scene (${SET_SKETCH})` });
  }
}

function checkSketchElement(el, base, errors) {
  if (!SKETCH_TYPES.includes(el.type)) {
    errors.push({ path: pathJoin(base, 'type'), message: `${el.type} is not drawn in a sketch scene; ${SKETCH_ALLOWED}; ${STANDARD_HINT}` });
    return;
  }
  for (const [key, reason] of Object.entries(REFUSED)) {
    if (el[key] !== undefined) errors.push({ path: pathJoin(base, key), message: `${key} is not allowed in a sketch scene (${reason}); still valid: ${STILL_VALID}; ${STANDARD_HINT}` });
  }
  if (el.type === 'text') checkGlyphs(el, base, errors);
  if (el.type === 'shape' && el.fill === SCRIBBLE_FILL && el.shape === 'line') {
    errors.push({ path: pathJoin(base, 'fill'), message: `"${SCRIBBLE_FILL}" hatches a rect or an ellipse; a line has no inside` });
  }
}

// A hand-drawn scene has no place in a viral spec: it would be drawn at the wrong shape, over a captions zone. One error
// at the root `style`, and one at each scene that names its own.
function checkViralSide(written, errors) {
  if (written.mode !== VIRAL_MODE) return;
  const message = `a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "${VIRAL_MODE}"`;
  if (written.style === 'sketch') errors.push({ path: 'style', message });
  written.scenes.forEach((scene, si) => {
    if (scene.style === 'sketch') errors.push({ path: `scenes[${si}].style`, message });
  });
}

/**
 * Pushes the hand-drawn style's refusals for `written` (the spec as written, schema-valid) onto `errors`.
 * `sketchBlocks`: the block names that draw only in a sketch scene (SKETCH_BLOCK_NAMES; a test can pass its own list).
 */
export function checkSketch(written, errors, { sketchBlocks = SKETCH_BLOCK_NAMES } = {}) {
  checkViralSide(written, errors);
  written.scenes.forEach((scene, si) => {
    const base = `scenes[${si}]`;
    const sketch = isSketchScene(written, scene);
    if (sketch && scene.camera !== undefined) {
      errors.push({ path: pathJoin(base, 'camera'), message: `camera is not allowed in a sketch scene (the board does not move); ${STANDARD_HINT}` });
    }
    for (const { el, path: at } of flattenElements(scene.elements, base)) {
      checkDrawAt(el, at, sketch, errors);
      if (el.type === 'icon') checkIcon(el, at, errors);
      if (!sketch && el.type === 'icon') errors.push({ path: pathJoin(at, 'type'), message: `icon is drawn only in a sketch scene; ${SET_SKETCH}` });
      if (el.type === 'block') checkBlockSide(el, at, sketch, sketchBlocks, errors);
      if (sketch) checkSketchElement(el, at, errors);
    }
  });
}

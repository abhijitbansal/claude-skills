// What the hand-drawn style refuses, on the spec as written (validateSpec calls checkSketch once the schema passes, before
// the block params): elements the pencil cannot draw, fields the drawing owns, characters Caveat lacks, unknown icons,
// numbers out of range and sketch scenes in a viral spec. Node only: the icon names come from the whole Lucide set
// (icon-names.mjs), which the page never loads.
import { pathJoin } from '../../shared/errors.mjs';
import { flattenElements } from '../../template/groups.mjs';
import { BLOCKS, BLOCK_NAMES, blockDef, isBlock } from '../../template/blocks/index.mjs';
import { canvasSize } from '../../template/formats.mjs';
import { VIRAL_MODE } from '../../template/viral.mjs';
import { isSketchScene, specHasSketch, SCRIBBLE_FILL, HAND_SCALE_RANGE, PACE_RANGE, SENTENCE_REF } from '../../template/sketch/style.mjs';
import caveat from '../../template/sketch/caveat-metrics.mjs';
import lucide from '../../template/sketch/lucide.mjs';
import { planScene } from '../../template/sketch/plan.mjs';
import { isPoint } from '../../template/sketch/geometry.mjs';
import { ICON_NAMES, suggestIcon } from './icon-names.mjs';

const SKETCH_TYPES = ['text', 'shape', 'icon', 'group', 'block'];
const SKETCH_ALLOWED = `allowed: ${SKETCH_TYPES.join(', ').replace(/block$/, 'block (sketch blocks only)')}`;
const STANDARD_HINT = 'put it in a standard scene (omit "style" on the scene, or set "style": "standard")';
const SET_SKETCH = 'set "style": "sketch" on the scene, or at the root';
const STILL_VALID = 'opacity, hold, drawAt';
const ICON_SEARCH = 'node scripts/sketch-icons.mjs search <word>';
const LINE_FIELDS = ['to', 'bow'];
const ART_BACKGROUND = 'art'; // spec.mjs's ART_BACKGROUND (this module cannot import it: spec.mjs imports this one)
const ICON_SET = new Set(ICON_NAMES);

const DRAWING_OWNS = 'the drawing decides how an element appears';
const FOLLOWS_WORLD = 'the hand follows world coordinates, so a %s element would be drawn away from the pencil tip';
// A field a sketch scene refuses, on the element types that take it: a type that does not take the field gets the plain
// "not valid on <type>" error from checkFields alone, never a second, conflicting one from here.
const MOVABLE = ['text', 'shape', 'group', 'block'];
const REFUSED = {
  keyframes: { types: MOVABLE, reason: DRAWING_OWNS },
  scale: { types: MOVABLE, reason: FOLLOWS_WORLD.replace('%s', 'scaled') },
  rotate: { types: MOVABLE, reason: FOLLOWS_WORLD.replace('%s', 'rotated') },
  typing: { types: ['text'], reason: DRAWING_OWNS },
  role: { types: ['text'], reason: DRAWING_OWNS },
  exit: { types: ['text'], reason: DRAWING_OWNS },
  font: { types: ['text'], reason: 'handwriting has one face' },
  fontWeight: { types: ['text'], reason: 'handwriting has one face' },
};

/** The names of the blocks that draw only in a sketch scene (their definitions say `sketchOnly: true`). */
export const SKETCH_BLOCK_NAMES = Object.freeze(BLOCK_NAMES.filter((name) => BLOCKS[name].sketchOnly === true));

const display = (ch) => (/[\p{C}\p{M}]/u.test(ch) ? `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : ch);

function checkGlyphs(el, base, errors) {
  if (typeof el.text !== 'string') return; // a missing `text` is reported as required (checkFields)
  const drawn = el.text.normalize('NFC'); // as the plan lays it out: a combining mark composes with its letter first
  const missing = [...new Set([...drawn].filter((ch) => ch !== '\n' && !Object.hasOwn(caveat.advance, ch)))];
  if (!missing.length) return;
  const many = missing.length > 1;
  errors.push({ path: pathJoin(base, 'text'), message: `${missing.map((ch) => JSON.stringify(display(ch))).join(', ')} ${many ? 'are' : 'is'} not in the handwriting font; remove ${many ? 'them' : 'it'} or use a standard scene` });
}

// A "sentence:<n>" after the voice step: { sentence: n }, with a narration that has that sentence (resolveSketchVoice checked
// it; a spec resolved some other way would not pass).
const isSentenceRef = (drawAt, scene) => drawAt !== null && typeof drawAt === 'object' && Object.keys(drawAt).length === 1
  && Number.isInteger(drawAt.sentence) && drawAt.sentence >= 0 && drawAt.sentence < (scene.narration?.length ?? 0);

function checkDrawAt(el, base, scene, sketch, errors) {
  if (el.drawAt === undefined) return;
  const at = pathJoin(base, 'drawAt');
  const { drawAt } = el;
  if (!sketch) {
    errors.push({ path: at, message: `drawAt is for sketch scenes (${SET_SKETCH}); a standard scene starts elements with keyframes` });
  } else if (typeof drawAt === 'number') {
    if (drawAt < 0 || drawAt >= scene.duration) {
      errors.push({ path: at, message: `drawAt ${drawAt} is outside scene "${scene.id}", which lasts ${scene.duration}s; use 0 or more and less than ${scene.duration}, or "sentence:<n>"` });
    }
  } else if (!(isSentenceRef(drawAt, scene) || (typeof drawAt === 'string' && SENTENCE_REF.test(drawAt)))) {
    errors.push({ path: at, message: 'drawAt must be a number of seconds (0 or more) or "sentence:<n>"' });
  }
}

// `to` and `bow` bend a line to wherever it runs: a line shape in a sketch scene only (a standard line is horizontal).
function checkLineFields(el, base, sketch, errors) {
  for (const key of LINE_FIELDS) {
    if (el[key] === undefined || (key === 'to' && el.type === 'counter')) continue; // a counter's `to` is its end value
    const at = pathJoin(base, key);
    if (!sketch) errors.push({ path: at, message: `${key} is for sketch scenes (${SET_SKETCH}); a standard line is horizontal` });
    else if (!(el.type === 'shape' && el.shape === 'line')) errors.push({ path: at, message: `${key} is only valid on a line shape` });
    else if (key === 'to' && !isPoint(el.to)) errors.push({ path: at, message: 'to must be a point, { "x": number, "y": number }' });
  }
}

function checkIcon(el, base, errors) {
  if (typeof el.name !== 'string' || ICON_SET.has(el.name)) return;
  const near = suggestIcon(el.name);
  const message = near ? `unknown icon ${JSON.stringify(el.name)}; did you mean ${JSON.stringify(near)}? (find names: ${ICON_SEARCH})` : `unknown icon ${JSON.stringify(el.name)}; find names: ${ICON_SEARCH}`;
  errors.push({ path: pathJoin(base, 'name'), message });
}

// A block on the wrong side: a sketch block in a standard scene, or a standard block in a sketch scene. A name that is no
// block at all is left to checkBlocks, which names the blocks that exist.
function checkBlockSide(el, base, sketch, sketchBlocks, errors) {
  if (typeof el.block !== 'string') return;
  const isSketchBlock = sketchBlocks.includes(el.block);
  if (!isSketchBlock && !BLOCK_NAMES.includes(el.block)) return;
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
  for (const [key, { types, reason }] of Object.entries(REFUSED)) {
    if (types.includes(el.type) && el[key] !== undefined) {
      errors.push({ path: pathJoin(base, key), message: `${key} is not allowed in a sketch scene (${reason}); still valid: ${STILL_VALID}; ${STANDARD_HINT}` });
    }
  }
  if (el.type === 'text') checkGlyphs(el, base, errors);
  if (el.type === 'shape' && el.fill === SCRIBBLE_FILL && el.shape === 'line') {
    errors.push({ path: pathJoin(base, 'fill'), message: `"${SCRIBBLE_FILL}" hatches a rect or an ellipse; a line has no inside` });
  }
}

const SECONDS_EPSILON = 1e-6;
const TOP_ELEMENT = /^scenes\[\d+\]\.elements\[(\d+)\]/;

// Where a too-short scene is reported: under the first required param of the block that draws last (a diagram's `nodes`),
// else at the scene. `written`: the scene as written; `stroke`: the last stroke of its plan.
function durationPath(written, si, stroke) {
  const base = `scenes[${si}]`;
  const index = TOP_ELEMENT.exec(stroke?.path ?? '')?.[1];
  const last = index === undefined ? undefined : written.scenes[si].elements[Number(index)];
  if (!isBlock(last)) return base;
  const params = `${base}.elements[${index}].params`;
  const param = blockDef(last.block)?.params?.required?.[0];
  return param ? pathJoin(params, param) : params;
}

/**
 * Pushes the plan's problems, and an error for each sketch scene shorter than its drawing needs at the natural pace: the
 * stroke plan's `needs`, in seconds, rounded up to a tenth. A scene with narration is exempt: its drawing follows the voice,
 * so one that does not fit is check.mjs's finding. `written`: the spec as written; `expanded`: the same after expandSpec (blocks are groups).
 */
export function checkSketchDuration(written, expanded, errors) {
  const size = canvasSize(expanded);
  const { seed, pace } = expanded.sketch ?? {};
  expanded.scenes.forEach((scene, si) => {
    if (!isSketchScene(expanded, scene)) return;
    const plan = planScene(scene, { size, seed, pace, icons: lucide, sceneIndex: si, startAfter: 0 });
    errors.push(...plan.problems); // what the plan could not draw, such as a word wider than its text's maxWidth
    if (scene.narration || scene.duration + SECONDS_EPSILON >= plan.needs) return; // a voiced scene that cannot fit is check.mjs's finding (plan.overruns, unfinishedWriting)
    const needed = Math.ceil((plan.needs - SECONDS_EPSILON) * 10) / 10;
    errors.push({ path: durationPath(written, si, plan.strokes.at(-1)), message: `this drawing needs a scene of at least ${needed}s` });
  });
}

// A hand-drawn scene has no place in a viral spec: it would be drawn at the wrong shape, over a captions zone. One error
// at the root `style` when a scene takes it from there, and one at each scene that names its own. A root `style` that no
// scene uses (each says "standard") draws nothing and is left alone.
function checkViralSide(written, errors) {
  if (written.mode !== VIRAL_MODE || !specHasSketch(written)) return;
  const message = `a hand-drawn scene is not available in viral mode; use "style": "standard", or drop "mode": "${VIRAL_MODE}"`;
  if (written.style === 'sketch' && written.scenes.some((scene) => scene.style === undefined)) errors.push({ path: 'style', message });
  written.scenes.forEach((scene, si) => {
    if (scene.style === 'sketch') errors.push({ path: `scenes[${si}].style`, message });
  });
}

// The schema types these; the ranges are checked here so that the message names both ends.
function checkRanges(written, errors) {
  const range = (value, [low, high], at) => {
    if (value !== undefined && !(value >= low && value <= high)) errors.push({ path: at, message: `must be from ${low} to ${high} (got ${value})` });
  };
  range(written.sketch?.hand?.scale, HAND_SCALE_RANGE, 'sketch.hand.scale');
  range(written.sketch?.pace, PACE_RANGE, 'sketch.pace');
}

/**
 * Pushes the hand-drawn style's refusals for `written` (the spec as written, schema-valid) onto `errors`.
 * `sketchBlocks`: the block names that draw only in a sketch scene (SKETCH_BLOCK_NAMES; a test can pass its own list).
 */
export function checkSketch(written, errors, { sketchBlocks = SKETCH_BLOCK_NAMES } = {}) {
  checkViralSide(written, errors);
  checkRanges(written, errors);
  written.scenes.forEach((scene, si) => {
    const base = `scenes[${si}]`;
    const sketch = isSketchScene(written, scene);
    if (sketch && scene.camera !== undefined) {
      errors.push({ path: pathJoin(base, 'camera'), message: `camera is not allowed in a sketch scene (the board does not move); ${STANDARD_HINT}` });
    }
    if (sketch && scene.background === ART_BACKGROUND) {
      errors.push({ path: pathJoin(base, 'background'), message: `"${ART_BACKGROUND}" is not allowed in a sketch scene (the board is its background); use a colour, or ${STANDARD_HINT}` });
    }
    for (const { el, path: at } of flattenElements(scene.elements, base)) {
      checkDrawAt(el, at, scene, sketch, errors);
      checkLineFields(el, at, sketch, errors);
      if (el.type === 'icon') checkIcon(el, at, errors);
      if (!sketch && el.type === 'icon') errors.push({ path: pathJoin(at, 'type'), message: `icon is drawn only in a sketch scene; ${SET_SKETCH}` });
      if (el.type === 'block') checkBlockSide(el, at, sketch, sketchBlocks, errors);
      if (sketch) checkSketchElement(el, at, errors);
    }
  });
}

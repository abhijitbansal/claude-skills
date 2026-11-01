// Browser-safe (no Node imports): colour grading for `image` and `video` elements, shared by spec validation and the
// renderer. A grade is one SVG <filter> (sRGB, so the numbers mean what they say on the 0-255 scale the canvas shows),
// built as text from numbers and table entries only: nothing a spec supplies is ever copied into the markup, and the
// one id it carries is checked against a strict pattern.
export const GRADE_ELEMENT_TYPES = Object.freeze(['image', 'video']);
export const EXPOSURE_RANGE = Object.freeze([-2, 2]); // stops: 2^stops of gain
export const CONTRAST_RANGE = Object.freeze([0.5, 2]);
export const SATURATION_RANGE = Object.freeze([0, 2]);
export const GRADE_DEFAULTS = Object.freeze({ exposure: 0, contrast: 1, saturation: 1 });

// Each preset: what it multiplies the saturation and the contrast by, and optionally a colour matrix (the top three rows of
// a 4x5 feColorMatrix; the alpha row is added) or a black lift (feFuncX tableValues), applied after the linear step so that
// pure black reads at the lift whatever the exposure and contrast (before it, the contrast pivot cancels a small lift).
const PRESETS = Object.freeze({
  warm: Object.freeze({ saturation: 1, contrast: 1, matrix: Object.freeze([1.08, 0, 0, 0, 0.02, 0, 1.02, 0, 0, 0, 0, 0, 0.9, 0, -0.02]) }),
  cool: Object.freeze({ saturation: 1, contrast: 1, matrix: Object.freeze([0.92, 0, 0, 0, -0.02, 0, 1, 0, 0, 0, 0, 0, 1.1, 0, 0.02]) }),
  mono: Object.freeze({ saturation: 0, contrast: 1.1 }),
  film: Object.freeze({ saturation: 0.85, contrast: 1.15, lift: '0.06 1' }),
});
export const GRADE_PRESETS = Object.freeze(Object.keys(PRESETS));

const ALPHA_ROW = [0, 0, 0, 1, 0];
const FILTER_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CHANNELS = ['R', 'G', 'B'];
const DECIMALS = 1e6;

/** The id of the filter of the `index`-th graded element on a stage (the element's own id never reaches markup or CSS). */
export const gradeId = (index) => `grade-${index}`;

// A number as short text: no float noise (0.30000000000000004), no "-0".
const fmt = (n) => String(Math.round(n * DECIMALS) / DECIMALS + 0);

function finite(grade, key) {
  const value = grade[key] === undefined ? GRADE_DEFAULTS[key] : grade[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`grade ${key} must be a finite number`);
  return value;
}

const transfer = (attrs) => `<feComponentTransfer>${CHANNELS.map((c) => `<feFunc${c} ${attrs}/>`).join('')}</feComponentTransfer>`;

/**
 * The `<filter id>` markup for `grade` ({ preset?, exposure?, contrast?, saturation? }; a missing number takes its default).
 * Steps, in order: saturate (saturation x the preset's), the preset's colour matrix, one linear transfer on R, G and B with
 * slope 2^exposure x contrast x the preset's and intercept 0.5 - 0.5 x contrast (contrast pivots on mid-grey), then the
 * preset's black lift (a table transfer, so the floor holds at any exposure or contrast). Throws on an `id` that is not a plain SVG name, an unknown preset, or a value that is not a finite number.
 */
export function gradeFilter(id, grade) {
  grade ??= {};
  if (typeof id !== 'string' || !FILTER_ID.test(id)) throw new Error(`filter id ${JSON.stringify(id)} must be letters, digits, "-" or "_", starting with a letter`);
  const named = grade.preset;
  if (named !== undefined && !(typeof named === 'string' && Object.hasOwn(PRESETS, named))) {
    throw new Error(`unknown grade preset ${JSON.stringify(named)}; presets: ${GRADE_PRESETS.join(', ')}`);
  }
  const preset = named === undefined ? { saturation: 1, contrast: 1 } : PRESETS[named];
  const saturation = finite(grade, 'saturation') * preset.saturation;
  const contrast = finite(grade, 'contrast') * preset.contrast;
  const gain = 2 ** finite(grade, 'exposure') * contrast;
  const steps = [`<feColorMatrix type="saturate" values="${fmt(saturation)}"/>`];
  if (preset.matrix) steps.push(`<feColorMatrix type="matrix" values="${[...preset.matrix, ...ALPHA_ROW].map(fmt).join(' ')}"/>`);
  steps.push(transfer(`type="linear" slope="${fmt(gain)}" intercept="${fmt(0.5 - 0.5 * contrast)}"`));
  if (preset.lift) steps.push(transfer(`type="table" tableValues="${preset.lift}"`));
  return `<filter id="${id}" color-interpolation-filters="sRGB">${steps.join('')}</filter>`;
}

/** True when `grade` would leave the picture as it is: no preset, and every number at its default. */
export const isIdleGrade = (grade) => grade.preset === undefined
  && Object.entries(GRADE_DEFAULTS).every(([key, rest]) => (grade[key] ?? rest) === rest);

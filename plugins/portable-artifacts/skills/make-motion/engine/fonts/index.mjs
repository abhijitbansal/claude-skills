// The variable display faces bundled in engine/fonts (SOURCES.md has their provenance), as data. Plain data plus
// fontFaces(); the page and Node tests both import it, so it touches no browser global.
//
// font: { family, file, axes, reach, of?, fixed? }
//   axes   the axes the entry leaves free, as [min, max]. A derived entry drops the axes it pins.
//   fixed  derived entries only: the axes pinned for this family name (variationSettings on its own FontFace), so
//          canvas text can reach opsz and SOFT, which ctx.font has no way to set. `of` names the base family.
//   reach  per axis: does drawing on canvas change when this axis changes, through the route the engine has for it
//          (wght: ctx.font weight; wdth: ctx.fontStretch keyword; a pinned axis: the derived family against its
//          base; any other axis has no ctx route)? These are measured, not guessed: test/v2/fonts-browser.test.mjs
//          draws each family and fails when a flag disagrees. Findings: CANVAS-NOTES.md.
const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const FRAUNCES_FILE = 'fraunces-latin-full-normal.woff2';
const FRAUNCES_AXES = { wght: [100, 900], opsz: [9, 144], SOFT: [0, 100] };
const NO_REACH = { wght: false, wdth: false, opsz: false, SOFT: false };

export const FONTS = deepFreeze([
  { family: 'Fraunces', file: FRAUNCES_FILE, axes: FRAUNCES_AXES, reach: { ...NO_REACH, wght: true } },
  { family: 'Fraunces Soft', file: FRAUNCES_FILE, of: 'Fraunces', fixed: { SOFT: 100 }, axes: { wght: [100, 900], opsz: [9, 144] }, reach: { ...NO_REACH, wght: true, SOFT: true } },
  { family: 'Fraunces Text', file: FRAUNCES_FILE, of: 'Fraunces', fixed: { opsz: 9 }, axes: { wght: [100, 900], SOFT: [0, 100] }, reach: { ...NO_REACH, wght: true, opsz: true } },
  { family: 'Fraunces Display', file: FRAUNCES_FILE, of: 'Fraunces', fixed: { opsz: 144 }, axes: { wght: [100, 900], SOFT: [0, 100] }, reach: { ...NO_REACH, wght: true, opsz: true } },
  { family: 'Archivo', file: 'archivo-latin-standard-normal.woff2', axes: { wght: [100, 900], wdth: [62, 125] }, reach: { ...NO_REACH, wght: true, wdth: true } },
  // the cosmos look's rounded sans: a weight axis only
  { family: 'Nunito', file: 'nunito-latin-wght-normal.woff2', axes: { wght: [200, 1000] }, reach: { ...NO_REACH, wght: true } },
  // the keynote look's neutral sans: a weight axis only; named apart from the static shared "Geist" (fonts-shared.mjs)
  { family: 'Geist Variable', file: 'geist-latin-wght-normal.woff2', axes: { wght: [100, 900] }, reach: { ...NO_REACH, wght: true } },
  // the marker look's handwriting: a weight axis only (400 to 700)
  { family: 'Caveat', file: 'caveat-latin-wght-normal.woff2', axes: { wght: [400, 700] }, reach: { ...NO_REACH, wght: true } },
]);

// ctx.fontStretch takes these keywords and nothing else (a percentage is ignored), so canvas width moves in these
// steps. [percent, keyword]; Archivo's wdth axis is 62..125, so these six are the widths it can show.
export const STRETCH_KEYWORDS = deepFreeze([
  [62.5, 'extra-condensed'], [75, 'condensed'], [87.5, 'semi-condensed'],
  [100, 'normal'], [112.5, 'semi-expanded'], [125, 'expanded'],
]);

const FONT_URL_PREFIX = '/engine/fonts/';
const FULL_WEIGHT = '100 900';

const variationSettings = (fixed) => Object.entries(fixed).map(([tag, value]) => `"${tag}" ${value}`).join(', ');

function descriptorsFor(font) {
  const descriptors = { weight: FULL_WEIGHT, style: 'normal' };
  if (font.axes.wdth) descriptors.stretch = `${font.axes.wdth[0]}% ${font.axes.wdth[1]}%`;
  if (font.fixed) descriptors.variationSettings = variationSettings(font.fixed);
  return descriptors;
}

/** One face per FONTS entry, ready for `new FontFace(family, `url(${url})`, descriptors)`; fresh objects every call. */
export const fontFaces = () => FONTS.map((font) => ({
  family: font.family,
  url: `${FONT_URL_PREFIX}${font.file}`,
  descriptors: descriptorsFor(font),
}));

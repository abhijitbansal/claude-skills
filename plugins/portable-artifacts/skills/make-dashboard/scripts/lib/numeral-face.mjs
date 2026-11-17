// The face chart text and footer numbers are set in. A body face whose only zero is slashed reads as a font fault in
// "2025" or "$6,000", so its theme's own fallback stack draws numbers instead. No new font file.

// Body faces with a slashed zero and no plain alternate: Atkinson Hyperlegible's file has no `zero` feature and its only
// other zero is the tabular one (GSUB ccmp, frac, pnum, tnum; checked with .scratch/r3/zero.mjs).
const SLASHED_ZERO = new Set(['Atkinson Hyperlegible']);

/** The CSS font-family for numbers in a theme's `fonts` ({ body: { family, fallback } }). */
export function numeralFont(fonts) {
  const { family, fallback } = fonts.body;
  return SLASHED_ZERO.has(family) ? fallback : `"${family}", ${fallback}`;
}

/** The page CSS for it: --font-num (the runtime draws charts in it) and the footer and card refresh lines set in it. */
export function numeralCss(fonts) {
  const stack = numeralFont(fonts);
  return `:root { --font-num: ${stack}; }\n.pa-footer, .card details > summary { font-family: ${stack}; }`;
}

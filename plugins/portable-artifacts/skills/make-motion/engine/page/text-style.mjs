// One place that turns a node's `font` object into canvas text state, so measuring and drawing cannot disagree.
// font: { family, size, weight?, width?, tracking? } (size in px, tracking in em, width a CSS font-stretch keyword).
const DEFAULT_WEIGHT = 400;
const FONT_STRETCHES = new Set([
  'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'normal',
  'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
]);

export const fontString = (font) => `${font.weight ?? DEFAULT_WEIGHT} ${font.size}px "${font.family}"`;

function stretchOf(font) {
  const width = font.width ?? 'normal';
  if (!FONT_STRETCHES.has(width)) throw new Error(`font.width must be one of ${[...FONT_STRETCHES].join(', ')}, got "${width}"`);
  return width;
}

// `tracked` false leaves letterSpacing at 0: layoutText adds tracking to each measured word itself, so a measure
// that also applied it would count it twice. Drawing sets it, and a drawn word then spans the width layout gave it.
export function applyFont(ctx, font, { tracked }) {
  ctx.font = fontString(font);
  ctx.fontStretch = stretchOf(font);
  ctx.letterSpacing = tracked ? `${(font.tracking ?? 0) * font.size}px` : '0px';
}

// The `measure(text, font) -> { width, ascent, descent }` layoutText and `free` take, backed by a canvas context.
export function createMeasure(ctx) {
  return (text, font) => {
    applyFont(ctx, font, { tracked: false });
    const m = ctx.measureText(text);
    return { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
  };
}

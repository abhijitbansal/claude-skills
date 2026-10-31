// Browser-safe (no Node imports): format presets, the safe area and the caption zone. Shared by spec validation,
// withDefaults, check.mjs and (with captions) the renderer.

// Each preset sets the canvas size and where the caption zone starts, as a share of the height. The vertical formats
// start it higher (72 %): their bottom edge is covered by app chrome, and a caption needs two lines of room.
export const FORMATS = Object.freeze({
  '16:9': Object.freeze({ size: Object.freeze([1920, 1080]), captionTop: 0.78 }),
  '9:16': Object.freeze({ size: Object.freeze([1080, 1920]), captionTop: 0.72 }),
  '1:1': Object.freeze({ size: Object.freeze([1080, 1080]), captionTop: 0.78 }),
  '4:5': Object.freeze({ size: Object.freeze([1080, 1350]), captionTop: 0.72 }),
});
export const FORMAT_NAMES = Object.freeze(Object.keys(FORMATS));

// The canvas when a spec gives neither `size` nor `format`.
export const DEFAULT_SIZE = FORMATS['16:9'].size;

// The canvas size a spec resolves to: its `size`, else its `format`'s, else the default. Pure; it writes nothing, so a
// step that runs before applyFormat (block expansion) lays out for the size applyFormat will give.
export const canvasSize = (spec) => spec.size ?? FORMATS[spec.format]?.size ?? DEFAULT_SIZE;

// The caption zone's top when a spec names no format (a custom `size`).
export const DEFAULT_CAPTION_TOP = 0.78;

export const SAFE_MARGIN_PX = 60; // at 1080 px on the canvas's short side; scaled by short side / 1080
export const SAFE_REFERENCE_SIDE = 1080;

// The safe-area margin on every side: 60 px at 1080 on the short side (the rule comes from a 1080x1080 canvas), so
// 1920x1080, 1080x1350 and 1080x1080 all get 60 px and 3840x2160 gets 120.
export const safeMargin = (size) => (SAFE_MARGIN_PX * Math.min(size[0], size[1])) / SAFE_REFERENCE_SIDE;

// The safe area as a margin on each side. `zone` is a platform's UI bands (viral mode); it is not defined yet, so a
// caller that passes one is refused rather than silently given the plain margin.
export function safeInsets(size, zone = null) {
  if (zone !== null) throw new Error('safeInsets: a zone is not supported yet (viral mode defines it)');
  const margin = safeMargin(size);
  return { top: margin, right: margin, bottom: margin, left: margin };
}

// Where captions sit: the safe area's lower part, from `captionTop` of the height down to the bottom margin. `insets`
// (viral mode's lifted zone) is not defined yet and refused the same way.
export function captionZone(size, format, insets = null) {
  if (insets !== null) throw new Error('captionZone: insets are not supported yet (viral mode defines them)');
  const [w, h] = size;
  const safe = safeMargin(size);
  const top = FORMATS[format]?.captionTop ?? DEFAULT_CAPTION_TOP;
  return { left: safe, top: Math.round(h * top), right: w - safe, bottom: h - safe };
}

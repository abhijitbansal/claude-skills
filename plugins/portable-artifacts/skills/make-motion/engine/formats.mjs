// Format presets, the safe area and the viral platform zone: a DOM-free table the render page and Node both load.
// A copy of the part of version 1's template/formats.mjs (deleted at cut-over) that version 2 uses; the values are the same
// (test/v2/formats.test.mjs records them).

// Each preset sets the canvas size. `captionTop` (where version 1's caption zone starts, as a share of the height) stays
// so the table is the old one value for value; version 2's captions place themselves.
export const FORMATS = Object.freeze({
  '16:9': Object.freeze({ size: Object.freeze([1920, 1080]), captionTop: 0.78 }),
  '9:16': Object.freeze({ size: Object.freeze([1080, 1920]), captionTop: 0.72 }),
  '1:1': Object.freeze({ size: Object.freeze([1080, 1080]), captionTop: 0.78 }),
  '4:5': Object.freeze({ size: Object.freeze([1080, 1350]), captionTop: 0.72 }),
});

// The canvas when a film gives neither `size` nor `format`.
const DEFAULT_SIZE = FORMATS['16:9'].size;

// The canvas size a spec resolves to: its `size`, else its `format`'s, else the default. Pure; it writes nothing.
export const canvasSize = (spec) => spec.size ?? FORMATS[spec.format]?.size ?? DEFAULT_SIZE;

export const SAFE_MARGIN_PX = 60; // at 1080 px on the canvas's short side; scaled by short side / 1080
export const SAFE_REFERENCE_SIDE = 1080;

// The safe-area margin on every side: 60 px at 1080 on the short side (the rule comes from a 1080x1080 canvas), so
// 1920x1080, 1080x1350 and 1080x1080 all get 60 px and 3840x2160 gets 120.
export const safeMargin = (size) => (SAFE_MARGIN_PX * Math.min(size[0], size[1])) / SAFE_REFERENCE_SIDE;

// Viral mode's platform safe zone: the union of the UI bands Reels, TikTok and Shorts draw over a 1080x1920 frame (px
// at that size; top 290 is the account bar, bottom 675 the caption, music and buttons, the sides the action rail).
// Tunable defaults from the platforms' ad-spec margins, not rules: a film's `viral.safeZone` replaces them.
export const VIRAL_SAFE_ZONE = Object.freeze({ top: 290, bottom: 675, left: 120, right: 195 });
export const VIRAL_REFERENCE = Object.freeze([1080, 1920]); // the canvas VIRAL_SAFE_ZONE is measured on

// The safe area as a margin on each side: the plain margin, or with `zone` (a platform's UI bands in px at 1080x1920,
// viral mode) each band scaled to the canvas, never less than the plain margin.
export function safeInsets(size, zone = null) {
  const margin = safeMargin(size);
  if (zone === null) return { top: margin, right: margin, bottom: margin, left: margin };
  const [w, h] = size;
  const [refW, refH] = VIRAL_REFERENCE;
  const band = (px, side, ref) => Math.max(margin, (px * side) / ref);
  return { top: band(zone.top, h, refH), right: band(zone.right, w, refW), bottom: band(zone.bottom, h, refH), left: band(zone.left, w, refW) };
}

// The v2 design unit: 1 unit = short side / 1080 px, so 1920x1080 and 1080x1920 both have a unit of 1 pixel and
// 3840x2160 has 2. The stage hands it to kinds as ctx.unit and the fields default to it. Pure and DOM-free.
export const REFERENCE_SIDE = 1080;

export function unitOf(canvas) {
  const { w, h } = canvas ?? {};
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
    throw new Error(`unitOf: canvas must be { w, h } with finite w and h > 0, got ${JSON.stringify(canvas)}`);
  }
  return Math.min(w, h) / REFERENCE_SIDE;
}

// Value-axis ticks chosen up front, from the pixels the axis has and the width of the labels it would
// print, so no label is ever hidden for overlap. Pure: no Vega, no DOM.

const CHAR_EM = 0.8; // Vega's own text-width estimate, per character, in ems
const MAX_STEPS = 60;

/** The 1-2-5 step (x 10^k) that is at least `raw`. */
export function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

const round = (v, step) => Number((Math.round(v / step) * step).toPrecision(12));

// Do the labels, drawn the way the axis draws them, clear each other? Horizontal labels are centred on their tick
// except the first and last, which sit flush inside the axis; vertical labels only need a line of height each.
function fits(positions, widths, { pixels, fontSize, horizontal, gap }) {
  if (!horizontal) return positions.every((p, i) => i === 0 || Math.abs(p - positions[i - 1]) >= fontSize * 1.3 + gap);
  const boxes = positions.map((p, i) => {
    const w = widths[i];
    const left = i === 0 ? p : i === positions.length - 1 ? p - w : p - w / 2;
    return [left, left + w];
  });
  return boxes.every((b, i) => i === 0 || b[0] - boxes[i - 1][1] >= gap) && boxes[0][0] >= 0 && boxes.at(-1)[1] <= pixels + 0.5;
}

/**
 * Ticks for a linear axis over the data extent [d0, d1].
 * `pixels` is the axis length, `label(value, step)` the text printed for a tick, `fontSize` its size,
 * `horizontal` whether labels sit side by side (else one above the other), `max` the most ticks wanted.
 * -> { values, domain: [lo, hi] } where the domain ends on a tick and overshoots the data by less than one step,
 * or null when the extent is empty (the caller keeps Vega's own axis).
 * The step is the smallest 1-2-5 step whose labels, side by side, fit in the space between ticks.
 */
export function tickLayout({ domain: [d0, d1], pixels, label, fontSize, horizontal, max, gap = 6 }) {
  const span = d1 - d0;
  if (!(span > 0) || !(pixels > 0)) return null;
  let step = niceStep(span / Math.max(max, 2) / 2);
  for (let i = 0; i < MAX_STEPS; i++, step = niceStep(step * 1.01)) {
    const lo = round(Math.floor(d0 / step + 1e-9) * step, step);
    const hi = round(Math.ceil(d1 / step - 1e-9) * step, step);
    const count = Math.round((hi - lo) / step) + 1;
    if (count > max && count > 2) continue;
    const values = Array.from({ length: count }, (_, k) => round(lo + k * step, step));
    const widths = values.map((v) => label(v, step).length * fontSize * CHAR_EM);
    if (count <= 2 || fits(values.map((v) => ((v - lo) / (hi - lo)) * pixels), widths, { pixels, fontSize, horizontal, gap })) return { values, domain: [lo, hi] };
  }
  return null;
}

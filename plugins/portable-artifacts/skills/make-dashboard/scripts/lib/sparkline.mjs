// A KPI tile's opt-in trend (kpis[].trend = { query, field }): the field of a declared query's rows, in query
// order, drawn at build time as one inline SVG line. Numbers only reach the markup; no script, no link, no text.

const PAD = 2; // room for the end dot and the stroke inside the box
const DOT_R = 2;
const round = (n) => Math.round(n * 10) / 10;

// A cell as a finite number, or null: wide DECIMALs arrive as numeric strings, BIGINTs as bigint, NULLs as null.
function numeric(v) {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** The trend values of `rows` for `field`, in row order; cells that are not finite numbers are skipped. */
export function trendValues(rows, field) {
  return (rows ?? []).map((r) => numeric(r?.[field])).filter((v) => v !== null);
}

/**
 * One inline SVG: a polyline path through the finite `values` (left to right, high values at the top) and a dot on
 * the last point. Fewer than two finite values give '' (a line needs two points). A flat series sits mid-height.
 */
export function sparklineSvg(values, { width, height }) {
  const ys = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (ys.length < 2) return '';
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min;
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  const points = ys.map((v, i) => [
    round(PAD + (innerW * i) / (ys.length - 1)),
    round(span === 0 ? height / 2 : PAD + innerH * (1 - (v - min) / span)),
  ]);
  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join('');
  const [lx, ly] = points.at(-1);
  return `<svg class="kpi-trend" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">`
    + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
    + `<circle cx="${lx}" cy="${ly}" r="${DOT_R}" fill="currentColor"/></svg>`;
}

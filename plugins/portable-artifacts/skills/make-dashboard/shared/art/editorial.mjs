// editorial: a newspaper page. A thick-and-thin rule at the head, column rules, set lines in each column and a
// fleuron ornament in the accent that breaks the columns. Colours are the theme's own tokens, used as they are.
import { TAU, f, fi, ring, bounded } from './pieces.mjs';

const MAX_COLUMNS = 6;
const MAX_LINES = 300; // across all columns

function head(ctx, y) {
  const { c, W, S } = ctx;
  const m = W * 0.06;
  return `<rect x="${fi(m)}" y="${fi(y)}" width="${fi(W - 2 * m)}" height="${f(Math.max(1.5, S / 120))}" fill="${c.text}"/>`
    + `<rect x="${fi(m)}" y="${fi(y + Math.max(4, S / 45))}" width="${fi(W - 2 * m)}" height="${f(Math.max(1, S / 500))}" fill="${c.text}"/>`;
}

function columns(ctx, top) {
  const { r, c, W, H, S } = ctx;
  const m = W * 0.06;
  const k = bounded(W - 2 * m, S * 0.5, MAX_COLUMNS);
  const cw = (W - 2 * m) / k;
  const pitch = Math.max(8, S / 22);
  const rows = Math.min(bounded(H - top, pitch, MAX_LINES), Math.floor(MAX_LINES / k));
  const barH = Math.max(1, pitch * 0.32);
  let rules = '';
  let set = '';
  for (let j = 1; j < k; j++) rules += `M${fi(m + j * cw)} ${fi(top)}V${fi(H - pitch)}`;
  for (let j = 0; j < k; j++) {
    for (let i = 1; i < rows; i++) {
      const y = top + i * pitch;
      if (y > H - pitch) break;
      const short = r() < 0.12; // a paragraph end
      set += `<rect x="${fi(m + j * cw + cw * 0.08)}" y="${fi(y - barH)}" width="${fi(cw * (short ? 0.3 + r() * 0.4 : 0.84))}" height="${fi(barH)}"/>`;
    }
  }
  return (rules ? `<path d="${rules}" fill="none" stroke="${c.line}" stroke-width="${f(Math.max(1, S / 700))}"/>` : '')
    + `<g fill="${c.grid}">${set}</g>`;
}

// A fleuron: four petals round a dot, flanked by two short rules, on a page-coloured plate that breaks the columns.
function ornament(ctx, cx, cy) {
  const { c, S } = ctx;
  const rad = S * 0.06;
  const petals = ring(cx, cy, rad, (t) => 0.35 + 0.65 * Math.abs(Math.cos(2 * t + TAU / 8)), 32);
  const reach = rad * 3.2;
  const w = f(Math.max(1, S / 400));
  return `<rect x="${fi(cx - reach * 1.15)}" y="${fi(cy - rad * 1.4)}" width="${fi(reach * 2.3)}" height="${fi(rad * 2.8)}" fill="${c.page}"/>`
    + `<path d="${petals}" fill="${c.accent}"/><circle cx="${fi(cx)}" cy="${fi(cy)}" r="${f(rad * 0.22)}" fill="${c.page}"/>`
    + `<path d="M${fi(cx - reach)} ${fi(cy)}H${fi(cx - rad * 1.3)}M${fi(cx + rad * 1.3)} ${fi(cy)}H${fi(cx + reach)}" stroke="${c.accent}" stroke-width="${w}"/>`;
}

export function editorial(ctx) {
  const { r, c, W, H, S } = ctx;
  const y0 = Math.max(4, S * 0.08);
  const top = y0 + Math.max(10, S / 12);
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${head(ctx, y0)}${columns(ctx, top)}`
    + ornament(ctx, W * (0.35 + r() * 0.3), top + (H - top) * (0.2 + r() * 0.25));
  return { defs: '', body, grain: 0.2 };
}

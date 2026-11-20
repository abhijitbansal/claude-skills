// paper: a ruled sheet. Feint rules, a margin line in the accent, two soft fold creases, a dog-eared corner and a
// few pen ticks near the margin. Colours are the theme's own tokens, used as they are.
import { f, fi, op, bounded } from './pieces.mjs';

const MAX_RULES = 80;

function rules(ctx) {
  const { c, W, H, S } = ctx;
  const rows = bounded(H, Math.max(10, S / 14), MAX_RULES);
  let d = '';
  for (let i = 1; i < rows; i++) d += `M0 ${fi((i * H) / rows)}H${fi(W)}`;
  return d ? `<path d="${d}" fill="none" stroke="${c.line}" stroke-width="${f(Math.max(1, S / 420))}"/>` : '';
}

// A crease: a soft band of shadow beside a hairline of the lighter surface, across the whole sheet.
function fold(ctx, vertical, at) {
  const { c, W, H, S, id } = ctx;
  const band = Math.max(4, S * 0.05);
  const key = vertical ? 'fold-v' : 'fold-h';
  const [x2, y2] = vertical ? ['1', '0'] : ['0', '1'];
  const defs = `<linearGradient id="${id(key)}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c.text}" stop-opacity="0"/>`
    + `<stop offset=".5" stop-color="${c.text}" stop-opacity="${op(ctx.mode === 'light' ? 0.11 : 0.18)}"/><stop offset="1" stop-color="${c.text}" stop-opacity="0"/></linearGradient>`;
  const rect = vertical
    ? `<rect x="${fi(at - band / 2)}" y="0" width="${fi(band)}" height="${fi(H)}" fill="url(#${id(key)})"/>`
    : `<rect x="0" y="${fi(at - band / 2)}" width="${fi(W)}" height="${fi(band)}" fill="url(#${id(key)})"/>`;
  const line = vertical ? `M${fi(at)} 0V${fi(H)}` : `M0 ${fi(at)}H${fi(W)}`;
  return { defs, body: `${rect}<path d="${line}" stroke="${c.surface}" stroke-width="${f(Math.max(1, S / 700))}" opacity=".9"/>` };
}

function dogEar(ctx) {
  const { c, W, S } = ctx;
  const s = S * 0.16;
  return `<path d="M${fi(W - s)} 0L${fi(W)} ${fi(s)}L${fi(W)} 0Z" fill="${c.page}"/>`
    + `<path d="M${fi(W - s)} 0L${fi(W - s * 0.08)} ${fi(s * 1.08)}L${fi(W)} ${fi(s)}Z" fill="${c.text}" opacity=".08"/>`
    + `<path d="M${fi(W - s)} 0L${fi(W)} ${fi(s)}L${fi(W - s)} ${fi(s)}Z" fill="${c.surface2}" stroke="${c.line}" stroke-width="${f(Math.max(1, S / 600))}"/>`;
}

function ticks(ctx, marginX) {
  const { r, c, H, S } = ctx;
  const n = 3 + Math.floor(r() * 3);
  const u = S * 0.03;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = marginX + u * (0.8 + r() * 1.5);
    const y = H * (0.15 + r() * 0.7);
    d += `M${fi(x)} ${fi(y)}l${fi(u * 0.4)} ${fi(u * 0.45)}l${fi(u * 0.9)} ${fi(-u)}`;
  }
  return `<path d="${d}" fill="none" stroke="${c.text2}" stroke-width="${f(Math.max(1, S / 260))}" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
}

export function paper(ctx) {
  const { r, c, W, H, S } = ctx;
  const marginX = W * (0.1 + r() * 0.06);
  const v = fold(ctx, true, W * (0.45 + r() * 0.15));
  const h = fold(ctx, false, H * (0.4 + r() * 0.25));
  let body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${rules(ctx)}`;
  body += `<path d="M${fi(marginX)} 0V${fi(H)}" stroke="${c.accent}" stroke-width="${f(Math.max(1, S / 360))}" opacity=".85"/>`;
  body += v.body + h.body + ticks(ctx, marginX) + dogEar(ctx);
  return { defs: v.defs + h.defs, body, grain: 0.35 };
}

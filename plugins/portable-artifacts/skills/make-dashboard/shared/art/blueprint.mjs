// blueprint: a drafting sheet. Minor and major grid, construction circles and a dashed frame in the accent, and
// dimension lines with extension lines and slash ticks. Colours are the theme's own tokens, used as they are.
import { f, fi, bounded } from './pieces.mjs';

const MAX_LINES = 120; // per axis
const MAJOR = 5;

function grid(ctx) {
  const { c, W, H, S } = ctx;
  const cols = bounded(W, Math.max(8, S / 24), MAX_LINES);
  const rows = bounded(H, Math.max(8, S / 24), MAX_LINES);
  let minor = '';
  let major = '';
  for (let i = 1; i < cols; i++) {
    const seg = `M${fi((i * W) / cols)} 0V${fi(H)}`;
    if (i % MAJOR === 0) major += seg; else minor += seg;
  }
  for (let j = 1; j < rows; j++) {
    const seg = `M0 ${fi((j * H) / rows)}H${fi(W)}`;
    if (j % MAJOR === 0) major += seg; else minor += seg;
  }
  const w = Math.max(0.5, S / 1600);
  return (minor ? `<path d="${minor}" fill="none" stroke="${c.grid}" stroke-width="${f(w)}"/>` : '')
    + (major ? `<path d="${major}" fill="none" stroke="${c.line}" stroke-width="${f(w * 2)}"/>` : '');
}

// A dimension: the measured span, two extension lines and a 45-degree slash at each end.
function dimension(ctx, x1, y1, x2, y2, offset) {
  const { c, S } = ctx;
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const [dx, dy] = horizontal ? [0, offset] : [offset, 0];
  const t = S * 0.018;
  const ext = horizontal ? `M${fi(x1)} ${fi(y1)}V${fi(y1 + dy * 1.2)}M${fi(x2)} ${fi(y2)}V${fi(y2 + dy * 1.2)}`
    : `M${fi(x1)} ${fi(y1)}H${fi(x1 + dx * 1.2)}M${fi(x2)} ${fi(y2)}H${fi(x2 + dx * 1.2)}`;
  const [ax, ay, bx, by] = [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
  const slash = (x, y) => `M${fi(x - t)} ${fi(y + t)}L${fi(x + t)} ${fi(y - t)}`;
  return `<path d="${ext}M${fi(ax)} ${fi(ay)}L${fi(bx)} ${fi(by)}${slash(ax, ay)}${slash(bx, by)}" fill="none" stroke="${c.text2}" stroke-width="${f(Math.max(0.8, S / 900))}"/>`;
}

function construction(ctx) {
  const { r, c, W, H, S } = ctx;
  const w = f(Math.max(1, S / 360));
  const cx = W * (0.3 + r() * 0.4);
  const cy = H * (0.3 + r() * 0.4);
  const rad = S * (0.18 + r() * 0.12);
  const inner = rad * (0.45 + r() * 0.2);
  const cross = rad * 1.25;
  let out = `<g fill="none" stroke="${c.accent}" stroke-width="${w}"><circle cx="${fi(cx)}" cy="${fi(cy)}" r="${fi(rad)}"/>`
    + `<circle cx="${fi(cx)}" cy="${fi(cy)}" r="${fi(inner)}" stroke-dasharray="${f(S * 0.02)} ${f(S * 0.012)}"/>`
    + `<path d="M${fi(cx - cross)} ${fi(cy)}H${fi(cx + cross)}M${fi(cx)} ${fi(cy - cross)}V${fi(cy + cross)}" stroke-dasharray="${f(S * 0.04)} ${f(S * 0.01)} ${f(S * 0.004)} ${f(S * 0.01)}"/>`;
  const fw = W * (0.55 + r() * 0.3);
  const fh = H * (0.5 + r() * 0.3);
  const [fx, fy] = [(W - fw) / 2, (H - fh) / 2];
  out += `<rect x="${fi(fx)}" y="${fi(fy)}" width="${fi(fw)}" height="${fi(fh)}" stroke-dasharray="${f(S * 0.03)} ${f(S * 0.015)}" opacity=".7"/></g>`;
  out += dimension(ctx, fx, fy + fh, fx + fw, fy + fh, S * 0.06);
  out += dimension(ctx, fx + fw, fy, fx + fw, fy + fh, S * 0.06);
  out += dimension(ctx, cx - rad, cy - rad, cx + rad, cy - rad, -S * 0.05);
  return out;
}

export function blueprint(ctx) {
  const { c, W, H } = ctx;
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${grid(ctx)}${construction(ctx)}`;
  return { defs: '', body, grain: 0.15 };
}

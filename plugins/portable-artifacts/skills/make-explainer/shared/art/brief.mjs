// brief: a memo. A row of folder tabs in the three surface steps, the sheet below them, an accent rule under the
// heading line and rows of text bars of seeded length. Colours are the theme's own tokens, used as they are.
import { f, fi, bounded } from './pieces.mjs';

const MAX_TABS = 6;
const MAX_ROWS = 60;

function tabs(ctx, tabH) {
  const { r, c, W, S } = ctx;
  const n = bounded(W, S * 0.7, MAX_TABS);
  const tw = W / (n + 0.6);
  const fills = [c.surface3, c.surface2, c.surface];
  const chosen = Math.floor(r() * n);
  const w = f(Math.max(1, S / 600));
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = tw * 0.3 + i * tw;
    const slant = tw * 0.08;
    const up = i === chosen ? tabH : tabH * 0.8;
    const y = tabH - up;
    const fill = i === chosen ? c.surface : fills[i % 2];
    out += `<path d="M${fi(x)} ${fi(tabH)}L${fi(x + slant)} ${fi(y)}H${fi(x + tw * 0.9 - slant)}L${fi(x + tw * 0.9)} ${fi(tabH)}Z" fill="${fill}" stroke="${c.line}" stroke-width="${w}"/>`;
    if (i === chosen) out += `<rect x="${fi(x + slant)}" y="${fi(y)}" width="${fi(tw * 0.9 - 2 * slant)}" height="${fi(Math.max(1, tabH * 0.12))}" fill="${c.accent}"/>`;
  }
  return out;
}

function lines(ctx, top) {
  const { r, c, W, H, S } = ctx;
  const pitch = Math.max(12, S / 11);
  const rows = bounded(H - top, pitch, MAX_ROWS);
  const left = W * 0.08;
  const room = W * 0.84;
  const barH = Math.max(1, pitch * 0.26);
  let bars = '';
  let faint = '';
  for (let i = 1; i < rows; i++) {
    const y = top + i * pitch;
    if (y > H - pitch * 0.5) break;
    const len = room * (i === 1 ? 0.45 : 0.35 + r() * 0.6);
    const bar = `<rect x="${fi(left)}" y="${fi(y - barH)}" width="${fi(len)}" height="${fi(barH)}"/>`;
    if (i === 1 || r() < 0.2) bars += bar; else faint += bar;
  }
  const rule = `<rect x="${fi(left)}" y="${fi(top + pitch * 1.45)}" width="${fi(room)}" height="${fi(Math.max(1, S / 160))}" fill="${c.accent}"/>`;
  return `<g fill="${c.text3}" opacity=".45">${bars}</g><g fill="${c.surface3}">${faint}</g>${rule}`;
}

export function brief(ctx) {
  const { c, W, H, S } = ctx;
  const tabH = Math.max(6, S * 0.1);
  const sheet = `<rect x="0" y="${fi(tabH)}" width="${f(W)}" height="${fi(Math.max(1, H - tabH))}" fill="${c.surface}" stroke="${c.line}" stroke-width="${f(Math.max(1, S / 600))}"/>`;
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${tabs(ctx, tabH)}${sheet}${lines(ctx, tabH)}`;
  return { defs: '', body, grain: 0.18 };
}

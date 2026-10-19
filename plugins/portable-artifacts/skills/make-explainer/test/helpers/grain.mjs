// Text contrast as the eye gets it on a flavored page: under the fixed film-grain overlay (flavors.css
// body::before), which token maths cannot see. The page is shot twice with every glyph hidden, once with the
// grain and once without; text whose ground is a solid fill (uniform in the grain-free shot) is then judged
// pixel by pixel against the grained fill. The grain also lands on the glyphs, so each pixel's grain alpha
// (recovered from the two shots) is applied to the text colour too, and the lower of the two readings counts.
// An element's figure is the PERCENTILE-low ratio over its box.
import { openPage } from './browser.mjs';

export const PERCENTILE = 0.05;
const MAX_HEIGHT = 12000;

const HIDE_TEXT = `*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important;
  caret-color: transparent !important; transition: none !important; animation: none !important; }`;
const NO_GRAIN = 'html[data-flavor] body::before { display: none !important; }';

// In the page: every own-text element (and each step marker numeral, a ::before) with its box and colour.
function collect() {
  const parse = (c) => {
    const n = (c.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
    const rgb = c.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
    return [...rgb, n.length > 3 ? n[3] : 1];
  };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const ownText = (el) => [...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim() !== '');
  const name = (el) => `${el.closest('section[id], header, footer')?.id || el.closest('section, header, footer')?.className || 'page'} ${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!ownText(el) || el.closest('svg, .sr-only, video, [hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const fg = parse(cs.color);
    fg[3] *= opacity(el);
    if (fg[3] < 0.05) continue; // shown only on hover or focus (the heading anchors)
    for (const r of el.getClientRects()) {
      if (r.width < 6 || r.height < 6) continue;
      out.push({ what: `${name(el)} "${el.textContent.trim().slice(0, 24)}"`, fg, box: [r.left + scrollX + 2, r.top + scrollY + 2, r.width - 4, r.height - 4], card: !!el.closest('.hero-tldr') });
    }
  }
  // A step marker is a card only where its numeral sits on a fill (press draws a bare accent numeral instead).
  for (const el of document.querySelectorAll('.step')) {
    const pre = getComputedStyle(el, '::before');
    if (pre.display === 'none' || pre.position !== 'absolute') continue;
    const card = parse(pre.backgroundColor)[3] > 0;
    const r = el.getBoundingClientRect();
    const [w, h] = [parseFloat(pre.width), parseFloat(pre.height)];
    const [x, y] = [r.left + scrollX + parseFloat(pre.left), r.top + scrollY + parseFloat(pre.top)];
    out.push({ what: `step marker ${el.querySelector('.step-title, b, strong')?.textContent.trim().slice(0, 16) ?? ''}`, fg: parse(pre.color), box: [x + w / 4, y + h / 4, w / 2, h / 2], card });
  }
  const text = parse(getComputedStyle(document.body, '::before').backgroundColor);
  return { items: out, grain: text, page: getComputedStyle(document.documentElement).getPropertyValue('--page').trim() };
}

// In a blank page: decode both shots and score every item whose grain-free ground is one flat colour.
async function score({ withGrain, without, items, grain, percentile }) {
  const decode = async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data };
  };
  const [A, B] = [await decode(withGrain), await decode(without)];
  const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (top, a, under) => [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a));
  const results = [];
  let skipped = 0;
  for (const it of items) {
    const [x0, y0] = [Math.max(0, Math.round(it.box[0])), Math.max(0, Math.round(it.box[1]))];
    const [x1, y1] = [Math.min(B.w, Math.round(it.box[0] + it.box[2])), Math.min(B.h, Math.round(it.box[1] + it.box[3]))];
    if (x1 - x0 < 2 || y1 - y0 < 2) { skipped++; continue; }
    const at = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
    const px = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.push([at(B, x, y), at(A, x, y)]);
    const med = [0, 1, 2].map((k) => { const v = px.map((p) => p[0][k]).sort((a, b) => a - b); return v[v.length >> 1]; });
    const flat = px.filter(([b]) => Math.abs(b[0] - med[0]) + Math.abs(b[1] - med[1]) + Math.abs(b[2] - med[2]) <= 3).length / px.length;
    if (flat < 0.97) { skipped++; continue; }
    const fg = mix(it.fg, it.fg[3], med);
    const d = [0, 1, 2].map((k) => grain[k] - med[k]);
    const dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const raw = [];
    const both = [];
    for (const [, a] of px) {
      const alpha = dd < 100 ? 0 : Math.min(1, Math.max(0, ((a[0] - med[0]) * d[0] + (a[1] - med[1]) * d[1] + (a[2] - med[2]) * d[2]) / dd));
      raw.push(ratio(fg, a));
      both.push(ratio(mix(grain, alpha, fg), a));
    }
    const low = (v) => v.sort((p, q) => p - q)[Math.floor(v.length * percentile)];
    const avg = [0, 1, 2].map((k) => px.reduce((acc, p) => acc + p[1][k], 0) / px.length);
    results.push({ what: it.what, card: it.card, mean: ratio(fg, avg), flat: ratio(fg, med), raw: low(raw), both: low(both), ratio: Math.min(low(raw), low(both)) });
  }
  return { results, skipped };
}

// A tall viewport can be shot before a style change reaches every tile; wait for two frames after one.
const painted = (page) => page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));

/**
 * Open a built page in `colorScheme` and score its text under the grain. `grainOp` forces --grain-op; `css` is
 * extra CSS added first. Resolves { results: [{ what, card, ratio, raw, both, flat, mean }], skipped, page }:
 * `ratio` = min(raw, both) is the figure; `flat` is the grain-free ratio and `mean` the ratio against the box's
 * average grained colour (both for context); `skipped` counts text whose ground is not one flat colour (art,
 * emoji, images); `page` is the computed --page, to prove the mode engaged.
 */
export async function grainContrast(url, { colorScheme = 'light', grainOp, css, width = 1280 } = {}) {
  if (grainOp !== undefined && !Number.isFinite(grainOp)) throw new TypeError(`grainOp must be a number, got ${grainOp}`);
  const { page, context } = await openPage(url, { width, height: 900, colorScheme });
  try {
    if (grainOp !== undefined) await page.addStyleTag({ content: `:root[data-flavor] { --grain-op: ${grainOp} !important; }` });
    if (css) await page.addStyleTag({ content: css });
    const height = Math.min(MAX_HEIGHT, await page.evaluate(() => document.documentElement.scrollHeight));
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    const { items, grain, page: pageInk } = await page.evaluate(collect);
    await page.addStyleTag({ content: HIDE_TEXT });
    await painted(page);
    const withGrain = (await page.screenshot({ type: 'png' })).toString('base64');
    const off = await page.addStyleTag({ content: NO_GRAIN });
    await painted(page);
    const without = (await page.screenshot({ type: 'png' })).toString('base64');
    await off.evaluate((n) => n.remove());
    const scorer = await context.newPage();
    const { results, skipped } = await scorer.evaluate(score, { withGrain, without, items, grain, percentile: PERCENTILE });
    return { results, skipped, page: pageInk };
  } finally {
    await context.close();
  }
}

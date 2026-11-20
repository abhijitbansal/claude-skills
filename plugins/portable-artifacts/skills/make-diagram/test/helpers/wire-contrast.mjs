// How dark a wire really draws, from a screenshot of the page as it opens: thin dashes and dots are anti-aliased
// into the page colour, so the token's contrast overstates them. For each solid, dashed and dotted wire it samples the
// path every screen px (2 px in from its ends, where arrow heads sit), takes the darkest pixel within 1 px of each
// sample, and reports the contrast against the page colour of the best pixel in each run of WINDOW samples (a
// dash period or more), as the median over the wire's runs. Nothing is decoded in node: the PNG is drawn on a
// canvas in a blank page of the same browser context.
import { contrastRatio } from '../../shared/contrast.mjs';

const WINDOW = 12;

const samplesInPage = (page) => page.evaluate((WINDOW) => {
  const hex = (c) => {
    const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    return `#${m.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  };
  const probe = document.createElement('i');
  probe.style.color = 'var(--page)';
  document.body.append(probe);
  const pageHex = hex(getComputedStyle(probe).color);
  probe.remove();
  const stage = document.getElementById('pa-stage').getBoundingClientRect();
  const wires = [...document.querySelectorAll('.pa-edge-solid .pa-wire, .pa-edge-dashed .pa-wire, .pa-edge-async .pa-wire')].filter((p) => !p.closest('.pa-legend')).map((p) => {
    const m = p.getScreenCTM();
    const len = p.getTotalLength();
    const scale = Math.hypot(m.a, m.b);
    const pts = [];
    for (let s = 2 / scale; s < len - 2 / scale; s += 1 / scale) {
      const q = p.getPointAtLength(s);
      const x = m.a * q.x + m.c * q.y + m.e;
      const y = m.b * q.x + m.d * q.y + m.f;
      if (x > stage.left + 2 && x < stage.right - 2 && y > stage.top + 2 && y < stage.bottom - 2) pts.push([Math.round(x), Math.round(y)]);
    }
    return { edge: p.closest('.pa-edge')?.dataset.id ?? '?', style: p.closest('.pa-edge-async') ? 'dotted' : p.closest('.pa-edge-dashed') ? 'dashed' : 'solid', pts };
  }).filter((w) => w.pts.length >= WINDOW);
  return { pageHex, wires };
}, WINDOW);

// Darkest pixel (by luminance) within 1 px of each point, as #rrggbb, from a PNG drawn on a canvas.
const darkest = (blank, png, points) => blank.evaluate(async ({ src, pts }) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return pts.map(([x, y]) => {
    let best = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = ((y + dy) * c.width + (x + dx)) * 4;
      if (best < 0 || lum(i) < lum(best)) best = i;
    }
    return `#${[d[best], d[best + 1], d[best + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}, { src: `data:image/png;base64,${png.toString('base64')}`, pts: points });

// Ink at each point: the summed darkness against the page colour (1 - luminance / page luminance, at least 0) of the
// 3x3 pixels around it, so a wire's width, tone and pattern all count and its subpixel offset does not.
const inkAt = (blank, png, points, pageHex) => blank.evaluate(async ({ src, pts, pageHex }) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const p = [1, 3, 5].map((i) => Number.parseInt(pageHex.slice(i, i + 2), 16));
  const page = lum(p[0], p[1], p[2]);
  return pts.map(([x, y]) => {
    let ink = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = ((y + dy) * c.width + (x + dx)) * 4;
      ink += Math.max(0, 1 - lum(d[i], d[i + 1], d[i + 2]) / page);
    }
    return ink;
  });
}, { src: `data:image/png;base64,${png.toString('base64')}`, pts: points, pageHex });

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * How much ink each wire puts down per px of its length, from a screenshot: [{ edge, style, ink }], ink the median over
 * runs of WINDOW samples of the run's mean ink (inkAt), so a label plate or a crossing wire does not move it. Light pages.
 */
export async function wireInk(page, context) {
  const { pageHex, wires } = await samplesInPage(page);
  const png = await page.screenshot();
  const blank = await context.newPage();
  try {
    const out = [];
    for (const w of wires) {
      const ink = await inkAt(blank, png, w.pts, pageHex);
      const runs = [];
      for (let i = 0; i + WINDOW <= ink.length; i += WINDOW) runs.push(ink.slice(i, i + WINDOW).reduce((a, b) => a + b, 0) / WINDOW);
      out.push({ edge: w.edge, style: w.style, ink: Number(median(runs).toFixed(3)) });
    }
    return out;
  } finally {
    await blank.close();
  }
}

/**
 * How heavy each wire draws as styled: [{ edge, style, width, contrast }] for every wire on `page` (style solid, dashed
 * or dotted; width in screen px, the stroke width times the scale unless the stroke does not scale; contrast of the
 * stroke colour on the page), plus the legend's samples: the drawn legend's (`drawn`, width in diagram units) and the
 * overlay's (`overlay`, its border width in px), each { style, width }.
 */
export const wireWeights = (page) => page.evaluate(() => {
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { const s = Number(v) / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  };
  const probe = document.createElement('i');
  probe.style.color = 'var(--page)';
  document.body.append(probe);
  const pageLum = lum(getComputedStyle(probe).color);
  probe.remove();
  const ratio = (c) => { const a = lum(c); return (Math.max(a, pageLum) + 0.05) / (Math.min(a, pageLum) + 0.05); };
  const styleOf = (el) => (el.closest('.pa-edge-async') ? 'dotted' : el.closest('.pa-edge-dashed') ? 'dashed' : 'solid');
  const wires = [...document.querySelectorAll('.pa-edge .pa-wire')].filter((p) => !p.closest('.pa-legend')).map((p) => {
    const cs = getComputedStyle(p);
    const m = p.getScreenCTM();
    const scale = cs.vectorEffect === 'non-scaling-stroke' ? 1 : Math.hypot(m.a, m.b);
    return { edge: p.closest('.pa-edge').dataset.id, style: styleOf(p), width: Number((parseFloat(cs.strokeWidth) * scale).toFixed(3)), contrast: Number(ratio(cs.stroke).toFixed(2)) };
  });
  const drawn = [...document.querySelectorAll('.pa-legend .pa-legend-sample .pa-wire')].map((p) => ({ style: styleOf(p), width: parseFloat(getComputedStyle(p).strokeWidth) }));
  const overlay = [...document.querySelectorAll('.lg-wire')].map((w) => ({ style: w.classList.contains('lg-wire-dotted') ? 'dotted' : w.classList.contains('lg-wire-dashed') ? 'dashed' : 'solid', width: parseFloat(getComputedStyle(w).borderTopWidth) }));
  return { wires, drawn, overlay };
});

/** [{ edge, style, contrast }] for every solid, dashed and dotted wire on `page`, plus the page colour. */
export async function wireContrast(page, context) {
  const { pageHex, wires } = await samplesInPage(page);
  const png = await page.screenshot();
  const blank = await context.newPage();
  try {
    const out = [];
    for (const w of wires) {
      const px = await darkest(blank, png, w.pts);
      const ratios = px.map((h) => contrastRatio(h, pageHex));
      const runs = [];
      for (let i = 0; i + WINDOW <= ratios.length; i += WINDOW) runs.push(Math.max(...ratios.slice(i, i + WINDOW)));
      out.push({ edge: w.edge, style: w.style, contrast: Number(median(runs).toFixed(2)) });
    }
    return { pageHex, wires: out };
  } finally {
    await blank.close();
  }
}

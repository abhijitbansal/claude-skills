// How dark a wire really draws, from a screenshot of the page as it opens: thin dashes and dots are anti-aliased
// into the page colour, so the token's contrast overstates them. For each dashed and dotted wire it samples the
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
  const wires = [...document.querySelectorAll('.pa-edge-dashed .pa-wire, .pa-edge-async .pa-wire')].filter((p) => !p.closest('.pa-legend')).map((p) => {
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
    return { edge: p.closest('.pa-edge')?.dataset.id ?? '?', style: p.closest('.pa-edge-async') ? 'dotted' : 'dashed', pts };
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

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** [{ edge, style, contrast }] for every dashed and dotted wire on `page`, plus the page colour. */
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

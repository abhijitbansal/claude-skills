// A claimed bar or series has to stand off the neutral the others take (vega-config.mjs). Measured in OKLab from
// the theme tokens: in dark, where a light accent sits next to a light neutral, the accent needs colour (chroma)
// and distance; in light, distance. Every step of the restrained series scale keeps 3:1 on the card surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vegaConfig } from '../scripts/lib/vega-config.mjs';
import { coloursOf } from '../scripts/lib/static-chart.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';
import { contrastRatio } from '../shared/contrast.mjs';

const MIN_DARK_CHROMA = 0.12;
const MIN_DARK_DISTANCE = 0.17;
const MIN_LIGHT_DISTANCE = 0.14;
const MIN_MARK = 3;

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const distance = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));
const chroma = (h) => Math.hypot(oklab(h)[1], oklab(h)[2]);
const cases = () => listThemes().flatMap((name) => ['light', 'dark'].map((mode) => {
  const tokens = loadTheme(name)[mode];
  const config = vegaConfig(coloursOf(tokens), 'sans-serif');
  return { name, mode, tokens, highlight: config.range.paHighlight, series: config.range.paSeries };
}));

test('the claimed mark stands off the neutral in every theme: dark needs chroma and distance, light needs distance', () => {
  const weak = cases().flatMap(({ name, mode, highlight: [accent, neutral] }) => {
    const d = distance(accent, neutral);
    const c = chroma(accent);
    const ok = mode === 'dark' ? c >= MIN_DARK_CHROMA && d >= MIN_DARK_DISTANCE : d >= MIN_LIGHT_DISTANCE;
    return ok ? [] : [`${name} ${mode}: ${accent} vs ${neutral} distance ${d.toFixed(3)}, chroma ${c.toFixed(3)}`];
  });
  assert.deepEqual(weak, []);
});

// Grouped and stacked charts: the claimed series is the strongest mark. Every neutral step sits between the accent and
// the card surface in lightness (lighter than the accent in light mode, darker in dark), at least MIN_SERIES_STEP OKLab
// L away from it, so no neutral is as dark (light mode) or as bright (dark mode) as the accent.
const MIN_SERIES_STEP = 0.06;
const lightness = (h) => oklab(h)[0];
test('the claimed series stands out from every neutral: each neutral sits on the surface side of the accent, clearly apart', () => {
  const close = cases().flatMap(({ name, mode, series: [accent, ...rest] }) => {
    const toSurface = mode === 'light' ? 1 : -1;
    return rest.filter((n) => (lightness(n) - lightness(accent)) * toSurface < MIN_SERIES_STEP)
      .map((n) => `${name} ${mode}: neutral ${n} L${lightness(n).toFixed(3)} vs accent ${accent} L${lightness(accent).toFixed(3)}`);
  });
  assert.deepEqual(close, []);
});

test('every step of the restrained series scale keeps 3:1 on the card surface', () => {
  const faint = cases().flatMap(({ name, mode, tokens, series }) => series.filter((c) => contrastRatio(c, tokens.surface) < MIN_MARK).map((c) => `${name} ${mode}: ${c} ${contrastRatio(c, tokens.surface).toFixed(2)}:1`));
  assert.deepEqual(faint, []);
});

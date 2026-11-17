// Theme colours -> Vega config. One pure function, used by the page runtime (html.mjs ships its
// source as window.PAVegaConfig) and by static renders in Node. It must not use anything outside itself.
// colours = { surface, text2, text3, grid, accent, cat: [8 colours], seq: [7 colours] }, font = a CSS font-family string.
export function vegaConfig(colours, font) {
  const { surface, text2: ink2, text3: ink3, grid, accent, cat, seq } = colours;
  // The neutral a claimed bar's siblings take: --text-3 mixed 80% into the surface (3:1 or more on every surface step
  // of every theme, tested). Hex in, hex out; any other colour form falls back to --text-3 itself.
  const hex = /^#[0-9a-f]{6}$/i;
  const mix = (a, b, share) => `#${[1, 3, 5].map((i) => Math.round(Number.parseInt(a.slice(i, i + 2), 16) * share + Number.parseInt(b.slice(i, i + 2), 16) * (1 - share)).toString(16).padStart(2, '0')).join('')}`;
  const neutral = hex.test(ink3 ?? '') && hex.test(surface ?? '') ? mix(ink3, surface, 0.8) : ink3;
  // The restrained series neutrals: three steps of --text-3 mixed into the surface, every one between the accent and
  // the surface in lightness (OKLab L), so the claimed series is the strongest mark (the darkest in light mode, the
  // brightest in dark). The room runs from the accent to the lightest (light) or darkest (dark) mix that keeps
  // SERIES_FLOOR contrast on the surface; the steps fill its outer share, faintest first (it sits beside the accent).
  // Without hex colours, or with no room, the scale falls back to ink, --text-3 and the neutral.
  const SERIES_FLOOR = 3.1;
  const SERIES_NEAR = 0.6; // the strongest neutral sits this share of the room away from the accent
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const rgb = (h) => [1, 3, 5].map((i) => lin(Number.parseInt(h.slice(i, i + 2), 16)));
  const okL = (h) => {
    const [r, g, b] = rgb(h);
    return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) + 0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  };
  const lum = (h) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // The share of --text-3 (0 = the surface, 1 = --text-3) where `f` first reaches `goal`, f rising with the share.
  const shareFor = (f, goal) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const k = (lo + hi) / 2; if (f(mix(ink3, surface, k)) >= goal) hi = k; else lo = k; }
    return hi;
  };
  const seriesNeutrals = () => {
    const a = accent ?? cat[0];
    if (![a, ink3, surface].every((c) => hex.test(c ?? ''))) return [ink2, ink3, neutral];
    const toSurface = okL(surface) >= okL(ink3) ? 1 : -1; // +1: light mode, the surface is lighter than the ink
    const faintest = mix(ink3, surface, shareFor((c) => ratio(c, surface), SERIES_FLOOR));
    const room = (okL(faintest) - okL(a)) * toSurface;
    if (!(room > 0)) return [ink2, ink3, neutral];
    const near = okL(a) + toSurface * SERIES_NEAR * room;
    return [0, 0.5, 1].map((t) => {
      const goal = okL(faintest) + (near - okL(faintest)) * t; // faintest first
      return t === 0 ? faintest : mix(ink3, surface, shareFor((c) => -toSurface * okL(c), -toSurface * goal));
    });
  };
  const months = "(span(domain('x')) / 2629800000)";
  const step = [1, 2, 3, 4, 6].map((k) => `${months} / ${k} <= width / 90 ? ${k} : `).join('') + '12';
  const MONTH_TICKS = `span(domain('x')) >= 7776000000 ? {interval: 'month', step: ${step}} : ceil(width / 90)`;
  return {
    background: null,
    font,
    view: { stroke: null },
    // paHighlight: [the claimed bar, the others] (views.mjs names this range for a bar chart whose title names a bar).
    // paSeries: a few series in a restrained scale, the claimed (or first) series in the accent, the rest in neutral
    // steps (seriesNeutrals; views.mjs sorts the claimed series first); every step keeps 3:1 on the surface (tested).
    range: { category: cat, ordinal: seq, ramp: seq, heatmap: seq, paHighlight: [accent ?? cat[0], neutral], paSeries: [accent ?? cat[0], ...seriesNeutrals()] },
    axis: {
      labelColor: ink3, titleColor: ink2, labelFont: font, titleFont: font,
      labelFontSize: 11, titleFontSize: 12, titleFontWeight: 'normal', labelPadding: 6,
      gridColor: grid, gridWidth: 1, domainColor: grid, tickColor: grid,
    },
    axisX: { grid: false, labelAngle: 0, labelOverlap: 'greedy' },
    // A time x axis asks for about one tick per 90 px of plot (a month label is about 55 px in the widest body face)
    // and drops a label that would come within 8 px of its neighbour, so labels never run together on a phone.
    // Over three months or more the ticks step by a fixed number of months (1, 2, 3, 4, 6 or 12: the least that keeps
    // one label per 90 px), so they fall evenly instead of where greedy overlap removal leaves them.
    axisXTemporal: { labelSeparation: 8, tickCount: { expr: MONTH_TICKS } },
    // Newsroom axes: the grid carries a value axis, so it draws no domain line and no ticks; a band axis keeps its
    // domain line as the baseline (the zero line under bars) and drops its ticks.
    axisQuantitative: { domain: false, ticks: false },
    axisBand: { ticks: false },
    legend: {
      labelColor: ink2, titleColor: ink2, labelFont: font, titleFont: font,
      labelFontSize: 12, titleFontSize: 12, titleFontWeight: 'normal', symbolType: 'circle', orient: 'top', direction: 'horizontal', padding: 0,
    },
    title: { color: ink2, font },
    bar: { cornerRadiusEnd: 2, stroke: surface, strokeWidth: 1, fill: cat[0] },
    // a single-series line, its points and an area take the theme accent (a coloured series takes its scale)
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round', stroke: accent ?? cat[0] },
    point: { size: 64, filled: true, stroke: surface, strokeWidth: 2, fill: accent ?? cat[0] },
    area: { opacity: 0.85, line: { strokeWidth: 2 }, fill: accent ?? cat[0] },
    rect: { stroke: surface, strokeWidth: 2 },
    arc: { stroke: surface, strokeWidth: 2 },
    text: { color: ink2, font, fontSize: 11 },
  };
}

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
  return {
    background: null,
    font,
    view: { stroke: null },
    // paHighlight: [the claimed bar, the others] (views.mjs names this range for a bar chart whose title names a bar).
    range: { category: cat, ordinal: seq, ramp: seq, heatmap: seq, paHighlight: [accent ?? cat[0], neutral] },
    axis: {
      labelColor: ink3, titleColor: ink2, labelFont: font, titleFont: font,
      labelFontSize: 11, titleFontSize: 12, titleFontWeight: 'normal', labelPadding: 6,
      gridColor: grid, gridWidth: 1, domainColor: grid, tickColor: grid,
    },
    axisX: { grid: false, labelAngle: 0, labelOverlap: 'greedy' },
    // A time x axis asks for about one tick per 90 px of plot (a month label is about 55 px in the widest body face)
    // and drops a label that would come within 8 px of its neighbour, so labels never run together on a phone.
    axisXTemporal: { labelSeparation: 8, tickCount: { expr: 'ceil(width / 90)' } },
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
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round', stroke: cat[0] },
    point: { size: 64, filled: true, stroke: surface, strokeWidth: 2, fill: cat[0] },
    area: { opacity: 0.85, line: { strokeWidth: 2 }, fill: cat[0] },
    rect: { stroke: surface, strokeWidth: 2 },
    arc: { stroke: surface, strokeWidth: 2 },
    text: { color: ink2, font, fontSize: 11 },
  };
}

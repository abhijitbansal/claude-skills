// Theme colours -> Vega config. One pure function, used by the page runtime (html.mjs ships its
// source as window.PAVegaConfig) and by static renders in Node. It must not use anything outside itself.
// colours = { surface, text2, text3, grid, cat: [8 colours], seq: [7 colours] }, font = a CSS font-family string.
export function vegaConfig(colours, font) {
  const { surface, text2: ink2, text3: ink3, grid, cat, seq } = colours;
  return {
    background: null,
    font,
    view: { stroke: null },
    range: { category: cat, ordinal: seq, ramp: seq, heatmap: seq },
    axis: {
      labelColor: ink3, titleColor: ink2, labelFont: font, titleFont: font,
      labelFontSize: 11, titleFontSize: 12, titleFontWeight: 'normal', labelPadding: 6,
      gridColor: grid, gridWidth: 1, domainColor: grid, tickColor: grid,
    },
    axisX: { grid: false, labelAngle: 0, labelOverlap: 'greedy' },
    legend: {
      labelColor: ink2, titleColor: ink2, labelFont: font, titleFont: font,
      labelFontSize: 12, titleFontSize: 12, titleFontWeight: 'normal', symbolType: 'circle', orient: 'top', direction: 'horizontal', padding: 0,
    },
    title: { color: ink2, font },
    bar: { cornerRadiusEnd: 4, stroke: surface, strokeWidth: 2, fill: cat[0] },
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round', stroke: cat[0] },
    point: { size: 64, filled: true, stroke: surface, strokeWidth: 2, fill: cat[0] },
    area: { opacity: 0.85, line: { strokeWidth: 2 }, fill: cat[0] },
    rect: { stroke: surface, strokeWidth: 2 },
    arc: { stroke: surface, strokeWidth: 2 },
    text: { color: ink2, font, fontSize: 11 },
  };
}

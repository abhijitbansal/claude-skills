// The chart kind's plot for its type, drawn into an area (chart-desk.mjs, chart-pop.mjs), and the band at the bottom of
// the frame its captions take (engine/captions), which a plot keeps clear of. Pure and DOM-free.
import { drawColumns, drawBars } from './chart-draw.mjs';
import { drawSeries } from './chart-series.mjs';
import { drawDonut } from './chart-donut.mjs';
import { drawScatter } from './chart-scatter.mjs';
import { drawRace } from './chart-race.mjs';

/** The plot of `shot` in `area` ({ x, y, w, h }), its marks kept `headroom` px under the area's top: { nodes, boxes, plot, highlight, times }. */
export function drawPlot(shot, ctx, style, area, { valueOnHighlight, headroom = 0 }) {
  if (shot.type === 'scatter') return drawScatter(shot, ctx, style, area, { headroom });
  if (shot.type === 'race') return drawRace(shot, ctx, style, area, { headroom });
  // a look that sets bar labels over the bars on a tall frame (style.labelsAbove) draws its columns there as such bars:
  // four columns across a phone's width cannot carry labels at the look's secondary floor
  if (shot.type === 'column' && !style.labelsAbove) return drawColumns(shot, ctx, style, area, { valueOnHighlight, headroom });
  if (shot.type === 'bar' || shot.type === 'column') return drawBars(shot, ctx, style, area, { valueOnHighlight, headroom });
  if (shot.type === 'donut') return drawDonut(shot, ctx, style, area, { valueOnHighlight });
  return drawSeries(shot, ctx, style, area, { valueOnHighlight, area: shot.type === 'area', headroom });
}

export { captionTop } from './shared.mjs'; // moved there: the clipping keeps clear of the band too

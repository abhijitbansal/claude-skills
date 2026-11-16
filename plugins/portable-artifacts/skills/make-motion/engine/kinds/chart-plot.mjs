// The chart kind's plot for its type, drawn into an area (chart-desk.mjs, chart-pop.mjs), and the band at the bottom of
// the frame its captions take (engine/captions), which a plot keeps clear of. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { compositionRect } from './shared.mjs';
import { drawColumns, drawBars } from './chart-draw.mjs';
import { drawSeries } from './chart-series.mjs';
import { drawDonut } from './chart-donut.mjs';

/** The plot of `shot` in `area` ({ x, y, w, h }), its marks kept `headroom` px under the area's top: { nodes, boxes, plot, highlight, times }. */
export function drawPlot(shot, ctx, style, area, { valueOnHighlight, headroom = 0 }) {
  if (shot.type === 'column') return drawColumns(shot, ctx, style, area, { valueOnHighlight, headroom });
  if (shot.type === 'bar') return drawBars(shot, ctx, style, area, { valueOnHighlight, headroom });
  if (shot.type === 'donut') return drawDonut(shot, ctx, style, area, { valueOnHighlight });
  return drawSeries(shot, ctx, style, area, { valueOnHighlight, area: shot.type === 'area', headroom });
}

/**
 * The top of the caption band, in px, for a composition the captions would otherwise cover; Infinity with captions off
 * or where the captions already keep out of the composition (a platform-safe composition gives the band up in kindContext).
 */
export function captionTop(ctx) {
  if (ctx.captions === false || compositionRect(ctx).safe) return Infinity; // captions off: the band is the plot's
  return registries.captions.get(ctx.look.captions).zone(ctx)[1];
}

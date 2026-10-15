// One entry point for laying out any diagram type.
import { layoutGraph } from './layout-graph.mjs';
import { layoutSequence } from './layout-sequence.mjs';
import { stretchLanes } from './lanes.mjs';

/** Lay out a validated spec: Geometry for architecture, flow and state (stacked top-level groups become lanes); SeqGeometry for sequence. */
export async function layoutDiagram(spec, theme) {
  return spec.type === 'sequence' ? layoutSequence(spec, theme) : stretchLanes(await layoutGraph(spec, theme));
}

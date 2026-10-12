// One entry point for laying out any diagram type.
import { layoutGraph } from './layout-graph.mjs';
import { layoutSequence } from './layout-sequence.mjs';

/** Lay out a validated spec: Geometry for architecture, flow and state; SeqGeometry for sequence. */
export async function layoutDiagram(spec, theme) {
  return spec.type === 'sequence' ? layoutSequence(spec, theme) : layoutGraph(spec, theme);
}

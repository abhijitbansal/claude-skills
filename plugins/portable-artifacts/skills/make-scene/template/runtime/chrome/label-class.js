// Which shared type classes a scene label carries. Pure (no DOM), so node:test can import it.
//   numbers (ticks, years, shares)  -> pa-num: tabular, lining figures, so stacked ticks line up
//   the largest size tier, when the graph uses more than one -> pa-caps: region and axis titles in the shared caps style
//   everything else                 -> plain
const NUMERIC = /^[\p{Sc}+\-−]?\d[\d.,:/\-\s]*[%kKMBT]?$/u;

/** One class string per label, in order. */
export function labelClasses(labels) {
  const largest = Math.max(...labels.map((l) => l.size));
  const tiered = labels.some((l) => l.size !== largest);
  return labels.map((l) => {
    if (NUMERIC.test(l.text.trim())) return 'sc-label pa-num';
    return tiered && l.size === largest ? 'sc-label pa-caps' : 'sc-label';
  });
}

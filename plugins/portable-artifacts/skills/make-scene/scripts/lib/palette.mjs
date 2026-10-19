// Group colours and the row helpers every data world shares: group order,
// t order and the items[] table. Item i is always row i of the input.
import { InternalError } from './internal-error.mjs';

const CATEGORICAL = 8;
const STEP_SHARE = 0.6;
const LIGHTER_BASE = '#ffffff'; // groups 8-15
const DARKER_BASE = '#000000'; // groups 16-23
// 20 is more fraction digits than any double needs: the display is the exact value.
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });

/** Groups 0-7 take cat1..cat8; 8-15 repeat them mixed toward white, 16-23 toward black. */
export function groupColour(i) {
  if (!Number.isInteger(i) || i < 0) throw new InternalError(`group index must be a non-negative integer, got ${i}`);
  if (i < CATEGORICAL) return `cat${i + 1}`;
  return { base: i < 2 * CATEGORICAL ? LIGHTER_BASE : DARKER_BASE, tint: `cat${(i % CATEGORICAL) + 1}`, share: STEP_SHARE };
}

/** Numbers first (numerically), then strings, then rows without t. Stable and locale-free. */
export function compareT(a, b) {
  if (a === undefined || b === undefined) return (a === undefined) - (b === undefined);
  const an = typeof a === 'number';
  const bn = typeof b === 'number';
  if (an !== bn) return an ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Group name -> index, in order of first appearance. */
export function groupIndex(rows) {
  const index = new Map();
  for (const r of rows) if (!index.has(r.group)) index.set(r.group, index.size);
  return index;
}

/** groups[] for the graph: { name, colour } in order of first appearance. */
export function groupsFrom(rows) {
  return [...groupIndex(rows).keys()].map((name, i) => ({ name, colour: groupColour(i) }));
}

/** items[]: item i is rows[i]. display is "<value> <units>" with en-US digit grouping. */
export function itemsFrom(rows, units) {
  const index = groupIndex(rows);
  return rows.map((r, i) => {
    const shown = NUMBER_FORMAT.format(r.value);
    const item = {
      id: `i${i}`,
      label: typeof r.label === 'string' && r.label !== '' ? r.label : r.t === undefined ? r.group : `${r.group} · ${r.t}`,
      group: index.get(r.group),
      value: r.value,
      display: units ? `${shown} ${units}` : shown,
    };
    if (r.t !== undefined) item.t = String(r.t);
    return item;
  });
}

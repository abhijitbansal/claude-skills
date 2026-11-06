// Shared by tests that push the sketch blocks to their limits (not a test file). The generic table in blocks.test.mjs cannot make
// these: a diagram's edges must name its nodes, node ids must differ and icons must be real Lucide names, so the longest and the
// smallest params of each sketch block are written out here. Every value is valid: it passes the schema and the block's own checks.
import { BLOCKS } from '../../template/blocks/index.mjs';

export const SKETCH_NAMES = Object.freeze(['sketch-diagram', 'sketch-steps', 'sketch-list', 'sketch-compare', 'sketch-callout']);

const PROSE = 'Every release ships faster when the builds stay local and the checks run before review starts';
const prose = (n, from = 0) => PROSE.repeat(Math.ceil((n + from) / PROSE.length) + 1).slice(from, from + n).trimEnd();
const ICONS = ['server', 'database', 'monitor', 'cloud', 'lock', 'globe', 'cpu', 'shield'];

const nodes = (count, length) => Array.from({ length: count }, (_, i) => ({ id: `n${i + 1}`, label: prose(length, i * 7), icon: ICONS[i % ICONS.length], ...(i % 2 ? { fill: true } : {}) }));
const chain = (count, length) => Array.from({ length: count - 1 }, (_, i) => ({ from: `n${i + 1}`, to: `n${i + 2}`, label: prose(length, i * 5 + 3) }));
const side = (seed) => ({ title: prose(24, seed), points: Array.from({ length: 5 }, (_, i) => prose(28, seed + i * 9)) });

// The most every param allows: 8 nodes of 24 characters joined by 11 edges (7 in a chain, 4 that skip nodes or run back).
const LONGEST = Object.freeze({
  'sketch-diagram': {
    nodes: nodes(8, 24),
    edges: [...chain(8, 16), { from: 'n1', to: 'n3', label: prose(16, 40) }, { from: 'n8', to: 'n1', label: prose(16, 44) }, { from: 'n2', to: 'n6' }, { from: 'n5', to: 'n3', label: prose(16, 12) }],
  },
  'sketch-steps': { steps: Array.from({ length: 6 }, (_, i) => prose(32, i * 11)) },
  'sketch-list': { title: prose(40), items: Array.from({ length: 6 }, (_, i) => ({ text: prose(40, i * 13), icon: ICONS[i] })) },
  'sketch-compare': { left: side(0), right: side(30) },
  'sketch-callout': { text: prose(40), icon: 'lightbulb' },
});

// The least every param needs.
const SMALLEST = Object.freeze({
  'sketch-diagram': { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [] },
  'sketch-steps': { steps: ['A', 'B'] },
  'sketch-list': { items: [{ text: 'A' }, { text: 'B' }] },
  'sketch-compare': { left: { title: 'A', points: ['x'] }, right: { title: 'B', points: ['y'] } },
  'sketch-callout': { text: 'A' },
});

// The enum params, first value then last: so `first` and `last` push a different branch of the layout each.
const FIRST = Object.freeze({ 'sketch-diagram': { layout: 'row' }, 'sketch-callout': { mark: 'underline' } });
const LAST = Object.freeze({ 'sketch-diagram': { layout: 'grid' }, 'sketch-callout': { mark: 'circle' } });

/** { example, first, last, small } for a sketch block, as blocks.test.mjs's `extremes` gives for any other: the longest params with each end of the enums, and the smallest. */
export function sketchExtremes(name) {
  return { example: BLOCKS[name].example, first: { ...LONGEST[name], ...FIRST[name] }, last: { ...LONGEST[name], ...LAST[name] }, small: { ...SMALLEST[name] } };
}

export const longestParams = (name, extra = {}) => ({ ...LONGEST[name], ...extra });

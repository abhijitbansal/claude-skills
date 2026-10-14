// The rules for every class the renderers emit. Colours and fonts are theme
// variables (--surface, --line, --text, --font, --k-<family>, ...), so one
// stylesheet serves light, dark and every theme. Text sizes come from
// sizes.mjs, which measured the text with them.
import { LABEL_SIZE, NOTE_SIZE, TYPE_SIZE, EDGE_LABEL_SIZE, GROUP_LABEL_SIZE, EMOJI_SIZE } from './sizes.mjs';
import { FAMILIES } from './kinds.mjs';

const TONES = { accent: 'accent', good: 'good', warn: 'warn', bad: 'bad' };
const EMOJI_FONTS = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const CARD_TINT = 10; // % of the kind hue in a card's fill; shared/contrast.mjs TINT gates the hue as text on it
const TILE_TINT = 18; // the tile is a stronger tint of the same hue

// Every color-mix() here wraps var(), so an engine without it still accepts the declaration at parse time, fails it at
// computed-value time and draws the property's initial value (black). An earlier plain declaration cannot save that, so
// each color-mix() rule sits in an @supports block, which such an engine skips whole, and a plain rule before it (same
// selector, same specificity) holds the colour. context-stroke has no var(): an engine without it drops the declaration
// at parse time and keeps the plain one directly before it.
const supportsMix = (rs) => `@supports (color: color-mix(in srgb, red, red)){${rs.join('')}}`;

const rules = [
  // frame
  '.pa-diagram{display:block;font-family:var(--font);font-size:14px;color:var(--text)}',
  // groups: a lane with a coloured bar (top-level) or a nested box; labels in spaced capitals
  '.pa-group-box{fill:var(--surface);stroke:var(--line);stroke-width:1}',
  supportsMix(['.pa-group-box{fill:color-mix(in srgb,var(--text-3) 7%,transparent)}']),
  '.pa-lane{stroke:none}',
  `.pa-group-label{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}`,
  // edges: one path.pa-wire per edge; the arrow heads take the wire's stroke (a plain declaration precedes context-stroke)
  '.pa-wire{fill:none;stroke:var(--text-3);stroke-width:1.25;stroke-linejoin:round}',
  '.pa-edge-dashed .pa-wire{stroke-dasharray:6 4}',
  '.pa-edge-async .pa-wire{stroke-dasharray:1.5 4;stroke-linecap:round}',
  '.pa-hit{fill:none;stroke:transparent;stroke-width:12px;vector-effect:non-scaling-stroke;pointer-events:stroke}', // the viewer's invisible mouse target along a wire
  '.pa-arrow-fill{fill:var(--text-3);fill:context-stroke;stroke:none}',
  '.pa-arrow-open{fill:none;stroke:var(--text-3);stroke:context-stroke;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-edge-plate{fill:var(--surface);stroke:var(--line);stroke-width:1}', // a pill: surface fill (the export and make-explainer draw on the surface), hairline border
  `.pa-edge-text{fill:var(--text-2);font-size:${EDGE_LABEL_SIZE}px;font-weight:400}`,
  // nodes: a card tinted by its kind family (familyRules below); the shape still encodes the kind
  '.pa-node{outline:none}',
  '.pa-shape{fill:var(--surface);stroke:var(--line);stroke-width:1.5}',
  '.pa-decor{fill:none;stroke:var(--line);stroke-width:1}',
  '.pa-kind-external .pa-shape{stroke-dasharray:5 4}',
  '.pa-tile{stroke:none}',
  `.pa-emoji{font-family:${EMOJI_FONTS};font-size:${EMOJI_SIZE}px}`,
  `.pa-type{font-size:${TYPE_SIZE}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}`,
  `.pa-label{fill:var(--text);font-size:${LABEL_SIZE}px;font-weight:600}`,
  `.pa-note{fill:var(--text-2);font-family:var(--mono);font-size:${NOTE_SIZE}px;font-weight:400}`,
  '.pa-icon{color:var(--text-2)}',
  '.pa-icon-lucide{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-icon-brand{fill:currentColor;stroke:none}',
  '.pa-node:focus-visible .pa-shape{stroke:var(--accent);stroke-width:2}',
  // sequence
  '.pa-lifeline{stroke:var(--text-3);stroke-width:1;stroke-dasharray:4 4;stroke-opacity:.6}',
  '.pa-frame-box{fill:none;stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  '.pa-frame-tab{fill:var(--surface);stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  // the tab's kind word is measured with f.group and a note's lines with f.note (layout-sequence.mjs): drawn at the same sizes
  `.pa-frame-kind{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600}`,
  `.pa-frame-label{fill:var(--text-2);font-size:${EDGE_LABEL_SIZE}px;font-weight:400}`,
  '.pa-seq-note-box{fill:var(--surface);stroke:var(--text-3);stroke-width:1}',
  `.pa-seq-note-text{fill:var(--text-2);font-family:var(--mono);font-size:${NOTE_SIZE}px;font-weight:400}`,
];

// One hue per family: the card's fill is a tint of it; the border, the tile,
// the icon, the type line and the wires leaving the node take it. A bare shape
// (dots, pills) keeps the neutral card.
const familyRules = FAMILIES.flatMap((f) => {
  const hue = `var(--k-${f})`;
  return [
    `.pa-family-${f} .pa-shape{fill:var(--surface);stroke:${hue}}`,
    `.pa-family-${f} .pa-decor{stroke:${hue}}`,
    `.pa-family-${f} .pa-tile{fill:var(--surface)}`,
    `.pa-family-${f} .pa-icon{color:${hue}}`,
    `.pa-family-${f} .pa-type{fill:${hue}}`,
    `.pa-edge[data-family="${f}"] .pa-wire{stroke:${hue}}`,
  ];
}).concat(['.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}', supportsMix(FAMILIES.flatMap((f) => [
  `.pa-family-${f} .pa-shape{fill:color-mix(in srgb,var(--k-${f}) ${CARD_TINT}%,var(--surface))}`,
  `.pa-family-${f} .pa-tile{fill:color-mix(in srgb,var(--k-${f}) ${TILE_TINT}%,var(--surface))}`,
]))]);

// Dots and the small diamond are drawn as marks, not cards: after the family
// rules (same specificity), so a bare family cannot wash them out.
const markRules = [
  '.pa-node .pa-shape-filled-dot{fill:var(--text-2);stroke:var(--text-2)}',
  '.pa-node .pa-shape-ringed-dot{stroke:var(--text-2);stroke-width:1.5}',
  '.pa-node .pa-decor-dot{fill:var(--text-2);stroke:none}',
  '.pa-node .pa-shape-small-diamond{stroke-width:1.25}',
];

// A tone colours the border (2 px), the filled dot, the icon and the type line,
// over the family hue (these rules come later, so they win at equal specificity).
const toneRules = Object.entries(TONES).flatMap(([tone, variable]) => [
  `.pa-tone-${tone} .pa-shape{stroke:var(--${variable});stroke-width:2}`,
  `.pa-tone-${tone} .pa-shape-filled-dot{fill:var(--${variable})}`,
  `.pa-tone-${tone} .pa-icon{color:var(--${variable})}`,
  `.pa-tone-${tone} .pa-type{fill:var(--${variable})}`,
]);

// Viewer state, set by the runtime: dim what a trace or a beat leaves out, hide
// what a presentation has not revealed yet (visibility, not display: hidden
// elements still measure), emphasise what a step highlights, a trace follows,
// a beat travels (pa-active) or Explore selected or routed. Every lit edge is
// thicker as well as recoloured.
const state = [
  '.pa-dim{opacity:.25}',
  '.pa-hidden{opacity:0;visibility:hidden}',
  '.pa-hl .pa-shape,.pa-on .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-hl > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-hl .pa-wire,.pa-edge.pa-on .pa-wire{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-active .pa-wire{stroke:var(--accent);stroke-width:3}',
  '.pa-selected .pa-shape{stroke:var(--accent);stroke-width:2.5}',
  '.pa-selected > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-selected .pa-wire{stroke:var(--accent);stroke-width:2.5}',
  '.pa-route .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-route > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-route .pa-wire{stroke:var(--accent);stroke-width:2.5}',
  '.pa-dot{fill:var(--accent);stroke:none;pointer-events:none;visibility:hidden}',
  '.pa-dot.pa-dot-on{visibility:visible}',
];

// Flow animation moves the dashes along a wire and keeps each style's own
// pattern: only stroke-dashoffset animates. A solid wire has no pattern, so it
// gets one while animating. --pa-period is the pattern's length, so the loop
// restarts on a whole period instead of jumping.
const animation = [
  '@media (prefers-reduced-motion: no-preference){',
  '.pa-edge-solid .pa-wire{--pa-period:12px}',
  '.pa-edge-dashed .pa-wire{--pa-period:10px}',
  '.pa-edge-async .pa-wire{--pa-period:5.5px}',
  '.pa-animate .pa-edge.pa-edge-solid .pa-wire{stroke-dasharray:6 6}',
  '.pa-animate .pa-edge .pa-wire{animation:pa-flow 1.2s linear infinite}',
  '@keyframes pa-flow{to{stroke-dashoffset:calc(var(--pa-period) * -1)}}',
  '.pa-node,.pa-edge,.pa-edge-label,.pa-group,.pa-lifeline,.pa-frame,.pa-seq-note{transition:opacity .2s cubic-bezier(.23,1,.32,1),visibility .2s}',
  '}',
];

// Lane bars cycle the categorical colours; the legend's swatches share the card tints.
const laneRules = Array.from({ length: 8 }, (_, i) => `.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`);
const legendRules = [
  '.pa-legend-text{fill:var(--text-2);font-size:11px}',
  '.pa-swatch{stroke-width:1}',
  ...FAMILIES.map((f) => `.pa-swatch.pa-family-${f}{fill:var(--surface);stroke:var(--k-${f})}`),
  '.pa-swatch.pa-family-bare{fill:var(--surface);stroke:var(--line)}',
  supportsMix(FAMILIES.map((f) => `.pa-swatch.pa-family-${f}{fill:color-mix(in srgb,var(--k-${f}) ${CARD_TINT}%,var(--surface))}`)),
  '.pa-legend-sample .pa-wire{stroke-width:1.5}',
];

// Dark mode: the glow. The active edge and the dot glow in the theme's --glow
// through a CSS drop-shadow (no <filter> in <defs>: a page-wide stylesheet
// cannot name a per-diagram id, and a missing filter target hides its element);
// the lanes' fill reads a little stronger on a dark page. Light mode is the
// default above: a thicker active edge instead of a glow. The two selector
// forms mirror shared/theme.mjs: the OS scheme unless the page pins light, or
// an explicit data-theme="dark".
const DARK = [
  '.pa-edge.pa-active .pa-wire{stroke-width:2.5;filter:drop-shadow(0 0 6px var(--glow))}',
  '.pa-dot{fill:var(--glow);filter:drop-shadow(0 0 6px var(--glow))}',
];
const DARK_MIX = ['.pa-group-box{fill:color-mix(in srgb,var(--text-3) 12%,transparent)}'];
const dark = [
  `@media (prefers-color-scheme: dark){${DARK.map((r) => `:root:not([data-theme="light"]) ${r}`).join('')}${supportsMix(DARK_MIX.map((r) => `:root:not([data-theme="light"]) ${r}`))}}`,
  ...DARK.map((r) => `:root[data-theme="dark"] ${r}`),
  supportsMix(DARK_MIX.map((r) => `:root[data-theme="dark"] ${r}`)),
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...familyRules, ...markRules, ...toneRules, ...laneRules, ...legendRules, ...state, ...animation, ...dark].join('\n');
}

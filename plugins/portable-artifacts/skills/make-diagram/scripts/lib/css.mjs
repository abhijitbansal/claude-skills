// The rules for every class the renderers emit. Colours and fonts are theme
// variables (--surface, --line, --text, --font, --k-<family>, ...), so one
// stylesheet serves light, dark and every theme. Text sizes come from
// sizes.mjs, which measured the text with them.
import { LABEL_SIZE, NOTE_SIZE, TYPE_SIZE, EDGE_LABEL_SIZE, GROUP_LABEL_SIZE, EMOJI_SIZE } from './sizes.mjs';
import { FAMILIES } from './kinds.mjs';

const TONES = { accent: 'accent', good: 'good', warn: 'warn', bad: 'bad' };
const EMOJI_FONTS = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const CARD_TINT = 10; // % tint shared/contrast.mjs TINT still gates the kind hue on (no card or swatch is tinted now; kept for that gate)
const TILE_TINT = 28; // the tile is a stronger tint of the same hue: it carries each theme's kind palette
const GROUP_TINT = 7; // light: --text-3 into the card surface, for a group box
const LANE_TINT = 45; // a lane bar: its series colour into the surface, so the bar is no louder than the cards
const PLATE_TINT = 38; // dark: --text-3 into the surface, for an edge label plate (one pill on the page, a group, a nested group)

// Every color-mix() here wraps var(), so an engine without it still accepts the declaration at parse time, fails it at
// computed-value time and draws the property's initial value (black). An earlier plain declaration cannot save that, so
// each color-mix() rule sits in an @supports block, which such an engine skips whole, and a plain rule before it (same
// selector, same specificity) holds the colour. context-stroke has no var(): an engine without it drops the declaration
// at parse time and keeps the plain one directly before it.
const supportsMix = (rs) => `@supports (color: color-mix(in srgb, red, red)){${rs.join('')}}`;

const rules = [
  // frame
  '.pa-diagram{display:block;font-family:var(--font);font-size:14px;font-variant-numeric:normal;color:var(--text)}',
  // groups: a lane with a coloured bar (top-level) or a nested box; labels in spaced capitals. In light the box is a
  // step below the card surface (not the page: press's surface is darker than its page, so a page tint matched the
  // cards), and a nested box one step further; dark mixes over the page below (the dark block).
  '.pa-group-box{fill:var(--surface);stroke:var(--line);stroke-width:1}',
  supportsMix([`.pa-group-box{fill:color-mix(in srgb,var(--text-3) ${GROUP_TINT}%,var(--surface))}`, `:where(.pa-group:not([data-depth="0"])) > .pa-group-box{fill:color-mix(in srgb,var(--text-3) ${2 * GROUP_TINT}%,var(--surface))}`]),
  '.pa-lane{stroke:none}',
  `.pa-group-label{fill:var(--text-2);font-size:${GROUP_LABEL_SIZE}px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}`,
  // edges: one path.pa-wire per edge; the arrow heads take the wire's stroke (a plain declaration precedes context-stroke)
  // Every wire keeps its width on screen (a zoomed-out view thinned them to under 1 px, under 3:1). A call (solid) is
  // the heaviest; a return, reply or event (dashed, dotted) is thinner, told apart by its pattern, never heavier.
  '.pa-wire{fill:none;stroke:var(--text-3);stroke-width:1.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}',
  '.pa-edge-dashed .pa-wire{stroke-width:1.25;stroke-dasharray:6 4}',
  '.pa-edge-async .pa-wire{stroke-width:1.25;stroke-dasharray:1 4.5;stroke-linecap:round}',
  '.pa-hit{fill:none;stroke:transparent;stroke-width:12px;vector-effect:non-scaling-stroke;pointer-events:visibleStroke}', // the viewer's invisible mouse target along a wire; visibleStroke so a hidden edge catches nothing
  '.pa-arrow-fill{fill:var(--text-3);fill:context-stroke;stroke:none}',
  '.pa-arrow-open{fill:none;stroke:var(--text-3);stroke:context-stroke;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-edge-plate{fill:var(--surface);stroke:none}', // a plate: surface fill (the export and make-explainer draw on the surface), no border
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

// One hue per family, carried by the tile (a tint of it), the icon and the type
// line. The card itself is the surface with a hairline, lifted off the page, so
// no card outshouts another; wires stay one quiet colour until hover, trace or
// a story beat lights them. A bare shape (dots, pills) keeps the flat neutral card.
const familyRules = FAMILIES.flatMap((f) => {
  const hue = `var(--k-${f})`;
  return [
    `.pa-family-${f} .pa-shape{fill:var(--surface);stroke:var(--line)}`,
    `.pa-family-${f} .pa-tile{fill:var(--surface)}`,
    `.pa-family-${f} .pa-icon{color:${hue}}`,
    `.pa-family-${f} .pa-type{fill:${hue}}`,
  ];
}).concat(['.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}', supportsMix(FAMILIES.map((f) => (
  `.pa-family-${f} .pa-tile{fill:color-mix(in srgb,var(--k-${f}) ${TILE_TINT}%,var(--surface))}`
)))]);

// Outlines: one neutral rule, never a kind hue. Dark mode: the hairline is too faint for a card edge, so cards take
// --text-3 (the :where() keeps the specificity at a family rule's, so tone and state rules, which come later, still
// win). A decision or choice diamond is a shape, not a card, and the external card is told apart by its dash: on a
// light page a hairline hid both, so they take --text-3 in every mode and every diagram type.
const outlineRules = [
  '@media (prefers-color-scheme: dark){:where(:root:not([data-theme="light"])) .pa-node .pa-shape{stroke:var(--text-3)}}',
  ':where(:root[data-theme="dark"]) .pa-node .pa-shape{stroke:var(--text-3)}',
  '.pa-node .pa-shape-diamond,.pa-node .pa-shape-small-diamond{stroke:var(--text-3)}',
  '.pa-kind-external .pa-shape{stroke:var(--text-3)}',
];

// Card lift: box-shadow does not reach SVG shapes, so a drop-shadow mixed from the theme's elevation colour
// (--shadow, as --elev-1 is); a plain rgba rule first for an engine without color-mix(). Print stays flat.
const LIFT = '0 1px 2px';
const liftRules = [
  `.pa-node:not(.pa-family-bare) .pa-shape{filter:drop-shadow(${LIFT} rgba(0,0,0,.08))}`,
  supportsMix([`.pa-node:not(.pa-family-bare) .pa-shape{filter:drop-shadow(${LIFT} color-mix(in srgb,var(--shadow) 14%,transparent))}`]),
  '@media print{.pa-shape{filter:none}}',
];

// Dots and the small diamond are drawn as marks, not cards: after the family
// rules (same specificity), so a bare family cannot wash them out.
const markRules = [
  '.pa-node .pa-shape-filled-dot{fill:var(--text-2);stroke:var(--text-2)}',
  '.pa-node .pa-shape-ringed-dot{stroke:var(--text-2);stroke-width:1.5}',
  '.pa-node .pa-decor-dot{fill:var(--text-2);stroke:none}',
  '.pa-node .pa-shape-small-diamond{stroke-width:1.25}',
];

// A tone colours the border (2 px), the filled dot and the icon, over the family
// hue (these rules come later, so they win at equal specificity). The kind label
// keeps its family hue: that is the colour checkTheme gates against the card tint.
// Its legend key (legend.mjs) is a neutral card swatch with the same border.
const toneRules = Object.entries(TONES).flatMap(([tone, variable]) => [
  `.pa-tone-${tone} .pa-shape{stroke:var(--${variable});stroke-width:2}`,
  `.pa-tone-${tone} .pa-shape-filled-dot{fill:var(--${variable})}`,
  `.pa-tone-${tone} .pa-icon{color:var(--${variable})}`,
  `.pa-swatch.pa-tone-${tone}{stroke:var(--${variable});stroke-width:2}`,
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

// Lane bars cycle the categorical colours. Legend swatches are drawn as their nodes are (legend.mjs): a neutral card
// with the kind hue as a small mark (the tile and icon carry it on a card), a dashed card for external, a bare
// neutral diamond for a decision or choice, dots for start and end; outlines follow the card rule, dark included.
const laneRules = [
  ...Array.from({ length: 8 }, (_, i) => `.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`),
  supportsMix(Array.from({ length: 8 }, (_, i) => `.pa-group[data-lane="${i}"] .pa-lane{fill:color-mix(in srgb,var(--s${i + 1}) ${LANE_TINT}%,var(--surface))}`)),
];
const legendRules = [
  '.pa-legend-text{fill:var(--text-2);font-size:11px}',
  '.pa-swatch{fill:var(--surface);stroke:var(--line);stroke-width:1}',
  '@media (prefers-color-scheme: dark){:where(:root:not([data-theme="light"])) .pa-swatch{stroke:var(--text-3)}}',
  ':where(:root[data-theme="dark"]) .pa-swatch{stroke:var(--text-3)}',
  ...FAMILIES.map((f) => `.pa-swatch-mark.pa-family-${f}{fill:var(--k-${f})}`),
  '.pa-swatch.pa-family-external{stroke:var(--text-3);stroke-dasharray:3 2}',
  '.pa-swatch-diamond{stroke:var(--text-3)}',
  '.pa-swatch-stadium{stroke:var(--text-3)}',
  '.pa-swatch-filled-dot{fill:var(--text-2);stroke:none}',
  '.pa-swatch-ringed-dot{fill:var(--surface);stroke:var(--text-2);stroke-width:1.5}',
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
const DARK_MIX = ['.pa-group-box{fill:color-mix(in srgb,var(--text-3) 12%,transparent)}', `.pa-edge-plate{fill:color-mix(in srgb,var(--text-3) ${PLATE_TINT}%,var(--surface))}`];
const dark = [
  `@media (prefers-color-scheme: dark){${DARK.map((r) => `:root:not([data-theme="light"]) ${r}`).join('')}${supportsMix(DARK_MIX.map((r) => `:root:not([data-theme="light"]) ${r}`))}}`,
  ...DARK.map((r) => `:root[data-theme="dark"] ${r}`),
  supportsMix(DARK_MIX.map((r) => `:root[data-theme="dark"] ${r}`)),
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...familyRules, ...outlineRules, ...liftRules, ...markRules, ...toneRules, ...laneRules, ...legendRules, ...state, ...animation, ...dark].join('\n');
}

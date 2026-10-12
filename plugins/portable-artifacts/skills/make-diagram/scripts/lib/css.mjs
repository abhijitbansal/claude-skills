// The rules for every class the renderers emit. Colours and fonts are theme
// variables (--surface, --line, --text, --font, ...), so one stylesheet serves
// light, dark and every theme.
const TONES = { accent: 'accent', good: 'good', warn: 'warn', bad: 'bad' };

const rules = [
  // frame
  '.pa-diagram{display:block;font-family:var(--font);font-size:14px;color:var(--text)}',
  // groups
  '.pa-group-box{fill:var(--page);stroke:var(--line);stroke-width:1}',
  '.pa-group-label{fill:var(--text-2);font-size:12px;font-weight:600}',
  // edges
  '.pa-edge path{fill:none;stroke:var(--text-3);stroke-width:1.25;stroke-linejoin:round}',
  '.pa-edge-dashed path{stroke-dasharray:6 4}',
  '.pa-edge-async path{stroke-dasharray:1.5 4;stroke-linecap:round}',
  '.pa-arrow-fill{fill:var(--text-3);stroke:none}',
  '.pa-arrow-open{fill:none;stroke:var(--text-3);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-edge-plate{fill:var(--surface)}',
  '.pa-edge-text{fill:var(--text-2);font-size:12px;font-weight:400}',
  // nodes: hairline border, surface fill; shape encodes the kind
  '.pa-node{outline:none}',
  '.pa-shape{fill:var(--surface);stroke:var(--line);stroke-width:1}',
  '.pa-decor{fill:none;stroke:var(--line);stroke-width:1}',
  '.pa-kind-external .pa-shape{stroke-dasharray:5 4}',
  '.pa-shape-filled-dot{fill:var(--text-2);stroke:var(--text-2)}',
  '.pa-shape-ringed-dot{stroke:var(--text-2);stroke-width:1.5}',
  '.pa-decor-dot{fill:var(--text-2);stroke:none}',
  '.pa-shape-small-diamond{stroke:var(--text-2);stroke-width:1.25}',
  '.pa-label{fill:var(--text);font-size:14px;font-weight:600}',
  '.pa-note{fill:var(--text-3);font-size:12px;font-weight:400}',
  '.pa-icon{color:var(--text-2)}',
  '.pa-icon-lucide{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.pa-icon-brand{fill:currentColor;stroke:none}',
  '.pa-node:focus-visible .pa-shape{stroke:var(--accent);stroke-width:2}',
  // sequence
  '.pa-lifeline{stroke:var(--text-3);stroke-width:1;stroke-dasharray:4 4;stroke-opacity:.6}',
  '.pa-frame-box{fill:none;stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  '.pa-frame-tab{fill:var(--surface);stroke:var(--text-3);stroke-width:1;stroke-opacity:.7}',
  '.pa-frame-kind{fill:var(--text-2);font-size:12px;font-weight:600}',
  '.pa-frame-label{fill:var(--text-2);font-size:12px;font-weight:400}',
  '.pa-seq-note-box{fill:var(--surface);stroke:var(--text-3);stroke-width:1}',
  '.pa-seq-note-text{fill:var(--text-2);font-size:12px;font-weight:400}',
];

// A tone colours only the border (1.5 px) and the icon.
const toneRules = Object.entries(TONES).flatMap(([tone, variable]) => [
  `.pa-tone-${tone} .pa-shape{stroke:var(--${variable});stroke-width:1.5}`,
  `.pa-tone-${tone} .pa-shape-filled-dot{fill:var(--${variable})}`,
  `.pa-tone-${tone} .pa-icon{color:var(--${variable})}`,
]);

// Viewer state, set by the runtime: dim what a trace leaves out, hide what a
// presentation has not revealed yet (visibility, not display: hidden elements
// still measure), emphasise what a step highlights or a trace follows.
const state = [
  '.pa-dim{opacity:.22}',
  '.pa-hidden{opacity:0;visibility:hidden}',
  '.pa-hl .pa-shape,.pa-on .pa-shape{stroke:var(--accent);stroke-width:2}',
  '.pa-hl > .pa-group-box{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-hl path,.pa-edge.pa-on path{stroke:var(--accent);stroke-width:2}',
  '.pa-edge.pa-hl .pa-arrow-fill,.pa-edge.pa-on .pa-arrow-fill{fill:var(--accent)}',
];

// Flow animation moves the dashes along an edge and keeps each style's own
// pattern: only stroke-dashoffset animates. A solid edge has no pattern, so it
// gets one while animating. --pa-period is the pattern's length, so the loop
// restarts on a whole period instead of jumping.
const animation = [
  '@media (prefers-reduced-motion: no-preference){',
  '.pa-edge-solid path{--pa-period:12px}',
  '.pa-edge-dashed path{--pa-period:10px}',
  '.pa-edge-async path{--pa-period:5.5px}',
  '.pa-animate .pa-edge-solid path{stroke-dasharray:6 6}',
  '.pa-animate .pa-edge path{animation:pa-flow 1.2s linear infinite}',
  '@keyframes pa-flow{to{stroke-dashoffset:calc(var(--pa-period) * -1)}}',
  '.pa-node,.pa-edge,.pa-edge-label,.pa-group,.pa-lifeline,.pa-frame,.pa-seq-note{transition:opacity .25s ease,visibility .25s}',
  '}',
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...toneRules, ...state, ...animation].join('\n');
}

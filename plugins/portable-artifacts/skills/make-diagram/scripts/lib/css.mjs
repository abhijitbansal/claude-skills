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

const animation = [
  '@media (prefers-reduced-motion: no-preference){',
  '.pa-animate .pa-edge path{stroke-dasharray:6 6;animation:pa-flow 1.2s linear infinite}',
  '@keyframes pa-flow{to{stroke-dashoffset:-12}}',
  '}',
];

/** The stylesheet for rendered diagrams. */
export function diagramCss() {
  return [...rules, ...toneRules, ...animation].join('\n');
}

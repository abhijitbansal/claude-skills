// The `pop` look: short-form caption collage, the default look of mode `viral`. Near-black field, one heavy
// extra-condensed grotesque in caps, an acid accent, springy pops. Plain data plus one pure function; index.mjs
// freezes and registers it. Width is a CSS font-stretch keyword because canvas reaches Archivo's width axis only
// in keyword steps (engine/fonts/CANVAS-NOTES.md).
const DISPLAY_TRACKING = -0.02; // em, at every size
const LABEL_TRACKING = 0.06; // em: caps labels are tracked out
const ROLES = ['display', 'text', 'label'];

// tracking(sizeUnits, role = 'display') -> em
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return DISPLAY_TRACKING;
  if (role === 'text') return 0;
  if (role === 'label') return LABEL_TRACKING;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const pop = {
  name: 'pop',
  modes: ['viral'],
  fonts: {
    display: { family: 'Archivo', weight: 900, width: 'extra-condensed' },
    text: { family: 'Archivo', weight: 700, width: 'condensed' },
    label: { family: 'Archivo', weight: 700, width: 'normal' },
  },
  palette: { paper: '#111111', ink: '#ffffff', ink2: '#b8b8b8', accent: '#d7ff3f', accent2: '#ff4d2e', rule: '#2a2a2a' },
  scale: [36, 56, 96, 180, 320],
  grid: { columns: 12, margin: 72, gutter: 20 },
  tracking,
  caps: { display: true, label: true },
  lineHeight: { display: 0.92, text: 1.15 },
  maxLines: { display: 3, text: 3 },
  wordsPerLine: { text: 12 },
  // Halftone dots in the palette's `rule` grey over the flat paper: texture without touching ink contrast.
  field: { field: 'halftone', params: { color: 'rule', strength: 1 } },
  emphasis: 'recolor-scale',
  moves: {
    enter: { ease: 'spring(260,16)', dur: 0.28, scale: 0.6 },
    exit: { ease: 'inCubic', dur: 0.15 },
    emphasize: { ease: 'spring(300,12)', dur: 0.2, scale: 1.12 },
    draw: { ease: 'outExpo', dur: 0.2 },
    count: { ease: 'outExpo', dur: 0.6 },
  },
  wordStagger: 0,
  camera: { drift: 0, style: 'locked' },
  cuts: ['cut', 'punch', 'slide'],
  keyline: 14,
  shadow: { dx: 10, dy: 10, blur: 0, alpha: 1, color: '#ff4d2e' },
  // Styling for the devices this look draws. Colours are palette keys (or #rrggbb), sizes are units.
  devices: {
    sticker: { outline: 'ink', width: 10, rotate: 4 },
    punch: { scale: 1.08, dur: 0.12 },
    numeral: { color: 'accent' },
    arrow: { color: 'accent', width: 14 },
    underline: { color: 'accent2', width: 10 },
    card: { fill: 'ink', edge: 'plain' },
    tag: { fill: 'accent', text: 'paper' },
    cutout: { keylineColor: '#ffffff' },
  },
  post: { grain: 0.03, halftone: 0.2, bloom: 0 },
};

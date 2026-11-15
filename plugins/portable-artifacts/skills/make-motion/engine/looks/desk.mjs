// The `desk` look: editorial paper collage, the default look of mode `pro`. Warm paper, a display serif, a
// highlighter, hand marks that step at 12 fps. Plain data plus one pure function; index.mjs freezes and registers it.
// Type decisions (rendered specimens): Fraunces is used as the base family with no pinned optical size, so canvas
// picks `opsz` from the pixel size (high-contrast cut at headline sizes, sturdy cut at small sizes). The derived
// Fraunces Display / Text / Soft families are not used here.
const DISPLAY_TIGHT_FROM = 132; // units: display type at or above this size is tracked in
const DISPLAY_TIGHT = -0.01; // em
const LABEL_TRACKING = 0.08; // em: caps labels are tracked out
const HAND_STEP = 12; // fps: hand marks and the highlighter step "on twos"
const ROLES = ['display', 'text', 'label'];

// tracking(sizeUnits, role = 'display') -> em
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return sizeUnits >= DISPLAY_TIGHT_FROM ? DISPLAY_TIGHT : 0;
  if (role === 'text') return 0;
  if (role === 'label') return LABEL_TRACKING;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const desk = {
  name: 'desk',
  summary: 'Editorial paper collage: warm paper, a display serif, a highlighter and hand marks that step at 12 fps. The look of mode pro.',
  modes: ['pro'],
  fonts: {
    display: { family: 'Fraunces', weight: 600, width: 'normal' },
    text: { family: 'Schibsted Grotesk', weight: 400, width: 'normal' },
    label: { family: 'JetBrains Mono', weight: 400, width: 'normal' },
  },
  palette: { paper: '#f3eee3', ink: '#15130f', ink2: '#5b554a', accent: '#ffe14a', accent2: '#d63a2f', rule: '#cfc7b6' },
  scale: [30, 44, 72, 132, 220],
  grid: { columns: 12, margin: 96, gutter: 24 },
  tracking,
  caps: { display: false, label: true },
  // 1.1: room for a highlighter band that holds a line's ascenders and descenders without touching its neighbours
  lineHeight: { display: 1.1, text: 1.3 },
  maxLines: { display: 4, text: 3 },
  wordsPerLine: { text: 12 },
  field: { field: 'paper', params: {} },
  // how shots lay out: flush left on grid columns (editorial) or on the centre of the composition (centred)
  composition: 'editorial',
  emphasis: 'highlight',
  moves: {
    enter: { ease: 'outCubic', dur: 0.5, dist: 24 },
    exit: { ease: 'inCubic', dur: 0.25, dist: 24 },
    emphasize: { ease: 'linear', dur: 0.25, step: HAND_STEP },
    draw: { ease: 'linear', dur: 0.5, step: HAND_STEP },
    count: { ease: 'outCubic', dur: 0.8 },
  },
  wordStagger: 0,
  camera: { drift: 12, style: 'desk' },
  cuts: ['cut', 'match', 'slide'],
  keyline: 8,
  shadow: { dx: 10, dy: 14, blur: 18, alpha: 0.25, color: '#000000' },
  // Styling for the devices this look draws. Colours are palette keys (or #rrggbb), sizes are units.
  devices: {
    highlight: { color: 'accent', blend: 'multiply', wobble: 3, step: HAND_STEP },
    circle: { color: 'accent2', width: 5, step: HAND_STEP },
    underline: { color: 'accent2', width: 5, step: HAND_STEP },
    arrow: { color: 'accent2', width: 5, step: HAND_STEP },
    bracket: { color: 'ink', width: 4, step: HAND_STEP },
    cutout: { keylineColor: '#ffffff' },
    clipping: { fill: '#ffffff', edge: 'torn' },
    card: { fill: '#ffffff', edge: 'taped' },
    tag: { fill: 'accent', text: 'ink' },
    focus: { dim: 0.55 },
    route: { color: 'accent2', width: 4, pins: true, step: HAND_STEP },
  },
  // 0.02: the paper field already carries the texture; more grain is noise a 20 s film pays for in megabytes (round 4 measurements)
  post: { grain: 0.02, halftone: 0, bloom: 0 },
};

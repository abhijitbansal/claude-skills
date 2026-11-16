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
  summary: 'Short-form caption collage: a near-black field, one heavy condensed grotesque in capitals, an acid accent and springy pops. The look of mode viral.',
  modes: ['viral'],
  fonts: {
    // wordSpace 0.26 em: the face's own space is about 7% of the cap height and runs caps words together
    display: { family: 'Archivo', weight: 900, width: 'extra-condensed', wordSpace: 0.26 },
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
  field: { field: 'halftone', params: { color: 'rule', strength: 0.5 } },
  // how shots lay out: a stack of short lines, each set at its own size to fill the width, flush left
  composition: 'stack',
  // emphasis recolours a word; the stack's size contrast is the hierarchy, so nothing scales
  emphasis: 'recolor',
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
    // emphasis: a highlight on a close-up turns its hard shadow to `shadow` and grows it to `offset` units; no frame
    cutout: { keylineColor: '#ffffff', emphasis: { shadow: 'accent', offset: 18 } },
  },
  // The caption style (registries.captions, engine/captions): display caps flush left on the stack edge, low in the
  // platform safe zone, a few words at a time, the spoken word in the accent.
  captions: 'stack',
  // halftone 0: pop's own field is already a halftone, and the post pass would dot the pictures too (see the Look typedef)
  post: { grain: 0.02, halftone: 0, bloom: 0 },
  // Composition data for the kinds that read it (engine/kinds/end.mjs, list.mjs); sizes are units or 1-based scale steps.
  kinds: {
    // end: a stack (the mark as its tag), the ask its last line in the accent, fitted to the width from step `askFromStep`
    // to `askToStep` (so the title stays the larger), its cap line `askGap` under the last title line
    end: { askFromStep: 3, askToStep: 4, askGap: 32 },
    // list: one item at a time as a stack under a count tag; a note in the text face at the largest of `smallSteps` the
    // stack stays three times, its cap line `noteGap` under the item
    list: { noteGap: 32, smallSteps: [1, 2] },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: 'click', slide: 'whoosh', punch: 'impact', match: null },
    device: { highlight: 'pop', circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: 'impact' },
    emphasis: 'pop',
    land: 'sub',
  },
};

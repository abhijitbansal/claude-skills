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
    // the named moves the second-wave kinds use (engine/moves/index.mjs); rise and pop are the enter move, a wipe is a
    // mask reveal, slam is a hard arrival (dur 0: desk does not slam), settle a slow ease into a new place
    rise: { ease: 'outCubic', dur: 0.5, dist: 24 },
    wipe: { ease: 'linear', dur: 0.4 },
    slam: { ease: 'linear', dur: 0 },
    pop: { ease: 'outCubic', dur: 0.5, dist: 24 },
    settle: { ease: 'outCubic', dur: 0.6 },
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
    // the arrow and the compare vs in ink at marker weight (look review 1: a thin red line was the film's one red)
    arrow: { color: 'ink', width: 10, step: HAND_STEP },
    bracket: { color: 'ink', width: 4, step: HAND_STEP },
    cutout: { keylineColor: '#ffffff' },
    clipping: { fill: '#ffffff', edge: 'torn' },
    card: { fill: '#ffffff', edge: 'taped' },
    tag: { fill: 'accent', text: 'ink' },
    focus: { dim: 0.55 },
    route: { color: 'accent2', width: 4, pins: true, step: HAND_STEP },
    // a place or part name in the text face in ink, its leader a hairline of ink
    label: { text: 'ink', line: 'ink', width: 2 },
    // a photo printed in ink on paper (engine/devices/treatments.mjs)
    duotone: { dark: 'ink', light: 'paper' },
  },
  // The caption style (registries.captions, engine/captions): label caps on a taped paper card, low on the grid.
  captions: 'lower',
  // 0.02: the paper field already carries the texture; more grain is noise a 20 s film pays for in megabytes (round 4 measurements)
  post: { grain: 0.02, halftone: 0, bloom: 0 },
  // Composition data for the kinds that read it (engine/kinds/end.mjs, list.mjs, quote.mjs, compare.mjs, chart.mjs);
  // sizes are units, shares of the frame,
  // em of the text they follow, or 1-based scale steps.
  kinds: {
    // end: the closing line fitted to columns 2 to `toWide` (`toTall` on vertical formats) from step `fromStep` to `max`,
    // at most `height` of the frame; the ask in the text face `askGap` em of the title under its last baseline, at the
    // largest of `askSteps` the title stays three times; the block centred at `centre` of the height; the mark in the
    // label face at the largest of `markSteps` under the title (3x) and the ask, on a taped card turned `turn` degrees,
    // its right edge mirroring the text margin, its
    // bottom on the bottom margin
    end: { fromStep: 4, max: 300, toWide: 11, toTall: 11, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: -3 },
    // list: the items in the display face down columns 2 to `toWide` (`toTall`), all at one size from step `fromStep` to
    // `max`, each at most `maxLines` lines, `gap` em from one item's last baseline to the next one's cap line (more than
    // the 0.4 em between the lines of one item, so the items read apart); a note in the text face and the figures in the
    // label face at the largest of `smallSteps` the items stay three times, a note's cap line `noteGap` em of the item
    // under its last baseline, the figures hanging in the margin a gutter before the items; the block centred in the room
    // the slug leaves
    list: { fromStep: 3, max: 180, toWide: 11, toTall: 11, maxLines: 3, gap: 0.75, noteGap: 0.3, smallSteps: [1, 2] },
    // quote: a taped card from column 2, at most to `toWide` (on tall frames from `fromTall` to `toTall`, the measure a
    // quotation needs to break without one-word lines) and wrapped to its text, centred at `centre` of the height; the
    // quotation `pad` in (more when its hanging opening mark needs it), in the display face up to `max`, at most `maxLines` lines, its opening mark hanging; the attribution's cap line
    // `attrGap` em of the quotation under it, a `rule`-wide rule and `ruleGap` before label caps at the largest of
    // `attrSteps` the quotation stays three times; a portrait `portrait` of the short side, `overlap` of it on the card
    quote: { toWide: 10, fromTall: 1, toTall: 12, centre: 0.5, pad: 64, max: 220, maxLines: 8, attrGap: 0.45, rule: 56, ruleGap: 18, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3 },
    // compare: two cards across columns 1 to 12, `gap` gutters apart, centred at `centre`; on each, `pad` in, the value
    // from step `valueFromStep` to `valueMax` and `valueGap` em over the title, the title from `titleMax` down (at most
    // `valueTitle` of the value; not under step `titleFromStep`) in at most `titleLines` lines, the points `titleGap` em
    // under it at `pointScale` times step `pointStep` (at most half the title); side pictures at the top of
    // the cards in a shared room `picture` of the content height, `pictureGap` above the text
    compare: { gap: 6, centre: 0.5, pad: 48, valueFromStep: 4, valueMax: 220, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 220, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1.25, picture: 0.4, pictureGap: 32 },
    // chart: the claim in the display face on columns 2 to `titleToWide` (`titleToTall`), from three times the labels up to
    // `titleMax` in at most `titleLines` lines, the plot `titleGap` under it; labels in the label face at step `labelStep`,
    // `gap` from what they label; marks `line` wide where they are lines, reference lines `ref` and the baseline `axis`
    // wide; marks other than the highlighted one dim to `dim`; reference lines drawn (`refs`); a donut or line plot keeps
    // at least `minPlot` of its box however long its labels (chart-draw.mjs)
    chart: { titleToWide: 11, titleToTall: 11, titleMax: 180, titleLines: 2, titleGap: 56, labelStep: 2, labelScale: 1.25, sourceStep: 2, gap: 14, line: 5, ref: 2, axis: 3, dim: 0.3, refs: true, minPlot: 0.4 },
    // media (engine/kinds/media.mjs): the photo in `treatment`, pushing from `push` to 1 over the shot; bleed: the caption
    // on a taped card over columns 1 to `toWide` (`toTall`), `cardPad` in, at the largest of `captionSteps` that holds it
    // in `captionLines` (two: a low, small card that keeps off the subject); cutout: the caption as the hero at the largest
    // of `heroSteps` in `maxLines`, beside the picture from column `besideFrom` (wide) or `gap` under it (tall)
    // screen (engine/kinds/screen.mjs): a white card frame with an ink hairline (`line`, `lineWidth` units) and the
    // contact shadow; window dots and the address pill in `dots` and `pill`, chrome text in `text` and `urlText`; on a
    // wide frame the framed screen is at most `wideShare` of the room's width; a tall frame's panel `gap` under it
    screen: { fill: '#ffffff', line: 'ink', lineWidth: 2, dots: 'rule', pill: 'paper', text: 'ink', urlText: 'ink2', wideShare: 0.78, gap: 56 },
    // map (engine/kinds/map.mjs): a printed sheet (`card`) with the land in paper, ink hairline borders `borderWidth`
    // units, highlights under the highlighter (multiply), red pins; the title on columns 1 to `titleTo` at the largest of
    // `titleSteps`, the map beside it; on a tall frame the places listed under the map `listGap` apart; `gap` between parts
    map: { card: true, land: 'paper', borders: 'ink', borderWidth: 1.2, highlight: 'accent', multiply: true, pin: 'accent2', titleTo: 4, titleSteps: [5, 4, 3], listGap: 10, gap: 40 },
    media: { treatment: 'duotone', push: 1.05, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 40, toWide: 6, toTall: 12, besideFrom: 8, gap: 48 },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: 'paper', slide: 'paper', punch: null, match: null },
    device: { highlight: 'marker', circle: 'marker', underline: 'marker', arrow: null, bracket: null, cutout: null, card: 'paper', tag: null, punch: null, item: 'paper', turn: 'paper',
      label: null, focus: null, route: 'marker', numeral: null, sticker: null, sweep: null, duotone: null, halftone: null, zoom: null,
      pin: 'paper', link: 'marker' },
    emphasis: null,
    land: 'click',
  },
};

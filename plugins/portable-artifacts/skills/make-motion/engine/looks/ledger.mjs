// The `ledger` look: a newsroom data film. Off-white paper with a hairline grid, near-black ink, one signal red, greys
// and a short categorical set. A coloured tag and a thin rule at top left with the claim as the title; direct labels,
// never a legend; everything but the series being discussed dims; an annotation with a leader lands on the spoken
// figure. No texture beyond the grid, no glow, no wobble. Plain data plus one pure function; index.mjs freezes and
// registers it. Experimental (hidden from every listing) until its gate (looks-four plan, Task 5).
const DISPLAY_TIGHT_FROM = 128; // units: display type at or above this size is tracked in
const DISPLAY_TIGHT = -0.01; // em
const ROLES = ['display', 'text', 'label'];
// the grid per format (gridTall: index.mjs lookForFormat); the field draws its hairlines on the same column edges
const GRID = Object.freeze({ columns: 12, margin: 96, gutter: 24 });
const GRID_TALL = Object.freeze({ columns: 12, margin: 72, gutter: 20 });
const RULE_ALPHA = 0.6; // the grid's hairlines in the rule colour at this alpha
const ENTER = Object.freeze({ ease: 'outCubic', dur: 0.45, dist: 16 });

// tracking(sizeUnits, role = 'display') -> em: sentence case throughout, so labels are not tracked out
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return sizeUnits >= DISPLAY_TIGHT_FROM ? DISPLAY_TIGHT : 0;
  if (role === 'text' || role === 'label') return 0;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const ledger = {
  name: 'ledger',
  summary: 'Newsroom data film: off-white paper on a hairline grid, near-black ink, one signal red and direct labels. The data look of mode pro.',
  experimental: true,
  modes: ['pro'],
  // Archivo at semi-condensed for display and labels (numbers in the label face; the numeral device sets digits in equal
  // cells), Fraunces at its text optical size for annotations, sources and captions
  fonts: {
    display: { family: 'Archivo', weight: 700, width: 'semi-condensed' },
    text: { family: 'Fraunces Text', weight: 400, width: 'normal' },
    label: { family: 'Archivo', weight: 600, width: 'semi-condensed' },
  },
  // paper is the only ground. accent2 is categorical 1; cat2 and cat3 the other two series colours; dim a series not
  // being discussed (3.28:1 on paper: marks only, never text); rule the hairlines (decoration)
  palette: {
    paper: '#fbfaf7', ink: '#16181d', ink2: '#5a606b', accent: '#c8102e', accent2: '#1f5fa8',
    cat2: '#1b7f5c', cat3: '#a86200', dim: '#868b95', rule: '#dcdee3',
  },
  scale: [34, 48, 76, 128, 208],
  grid: GRID,
  gridTall: GRID_TALL,
  tracking,
  caps: { display: false, label: false },
  lineHeight: { display: 1.08, text: 1.3 },
  maxLines: { display: 4, text: 3 },
  wordsPerLine: { text: 12 },
  // one minimum size for secondary text (labels, units, source, attribution, ask: kinds/secondary.mjs)
  secondary: { min: 46 },
  field: { field: 'grid', params: { margin: GRID.margin, gutter: GRID.gutter, marginTall: GRID_TALL.margin, gutterTall: GRID_TALL.gutter, alpha: RULE_ALPHA } },
  composition: 'editorial',
  // a shot's kicker is set on the look's tag at the top left, its rule running to the right margin (kinds/slug.mjs)
  slug: { style: 'tag' },
  // an emphasised word steps from the display weight to 800 and turns the accent, its advance reserved at 800 so no
  // word moves (engine/kinds/emphasis.mjs weight-color)
  emphasis: 'weight-color',
  colorSpace: 'oklab',
  moves: {
    enter: ENTER,
    exit: { ease: 'inCubic', dur: 0.25 },
    emphasize: { ease: 'outCubic', dur: 0.3 },
    draw: { ease: 'inOutCubic', dur: 0.9 },
    count: { ease: 'outCubic', dur: 0.8 },
    rise: ENTER,
    pop: ENTER,
    wipe: { ease: 'outCubic', dur: 0.7 },
    slam: { ease: 'linear', dur: 0 }, // ledger does not slam
    settle: { ease: 'inOutCubic', dur: 0.6 },
  },
  wordStagger: 0,
  // no drift: a locked camera keeps the grid on the columns; a region close-up is a cut, not a push
  camera: { drift: 0, style: 'locked' },
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'],
  cutPalette: ['cut', 'match', 'fade', 'wipe'],
  cutStyle: {},
  keyline: 4,
  // nothing in ledger casts a shadow (the card is plain); a cut-out keeps a faint contact edge
  shadow: { dx: 0, dy: 4, blur: 8, alpha: 0.12, color: '#16181d' },
  // Styling for the devices this look draws. Colours are palette keys (or #rrggbb), sizes are units. Every mark is
  // ruled: straight, exact, no wobble and no stepped frames. No highlight: emphasis is weight and colour.
  devices: {
    circle: { color: 'ink', width: 3, cap: 'butt' },
    underline: { color: 'ink', width: 3, cap: 'butt' },
    arrow: { color: 'ink', width: 3, cap: 'butt' },
    bracket: { color: 'ink', width: 3, cap: 'butt' },
    cutout: { keylineColor: '#ffffff' },
    // plain white with a 1-unit edge in the rule colour, square, no shadow, no tape
    card: { fill: '#ffffff', edge: 'hairline', line: 'rule', width: 1 },
    // the accent plate with paper text and a 2-unit ink rule running right from its mid height to the box's right edge
    tag: { fill: 'accent', text: 'paper', rule: { color: 'ink', width: 2 } },
    focus: { dim: 0.65 },
    // ink text, an ink2 hairline leader ending in a 6-unit dot on what it labels
    label: { text: 'ink', line: 'ink2', width: 2, dot: 6 },
    numeral: { color: 'ink' },
    // the close-up cut of a locked camera (clipping, screen): barely a punch
    punch: { scale: 1.04, dur: 0.2 },
    duotone: { dark: 'ink', light: 'paper' },
  },
  // the caption style: lower, as the plain strip (captions/lower.mjs): the text face on a white strip with a top
  // hairline, the spoken word in ink at 600, the rest in ink2
  captions: 'lower',
  captionVariant: 'plain',
  post: { grain: 0, halftone: 0, bloom: 0 },
  // Composition data for the kinds that read it, in the editorial family's terms (desk.mjs explains each field).
  kinds: {
    statement: {},
    // parked (looks-four Task 4): on 9:16 the desk number composition leaves 76% of the height empty (the 35% rule);
    // a tall number composition for ledger is open work
    number: { experimental: true },
    // the picture on the plain card, square
    clipping: { card: true, turn: 0 },
    free: {},
    end: { fromStep: 4, max: 280, toWide: 11, toTall: 11, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: 0 },
    // list: as desk's; on a tall frame the items from column 3, so the figures hang inside the narrow tall margin
    list: { fromStep: 3, max: 180, toWide: 11, fromTall: 3, toTall: 12, maxLines: 3, gap: 0.75, noteGap: 0.3, smallSteps: [1, 2] },
    quote: { toWide: 10, fromTall: 1, toTall: 12, centre: 0.5, pad: 64, max: 208, maxLines: 8, attrGap: 0.45, rule: 56, ruleGap: 18, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3, card: false },
    // compare: as desk's, the columns at least `fill` of the height they could take (a tall frame is filled)
    compare: { fill: 0.7, gap: 6, centre: 0.5, pad: 48, valueFromStep: 4, valueMax: 208, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 208, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1.25, picture: 0.4, pictureGap: 32 },
    // chart: as desk's, every mark labelled directly (`direct`), the others dimmed to the `dim` grey at the highlight
    // (`dimTo`), the source in the serif (`sourceFace`), the spoken figure an `annotation` (a figure: the label face) on a
    // leader that ends on its mark; on a tall frame the claim across the full width (`titleFromTall`, `titleToTall`)
    chart: { titleToWide: 11, titleFromTall: 1, titleToTall: 12, titleMax: 180, titleLines: 3, titleGap: 56, labelStep: 2, labelScale: 1, sourceStep: 1, sourceFace: 'text', gap: 14, line: 5, ref: 1, axis: 2, dim: 0.3, refs: true, direct: true, dimTo: 'dim', minPlot: 0.4, point: 10, annotation: { face: 'label' } },
    screen: { fill: '#ffffff', line: 'rule', lineWidth: 1, dots: 'rule', pill: 'paper', text: 'ink', urlText: 'ink2', wideShare: 0.78, gap: 56, pushDim: 1 },
    // parked (looks-four Task 4): on 16:9 the 46-unit secondary floor leaves the map either a title under three times
    // its labels (titleTo 5) or no room for its third place name (titleTo 6 or 7, the dropped rule)
    map: { experimental: true, card: false, land: '#e9eaee', borders: 'paper', borderWidth: 1.2, highlight: 'accent', multiply: false, pin: 'accent', labelFace: 'label', titleTo: 6, titleSteps: [5, 4, 3], listGap: 10, gap: 40, keyFill: 'ink', keyText: 'paper' },
    diagram: { card: true, steps: [4, 3, 2, 1], maxLines: 2, pad: 28, gap: 48, margin: 10, platePad: 8, plate: 'paper', arrow: 'ink', arrowWidth: 3, head: 20, text: 'ink', edgeText: 'ink2', titleSteps: [5, 4, 3], titleGap: 48, dim: 0.35, current: false, advance: 0.5 },
    // timeline: as desk's, the dates in the display face at step 5 or 4 (three times the 46-unit serif text), the events
    // in the serif
    timeline: { whatFace: 'text', whenSteps: [5, 4], whatSteps: [2], whenLines: 2, whatLines: 3, gap: 24, inset: 16, lineGap: 28, lineX: 12, textGap: 48, partGap: 12, line: 'ink', lineWidth: 2, tick: 18, titleSteps: [4, 3], titleGap: 48, advance: 0.5 },
    code: { font: { family: 'JetBrains Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.4, pad: 48, steps: [2, 3], card: true, roles: { plain: 'ink', keyword: 'accent2', string: 'cat2', number: 'accent', comment: 'ink2', name: 'ink', punct: 'ink2' }, highlight: { band: 'rule', multiply: true }, removed: 'accent', added: 'cat2', strike: 3, prompt: 'ink2', heroAdvance: 0.5 },
    feed: { face: 'text', titleFace: 'label', steps: [2, 3, 4], maxLines: 4, pad: 24, gap: 20, share: 0.82, radius: 0, bold: 600, me: { fill: '#ffffff', text: 'ink' }, them: { fill: '#ffffff', text: 'ink' }, card: { fill: '#ffffff', text: 'ink' }, discs: ['accent2', 'cat2', 'cat3'], discText: 'paper', dots: 'ink2', title: 'ink2', line: 'rule', lineWidth: 1, shadow: false },
    media: { treatment: 'duotone', push: 1, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 40, toWide: 6, toTall: 12, besideFrom: 8, gap: 48 },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: null, slide: null, punch: null, match: null, cover: null, crossfade: null, fade: null, wipe: 'paper', iris: null, zoom: null, blur: null, ripple: null, cube: null,
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': null, wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': null, pixelize: null, 'water-drop': null, erase: null },
    device: { highlight: null, circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: null, item: 'click', turn: null,
      label: 'click', focus: null, route: null, numeral: null, sticker: null, sweep: null, duotone: null, halftone: null, zoom: null,
      pin: null, link: null, node: null, event: 'click', change: 'click', output: null, message: null },
    emphasis: null,
    land: 'ding',
  },
};

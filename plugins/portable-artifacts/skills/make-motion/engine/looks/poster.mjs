// The `poster` look: kinetic type and cut paper. Two flat colours, black and paper white, with a signal red and a blue:
// type is the image, lines stack and fill the width, cut-paper bars and circles wipe as transitions, the grid shows.
// Hard and rhythmic. Each shot sits on one flat ground (paper, red, blue or ink) chosen by its index and the seed so no
// two neighbours match (engine/looks/grounds.mjs), and every colour a kind draws comes from the pairing table `on` for
// that ground: ink on blue and red on blue are banned. Plain data plus one pure function; index.mjs freezes and
// registers it. Experimental until its gate (looks-four plan, Task 8).
const DISPLAY_TRACKING = -0.02; // em: display type is tracked in
const ROLES = ['display', 'text', 'label'];
// margin 72, not the plan's 64 (16:9) and 56 (9:16 pro): a stack line's layout box starts its ink's side bearing left of
// the margin, and at 64 or 56 it crossed the format's 60-unit title-safe inset (the review's safe-area rule; pop also
// uses 72). In viral at 9:16 the platform safe zone (safeZone 'mode') with the band below
const GRID = Object.freeze({ columns: 12, margin: 72, gutter: 16 });
const GRID_TALL = Object.freeze({ columns: 12, margin: 72, gutter: 16 });
const HAIRLINES = 0.25; // the column hairlines in the ground's second colour at this alpha
const ENTER = Object.freeze({ ease: 'outExpo', dur: 0.16, scale: 0.8 });
const BAR = 16; // units: a cut bar's thickness (arrow, underline, bracket, ring)

// tracking(sizeUnits, role = 'display') -> em: display tracked in; text and labels as set
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return DISPLAY_TRACKING;
  if (role === 'text' || role === 'label') return 0;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const poster = {
  name: 'poster',
  experimental: true,
  summary: 'Kinetic type and cut paper: one flat ground a shot (paper, red, blue or black), heavy condensed capitals that fill the frame, cut-paper bars and circles. Modes viral and pro.',
  modes: ['pro', 'viral'],
  // the platform safe zone in a platform mode only (viral): in pro a 9:16 frame keeps its margins (kinds/shared.mjs)
  safeZone: 'mode',
  // Archivo in every role: width changes on the beat in the keyword steps canvas reaches (fonts/CANVAS-NOTES.md)
  fonts: {
    display: { family: 'Archivo', weight: 900, width: 'extra-condensed', wordSpace: 0.18 },
    text: { family: 'Archivo', weight: 700, width: 'condensed' },
    label: { family: 'Archivo', weight: 700, width: 'normal' },
  },
  // the base colours; a shot's palette is these renamed for its ground (grounds.mjs). `plate`: a colour the ground's ink
  // reads on (a highlight bar), set per ground; here blue, unused before a ground is applied
  // `dim` likewise: a mark not being discussed, the ink mixed toward the ground (here toward paper)
  // inkText / plateText: the text on an ink plate and on a plate-coloured plate, set per ground (grounds.mjs)
  palette: { paper: '#f2ede2', ink: '#141414', ink2: '#141414', accent: '#d92b1c', accent2: '#1f3fc4', rule: '#141414', plate: '#1f3fc4', dim: '#8a8681', inkText: '#f2ede2', plateText: '#f2ede2', textPlate: '#1f3fc4', accentText: '#f2ede2', landLine: '#f2ede2', coastLine: '#1f3fc4', bar: '#141414', barText: '#f2ede2', cardPlate: '#1f3fc4', cardPlateText: '#f2ede2' },
  // the four grounds, as palette keys, and what may sit on each (first: the ground's ink; then its accents). Red on paper
  // and ink on red are display sizes only (step 3 and up): the kinds set them only as display type
  grounds: ['paper', 'accent', 'accent2', 'ink'],
  on: { paper: ['ink', 'accent', 'accent2'], accent: ['paper', 'ink'], accent2: ['paper'], ink: ['paper', 'accent'] },
  // the pairs the plan sets at display sizes only (step 3 and up): red on paper, ink on red (grounds.mjs textPlate)
  displayOnly: { paper: ['accent'], accent: ['ink'] },
  scale: [38, 58, 104, 196, 360],
  grid: GRID,
  gridTall: GRID_TALL,
  tracking,
  caps: { display: true, label: false },
  lineHeight: { display: 0.9, text: 1.15 },
  maxLines: { display: 3, text: 3 },
  wordsPerLine: { text: 12 },
  secondary: { min: 52 },
  field: { field: 'flat', params: { margin: GRID.margin, gutter: GRID.gutter, marginTall: GRID_TALL.margin, gutterTall: GRID_TALL.gutter, alpha: HAIRLINES } },
  composition: 'stack',
  // the stack (pop's family, kinds/stack.mjs): two sizes, the larger ratio times the smaller; a hook a word a line when
  // larger, within `hook` of the height (0.65: the hook, never turned, fills by size); a tall stack grown until it fills
  // `grow` of its area; a statement (not a hook) whose upright stack still fills less than `turn` of a tall area is
  // turned 90 degrees to run up the frame (kinds/stack-turn.mjs; ban 2's 65 percent)
  stack: { ratio: 1.35, centre: 0.45, hook: 0.65, grow: 0.65, turn: 0.65 },
  // on 9:16 in viral, the composition band as shares of the height inside the platform sides
  band: { top: 0.14, bottom: 0.78 },
  // a viral hook opens at full ink on frame 0 (ban 5); every shot opens composed, its words set from the first frame
  hookInk: true,
  opens: 'set',
  emphasis: 'scale',
  colorSpace: 'oklab',
  moves: {
    enter: ENTER,
    exit: { ease: 'linear', dur: 0.08 },
    emphasize: { ease: 'linear', dur: 0, scale: 1 }, // a hard step on the word; nothing pulses (scale 1)
    draw: { ease: 'outExpo', dur: 0.2 },
    count: { ease: 'outExpo', dur: 0.5 },
    rise: { ease: 'outExpo', dur: 0.16, dist: 48 },
    wipe: { ease: 'outExpo', dur: 0.2 },
    slam: { ease: 'spring(340,22)', dur: 0.14, scale: 1.5 },
    pop: ENTER,
    settle: { ease: 'outExpo', dur: 0.25 },
  },
  wordStagger: 0,
  // a region close-up is a cut to a window of the source round the region (ledger's shares), so a ring on the region
  // stays inside the frame
  camera: { drift: 0, style: 'locked', closeUp: { width: 0.86, height: 0.7, pad: 0.2, minGain: 1.25 } },
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'],
  cutPalette: ['cut', 'cover', 'iris', 'wipe', 'punch', 'slide'],
  // a cover is a hard sheet of the next ground (the bar that wipes is the cut paper): no smear
  cutStyle: { cover: { smear: false } },
  keyline: 8,
  // nothing casts a shadow: paper is flat
  shadow: { dx: 0, dy: 0, blur: 0, alpha: 0, color: '#141414' },
  // Styling for the devices this look draws. Colours are palette keys, read on the shot's ground; sizes are units. No
  // sticker (declined) and no sweep (no light in this look).
  devices: {
    card: { edge: 'cut', fill: 'ink', turn: 2 },
    tag: { fill: 'ink', text: 'inkText' },
    numeral: { color: 'ink' },
    arrow: { color: 'ink', width: BAR, cap: 'butt' },
    underline: { color: 'ink', width: BAR, cap: 'butt' },
    bracket: { color: 'ink', width: BAR, cap: 'butt' },
    circle: { color: 'ink', width: BAR, cap: 'butt' },
    // a bar the words over it read on at 4.5:1: the words take `text` while the bar is under them (kinds/stack.mjs bars)
    highlight: { color: 'bar', text: 'barText', fit: true },
    punch: { scale: 1.1, dur: 0.12 },
    focus: { dim: 0.6 },
    halftone: { dark: 'ink', light: 'paper', cell: 12 },
    label: { text: 'ink', line: 'ink', width: 6 },
    route: { color: 'ink', width: 14 },
    // a cut-out's keyline in the plate colour: the ground's ink reads on it, so a caption that meets it still reads
    cutout: { keylineColor: 'plate' },
  },
  captions: 'stack',
  post: { grain: 0.015, halftone: 0, bloom: 0 },
  // Composition data per kind (looks-four Task 7): pop's family (the `-pop` compositions, pop.mjs explains each field),
  // every colour a palette key read on the shot's ground. A plate under text is `ink` with `paper` text (always a
  // permitted pair), or `plate` with `ink` text; nothing is translucent (dims are the opaque `dim`).
  kinds: {
    // the ask at most step 2, the kicker tag's size: with a title large enough to allow step 3 (9:16 in pro) the card
    // set three sizes (the two-size rule)
    // the ask's tag in the accent with the accent's own ink (on the ink ground the accent tag set the ground's ink on
    // red; the plate is red on the blue ground, a banned pair)
    end: { askSteps: [1, 2], askGap: 40, askFill: 'accent', askText: 'accentText' },
    // clipping: the picture without a card: on the cut card the line caption under a pushed picture landed on the card's
    // ink and read ink on ink (the frame review's contrast rule at 16:9)
    clipping: { card: false, turn: 0 },
    statement: {},
    // parked (looks-four Task 7): at 9:16 in viral the digits do not fit at poster's numeral floor and the suffix leaves
    // the platform safe zone (make --json, .scratch/p2/films/out/tall-viral); the plan's bleeding numeral needs a
    // ruling against ban 10 first (asked of the controller)
    number: { experimental: true },
    free: {},
    list: { noteGap: 32, smallSteps: [1, 2] },
    // the opening mark 1.4 times the first line (pop's 1.1): a poster's mark is display type, and it carries the tall
    // quote's top (the 65 percent fill at 9:16 in viral)
    quote: { mark: 1.4, into: -0.15, tagGap: 40, tagSteps: [1, 2], portrait: 0.24 },
    // a tall frame stacks both sides with a cut bar between (the plan's tall compare): nothing dims (dim 1: no opacity on
    // an unspoken side, bans 5 and 6), the bar in the accent (a colour every ground permits) punches in at the turn
    compare: { pointGap: 32, pointSteps: [1, 2], picture: 0.3, pictureGap: 32, stackTall: true, sideGap: 64, dim: 1, valueTall: 0.3 },
    // the claim as the tag, bars as flat cut paper, the numeral the only accent, the other marks the opaque `dim`; the
    // finished chart held 1.2 s before the cut and every point of a line labelled (the ledger gate's rulings)
    chart: { settle: 1.2, pointLabels: true, pointFace: 'text', tagSteps: [2, 3], tagGap: 24, numeralMax: 320, numeralShare: 0.2, numeralWidth: 0.6, holeShare: 0.5, numeralGap: 24, labelStep: 1, gap: 18, line: 10, ref: 2, axis: 4, dim: 0.3, dimTo: 'dim', refs: false, minPlot: 0.4, point: 14 },
    // at 9:16 the route to the region panel draws once the panel is in (linkAfter), and a panel crop of 80 percent of the
    // picture's width or more takes all of it (wholeWidth): words were cut at its edge
    screen: { linkAfter: true, wholeWidth: 0.8, fill: 'ink', line: 'ink', lineWidth: 10, dots: 'rule', pill: 'cardPlate', text: 'inkText', urlText: 'cardPlateText', wideShare: 0.8, gap: 44 },
    // land on textPlate: the place labels (ink, text size) read on it on every ground (red land put ink on red)
    // wholeTall: at 9:16 the whole land fits the width (the tall crop cut the Americas off at the frame edge, ban 10)
    map: { wholeTall: true, card: false, land: 'textPlate', coast: 'coastLine', borders: 'landLine', borderWidth: 1.5, highlight: 'ink', multiply: false, pin: 'ink', titleTo: 4, titleSteps: [3], listGap: 12, gap: 36, keyFill: 'ink', keyText: 'inkText', keyLine: 'ink', keyLineWidth: 4 },
    diagram: { card: true, steps: [4, 3, 2, 1], maxLines: 2, pad: 18, gap: 56, margin: 12, platePad: 10, plate: 'paper', arrow: 'ink', arrowWidth: 12, head: 34, text: 'paper', edgeText: 'ink', titleSteps: [3], titleGap: 40, dim: 1, current: false, advance: 0.48 },
    timeline: { whenSteps: [5, 4], whatSteps: [3, 2], whenLines: 2, whatLines: 3, rail: 48, dot: 12, ring: 1.7, rule: 'ink', ruleWidth: 4, dotFill: 'ink', lit: 'ink', when: 'ink', what: 'ink', partGap: 24, gap: 24, titleSteps: [3], titleGap: 40, advance: 0.45 },
    // lineHeight 1.3 (pop's 1.4): at 16:9 the 72-unit margins leave room for 10 rows at 1.4, and the example has 11
    code: { font: { family: 'JetBrains Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.3, pad: 32, steps: [2, 3], card: false, fill: 'ink', line: 'ink', lineWidth: 10, roles: { plain: 'inkText', keyword: 'inkText', string: 'inkText', number: 'inkText', comment: 'inkText', name: 'inkText', punct: 'inkText' }, highlight: { band: 'cardPlate', text: 'cardPlateText' }, removed: 'inkText', added: 'inkText', strike: 6, prompt: 'inkText', heroAdvance: 0.45 },
    feed: { steps: [2, 3, 4], maxLines: 4, pad: 26, gap: 24, share: 0.82, radius: 0, bold: 900, me: { fill: 'ink', text: 'inkText' }, them: { fill: 'accent', text: 'accentText' }, card: { fill: 'ink', text: 'inkText' }, discs: ['ink'], discText: 'inkText', dots: 'ink', title: 'ink', line: 'ink', lineWidth: 6, shadow: false },
    // fitTall: at 9:16 the picture is a cut-out filling the band over its caption in the ground's ink (a bleed's caption
    // card in ink was lost on the ink ground and left the band's lower part to a dark picture)
    media: { fitTall: 'cutout', treatment: 'halftone', push: 1.06, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 28, toWide: 7, toTall: 12, besideFrom: 8, gap: 40 },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: 'click', slide: 'whoosh', punch: 'impact', match: null, cover: 'paper', crossfade: null, fade: null, wipe: 'paper', iris: 'paper', zoom: null, blur: null, ripple: null, cube: null,
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': null, wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': null, pixelize: null, 'water-drop': null, erase: null },
    device: { highlight: 'click', circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: 'impact', item: 'pop', turn: 'paper',
      label: null, focus: null, route: null, numeral: 'sub', sticker: null, sweep: null, duotone: null, halftone: null, zoom: null,
      pin: null, link: null, node: null, event: null, change: null, output: null, message: null },
    emphasis: 'click',
    land: 'impact',
  },
};

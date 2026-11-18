// The `keynote` look: a product launch film. A near-white ground with a soft mesh of two pale washes and fine grain,
// one neutral variable sans from light to black (Geist Variable), one brand accent. A huge headline; a weight sweep
// across the spoken words; product screens on elevated white cards with depth; a band of light crossing type once (the
// look's only light); a ring drawn round a region as the camera pushes in. Long ease-out settles and a camera that never
// rests. Light ground only: the near-black variant is the slide-deck look the gates banned (looks-four plan, ban 1).
// Plain data plus one pure function; index.mjs freezes and registers it. Experimental until its gate (Task 11).
const DISPLAY_TIGHT_FROM = 152; // units: display type at or above this size is tracked in
const DISPLAY_TIGHT = -0.02; // em
const LABEL_TRACKING = 0.01; // em: labels are tracked out a little
const ROLES = ['display', 'text', 'label'];
// the grid per format (gridTall: index.mjs lookForFormat)
const GRID = Object.freeze({ columns: 12, margin: 120, gutter: 24 });
const GRID_TALL = Object.freeze({ columns: 12, margin: 72, gutter: 20 });
const SETTLE = 'outQuart'; // the longest ease-out settle engine/time/ease.mjs has
const ENTER = Object.freeze({ ease: SETTLE, dur: 0.9, dist: 36 });
const RADIUS = 28; // units: an elevated card's corner

// tracking(sizeUnits, role = 'display') -> em: sentence case throughout
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return sizeUnits >= DISPLAY_TIGHT_FROM ? DISPLAY_TIGHT : 0;
  if (role === 'text') return 0;
  if (role === 'label') return LABEL_TRACKING;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const keynote = {
  name: 'keynote',
  experimental: true,
  summary: 'Product launch film: a near-white ground with a soft mesh, one variable sans swept from light to heavy, product screens on elevated cards and a band of light. The launch look of mode pro.',
  modes: ['pro'],
  // one variable family in every role (Geist Variable, engine/fonts: the static shared Geist cannot sweep)
  fonts: {
    display: { family: 'Geist Variable', weight: 700, width: 'normal' },
    text: { family: 'Geist Variable', weight: 400, width: 'normal' },
    label: { family: 'Geist Variable', weight: 500, width: 'normal' },
  },
  // paper is the ground; wash and wash2 the mesh's two blobs (grounds too: keynote-look.test.mjs computes every pair on
  // them); dim a chart mark not being discussed (marks only, never text); rule the hairlines (decoration); shade the
  // elevated card's cool grey shadow. accent2 is ink2: there is no second hue.
  palette: {
    paper: '#f5f5f7', ink: '#0b0b0f', ink2: '#5c5f6a', accent: '#3b5bff', accent2: '#5c5f6a',
    dim: '#7d8394', rule: '#dcdde3', wash: '#dfe4ff', wash2: '#ffe6dc', shade: '#4a5068', card: '#ffffff',
  },
  scale: [34, 48, 84, 152, 264],
  grid: GRID,
  gridTall: GRID_TALL,
  tracking,
  caps: { display: false, label: false },
  lineHeight: { display: 1.02, text: 1.35 },
  maxLines: { display: 4, text: 3 },
  wordsPerLine: { text: 12 },
  secondary: { min: 46 },
  // the mesh at half strength in the two washes, swaying (fields/mesh.mjs colours, sway)
  field: { field: 'mesh', params: { blobs: 4, strength: 0.5, colours: ['wash', 'wash2'], sway: 1 } },
  composition: 'editorial',
  // every shot opens composed (ban 5; the ledger and poster gates' first ruling): the claim set whole on frame 0, and the
  // designed motion after it is the weight sweep, the band of light and the camera (kinds/shared.mjs opensSet)
  opens: 'set',
  slug: { style: 'tag' },
  // an emphasised word's weight ramps from 300 to 800 over its spoken time, the whole word at once, in spoken order
  // across a phrase; every word measured at 800 so nothing moves (engine/kinds/emphasis.mjs weight-sweep)
  emphasis: 'weight-sweep',
  // 500, the plan's one fallback (looks-four Task 9): at 300 a light word sat visibly indented in its 800 room on the
  // first sheets (a line's first word drawn centred in its reserved advance, .scratch/n1 statement sheet at 2.10 s)
  // `flush` 'start' (n2 ruling 2): a line's first word sits at its room's start, not centred in it, so the light word
  // opening a line starts where the other lines start (the n1 sheet: "sources." inset about 25 px at 9:16)
  sweep: { from: 500, to: 800, flush: 'start' },
  colorSpace: 'oklab',
  moves: {
    enter: ENTER,
    exit: { ease: 'inCubic', dur: 0.3 },
    emphasize: { ease: 'inOutCubic', dur: 0.6 },
    draw: { ease: 'inOutCubic', dur: 0.7 },
    count: { ease: SETTLE, dur: 1.1 },
    rise: ENTER,
    wipe: { ease: SETTLE, dur: 0.8 },
    slam: { ease: 'linear', dur: 0 }, // keynote does not slam
    pop: { ease: SETTLE, dur: 0.7, scale: 0.96 },
    settle: { ease: SETTLE, dur: 1.0 },
  },
  wordStagger: 0,
  // a slow continuous move through every shot: never still
  camera: { drift: 18, style: 'desk' },
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'],
  cutPalette: ['cut', 'match', 'crossfade', 'zoom', 'blur', 'cross-zoom'],
  cutStyle: { crossfade: { duration: 0.5 } },
  keyline: 8,
  // nothing casts a hard shadow: depth is the elevated card's own soft two-layer shadow (devices/card.mjs elevated)
  shadow: { dx: 0, dy: 0, blur: 0, alpha: 0, color: '#4a5068' },
  // Styling for the devices this look draws. Colours are palette keys (or #rrggbb), sizes are units. Declined (no style):
  // highlight, underline, bracket (emphasis is weight), sticker, duotone and halftone (pictures stay in colour).
  devices: {
    // white, radius 28, a two-layer soft shadow in the shade grey drawn once as stacked rings (no blur filter)
    card: { edge: 'elevated', fill: 'card', radius: RADIUS, layers: [{ color: 'shade', alpha: 0.1, reach: 10, dy: 4 }, { color: 'shade', alpha: 0.12, reach: 64, dy: 28 }] },
    // the band of light: white, screened, crossing a headline or a screen once
    sweep: { color: '#ffffff', alpha: 0.7 },
    // the ring round a region (the zoom ring, a clipping's region): an accent line 4 units wide drawn round it as a box
    // 16 units out (an ellipse round a wide region ran past the frame)
    circle: { color: 'accent', width: 4, cap: 'round', shape: 'box', pad: 16 },
    arrow: { color: 'accent', width: 4, cap: 'round' },
    tag: { shape: 'pill', fill: 'card', text: 'ink2' },
    label: { text: 'ink', line: 'rule', width: 2 },
    numeral: { color: 'ink' },
    route: { color: 'ink', width: 3 },
    focus: { dim: 0.55 },
    cutout: { keylineColor: '#ffffff' },
  },
  // the pill caption: a white pill, ink text, the spoken word at `captionWeight` with no recolour (captions/pill.mjs)
  captions: 'pill',
  captionWeight: 700,
  post: { grain: 0.012, halftone: 0, bloom: 0 },
  kinds: {
    // one huge headline up to 264 across columns 1 to 11, set whole on frame 0; the sweep on its emphasised word
    // `linesWide` 2: on a wide frame at most two lines when that fits (three one-word lines left the right half empty
    // on the first sheet); `tail`: 1.6 s after the last word before the cut, so the swept word holds heavy
    // `tallFrom` 1: on a tall frame from the first column, so a short claim sets larger and fills more of the height
    // (from column 2 the 9:16 sheet left 36 percent under the claim)
    // n2 ruling 3: at 16:9 across all twelve columns (`toWide` 12) and centred down the frame, not hung under the tag:
    // hung, the two-line claim left 34 percent of the height empty under it (measured with real glyphs,
    // keynote-glyphs-browser.test.mjs)
    statement: { toWide: 12, linesWide: 2, tallFrom: 1, tail: 1.6 },
    // parked (looks-four Task 10): on 9:16 the desk number composition leaves 75 percent of the height empty (25 percent
    // used, keynote-kinds.test.mjs; the 35 percent rule), as it did in ledger; a tall number composition is open work
    number: { experimental: true, labelFace: 'text' },
    // parked (looks-four Task 10): on the rendered sheets (.scratch/n1/films/out/keynote-tall2.sheets/clipping.png) the
    // author caption enters ghosted on frame 0, the push at 9:16 runs past the picture's top into an empty paper band, and
    // the caption card sits over a bar label inside the ringed region (ban 10); a keynote clipping composition is open work
    clipping: { experimental: true, card: true, turn: 0 },
    free: {},
    // the wordmark at 800 (`titleWeight`) with the band of light crossing it once (`sweep`), the ask under it
    end: { titleWeight: 800, sweep: true, fromStep: 4, max: 264, toWide: 11, toTall: 11, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: 0, askFace: 'text', markTag: true },
    // on a tall frame the items from column 3, so the figures hang inside the narrow tall margin (ledger's fix)
    list: { previews: true, fromStep: 3, max: 152, toWide: 11, fromTall: 3, toTall: 12, maxLines: 3, gap: 0.75, noteGap: 0.3, smallSteps: [1, 2] },
    // quote: plain type, no card, the attribution in ink2; it differs from a statement by its centred block (`centred`),
    // its narrower measure (to column 10 wide, 2 to 11 tall) and its size (step 4, 152, against the statement's 264; a
    // tall frame lets it grow to 208, `maxTall`, so it fills the height)
    // `setOnOpen`: the quotation whole on frame 0 (the first sheet showed grey unspoken words); `attrFill`: ink2
    quote: { setOnOpen: true, attrFill: 'ink2', centred: true, face: 'display', toWide: 10, fromTall: 2, toTall: 11, centre: 0.5, pad: 64, max: 152, maxTall: 208, maxLines: 8, attrGap: 0.45, rule: 56, ruleGap: 18, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3, card: false },
    // compare: two elevated cards, the unspoken one moved back in depth (`recede`: scaled to 0.94), not dimmed
    compare: { recede: 0.94, gap: 6, centre: 0.5, pad: 56, fill: 0.9, valueFromStep: 4, valueMax: 264, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 152, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1.25, picture: 0.4, pictureGap: 32 },
    // `valuesSet` (n2 ruling 4): a value label appears at full ink once its bar has grown (n1's sheets: the first label
    // faint mid-growth)
    chart: { valuesSet: true, settle: 1.2, pointLabels: true, fillFollowsLine: true, startFinal: true, claimLast: true, rowDrop: 0.75, pointLift: 0.6, pointNudge: 1, plotHeight: 0.2, titleToWide: 11, titleFromTall: 1, titleToTall: 12, titleMax: 152, titleLines: 3, titleGap: 56, labelStep: 2, labelScale: 1, sourceStep: 1, sourceFace: 'text', gap: 14, line: 5, ref: 1, axis: 2, dim: 0.3, refs: false, direct: true, dimTo: 'dim', minPlot: 0.4, point: 10, annotation: { face: 'label', leader: 'joined', barLeader: 'none' } },
    // screen: the framed screenshot on the elevated card's shadow (`elevated`), the camera pushing in with the rest under
    // the focus scrim, and the zoom ring drawn round the region (`ring`): no paper mask (desk's pushDim left a wide region
    // a thin strip floating on an empty frame on the first sheets)
    // at 9:16 (two panels) the link to the region panel draws once the panel is in (`linkAfter`) and a crop of 80 percent
    // of the picture's width or more takes all of it (`wholeWidth`): poster's switches; the first 9:16 sheet showed a
    // hanging link and words cut at the panel's edge
    // un-parked (n2 ruling 1). n1 parked it: at 9:16 the region panel of a wide region was sliced at its sides (at the
    // tall panel's aspect panelCrop scaled the whole-width crop narrower: "Da", "1"), and at 16:9 the push sliced the
    // dimmed rows above the ring at the frame's top. Now:
    // `pushFrame` 'card': at 16:9 the push frames the whole card (camera.mjs pushLayer keep), so no row is cut at an edge
    // `tallHero`: at 9:16 a titled wide screen is one whole card under its title set as the headline (up to `heroMax`,
    // `heroLines`, `heroShare` of the room), the region ringed and focused, never cropped (a region most of the screen
    // wide cannot be enlarged on a tall panel without slicing it); `cropRegion`: an untitled one keeps the region panel,
    // its crop never narrower than the region
    // The plan's turned-in-depth card with a second card behind and parallax is not built (open, n2 report)
    screen: { pushFrame: 'card', tallHero: true, heroMax: 264, heroLines: 3, heroShare: 0.4, cropRegion: true, linkAfter: true, wholeWidth: 0.8, elevated: true, ring: true, fill: 'card', line: 'rule', lineWidth: 1, dots: 'rule', pill: 'paper', text: 'ink', urlText: 'ink2', wideShare: 0.78, gap: 56 },
    // map: at 16:9 the title over a map the full width (`titleAbove`, ledger's switch: beside it the map was too narrow to
    // hold a third place name, a creative finding on the first render)
    map: { titleAbove: true, titleStepsWide: [4, 3], sourceFace: 'text', sourceStep: 1, sourcePrefix: true, sourceAt: 'title', card: true, land: '#dfe1e8', borders: 'card', borderWidth: 1.2, highlight: 'accent', multiply: false, pin: 'accent', labelFace: 'label', titleTo: 5, titleSteps: [5, 4, 3], listGap: 10, gap: 40, keyFill: 'ink', keyText: 'card' },
    // diagram: the first three nodes and their edges on from frame 0 (`openNodes`; the first sheet opened on one node)
    // `pad` 56 (n2 ruling 3): larger elevated boxes, so a row of three spans more of a wide frame (at 28 the row took 14
    // percent of the height, measured with real glyphs)
    diagram: { openNodes: 3, card: true, steps: [4, 3, 2, 1], maxLines: 2, pad: 56, gap: 48, margin: 10, platePad: 8, plate: 'paper', arrow: 'ink2', arrowWidth: 3, head: 20, text: 'ink', edgeText: 'ink2', titleSteps: [5, 4, 3], titleGap: 48, dim: 0.35, current: false, advance: 0.55 },
    // open (n2 ruling 3): at 16:9 the events leave 32 percent of the height empty under them (measured with real
    // glyphs); the hero rule holds each event's words to a third of its date and a 264 date does not fit its column, so
    // no data value fills it: a taller keynote timeline composition is open work
    timeline: { underTitle: true, previews: true, whatFace: 'text', whenSteps: [5, 4], whatSteps: [2], whenLines: 2, whatLines: 3, gap: 24, inset: 16, lineGap: 20, lineX: 12, textGap: 48, partGap: 12, line: 'ink2', lineWidth: 2, tick: 18, titleSteps: [5, 4], titleGap: 40, advance: 0.55 },
    // code: every line on frame 0 (`setOnOpen`; the first sheet typed it in from one word) and the title the hero over a
    // full-width card at 16:9 too (`heroWide`, poster's switch: a narrow card left the sides of the frame empty)
    // (at most `heroWideRows` 6 rows under the hero at 16:9: a ten-row listing did not fit under it, a creative finding;
    // a longer listing keeps the plain card)
    // `cardWide` (n2 ruling 3): a long listing's plain card takes the frame's width at 16:9 (as narrow as its longest
    // line it used 40 percent of the width, measured with real glyphs)
    code: { cardWide: true, setOnOpen: true, heroWide: true, heroWideRows: 6, heroMax: 264, font: { family: 'Geist Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.4, pad: 48, steps: [2, 3], card: true, roles: { plain: 'ink', keyword: 'accent', string: 'ink2', number: 'accent', comment: 'ink2', name: 'ink', punct: 'ink2' }, highlight: { band: 'wash', multiply: true }, removed: 'ink2', added: 'accent', strike: 3, prompt: 'ink2', heroAdvance: 0.5 },
    // feed: every message set on frame 0, the spoken one in ink and the others in ink2 (`lit`, ledger's switch): the
    // first 16:9 sheet left the lower half empty for two seconds, and poster's `roomOnOpen` left plates blank for five
    // seconds on the 9:16 sheet (the failure that parked feed in poster). The me bubble is the pale wash, so ink2 reads
    feed: { lit: { spoken: 'ink', other: 'ink2' }, titleSlug: true, titleGap: 48, face: 'display', steps: [2, 3, 4], maxLines: 4, pad: 28, gap: 20, share: 0.82, radius: 24, bold: 700, me: { fill: 'wash', text: 'ink' }, them: { fill: 'card', text: 'ink' }, card: { fill: 'card', text: 'ink' }, discs: ['accent', 'ink2', 'ink'], discText: 'card', dots: 'ink2', title: 'ink2', lineWidth: 0, shadow: false },
    // media: the picture in colour (no treatment), its caption whole from frame 0 (`setOnOpen`: the first sheets showed
    // a caption card holding one word for two seconds)
    media: { setOnOpen: true, treatment: 'none', push: 1.04, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 40, toWide: 6, toTall: 12, besideFrom: 8, gap: 48 },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: null, slide: null, punch: null, match: null, cover: null, crossfade: null, fade: null, wipe: null, iris: null, zoom: 'whoosh', blur: 'whoosh', ripple: null, cube: null,
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': 'whoosh', wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': null, pixelize: null, 'water-drop': null, erase: null },
    device: { highlight: null, circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: null, item: 'click', turn: null,
      label: null, focus: null, route: null, numeral: 'sub', sticker: null, sweep: 'chime', duotone: null, halftone: null, zoom: 'whoosh',
      pin: null, link: null, node: null, event: null, change: null, output: null, message: null },
    emphasis: null,
    land: 'sub',
  },
};

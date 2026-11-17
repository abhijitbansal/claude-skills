// The `ledger` look: a newsroom data film. Off-white paper with a hairline grid, near-black ink, one signal red, greys
// and a short categorical set. A coloured tag and a thin rule at top left with the claim as the title; direct labels,
// never a legend; everything but the series being discussed dims; an annotation with a leader lands on the spoken
// figure. No texture beyond the grid, no glow, no wobble. Plain data plus one pure function; index.mjs freezes and
// registers it. Listed since its gate (looks-four plan, Task 5: ship after fixes on both films).
const DISPLAY_TIGHT_FROM = 128; // units: display type at or above this size is tracked in
const DISPLAY_TIGHT = -0.01; // em
const ROLES = ['display', 'text', 'label'];
// the grid per format (gridTall: index.mjs lookForFormat); the field draws its hairlines on the same column edges
const GRID = Object.freeze({ columns: 12, margin: 96, gutter: 24 });
const GRID_TALL = Object.freeze({ columns: 12, margin: 72, gutter: 20 });
const RULE_ALPHA = 0.6; // the grid's hairlines in the rule colour at this alpha
const ENTER = Object.freeze({ ease: 'outCubic', dur: 0.45, dist: 16 });
// A region close-up (controller ruling 4): a window of the source round the region, CLOSE_UP_PAD of the region's size
// more on every side (the words at its edge are not cut, and a ruled circle, 1.25 times the region, rings it on the
// picture instead of running past the frame as pop's region-only close-up does). The window takes CLOSE_UP_WIDTH of the
// width between the margins, at most CLOSE_UP_HEIGHT of the height. A close-up that would draw the region less than
// CLOSE_UP_GAIN times as wide as the establishing picture does (a wide region on a tall frame: a thin strip that reads
// as a zoom out) is not cut to: the region is ringed on the establishing picture instead.
const CLOSE_UP_PAD = 0.2;
const CLOSE_UP_GAIN = 1.25;
const CLOSE_UP_WIDTH = 0.86;
const CLOSE_UP_HEIGHT = 0.7;

// tracking(sizeUnits, role = 'display') -> em: sentence case throughout, so labels are not tracked out
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return sizeUnits >= DISPLAY_TIGHT_FROM ? DISPLAY_TIGHT : 0;
  if (role === 'text' || role === 'label') return 0;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const ledger = {
  name: 'ledger',
  summary: 'Newsroom data film: off-white paper on a hairline grid, near-black ink, one signal red and direct labels. The data look of mode pro.',
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
  // step 4 at 144: a step-4 hero is at least three times the 46-unit secondary floor (controller ruling, Task 4b) and
  // three times step 2 (48), the reading size the map and other kinds set their labels at
  scale: [34, 48, 76, 144, 208],
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
  // every shot opens composed (ban 5, gate-ledger-1 ruling 4): the claim set whole and the tag and mark on from the
  // first frame (kinds/shared.mjs opensSet); only spoken marks arrive after
  opens: 'set',
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
    wipe: { ease: 'outCubic', dur: 0.7 },
    slam: { ease: 'linear', dur: 0 }, // ledger does not slam
    pop: ENTER,
    settle: { ease: 'inOutCubic', dur: 0.6 },
  },
  wordStagger: 0,
  // no drift: a locked camera keeps the grid on the columns; a region close-up is a cut, not a push, to a window of the
  // source round the region (the CLOSE_UP constants above)
  camera: { drift: 0, style: 'locked', closeUp: { width: CLOSE_UP_WIDTH, height: CLOSE_UP_HEIGHT, pad: CLOSE_UP_PAD, minGain: CLOSE_UP_GAIN } },
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
    // a region or a word ringed by a ruled box 12 units out, never an ellipse (gate-ledger-1 ruling 1)
    circle: { color: 'ink', width: 3, cap: 'butt', shape: 'box', pad: 12 },
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
    // a map route: a 3-unit ink line with a small head, no second hue (gate-ledger-1 ruling 2)
    route: { color: 'ink', width: 3 },
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
    // the claim across columns 2 to 11 at 16:9 (`toWide`, gate-ledger-1 ruling 5: on 2 to 9 it left the right half
    // empty), the span every other shot's claim takes; under a tag the claim hangs right under its rule (`hang`)
    // `tail`: seconds after the last word before the cut (script/timing.mjs shotPace), so an emphasis on the last word is
    // red on screen at least 1.2 s (gate-ledger-2 ruling 2: the tall lede showed it 0.4 s)
    // a hanging claim is fitted to the room under its tag (statement.mjs fitEditorial; gate-ledger-3 F4: fitted to the
  // desk's centred height share, it left the lower third of the frame empty)
  statement: { toWide: 11, hang: true, tail: 1.6 },
    // the label in the serif (`labelFace`). Parked (looks-four Task 4): on 9:16 the desk number composition leaves 76%
    // of the height empty (the 35% rule); a tall number composition for ledger is open work
    number: { experimental: true, labelFace: 'text' },
    // the picture on the plain card, square
    clipping: { card: true, turn: 0 },
    free: {},
    // end: as desk's, square, the ask in the serif (`askFace`), the mark the look's tag (`markTag`) bottom right
    end: { fromStep: 4, max: 280, toWide: 11, toTall: 11, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: 0, askFace: 'text', markTag: true },
    // list: as desk's; on a tall frame the items from column 3, so the figures hang inside the narrow tall margin
    // `previews` (gate-ledger-2 ruling 3): every item set from frame 0 in ink2, the spoken one in ink (list-desk.mjs)
    list: { previews: true, fromStep: 3, max: 180, toWide: 11, fromTall: 3, toTall: 12, maxLines: 3, gap: 0.75, noteGap: 0.3, smallSteps: [1, 2] },
    // quote: the quotation in the serif (`face`) up to step 4 (step 5 on a tall frame, `maxTall`, so it fills the height),
    // no card, a 4-unit accent rule down its left (`bar`); at 16:9 on columns 2 to 12 (`toWide`) with its lines at 1.15
    // (`leading`), so a twelve-word quotation fits at three times the attribution's 46-unit floor and keeps its
    // attribution (on 10 columns at the text leading it took four lines the height could not hold, and it was dropped)
    quote: { face: 'text', leading: 1.15, bar: { width: 4, color: 'accent' }, toWide: 12, fromTall: 1, toTall: 12, centre: 0.5, pad: 64, max: 144, maxTall: 208, maxLines: 8, attrGap: 0.45, rule: 56, ruleGap: 18, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3, card: false },
    // compare: as desk's, the columns at least `fill` of the height they could take (a tall frame is filled); drawn as
    // two ruled columns (`columns`, gate-ledger-1 ruling 1): no card, no scrim, no drawn vs, a 2-unit ink2 hairline
    // (`divider`) between them, the points without a dash (`plainPoints`: "- 182" read as minus 182), and the side
    // stating the larger figure in the accent from the first frame (compare-desk.mjs claimedSide)
    // gate-ledger-2 ruling 6: the values the hero up to `valueMax` (they fill the lower third), the copy on the film's
    // left margin: from column 2 at 16:9 (`fromWide`), no inner pad (no card to pad)
    compare: { columns: true, fromWide: 2, divider: { color: 'ink2', width: 2 }, plainPoints: true, fill: 0.9, gap: 6, centre: 0.5, pad: 0, valueFromStep: 4, valueMax: 400, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 208, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1.25, picture: 0.4, pictureGap: 32 },
    // chart: as desk's, every mark labelled directly (`direct`), the others dimmed to the `dim` grey at the highlight
    // (`dimTo`), the source in the serif (`sourceFace`), the spoken figure an `annotation` (a figure: the label face) on a
    // leader that ends on its mark; on a tall frame the claim across the full width (`titleFromTall`, `titleToTall`);
    // `plotHeight`: the share of the frame's height the plot aims to keep, the claim set smaller to leave it (a claim
    // that cannot fit the room left is set at three times the labels, and the plot takes what remains)
    // `settle`: the finished chart (values, highlight and dims) is on screen at least this many seconds before the cut
    // (gate-ledger-1 ruling 4, 1.2 s by gate-ledger-2 ruling 2; chart-time.mjs)
    // line and area (gate-ledger-1 ruling 3, chart-series.mjs): every point's value over it as the line reaches it
    // (`pointLabels`), an area's fill edge on the line's tip (`fillFollowsLine`), the category row dropped `rowDrop` em
    // under the value axis's "0" so the two never read as one string
    // gate-ledger-2 ruling 5: the first point label lifted `pointLift` em off the "0" row and `pointNudge` em right of
    // the tick column; the last point claimed in the
    // accent when nothing is highlighted (`claimLast`); bars grown in their final colours (`startFinal`)
  // gate-ledger-3 F5: a bar's note has no leader (`barLeader` none: the short tick read as a minus sign, "-182", and
  // drew on ahead of the note); a column's note hangs on a vertical leader joined to the column, growing from it with
  // the note (`leader` joined: drawn from the note's end, it began as a stray dot over the column)
    chart: { settle: 1.2, pointLift: 0.6, pointNudge: 1, claimLast: true, startFinal: true, pointLabels: true, fillFollowsLine: true, rowDrop: 0.75, plotHeight: 0.2, titleToWide: 11, titleFromTall: 1, titleToTall: 12, titleMax: 180, titleLines: 3, titleGap: 56, labelStep: 2, labelScale: 1, sourceStep: 1, sourceFace: 'text', gap: 14, line: 5, ref: 1, axis: 2, dim: 0.3, refs: true, refsTypes: ['line', 'area'], direct: true, dimTo: 'dim', minPlot: 0.4, point: 10, annotation: { face: 'label', leader: 'joined', barLeader: 'none' } },
    screen: { fill: '#ffffff', line: 'rule', lineWidth: 1, dots: 'rule', pill: 'paper', text: 'ink', urlText: 'ink2', wideShare: 0.78, gap: 56, pushDim: 1 },
    // map: no card. At 16:9 the title across the top at step 4 (144: three times the 48-unit place names) or step 3,
    // over a map the full width (`titleAbove`, `titleStepsWide`); on a tall frame at step 5, 4 or 3 over it
    // land `#c9cdd4` (gate-ledger-1 ruling 2, over the plan's `#e9eaee` at 1.15:1, which barely read): 1.53:1 on
    // paper, ink labels 11.1:1, ink2 leaders 3.97:1 and accent pins 3.69:1 on it (ledger-gate2.test.mjs computes them).
    // A route across the antimeridian is one line from city to city inside the map (`unwrapped`), not two pieces
    // clipped at the edges
    // gate-ledger-2 ruling 4: only the origin in the accent, the destinations' pins in ink (`pinTo`)
    // gate-ledger-3 F2: when a route would cross the map's edge, the world is turned so the edge falls where no route
    // runs (`recentre`, scripts/v2/prepare/map.mjs): every route one line the short way (Denver to Kyoto over the
    // Pacific, not the long way east over Africa); `unwrapped` stays for a route set that leaves no clear seam
    // gate-ledger-3 F3: the source set as the charts set theirs: the serif at step 1 held to the secondary floor, after
    // "Source: ", on the title's left edge (`sourceFace`, `sourceStep`, `sourcePrefix`, `sourceAt`)
    map: { recentre: true, sourceFace: 'text', sourceStep: 1, sourcePrefix: true, sourceAt: 'title', unwrapped: true, pinTo: 'ink', titleAbove: true, titleStepsWide: [4, 3], card: false, land: '#c9cdd4', borders: 'paper', borderWidth: 1.2, highlight: 'accent', multiply: false, pin: 'accent', labelFace: 'label', titleTo: 5, titleSteps: [5, 4, 3], listGap: 10, gap: 40, keyFill: 'ink', keyText: 'paper' },
    // diagram: on a tall frame a column's boxes run across the label room (`fullColumn`, gate-ledger-1 ruling 5)
    diagram: { fullColumn: true, card: true, steps: [4, 3, 2, 1], maxLines: 2, pad: 28, gap: 48, margin: 10, platePad: 8, plate: 'paper', arrow: 'ink', arrowWidth: 3, head: 20, text: 'ink', edgeText: 'ink2', titleSteps: [5, 4, 3], titleGap: 48, dim: 0.35, current: false, advance: 0.5 },
    // timeline: as desk's, the dates in the display face at step 5 or 4 (three times the 46-unit serif text), the events
    // in the serif
    // gate-ledger-2 ruling 3: the title the hero at step 5 or 4 (`titleSteps`), the dates and events one size a third
    // of it (`underTitle`, timeline-fit.mjs), every event set from frame 0 with the spoken one lit (`previews`)
    timeline: { underTitle: true, previews: true, whatFace: 'text', whenSteps: [5, 4], whatSteps: [2], whenLines: 2, whatLines: 3, gap: 24, inset: 16, lineGap: 20, lineX: 12, textGap: 48, partGap: 12, line: 'ink', lineWidth: 2, tick: 18, titleSteps: [5, 4], titleGap: 40, advance: 0.5 },
    code: { font: { family: 'JetBrains Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.4, pad: 48, steps: [2, 3], card: true, roles: { plain: 'ink', keyword: 'accent2', string: 'cat2', number: 'accent', comment: 'ink2', name: 'ink', punct: 'ink2' }, highlight: { band: 'rule', multiply: true }, removed: 'accent', added: 'cat2', strike: 3, prompt: 'ink2', heroAdvance: 0.5 },
    // feed: messages as ruled rows (`rows`, gate-ledger-1 ruling 1): no bubble card, each message across the full width
    // (`share` 1) under a 2-unit ink2 hairline, set so no line holds one word, the rows spread down the room.
    // gate-ledger-2 ruling 1: the title is the look's tag slug (`titleSlug`, `titleGap` units over the rows), the
    // messages the hero in the display face as large as the room holds (`steps` up to 5); a `me` message starts `indent`
    // units in (the speakers told apart, no names invented); every row set from frame 0, the spoken one in ink and the
    // others in ink2 (`lit`)
    feed: { rows: true, titleSlug: true, titleGap: 48, indent: 96, lit: { spoken: 'ink', other: 'ink2' }, face: 'display', steps: [2, 3, 4, 5], maxLines: 5, pad: 24, gap: 20, share: 1, radius: 0, bold: 600, me: { fill: '#ffffff', text: 'ink' }, them: { fill: '#ffffff', text: 'ink' }, card: { fill: '#ffffff', text: 'ink' }, discs: ['accent2', 'cat2', 'cat3'], discText: 'paper', dots: 'ink2', title: 'ink', line: 'ink2', lineWidth: 2, shadow: false },
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

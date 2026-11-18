// The `cosmos` look: flat vector science explainer. Deep navy to violet, saturated shapes, one glowing accent, a rounded
// sans (Nunito). No characters or mascots: scenes are shapes, scale and light. Plain data plus one pure function;
// index.mjs freezes and registers it.
const DISPLAY_TIGHT_FROM = 136; // units: display type at or above this size is tracked in (a rounded face sets loose)
const DISPLAY_TIGHT = -0.01; // em
const LABEL_TRACKING = 0.01; // em: labels are sentence case, so barely tracked
const ROLES = ['display', 'text', 'label'];
// Entrances: a small overshoot at the end (about 10% of the move). Not an in-out back curve: that one backs off below
// its start before it moves, which held every fading entrance at nothing for its first frames (seen on the sheets).
const SMOOTH = 'outBack';
const PLAIN = 'inOutCubic';

// tracking(sizeUnits, role = 'display') -> em
function tracking(sizeUnits, role = 'display') {
  if (role === 'display') return sizeUnits >= DISPLAY_TIGHT_FROM ? DISPLAY_TIGHT : 0;
  if (role === 'text') return 0;
  if (role === 'label') return LABEL_TRACKING;
  throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
}

export const cosmos = {
  name: 'cosmos',
  summary: 'Flat vector science explainer: deep navy to violet, saturated shapes, one glowing accent and a rounded sans. Serves pro and viral.',
  modes: ['pro', 'viral'],
  // listed again: parked after gate review 3, un-parked when the final gate review passed it (ship after fixes, no shot
  // failing). It ships the kinds it has data for; a kind it has none for is refused with the looks that support it.
  fonts: {
    display: { family: 'Nunito', weight: 800, width: 'normal' },
    text: { family: 'Nunito', weight: 600, width: 'normal' },
    label: { family: 'Nunito', weight: 700, width: 'normal' },
  },
  // paper is the field's LIGHTER end (violet), deep its darker top: the review's contrast rule reads the field as its
  // paper, so it measures text against the worse end. shape and shape2 are the two mark colours of charts and compare.
  // No second hue: accent2 (a key every look carries) is the lavender, so gold stays the one colour of light.
  palette: {
    paper: '#2a1a5e', deep: '#0b1030', ink: '#f4f1ff', ink2: '#a9a4d6', accent: '#ffd166', accent2: '#a9a4d6',
    shape: '#ff6b9a', shape2: '#6ea8ff', rule: '#3d3478',
  },
  scale: [32, 46, 76, 136, 232],
  grid: { columns: 12, margin: 96, gutter: 24 },
  // on 9:16 the composition band, as shares of the height, inside the platform sides (pop's band: the platform safe
  // zone's own bottom would leave the lower half of a vertical frame empty)
  // (gate review c5: 8 of 9 tall shots left their bottom 25 to 45 percent bare; the band's foot, at 0.75, was 1440 px, and
  // the caption pill stands on it, so a captioned shot's content ended near 1316. The foot is now 0.84, 1613 px)
  band: { top: 0.15, bottom: 0.84 },
  // the slug (kinds/slug.mjs) is a square rounded chip: no turn, its kicker on one line up to five columns
  slug: { turn: 0, maxColumns: 5 },
  tracking,
  caps: { display: false, label: false },
  lineHeight: { display: 1.1, text: 1.3 },
  maxLines: { display: 4, text: 3 },
  // on a tall frame a statement may take five lines: Nunito is wide, and in four the hook was set at 90 px (15% of the frame)
  maxLinesTall: { display: 6 },
  wordsPerLine: { text: 12 },
  // one minimum size for secondary text (labels, units, source, attribution, ask: kinds/secondary.mjs), 1.6 times the
  // smallest the kinds set before it (32 units), so it reads on a phone tile; heroes keep 3 times over it
  secondary: { min: 52 },
  // the gradient deep -> paper, a soft lift behind the hero, a slow bloom of light low on the field at 8% (depth from
  // light), two drifting star layers and a few larger soft stars nearer the camera (glints: depth), a faint vignette
  // (engine/fields/cosmos.mjs)
  field: { field: 'cosmos', params: { bloom: 0.08, glints: 9 } },
  // statements flush left on grid columns: the editorial family desk uses, which already sets a large hero on the grid
  // with its kicker top left (Task 3 restyles that kicker as a pill)
  composition: 'editorial',
  // the emphasised words take the accent and their glyphs glow (engine/devices/glow.mjs, screened in draw.mjs): a warm
  // gold light at alpha 0.45, its radius a third of the cap height up to `maxRadius` units, so a figure's counters keep
  // the field (a 232 px 0 is at most 1.15 times as light inside, and the accent keeps 3:1 beside it: measured in
  // cosmos-glow-browser.test.mjs)
  emphasis: 'glow',
  // every colour fade (a word lighting, a dim, a side turning) is mixed in OKLCH (engine/color/oklab.mjs): no khaki
  colorSpace: 'oklab',
  // a viral hook opens at full contrast (frame 0 is the scroll-stopper and the thumbnail): no ghosted words, the
  // emphasised ones lighting by the glow as they are spoken
  hookInk: true,
  glow: { color: '#ffb040', alpha: 0.45, capShare: 1 / 3, maxRadius: 24 },
  // the light source (engine/devices/sun.mjs): one sun drawn as light (a hot near-white core, the accent gold body and a
  // deeper gold limb, a bloom falling to nothing), anchored per format for the statement, number and end kinds
  // (frame-left on 16:9, high and centred on 9:16), at the list path's start, and at scale as the compare's large disc
  // `base`: the accent these colours are designed against; a film's accent override moves them all by the same offset
  sun: {
    // anchors (gate round 3): on 16:9 the whole light inside the frame (x at its radius: no glow cut by the left edge);
    // on 9:16 at 17% of the height, below the feed's status bar and account row; `clear`: a text beside the sun starts
    // this share of the light's radius right of its centre (sun.mjs besideSun), past the disc and the bright bloom
    base: '#ffd166', core: '#fff7e3', color: '#ffd166', limb: '#ffbe3d', disc: 0.3, bloom: 0.42, lift: 0.8, clear: 0.75,
    anchor: { wide: { x: 0.125, y: 0.5, r: 240 }, tall: { x: 0.5, y: 0.17, r: 220 } },
    body: { bloom: 0.05 },
  },
  // the one Earth mark (sun.mjs earthNodes): a small blue dot with a lavender ring, wherever Earth is drawn (the number's
  // line, the to-scale compare, the quote's pale blue dot); 28 units across, the compare's smallest disc
  earth: { color: 'shape2', ring: 'ink2', r: 14, gap: 12, width: 4 },
  moves: {
    enter: { ease: SMOOTH, dur: 0.55, scale: 0.92 },
    exit: { ease: PLAIN, dur: 0.3 },
    emphasize: { ease: PLAIN, dur: 0.4 },
    draw: { ease: PLAIN, dur: 0.6 },
    count: { ease: PLAIN, dur: 0.9 },
    // the second-wave named moves (engine/moves): the look uses the two its second-wave kinds ask for, the screen's card
    // (`pop`, the enter spring) and a part settling into place (`settle`, a plain ease: the data never overshoots)
    rise: null, wipe: null, slam: null, pop: { ease: SMOOTH, dur: 0.55, scale: 0.92 }, settle: { ease: PLAIN, dur: 0.6 },
  },
  wordStagger: 0,
  // the resting camera: a slow linear drift across each shot (the 'desk' camera style), no shake
  camera: { drift: 10, style: 'desk' },
  // every registered cut may be named; the palette is cosmos's own set, in its order, cutStyle its defaults per cut
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'],
  cutPalette: ['cut', 'match', 'crossfade', 'fade', 'iris', 'ripple'],
  cutStyle: {},
  keyline: 8,
  // a soft shadow in a darker navy: depth from light, not from paper
  shadow: { dx: 0, dy: 12, blur: 32, alpha: 0.35, color: '#05081c' },
  // Styling for the devices this look draws. Colours are palette keys (or #rrggbb), sizes are units. Every style is
  // smooth and round: no tilt, no tape, no hand wobble, no stepped frames.
  devices: {
    // a neon pill: the deep navy at `alpha` behind the phrase, and round it a soft accent glow (screened, so it only
    // brightens) whose edge falls off over `glow` units. An accent pill at an alpha read as a brown band (rendered).
    highlight: { shape: 'pill', color: 'deep', alpha: 0.85, glowColor: 'accent', glowAlpha: 0.6, glowBlend: 'screen', glow: 24 },
    circle: { color: 'accent', width: 6, cap: 'round' },
    underline: { color: 'accent', width: 6, cap: 'round' },
    arrow: { color: 'ink', width: 8, cap: 'round' },
    // a rounded panel a step lighter and bluer than the violet field, with a faint inner sheen and a lighter edge
    // with a faint ground glow of ink2 light behind it (`ground`: alpha, blur and dy units): depth from light
    // (c6) `sheen: false`: one tone (the lighter top was the "tone step" across the map sheet and the code panel)
    card: { edge: 'rounded', radius: 28, sheen: false, fill: '#2e2770', ground: { color: 'ink2', alpha: 0.3, blur: 64, dy: 28 } },
    // a lavender pill: gold is for the frame's one focal element, never chrome
    tag: { shape: 'pill', fill: 'ink2', text: 'deep' },
    // a picture keyed in the card's colour, so it sits on its rounded card with no white frame
    cutout: { keylineColor: '#2e2770' },
    // what recedes goes under a scrim of the deep navy: a field-coloured scrim
    focus: { dim: 0.6, scrim: 'deep' },
    // a route (the map kind) is light crossing the sky: a gold line with round caps; a place or part name in ink on a
    // lavender leader ending in a dot
    route: { color: 'accent', width: 4, cap: 'round' },
    label: { text: 'ink', line: 'ink2', width: 2, dot: 6 },
  },
  // The caption style (registries.captions, engine/captions/pill.mjs): the spoken words on one line in a pill at the
  // bottom of the grid, each word in the accent while it is spoken.
  captions: 'pill',
  // Composition data for the kinds that read it (engine/kinds/end.mjs, list.mjs, quote.mjs, compare.mjs, chart.mjs), in
  // the editorial family's terms (desk.mjs explains each field); sizes are units, shares, em or 1-based scale steps.
  kinds: {
    // statement (optional data, statement.mjs): on a wide frame across columns 2 to `toWide` in at most `linesWide` lines when
    // that fits, emphasised phrases kept whole (`together`); on a tall one from column `tallFrom`, up to `tallHeight` of the
    // band; the look's sun behind the emphasis (`sun`: share of the short side, offset of its radius right of the
    // phrase, strength)
    // (gate round 3) `fromSun`: on a wide frame from the column the sun leaves free (sun.mjs besideSun) to `toWide`, so
    // the sun has a column of its own; on a tall one centred on the sun's axis (`tallAlign`) in the band under its disc
    statement: { toWide: 12, fromSun: true, tallAlign: 'center', linesWide: 2, together: true, tallFrom: 1, tallHeight: 0.92, sun: { strength: 1 } },
    // clipping (optional data, clipping.mjs): the picture on the look's rounded `card`, square (`turn` 0), with a soft
    // accent `glow` (units of blur) round the card, and a region's marker frame round-cornered (`mark`: radius, width units)
    clipping: { card: true, turn: 0, glow: 26, mark: { radius: 18, width: 6 } },
    // number (optional data, number.mjs deskParts): `sky`, the composition on the sky (number-sky.mjs: a measured line
    // from the sun to the Earth mark, the figure over it and the label under it on a wide frame, both in a break of it
    // on a tall one, light travelling the line as the figure counts; units: `above` the figure's baseline over a wide
    // line, `labelGap`, the line's `width` and `gap`, the travelling `light`'s radius; `fit` the figure's share of the
    // line; `out` seconds the light takes to go out at Earth), the figure's glyph `glow` as it lands, and the figure
    // down to scale step `fromStep` (a three-digit figure in the 9:16 safe zone); `affix` 'baseline': a unit sits on the
    // figure's baseline (never an exponent); `countAlign` 'right': a count grows leftward from the unit; `fromFirst`: a
    // count opens on its first non-zero step
    // (gate review 4, glow only on light) `glow` false: the figure carries none; the light is the sun and the line
    number: { sky: { labelStep: 3, labelGap: 48, above: 56, line: { width: 4, gap: 28 }, light: 30, fit: 0.86, out: 0.35 }, glow: false, besideGap: 64, fromStep: 4, affix: 'baseline', countAlign: 'right', fromFirst: true },
    // end: as desk's, square (`turn` 0), and a slow `ring` round the mark's chip (end.mjs ringNodes: `gap` and `width`
    // units, drawing on over `dur` s); from step 3 so the closing line fits the narrow 9:16 safe zone
    end: { fromStep: 3, max: 280, toWide: 11, toTall: 12, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: 0, ring: { gap: 14, width: 3, dur: 1.6 },
      // a real end card (end-mark.mjs): the line centred, the ask `askGap` em under its descenders, the mark a wordmark in
      // the display weight at `markShare` of the title with no outline, the sun on its anchor; the shot's tail at least
      // `tail` s after the last word (engine/script/timing.mjs) so the finished card holds
      // (c6) `setOnOpen`: the line, the ask and the mark are all set on frame 0; `titleHeightTall`: on a tall frame the line may
    // take 0.6 of the band (at the hero floor Nunito sets a closing line in three or four lines, which 0.42 could not hold)
    wordmark: { setOnOpen: true, titleHeightTall: 0.6, tail: 2.8, titleHeight: 0.42, markShare: 0.32, askGap: 0.35, gap: 0.55, centre: 0.5, sun: { strength: 0.8 } } },
    // list: as desk's, with a dot rail in place of figures (list-desk.mjs dotRail): a dot per item in a `column` units
    // wide at the span's left, `radius` units, on a rail `line` units wide; the current item's dot lit in the accent; the
    // items shown from frame 0 in ink2 and lit while current (`previews`), no slug badge (`slug` false), light travelling
    // down the rail from the sun at its start (`dots.light`: sun radius units, strength, and the `gap` units between its
    // disc and the first item's dot: the sun is a node of its own above the first item), on a tall frame spread down the
    // content band (`fillTall`, within `roomTall` of it) so the path runs its height
    list: { fromStep: 3, max: 180, toWide: 11, toTall: 12, maxLines: 3, gap: 0.75, gapTall: 1.5, roomTall: 0.9, fillTall: true, noteGap: 0.3, smallSteps: [1, 2], previews: true, slug: false, dots: { column: 72, radius: 13, line: 6, light: { sun: 160, strength: 0.7, gap: 40 } } },
    // quote: as desk's, with large accent opening and closing marks `mark` times the quotation's size, short sentences one
    // per line (`sentenceLines`), the attribution plain lavender text (`attrFill`, no rule), the card growing with the text
    // (`grow`)
    // (gate round 3) `card` false: plain type on the field, no card (a frosted card read as a web component); the marks
    // in `markFill`, the lavender (gold is only for light); `earth`: the pale blue dot hung before the attribution
    quote: { toWide: 12, fromTall: 1, toTall: 12, centre: 0.5, pad: 40, max: 200, maxLines: 8, attrGap: 0.35, rule: 0, ruleGap: 0, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3, mark: 1.6, sentenceLines: { words: 6 }, attrFill: 'ink2', centred: true, card: false, markFill: 'ink2', earth: true },
    // compare: as desk's, with the vs as a pill (`vs`), the values in the accent (`valueAccent`), points without a dash
    // (`plainPoints`), the cards at least `fill` of the height they could take with their copy centred, on the optical
    // centre (`centre`), and the spoken card's rim light (`rim`: alpha, blur units) moving to the other card at the turn
    // with two numeric values the compare draws scale (compare-discs.mjs `discs`): discs in the true ratio, the smaller at
    // least `minDot` units with a `ring`, the larger the sun at scale off the frame from `edge`, one headline with it;
    // under `minRatio` the cards (near equal discs read as two equal circles), a ratio at or over `maxRatio` printed as
    // "<more> <maxRatio>", the larger disc at most `bigCap` times the room
    // (gate round 3) the discs staged as a reveal: the smaller side from the first frame, the sun growing in from the
    // edge over `reveal` s at the turn, the headline's words lighting `stagger` s apart; the headline names its subject
    // (`subject`), `groupGap` em of the headline between the groups
    // (gate review 4) `plain`: the smaller disc is the Earth's blue alone, no ring: a measured body, drawn to scale
    compare: { discs: { plain: true, minDot: 28, fill: 0.8, wide: { edge: 0.66 }, tall: { edge: 0.62 }, gap: 12, groupGap: 0.3, valueStep: 3, ratioStep: 4, ring: { gap: 14, width: 4 }, minRatio: 2, maxRatio: 1e9, more: 'more than', bigCap: 20, subject: true, reveal: 1.2, stagger: 0.12 }, vs: 'pill', valueAccent: true, plainPoints: true, fill: 0.62, rim: { alpha: 0.45, blur: 34 }, gap: 6, centre: 0.46, pad: 48, valueFromStep: 4, valueMax: 220, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 220, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1, picture: 0.4, pictureGap: 32 },
    // chart: as desk's, the marks in a shape colour (`marks`: one series, one colour; alternating read as categories),
    // far ends rounded at `round` units (half the width read as domes, rendered), and the highlighted mark in the accent with `glow` units of soft light round it
    // (chart-draw.mjs); every mark labelled directly (`direct`, `refs` false: no axis, gridlines or ticks), marks `fill` of
    // their band, labels at step 2, the source at step 1 (both at least the secondary floor) and `sourceGap` gaps apart; the
    // marks grow in the lavender, gold only the highlighted one (`dimTo`: the others stay the one lavender dim); on a tall
    // frame each bar's label over it so the bars take the full safe width (`labelsAbove`)
    // `titleMargin`: the claim at least this many times three times the labels (a hair over, so rounding never takes it
    // under; desk and pop fit it from exactly three times); `minPlot` as desk's
    // (gate round 3) the data owns the frame: labels on a wide frame at 1.7 times step 2 (78 units, 1.5 times the
    // floor: readable on the phone tile), the claim held at three times the smallest text (`titleFloor` 'smallest': the
    // quieter source), so it is smaller than the chart; the highlighted bar lights in ink (`hlFill`), gold only in the
    // light round it; on a tall frame the claim from column 1 (`titleFromTall`), on the plot's left edge
    chart: { titleToWide: 12, titleToTall: 12, titleFromTall: 1, titleMax: 168, titleLines: 4, titleGap: 56, labelStep: 2, labelScale: 1.7, sourceStep: 1, sourceGap: 5, gap: 14, line: 6, ref: 2, axis: 3, dim: 0.65, refs: false, direct: true, fill: 0.8, fillTall: 0.65, dimTo: 'ink2', marks: ['ink2'], growEase: 'outCubic', labelsAbove: 'tall', round: 16, glow: 22, minPlot: 0.4, titleMargin: 1.03, titleFloor: 'smallest', hlFill: 'ink' },
    // The second-wave kinds (the looks phase), in cosmos's own vocabulary: the rounded card (`devices.card`), the lavender
    // for chrome and the deep navy for what recedes, gold only for light (a lit item, a route, a pin), the blue and pink
    // shapes for data marks.
    // media: the picture as shot (no treatment), its caption set whole from frame 0 on the rounded card (`setOnOpen`: no
    // card holding one word)
    media: { setOnOpen: true, treatment: 'none', push: 1.04, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 40, toWide: 6, toTall: 12, besideFrom: 8, gap: 48 },
    // screen: the screen in a rounded frame on the card's violet with the lavender window dots and the deep navy address
    // pill; what recedes under a deep-navy mask at 0.9 (`pushDim`) as the camera pushes in. No `ring`: cosmos's circle is an
    // ellipse, which ran across the lifted card and its heading on the 16:9 sheet
    screen: { pushDim: 0.9, fill: '#2e2770', line: 'rule', lineWidth: 2, dots: 'ink2', pill: 'deep', text: 'ink', urlText: 'ink2', wideShare: 0.78, gap: 56 },
    // map: the land a step lighter than its rounded card, the borders in the card's violet, the highlighted region and the
    // pins lit in the accent, place names in the label face, the places keyed on a tall frame in lavender discs
    map: { wholeTall: true, card: true, land: '#4d4296', borders: '#2e2770', borderWidth: 1.2, highlight: 'accent', multiply: false, pin: 'accent', labelFace: 'label', titleAbove: true, titleFit: true, titleHeight: 0.3, titleStepsWide: [5], titleTo: 5, titleSteps: [5], listGap: 10, gap: 40, keyFill: 'ink2', keyText: 'deep' },
    // diagram: rounded nodes, lavender arrows, edge labels on a deep plate
    // (c6) `current` + `litRing`: the step being spoken is ringed in the accent with a screened glow (the motif: light marks the
    // active item); the arrows are 8 units with 34-unit heads, so they read on a phone tile
    diagram: { openNodes: 8, fullColumn: 'room', card: true, steps: [4, 3, 2, 1], maxLines: 2, pad: 28, gap: 48, margin: 10, platePad: 8, plate: 'deep', arrow: 'ink2', arrowWidth: 8, head: 34, text: 'ink', edgeText: 'ink2', titleSteps: [5, 4, 3], titleGap: 48, dim: 0.35, current: true, litRing: { color: 'accent', width: 6, glow: 28, alpha: 0.5 }, advance: 0.55 },
    // timeline: a lavender line with its ticks, every event set from frame 0 and the spoken one lit
    // `whenSizes`: dates at 140 units, between the scale's 136 and 232 (136 is under three times the events' 46, and 232
    // does not fit a column on 16:9: measured with the fake measure, 14.5 units of overlap)
    // (c6) `discs`: each event sits on a 14-unit disc node (not a hairline tick), gold with a screened halo while it is spoken
    timeline: { discs: { radius: 14, glow: { reach: 26, alpha: 0.5, color: 'accent' } }, previews: true, whatFace: 'text', whenSteps: [5, 4], whenSizes: [168, 160], whatSizes: [56, 52], whatSteps: [2], whenLines: 2, whatLines: 3, gap: 24, inset: 16, lineGap: 28, lineX: 12, textGap: 48, partGap: 12, line: 'ink2', lineWidth: 4, tick: 18, titleSteps: [5, 4], titleGap: 48, advance: 0.55 },
    // code: on the rounded panel, the tokens in the blue and pink shapes and the lavender, the lit line on a violet band
    code: { heroInset: 10, cardWide: true, setOnOpen: true, font: { family: 'JetBrains Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.4, pad: 48, steps: [2, 3], card: true, roles: { plain: 'ink', keyword: 'shape2', string: 'shape', number: 'shape2', comment: 'ink2', name: 'ink', punct: 'ink2' }, highlight: { band: '#352d6e', multiply: false }, removed: 'shape', added: 'shape2', strike: 4, prompt: 'ink2', heroAdvance: 0.5 },
    // feed: rounded bubbles in two violets, the app's disc in a shape colour, every message set from frame 0, the spoken
    // one in ink and the others in lavender
    feed: { lit: { spoken: 'ink', other: 'ink2' }, face: 'display', titleFace: 'label', steps: [2, 3, 4], maxLines: 4, pad: 28, gap: 20, share: 0.82, radius: 36, bold: 700, me: { fill: '#3a3180', text: 'ink' }, them: { fill: '#2e2770', text: 'ink' }, card: { fill: '#2e2770', text: 'ink' }, discs: ['shape', 'shape2', 'ink2'], discText: 'deep', dots: 'ink2', title: 'ink2', lineWidth: 0, shadow: false },
  },
  post: { grain: 0.01, halftone: 0, bloom: 0 },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: null, slide: 'whoosh', punch: 'sub', match: null, cover: null, crossfade: null, fade: null, wipe: null, iris: 'whoosh', zoom: null, blur: null, ripple: 'whoosh', cube: null,
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': null, wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': null, pixelize: null, 'water-drop': null, erase: null },
    device: {
      highlight: 'chime', circle: 'chime', underline: 'chime', arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: null, item: 'pop', turn: 'whoosh',
      // the second-wave devices: silent in the parked look
      label: null, focus: null, route: null, numeral: null, sticker: null, sweep: null, duotone: null, halftone: null, zoom: null, pin: null, link: null,
      node: null, event: null, change: null, output: null, message: null,
    },
    emphasis: null,
    land: 'ding',
  },
};

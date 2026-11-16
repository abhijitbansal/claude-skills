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
  fonts: {
    display: { family: 'Nunito', weight: 800, width: 'normal' },
    text: { family: 'Nunito', weight: 600, width: 'normal' },
    label: { family: 'Nunito', weight: 700, width: 'normal' },
  },
  // paper is the field's LIGHTER end (violet), deep its darker top: the review's contrast rule reads the field as its
  // paper, so it measures text against the worse end. shape and shape2 are the two mark colours of charts and compare.
  palette: {
    paper: '#2a1a5e', deep: '#0b1030', ink: '#f4f1ff', ink2: '#a9a4d6', accent: '#ffd166', accent2: '#4de2c5',
    shape: '#ff6b9a', shape2: '#6ea8ff', rule: '#3d3478',
  },
  scale: [32, 46, 76, 136, 232],
  grid: { columns: 12, margin: 96, gutter: 24 },
  // on 9:16 the composition band, as shares of the height, inside the platform sides (pop's band: the platform safe
  // zone's own bottom would leave the lower half of a vertical frame empty)
  band: { top: 0.15, bottom: 0.75 },
  // the slug (kinds/slug.mjs) is a square rounded chip: no turn, its kicker on one line up to five columns
  slug: { turn: 0, maxColumns: 5 },
  tracking,
  caps: { display: false, label: false },
  lineHeight: { display: 1.1, text: 1.3 },
  maxLines: { display: 4, text: 3 },
  // on a tall frame a statement may take five lines: Nunito is wide, and in four the hook was set at 90 px (15% of the frame)
  maxLinesTall: { display: 5 },
  wordsPerLine: { text: 12 },
  // the gradient deep -> paper, a soft lift behind the hero, a slow bloom of light low on the field at 8% (depth from
  // light), two drifting star layers, a faint vignette (engine/fields/cosmos.mjs)
  field: { field: 'cosmos', params: { bloom: 0.08 } },
  // statements flush left on grid columns: the editorial family desk uses, which already sets a large hero on the grid
  // with its kicker top left (Task 3 restyles that kicker as a pill)
  composition: 'editorial',
  // the emphasised words take the accent and their glyphs glow (engine/devices/glow.mjs, screened in draw.mjs): a warm
  // gold light at alpha 0.45, its radius a third of the cap height up to `maxRadius` units, so a figure's counters keep
  // the field (a 232 px 0 is at most 1.15 times as light inside, and the accent keeps 3:1 beside it: measured in
  // cosmos-glow-browser.test.mjs)
  emphasis: 'glow',
  glow: { color: '#ffb040', alpha: 0.45, capShare: 1 / 3, maxRadius: 24 },
  moves: {
    enter: { ease: SMOOTH, dur: 0.55, scale: 0.92 },
    exit: { ease: PLAIN, dur: 0.3 },
    emphasize: { ease: PLAIN, dur: 0.4 },
    draw: { ease: PLAIN, dur: 0.6 },
    count: { ease: PLAIN, dur: 0.9 },
  },
  wordStagger: 0,
  // the resting camera: a slow linear drift across each shot (the 'desk' camera style), no shake
  camera: { drift: 10, style: 'desk' },
  cuts: ['cut', 'match'],
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
    card: { edge: 'rounded', radius: 28, fill: '#2e2770', ground: { color: 'ink2', alpha: 0.3, blur: 64, dy: 28 } },
    tag: { shape: 'pill', fill: 'accent', text: 'deep' },
    // a picture keyed in the card's colour, so it sits on its rounded card with no white frame
    cutout: { keylineColor: '#2e2770' },
    // what recedes goes under a scrim of the deep navy: a field-coloured scrim
    focus: { dim: 0.6, scrim: 'deep' },
  },
  // The caption style (registries.captions, engine/captions/pill.mjs): the spoken words on one line in a pill at the
  // bottom of the grid, each word in the accent while it is spoken.
  captions: 'pill',
  // Composition data for the kinds that read it (engine/kinds/end.mjs, list.mjs, quote.mjs, compare.mjs, chart.mjs), in
  // the editorial family's terms (desk.mjs explains each field); sizes are units, shares, em or 1-based scale steps.
  kinds: {
    // clipping (optional data, clipping.mjs): the picture on the look's rounded `card`, square (`turn` 0), with a soft
    // accent `glow` (units of blur) round the card, and a region's marker frame round-cornered (`mark`: radius, width units)
    clipping: { card: true, turn: 0, glow: 26, mark: { radius: 18, width: 6 } },
    // number (optional data, number.mjs deskParts, number-orbit.mjs): an `orbit` round the figure (a tilted ellipse
    // `tilt` degrees, minor axis `ratio` of the major, `air` past the cap box's corners, a `width`-unit stroke, faint
    // until the landing then lit, a `dot`-unit bright dot circling once as the figure counts), the figure's glyph `glow`
    // as it lands, the label `besideGap` units clear of the orbit, and the figure down to scale step `fromStep` (a
    // three-digit figure in the 9:16 safe zone); `sameDigits`: a count runs within the final digit count (150 from 100)
    number: { orbit: { tilt: -14, ratio: 0.42, air: 0.1, width: 4, dot: 9, faint: 0.4, lit: 0.9 }, glow: true, besideGap: 64, fromStep: 4, sameDigits: true },
    // end: as desk's, square (`turn` 0), and a slow `ring` round the mark's chip (end.mjs ringNodes: `gap` and `width`
    // units, drawing on over `dur` s); from step 3 so the closing line fits the narrow 9:16 safe zone
    end: { fromStep: 3, max: 280, toWide: 11, toTall: 12, height: 0.56, centre: 0.5, askGap: 0.42, askSteps: [2, 3], markSteps: [1, 2], turn: 0, ring: { gap: 14, width: 3, dur: 1.6 } },
    // list: as desk's, with a dot rail in place of figures (list-desk.mjs dotRail): a dot per item in a `column` units
    // wide at the span's left, `radius` units, on a rail `line` units wide; the current item's dot lit in the accent
    list: { fromStep: 3, max: 180, toWide: 11, toTall: 12, maxLines: 3, gap: 0.75, noteGap: 0.3, smallSteps: [1, 2], dots: { column: 64, radius: 12, line: 3 } },
    // quote: as desk's, with a large accent opening mark `mark` times the quotation's size standing over it, and
    // the attribution in a pill (`pill`: padding in em of the attribution) in place of the rule
    quote: { toWide: 10, fromTall: 1, toTall: 12, centre: 0.5, pad: 56, max: 200, maxLines: 8, attrGap: 0.55, rule: 56, ruleGap: 18, attrSteps: [1, 2], portrait: 0.28, overlap: 0.3, mark: 2.4, pill: { padX: 0.6, padY: 0.3 } },
    // compare: as desk's, with the vs as a pill (`vs`), the values in the accent (`valueAccent`), points without a dash
    // (`plainPoints`), the cards at least `fill` of the height they could take with their copy centred, on the optical
    // centre (`centre`), and the spoken card's rim light (`rim`: alpha, blur units) moving to the other card at the turn
    compare: { vs: 'pill', valueAccent: true, plainPoints: true, fill: 0.62, rim: { alpha: 0.45, blur: 34 }, gap: 6, centre: 0.46, pad: 48, valueFromStep: 4, valueMax: 220, valueGap: 0.3, valueTitle: 0.55, titleFromStep: 3, titleMax: 220, titleLines: 4, titleGap: 0.45, pointStep: 2, pointScale: 1, picture: 0.4, pictureGap: 32 },
    // chart: as desk's, the marks in a shape colour (`marks`: one series, one colour; alternating read as categories),
    // far ends rounded at `round` units (half the width read as domes, rendered), and the highlighted mark in the accent with `glow` units of soft light round it
    // (chart-draw.mjs); every mark labelled directly (`direct`, `refs` false: no axis, gridlines or ticks), marks `fill` of
    // their band, labels at step 2, the source small at step 1 and `sourceGap` gaps apart; dimmed marks keep 0.65 (3:1)
    chart: { titleToWide: 12, titleToTall: 12, titleMax: 150, titleLines: 3, titleGap: 56, labelStep: 2, labelScale: 1, sourceStep: 1, sourceGap: 5, gap: 14, line: 6, ref: 2, axis: 3, dim: 0.65, refs: false, direct: true, fill: 0.8, marks: ['shape2'], round: 16, glow: 22 },
  },
  post: { grain: 0.01, halftone: 0, bloom: 0 },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: null, slide: 'whoosh', punch: 'sub', match: null },
    device: { highlight: 'chime', circle: 'chime', underline: 'chime', arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: null, item: 'pop', turn: 'whoosh' },
    emphasis: null,
    land: 'ding',
  },
};

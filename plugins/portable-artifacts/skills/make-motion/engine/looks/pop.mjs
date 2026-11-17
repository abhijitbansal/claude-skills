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
    // wordSpace 0.18 em: the face's own space is about 7% of the cap height and runs caps words together; at 0.26 a
    // line set large read as stretched (look review 1), so a plain word space wide enough to part caps words
    display: { family: 'Archivo', weight: 900, width: 'extra-condensed', wordSpace: 0.18 },
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
  // the stack: no line more than `ratio` times its neighbour (lines fill by size only); on a tall frame the block's
  // middle on `centre` of the composition area's height, its optical centre (a wide frame centres it)
  // and a viral hook (the first statement) set a word a line when that is larger, within `hook` of the height; a stack
  // shorter than `grow` of its area is broken finer (more lines, larger type) until it reaches it; at most two sizes
  stack: { ratio: 1.35, centre: 0.45, hook: 0.4, grow: 0.55 },
  // on 9:16 the composition band, as shares of the height, inside the platform sides (look review 2)
  band: { top: 0.15, bottom: 0.75 },
  // emphasis recolours a word; the stack's size contrast is the hierarchy, so nothing scales
  emphasis: 'recolor',
  moves: {
    enter: { ease: 'spring(260,16)', dur: 0.28, scale: 0.6 },
    exit: { ease: 'inCubic', dur: 0.15 },
    emphasize: { ease: 'spring(300,12)', dur: 0.2, scale: 1.12 },
    draw: { ease: 'outExpo', dur: 0.2 },
    count: { ease: 'outExpo', dur: 0.6 },
    // the named moves the second-wave kinds use (engine/moves/index.mjs): pop is the enter move; rise and wipe are fast;
    // slam lands from 1.6 times its size on a stiff spring; settle springs into a new place
    rise: { ease: 'outExpo', dur: 0.2, dist: 40 },
    wipe: { ease: 'outExpo', dur: 0.18 },
    slam: { ease: 'spring(320,20)', dur: 0.16, scale: 1.6 },
    pop: { ease: 'spring(260,16)', dur: 0.28, scale: 0.6 },
    settle: { ease: 'spring(200,22)', dur: 0.3 },
  },
  wordStagger: 0,
  camera: { drift: 0, style: 'locked' },
  // every registered cut may be named; the palette is pop's own set, in its order, cutStyle its defaults per cut
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'],
  cutPalette: ['cut', 'punch', 'slide', 'cover', 'zoom', 'polka-dots', 'glitch-memories', 'cross-zoom'],
  // the motion blur on the cuts that move (engine/cuts/smear.mjs)
  // the punch gets 0.3 s to land and settle (look review gate-cuts-1 P1: 0.2 s read as a 3% nudge)
  cutStyle: { slide: { smear: true }, cover: { smear: true }, punch: { smear: true, duration: 0.3 } },
  // a cover's sheet leads with a hard accent keyline: a shadow would not show on the dark paper
  coverEdge: { line: { color: 'accent', width: 6, alpha: 1 } },
  // a punch lands 1.25 times its size with a small overshoot; the smear's shutter is a quarter frame, half the
  // default, so a vertical slide does not stretch letters into striped bars (gate-cuts-1 P1, P2, P3)
  cutMotion: { punchZoom: 1.25, punchEase: 'outBack', smearShutter: 0.25 },
  keyline: 14,
  // the hard offset shadow in the accent (look review 1: the orange-red was the film's only second hue)
  shadow: { dx: 10, dy: 10, blur: 0, alpha: 1, color: '#d7ff3f' },
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
    // second-wave devices: a label in white with an accent leader; the paper scrim at 0.6 over all but the target; a thick
    // accent route whose head jabs; a white band of light (screened) for a glint on a screen
    label: { text: 'ink', line: 'accent', width: 4 },
    focus: { dim: 0.6 },
    route: { color: 'accent', width: 14 },
    sweep: { color: 'ink', alpha: 0.35 },
    // a photo as dots of the field colour on white, one every `cell` units (engine/devices/treatments.mjs)
    halftone: { dark: 'paper', light: 'ink', cell: 12 },
  },
  // The caption style (registries.captions, engine/captions): display caps flush left on the stack edge, low in the
  // platform safe zone, a few words at a time, the spoken word in the accent.
  captions: 'stack',
  // halftone 0: pop's own field is already a halftone, and the post pass would dot the pictures too (see the Look typedef)
  post: { grain: 0.02, halftone: 0, bloom: 0 },
  // Composition data for the kinds that read it (engine/kinds/end.mjs, list.mjs, quote.mjs, compare.mjs, chart.mjs);
  // sizes are units or 1-based scale steps.
  kinds: {
    // end: a stack (the mark as its tag), the ask an action: the look's tag in the accent at the largest of `askSteps` the
    // title's largest line stays three times (the hero rule judges it), `askGap` under the last title line (look review 2:
    // as a last headline line it did not read as an action)
    end: { askSteps: [1, 2, 3], askGap: 40 },
    // list: one item at a time as a stack under a count tag; a note in the text face at the largest of `smallSteps` the
    // stack stays three times, its cap line `noteGap` under the item
    list: { noteGap: 32, smallSteps: [1, 2] },
    // quote: a stack under an accent opening mark `mark` em of its first line tall, reaching `into` of its height into
    // the line (negative: that share of its height clear above it; look review 1 saw the mark's tail on the first
    // letters); the attribution a tag `tagGap` under it at the largest of `tagSteps` that fits; a portrait `portrait` of
    // the short side over the mark
    quote: { mark: 1.1, into: -0.15, tagGap: 40, tagSteps: [1, 2], portrait: 0.24 },
    // compare: one side at a time as a stack under its tag; the points `pointGap` under it at the largest of `pointSteps`
    // the stack stays three times
    // on a tall frame (`stackTall`) both sides at once, A over B `sideGap` apart, the unspoken one at `dim` opacity, a
    // value's size at most `valueTall` of a side's height
    compare: { pointGap: 32, pointSteps: [1, 2], picture: 0.3, pictureGap: 32, stackTall: true, sideGap: 64, dim: 0.35, valueTall: 0.3 },
    // chart: the claim as a tag at the largest of `tagSteps` that holds it on a line, the plot `tagGap` under it; the
    // highlighted value a numeral up to `numeralMax`, at most `numeralShare` of the plot's height and `numeralWidth` of its
    // width, top right in the plot with the marks `numeralGap` under it (a donut's: in the hole, `holeShare` of the ring);
    // labels at step `labelStep`, `gap` from what they label; lines `line` wide, the baseline `axis` wide; the other marks
    // dim to `dim`; no reference lines (`refs`): the values are labelled on the marks; a donut or line plot keeps at least
    // `minPlot` of its box however long its labels (chart-draw.mjs)
    // (`point`: a scatter point's radius in units, engine/kinds/chart-scatter.mjs)
    // `pointFace`: the race's and the scatter's labels in the condensed text face (one display system; the wide label
    // face is the tags' alone)
    chart: { pointFace: 'text', tagSteps: [2, 3], tagGap: 24, numeralMax: 320, numeralShare: 0.2, numeralWidth: 0.6, holeShare: 0.5, numeralGap: 24, labelStep: 1, gap: 18, line: 10, ref: 2, axis: 4, dim: 0.3, refs: false, minPlot: 0.4, point: 14 },
    // media (engine/kinds/media.mjs): as desk's, the bleed caption on the look's white plate (its card) in the safe zone
    // screen (engine/kinds/screen.mjs): a white frame with a thick white outline and the look's offset accent shadow; the
    // chrome's dots and pill in greys, its text in the field colour
    screen: { fill: 'ink', line: 'ink', lineWidth: 10, dots: 'rule', pill: 'ink2', text: 'paper', urlText: 'paper', wideShare: 0.8, gap: 44 },
    // map (engine/kinds/map.mjs): the land in the dark `rule` grey on the field (white land would take the white labels'
    // contrast), field-coloured borders, highlights in the accent, accent2 pins, the title as the look's tag above;
    // place names on stickers (`labelPlate`: white on the lime highlight did not read); on a tall frame numbered discs
    // in the field colour with a white ring (`keyLine`, `keyLineWidth` units) key the places listed under the map
    map: { card: false, land: 'rule', borders: 'paper', borderWidth: 1.5, highlight: 'accent', multiply: false, pin: 'accent2', titleTo: 4, titleSteps: [3], listGap: 12, gap: 36, labelPlate: 'sticker', keyFill: 'paper', keyText: 'ink', keyLine: 'ink', keyLineWidth: 4 },
    // diagram (engine/kinds/diagram.mjs): nodes as stickers (`pad` is the sticker's own), the node being spoken lit in
    // the accent (`current`: an accent plate, its words in the field colour) until the next arrives; thick accent arrows
    // that jab; edge labels in ink2 on a field-coloured plate; the title as the look's tag; values as desk's
    diagram: { card: false, steps: [4, 3, 2, 1], maxLines: 2, pad: 18, gap: 56, margin: 12, platePad: 10, plate: 'paper', arrow: 'accent', arrowWidth: 12, head: 34, text: 'ink', litText: 'paper', litFill: 'accent', edgeText: 'ink2', titleSteps: [3], titleGap: 40, dim: 0.35, current: true, advance: 0.48 },
    // timeline (engine/kinds/timeline.mjs): one event at a time, `when` in the accent over `what` in white (sizes as
    // desk's); a progress rail `rail` units deep along the room's edge: a `rule` line `ruleWidth` wide, `dot`-radius
    // dots in `dotFill`, the current one lit in `lit`, the highlighted one ringed `ring` times wider
    timeline: { whenSteps: [5, 4], whatSteps: [3, 2], whenLines: 2, whatLines: 3, rail: 48, dot: 12, ring: 1.7, rule: 'rule', ruleWidth: 4, dotFill: 'ink2', lit: 'accent', when: 'accent', what: 'ink', partGap: 24, gap: 24, titleSteps: [3], titleGap: 40, advance: 0.45 },
    // code (engine/kinds/code.mjs): a dark panel (`fill`) with a thick outline (`line`, `lineWidth` units) and the offset
    // accent shadow, `pad` units in, one size in `font` (pop has no mono of its own: the stage loads it for a code shot)
    // at the largest of `steps` that holds every line; roles in white and the two accents; a highlighted line on a
    // `highlight.band` with its words turned `highlight.text` (dark on the lime); diff signs in `removed` / `added`; on a tall frame
    // the title (or a run's command) is the hero over the card
    code: { font: { family: 'JetBrains Mono', weight: 400, width: 'normal' }, advance: 0.6, lineHeight: 1.4, pad: 32, steps: [2, 3], card: false, fill: 'paper', line: 'ink', lineWidth: 10, roles: { plain: 'ink', keyword: 'accent', string: 'accent2', number: 'accent2', comment: 'ink2', name: 'ink', punct: 'ink2' }, highlight: { band: 'accent', text: 'paper' }, removed: 'accent2', added: 'accent', strike: 6, prompt: 'accent', heroAdvance: 0.45 },
    // feed (engine/kinds/feed.mjs): thick-outlined bubbles (`line`, `lineWidth` units), `me` in the accent with dark words,
    // `them` dark with white words; one text size as desk's; notifications as dark cards; the frame is the look's own,
    // never a platform's
    feed: { steps: [2, 3, 4], maxLines: 4, pad: 26, gap: 24, share: 0.82, radius: 28, bold: 900, me: { fill: 'accent', text: 'paper' }, them: { fill: 'paper', text: 'ink' }, card: { fill: 'paper', text: 'ink' }, discs: ['accent', 'accent2', 'ink'], discText: 'paper', dots: 'ink', title: 'ink2', line: 'ink', lineWidth: 6, shadow: false },
    media: { treatment: 'halftone', push: 1.06, captionSteps: [4, 3, 2], captionLines: 2, heroSteps: [5, 4, 3, 2], maxLines: 3, cardPad: 28, toWide: 7, toTall: 12, besideFrom: 8, gap: 40 },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: 'click', slide: 'whoosh', punch: 'impact', match: null, cover: 'whoosh', crossfade: null, fade: null, wipe: 'whoosh', iris: null, zoom: 'whoosh', blur: null, ripple: null, cube: 'whoosh',
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': 'impact', wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': 'click', pixelize: 'click', 'water-drop': null },
    device: { highlight: 'pop', circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: 'impact', item: 'pop', turn: 'whoosh',
      label: null, focus: null, route: null, numeral: null, sticker: 'pop', sweep: 'whoosh', duotone: null, halftone: null, zoom: 'whoosh',
      pin: 'pop', link: 'whoosh', node: 'pop', event: 'pop', change: 'whoosh', output: 'click', message: 'pop' },
    emphasis: 'pop',
    land: 'sub',
  },
};

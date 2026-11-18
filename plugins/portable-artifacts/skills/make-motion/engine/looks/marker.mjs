// The `marker` look: a whiteboard time-lapse. A white board, one black marker, one red marker, Caveat in every role. A
// hand (engine/hand) draws every stroke on screen: text is written a line at a time through a clip the marker tip leads,
// boxes, underlines and arrows are drawn along their own points, and nothing fades in. One element is begun per sentence
// of the narration; between boards the hand erases (the `erase` cut). Plain data plus one pure function; index.mjs
// freezes and registers it, hidden (experimental) until its gate (looks-four plan, Task 14).
import { desk } from './desk.mjs';

const ROLES = ['display', 'text', 'label'];
// the grid per format (gridTall: index.mjs lookForFormat)
const GRID = Object.freeze({ columns: 12, margin: 110, gutter: 24 });
const GRID_TALL = Object.freeze({ columns: 12, margin: 80, gutter: 20 });
const SHEEN = 0.5; // the board's sheen strength (fields/board.mjs)
const STROKE = 'linear'; // every move is a stroke at a constant speed: nothing eases, nothing overshoots
const MARK_WIDTH = 7; // units: the marker's line
const PARKED_FROM_DESK = Object.freeze(['list', 'compare', 'diagram', 'feed']);

// tracking(sizeUnits, role = 'display') -> em: handwriting is not tracked
function tracking(sizeUnits, role = 'display') {
  if (!ROLES.includes(role)) throw new Error(`tracking role must be one of ${ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  return 0;
}

export const marker = {
  name: 'marker',
  summary: 'Whiteboard time-lapse: a hand draws every stroke in one black marker and one accent colour; nothing fades in; the hand erases between boards.',
  modes: ['pro'],
  experimental: true,
  // Caveat (engine/fonts, variable 400 to 700) in every role: display 700, text 600, label 600
  fonts: {
    display: { family: 'Caveat', weight: 700, width: 'normal' },
    text: { family: 'Caveat', weight: 600, width: 'normal' },
    label: { family: 'Caveat', weight: 600, width: 'normal' },
  },
  // paper is the board; ink the black marker; ink2 the same marker for notes; accent the red marker; rule the board's
  // frame and the erase smear (decoration, never text). accent2 is ink2, not a copy of the accent hex (a copy would stay
  // behind when a film overrides the accent): there is one accent colour.
  palette: { paper: '#fdfdfb', ink: '#1b1b1f', ink2: '#4a4a52', accent: '#d1321f', accent2: '#4a4a52', rule: '#e4e4df' },
  // Caveat's x-height is small, so every step is larger than the other looks'
  scale: [44, 60, 92, 150, 240],
  grid: GRID,
  gridTall: GRID_TALL,
  tracking,
  caps: { display: false, label: false },
  lineHeight: { display: 1.0, text: 1.2 },
  maxLines: { display: 3, text: 3 },
  wordsPerLine: { text: 12 },
  secondary: { min: 60 },
  field: { field: 'board', params: { margin: GRID.margin, marginTall: GRID_TALL.margin, sheen: SHEEN } },
  composition: 'editorial',
  slug: { style: 'tag' },
  // the hand draws one wobbling stroke in the accent under an emphasised word as it is spoken (kinds/emphasis.mjs)
  emphasis: 'underline',
  colorSpace: 'oklab',
  moves: {
    enter: { ease: STROKE, dur: 0.5 }, // the value used when a shot has no narration; the hand's strokes take the narration's time
    exit: { ease: STROKE, dur: 0 }, // a board leaves only by the erase
    emphasize: { ease: STROKE, dur: 0.3 },
    draw: { ease: STROKE, dur: 0.5 },
    count: { ease: STROKE, dur: 0.8 }, // written digit by digit, never rolling
    rise: { ease: STROKE, dur: 0.5 },
    wipe: { ease: STROKE, dur: 0.5 },
    slam: { ease: STROKE, dur: 0 }, // a pinned print is put on the board at once
    pop: { ease: STROKE, dur: 0.5 },
    settle: { ease: STROKE, dur: 0 },
  },
  wordStagger: 0,
  // locked: nothing on a whiteboard zooms. A region close-up (clipping) is a cut to a window of the source round the region
  // (ledger's values: a window 86 percent of the width between the margins, at most 70 percent of the height)
  camera: { drift: 0, style: 'locked', closeUp: { width: 0.86, height: 0.7, pad: 0.2, minGain: 1.25 } },
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop', 'erase'],
  cutPalette: ['cut', 'erase'],
  keyline: 6,
  shadow: { dx: 0, dy: 0, blur: 0, alpha: 0, color: '#1b1b1f' },
  // the drawing hand (engine/hand): the tip rests low on the right, outside the grid; `angle` hangs the hand 55 degrees
  // below the line it writes so no outline point is above the tip (the spike's covered-text finding); `wobble` bends
  // every stroke; `width` is the marker's line per stroke kind; `erase`: three passes, the smear stays 0.4 s
  hand: {
    rest: 0.3, maxSpeed: 2600, angle: 55, scale: 1, shape: 'hand',
    wobble: { amp: 2.4, wave: 46, step: 7 },
    width: { line: MARK_WIDTH, write: 6, fill: 5 },
    restAt: { wide: [0.95, 0.92], tall: [0.9, 0.94] },
    erase: { passes: 3, smear: 0.4 },
    colours: { skin: '#eec39d', shade: '#d9a680', outline: 'ink', barrel: '#2b2e33', cap: 'accent', nib: 'ink' },
  },
  // Every drawn mark is one stroke (`drawn`: devices/marks.mjs draws exact points, the hand's wobble bends them).
  // Declined (no style): highlight (the emphasis is the underline), focus (nothing dims on a whiteboard), duotone,
  // halftone, sweep, sticker, punch.
  devices: {
    underline: { drawn: true, color: 'accent', width: MARK_WIDTH, cap: 'round' },
    circle: { drawn: true, color: 'accent', width: MARK_WIDTH, cap: 'round', shape: 'box', pad: 10 },
    arrow: { drawn: true, color: 'accent', width: MARK_WIDTH, cap: 'round' },
    bracket: { drawn: true, color: 'ink', width: MARK_WIDTH, cap: 'round' },
    // a drawn box: the hairline card is the paper in the board's colour and an edge in ink (flattened by the hand to its outline)
    card: { edge: 'hairline', fill: 'paper', line: 'ink', width: 6 },
    // a drawn box round handwriting in ink2: the plate in the board's colour with an outline in ink
    tag: { fill: 'paper', text: 'ink2', outline: { color: 'ink', width: 5 } },
    // a pinned print: its keyline in the marker's ink, put on at once
    cutout: { keylineColor: 'ink' },
    // the close-up cut of a locked camera (clipping): barely a punch, as in ledger
    punch: { scale: 1.04, dur: 0.2 },
  },
  // handwriting in ink2 on the board's lower edge, no card (captions are opt-in in every mode)
  captions: 'lower',
  captionVariant: 'plain',
  post: { grain: 0.006, halftone: 0, bloom: 0 },
  // Composition data per kind. screen and code are excluded (no entry: a film asking for one is refused with the looks that
  // support it). Kinds that read data start from desk's (the same editorial composition, margins and steps).
  // PARKED in marker alone (experimental: true: they validate and render here, and are not listed), each measured on its
  // registered example by scripts/v2/review.mjs (the hand's findings are in the review, scripts/v2/review-hand.mjs); the
  // shortest path to finish each is in docs/decisions-pending.md:
  //   chart (race parked in it as well, a board can only change ranks by erasing): drawn bars, hatch fills and the axis look
  //     right on the sheets (.scratch/m1/out/kinds-wide.sheets/chart.png) but the example needs about 40 short strokes and
  //     their travels in one sentence: hand-speed (no time left to draw: the labels need a drawn-at-once form)
  //   list, quote, compare, number, feed, map, clipping, free: hand-speed (3000 to 140000 units a second against the 2600
  //     limit: one sentence holds more elements than the hand can draw; feed and map worst: speech bubbles and outlines),
  //     and the hand rests over finished items (list, compare) until it leaves for its rest point
  //   diagram: 16:9 clean, 9:16 hand-speed 3424
  //   timeline: at 16:9 three dates at three times the 60 minimum do not fit side by side
  kinds: {
    statement: { toWide: 11, linesWide: 2 },
    end: desk.kinds.end,
    media: desk.kinds.media,
    ...Object.fromEntries(PARKED_FROM_DESK.map((kind) => [kind, { ...desk.kinds[kind], experimental: true }])),
    number: { experimental: true },
    clipping: { experimental: true },
    free: { experimental: true },
    // the claim up to step 5 (240): three times the labels at step 2 is 180 (desk's cap of 180 left no room)
    chart: { ...desk.kinds.chart, titleMax: 240, labelScale: 1, experimental: true, experimentalTypes: ['race'] },
    // the quotation up to 240 on every column, its attribution at step 2 (60, secondary.min) so the quotation stays three times it
    quote: { ...desk.kinds.quote, toWide: 12, pad: 40, max: 240, attrSteps: [2], experimental: true },
    // dates at step 5 or 4: three times the events' text at the 60 minimum
    timeline: { ...desk.kinds.timeline, whenSteps: [5, 4], experimental: true },
    // the key's numbers in ink on the board (a paper number on a plate the hand does not fill)
    map: { ...desk.kinds.map, keyText: 'ink', keyFill: 'paper', pin: 'accent', experimental: true },
  },
  // The cue each event makes (scripts/v2/sound/cues.mjs), or null for none: every registered cut and device is named.
  sounds: {
    cut: { cut: null, slide: null, punch: null, match: null, cover: null, crossfade: null, fade: null, wipe: null, iris: null, zoom: null, blur: null, ripple: null, cube: null,
      'page-curl': null, 'directional-warp': null, 'cross-warp': null, 'cross-zoom': null, wind: null, 'window-slices': null, 'polka-dots': null, 'glitch-memories': null, pixelize: null, 'water-drop': null, erase: 'erase' },
    device: { highlight: null, circle: 'marker', underline: 'marker', arrow: 'marker', bracket: 'marker', cutout: 'click', card: 'marker', tag: 'marker', punch: null, item: 'marker', turn: null,
      label: 'marker', focus: null, route: 'marker', numeral: 'marker', sticker: null, sweep: null, duotone: null, halftone: null, zoom: null,
      pin: 'click', link: 'marker', node: 'marker', event: 'marker', change: 'marker', output: 'marker', message: 'marker' },
    emphasis: 'marker',
    land: null,
  },
};

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
const PARKED_FROM_DESK = Object.freeze(['feed']);

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
  // locked: nothing on a whiteboard zooms. No region close-up either (closeUp: false, m3): a cut to a window of the source
  // laid a second print over the first, and the hand drew a second frame on it, misaligned; clipping keeps one pinned print
  // and the hand rings the region on it
  camera: { drift: 0, style: 'locked', closeUp: false },
  cuts: ['cut', 'slide', 'cover', 'punch', 'match', 'crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur', 'ripple', 'cube',
    'page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop', 'erase'],
  cutPalette: ['cut', 'erase'],
  // gate-marker-1 ruling 5: a film that names no cut changes board by the erase or a pan (the next board slides in), in turn;
  // never a hard cut, and never one into a picture
  cutPick: { cuts: ['erase', 'slide'], every: 1 },
  keyline: 6,
  shadow: { dx: 0, dy: 0, blur: 0, alpha: 0, color: '#1b1b1f' },
  // the drawing hand (engine/hand): the tip rests low on the right, outside the grid; `angle` hangs the hand 55 degrees
  // below the line it writes so no outline point is above the tip (the spike's covered-text finding); `wobble` bends
  // every stroke; `width` is the marker's line per stroke kind; `erase`: three passes, the smear stays 0.4 s
  hand: {
    // drawFirst (gate-marker-1 ruling 1): the hand draws every element, none is set on frame 0; frame 0 is the pen down with
    // the first stroke begun, so the hand never starts at rest
    // afterCut (m5, gate-marker-2 rulings 1 and 2): a board after a cut is written only once the cut is over (an erase's passes,
    // a pan's landing): the hand draws nothing while the old board is still going; eraserAngle turns the hand over its eraser
    rest: 0.3, restAtStart: false, drawFirst: true, afterCut: true, noSet: true, maxSpeed: 2600, angle: 55, eraserAngle: 0, scale: 0.9, shape: 'hand',
    wobble: { amp: 2.4, wave: 46, step: 7 },
    width: { line: MARK_WIDTH, write: 6, fill: 5 },
    // m4 (gate-marker-1 ruling 3): the whole hand is on the board at rest, never cropped in a corner (marker-m4.test.mjs)
    // mid-height on the right: clear of the close's badge (low right) and of the writing, which keeps to the left (ruling 8)
    restAt: { wide: [0.872, 0.68], tall: [0.72, 0.66] },
    // m5 (ruling 5): the rest point a board leaves clear of its writing (the first of these when restAt is on something), the hand
    // turns flatter (minAngle) as the tip nears the bottom edge so it is never cropped, and the last stroke ends clearBy s before
    // the shot so the hand is at rest on the last frame
    restAlt: { wide: [[0.872, 0.62], [0.872, 0.4], [0.6, 0.62], [0.8, 0.12], [0.55, 0.12], [0.3, 0.62], [0.872, 0.88], [0.6, 0.9], [0.15, 0.9]], tall: [[0.72, 0.4], [0.72, 0.85], [0.3, 0.9], [0.72, 0.2]] },
    minAngle: -25, clearBy: 0.6,
    erase: { passes: 3, smear: 0.4 },
    colours: { skin: '#eec39d', shade: '#d9a680', outline: 'ink', barrel: '#2b2e33', cap: 'accent', nib: 'ink', eraser: '#d8d4c8', felt: '#4a4a52' },
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
  // shortest path to finish each is named below (docs/decisions-pending.md has no entries for them yet). m2: the hand's
  // per-element speed model made quote and diagram review clean. m3 shipped list, compare, media, map and clipping
  // by changing what is drawn, where and when (never a threshold): list writes its figure before its item (bulletFirst);
  // compare's arrow is drawn between the cards
  // (betweenFirst); a board-coloured plate over a picture is an opaque ground put on at once (media's caption box); map's 16:9
  // title runs across the top over a map scaled to the board (titleAbove); clipping keeps one print (no close-up cut) and
  // its ring is drawn on its word and is never the first thing on the board. The numbers below are from
  // .scratch/m1/sweep.mjs, the sheets from .scratch/m3/out:
  //   number: review clean at both formats (m3 underGap: the label under the digits' ink box), but at 9:16 the figure, label
  //     and delta are one small block: the settled board uses 35 percent of the height where marker-tall.test.mjs (ban 2)
  //     wants 65; it needs a tall composition (spread figure, label and delta down the band) the number kind has no data for
  //   free: review clean at 16:9; the example's bar runs off the right of a 9:16 frame (the new stroke-edge audit,
  //     engine/hand/index.mjs, finds it); free is author-placed, so the example needs its own tall layout
  //   chart (race parked in it as well, a board can only change ranks by erasing): hand-speed at both formats (16:9: no
  //     time left, 9:16: 10948 units a second against 2600); about 20 strokes in two sentences, chart-draw gives no
  //     element a lesser (set at once) form, so the hand cannot spare any of them
  //   feed: hand-speed at both formats (16:9 5243, 9:16 8892): speech bubbles are many strokes in one sentence each
  //   timeline: 16:9 three dates at three times the 60 minimum do not fit side by side (kind rule); 9:16 clean
  kinds: {
    // a tall board is written down the page: lines 2 high apart and the block allowed 85 percent of the band (m2, ban 2:
    // marker-tall.test.mjs measures the fill in the page with Caveat)
    // tail (m4): the hand draws the badge, the kicker and the hero line itself now, so the shot holds long enough after the last
    // word for the pen to finish (script/timing.mjs shotPace; the speed cap is untouched)
    // (m4 ruling 7: the tall lines 1.5 apart, not 2: a board's lines read loose at 2)
    statement: { toWide: 11, linesWide: 2, tallLineHeight: 1.7, tallHeight: 0.85, tail: 1.6 },
    // m4 (ruling 8): the ask (the url) and the mark at step 2 (60, the look's secondary minimum) at the least, never the 44 of
    // step 1, and a tail like statement's so the hand finishes the badge and the url
    // m5 (ruling 3): the mark is a box the pen draws (no turn: a turned card would appear at once), last on the board
    end: { ...desk.kinds.end, tallLineHeight: 1.5, tallHeight: 0.8, askSteps: [2], markSteps: [2], tail: 1.6, turn: 0, markLast: true },
    // m4 (ruling 9): bigger boxes (more room round each label: the labels stay at a third of the title) and a heavier arrow, so
    // the chain reads at phone size and uses the board's width
    // m5: a tail like the other kinds' so the hand has time for the title, four boxes, their labels and three arrows
    diagram: { ...desk.kinds.diagram, pad: 80, arrowWidth: 7, head: 34, tail: 1.6, bottomRoom: 90 },
    ...Object.fromEntries(PARKED_FROM_DESK.map((kind) => [kind, { ...desk.kinds[kind], experimental: true }])),
    // gate-marker-1 ruling 4: the picture is a card on the board (the pinned print, its keyline in ink, the caption beside it
    // or under it) at both formats, never full bleed: the board and its frame stay visible round it
    media: { ...desk.kinds.media, fitWide: 'cutout', fitTall: 'cutout' },
    // the hand writes each step's figure before its item (m3), so it ends an item at its right end, not hanging over it
    // numbered (m4, ruling 7): the list is written with its numbers, a hand-drawn structure, not three plain lines
    // m5: a tail so the phone tile (85 percent of the shot) shows the finished list with the hand away from it
    list: { ...desk.kinds.list, bulletFirst: true, numbered: true, tail: 2.2 },
    // the arrow (or vs) is drawn between the cards, before the second card's copy (m3): the hand ends it on the second
    // card's top edge and must not then hang over that card's finished title
    // gate-marker-1 ruling 6: the value is the hero (valueMax 240, the title at most a third of it, step 2 at the least),
    // the vs has room (gap 9 gutters: its mark is 144 wide), a point is plain (no dash that reads as a minus), and the gap
    // is drawn: a bar under each value at the true scale of the two (compare-desk.mjs bars)
    // m5 (ruling 6): the vs is written in the look's own face (vs: 'text')
    compare: { ...desk.kinds.compare, vs: 'text', inlinePoints: true, betweenFirst: true, plainPoints: true, gap: 10, valueMax: 240, valueTitle: 0.33, valueHero: true, titleFromStep: 2, bars: { gap: 0.4, width: 18 }, tail: 2.4 },
    // the label is written under the digits' ink box (0.22 em under the baseline: the review's measure), not in it (m3)
    number: { underGap: 90, experimental: true },
    clipping: {},
    free: { experimental: true },
    // the claim up to step 5 (240): three times the labels at step 2 is 180 (desk's cap of 180 left no room)
    chart: { ...desk.kinds.chart, titleMax: 240, labelScale: 1, experimental: true, experimentalTypes: ['race'] },
    // the quotation up to 240 on every column, its attribution at step 2 (60, secondary.min) so the quotation stays three times it
    quote: { ...desk.kinds.quote, toWide: 12, pad: 40, max: 240, attrSteps: [2], tail: 2.2 },
    // dates at step 5 or 4: three times the events' text at the 60 minimum
    timeline: { ...desk.kinds.timeline, whenSteps: [5, 4], experimental: true },
    // the key's numbers in ink on the board (a paper number on a plate the hand does not fill)
    // m3: at 16:9 the title runs across the top in one line (titleAbove, ledger's data) and the map takes the board under it,
    // so the title never stacks against the map's frame; at step 5 (240) it stays over three times the place names (step 4,
    // 150, was 2.5 times the smallest text and the review's hero rule refused it)
    map: { ...desk.kinds.map, keyText: 'ink', keyFill: 'paper', pin: 'accent', titleAbove: true, titleStepsWide: [5], tail: 2.4 },
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

// The emphasis styles as a table: a look names one (look.emphasis) and the kinds read its entry instead of comparing the
// name, so a new emphasis system is one more entry, not one more branch. Moved unchanged in behaviour out of
// statement.mjs and captions/stack.mjs (looks-four Task 1). The data half (together, scales, maxShare) is
// emphasis-flags.mjs, which the caption styles import; this file adds the word tracks. Pure and DOM-free.
//
// An entry: the flags of emphasis-flags.mjs, and wordTracks(look, word, at, ctx) -> tracks: a word's tracks once it has
// entered, `word` being { tracks, emphasised, matched, start, peak } (its entrance tracks, whether it is emphasised,
// whether the hero arrives matched, its entrance start scale and its pulse peak); hookTracks(look, word, at) -> tracks:
// a viral hook's ghost word (`word.tracks` the ghost lighting to its colour); inkTracks(look, word, at) -> tracks: a
// hook that opens at full ink (look.hookInk); span?(layout, times, timing): the device params the text node carries
// (the most lines one emphasised run spans); reserve?(look) -> { weight?, width? }: the weight and width a text's
// advances are measured at (weight-color sets one; the four styles before it do not).
import { track } from '../time/track.mjs';
import { glowFill } from '../devices/glow.mjs';
import { pulseScale } from './shared.mjs';
import { highlightLines } from './highlighter.mjs';
import { EMPHASIS_FLAGS, emphasisName } from './emphasis-flags.mjs';

const FILL_EASE = 'outCubic';

const asIs = (look, word) => word.tracks;
const none = () => ({});

// a highlighter band behind each emphasised run (desk): the words themselves do not change
const highlight = Object.freeze({
  ...EMPHASIS_FLAGS.highlight,
  wordTracks: asIs, hookTracks: asIs, inkTracks: none,
  span: (layout, times, timing) => highlightLines(layout, times, timing),
});

// a recolour with a pulse: the emphasised word grows to the emphasize scale and turns to the accent as it is spoken
const recolorScale = Object.freeze({
  ...EMPHASIS_FLAGS['recolor-scale'],
  wordTracks: (look, word, at) => {
    if (!word.emphasised) return word.tracks;
    return {
      ...word.tracks,
      scale: pulseScale(look, { enterAt: word.matched ? undefined : at, enterFrom: word.start, pulse: at, peak: word.peak }),
      fill: track([{ t: at, v: look.palette.ink }, { t: at + look.moves.emphasize.dur, v: look.palette.accent, ease: FILL_EASE }]),
    };
  },
  hookTracks: asIs, inkTracks: none,
});

// a recolour alone (pop): its stack and caption colour the words; a statement's words keep their entrance
const recolor = Object.freeze({ ...EMPHASIS_FLAGS.recolor, wordTracks: asIs, hookTracks: asIs, inkTracks: none });

// the emphasised words take the accent and their glyphs glow (cosmos, engine/devices/glow.mjs)
const glow = Object.freeze({
  ...EMPHASIS_FLAGS.glow,
  wordTracks: (look, word, at) => (word.emphasised ? { ...word.tracks, ...glowFill(look, at) } : word.tracks),
  hookTracks: (look, word, at) => (word.emphasised ? { ...word.tracks, glow: glowFill(look, at).glow } : word.tracks),
  inkTracks: (look, word, at) => (word.emphasised ? glowFill(look, at) : {}),
});

// an emphasised word steps from the display weight to HEAVY and turns the accent over the emphasize move as it is spoken
// (ledger); every word of the text is measured at HEAVY (reserve), so a word drawn lighter is centred in its room and
// nothing moves when the weight changes
const HEAVY = 800;
function weightTracks(look, at) {
  const end = at + look.moves.emphasize.dur;
  const { ease } = look.moves.emphasize;
  const { ink, accent } = look.palette;
  const from = look.fonts.display.weight;
  return {
    weight: track([{ t: 0, v: from }, { t: at, v: from }, { t: end, v: HEAVY, ease }]),
    fill: track([{ t: 0, v: ink }, { t: at, v: ink }, { t: end, v: accent, ease }], { space: look.colorSpace }),
  };
}
const weightColor = Object.freeze({
  ...EMPHASIS_FLAGS['weight-color'],
  wordTracks: (look, word, at) => (word.emphasised ? { ...word.tracks, ...weightTracks(look, at) } : word.tracks),
  hookTracks: asIs,
  inkTracks: (look, word, at) => (word.emphasised ? weightTracks(look, at) : {}),
  reserve: () => ({ weight: HEAVY }),
});

// size and width alone (poster): the stack sets the emphasised line large (kinds/stack.mjs) and a one-line stack widens
// its emphasised word; the words keep their colour and their entrance
const scale = Object.freeze({ ...EMPHASIS_FLAGS.scale, wordTracks: asIs, hookTracks: asIs, inkTracks: none });

export const EMPHASIS = Object.freeze({ highlight, 'recolor-scale': recolorScale, recolor, glow, 'weight-color': weightColor, scale });

/** The entry of look.emphasis; throws naming the look, the name and the names the table has (with did-you-mean). */
export const emphasisOf = (look) => EMPHASIS[emphasisName(look)];

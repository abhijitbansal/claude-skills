// The `glow` emphasis (a look whose `emphasis` is 'glow': cosmos). An emphasised word takes the accent as it is
// spoken (glowFill, a word track), and behind each run of adjacent emphasised words on a line sits one soft accent halo
// (glowHalos): a soft pill, whole at GLOW.alpha along the run's middle (GLOW.inset em inside its ink box) and falling
// off to nothing GLOW.reach em past the ink (shared.mjs softRoundedRect: stacked rings, no blur filter, which cost
// about 7 ms a frame per halo),
// screened over what is under it (GLOW.blend), fading in over the look's emphasize move from when the run's first
// word is spoken. One halo per run, never one per
// word, so halos never stack. The halo is paths in a group (props.under: the caller puts it before the text), so the
// measured ink box the review reads (text nodes only) never includes it. Its reach stays in the gap a display line
// height leaves between lines, and inside the canvas: a halo near an edge is clipped to the frame, its reach shrunk.
// Not a registered device (every look would need a sound for it): kinds call it as they call highlightBands.
// Pure and DOM-free.
import { track } from '../time/track.mjs';
import { softRoundedRect } from './shared.mjs';
import { runInk } from '../kinds/shared.mjs';

export const GLOW = Object.freeze({
  inset: 0.22, // em of the text: the halo is whole only this far inside the run's ink box (along the words' middle)...
  reach: 0.14, // em of the text: ...and falls off to nothing this far past the ink (a whole ink box read as a plate)
  alpha: 0.35, // the halo's opacity where it is whole, once lit
  // composited with screen, so it only ever brightens what is under it (an accent at an alpha over violet in plain
  // source-over reads as a brown box, as rendered)
  blend: 'screen',
});
const FILL_EASE = 'inOutCubic';
const HALF = 2;

/** A word's fill track in a glow look: ink until `at`, the accent by `at` + the emphasize move. */
export function glowFill(look, at) {
  const { ink, accent } = look.palette;
  return { fill: track([{ t: 0, v: ink }, { t: at, v: ink }, { t: at + look.moves.emphasize.dur, v: accent, ease: FILL_EASE }]) };
}

const isEmphasised = (times, timing, index) => times[index] !== undefined && times[index].spoken !== null && timing.words[times[index].spoken]?.emphasis === true;

// Runs of adjacent emphasised words on each line, each { line, first, last } (word indexes).
function runsOf(layout, times, timing) {
  return layout.lines.flatMap((line) => line.words.reduce((runs, word) => {
    if (!isEmphasised(times, timing, word.index)) return runs;
    const open = runs.at(-1);
    if (open && open.last === word.index - 1) return [...runs.slice(0, -1), { ...open, last: word.index }];
    return [...runs, { line, first: word.index, last: word.index }];
  }, []));
}

// A run's halo in the placed text's parent space: the whole core (its ink box, clipped to the canvas, then shrunk by
// GLOW.inset, never past its own middle) and the reach from the core to the soft edge, which ends GLOW.reach past the
// ink, or at the canvas edge where that is nearer.
function haloGeometry(placed, { line, first, last }, measure, canvas) {
  const { x, y, font } = placed;
  const ink = runInk(line, font, measure, first, last);
  const baseline = y + line.y;
  const left = Math.max(0, x + ink.left), right = Math.min(canvas.w, x + ink.right);
  const top = Math.max(0, baseline - ink.up), bottom = Math.min(canvas.h, baseline + ink.down);
  const inset = Math.min(GLOW.inset * font.size, (right - left) / HALF, (bottom - top) / HALF);
  const room = Math.min(left, top, canvas.w - right, canvas.h - bottom);
  const rect = [left + inset, top + inset, right - left - HALF * inset, bottom - top - HALF * inset];
  return { rect, reach: inset + Math.max(0, Math.min(GLOW.reach * font.size, room)) };
}

/**
 * The halos behind a placed text's emphasised runs, in the text's parent space (`placed` is { x, y, layout, font },
 * `times` is per word index { at, spoken }, ctx carries look, timing, measure and canvas); none unless the look's
 * emphasis is the glow. The same signature as kinds/shared.mjs highlightBands.
 */
export function glowHalos(id, placed, times, ctx) {
  const { look, timing, measure, canvas } = ctx;
  if (look.emphasis !== 'glow') return [];
  return runsOf(placed.layout, times, timing).map((run, k) => {
    const { rect, reach } = haloGeometry(placed, run, measure, canvas);
    const at = times[run.first].at;
    const opacity = track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at + look.moves.emphasize.dur, v: 1, ease: FILL_EASE }]);
    return softRoundedRect({
      id: `${id}.glow${k}`, rect, pill: true, reach, alpha: GLOW.alpha, fill: look.palette.accent,
      props: { under: true, blend: GLOW.blend }, opts: { tracks: { opacity } },
    });
  });
}

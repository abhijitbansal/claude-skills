// The `glow` emphasis (a look whose `emphasis` is 'glow': cosmos). An emphasised word takes the accent as it is spoken
// and its own glyphs glow behind it: the draw layer blurs the word's glyph mask (a canvas shadow) in the look's
// glow colour, so the light hugs the letters, with no plate, no box and no stepped rings (look review: a pill halo of
// stacked rings read as a brownish box). glowFill gives the word's tracks (its fill turning to the accent and its
// glow rising over the look's emphasize move from when it is spoken); glowStyle gives the text node's props.glow
// ({ color, alpha, radius }: radius is look.glow.capShare of the cap height). The glow is pixels the draw layer adds
// to a text, never a node, so the measured ink box the review reads is the text's alone; it reaches about its radius
// past the glyphs, inside the safe margin. Its alpha (look data) is set so the accent keeps 3:1 against the brightest
// glow pixel beside the glyphs (measured in the browser: .scratch/cosmos/glow-contrast.mjs). Pure and DOM-free.
import { track } from '../time/track.mjs';
import { CAP_HEIGHT } from '../kinds/shared.mjs';

const FILL_EASE = 'inOutCubic';
// units: the glow's radius never passes the safe margin (template/formats.mjs SAFE_MARGIN_PX at 1080), so a text kept
// inside the safe area keeps its glow inside the frame
const MAX_RADIUS_UNITS = 60;

/** A word's tracks in a glow look: ink until `at`, then the accent and its glow, over the emphasize move. */
export function glowFill(look, at) {
  const { ink, accent } = look.palette;
  const end = at + look.moves.emphasize.dur;
  return {
    fill: track([{ t: 0, v: ink }, { t: at, v: ink }, { t: end, v: accent, ease: FILL_EASE }]),
    glow: track([{ t: 0, v: 0 }, { t: at, v: 0 }, { t: end, v: 1, ease: FILL_EASE }]),
  };
}

/** The props.glow of a text set in `font` in a glow look ({ color, alpha, radius } in px), or {} for any other look. */
export function glowStyle(look, font, unit) {
  if (look.emphasis !== 'glow' || !look.glow) return {};
  const { color, alpha, capShare } = look.glow;
  return { glow: { color, alpha, radius: Math.min(capShare * CAP_HEIGHT * font.size, MAX_RADIUS_UNITS * unit) } };
}

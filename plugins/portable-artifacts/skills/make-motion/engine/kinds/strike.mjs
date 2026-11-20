// The strike (look data `beatAt` on a kind, poster: gate-poster-2 ruling 3, kinetic type): a shot's hero (a chart's
// numeral, a code or diagram title) changes ground on a spoken word after a complete first frame. The look's highlight
// bar lands under each of its lines by a hard step and a knockout copy of the text in the bar's text colour stands in for
// it: the beat bar of a stack (stack.mjs beatPair, the one builder). `beatAt` is a share of the spoken words (the bar
// stays to the end, so the frame at the end is never the frame at 0) or [on, off], two shares (the bar lands on the
// first word and lifts on the second: a kind whose own motion leaves two holds). The words are chosen by their place in
// the narration, so the strike holds on estimated and voiced timing alike. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { runInk } from './shared.mjs';
import { beatPair, stepped } from './stack.mjs';

/** When a strike lands: the start of the spoken word `share` of the way through `timing.words` (rounded to a word), or
 *  null without a share, without narration, or on the first word (the first frame stays complete and still). */
export function strikeAt(timing, share) {
  if (!Number.isFinite(share)) return null;
  const words = timing?.words ?? [];
  if (words.length < 2) return null;
  const at = words[Math.round(Math.min(1, Math.max(0, share)) * (words.length - 1))].start;
  return Number.isFinite(at) && at > 0 ? at : null;
}

// The window of look data `beatAt` on `timing`: { at, until } or null.
function windowOf(timing, beatAt) {
  const [on, off] = Array.isArray(beatAt) ? beatAt : [beatAt, undefined];
  const at = strikeAt(timing, on);
  if (at === null) return null;
  const until = off === undefined ? Infinity : strikeAt(timing, off) ?? Infinity;
  return until > at ? { at, until } : null;
}

/**
 * A text node struck by look data `beatAt` on the shot's narration (ctx.timing): [the text hidden while struck, a bar per
 * line, the knockout copy]. A text that already moves (its own opacity track), or a shot with no window, is returned
 * alone, as it is.
 */
export function struck(text, ctx, beatAt) {
  const beat = beatAt === undefined ? null : windowOf(ctx.timing, beatAt);
  if (beat === null || text.tracks.opacity !== undefined) return [text];
  const { layout, font } = text.props;
  const pairs = layout.lines.map((line, k) => {
    const ink = runInk(line, font, ctx.measure);
    const baseline = text.props.y + line.y;
    const box = [text.props.x + ink.left, baseline - ink.up, ink.right - ink.left, ink.up + ink.down];
    return beatPair(`${text.id}.strike${k === 0 ? '' : k}`, beat, [box], text, { baseline, ink, font }, ctx);
  });
  const hidden = node('text', text.id, text.props, { tracks: { ...text.tracks, opacity: stepped(1, 0, beat) }, wordTracks: text.wordTracks, depth: text.depth, step: text.step });
  // every line's bar, then one copy of the whole text over them (the first pair's)
  return [hidden, ...pairs.map(([bar]) => bar), pairs[0][1]];
}

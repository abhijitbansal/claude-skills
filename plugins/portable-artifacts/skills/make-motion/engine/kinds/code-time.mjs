// When the `code` kind shows what it shows (plan 2026-11-16-pa2-shot-kinds-b, Task 8). type: the panel, the title and
// the first line on frame 0, the rest typing on run by run over the narration, landed by its end. diff: `before` whole on
// frame 0; on the second sentence (else the narration's middle) removed lines are struck, then close as the others settle
// and added lines open. run: the prompt on frame 0, the command typing over the first sentence, output lines in order
// over the rest. Every time is landed by arrivals.mjs latestLanding. Pure and DOM-free.
import { latestLanding, landBy } from './arrivals.mjs';

export const CLOSE = 0.4; // s from a diff's strike to its removed lines closing
// s from the close to the added lines opening: room for the longest settle move of a look (desk 0.6), so the times are
// the same in every look and the sound plan, which knows no look, cues them as the picture shows them
export const SETTLE_ROOM = 0.6;

/** When the narration ends (its last word's end), held to latestLanding; latestLanding with no words. */
export function narrationEnd(timing) {
  const last = timing.words?.at(-1);
  return last ? landBy(last.end ?? last.start, timing) : latestLanding(timing);
}

/** `n` times spread evenly over (from, to]: the k-th at from + (to - from)(k + 1)/n. */
export const spread = (n, from, to) => Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 1)) / n);

/** type: when typing has landed: the last sentence's start when there are two or more (the last sentence is then said
 *  over the finished code), else the narration's end. */
export function typedBy(timing) {
  const sentences = timing.sentences ?? [];
  return sentences.length > 1 ? landBy(sentences.at(-1).start, timing) : narrationEnd(timing);
}

/** type: the times of the runs that type on (`n` of them, after the first line), over (0, typedBy]. */
export const typeTimes = (n, timing) => spread(n, 0, typedBy(timing));

/** diff: when removed lines are struck: the second sentence, else the narration's middle, else the shot's; early enough
 *  that the close and the settle land by latestLanding, never on frame 0. */
export function changeTime(timing) {
  const second = timing.sentences?.[1]?.start;
  const words = timing.words ?? [];
  const middle = words.length > 0 ? (words[0].start + narrationEnd(timing)) / 2 : timing.duration / 2;
  const latest = latestLanding(timing) - CLOSE - SETTLE_ROOM;
  return Math.max(0, Math.min(second ?? middle, latest));
}

/** diff: when the added lines open (and the diff has landed). */
export const opensAt = (timing) => changeTime(timing) + CLOSE + SETTLE_ROOM;

/** run: the command's `n` runs over the first sentence (else the first third), then `m` output lines evenly to the end.
 *  -> { command: number[], output: number[] } */
export function runTimes(n, m, timing) {
  const end = narrationEnd(timing);
  const first = timing.sentences?.length > 1 ? Math.min(timing.sentences[0].end ?? timing.sentences[1].start, end) : end / 3;
  const command = spread(n, 0, m > 0 ? first : end);
  return { command, output: spread(m, command.at(-1) ?? 0, end) };
}

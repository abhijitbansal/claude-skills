// The desk highlighter behind emphasised runs (split out of shared.mjs; statement, quote): the band boxes and the
// longest run of emphasis, for the frame review's highlight-lines rule. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { BAND_HEIGHT } from '../devices/highlight.mjs';
import { runInk, requireDevice } from './shared.mjs';
import { emphasisFlags } from './emphasis-flags.mjs';

const HALF = 2;

const HIGHLIGHT_PAST_INK = 0.06; // em of the text: the band reaches this far past the run's ink, above and below

export const isEmphasised = (times, timing, index) => times[index] !== undefined && times[index].spoken !== null && timing.words[times[index].spoken].emphasis;

// Runs of adjacent emphasised words on one line, each { line, first, last } (word indexes).
export function emphasisRuns(layout, times, timing) {
  return layout.lines.flatMap((line) => line.words.reduce((runs, word) => {
    if (!isEmphasised(times, timing, word.index)) return runs;
    const open = runs.at(-1);
    if (open && open.last === word.index - 1) return [...runs.slice(0, -1), { ...open, last: word.index }];
    return [...runs, { line, first: word.index, last: word.index }];
  }, []));
}

// The box to give the highlight device for a run, so that the band it draws (BAND_HEIGHT times the box, about the same
// middle) runs from HIGHLIGHT_PAST_INK above the run's highest ink to HIGHLIGHT_PAST_INK below its lowest: it holds the
// words, descenders included, and with the look's display line height it clears the lines above and below.
function bandBox({ x, y, font }, line, run, measure) {
  const a = line.words.find((w) => w.index === run.first), b = line.words.find((w) => w.index === run.last);
  const ink = runInk(line, font, measure, run.first, run.last);
  const baseline = y + line.y;
  const top = baseline - ink.up - HIGHLIGHT_PAST_INK * font.size, bottom = baseline + ink.down + HIGHLIGHT_PAST_INK * font.size;
  const h = (bottom - top) / BAND_HEIGHT;
  const left = x + line.x + a.x;
  return [left, (top + bottom) / HALF - h / HALF, x + line.x + b.x + b.width - left, h];
}

/**
 * The most laid-out lines one unbroken run of emphasised words spans (a run follows word order across lines), or
 * undefined when nothing is emphasised: the frame review's highlight-lines rule reads it from the text node.
 */
export function highlightLines(layout, times, timing) {
  const lineOf = new Map(layout.lines.flatMap((line, k) => line.words.map((w) => [w.index, k])));
  let most, first = null;
  for (let i = 0; i <= times.length; i++) {
    if (i < times.length && isEmphasised(times, timing, i)) { first ??= i; continue; }
    if (first !== null) most = Math.max(most ?? 0, lineOf.get(i - 1) - lineOf.get(first) + 1);
    first = null;
  }
  return most;
}

/**
 * The highlight bands behind a placed text's emphasised runs, in the text's parent space, each growing with its words
 * (every word's landing time and right edge); none when the look's emphasis is not the highlighter. `placed` is
 * { x, y, layout, font }, `times` is per word index ({ at, spoken }), `kind` names the kind for a missing device.
 */
export function highlightBands(id, placed, times, ctx, kind) {
  const { look, unit, seed, timing, measure } = ctx;
  if (emphasisFlags(look).bands !== true) return [];
  const runs = emphasisRuns(placed.layout, times, timing);
  if (runs.length > 0) requireDevice(look, 'highlight', kind);
  const device = registries.devices.get('highlight');
  return runs.flatMap(({ line, first, last }, k) => {
    const box = bandBox(placed, line, { first, last }, measure);
    const stops = line.words.filter((w) => w.index >= first && w.index <= last).map((w) => ({ at: times[w.index].at, x: placed.x + line.x + w.x + w.width }));
    return device.build({ id: `${id}.hl${k}`, box, at: times[first].at, look, unit, seed, stops }).nodes;
  });
}

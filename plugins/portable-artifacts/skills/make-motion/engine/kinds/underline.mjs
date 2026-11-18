// The underline emphasis (marker; looks-four Task 12): the hand draws one stroke in the accent under each emphasised run of
// a placed text, begun as its first word is spoken and ended as its last is. The mark is the look's `underline` device
// (devices/marks.mjs, `drawn` style: exact points the hand's wobble bends) carrying the window it is drawn in
// (props.window, read by hand/strokes.mjs). It is placed after the text it sits under: the text is the board's first
// element and stands whole on frame 0. None when the look's emphasis is not an underline. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { runInk, requireDevice } from './shared.mjs';
import { emphasisRuns } from './highlighter.mjs';
import { emphasisFlags } from './emphasis-flags.mjs';

// The box of a run's ink for the device: its top at the run's highest ink, its bottom on the baseline (the device sets
// the stroke `gap` units under that).
function runBox({ x, y, font }, line, run, measure) {
  const a = line.words.find((w) => w.index === run.first), b = line.words.find((w) => w.index === run.last);
  const ink = runInk(line, font, measure, run.first, run.last);
  const left = x + line.x + a.x;
  return [left, y + line.y - ink.up, x + line.x + b.x + b.width - left, ink.up];
}

/**
 * The underline marks of a placed text's emphasised runs. `placed` is { x, y, layout, font }, `times` per word index
 * ({ at, spoken }), `kind` names the kind for a missing device.
 */
export function underlineMarks(id, placed, times, ctx, kind) {
  const { look, unit, seed, timing, measure } = ctx;
  if (emphasisFlags(look).strokes !== true) return [];
  const runs = emphasisRuns(placed.layout, times, timing);
  if (runs.length > 0) requireDevice(look, 'underline', kind);
  const device = registries.devices.get('underline');
  return runs.map(({ line, first, last }, k) => {
    const last_ = times[last].spoken;
    const from = times[first].at;
    const to = last_ === null ? from + look.moves.draw.dur : Math.max(from + look.moves.draw.dur, timing.words[last_].end);
    const mark = device.build({ id: `${id}.ul${k}`, box: runBox(placed, line, { first, last }, measure), at: from, look, unit, seed }).nodes[0];
    return node(mark.type, mark.id, { ...mark.props, window: [from, to] }, { tracks: mark.tracks, step: mark.step });
  });
}

// The film's own events as data, in film seconds: what the cue plan (cues.mjs) asks a look to sound. Pure: no clock,
// no randomness; every time is read off the timeline (engine/script/timing.mjs), never estimated here.
//
// An event is { kind, t, shot, cut?, device? }:
//   cut       the first frame of each shot after the first (`cut` names the cut, default "cut")
//   device    each `on` entry's resolved time (`device` is its `do`)
//   emphasis  the first word of each run of emphasised words (one event per run), when it is heard
//   land      the moment a shot's figure reaches its value, for a kind that says when (its `landing(shot, timing)`)
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/kinds/index.mjs';
import { resolveAnchor, AnchorError } from '../../../engine/script/anchors.mjs';

const DEFAULT_CUT = 'cut';

const event = (fields) => Object.freeze(fields);

function cutEvents(shot, entry) {
  if (entry.index === 0) return [];
  return [event({ kind: 'cut', t: entry.start, shot: entry.id, cut: shot.cut ?? DEFAULT_CUT })];
}

// Each `on` entry at its anchor in the shot, as the frame draws it (engine/graph/film.mjs resolves it the same way).
function deviceEvents(shot, entry) {
  if (!Array.isArray(shot.on)) return [];
  return shot.on.map((item, j) => {
    try {
      return event({ kind: 'device', t: entry.start + resolveAnchor(item.at, entry), shot: entry.id, device: item.do });
    } catch (err) {
      if (err instanceof AnchorError) throw new AnchorError(`shots[${entry.index}].on[${j}].at: ${err.message}`);
      throw err;
    }
  });
}

// One event at the start of each run of emphasised words, when its first word is heard (soundStart: the picture shows a
// shot's first word from the shot's first frame, the voice speaks it later).
function emphasisEvents(entry) {
  return entry.words
    .filter((w, k) => w.emphasis && !entry.words[k - 1]?.emphasis)
    .map((w) => event({ kind: 'emphasis', t: entry.start + (w.soundStart ?? w.start), shot: entry.id }));
}

function landEvents(shot, entry, kinds) {
  if (typeof shot.show !== 'string' || !kinds.has(shot.show)) return [];
  const { landing } = kinds.get(shot.show);
  if (typeof landing !== 'function') return [];
  return [event({ kind: 'land', t: entry.start + landing(shot, entry), shot: entry.id })];
}

/**
 * The events of `film` on `timeline` (buildTimeline's), sorted by time. At the same time they keep the order shot by
 * shot, then cut, devices in `on` order, emphasis, landing, so the cue plan's "keep the first" is deterministic.
 * `kinds` is the kinds registry whose `landing` hooks are asked (default: the shared one).
 */
export function soundEvents(film, timeline, { kinds = registries.kinds } = {}) {
  const events = film.shots.flatMap((shot, index) => {
    const entry = timeline.shots[index];
    if (entry?.id !== shot.id) throw new RangeError(`timeline shot ${index} is ${JSON.stringify(entry?.id)}, the film's shot is "${shot.id}"`);
    return [...cutEvents(shot, entry), ...deviceEvents(shot, entry), ...emphasisEvents(entry), ...landEvents(shot, entry, kinds)];
  });
  return Object.freeze([...events].sort((a, b) => a.t - b.t));
}

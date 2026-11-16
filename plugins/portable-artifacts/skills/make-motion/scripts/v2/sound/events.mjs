// The film's own events as data, in film seconds: what the cue plan (cues.mjs) asks a look to sound. Pure: no clock,
// no randomness; every time is read off the timeline (engine/script/timing.mjs), never estimated here.
//
// An event is { kind, t, shot, cut?, device? }:
//   cut       the first frame of each shot after the first (`cut` names the cut, default "cut")
//   device    each `on` entry's resolved time (`device` is its `do`)
//   emphasis  the first word of each run of emphasised words (one event per run), when it is heard
//   land      the moment a shot's figure reaches its value, for a kind that says when (its `landing(shot, timing)`)
// and a kind's own events (its `events(shot, timing)`: device events in shot seconds, such as a list's items, each
// naming a device the kind declares in `eventDevices`).
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/kinds/index.mjs';
import { resolveAnchor, AnchorError } from '../../../engine/script/anchors.mjs';
import { resolveLook } from '../../../engine/graph/film.mjs';
import { isHidden } from '../../../engine/kinds/shared.mjs';
import { canvasSize } from '../../../template/formats.mjs';

const DEFAULT_CUT = 'cut';

const event = (fields) => Object.freeze(fields);

function cutEvents(shot, entry) {
  if (entry.index === 0) return [];
  return [event({ kind: 'cut', t: entry.start, shot: entry.id, cut: shot.cut ?? DEFAULT_CUT })];
}

// Each `on` entry at its anchor in the shot, as the frame draws it (engine/graph/film.mjs resolves it the same way). An
// entry aimed at a part that is off screen then (its kind's partWindow) plans no cue: the review reports it instead.
function deviceEvents(shot, entry, { kinds, look, canvas }) {
  if (!Array.isArray(shot.on)) return [];
  const kind = typeof shot.show === 'string' && kinds.has(shot.show) ? kinds.get(shot.show) : null;
  const windowOf = (target) => (typeof kind?.partWindow === 'function' ? kind.partWindow(shot, entry, target, look, canvas) : null);
  return shot.on.flatMap((item, j) => {
    try {
      const t = resolveAnchor(item.at, entry);
      const window = windowOf(item.target);
      if (window !== null && isHidden(t, window)) return [];
      return [event({ kind: 'device', t: entry.start + t, shot: entry.id, device: item.do })];
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

// A kind's own events (`events(shot, timing)` -> [{ kind: 'device', device, t }], t in shot seconds), each a device it
// declares in `eventDevices`: one it does not is an error, never a cue the looks have no sound for.
function kindEvents(shot, entry, kinds) {
  if (typeof shot.show !== 'string' || !kinds.has(shot.show)) return [];
  const kind = kinds.get(shot.show);
  if (typeof kind.events !== 'function') return [];
  const declared = Array.isArray(kind.eventDevices) ? kind.eventDevices : [];
  return kind.events(shot, entry).map((e) => {
    if (e?.kind !== 'device') throw new RangeError(`kind "${shot.show}" sent an event of kind ${JSON.stringify(e?.kind)}; a kind's own events are device events`);
    if (!declared.includes(e.device)) throw new RangeError(`kind "${shot.show}" sent the device event ${JSON.stringify(e.device)}, which its eventDevices (${declared.join(', ')}) does not declare`);
    if (!Number.isFinite(e.t)) throw new RangeError(`kind "${shot.show}" sent the device event "${e.device}" at ${JSON.stringify(e.t)}, which is not a time in seconds`);
    return event({ kind: 'device', t: entry.start + e.t, shot: entry.id, device: e.device });
  });
}

function landEvents(shot, entry, kinds) {
  if (typeof shot.show !== 'string' || !kinds.has(shot.show)) return [];
  const { landing } = kinds.get(shot.show);
  if (typeof landing !== 'function') return [];
  return [event({ kind: 'land', t: entry.start + landing(shot, entry), shot: entry.id })];
}

/**
 * The events of `film` on `timeline` (buildTimeline's), sorted by time. At the same time they keep the order shot by
 * shot, then cut, devices in `on` order, the kind's own events, emphasis, landing, so the cue plan's "keep the first" is deterministic.
 * `kinds` is the kinds registry whose `landing` hooks are asked (default: the shared one).
 */
export function soundEvents(film, timeline, { kinds = registries.kinds } = {}) {
  const look = resolveLook(film);
  const [w, h] = canvasSize(film);
  const canvas = { w, h };
  const events = film.shots.flatMap((shot, index) => {
    const entry = timeline.shots[index];
    if (entry?.id !== shot.id) throw new RangeError(`timeline shot ${index} is ${JSON.stringify(entry?.id)}, the film's shot is "${shot.id}"`);
    return [...cutEvents(shot, entry), ...deviceEvents(shot, entry, { kinds, look, canvas }), ...kindEvents(shot, entry, kinds), ...emphasisEvents(entry), ...landEvents(shot, entry, kinds)];
  });
  return Object.freeze([...events].sort((a, b) => a.t - b.t));
}

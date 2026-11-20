// The look's own emphasis in place of an emphasis device it does not draw (looks-four Task 4b, controller ruling). An
// `on` event whose device is an emphasis device (`emphasis: true`: the highlight) in a look that does not support it
// (ledger) is not refused: it is taken out, and when it targets one of the shot's words (`word:<i>`) that word is starred
// in the shot's `say`, so the look's emphasis system marks it (ledger: weight and colour). Applied where a film enters
// the engine (buildTimeline, buildFilm), so timing and expansion read the same shots; make says so in one info line
// per event (fallbackNotices). Pure and DOM-free: reads only the registries.
import { registries as defaultRegistries } from '../registry.mjs';

const WORD_TARGET = /^word:(\d+)$/;
const FORCE_MARK = '|';
const CORE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u; // a word's leading punctuation, its core, its trailing punctuation

// `say` with its word `index` (counted as the statement counts targets: whitespace tokens, the force mark left out)
// starred, or as it was when that word is already marked or does not exist.
function starWord(say, index) {
  const parts = say.split(/(\s+)/);
  let seen = -1;
  return parts.map((part) => {
    if (part.trim() === '' || part === FORCE_MARK) return part;
    seen += 1;
    if (seen !== index || part.includes('*')) return part;
    const [, lead, core, tail] = CORE.exec(part);
    return core === '' ? part : `${lead}*${core}*${tail}`;
  }).join('');
}

const REGION_PREFIX = 'region:';

// A device the shot's kind draws itself on one of its regions (kind.regionDevices: a clipping draws a region highlight
// as a frame in any look), which validation allows and which is never moved.
const kindDrawsIt = (item, kind) => Array.isArray(kind?.regionDevices) && kind.regionDevices.includes(item.do)
  && typeof item.target === 'string' && item.target.startsWith(REGION_PREFIX);

// The emphasis devices `look` does not draw in a shot of `kind`, as a test on one `on` item.
const fallsBack = (look, devices, kind) => (item) => devices.has(item.do) && devices.get(item.do).emphasis === true
  && !devices.get(item.do).supports(look) && !kindDrawsIt(item, kind);

/** The film's look, or null when its look (or mode default) is not registered (validation reports that). */
function lookOf(film, regs) {
  const mode = regs.modes.has(film.mode ?? 'pro') ? regs.modes.get(film.mode ?? 'pro') : null;
  const name = film.look ?? mode?.defaultLook;
  return typeof name === 'string' && regs.looks.has(name) ? regs.looks.get(name) : null;
}

/**
 * `film` with every emphasis device its look does not draw replaced by the look's emphasis on its target word; the same
 * object when there is none. -> { film, moved: [{ shot, index, device, target, starred }] }
 */
export function withLookEmphasis(film, regs = defaultRegistries) {
  const look = lookOf(film, regs);
  if (look === null || !Array.isArray(film.shots)) return { film, moved: [] };
  const moved = [];
  const shots = film.shots.map((shot) => {
    const test = fallsBack(look, regs.devices, regs.kinds.has(shot.show) ? regs.kinds.get(shot.show) : null);
    const out = (shot.on ?? []).map((item, index) => ({ item, index })).filter(({ item }) => test(item));
    if (out.length === 0) return shot;
    let say = shot.say;
    for (const { item, index } of out) {
      const word = WORD_TARGET.exec(item.target ?? '');
      const starred = word !== null && typeof say === 'string';
      if (starred) say = starWord(say, Number(word[1]));
      moved.push({ shot: shot.id, index, device: item.do, target: item.target ?? null, starred });
    }
    const on = shot.on.filter((item) => !test(item));
    return { ...shot, ...(say === undefined ? {} : { say }), on };
  });
  return moved.length === 0 ? { film, moved } : { film: { ...film, shots }, moved };
}

/** make's info line for one moved event. */
export const fallbackNotice = (look, { shot, index, device, target, starred }) => (starred
  ? `make: shot "${shot}" on[${index}]: look "${look}" does not draw "${device}"; ${target} takes the look's own emphasis instead`
  : `make: shot "${shot}" on[${index}]: look "${look}" does not draw "${device}"; its target is not a word, so the look's emphasis marks only the starred words`);

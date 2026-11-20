// The master and its AAC encode, mastered again when the encode cannot reach the mode's target (branch review A, I1).
//
// The master stops within MASTER_AIM_LU of the target, its true peak as high as ceilingFor allows, and AAC can take
// close to 2 LU from full-band, noise-like sound (final review I3). An encode that lands short with its peak already at
// ceilingFor has no room for encodeMaster's raise, so the film would be refused for a level the mastering could reach.
// Such an encode is mastered again under a ceiling lowered by its shortfall (masterTrack's headroomDb: the limiter
// holds the peaks lower at the same target), so the next encode has that much room to be raised into. At most
// REMASTER_ROUNDS times, the headroom never past REMASTER_HEADROOM_MAX_DB: each round runs one master and one encode,
// so the work is bounded, and what is still short after the last is judged (and refused) as before.
import { encodeMaster, encodeRaise, LOUDNESS_TOLERANCE_LU } from './master.mjs';

/** At most this many masters after the first. */
export const REMASTER_ROUNDS = 2;
/** The ceiling is never lowered more than this many dB for the encode's sake. */
export const REMASTER_HEADROOM_MAX_DB = 3;
const GAIN_STEPS = 100; // dB to 0.01, as the master writes them

const hundredths = (n) => Math.round(n * GAIN_STEPS) / GAIN_STEPS;

// How much more headroom an encode asks for (0: none): only one the judgement would refuse as short, whose shortfall
// is not the hold's own (the held note covers that), and whose peak leaves too little room for a raise to bring it
// within tolerance (encodeRaise: none at ceilingFor, or the few tenths a real reading a step under it leaves). An encode
// whose raise had the room but ran out of encode rounds is not mastered again. A film with no narration is noted,
// never limited harder (judgeLevel noVoice).
function shortfallAtCeiling(encoded, loudness, noVoice) {
  const { level, heldFrom } = encoded;
  if (noVoice || level.lufs === null) return 0;
  const shortDb = loudness.lufs - level.lufs;
  const heldOnly = heldFrom !== null && (heldFrom.lufs === null || loudness.lufs - heldFrom.lufs <= LOUDNESS_TOLERANCE_LU);
  const roomy = encodeRaise(level, loudness) >= shortDb - LOUDNESS_TOLERANCE_LU;
  if (shortDb <= LOUDNESS_TOLERANCE_LU || heldOnly || roomy) return 0;
  return shortDb;
}

/**
 * Masters through `master(headroomDb) -> Promise<string | null>` (the master WAV's path, or null for nothing to master:
 * render.mjs passes masterTrack with the film's parts) and encodes it to `out` (encodeMaster, `run`, `duration`,
 * `loudness` the mode's target). An encode short of the target at the ceiling (shortfallAtCeiling) is mastered again
 * with that shortfall more headroom, at most REMASTER_ROUNDS times and REMASTER_HEADROOM_MAX_DB in all. Resolves the
 * last encodeMaster result, or null when there is nothing to master. `noVoice`: the film has no narration.
 */
export async function encodeToTarget({ run, master, out, duration, loudness, noVoice }) {
  let headroomDb = 0;
  for (let round = 0; ; round++) {
    const file = await master(headroomDb);
    if (file === null) return null;
    const encoded = await encodeMaster({ run, master: file, out, duration, loudness });
    const more = shortfallAtCeiling(encoded, loudness, noVoice);
    const next = hundredths(Math.min(REMASTER_HEADROOM_MAX_DB, headroomDb + more));
    if (round === REMASTER_ROUNDS || more === 0 || next <= headroomDb) return encoded;
    headroomDb = next;
  }
}

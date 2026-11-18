// Modes for the v2 engine. Importing this file registers `pro` and `viral` in registries.modes (once: a second
// evaluation leaves the registry as it is). A mode is behaviour; the look it names is appearance.
//
// Mode = { name, defaultLook, defaultFormat, wpm, tail, maxStillSeconds, hookFromFrameZero, maxLineWords?, maxHookWords?,
//          platformSafeZone?, captions: boolean, voiceSpeed, emphasisPause, loudness, cues: boolean }
// Voice data (both REQUIRED: a mode without them cannot be registered; checked by validateMode, never decided from a
// mode's name):
//   voiceSpeed     Kokoro speed of the narration, VOICE_SPEED_MIN to VOICE_SPEED_MAX (the range the start rule was measured on)
//   emphasisPause  seconds of silence before an emphasised word, 0 to EMPHASIS_PAUSE_MAX; 0 (the default) means
//                  emphasis neither splits a call nor pauses
// Loudness (REQUIRED, checked by validateMode like the voice data):
//   loudness      { lufs, truePeakDb, lra }: the voice master's integrated target (LUFS_MIN to LUFS_MAX), its true-peak
//                  ceiling (TRUE_PEAK_MIN to TRUE_PEAK_MAX dBTP) and loudnorm's loudness range (LRA_MIN to LRA_MAX LU)
// Sound (REQUIRED, checked by validateMode last, after the voice data and loudness):
//   cues          true: sound cues play unless the film says "sound": "off"; false: only when it says "sound": "on"
// Captions (REQUIRED, checked by validateMode after cues):
//   captions      true: a narrated shot whose kind does not show its own words is captioned unless the film says
//                  "captions": false; false: only when it says "captions": true (engine/captions/index.mjs)
import { registries } from '../registry.mjs';
import { pro } from './pro.mjs';
import { viral } from './viral.mjs';

export const VOICE_SPEED_MIN = 0.8;
export const VOICE_SPEED_MAX = 1.25;
export const EMPHASIS_PAUSE_MAX = 3; // as the longest pause a say can write (engine/script/say.mjs PAUSE_MAX)
// The ranges version 1 accepted for a film's loudness (its scripts/lib/loudness.mjs, deleted at cut-over), and loudnorm's own LRA range.
export const LUFS_MIN = -30;
export const LUFS_MAX = -5;
export const TRUE_PEAK_MIN = -3;
export const TRUE_PEAK_MAX = 0;
export const LRA_MIN = 1;
export const LRA_MAX = 50;

const isNumberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const LOUDNESS_FIELDS = Object.freeze([
  ['lufs', LUFS_MIN, LUFS_MAX],
  ['truePeakDb', TRUE_PEAK_MIN, TRUE_PEAK_MAX],
  ['lra', LRA_MIN, LRA_MAX],
]);

/** Throws a RangeError naming the mode when its `loudness` is not { lufs, truePeakDb, lra } inside their ranges. */
export function validateLoudness({ name, loudness }) {
  if (loudness === null || typeof loudness !== 'object') {
    throw new RangeError(`mode "${name}": loudness must be { lufs, truePeakDb, lra }, got ${String(loudness)}`);
  }
  for (const [field, min, max] of LOUDNESS_FIELDS) {
    if (!isNumberIn(loudness[field], min, max)) {
      throw new RangeError(`mode "${name}": loudness.${field} must be a number from ${min} to ${max}, got ${String(loudness[field])}`);
    }
  }
}

/**
 * Throws a RangeError naming the mode and the field when the mode's voice data or loudness is missing or out of range.
 * Returns the mode, so it can be used inline.
 */
export function validateMode(mode) {
  const { name, voiceSpeed, emphasisPause } = mode;
  if (!isNumberIn(voiceSpeed, VOICE_SPEED_MIN, VOICE_SPEED_MAX)) {
    throw new RangeError(`mode "${name}": voiceSpeed must be a number from ${VOICE_SPEED_MIN} to ${VOICE_SPEED_MAX}, got ${String(voiceSpeed)}`);
  }
  if (!isNumberIn(emphasisPause, 0, EMPHASIS_PAUSE_MAX)) {
    throw new RangeError(`mode "${name}": emphasisPause must be a number of seconds from 0 to ${EMPHASIS_PAUSE_MAX}, got ${String(emphasisPause)}`);
  }
  validateLoudness(mode);
  if (typeof mode.cues !== 'boolean') {
    throw new RangeError(`mode "${name}": cues must be true or false, got ${String(mode.cues)}`);
  }
  if (typeof mode.captions !== 'boolean') {
    throw new RangeError(`mode "${name}": captions must be true or false, got ${String(mode.captions)}`);
  }
  return mode;
}

// Every mode added to the shared registry is checked as it is added, so a mode with no voice data or no loudness cannot
// register. The registry itself (engine/registry.mjs) is generic and knows nothing of modes, so its `add` for modes is
// wrapped here, once (a second evaluation of this file keeps the first wrapper).
const addMode = registries.modes.add;
if (!addMode.validatesModes) {
  const checkedAdd = (name, mode) => {
    validateMode({ ...mode, name });
    addMode(name, mode);
  };
  checkedAdd.validatesModes = true;
  registries.modes.add = checkedAdd;
}

for (const mode of [pro, viral]) {
  if (!registries.modes.has(mode.name)) registries.modes.add(mode.name, Object.freeze(mode));
}

// Modes for the v2 engine. Importing this file registers `pro` and `viral` in registries.modes (once: a second
// evaluation leaves the registry as it is). A mode is behaviour; the look it names is appearance.
//
// Mode = { name, defaultLook, defaultFormat, wpm, tail, maxStillSeconds, hookFromFrameZero, maxLineWords?, maxHookWords?,
//          platformSafeZone?, captions: boolean, voiceSpeed, emphasisPause }
// Voice data (both REQUIRED: a mode without them cannot be registered; checked by validateMode, never decided from a
// mode's name):
//   voiceSpeed     Kokoro speed of the narration, VOICE_SPEED_MIN to VOICE_SPEED_MAX (the range the start rule was measured on)
//   emphasisPause  seconds of silence before an emphasised word, 0 to EMPHASIS_PAUSE_MAX; 0 (the default) means
//                  emphasis neither splits a call nor pauses
import { registries } from '../registry.mjs';
import { pro } from './pro.mjs';
import { viral } from './viral.mjs';

export const VOICE_SPEED_MIN = 0.8;
export const VOICE_SPEED_MAX = 1.25;
export const EMPHASIS_PAUSE_MAX = 3; // as the longest pause a say can write (engine/script/say.mjs PAUSE_MAX)

const isNumberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/**
 * Throws a RangeError naming the mode and the field when the mode's voice data is missing or out of range. Returns the
 * mode, so it can be used inline.
 */
export function validateMode(mode) {
  const { name, voiceSpeed, emphasisPause } = mode;
  if (!isNumberIn(voiceSpeed, VOICE_SPEED_MIN, VOICE_SPEED_MAX)) {
    throw new RangeError(`mode "${name}": voiceSpeed must be a number from ${VOICE_SPEED_MIN} to ${VOICE_SPEED_MAX}, got ${String(voiceSpeed)}`);
  }
  if (!isNumberIn(emphasisPause, 0, EMPHASIS_PAUSE_MAX)) {
    throw new RangeError(`mode "${name}": emphasisPause must be a number of seconds from 0 to ${EMPHASIS_PAUSE_MAX}, got ${String(emphasisPause)}`);
  }
  return mode;
}

// Every mode added to the shared registry is checked as it is added, so a mode with no voice data cannot register. The
// registry itself (engine/registry.mjs) is generic and knows nothing of modes, so its `add` for modes is wrapped here,
// once (a second evaluation of this file keeps the first wrapper).
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

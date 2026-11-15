// Modes for the v2 engine. Importing this file registers `pro` and `viral` in registries.modes (once: a second
// evaluation leaves the registry as it is). A mode is behaviour; the look it names is appearance.
//
// Mode = { name, defaultLook, defaultFormat, wpm, tail, maxStillSeconds, captions: boolean }
import { registries } from '../registry.mjs';
import { pro } from './pro.mjs';
import { viral } from './viral.mjs';

for (const mode of [pro, viral]) {
  if (!registries.modes.has(mode.name)) registries.modes.add(mode.name, Object.freeze(mode));
}

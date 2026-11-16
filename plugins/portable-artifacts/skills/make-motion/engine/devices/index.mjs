// Graphic devices for the v2 engine. Importing this file registers every device in registries.devices (once: a
// second evaluation leaves the registry as it is). A device is { name, supports(look) -> boolean, build(params) }
// where build({ id, box: [x, y, w, h], at, look, unit, seed, measure?, ...extra }) returns
// { nodes: Node[], camera?: key[], boxes?: object }. Devices only build scene-graph nodes; they never draw.
import { registries } from '../registry.mjs';
import { highlight } from './highlight.mjs';
import { underline, circle, arrow, bracket } from './marks.mjs';
import { cutout } from './cutout.mjs';
import { card } from './card.mjs';
import { tag } from './tag.mjs';
import { punch } from './punch.mjs';
import { label } from './label.mjs';
import { focus } from './focus.mjs';
import { route } from './route.mjs';
import { numeral } from './numeral.mjs';
import { sticker } from './sticker.mjs';
import { sweep } from './sweep.mjs';
import { duotone, halftone } from './treatments.mjs';

// A device with `on: false` (numeral, sticker, the treatments) is a layout device: kinds build it, an `on` event cannot place it.
export const DEVICES = Object.freeze([highlight, circle, underline, arrow, bracket, cutout, card, tag, punch, label, focus, route, numeral, sticker, sweep, duotone, halftone]);

for (const device of DEVICES) {
  if (!registries.devices.has(device.name)) registries.devices.add(device.name, device);
}

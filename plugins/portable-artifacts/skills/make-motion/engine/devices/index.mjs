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

export const DEVICES = Object.freeze([highlight, circle, underline, arrow, bracket, cutout, card, tag, punch]);

for (const device of DEVICES) {
  if (!registries.devices.has(device.name)) registries.devices.add(device.name, device);
}

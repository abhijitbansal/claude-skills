// pop's clipping close-ups. In a crisp look a region event is not a camera push (a landscape screenshot pushed in on a
// vertical canvas ends up cropped, its background blown up) but a cut: on the event's frame the whole picture goes
// and the region itself becomes the picture, an image of the same src clipped to the region, built as a cutout and
// fitted to the composition, landing with the look's punch. A later event on a different region cuts to that one.
// Devices on a region are drawn against its close-up, starting on the cut. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { buildDevice } from './shared.mjs';
import { regionMark, markDuration } from './region-mark.mjs';

const REGION_PREFIX = 'region:';
const WIDTH_SHARE = 0.92; // of the available width
const HEIGHT_SHARE = 0.7; // of the available height, at most
const CLEARANCE = 16; // units between the cut-out's shadow and a device placed against it
const HALF = 2;

const regionOf = (item) => (typeof item.target === 'string' && item.target.startsWith(REGION_PREFIX) ? item.target.slice(REGION_PREFIX.length) : null);

/**
 * The close-ups a shot cuts to, in time order: one per region event whose region differs from the one on screen.
 * Each is { region, at, until } (until undefined for the last); events carry { item, j, at, region }.
 */
export function closeUpPlan(shot, ctx) {
  const events = (shot.on ?? []).map((item, j) => ({ item, j, at: ctx.at(item.at), region: regionOf(item) }))
    .filter((e) => e.region !== null)
    .sort((a, b) => a.at - b.at || a.j - b.j);
  const cuts = [];
  for (const e of events) {
    if (cuts.at(-1)?.region === e.region) continue;
    if (cuts.length > 0) cuts.at(-1).until = e.at;
    cuts.push({ region: e.region, at: e.at, until: undefined });
  }
  return { cuts, events };
}

// Shown from `at` until `until`, hidden before and after, switching on exact frames.
function shownBetween(at, until) {
  const keys = at === 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at, v: 1 }];
  if (until !== undefined) keys.push({ t: until, v: 1 }, { t: until, v: 0 });
  return track(keys);
}

// The close-up's size: WIDTH_SHARE of the available width, or HEIGHT_SHARE of its height, whichever binds.
function fitted(clip, area) {
  const fit = Math.min((WIDTH_SHARE * area.w) / clip[2], (HEIGHT_SHARE * area.h) / clip[3]);
  return { w: clip[2] * fit, h: clip[3] * fit };
}

// A device on a close-up starts drawing on the cut: it lands one draw later than its event, or later still for a
// region frame, which draws its four sides in turn. It is placed against the cut-out as drawn, keyline and hard
// shadow included (`reach` past the picture), so an underline or a frame never runs into the shadow.
function closeUpDevice(shot, ctx, e, box, reach) {
  const around = [box[0] - reach, box[1] - reach, box[2] + HALF * reach, box[3] + HALF * reach];
  if (e.item.do === 'highlight') {
    const at = e.at + markDuration(ctx.look);
    return regionMark({ id: `${shot.id}.on${e.j}`, region: around, picture: around, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, dim: false });
  }
  return buildDevice(shot, ctx, { item: e.item, j: e.j, box: around, at: e.at + ctx.look.moves.draw.dur }).nodes;
}

/**
 * The close-up nodes, camera punches and region boxes for a pop clipping.
 * @param {{ picture: { width, height }, area: { w, h }, centre: number[], plan: ReturnType<typeof closeUpPlan> }} p
 *   picture: the image's own pixel size; area: the space the close-up fits in; centre: where it is centred.
 */
export function closeUps(shot, ctx, { picture, area, centre, plan }) {
  const { look, unit, seed } = ctx;
  const reach = (look.keyline + Math.max(look.shadow.dx, look.shadow.dy) + CLEARANCE) * unit;
  const boxes = {};
  const camera = [];
  const nodes = plan.cuts.map((cut, k) => {
    const [fx, fy, fw, fh] = shot.regions[cut.region];
    const clip = [fx * picture.width, fy * picture.height, fw * picture.width, fh * picture.height];
    const { w, h } = fitted(clip, area);
    const box = [centre[0] - w / HALF, centre[1] - h / HALF, w, h];
    boxes[`${REGION_PREFIX}${cut.region}`] ??= box;
    const id = `${shot.id}.close${k}`;
    const image = node('image', `${id}.photo`, { src: shot.src, w, h, clip });
    const cutout = registries.devices.get('cutout').build({ id: `${id}.cutout`, box, at: 0, look, unit, seed, image }).nodes;
    const mine = plan.events.filter((e) => e.region === cut.region && e.at >= cut.at && (cut.until === undefined || e.at < cut.until));
    const devices = mine.flatMap((e) => closeUpDevice(shot, ctx, e, box, reach));
    camera.push(registries.devices.get('punch').build({ id: `${id}.punch`, box, at: cut.at, look, unit, seed }).camera);
    return node('group', id, {}, { tracks: { opacity: shownBetween(cut.at, cut.until) }, children: [...cutout, ...devices] });
  });
  return { nodes, camera, boxes };
}

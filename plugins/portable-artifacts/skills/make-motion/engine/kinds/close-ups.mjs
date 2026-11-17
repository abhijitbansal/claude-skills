// pop's clipping close-ups. In a crisp look a region event is not a camera push (a landscape screenshot pushed in on a
// vertical canvas ends up cropped, its background blown up) but a cut: on the event's frame the whole picture goes
// and the region itself becomes the picture, an image of the same src clipped to the region, built as a cutout and
// fitted to the composition, landing with the look's punch. A later event on a different region cuts to that one.
// Devices on a region are drawn against its close-up, starting on the cut. A highlight on a close-up is the look's
// cutout emphasis where the look styles one (pop: the hard shadow turns accent and grows; nothing is drawn), else a
// ruled frame. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { REGION_PREFIX, regionOf, shownFrom, buildDevice } from './shared.mjs';
import { regionMark, markDuration } from './region-mark.mjs';

const WIDTH_SHARE = 0.92; // of the available width
const HEIGHT_SHARE = 0.7; // of the available height, at most
const CLEARANCE = 16; // units between the cut-out's shadow and a device placed against it
const CONTEXT_GAP = 12; // units between a region inside a context window and a device placed round it
const HALF = 2;

/** The id of a close-up's drawn picture (the cutout device's image, `<shot id>.close<k>.cutout.image`), which the frame
 *  review reads to know a close-up is on screen (engine/review/regions.mjs). */
export const CLOSE_UP_PHOTO_RE = /\.close\d+\.cutout\.image$/;

/** The band, in px past the keyline and shadow, that the drawn devices of a shot's region events take under a close-up
 *  (CLEARANCE and the widest stroke): 0 when none draws one. A caption pinned under the picture keeps this too. */
export function markRoom(shot, look, unit) {
  const drawn = (shot.on ?? []).filter((e) => regionOf(e.target) !== null && !(e.do === 'highlight' && emphasisStyled(look)));
  if (drawn.length === 0) return 0;
  return (CLEARANCE + Math.max(0, ...drawn.map((e) => look.devices?.[e.do]?.width ?? 0))) * unit;
}

// The look marks a highlighted close-up through its cut-out (devices.cutout.emphasis) rather than a frame.
const emphasisStyled = (look) => look.devices?.cutout?.emphasis !== undefined;

/**
 * The close-ups a shot cuts to, in time order: one per region event whose region differs from the one on screen.
 * Each is { region, at, until } (until undefined for the last); events carry { item, j, at, region }.
 */
export function closeUpPlan(shot, ctx) {
  const events = (shot.on ?? []).map((item, j) => ({ item, j, at: ctx.at(item.at), region: regionOf(item.target) }))
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

// The close-up's size: a share of the available width, or of its height, whichever binds. The shares are the look's
// (look.camera.closeUp: { width, height }), else WIDTH_SHARE and HEIGHT_SHARE.
function fitted(clip, area, look) {
  const { width = WIDTH_SHARE, height = HEIGHT_SHARE } = look.camera?.closeUp ?? {};
  const fit = Math.min((width * area.w) / clip[2], (height * area.h) / clip[3]);
  return { w: clip[2] * fit, h: clip[3] * fit };
}

// The window of the source a close-up shows: the region itself, or, where the look asks for context
// (look.camera.closeUp.pad: a share of the region's size added on every side), the region with the source round it,
// kept inside the picture. A mark then rings the region on the picture, and the words at the region's edge are not cut
// by the frame.
function contextWindow(region, picture, look) {
  const { pad } = look.camera?.closeUp ?? {};
  if (pad === undefined) return region;
  const [x, y, w, h] = region;
  const ww = Math.min(picture.width, w * (1 + HALF * pad));
  const hh = Math.min(picture.height, h * (1 + HALF * pad));
  const within = (start, size, whole) => Math.min(whole - size, Math.max(0, start));
  return [within(x + w / HALF - ww / HALF, ww, picture.width), within(y + h / HALF - hh / HALF, hh, picture.height), ww, hh];
}

/** How wide `region` (fractions of the picture) is drawn on its close-up, in px: the region's share of the fitted
 *  window (contextWindow). A kind compares it with the region on the establishing picture (look.camera.closeUp.minGain). */
export function closeUpRegionWidth([fx, fy, fw, fh], picture, area, look) {
  const region = [fx * picture.width, fy * picture.height, fw * picture.width, fh * picture.height];
  const clip = contextWindow(region, picture, look);
  return fitted(clip, area, look).w * (region[2] / clip[2]);
}

// A device on a close-up: { nodes, camera }. A drawn device starts drawing on the cut: it lands one draw later than its
// event, or later still for a region frame, which draws its four sides in turn; a punch keeps its own time and camera
// keys. It is placed against the cut-out as drawn, keyline and hard shadow included (`reach` past the picture), so an
// underline or a frame never runs into the shadow.
function closeUpDevice(shot, ctx, e, box, reach) {
  const around = [box[0] - reach, box[1] - reach, box[2] + HALF * reach, box[3] + HALF * reach];
  if (e.item.do === 'highlight' && emphasisStyled(ctx.look)) return { nodes: [], camera: [] }; // the cutout's shadow carries it
  if (e.item.do === 'highlight') {
    const at = e.at + markDuration(ctx.look);
    return { nodes: regionMark({ id: `${shot.id}.on${e.j}`, region: around, at, look: ctx.look, unit: ctx.unit, seed: ctx.seed }), camera: [] };
  }
  const at = e.item.do === 'punch' ? e.at : e.at + ctx.look.moves.draw.dur;
  const built = buildDevice(shot, ctx, { item: e.item, j: e.j, box: around, at });
  return { nodes: built.nodes, camera: built.camera ?? [] };
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
  const marks = []; // the band each drawn device takes round its close-up, its stroke included (a pinned caption clears it)
  const nodes = plan.cuts.map((cut, k) => {
    const [fx, fy, fw, fh] = shot.regions[cut.region];
    const region = [fx * picture.width, fy * picture.height, fw * picture.width, fh * picture.height];
    const clip = contextWindow(region, picture, look);
    const { w, h } = fitted(clip, area, look);
    const box = [centre[0] - w / HALF, centre[1] - h / HALF, w, h];
    // the region on the drawn close-up: the whole of it, or its place inside a context window
    const scale = w / clip[2];
    const marked = clip === region ? box : [box[0] + (region[0] - clip[0]) * scale, box[1] + (region[1] - clip[1]) * scale, region[2] * scale, region[3] * scale];
    const gap = clip === region ? reach : CONTEXT_GAP * unit; // inside the picture there is no keyline or shadow to clear
    boxes[`${REGION_PREFIX}${cut.region}`] ??= marked;
    const id = `${shot.id}.close${k}`;
    const image = node('image', `${id}.photo`, { src: shot.src, w, h, clip });
    const mine = plan.events.filter((e) => e.region === cut.region && e.at >= cut.at && (cut.until === undefined || e.at < cut.until));
    const lift = emphasisStyled(look) ? mine.find((e) => e.item.do === 'highlight')?.at : undefined;
    const cutout = registries.devices.get('cutout').build({ id: `${id}.cutout`, box, at: 0, look, unit, seed, image, ...(lift === undefined ? {} : { emphasisAt: lift }) }).nodes;
    const devices = mine.map((e) => closeUpDevice(shot, ctx, e, marked, gap));
    mine.filter((e, i) => devices[i].nodes.length > 0).forEach((e) => {
      const stroke = (look.devices?.[e.item.do]?.width ?? 0) * unit;
      marks.push([marked[0] - gap, marked[1] - gap, marked[2] + HALF * gap, marked[3] + HALF * gap + stroke]);
    });
    camera.push(registries.devices.get('punch').build({ id: `${id}.punch`, box, at: cut.at, look, unit, seed }).camera);
    camera.push(...devices.map((d) => d.camera).filter((keys) => keys.length > 0));
    return node('group', id, {}, { tracks: { opacity: shownFrom(cut.at, cut.until) }, children: [...cutout, ...devices.flatMap((d) => d.nodes)] });
  });
  return { nodes, camera, boxes, marks };
}

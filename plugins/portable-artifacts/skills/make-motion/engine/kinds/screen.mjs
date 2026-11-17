// The `screen` kind: a screenshot upright in a device frame drawn from paths (screen-frame.mjs: browser, window, phone
// or none; default by the picture's shape), its `title` and `url` in the chrome (the url is display text, never fetched
// or checked). A clipping is a piece of paper on the desk; a screen is a device. Named `regions` (as clipping's) can be
// marked by `on` events, and the camera goes to one, `zoom`, or the first region an `on` event aims at: a push with the
// rest dimmed where the camera moves (desk), a cut to a close-up where it is locked (pop); a wide screen on a tall frame
// is two panels instead, the region enlarged under the whole screen (screen-layout.mjs). The arrival is a `zoom` sound
// event. How each look styles it is look data (look.kinds.screen). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { resolveAnchor } from '../script/anchors.mjs';
import { regionProblems, closeUpProblems } from './clipping-rules.mjs';
import { regionFloor } from './camera.mjs';
import { landBy } from './arrivals.mjs';
import { REGION_PREFIX, regionOf, cutsToCloseUp, isWide, fieldNode, onDevices, placeDevices, deviceCamera, requireDevice, NOT_BLANK, assertNoBlanks } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { FRAMES } from './screen-frame.mjs';
import { frameFor, isTwoPanel, twoPanelLayout, singleLayout, zoomReach } from './screen-layout.mjs';
import { unmarked } from './shared.mjs';
import { unitOf } from '../units.mjs';

const KIND = 'screen';
const TITLE_MAX = 40;
const URL_MAX = 48;
const REGIONS_MAX = 8;
// The zoom waits for the whole screen to be seen as a push would (camera.mjs regionFloor of a moving camera) in every
// look, so the sound plan, which knows no look, times the zoom event as the picture does.
const PUSHING = Object.freeze({ camera: Object.freeze({ style: 'desk' }) });
const FRACTION = { type: 'number', minimum: 0, maximum: 1 };

const isRegionEvent = (item) => regionOf(item?.target) !== null;

/** The region the shot zooms to: its `zoom`, else the first region an `on` event aims at; null for none. */
export const zoomRegion = (shot) => shot.zoom ?? regionOf((shot.on ?? []).find(isRegionEvent)?.target) ?? null;

// When the zoom would land before the floor and the latest landing are applied: the first on event aimed at a region;
// else the second sentence; else the narration's midpoint; else (a held shot) its middle.
function rawZoomTime(shot, timing) {
  const event = (shot.on ?? []).find(isRegionEvent);
  if (event) return resolveAnchor(event.at, timing);
  if (timing.sentences?.length >= 2) return timing.sentences[1].start;
  if (timing.words.length > 0) return (timing.words[0].start + timing.words.at(-1).end) / 2;
  return timing.duration / 2;
}

/** The zoom's landing in shot seconds, or null when the shot has none: after the whole screen has been seen, and in time
 *  to hold (arrivals.mjs landBy). */
export function zoomTime(shot, timing) {
  if (zoomRegion(shot) === null) return null;
  return landBy(Math.max(rawZoomTime(shot, timing), regionFloor(shot, { look: PUSHING, timing })), timing);
}

function zoomProblems(shot) {
  if (shot.zoom === undefined) return [];
  const names = Object.keys(shot.regions ?? {});
  if (names.includes(shot.zoom)) return [];
  const hint = didYouMean(shot.zoom, names);
  return [{ path: 'zoom', message: `no region "${shot.zoom}"${hint ? `; did you mean "${hint}"?` : ''} (regions: ${names.join(', ') || 'none'})` }];
}

// A zoom the picture's pixels cannot carry stops at its own resolution (screen-layout.mjs: a push's cap, a panel drawn
// no larger than its crop) and says so, with the picture width the whole zoom needs.
const ZOOM_SLACK = 1.01; // a zoom within 1% of the picture's resolution is not reported
function zoomResolution(shot, { canvas, look, viralInsets }, picture) {
  const region = shot.regions?.[zoomRegion(shot)];
  if (!region || !supportsKindData(look)) return [];
  const reach = zoomReach(shot, { look, canvas, unit: unitOf(canvas), viralInsets, captions: false, data: kindData(look, KIND) }, picture, region);
  if (reach === null || reach.wanted <= reach.cap * ZOOM_SLACK) return [];
  const need = Math.ceil((picture.width * reach.wanted) / reach.cap);
  return [{ path: 'zoom', at: 0, message: `the picture is ${picture.width} px wide, so the zoom to "${zoomRegion(shot)}" stops at its own resolution instead of a soft upscale; give a picture at least ${need} px wide for the whole zoom` }];
}
const supportsKindData = (look) => look.kinds?.[KIND] !== undefined;

function screenProblems(shot, { look, at } = {}) {
  return [...kindSupportProblems(KIND, look), ...regionProblems(shot), ...zoomProblems(shot), ...closeUpProblems(shot, look, at)];
}

// Creative advice: nothing to go to (a still), a wide screen on a tall frame with nothing to enlarge, chrome text the
// frame has no row for. `asset(src)` is the picture's loaded size (scripts/v2/review.mjs), undefined when unknown.
function screenReview(shot, { canvas, asset, look, viralInsets }) {
  const out = [];
  const none = zoomRegion(shot) === null;
  if (none) out.push({ path: 'zoom', at: 0, message: 'name a region to go to, or mark one with an on event: a screen that only sits there is a still' });
  const picture = typeof asset === 'function' ? asset(shot.src) : undefined;
  if (!picture) return out;
  if (!none && look) out.push(...zoomResolution(shot, { canvas, look, viralInsets }, picture));
  if (none && isTwoPanel(shot, picture, canvas)) out.push({ path: 'regions', at: 0, message: 'name a region to enlarge: a wide screen on a tall frame leaves half of it empty' });
  const frame = frameFor(shot, picture);
  if (shot.title !== undefined && !['browser', 'window'].includes(frame)) out.push({ path: 'title', at: 0, message: `a ${frame} frame has no title row, so the title is not drawn; use frame "browser" or "window", or remove it` });
  if (shot.url !== undefined && frame !== 'browser') out.push({ path: 'url', at: 0, message: `a ${frame} frame has no address row, so the url is not drawn; use frame "browser", or remove it` });
  return out;
}

function expandScreen(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit, canvas } = ctx;
  const data = kindData(look, KIND);
  const picture = ctx.asset(shot.src);
  const region = zoomRegion(shot);
  const zoom = region === null ? null : { region, at: zoomTime(shot, timing) };
  const two = isTwoPanel(shot, picture, canvas);
  const cuts = zoom !== null && !two && cutsToCloseUp(look) && isWide(canvas); // screen-layout.mjs singleLayout
  if (cuts) requireDevice(look, 'punch', KIND);
  const laid = two ? twoPanelLayout(shot, { ...ctx, data }, { picture, zoom }) : singleLayout(shot, { ...ctx, data }, { picture, zoom });
  const devices = onDevices(shot, ctx, { boxes: laid.boxes, defaultTarget: 'screen', skip: cuts ? isRegionEvent : () => false });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...laid.camera, ...deviceCamera(devices)],
    boxes: laid.boxes,
    hero: `${shot.id}.screen`,
    background: look.palette.paper,
  };
}

function screenField(shot, id) {
  if (id === `${shot.id}.title`) return 'title';
  if (id === `${shot.id}.url`) return 'url';
  if (id === `${shot.id}.screen.image` || id === `${shot.id}.panel.image` || id.startsWith(`${shot.id}.close`)) return 'src';
  return undefined;
}

registries.kinds.add(KIND, {
  summary: 'A screenshot upright in a device frame (browser, window, phone or none) with its title and url in the chrome; the camera goes to a named region (zoom, or the first region an on event marks): a push in desk, a cut to a close-up in pop, or on a tall frame the region enlarged under the screen.',
  example: {
    id: 'report', show: KIND, src: 'assets/screenshot.png', say: 'This is the weekly report. The total sits at the bottom.',
    // a region the picture's own pixels carry at the full push (a narrower one is a resolution finding)
    title: 'Weekly report', url: 'example.com/report', regions: { total: [0.05, 0.6, 0.9, 0.3] }, zoom: 'total',
  },
  schema: {
    required: ['src'],
    properties: {
      src: { type: 'string', minLength: 1 },
      frame: { enum: [...FRAMES] },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      url: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: URL_MAX },
      regions: { type: 'object', maxProperties: REGIONS_MAX, propertyNames: { pattern: '^[a-z][a-z0-9-]*$' }, additionalProperties: { type: 'array', items: FRACTION, minItems: 4, maxItems: 4 } },
      zoom: { type: 'string', minLength: 1, pattern: NOT_BLANK },
    },
  },
  srcFields: ['src'],
  steeringFields: ['frame', 'regions', 'zoom'],
  heroTarget: 'screen',
  targets: (shot) => ['screen', ...Object.keys(shot.regions ?? {}).map((name) => `${REGION_PREFIX}${name}`)],
  ids: (shot) => [`${shot.id}.screen`],
  nodeField: screenField,
  validate: screenProblems,
  review: screenReview,
  expand: (shot, ctx) => expandScreen(unmarked(shot), ctx),
  // the zoom's arrival: a device event the looks name a sound for (sounds.device.zoom)
  eventDevices: Object.freeze(['zoom']),
  events: (shot, timing) => {
    const t = zoomTime(shot, timing);
    return t === null ? [] : [{ kind: 'device', device: 'zoom', t }];
  },
  lookData: true, // a look ships it only with a kinds.screen entry (engine/looks/index.mjs listedKinds)
  numbered: false,
  showsWords: false, // its narration is not its picture: captioned (engine/captions)
});

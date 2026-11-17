// The `map` kind: the world or the US with places (a pin and a label each), routes between them and highlighted
// countries or states. The atlases and the projection run in Node (scripts/v2/prepare/map.mjs: the page cannot load
// d3-geo), so this kind declares `prepared: true` and draws ctx.prepared (map-draw.mjs). A place, and a highlighted area,
// lands on the word that names it, else one per sentence, else evenly; a route draws once both its ends are on. Sound
// events: `pin` (a place) and `link` (a route drawn; not the `route` device's own cue). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { landBy, namedTimes } from './arrivals.mjs';
import { WORLD_NAMES, US_NAMES } from './map-names.mjs';
import { mapLayout } from './map-draw.mjs';

const KIND = 'map';
const ROUTE_LAG = 0.5; // s after both ends are on that a route has drawn
const NAMES = Object.freeze({ world: WORLD_NAMES, us: US_NAMES });
const AREA = Object.freeze({ world: 'country', us: 'state' });
const MAP_NAME = Object.freeze({ world: 'world', us: 'US' });
const LON = 180, LAT = 90;

/** When the places, highlighted areas and routes arrive, in shot seconds. */
export function arrivals(shot, timing) {
  const places = namedTimes((shot.places ?? []).map((p) => p.name), timing);
  const at = new Map((shot.places ?? []).map((p, i) => [p.name, places[i]]));
  const routes = (shot.routes ?? []).map((r) => landBy(Math.max(at.get(r.from) ?? 0, at.get(r.to) ?? 0) + ROUTE_LAG, timing));
  return { places, highlights: namedTimes(shot.highlight ?? [], timing), routes };
}

function placeProblems(shot) {
  const seen = new Set();
  return (shot.places ?? []).flatMap((p, i) => {
    const out = [];
    const [lon, lat] = p.at ?? [];
    if (!(Math.abs(lon) <= LON && Math.abs(lat) <= LAT)) out.push({ path: `places.${i}.at`, message: `longitude must be from -180 to 180 and latitude from -90 to 90, got [${(p.at ?? []).join(', ')}]` });
    if (seen.has(p.name)) out.push({ path: `places.${i}.name`, message: `duplicate place "${p.name}"` });
    seen.add(p.name);
    return out;
  });
}

function routeProblems(shot) {
  const names = (shot.places ?? []).map((p) => p.name);
  return (shot.routes ?? []).flatMap((r, j) => {
    if (r.from === r.to) return [{ path: `routes.${j}`, message: 'a route from a place to itself' }];
    return ['from', 'to'].filter((end) => !names.includes(r[end]))
      .map((end) => ({ path: `routes.${j}.${end}`, message: `no place "${r[end]}"; the places are: ${names.join(', ') || 'none'}` }));
  });
}

function highlightProblems(shot) {
  const names = NAMES[shot.region] ?? [];
  return (shot.highlight ?? []).flatMap((name, i) => {
    if (names.includes(name)) return [];
    const hint = didYouMean(name, names);
    return [{ path: `highlight.${i}`, message: `no ${AREA[shot.region]} "${name}" in the ${MAP_NAME[shot.region]} map${hint ? `; did you mean "${hint}"?` : ''}` }];
  });
}

function mapProblems(shot, { look } = {}) {
  const empty = (shot.places ?? []).length === 0 && (shot.highlight ?? []).length === 0 ? [{ path: 'places', message: 'a map needs places or highlight' }] : [];
  return [...kindSupportProblems(KIND, look), ...empty, ...placeProblems(shot), ...routeProblems(shot), ...highlightProblems(shot)];
}

// What the kind does not draw yet, said (never silent): the `places` view (it needs a clip the engine has not) and route labels.
function mapReview(shot) {
  const out = shot.view === 'places' ? [{ path: 'view', at: 0, message: 'the places view is not drawn yet: the whole map is shown' }] : [];
  return [...out, ...(shot.routes ?? []).flatMap((r, j) => (r.label === undefined ? [] : [{ path: `routes[${j}].label`, at: 0, message: 'route labels are not drawn yet' }]))];
}

function expandMap(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const laid = mapLayout(shot, { ...ctx, data }, ctx.prepared, arrivals(shot, timing));
  const devices = onDevices(shot, ctx, { boxes: laid.boxes, defaultTarget: 'map' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: laid.boxes, hero: `${shot.id}.map`, background: look.palette.paper,
  };
}

function mapField(shot, id) {
  if (id === `${shot.id}.title` || id === `${shot.id}.title.text`) return 'title';
  if (id === `${shot.id}.source`) return 'source';
  if (id === `${shot.id}.land`) return 'region';
  if (/\.key\d+(\.|$)/.test(id)) return null; // a tall frame's key: the numbered discs and their rows (the names are list<i>)
  if (/\.(place\d+|list\d+)(\.|$)/.test(id)) return 'places';
  if (/\.hl\d+$/.test(id)) return 'highlight';
  if (/\.route\d+(\.|$)/.test(id)) return 'routes';
  return undefined;
}

const PLACE = { type: 'object', additionalProperties: false, required: ['name', 'at'], properties: { name: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: 24 }, at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } };
const ROUTE = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string', minLength: 1, pattern: NOT_BLANK }, to: { type: 'string', minLength: 1, pattern: NOT_BLANK }, label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: 24 } } };

registries.kinds.add(KIND, {
  summary: 'The world or the US with places (a pin and a label each), routes between them and highlighted countries or states, each arriving on the word that names it. Projected at render time from the bundled atlases.',
  example: {
    id: 'reach', show: KIND, region: 'world', say: 'We ship from Paris to Nairobi and Tokyo.', title: 'Where we ship',
    places: [{ name: 'Paris', at: [2.35, 48.86] }, { name: 'Nairobi', at: [36.82, -1.29] }, { name: 'Tokyo', at: [139.69, 35.68] }],
    routes: [{ from: 'Paris', to: 'Nairobi' }, { from: 'Paris', to: 'Tokyo' }],
  },
  schema: {
    required: ['region'],
    properties: {
      region: { enum: ['world', 'us'] },
      places: { type: 'array', maxItems: 8, items: PLACE },
      routes: { type: 'array', maxItems: 6, items: ROUTE },
      highlight: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, pattern: NOT_BLANK } },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: 60 },
      source: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: 60 },
      view: { enum: ['whole', 'places'] },
    },
  },
  srcFields: [],
  prepared: true,
  steeringFields: ['view'],
  heroTarget: 'map',
  targets: (shot) => ['map', ...(shot.places ?? []).map((p) => `place:${p.name}`)],
  ids: (shot) => [`${shot.id}.map`],
  nodeField: mapField,
  validate: mapProblems,
  review: mapReview,
  expand: expandMap,
  arrivals,
  eventDevices: Object.freeze(['pin', 'link']),
  events: (shot, timing) => {
    const t = arrivals(shot, timing);
    return [...t.places.map((at) => ({ kind: 'device', device: 'pin', t: at })), ...t.routes.map((at) => ({ kind: 'device', device: 'link', t: at }))];
  },
  lookData: true,
  numbered: false,
  showsWords: false,
});

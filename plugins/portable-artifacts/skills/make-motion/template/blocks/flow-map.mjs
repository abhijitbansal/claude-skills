// flow-map: a world or US map with arcs between places, drawn one after another, and each flow's caption under the map
// while its arc is the newest. Every arc is its own chart laid exactly over the map's: the same atlas, the same projection
// and the same fit, so they line up (see fitAnchors).
import { MAP_KINDS, kindOf, projectionOf, mapBox, mapSpec, landLayer, fitLayer, chartPart } from './map-layout.mjs';
import { unit, contentWidth, fitText, squeeze, textPart, enter, blockGroup, stack, MIN_TEXT, ENTER_SECONDS, centrePlace } from './layout.mjs';

const MAX_FLOWS = 12;
const MAX_LABEL = 40;
const LAT_RANGE = [-85, 83]; // the atlas's land spans -90..83.6; Mercator stops at 85
const point = {
  type: 'object',
  additionalProperties: false,
  required: ['lon', 'lat'],
  properties: {
    lon: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: LAT_RANGE[0], maximum: LAT_RANGE[1] },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['flows'],
  properties: {
    map: { enum: [...MAP_KINDS], default: 'world' },
    flows: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_FLOWS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to'],
        properties: { from: point, to: point, label: { type: 'string', minLength: 1, maxLength: MAX_LABEL } },
      },
    },
  },
};

const MAP_IN = 0.6; // the map has faded in by this second; the first arc starts then
const STEP_BARE = 0.5; // seconds between arcs
const STEP_LABELLED = 1.2; // ... when the flows have captions, so each can be read while its arc is the newest
const FADE_OUT = 0.3; // a caption fades out over this long, ending as the next one starts to enter

const coordinates = (flow) => [[flow.from.lon, flow.from.lat], [flow.to.lon, flow.to.lat]];
const ends = (flows) => flows.flatMap((flow) => [flow.from, flow.to].map(({ lon, lat }) => ({ lon, lat })));

// Invisible points at every end of every flow. Every chart carries the same ones, so the projection (which fits to the
// data of all layers) is the same in the map and in each arc's chart, whatever the points.
const fitAnchors = (flows) => ({
  data: { values: ends(flows) },
  mark: { type: 'point', opacity: 0 },
  encoding: { longitude: { field: 'lon', type: 'quantitative' }, latitude: { field: 'lat', type: 'quantitative' } },
});

// The arc of one flow (a great circle, drawn as such by the projection) and a dot at each end.
const arcLayers = (flow, u) => [
  {
    data: { values: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordinates(flow) } }] },
    mark: { type: 'geoshape', filled: false, stroke: 'accent', strokeWidth: Math.max(2, Math.round(5 * u)), strokeCap: 'round' },
  },
  {
    data: { values: ends([flow]) },
    mark: { type: 'point', filled: true, fill: 'accent', stroke: 'text', strokeWidth: Math.max(1, Math.round(2 * u)), size: Math.max(9, Math.round((14 * u) ** 2)) },
    encoding: { longitude: { field: 'lon', type: 'quantitative' }, latitude: { field: 'lat', type: 'quantitative' } },
  },
];

function expand(el, ctx) {
  const p = el.params;
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const labelled = p.flows.some((flow) => flow.label);
  const step = labelled ? STEP_LABELLED : STEP_BARE;
  const width = contentWidth(size, 1500 * u, 0, ctx.insets);
  const fits = p.flows.map((flow) => flow.label && fitText(flow.label, { size: 44 * u, min: MIN_TEXT * u, maxWidth: width, maxLines: 2 }));
  const slot = Math.max(0, ...fits.map((fit) => fit?.height ?? 0)); // every caption centres in one slot under the map
  const projection = projectionOf(p);
  const box = mapBox(ctx, el.y, projection, slot);
  const [mapY, labelY] = stack(slot ? [box.height, slot] : [box.height], [box.gap]);
  const start = (i) => MAP_IN + i * step;
  const at = squeeze(sceneDuration, start(p.flows.length - 1) + ENTER_SECONDS);
  const anchors = fitAnchors(p.flows);
  const map = enter(chartPart(`${el.id}/map`, 0, mapY, box, mapSpec(p, [landLayer(u), anchors])), [at(0), at(ENTER_SECONDS)]);
  const arcs = p.flows.map((flow, i) => enter(
    chartPart(`${el.id}/flow-${i + 1}`, 0, mapY, box, mapSpec(p, [fitLayer(), anchors, ...arcLayers(flow, u)])),
    [at(start(i)), at(start(i) + ENTER_SECONDS)],
  ));
  const labels = p.flows.flatMap((flow, i) => {
    if (!flow.label) return [];
    const part = textPart(`${el.id}/label-${i + 1}`, flow.label, 0, labelY, { fontSize: fits[i].fontSize, maxWidth: width, fontWeight: 600, color: 'text' });
    const shown = enter(part, [at(start(i)), at(start(i) + ENTER_SECONDS)]);
    // Gone just before the next caption (the next flow with one) starts to enter, so two never overlap; the last stays.
    const next = p.flows.findIndex((other, j) => j > i && other.label);
    if (next < 0) return [shown];
    const out = [{ t: at(start(next) - FADE_OUT), opacity: 1 }, { t: at(start(next)), opacity: 0, ease: 'exit' }];
    return [{ ...shown, keyframes: [...shown.keyframes, ...out] }];
  });
  return blockGroup(el, [map, ...arcs, ...labels]);
}

export default Object.freeze({
  summary: 'a world or US map with arcs drawn between places one after another, and a caption for each flow under the map while its arc is the newest',
  params,
  describe: {
    map: '"world" (default) or "us"; the US map draws only flows whose ends are inside the United States (Alaska and Hawaii included)',
    flows: `1 to ${MAX_FLOWS} flows drawn in this order, each { "from": { "lon", "lat" }, "to": { "lon", "lat" }, "label"? (up to ${MAX_LABEL} characters) }; lon is -180 to 180, lat is ${LAT_RANGE[0]} to ${LAT_RANGE[1]}, east and north positive`,
  },
  example: {
    map: 'world',
    flows: [
      { from: { lon: -74, lat: 40.7 }, to: { lon: -0.13, lat: 51.5 }, label: 'New York to London' },
      { from: { lon: -0.13, lat: 51.5 }, to: { lon: 77.2, lat: 28.6 }, label: 'London to Delhi' },
      { from: { lon: 77.2, lat: 28.6 }, to: { lon: 139.7, lat: 35.7 }, label: 'Delhi to Tokyo' },
    ],
  },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  paramOf: (part) => {
    const m = /^label-(\d+)$/.exec(part);
    return m ? `flows[${Number(m[1]) - 1}].label` : null;
  },
  expand,
});

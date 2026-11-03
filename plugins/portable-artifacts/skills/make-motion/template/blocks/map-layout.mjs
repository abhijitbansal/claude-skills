// Browser-safe (no Node imports): what the two map blocks (map-highlight, flow-map) share. A map is a `chart` element
// whose Vega-Lite spec draws a bundled atlas (template/maps.mjs): the world (world-110m) or the US states
// (us-states-10m), in surface with line borders, in the projection the map suits. Colours are theme tokens the renderer
// resolves (maps.mjs themeColours), like every other block colour.
import { WORLD_NAMES, US_NAMES } from '../map-names.mjs';
import { unit, contentWidth, freeBand, roomAt } from './layout.mjs';

export const MAP_KINDS = Object.freeze(['world', 'us']);
export const PROJECTIONS = Object.freeze(['equalEarth', 'albersUsa', 'mercator']);
// Per map: the atlas it draws, the names it knows and the projection that suits it.
export const MAPS = Object.freeze({
  world: Object.freeze({ atlas: 'world-110m', names: WORLD_NAMES, projection: 'equalEarth', label: 'world' }),
  us: Object.freeze({ atlas: 'us-states-10m', names: US_NAMES, projection: 'albersUsa', label: 'US' }),
});
// Width over height of the drawn map in each projection: the chart box takes this shape, so the map fills it.
const ASPECT = Object.freeze({ equalEarth: 2, albersUsa: 1.6, mercator: 1.5 });
const MAP_WIDTH = 1500; // px at 1080 on the short side: the widest a map is drawn
const MAP_GAP = 24; // px at 1080 between the map and the line of text under it
const BORDER = 0.7; // px at 1080: a country's or state's outline

export const kindOf = (params) => params.map ?? 'world';
export const projectionOf = (params) => params.projection ?? MAPS[kindOf(params)].projection;

/**
 * The chart box of a map centred at canvas `y`, in whole px: the widest of MAP_WIDTH (less the safe area) that the
 * band the block may fill (layout.mjs freeBand, captions and a viral spec's insets honoured) has the height for once
 * `reserved` px of text and its gap are taken off, in the shape of `projection`. At least 1 px each way.
 */
export function mapBox(ctx, y, projection, reserved) {
  const { size, insets } = ctx;
  const u = unit(size);
  const aspect = ASPECT[projection];
  const wide = contentWidth(size, MAP_WIDTH * u, 0, insets);
  const high = roomAt(freeBand(ctx), y) - (reserved > 0 ? reserved + MAP_GAP * u : 0);
  const height = Math.max(1, Math.floor(Math.min(wide / aspect, high)));
  return { width: Math.max(1, Math.floor(height * aspect)), height, gap: MAP_GAP * u };
}

const outline = (u) => Math.max(0.25, Math.round(BORDER * u * 100) / 100);

/** The base layer: every feature of the atlas in surface, outlined in text3 (a coast reads on the page colour, a surface alone does not). */
export const landLayer = (u) => ({ mark: { type: 'geoshape', fill: 'surface', stroke: 'text3', strokeWidth: outline(u) } });

/** The layer that draws nothing but holds the fit: the whole atlas, invisible (the projection fits to the data of every layer). */
export const fitLayer = () => ({ mark: { type: 'geoshape', opacity: 0 } });

/** `names` drawn over the land in accent. */
export const highlightLayer = (u, names) => ({
  transform: [{ filter: { field: 'properties.name', oneOf: [...names] } }],
  mark: { type: 'geoshape', fill: 'accent', stroke: 'text3', strokeWidth: outline(u) },
});

/** A Vega-Lite spec for the map `params` choose: the atlas, the projection and `layers`. */
export const mapSpec = (params, layers) => ({ data: { name: MAPS[kindOf(params)].atlas }, projection: { type: projectionOf(params) }, layer: layers });

/** The chart element of a map (positions relative to the block's group centre). */
export const chartPart = (id, x, y, { width, height }, vegaLite) => ({ id, type: 'chart', x: Math.round(x), y: Math.round(y), width, height, vegaLite });

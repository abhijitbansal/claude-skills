// The `map` kind's preparer: projects the shot's atlas (geoEqualEarth for the world, geoAlbersUsa for the US, both from
// d3-geo, fitted to a box WIDTH wide) into plain JSON the page draws: the land and the borders as path strings (to 0.1),
// each highlighted area's path, each place's point, each route as points along it (a great-circle arc on the world, a
// straight line on the US), and the padded box round the places and highlights. A place the projection cannot show (the
// US map shows no Paris) is a problem at its path. Deterministic and bounded; never touches the network. Node only.
import { geoEqualEarth, geoAlbersUsa, geoPath, geoInterpolate } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { atlasOf } from './atlases.mjs';

export const WIDTH = 1000; // the projected map's width; the page scales it to its box
const DIGITS = 1; // path coordinates to 0.1
const ROUTE_POINTS = 9; // points along a route
const EXTENT_PAD = 0.12; // of the extent's larger side, round the places and highlights...
const EXTENT_MIN = 160; // ...and never smaller than this (a single place)
const round = (v) => Math.round(v * 10 ** DIGITS) / 10 ** DIGITS + 0;
const REGION_NAMES = Object.freeze({ world: 'world', us: 'US' });

const projectionOf = (region, areas) => (region === 'us' ? geoAlbersUsa() : geoEqualEarth()).fitWidth(WIDTH, areas);

function placesOf(shot, projection, problems) {
  return (shot.places ?? []).map((place, i) => {
    const xy = projection(place.at);
    if (!xy) {
      problems.push({ path: `places[${i}].at`, message: `[${place.at.join(', ')}] is outside the ${REGION_NAMES[shot.region]} map; use "region": "world"` });
      return null;
    }
    return { name: place.name, x: round(xy[0]), y: round(xy[1]) };
  });
}

function routesOf(shot, projection) {
  const byName = new Map((shot.places ?? []).map((p) => [p.name, p.at]));
  return (shot.routes ?? []).map((route) => {
    const [a, b] = [byName.get(route.from), byName.get(route.to)];
    const along = shot.region === 'world' ? geoInterpolate(a, b) : null;
    const points = Array.from({ length: ROUTE_POINTS }, (_, k) => {
      const t = k / (ROUTE_POINTS - 1);
      const xy = along ? projection(along(t)) : (() => { const [p, q] = [projection(a), projection(b)]; return p && q ? [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] : null; })();
      return xy ? [round(xy[0]), round(xy[1])] : null;
    }).filter(Boolean);
    return { from: route.from, to: route.to, points };
  });
}

// The padded box [x, y, w, h] round the places and the highlighted areas, inside the map's own bounds.
function extentOf(points, boxes, [w, h]) {
  const all = [...points.map(([x, y]) => [x, y, x, y]), ...boxes.map(([[x0, y0], [x1, y1]]) => [x0, y0, x1, y1])];
  if (all.length === 0) return [0, 0, w, h];
  const x0 = Math.min(...all.map((b) => b[0])), y0 = Math.min(...all.map((b) => b[1]));
  const x1 = Math.max(...all.map((b) => b[2])), y1 = Math.max(...all.map((b) => b[3]));
  const pad = Math.max(EXTENT_MIN, EXTENT_PAD * Math.max(x1 - x0, y1 - y0)) / 2;
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  return [round(left), round(top), round(Math.min(w, x1 + pad) - left), round(Math.min(h, y1 + pad) - top)];
}

/** The map shot's prepared data, { data, problems }: problems paths are relative to the shot. */
export function prepareMap(shot) {
  const problems = [];
  const { topology, object } = atlasOf(shot.region);
  const areas = feature(topology, topology.objects[object]);
  const projection = projectionOf(shot.region, areas);
  const path = geoPath(projection).digits(DIGITS);
  const [[bx0, by0], [bx1, by1]] = path.bounds(areas);
  const byName = new Map(areas.features.map((f) => [f.properties.name, f]));
  const lit = (shot.highlight ?? []).map((name) => byName.get(name)).filter(Boolean);
  const places = placesOf(shot, projection, problems);
  const size = [round(bx1), round(by1)];
  const data = {
    region: shot.region, width: WIDTH, height: size[1], origin: [round(bx0), round(by0)],
    land: path(areas), borders: path(mesh(topology, topology.objects[object], (a, b) => a !== b)),
    highlights: lit.map((f) => ({ name: f.properties.name, d: path(f) })),
    places: places.filter(Boolean), routes: routesOf(shot, projection),
    extent: extentOf(places.filter(Boolean).map((p) => [p.x, p.y]), lit.map((f) => path.bounds(f)), size),
  };
  return { data: problems.length > 0 ? null : data, problems };
}

// The `map` kind and its preparer (scripts/v2/prepare/map.mjs): the world or the US projected in Node, places with pins
// and labels that land on the word naming them, routes that draw once both ends are on, highlighted areas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoPath, geoAlbersUsa } from 'd3-geo';
import { feature } from 'topojson-client';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { WORLD_NAMES, US_NAMES } from '../../engine/kinds/map-names.mjs';
import { prepareMap } from '../../scripts/v2/prepare/map.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const map = registries.kinds.get('map');
const require = createRequire(import.meta.url);
const PARIS = { name: 'Paris', at: [2.35, 48.86] };
const NAIROBI = { name: 'Nairobi', at: [36.82, -1.29] };
const TOKYO = { name: 'Tokyo', at: [139.69, 35.68] };
const base = (extra = {}) => ({ id: 'm', show: 'map', region: 'world', places: [PARIS, NAIROBI, TOKYO], ...extra });
const expand = (shot, look = 'desk', format = '16:9', extra = {}) => {
  const film = filmOf([shot], look, format, extra);
  return expandIn(film, 0, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
};
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;

// ---- the preparer ----

test('prepared: Paris, Nairobi and Tokyo land where the projection puts them (checked by eye: Paris upper middle, Nairobi on the equator line, Tokyo right)', () => {
  const { data, problems } = prepareMap(base());
  assert.deepEqual(problems, []);
  const at = Object.fromEntries(data.places.map((p) => [p.name, [p.x, p.y]]));
  const near = ([x, y], [ex, ey]) => assert.ok(Math.abs(x - ex) <= 1 && Math.abs(y - ey) <= 1, `${x},${y} vs ${ex},${ey}`);
  near(at.Paris, [505.5, 71.9]);
  near(at.Nairobi, [604.2, 250.7]);
  near(at.Tokyo, [859.5, 114.4]);
  assert.equal(data.width, 1000);
});

test('prepared data is byte-identical on a second run and the world is under 300 KB', () => {
  const shot = base({ highlight: ['Brazil', 'Kenya'], routes: [{ from: 'Paris', to: 'Tokyo' }] });
  const once = JSON.stringify(prepareMap(shot));
  assert.equal(JSON.stringify(prepareMap(shot)), once);
  assert.ok(once.length < 300 * 1024, `${once.length} bytes`);
});

test('a place outside the US map is a problem at its path, through the film prepare step', () => {
  const film = filmOf([{ id: 'u', show: 'map', region: 'us', places: [PARIS], hold: 2 }]);
  assert.deepEqual(prepareFilm(film, { filmDir: '.' }).problems, [{ path: 'shots[0].places[0].at', message: '[2.35, 48.86] is outside the US map; use "region": "world"' }]);
});

test('the name lists equal the pinned atlas files, the US list its drawable states (a version bump fails here)', () => {
  const read = (file) => JSON.parse(readFileSync(require.resolve(file), 'utf8'));
  const world = read('world-atlas/countries-110m.json');
  assert.deepEqual([...new Set(world.objects.countries.geometries.map((g) => g.properties.name))].sort(), [...WORLD_NAMES].sort());
  // geoAlbersUsa draws the 50 states and DC; the territories in the file (American Samoa, Guam, ...) it cannot place
  const us = read('us-atlas/states-10m.json');
  const path = geoPath(geoAlbersUsa());
  const drawable = feature(us, us.objects.states).features.filter((f) => path(f)).map((f) => f.properties.name);
  assert.deepEqual([...new Set(drawable)].sort(), [...US_NAMES].sort());
});

// ---- validation ----

test('validation: coordinates, highlight names with did-you-mean, routes to real places, no loops, no duplicates', () => {
  const has = (shot, path, message) => assert.ok(errorsOf(shot).some((e) => e.path === path && e.message === message), JSON.stringify(errorsOf(shot)));
  has(base({ hold: 2, places: [PARIS, { name: 'Far', at: [200, 10] }] }), 'shots[0].places[1].at', 'longitude must be from -180 to 180 and latitude from -90 to 90, got [200, 10]');
  has(base({ hold: 2, highlight: ['Brasil'] }), 'shots[0].highlight[0]', 'no country "Brasil" in the world map; did you mean "Brazil"?');
  has(base({ hold: 2, places: [PARIS, NAIROBI], routes: [{ from: 'Paris', to: 'Lagos' }] }), 'shots[0].routes[0].to', 'no place "Lagos"; the places are: Paris, Nairobi');
  has(base({ hold: 2, routes: [{ from: 'Paris', to: 'Paris' }] }), 'shots[0].routes[0]', 'a route from a place to itself');
  has(base({ hold: 2, places: [PARIS, { ...PARIS, at: [3, 49] }] }), 'shots[0].places[1].name', 'duplicate place "Paris"');
  has({ id: 'm', show: 'map', region: 'world', hold: 2 }, 'shots[0].places', 'a map needs places or highlight');
  assert.deepEqual(errorsOf(base({ hold: 2, highlight: ['Kenya'], routes: [{ from: 'Paris', to: 'Tokyo', label: 'by air' }], title: 'Where we ship', source: 'Our data' })), []);
});

// ---- timing ----

test('a place lands on the word naming it; else one per sentence; else evenly; a route draws once both ends are on', () => {
  const named = base({ say: 'We start in Tokyo, then Paris, then Nairobi.', routes: [{ from: 'Paris', to: 'Tokyo' }] });
  const out = expand(named);
  const word = (w) => out.timing.words.find((x) => x.text.toLowerCase().startsWith(w)).start;
  const arrivals = map.arrivals(named, out.timing);
  assert.ok(Math.abs(arrivals.places[2] - word('tokyo')) < 1e-9 || arrivals.places[2] === 0, 'Tokyo on its word');
  assert.ok(Math.abs(arrivals.places[0] - word('paris')) < 1e-9);
  assert.ok(arrivals.routes[0] >= Math.max(arrivals.places[0], arrivals.places[2]), 'not before both ends');
  const sentences = base({ say: 'One city. Another one. And a third.' });
  const s = expand(sentences);
  assert.deepEqual(map.arrivals(sentences, s.timing).places, s.timing.sentences.map((x, k) => (k === 0 ? 0 : x.start)));
  const held = base({ hold: 4 });
  const h = map.arrivals(held, expand(held).timing).places;
  assert.ok(h[0] === 0 && h[1] > 0 && h[2] > h[1] && h[2] <= 4 - 0.6, `evenly, landed in time: ${h}`);
});

test('the land is whole on frame 0; a pin and its label arrive together; events are pin and link', () => {
  const shot = base({ say: 'We start in Tokyo, then Paris, then Nairobi.', routes: [{ from: 'Paris', to: 'Tokyo' }] });
  const out = expand(shot);
  const land = all(out.nodes).find((n) => n.id === 'm.land');
  assert.equal(land.tracks.opacity, undefined);
  const pin = all(out.nodes).find((n) => n.id === 'm.place1.pin');
  const at = map.arrivals(shot, out.timing).places[1];
  assert.equal(sample(pin.tracks.opacity, Math.max(0, at - 0.05)), at > 0 ? 0 : 1);
  assert.equal(sample(pin.tracks.opacity, at), 1);
  const events = map.events(shot, out.timing);
  assert.deepEqual(events.map((e) => e.device), ['pin', 'pin', 'pin', 'link']);
  assert.deepEqual(map.eventDevices, ['pin', 'link']);
});

test('view: whole is drawn; places is not drawn yet and says so', () => {
  assert.deepEqual(map.review(base({ hold: 2, view: 'places' }), {}).map((f) => f.path), ['view']);
  assert.deepEqual(map.review(base({ hold: 2 }), {}), []);
});

// ---- the bar ----

const example = () => map.example;
const full = () => base({
  say: 'We ship from Paris to Nairobi and Tokyo. Kenya is our largest market.', title: 'Where we ship', source: 'Our shipping data, 2026',
  highlight: ['Kenya'], routes: [{ from: 'Paris', to: 'Nairobi' }, { from: 'Paris', to: 'Tokyo' }],
});
for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`map bar: the example in ${look} at ${format}`, () => assertBar('map', example(), { look, format, prepare: true }));
    test(`map bar: the full fixture in ${look} at ${format}`, () => assertBar('map', full(), { look, format, prepare: true }));
    test(`map bar: a US map in ${look} at ${format}`, () => assertBar('map', { id: 'u', show: 'map', region: 'us', say: 'Texas and Ohio lead.', highlight: ['Texas', 'Ohio'], places: [{ name: 'Austin', at: [-97.74, 30.27] }] }, { look, format, prepare: true }));
  }
}

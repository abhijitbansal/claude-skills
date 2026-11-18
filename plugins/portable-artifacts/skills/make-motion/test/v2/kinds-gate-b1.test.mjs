// The second-wave look review, revision 1 (gate-kinds-b-1): emphasis markers never drawn, map routes that stay on the
// map, and the other rulings of that round, each a failing test first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { expandIn, filmOf, all, overlaps, expandShot, pushLanding, IMAGES, canvasOf } from './helpers/kinds.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { dateValues } from '../../engine/kinds/timeline-dates.mjs';
import { contrastRatio } from '../../engine/review/contrast.mjs';
import { drawnLeaves } from './helpers/bar.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { prepareMap } from '../../scripts/v2/prepare/map.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { sample } from '../../engine/time/track.mjs';
import { sizeAt } from '../../engine/kinds/shared.mjs';

const LOOKS = ['desk', 'pop'];
const FORMATS = ['16:9', '9:16'];
const expandFilm = (film, index) => expandIn(film, index, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });

// ---- emphasis markers (ruling 2) ----

// The author's on-screen words: these fields get a *starred* word; ids, names that other fields refer to, sources and
// code stay as they are (a `*` in code is code).
const STARRED_KEYS = new Set(['text', 'title', 'kicker', 'caption', 'ask', 'label', 'what', 'by', 'items', 'points', 'credit']);
const starFirst = (s) => s.replace(/^(\S*?)([\p{L}\p{N}]+)/u, '$1*$2*');
function starred(value, key) {
  if (key === 'data' || key === 'code' || key === 'id' || key === 'show') return value;
  if (typeof value === 'string') return STARRED_KEYS.has(key) ? starFirst(value) : value;
  if (Array.isArray(value)) return value.map((v) => starred(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, starred(v, k)]));
  return value;
}
const shownTexts = (nodes) => all(nodes).flatMap((n) => [
  ...(n.props.layout?.lines ?? []).flatMap((l) => l.words.map((w) => w.text)),
  ...(typeof n.props.text === 'string' ? [n.props.text] : []),
]);

const KINDS = registries.kinds.names().filter((name) => name !== 'code' && name !== 'free').map((name) => [name, registries.kinds.get(name)]);
for (const [name, kind] of KINDS.filter(([, k]) => k.example)) {
  for (const look of LOOKS) {
    for (const format of FORMATS) {
      test(`emphasis: ${name} in ${look} ${format} with *starred* words draws no star`, () => {
        const picture = kind.example.src === undefined ? {} : { src: 'shot.png' }; // a picture the helper has loaded
        const shot = starred({ ...kind.example, ...picture, ...(kind.example.say ? { say: starFirst(kind.example.say) } : {}) });
        const film = filmOf([{ id: 'lead', show: 'statement', hold: 1, text: 'Hi' }, shot], look, format);
        const out = expandFilm(film, 1);
        const marked = shownTexts(out.nodes).filter((s) => s.includes('*'));
        assert.deepEqual(marked, [], `${name}: a star is drawn`);
      });
    }
  }
}

test('emphasis: the pop hook "to *print*." in a statement text draws PRINT without stars, in the accent', () => {
  const shot = { id: 'hook', show: 'statement', text: 'Your orders | know what | to *print*.', say: 'Your orders know what to *print*.' };
  const out = expandFilm(filmOf([shot], 'pop', '9:16'), 0);
  const texts = shownTexts(out.nodes);
  assert.ok(texts.some((s) => /^print\.?$/i.test(s)), texts.join(' '));
  assert.deepEqual(texts.filter((s) => s.includes('*')), []);
});

// ---- map routes and labels (ruling 1) ----

const DENVER = { name: 'Denver', at: [-104.99, 39.74] };
const OSLO = { name: 'Oslo', at: [10.75, 59.91] };
const KYOTO = { name: 'Kyoto', at: [135.77, 35.01] };
const LIMA = { name: 'Lima', at: [-77.04, -12.05] };
const SYDNEY = { name: 'Sydney', at: [151.21, -33.87] };
const LOS_ANGELES = { name: 'Los Angeles', at: [-118.24, 34.05] };
const REACH = {
  id: 'reach', show: 'map', region: 'world', title: 'Where the prints go', places: [DENVER, OSLO, KYOTO, LIMA],
  routes: [{ from: 'Denver', to: 'Oslo' }, { from: 'Denver', to: 'Kyoto' }, { from: 'Denver', to: 'Lima' }],
  say: 'We print in Denver and ship to Oslo, Kyoto and Lima.',
};
const partsOf = (route) => route.parts ?? [route.points];

// Points along a path of M/L/C commands (each cubic sampled), in the path's own units.
const CURVE_SAMPLES = 12;
function tracePath(d) {
  const pts = pathPoints(d);
  const out = [pts[0]];
  const curves = d.includes('C');
  for (let i = 1; i < pts.length; i += curves ? 3 : 1) {
    if (!curves) { out.push(pts[i]); continue; }
    const [p0, c1, c2, p1] = [out.at(-1), pts[i], pts[i + 1], pts[i + 2]];
    for (let k = 1; k <= CURVE_SAMPLES; k++) {
      const t = k / CURVE_SAMPLES, u = 1 - t;
      out.push([0, 1].map((a) => u * u * u * p0[a] + 3 * u * u * t * c1[a] + 3 * u * t * t * c2[a] + t * t * t * p1[a]));
    }
  }
  return out;
}

for (const [name, places, from, to] of [['Denver to Kyoto', [DENVER, KYOTO], 'Denver', 'Kyoto'], ['Sydney to Los Angeles', [SYDNEY, LOS_ANGELES], 'Sydney', 'Los Angeles']]) {
  test(`map prepare: ${name} crosses the antimeridian the short way, in parts that end on the map's edge`, () => {
    const { data } = prepareMap({ id: 'm', show: 'map', region: 'world', places, routes: [{ from, to }] });
    const [route] = data.routes;
    const parts = partsOf(route);
    assert.equal(parts.length, 2, 'two parts, one each side of the antimeridian');
    const at = Object.fromEntries(data.places.map((p) => [p.name, [p.x, p.y]]));
    assert.deepEqual(parts[0][0], at[from]);
    assert.deepEqual(parts.at(-1).at(-1), at[to]);
    for (const part of parts) {
      for (let k = 1; k < part.length; k++) assert.ok(Math.abs(part[k][0] - part[k - 1][0]) < data.width / 4, `a part jumps across the map at ${k}`);
    }
    // the parts meet the map's edge: one ends on a side, the next starts on the other
    const edgeOf = (x) => (x < data.width / 2 ? 'left' : 'right');
    assert.notEqual(edgeOf(parts[0].at(-1)[0]), edgeOf(parts[1][0][0]));
    assert.equal(edgeOf(parts[0].at(-1)[0]), edgeOf(parts[0][0][0]), 'the route leaves its start towards the near edge');
  });
}

test('map prepare: a route that stays on one side of the antimeridian keeps its single list of points', () => {
  const { data } = prepareMap({ id: 'm', show: 'map', region: 'world', places: [DENVER, OSLO], routes: [{ from: 'Denver', to: 'Oslo' }] });
  assert.equal(data.routes[0].parts, undefined);
  assert.ok(data.routes[0].points.length >= 2);
});

for (const look of LOOKS) {
  test(`map ${look} 16:9: every drawn route stays inside the map and never jumps across it (Denver to Kyoto)`, () => {
    const out = expandFilm(filmOf([REACH], look, '16:9'), 0);
    const [mx, my, mw, mh] = out.boxes.map;
    const lines = all(out.nodes).filter((n) => /\.route\d+(\.part\d+)?\.line$/.test(n.id));
    assert.ok(lines.length >= 4, `the Kyoto route is drawn in parts (${lines.length} lines)`);
    const SLACK = 2;
    for (const line of lines) {
      const pts = tracePath(line.props.d);
      for (const [x, y] of pts) assert.ok(x >= mx - SLACK && x <= mx + mw + SLACK && y >= my - SLACK && y <= my + mh + SLACK, `${line.id} leaves the map at ${x.toFixed(1)},${y.toFixed(1)}`);
      for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(pts[k][0] - pts[k - 1][0]) < mw / 4, `${line.id} jumps across the map`);
    }
    const pins = all(out.nodes).filter((n) => /\.route1\.part\d+\.(pin\d|head)$/.test(n.id));
    const kept = pins.map((n) => n.id.replace(/^reach\.route1\./, ''));
    assert.deepEqual(kept.sort(), look === 'desk' ? ['part0.pin0', 'part1.pin1'] : ['part1.head'], 'no pin or head on a clipped end');
  });

  test(`map ${look} 16:9: the clipped parts of a route draw one after the other, landing on the route's time`, () => {
    const out = expandFilm(filmOf([REACH], look, '16:9'), 0);
    const lines = all(out.nodes).filter((n) => /\.route1\.part\d+\.line$/.test(n.id));
    const landed = (n) => n.tracks.draw.points.at(-1).t;
    const started = (n) => n.tracks.draw.points[0].t;
    assert.ok(landed(lines[0]) <= started(lines[1]) + 1e-6, 'the second part starts after the first lands');
  });
}

test('map desk 16:9: no part of a place label (its leader included) shows before its pin', () => {
  const out = expandFilm(filmOf([REACH], 'desk', '16:9'), 0);
  const nodes = all(out.nodes);
  REACH.places.forEach((_, i) => {
    const pin = nodes.find((n) => n.id === `reach.place${i}.pin`);
    const at = pin.tracks.opacity.points.find((p) => p.v === 1).t;
    const before = Math.max(0, at - 0.05);
    const label = nodes.filter((n) => n.id.startsWith(`reach.place${i}.`) && n.id !== pin.id);
    assert.ok(label.length > 0);
    for (const n of label) {
      const shown = (n.tracks.opacity ? sample(n.tracks.opacity, before, n.step) : 1) * (n.tracks.draw ? sample(n.tracks.draw, before, n.step) : 1);
      assert.equal(shown, 0, `${n.id} shows at ${before.toFixed(2)} before its pin at ${at.toFixed(2)}`);
    }
  });
});

// Places close together with routes passing near them: a label's default side sits on another pin or a route.
const CLOSE = {
  id: 'reach', show: 'map', region: 'world', title: 'Where we ship', places: [{ name: 'Denver', at: [-104.99, 39.74] }, { name: 'Lima', at: [-77.04, -12.05] }, { name: 'Santos', at: [-46.33, -23.96] }, { name: 'Cairo', at: [31.24, 30.04] }],
  routes: [{ from: 'Denver', to: 'Lima' }, { from: 'Denver', to: 'Cairo' }], say: 'From Denver to Lima, Santos and Cairo.',
};
for (const [name, shot] of [['four cities', REACH], ['Lima beside Santos', CLOSE]]) test(`map desk 16:9 (${name}): place labels are set at the reading floor and keep clear of routes and of the other pins`, () => {
  const out = expandFilm(filmOf([shot], 'desk', '16:9'), 0);
  const nodes = all(out.nodes);
  const floor = sizeAt(out.ctx.look, 2, out.ctx.unit);
  const labels = nodes.filter((n) => n.type === 'text' && /^reach\.place\d+\./.test(n.id));
  assert.equal(labels.length, shot.places.length, 'every place keeps its label');
  const routePts = nodes.filter((n) => /\.route\d+(\.part\d+)?\.line$/.test(n.id)).flatMap((n) => tracePath(n.props.d));
  const pins = nodes.filter((n) => /^reach\.place\d+\.pin$/.test(n.id));
  for (const t of labels) {
    assert.ok(t.props.layout.size >= floor - 1e-6, `${t.id} at ${t.props.layout.size} under the floor ${floor}`);
    const box = [t.props.x, t.props.y, t.props.layout.width, t.props.layout.height];
    const hit = routePts.find(([x, y]) => x > box[0] && x < box[0] + box[2] && y > box[1] && y < box[1] + box[3]);
    assert.equal(hit, undefined, `${t.id} sits on a route`);
    const own = t.id.match(/^reach\.place(\d+)\./)[1];
    for (const pin of pins.filter((p) => p.id !== `reach.place${own}.pin`)) {
      const [px, py] = pathPoints(pin.props.d)[0];
      const r = pathPoints(pin.props.d).reduce((m, [x, y]) => Math.max(m, Math.hypot(x - px, y - py)), 0) / 2;
      assert.ok(!overlaps(box, [px - r, py, 2 * r, 2 * r]), `${t.id} covers ${pin.id}`);
    }
  }
});

// ---- race values (ruling 4) ----

const RACE = {
  id: 'lead', show: 'chart', type: 'race', title: 'The North pulls ahead', highlight: 'North', valueLabel: 'orders to date',
  data: { periods: ['Q1', 'Q2', 'Q3', 'Q4'], rows: [
    { name: 'North', values: [1, 14, 66, 182] }, { name: 'South', values: [3, 18, 56, 121] },
    { name: 'East', values: [2, 13, 40, 97] }, { name: 'West', values: [0, 7, 20, 59] }] },
  say: 'In the first quarter the North came third. Quarter by quarter it pulled ahead, to one hundred and eighty two orders.',
};
const FRAME = 1 / 30;
const barWidth = (bar) => Number(/H([\d.]+)/.exec(bar.props.d)[1]);

for (const look of LOOKS) {
  for (const format of FORMATS) {
    test(`race ${look} ${format}: every row keeps a value on screen through each reorder, riding its bar's end`, () => {
      const out = expandFilm(filmOf([RACE], look, format), 0);
      const rows = all(out.nodes).filter((n) => /^lead\.row\.\d+$/.test(n.id));
      assert.equal(rows.length, 4);
      for (let t = 0; t <= out.timing.duration; t += FRAME) {
        for (const row of rows) {
          if (sample(row.tracks.opacity, t) === 0) continue;
          const bar = row.children.find((c) => /\.mark\.\d+$/.test(c.id));
          // ruling f4-1: a count step on the way to a period's value is value.row.period.step
          const values = row.children.filter((c) => /\.value\.\d+\.\d+(\.\d+)?$/.test(c.id) && sample(c.tracks.opacity, t) > 0);
          assert.equal(values.length, 1, `${row.id} shows ${values.length} values at ${t.toFixed(2)} s`);
          const end = bar.props.x + barWidth(bar) * sample(bar.tracks.scaleX, t);
          const x = values[0].tracks.x ? sample(values[0].tracks.x, t) : values[0].props.x;
          assert.ok(x >= end - 1e-6 && x - end < 40 * out.ctx.unit, `${values[0].id} at ${x.toFixed(1)} is off its bar's end ${end.toFixed(1)} at ${t.toFixed(2)} s`);
        }
      }
    });

    test(`race ${look} ${format}: valueLabel says what the values count, drawn and mapped to its field`, () => {
      const out = expandFilm(filmOf([RACE], look, format), 0);
      const counts = all(out.nodes).find((n) => n.id === 'lead.counts');
      assert.ok(counts, 'a counts label');
      assert.equal(counts.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ').toLowerCase(), 'orders to date');
      assert.equal(registries.kinds.get('chart').nodeField(RACE, 'lead.counts'), 'valueLabel');
    });
  }
}

// ---- timeline spacing (ruling 5) ----

const centreOf = (d) => {
  const pts = pathPoints(d), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
const TIMELINE = (events, extra = {}) => ({ id: 'year', show: 'timeline', events, say: events.map((e) => `${e.when}, ${e.what}.`).join(' '), ...extra });
const MONTHS = [{ when: 'Mar', what: 'First sale' }, { when: 'Apr', what: 'Online' }, { when: 'Dec', what: 'Dashboard' }];
const gapsOf = (centres, axis) => centres.slice(1).map((c, k) => c[axis] - centres[k][axis]);

test('timeline dates: month names, years and year-months read as dates; anything else, mixed or out of order does not', () => {
  assert.deepEqual(dateValues([{ when: 'Mar' }, { when: 'Jun' }, { when: 'Dec' }]), [2, 5, 11]);
  assert.deepEqual(dateValues([{ when: '1969' }, { when: '1989' }]), [1969 * 12, 1989 * 12]);
  assert.deepEqual(dateValues([{ when: 'Mar 2024' }, { when: '2025-01' }]), [2024 * 12 + 2, 2025 * 12]);
  assert.equal(dateValues([{ when: 'Launch' }, { when: 'Mar' }]), null);
  assert.equal(dateValues([{ when: 'Mar' }, { when: '2024' }]), null, 'a month with no year beside a year');
  assert.equal(dateValues([{ when: 'Jun' }, { when: 'Mar' }]), null, 'out of order: a sequence, not a scale');
});

test('timeline pop 9:16: dated events sit on the rail by date (Mar, Apr, Dec), the rail on the left, clear of the app buttons', () => {
  const out = expandFilm(filmOf([TIMELINE(MONTHS)], 'pop', '9:16'), 0);
  const dots = [0, 1, 2].map((k) => centreOf(all(out.nodes).find((n) => n.id === `year.rail.dot${k}`).props.d));
  const [a, b] = gapsOf(dots, 1);
  assert.ok(b / a > 3, `gaps ${a.toFixed(0)} then ${b.toFixed(0)}: one month then eight`);
  for (const [x] of dots) assert.ok(x < 0.5 * out.canvas.w, `rail at x ${x.toFixed(0)} of ${out.canvas.w}`);
});

for (const format of FORMATS) {
  test(`timeline desk ${format}: dated events are spaced by date with room for their words; undated ones stay even`, () => {
    const out = expandFilm(filmOf([TIMELINE(MONTHS)], 'desk', format), 0);
    const axis = format === '16:9' ? 0 : 1;
    const ticks = [0, 1, 2].map((k) => centreOf(all(out.nodes).find((n) => n.id === `year.tick${k}`).props.d));
    const [a, b] = gapsOf(ticks, axis);
    assert.ok(b / a > 1.5, `gaps ${a.toFixed(0)} then ${b.toFixed(0)}`);
    const boxes = [0, 1, 2].map((k) => out.boxes[`event:${k}`]);
    for (let k = 1; k < 3; k++) assert.ok(!overlaps(boxes[k - 1], boxes[k]), `events ${k - 1} and ${k} meet`);
    const plain = expandFilm(filmOf([TIMELINE([{ when: 'Start', what: 'One' }, { when: 'Middle', what: 'Two' }, { when: 'End', what: 'Three' }])], 'desk', format), 0);
    const even = gapsOf([0, 1, 2].map((k) => centreOf(all(plain.nodes).find((n) => n.id === `year.tick${k}`).props.d)), axis);
    assert.ok(Math.abs(even[0] - even[1]) < 0.05, `undated gaps ${even.join(', ')}`); // paths round to 0.01
  });
}

// ---- one margin, one type system, readable dimmed dots (ruling 6) ----

const SCATTER = {
  id: 'price', show: 'chart', type: 'scatter', title: 'Dawn breaks the rule', xLabel: 'Price, $', yLabel: 'Orders', highlight: 'Dawn',
  data: [{ x: 5, y: 85, label: 'Card' }, { x: 12, y: 70 }, { x: 18, y: 60 }, { x: 25, y: 46 }, { x: 30, y: 42 }, { x: 40, y: 28 }, { x: 48, y: 20 }, { x: 60, y: 90, label: 'Dawn' }, { x: 75, y: 12 }, { x: 90, y: 6, label: 'Mural' }],
  say: 'Cheaper prints sell more. Dawn costs sixty dollars and sells the most.',
};
const mixHex = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(a * parseInt(fg.slice(i, i + 2), 16) + (1 - a) * parseInt(bg.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('')}`;

for (const look of LOOKS) {
  test(`scatter ${look} 9:16: a dimmed dot keeps 3:1 against the ground`, () => {
    const out = expandFilm(filmOf([SCATTER], look, '9:16'), 0);
    const { paper } = out.ctx.look.palette;
    const dot = all(out.nodes).find((n) => n.id === 'price.mark.1');
    const group = all(out.nodes).find((n) => n.id === 'price.point.1');
    const end = out.timing.duration;
    const alpha = sample(dot.tracks.opacity, end) * (group.tracks.opacity ? sample(group.tracks.opacity, end) : 1);
    const ratio = contrastRatio(mixHex(dot.props.fill, paper, alpha), paper);
    assert.ok(ratio >= 3, `${dot.props.fill} at ${alpha} on ${paper}: ${ratio.toFixed(2)}:1`);
  });
}

test('scatter pop: the highlighted label is set in the same face and case as the other point labels', () => {
  const out = expandFilm(filmOf([SCATTER], 'pop', '9:16'), 0);
  const texts = all(out.nodes).filter((n) => n.type === 'text' && /^price\.label\.\d+/.test(n.id));
  assert.ok(texts.length >= 2);
  const faces = new Set(texts.map((n) => `${n.props.font.family}/${n.props.font.width}/${n.props.font.weight}`));
  assert.equal(faces.size, 1, [...faces].join(' | '));
  const words = texts.flatMap((n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)));
  assert.deepEqual(words.filter((w) => w !== w.toUpperCase()), []);
});

test('pop: the race and scatter labels are in the condensed face of the film, not the wide tag face', () => {
  const look = registries.looks.get('pop');
  for (const shot of [SCATTER, RACE]) {
    const out = expandFilm(filmOf([shot], 'pop', '9:16'), 0);
    const labels = all(out.nodes).filter((n) => n.type === 'text' && /\.(label|name|value)\.\d+/.test(n.id));
    assert.ok(labels.length > 0);
    for (const n of labels) assert.notEqual(n.props.font.width, look.fonts.label.width, `${n.id} in the wide face`);
  }
});

const DESK_KINDS_B = ['media', 'map', 'timeline', 'feed'];
test('desk 16:9: the second-wave kinds keep the one left margin of the statement and the chart (column 2)', () => {
  const left = (out) => Math.min(...drawnLeaves(sampleGraph(out.nodes, out.timing.duration - 0.01)).filter((l) => l.node.type === 'text').map((l) => l.box[0]));
  const film = (shot) => filmOf([{ id: 'lead', show: 'statement', hold: 1, text: 'Hi' }, shot], 'desk', '16:9');
  const statement = expandFilm(filmOf([{ id: 's', show: 'statement', text: 'One year of orders told us what to print.', hold: 3 }], 'desk', '16:9'), 0);
  const margin = left(statement);
  for (const name of DESK_KINDS_B) {
    const kind = registries.kinds.get(name);
    const out = expandFilm(film({ ...kind.example, ...(kind.example.src ? { src: 'shot.png' } : {}) }), 1);
    const x = left(out);
    assert.ok(x >= margin - 1 && x - margin < 64 * out.ctx.unit, `${name} text starts at ${x.toFixed(0)}, the margin is ${margin.toFixed(0)}`);
  }
});

test('desk: no second-wave kind sets the author\'s words in the grotesk text face (timeline, chat, map labels, scatter label)', () => {
  const look = registries.looks.get('desk');
  const grotesk = look.fonts.text.family;
  const shots = [TIMELINE(MONTHS), REACH, SCATTER, { id: 'chat', show: 'feed', title: 'Studio', items: [{ from: 'them', text: 'North orders tripled.' }, { from: 'me', text: 'Then we print more of Dawn.' }], say: 'North orders tripled. Then we print more of Dawn.' }];
  for (const format of FORMATS) {
    for (const shot of shots) {
      const out = expandFilm(filmOf([shot], 'desk', format), 0);
      const used = all(out.nodes).filter((n) => n.type === 'text' && n.props.font?.family === grotesk).map((n) => n.id);
      assert.deepEqual(used, [], `${shot.id} ${format}`);
    }
  }
});

// ---- the reading floor on the phone tile (ruling 7) ----

const CODE = { id: 'count', show: 'code', lang: 'js', title: 'Count by region', code: 'const n = {}\nfor (const r of rows) {\n  if (!r.paid) continue\n  n[r.region] ??= 0\n  n[r.region] += 1\n}', highlight: [5], say: 'A short script counts the paid orders by region. One line does the counting.' };
const floorOf = (out) => sizeAt(out.ctx.look, 2, out.ctx.unit) - 1e-6;

for (const look of LOOKS) {
  for (const format of FORMATS) {
    test(`reading floor ${look} ${format}: code and timeline captions are at or above the look's second step`, () => {
      const code = expandFilm(filmOf([CODE], look, format), 0);
      const lines = all(code.nodes).filter((n) => n.type === 'text' && /\.l\d+\.c\d+$/.test(n.id));
      assert.ok(lines.length > 0, 'code lines');
      for (const n of lines) assert.ok(n.props.layout.size >= floorOf(code), `${n.id} at ${n.props.layout.size}`);
      const year = expandFilm(filmOf([TIMELINE(MONTHS)], look, format), 0);
      const whats = all(year.nodes).filter((n) => n.type === 'text' && /\.what\d+$/.test(n.id));
      assert.ok(whats.length > 0);
      for (const n of whats) assert.ok(n.props.layout.size >= floorOf(year), `${n.id} at ${n.props.layout.size}`);
    });
  }
}

test('reading floor: six long captions on desk 16:9 are not shrunk under the floor to fit their columns', () => {
  const six = ['Jan', 'Mar', 'May', 'Jul', 'Sep', 'Nov'].map((when) => ({ when, what: 'The shop sold its first framed print abroad' }));
  const out = expandFilm(filmOf([TIMELINE(six)], 'desk', '16:9'), 0);
  for (const n of all(out.nodes).filter((m) => m.type === 'text' && /\.what\d+$/.test(m.id))) assert.ok(n.props.layout.size >= floorOf(out), `${n.id} at ${n.props.layout.size}`);
});

test('reading floor: a code line too long for the floor is cut at the panel edge, and rows past the room are left out', () => {
  const long = { id: 'count', show: 'code', lang: 'js', title: 'rows.js', hold: 3, code: Array.from({ length: 16 }, (_, i) => `const row${i} = load(${i}); // row ${i}`).join('\n') };
  const out = expandFilm(filmOf([long], 'pop', '9:16'), 0);
  const runs = all(out.nodes).filter((n) => n.type === 'text' && /\.l\d+\.c\d+$/.test(n.id));
  const panel = all(out.nodes).find((n) => n.id === 'count.panel.body' || n.id === 'count.panel.card');
  assert.ok(runs.length > 0 && panel, 'runs and a panel');
  const right = Math.max(...runs.map((n) => n.props.x + n.props.layout.width));
  const pathXs = pathPoints(panel.props.d).map((p) => p[0] + (panel.props.x ?? 0));
  assert.ok(right <= Math.max(...pathXs) + 1, `text reaches ${right.toFixed(0)}, the panel ends at ${Math.max(...pathXs).toFixed(0)}`);
  const lines = new Set(runs.map((n) => n.id.match(/\.l(\d+)\./)[1]));
  assert.ok(lines.size < 16, `${lines.size} of 16 rows drawn in a room that holds fewer`);
});

test('reading floor: the films\' charts (desk 16:9, pop 9:16) set axis numbers and labels at or above the second step', () => {
  for (const [look, format] of [['desk', '16:9'], ['pop', '9:16']]) {
    for (const shot of [SCATTER, RACE]) {
      const out = expandFilm(filmOf([shot], look, format), 0);
      const labels = all(out.nodes).filter((n) => n.type === 'text' && !/\.(title|tag|numeral|period)/.test(n.id) && n.props.role !== 'hero');
      assert.ok(labels.length > 0);
      for (const n of labels) assert.ok(n.props.layout.size >= floorOf(out), `${look} ${shot.id} ${n.id} at ${n.props.layout.size}`);
    }
  }
});

test('reading floor: code that cannot fit at the floor is not shrunk under it; the review says what to cut', () => {
  const long = { id: 'count', show: 'code', lang: 'js', code: 'x'.repeat(70), say: CODE.say };
  const out = expandFilm(filmOf([long], 'pop', '9:16'), 0);
  const line = all(out.nodes).find((n) => n.type === 'text' && /\.l\d+\.c\d+$/.test(n.id));
  assert.ok(line.props.layout.size >= floorOf(out));
  const found = registries.kinds.get('code').review(long, { look: out.ctx.look, timing: out.timing, canvas: out.canvas, viralInsets: out.ctx.viralInsets, at: () => 0 });
  assert.ok(found.length > 0, 'a finding names the cut');
});

// ---- first beats (ruling 8) ----

for (const format of FORMATS) {
  test(`first beat desk ${format}: the timeline opens on its whole ruled line and every tick, not one month alone`, () => {
    const out = expandFilm(filmOf([TIMELINE(MONTHS)], 'desk', format), 0);
    const nodes = all(out.nodes);
    const line = nodes.find((n) => n.id === 'year.line');
    assert.equal(line.tracks.draw ? sample(line.tracks.draw, 0, line.step) : 1, 1, 'the line is whole on frame 0');
    const shown = (n) => {
      const parents = nodes.filter((p) => p.children.includes(n));
      const own = n.tracks.opacity ? sample(n.tracks.opacity, 0) : 1;
      return own * parents.reduce((a, p) => a * (p.tracks.opacity ? sample(p.tracks.opacity, 0) : 1), 1);
    };
    for (let k = 0; k < MONTHS.length; k++) assert.equal(shown(nodes.find((n) => n.id === `year.tick${k}`)), 1, `tick ${k} on frame 0`);
  });
}

// The 0.8 s first beat of this gate was overruled by the transitions revision, round 2 (lead ruling 4: narration timing
// wins over "no empty first beat" for later items): the first item is up from frame 0, the reply arrives when spoken.
test('first beat: a feed shows its first item from frame 0 and the reply when its sentence is spoken', () => {
  const chat = { id: 'chat', show: 'feed', title: 'Studio', items: [{ from: 'them', text: 'North tripled this quarter.' }, { from: 'me', text: 'Then we print more of Dawn.' }, { from: 'them', text: 'Paper comes Friday.' }],
    say: 'North tripled this quarter, and that is a lot of prints. Then we print more of Dawn. Paper comes Friday.' };
  for (const look of LOOKS) {
    const out = expandFilm(filmOf([chat], look, '16:9'), 0);
    const [first, second] = registries.kinds.get('feed').arrivals(chat, out.timing);
    assert.equal(first, 0, `${look}: the first item on frame 0`);
    assert.ok(Math.abs(second - out.timing.sentences[1].start) < 1e-9, `${look}: the second item at ${second.toFixed(2)} s, its sentence at ${out.timing.sentences[1].start.toFixed(2)} s`);
  }
});

// ---- screen zoom (ruling 3) ----

const SCREEN = (extra = {}) => ({ id: 's', show: 'screen', src: 'shot.png', regions: { chart: [0.55, 0.4, 0.3, 0.3] }, zoom: 'chart', say: 'This page shows every order. One region stands out.', ...extra });
const screenReview = (shot, look, format) => {
  const out = expandShot(shot, look, format);
  return registries.kinds.get('screen').review(shot, { look: registries.looks.get(look), timing: out.timing, at: (ref) => resolveAnchor(ref, out.timing), canvas: canvasOf(format), asset: (src) => IMAGES.get(src), viralInsets: out.ctx.viralInsets });
};

test('screen desk 16:9: the push stops at the picture\'s own resolution (one picture pixel to one frame pixel at most)', () => {
  const out = expandShot(SCREEN(), 'desk', '16:9');
  const native = IMAGES.get('shot.png').width / out.boxes.image[2];
  const landed = pushLanding(out.camera);
  assert.ok(landed === undefined || landed.zoom <= native + 1e-9, `zoom ${landed?.zoom} past the native ${native.toFixed(3)}`);
});

test('screen desk 16:9: a push the picture cannot carry is a creative finding at zoom that names the picture width it needs', () => {
  const found = screenReview(SCREEN(), 'desk', '16:9').filter((f) => f.path === 'zoom');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, /1600 px wide/);
  assert.match(found[0].message, /at least \d+ px wide/);
});

test('screen desk 16:9: a picture large enough for the push gives no zoom finding', () => {
  const found = screenReview(SCREEN({ regions: { chart: [0.1, 0.1, 0.85, 0.8] } }), 'desk', '16:9').filter((f) => f.path === 'zoom');
  assert.deepEqual(found, []);
});

test('screen pop 9:16: the enlarged panel is never drawn larger than its crop of the picture', () => {
  const out = expandShot(SCREEN(), 'pop', '9:16');
  const panel = all(out.nodes).find((n) => n.id === 's.panel.cutout.image');
  assert.ok(panel, 'a second panel');
  assert.ok(panel.props.w <= panel.props.clip[2] + 1e-9, `panel ${panel.props.w.toFixed(1)} wide from a ${panel.props.clip[2].toFixed(1)} px crop`);
});

test('screen desk 16:9: at rest after the push, everything outside the region is masked by the paper (no part-cut UI at the frame edge)', () => {
  const out = expandShot(SCREEN(), 'desk', '16:9');
  const scrim = all(out.nodes).find((n) => n.id === 's.focus');
  assert.ok(scrim, 'a scrim over the rest');
  assert.equal(sample(scrim.tracks.opacity, out.timing.duration), 1);
});

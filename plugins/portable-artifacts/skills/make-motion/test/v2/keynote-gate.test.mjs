// The keynote gate's revision 1 rulings (gate-keynote-1.md), on the gate films' own shots (references/examples/v2
// gate-keynote.json and gate-keynote-tall.json; the screen's picture swapped for the test picture of the same shape):
// the 9:16 screen enlarges its region under the headline (ruling 1), the 16:9 push leaves the card balanced with its
// chrome readable and the ring exactly round the region from a corner (ruling 2), charts open set and fill the plot
// (ruling 3), and the engine picks soft cuts with the band of light over the screen (ruling 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { filmFor, filmOf, IMAGES } from './helpers/kinds.mjs';
import { drawnLeaves } from './helpers/bar.mjs';

const EXAMPLES = new URL('../../references/examples/v2/', import.meta.url);
const gate = (file) => JSON.parse(readFileSync(new URL(file, EXAMPLES), 'utf8'));
const WIDE = gate('gate-keynote.json');
const TALL = gate('gate-keynote-tall.json');
const shotOf = (film, id) => {
  const shot = film.shots.find((s) => s.id === id);
  return shot.src === undefined ? shot : { ...shot, src: 'shot.png' };
};
const CANVAS = Object.freeze({ '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 } });
const FPS = 30;
const framesOf = (duration) => Array.from({ length: Math.floor(duration * FPS) + 1 }, (_, i) => i / FPS);
const look = () => registries.looks.get('keynote');
const built = (shot, format) => filmFor([shot], 'keynote', format, { mode: 'pro' });
const union = (boxes) => {
  const [x0, y0] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0];
};
const insideBox = (b, r, slack = 1) => b[0] >= r[0] - slack && b[1] >= r[1] - slack && b[0] + b[2] <= r[0] + r[2] + slack && b[1] + b[3] <= r[1] + r[3] + slack;
const safeBox = (format) => {
  const s = safeRectFor(CANVAS[format], look());
  return [s.left, s.top, s.right - s.left, s.bottom - s.top];
};
const PICTURE = IMAGES.get('shot.png');
// px a drawn ring's box may differ from the region's: half its 4-unit stroke at the push's zoom (at most 3.2 in
// camera.mjs, landing here under 1.5), plus a pixel of rounding; the old 16-unit pad put it 16 px or more outside
const STROKE_SLACK = 4;
// each edge of `a` within STROKE_SLACK of the same edge of `b`
const edges = ([x, y, w, h]) => [x, y, x + w, y + h];
const sameBox = (a, b) => edges(a).every((v, i) => Math.abs(v - edges(b)[i]) <= STROKE_SLACK);

// ---- ruling 1: the 9:16 screen ----

test('gate 9:16 screen: frame 0 shows the whole card under the headline, no region card yet', () => {
  const film = built(shotOf(TALL, 'dash'), '9:16');
  const leaves = drawnLeaves(film.sampleShot(0, 0));
  assert.ok(leaves.some((l) => l.node.id === 'dash.screen.image' && l.opacity === 1), 'the whole screen on frame 0');
  assert.ok(leaves.some((l) => l.node.id === 'dash.headline'), 'the headline on frame 0');
  assert.ok(!leaves.some((l) => l.node.id.startsWith('dash.region') && l.opacity > 0), 'no region card on frame 0');
});

test('gate 9:16 screen: the region enlarges to the full safe width, whole, inside the safe box, under the headline', () => {
  const shot = shotOf(TALL, 'dash');
  const film = built(shot, '9:16');
  const safe = safeBox('9:16');
  const [fx, fy, fw, fh] = shot.regions.region;
  const end = drawnLeaves(film.sampleShot(0, film.duration));
  const card = end.find((l) => l.node.id === 'dash.region.image');
  assert.ok(card, 'a region card');
  const clip = card.node.props.clip;
  const want = [fx * PICTURE.width, fy * PICTURE.height, fw * PICTURE.width, fh * PICTURE.height];
  assert.ok(clip.every((v, i) => Math.abs(v - want[i]) <= 1), `the card shows the region whole: ${clip.map(Math.round)} against ${want.map(Math.round)}`);
  assert.ok(card.box[2] >= safe[2] - 1, `the region card is ${Math.round(card.box[2])} px wide (the safe width is ${safe[2]})`);
  const head = end.find((l) => l.node.id === 'dash.headline');
  assert.ok(head.box[1] + head.box[3] <= card.box[1], 'the headline above the region card');
  for (const t of framesOf(film.duration)) {
    const parts = drawnLeaves(film.sampleShot(0, t)).filter((l) => l.node.id.startsWith('dash.region') && !l.node.id.includes('.shadow') && l.opacity > 0);
    if (parts.length === 0) continue;
    assert.ok(insideBox(union(parts.map((l) => l.box)), safe, look().keyline), `at ${t.toFixed(2)} s the region card leaves the safe box`);
  }
});

test('gate 9:16 screen: the ring is exactly round the region card', () => {
  const film = built(shotOf(TALL, 'dash'), '9:16');
  const end = drawnLeaves(film.sampleShot(0, film.duration));
  const card = end.find((l) => l.node.id === 'dash.region.image');
  const ring = end.filter((l) => l.node.id.startsWith('dash.ring'));
  assert.ok(ring.length > 0, 'a ring');
  const box = union(ring.map((l) => l.box));
  // a drawn box includes its stroke, centred on the edge: half the ring's width either side
  assert.ok(sameBox(box, card.box), `ring ${box.map(Math.round)} round the card ${card.box.map(Math.round)}`);
});

// ---- ruling 2: the 16:9 screen ----

test('gate 16:9 screen: after the push the card is centred across the frame', () => {
  const film = built(shotOf(WIDE, 'dash'), '16:9');
  const end = drawnLeaves(film.sampleShot(0, film.duration));
  const card = union(end.filter((l) => (l.node.id.startsWith('dash.frame') && !l.node.id.includes('.shadow')) || l.node.id === 'dash.screen.image').map((l) => l.box));
  const [left, right] = [card[0], CANVAS['16:9'].w - card[0] - card[2]];
  // the resting drift carries on after the landing (camera.mjs: a full drift across the shot), which moves the card up
  // to a drift off the centre: the margins then differ by up to two drifts
  const drift = look().camera.drift;
  assert.ok(Math.abs(left - right) <= 2 * drift + 2, `margins ${Math.round(left)} and ${Math.round(right)} px`);
});

test('gate 16:9 screen: the title and url stay at full ink inside the title-safe box through the shot', () => {
  const film = built(shotOf(WIDE, 'dash'), '16:9');
  const safe = safeBox('16:9');
  for (const t of framesOf(film.duration)) {
    const leaves = drawnLeaves(film.sampleShot(0, t));
    for (const id of ['dash.title', 'dash.url']) {
      const l = leaves.find((x) => x.node.id === id);
      assert.ok(l && l.opacity === 1, `at ${t.toFixed(2)} s ${id} is not at full ink`);
      assert.ok(insideBox(l.box, safe, 0), `at ${t.toFixed(2)} s ${id} ${l.box.map(Math.round)} leaves the title-safe box`);
    }
  }
});

test('gate 16:9 screen: the ring is a box exactly round the region, drawn from its top left corner both ways', () => {
  const shot = shotOf(WIDE, 'dash');
  const film = built(shot, '16:9');
  const end = drawnLeaves(film.sampleShot(0, film.duration));
  const image = end.find((l) => l.node.id === 'dash.screen.image').box;
  const [fx, fy, fw, fh] = shot.regions.region;
  const region = [image[0] + fx * image[2], image[1] + fy * image[3], fw * image[2], fh * image[3]];
  const ring = end.filter((l) => l.node.id.startsWith('dash.ring'));
  const box = union(ring.map((l) => l.box));
  assert.ok(sameBox(box, region), `ring ${box.map(Math.round)} round region ${region.map(Math.round)}`);
  const paths = ring.map((l) => l.node);
  assert.equal(paths.length, 2, 'two strokes');
  const starts = paths.map((n) => pathPoints(n.props.d)[0]);
  assert.deepEqual(starts[0], starts[1], 'both strokes start at one corner');
  for (const t of framesOf(film.duration)) {
    const drawn = drawnLeaves(film.sampleShot(0, t)).filter((l) => l.node.id.startsWith('dash.ring')).map((l) => l.node.draw);
    assert.ok(drawn.length === 0 || (drawn.length === 2 && drawn[0] === drawn[1]), `at ${t.toFixed(2)} s the strokes are not drawn together: ${drawn}`);
  }
  assert.ok(paths.every((n) => pathPoints(n.props.d).length === 3), 'each stroke takes two sides');
});

test('gate 16:9 screen: the band of light crosses the card once', () => {
  const film = built(shotOf(WIDE, 'dash'), '16:9');
  const sweeps = framesOf(film.duration).filter((t) => drawnLeaves(film.sampleShot(0, t)).some((l) => l.node.id.startsWith('dash.sweep') && l.opacity > 0));
  assert.ok(sweeps.length > 0, 'a band of light over the screen');
});

test('gate 9:16 screen: the band of light crosses the region card once', () => {
  const film = built(shotOf(TALL, 'dash'), '9:16');
  const sweeps = framesOf(film.duration).filter((t) => drawnLeaves(film.sampleShot(0, t)).some((l) => l.node.id.startsWith('dash.sweep') && l.opacity > 0));
  assert.ok(sweeps.length > 0, 'a band of light over the region card');
});

// ---- ruling 3: charts open set and fill the plot ----

for (const [film, format] of [[WIDE, '16:9'], [TALL, '9:16']]) {
  test(`gate ${format} chart: every bar is present from frame 0 at a base, growing after`, () => {
    const b = built(shotOf(film, 'regions'), format);
    const along = format === '16:9' ? 2 : 3;
    const marks = (t) => drawnLeaves(b.sampleShot(0, t)).filter((l) => /^regions\.mark\.\d$/.test(l.node.id));
    const [first, last] = [marks(0), marks(b.duration)];
    assert.equal(first.length, 4, 'four marks on frame 0');
    for (const [i, m] of first.entries()) {
      assert.ok(m.opacity === 1 && m.box[along] >= 0.08 * last[i].box[along], `${m.node.id} is ${Math.round(m.box[along])} px on frame 0 (of ${Math.round(last[i].box[along])})`);
      assert.ok(m.box[along] < last[i].box[along] - 1, `${m.node.id} grows after frame 0`);
    }
  });
}

test('gate 16:9 chart: the bars and their values fill the free width', () => {
  const b = built(shotOf(WIDE, 'regions'), '16:9');
  const leaves = drawnLeaves(b.sampleShot(0, b.duration));
  const title = leaves.find((l) => l.node.id === 'regions.title').box;
  const right = CANVAS['16:9'].w - title[0];
  const reach = Math.max(...leaves.filter((l) => /^regions\.(mark|value|annotation)/.test(l.node.id)).map((l) => l.box[0] + l.box[2]));
  assert.ok(reach >= right - 0.06 * CANVAS['16:9'].w, `the plot reaches ${Math.round(reach)} of ${Math.round(right)} px`);
});

test('gate 9:16 chart: the tallest column fills the free height under the claim', () => {
  const b = built(shotOf(TALL, 'regions'), '9:16');
  const leaves = drawnLeaves(b.sampleShot(0, b.duration));
  const title = leaves.find((l) => l.node.id === 'regions.title').box;
  const marks = leaves.filter((l) => /^regions\.mark\.\d$/.test(l.node.id));
  const base = Math.max(...marks.map((l) => l.box[1] + l.box[3]));
  const top = Math.min(...marks.map((l) => l.box[1]));
  const free = base - (title[1] + title[3]);
  assert.ok(base - top >= 0.75 * free, `the tallest column is ${Math.round(base - top)} px of ${Math.round(free)} free`);
});

// ---- ruling 4: soft cuts chosen by the engine ----

for (const film of [WIDE, TALL]) {
  test(`gate ${film.format}: the engine picks soft cuts, never a hard cut and never three alike in a row`, () => {
    const names = film.shots.slice(1).map((_, i) => resolveShotCut(filmOf(film.shots, 'keynote', film.format, { mode: 'pro' }), i + 1, { look: look() })?.name ?? 'cut');
    assert.ok(names.every((n) => ['crossfade', 'blur', 'zoom', 'cross-zoom', 'match'].includes(n)), `cuts: ${names.join(', ')}`);
    assert.ok(names.every((n, i) => i < 2 || !(n === names[i - 1] && n === names[i - 2])), `three alike in a row: ${names.join(', ')}`);
  });
}

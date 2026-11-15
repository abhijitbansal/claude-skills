// The clipping kind, look gate fix pass: the desk region focus as a paper scrim over the whole picture card (F1), the
// desk caption card moving under the pushed region (F2), the picture's entrance as one clean layer (F3), and a stack
// look's establishing picture kept inside the safe area through its spring (F5). Pure scene-graph work with the fake
// text measure (helpers/kinds.mjs); positions are read off the sampled film, through the camera (helpers/boxes.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../../engine/time/track.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { EPS, canvasOf, filmOf, expandIn, expandShot, filmFor, all, near, FILLER } from './helpers/kinds.mjs';
import { apply, invert as invertOf, pathBox, worldOf, subtreeBox } from './helpers/boxes.mjs';

const bottom = (b) => b[1] + b[3];

const DESK_CLIP = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', kicker: 'The proof', caption: 'Every chart shows its query',
  regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
const pushKeys = (camera) => camera.find((layer) => layer.some((k) => k.zoom !== undefined && k.zoom > 1));

// ---- F1: the paper scrim ----

// The coordinate pairs of a path string, as points.
const pointsOf = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
};

test('F1 desk region highlight: a paper scrim lies exactly on the whole picture card outside the region, its mount and tape included; the region stays clean', () => {
  for (const format of ['16:9', '9:16']) {
    const { camera } = expandShot(DESK_CLIP, 'desk', format);
    const at = pushKeys(camera).at(-1).t;
    const tree = filmFor([DESK_CLIP], 'desk', format).sampleAt(at);
    const scrim = worldOf(tree, 'c.on0.scrim');
    assert.ok(scrim, `${format}: a scrim`);
    const subpaths = scrim.node.props.d.split(/(?=M)/);
    const hole = subpaths.at(-1);
    // every subpath but the hole on screen, to compare with the parts it lies on
    const outlines = subpaths.slice(0, -1).map((d) => pointsOf(d).map((p) => apply(scrim.m, p)));
    for (const id of ['c.image.card.paper', 'c.image.card.tape1', 'c.image.card.tape2']) {
      const part = worldOf(tree, id);
      assert.ok(part, `${format}: ${id}`);
      const want = pointsOf(part.node.props.d).map((p) => apply(part.m, p));
      const match = outlines.find((o) => o.length === want.length && o.every((p, i) => Math.hypot(p[0] - want[i][0], p[1] - want[i][1]) < 0.05));
      assert.ok(match, `${format}: the scrim lies on ${id}, point for point`);
    }
    assert.equal(outlines.length, 3, `${format}: the paper and two tape strips, nothing else (the keyline lies inside the paper; the shadow stays on the desk)`);
    // the hole is the region in the drawn picture's own space, exactly
    const image = all(tree).find((n) => n.type === 'image');
    const { w: W, h: H } = image.props;
    const region = [0.6 * W - W / 2, 0.2 * H - H / 2, 0.3 * W, 0.2 * H];
    pathBox(hole).forEach((v, i) => assert.ok(Math.abs(v - region[i]) < 0.02, `${format}: the clean hole ${i}: ${v} vs ${region[i]}`));
    // what the nonzero fill paints: nothing inside the region, everything on the mount and the tape
    const local = subpaths.map(pointsOf);
    assert.equal(winding(local, [region[0] + region[2] / 2, region[1] + region[3] / 2]), 0, `${format}: the region stays clean`);
    assert.notEqual(winding(local, [W / 2 + 24, 0]), 0, `${format}: the mount right of the picture is scrimmed`);
    const tape = worldOf(tree, 'c.image.card.tape1');
    const tapeCentre = apply(invertOf(scrim.m), apply(tape.m, [0, 0]));
    assert.notEqual(winding(local, tapeCentre), 0, `${format}: the tape is scrimmed`);
  }
});

// The nonzero winding number of closed polygons about point p (canvas y runs down).
function winding(polygons, [px, py]) {
  let wn = 0;
  for (const poly of polygons) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const side = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
      if (a[1] <= py && b[1] > py && side > 0) wn += 1;
      else if (a[1] > py && b[1] <= py && side < 0) wn -= 1;
    });
  }
  return wn;
}

// ---- F2: the caption card follows the push ----

// The region's box on screen at time t: its rest box carried by the picture group's sampled move (zoom and pan), and
// the zoom.
function regionOnScreen(f, rest, t) {
  const restGroup = rest.nodes.find((n) => n.id === 'c.image');
  const pic = f.sampleAt(t).find((n) => n.id === 'c.image');
  const zoom = pic.scale / (restGroup.props.scale ?? 1);
  const [bx, by, bw, bh] = rest.boxes['region:query'];
  return { box: [pic.x + (bx - restGroup.props.x) * zoom, pic.y + (by - restGroup.props.y) * zoom, bw * zoom, bh * zoom], zoom };
}
// The marker frame's lowest ink on screen: the bottom of its strokes, both passes.
function frameBottom(tree) {
  const ids = all(tree).filter((n) => /^c\.on0\.side\d(\.pass2)?$/.test(n.id)).map((n) => n.id);
  return Math.max(...ids.map((id) => bottom(subtreeBox(tree, id))));
}

test('F2 desk caption card: after the push it sits one gutter under the marker frame, its left edge on the region\'s left edge, pinned, inside the margins', () => {
  for (const format of ['16:9', '9:16']) {
    const rest = expandShot(DESK_CLIP, 'desk', format);
    const { ctx, canvas, timing } = rest;
    const look = ctx.look, unit = ctx.unit, gutter = look.grid.gutter * unit, margin = look.grid.margin * unit;
    const keys = pushKeys(rest.camera);
    const f = filmFor([DESK_CLIP], 'desk', format);
    for (const t of [keys.at(-1).t, timing.duration]) {
      const tree = f.sampleAt(t);
      const card = subtreeBox(tree, 'c.caption.card.paper');
      const { box: region, zoom } = regionOnScreen(f, rest, t);
      assert.ok(Math.abs(card[0] - region[0]) <= 2 * unit, `${format} at ${t}: left edge ${card[0]} on the region's left edge ${region[0]}`);
      const gap = card[1] - frameBottom(tree);
      // the frame's lowest ink lies within its hand wobble (1.5 units, zoomed) of where the layout allows for it
      assert.ok(gap >= gutter - 0.5 && gap <= gutter + 2 * 1.5 * unit * zoom + 2 * unit, `${format} at ${t}: one gutter under the frame's lowest ink: ${gap}`);
      assert.ok(card[0] >= margin - 2 * unit && card[0] + card[2] <= canvas.w - margin + 2 * unit && card[1] >= margin - 2 * unit && bottom(card) <= canvas.h - margin + 2 * unit, `${format} at ${t}: inside the margins: ${card}`);
    }
    const group = all(rest.nodes).find((n) => n.id === 'c.caption.card');
    assert.equal(group.props.fixed, true, 'pinned to the frame: the camera does not move it');
  }
});

test('F2 desk caption card: where it rests until the push starts, then it moves with the push on the push\'s own curve', () => {
  const rest = expandShot(DESK_CLIP, 'desk', '16:9');
  const { ctx, canvas } = rest;
  const keys = pushKeys(rest.camera);
  const [p0, p1] = [keys[0].t, keys.at(-1).t];
  const group = all(rest.nodes).find((n) => n.id === 'c.caption.card');
  const at = (name, t) => (group.tracks[name] ? sample(group.tracks[name], t) : group.props[name]);
  // before the push: bottom left on column 2, on the bottom margin (the establishing place)
  const f = filmFor([DESK_CLIP], 'desk', '16:9');
  const before = subtreeBox(f.sampleAt(p0 - 0.05), 'c.caption.card.paper');
  assert.ok(Math.abs(before[0] - gridX(ctx.look, canvas, 2)) < 2, 'left edge on column 2');
  assert.ok(Math.abs(bottom(before) - (canvas.h - ctx.look.grid.margin)) < 2, 'bottom on the bottom margin');
  near(at('x', p0), at('x', 0), 'x still at rest when the push starts');
  near(at('y', p0), at('y', ctx.look.moves.enter.dur), 'y at rest (after its entrance) when the push starts');
  for (const u of [0.25, 0.5, 0.75]) {
    const t = p0 + u * (p1 - p0), want = ease(keys.at(-1).ease)(u);
    for (const name of ['x', 'y']) {
      const share = (at(name, t) - at(name, p0)) / (at(name, p1) - at(name, p0));
      assert.ok(Math.abs(share - want) < 1e-6, `${name} at ${u} of the push: ${share} vs the push curve ${want}`);
    }
  }
});

test('F2 desk caption card: a push on a region without a highlight puts it under the region as well; with no region event it stays where it rests', () => {
  const circled = { ...DESK_CLIP, on: [{ at: 'word:query', do: 'circle', target: 'region:query' }] };
  const rest = expandShot(circled, 'desk', '16:9');
  const keys = pushKeys(rest.camera);
  const f = filmFor([circled], 'desk', '16:9');
  const t = keys.at(-1).t;
  const card = subtreeBox(f.sampleAt(t), 'c.caption.card.paper');
  const { box: region } = regionOnScreen(f, rest, t);
  assert.ok(Math.abs(card[0] - region[0]) <= 2, `left edge on the region: ${card[0]} vs ${region[0]}`);
  assert.ok(card[1] > bottom(region), 'under the region');
  const quiet = { ...DESK_CLIP, on: undefined, hold: 4 };
  const still = all(expandShot(quiet, 'desk', '16:9').nodes).find((n) => n.id === 'c.caption.card');
  assert.equal(still.tracks.x, undefined, 'no x move');
  near(sample(still.tracks.y, 4), sample(still.tracks.y, 0.5), 'no y move after its entrance');
});

test('F2 where the caption card goes after a push: under the frame when it fits, above the region when it does not, always inside the margins', async () => {
  const { captionAfterPush } = await import('../../engine/kinds/clipping-captions.mjs');
  assert.equal(typeof captionAfterPush, 'function', 'clipping-captions.mjs exports captionAfterPush');
  const area = { left: 96, top: 96, right: 1824, bottom: 984 };
  const size = { w: 400, h: 120 };
  const gutter = 24;
  // the region and the frame's ink on screen, [x, y, w, h]
  const under = captionAfterPush({ region: [500, 300, 600, 300], frame: [480, 280, 640, 340], size, gutter, area });
  assert.deepEqual(under, [500, 280 + 340 + 24, 400, 120], 'under the frame, left edge on the region');
  const above = captionAfterPush({ region: [500, 600, 600, 300], frame: [480, 580, 640, 340], size, gutter, area });
  assert.deepEqual(above, [500, 580 - 24 - 120, 400, 120], 'above the region when under runs past the bottom margin');
  const wide = captionAfterPush({ region: [1600, 300, 200, 300], frame: [1580, 280, 240, 340], size, gutter, area });
  assert.equal(wide[0] + wide[2], 1824, 'moved left to stay inside the right margin');
  const neither = captionAfterPush({ region: [200, 100, 1400, 860], frame: [180, 80, 1440, 900], size, gutter, area });
  assert.ok(neither[1] >= 96 && neither[1] + 120 <= 984, 'inside the margins when neither fits');
});

// ---- F3: the picture's entrance ----

test('F3 the picture enters as one layer: a clean opacity fade with the enter move, at least half visible on the first frame after a hard cut', () => {
  for (const look of ['desk', 'pop']) {
    const format = look === 'pop' ? '9:16' : '16:9';
    const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, cut: 'cut' };
    const { nodes, ctx } = expandIn(filmOf([FILLER, shot], look, format), 1);
    const pic = nodes.find((n) => n.id === 'c.image');
    assert.equal(pic.props.layer, true, `${look}: composited as one picture, so its parts never show through one another`);
    const move = ctx.look.moves.enter;
    assert.ok(sample(pic.tracks.opacity, 0) >= 0.5, `${look}: at least half visible on the first frame: ${sample(pic.tracks.opacity, 0)}`);
    near(sample(pic.tracks.opacity, move.dur), 1, `${look}: opaque when the enter move ends`);
    // on the enter move's curve where it does not overshoot (desk); a spring (pop) would carry the opacity past 1 and back
    const springs = Array.from({ length: 101 }, (_, i) => ease(move.ease)(i / 100)).some((v) => v > 1 + EPS);
    const first = sample(pic.tracks.opacity, 0);
    if (!springs) near(sample(pic.tracks.opacity, move.dur / 2), first + (1 - first) * ease(move.ease)(0.5), `${look}: on the enter move's curve`);
    const values = Array.from({ length: 61 }, (_, i) => sample(pic.tracks.opacity, (i / 30) * move.dur));
    assert.ok(values.every((v, i) => v <= 1 + EPS && (i === 0 || v >= values[i - 1] - EPS)), `${look}: a plain fade, never past 1 and never stepping back: ${values.map((v) => v.toFixed(3))}`);
    // a slide shows the outgoing shot on its first frame: there the picture is still one layer
    const slid = expandIn(filmOf([FILLER, { ...shot, cut: 'slide' }], look, format), 1).nodes.find((n) => n.id === 'c.image');
    assert.equal(slid.props.layer, true);
  }
  const desk = expandIn(filmOf([FILLER, { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, cut: 'cut' }], 'desk', '16:9'), 1);
  assert.ok(desk.nodes.find((n) => n.id === 'c.image').tracks.y, 'desk still rises in with its enter move');
});

// ---- F5: a stack look's establishing picture ----

// Moments sampled through the entrance (and as long again after it), finely enough to catch the spring's overshoot.
const ENTRANCE_SAMPLES = 400;
const ROUNDING = 0.02; // px
const entranceTimes = (dur) => Array.from({ length: ENTRANCE_SAMPLES + 1 }, (_, i) => (i / ENTRANCE_SAMPLES) * dur * 2);

test('F5 pop establishing picture: the cut-out, its keyline and shadow stay inside the safe area through the spring\'s overshoot, on every format', () => {
  const shots = [
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3 },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'See it.', kicker: 'The proof' },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, crop: [0.57, 0.1, 0.405, 0.885] },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, crop: [0.57, 0.1, 0.405, 0.885], caption: 'It works.' },
  ];
  for (const format of ['9:16', '16:9', '1:1', '4:5']) {
    for (const shot of shots) {
      const film = filmFor([shot], 'pop', format);
      const safe = safeRectFor(canvasOf(format), film.look);
      for (const t of entranceTimes(film.look.moves.enter.dur)) {
        const box = subtreeBox(film.sampleAt(t), 'c.image.cutout');
        const tag = `${format} ${JSON.stringify(Object.keys(shot))} at ${t.toFixed(4)}`;
        // ROUNDING: path strings round their coordinates to 0.01, so a keyline fitted exactly may reach that far past
        assert.ok(box[0] >= safe.left - ROUNDING && box[1] >= safe.top - ROUNDING && box[0] + box[2] <= safe.right + ROUNDING && bottom(box) <= safe.bottom + ROUNDING, `${tag}: ${box} inside ${JSON.stringify(safe)}`);
      }
    }
  }
});

test('F5 pop establishing picture: as large as the safe area allows at the spring\'s peak (no needless shrink)', () => {
  const film = filmFor([{ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }], 'pop', '9:16');
  const safe = safeRectFor(canvasOf('9:16'), film.look);
  const boxes = entranceTimes(film.look.moves.enter.dur).map((t) => subtreeBox(film.sampleAt(t), 'c.image.cutout'));
  const lowest = Math.max(...boxes.map(bottom)), rightmost = Math.max(...boxes.map((b) => b[0] + b[2]));
  // the picture reaches within 2 px of the safe edge it fits against: the bottom for a tall window, else the right
  assert.ok(safe.bottom - lowest < 2 || safe.right - rightmost < 2, `the reach ${lowest}, ${rightmost} against the safe bottom ${safe.bottom} and right ${safe.right}`);
});

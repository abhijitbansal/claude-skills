// The clipping kind: pictures on a card, regions, the desk push and marker frame, pop close-ups, the establishing
// view. Pure scene-graph work with a fake text measure (helpers/kinds.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { markerAccent } from '../../engine/kinds/shared.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { landing } from '../../engine/devices/shared.mjs';
import { establishingFindings } from '../../engine/kinds/clipping-rules.mjs';
import { withLookEmphasis } from '../../engine/kinds/emphasis-fallback.mjs';
import { resolveAnchor } from '../../engine/script/anchors.mjs';
import { validateFilm, SpecError } from '../../scripts/v2/spec.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import {
  FPS, EPS, canvasOf, viralOf, filmOf, expandIn, expandShot, FILLER, filmFor, all, textNode, lastKey, near,
  inside, landsOn, POP_SHOT, opacityAt, CLIP, pushLanding, slugOf, plateBox, shownAt,
} from './helpers/kinds.mjs';

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-kinds-'));
  writeFileSync(path.join(specDir, 'shot.png'), 'x');
});
after(() => rmSync(specDir, { recursive: true, force: true }));
test('a missing clipping image is an error with its path, exit 2', () => {
  const file = path.join(specDir, 'film.json');
  writeFileSync(file, JSON.stringify({ version: 2, shots: [{ id: 'c', show: 'clipping', src: 'nope.png', hold: 2 }] }));
  assert.throws(() => loadFilm(file), (err) => {
    assert.ok(err instanceof SpecError);
    assert.equal(err.errors[0].path, 'shots[0].src');
    assert.match(err.errors[0].message, /file not found: "nope\.png"/);
    return true;
  });
});

test('desk clipping: cutout on a card 48 units larger, rotated -2 degrees, 70% of a wide frame\'s width (at most the height between the margins), rising in', () => {
  const { nodes, ctx, canvas, hero } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'The query' });
  const look = ctx.look;
  const pic = nodes.find((n) => n.id === hero);
  assert.equal(hero, 'c.image');
  assert.equal(pic.props.rotate, -2);
  assert.equal(pic.props.x, 0.54 * canvas.w);
  assert.equal(pic.props.y, 0.52 * canvas.h);
  near(sample(pic.tracks.y, 0), 0.52 * canvas.h + 80, 'starts 80 below');
  near(lastKey(pic.tracks.y).t, look.moves.enter.dur);
  const image = all([pic]).find((n) => n.type === 'image');
  near(image.props.w, Math.min(0.7 * 1920, (1080 - 2 * 96) * 1600 / 1000), 'size: 70% of the width (look revision 1)');
  const paper = all([pic]).find((n) => n.id === 'c.image.card.paper');
  assert.ok(paper, 'a card');
  const card = pic.children.find((n) => n.id === 'c.image.card');
  assert.ok(pic.children.indexOf(card) < pic.children.findIndex((n) => n.id === 'c.image.cutout'), 'card under the cutout');
  assert.ok(textNode(nodes, 'c.caption'));
});

test('pop clipping: cutout only, upright, centred on the safe zone at no more than 92% of its width, popping in', () => {
  const { nodes, canvas, hero, ctx } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right;
  const pic = nodes.find((n) => n.id === hero);
  assert.equal(pic.props.rotate ?? 0, 0);
  near(pic.props.x, safe.left + safeW / 2);
  // on the band's optical centre (45%), or its middle when the picture's reach meets the edge (look revisions 1, 2)
  const h = canvas.h - safe.top - safe.bottom;
  assert.ok(pic.props.y >= safe.top + 0.45 * h - 1e-6 && pic.props.y <= safe.top + h / 2 + 1e-6, `y ${pic.props.y}`);
  // the fix pass (F5): smaller than 92% where its keyline and shadow at the spring's peak would leave the safe zone
  // (kinds-clipping-focus.test.mjs checks the reach)
  assert.ok(all([pic]).find((n) => n.type === 'image').props.w <= 0.92 * safeW + EPS, 'width');
  assert.ok(!all([pic]).some((n) => n.id.includes('card')));
  near(sample(pic.tracks.scale, 0), 0.9, 'grows from 0.9, whole from frame 0 (look revision 2)');
});

test('pop establishing picture on a vertical format: a 4:5 crop of the source, as tall as the image allows, centred on the first targeted region', () => {
  const imageOf = (shot, format = '9:16') => {
    const r = expandShot(shot, 'pop', format);
    return { image: all([r.nodes.find((n) => n.id === 'c.image')]).find((n) => n.type === 'image'), canvas: r.canvas };
  };
  // hand-computed: 1600 x 1000 at 4:5 is 800 x 1000; the query region's centre is at 0.75 x 1600 = 1200, so the
  // window would start at 800, which is also the furthest right it can go (1600 - 800)
  const targeted = imageOf({ ...POP_SHOT, on: [{ at: 'word:query', do: 'underline', target: 'region:query' }] });
  assert.deepEqual(targeted.image.props.clip, [800, 0, 800, 1000]);
  const safe = viralOf(targeted.canvas), safeW = targeted.canvas.w - safe.left - safe.right;
  assert.ok(targeted.image.props.w <= 0.92 * safeW + EPS, 'a cutout at most 92% of the safe width');
  near(targeted.image.props.w / targeted.image.props.h, 4 / 5, '4:5');
  const centred = imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { mid: [0.3, 0.3, 0.2, 0.2] } });
  assert.deepEqual(centred.image.props.clip, [400, 0, 800, 1000], 'no region target: the crop is centred');
  const left = imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { l: [0.05, 0.3, 0.2, 0.2] }, on: [{ at: 1, do: 'underline', target: 'region:l' }] });
  assert.deepEqual(left.image.props.clip, [0, 0, 800, 1000], 'clamped inside the image');
  assert.equal(imageOf({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, '16:9').image.props.clip, undefined, 'a wide format shows the whole picture');
});

test('desk clipping on vertical formats is 92% of the width inside the margins', () => {
  for (const format of ['9:16', '4:5', '1:1']) {
    const { nodes, ctx, canvas, hero } = expandShot({ id: 'c', show: 'clipping', src: 'shot.png', hold: 3 }, 'desk', format);
    const available = gridX(ctx.look, canvas, 13) - gridX(ctx.look, canvas, 1);
    near(all([nodes.find((n) => n.id === hero)]).find((n) => n.type === 'image').props.w, 0.92 * available, format);
  }
});

test('a region box is the region inside the drawn picture, through its rotation', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { query: [0.25, 0.5, 0.5, 0.25] } };
  const pop = expandShot(shot, 'pop');
  // 1600x1000 -> 669.6 x 418.5 centred at (960, 540): left 625.2, top 330.75
  const W = 0.62 * 1080, H = W * 1000 / 1600;
  const left = 960 - W / 2, top = 540 - H / 2;
  pop.boxes['region:query'].forEach((v, i) => near(v, [left + 0.25 * W, top + 0.5 * H, 0.5 * W, 0.25 * H][i], `pop ${i}`));
  // desk: the corners turned by the group's -2 degrees and the cutout's own seeded tilt about (0.54 w, 0.52 h), the
  // picture 70% of the width (1344 x 840; look revision 1)
  const desk = expandShot(shot, 'desk');
  const [DW, DH] = [0.7 * 1920, 0.7 * 1920 * 1000 / 1600];
  const pic = desk.nodes.find((n) => n.id === 'c.image');
  const tilt = pic.children.find((n) => n.id === 'c.image.cutout').props.rotate ?? 0;
  const a = ((-2 + tilt) * Math.PI) / 180, cx = 0.54 * 1920, cy = 0.52 * 1080;
  const corners = [[0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]].map(([fx, fy]) => {
    const lx = fx * DW - DW / 2, ly = fy * DH - DH / 2;
    return [cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a)];
  });
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const want = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  desk.boxes['region:query'].forEach((v, i) => near(v, want[i], `desk ${i}`));
});

test('a mark on a region goes over the picture, and the desk camera pushes until the region fills 72% of the width and no more than 70% of the height without a caption (zoom 1.2 to 3.2)', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'circle', target: 'region:query' }] };
  for (const format of ['16:9', '9:16']) {
    const { nodes, camera, timing, ctx, boxes, canvas } = expandShot(shot, 'desk', format);
    const ids = nodes.map((n) => n.id);
    assert.ok(ids.indexOf('c.on0') > ids.indexOf('c.image'), 'mark drawn over the picture');
    const push = camera.find((layer) => layer.some((k) => k.zoom !== undefined));
    const at = Math.max(timing.words[4].start, 0.6 + 0.9); // the first shot shows the whole picture for 0.6 s before a push of 0.9 s
    const rect = ctx.look.grid ? { w: canvas.w, h: canvas.h } : null; // desk composes on the whole canvas
    const want = Math.min(3.2, Math.max(1.2, Math.min((0.72 * rect.w) / boxes['region:query'][2], (0.7 * rect.h) / boxes['region:query'][3])));
    near(push.at(-1).t, at, `${format} lands on the event`);
    near(push.at(-1).zoom, want, `${format} zoom`);
    assert.equal(push.at(-1).ease, ctx.look.moves.enter.ease);
    near(push[0].t, at - 0.9, 'over 0.9 s');
  }
  const still = expandShot({ ...shot, on: [{ at: 'word:query', do: 'circle', target: 'image' }] });
  assert.ok(!still.camera.some((layer) => layer.some((k) => k.zoom !== undefined)), 'no region target, no push');
});

test('a pushed region sits on the composition centre, as far as the field allows', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { mid: [0.4, 0.4, 0.2, 0.2] }, on: [{ at: 2, do: 'underline', target: 'region:mid' }] };
  const { boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const f = filmFor([shot], 'desk', '16:9');
  const pic = f.sampleAt(2).find((n) => n.id === 'c.image'); // the landing time; the drift moves on after it
  const rest = expandShot(shot, 'desk', '16:9').nodes.find((n) => n.id === 'c.image');
  const [bx, by, bw, bh] = boxes['region:mid'];
  // the region centre moves with the picture group: rest offset scaled by the camera zoom
  const zoom = pic.scale / (rest.props.scale ?? 1);
  const rx = pic.x + (bx + bw / 2 - rest.props.x) * zoom, ry = pic.y + (by + bh / 2 - rest.props.y) * zoom;
  // the drift's pan at the landing time is allowed for, so the region sits on the centre to well under a pixel
  assert.ok(Math.abs(rx - canvas.w / 2) < 0.5 && Math.abs(ry - canvas.h / 2) < 0.5, `region at ${rx}, ${ry}`);
});

test('a highlight on a region is a hand-drawn marker frame with the rest of the picture under a paper scrim in desk', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', regions: { query: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
  const { nodes, timing, ctx } = expandShot(shot, 'desk');
  const at = Math.max(timing.words[4].start, 0.6 + 0.9);
  const pic = nodes.find((n) => n.id === 'c.image');
  assert.ok(!all(nodes).some((n) => n.props.under), 'no filled band');
  const sides = all([pic]).filter((n) => /^c\.on0\.side\d$/.test(n.id));
  const passes = all([pic]).filter((n) => /^c\.on0\.side\d\.pass2$/.test(n.id));
  assert.equal(sides.length, 4, 'four strokes inside the picture');
  assert.equal(passes.length, 4, 'each drawn twice: a second pass of the same stroke');
  for (const s of [...sides, ...passes]) {
    assert.equal(s.props.stroke, markerAccent(ctx.look), 'the highlighter\'s yellow as it shows on paper (look revision 1, one yellow)');
    assert.equal(s.props.strokeWidth, 7, '7 units wide');
    assert.equal(s.props.lineCap, 'round');
    assert.equal(s.props.blend, undefined);
  }
  sides.forEach((s, i) => {
    const second = passes[i];
    assert.notEqual(second.props.d, s.props.d, 'the second pass is offset');
    const shift = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const [a, b] = [shift(s.props.d), shift(second.props.d)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    a.forEach((v, k) => near(b[k] - v, k % 2 === 0 ? dx : dy, `side ${i}: the same geometry, moved`));
    assert.ok(Math.hypot(dx, dy) > 0 && Math.hypot(dx, dy) <= 3, `a small offset: ${Math.hypot(dx, dy)}`);
  });
  const lands = sides.map((s) => lastKey(s.tracks.draw).t);
  assert.deepEqual([...lands].sort((a, b) => a - b), lands, 'drawn on in order');
  landsOn(sides[3], 'draw', at, 'the frame closes on the event');
  // geometry in the picture's own space: the region [0.6, 0.2, 0.3, 0.2] of the drawn picture (70% of 1920 wide: look
  // revision 1)
  const W = 0.7 * 1920, H = W * 1000 / 1600;
  const region = [0.6 * W - W / 2, 0.2 * H - H / 2, 0.3 * W, 0.2 * H];
  const pts = (s) => s.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const ys = [...sides, ...passes].flatMap((s) => pts(s).filter((_, i) => i % 2 === 1));
  const xs = [...sides, ...passes].flatMap((s) => pts(s).filter((_, i) => i % 2 === 0));
  const half = 3.5;
  // the bottom stroke is the lowest ink: the side strokes do not overshoot downward into the picture below the region,
  // so the frame reaches the gap plus its own width, plus at most 2 units of hand wobble
  assert.ok(Math.max(...ys) + half <= region[1] + region[3] + 6 + 7 + 2 + EPS, `the frame reaches ${(Math.max(...ys) + half - region[1] - region[3]).toFixed(1)} below the region: at most the gap, one width and the wobble`);
  // the frame overshoots each corner by at most 10 units past the gap and stroke
  assert.ok(Math.min(...xs) >= region[0] - 6 - half - 10 - EPS && Math.max(...xs) <= region[0] + region[2] + 6 + half + 10 + EPS, 'overshoot at most 10 units');
  // it hugs the region: the top stroke's points sit 6 units plus half the stroke above it, within the hand wobble
  const top = pts(sides[0]).filter((_, i) => i % 2 === 1);
  const mean = top.reduce((a, b) => a + b, 0) / top.length;
  assert.ok(Math.abs(mean - (region[1] - 6 - half)) <= 1.5 + EPS, `top stroke centre ${mean} at the 6-unit gap (${region[1] - 6 - half})`);
  // the fix pass (F1): the surroundings recede into the paper, a scrim of the look's paper, not a multiply of ink
  assert.ok(!all([pic]).some((n) => n.id === 'c.on0.dim'), 'no ink dim');
  const scrim = all([pic]).find((n) => n.id === 'c.on0.scrim');
  assert.equal(scrim.props.fill, ctx.look.palette.paper);
  assert.equal(scrim.props.blend, undefined, 'plain paper over the picture, not a blend');
  assert.equal(scrim.props.d.match(/M/g).length, 4, 'the card paper, its two tape strips, and the region cut out of them');
  near(sample(scrim.tracks.opacity, 0), 0);
  // 0.8: the brief's 0.72 tuned on the rendered proof (the range it allows is 0.6 to 0.8): at 0.72 a sliced "59" at the
  // frame edge still read as a number
  assert.ok(sample(scrim.tracks.opacity, at - 0.25) > 0 && sample(scrim.tracks.opacity, at - 0.25) < 0.8, 'easing in with the frame');
  near(sample(scrim.tracks.opacity, at), 0.8, 'paper at 0.8 with the frame');
});

test('pop: the whole picture until the first region event, then a hard switch to the region as its own cut-out', () => {
  const { nodes, timing, canvas, ctx } = expandShot(POP_SHOT, 'pop', '9:16');
  const at = timing.words[4].start; // "query"
  const pic = nodes.find((n) => n.id === 'c.image');
  const close = nodes.find((n) => n.id === 'c.close0');
  near(opacityAt(pic, at - 1 / FPS), 1, 'the whole picture just before');
  near(opacityAt(close, at - 1 / FPS), 0, 'no close-up just before');
  near(opacityAt(pic, at), 0, 'the whole picture gone on the event frame');
  near(opacityAt(close, at), 1, 'the close-up on the event frame');
  const image = all([close]).find((n) => n.type === 'image');
  assert.deepEqual(image.props.clip, [0.6 * 1600, 0.2 * 1000, 0.3 * 1600, 0.2 * 1000], 'the region in image pixels');
  assert.equal(image.props.src, 'shot.png');
  assert.ok(all([close]).some((n) => n.id.endsWith('.keyline')) && all([close]).some((n) => n.id.endsWith('.shadow')), 'a cutout: keyline and shadow');
  const safe = viralOf(canvas);
  const safeW = canvas.w - safe.left - safe.right, safeH = canvas.h - safe.top - safe.bottom;
  const fitsWidth = Math.abs(image.props.w - 0.92 * safeW) < 1e-6, fitsHeight = Math.abs(image.props.h - 0.7 * safeH) < 1e-6;
  assert.ok(fitsWidth || fitsHeight, `92% of the safe width or 70% of its height: ${image.props.w} x ${image.props.h}`);
  assert.ok(image.props.w <= 0.92 * safeW + EPS && image.props.h <= 0.7 * safeH + EPS);
  near(image.props.w / image.props.h, (0.3 * 1600) / (0.2 * 1000), 'the region keeps its shape');
  const cutoutGroup = close.children.find((n) => n.id === 'c.close0.cutout');
  near(cutoutGroup.props.x, safe.left + safeW / 2);
  assert.ok(cutoutGroup.props.y >= safe.top + 0.45 * safeH - 1e-6 && cutoutGroup.props.y <= safe.top + safeH / 2 + 1e-6, 'on the optical centre, or the middle');
  const punch = ctx.look.devices.punch.scale;
  const switchKeys = (expandShot(POP_SHOT, 'pop', '9:16').camera).flat().filter((k) => k.zoom === punch);
  assert.ok(switchKeys.some((k) => Math.abs(k.t - at) < 1e-6), 'the switch lands with a punch');
});

test('pop: a second, different region event switches to that close-up; devices sit against the close-up and draw on after the cut', () => {
  const { nodes, timing, boxes } = expandShot(POP_SHOT, 'pop', '9:16');
  const first = timing.words[4].start, second = timing.words[8].start; // "query", "chart"
  const [a, b] = ['c.close0', 'c.close1'].map((id) => nodes.find((n) => n.id === id));
  near(opacityAt(a, second - 1 / FPS), 1); near(opacityAt(b, second - 1 / FPS), 0);
  near(opacityAt(a, second + 1e-6), 0); near(opacityAt(b, second + 1e-6), 1); // anchors round to 1e-6 s
  const underline = all([a]).find((n) => n.id === 'c.on0');
  assert.ok(underline, 'the underline belongs to its close-up');
  const [, by, , bh] = boxes['region:query'];
  const ys = underline.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) > by + bh, 'under the close-up');
  near(lastKey(underline.tracks.draw).t, first + registries.looks.get('pop').moves.draw.dur, 'starts drawing on the cut');
  assert.ok(!all([b]).some((n) => /^c\.on1\.side/.test(n.id)), 'a highlight on a pop close-up draws no frame');
  assert.ok(!all([b]).some((n) => n.id === 'c.on1.dim'), 'no overlay on a close-up');
  assert.ok(boxes['region:chart'][3] > 0);
});

test('pop region highlight: the close-up\'s hard accent shadow grows from 10 to 18 units on the event, with the emphasize ease; nothing else is drawn', () => {
  const { nodes, timing, ctx } = expandShot(POP_SHOT, 'pop', '9:16');
  const look = ctx.look;
  const at = timing.words[8].start; // chart: the highlight
  const close = nodes.find((n) => n.id === 'c.close1');
  const shadows = all([close]).filter((n) => /\.shadow(\.emphasis)?$/.test(n.id));
  const base = shadows.find((n) => n.id.endsWith('.shadow')), lifted = shadows.find((n) => n.id.endsWith('.shadow.emphasis'));
  assert.equal(base.props.fill, look.palette.accent, 'one hue: the shadow is the accent before the event too (look revision 1)');
  assert.equal(lifted.props.fill, look.palette.accent);
  near(opacityAt(base, at - 1 / FPS), 1); near(opacityAt(lifted, at - 1 / FPS), 0);
  const on = at + 1e-6; // anchors round to 1e-6 s
  near(opacityAt(base, on), 0, 'a step change on the event'); near(opacityAt(lifted, on), 1);
  near(sample(lifted.tracks.x, on), 10, 'from 10'); near(sample(lifted.tracks.y, on), 10);
  near(sample(lifted.tracks.x, at + look.moves.emphasize.dur), 18, 'grown to 18 one emphasize move later');
  near(sample(lifted.tracks.y, at + 5), 18);
  const halfway = sample(lifted.tracks.x, at + look.moves.emphasize.dur / 2);
  assert.ok(Math.abs(halfway - (10 + 8 * ease(look.moves.emphasize.ease)(0.5))) < 1e-3, `with the emphasize ease: ${halfway}`);
  assert.equal(all(nodes).filter((n) => n.id.startsWith('c.on1')).length, 0, 'no device nodes for the highlight');
  // the underline on the first close-up stays as it is
  assert.ok(all([nodes.find((n) => n.id === 'c.close0')]).some((n) => n.id === 'c.on0'));
});

test('pop clippings never push the camera, and the pop field ignores the camera', () => {
  const { camera, nodes } = expandShot(POP_SHOT, 'pop', '9:16');
  const punch = registries.looks.get('pop').devices.punch.scale;
  assert.ok(camera.flat().every((k) => k.zoom === undefined || k.zoom === 1 || k.zoom === punch), 'only punch zooms');
  assert.equal(nodes[0].props.fixed, true, 'pop field fixed');
  assert.equal(expandShot(POP_SHOT, 'desk').nodes[0].props.fixed, undefined, 'desk field moves with the camera');
  const out = registries.cuts.get('punch').apply({ from: [], to: [nodes[0]].map((n) => sampleGraph([n], 0)[0]), p: 0.5, canvas: canvasOf('9:16') });
  assert.equal(out[0].scale, 1, 'a punch cut leaves a fixed field alone');
});

// looks-four Task 4b (controller ruling): an emphasis device a look does not draw is no longer refused; the event takes
// the look's own emphasis instead (kinds/emphasis-fallback.mjs), while a clipping still draws its own region highlight
test('the validator lets a clipping take a highlight on a region in pop; a highlight pop does not draw falls back to its emphasis', () => {
  const film = (shots) => ({ version: 2, mode: 'viral', shots });
  const pop = (shots) => validateFilm(film(shots), { specDir });
  const clip = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { q: [0.1, 0.1, 0.2, 0.2] } };
  const onRegion = [{ ...clip, on: [{ at: 1, do: 'highlight', target: 'region:q' }] }];
  assert.deepEqual(pop(onRegion).errors, []);
  assert.deepEqual(withLookEmphasis(film(onRegion)).moved, [], 'the clipping draws its region highlight itself');
  const onImage = [{ ...clip, on: [{ at: 1, do: 'highlight', target: 'image' }] }];
  assert.deepEqual(pop(onImage).errors, []);
  assert.deepEqual(withLookEmphasis(film(onImage)).moved.map((m) => m.starred), [false]);
  const onText = [{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 0, do: 'highlight', target: 'text' }] }];
  assert.deepEqual(pop(onText).errors, []);
  assert.deepEqual(withLookEmphasis(film(onText)).moved.map((m) => m.device), ['highlight']);
});

test('the push never shows the edge of the field', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, regions: { corner: [0.9, 0.9, 0.1, 0.1] }, on: [{ at: 1, do: 'circle', target: 'region:corner' }] };
  for (const [look, format] of [['desk', '16:9'], ['desk', '9:16'], ['pop', '9:16']]) {
    const f = filmFor([shot], look, format);
    const canvas = canvasOf(format);
    for (const t of [0.5, 1, 2, 3]) {
      const field = f.sampleAt(t)[0];
      const left = field.x, top = field.y, w = field.props.w * field.scale, h = field.props.h * field.scale;
      assert.ok(left <= 0 && top <= 0 && left + w >= canvas.w && top + h >= canvas.h, `${look} ${format} t=${t}`);
    }
  }
});

test('the validator checks clipping regions, close-up timing, image targets after a switch and reserved hero ids', () => {
  const check = (shot, mode = 'pro') => validateFilm({ version: 2, mode, shots: [shot] }, { specDir }).errors;
  const clip = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3 };
  const zero = check({ ...clip, regions: { q: [0.1, 0.1, 0, 0.2] } });
  assert.equal(zero[0].path, 'shots[0].regions.q');
  assert.match(zero[0].message, /w and h must be above 0/);
  const past = check({ ...clip, regions: { q: [0.8, 0.1, 0.3, 0.2] } });
  assert.equal(past[0].path, 'shots[0].regions.q');
  assert.match(past[0].message, /x \+ w/);
  const regions = { a: [0.1, 0.1, 0.2, 0.2], b: [0.5, 0.5, 0.2, 0.2] };
  const together = check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 1, do: 'underline', target: 'region:b' }] }, 'viral');
  assert.equal(together[0].path, 'shots[0].on[1].at');
  assert.match(together[0].message, /same time/);
  const image = check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 2, do: 'arrow', target: 'image' }] }, 'viral');
  assert.equal(image[0].path, 'shots[0].on[1].target');
  assert.match(image[0].message, /target the region/);
  assert.deepEqual(check({ ...clip, regions, on: [{ at: 1, do: 'underline', target: 'region:a' }, { at: 1, do: 'circle', target: 'region:b' }] }).filter((e) => /same time/.test(e.message)), [], 'desk pushes, so no rule');
  const hero = check({ id: 'a', show: 'statement', say: 'Hi.', hero: 'field' });
  assert.equal(hero[0].path, 'shots[0].hero');
  assert.match(hero[0].message, /reserved/);
});

test('pop close-ups: a punch on a region keeps its keys, an early event shortens the entrance, and with no highlight the caption is there with the picture and stays', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'The query', regions: { q: [0.6, 0.2, 0.3, 0.2] },
    on: [{ at: 0.1, do: 'underline', target: 'region:q' }, { at: 1.5, do: 'punch', target: 'region:q' }] };
  const { nodes, camera, ctx } = expandShot(shot, 'pop', '9:16');
  const punch = ctx.look.devices.punch.scale;
  assert.ok(camera.flat().some((k) => k.zoom === punch && Math.abs(k.t - 1.5) < 1e-6), 'the punch at 1.5 s keeps its keys');
  const pic = nodes.find((n) => n.id === 'c.image');
  const lastIn = 0.6 - 1 / FPS; // the event at 0.1 s is moved to 0.6 s, after the establishing view
  near(sample(pic.tracks.opacity, lastIn), 1, 'the entrance ends one frame before the switch');
  assert.ok(sample(pic.tracks.opacity, lastIn / 2) > 0, 'and is not collapsed to nothing');
  near(sample(pic.tracks.opacity, 0.6), 0, 'gone on the switch');
  const caption = textNode(nodes, 'c.caption');
  for (const t of [0, 0.6, 0.7, 1, 1.5, 2]) near(sample(caption.tracks.opacity, t), 1, `the caption at ${t}`);
});

test('desk: the push starts no earlier than the incoming cut ends plus 0.6 s, so the whole picture is seen first', () => {
  const early = expandIn(filmOf([FILLER, CLIP({ cut: 'slide' })]), 1);
  const landing = pushLanding(early.camera);
  const layer = early.camera.find((l) => l.some((k) => k.zoom > 1));
  near(landing.t, 0.4 + 0.6 + 0.9, 'a slide ends at 0.4 s: the push lands 0.6 s plus its own 0.9 s after that');
  assert.ok(layer[0].t >= 0.4 + 0.6 - EPS, `the push starts at ${layer[0].t}`);
  const first = expandIn(filmOf([CLIP()]), 0);
  near(pushLanding(first.camera).t, 0.6 + 0.9, 'the first shot has no cut: 0.6 s of the picture, then the push');
  const late = expandIn(filmOf([FILLER, CLIP({ cut: 'slide', on: [{ at: 2.5, do: 'circle', target: 'region:r' }] })]), 1);
  near(pushLanding(late.camera).t, 2.5, 'an event that is late enough stays where the narration puts it');
});

test('pop: the close-up switch is no earlier than the incoming cut ends plus 0.6 s', () => {
  const clip = CLIP({ cut: 'punch', on: [{ at: 'word:one', do: 'underline', target: 'region:r' }] });
  const { nodes } = expandIn(filmOf([FILLER, clip], 'pop', '9:16'), 1);
  const hero = nodes.find((n) => n.id === 'c.image');
  const hideAt = hero.tracks.opacity.points.at(-1).t;
  assert.ok(hideAt >= 0.2 + 0.6 - EPS, `the picture goes at ${hideAt}`);
});

test('an event that was moved is reported at shots[i].on[j] with how early the word is', () => {
  const clip = CLIP({ cut: 'slide' });
  const film = filmOf([FILLER, clip]);
  const timeline = buildTimeline(film, { fps: FPS });
  const timing = timeline.shots[1];
  const [found] = establishingFindings(clip, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) });
  assert.equal(found.path, 'on[0]');
  const wordOne = timing.words.find((w) => w.text === 'one' || w.text === 'One');
  const by = 0.4 + 0.6 + 0.9 - resolveAnchor('word:one', timing);
  assert.match(found.message, new RegExp(`comes ${by.toFixed(2)} s too early to show the whole picture first`));
  assert.match(found.message, /move the word later in the narration by/);
  void wordOne;
  const later = establishingFindings({ ...clip, on: [{ at: 2.5, do: 'circle', target: 'region:r' }] }, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) });
  assert.deepEqual(later, []);
  assert.deepEqual(establishingFindings({ ...clip, on: [{ at: 0.1, do: 'highlight', target: 'image' }] }, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) }), [], 'an event on the whole picture needs no establishing view');
});

test('in a shot shorter than the establishing floor the message says where the event really went: the shot end', () => {
  const clip = { ...CLIP({ cut: 'slide' }), say: undefined, hold: 1.5, on: [{ at: 0.2, do: 'circle', target: 'region:r' }] };
  const timeline = buildTimeline(filmOf([FILLER, clip]), { fps: FPS });
  const timing = timeline.shots[1];
  const [found] = establishingFindings(clip, { look: registries.looks.get('desk'), timing, at: (ref) => resolveAnchor(ref, timing) });
  assert.match(found.message, /the event was moved to 1\.50 s/, 'the floor (1.9 s) is past the 1.5 s shot');
});

// ---- revision 2: slug, caption, crop, dim (E3) ----

const DESK_CLIP = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.', kicker: 'The proof', caption: 'Every chart shows its query',
  regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
// the fake measure sets caps far wider than Archivo extra-condensed: a short caption, so that it fits at step 3
const POP_CLIP = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows you the query behind it.', caption: 'See the query.',
  regions: { query: [0.6, 0.2, 0.3, 0.2] }, on: [{ at: 'word:query', do: 'highlight', target: 'region:query' }] };
const pushAt = (timing) => Math.max(timing.words[4].start, 0.6 + 0.9);

test('desk clipping kicker: the same slug as a statement, pinned to the frame (out of the camera) and drawn over the picture', () => {
  const { nodes, canvas, ctx } = expandShot(DESK_CLIP, 'desk', '16:9');
  const slug = slugOf(nodes, 'c');
  assert.ok(slug, 'a clipping takes a kicker and sets it on the slug');
  assert.equal(slug.group.props.fixed, true, 'pinned: the camera push does not move it');
  assert.equal(slug.group.props.rotate, 3);
  assert.ok(Math.abs(slug.right - (canvas.w - gridX(ctx.look, canvas, 2))) < 2, 'where every slug is');
  const ids = nodes.map((n) => n.id);
  assert.ok(ids.indexOf('c.slug') > ids.indexOf('c.image'), 'drawn after the picture, so the picture never covers it');
  // through the push: the slug stands where it rests while the picture is pushed in
  const f = filmFor([DESK_CLIP], 'desk', '16:9');
  const { timing } = expandShot(DESK_CLIP, 'desk', '16:9');
  const pushed = f.sampleAt(pushAt(timing)).find((n) => n.id === 'c.slug');
  near(pushed.x, slug.group.props.x, 'the slug x through the push');
  near(pushed.y, slug.group.props.y, 'the slug y through the push');
  near(pushed.scale, 1, 'not zoomed');
  assert.ok(f.sampleAt(pushAt(timing)).find((n) => n.id === 'c.image').scale > 1.2, 'while the picture is pushed in');
});

test('pop clipping kicker: a tag flush left on the stack edge, over the picture, pinned and inside the safe zone', () => {
  const { nodes, canvas, ctx, boxes } = expandShot({ ...POP_CLIP, kicker: 'The proof' }, 'pop', '9:16');
  const safe = viralOf(canvas);
  const tag = nodes.find((n) => n.id === 'c.kicker');
  assert.ok(tag, 'the kicker is drawn');
  assert.equal(tag.props.fixed, true);
  assert.equal(tag.children.find((n) => n.type === 'path').props.fill, ctx.look.palette.accent);
  const box = plateBox(tag);
  near(box[0], safe.left, 'flush left');
  assert.ok(box[1] >= safe.top - EPS, 'inside the safe zone');
  assert.ok(box[1] + box[3] <= boxes.image[1] + EPS, 'over the picture');
});

test('desk caption: label caps at step 2 on a small paper card, bottom left on column 2, upright, pinned to the frame for the whole shot', () => {
  const { nodes, canvas, ctx, timing } = expandShot(DESK_CLIP, 'desk', '16:9');
  const look = ctx.look;
  const card = all(nodes).find((n) => n.id === 'c.caption.card');
  assert.ok(card, 'a caption card');
  assert.equal(card.props.fixed, true, 'pinned to the frame');
  assert.equal(card.props.rotate ?? 0, 0, 'no tilt');
  assert.ok(card.children.some((n) => n.id === 'c.caption.card.paper'), 'the card device: paper');
  assert.equal(card.children.find((n) => n.id === 'c.caption.card.paper').props.textCard, true, 'a text card, for the review');
  const text = card.children.find((n) => n.id === 'c.caption');
  assert.equal(text.props.font.family, look.fonts.label.family);
  assert.equal(text.props.font.size, look.scale[1], 'scale step 2');
  assert.equal(text.props.role, 'caption');
  assert.equal(text.props.furniture, true, 'a caption card is frame furniture');
  assert.ok(text.props.layout.lines.every((l) => l.words.every((w) => w.text === w.text.toUpperCase())), 'caps');
  const paper = card.children.find((n) => n.id === 'c.caption.card.paper');
  const nums = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  assert.ok(Math.abs(card.props.x + Math.min(...xs) - gridX(look, canvas, 2)) < 2, 'left edge on column 2, within the hand jitter');
  assert.ok(Math.abs(card.props.y + Math.max(...ys) - (canvas.h - look.grid.margin)) < 2, 'bottom on the bottom margin');
  near(sample(card.tracks.opacity, look.moves.enter.dur), 1, 'in with the picture');
  for (const t of [pushAt(timing), timing.duration]) near(sample(card.tracks.opacity, t), 1, `still there at ${t}`);
  const ids = nodes.map((n) => n.id);
  assert.ok(ids.indexOf('c.caption.card') > ids.indexOf('c.image'), 'over the picture');
});

test('pop caption: one line in the display face at step 3 or more, flush left on the stack edge, directly under the close-up, in with the highlight', () => {
  const { nodes, canvas, ctx, boxes } = expandShot(POP_CLIP, 'pop', '9:16');
  const look = ctx.look;
  const safe = viralOf(canvas);
  const caption = all(nodes).find((n) => n.id === 'c.caption');
  assert.ok(caption, 'a caption');
  assert.equal(caption.props.font.family, look.fonts.display.family);
  assert.ok(caption.props.font.size >= look.scale[2], `step 3 or more: ${caption.props.font.size}`);
  assert.equal(caption.props.layout.lines.length, 1, 'one line');
  assert.equal(caption.props.fixed, true, 'pinned to the frame');
  near(boxes.caption[0], safe.left, 'ink flush left on the safe edge');
  const close = boxes['region:query'];
  const reach = (look.keyline + Math.max(look.shadow.dx, look.shadow.dy)) * 1;
  assert.ok(boxes.caption[1] >= close[1] + close[3] + reach - EPS, 'under the close-up, clear of its keyline and shadow');
  assert.ok(boxes.caption[1] - (close[1] + close[3] + reach) <= 60, 'directly under it');
  assert.ok(boxes.caption[1] + boxes.caption[3] <= canvas.h - safe.bottom + EPS, 'inside the safe zone');
  const switchAt = shownAt(nodes.find((n) => n.id === 'c.close0').tracks.opacity);
  near(sample(caption.tracks.opacity, switchAt - 1 / FPS), 0, 'not before the highlight');
  near(sample(caption.tracks.opacity, switchAt), 1, 'in with the highlight');
  assert.equal(caption.props.layout.overflow, false);
  // a caption too long for one line at step 3 is set smaller to stay inside the safe width, and says it overflows
  const long = expandShot({ ...POP_CLIP, caption: 'It shows its work.' }, 'pop', '9:16');
  const longText = all(long.nodes).find((n) => n.id === 'c.caption');
  assert.equal(longText.props.layout.lines.length, 1, 'still one line');
  assert.equal(longText.props.layout.overflow, true, 'flagged for the review');
  assert.ok(long.boxes.caption[0] + long.boxes.caption[2] <= canvas.w - safe.right + 1, 'inside the safe width');
  // no highlight: it arrives with the picture, under it
  const quiet = expandShot({ ...POP_CLIP, on: undefined, hold: 3 }, 'pop', '9:16');
  const plain = all(quiet.nodes).find((n) => n.id === 'c.caption');
  near(sample(plain.tracks.opacity, 0), 1, 'with the picture');
  assert.ok(quiet.boxes.caption[1] >= quiet.boxes.image[1] + quiet.boxes.image[3] - EPS, 'under the picture');
});

test('crop: the establishing window of a locked camera is exactly the crop, fitted to the available space; a moving camera shows the whole picture', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, crop: [0.5, 0, 0.5, 1] };
  const { nodes, canvas } = expandShot(shot, 'pop', '9:16');
  const photo = all(nodes).find((n) => n.type === 'image' && n.id.startsWith('c.image.'));
  assert.deepEqual(photo.props.clip, [800, 0, 800, 1000], 'the crop in image pixels');
  const safe = viralOf(canvas);
  const w = canvas.w - safe.left - safe.right, h = canvas.h - safe.top - safe.bottom;
  // the fix pass (F5): fitted inside the available space less the spring's overshoot and the keyline and shadow, so no
  // larger than the plain fit (kinds-clipping-focus.test.mjs checks the reach)
  const fit = Math.min((0.92 * w) / 800, h / 1000);
  assert.ok(photo.props.w <= 800 * fit + EPS && photo.props.w > 0.75 * 800 * fit, `fitted width ${photo.props.w}`);
  near(photo.props.w / photo.props.h, 800 / 1000, 'the crop\'s own shape');
  const desk = all(expandShot(shot, 'desk', '16:9').nodes).find((n) => n.type === 'image' && n.id.startsWith('c.image.'));
  assert.equal(desk.props.clip, undefined, 'desk pushes in on the whole picture');
});

test('the validator checks a crop like a region', () => {
  const check = (crop) => validateFilm({ version: 2, mode: 'viral', shots: [{ id: 'c', show: 'clipping', src: 'shot.png', hold: 3, crop }] }, { specDir }).errors;
  assert.deepEqual(check([0.5, 0, 0.5, 1]), []);
  const past = check([0.6, 0, 0.5, 1]);
  assert.equal(past[0].path, 'shots[0].crop');
  assert.match(past[0].message, /runs past the image/);
  const zero = check([0.1, 0.1, 0, 0.5]);
  assert.equal(zero[0].path, 'shots[0].crop');
  assert.match(zero[0].message, /w and h must be above 0/);
  assert.ok(check([0.1, 0.1, 0.5]).length > 0, 'four numbers');
});

// k5: with no highlight the pop caption captions the whole picture from frame 0, and the close-up an underline cuts to
// is larger than the picture: the caption ran onto its white keyline and lime shadow (the contrast rule's partial ground
// caught it, white on white). The caption keeps clear of every cut-out it shares the frame with, keyline and shadow included.
test('pop: a caption shown from frame 0 clears the close-ups the shot cuts to, keyline and shadow included', () => {
  const look = registries.looks.get('pop');
  const shot = { ...registries.kinds.get('clipping').example, src: 'shot.png', on: [{ at: 'word:query', do: 'underline', target: 'region:query' }] };
  for (const format of ['16:9', '9:16']) {
    const out = expandShot(shot, 'pop', format);
    const unit = Math.min(out.canvas.w, out.canvas.h) / 1080;
    const close = out.boxes['region:query'];
    const reach = (look.keyline + Math.max(look.shadow.dx, look.shadow.dy)) * unit;
    const caption = out.boxes.caption;
    const meets = caption[1] < close[1] + close[3] + reach && close[1] - reach < caption[1] + caption[3];
    assert.ok(!meets, `${format}: caption ${caption.map(Math.round)} meets the close-up ${close.map(Math.round)} (reach ${reach})`);
    // the underline drawn under the close-up is above the caption's cap line (where its capitals start), by at least the
    // caption's own gap (24 units, clipping-captions.mjs LINE_CAPTION.gap): the browser frame showed it crossing the caps
    const line = all(out.nodes).find((n) => n.id === 'query.on0');
    const lineBottom = Number(/^M[\d.]+ ([\d.]+)/.exec(line.props.d)[1]) + line.props.strokeWidth / 2;
    const cap = textNode(out.nodes, 'query.caption');
    const capTop = cap.props.y + cap.props.layout.lines[0].y - 0.7 * cap.props.layout.size;
    assert.ok(capTop - lineBottom >= 24 * unit - 1e-6, `${format}: the caption's cap line ${Math.round(capTop)} is not 24 units under the underline's bottom ${Math.round(lineBottom)}`);
    const safe = safeRectFor(out.canvas, look); // the rectangle the frame review keeps text inside
    inside(caption, { left: safe.left, top: safe.top, right: out.canvas.w - safe.right, bottom: out.canvas.h - safe.bottom }, out.canvas, `${format}: caption`);
  }
});

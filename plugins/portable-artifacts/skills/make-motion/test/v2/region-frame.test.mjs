// Region marks and close-ups at the frame's edge (looks-four Task 4b, controller ruling 4). The frame review reports a
// mark drawn on a region (a highlight frame, a circle, an underline, a bracket, an arrow, a label: an `on` event aimed at
// `region:<name>`) whose drawn box lies partly outside the frame on a sampled frame, after the camera (region-off-frame),
// and a text sliced by the frame's edge while a close-up is on screen (frame-edge). Both are mechanical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { node } from '../../engine/graph/node.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { regionMarkIds } from '../../engine/review/regions.mjs';
import { withLookEmphasis } from '../../engine/kinds/emphasis-fallback.mjs';
import { CLOSE_UP_PHOTO_RE } from '../../engine/kinds/close-ups.mjs';
import { safeRectFor, regionMarksOf } from '../../scripts/v2/review.mjs';
import { registries } from '../../engine/registry.mjs';
import { snapshotOf } from './helpers/bar.mjs';
import { expandShot, filmFor, filmOf, canvasOf, all } from './helpers/kinds.mjs';

const WIDE = canvasOf('16:9');
const ctxFor = (look, canvas, extra = {}) => ({ look, canvas, mode: 'pro', shotId: 's', shotIndex: 0, t: 1, safe: safeRectFor(canvas, look), ...extra });
const ledger = () => registries.looks.get('ledger');
const rulesOf = (findings, rule) => findings.filter((f) => f.rule === rule);
const ellipse = (cx, cy, rx, ry) => `M${cx - rx} ${cy}C${cx - rx} ${cy - ry} ${cx + rx} ${cy - ry} ${cx + rx} ${cy}C${cx + rx} ${cy + ry} ${cx - rx} ${cy + ry} ${cx - rx} ${cy}Z`;
const circleNode = (id, cx, rx) => node('path', id, { d: ellipse(cx, 540, rx, 200), stroke: '#16181d', strokeWidth: 3 });
const audit = (nodes, extra) => auditFrame(snapshotOf(sampleGraph(nodes, 0)), ctxFor(ledger(), WIDE, extra));

test('regionMarkIds names the device of every on event aimed at a region, by its place in on', () => {
  const shot = { id: 'q', on: [{ at: 0, do: 'circle', target: 'region:a' }, { at: 0, do: 'underline', target: 'image' }, { at: 0, do: 'label', target: 'region:b', text: 'x' }] };
  assert.deepEqual(regionMarkIds(shot), ['q.on0', 'q.on2']);
  assert.deepEqual(regionMarkIds({ id: 'q' }), []);
});

test('a region circle that runs past the frame edge is a mechanical region-off-frame finding', () => {
  const found = rulesOf(audit([circleNode('s.on0', 1700, 400)], { regionMarks: ['s.on0'] }), 'region-off-frame');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'mechanical');
  assert.equal(found[0].node, 's.on0');
  assert.match(found[0].message, /right edge/);
});

test('a region circle inside the frame, and a mark that is not on a region, give no region-off-frame finding', () => {
  assert.deepEqual(rulesOf(audit([circleNode('s.on0', 960, 400)], { regionMarks: ['s.on0'] }), 'region-off-frame'), []);
  assert.deepEqual(rulesOf(audit([circleNode('s.on1', 1700, 400)], { regionMarks: ['s.on0'] }), 'region-off-frame'), []);
});

test('a focus scrim over the whole frame is not a region box (its hole is what it marks), even zoomed past the edges', () => {
  const scrim = node('path', 's.on0', { d: `M0 0H${WIDE.w}V${WIDE.h}H0ZM800 400V600H1100V400Z`, fill: '#fbfaf7' });
  const zoomed = node('group', 'cam', { scale: 1.1, x: -96, y: -54 }, { children: [scrim] });
  assert.deepEqual(rulesOf(audit([zoomed], { regionMarks: ['s.on0'] }), 'region-off-frame'), []);
});

test('the camera counts: a mark inside the frame at rest leaves it under a zoom', () => {
  const zoomed = node('group', 'cam', { scale: 1.6, x: -400, y: -200 }, { children: [circleNode('s.on0', 1400, 300)] });
  assert.equal(rulesOf(audit([zoomed], { regionMarks: ['s.on0'] }), 'region-off-frame').length, 1);
});

// A statement's hero carried past the left edge, with a close-up picture on screen or without one.
function slicedFrame(withCloseUp) {
  const { nodes } = expandShot({ id: 's', show: 'statement', text: 'Numbers need sources' }, 'ledger', '16:9');
  const photo = node('image', 's.close0.cutout.image', { src: 'shot.png', w: 600, h: 300 });
  const shifted = node('group', 'shift', { x: -300 }, { children: nodes });
  return snapshotOf(sampleGraph(withCloseUp ? [photo, shifted] : [shifted], 5));
}

test('a text sliced by the frame edge while a close-up is on screen is a mechanical frame-edge finding', () => {
  const found = rulesOf(auditFrame(slicedFrame(true), ctxFor(ledger(), WIDE, { t: 5 })), 'frame-edge');
  assert.ok(found.length >= 1, 'a frame-edge finding');
  assert.equal(found[0].kind, 'mechanical');
  assert.match(found[0].message, /sliced by the frame's left edge/);
});

test('a text still moving (not landed) past the edge during a close-up is not judged: a push carries it out', () => {
  const [photo, shifted] = slicedFrame(true);
  const fading = { ...shifted, opacity: 0.5 }; // arriving: not landed
  assert.deepEqual(rulesOf(auditFrame([photo, fading], ctxFor(ledger(), WIDE, { t: 5 })), 'frame-edge'), []);
});

test('without a close-up on screen the frame-edge rule is silent (the safe-area rule judges a resting text)', () => {
  assert.deepEqual(rulesOf(auditFrame(slicedFrame(false), ctxFor(ledger(), WIDE, { t: 5 })), 'frame-edge'), []);
});

// ---- whole shots, camera applied (buildFilm sampleShot) ----

// Every region-off-frame finding of a one-shot film at frames every 0.25 s, the ids taken from the shots the engine
// builds (after the emphasis fallback moves events out of `on`).
function filmFindings(shot, look, format) {
  const built = filmFor([shot], look, format);
  const film = withLookEmphasis(filmOf([shot], look, format)).film;
  const canvas = canvasOf(format);
  const resolved = registries.looks.get(look);
  const ctx = ctxFor(resolved, canvas, { mode: look === 'pop' ? 'viral' : 'pro', regionMarks: regionMarkIds(film.shots[0]) });
  const times = Array.from({ length: Math.floor(built.duration / 0.25) + 1 }, (_, i) => i * 0.25);
  return times.flatMap((t) => auditFrame(snapshotOf(built.sampleShot(0, t)), { ...ctx, t }))
    .filter((f) => f.rule === 'region-off-frame' || f.rule === 'frame-edge');
}

const OFF_FRAME = Object.freeze({
  id: 'wide', show: 'clipping', src: 'shot.png', say: 'Every chart on this page shows its query.',
  regions: { query: [0.05, 0.4, 0.9, 0.2] }, on: [{ at: 'word:query', do: 'circle', target: 'region:query' }],
});

test('a pop film whose close-up circle runs off the frame fails the review', () => {
  assert.ok(filmFindings(OFF_FRAME, 'pop', '16:9').some((f) => f.rule === 'region-off-frame'));
});

test('in ledger a highlight the look falls back from keeps the circle after it judged (ids after the fallback)', () => {
  const shot = { ...OFF_FRAME, on: [{ at: 'word:0', do: 'highlight', target: 'word:0' }, ...OFF_FRAME.on] };
  const film = withLookEmphasis(filmOf([shot], 'ledger', '16:9')).film;
  assert.deepEqual(regionMarkIds(film.shots[0]), ['wide.on0']);
  // the film review reads the same ids from the film as written
  assert.deepEqual(regionMarksOf(filmOf([shot], 'ledger', '16:9')), [['wide.on0']]);
  assert.ok(all(filmFor([shot], 'ledger', '16:9').sampleShot(0, 0)).some((n) => n.id === 'wide.on0'), 'the built circle carries that id');
});

// The close-up picture and the circle on a ledger close-up at the shot's last frame, boxes in canvas pixels.
function closeUpParts(format, region = OFF_FRAME.regions.query) {
  const built = filmFor([{ ...OFF_FRAME, regions: { query: region } }], 'ledger', format);
  const snap = all(snapshotOf(built.sampleShot(0, built.duration)));
  return { photo: snap.find((n) => n.id === 'wide.close0.cutout.image'), circle: snap.find((n) => n.id === 'wide.on0') };
}
const holds = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];

test('ledger close-up shows the region with the source round it: the ruled circle rings the region on the picture', () => {
  // the registered example's region, which has the source round it on every side
  const { photo, circle } = closeUpParts('16:9', [0.55, 0.2, 0.35, 0.2]);
  assert.ok(all(filmFor([OFF_FRAME], 'pop', '16:9').sampleShot(0, 3)).some((n) => n.type === 'image' && CLOSE_UP_PHOTO_RE.test(n.id)), 'the review knows a built close-up when it sees one');
  const [, , cw, ch] = photo.props.clip;
  assert.ok(Math.abs(cw - 0.35 * 1600 * 1.4) < 1, `the window is the region and a fifth of it each side (clip width ${cw})`);
  assert.ok(Math.abs(ch - 0.2 * 1000 * 1.4) < 1, `and as much above and below (clip height ${ch})`);
  assert.ok(holds(photo.bbox, circle.bbox), `circle ${circle.bbox.map(Math.round)} inside the picture ${photo.bbox.map(Math.round)}`);
});

test('on 9:16 ledger does not cut to a close-up that would not enlarge a wide region: it rings it on the picture', () => {
  const { photo, circle } = closeUpParts('9:16', [0.03, 0.74, 0.44, 0.22]);
  assert.equal(photo, undefined, 'no close-up picture');
  const built = filmFor([{ ...OFF_FRAME, regions: { query: [0.03, 0.74, 0.44, 0.22] } }], 'ledger', '9:16');
  const establishing = all(snapshotOf(built.sampleShot(0, built.duration))).find((n) => n.id === 'wide.image.cutout.image');
  assert.ok(circle && establishing, 'the circle and the establishing picture are on screen at the end');
  assert.ok(circle.bbox[1] > establishing.bbox[1] && circle.bbox[1] + circle.bbox[3] < establishing.bbox[1] + establishing.bbox[3] + 40, 'the circle sits on the picture');
  // on 16:9 the same region is cut to: there the close-up enlarges it
  assert.ok(closeUpParts('16:9', [0.03, 0.74, 0.44, 0.22]).photo, 'a close-up on 16:9');
});

const LEDGER_DEVICES =Object.freeze(['circle', 'underline', 'bracket', 'arrow', 'highlight']);
const STRIPS = Object.freeze({ wide: [0.05, 0.4, 0.9, 0.2], tall: [0.4, 0.05, 0.2, 0.9], example: [0.55, 0.2, 0.35, 0.2] });
for (const format of ['16:9', '9:16']) {
  for (const [strip, region] of Object.entries(STRIPS)) {
    test(`ledger clipping at ${format}: every ruled mark on a ${strip} region close-up stays inside the frame`, () => {
      for (const device of LEDGER_DEVICES) {
        const shot = { ...OFF_FRAME, regions: { query: region }, on: [{ at: 'word:query', do: device, target: 'region:query' }] };
        assert.deepEqual(filmFindings(shot, 'ledger', format).map((f) => `${device}: ${f.message}`), []);
      }
    });
  }
}

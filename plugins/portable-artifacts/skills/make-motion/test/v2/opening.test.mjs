// No shot opens on an empty frame (look gate revision 2, E2): the frame review's opening rule, shown firing on a
// synthetic film, and every designed kind showing something on the first frame after a hard cut. Pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { auditFrame, openingFindings } from '../../engine/review/frame.mjs';
import { safeRectFor, opensShotAt, auditPlan } from '../../scripts/v2/review.mjs';
import { auditMoments } from '../../scripts/v2/plan.mjs';
import { FPS, measure, canvasOf, viralOf, filmOf, IMAGES } from './helpers/kinds.mjs';

const square = (id, extra = {}) => ({ type: 'path', id, props: { d: 'M0 0H200V200H0Z', fill: '#ff0000', x: 400, y: 300 }, ...extra });
const ground = { type: 'path', id: 'ground', depth: 1, props: { d: 'M0 0H1920V1080H0Z', fill: '#f3eee3' } };
// A free shot: the ground (depth 1, as a look's field is) and `nodes`.
const freeShot = (id, nodes, extra = {}) => ({ id, show: 'free', hold: 2, nodes: [ground, ...nodes], ...extra });
const FADING = square('box', { tracks: { opacity: { keys: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] } } });

function built(film) {
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  return { timeline, canvas, movie: buildFilm({ film, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) }) };
}

// The first frame of shot `index`, as the viewer sees it.
function openingFrame(film, index) {
  const { timeline, canvas, movie } = built(film);
  const frame = Math.round(timeline.shots[index].start * FPS);
  return { sampled: movie.sampleAt(frame / FPS), canvas, timeline, frame };
}

const reviewCtx = (film, canvas, extra = {}) => ({
  look: built(film).movie.look, canvas, safe: safeRectFor(canvas, built(film).movie.look), mode: film.mode, shotId: 'b', shotIndex: 1, t: 2, ...extra,
});

test('the frame review finds a shot that opens on nothing but the field: mechanical, at the shot', () => {
  const film = filmOf([freeShot('a', [square('a.box')]), freeShot('b', [FADING], { cut: 'cut' })]);
  const { sampled, canvas } = openingFrame(film, 1);
  // no text on screen, so the frame needs no page measurement (annotate) for the audit
  const findings = auditFrame(sampled, reviewCtx(film, canvas, { opensShot: true }));
  const opening = findings.filter((f) => f.rule === 'empty-first-frame');
  assert.equal(opening.length, 1, JSON.stringify(findings));
  assert.equal(opening[0].kind, 'mechanical');
  assert.equal(opening[0].path, 'shots[1]');
  assert.match(opening[0].message, /opens on an empty frame/);
  // the same frame is not an opening when the review says so (a frame inside a cut window, or later in the shot)
  assert.deepEqual(auditFrame(sampled, reviewCtx(film, canvas)).filter((f) => f.rule === 'empty-first-frame'), []);
});

test('a shot whose first frame shows something has no opening finding', () => {
  const film = filmOf([freeShot('a', [square('a.box')]), freeShot('b', [square('b.box')], { cut: 'cut' })]);
  const { sampled, canvas } = openingFrame(film, 1);
  assert.deepEqual(openingFindings(sampled, reviewCtx(film, canvas, { opensShot: true })), []);
});

test('what counts as shown: a text whose words are all at opacity 0, a stroke not yet drawn and a node inside a hidden group are not', () => {
  const ctx = { shotIndex: 1, shotId: 'b' };
  const word = (opacity) => ({ opacity, x: 0, y: 0, scale: 1 });
  const text = (opacities) => ({ type: 'text', id: 't', depth: 0, opacity: 1, draw: 1, reveal: 1, props: {}, children: [], words: opacities.map(word) });
  const stroke = (draw) => ({ type: 'path', id: 's', depth: 0, opacity: 1, draw, reveal: 1, props: { stroke: '#000000' }, children: [] });
  const group = (opacity, children) => ({ type: 'group', id: 'g', depth: 0, opacity, draw: 1, reveal: 1, props: {}, children });
  const field = { type: 'field', id: 'field', depth: 1, opacity: 1, draw: 1, reveal: 1, props: {}, children: [] };
  const fires = (nodes) => openingFindings([field, ...nodes], ctx).length === 1;
  assert.ok(fires([text([0, 0])]), 'all words hidden');
  assert.ok(!fires([text([0, 0.4])]), 'a ghost word at 0.4 is shown');
  assert.ok(fires([stroke(0)]), 'a stroke with nothing drawn');
  assert.ok(!fires([stroke(0.1)]), 'a stroke on its way');
  assert.ok(fires([group(0, [stroke(1)])]), 'inside a hidden group');
  assert.ok(fires([]), 'the field alone');
});

// Every designed kind, in both looks, as the second shot after a hard cut: something is on screen on its first frame.
const KINDS = [
  { id: 'b', show: 'statement', cut: 'cut', say: 'Built on your machine.', kicker: 'The point' },
  { id: 'b', show: 'number', cut: 'cut', say: 'Five skills. One file each.', value: 5, label: 'skills', delta: 'one file each' },
  { id: 'b', show: 'clipping', cut: 'cut', src: 'shot.png', say: 'This one shows the query behind it.', caption: 'It shows its work.' },
];
for (const look of ['desk', 'pop']) {
  for (const shot of KINDS) {
    test(`${look} ${shot.show}: the hero is on screen on the first frame after a hard cut`, () => {
      const format = look === 'pop' ? '9:16' : '16:9';
      const film = filmOf([{ id: 'a', show: 'statement', say: 'Hello there.' }, shot], look, format);
      const { sampled, canvas } = openingFrame(film, 1);
      assert.deepEqual(openingFindings(sampled, reviewCtx(film, canvas, { opensShot: true })), []);
    });
  }
}

test('the review judges the opening of a shot that comes in on a hard cut, and not the film\'s own first frame in a mode that does not read from frame 0 (a film may open on its field: the director\'s ruling)', () => {
  const film = filmOf([freeShot('a', [FADING]), freeShot('b', [FADING], { cut: 'cut' }), freeShot('c', [FADING], { cut: 'slide' })]);
  const { timeline } = built(film);
  const first = (i) => Math.round(timeline.shots[i].start * FPS);
  assert.equal(opensShotAt(film, timeline, 0, true), false, 'the film opens as its author wrote it');
  assert.equal(opensShotAt(film, timeline, first(1), true), true, 'a hard cut must not land on the field alone');
  assert.equal(opensShotAt(film, timeline, first(1) + 1, true), false, 'only its first frame');
  assert.equal(opensShotAt(film, timeline, first(2), false), false, 'a slide shows the outgoing shot on that frame');
});

// ---- look gate fix pass, review-rev2 I2 (the director's ruling) ----

test('in a mode that reads from frame 0 (hookFromFrameZero) the film\'s own first frame is judged too', () => {
  const film = filmOf([freeShot('a', [FADING]), freeShot('b', [FADING], { cut: 'cut' })], 'pop', '9:16');
  const { timeline } = built(film);
  assert.equal(opensShotAt(film, timeline, 0, true), true, 'the hook frame must show something');
  assert.equal(opensShotAt(film, timeline, 1, true), false, 'only frame 0');
  // and the rule fires on it when only the field is there
  const { sampled, canvas } = openingFrame(film, 0);
  const findings = auditFrame(sampled, reviewCtx(film, canvas, { opensShot: true, shotId: 'a', shotIndex: 0 })).filter((f) => f.rule === 'empty-first-frame');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'shots[0]');
});

test('a punch arrival is judged on its first frame that shows only the incoming shot (the one after p 0, which still shows the outgoing shot)', () => {
  const film = filmOf([freeShot('a', [square('a.box')]), freeShot('b', [FADING], { cut: 'punch' })]);
  const { timeline } = built(film);
  const first = Math.round(timeline.shots[1].start * FPS);
  assert.equal(opensShotAt(film, timeline, first, true), false, 'p 0 shows the outgoing shot');
  assert.equal(opensShotAt(film, timeline, first + 1, true), true, 'the first frame of only the incoming shot');
  assert.equal(opensShotAt(film, timeline, first + 2, true), false);
  assert.ok(auditMoments(film, timeline).includes(first + 1), 'the audit looks at that frame');
  // the punch window after p 0 is audited as drawn (the whole frame: only the incoming shot is there); p 0 alone
  const plan = new Map(auditPlan(film, timeline).map(([shot, frame]) => [frame, shot]));
  assert.equal(plan.get(first + 1), -1, 'the whole frame');
  assert.equal(plan.get(first), 1, 'p 0: the incoming shot alone');
  // a slide shows both shots throughout its window: the incoming shot is audited alone there
  const slid = filmOf([freeShot('a', [square('a.box')]), freeShot('b', [FADING], { cut: 'slide' })]);
  const slidTimeline = built(slid).timeline;
  const slideStart = Math.round(slidTimeline.shots[1].start * FPS);
  assert.equal(new Map(auditPlan(slid, slidTimeline).map(([shot, frame]) => [frame, shot])).get(slideStart + 2), 1);
});

test('a designed kind arriving on a punch opens whole: a clipping\'s picture is at least half there from the shot\'s first frame', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'Hello there.' }, { id: 'b', show: 'clipping', cut: 'punch', src: 'shot.png', hold: 3 }], 'pop', '9:16');
  const { movie } = built(film);
  const pic = movie.sampleShot(1, 0).find((n) => n.id === 'b.image');
  assert.ok(pic.opacity >= 0.5, `the picture on the shot's first frame: ${pic.opacity}`);
});

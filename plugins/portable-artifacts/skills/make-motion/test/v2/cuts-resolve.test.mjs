// Cuts: today's frames pinned (fixtures/cuts/baseline-keys.json, generated once from HEAD by .scratch/t1/baseline.mjs
// with helpers/cut-baseline.mjs; regenerated only in a commit that says which picture it changes on purpose), the one
// normaliser resolveCut, the cut options and their validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { registries } from '../../engine/registry.mjs';
import { resolveCut, resolveShotCut, explicitCut } from '../../engine/cuts/resolve.mjs';
import { aloneFromFrame, aloneAfterFrame } from '../../engine/cuts/index.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { cutEnd } from '../../engine/kinds/camera.mjs';
import { opensWhole, arrivesMatched } from '../../engine/kinds/shared.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { auditMoments } from '../../scripts/v2/plan.mjs';
import { shotFloors } from '../../scripts/v2/sound/snap.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import { stateKey } from '../../engine/graph/sample.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { measure, canvasOf, viralOf } from './helpers/kinds.mjs';
import { nodeCutKeys, filmCutKeys, cutWindows, BASELINE_FILM } from './helpers/cut-baseline.mjs';
import { handLook } from './helpers/hand-look.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const baseline = JSON.parse(readFileSync(path.join(HERE, 'fixtures/cuts/baseline-keys.json'), 'utf8'));
const engine = { cuts: registries.cuts, stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf };

// ---- today's frames ----

test('baseline: the fixture names the commit it was made from and every pinned state', () => {
  assert.match(baseline.from, /^[0-9a-f]{40}$/);
  assert.equal(Object.keys(baseline.nodes).length, 56, '4 cuts x 7 progress values x with and without frame');
  assert.equal(Object.keys(baseline.film.frames).length, 12, 'two punches of 6 frames in gate-pop');
});

test('baseline: cut, slide, punch and match open the windows they opened', () => {
  assert.deepEqual(cutWindows(engine), baseline.windows);
});

test('baseline: cut, slide, punch and match return the nodes they returned, with and without frame', () => {
  assert.deepEqual(nodeCutKeys(engine), baseline.nodes);
});

test(`baseline: every frame inside the cut windows of ${BASELINE_FILM} is the frame it was`, () => {
  const film = JSON.parse(readFileSync(path.join(SKILL, 'references/examples/v2', `${BASELINE_FILM}.json`), 'utf8'));
  assert.equal(baseline.film.name, BASELINE_FILM);
  assert.deepEqual(filmCutKeys(engine, film), baseline.film.frames);
});

// ---- resolveCut ----

test('resolveCut: a name gets the cut\'s own defaults (slide: moving left, in from the right, 0.4 s, no smear)', () => {
  const cut = resolveCut('slide');
  assert.deepEqual({ name: cut.name, family: cut.family, direction: cut.direction, dur: cut.dur, smear: cut.smear }, { name: 'slide', family: 'node', direction: 'left', dur: 0.4, smear: false });
  assert.equal(cut.entry, registries.cuts.get('slide'));
});

test('resolveCut: an object\'s direction and duration win over the defaults', () => {
  const cut = resolveCut({ type: 'slide', direction: 'up', duration: 0.8 });
  assert.equal(cut.direction, 'up');
  assert.equal(cut.dur, 0.8);
});

test('resolveCut: no cut at all is the hard cut, with no direction and no window', () => {
  assert.deepEqual([resolveCut(undefined).name, resolveCut(undefined).direction, resolveCut(undefined).dur], ['cut', null, 0]);
});

test('resolveCut: the root cut is used when the shot has none, and loses to the shot\'s own', () => {
  const rootCut = { type: 'slide', direction: 'left', duration: 0.6 };
  assert.deepEqual([resolveCut(undefined, { rootCut }).name, resolveCut(undefined, { rootCut }).direction, resolveCut(undefined, { rootCut }).dur], ['slide', 'left', 0.6]);
  assert.equal(resolveCut('punch', { rootCut }).name, 'punch');
  assert.equal(resolveCut('punch', { rootCut }).dur, 0.2, 'a root cut of another type lends no options');
  assert.equal(resolveCut({ type: 'slide', direction: 'down' }, { rootCut }).direction, 'down');
  assert.equal(resolveCut({ type: 'slide', direction: 'down' }, { rootCut }).dur, 0.6, 'the same type fills the options the shot leaves out');
});

test('resolveCut: the window is never longer than the shot it opens', () => {
  assert.equal(resolveCut({ type: 'slide', duration: 2 }, { shotDuration: 1.2 }).dur, 1.2);
  assert.equal(resolveCut('slide', { shotDuration: 3 }).dur, 0.4);
});

test('resolveCut: smear is false unless asked for, and never on a cut that cannot smear', () => {
  assert.equal(resolveCut({ type: 'slide', smear: true }).smear, true);
  assert.equal(resolveCut({ type: 'match', smear: true }).smear, false);
});

test('resolveCut: an unregistered name throws with the registry\'s did-you-mean', () => {
  assert.throws(() => resolveCut('slid'), /slide/);
});

test('resolveShotCut: null for the first shot; the film\'s root cut for the others', () => {
  const film = { look: 'desk', cut: 'slide', shots: [{ id: 'a' }, { id: 'b' }, { id: 'c', cut: 'match' }] };
  assert.equal(resolveShotCut(film, 0), null);
  assert.equal(resolveShotCut(film, 1).name, 'slide');
  assert.equal(resolveShotCut(film, 2).name, 'match');
});

test('explicitCut: every option written out, so a reader of the shot alone resolves the same cut', () => {
  const cut = resolveCut(undefined, { rootCut: { type: 'slide', direction: 'up' } });
  assert.deepEqual(explicitCut(cut), { type: 'slide', direction: 'up', duration: 0.4, smear: false });
  assert.deepEqual(resolveCut(explicitCut(cut)), cut);
  assert.deepEqual(explicitCut(resolveCut('cut')), { type: 'cut' });
});

test('aloneAfterFrame: a 0.8 s slide at 30 fps leaves the shot alone on frame 24; a punch on frame 1; a hard cut on 0', () => {
  assert.equal(aloneAfterFrame(resolveCut({ type: 'slide', duration: 0.8 }), 30), 24);
  assert.equal(aloneFromFrame(resolveCut('punch')), 1);
  assert.equal(aloneFromFrame(resolveCut('cut')), 0);
  assert.equal(aloneFromFrame(resolveCut('slide')), null);
});

// ---- slide and cover, by direction ----

const W = 1920, H = 1080;
const CANVAS = { w: W, h: H };
const at = (nodes, id) => nodes.find((n) => n.id === id);
const plain = (id, x, y, depth = 0) => Object.freeze({ type: 'path', id, depth, props: Object.freeze({ d: 'M0 0H10V10H0Z', fill: '#000000' }),
  x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]) });
const OUT = [plain('field', 0, 0, 1), plain('a', 900, 200)];
const IN = [plain('field', 0, 0, 1), plain('b', 100, 900)];
const E = 0.0625; // inOutCubic(0.25) = 4 * 0.25^3
// [direction, outgoing a at p 0.25, incoming b at p 0.25]: both shots move the way the direction names, so the incoming
// shot comes in by the edge across from it (left enters at the right edge, up at the bottom: engine/cuts/edges.mjs)
// and the outgoing leaves by the other
const SLIDE_AT = [
  ['left', [900 - E * W, 200], [100 + (1 - E) * W, 900]],
  ['right', [900 + E * W, 200], [100 - (1 - E) * W, 900]],
  ['up', [900, 200 - E * H], [100, 900 + (1 - E) * H]],
  ['down', [900, 200 + E * H], [100, 900 - (1 - E) * H]],
];

for (const [direction, a, b] of SLIDE_AT) {
  test(`slide ${direction}: both shots move at p 0.25 and the shared background stays`, () => {
    const out = registries.cuts.get('slide').apply({ from: OUT, to: IN, p: 0.25, canvas: CANVAS, direction });
    assert.deepEqual([at(out, 'a').x, at(out, 'a').y], a);
    assert.deepEqual([at(out, 'b').x, at(out, 'b').y], b);
    assert.deepEqual([at(out, 'field').x, at(out, 'field').y], [0, 0]);
  });

  test(`cover ${direction}: only the incoming shot moves, over the outgoing one where it was`, () => {
    const out = registries.cuts.get('cover').apply({ from: OUT, to: IN, p: 0.25, canvas: CANVAS, direction, background: '#123456' });
    assert.deepEqual([at(out, 'a').x, at(out, 'a').y], [900, 200]);
    assert.deepEqual([at(out, 'b').x, at(out, 'b').y], b);
    assert.deepEqual([at(out, 'field').x, at(out, 'field').y], [0, 0]);
    assert.ok(out.indexOf(at(out, 'b')) > out.indexOf(at(out, 'a')), 'the incoming shot is drawn over the outgoing one');
  });
}

test('cover: the incoming shot brings its own backdrop, so it covers the outgoing one as it slides in', () => {
  const out = registries.cuts.get('cover').apply({ from: OUT, to: IN, p: 0.25, canvas: CANVAS, direction: 'left', background: '#123456' });
  const backdrop = out.find((n) => n.props.fill === '#123456');
  assert.ok(backdrop, 'a backdrop in the incoming background colour');
  assert.equal(backdrop.x, (1 - E) * W);
  assert.ok(out.indexOf(backdrop) > out.indexOf(at(out, 'a')) && out.indexOf(backdrop) < out.indexOf(at(out, 'b')));
});

test('cover: the endpoints are the plain frames', () => {
  const cover = registries.cuts.get('cover');
  assert.equal(cover.apply({ from: OUT, to: IN, p: 0, canvas: CANVAS, direction: 'left' }), OUT);
  assert.equal(cover.apply({ from: OUT, to: IN, p: 1, canvas: CANVAS, direction: 'left' }), IN);
});

test('slide with no direction is the slide left, in from the right edge (today\'s picture)', () => {
  const slide = registries.cuts.get('slide');
  assert.deepEqual(slide.apply({ from: OUT, to: IN, p: 0.25, canvas: CANVAS }), slide.apply({ from: OUT, to: IN, p: 0.25, canvas: CANVAS, direction: 'left' }));
});

// ---- the registry entries ----

test('every registered cut has a family, a length, a summary, an example, its directions and whether it smears', () => {
  for (const name of registries.cuts.names()) {
    const entry = registries.cuts.get(name);
    assert.ok(['node', 'layer', 'shader'].includes(entry.family), name);
    assert.ok(Number.isFinite(entry.dur) && entry.dur >= 0, name);
    assert.equal(typeof entry.summary, 'string', name);
    assert.ok(entry.example !== undefined, name);
    assert.ok(entry.directions === null || (Array.isArray(entry.directions) && entry.directions.length > 0), name);
    assert.equal(typeof entry.smearable, 'boolean', name);
    assert.equal(typeof entry.incomingOnly, 'boolean', name);
  }
  assert.deepEqual(registries.cuts.get('slide').directions, ['left', 'right', 'up', 'down']);
  assert.deepEqual(registries.cuts.get('cover').directions, ['left', 'right', 'up', 'down']);
  assert.deepEqual(['cut', 'slide', 'cover', 'punch', 'match'].map((n) => registries.cuts.get(n).smearable), [false, true, true, true, false]);
});

// ---- --list cuts ----

test('--list cuts: each cut with its family, directions, default length, whether it takes smear, and its example', () => {
  const slide = listEntries('cuts').find((e) => e.name === 'slide');
  assert.deepEqual({ family: slide.family, directions: slide.directions, dur: slide.dur, smear: slide.smear, example: slide.example },
    { family: 'node', directions: ['left', 'right', 'up', 'down'], dur: 0.4, smear: true, example: { type: 'slide', direction: 'right' } });
  const match = listEntries('cuts').find((e) => e.name === 'match');
  assert.deepEqual([match.directions, match.smear], [null, false]);
  const text = formatList('cuts', listEntries('cuts'));
  // a direction is the way the next shot moves (lead ruling 1, round 2), and the list says so in those words
  assert.match(text, /^slide {2}.+\n {2}node, moves left \(default\), right, up or down \(the way the next shot moves on screen: "left" moves leftward and enters by the right edge, "up" moves upward and enters by the bottom edge\); 0\.4 s; takes smear; in the palette of desk, pop, poster\n {2}example: \{"type":"slide","direction":"right"\}$/m);
  assert.match(text, /^iris {2}.+\n {2}layer, in \(default\), out; 0\.4 s; no smear/m);
  assert.match(text, /^cut {2}.+\n {2}node, no direction; no window; no smear; in the palette of desk, pop, cosmos, ledger, poster\n {2}example: "cut"$/m);
});

test('--list cuts: every registered cut has an example that validates in desk (erase in the hand look, its only look)', () => {
  for (const name of registries.cuts.names()) {
    const { example } = listEntries('cuts').find((e) => e.name === name);
    const look = name === 'erase' ? handLook() : 'desk';
    const film = { version: 2, look, shots: [statement('a', { hero: 'h' }), statement('b', { hero: 'h', cut: example })] };
    assert.deepEqual(errorsOf(film), [], `${name}: ${JSON.stringify(example)}`);
  }
});

// ---- every reader agrees on a root cut and an object cut ----

test('a root cut and an object match: the film, the camera, the opening, the sound, the audit and the snap floors agree', () => {
  const film = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1, cut: { type: 'slide', duration: 1.5 },
    shots: [statement('a', { hold: 3 }), statement('b', { hold: 3, hero: 'h' }), statement('c', { hold: 3, hero: 'h', cut: { type: 'match' } })] };
  const timeline = buildTimeline(film, { fps: 30 });
  const built = buildFilm({ film, timeline, measure, canvas: canvasOf('16:9'), viralInsets: viralOf(canvasOf('16:9')) });
  const [b, c] = [timeline.shots[1], timeline.shots[2]];
  assert.notDeepEqual(built.frameAt(b.start + 1.4).sampled, built.sampleShot(1, 1.4), 'b is still sliding in at 1.4 s');
  assert.deepEqual(built.frameAt(b.start + 1.5).sampled, built.sampleShot(1, 1.5), 'b is alone from 1.5 s');
  assert.equal(cutEnd({ ...film.shots[1], cut: explicitCut(resolveShotCut(film, 1)) }, b), 1.5);
  assert.equal(opensWhole({ ...film.shots[1], cut: explicitCut(resolveShotCut(film, 1)) }, { timing: b }), false);
  assert.equal(arrivesMatched({ ...film.shots[2], cut: explicitCut(resolveShotCut(film, 2)) }, { timing: c }), true);
  assert.deepEqual(soundEvents(film, timeline).filter((e) => e.kind === 'cut').map((e) => e.cut), ['slide', 'match']);
  assert.ok(auditMoments(film, timeline).includes(Math.round(b.start * 30) + 45), 'the first frame after the 1.5 s slide is audited');
  assert.deepEqual(shotFloors(film), [1, 1.5, 1]);
});

test('a kind sees the cut the film draws: a root match and the same match on the shot build the same frames', () => {
  const shots = [statement('a', { hold: 3 }), statement('b', { hold: 3, hero: 'h' })];
  const frames = (film) => {
    const timeline = buildTimeline(film, { fps: 30 });
    const built = buildFilm({ film, timeline, measure, canvas: canvasOf('16:9'), viralInsets: viralOf(canvasOf('16:9')) });
    return Array.from({ length: 30 }, (_, i) => stateKey(built.frameAt(3 + i / 30)));
  };
  const base = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1 };
  assert.deepEqual(frames({ ...base, cut: 'match', shots }), frames({ ...base, shots: [shots[0], { ...shots[1], cut: 'match' }] }));
});

// ---- validation ----

const DIR = mkdtempSync(path.join(tmpdir(), 'mm-cuts-'));
const statement = (id, extra = {}) => ({ id, show: 'statement', hold: 2, text: `Shot ${id}`, ...extra });
const deskFilm = (cut, root) => ({ version: 2, look: 'desk', ...(root === undefined ? {} : { cut: root }), shots: [statement('a'), statement('b'), statement('c', cut === undefined ? {} : { cut })] });
// shots b and c share the hero "h", as a match into c needs
const heroFilm = (cut) => ({ version: 2, look: 'desk', shots: [statement('a'), statement('b', { hero: 'h' }), statement('c', { hero: 'h', cut })] });
const errorsOf = (film) => validateFilm(film, { specDir: DIR }).errors;
const only = (film) => {
  const errors = errorsOf(film);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  return errors[0];
};

test('validation: a cut object with every option is fine, and so is a root cut', () => {
  assert.deepEqual(errorsOf(deskFilm({ type: 'slide', direction: 'up', duration: 0.8, smear: true })), []);
  assert.deepEqual(errorsOf(deskFilm(undefined, { type: 'slide', direction: 'left' })), []);
});

test('validation: an unknown key gets a did-you-mean and the keys a cut takes', () => {
  const e = only(deskFilm({ type: 'slide', direciton: 'up' }));
  assert.equal(e.path, 'shots[2].cut.direciton');
  assert.match(e.message, /did you mean "direction"\?/);
  assert.match(e.message, /type, direction, duration, smear/);
});

test('validation: a direction on a cut that has none is refused', () => {
  const e = only(heroFilm({ type: 'match', direction: 'up' }));
  assert.equal(e.path, 'shots[2].cut.direction');
  assert.match(e.message, /"match" cut takes no direction/);
});

test('validation: a direction outside the cut\'s list names the list and says what a direction means', () => {
  const e = only(deskFilm({ type: 'slide', direction: 'sideways' }));
  assert.equal(e.path, 'shots[2].cut.direction');
  assert.match(e.message, /left, right, up or down \(the way the next shot moves on screen: "left" moves leftward and enters by the right edge, "up" moves upward and enters by the bottom edge\), got "sideways"/);
  // in and out are not edges: no edge words
  assert.doesNotMatch(only(deskFilm({ type: 'iris', direction: 'up' })).message, /moves/);
});

test('validation: a duration outside 0.1 to 2 s is refused', () => {
  for (const duration of [0.05, 2.5, '1']) {
    const e = only(deskFilm({ type: 'slide', duration }));
    assert.equal(e.path, 'shots[2].cut.duration');
    assert.match(e.message, /0\.1 to 2/);
  }
});

test('validation: a duration on the hard cut is refused', () => {
  const e = only(deskFilm({ type: 'cut', duration: 0.5 }));
  assert.equal(e.path, 'shots[2].cut.duration');
  assert.match(e.message, /hard cut/);
});

test('validation: smear on a cut that cannot smear is refused, naming the ones that can', () => {
  const e = only(heroFilm({ type: 'match', smear: true }));
  assert.equal(e.path, 'shots[2].cut.smear');
  assert.match(e.message, /slide, cover, punch/);
});

test('validation: a cut object needs its type, and a cut is a name or an object', () => {
  assert.equal(only(deskFilm({ direction: 'up' })).path, 'shots[2].cut');
  assert.match(only(deskFilm({ direction: 'up' })).message, /"type"/);
  assert.equal(only(deskFilm(7)).path, 'shots[2].cut');
});

test('validation: an object\'s type the look does not list names the look\'s cuts', () => {
  const e = only(deskFilm({ type: 'slyde' }));
  assert.equal(e.path, 'shots[2].cut.type');
  assert.match(e.message, /did you mean "slide"/);
});

test('validation: the first shot accepts only the hard cut, as a name or an object', () => {
  const first = (cut) => ({ version: 2, look: 'desk', shots: [statement('a', { cut }), statement('b')] });
  assert.equal(only(first({ type: 'slide' })).path, 'shots[0].cut');
  assert.deepEqual(errorsOf(first({ type: 'cut' })), []);
});

test('validation: a root cut is checked as a shot\'s is, at "cut"', () => {
  const e = only(deskFilm(undefined, { type: 'slide', direction: 'sideways' }));
  assert.equal(e.path, 'cut.direction');
});

test('validation: an object match keeps the shared-id rule, and a root match is held to it too', () => {
  assert.equal(only(deskFilm({ type: 'match' })).path, 'shots[2].cut');
  assert.deepEqual(errorsOf(heroFilm({ type: 'match', duration: 0.6 })), []);
  assert.equal(errorsOf(deskFilm(undefined, 'match')).filter((e) => /shared/.test(e.message)).length, 2);
});

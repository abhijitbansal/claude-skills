// The field, the cuts between shots, the camera and buildFilm. Pure scene-graph work with a fake text measure
// (helpers/kinds.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sampleGraph, stateKey } from '../../engine/graph/sample.mjs';
import { sample } from '../../engine/time/track.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm, resolveLook, shotTime } from '../../engine/graph/film.mjs';
import { annotate } from '../../engine/page/bounds.mjs';
import { safeInsets } from '../../template/formats.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import {
  FPS, measure, viralOf, filmOf, expandIn, expandShot, filmFor, all, textNode, near, inside, isTextOnly,
  fakeSampled, THREE, FILLER,
} from './helpers/kinds.mjs';
import { worldOf, apply } from './helpers/boxes.mjs';

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-kinds-'));
  writeFileSync(path.join(specDir, 'shot.png'), 'x');
});
after(() => rmSync(specDir, { recursive: true, force: true }));
test('a match cut with no shared id is a validator error', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hi.' }, { id: 'b', show: 'number', cut: 'match', value: 1, label: 'x', hold: 2 }] }, { specDir });
  assert.equal(r.errors[0].path, 'shots[1].cut');
  assert.match(r.errors[0].message, /"match" needs a node id shared with shot "a"/);
  const ok = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hi.', hero: 'big' }, { id: 'b', show: 'number', cut: 'match', value: 1, label: 'x', hold: 2, hero: 'big' }] }, { specDir });
  assert.deepEqual(ok.errors, []);
});

test('every shot draws the look field first, at depth 1, 6% past every edge', () => {
  const shots = [
    { id: 'a', show: 'statement', say: 'One file.' },
    { id: 'n', show: 'number', value: 3, label: 'x', hold: 2 },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 2 },
  ];
  for (const look of ['desk', 'pop']) {
    for (const shot of shots) {
      const { nodes, canvas } = expandShot(shot, look);
      const [field] = nodes;
      assert.equal(field.type, 'field');
      assert.equal(field.depth, 1);
      assert.equal(field.props.field, registries.looks.get(look).field.field);
      assert.ok(Number.isInteger(field.props.w) && Number.isInteger(field.props.h));
      assert.ok(field.props.x <= -0.06 * canvas.w + 1 && field.props.x + field.props.w >= canvas.w * 1.06 - 1);
      assert.ok(field.props.y <= -0.06 * canvas.h + 1 && field.props.y + field.props.h >= canvas.h * 1.06 - 1);
    }
  }
});

test('one surface per film: every shot has the same field, seeded by the film seed alone', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'One file.' }, { id: 'n', show: 'number', value: 3, label: 'x', hold: 2 },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 2 }], 'desk', '16:9', { seed: 42 });
  const fields = [0, 1, 2].map((i) => expandIn(film, i).nodes[0]);
  for (const f of fields) {
    assert.equal(f.id, 'field');
    assert.equal(f.props.seed, 42);
    assert.deepEqual(f.props, fields[0].props, 'the same plan in every shot');
  }
});

test('a slide moves everything but the field', () => {
  const canvas = { w: 1920, h: 1080 };
  const field = (x) => Object.freeze({ ...fakeSampled('field', x), depth: 1 });
  const to = [field(-20), fakeSampled('b', 500)];
  const out = registries.cuts.get('slide').apply({ from: [field(-20), fakeSampled('a', 100)], to, p: 0.5, canvas });
  assert.deepEqual(out.map((n) => n.id), ['field', 'a', 'b']);
  assert.equal(out[0], to[0], 'the incoming field, unmoved');
  near(out[1].x, 100 - 0.5 * 1920);
  near(out[2].x, 500 + 0.5 * 1920);
});

test('desk drifts half a drift either side, alternating by shot; pop is locked', () => {
  const film = filmOf([{ id: 'a', show: 'statement', say: 'One.' }, { id: 'b', show: 'statement', say: 'Two.' }]);
  const drift = registries.looks.get('desk').camera.drift;
  const [even] = expandIn(film, 0).camera, [odd] = expandIn(film, 1).camera;
  const duration = expandIn(film, 0).timing.duration;
  assert.deepEqual(even.map((k) => [k.t, k.x]), [[0, -drift / 2], [duration, drift / 2]]);
  assert.deepEqual(odd.map((k) => [k.t, k.x]), [[0, drift / 2], [expandIn(film, 1).timing.duration, -drift / 2]]);
  assert.deepEqual(expandShot({ id: 'a', show: 'statement', say: 'One.' }, 'pop').camera, []);
});

test('every cut returns the outgoing frame at p 0 and the incoming frame at p 1', () => {
  const from = [fakeSampled('a', 100), fakeSampled('s', 300)];
  const to = [fakeSampled('b', 500), fakeSampled('s', 700, { rotate: 30 })];
  for (const name of ['cut', 'slide', 'punch', 'match']) {
    const cut = registries.cuts.get(name);
    const args = { from, to, canvas: { w: 1920, h: 1080 }, look: registries.looks.get('desk') };
    assert.deepEqual(cut.apply({ ...args, p: 0 }), from, `${name} p 0`);
    assert.deepEqual(cut.apply({ ...args, p: 1 }), to, `${name} p 1`);
  }
  assert.deepEqual([0, 0.4, 0.2, 0.5].map((_, i) => registries.cuts.get(['cut', 'slide', 'punch', 'match'][i]).dur), [0, 0.4, 0.2, 0.5]);
});

test('slide moves the outgoing frame left a canvas width while the incoming one enters from the right', () => {
  const canvas = { w: 1920, h: 1080 };
  const out = registries.cuts.get('slide').apply({ from: [fakeSampled('a', 100)], to: [fakeSampled('b', 500)], p: 0.25, canvas });
  const e = ease('inOutCubic')(0.25);
  near(out.find((n) => n.id === 'a').x, 100 - e * 1920);
  near(out.find((n) => n.id === 'b').x, 500 + (1 - e) * 1920);
});

test('punch starts the incoming frame at zoom 1.15 and settles', () => {
  const canvas = { w: 1920, h: 1080 };
  const out = registries.cuts.get('punch').apply({ from: [fakeSampled('a', 100)], to: [fakeSampled('b', 500)], p: 0.5, canvas });
  const z = 1.15 + (1 - 1.15) * ease('outExpo')(0.5);
  assert.deepEqual(out.map((n) => n.id), ['b']);
  near(out[0].scale, z);
  near(out[0].x, 960 + (500 - 960) * z);
});

// look gate fix pass, review-rev2 I3: a pinned overlay keeps its place over the picture through a punch
test('a punch keeps the incoming shot\'s order: a pinned kicker stays over the picture, unzoomed, and the fixed field stays at the back', () => {
  const canvas = { w: 1920, h: 1080 };
  const to = [fakeSampled('field', 0, { fixed: true }), fakeSampled('picture', 500), fakeSampled('kicker', 300, { fixed: true })];
  const ids = (out) => out.map((n) => n.id);
  const out = registries.cuts.get('punch').apply({ from: [], to, p: 0.5, canvas });
  assert.deepEqual(ids(out), ['field', 'picture', 'kicker'], 'the order the shot drew them in');
  near(out[2].x, 300, 'the pinned kicker is not zoomed');
  near(out[2].scale, 1);
  assert.ok(out[1].scale > 1, 'the picture is');
  // smeared, the same order: the fixed field still at the back, the picture averaged, the kicker drawn over it
  const parts = registries.cuts.get('punch').parts({ from: [], to, p: 0.5, canvas });
  assert.deepEqual([ids(parts.still), ids(parts.moving(0.4)), ids(parts.over)], [['field'], ['picture'], ['kicker']]);
  // a real film: a pop clipping with a kicker tag, arriving on a punch
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', cut: 'punch', hold: 3, kicker: 'The proof' };
  const f = filmFor([FILLER, shot], 'pop', '9:16');
  const mid = ids(f.sampleAt(1 + 0.1));
  assert.ok(mid.indexOf('c.kicker') > mid.indexOf('c.image'), `the kicker over the picture mid-punch: ${mid}`);
});

test('slide and punch smear what they move (Task 6): the still nodes once, the moving ones in samples over half a frame of travel, a slide shows both shots at p 0.5', () => {
  const canvas = { w: 1920, h: 1080 };
  const field = Object.freeze({ ...fakeSampled('field', -20), depth: 1 });
  const e = (q) => ease('inOutCubic')(q);
  const parts = registries.cuts.get('slide').parts({ from: [field, fakeSampled('a', 1500)], to: [field, fakeSampled('b', 200)], p: 0.5, canvas, background: '#123456' });
  assert.deepEqual(parts.still.map((n) => n.id), ['field'], 'the shared field is drawn once');
  for (const q of [0.48, 0.5, 0.52]) {
    const [a, b] = parts.moving(q);
    near(a.x, 1500 - e(q) * 1920, `outgoing at ${q}`);
    near(b.x, 200 + (1 - e(q)) * 1920, `incoming at ${q}`);
    near(a.opacity, 1, 'no sample carries an opacity of its own');
  }
  const onScreen = (n) => n.x + 10 > 0 && n.x < canvas.w; // the fake node is a 10 px square at its x
  assert.ok(parts.moving(0.5).every(onScreen), 'both shots on screen mid-cut');
  // apply draws the parts at p: each node once
  assert.deepEqual(registries.cuts.get('slide').apply({ from: [field, fakeSampled('a', 1500)], to: [field, fakeSampled('b', 200)], p: 0.5, canvas }).map((n) => n.id), ['field', 'a', 'b']);
  const punch = registries.cuts.get('punch').parts({ from: [], to: [fakeSampled('ground', 0, { fixed: true }), fakeSampled('b', 500)], p: 0.5, canvas });
  assert.deepEqual(punch.still.map((n) => n.id), ['ground'], 'a fixed node at the back is still');
  near(punch.moving(0.3)[0].scale, 1.15 + (1 - 1.15) * ease('outExpo')(0.3), 'punch sample');
  // a real film in a look that asks for the smear: a slide has both shots' text in every layer mid-cut, and no smear once
  // it has run
  const shots = [{ id: 'one', show: 'statement', say: 'Your charts lie.' }, { id: 'two', show: 'statement', say: 'No cloud.', cut: 'slide' }];
  const f = filmFor(shots, smearLook('pop'), '9:16');
  const second = buildTimeline(filmOf(shots, smearLook('pop'), '9:16'), { fps: FPS }).shots[1];
  const { smear } = f.frameAt(second.start + 0.2);
  assert.ok(smear.layers.length > 1);
  assert.ok(smear.layers.every((l) => l.some((n) => n.id === 'one.text') && l.some((n) => n.id === 'two.text')), 'both statements in every sample');
  assert.equal(f.frameAt(second.start + 0.5).smear, undefined, 'crisp once the cut has run');
  assert.equal(f.sampleAt(second.start + 0.5).filter((n) => n.id === 'two.text').length, 1);
  // a desk slide between two statements: at p 0.5 the outgoing text still reaches onto the canvas and the incoming one has arrived on it
  const desk = [{ id: 'one', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.' }, { id: 'two', show: 'statement', say: 'This one is different.', cut: 'slide' }];
  const g = filmFor(desk, smearLook('desk'), '16:9');
  const at = buildTimeline(filmOf(desk, smearLook('desk'), '16:9'), { fps: FPS }).shots[1].start + 0.2;
  const texts = (id) => g.frameAt(at).smear.layers.flat().filter((n) => n.id === id);
  assert.ok(texts('one.text').some((n) => n.x + n.props.layout.width > 0), 'the outgoing text is on screen at p 0.5');
  assert.ok(texts('two.text').some((n) => n.x < canvas.w), 'the incoming text is on screen at p 0.5');
});

// A look whose cutStyle is `cutStyle`: `base` under a test name (the shipped looks smear some cuts and not others).
function styledLook(base, suffix, cutStyle) {
  const name = `${base}-${suffix}-test`;
  if (!registries.looks.has(name)) registries.looks.add(name, Object.freeze({ ...registries.looks.get(base), name, cutStyle }));
  return name;
}
// A look that asks for the cut smear on slide and punch; one that asks for none.
const smearLook = (base) => styledLook(base, 'smear', { slide: { smear: true }, punch: { smear: true } });
const plainLook = (base) => styledLook(base, 'plain', {});

test('the smear is look data: a look whose cutStyle does not ask for it draws one copy of each shot through a slide and a punch; one that asks draws the averaged samples', () => {
  const statements = (cut) => [{ id: 'one', show: 'statement', say: 'Your charts lie.' }, { id: 'two', show: 'statement', say: 'No cloud.', cut }];
  for (const [base, format, cut] of [['desk', '16:9', 'slide'], ['pop', '9:16', 'slide'], ['pop', '9:16', 'punch']]) {
    const look = plainLook(base);
    const f = filmFor(statements(cut), look, format);
    const second = buildTimeline(filmOf(statements(cut), look, format), { fps: FPS }).shots[1];
    const t = second.start + registries.cuts.get(cut).dur / 2;
    const mid = f.sampleAt(t);
    assert.equal(f.frameAt(t).smear, undefined, `${look} ${cut}: no smear`);
    assert.equal(mid.filter((n) => n.id === 'two.text').length, 1, `${look} ${cut}: one copy of the incoming shot`);
    if (cut === 'slide') assert.equal(mid.filter((n) => n.id === 'one.text').length, 1, `${look} ${cut}: one copy of the outgoing shot`);
    // the test look's own timeline (a test look's mode follows its name, so its timing may differ)
    const smearStart = buildTimeline(filmOf(statements(cut), smearLook(base), format), { fps: FPS }).shots[1].start;
    const smeared = filmFor(statements(cut), smearLook(base), format).frameAt(smearStart + registries.cuts.get(cut).dur / 2);
    assert.ok(smeared.smear.layers.length > 1, `${base}-smear-test ${cut}: averaged samples`);
  }
  // transitions Task 6: desk and pop smear their three moving cuts; cosmos none
  const smears = (name) => Object.keys(registries.looks.get(name).cutStyle).filter((cut) => registries.looks.get(name).cutStyle[cut].smear === true).sort();
  assert.deepEqual(smears('desk'), ['cover', 'punch', 'slide']);
  assert.deepEqual(smears('pop'), ['cover', 'punch', 'slide']);
  assert.deepEqual(smears('cosmos'), []);
});

test('match interpolates a shared node at p 0.5 and fades the others', () => {
  const canvas = { w: 1920, h: 1080 };
  const a = { ...fakeSampled('s', 100, { opacity: 1, rotate: 0 }), bbox: [100, 100, 10, 10] };
  const b = { ...fakeSampled('s', 700, { opacity: 0.5, rotate: 40, scale: 2 }), bbox: [700, 100, 20, 20] };
  const out = registries.cuts.get('match').apply({ from: [fakeSampled('o', 0), a], to: [fakeSampled('i', 0), b], p: 0.5, canvas });
  const shared = out.find((n) => n.id === 's');
  assert.deepEqual(shared.bbox, [400, 100, 15, 15]);
  const [fromCopy, toCopy] = shared.children;
  near(fromCopy.rotate, 20); near(toCopy.rotate, 20);
  // coverage, not a sum: the outgoing copy keeps the full interpolated opacity underneath and only the incoming one
  // fades in over it, so the pair never reads thinner than either end
  near(fromCopy.opacity, 0.75, 'outgoing copy at the interpolated opacity');
  near(toCopy.opacity, 0.75 * 0.5, 'incoming copy fading in over it (smoothstep 0.5 at mid-cut)');
  assert.ok(shared.children.indexOf(fromCopy) < shared.children.indexOf(toCopy), 'outgoing underneath');
  // each copy's box is mapped onto the interpolated box: centre (407.5, 107.5), size 15
  near(fromCopy.scale, 1.5); near(toCopy.scale, 2 * 0.75);
  near(out.find((n) => n.id === 'o').opacity, 0, 'outgoing others are gone after 40%');
  near(out.find((n) => n.id === 'i').opacity, (0.5 - 0.4) / 0.6, 'incoming others fade in over the last 60%');
  const plainMatch = registries.cuts.get('match').apply({ from: [fakeSampled('s', 100)], to: [fakeSampled('s', 700)], p: 0.5, canvas });
  near(plainMatch[0].children[0].x, 400, 'without bboxes the origins interpolate');
});

test('buildFilm expands every shot once and gives the same frame for the same t in any order', () => {
  const kind = registries.kinds.get('statement');
  const original = kind.expand;
  let calls = 0;
  try {
    kind.expand = (...args) => { calls++; return original(...args); };
    const f = filmFor(THREE);
    assert.equal(calls, 1, 'statement expanded once');
    const times = Array.from({ length: 12 }, (_, i) => (i * f.duration) / 11);
    const forward = times.map((t) => stateKey(f.sampleAt(t)));
    const g = filmFor(THREE);
    const backward = [...times].reverse().map((t) => stateKey(g.sampleAt(t))).reverse();
    assert.deepEqual(forward, backward);
    assert.deepEqual(times.map((t) => stateKey(f.sampleAt(t))), forward, 'a second pass on the same film');
    assert.equal(f.frameCount, buildTimeline(filmOf(THREE), { fps: FPS }).frameCount);
  } finally {
    kind.expand = original;
  }
});

test('a cut starts on the plain outgoing frame and ends on the plain incoming one', () => {
  for (const [look, cut] of [['desk', 'slide'], ['desk', 'match'], ['pop', 'punch'], ['pop', 'slide']]) {
    const s = [{ ...THREE[0], hero: 'h' }, { ...THREE[0], id: 'b', say: 'One file. No server.', cut, hero: 'h' }];
    const f = filmFor(s, look);
    const [first, second] = buildTimeline(filmOf(s, look), { fps: FPS }).shots;
    // the window the look gives the cut (pop's punch runs 0.3 s: look review gate-cuts-1 P1), else the registry's
    const dur = registries.looks.get(look).cutStyle?.[cut]?.duration ?? registries.cuts.get(cut).dur;
    assert.equal(stateKey(f.sampleAt(second.start)), stateKey(f.sampleShot(0, first.duration)), `${look} ${cut} starts on the outgoing end`);
    assert.equal(stateKey(f.sampleAt(second.start + dur)), stateKey(f.sampleShot(1, dur)), `${look} ${cut} ends on the incoming frame`);
    assert.notEqual(stateKey(f.sampleAt(second.start + dur / 2)), stateKey(f.sampleShot(1, dur / 2)), `${look} ${cut} differs mid-cut`);
    // just before the end the cut is already almost the incoming frame: the hero sits within a pixel of its place
    // the incoming copy, in the latest smear sample (the last layer) when the cut smears
    const top = f.sampleAt(second.start + dur - 1 / 600);
    const late = (top.at(-1).props.layer === true ? top.at(-1).children : top).findLast((n) => n.id === 'h');
    const plain = f.sampleShot(1, dur - 1 / 600).find((n) => n.id === 'h');
    if (cut !== 'match') assert.ok(Math.abs(late.x - plain.x) < 2, `${look} ${cut} converges`);
  }
});

test('heroes carry their box so a match can morph them', () => {
  const f = filmFor(THREE);
  const hero = f.sampleAt(1).find((n) => n.id === 'h');
  assert.equal(hero.bbox.length, 4);
  assert.ok(hero.bbox[2] > 0 && hero.bbox[3] > 0);
});

test('resolveLook applies the mode default and the accent', () => {
  assert.equal(resolveLook({ shots: [] }).name, 'desk');
  assert.equal(resolveLook({ mode: 'viral', shots: [] }).name, 'pop');
  assert.equal(resolveLook({ accent: '#ff6600', shots: [] }).palette.accent, '#ff6600');
});

test('every kind stays inside the safe area on every format once its entrances have landed', () => {
  const shots = [
    { id: 'a', show: 'statement', say: 'Most dashboards cannot tell you where a number came from.', kicker: 'The problem' },
    { id: 'n', show: 'number', say: 'Four hundred fifty nine rows.', value: 459, prefix: '$', suffix: 'K', label: 'rows in one file, with no server behind it', delta: '+12% this year' },
    { id: 'c', show: 'clipping', src: 'shot.png', hold: 3, caption: 'Figure one: the query', regions: { q: [0.1, 0.1, 0.8, 0.8] } },
  ];
  // pop sets a hook of a few words (design 5.2: at most seven); a desk statement is a full sentence
  const popStatement = { id: 'a', show: 'statement', say: 'One file. No server.', kicker: 'The problem' };
  for (const look of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16', '1:1', '4:5']) {
      for (const shot of look === 'pop' ? [popStatement, ...shots.slice(1)] : shots) {
        const { boxes, canvas, nodes, timing } = expandShot(shot, look, format);
        if (shot.show === 'statement') assert.equal(textNode(nodes).props.layout.overflow, false, `${look} ${format} fits`);
        // pop on 9:16 composes inside the platform safe zone; everything else inside the plain safe margin
        const insets = look === 'pop' && format === '9:16' ? viralOf(canvas) : safeInsets([canvas.w, canvas.h]);
        for (const [target, box] of Object.entries(boxes)) inside(box, insets, canvas, `${look} ${format} ${shot.show} ${target}`);
        // Every all-text node as drawn once landed (kicker, label, caption, the figure group). Nodes with paths (the
        // card, tags, hairlines) need the page to measure and are covered by their target boxes above.
        // A stack sets its lines flush left by their ink, so a line's advance box starts a side bearing before the
        // edge; its ink is checked through the `text` and word boxes above (the review measures ink the same way). The
        // stack look's delta (plain label caps on no plate) and caption are set flush by their ink too and checked by their boxes.
        const flushByInk = (n) => n.children.some((c) => c.props.stack) || (look === 'pop' && [`${shot.id}.delta`, `${shot.id}.caption`].includes(n.id));
        const drawn = annotate(sampleGraph(nodes, timing.duration).filter(isTextOnly).filter((n) => !flushByInk(n)));
        for (const n of drawn) inside(n.bbox, insets, canvas, `${look} ${format} ${shot.show} node ${n.id}`);
        // the fix pass (review-rev2 M1a): the texts set flush by their ink, and the desk caption inside its card, are
        // checked as drawn too: their ink measured here, through every transform above them, not the engine's boxes
        const sampled = sampleGraph(nodes, timing.duration);
        const inkIds = shot.show === 'number' ? (look === 'pop' ? ['n.delta.text'] : []) : shot.show === 'clipping' ? ['c.caption'] : [];
        for (const id of inkIds) inside(drawnInk(sampled, id), insets, canvas, `${look} ${format} ${shot.show} ink of ${id}`);
      }
    }
  }
});

// The ink of text `id` in a sampled tree as drawn, in canvas pixels: each word's ink by the fake measure (helpers/
// kinds.mjs, tracking added after every glyph but the last, as canvas does), carried through every transform above it.
function drawnInk(sampled, id) {
  const found = worldOf(sampled, id);
  assert.ok(found && found.node.type === 'text', `a text ${id}`);
  const { node: n, m } = found;
  const { layout, font } = n.props;
  const points = layout.lines.flatMap((line) => line.words.flatMap((w) => {
    const ink = measure(w.text, font);
    const tracked = (font.tracking ?? 0) * font.size * ([...w.text].length - 1);
    const left = line.x + w.x + ink.inkLeft, right = line.x + w.x + ink.inkRight + tracked;
    return [[left, line.y - ink.inkAscent], [right, line.y - ink.inkAscent], [left, line.y + ink.inkDescent], [right, line.y + ink.inkDescent]].map((p) => apply(m, p));
  }));
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

test('a match keeps the shared field first, under the outgoing frame, and the hero above it', () => {
  const field = (x) => Object.freeze({ ...fakeSampled('field', x), depth: 1 });
  const out = registries.cuts.get('match').apply({
    from: [field(0), fakeSampled('old', 0), fakeSampled('h', 10)],
    to: [field(0), fakeSampled('h', 20), fakeSampled('new', 0)],
    p: 0.5, canvas: { w: 1920, h: 1080 },
  });
  assert.deepEqual(out.map((n) => n.id), ['field', 'old', 'h', 'new']);
});

test('a punch at 0 keeps both of its keys at t 0, so the shot opens on the peak', () => {
  const f = filmFor([{ id: 'a', show: 'statement', say: 'One file.', on: [{ at: 0, do: 'punch', target: 'text' }] }], 'pop', '9:16');
  const peak = registries.looks.get('pop').devices.punch.scale;
  near(f.sampleShot(0, 0).find((n) => n.id === 'a.text').scale, peak, 'the jump survives the merge');
  near(f.sampleShot(0, 1).find((n) => n.id === 'a.text').scale, 1, 'and settles');
});

test('a match passes an identical node through unchanged, and the field never dips', () => {
  const canvas = { w: 1920, h: 1080 };
  const field = Object.freeze({ ...fakeSampled('field', -20), depth: 1 });
  const same = fakeSampled('same', 40);
  const out = registries.cuts.get('match').apply({ from: [field, same, fakeSampled('h', 10)], to: [field, same, fakeSampled('h', 300)], p: 0.5, canvas });
  assert.equal(out.find((n) => n.id === 'field'), field, 'the shared field passes through');
  assert.equal(out.find((n) => n.id === 'same'), same, 'an identical node passes through');
  // a real desk match: at every frame of the cut the field is one node, fully opaque, where the incoming shot has it
  const s = [{ ...THREE[0], hero: 'h' }, { ...THREE[0], id: 'b', say: 'One file. No server.', cut: 'match', hero: 'h' }];
  const f = filmFor(s, 'desk');
  const second = buildTimeline(filmOf(s, 'desk'), { fps: FPS }).shots[1];
  for (let i = 0; i <= 15; i++) {
    const local = i / FPS;
    const fields = f.sampleAt(second.start + local).filter((n) => n.id === 'field');
    const plain = f.sampleShot(1, local)[0];
    assert.equal(fields.length, 1, `frame ${i}: one field`);
    assert.equal(fields[0].type, 'field');
    assert.equal(fields[0].opacity, 1, `frame ${i}: the field is fully opaque`);
    assert.ok(Math.abs(fields[0].x - plain.x) < 1 && Math.abs(fields[0].scale - plain.scale) < 1e-3, `frame ${i}: where the incoming shot has it`);
  }
});

test('a slide out of a pushed-in shot eases the field from its outgoing state to the incoming one', () => {
  const canvas = { w: 1920, h: 1080 };
  const pushed = Object.freeze({ ...fakeSampled('field', -300), depth: 1, scale: 1.4 });
  const rest = Object.freeze({ ...fakeSampled('field', -100), depth: 1, scale: 1 });
  const out = registries.cuts.get('slide').apply({ from: [pushed], to: [rest], p: 0.5, canvas });
  const e = ease('inOutCubic')(0.5);
  near(out[0].x, -300 + (-100 + 300) * e, 'x eases');
  near(out[0].scale, 1.4 + (1 - 1.4) * e, 'scale eases');
});

test('a kind that needs a device the look does not style fails naming the look and the device', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('bare-test')) registries.looks.add('bare-test', Object.freeze({ ...desk, name: 'bare-test', devices: {} }));
  const film = { version: 2, mode: 'pro', look: 'bare-test', format: '16:9', fps: FPS, seed: 1, shots: [{ id: 'c', show: 'clipping', src: 'shot.png', hold: 2 }] };
  assert.throws(() => expandIn(film), /look "bare-test".*"cutout"|"cutout".*look "bare-test"/);
});

// Lead ruling 2 (look review gate-cuts-1 D1) replaced the drift-and-fade hand-off this test pinned: an unlike pair is
// now carried on one path from the old place and size to the new one, handing over at the middle (cuts-match.test.mjs).
test('a match between unlike heroes carries one slot from the old place and size to the new one, the words changing in flight', () => {
  const canvas = { w: 1920, h: 1080 };
  const layoutOf = (...words) => ({ lines: [{ x: 0, y: 40, width: 100, words: words.map((text, index) => ({ text, index, x: 0, width: 50 })) }] });
  const heroText = { ...fakeSampled('h', 200, { scale: 1.5 }), type: 'text', props: { layout: layoutOf('Hello', 'there') }, bbox: [200, 100, 400, 100] };
  const heroFigure = { ...fakeSampled('h', 1000, { scale: 1 }), type: 'group', children: [{ ...fakeSampled('h.digits', 0), type: 'text', props: { layout: layoutOf('42') }, children: [] }], bbox: [900, 500, 400, 200] };
  const cut = registries.cuts.get('match');
  const kicker = fakeSampled('k', 300);
  const at = (p) => cut.apply({ from: [kicker, heroText], to: [heroFigure], p, canvas });
  const copy = (p, id) => at(p).find((n) => n.id === 'h').children.find((n) => n.id === id);
  // early the words are the outgoing ones, on their way and already resized toward the figure's box
  assert.ok(copy(0.3, 'h.from').opacity > 0.9 && copy(0.3, 'h.to').opacity === 0, 'outgoing words only');
  assert.ok(copy(0.3, 'h.from').scale > 1.5, 'resized on the way (the figure box is larger)');
  // late the figure, near its place; the kicker left before it arrived
  assert.ok(copy(0.7, 'h.to').opacity > 0.9 && copy(0.7, 'h.from').opacity === 0, 'incoming figure only');
  assert.equal(at(0.45).find((n) => n.id === 'k').opacity, 0, 'the rest of the outgoing frame is gone by the hand-over');
  const home = copy(0.999, 'h.to');
  assert.ok(Math.abs(home.x - 1000) < 2 && Math.abs(home.opacity - 1) < 0.01, 'the incoming hero ends where it belongs');
  // identical heroes still morph
  const twin = { ...heroText, bbox: [1000, 500, 400, 100], x: 1000 };
  const morphed = cut.apply({ from: [heroText], to: [twin], p: 0.5, canvas }).find((n) => n.id === 'h');
  assert.equal(morphed.props.match, true, 'a like pair morphs into one group of two copies');
});


// ---- final wave M9: a statement with nothing to show is a validation error at its path ----

test('a statement with hold and neither text nor say is a validation error at shots[i].text, not a page error', () => {
  const r = validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', hold: 2 }] }, { specDir });
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].text']);
  assert.match(r.errors[0].message, /"text" or "say"/);
  assert.deepEqual(validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', hold: 2, text: 'Hi' }] }, { specDir }).errors, []);
  assert.deepEqual(validateFilm({ version: 2, shots: [{ id: 'a', show: 'statement', hold: 2, text: ' | ' }] }, { specDir }).errors.map((e) => e.path), ['shots[0].text'], 'a text with no words');
});

// ---- final wave M3: the drawn and the audited frame read a shot at the same local time ----

test('shotTime rounds a shot-local time to 1e-9 s, as frameAt does, so a key that sits on a frame is reached in both', () => {
  assert.equal(0.1 + 0.2 - 0.1, 0.20000000000000004, 'float noise without the rounding');
  assert.equal(shotTime(0.1 + 0.2, 0.1), 0.2);
  assert.ok(Object.is(shotTime(0.5, 0.5), 0), 'never -0');
});

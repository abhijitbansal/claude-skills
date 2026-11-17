// Final wave I3: the contrast rule. Each text on screen is compared, by WCAG contrast ratio, with what is drawn
// directly under it (the field's paper, or an opaque filled shape such as a card or a plate that covers its ink, else
// the shot's background); under 3:1 is mechanical and names both colours. A ghost word (unspoken, in a mode that reads
// from frame 0) is exempt while unspoken, by the per-word `ghost` value the kind sets, never by its colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { contrastRatio } from '../../engine/review/contrast.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm, resolveLook } from '../../engine/graph/film.mjs';
import { annotate } from '../../engine/page/bounds.mjs';
import { FPS, measure, IMAGES, canvasOf, viralOf, filmOf } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = (extra = {}) => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 0.5, ...extra };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};
const at = (box) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0 });
const field = (paper) => ({ ...at([-60, -60, 2040, 1200]), type: 'field', id: 'field', depth: 1, props: { field: 'paper', palette: { paper, ink: '#000000' } } });
const plate = (fill, box = [180, 380, 900, 200], extra = {}) => ({ ...at(box), type: 'path', id: 'plate', props: { d: 'M0 0H1V1H0Z', fill, ...extra } });
const image = (box = [180, 380, 900, 200]) => ({ ...at(box), type: 'image', id: 'pic', props: { src: 'a.png', w: box[2], h: box[3] } });
// A 96 px text of `words` words with per-word fills (and optional ghost values), laid out inside the safe area.
function textNode({ fill = '#000000', words = [{}], opacity = 1 } = {}) {
  const size = 96, width = words.length * 192, height = size * 1.15;
  const line = { x: 0, y: size * 0.9, width, words: words.map((_, k) => ({ text: 'word', index: k, x: k * 192, width: 192 })) };
  return {
    ...at([200, 400, width, height]), type: 'text', id: 't', props: { fill }, opacity,
    words: words.map((w) => ({ opacity: 1, x: 0, y: 0, scale: 1, ...w })),
    layout: { size, width, height, overflow: false, lines: [line] },
  };
}
const contrast = (tree, extra) => auditFrame(tree, ctx(extra)).filter((f) => f.rule === 'contrast');

test('the WCAG ratio: black on white is 21, a colour on itself is 1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrastRatio('#111111', '#111111'), 1);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
});

test('a text in the colour of the field paper is mechanical and names both colours; a readable one is not', () => {
  const found = contrast([field('#111111'), textNode({ fill: '#151515' })]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.deepEqual([found[0].kind, found[0].node], ['mechanical', 't']);
  assert.match(found[0].message, /#151515/);
  assert.match(found[0].message, /#111111/);
  assert.deepEqual(contrast([field('#111111'), textNode({ fill: '#ffffff' })]), []);
});

test('the ground is what is drawn directly under the text: a plate that covers it, else the field, else the background', () => {
  assert.deepEqual(contrast([field('#111111'), plate('#ffffff'), textNode({ fill: '#111111' })]), [], 'dark caps on a white plate');
  assert.equal(contrast([field('#ffffff'), plate('#111111'), textNode({ fill: '#151515' })]).length, 1, 'on the plate, not the field');
  assert.equal(contrast([field('#111111'), plate('#ffffff', [900, 380, 300, 200]), textNode({ fill: '#111111' })]).length, 1, 'a plate beside the text is not under it');
  assert.equal(contrast([field('#111111'), textNode({ fill: '#111111' }), plate('#ffffff')]).length, 1, 'a plate drawn after the text is not under it');
  assert.equal(contrast([field('#111111'), plate('#ffffff', undefined, { blend: 'multiply' }), textNode({ fill: '#111111' })]).length, 1, 'a blended shape is not a ground');
  assert.equal(contrast([textNode({ fill: '#101010' })], { background: '#000000' }).length, 1, 'no field: the shot background');
  assert.deepEqual(contrast([textNode({ fill: '#101010' })]), [], 'no ground known: not judged');
  assert.deepEqual(contrast([field('#111111'), image(), textNode({ fill: '#111111' })]), [], 'over a picture: its pixels are not known, not judged');
});

// k4's map defect: a white place name overhung a lime highlight (1.15:1) and the rule gave no finding, because only a
// ground under all of a text's ink was its ground. A fill drawn after that ground and under part of the ink is a ground
// too: the text is judged against each of them.
test('a filled shape under part of a text is a ground too: white words running onto the pop lime are judged against it', () => {
  const lime = registries.looks.get('pop').palette.accent;
  const found = contrast([field('#111111'), plate(lime, [300, 380, 400, 200]), textNode({ fill: '#ffffff' })]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, new RegExp(lime));
  assert.match(found[0].message, /1\.15:1/);
  assert.deepEqual(contrast([field('#111111'), plate('#333333', [300, 380, 400, 200]), textNode({ fill: '#ffffff' })]), [], 'white reads on both grounds');
  assert.deepEqual(contrast([field('#111111'), plate(lime, [300, 380, 400, 200]), plate('#111111'), textNode({ fill: '#ffffff' })]), [], 'a plate drawn later over all of the text covers the part under it');
  assert.deepEqual(contrast([field('#111111'), plate(lime, [300, 380, 400, 200], { blend: 'multiply' }), textNode({ fill: '#ffffff' })]), [], 'a blended shape is not a ground, partly or wholly');
  assert.deepEqual(contrast([field('#111111'), textNode({ fill: '#ffffff' }), plate(lime, [300, 380, 400, 200])]), [], 'drawn after the text: on top, not under');
  // cosmos's quote draws its attribution rule 0 wide: a shape with no area paints nothing under the text
  assert.deepEqual(contrast([field('#111111'), plate('#f4f1ff', [250, 450, 0, 3]), textNode({ fill: '#ffffff' })]), [], 'a 0-wide rule is not a ground');
});

test('per word: each word fill counts; a word at opacity 0, and a text still fading in, are not judged', () => {
  const found = contrast([field('#111111'), textNode({ fill: '#ffffff', words: [{}, { fill: '#111111' }] })]);
  assert.equal(found.length, 1, 'the second word is in the paper colour');
  assert.deepEqual(contrast([field('#111111'), textNode({ fill: '#ffffff', words: [{}, { fill: '#111111', opacity: 0 }] })]), []);
  assert.deepEqual(contrast([field('#111111'), textNode({ fill: '#111111', opacity: 0.5 })]), []);
});

test('a ghost word is exempt while the kind marks it unspoken (ghost above 0), whatever its colour; spoken, it is judged', () => {
  assert.deepEqual(contrast([field('#111111'), textNode({ fill: '#ffffff', words: [{ fill: '#141414', ghost: 1 }] })]), []);
  assert.equal(contrast([field('#111111'), textNode({ fill: '#ffffff', words: [{ fill: '#141414', ghost: 0 }] })]).length, 1);
});

test('the reviewer\'s case: pop with "accent": "#111111" fires once the emphasised word lights in the paper colour', () => {
  const shots = [{ id: 'hook', show: 'statement', say: 'Your charts are *hiding* something.' }];
  const film = filmOf(shots, 'pop', '9:16', { accent: '#111111' });
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf('9:16');
  const movie = buildFilm({ film, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) });
  const look = resolveLook(film);
  const audit = (frame) => auditFrame(annotate(movie.sampleAt(frame / FPS)), { look, canvas, safe: safeRectFor(canvas, look), mode: 'viral', shotId: 'hook', shotIndex: 0, t: frame / FPS })
    .filter((f) => f.rule === 'contrast');
  assert.deepEqual(audit(0), [], 'frame 0: every word is an unspoken ghost');
  const found = audit(timeline.frameCount - 1);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, /#111111 on #111111/);
  const plain = filmOf(shots, 'pop', '9:16');
  const plainMovie = buildFilm({ film: plain, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) });
  const plainLook = resolveLook(plain);
  const last = annotate(plainMovie.sampleAt((timeline.frameCount - 1) / FPS));
  assert.deepEqual(auditFrame(last, { look: plainLook, canvas, safe: safeRectFor(canvas, plainLook), mode: 'viral', shotId: 'hook', shotIndex: 0, t: 1 }).filter((f) => f.rule === 'contrast'), [], 'the look\'s own accent passes');
});

// Task 28: the text-behind-subject block. The shared table in blocks.test.mjs runs the example, the extremes, the render
// twice and check.mjs over it; this file covers what is its own: the layer order, the alignment of the two pictures, clips,
// the cutout checks and the text sizing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES, expandBlocks } from '../template/blocks/index.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const NAME = 'text-behind-subject';
const PARAMS = { src: 'portrait.jpg', cutout: 'portrait-cutout.png', text: 'UNSTOPPABLE' };

const block = (params, extra = {}) => ({ id: 'tb', type: 'block', x: 960, y: 540, block: NAME, params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const errs = (motion) => validateSpec(motion, { dir: EXAMPLES }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');

test('the block is registered, and the registry has 38 blocks', () => {
  assert.ok(BLOCK_NAMES.includes(NAME));
  assert.equal(BLOCK_NAMES.length, 38);
  assert.deepEqual(BLOCKS[NAME].assets, ['src', 'cutout']);
});

test('three layers in this order: the picture, the text, the cutout on top; the two pictures share one frame so the person lines up', () => {
  const parts = partsOf(expandBlocks(oneScene([block(PARAMS)])));
  assert.deepEqual(parts.map((p) => p.id), ['tb/photo', 'tb/text', 'tb/subject']);
  assert.deepEqual(parts.map((p) => p.type), ['image', 'text', 'image']);
  const [photo, , subject] = parts;
  assert.deepEqual([photo.src, subject.src], ['portrait.jpg', 'portrait-cutout.png']);
  for (const key of ['x', 'y', 'width', 'height', 'fit']) assert.equal(subject[key], photo[key], `${key} of both pictures`);
  assert.equal(photo.fit, 'cover');
});

test('the text behind is drawn big in the upper part of the frame, in the chosen theme token (default text), at most fontSize px at 1080', () => {
  const text = (params) => partsOf(expandBlocks(oneScene([block({ ...PARAMS, ...params })]))).find((p) => p.id === 'tb/text');
  assert.equal(text({}).color, 'text');
  assert.equal(text({ color: 'accent' }).color, 'accent');
  assert.ok(text({}).y < 0, 'above the middle of the frame, where a head is');
  assert.ok(text({ fontSize: 120 }).fontSize <= 120);
  assert.ok(text({ fontSize: 120 }).fontSize < text({ fontSize: 300 }).fontSize, 'a bigger cap gives bigger text when it fits');
  assert.ok(text({}).fontSize >= 40, 'never under the 40 px floor');
  assert.equal(text({ text: '</script>' }).text, '</script>');
});

test('clips: a clip pair is drawn as two video elements; the original keeps its sound, the cutout is muted', () => {
  const parts = partsOf(expandBlocks(oneScene([block({ src: 'clip.mp4', cutout: 'clip.webm', text: 'LIVE' })])));
  assert.deepEqual(parts.map((p) => p.type), ['video', 'text', 'video']);
  assert.equal(parts[0].mute, undefined, 'the original plays its own sound');
  assert.equal(parts[2].mute, true, 'the cutout never doubles it');
});

test('the cutout is checked: not the same file, the same kind as src, and a format with alpha', () => {
  const at = (params) => errs(oneScene([block(params)]));
  assert.deepEqual(at(PARAMS), []);
  assert.deepEqual(at({ ...PARAMS, cutout: 'portrait.jpg' }), ['scenes[0].elements[0].params.cutout: is the same file as src; run node scripts/cutout.mjs on src and name the file it prints']);
});

test('the kind rules run on the names: a JPEG, an MP4 or a mixed pair cannot be a cutout; a PNG, WebP, SVG, WebM or MOV can', () => {
  assert.match(BLOCKS[NAME].validate({ src: 'a.png', cutout: 'a.jpg', text: 'x' }, { sceneDuration: 6 })[0].message, /JPEG has no transparency.*PNG/);
  assert.match(BLOCKS[NAME].validate({ src: 'a.mp4', cutout: 'a.mp4', text: 'x' }, { sceneDuration: 6 })[0].message, /same file as src/);
  assert.match(BLOCKS[NAME].validate({ src: 'a.mp4', cutout: 'b.mp4', text: 'x' }, { sceneDuration: 6 })[0].message, /an MP4 clip has no transparency.*WebM/);
  assert.match(BLOCKS[NAME].validate({ src: 'a.mp4', cutout: 'b.png', text: 'x' }, { sceneDuration: 6 })[0].message, /src is a clip but cutout is a photo/);
  assert.match(BLOCKS[NAME].validate({ src: 'a.png', cutout: 'b.webm', text: 'x' }, { sceneDuration: 6 })[0].message, /src is a photo but cutout is a clip/);
  assert.deepEqual(BLOCKS[NAME].validate({ src: 'a.mov', cutout: 'b.webm', text: 'x' }, { sceneDuration: 6 }), []);
  assert.deepEqual(BLOCKS[NAME].validate({ src: 'a.jpg', cutout: 'b.webp', text: 'x' }, { sceneDuration: 6 }), []);
  assert.deepEqual(BLOCKS[NAME].validate({ src: 'a.png', cutout: 'b.svg', text: 'x' }, { sceneDuration: 6 }), []);
});

test('params are capped and checked at params.<field>: a 41-character text, an over-long path, a fontSize outside 40 to 400, an unknown colour', () => {
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, text: 'x'.repeat(41) })])), ['scenes[0].elements[0].params.text: must NOT have more than 40 characters']);
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, fontSize: 20 })])), ['scenes[0].elements[0].params.fontSize: must be >= 40']);
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, fontSize: 401 })])), ['scenes[0].elements[0].params.fontSize: must be <= 400']);
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, color: 'red' })])), ['scenes[0].elements[0].params.color: must be one of "text", "text2", "accent", "good"']);
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, cutout: '../x.png' })])), ['scenes[0].elements[0].params.cutout: must stay inside the spec folder']);
  assert.deepEqual(errs(oneScene([block({ ...PARAMS, src: 'missing.png' })])), ['scenes[0].elements[0].params.src: file not found: missing.png']);
});

test('/assets serves both files the block names, and nothing else', async () => {
  const specPath = path.join(EXAMPLES, `${NAME}.json`);
  const srv = await startServer({ specPath, mode: 'preview' });
  try {
    for (const file of ['portrait.jpg', 'portrait-cutout.png']) assert.equal((await fetch(new URL(`/assets/${file}`, srv.url))).status, 200, file);
    assert.equal((await fetch(new URL('/assets/avatar.svg', srv.url))).status, 404);
  } finally { await srv.close(); }
});

test('the eval fixtures are byte copies of the example pair, so the item eval runs with no install', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['portrait.jpg', 'portrait-cutout.png']) {
    assert.deepEqual(readFileSync(path.join(root, '../../eval/fixtures/data', file)), readFileSync(path.join(EXAMPLES, file)), file);
  }
});

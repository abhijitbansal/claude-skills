// engine/formats.mjs: the format presets, the safe area and the viral platform zone, as version 2 reads them. The pure
// cases of version 1's test/formats.test.mjs, moved here with the file (cut-over plan, Task 1). The values are recorded
// as literals, so the table is pinned without the old file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, canvasSize, SAFE_MARGIN_PX, SAFE_REFERENCE_SIDE, safeMargin, safeInsets, VIRAL_SAFE_ZONE, VIRAL_REFERENCE } from '../../engine/formats.mjs';

test('FORMATS holds the four presets with their sizes and caption tops', () => {
  assert.deepEqual(FORMATS, {
    '16:9': { size: [1920, 1080], captionTop: 0.78 },
    '9:16': { size: [1080, 1920], captionTop: 0.72 },
    '1:1': { size: [1080, 1080], captionTop: 0.78 },
    '4:5': { size: [1080, 1350], captionTop: 0.72 },
  });
  assert.deepEqual([SAFE_MARGIN_PX, SAFE_REFERENCE_SIDE], [60, 1080]);
});

test('the table is frozen, sizes included, so no film or look can change a preset', () => {
  assert.ok(Object.isFrozen(FORMATS) && Object.isFrozen(FORMATS['9:16']) && Object.isFrozen(FORMATS['9:16'].size));
  assert.ok(Object.isFrozen(VIRAL_SAFE_ZONE) && Object.isFrozen(VIRAL_REFERENCE));
});

test('canvasSize is the film\'s size, else its format\'s, else 16:9; an unknown format falls to the default', () => {
  assert.deepEqual(canvasSize({ size: [640, 360] }), [640, 360]);
  assert.deepEqual(canvasSize({ size: [640, 360], format: '9:16' }), [640, 360], 'a size wins');
  for (const [name, { size }] of Object.entries(FORMATS)) assert.deepEqual(canvasSize({ format: name }), size, name);
  assert.deepEqual(canvasSize({}), [1920, 1080]);
  assert.deepEqual(canvasSize({ format: 'constructor' }), [1920, 1080], 'an inherited name is not a format');
});

test('safeMargin is 60 px at 1080 on the short side; safeInsets gives it on all four sides', () => {
  assert.equal(safeMargin([1920, 1080]), 60);
  assert.equal(safeMargin([1080, 1920]), 60);
  assert.equal(safeMargin([3840, 2160]), 120);
  assert.deepEqual(safeInsets([1920, 1080]), { top: 60, right: 60, bottom: 60, left: 60 });
  assert.deepEqual(safeInsets([3840, 2160]), { top: 120, right: 120, bottom: 120, left: 120 });
});

test('the viral zone is the union of the platform bands at 1080x1920: top 290, bottom 675, left 120, right 195', () => {
  assert.deepEqual(VIRAL_SAFE_ZONE, { top: 290, bottom: 675, left: 120, right: 195 });
  assert.deepEqual(VIRAL_REFERENCE, [1080, 1920]);
  assert.deepEqual(safeInsets([1080, 1920], VIRAL_SAFE_ZONE), { top: 290, right: 195, bottom: 675, left: 120 });
});

test('a zone given to safeInsets is used, never ignored: each band scales to the canvas and is never under the plain margin', () => {
  assert.deepEqual(safeInsets([1080, 1920], { top: 290, bottom: 675, left: 120, right: 195 }), { top: 290, right: 195, bottom: 675, left: 120 });
  assert.deepEqual(safeInsets([2160, 3840], VIRAL_SAFE_ZONE), { top: 580, right: 390, bottom: 1350, left: 240 }, 'twice the canvas, twice the bands');
  assert.deepEqual(safeInsets([1920, 1080], { top: 1, bottom: 1, left: 1, right: 1 }), { top: 60, right: 60, bottom: 60, left: 60 }, 'a thin band gives way to the margin');
});

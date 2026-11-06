// Task 7 (make-motion 1.2.0): the five UI mockup blocks (browser-window, form-fields, tab-switch, button-state,
// side-panel). The table every block passes (example, params limits, golden sheet, check.mjs) is blocks.test.mjs;
// this file pins what is specific to the UI blocks: fill order, swap timing, the content rectangle, the safe area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BLOCKS, expandBlocks } from '../template/blocks/index.mjs';
import { contentRect } from '../template/blocks/browser-window.mjs';
import { FORMATS, safeMargin } from '../template/formats.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const CLI = path.join(root, 'scripts/blocks.mjs');
const EXAMPLES = path.join(root, 'references/examples');
const EPSILON = 1e-9;

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 540, block: name, params, ...extra });
const oneScene = (elements, extra = {}, duration = 7) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const partNamed = (spec, name) => partsOf(spec).find((el) => el.id === `b/${name}`);
const at = (name, format, params, duration) => {
  const size = FORMATS[format].size;
  const { x, y } = BLOCKS[name].place(size, format, params.side);
  return expandBlocks(oneScene([block(name, params, { x, y })], { format }, duration));
};
const times = (el, prop) => (el.keyframes ?? []).filter((kf) => kf[prop] !== undefined).map((kf) => kf.t);
// When `el` has finished fading in (its first opacity-1 keyframe) and when it has faded out (its last opacity-0 one).
const landedAt = (el) => (el.keyframes ?? []).find((kf) => kf.opacity === 1).t;
const goneAt = (el) => (el.keyframes ?? []).findLast((kf) => kf.opacity === 0).t;

test('the five UI blocks are registered', () => {
  for (const name of ['browser-window', 'form-fields', 'tab-switch', 'button-state', 'side-panel']) assert.ok(BLOCKS[name], `${name} is a block`);
});

test('form-fields fills rows in order: each row\'s value keyframes start after the previous row\'s end', () => {
  for (const typing of [false, true]) {
    const fields = [{ label: 'Name', value: 'Ada Lovelace' }, { label: 'Email', value: 'ada@example.com' }, { label: 'Role', value: 'Engineer' }, { label: 'Team', value: 'Research' }];
    const spec = at('form-fields', '16:9', { fields, typing }, 12);
    const spans = fields.map((_, i) => {
      const t = times(partNamed(spec, `value-${i + 1}`), typing ? 'value' : 'opacity');
      return [Math.min(...t), Math.max(...t)];
    });
    spans.forEach(([start], i) => {
      if (i > 0) assert.ok(start >= spans[i - 1][1] - EPSILON, `typing ${typing}: row ${i + 1} starts at ${start}, before row ${i} ends at ${spans[i - 1][1]}`);
    });
  }
});

test('tab-switch and button-state: the old face is at opacity 0 by the time the new one reaches 1', () => {
  const tabs = at('tab-switch', '16:9', { tabs: [{ label: 'One', body: 'First body' }, { label: 'Two', body: 'Second body' }, { label: 'Three', body: 'Third body' }] }, 10);
  for (const k of [1, 2]) {
    const old = partNamed(tabs, `body-${k}`);
    const next = partNamed(tabs, `body-${k + 1}`);
    assert.ok(goneAt(old) <= landedAt(next) + EPSILON, `body-${k} is gone at ${goneAt(old)}, after body-${k + 1} lands at ${landedAt(next)}`);
  }
  const button = at('button-state', '16:9', { from: { label: 'Save' }, to: { label: 'Saved', tone: 'good' }, at: 2 }, 6);
  for (const [oldPart, newPart] of [['from-bg', 'to-bg'], ['from-label', 'to-label']]) {
    assert.ok(goneAt(partNamed(button, oldPart)) <= landedAt(partNamed(button, newPart)) + EPSILON, `${oldPart} must be gone before ${newPart} lands`);
  }
});

test('blocks.mjs show browser-window prints the content rectangle', () => {
  const r = spawnSync(process.execPath, [CLI, 'show', 'browser-window'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('content rectangle'));
  assert.ok(line, r.stdout);
  for (const format of Object.keys(FORMATS)) {
    const rect = contentRect(FORMATS[format].size, format);
    assert.ok(line.includes(`${format} x ${Math.round(rect.x)} y ${Math.round(rect.y)} width ${Math.round(rect.width)} height ${Math.round(rect.height)}`), `${format} in: ${line}`);
  }
});

test('contentRect is the area under the bars: inside the window, and the same one the expansion draws', () => {
  for (const format of Object.keys(FORMATS)) {
    const size = FORMATS[format].size;
    const rect = contentRect(size, format);
    const spec = at('browser-window', format, BLOCKS['browser-window'].example);
    const frame = partNamed(spec, 'frame');
    const { x, y } = BLOCKS['browser-window'].place(size, format);
    assert.ok(rect.width > 0 && rect.height > 0, format);
    assert.ok(Math.abs(rect.x - (x + frame.x)) < 1, `${format}: content centred across the window`);
    assert.ok(Math.abs(rect.y + rect.height / 2 - (y + frame.y + frame.height / 2)) < 1, `${format}: content ends at the window's bottom`);
    assert.ok(rect.width <= frame.width && rect.height < frame.height, `${format}: content is smaller than the window`);
  }
});

test('a 9:16 browser-window stays inside the safe area', () => {
  const size = FORMATS['9:16'].size;
  const m = safeMargin(size);
  const { x, y } = BLOCKS['browser-window'].place(size, '9:16');
  const params = { url: 'a'.repeat(32), title: 'b'.repeat(24), image: BLOCKS['browser-window'].example.image };
  for (const withImage of [true, false]) {
    const p = withImage ? params : { url: params.url, title: params.title };
    const parts = partsOf(expandBlocks(oneScene([block('browser-window', p, { x, y })], { format: '9:16' })));
    for (const el of parts) {
      const w = el.width ?? el.maxWidth;
      const h = el.height ?? el.fontSize;
      const leftEdge = el.anchor === 'left' ? x + el.x : x + el.x - w / 2; // an `anchor: left` text has its x at the left edge
      const [left, right, top, bottom] = [leftEdge, leftEdge + w, y + el.y - h / 2, y + el.y + h / 2];
      assert.ok(left >= m - 1 && right <= size[0] - m + 1 && top >= m - 1 && bottom <= size[1] - m + 1, `${el.id} spans x ${left}..${right}, y ${top}..${bottom}, outside the safe area ${m}`);
    }
  }
});

test('ui-form-fill.json has at most 5 block elements and check.mjs reports no problems', async (t) => {
  const file = path.join(EXAMPLES, 'ui-form-fill.json');
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(validateSpec(spec, { dir: EXAMPLES }).errors, []);
  const blocks = spec.scenes.flatMap((s) => s.elements).filter((el) => el.type === 'block');
  assert.ok(blocks.length >= 3 && blocks.length <= 5, `${blocks.length} block elements`);
  for (const name of ['browser-window', 'form-fields', 'side-panel']) assert.ok(blocks.some((el) => el.block === name), `uses ${name}`);
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(\d+ scenes?, \d+ moments\)\n$/);
  for (const line of r.stderr.split('\n').filter(Boolean)) assert.match(line, /^warning: scenes\[0\]: scene "[^"]+" shows nothing at 0\.00s/);
});

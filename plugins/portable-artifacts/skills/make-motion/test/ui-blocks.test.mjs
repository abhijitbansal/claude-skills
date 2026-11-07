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
import { FORMATS, safeMargin, safeInsets, VIRAL_SAFE_ZONE } from '../template/formats.mjs';
import { VIRAL_FORMAT } from '../template/viral.mjs';
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
// When `el` has finished fading in (its first opacity-1 keyframe) and when it has faded out (its last opacity-0 one).
const landedAt = (el) => (el.keyframes ?? []).find((kf) => kf.opacity === 1).t;
const goneAt = (el) => (el.keyframes ?? []).findLast((kf) => kf.opacity === 0).t;

test('the five UI blocks are registered', () => {
  for (const name of ['browser-window', 'form-fields', 'tab-switch', 'button-state', 'side-panel']) assert.ok(BLOCKS[name], `${name} is a block`);
});

// The value parts of row k: the typing text and/or the static copy (a faded-in value has only the static one).
const valueParts = (spec, k) => ['typing', 'value'].map((name) => partNamed(spec, `${name}-${k}`)).filter(Boolean);
const allTimes = (els) => els.flatMap((el) => (el.keyframes ?? []).map((kf) => kf.t));
// The opacity of `el` at scene second `t`: linear between its opacity keyframes, held outside them.
function opacityAt(el, t) {
  const kfs = (el.keyframes ?? []).filter((kf) => kf.opacity !== undefined);
  if (!kfs.length) return 1;
  if (t <= kfs[0].t) return kfs[0].opacity;
  const next = kfs.findIndex((kf) => kf.t >= t);
  if (next < 0) return kfs.at(-1).opacity;
  const [a, b] = [kfs[next - 1], kfs[next]];
  return a.opacity + ((b.opacity - a.opacity) * (t - a.t)) / (b.t - a.t);
}
// When `el` starts to fade in: the opacity-0 keyframe just before its first keyframe above 0.
const rampStartsAt = (el) => {
  const kfs = el.keyframes ?? [];
  return kfs[kfs.findIndex((kf) => kf.opacity > 0) - 1].t;
};
const SHORT_FIELDS = [{ label: 'Ok', value: 'Yes' }, { label: 'Go', value: 'No' }, { label: 'Hi', value: 'Ada' }, { label: 'Id', value: 'A1' }];

test('form-fields fills rows in order: every keyframe of a row\'s value parts is at or after every keyframe of the row before, even for 1 to 3 character values', () => {
  for (const typing of [false, true]) {
    const spec = at('form-fields', '16:9', { fields: SHORT_FIELDS, typing }, 12);
    const spans = SHORT_FIELDS.map((_, i) => {
      const t = allTimes(valueParts(spec, i + 1));
      assert.ok(t.length >= 2, `row ${i + 1} has keyframes`);
      return [Math.min(...t), Math.max(...t)];
    });
    spans.forEach(([start], i) => {
      if (i > 0) assert.ok(start >= spans[i - 1][1] - EPSILON, `typing ${typing}: row ${i + 1} starts at ${start}, before row ${i} ends at ${spans[i - 1][1]}`);
    });
  }
});

test('typed form-fields shows one caret: only the row being typed has its typing text visible, and the last row keeps it', () => {
  const spec = at('form-fields', '16:9', { fields: SHORT_FIELDS, typing: true }, 12);
  const typing = SHORT_FIELDS.map((_, i) => partNamed(spec, `typing-${i + 1}`));
  for (let t = 0; t <= 12; t += 0.01) {
    const shown = typing.filter((el) => opacityAt(el, t) > 0.05).length;
    assert.ok(shown <= 1, `${shown} typing texts (carets) are visible at ${t.toFixed(2)} s`);
  }
  assert.equal(opacityAt(typing.at(-1), 12), 1, 'the last typed row keeps its caret');
  for (const i of [0, 1, 2]) assert.equal(opacityAt(typing[i], 12), 0, `row ${i + 1}'s typing text is gone once the row is done`);
  for (const i of [0, 1, 2]) assert.equal(opacityAt(partNamed(spec, `value-${i + 1}`), 12), 1, `row ${i + 1}'s static value shows`);
});

test('tab-switch and button-state: the old face is gone before the new one starts to fade in, and so before it lands', () => {
  const tabs = at('tab-switch', '16:9', { tabs: [{ label: 'One', body: 'First body' }, { label: 'Two', body: 'Second body' }, { label: 'Three', body: 'Third body' }] }, 10);
  const pairs = [1, 2].map((k) => [`body-${k}`, `body-${k + 1}`, partNamed(tabs, `body-${k}`), partNamed(tabs, `body-${k + 1}`)]);
  const button = at('button-state', '16:9', { from: { label: 'Save' }, to: { label: 'Saved', tone: 'good' }, at: 2 }, 6);
  pairs.push(...[['from-bg', 'to-bg'], ['from-label', 'to-label']].map(([o, n]) => [o, n, partNamed(button, o), partNamed(button, n)]));
  for (const [oldName, newName, old, next] of pairs) {
    assert.ok(goneAt(old) <= landedAt(next) + EPSILON, `${oldName} is gone at ${goneAt(old)}, after ${newName} lands at ${landedAt(next)}`);
    assert.ok(goneAt(old) <= rampStartsAt(next) + EPSILON, `${oldName} is gone at ${goneAt(old)}, after ${newName} starts to fade in at ${rampStartsAt(next)}: the two are drawn over each other`);
  }
});

test('button-state, tab-switch and form-fields name the scene length they need, and a scene of that length passes', () => {
  const tabs = ['Profile', 'Billing', 'Team'].map((label) => ({ label, body: 'Some body text' }));
  const fields = [{ label: 'Name', value: 'Ada Lovelace' }, { label: 'Email', value: 'ada@example.com' }, { label: 'Role', value: 'Engineer' }];
  const cases = [
    ['button-state', { from: { label: 'Save' }, to: { label: 'Saved' }, at: 5 }, 'at'],
    ['tab-switch', { tabs, switchAfter: 4 }, 'switchAfter'],
    ['form-fields', { fields, typing: true }, 'fields'],
    ['form-fields', { fields }, 'fields'],
  ];
  const errsAt = (name, params, duration) => validateSpec(oneScene([block(name, params)], {}, duration), { dir: EXAMPLES }).errors.map((e) => `${e.path}: ${e.message}`);
  for (const [name, params, path] of cases) {
    const need = BLOCKS[name].minDuration(params);
    const found = errsAt(name, params, Math.round((need - 0.5) * 100) / 100);
    assert.equal(found.length, 1, `${name}: ${found.join(' | ')}`);
    assert.ok(found[0].startsWith(`scenes[0].elements[0].params.${path}: `), found[0]);
    const named = Number(found[0].match(/at least (\d+(?:\.\d+)?)s/)[1]);
    assert.ok(Math.abs(named - need) < 0.01, `${name}: names ${named}s, needs ${need}s`);
    assert.deepEqual(errsAt(name, params, named), [], `${name}: a ${named}s scene passes`);
  }
  // The scene the issue named: a change at 5 s in a 5 s scene is an error, not a change rescaled to about 3.7 s.
  assert.equal(errsAt('button-state', { from: { label: 'Save' }, to: { label: 'Saved' }, at: 5 }, 5).length, 1);
  const kept = at('button-state', '16:9', { from: { label: 'Save' }, to: { label: 'Saved' }, at: 5 }, 8);
  assert.equal(landedAt(partNamed(kept, 'to-bg')), 5.8, 'with room, `at` is scene seconds: the new face lands 0.8 s after it');
});

test('blocks.mjs show browser-window prints the content rectangle', () => {
  const r = spawnSync(process.execPath, [CLI, 'show', 'browser-window'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('content rectangle'));
  assert.ok(line, r.stdout);
  const shown = (key, rect) => `${key} x ${Math.round(rect.x)} y ${Math.round(rect.y)} width ${Math.round(rect.width)} height ${Math.round(rect.height)}`;
  for (const format of Object.keys(FORMATS)) {
    assert.ok(line.includes(shown(format, contentRect(FORMATS[format].size, format))), `${format} in: ${line}`);
  }
  const viralSize = FORMATS[VIRAL_FORMAT].size;
  const viral = contentRect(viralSize, VIRAL_FORMAT, safeInsets(viralSize, VIRAL_SAFE_ZONE));
  assert.ok(line.includes(shown(`viral ${VIRAL_FORMAT}`, viral)), `viral in: ${line}`);
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
  assert.equal(r.stderr, '', 'a shipped example carries no warning');
});

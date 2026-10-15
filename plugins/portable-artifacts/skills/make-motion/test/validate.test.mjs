import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, withDefaults, EASES, ANIMATABLE } from '../scripts/lib/spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exDir = path.join(root, 'references/examples');
const CLI = path.join(root, 'scripts/validate.mjs');
const good = () => ({
  scenes: [{ id: 's1', duration: 3, elements: [
    { id: 't1', type: 'text', text: 'hi', x: 10, y: 10, keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] },
  ] }],
});
const errs = (spec, dir = root) => validateSpec(spec, { dir }).errors.map((e) => `${e.path}: ${e.message}`);

test('every example is valid, <= 15 s', () => {
  const files = readdirSync(exDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const { spec, dir } = loadSpec(path.join(exDir, f));
    const r = validateSpec(spec, { dir });
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.ok);
    const total = withDefaults(spec).scenes.reduce((a, s) => a + s.duration, 0);
    assert.ok(total <= 15, `${f} is ${total}s`);
  }
});

test('minimal spec valid; defaults filled', () => {
  assert.deepEqual(errs(good()), []);
  const d = withDefaults(good());
  assert.deepEqual(d.size, [1920, 1080]);
  assert.equal(d.fps, 30);
  assert.equal(d.background, '#0b0d12');
  const el = d.scenes[0].elements[0];
  assert.equal(el.opacity, 1); assert.equal(el.scale, 1); assert.equal(el.rotate, 0);
  assert.equal(el.draw, 1); assert.equal(el.reveal, 1);
  assert.ok(!('opacity' in good().scenes[0].elements[0]), 'input not mutated');
});

test('counter value defaults to from', () => {
  const s = good();
  s.scenes[0].elements.push({ id: 'c', type: 'counter', from: 3, to: 9, x: 0, y: 0 });
  assert.equal(withDefaults(s).scenes[0].elements[1].value, 3);
});

test('unknown property gets did-you-mean', () => {
  const s = good(); s.fsp = 30;
  assert.deepEqual(errs(s), ['fsp: unknown property; did you mean "fps"?']);
});

test('bad fps and bad ease', () => {
  const s = good(); s.fps = 31; s.scenes[0].elements[0].keyframes[1].ease = 'outCubc';
  const e = errs(s);
  assert.ok(e.some((x) => x.startsWith('fps: must be one of 24, 25, 30, 60')), e.join('\n'));
  assert.ok(e.some((x) => x.includes('scenes[0].elements[0].keyframes[1].ease') && x.includes('did you mean "outCubic"?')), e.join('\n'));
});

test('duplicate ids are global across scenes and elements', () => {
  const s = good();
  s.scenes.push({ id: 's2', duration: 1, elements: [{ id: 't1', type: 'text', text: 'x', x: 0, y: 0 }] });
  assert.deepEqual(errs(s), ['scenes[1].elements[0].id: duplicate id "t1" (first used at scenes[0].elements[0].id)']);
  const s2 = good(); s2.scenes[0].id = 't1';
  assert.ok(errs(s2).some((x) => x.includes('duplicate id "t1"')));
});

test('keyframes must be sorted and within scene duration', () => {
  const s = good();
  s.scenes[0].elements[0].keyframes = [{ t: 2, opacity: 1 }, { t: 1, opacity: 0 }, { t: 5, opacity: 1 }];
  const e = errs(s);
  assert.ok(e.includes('scenes[0].elements[0].keyframes[1].t: 1 is before previous keyframe t=2; keyframes must be sorted by t'), e.join('\n'));
  assert.ok(e.includes('scenes[0].elements[0].keyframes[2].t: 5 exceeds scene duration 3'), e.join('\n'));
});

test('prop not animatable on type', () => {
  const s = good();
  s.scenes[0].elements[0].keyframes = [{ t: 0, opacity: 0 }, { t: 1, draw: 1 }];
  assert.deepEqual(errs(s), ['scenes[0].elements[0].keyframes[1].draw: not animatable on text; animatable: opacity, x, y, scale, rotate']);
  assert.deepEqual(ANIMATABLE.text, ['opacity', 'x', 'y', 'scale', 'rotate']);
});

test('field not valid for type / missing required for type', () => {
  const s = good();
  s.scenes[0].elements[0].strokeWidth = 3;
  const e = errs(s);
  assert.ok(e.some((x) => x.startsWith('scenes[0].elements[0].strokeWidth: not valid on text')), e.join('\n'));
  const s2 = good(); delete s2.scenes[0].elements[0].text;
  assert.ok(errs(s2).includes('scenes[0].elements[0].text: required for type text'));
});

test('total duration over 120 s rejected', () => {
  const s = { scenes: [60, 60, 1].map((d, i) => ({ id: `s${i}`, duration: d, elements: [] })) };
  assert.ok(errs(s).includes('scenes: total duration 121s exceeds the 120s limit'));
});

test('image src must exist relative to spec dir', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mx-'));
  const s = good();
  s.scenes[0].elements.push({ id: 'im', type: 'image', src: 'nope.png', x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(errs(s, dir), ['scenes[0].elements[1].src: file not found: nope.png']);
  writeFileSync(path.join(dir, 'nope.png'), 'x');
  assert.deepEqual(errs(s, dir), []);
});

test('chart vegaLite must compile and carry inline data.values', () => {
  const chart = (vl) => ({ scenes: [{ id: 's', duration: 2, elements: [
    { id: 'ch', type: 'chart', x: 0, y: 0, width: 400, height: 300, vegaLite: vl }] }] });
  const ok = { mark: 'bar', data: { values: [{ a: 1, b: 2 }] }, encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } } };
  assert.deepEqual(errs(chart(ok)), []);
  const noData = { mark: 'bar', encoding: ok.encoding };
  assert.deepEqual(errs(chart(noData)), ['scenes[0].elements[0].vegaLite.data.values: required — chart needs inline data.values']);
  const badMark = { ...ok, mark: 'barr' };
  assert.ok(errs(chart(badMark)).some((x) => x.startsWith('scenes[0].elements[0].vegaLite')));
});

test('CLI exit codes and json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mx-'));
  const p = path.join(dir, 'm.json');
  writeFileSync(p, JSON.stringify(good()));
  assert.equal(spawnSync('node', [CLI, p]).status, 0);
  writeFileSync(p, JSON.stringify({ ...good(), fsp: 1 }));
  const bad = spawnSync('node', [CLI, p, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const out = JSON.parse(bad.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].path, 'fsp');
  assert.equal(spawnSync('node', [CLI, path.join(dir, 'missing.json')]).status, 2);
  assert.equal(spawnSync('node', [CLI]).status, 2);
  writeFileSync(p, '{not json');
  assert.equal(spawnSync('node', [CLI, p]).status, 2);
});

test('EVAL_LOG line written', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mx-'));
  const p = path.join(dir, 'm.json'); const log = path.join(dir, 'log.jsonl');
  writeFileSync(p, JSON.stringify(good()));
  spawnSync('node', [CLI, p], { env: { ...process.env, EVAL_LOG: log } });
  const line = JSON.parse(readFileSyncLine(log));
  assert.equal(line.ok, true); assert.equal(line.errors, 0); assert.ok(line.ts);
});
import { readFileSync } from 'node:fs';
function readFileSyncLine(f) { return readFileSync(f, 'utf8').trim().split('\n')[0]; }

test('EASES is the documented set', () => {
  assert.ok(EASES.includes('linear') && EASES.includes('outCubic') && EASES.includes('inOutElastic'));
  assert.equal(EASES.length, 1 + 3 * 9);
});

// ---- review fix pass -------------------------------------------------------
const chartSpec = (vl) => ({ scenes: [{ id: 's', duration: 2, elements: [
  { id: 'ch', type: 'chart', x: 0, y: 0, width: 400, height: 300, vegaLite: vl }] }] });
const rows = [{ a: 'x', b: 1 }];
const enc = { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } };
const VL = 'scenes[0].elements[0].vegaLite';

test('chart: remote data.url nested in a layer is rejected', () => {
  const vl = { data: { values: rows }, layer: [{ mark: 'bar', encoding: enc }, { data: { url: 'http://evil.test/d.json' }, mark: 'line', encoding: enc }] };
  assert.deepEqual(errs(chartSpec(vl)), [`${VL}.layer[1].data.url: remote data is not allowed — inline data.values`]);
});

test('chart: lookup transform from.data.url is rejected', () => {
  const vl = { data: { values: rows }, mark: 'bar', encoding: enc,
    transform: [{ lookup: 'a', from: { data: { url: 'https://evil.test/x.csv' }, key: 'a', fields: ['b'] } }] };
  assert.deepEqual(errs(chartSpec(vl)), [`${VL}.transform[0].from.data.url: remote data is not allowed — inline data.values`]);
});

test('chart: image-mark url encoding is rejected', () => {
  const vl = { data: { values: rows }, mark: 'image', encoding: { x: enc.x, y: enc.y, url: { field: 'a', type: 'nominal' } } };
  assert.ok(errs(chartSpec(vl)).some((e) => e.startsWith(`${VL}.encoding.url:`) && e.includes('not allowed')), errs(chartSpec(vl)).join('\n'));
  const vl2 = { data: { values: rows }, mark: { type: 'image', url: 'http://evil.test/p.png' }, encoding: enc };
  assert.ok(errs(chartSpec(vl2)).some((e) => e.startsWith(`${VL}.mark.url:`)));
});

test('chart: top-level data.url is rejected', () => {
  assert.deepEqual(errs(chartSpec({ data: { url: 'http://evil.test/d.csv' }, mark: 'bar', encoding: enc })),
    [`${VL}.data.url: remote data is not allowed — inline data.values`]);
});

test('chart: datasets + named data is accepted as inline data', () => {
  const vl = { datasets: { d1: rows }, data: { name: 'd1' }, mark: 'bar', encoding: enc };
  assert.deepEqual(errs(chartSpec(vl)), []);
  const missing = { datasets: { d1: rows }, data: { name: 'nope' }, mark: 'bar', encoding: enc };
  assert.ok(errs(chartSpec(missing)).some((e) => e.startsWith(`${VL}.data.name:`)));
});

test('colour fields reject url() and non-colours; accept real colours', () => {
  const s = good();
  s.background = 'url(http://evil.test/a.png)';
  s.scenes[0].background = 'url(x)';
  s.scenes[0].elements[0].color = 'red; background:url(x)';
  s.scenes[0].elements.push({ id: 'sh', type: 'shape', shape: 'rect', x: 0, y: 0, fill: 'url(#a)', stroke: 'var(--x)' });
  const e = errs(s);
  for (const p of ['background', 'scenes[0].background', 'scenes[0].elements[0].color', 'scenes[0].elements[1].fill', 'scenes[0].elements[1].stroke']) {
    assert.ok(e.some((x) => x.startsWith(`${p}: must be a CSS colour`)), `${p}\n${e.join('\n')}`);
  }
  const ok = good();
  ok.background = '#0b0d12';
  ok.scenes[0].background = 'rgba(0, 0, 0, 0.5)';
  ok.scenes[0].elements[0].color = 'hsl(200 50% 50%)';
  ok.scenes[0].elements.push({ id: 'sh', type: 'shape', shape: 'rect', x: 0, y: 0, fill: 'tomato', stroke: '#fff8' });
  assert.deepEqual(errs(ok), []);
});

test('image src: symlink escaping the spec dir, directory and dotfile are rejected', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'img-'));
  const dir = path.join(parent, 'proj');
  mkdirSync(path.join(dir, 'sub'), { recursive: true });
  writeFileSync(path.join(parent, 'secret.png'), 'x');
  writeFileSync(path.join(dir, '.hidden.png'), 'x');
  writeFileSync(path.join(dir, 'ok.png'), 'x');
  symlinkSync(path.join(parent, 'secret.png'), path.join(dir, 'link.png'));
  const mk = (src) => ({ scenes: [{ id: 's', duration: 1, elements: [{ id: 'im', type: 'image', src, x: 0, y: 0, width: 1, height: 1 }] }] });
  const at = 'scenes[0].elements[0].src';
  assert.deepEqual(errs(mk('ok.png'), dir), []);
  assert.deepEqual(errs(mk('link.png'), dir), [`${at}: must stay inside the spec folder`]);
  assert.deepEqual(errs(mk('../secret.png'), dir), [`${at}: must stay inside the spec folder`]);
  assert.deepEqual(errs(mk('sub'), dir), [`${at}: not a regular file: sub`]);
  assert.deepEqual(errs(mk('.hidden.png'), dir), [`${at}: hidden files are not allowed`]);
});

test('fontWeight is one of 400, 500, 600, 700, 800', () => {
  const s = good(); s.scenes[0].elements[0].fontWeight = 450;
  assert.ok(errs(s).some((e) => e.startsWith('scenes[0].elements[0].fontWeight: must be one of 400, 500, 600, 700, 800')));
  s.scenes[0].elements[0].fontWeight = 500;
  assert.deepEqual(errs(s), []);
});

test('theme: a shared theme name is valid, anything else gets a did-you-mean or the list', () => {
  for (const name of ['paper', 'ink', 'blueprint', 'editorial']) assert.deepEqual(errs({ ...good(), theme: name }), [], name);
  assert.deepEqual(errs({ ...good(), theme: 'inx' }), ['theme: unknown theme "inx"; did you mean "ink"?']);
  assert.deepEqual(errs({ ...good(), theme: 'zzzzzzzz' }), ['theme: unknown theme "zzzzzzzz"; available: blueprint, editorial, ink, paper']);
  assert.deepEqual(errs({ ...good(), theme: '' }), ['theme: must NOT have fewer than 1 characters']);
  assert.deepEqual(errs({ ...good(), theme: 3 }), ['theme: must be string']);
});

test('theme does not change the defaults withDefaults fills (the page applies them)', () => {
  assert.deepEqual(withDefaults({ ...good(), theme: 'ink' }).background, '#0b0d12');
});

test('generatedBy: model/effort/agent strings pass; hostile, long or unknown values fail', () => {
  assert.deepEqual(errs({ ...good(), generatedBy: { model: 'Claude Opus 5', effort: 'high', agent: 'Claude Code' } }), []);
  assert.notDeepEqual(errs({ ...good(), generatedBy: { model: '<x>' } }), []);
  assert.notDeepEqual(errs({ ...good(), generatedBy: { model: 'a'.repeat(61) } }), []);
  assert.notDeepEqual(errs({ ...good(), generatedBy: { modle: 'x' } }), []);
  assert.notDeepEqual(errs({ ...good(), generatedBy: 'x' }), []);
});

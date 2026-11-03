import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, symlinkSync, lstatSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { substituteVars, findVarRefs, varValues } from '../template/vars.mjs';
import { expandSpec, withDefaults } from '../template/defaults.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { safeSegment, outTemplate, outputFor, readRows, columnWarnings, collisionKey, batchTempPath, tempClashes, recheckRows, checkManifestSlot, writeManifest } from '../scripts/lib/batch.mjs';
import { freshFile } from '../scripts/lib/paths.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { requireRender, assertRendersIdentically, makeTestVideo } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const EXAMPLE = path.join(root, 'references/examples/batch-welcome.json');
const EXAMPLE_ROWS = path.join(root, 'references/examples/data/batch-welcome.rows.json');
const PINNED_BUILD_DATE = '1793318400';

const text = (id, value, extra = {}) => ({ id, type: 'text', text: value, x: 80, y: 45, fontSize: 12, ...extra });
const scene = (elements, extra = {}) => ({ id: 's', duration: 1, elements, ...extra });
const motion = (elements, vars, extra = {}) => ({ size: [160, 90], ...(vars && { vars }), scenes: [scene(elements)], ...extra });

function project(spec, rows, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vars-'));
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec));
  if (rows !== undefined) writeFileSync(path.join(dir, 'rows.json'), typeof rows === 'string' ? rows : JSON.stringify(rows));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}
const render = (dir, args, env = {}) => spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), ...args], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: PINNED_BUILD_DATE, ...env } });
const batch = (dir, out = path.join(dir, 'out', '{index}.mp4'), extra = []) => render(dir, ['--batch', path.join(dir, 'rows.json'), '--out', out, ...extra]);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// --- substitution -------------------------------------------------------------------------------------------------

test('vars: {{name}} is replaced in text, a counter prefix and a chart title; numbers become their String; vars is removed', () => {
  const vars = { name: { type: 'string', default: 'Ada' }, currency: { type: 'string', default: '€' }, seats: { type: 'number', default: 12 } };
  const chart = { id: 'c', type: 'chart', x: 80, y: 45, width: 60, height: 40, vegaLite: { title: '{{name}} sales', data: { values: [{ a: 1 }] }, mark: 'bar', encoding: { y: { field: 'a', type: 'quantitative' } } } };
  const spec = motion([text('t', 'Hi {{name}}, {{seats}} seats'), { id: 'n', type: 'counter', to: 5, prefix: '{{currency}}', x: 1, y: 1 }, chart], vars);
  const out = substituteVars(spec, { name: 'Grace' });
  assert.equal(out.scenes[0].elements[0].text, 'Hi Grace, 12 seats');
  assert.equal(out.scenes[0].elements[1].prefix, '€');
  assert.equal(out.scenes[0].elements[2].vegaLite.title, 'Grace sales');
  assert.equal(out.vars, undefined);
  assert.equal(spec.scenes[0].elements[0].text, 'Hi {{name}}, {{seats}} seats', 'pure: the input is unchanged');
  assert.equal(validateSpec(spec, { values: { name: 'Grace' } }).ok, true);
});

test('vars: a spec without vars is the same object, and its {{…}} text, code and block params are never errors', () => {
  const spec = motion([text('t', 'Hello {{name}} {{{{x}}'), { id: 'c', type: 'code', lang: 'html', code: '<p>{{ msg }} {{msg}}</p>', x: 80, y: 45, width: 100 }]);
  assert.equal(substituteVars(spec, { name: 'x' }), spec);
  assert.deepEqual(findVarRefs(spec), []);
  assert.deepEqual(expandSpec(spec).scenes[0].elements[0].text, 'Hello {{name}} {{{{x}}');
  assert.deepEqual(validateSpec(spec).errors, []);
});

test('vars: {{{{ writes a literal {{ in a spec that declares vars; {{ name }} with spaces and {{Name}} stay as written', () => {
  const spec = motion([text('t', '{{{{name}} is {{name}}'), { id: 'c', type: 'code', lang: 'html', code: '<p>{{{{msg}}</p> {{ msg }} {{Msg}}', x: 80, y: 45, width: 100 }], { name: { type: 'string', default: 'Ada' } });
  const out = substituteVars(spec);
  assert.equal(out.scenes[0].elements[0].text, '{{name}} is Ada');
  assert.equal(out.scenes[0].elements[1].code, '<p>{{msg}}</p> {{ msg }} {{Msg}}');
  assert.deepEqual(validateSpec(spec).errors, []);
  // A second pass (the page's withDefaults on the served, substituted spec) changes nothing.
  assert.deepEqual(withDefaults(out).scenes[0].elements[0].text, '{{name}} is Ada');
});

test('vars: a value is inserted once and never searched again', () => {
  const spec = motion([text('t', '{{a}}')], { a: { type: 'string' }, b: { type: 'string', default: 'B' } });
  assert.equal(substituteVars(spec, { a: '{{b}} and {{{{' }).scenes[0].elements[0].text, '{{b}} and {{{{');
});

test('vars: findVarRefs lists every reference with its path; vars itself is not searched', () => {
  const spec = motion([text('t', '{{a}} {{b}}'), { id: 'n', type: 'counter', to: 1, suffix: '{{a}}', x: 1, y: 1 }], { a: { type: 'string', default: '{{b}}' } });
  assert.deepEqual(findVarRefs(spec), [
    { path: 'scenes[0].elements[0].text', name: 'a' },
    { path: 'scenes[0].elements[0].text', name: 'b' },
    { path: 'scenes[0].elements[1].suffix', name: 'a' },
  ]);
});

test('vars: {{headline}} in a block param works in viral mode, and `mode` itself may be a var', () => {
  const spec = {
    mode: '{{mode}}',
    vars: { mode: { type: 'string', default: 'viral' }, headline: { type: 'string', default: 'Ship it' } },
    scenes: [{ id: 's', duration: 3, elements: [{ id: 'card', type: 'block', block: 'title-card', x: 540, y: 960, params: { title: '{{headline}} today' } }] }],
  };
  assert.deepEqual(validateSpec(spec).errors, []);
  const expanded = expandSpec(spec);
  assert.equal(expanded.format, '9:16', 'viral mode applied after substitution');
  const title = expanded.scenes[0].elements[0].children.find((el) => el.id === 'card/title');
  assert.equal(title.text, 'Ship it today');
});

// --- validation ---------------------------------------------------------------------------------------------------

test('vars: a reference to an undeclared name names it and the declared ones', () => {
  const spec = motion([text('t', 'Hi {{citty}}')], { city: { type: 'string', default: 'Paris' }, name: { type: 'string', default: 'Ada' } });
  const { ok, errors } = validateSpec(spec);
  assert.equal(ok, false);
  assert.deepEqual(errors, [{ path: 'scenes[0].elements[0].text', message: 'unknown variable "citty"; declared: city, name' }]);
});

test('vars: a declared variable without a default and no row value is an error at vars.<name>', () => {
  const spec = motion([text('t', '{{city}}')], { city: { type: 'string' } });
  assert.deepEqual(validateSpec(spec).errors, [{ path: 'vars.city', message: 'no default and the row gives no value' }]);
  assert.equal(validateSpec(spec, { values: { city: 'Oslo' } }).ok, true);
});

test('vars: the vars block is checked: name pattern, count, type, a default of the wrong type', () => {
  const bad = (vars) => validateSpec(motion([text('t', 'x')], vars)).errors;
  assert.match(bad({ City: { type: 'string' } })[0].path, /^vars\.City$/);
  assert.match(bad({ a: { type: 'bool' } })[0].message, /must be one of "string", "number"/);
  assert.deepEqual(bad({ n: { type: 'number', default: '12' } }), [{ path: 'vars.n.default', message: 'must be a number, as its type says (got a string)' }]);
  const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`v${i}`, { type: 'string', default: '' }]));
  assert.match(bad(many)[0].message, /declares 31 vars; at most 30/);
  assert.match(bad([])[0].message, /must be an object/);
});

test('vars: a row value must match its type, with no coercion; an undeclared row key is ignored by the validator', () => {
  const spec = motion([text('t', '{{city}} {{seats}}')], { city: { type: 'string', default: 'Paris' }, seats: { type: 'number', default: 1 } });
  assert.deepEqual(validateSpec(spec, { values: { seats: '12abc' } }).errors, [{ path: 'vars.seats', message: 'the row gives "12abc" (a string); seats is a number' }]);
  assert.deepEqual(validateSpec(spec, { values: { seats: '12' } }).errors.map((e) => e.path), ['vars.seats']);
  assert.deepEqual(validateSpec(spec, { values: { city: 7 } }).errors, [{ path: 'vars.city', message: 'the row gives 7 (a number); city is a string' }]);
  assert.deepEqual(validateSpec(spec, { values: { citty: 'Rome' } }).errors, [], 'an extra column is a batch warning (columnWarnings), not an error');
  assert.deepEqual(columnWarnings(spec, { citty: 'Rome', city: 'Oslo' }), ['unknown column "citty" ignored; declared: city, seats (did you mean "city"?)']);
  assert.deepEqual(columnWarnings(spec, { region: 'EU' }), ['unknown column "region" ignored; declared: city, seats']);
  assert.deepEqual(columnWarnings(motion([text('t', 'x')]), { a: 1 }), ['unknown column "a" ignored; declared: none']);
});

test('vars: a value that is exactly {{n}} of a number var becomes the number; partial strings and string vars stay strings', () => {
  const vars = { n: { type: 'number', default: 7 }, name: { type: 'string', default: 'Ada' } };
  const counter = (to, extra = {}) => ({ id: 'c', type: 'counter', to, x: 80, y: 45, fontSize: 12, ...extra });
  const spec = motion([counter('{{n}}', { prefix: 'Q{{n}} ' }), text('t', '{{name}}')], vars);
  const out = substituteVars(spec, { n: 12 });
  assert.equal(out.scenes[0].elements[0].to, 12);
  assert.equal(out.scenes[0].elements[0].prefix, 'Q12 ');
  assert.equal(out.scenes[0].elements[1].text, 'Ada');
  assert.deepEqual(validateSpec(spec, { values: { n: 12 } }).errors, []);
  assert.equal(substituteVars(spec).scenes[0].elements[0].to, 7, 'the default too');
  assert.deepEqual(validateSpec(motion([counter('{{name}}')], vars)).errors, [{ path: 'scenes[0].elements[0].to', message: 'must be number' }]);
  assert.deepEqual(validateSpec(motion([text('t', '{{n}}')], vars)).errors, [{ path: 'scenes[0].elements[0].text', message: 'must be string' }], 'a number var alone in a text is a number');
  assert.equal(substituteVars(motion([text('t', '{{{{n}}')], vars)).scenes[0].elements[0].text, '{{n}}', 'an escaped whole value stays a string');
});

test('vars: __proto__ and constructor in a row are data, never prototype writes; a var may be called constructor', () => {
  const spec = motion([text('t', '{{constructor}}')], { constructor: { type: 'string', default: 'x' } });
  const row = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "Bob"}');
  assert.deepEqual(validateSpec(spec, { values: row }).errors, []);
  assert.deepEqual(columnWarnings(spec, row), ['unknown column "__proto__" ignored; declared: constructor']);
  assert.equal(substituteVars(spec, row).scenes[0].elements[0].text, 'Bob');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  const values = varValues(spec, row);
  assert.equal(Object.getPrototypeOf(values), null);
  assert.deepEqual(Object.keys(values), ['constructor']);
  // An undeclared `constructor` or `toString` is never read from Object.prototype: it is an ignored column, or an unknown variable.
  const plain = motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } });
  assert.equal(substituteVars(plain, { constructor: 'x' }).scenes[0].elements[0].text, 'A');
  assert.match(columnWarnings(plain, { constructor: 'x' })[0], /unknown column "constructor" ignored/);
  assert.match(validateSpec(motion([text('t', '{{toString}}')], {})).errors[0].message, /unknown variable "toString"; declared: none/);
});

test('vars: a __proto__ key inside the spec stays a key in the substituted copy', () => {
  const spec = JSON.parse('{"vars": {"a": {"type": "string", "default": "A"}}, "scenes": [{"id": "s", "duration": 1, "elements": []}], "x": {"__proto__": {"polluted": "{{a}}"}}}');
  const out = substituteVars(spec);
  assert.ok(Object.hasOwn(out.x, '__proto__'));
  assert.equal(out.x.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out.x), Object.prototype);
});

// --- batch: refused before anything renders -----------------------------------------------------------------------

const lines = (r) => (r.stdout + r.stderr).split('\n');

test('batch: a value that turns a src or a colour into an escape fails at the normal validator path, with the row index', () => {
  const vars = { pic: { type: 'string', default: 'pic.png' }, tint: { type: 'string', default: 'red' } };
  const dir = project(motion([text('t', 'x', { color: '{{tint}}' }), { id: 'im', type: 'image', src: '{{pic}}', x: 1, y: 1, width: 4, height: 4 }], vars),
    [{}, { pic: '../x.png' }, { tint: 'url(x)' }], { 'pic.png': 'png' });
  const r = batch(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(lines(r).includes('row 1: scenes[0].elements[1].src: must stay inside the spec folder'), r.stdout);
  assert.ok(lines(r).some((l) => l.startsWith('row 2: scenes[0].elements[0].color: must be a CSS colour')), r.stdout);
  assert.ok(!lines(r).some((l) => l.startsWith('row 0:')), 'row 0 is valid');
  assert.deepEqual(readdirSync(dir).sort(), ['m.json', 'pic.png', 'rows.json'], 'nothing rendered, not even row 0');
});

test('batch: a value that turns an audio, captions or block param path into an escape is refused with the row index', () => {
  const vars = { track: { type: 'string', default: 'a.wav' }, subs: { type: 'string', default: 'c.srt' }, logo: { type: 'string', default: 'logo.png' }, sound: { type: 'string', default: 'pop' } };
  const spec = {
    size: [320, 180], vars,
    audio: [{ src: '{{track}}' }], captions: [{ src: '{{subs}}' }], cues: [{ cue: '{{sound}}', at: 0 }],
    scenes: [{ id: 's', duration: 3, elements: [{ id: 'end', type: 'block', block: 'logo-outro', x: 160, y: 90, params: { src: '{{logo}}' } }] }],
  };
  const dir = project(spec, [{ track: '../a.wav' }, { subs: '/etc/c.srt' }, { logo: '../logo.png' }, { sound: 'boom' }], { 'a.wav': 'x', 'c.srt': '1\n00:00:00,000 --> 00:00:01,000\nhi\n', 'logo.png': 'x' });
  const r = batch(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = lines(r);
  assert.ok(out.includes('row 0: audio[0].src: must stay inside the spec folder'), r.stdout);
  assert.ok(out.includes('row 1: captions[0].src: must be a path relative to the spec file'), r.stdout);
  assert.ok(out.includes('row 2: scenes[0].elements[0].params.src: must stay inside the spec folder'), r.stdout);
  assert.ok(out.some((l) => l.startsWith('row 3: cues[0].cue: must be one of')), r.stdout);
});

test('batch: a row whose longer value overruns typing gets the cut-off error with its row index (and at --fps)', () => {
  // 26 characters take 0.91 s: they fit a 1 s scene at 30 fps (last frame at 0.967 s); 28 (0.98 s) do not. At 10 fps
  // (last frame at 0.9 s) 26 do not fit either.
  const spec = { size: [160, 90], fps: 30, vars: { name: { type: 'string', default: 'x' } }, scenes: [scene([text('t', '{{name}}', { typing: true })])] };
  const dir = project(spec, [{ name: 'y'.repeat(26) }, { name: 'z'.repeat(28) }]);
  const r = batch(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(lines(r).some((l) => /^row 1: scenes\[0\]\.elements\[0\]\.text: typing 28 characters takes 0\.98s but scene "s" lasts 1s/.test(l)), r.stdout);
  assert.ok(!lines(r).some((l) => l.startsWith('row 0:')));
  const slow = batch(dir, path.join(dir, 'out', '{index}.mp4'), ['--fps', '10']);
  assert.ok(lines(slow).some((l) => /^row 0: scenes\[0\]\.elements\[0\]\.text: typing 26 characters .*at 10 fps/.test(l)), slow.stdout);
});

test('batch: a typo\'d column warns with did-you-mean; wrong types and missing values are errors per row; nothing renders', () => {
  const spec = motion([text('t', '{{city}} {{seats}}')], { city: { type: 'string' }, seats: { type: 'number', default: 1 } });
  const dir = project(spec, [{ citty: 'Rome' }, { city: 'Oslo', seats: '12abc' }, {}]);
  const r = batch(dir);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.split('\n').includes('row 0: unknown column "citty" ignored; declared: city, seats (did you mean "city"?)'), r.stderr);
  const out = r.stdout.split('\n');
  assert.ok(out.includes('row 0: vars.city: no default and the row gives no value'), r.stdout);
  assert.ok(out.includes('row 1: vars.seats: the row gives "12abc" (a string); seats is a number'), r.stdout);
  assert.ok(out.includes('row 2: vars.city: no default and the row gives no value'), r.stdout);
  assert.ok(out.includes(`${path.join(dir, 'rows.json')}: 3 errors; nothing rendered`), r.stdout);
});

test('batch: an extra column renders with a warning; the manifest keeps only the declared vars', async (t) => {
  if (!(await requireRender(t))) return;
  const dir = project(motion([text('t', 'Hi {{name}}')], { name: { type: 'string', default: 'A' } }), [{ name: 'Ada', city: 'Oslo' }]);
  const r = batch(dir, path.join(dir, 'out', '{name}.mp4'), ['--fps', '10']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stderr.split('\n').includes('row 0: unknown column "city" ignored; declared: name'), r.stderr);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'out', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rows.map((row) => [row.status, row.vars]), [['ok', { name: 'Ada' }]]);
});

test('batch: --batch needs an --out template, never with --contact-sheet; an unknown flag lists the accepted ones (exit 2)', () => {
  const dir = project(motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } }), [{}]);
  const rows = path.join(dir, 'rows.json');
  const needs = '--batch needs an --out template with {index} or a {var}, so outputs do not collide';
  for (const args of [['--batch', rows], ['--batch', rows, '--out', path.join(dir, 'o.mp4')]]) {
    const r = render(dir, args);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stderr.trim(), needs);
  }
  const contact = render(dir, ['--batch', rows, '--out', path.join(dir, '{index}'), '--contact-sheet']);
  assert.equal(contact.status, 2);
  assert.match(contact.stderr, /--batch does not apply to --contact-sheet/);
  const folder = render(dir, ['--batch', rows, '--out', path.join(dir, '{name}', 'v.mp4')]);
  assert.equal(folder.status, 2);
  assert.match(folder.stderr, /put the \{…\} placeholders in the file name, not the folder/);
  const unknown = render(dir, ['--batch', rows, '--out', path.join(dir, '{nam}.mp4')]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--out: unknown placeholder \{nam\}; did you mean \{name\}\? \(accepted: \{index\}, \{name\}\)/);
  const flag = render(dir, ['--batchh', rows]);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /unknown option --batchh; did you mean --batch\? \(accepted: --out, .*--batch, --contact-sheet\)/);
  assert.deepEqual(readdirSync(dir).sort(), ['m.json', 'rows.json']);
});

test('batch: a rows file that is not a non-empty array of plain objects is a usage error (exit 2)', () => {
  const spec = motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } });
  for (const [rows, message] of [['{"name": "A"}', /must be a JSON array of rows/], ['[]', /has no rows/], ['[{}, ["A"]]', /row 1 must be an object of var values .*got an array/], ['[null]', /row 0 must be an object .*got null/], ['[{', /is not valid JSON/]]) {
    const dir = project(spec, rows);
    const r = batch(dir);
    assert.equal(r.status, 2, `${rows}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message);
  }
  assert.throws(() => readRows(path.join(tmpdir(), 'no-such-rows.json')), /cannot read/);
});

test('batch: row values in --out never leave its folder; one with no usable name, or two rows with one file, are refused', () => {
  const tpl = outTemplate(path.join(tmpdir(), 'renders', '{name}-{index}.mp4'), ['name']);
  const at = (name) => outputFor(tpl, 3, Object.assign(Object.create(null), { name }));
  for (const [value, file] of [['../../etc/x', 'etc-x-3.mp4'], ['/etc/passwd', 'etc-passwd-3.mp4'], ['C:\\x', 'C-x-3.mp4'], ['a\0b', 'a-b-3.mp4'], ['.env', 'env-3.mp4'], ['Zürich', 'Zürich-3.mp4']]) {
    assert.equal(at(value).out, path.join(tpl.dir, file), value);
  }
  for (const value of ['', '/', '\\', '..', '.', '-']) assert.match(at(value).error, /leaves no file name/, JSON.stringify(value));
  assert.equal(safeSegment('x'.repeat(200)).length, 80);
  // outTemplate takes only .mp4, so the manifest clash is checked on a hand-made template; it ignores case.
  assert.match(outputFor({ dir: tmpdir(), base: '{name}.json' }, 0, Object.assign(Object.create(null), { name: 'MANIFEST' })).error, /manifest's name/);

  const spec = motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } });
  const dir = project(spec, [{ name: 'Ada' }, { name: '/' }, { name: 'ada' }]);
  const r = batch(dir, path.join(dir, 'out', '{name}.mp4'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(lines(r).includes('row 1: --out: {name} is "/", which leaves no file name; give name letters or digits, or use {index}'), r.stdout);
  assert.ok(lines(r).includes("row 2: --out: ada.mp4 is also row 0's output; add {index} to --out, or give the rows different values"), r.stdout);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing rendered');
});

// --- server -------------------------------------------------------------------------------------------------------

function get(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('server: a {{logo}} src is served at its default, and a batch row\'s spec serves the row\'s file instead', async () => {
  const spec = motion([{ id: 'im', type: 'image', src: '{{logo}}', x: 1, y: 1, width: 4, height: 4 }], { logo: { type: 'string', default: 'logo.png' } });
  const dir = project(spec, undefined, { 'logo.png': 'default logo', 'brand.png': 'row logo' });
  const file = await startServer({ specPath: path.join(dir, 'm.json') });
  try {
    assert.deepEqual(await get(file.url, '/assets/logo.png'), { status: 200, body: 'default logo' });
    assert.equal((await get(file.url, '/assets/brand.png')).status, 404);
  } finally { await file.close(); }
  const row = await startServer({ specPath: path.join(dir, 'm.json'), spec: substituteVars(spec, { logo: 'brand.png' }) });
  try {
    assert.deepEqual(await get(row.url, '/assets/brand.png'), { status: 200, body: 'row logo' });
    assert.equal((await get(row.url, '/assets/logo.png')).status, 404);
    const served = JSON.parse((await get(row.url, '/spec.json')).body);
    assert.equal(served.vars, undefined);
    assert.equal(served.scenes[0].elements[0].src, 'brand.png');
  } finally { await row.close(); }
});

// --- batch renders ------------------------------------------------------------------------------------------------

test('batch: the example\'s 2 rows at 160x90 write two MP4s and a manifest whose sha256 values match the files', async (t) => {
  if (!(await requireRender(t))) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'vars-batch-'));
  const r = spawnSync(process.execPath, [RENDER, EXAMPLE, '--batch', EXAMPLE_ROWS, '--out', path.join(dir, 'welcome-{index}-{name}.mp4'), '--size', '160x90', '--fps', '10', '--workers', '2'], {
    encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: PINNED_BUILD_DATE },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const rows = JSON.parse(readFileSync(EXAMPLE_ROWS, 'utf8'));
  assert.equal(manifest.rows.length, 2);
  manifest.rows.forEach((row, i) => {
    assert.equal(row.index, i);
    assert.equal(row.status, 'ok');
    assert.equal(row.duration, 3.5);
    assert.equal(row.error, undefined);
    assert.equal(row.vars.name, rows[i].name);
    assert.equal(row.sha256, sha(path.join(dir, row.out)));
  });
  assert.equal(manifest.rows[1].vars.team, 'Platform', 'a value the row leaves out is the default');
  assert.notEqual(manifest.rows[0].sha256, manifest.rows[1].sha256);
  assert.deepEqual(readdirSync(dir).sort(), ['manifest.json', ...manifest.rows.map((row) => row.out)].sort());
});

test('batch: the example renders byte-identically twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

test('batch: a row that fails mid-render is marked failed with its error and its partial removed; the others render; exit 1', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const dir = project(motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } }), [{ name: 'boom' }, { name: 'Ada' }]);
  // An ffmpeg that fails part way through the encode of any output named *boom*, and is the real one otherwise.
  const fake = path.join(dir, 'ffmpeg');
  writeFileSync(fake, `#!/bin/sh\nfor last; do :; done\ncase "$last" in *boom*) head -c 100 > /dev/null; printf partial > "$last"; echo "encoder exploded" >&2; exit 1;; esac\nexec '${tools.ffmpeg}' "$@"\n`);
  chmodSync(fake, 0o755);
  const out = path.join(dir, 'out');
  mkdirSync(out);
  // Older renders under both names: a failed row keeps its older file untouched (the manifest says `failed`), and a row
  // that succeeds replaces its older file only through the temp-to-final rename.
  writeFileSync(path.join(out, 'boom.mp4'), 'an older batch');
  writeFileSync(path.join(out, 'Ada.mp4'), 'an older batch');
  const r = render(dir, ['--batch', path.join(dir, 'rows.json'), '--out', path.join(out, '{name}.mp4'), '--fps', '10'], { FFMPEG_PATH: fake });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rows[0].status, 'failed');
  assert.match(manifest.rows[0].error, /ffmpeg failed/);
  assert.equal(manifest.rows[0].sha256, null);
  assert.equal(readFileSync(path.join(out, 'boom.mp4'), 'utf8'), 'an older batch', 'the failed row left the older file as it was');
  assert.equal(manifest.rows[1].status, 'ok');
  assert.notEqual(readFileSync(path.join(out, 'Ada.mp4'), 'utf8'), 'an older batch', 'the row that succeeded replaced it');
  assert.equal(manifest.rows[1].sha256, sha(path.join(out, 'Ada.mp4')));
  assert.deepEqual(readdirSync(out).sort(), ['Ada.mp4', 'boom.mp4', 'manifest.json'], 'no temp file, no temp manifest');
  assert.match(r.stderr, /row 0: failed: ffmpeg failed/);
});

test('batch: 2 rows with a per-row cue, --quality draft and --workers 2 render, each sha256 in the manifest matching its file', async (t) => {
  if (!(await requireRender(t))) return;
  const spec = {
    size: [160, 90],
    vars: { name: { type: 'string', default: 'A' }, sound: { type: 'string', default: 'pop' } },
    cues: [{ cue: '{{sound}}', at: 0.2 }],
    scenes: [scene([text('t', 'Hi {{name}}')])],
  };
  const dir = project(spec, [{ name: 'Ada', sound: 'pop' }, { name: 'Bo', sound: 'ding' }]);
  const r = batch(dir, path.join(dir, 'out', 'clip-{index}.mp4'), ['--fps', '10', '--quality', 'draft', '--workers', '2']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr.split('\n').filter((l) => l.startsWith('quality: draft (80x44)')).length, 2, r.stderr);
  assert.equal((r.stdout.match(/^audio: /gm) ?? []).length, 2, 'each row has its cue in the mix');
  const manifest = JSON.parse(readFileSync(path.join(dir, 'out', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rows.map((row) => [row.index, row.status, row.out]), [[0, 'ok', 'clip-0.mp4'], [1, 'ok', 'clip-1.mp4']]);
  for (const row of manifest.rows) assert.equal(row.sha256, sha(path.join(dir, 'out', row.out)));
  assert.notEqual(manifest.rows[0].sha256, manifest.rows[1].sha256);
});

// --- fix round 1 ----------------------------------------------------------------------------------------------------

test('batch (H1): a row value ending in .partial never lets a later row\'s temp file overwrite an earlier row\'s output', async (t) => {
  if (!(await requireRender(t))) return;
  const dir = project(motion([text('t', 'Hi {{name}}')], { name: { type: 'string', default: 'A' } }), [{ name: 'x.partial' }, { name: 'x' }]);
  const out = path.join(dir, 'o');
  const r = batch(dir, path.join(out, '{name}.mp4'), ['--fps', '10']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(out).sort(), ['manifest.json', 'x.mp4', 'x.partial.mp4']);
  const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  for (const row of manifest.rows) {
    assert.equal(row.status, 'ok');
    assert.equal(row.sha256, sha(path.join(out, row.out)), row.out);
  }
  assert.notEqual(manifest.rows[0].sha256, manifest.rows[1].sha256);
});

test('batch (H1): temp files are hidden and per row, one dot ahead of any output of the template; a clash is still refused', () => {
  const at = (name) => path.join(tmpdir(), name);
  assert.equal(batchTempPath(at('x.mp4'), 3), at('.x.3.partial.mp4'));
  assert.equal(batchTempPath(at('.x.mp4'), 0), at('..x.0.partial.mp4'), 'a template that starts with a dot gets a temp with one more');
  // Values never start with a dot (safeSegment), so a template's outputs never reach their temps' extra dot; the guard
  // still refuses a planned output that equals another row's temp file, whatever made it.
  const jobs = [{ index: 0, out: at('x.mp4'), partial: at('.x.0.partial.mp4') }, { index: 1, out: at('.X.0.partial.mp4'), partial: at('..X.0.partial.mp4') }];
  assert.deepEqual(tempClashes(jobs), [{ index: 1, path: '--out', message: ".X.0.partial.mp4 is row 0's temporary file name; change the value or the --out template" }]);
  assert.deepEqual(tempClashes(jobs.slice(0, 1)), []);
});

test('batch (H1): recheckRows marks an ok row failed when its file is gone or no longer matches its sha256', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vars-recheck-'));
  writeFileSync(path.join(folder, 'a.mp4'), 'a');
  writeFileSync(path.join(folder, 'b.mp4'), 'changed');
  const rows = [
    { index: 0, status: 'ok', out: 'a.mp4', sha256: sha(path.join(folder, 'a.mp4')) },
    { index: 1, status: 'ok', out: 'b.mp4', sha256: 'f'.repeat(64) },
    { index: 2, status: 'ok', out: 'c.mp4', sha256: 'f'.repeat(64) },
    { index: 3, status: 'failed', out: 'd.mp4', sha256: null, error: 'boom' },
  ];
  const checked = recheckRows(folder, rows);
  assert.deepEqual(checked.map((row) => row.status), ['ok', 'failed', 'failed', 'failed']);
  assert.match(checked[1].error, /b\.mp4 changed after it was rendered/);
  assert.match(checked[2].error, /c\.mp4 is missing after it was rendered/);
  assert.equal(checked[1].sha256, null);
  assert.equal(checked[3].error, 'boom');
});

test('vars (M1): `index` is reserved for the --out row number and cannot be a var name', () => {
  const errors = validateSpec(motion([text('t', '{{index}}')], { index: { type: 'string', default: 'zzz' } })).errors;
  assert.deepEqual(errors, [{ path: 'vars.index', message: '"index" is reserved for the row number in a --batch --out template; give the var another name' }]);
});

test('batch (M2): an existing manifest.json that is not a batch manifest is refused before anything renders (exit 2)', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vars-slot-'));
  assert.doesNotThrow(() => checkManifestSlot(path.join(folder, 'missing')));
  writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ rows: [] }));
  assert.doesNotThrow(() => checkManifestSlot(folder), 'an earlier batch manifest is replaced');
  writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ rows: [{ index: 0, status: 'ok', out: 'a.mp4' }, { index: 1, status: 'failed', out: 'b.mp4' }] }));
  assert.doesNotThrow(() => checkManifestSlot(folder), 'a batch manifest with rows');
  // N7: another tool's { rows: [...] } is not a batch manifest: every row needs an integer index and an ok/failed status.
  for (const rows of [[{ a: 1 }], [{ index: 0, status: 'done' }], [{ index: '0', status: 'ok' }], [null]]) {
    writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ rows }));
    assert.throws(() => checkManifestSlot(folder), /is not a batch manifest/, JSON.stringify(rows));
  }
  for (const body of ['{"name": "My PWA", "icons": []}', '{"rows": 3}', 'not json']) {
    writeFileSync(path.join(folder, 'manifest.json'), body);
    assert.throws(() => checkManifestSlot(folder), /manifest\.json exists and is not a batch manifest/, body);
  }
  const dir = project(motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } }), [{ name: 'Ada' }]);
  mkdirSync(path.join(dir, 'web'));
  writeFileSync(path.join(dir, 'web', 'manifest.json'), '{"name": "My PWA"}');
  const r = batch(dir, path.join(dir, 'web', '{name}.mp4'));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /manifest\.json exists and is not a batch manifest; choose another --out folder/);
  assert.equal(readFileSync(path.join(dir, 'web', 'manifest.json'), 'utf8'), '{"name": "My PWA"}');
  assert.deepEqual(readdirSync(path.join(dir, 'web')), ['manifest.json']);
});

test('batch (L1): --model/--effort/--agent are stamped after substitution, so a {{name}} in them is never substituted', () => {
  const dir = project(motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } }), [{ name: 'Ada' }]);
  const r = batch(dir, path.join(dir, 'o', '{name}.mp4'), ['--model', '{{name}}']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(lines(r).some((l) => l.startsWith('row 0: generatedBy.model:')), r.stdout);
  assert.ok(!/unknown variable/.test(r.stdout), r.stdout);
});

test('batch (L2, L14, L5, L7): placeholder mix-ups in --out exit 2 with the fix; a cwd folder with braces is fine', () => {
  const dir = project(motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } }), [{}]);
  const rows = path.join(dir, 'rows.json');
  const noBatch = render(dir, ['--out', path.join(dir, '{name}.mp4')]);
  assert.equal(noBatch.status, 2);
  assert.match(noBatch.stderr, /--out has a \{name\} placeholder but no --batch; add --batch <rows\.json>, or write the file name without braces/);
  const doubled = render(dir, ['--batch', rows, '--out', path.join(dir, '{{name}}.mp4')]);
  assert.equal(doubled.status, 2);
  assert.match(doubled.stderr, /--out: write placeholders with single braces, like \{name\}; \{\{name\}\} is the spec's syntax/);
  const json = render(dir, ['--batch', rows, '--out', path.join(dir, '{name}.json')]);
  assert.equal(json.status, 2);
  assert.match(json.stderr, /--out: a batch writes MP4 files; end the template with \.mp4 \(got "\.json"\)/);
  assert.deepEqual(readdirSync(dir).sort(), ['m.json', 'rows.json']);
  // A working folder whose own name has braces is not a placeholder: only the folder part as written counts.
  const braces = path.join(dir, '{draft}');
  mkdirSync(braces);
  writeFileSync(rows, JSON.stringify([{ name: 7 }])); // a type error, so the batch stops before rendering
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), '--batch', rows, '--out', 'o/{name}.mp4'], { encoding: 'utf8', cwd: braces });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('row 0: vars.name: the row gives 7 (a number); name is a string'), r.stdout);
});

test('render (N2): without --batch only the file name of --out is read for placeholders; a {draft} folder renders as before', () => {
  // The spec has a bad colour, so the run stops at validation (exit 1): it got past the --out check, which exits 2.
  const dir = project(motion([text('t', 'x', { color: 'url(x)' })]));
  const folder = render(dir, ['--out', path.join(dir, '{draft}', 'clip.mp4')]);
  assert.equal(folder.status, 1, folder.stdout + folder.stderr);
  assert.match(folder.stdout, /scenes\[0\]\.elements\[0\]\.color: must be a CSS colour/);
  const named = render(dir, ['--out', path.join(dir, '{draft}', '{index}.mp4')]);
  assert.equal(named.status, 2);
  assert.match(named.stderr, /--out has a \{index\} placeholder but no --batch/);
  // N3: a batch keeps refusing braces in the folder written in --out (no way to tell a folder from a placeholder there).
  writeFileSync(path.join(dir, 'rows.json'), '[{}]');
  const batchFolder = render(dir, ['--batch', path.join(dir, 'rows.json'), '--out', path.join(dir, '{draft}', '{index}.mp4')]);
  assert.equal(batchFolder.status, 2);
  assert.match(batchFolder.stderr, /put the \{…\} placeholders in the file name, not the folder/);
});

test('batch (L3, L4, L6, L8): messages and limits', () => {
  const spec = motion([text('t', '{{n}}x')], { n: { type: 'number', default: 1 } });
  assert.deepEqual(validateSpec(spec, { values: { n: Infinity } }).errors, [{ path: 'vars.n', message: 'the row gives Infinity (a number too large to use); n is a number' }]);
  assert.throws(() => readRows(path.join(project(spec, '{}'), 'rows.json')), /\(got an object\)/);
  // NAME_MAX is 255 bytes: 3 CJK values of 80 characters are 720 bytes.
  const tpl = outTemplate(path.join(tmpdir(), '{a}-{b}-{c}.mp4'), ['a', 'b', 'c']);
  const long = '漢'.repeat(80);
  assert.match(outputFor(tpl, 0, Object.assign(Object.create(null), { a: long, b: long, c: long })).error, /file name is \d+ bytes with its temporary prefix and suffix; at most 255/);
  assert.equal(collisionKey('/o/STRASSE.mp4'), collisionKey('/o/straße.mp4'));
});

// --- Gate 2 fix (L6) ------------------------------------------------------------------------------------------------

test('batch (gate 2 L6): an output that is the rows file, or a clip the spec plays, is refused before anything renders', async (t) => {
  const spec = motion([text('t', '{{name}}')], { name: { type: 'string', default: 'A' } });
  const body = JSON.stringify([{ name: 'rows' }, { name: 'ok' }]);
  const dir = project(spec, undefined, { 'rows.mp4': body });
  const rows = path.join(dir, 'rows.mp4');
  const r = render(dir, ['--batch', rows, '--out', path.join(dir, '{name}.mp4')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(lines(r).includes('row 0: --out: rows.mp4 is a file this batch reads (the rows file); change the value or the --out template'), r.stdout);
  assert.equal(readFileSync(rows, 'utf8'), body, 'the rows file is untouched');
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const video = { id: 'v', type: 'video', src: 'footage/clip.mp4', x: 80, y: 45, width: 160, height: 90 };
  const clipDir = project({ ...spec, scenes: [scene([text('t', '{{name}}'), video])] }, [{ name: 'CLIP' }]);
  mkdirSync(path.join(clipDir, 'footage'));
  makeTestVideo(tools.ffmpeg, path.join(clipDir, 'footage', 'clip.mp4'), { seconds: 1 });
  const before = sha(path.join(clipDir, 'footage', 'clip.mp4'));
  const clip = batch(clipDir, path.join(clipDir, 'footage', '{name}.mp4'));
  assert.equal(clip.status, 1, clip.stdout + clip.stderr);
  assert.ok(lines(clip).includes('row 0: --out: CLIP.mp4 is a file this batch reads (footage/clip.mp4); change the value or the --out template'), clip.stdout);
  assert.equal(sha(path.join(clipDir, 'footage', 'clip.mp4')), before, 'the clip is untouched');
});

// Gate 2 re-review N1: a plain render guards its --out the same way.
test('render (gate 2 N1): --out onto the spec\'s own clip, or the spec itself, exits 2 before anything renders', async (t) => {
  const tools = await requireRender(t, { need: ['ffmpeg', 'ffprobe'] });
  if (!tools) return;
  const video = { id: 'v', type: 'video', src: 'footage/clip.mp4', x: 80, y: 45, width: 160, height: 90 };
  const dir = project(motion([text('t', 'Hi'), video]));
  mkdirSync(path.join(dir, 'footage'));
  const clipFile = path.join(dir, 'footage', 'clip.mp4');
  makeTestVideo(tools.ffmpeg, clipFile, { seconds: 1 });
  const before = sha(clipFile);
  const r = render(dir, ['--out', clipFile]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), '--out: clip.mp4 is a file this render reads (footage/clip.mp4); choose another --out');
  assert.equal(sha(clipFile), before, 'the clip is untouched');
  const spec = readFileSync(path.join(dir, 'm.json'), 'utf8');
  const self = render(dir, ['--out', path.join(dir, 'm.json')]);
  assert.equal(self.status, 2, self.stdout + self.stderr);
  assert.equal(self.stderr.trim(), '--out: m.json is a file this render reads (the spec); choose another --out');
  assert.equal(readFileSync(path.join(dir, 'm.json'), 'utf8'), spec, 'the spec is untouched');
});

test('batch (gate 2 L6): a symlink left at the manifest temp name is never written through, and one at a partial MP4 name is replaced by a new file', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vars-link-'));
  const victim = path.join(folder, 'victim.txt');
  writeFileSync(victim, 'keep me');
  symlinkSync(victim, path.join(folder, `.manifest.json.${process.pid}.tmp`));
  writeManifest(folder, [{ index: 0, status: 'ok', out: 'a.mp4', sha256: null }]);
  assert.equal(readFileSync(victim, 'utf8'), 'keep me');
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8')).rows.length, 1);
  const partial = path.join(folder, '.x.0.partial.mp4');
  symlinkSync(victim, partial);
  freshFile(partial);
  assert.equal(lstatSync(partial).isFile(), true, 'a regular file now, not a link');
  assert.equal(statSync(partial).size, 0);
  assert.equal(readFileSync(victim, 'utf8'), 'keep me');
});

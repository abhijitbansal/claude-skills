import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, registerLiftCheck } from '../scripts/lib/spec.mjs';
import { loadData, focusKeys } from '../scripts/lib/rows.mjs';
import { eligibility } from '../scripts/lib/eligibility.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const rows = (n = 2) => Array.from({ length: n }, (_, i) => ({ group: `g${i % 3}`, t: `t${i}`, value: i }));
const scene = (extra = {}) => ({ title: 'T', data: { rows: [{ group: 'api', t: 'W1', value: 1 }, { group: 'web', t: 'W1', value: 2 }] }, ...extra });
const check = (spec, opts = {}) => validateSpec(spec, { dir: FIX, ...opts });
const errorAt = (result, p) => result.errors.find((e) => e.path === p);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scene-spec-'));

test('a valid inline scene passes', async () => {
  const r = await check(scene());
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('the file fixture scene passes', async () => {
  const { spec, dir } = loadSpec(path.join(FIX, 'city.scene.json'));
  assert.deepEqual(await validateSpec(spec, { dir }), { ok: true, errors: [] });
});

test('exactly one of data or lift', async () => {
  const none = await check({ title: 'T' });
  assert.equal(none.ok, false);
  assert.match(errorAt(none, 'data').message, /exactly one of data or lift/);
  const both = await check(scene({ lift: { diagram: 'x.json' } }));
  assert.match(errorAt(both, 'lift').message, /exactly one of data or lift/);
});

test('exactly one data source', async () => {
  const none = await check(scene({ data: {} }));
  assert.match(errorAt(none, 'data').message, /exactly one data source.*rows, file or csv/);
  const two = await check(scene({ data: { rows: rows(), file: 'rows.json' } }));
  assert.match(errorAt(two, 'data').message, /exactly one data source/);
});

test('csv columns map group t value label parent', async () => {
  const spec = scene({ data: { csv: 'data.csv', columns: { group: 'folder', t: 'week', value: 'commits', label: 'note', parent: 'up' } } });
  assert.deepEqual(await check(spec), { ok: true, errors: [] });
  const { rows: loaded } = loadData(spec, FIX);
  assert.deepEqual(loaded[0], { group: 'api', t: '2026-W30', value: 12, label: 'Big, bold' });
  assert.deepEqual(loaded[1], { group: 'web', t: '2026-W30', value: 5, label: 'say "hi"', parent: 'api' });
});

test('csv column naming a missing header suggests one', async () => {
  const r = await check(scene({ data: { csv: 'data.csv', columns: { group: 'folde', value: 'commits' } } }));
  assert.equal(errorAt(r, 'data.columns.group').message, 'csv has no column "folde"; did you mean "folder"?');
});

test('csv without columns needs headers named after the fields', async () => {
  const r = await check(scene({ data: { csv: 'data.csv' } }));
  assert.equal(r.ok, false);
  assert.match(errorAt(r, 'data.columns.group').message, /no column "group"/);
});

const csvSpec = (name, text, columns = { group: 'g', value: 'v' }) => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, name), text);
  return { dir, spec: scene({ data: { csv: name, columns } }) };
};

test('csv value that is not a number names column, line and cell', async () => {
  const { dir, spec } = csvSpec('bad.csv', 'g,v\na,12\nb,lots\n');
  const r = await validateSpec(spec, { dir });
  assert.deepEqual(r.errors, [{ path: 'data.csv', message: 'column "v" line 3 has "lots", not a number; map columns.value to a numeric column' }]);
  fs.rmSync(dir, { recursive: true });
});

test('csv line numbers count blank lines, quoted newlines and the header', async () => {
  const { dir, spec } = csvSpec('lines.csv', 'g,v\n\n"x\ny",1\nb,oops\n');
  const r = await validateSpec(spec, { dir });
  assert.match(r.errors[0].message, /^column "v" line 5 has "oops"/);
  fs.rmSync(dir, { recursive: true });
});

test('csv Infinity, NaN and empty value cells are rejected like text', async () => {
  const { dir, spec } = csvSpec('odd.csv', 'g,v\na,Infinity\nb,NaN\nc,\nd,-Infinity\ne,4\n');
  const r = await validateSpec(spec, { dir });
  assert.deepEqual(r.errors.map((e) => e.message), [
    'column "v" line 2 has "Infinity", not a number; map columns.value to a numeric column',
    'column "v" line 3 has "NaN", not a number; map columns.value to a numeric column',
    'column "v" line 4 is empty, not a number; map columns.value to a numeric column',
    'column "v" line 5 has "-Infinity", not a number; map columns.value to a numeric column',
  ]);
  fs.rmSync(dir, { recursive: true });
});

test('csv value errors are capped at ten plus a count', async () => {
  const { dir, spec } = csvSpec('many.csv', `g,v\n${Array.from({ length: 13 }, () => 'a,x').join('\n')}\n`);
  const r = await validateSpec(spec, { dir });
  assert.equal(r.errors.length, 11);
  assert.equal(r.errors[10].message, '… and 3 more non-numeric value cells');
  fs.rmSync(dir, { recursive: true });
});

test('csv unterminated quote reports the line it opened on', async () => {
  const { dir, spec } = csvSpec('open.csv', 'g,v\na,1\n"b,2\nc,3\n');
  const r = await validateSpec(spec, { dir });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'data.csv');
  assert.match(r.errors[0].message, /unterminated quote starting on line 3/);
  fs.rmSync(dir, { recursive: true });
});

test('rejects URL and missing data paths', async () => {
  const url = await check(scene({ data: { file: 'https://example.com/rows.json' } }));
  assert.match(errorAt(url, 'data.file').message, /local file.*no URLs/);
  const csvUrl = await check(scene({ data: { csv: 'http://x/y.csv', columns: { group: 'a', value: 'b' } } }));
  assert.match(errorAt(csvUrl, 'data.csv').message, /no URLs/);
  const missing = await check(scene({ data: { file: 'nope.json' } }));
  assert.match(errorAt(missing, 'data.file').message, /file not found/);
});

test('data path outside spec dir rejected unless allowOutside', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'outer.json'), JSON.stringify({ rows: rows() }));
  const inner = path.join(dir, 'inner');
  fs.mkdirSync(inner);
  const dotdot = { data: { file: '../outer.json' } };
  const r = await validateSpec(scene(dotdot), { dir: inner });
  assert.match(errorAt(r, 'data.file').message, /outside the spec folder.*--allow-outside/);
  assert.equal((await validateSpec(scene(dotdot), { dir: inner, allowOutside: true })).ok, true);
  const abs = { data: { file: path.join(dir, 'outer.json') } };
  assert.match(errorAt(await validateSpec(scene(abs), { dir: inner }), 'data.file').message, /absolute paths are not allowed/);
  assert.equal((await validateSpec(scene(abs), { dir: inner, allowOutside: true })).ok, true);
  fs.rmSync(dir, { recursive: true });
});

test('a symlink out of the spec dir is outside too', async () => {
  const dir = tmp();
  const inner = path.join(dir, 'inner');
  fs.mkdirSync(inner);
  fs.writeFileSync(path.join(dir, 'secret.json'), JSON.stringify({ rows: rows() }));
  fs.symlinkSync(path.join(dir, 'secret.json'), path.join(inner, 'link.json'));
  const r = await validateSpec(scene({ data: { file: 'link.json' } }), { dir: inner });
  assert.match(errorAt(r, 'data.file').message, /outside the spec folder/);
  fs.rmSync(dir, { recursive: true });
});

test('lift paths follow the same containment rules', async () => {
  const url = await check({ title: 'T', lift: { diagram: 'https://x/d.json' } });
  assert.match(errorAt(url, 'lift.diagram').message, /no URLs/);
  const out = await check({ title: 'T', lift: { dashboard: '../x.json', chart: 'c1' } });
  assert.match(errorAt(out, 'lift.dashboard').message, /outside the spec folder/);
  const missing = await check({ title: 'T', lift: { dashboard: 'nope.json', chart: 'c1' } });
  assert.match(errorAt(missing, 'lift.dashboard').message, /file not found/);
});

test('lift shape: exactly one key, dashboard needs chart, inline diagram is not path-checked', async () => {
  const both = await check({ title: 'T', lift: { diagram: { a: 1 }, dashboard: 'rows.json', chart: 'c' } });
  assert.match(errorAt(both, 'lift').message, /exactly one of diagram or dashboard/);
  const empty = await check({ title: 'T', lift: {} });
  assert.match(errorAt(empty, 'lift').message, /exactly one of diagram or dashboard/);
  const noChart = await check({ title: 'T', lift: { dashboard: 'rows.json' } });
  assert.match(errorAt(noChart, 'lift.chart').message, /required with lift.dashboard/);
  const strayChart = await check({ title: 'T', lift: { diagram: 'rows.json', chart: 'c' } });
  assert.match(errorAt(strayChart, 'lift.chart').message, /only with lift.dashboard/);
  const inline = await check({ title: 'T', lift: { diagram: { title: 'x', type: 'flow' } } });
  assert.deepEqual(inline, { ok: true, errors: [] });
});

test('lift checks registered by sibling tasks run with spec, dir and allowOutside', async () => {
  const calls = [];
  registerLiftCheck('diagram', async (spec, ctx) => { calls.push(ctx); return [{ path: 'lift.diagram', message: 'sibling says no' }]; });
  try {
    const r = await check({ title: 'T', lift: { diagram: { title: 'x' } } }, { allowOutside: true });
    assert.deepEqual(r.errors, [{ path: 'lift.diagram', message: 'sibling says no' }]);
    assert.deepEqual(calls, [{ dir: FIX, allowOutside: true }]);
  } finally {
    registerLiftCheck('diagram', async () => []);
  }
});

test('registerLiftCheck throws TypeError for an unknown kind or a non-function', () => {
  assert.throws(() => registerLiftCheck('diagrm', async () => []), (e) => e instanceof TypeError && /kind must be "diagram" or "dashboard", got "diagrm"/.test(e.message));
  assert.throws(() => registerLiftCheck(undefined, async () => []), TypeError);
  assert.throws(() => registerLiftCheck('diagram', undefined), (e) => e instanceof TypeError && /must be a function/.test(e.message));
  assert.throws(() => registerLiftCheck('dashboard', 'nope'), TypeError);
});

test('world, links and columns do not apply to a lift', async () => {
  const r = await check({ title: 'T', world: 'city', lift: { diagram: { title: 'x' } } });
  assert.match(errorAt(r, 'world').message, /only applies to data/);
});

test('rejects negative or non-finite value', async () => {
  const neg = await check(scene({ data: { rows: [{ group: 'a', value: -1 }] } }));
  assert.match(errorAt(neg, 'data.rows[0].value').message, /negative/);
  const text = await check(scene({ data: { rows: [{ group: 'a', value: 'lots' }] } }));
  assert.equal(errorAt(text, 'data.rows[0].value').message, 'must be number');
  const inf = await check(scene({ data: { rows: [{ group: 'a', value: Infinity }] } }));
  assert.equal(inf.ok, false);
  assert.ok(errorAt(inf, 'data.rows[0].value'));
  const nan = await check(scene({ data: { rows: [{ group: 'a', value: NaN }] } }));
  assert.ok(errorAt(nan, 'data.rows[0].value'));
  const zero = await check(scene({ data: { rows: [{ group: 'a', value: 0 }] } }));
  assert.equal(zero.ok, true);
});

test('group is free text up to 48 chars', async () => {
  assert.equal((await check(scene({ data: { rows: [{ group: '.github', value: 1 }, { group: 'Sources & more', value: 1 }] } }))).ok, true);
  assert.equal((await check(scene({ data: { rows: [{ group: 'x'.repeat(48), value: 1 }] } }))).ok, true);
  const long = await check(scene({ data: { rows: [{ group: 'x'.repeat(49), value: 1 }] } }));
  assert.match(errorAt(long, 'data.rows[0].group').message, /49 characters; the limit is 48/);
  const empty = await check(scene({ data: { rows: [{ group: '', value: 1 }] } }));
  assert.equal(empty.ok, false);
});

test('parent must name a group, with did-you-mean', async () => {
  const r = await check(scene({ data: { rows: [{ group: 'api', value: 1 }, { group: 'web', value: 1, parent: 'apy' }] } }));
  assert.equal(errorAt(r, 'data.rows[1].parent').message, '"apy" is not a group; did you mean "api"?');
});

test('parent cycle is an error', async () => {
  const r = await check(scene({ data: { rows: [{ group: 'a', value: 1, parent: 'b' }, { group: 'b', value: 1, parent: 'a' }] } }));
  assert.match(errorAt(r, 'data.rows[0].parent').message, /form a cycle: a -> b -> a/);
  assert.equal(r.errors.length, 1);
  const self = await check(scene({ data: { rows: [{ group: 'a', value: 1, parent: 'a' }] } }));
  assert.match(errorAt(self, 'data.rows[0].parent').message, /cycle: a -> a/);
});

test('a group cannot have two different parents', async () => {
  const r = await check(scene({ data: { rows: [{ group: 'a', value: 1 }, { group: 'b', value: 1 }, { group: 'c', value: 1, parent: 'a' }, { group: 'c', value: 2, parent: 'b' }] } }));
  assert.match(errorAt(r, 'data.rows[3].parent').message, /group "c" has parents "a" and "b"/);
});

test('terrain needs t on every row', async () => {
  const r = await check(scene({ world: 'terrain', data: { rows: [{ group: 'a', t: 1, value: 1 }, { group: 'b', value: 1 }] } }));
  assert.match(errorAt(r, 'world').message, /terrain needs t on every row/);
  assert.match(errorAt(r, 'world').message, /eligible worlds: city, forest, galaxy/);
});

test('terrain rejects duplicate group,t', async () => {
  const r = await check(scene({ world: 'terrain', data: { rows: [{ group: 'a', t: 1, value: 1 }, { group: 'a', t: 1, value: 2 }] } }));
  assert.match(errorAt(r, 'world').message, /terrain needs exactly one row per group and t/);
});

test('explicit world the data cannot feed names eligible worlds', async () => {
  const r = await check(scene({ world: 'terrain', data: { rows: [{ group: 'a', value: 1 }] } }));
  assert.equal(errorAt(r, 'world').message, 'world "terrain" cannot show this data: terrain needs t on every row; eligible worlds: city, forest, galaxy');
  const ok = await check(scene({ world: 'terrain', data: { rows: [{ group: 'a', t: 'x', value: 1 }, { group: 'a', t: 'y', value: 1 }] } }));
  assert.equal(ok.ok, true);
});

test('duplicate group,t is fine for the other worlds', async () => {
  const dup = [{ group: 'a', t: 1, value: 1 }, { group: 'a', t: 1, value: 2 }];
  for (const world of ['city', 'forest', 'galaxy']) assert.equal((await check(scene({ world, data: { rows: dup } }))).ok, true);
});

test('eligibility reports every world', () => {
  const grid = [{ group: 'a', t: 1, value: 1 }, { group: 'a', t: 2, value: 1 }];
  assert.deepEqual(eligibility({ rows: grid, links: [] }), {
    city: { ok: true }, forest: { ok: true }, galaxy: { ok: true }, terrain: { ok: true },
  });
  const flat = eligibility({ rows: [{ group: 'a', value: 1 }], links: [] });
  assert.equal(flat.terrain.ok, false);
  assert.equal(flat.terrain.needs, 'terrain needs t on every row');
  assert.equal(flat.city.ok, true);
});

test('tour focus resolves case-insensitively', async () => {
  const r = await check(scene({ tour: [{ title: 'Web', focus: ['Web'] }, { title: 'API', focus: ['API'] }] }));
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('tour focus matches a row label', async () => {
  const spec = scene({ data: { rows: [{ group: 'a', value: 1, label: 'Spike in March' }] }, tour: [{ title: 'S', focus: ['spike in march'] }] });
  assert.equal((await check(spec)).ok, true);
  assert.deepEqual([...focusKeys(spec.data.rows)].sort(), ['a', 'spike in march']);
});

test('tour focus miss suggests a key', async () => {
  const r = await check(scene({ tour: [{ title: 'W', focus: ['api', 'wbe'] }] }));
  assert.equal(errorAt(r, 'tour[0].focus[1]').message, '"wbe" is not a group or label; did you mean "web"?');
});

test('tour focus is not resolved for a lift (node ids belong to the sibling)', async () => {
  const r = await check({ title: 'T', lift: { diagram: { title: 'x' } }, tour: [{ title: 'N', focus: ['some-node'] }] });
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('limits: 2001 rows rejected, 2000 fine', async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ group: `g${i % 24}`, t: i, value: i }));
  assert.equal((await check(scene({ data: { rows: many(2000) } }))).ok, true);
  const r = await check(scene({ data: { rows: many(2001) } }));
  assert.match(errorAt(r, 'data.rows').message, /2001 rows; the limit is 2000/);
});

test('limits: 25 groups rejected, 24 fine', async () => {
  const groups = (n) => Array.from({ length: n }, (_, i) => ({ group: `g${i}`, value: 1 }));
  assert.equal((await check(scene({ data: { rows: groups(24) } }))).ok, true);
  const r = await check(scene({ data: { rows: groups(25) } }));
  assert.match(errorAt(r, 'data').message, /25 groups; the limit is 24/);
});

test('limits: 13 beats rejected, 12 fine', async () => {
  const beats = (n) => Array.from({ length: n }, (_, i) => ({ title: `b${i}`, focus: ['api'] }));
  assert.equal((await check(scene({ tour: beats(12) }))).ok, true);
  const r = await check(scene({ tour: beats(13) }));
  assert.match(errorAt(r, 'tour').message, /13 beats; the limit is 12/);
});

test('limits: text lengths', async () => {
  const r = await check(scene({
    title: 'x'.repeat(121), subtitle: 'x'.repeat(161),
    tour: [{ title: 'x'.repeat(49), caption: 'x'.repeat(161), focus: ['api'] }],
  }));
  for (const [p, limit] of [['title', 120], ['subtitle', 160], ['tour[0].title', 48], ['tour[0].caption', 160]]) {
    assert.match(errorAt(r, p).message, new RegExp(`the limit is ${limit}`), p);
  }
});

test('unknown top-level field gets did-you-mean', async () => {
  const r = await check({ ...scene(), wrold: 'city' });
  assert.deepEqual(errorAt(r, 'wrold'), { path: 'wrold', message: 'unknown property; did you mean "world"?' });
});

test('unknown world gets did-you-mean', async () => {
  const r = await check(scene({ world: 'citty' }));
  assert.match(errorAt(r, 'world').message, /must be one of "city", "forest", "galaxy", "terrain"; did you mean "city"\?/);
});

test('unknown row field is rejected', async () => {
  const r = await check(scene({ data: { rows: [{ group: 'a', value: 1, valeu: 2 }] } }));
  assert.match(errorAt(r, 'data.rows[0].valeu').message, /did you mean "value"/);
});

test('theme must be a shared theme', async () => {
  assert.equal((await check(scene({ theme: 'dusk' }))).ok, true);
  const r = await check(scene({ theme: 'dsk' }));
  assert.equal(errorAt(r, 'theme').message, 'unknown theme "dsk"; did you mean "dusk"?');
});

test('generatedBy and autoplay are accepted', async () => {
  const r = await check(scene({ autoplay: true, generatedBy: { model: 'haiku', effort: 'low', agent: 'claude-code' } }));
  assert.deepEqual(r, { ok: true, errors: [] });
  assert.equal((await check(scene({ generatedBy: { modle: 'x' } }))).ok, false);
});

test('top-level links: shape-checked and must name groups', async () => {
  const ok = await check(scene({ links: [{ from: 'api', to: 'web', value: 3 }] }));
  assert.deepEqual(ok, { ok: true, errors: [] });
  const bad = await check(scene({ links: [{ from: 'api', to: 'wbe' }] }));
  assert.equal(errorAt(bad, 'links[0].to').message, '"wbe" is not a group; did you mean "web"?');
  const neg = await check(scene({ links: [{ from: 'api', to: 'web', value: -1 }] }));
  assert.match(errorAt(neg, 'links[0].value').message, /negative/);
});

test('file source: rows and links load, rows are validated', async () => {
  const spec = { title: 'T', data: { file: 'rows.json' } };
  const data = loadData(spec, FIX);
  assert.equal(data.rows.length, 4);
  assert.deepEqual(data.links, [{ from: 'api', to: 'web', value: 3 }]);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ rows: [{ group: 'a', value: -2 }] }));
  const r = await validateSpec({ title: 'T', data: { file: 'bad.json' } }, { dir });
  assert.match(errorAt(r, 'data.file.rows[0].value').message, /negative/);
  fs.writeFileSync(path.join(dir, 'junk.json'), '{nope');
  const junk = await validateSpec({ title: 'T', data: { file: 'junk.json' } }, { dir });
  assert.match(errorAt(junk, 'data.file').message, /not valid JSON/);
  fs.rmSync(dir, { recursive: true });
});

test('an empty rows list is an error', async () => {
  const r = await check(scene({ data: { rows: [] } }));
  assert.match(errorAt(r, 'data.rows').message, /at least one row/);
});

test('loadSpec reads a file and reports the folder; bad input is a usage error', () => {
  const { spec, dir } = loadSpec(path.join(FIX, 'city.scene.json'));
  assert.equal(spec.title, 'Commits per folder');
  assert.equal(dir, FIX.replace(/\/$/, ''));
  assert.throws(() => loadSpec('/nonexistent/x.json'), /cannot read/);
  const d = tmp();
  fs.writeFileSync(path.join(d, 'x.json'), '{bad');
  assert.throws(() => loadSpec(path.join(d, 'x.json')), /not valid JSON/);
  fs.rmSync(d, { recursive: true });
});

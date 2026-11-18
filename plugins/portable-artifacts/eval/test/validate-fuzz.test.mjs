// PA-66: every validate.mjs gets specs whose keys or lookup values are names every JS object inherits
// (constructor, __proto__, toString, hasOwnProperty). A validator that looks a name up with `in` or a bare
// `obj[name]` accepts them as real kinds, themes or blocks, or crashes on them. Each hostile spec must be
// rejected cleanly: exit 1, a JSON result with ok:false, no stack trace.
// The guardrail proof at the bottom feeds the same harness a scratch validator that accepts `constructor`
// and shows it is caught.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib.mjs';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const HOSTILE_KEYS = ['constructor', '__proto__', 'toString'];
const HOSTILE_VALUES = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
const CONCURRENCY = 6;
const CRASH = /TypeError|RangeError|ReferenceError|\n\s+at .*\.mjs:\d+/;

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// `lookups`: paths to a string the validator looks up in a closed set or a registry (a kind, a theme, a block, an icon,
// a reference to an id); `nested`: paths to an object that takes a closed set of keys.
const CASES = [
  { skill: 'make-dashboard', dir: 'references/examples', file: 'minimal.json', lookups: [['theme'], ['charts', 0, 'kind'], ['charts', 0, 'x'], ['charts', 0, 'query']], nested: [['charts', 0]] },
  { skill: 'make-diagram', dir: 'references/examples', file: 'architecture.diagram.json', lookups: [['theme'], ['type'], ['direction'], ['nodes', 0, 'kind'], ['nodes', 1, 'icon'], ['nodes', 1, 'group'], ['edges', 0, 'from']], nested: [['nodes', 0], ['edges', 0], ['groups', 0]] },
  { skill: 'make-explainer', dir: 'references/examples', file: 'concept.explainer.json', lookups: [['theme'], ['preset'], ['mode'], ['sections', 0, 'type'], ['sections', 0, 'tone'], ['sections', 10, 'items', 0, 'severity'], ['sections', 11, 'items', 0, 'change'], ['sections', 13, 'tone']], nested: [['sections', 0], ['sections', 5, 'items', 0], ['meta']] },
  // make-motion has no validate.mjs since the cut-over; its film validator is fuzzed in-process by make-motion/test/v2/hostile-names.test.mjs.
  { skill: 'make-scene', dir: 'references/examples', file: 'city.scene.json', lookups: [['world'], ['theme']], nested: [['data']] },
];

const clone = (o) => JSON.parse(JSON.stringify(o));
// `__proto__` written as an assignment or an object literal sets the prototype and never reaches JSON.stringify;
// defineProperty makes it a real own key, which is what JSON.parse gives a validator reading a hostile file.
const withOwnKey = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
const at = (root, p) => p.reduce((o, k) => o?.[k], root);

// The hostile variants of a base spec: { label, spec }.
function hostileSpecs(base, { lookups, nested }) {
  const out = [];
  for (const key of HOSTILE_KEYS) {
    out.push({ label: `root key ${key}`, spec: withOwnKey(clone(base), key, { x: 1 }) });
    for (const p of nested) {
      const spec = clone(base);
      const target = at(spec, p);
      assert.ok(target && typeof target === 'object', `base has no object at ${p.join('.')}`);
      withOwnKey(target, key, { x: 1 });
      out.push({ label: `${p.join('.')} key ${key}`, spec });
    }
  }
  for (const value of HOSTILE_VALUES) {
    for (const p of lookups) {
      const spec = clone(base);
      const parent = at(spec, p.slice(0, -1));
      assert.ok(parent && typeof parent === 'object', `base has no object at ${p.slice(0, -1).join('.')}`);
      parent[p.at(-1)] = value;
      out.push({ label: `${p.join('.')} = ${value}`, spec });
    }
  }
  return out;
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

// Run one validator over a base spec and its hostile variants -> list of what went wrong (empty = clean).
async function fuzzValidator({ validatePath, baseFile, lookups, nested, cwd }) {
  const ext = path.basename(baseFile).replace(/^[^.]*/, '');
  const stem = path.basename(baseFile).slice(0, path.basename(baseFile).length - ext.length);
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const cases = hostileSpecs(base, { lookups, nested });
  const results = await pool(cases, async ({ label, spec }, i) => {
    const file = path.join(cwd, `${stem}-fz${i}${ext}`);
    fs.writeFileSync(file, JSON.stringify(spec));
    const r = await run(['node', validatePath, file, '--json'], { cwd, env: { EVAL_LOG: '' }, timeoutMs: 120000 });
    fs.rmSync(file, { force: true });
    if (r.timedOut) return `${label}: timed out`;
    if (CRASH.test(r.out)) return `${label}: crashed: ${r.out.split('\n').slice(0, 2).join(' | ')}`;
    let parsed;
    try { parsed = JSON.parse(r.out.trim().split('\n').pop()); } catch { return `${label}: no JSON result (exit ${r.code})`; }
    if (parsed.ok !== false) return `${label}: accepted (ok:${parsed.ok})`;
    return r.code === 1 ? null : `${label}: rejected but exit ${r.code}, expected 1`;
  });
  return results.filter(Boolean);
}

for (const c of CASES) {
  test(`${c.skill} validate.mjs rejects hostile keys and lookup values in ${c.file} (no crash, ok:false, exit 1)`, async (t) => {
    const skillDir = path.join(SKILLS, c.skill);
    if (!fs.existsSync(path.join(skillDir, 'node_modules'))) { t.skip(`${c.skill}: dependencies not installed`); return; }
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-fuzz-'));
    made.push(cwd);
    fs.cpSync(path.join(skillDir, c.dir), cwd, { recursive: true });
    const problems = await fuzzValidator({ validatePath: path.join(skillDir, 'scripts/validate.mjs'), baseFile: path.join(cwd, c.file), lookups: c.lookups, nested: c.nested, cwd });
    assert.deepEqual(problems, []);
  });
}

test('every skill that has a validate.mjs is fuzzed', () => {
  const have = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'scripts/validate.mjs'))).sort();
  assert.deepEqual([...new Set(CASES.map((c) => c.skill))].sort(), have);
  assert.equal(have.length, 4);
});

test('guardrail proof: a scratch validator that looks a kind up with `in` is caught accepting constructor', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-fuzz-scratch-'));
  made.push(cwd);
  const validate = path.join(cwd, 'validate.mjs');
  fs.writeFileSync(validate, `
    import fs from 'node:fs';
    const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const KINDS = { bar: 1, line: 1 };
    const errors = [];
    if (spec.kind !== undefined && !(spec.kind in KINDS)) errors.push({ path: 'kind', message: 'unknown kind' });
    console.log(JSON.stringify({ ok: errors.length === 0, errors }));
    process.exit(errors.length === 0 ? 0 : 1);
  `);
  fs.writeFileSync(path.join(cwd, 'base.json'), JSON.stringify({ kind: 'bar' }));
  const problems = await fuzzValidator({ validatePath: validate, baseFile: path.join(cwd, 'base.json'), lookups: [['kind']], nested: [], cwd });
  assert.ok(problems.some((p) => p.startsWith('kind = constructor: accepted')), problems.join('\n'));
  assert.ok(problems.some((p) => p.startsWith('root key constructor: accepted')), 'an unknown root key is not rejected either');
  // and a validator that crashes on them is caught as a crash
  fs.writeFileSync(validate, 'const spec = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")); null.boom;');
  const crashing = await fuzzValidator({ validatePath: validate, baseFile: path.join(cwd, 'base.json'), lookups: [['kind']], nested: [], cwd });
  assert.ok(crashing.length > 0 && crashing.every((p) => /crashed|exit/.test(p)), crashing.join('\n'));
});

test('hostileSpecs writes __proto__ as a real key in the JSON text (an object literal would drop it)', () => {
  const [first] = hostileSpecs({ a: 1 }, { lookups: [], nested: [] }).filter((c) => c.label === 'root key __proto__');
  assert.match(JSON.stringify(first.spec), /"__proto__":\{"x":1\}/);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(first.spec)), '__proto__'), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalisedBody } from './helpers/golden.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CORE = path.join(FIXTURES, 'core.explainer.json');
const GOLDEN = fileURLToPath(new URL('./golden/core.body.html', import.meta.url));

function sandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-build-')));
  return { root, done: () => fs.rmSync(root, { recursive: true }) };
}
const run = (args, env = {}) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', ...env } });

test('--out file.html writes the page and prints theme / wrote / open lines', () => {
  const { root, done } = sandbox();
  try {
    const out = path.join(root, 'deep', 'my.html');
    const r = run([CORE, '--out', out]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.stdout, `theme: paper\nwrote ${out}\nopen: ${pathToFileURL(out).href}\n`);
    assert.match(fs.readFileSync(out, 'utf8'), /^<!doctype html>/);
    assert.ok(!fs.existsSync(path.join(root, 'deep', 'my.assets')), 'no assets folder when nothing needs one');
  } finally { done(); }
});

test('--out dir writes <slug-of-title>.html there', () => {
  const { root, done } = sandbox();
  try {
    const r = run([CORE, '--out', root]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(root, 'feat-visual-artifacts-dashboards-diagrams-and-explainers.html')));
  } finally { done(); }
});

test('without --out the page goes to $PA_OUTPUT_DIR/<slug>.html', () => {
  const { root, done } = sandbox();
  try {
    const r = run([CORE], { PA_OUTPUT_DIR: path.join(root, 'out') });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readdirSync(path.join(root, 'out')).every((f) => f.endsWith('.html')));
    assert.equal(fs.readdirSync(path.join(root, 'out')).length, 1);
  } finally { done(); }
});

test('--json prints one result line', () => {
  const { root, done } = sandbox();
  try {
    const out = path.join(root, 'a.html');
    const r = run([CORE, '--out', out, '--json']);
    assert.equal(r.status, 0);
    const result = JSON.parse(r.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.out, out);
    assert.deepEqual(result.assets, []);
    assert.equal(result.bytes, fs.statSync(out).size);
    assert.equal(result.theme, 'paper');
  } finally { done(); }
});

test('the printed theme is the one used: --theme beats spec.theme, and no theme anywhere means dusk', () => {
  const { root, done } = sandbox();
  try {
    const flagged = run([CORE, '--out', path.join(root, 'a.html'), '--theme', 'blueprint']);
    assert.match(flagged.stdout, /^theme: blueprint\nwrote /m);
    const bare = path.join(root, 'bare.explainer.json');
    fs.writeFileSync(bare, JSON.stringify({ title: 'No theme named', sections: [{ type: 'text', text: 'Plain words.' }] }));
    const plain = run([bare, '--out', path.join(root, 'b.html')]);
    assert.equal(plain.status, 0, plain.stderr + plain.stdout);
    assert.match(plain.stdout, /^theme: dusk\nwrote /m);
    assert.equal(JSON.parse(run([bare, '--out', path.join(root, 'c.html'), '--json']).stdout).theme, 'dusk');
  } finally { done(); }
});

test('a spec with errors exits 1, lists every error with its path and writes nothing', () => {
  const { root, done } = sandbox();
  try {
    const spec = path.join(root, 'bad.explainer.json');
    fs.writeFileSync(spec, JSON.stringify({ title: 'T', sections: [{ type: 'text', text: 'We leverage this' }, { type: 'text', text: 'TODO: later' }] }));
    const out = path.join(root, 'bad.html');
    const r = run([spec, '--out', out]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /sections\[0\]\.text: .*leverage/);
    assert.match(r.stdout, /sections\[1\]\.text: .*TODO/);
    assert.match(r.stdout, /bad\.explainer\.json: 2 errors/);
    assert.ok(!fs.existsSync(out));
    const j = JSON.parse(run([spec, '--out', out, '--json']).stdout);
    assert.equal(j.ok, false);
    assert.equal(j.errors.length, 2);
  } finally { done(); }
});

test('a motion section with a missing video exits 1 naming the path, and writes nothing', () => {
  const { root, done } = sandbox();
  try {
    const spec = path.join(root, 'later.explainer.json');
    fs.writeFileSync(spec, JSON.stringify({ title: 'T', sections: [{ type: 'motion', video: 'v.mp4' }] }));
    const out = path.join(root, 'later.html');
    const r = run([spec, '--out', out]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /sections\[0\]\.video: file not found: "v\.mp4"/);
    assert.ok(!fs.existsSync(out));
    assert.ok(!fs.existsSync(path.join(root, 'later.assets')));
  } finally { done(); }
});

test('a motion section builds the page and copies the video next to it', () => {
  const { root, done } = sandbox();
  try {
    fs.copyFileSync(path.join(FIXTURES, 'demo.mp4'), path.join(root, 'v.mp4'));
    const spec = path.join(root, 'ok.explainer.json');
    fs.writeFileSync(spec, JSON.stringify({ title: 'T', sections: [{ type: 'motion', title: 'Tour', video: 'v.mp4' }] }));
    const out = path.join(root, 'dist', 'ok.html');
    const r = run([spec, '--out', out, '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).assets, [path.join(root, 'dist', 'ok.assets', 'tour.mp4')]);
    assert.ok(fs.readFileSync(out, 'utf8').includes('src="ok.assets/tour.mp4"'));
    assert.deepEqual(fs.readFileSync(path.join(root, 'dist', 'ok.assets', 'tour.mp4')), fs.readFileSync(path.join(root, 'v.mp4')));
  } finally { done(); }
});

test('--theme overrides the spec theme, and an unknown theme is a spec error with a hint', () => {
  const { root, done } = sandbox();
  try {
    const a = path.join(root, 'a.html');
    const b = path.join(root, 'b.html');
    assert.equal(run([CORE, '--out', a, '--theme', 'blueprint']).status, 0);
    assert.equal(run([CORE, '--out', b]).status, 0);
    assert.notEqual(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'));
    const bad = run([CORE, '--out', path.join(root, 'c.html'), '--theme', 'blueprnt']);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /theme: unknown theme "blueprnt"; did you mean "blueprint"\?/);
  } finally { done(); }
});

test('usage problems exit 2 on stderr', () => {
  assert.equal(run([]).status, 2);
  assert.match(run([]).stderr, /expected one spec file; usage: node scripts\/build\.mjs/);
  assert.equal(run([CORE, '--nope']).status, 2);
  assert.equal(run(['missing.json']).status, 2);
  assert.match(run(['missing.json']).stderr, /cannot read missing\.json/);
  assert.equal(JSON.parse(run(['--json']).stdout).ok, false);
});

test('an unwritable destination exits 2', () => {
  const { root, done } = sandbox();
  try {
    fs.writeFileSync(path.join(root, 'file'), 'x');
    const r = run([CORE, '--out', path.join(root, 'file', 'sub', 'x.html')]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot write/);
  } finally { done(); }
});

test('rebuilding the same spec gives byte-identical output', () => {
  const { root, done } = sandbox();
  try {
    run([CORE, '--out', path.join(root, '1.html')]);
    run([CORE, '--out', path.join(root, '2.html')]);
    assert.equal(fs.readFileSync(path.join(root, '1.html'), 'utf8'), fs.readFileSync(path.join(root, '2.html'), 'utf8'));
  } finally { done(); }
});

// ---- golden: the body markup of the core fixture ---------------------------------------
// Baselines change only on purpose: UPDATE_GOLDEN=1 node --test test/build.test.mjs

test('golden: body markup of the core fixture is unchanged', () => {
  const { root, done } = sandbox();
  try {
    const out = path.join(root, 'core.html');
    assert.equal(run([CORE, '--out', out]).status, 0);
    const actual = normalisedBody(fs.readFileSync(out, 'utf8'));
    if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(GOLDEN, actual);
    assert.ok(fs.existsSync(GOLDEN), 'no golden file; create it with UPDATE_GOLDEN=1 after reviewing the output');
    assert.equal(actual, fs.readFileSync(GOLDEN, 'utf8'));
  } finally { done(); }
});

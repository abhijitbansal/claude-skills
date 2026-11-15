// build.mjs and validate.mjs flags and defaults: --strict (PA-63), --md (PA-02), and the shared default output
// folder plus the bare file:// line (PA-07). Every run is a child process in a temp folder with a fake HOME, so
// nothing is written into this checkout or the real home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const script = (name) => path.join(ROOT, 'scripts', `${name}.mjs`);

function sandbox() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-options-')));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  return { dir, home, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const run = (name, args, { home, cwd } = {}) => spawnSync(process.execPath, [script(name), ...args], {
  encoding: 'utf8', cwd, env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '', HOME: home, USERPROFILE: home },
});
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const longSpec = () => ({ title: 'A long page', sections: Array.from({ length: 12 }, (_, i) => ({ type: 'text', title: `Part ${i}`, text: `${words(100)}.` })) });
const smallSpec = () => ({ title: 'A small page', sections: [{ type: 'text', title: 'One', text: 'Short and clear.' }] });
const checklistSpec = () => ({
  title: 'Device run',
  subtitle: 'What the tests could not cover',
  sections: [{
    type: 'checklist', title: 'What to confirm', key: 'device-run', intro: 'Use a clean device.',
    groups: [
      { title: 'Pairing', intro: 'Start here.', items: [{ text: 'Pair the device', tag: 'device', tags: ['P0'], steps: ['Open Settings', 'Tap Pair'], expect: 'a green tick', note: 'twice' }, { text: 'Unpair it' }] },
    ],
    onFail: 'Tell the owner.',
  }],
});

test('--strict fails a page over the word cap (exit 1) on validate and on build; without it the page only warns', () => {
  const { dir, home, done } = sandbox();
  try {
    const spec = write(path.join(dir, 'long.explainer.json'), longSpec());
    const lax = run('validate', [spec], { home });
    assert.equal(lax.status, 0, lax.stdout);
    assert.match(lax.stdout, /warning: page has 1,200 words/);
    const strict = run('validate', [spec, '--strict'], { home });
    assert.equal(strict.status, 1, strict.stdout);
    assert.match(strict.stdout, /: page has 1,200 words of prose.*--strict/);
    const out = path.join(dir, 'long.html');
    const built = run('build', [spec, '--strict', '--out', out], { home });
    assert.equal(built.status, 1, built.stdout);
    assert.ok(!fs.existsSync(out), 'a failed strict build writes nothing');
    assert.equal(run('build', [spec, '--out', out], { home }).status, 0);
  } finally { done(); }
});

test('--strict leaves a small page valid', () => {
  const { dir, home, done } = sandbox();
  try {
    const spec = write(path.join(dir, 'small.explainer.json'), smallSpec());
    assert.equal(run('validate', [spec, '--strict'], { home }).status, 0);
  } finally { done(); }
});

test('build --md writes the markdown twin next to the page and reports it', () => {
  const { dir, home, done } = sandbox();
  try {
    const spec = write(path.join(dir, 'device.explainer.json'), checklistSpec());
    const out = path.join(dir, 'pages', 'device.html');
    const r = run('build', [spec, '--out', out, '--md'], { home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const twin = path.join(dir, 'pages', 'device.md');
    assert.match(r.stdout, new RegExp(`wrote ${twin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.equal(fs.readFileSync(twin, 'utf8'), [
      '# Device run',
      '',
      'What the tests could not cover',
      '',
      '## What to confirm',
      '',
      'Use a clean device.',
      '',
      '### Pairing',
      '',
      'Start here.',
      '',
      '- [ ] Pair the device `device` `P0` — twice',
      '  1. Open Settings',
      '  2. Tap Pair',
      '  - You should see: a green tick',
      '- [ ] Unpair it',
      '',
      '### If something fails',
      '',
      'Tell the owner.',
      '',
    ].join('\n'));
    const json = JSON.parse(run('build', [spec, '--out', out, '--md', '--json'], { home }).stdout);
    assert.equal(json.md, twin);
  } finally { done(); }
});

test('build --md on a spec with no checklist exits 1 and writes neither file', () => {
  const { dir, home, done } = sandbox();
  try {
    const spec = write(path.join(dir, 'small.explainer.json'), smallSpec());
    const out = path.join(dir, 'small.html');
    const r = run('build', [spec, '--out', out, '--md'], { home });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /sections: --md writes the markdown twin of a checklist/);
    assert.ok(!fs.existsSync(out) && !fs.existsSync(path.join(dir, 'small.md')));
  } finally { done(); }
});

test('without --out a spec inside a git repository builds into <git root>/.scratch and the last line is the bare file:// URL', () => {
  const { dir, home, done } = sandbox();
  try {
    fs.mkdirSync(path.join(dir, 'repo', '.git'), { recursive: true });
    const spec = write(path.join(dir, 'repo', 'docs', 'small.explainer.json'), smallSpec());
    const r = run('build', [spec], { home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const page = path.join(dir, 'repo', '.scratch', 'a-small-page.html');
    assert.ok(fs.existsSync(page), r.stdout);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines.at(-1), pathToFileURL(page).href, 'the URL is alone on the last line, with no label');
    assert.equal(lines.at(-2), `wrote ${page}`);
  } finally { done(); }
});

test('without --out a spec outside any repository builds into ~/.agent/diagrams; PA_OUTPUT_DIR wins over both', () => {
  const { dir, home, done } = sandbox();
  try {
    const spec = write(path.join(dir, 'loose', 'small.explainer.json'), smallSpec());
    const r = run('build', [spec], { home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(home, '.agent', 'diagrams', 'a-small-page.html')), r.stdout);
    const elsewhere = path.join(dir, 'elsewhere');
    const env = spawnSync(process.execPath, [script('build'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: elsewhere, HOME: home, USERPROFILE: home } });
    assert.equal(env.status, 0, env.stdout + env.stderr);
    assert.ok(fs.existsSync(path.join(elsewhere, 'a-small-page.html')));
  } finally { done(); }
});

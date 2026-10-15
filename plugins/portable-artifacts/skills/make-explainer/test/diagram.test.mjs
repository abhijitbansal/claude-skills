import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage, BuildError } from '../scripts/lib/page.mjs';
import { DIAGRAM_MAX_BYTES } from '../scripts/lib/diagram-source.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function folder(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-diagram-')));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const flow = (title = 'Request path', extra = {}) => ({
  title,
  type: 'flow',
  nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Server' }],
  edges: [{ from: 'a', to: 'b', label: 'GET' }],
  ...extra,
});
const doc = (sections, extra = {}) => ({ title: 'Doc', sections, ...extra });
const section = (diagram, extra = {}) => ({ type: 'diagram', diagram, ...extra });
const errorsOf = async (spec, dir) => (await validateSpec(spec, { dir })).errors;
const text = { type: 'text', text: 'x' };

// ---- validation -------------------------------------------------------------------------

test('a valid inline diagram and a valid diagram file both validate', async () => {
  const dir = folder({ 'flow.diagram.json': flow() });
  assert.deepEqual(await errorsOf(doc([section(flow())]), dir), []);
  assert.deepEqual(await errorsOf(doc([section('flow.diagram.json')]), dir), []);
});

test('errors in an embedded spec are re-pathed under sections[i].diagram', async () => {
  const dir = folder();
  const bad = flow('Request path', { edges: [{ from: 'a', to: 'zz' }], bogus: 1, type: 'flows' });
  const errors = await errorsOf(doc([text, section(bad)]), dir);
  const paths = errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ['sections[1].diagram.bogus', 'sections[1].diagram.type']);
  assert.match(errors.find((e) => e.path.endsWith('.type')).message, /did you mean "flow"/);

  const semantic = await errorsOf(doc([section(flow('T', { edges: [{ from: 'a', to: 'zz' }] }))]), dir);
  assert.deepEqual(semantic.map((e) => e.path), ['sections[0].diagram.edges[0].to']);
  assert.match(semantic[0].message, /"zz" not found; did you mean "a"\?/);
});

test('a diagram missing a required field is reported at the field', async () => {
  const errors = await errorsOf(doc([section({ type: 'flow', nodes: [{ id: 'a', label: 'A' }] })]), folder());
  assert.deepEqual(errors, [{ path: 'sections[0].diagram.title', message: 'required' }]);
});

test('errors in a diagram file are re-pathed the same way and name the file', async () => {
  const dir = folder({ 'x.diagram.json': flow('T', { edges: [{ from: 'a', to: 'zz' }] }) });
  const errors = await errorsOf(doc([text, text, section('x.diagram.json')]), dir);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[2].diagram.edges[0].to');
  assert.match(errors[0].message, /"zz" not found/);
  assert.match(errors[0].message, /\(in x\.diagram\.json\)/);
});

test('an embedded diagram theme is ignored with a warning; the page theme is used', async () => {
  const dir = folder({ 't.diagram.json': flow('T', { theme: 'no-such-theme' }) });
  const warning = (theme, file) => [{ path: 'sections[0].diagram.theme', message: `ignored — the page theme (${JSON.stringify(theme)}) is used; remove it or change the explainer's theme${file ? ` (in ${file})` : ''}` }];
  for (const [diagram, file] of [[flow('T', { theme: 'no-such-theme' }), undefined], ['t.diagram.json', 't.diagram.json']]) {
    const inkPage = await validateSpec(doc([section(diagram)], { theme: 'ink' }), { dir });
    assert.equal(inkPage.ok, true, JSON.stringify(inkPage.errors));
    assert.deepEqual(inkPage.warnings, warning('ink', file));
    assert.deepEqual((await validateSpec(doc([section(diagram)]), { dir })).warnings, warning('paper', file));
  }
  assert.deepEqual((await validateSpec(doc([section(flow())]), { dir })).warnings, [], 'no theme, no warning');
  const { html } = await buildPage(doc([section(flow('T', { theme: 'no-such-theme' }))], { theme: 'ink' }), { dir });
  assert.match(html, /class="pa-diagram/);
});

test('a layout failure in the embedded spec is reported before the build', async () => {
  // 61 nodes is over make-diagram's limit; the message comes from make-diagram unchanged.
  const nodes = Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
  const errors = await errorsOf(doc([section({ title: 'Big', type: 'flow', nodes })]), folder());
  assert.ok(errors.length > 0);
  assert.ok(errors.every((e) => e.path.startsWith('sections[0].diagram')), JSON.stringify(errors));
});

test('a blank diagram string is reported once, by the section check', async () => {
  const errors = await errorsOf(doc([section('  ')]), folder());
  assert.deepEqual(errors, [{ path: 'sections[0].diagram', message: 'must contain at least one non-space character' }]);
});

// ---- path rules (Review Focus 4) ----------------------------------------------------------

test('a diagram path must be a json file inside the spec folder, not a symlink', async () => {
  const root = folder({ 'spec/ok.diagram.json': flow(), 'secret.diagram.json': flow(), 'spec/notes.txt': 'x', 'spec/bad.diagram.json': '{ nope', 'spec/list.diagram.json': '[1]', 'spec/huge.diagram.json': `{${' '.repeat(DIAGRAM_MAX_BYTES)}}` });
  const dir = path.join(root, 'spec');
  fs.symlinkSync(path.join(root, 'secret.diagram.json'), path.join(dir, 'link.diagram.json'));
  fs.symlinkSync(root, path.join(dir, 'up'));
  const at = async (p) => (await errorsOf(doc([section(p)]), dir)).map((e) => `${e.path}: ${e.message}`);

  assert.deepEqual(await at('ok.diagram.json'), []);
  assert.deepEqual(await at('../secret.diagram.json'), [`sections[0].diagram: "../secret.diagram.json" is outside the spec folder; move the file under ${dir} and use a relative path`]);
  assert.deepEqual(await at(path.join(root, 'secret.diagram.json')), [`sections[0].diagram: ${JSON.stringify(path.join(root, 'secret.diagram.json'))} is absolute; use a path relative to the spec folder`]);
  assert.match((await at('link.diagram.json'))[0], /^sections\[0\]\.diagram: "link\.diagram\.json" goes through a symlink/);
  assert.match((await at('up/secret.diagram.json'))[0], /goes through a symlink/);
  assert.match((await at('missing.diagram.json'))[0], /^sections\[0\]\.diagram: file not found: "missing\.diagram\.json"/);
  assert.match((await at('notes.txt'))[0], /must be a \.json file/);
  assert.match((await at('bad.diagram.json'))[0], /^sections\[0\]\.diagram: "bad\.diagram\.json" is not valid JSON: /);
  assert.match((await at('list.diagram.json'))[0], /must hold one JSON object/);
  assert.match((await at('huge.diagram.json'))[0], /^sections\[0\]\.diagram: "huge\.diagram\.json" is 1024 KB; the limit is 1024 KB — split the diagram/);
});

test('building a spec whose diagram file is missing is a BuildError at the field', async () => {
  const dir = folder();
  await assert.rejects(buildPage(doc([section('gone.diagram.json')]), { dir }), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[0].diagram');
    assert.match(e.errors[0].message, /file not found/);
    return true;
  });
});

test('building an invalid embedded spec is a BuildError with re-pathed errors', async () => {
  await assert.rejects(buildPage(doc([text, section(flow('T', { edges: [{ from: 'a', to: 'zz' }] }))]), { dir: folder() }), (e) => {
    assert.ok(e instanceof BuildError);
    assert.deepEqual(e.errors.map((x) => x.path), ['sections[1].diagram.edges[0].to']);
    return true;
  });
});

// ---- missing make-diagram ---------------------------------------------------------------

// The skill copied next to no make-diagram: the sibling lookup must fail the way an install without it would.
function skillWithoutSibling(fake = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-nosib-')));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  for (const name of ['scripts', 'shared', 'template', 'references', 'package.json']) fs.cpSync(path.join(SKILL, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  for (const [rel, body] of Object.entries(fake)) {
    const file = path.join(root, 'make-diagram', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'function' ? body(pathToFileURL(path.join(copy, 'scripts/lib/siblings.mjs')).href) : body);
  }
  return { root, copy };
}
const INSTALL = 'npx skills add abhijitbansal/claude-skills --skill make-explainer make-diagram';

test('without make-diagram, validate exits 1 with the install command', () => {
  const { root, copy } = skillWithoutSibling();
  const spec = path.join(root, 'd.explainer.json');
  fs.writeFileSync(spec, JSON.stringify(doc([section(flow())])));
  const r = spawnSync(process.execPath, [path.join(copy, 'scripts/validate.mjs'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /sections\[0\]\.diagram: make-diagram skill not found next to make-explainer/);
  assert.ok(r.stdout.includes(`install it with: ${INSTALL}`), r.stdout);
});

test('without make-diagram, buildPage lets the SiblingError through unchanged', async () => {
  const { root, copy } = skillWithoutSibling();
  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  await assert.rejects(page.buildPage(doc([section(flow())]), { dir: root }), (e) => {
    assert.equal(e.name, 'SiblingError');
    assert.equal(e.command, INSTALL);
    assert.ok(e.message.includes(`install it with: ${INSTALL}`));
    return true;
  });
  // A page with no diagram never needs the sibling.
  assert.match((await page.buildPage(doc([text]), { dir: root })).html, /<!doctype html>/);
});

// ---- rendering --------------------------------------------------------------------------

const build = (sections, extra = {}) => buildPage(doc(sections, extra), { dir: folder() });
const idsOf = (html) => [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

test('two diagrams on one page share no ids, and the css and runtime ship once', async () => {
  const { html } = await build([section(flow('First'), { title: 'One' }), text, section(flow('Second'), { title: 'Two' })]);
  const ids = idsOf(html);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  assert.equal((html.match(/\.pa-dim\{/g) ?? []).length, 1, 'diagram css once');
  assert.equal((html.match(/PADiagram\.mount = mount;/g) ?? []).length, 1, 'viewer runtime once');
  assert.equal((html.match(/<svg[^>]*class="pa-diagram/g) ?? []).length, 2);
  assert.equal((html.match(/<button[^>]*data-dg-present/g) ?? []).length, 2);
});

test('a page without a diagram ships no diagram css, runtime or markup', async () => {
  const { html } = await build([text]);
  assert.ok(!html.includes('PADiagram'));
  assert.ok(!html.includes('.pa-dim{'));
  assert.ok(!html.includes('data-diagram'));
});

test('the diagram figure carries its caption, a Present button and a dialog holding the whole viewer', async () => {
  const { html } = await build([section(flow('Request path'), { caption: 'How a **request** flows' })]);
  assert.match(html, /<figcaption>How a <strong>request<\/strong> flows<\/figcaption>/);
  assert.match(html, /<button type="button" class="btn dg-present" data-dg-present aria-haspopup="dialog"[^>]*>Present/);
  assert.match(html, /<dialog class="dg-overlay" data-dg-dialog aria-label="Diagram presentation: Request path"/);
  // Only the dialog's markup: the inlined viewer runtime mentions these hooks too.
  const dialog = html.match(/<dialog class="dg-overlay"[\s\S]*?<\/dialog>/)[0];
  for (const part of ['data-pa-mode="play"', 'data-pa-mode="explore"', 'data-pa-find', 'data-pa-full', 'data-dg-close', 'data-pa-chapters', 'data-pa-found', 'data-pa-tip', 'data-pa-panel', 'data-pa-panel-title', 'data-pa-panel-close', 'data-pa-tally', 'data-pa-panel-body',
    'data-pa-caption', 'data-pa-line', 'data-pa-beats', 'data-pa-prev-chapter', 'data-pa-prev', 'data-pa-play', 'data-pa-next', 'data-pa-next-chapter', 'data-pa-scrub', 'data-pa-ticks', 'data-pa-count', 'data-pa-speed', 'data-pa-loop']) assert.ok(dialog.includes(part), part);
  assert.ok(!dialog.includes('data-pa-title') && !dialog.includes('data-pa-note'), 'the caption line replaces the older title and note parts');
  assert.match(html, /<input type="range" class="dg-scrub" data-pa-scrub[^>]* list="dg_0-ticks">/);
  assert.match(html, /<datalist id="dg_0-ticks" data-pa-ticks><\/datalist>/);
});

test('each figure prefixes its scrubber datalist id, so two overlays share no id', async () => {
  const { html } = await build([section(flow('First')), text, section(flow('Second'))]);
  assert.match(html, /id="dg_0-ticks"/);
  assert.match(html, /id="dg_2-ticks"/);
  assert.equal((html.match(/<datalist[^>]*data-pa-ticks/g) ?? []).length, 2);
});

test('diagram text from the spec is escaped, in the svg and in the data block', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { html } = await build([section(flow('</script><b>t</b>', { nodes: [{ id: 'a', label: evil }, { id: 'b', label: 'B' }] }))]);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>t</b>'));
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g);
  for (const s of scripts) assert.equal((s.match(/<\/script/gi) ?? []).length, 1);
});

test('the CSP is unchanged by a diagram', async () => {
  const { html } = await build([section(flow())]);
  assert.ok(html.includes("content=\"default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:\""));
});

test('slides mode renders the same figure inside its slide', async () => {
  const { html } = await build([section(flow('Request path'), { title: 'The path' })], { mode: 'slides' });
  assert.match(html, /<section class="slide slide-diagram" id="slide-2"/);
  assert.match(html, /data-dg-present/);
  assert.equal((html.match(/PADiagram\.mount = mount;/g) ?? []).length, 1);
});

test('a diagram file is loaded relative to the spec folder', async () => {
  const dir = folder({ 'sub/f.diagram.json': flow('From file') });
  const { html } = await buildPage(doc([section('sub/f.diagram.json')]), { dir });
  assert.match(html, /<title id="dg_0-title">From file<\/title>/);
});

// ---- the sibling contract: api.mjs only -----------------------------------------------------

const FAKE_API = (extra) => (siblings) => `import { SiblingError } from '${siblings}';
export const viewerRuntime = () => '/* fake */';
${extra}`;

test('the check loads make-diagram through api.mjs alone, and a make-diagram without validateSpec says so', async () => {
  const ok = skillWithoutSibling({ 'scripts/lib/api.mjs': FAKE_API('export const validateSpec = async () => ({ ok: true, errors: [] });\nexport const buildDiagram = async () => { throw new Error("unused"); };') });
  const { validateSpec: validate } = await import(pathToFileURL(path.join(ok.copy, 'scripts/lib/spec.mjs')).href);
  const r = await validate(doc([section(flow())]), { dir: ok.root });
  assert.deepEqual(r.errors, [], 'a make-diagram that only has api.mjs is enough');

  const old = skillWithoutSibling({ 'scripts/lib/api.mjs': FAKE_API('export const buildDiagram = async () => ({});') });
  const { validateSpec: validateOld } = await import(pathToFileURL(path.join(old.copy, 'scripts/lib/spec.mjs')).href);
  const errors = (await validateOld(doc([section(flow())]), { dir: old.root })).errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].diagram');
  assert.match(errors[0].message, /make-diagram is too old \(no validateSpec in api\.mjs\)/);
  assert.match(errors[0].message, /reinstall with npx --yes skills@1\.7\.2 add abhijitbansal\/claude-skills --skill make-diagram -y, then run npm ci --omit=dev --prefix /);
  assert.doesNotMatch(errors[0].message, /doctor/);
});

test('build() turns a SiblingError from the page build into a failure with a path, not a stack', async () => {
  const { root, copy } = skillWithoutSibling({
    'scripts/lib/api.mjs': FAKE_API(`export const validateSpec = async () => ({ ok: true, errors: [] });
export const buildDiagram = async () => { throw new SiblingError('make-diagram vanished; install it with: ${INSTALL}', ${JSON.stringify(INSTALL)}); };`),
  });
  const spec = path.join(root, 'd.explainer.json');
  fs.writeFileSync(spec, JSON.stringify(doc([section(flow())])));
  const { build } = await import(pathToFileURL(path.join(copy, 'scripts/build.mjs')).href);
  const result = await build(spec, { out: path.join(root, 'out.html') });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.path), ['sections']);
  assert.ok(result.errors[0].message.includes(`install it with: ${INSTALL}`));
});

test('the figcaption is the last child of the figure', async () => {
  const { html } = await build([section(flow(), { caption: 'Cap' })]);
  assert.match(html, /<figcaption>Cap<\/figcaption>\n<\/figure>/);
});

test('page.mjs holds no diagram-specific wiring; the section registry carries the page parts', async () => {
  const { SECTIONS } = await import('../scripts/lib/sections.mjs');
  assert.equal(typeof SECTIONS.diagram.page, 'function');
  // (the cards icon loader names the make-diagram skill; that is not diagram-section wiring)
  assert.ok(!/diagram/i.test(fs.readFileSync(path.join(SKILL, 'scripts/lib/page.mjs'), 'utf8').replaceAll('make-diagram', '')));
});

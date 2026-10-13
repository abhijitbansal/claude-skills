// Final fix wave B1: reserved ids, lint exemptions, stale assets, KPI numbers, deterministic
// interactive builds, section-title links, emoji lint, motion env, JSON error location,
// SVG sanitiser, and the scaffold fit / git env fixes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage } from '../scripts/lib/page.mjs';
import { build } from '../scripts/build.mjs';
import { lintText } from '../scripts/lib/lint.mjs';
import { svgProblem } from '../scripts/lib/image.mjs';
import { SECTIONS } from '../scripts/lib/sections.mjs';
import { fit, cleanText } from '../scripts/lib/fit.mjs';
import { childEnv } from '../scripts/lib/motion-render.mjs';
import { gitEnv } from '../scripts/lib/git.mjs';
import { pruneAssets } from '../scripts/lib/assets.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(SKILL, 'test/fixtures');
const CHART_FIXTURE = path.join(FIXTURES, 'chart');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const tmp = (prefix = 'explainer-hardening-') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};
const SCRIPT = (name) => path.join(SKILL, 'scripts', name);
const doc = (sections, extra = {}) => ({ title: 'T', sections, ...extra });
const text = (t = 'Body.', extra = {}) => ({ type: 'text', text: t, ...extra });
const errorsOf = async (spec, dir = FIXTURES) => (await validateSpec(spec, { dir })).errors.map((e) => `${e.path}: ${e.message}`);

// ---- 1. reserved ids -------------------------------------------------------------------------

test('reserved ids: ids the page shell and renderers use are validation errors with the path and the fix', async () => {
  for (const id of ['content', 'outline-title', 'slide-3', 'slide-12-title', 'ch0-lw-clip3', 'ch2-anything']) {
    const errors = await errorsOf(doc([text('a'), text('b', { id })]));
    assert.equal(errors.length, 1, id);
    assert.match(errors[0], new RegExp(`^sections\\[1\\]\\.id: id "${id}" is reserved by the page; pick another id, such as "overview"`), id);
  }
});

test('reserved ids: ordinary ids that merely look similar stay valid', async () => {
  for (const id of ['contents', 'content-notes', 'slide', 'slides-2', 'chart-1', 'chat', 'outline']) {
    assert.deepEqual(await errorsOf(doc([text('a', { id })])), [], id);
  }
});

test('a page never has two elements with one id (every example and the all-types fixture)', async () => {
  const files = [
    ...fs.readdirSync(path.join(SKILL, 'references/examples')).filter((f) => f.endsWith('.explainer.json')).map((f) => path.join(SKILL, 'references/examples', f)),
    path.join(FIXTURES, 'all-types.explainer.json'),
  ];
  for (const file of files) {
    const { spec, dir } = loadSpec(file);
    const { html } = await buildPage(spec, { dir, out: path.join(tmp(), 'page.html') });
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], path.basename(file));
  }
});

// ---- 2. banned phrases in non-prose ----------------------------------------------------------

test('banned phrases are not reported inside link URLs, code spans or bare URLs', () => {
  const P = 'sections[0].text';
  const errors = (t) => lintText(t, P).errors;
  assert.deepEqual(errors('See [the docs](https://example.com/leverage-guide) now.'), []);
  assert.deepEqual(errors('Call `leverage()` to start.'), []);
  assert.deepEqual(errors('Call `utilize` twice, then `delve`.'), []);
  assert.deepEqual(errors('Read https://example.com/leverage/utilize?delve=1 first.'), []);
  assert.deepEqual(errors('A link with parens [x](https://example.com/a_(leverage)) here.'), []);
});

test('banned phrases are still reported in link labels and plain prose next to code or links', () => {
  const P = 'sections[0].text';
  const errors = (t) => lintText(t, P).errors.map((e) => e.message);
  assert.deepEqual(errors('See [leverage](https://example.com/x).'), ['banned phrase "leverage"; replace it with "use"']);
  assert.deepEqual(errors('We leverage `cache` and [docs](https://example.com).'), ['banned phrase "leverage"; replace it with "use"']);
  assert.deepEqual(errors('An unclosed `tick leverage stays prose'), ['banned phrase "leverage"; replace it with "use"']);
});

test('table cells are data, not prose: no banned-phrase error, but emoji and placeholders still fail', async () => {
  const table = (rows, extra = {}) => ({ type: 'table', columns: ['Command', 'Note'], rows, ...extra });
  assert.deepEqual(await errorsOf(doc([table([['git leverage', 'uses utilize']])])), []);
  const bad = await errorsOf(doc([table([['ok', 'TODO: fill']])]));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /^sections\[0\]\.rows\[0\]\[1\]: still has a TODO placeholder/);
  const emoji = await errorsOf(doc([table([['ok', 'done \u{1F680}']])]));
  assert.match(emoji[0], /^sections\[0\]\.rows\[0\]\[1\]: contains emoji/);
});

test('captions and table headers are prose: a banned phrase there is still an error, and the fix is to reword', async () => {
  const caption = await errorsOf(doc([{ type: 'table', columns: ['A'], rows: [['x']], caption: 'We leverage this' }]));
  assert.deepEqual(caption, ['sections[0].caption: banned phrase "leverage"; replace it with "use"']);
  const header = await errorsOf(doc([{ type: 'table', columns: ['Leverage'], rows: [['x']] }]));
  assert.match(header[0], /^sections\[0\]\.columns\[0\]: banned phrase "Leverage"/);
  // the same word inside backticks in a caption is fine
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['A'], rows: [['x']], caption: 'Output of `leverage`' }])), []);
});

// ---- 3. stale assets -------------------------------------------------------------------------

const put = (file, content = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };

test('pruneAssets removes files the build no longer writes, keeps the ones it does, and drops emptied folders', () => {
  const root = tmp();
  const dir = path.join(root, 'page.assets');
  put(path.join(dir, 'keep.mp4'));
  put(path.join(dir, 'old.mp4'));
  put(path.join(dir, 'chart-a', 'index.html'));
  put(path.join(dir, 'chart-a', 'extra', 'deep.txt'));
  const removed = pruneAssets(dir, [path.join(dir, 'keep.mp4')]);
  assert.deepEqual(fs.readdirSync(dir), ['keep.mp4']);
  assert.deepEqual(removed.sort(), [path.join(dir, 'chart-a', 'extra', 'deep.txt'), path.join(dir, 'chart-a', 'index.html'), path.join(dir, 'old.mp4')].sort());
});

test('pruneAssets removes the assets folder itself when nothing is written any more, never touches siblings', () => {
  const root = tmp();
  const dir = path.join(root, 'page.assets');
  put(path.join(dir, 'old.mp4'));
  put(path.join(root, 'page.html'));
  put(path.join(root, 'other.assets', 'keep.txt'));
  pruneAssets(dir, []);
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(root, 'page.html')));
  assert.ok(fs.existsSync(path.join(root, 'other.assets', 'keep.txt')));
});

test('pruneAssets never follows or deletes symlinks, and leaves a symlinked assets folder alone', () => {
  const root = tmp();
  const outside = path.join(root, 'outside');
  put(path.join(outside, 'precious.txt'), 'keep me');
  const dir = path.join(root, 'page.assets');
  put(path.join(dir, 'old.mp4'));
  fs.symlinkSync(outside, path.join(dir, 'linked-dir'));
  fs.symlinkSync(path.join(outside, 'precious.txt'), path.join(dir, 'linked-file'));
  pruneAssets(dir, []);
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me');
  assert.ok(fs.lstatSync(path.join(dir, 'linked-dir')).isSymbolicLink(), 'symlinks stay');
  assert.ok(fs.lstatSync(path.join(dir, 'linked-file')).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(dir, 'old.mp4')));

  const real = path.join(root, 'real.assets');
  put(path.join(real, 'a.txt'));
  const link = path.join(root, 'link.assets');
  fs.symlinkSync(real, link);
  pruneAssets(link, []);
  assert.ok(fs.existsSync(path.join(real, 'a.txt')), 'a symlinked assets folder is not entered');
  assert.equal(pruneAssets(path.join(root, 'missing.assets'), []).length, 0, 'a missing folder is fine');
});

function chartFolder(files = {}) {
  const dir = tmp('explainer-assets-');
  fs.cpSync(CHART_FIXTURE, dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) put(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}
const dash = (extra = {}) => ({ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', ...extra });

test('a rebuild removes assets of a renamed chart and of a section that stopped being interactive', async () => {
  const dir = chartFolder();
  const out = path.join(dir, 'out', 'page.html');
  const specFile = path.join(dir, 'doc.explainer.json');
  const write = (sections) => fs.writeFileSync(specFile, JSON.stringify(doc(sections)));

  write([dash({ interactive: true })]);
  assert.equal((await build(specFile, { out })).ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'page.assets', 'by-region', 'index.html')));

  write([dash({ chart: 'weekly', interactive: true })]);
  const renamed = await build(specFile, { out });
  assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
  assert.ok(fs.existsSync(path.join(dir, 'out', 'page.assets', 'weekly', 'index.html')));
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'page.assets', 'by-region')), 'the renamed chart left no folder behind');

  write([dash()]);
  assert.equal((await build(specFile, { out })).ok, true);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'page.assets')), 'no interactive section, no assets folder');
  assert.ok(fs.existsSync(out));
});

test('a failed build removes nothing', async () => {
  const dir = chartFolder();
  const out = path.join(dir, 'out', 'page.html');
  const specFile = path.join(dir, 'doc.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(doc([dash({ interactive: true })])));
  assert.equal((await build(specFile, { out })).ok, true);
  fs.writeFileSync(specFile, JSON.stringify(doc([dash({ chart: 'nope', interactive: true })])));
  assert.equal((await build(specFile, { out })).ok, false);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'page.assets', 'by-region', 'index.html')));
});

// ---- 4. KPI numbers --------------------------------------------------------------------------

const ctx = { dir: FIXTURES, icons: null, theme: null, mode: 'page', slug: 'page', assetsDir: FIXTURES, idFor: () => 'sec' };
const kpiValues = (items) => [...SECTIONS.kpis.render({ type: 'kpis', items }, ctx).matchAll(/<dd class="kpi-value">([^<]*)<\/dd>/g)].map((m) => m[1]);

test('KPI numbers render with thousands separators; strings are shown as written', () => {
  assert.deepEqual(
    kpiValues([{ label: 'a', value: 51301 }, { label: 'b', value: 7 }, { label: 'c', value: 1234567 }, { label: 'd', value: -2500 }, { label: 'e', value: 1234.5 }, { label: 'f', value: 0 }]),
    ['51,301', '7', '1,234,567', '-2,500', '1,234.5', '0'],
  );
  assert.deepEqual(kpiValues([{ label: 'a', value: '51301' }, { label: 'b', value: '12k' }, { label: 'c', value: '2026' }]), ['51301', '12k', '2026']);
});

// ---- 5. deterministic interactive builds -----------------------------------------------------

// DuckDB returns tied rows in any order, so a query that sorts only by day can differ between runs. The
// fixture's "weekly" query does; this test uses a copy that sorts by a full key.
const DETERMINISTIC_DASHBOARD = JSON.parse(fs.readFileSync(path.join(CHART_FIXTURE, 'sales.dashboard.json'), 'utf8'));
DETERMINISTIC_DASHBOARD.queries.weekly = DETERMINISTIC_DASHBOARD.queries.weekly.replace('ORDER BY 1', 'ORDER BY 1, 2');

test('an interactive build is byte-deterministic: two builds give identical assets', async () => {
  const dir = chartFolder({ 'sales.dashboard.json': DETERMINISTIC_DASHBOARD });
  const specFile = path.join(dir, 'doc.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(doc([dash({ interactive: true })])));
  // One process per build, as a user runs it (Vega numbers clip paths from a process-wide counter).
  const readAsset = (out) => {
    const r = spawnSync(process.execPath, [SCRIPT('build.mjs'), specFile, '--out', out, '--json'], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return { page: fs.readFileSync(out), asset: fs.readFileSync(JSON.parse(r.stdout).assets[0]) };
  };
  const first = readAsset(path.join(dir, 'one', 'p.html'));
  await new Promise((resolve) => setTimeout(resolve, 1100)); // a wall-clock stamp would differ by now
  const second = readAsset(path.join(dir, 'two', 'p.html'));
  assert.ok(first.asset.equals(second.asset), 'the dashboard asset is identical');
  assert.ok(first.page.equals(second.page), 'the page is identical');
});

test('the dashboard stamp follows the newest input, so editing data changes it', async () => {
  const dir = chartFolder();
  const specFile = path.join(dir, 'doc.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(doc([dash({ interactive: true })])));
  const old = new Date('2026-01-02T03:04:05Z');
  for (const f of ['sales.dashboard.json', 'sales.csv']) fs.utimesSync(path.join(dir, f), old, old);
  const r = await build(specFile, { out: path.join(dir, 'o', 'p.html') });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.match(fs.readFileSync(r.assets[0], 'utf8'), /2026-01-02T03:04:05\.000Z/);
});

// ---- 6. section title links ------------------------------------------------------------------

test('a link in a section title renders as its text, other inline markup stays', async () => {
  const spec = doc([text('a', { title: 'See [the docs](https://example.com/x) for **bold** and `code`' })]);
  const { html } = await buildPage(spec, { dir: FIXTURES, out: path.join(tmp(), 'p.html') });
  const h2 = /<h2 class="sec-title"[^>]*>(.*?)<\/h2>/s.exec(html)[1];
  assert.ok(!h2.includes('href="https://example.com'), h2);
  assert.match(h2, /^See the docs for <strong>bold<\/strong> and <code>code<\/code><a class="anchor"/);
});

test('a link in a slide title renders as its text', async () => {
  const spec = doc([text('a', { title: 'See [the docs](https://example.com/x)' })], { mode: 'slides' });
  const { html } = await buildPage(spec, { dir: FIXTURES, out: path.join(tmp(), 'p.html') });
  const h2 = /<h2 class="slide-title"[^>]*>(.*?)<\/h2>/s.exec(html)[1];
  assert.equal(h2, 'See the docs');
});

// ---- 7. emoji lint ---------------------------------------------------------------------------

const emojiErrors = (t) => lintText(t, 'p').errors.filter((e) => e.message.startsWith('contains emoji'));

test('text-presentation symbols are allowed', () => {
  for (const t of ['sync ↔ server', 'play ▶ now', 'info ℹ note', 'next → step', 'done ✓', 'warn ⚠ here', 'heart ❤ ok', 'sun ☀ shine', 'check ✔ done', 'star ★ ☆']) {
    assert.deepEqual(emojiErrors(t), [], t);
  }
});

test('emoji-presentation characters, and symbols followed by VS16, stay errors', () => {
  for (const t of ['rocket \u{1F680}', 'done ✅', 'ok ✨', 'star ⭐', 'no ❌', 'arrow ↔️', 'heart ❤️', 'play ▶️', 'info ℹ️', 'flag \u{1F1FA}\u{1F1F8}', 'key 1️⃣', 'hand ☝\u{1F3FD}', 'family \u{1F468}‍\u{1F469}‍\u{1F467}', 'spider \u{1F577}']) {
    assert.equal(emojiErrors(t).length, 1, t);
  }
  assert.equal(emojiErrors('© ® ™').length, 0);
});

// ---- 8. motion child env ---------------------------------------------------------------------

test('the make-motion child gets the environment without EVAL_LOG', () => {
  const env = childEnv({ PATH: '/bin', HOME: '/h', EVAL_LOG: '/tmp/log', PA_MOTION_TIMEOUT_MS: '5', OTHER: 'x' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', PA_MOTION_TIMEOUT_MS: '5', OTHER: 'x' });
  assert.ok(!Object.hasOwn(env, 'EVAL_LOG'));
});

// ---- 9. JSON error location ------------------------------------------------------------------

const runCli = (script, args) => spawnSync(process.execPath, [SCRIPT(script), ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });
const BAD = '{\n  "title": "T",\n  "sections": [\n    { "type": "text", "text": "x", },\n    { "type": "text", "text": "y" }\n  ]\n}\n';
const BAD_COLUMN = BAD.split('\n')[3].lastIndexOf('}') + 1; // the "}" after the trailing comma

test('loadSpec names the line and column of a JSON syntax error', () => {
  const dir = tmp();
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, BAD);
  let caught;
  try { loadSpec(file); } catch (e) { caught = e; }
  assert.ok(caught.message.includes(`bad.json is not valid JSON: unexpected "}" at line 4, column ${BAD_COLUMN}; remove the trailing comma before it`), caught.message);
  assert.equal(caught.snippet, `  { "type": "text", "text": "x", },\n${' '.repeat(2 + BAD_COLUMN - 1 - 4)}^`);
});

test('validate shows the offending line with a caret, in text and in --json', () => {
  const dir = tmp();
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, BAD);
  const text = runCli('validate.mjs', [file]);
  assert.equal(text.status, 2);
  const lines = text.stderr.trimEnd().split('\n');
  assert.equal(lines.length, 3, text.stderr);
  assert.ok(lines[0].includes(`at line 4, column ${BAD_COLUMN}`), lines[0]);
  assert.equal(lines[1], '  { "type": "text", "text": "x", },');
  assert.equal(lines[2].indexOf('^'), lines[1].indexOf('}'));

  const json = JSON.parse(runCli('validate.mjs', [file, '--json']).stdout);
  assert.equal(json.ok, false);
  const [m0, m1, m2] = json.errors[0].message.split('\n');
  assert.match(m0, /is not valid JSON/);
  assert.equal(m1, lines[1]);
  assert.equal(m2.indexOf('^'), m1.indexOf('}'));
});

test('build shows the same line and caret', () => {
  const dir = tmp();
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, BAD);
  const r = runCli('build.mjs', [file, '--out', path.join(dir, 'o.html')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`bad\\.json is not valid JSON: .*line 4, column ${BAD_COLUMN}[^\\n]*\\n  \\{ "type": "text", "text": "x", \\},\\n +\\^\\n$`));
});

test('JSON errors: end of input, long lines are trimmed around the column, tabs and CRLF are handled', () => {
  const dir = tmp();
  const at = (content) => {
    const file = path.join(dir, `f${Math.random()}.json`);
    fs.writeFileSync(file, content);
    try { loadSpec(file); } catch (e) { return e; }
    return assert.fail('should throw');
  };
  const eof = at('{\n  "title": "T",\n  "sections": [');
  assert.match(eof.message, /unexpected end of input.*line 3, column 16/);
  assert.equal(eof.snippet.split('\n')[0], '  "sections": [');

  const wide = at(`{"title":"${'a'.repeat(300)}", "x": ??? , "tail": "${'b'.repeat(300)}"}`);
  const [shown, caret] = wide.snippet.split('\n');
  assert.ok(shown.length <= 2 + 120 + 2, `trimmed to about 120 chars, got ${shown.length}`);
  assert.ok(shown.includes('???') && shown.includes('…'));
  assert.equal(caret.indexOf('^'), shown.indexOf('?'));

  const crlf = at('{\r\n\t"a": 1,\r\n}\r\n');
  assert.match(crlf.message, /line 3, column 1/);
  assert.equal(crlf.snippet.split('\n')[0], '  }');
  assert.equal(at('{\r\n\t"a" 1\r\n}').snippet.split('\n')[0].includes('\t'), false, 'tabs become spaces');
});

// ---- 10. SVG sanitiser -----------------------------------------------------------------------

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

test('svg: character references are decoded before scanning', () => {
  assert.match(svgProblem(svg('<style>@&#105;mport "https://evil.example/x.css";</style>')), /@import/);
  assert.match(svgProblem(svg('<style>@&#x69;mport url(#a);</style>')), /@import/);
  assert.match(svgProblem(svg('<style>rect{fill:u&#114;l(https://evil.example/a)}</style>')), /url\(\)/);
  assert.match(svgProblem(svg('<animate attributeName="&#104;ref" to="https://evil.example"/>')), /animates an href/);
  assert.match(svgProblem(svg('<style>a{background:url(&#x6A;avascript:alert(1))}</style>')), /./);
  assert.match(svgProblem(svg('<text>&#106;avascript:alert(1)</text>')), /javascript/);
});

test('svg: namespace-prefixed script and foreignObject are refused', () => {
  assert.match(svgProblem(svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>')), /<script/);
  assert.match(svgProblem(svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg"/>')), /<script/);
  assert.match(svgProblem(svg('<svg:foreignObject xmlns:svg="http://www.w3.org/2000/svg"><p/></svg:foreignObject>')), /foreignObject/);
});

test('svg: CSS escapes in url() and @import are decoded before scanning', () => {
  assert.match(svgProblem(svg('<style>rect{fill:u\\72l(https://evil.example/a)}</style>')), /url\(\)/);
  assert.match(svgProblem(svg('<style>rect{fill:\\75rl(https://evil.example/a)}</style>')), /url\(\)/);
  assert.match(svgProblem(svg('<style>rect{fill:\\000075rl(https://evil.example/a)}</style>')), /url\(\)/);
  assert.match(svgProblem(svg('<style>@\\69mport "https://evil.example/x.css";</style>')), /@import/);
  assert.match(svgProblem(svg('<style>@im\\70ort "https://evil.example/x.css";</style>')), /@import/);
  assert.match(svgProblem(svg('<style>@\\69 mport "x";</style>')), /@import/);
});

test('svg: ordinary files still pass', () => {
  assert.equal(svgProblem(svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="5" height="5"/><text>Fish &amp; chips &lt;3 &#169; 2026</text>')), null);
  assert.equal(svgProblem(fs.readFileSync(path.join(SKILL, 'references/examples/pipeline.svg'), 'utf8')), null);
  assert.equal(svgProblem(svg('<style>.a{fill:red}</style><path class="a" d="M0 0L5 5"/><desc>The path\\ntext</desc>')), null);
});

// ---- 11. fit, cleanText, git env -------------------------------------------------------------

const wellFormed = (s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test('fit never splits a surrogate pair', () => {
  const text = 'ab\u{20BB7}\u{20BB7}\u{20BB7}\u{20BB7}\u{20BB7}\u{20BB7}';
  for (let limit = 3; limit < 14; limit++) {
    const out = fit(text, limit);
    assert.ok(wellFormed(out), `limit ${limit}: ${JSON.stringify(out)}`);
    assert.ok(out.length <= limit, `limit ${limit}`);
  }
});

test('fit never drops a combining mark from its base, or half of a grapheme', () => {
  const text = 'é'.repeat(20);
  for (let limit = 3; limit < 30; limit++) {
    const out = fit(text, limit);
    assert.ok(out.length <= limit, `limit ${limit}`);
    const body = out.replace(/…$/, '');
    assert.ok(/^(?:é)*$/.test(body), `limit ${limit}: ${JSON.stringify(out)}`);
  }
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const out = fit(`word ${family.repeat(5)}`, 14);
  assert.ok(wellFormed(out));
  assert.ok(!out.includes('‍') || out.includes(family), 'a joined emoji is kept whole or cut whole');
});

test('cleanText strips ZWJ and variation selectors only inside emoji sequences', () => {
  // Devanagari conjunct and a Persian word with ZWNJ keep their joiners.
  const devanagari = 'क्‍ष text';
  const persian = 'می‌خواهم';
  assert.equal(cleanText(devanagari), devanagari);
  assert.equal(cleanText(persian), persian);
  assert.equal(cleanText('text︎ mark'), 'text︎ mark', 'a lone text variation selector in non-emoji text stays');
  // emoji sequences go entirely
  assert.equal(cleanText('a \u{1F468}‍\u{1F4BB} b'), 'a b');
  assert.equal(cleanText('a ❤️ b'), 'a b');
  assert.equal(cleanText('a ☝\u{1F3FD} b'), 'a b');
  assert.equal(cleanText('a \u{1F1FA}\u{1F1F8} b'), 'a b');
  assert.equal(cleanText('key 1️⃣ b'), 'key 1 b');
  // text symbols stay; their VS16 form is an emoji and goes
  assert.equal(cleanText('sync ↔ server'), 'sync ↔ server');
  assert.equal(cleanText('sync ↔️ server'), 'sync server');
});

test('git env: only repo-redirecting GIT_* variables are dropped; GIT_CONFIG_* and GIT_EXEC_PATH stay', () => {
  const dropped = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];
  const kept = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_NOSYSTEM', 'GIT_EXEC_PATH', 'GIT_AUTHOR_NAME'];
  const env = gitEnv({ PATH: '/bin', ...Object.fromEntries([...dropped, ...kept].map((k) => [k, 'v'])) });
  for (const k of dropped) assert.ok(!Object.hasOwn(env, k), k);
  for (const k of kept) assert.equal(env[k], 'v', k);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

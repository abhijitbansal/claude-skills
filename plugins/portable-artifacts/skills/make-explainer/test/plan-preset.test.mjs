// Plan mode, the author's side: the `plan` scaffold (plan body first, questions after, every sentence a TODO), the checked-in
// example (valid, builds in mono and brief, survives a real answer round trip through answers.mjs), the page-level
// mono weight, and the SKILL.md instructions an agent follows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scaffold, PRESET_NAMES } from '../scripts/lib/presets.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { collectStrings } from '../scripts/lib/walk.mjs';
import { buildFile, haveBrowser, openPage, closeSharedBrowser, scratchDir } from './helpers/browser.mjs';

after(closeSharedBrowser);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = path.join(ROOT, 'references/examples/plan.explainer.json');
const node = (script, args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: '' } });
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-plan-preset-')));
const readExample = () => JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const ORDER = ['tldr', 'kpis', 'cards', 'text', 'steps', 'table', 'diagram', 'steps', 'details', 'decision', 'approval', 'question', 'review', 'verdict'];
// What the scaffold names itself: the three kpi labels, the choices table's column headings and the verdict's heading
// (the same on every plan).
const FIXED_PROSE = new Set(['Ship by', 'Cost', 'Risk', 'Choice', 'Why', 'Made by', 'Approve, change or stop this plan', 'Your verdict']);
const isTodo = (s) => s.startsWith('TODO:');
const todoErrors = (r) => r.errors.filter((e) => /TODO placeholder/.test(e.message));
const otherErrors = (r) => r.errors.filter((e) => !/TODO placeholder/.test(e.message));

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// Replaces each TODO the way a model would, the same placeholder always with the same text (an option label and the
// `recommended` that names it), short enough for every limit (diagram labels hold 48 characters).
function fill(value, seen = new Map()) {
  if (typeof value === 'string') {
    if (!isTodo(value)) return value;
    if (!seen.has(value)) seen.set(value, `Filled part ${seen.size + 1} of the plan`);
    return seen.get(value);
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, seen));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, seen)]));
  return value;
}

// ---- the scaffold -------------------------------------------------------------------------------

test('plan is a scaffold preset', () => {
  assert.ok(PRESET_NAMES.includes('plan'));
});

test('scaffold plan: the plan body comes before anything that needs an answer', () => {
  const spec = scaffold('plan');
  assert.equal(spec.preset, 'plan');
  const types = spec.sections.map((s) => s.type);
  assert.deepEqual(types, ORDER);
  const firstBody = types.findIndex((t) => ['cards', 'steps', 'table'].includes(t));
  assert.ok(firstBody >= 0 && firstBody < spec.sections.findIndex((s) => s.id === 'decision-1'), 'the body precedes the first decision');
  const byType = Object.fromEntries(spec.sections.map((s) => [s.type, s]));
  assert.equal(byType.cards.items.length, 2);
  assert.ok(byType.cards.items.every((c) => isTodo(c.title) && isTodo(c.text)), 'workstream cards are TODOs');
  assert.deepEqual(byType.table.columns, ['Choice', 'Why', 'Made by']);
  assert.equal(byType.table.rows.length, 1);
  assert.ok(byType.table.rows[0].every((c) => isTodo(String(c))), 'the choices row is TODOs');
  assert.equal(byType.decision.id, 'decision-1');
  assert.equal(byType.approval.id, 'approval-1');
  assert.equal(byType.question.id, 'question-1');
  assert.equal(byType.decision.options.length, 3);
  assert.deepEqual(byType.review.items.map((i) => i.target), ['decision-1', 'approval-1']);
  assert.deepEqual(byType.kpis.items.map((i) => i.label), ['Ship by', 'Cost', 'Risk']);
  assert.ok(byType.kpis.items.every((i) => isTodo(String(i.value))), 'kpi values are TODOs');
  assert.ok(byType.decision.options.some((o) => o.label === byType.decision.recommended), 'recommended names an option');
  assert.ok(byType.decision.options.some((o) => o.label === byType.decision.default), 'default names an option');
  assert.equal(types.at(-1), 'verdict');
  assert.deepEqual([byType.verdict.id, byType.verdict.label], ['verdict', 'Your verdict'], 'the verdict is in the contents with a stable link');
  assert.ok(byType.verdict.title && !isTodo(byType.verdict.title));
});

test('scaffold plan: the key is real (from the title, else plan-draft); every other prose string is a TODO', () => {
  assert.equal(scaffold('plan').key, 'plan-draft');
  const titled = scaffold('plan', { title: 'Ship the answer cache' });
  assert.equal(titled.title, 'Ship the answer cache');
  assert.equal(titled.key, 'plan-ship-the-answer-cache');
  const spec = scaffold('plan');
  assert.ok(!isTodo(spec.key));
  const prose = collectStrings(spec).filter((s) => s.prose && !FIXED_PROSE.has(s.text));
  assert.ok(prose.length > 20);
  assert.deepEqual(prose.filter((s) => !isTodo(s.text)).map((s) => s.path), []);
  for (const s of spec.sections) assert.ok(collectStrings(s).some((x) => isTodo(x.text)), `${s.type} has a TODO`);
});

test('scaffold plan: validate rejects the starter only for its TODOs; filled, it validates and builds as mono', async () => {
  const dir = tmp();
  try {
    const spec = scaffold('plan', { facts: { date: '2026-10-21', repo: 'claude-skills', commits: [], files: [], tests: [] } });
    assert.deepEqual(spec.meta, { date: '2026-10-21', repo: 'claude-skills' });
    const first = await validateSpec(spec, { dir });
    assert.equal(first.ok, false);
    assert.ok(todoErrors(first).length > 20);
    assert.deepEqual(otherErrors(first), [], 'only TODO errors in a starter');
    const filled = fill(spec);
    const second = await validateSpec(filled, { dir });
    assert.deepEqual(second.errors, []);
    const file = path.join(dir, 'plan.explainer.json');
    fs.writeFileSync(file, JSON.stringify(filled));
    const out = path.join(dir, 'plan.html');
    const r = node('build.mjs', [file, '--out', out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^theme: mono$/m);
    assert.match(fs.readFileSync(out, 'utf8'), /<html lang="en" data-flavor="classic" data-theme-name="mono" data-preset="plan" data-plan-key="plan-draft"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('validate warns about the placeholder key plan-draft and suggests one from the title', async () => {
  const spec = { ...readExample(), key: 'plan-draft' };
  const r = await validateSpec(spec, { dir: path.dirname(EXAMPLE) });
  assert.deepEqual(r.errors, []);
  const keyWarnings = r.warnings.filter((w) => w.path === 'key');
  assert.equal(keyWarnings.length, 1);
  assert.match(keyWarnings[0].message, /placeholder.*such as "plan-[a-z0-9-]+"$/);
  assert.doesNotMatch(keyWarnings[0].message, /such as "plan-draft"/);
  const real = await validateSpec(readExample(), { dir: path.dirname(EXAMPLE) });
  assert.deepEqual(real.warnings.filter((w) => w.path === 'key'), [], 'a real key is not warned about');
});

test('scaffold.mjs plan --out writes the starter to a file', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'plan.explainer.json');
    const r = node('scaffold.mjs', ['plan', '--title', 'Ship the answer cache', '--out', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `wrote ${file}`);
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(spec.key, 'plan-ship-the-answer-cache');
    assert.deepEqual(spec.sections.map((s) => s.type), ORDER);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- embedded diagrams and scenes are checked under the theme the page is drawn in -------------------

test('an embedded spec is validated under the page theme: mono for a plan, the spec theme when set, dusk otherwise', async () => {
  const { underPageTheme } = await import('../scripts/lib/diagram-source.mjs');
  const embedded = { title: 'D', type: 'flow', theme: 'paper', nodes: [] };
  assert.equal(underPageTheme(embedded, { preset: 'plan' }).theme, 'mono');
  assert.equal(underPageTheme(embedded, { preset: 'plan', theme: 'brief' }).theme, 'brief');
  assert.equal(underPageTheme(embedded, { preset: 'concept' }).theme, 'dusk');
  assert.equal(embedded.theme, 'paper', 'the embedded spec is not changed');
});

test('validate names the plan page theme (mono) when an embedded diagram carries its own theme', async () => {
  const spec = readExample();
  const at = spec.sections.findIndex((s) => s.type === 'diagram');
  spec.sections[at].diagram = { ...spec.sections[at].diagram, theme: 'paper' };
  const r = await validateSpec(spec, { dir: path.dirname(EXAMPLE) });
  assert.deepEqual(r.warnings.map((w) => [w.path, /page theme \("mono"\)/.test(w.message)]), [[`sections[${at}].diagram.theme`, true]]);
});

// ---- the checked-in example ------------------------------------------------------------------------

test('the plan example validates with no errors and no warnings, context first, verdict last', async () => {
  const spec = readExample();
  const r = await validateSpec(spec, { dir: path.dirname(EXAMPLE) });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(spec.preset, 'plan');
  assert.equal(spec.theme, undefined, 'the example exercises the mono default');
  assert.ok(spec.key);
  const types = spec.sections.map((s) => s.type);
  assert.equal(types.at(-1), 'verdict');
  assert.ok(types.filter((t) => t === 'decision').length >= 2);
  assert.ok(types.includes('approval') && types.includes('question') && types.includes('review') && types.includes('diagram'));
  const verdict = spec.sections.at(-1);
  assert.deepEqual([verdict.id, verdict.label], ['verdict', 'Your verdict']);
  assert.ok(verdict.title);
  assert.equal(spec.sections[0].label, 'Summary', 'only the verdict section is called a verdict');
  const firstAnswerable = types.findIndex((t) => ['decision', 'approval', 'question'].includes(t));
  const before = types.slice(0, firstAnswerable);
  for (const t of ['cards', 'table', 'steps']) assert.ok(before.includes(t), `a ${t} section comes before the first decision (index ${firstAnswerable})`);
  // The scaffold has one workstream `steps`; the example copies it once per workstream, so a run of steps counts as one.
  const collapse = (list) => list.filter((t, i) => !(t === 'steps' && list[i - 1] === 'steps'));
  assert.deepEqual(collapse(before), ORDER.slice(0, ORDER.indexOf('decision')), 'the example follows the scaffold order up to the first decision');
  assert.ok(before.filter((t) => t === 'steps').length >= 2, 'a workstream steps section, and the phases after the diagram');
});

test('the plan example builds as mono by default and as brief with --theme brief', () => {
  const dir = tmp();
  try {
    for (const [theme, args] of [['mono', []], ['brief', ['--theme', 'brief']]]) {
      const out = path.join(dir, `${theme}.html`);
      const r = node('build.mjs', [EXAMPLE, '--out', out, ...args]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`^theme: ${theme}$`, 'm'));
      const html = fs.readFileSync(out, 'utf8');
      assert.match(html, new RegExp(`<html lang="en" data-flavor="classic" data-theme-name="${theme}" data-preset="plan" data-plan-key="`));
      assert.match(html, /<a href="#verdict"[^>]*>Your verdict<\/a>/, 'the verdict is listed in the contents');
      assert.match(html, /\sid="verdict"/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- in a browser ------------------------------------------------------------------------------------

const pick = (page, name, value) => page.locator(`input[name="${name}"]`).evaluateAll((els, v) => els.find((e) => e.value === v).click(), value);

test('round trip on the example: answer every item in the page, export, and answers.mjs accepts it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = readExample();
  const { url } = buildFile(EXAMPLE, { name: 'plan-example' });
  const { page, problems, context } = await openPage(url);
  for (const s of spec.sections) {
    if (s.type === 'decision') await pick(page, `plan-${s.id}`, s.options.at(-1).label);
    if (s.type === 'approval') {
      await pick(page, `plan-${s.id}`, 'changes');
      await page.locator(`[data-plan-item][data-id="${s.id}"] [data-comment]`).fill('Name the owner first.');
    }
    if (s.type === 'question') await page.locator(`[data-plan-item][data-id="${s.id}"] [data-answer]`).fill('Two weeks.');
  }
  await pick(page, 'plan-verdict', 'approve-with-changes');
  await page.locator('[data-reviewer]').fill('Ada');
  const exported = await page.evaluate(() => window.PA.planExport());
  assert.deepEqual(problems, []);
  await context.close();
  const answerable = spec.sections.filter((s) => ['decision', 'approval', 'question'].includes(s.type));
  assert.equal(exported.answers.length, answerable.length);
  assert.ok(exported.answers.every((a) => a.answered), 'every item answered');

  const dir = fs.mkdtempSync(path.join(scratchDir(), 'plan-example-'));
  const file = path.join(dir, 'plan-answers.json');
  fs.writeFileSync(file, JSON.stringify(exported, null, 2));
  const r = node('answers.mjs', [EXAMPLE, file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /^INVALID ANSWERS/);
  for (const s of answerable) assert.match(r.stdout, new RegExp(`^${s.id}: `, 'm'));
  assert.match(r.stdout, /^verdict: approve-with-changes$/m);
  const json = JSON.parse(node('answers.mjs', [EXAMPLE, file, '--json']).stdout);
  assert.deepEqual(Object.keys(json), ['ok', 'errors', 'warnings', 'errorCount', 'warningCount', 'summary']);
  assert.equal(json.ok, true);
});

// The mono theme ships one weight (400): page-level headings, the hero text and kpi values must not ask for 600 and
// get a synthesized bold. Brief keeps its weights.
const WEIGHTED = ['h1', '.sec-title', '.hero-tldr .lead', '.kpi-value', '.hero-tldr-title'];

test('mono plan page: headings, hero text and kpi values compute to weight 400 with no font synthesis', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(EXAMPLE, { name: 'plan-mono-weight' });
  const { page, problems, context } = await openPage(url, { colorScheme: 'dark' });
  const styles = await page.evaluate((sels) => sels.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    return { sel, weight: cs.fontWeight, synthesis: cs.fontSynthesisWeight || cs.fontSynthesis };
  }), WEIGHTED);
  await context.close();
  assert.deepEqual(problems, []);
  for (const s of styles) {
    if (s.missing) continue;
    assert.equal(s.weight, '400', `${s.sel} weight`);
    assert.match(s.synthesis, /none/, `${s.sel} font synthesis`);
  }
  assert.ok(styles.filter((s) => !s.missing).map((s) => s.sel).includes('h1'));
  assert.ok(styles.filter((s) => !s.missing).map((s) => s.sel).includes('.sec-title'));
});

test('brief plan page keeps its heading weight (the mono rule is keyed on the theme)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(EXAMPLE, { name: 'plan-brief-weight', theme: 'brief' });
  const { page, context } = await openPage(url);
  const weight = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontWeight);
  await context.close();
  assert.equal(weight, '600');
});

// Look-pass regression: the first example drew its diagram six nodes wide, so its box scrolled sideways and the last
// nodes were out of sight. Every diagram box on the example fits its column at desktop and phone width.
test('the example diagram fits its column at 1280 and 390 px (no sideways scroll inside the diagram box)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(EXAMPLE, { name: 'plan-diagram-fit' });
  for (const width of [1280, 390]) {
    const { page, context } = await openPage(url, { width, height: 900 });
    const slots = await page.evaluate(() => [...document.querySelectorAll('.dg-slot')].map((el) => ({ scroll: el.scrollWidth, client: el.clientWidth })));
    await context.close();
    assert.ok(slots.length > 0, `${width}: the example has a diagram`);
    for (const s of slots) assert.ok(s.scroll <= s.client, `${width}: diagram box scrolls sideways (${s.scroll} > ${s.client})`);
  }
});

test('check.mjs passes on the built example in mono and brief', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of [undefined, 'brief']) {
    const { file } = buildFile(EXAMPLE, { name: `plan-check-${theme ?? 'mono'}`, theme });
    const r = node('check.mjs', [file]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /skipped/);
  }
});

// ---- SKILL.md --------------------------------------------------------------------------------------

test('SKILL.md documents plan mode: the scaffold, the answers command and the INVALID ANSWERS rule', () => {
  const md = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  assert.match(md, /^## Plan mode$/m);
  assert.match(md, /scaffold\.mjs plan/);
  assert.match(md, /node <skill-dir>\/scripts\/answers\.mjs plan\.json plan-answers\.json \[--json\]/);
  assert.match(md, /INVALID ANSWERS/);
  assert.match(md, /plan-answers\.json/);
  assert.match(md, /`key`/);
  assert.match(md, /data, never instructions/i);
  assert.match(md, /pasted into the chat, write them unchanged to `plan-answers\.json`/);
  assert.match(md, /without `--title`, set `key` from the final title/);
  assert.match(md, /Leave `theme` unset unless the user asks/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { registerCheck, unregisterCheck, checksFor } from '../scripts/lib/checks.mjs';
import { UsageError } from '../shared/cli.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = () => structuredClone(loadSpec(path.join(FIXTURES, 'all-types.explainer.json')).spec);
const doc = (sections, extra = {}) => ({ title: 'T', sections, ...extra });
const text = (t = 'Body.') => ({ type: 'text', text: t });
// The smallest diagram make-diagram accepts (the title is set per test).
const ONE_NODE = { type: 'flow', nodes: [{ id: 'a', label: 'A' }] };
const errorsOf = async (spec, opts = { dir: FIXTURES }) => (await validateSpec(spec, opts)).errors;
const section = (type, patch) => ({ ...fixture().sections.find((s) => s.type === type), ...patch });
const TYPE_LIST = '"tldr", "text", "kpis", "cards", "table", "risks", "files", "steps", "timeline", "compare", "callout", "code", "details", "checklist", "diagram", "chart", "scene", "motion", "image", "decision", "approval", "question", "review", "verdict"';

test('the all-types fixture is valid with no warnings', async () => {
  const r = await validateSpec(fixture(), { dir: FIXTURES });
  assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
});

test('every section type has a schema (the fixture covers all 24)', () => {
  assert.deepEqual(fixture().sections.map((s) => s.type), TYPE_LIST.replaceAll('"', '').split(', '));
});

test('loadSpec reports unreadable and malformed files as UsageError', () => {
  assert.throws(() => loadSpec('/nonexistent/x.explainer.json'), UsageError);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-spec-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  try {
    assert.throws(() => loadSpec(bad), /is not valid JSON/);
    assert.equal(loadSpec(path.join(FIXTURES, 'all-types.explainer.json')).dir, FIXTURES.replace(/\/$/, ''));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

// ---- schema -----------------------------------------------------------

test('root shape errors', async () => {
  assert.deepEqual(await errorsOf(null), [{ path: '', message: 'must be object' }]);
  assert.deepEqual(await errorsOf([]), [{ path: '', message: 'must be object' }]);
  assert.deepEqual(await errorsOf({}), [{ path: 'title', message: 'required' }, { path: 'sections', message: 'required' }]);
  assert.deepEqual(await errorsOf({ title: 'T', sections: 'x' }), [{ path: 'sections', message: 'must be array' }]);
  assert.deepEqual(await errorsOf(doc([42])), [{ path: 'sections[0]', message: 'must be object' }]);
  assert.deepEqual(await errorsOf({ title: 3, sections: [text()] }), [{ path: 'title', message: 'must be string' }]);
});

test('unknown top-level property gets did-you-mean, or the allowed list', async () => {
  assert.deepEqual(await errorsOf({ ...doc([text()]), titel: 'x' }), [{ path: 'titel', message: 'unknown property; did you mean "title"?' }]);
  assert.deepEqual(await errorsOf({ ...doc([text()]), zzzzzz: 1 }), [
    { path: 'zzzzzz', message: 'unknown property; allowed: title, subtitle, preset, key, mode, theme, generatedBy, meta, sections' },
  ]);
  assert.deepEqual(await errorsOf({ title: 'x', section: [text()] }), [
    { path: 'section', message: 'unknown property; did you mean "sections"?' },
  ]);
});

test('closed sets: preset, mode and meta keys', async () => {
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'recapp' })), [
    { path: 'preset', message: 'must be one of "recap", "checklist", "concept", "slides", "plan", "none"; did you mean "recap"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([text()], { mode: 'slide' })), [
    { path: 'mode', message: 'must be one of "page", "slides"; did you mean "slides"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([text()], { meta: { dat: 'x' } })), [
    { path: 'meta.dat', message: 'unknown property; did you mean "date"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([text()], { meta: { date: 5 } })), [{ path: 'meta.date', message: 'must be string' }]);
});

test('section type: required, unknown with did-you-mean, and per-section independence', async () => {
  assert.deepEqual(await errorsOf(doc([{ text: 'x' }])), [{ path: 'sections[0].type', message: 'required' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'tldrr', text: 'x' }])), [
    { path: 'sections[0].type', message: `must be one of ${TYPE_LIST}; did you mean "tldr"?` },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 7 }])), [
    { path: 'sections[0].type', message: `must be one of ${TYPE_LIST}` },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'nonsense' }, { type: 'text', tilte: 'x', text: 'y' }])), [
    { path: 'sections[0].type', message: `must be one of ${TYPE_LIST}` },
    { path: 'sections[1].tilte', message: 'unknown property; did you mean "title"?' },
  ]);
});

test('section fields: required, unknown (closed), wrong type', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'text' }])), [{ path: 'sections[0].text', message: 'required' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'text', text: 'x', points: ['a'] }])), [
    { path: 'sections[0].points', message: 'unknown property; allowed: type, id, title, label, text' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a' }] }])), [{ path: 'sections[0].items[0].value', message: 'required' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a', value: [] }] }])), [{ path: 'sections[0].items[0].value', message: 'must be string,number' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a', value: '1', tnoe: 'good' }] }])), [
    { path: 'sections[0].items[0].tnoe', message: 'unknown property; did you mean "tone"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'files', items: [{ path: 'a', change: 'added', add: -1 }] }])), [
    { path: 'sections[0].items[0].add', message: 'must be >= 0' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'files', items: [{ path: 'a', change: 'added', add: 1.5 }] }])), [
    { path: 'sections[0].items[0].add', message: 'must be integer' },
  ]);
});

test('enums: severity, change, status, tone, tag, align, columns', async () => {
  assert.deepEqual(await errorsOf(doc([section('risks', { items: [{ risk: 'r', severity: 'hgih', mitigation: 'm' }] })])), [
    { path: 'sections[0].items[0].severity', message: 'must be one of "low", "medium", "high", "critical"; did you mean "high"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('files', { items: [{ path: 'a', change: 'changed' }] })])), [
    { path: 'sections[0].items[0].change', message: 'must be one of "added", "modified", "deleted", "renamed"' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('steps', { items: [{ title: 'a', status: 'dne' }] })])), [
    { path: 'sections[0].items[0].status', message: 'must be one of "done", "doing", "todo"; did you mean "done"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('callout', { tone: 'warning' })])), [
    { path: 'sections[0].tone', message: 'must be one of "info", "warn", "good", "bad"; did you mean "warn"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('tldr', { tone: 'great' })])), [
    { path: 'sections[0].tone', message: 'must be one of "neutral", "accent", "good", "warn", "bad"' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('checklist', { groups: [{ title: 'g', items: [{ text: 'a', tag: 'devise' }] }] })])), [
    { path: 'sections[0].groups[0].items[0].tag', message: 'must be one of "regression", "device", "manual", "visual"; did you mean "device"?' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('table', { align: ['left', 'middle'] })])), [
    { path: 'sections[0].align[1]', message: 'must be one of "left", "center", "right"' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('cards', { columns: 5 })])), [
    { path: 'sections[0].columns', message: 'must be one of 2, 3, 4' },
  ]);
});

test('whitespace-only text is rejected with the fix', async () => {
  const msg = 'must contain at least one non-space character';
  assert.deepEqual(await errorsOf(doc([{ type: 'text', text: '   ' }])), [{ path: 'sections[0].text', message: msg }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'text', text: '' }])), [{ path: 'sections[0].text', message: msg }]);
  assert.deepEqual(await errorsOf({ title: ' \n', sections: [text()] }), [{ path: 'title', message: msg }]);
  assert.deepEqual(await errorsOf(doc([section('tldr', { points: ['ok', '  '] })])), [{ path: 'sections[0].points[1]', message: msg }]);
  assert.deepEqual(await errorsOf(doc([section('diagram', { diagram: '  ' })])), [{ path: 'sections[0].diagram', message: msg }]);
});

test('schema errors stop the run before the semantic and lint passes', async () => {
  const spec = doc([{ type: 'text', text: 'TODO: fix', extra: 1 }], { title: 'x'.repeat(200) });
  assert.deepEqual(await errorsOf(spec), [{ path: 'sections[0].extra', message: 'unknown property; allowed: type, id, title, label, text' }]);
});

// ---- limits -----------------------------------------------------------

test('top-level limits state the value and the limit', async () => {
  assert.deepEqual(await errorsOf({ title: 'x'.repeat(91), sections: [text()] }), [{ path: 'title', message: 'title is 91 characters; the limit is 90 — shorten it' }]);
  assert.deepEqual(await errorsOf(doc([text()], { subtitle: 'x'.repeat(141) })), [{ path: 'subtitle', message: 'subtitle is 141 characters; the limit is 140 — shorten it' }]);
  assert.deepEqual(await errorsOf(doc([text()], { meta: { author: 'x'.repeat(61) } })), [{ path: 'meta.author', message: 'author is 61 characters; the limit is 60 — shorten it' }]);
  assert.deepEqual(await errorsOf(doc([])), [{ path: 'sections', message: 'sections has 0 entries; at least 1 required — add more' }]);
  assert.deepEqual(await errorsOf(doc(Array.from({ length: 41 }, () => text()))), [
    { path: 'sections', message: 'sections has 41 entries; the limit is 40 — cut some or split the explainer' },
  ]);
  assert.equal((await validateSpec(doc(Array.from({ length: 40 }, () => text())), { dir: FIXTURES })).ok, true);
  assert.deepEqual(await errorsOf(doc([text()], { theme: 'papr' })), [{ path: 'theme', message: 'unknown theme "papr"; did you mean "paper"?' }]);
  assert.deepEqual(await errorsOf(doc([text()], { theme: 'zzzzzzzzzz' })), [
    { path: 'theme', message: 'unknown theme "zzzzzzzzzz"; available: blueprint, brief, dusk, editorial, ink, mono, paper, poster, press' },
  ]);
});

test('section limits', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'text', title: 'x'.repeat(91), text: 'y' }])), [
    { path: 'sections[0].title', message: 'title is 91 characters; the limit is 90 — shorten it' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'tldr', text: 'x'.repeat(401) }])), [
    { path: 'sections[0].text', message: 'text is 401 characters; the limit is 400 — shorten it' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'text', text: 'x'.repeat(4001) }])), [
    { path: 'sections[0].text', message: 'text is 4001 characters; the limit is 4000 — shorten it' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'details', summary: 's', text: 'x'.repeat(4001) }])), [
    { path: 'sections[0].text', message: 'text is 4001 characters; the limit is 4000 — shorten it' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'tldr', text: 't', points: Array(7).fill('p') }])), [
    { path: 'sections[0].points', message: 'points has 7 entries; the limit is 6 — keep the strongest points or split the section' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'tldr', text: 't', points: ['ok', 'x'.repeat(161)] }])), [
    { path: 'sections[0].points[1]', message: 'point is 161 characters; the limit is 160 — shorten it' },
  ]);
  const kpi = { label: 'a', value: '1' };
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [] }])), [{ path: 'sections[0].items', message: 'items has 0 entries; at least 1 required — add more' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: Array(7).fill(kpi) }])), [
    { path: 'sections[0].items', message: 'items has 7 entries; the limit is 6 — keep the key numbers or split the section' },
  ]);
  const card = { title: 'a', text: 'b' };
  assert.deepEqual(await errorsOf(doc([{ type: 'cards', items: Array(13).fill(card) }])), [
    { path: 'sections[0].items', message: 'items has 13 entries; the limit is 12 — split the section' },
  ]);
  const file = { path: 'a', change: 'added' };
  assert.deepEqual(await errorsOf(doc([{ type: 'files', items: Array(201).fill(file) }])), [
    { path: 'sections[0].items', message: 'items has 201 entries; the limit is 200 — group by folder instead of listing every file' },
  ]);
  for (const type of ['risks', 'steps', 'timeline']) {
    assert.deepEqual(await errorsOf(doc([{ type, items: [] }])), [{ path: 'sections[0].items', message: 'items has 0 entries; at least 1 required — add more' }], type);
  }
  const col = { title: 'c', points: ['p'] };
  assert.deepEqual(await errorsOf(doc([{ type: 'compare', columns: [col] }])), [{ path: 'sections[0].columns', message: 'columns has 1 entries; at least 2 required — add more' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'compare', columns: [col, col, col, col] }])), [
    { path: 'sections[0].columns', message: 'columns has 4 entries; the limit is 3 — compare at most three options' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'compare', columns: [col, { title: 'd', points: [] }] }])), [
    { path: 'sections[0].columns[1].points', message: 'points has 0 entries; at least 1 required — add more' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'code', code: Array(121).fill('x').join('\n') }])), [
    { path: 'sections[0].code', message: 'code is 121 lines; the limit is 120 — shorten it or split it' },
  ]);
  assert.equal((await validateSpec(doc([{ type: 'code', code: `${Array(120).fill('x').join('\n')}\n\n` }]), { dir: FIXTURES })).ok, true);
});

test('table shape', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: Array(9).fill('c'), rows: [Array(9).fill('v')] }])), [
    { path: 'sections[0].columns', message: 'columns has 9 entries; the limit is 8 — drop columns or split the table' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a'], rows: Array(61).fill(['v']) }])), [
    { path: 'sections[0].rows', message: 'rows has 61 entries; the limit is 60 — split the table' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a', 'b'], rows: [] }])), [
    { path: 'sections[0].rows', message: 'rows has 0 entries; at least 1 required — add more' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['1'], ['1', '2', '3']] }])), [
    { path: 'sections[0].rows[1]', message: 'row has 1 cells but there are 2 columns; give every row 2 cells' },
    { path: 'sections[0].rows[2]', message: 'row has 3 cells but there are 2 columns; give every row 2 cells' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a'], rows: [['1', '2']] }])), [
    { path: 'sections[0].rows[0]', message: 'row has 2 cells but there is 1 column; give every row 1 cell' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a', 'b'], rows: [['1', '2']], align: ['left'] }])), [
    { path: 'sections[0].align', message: 'align has 1 entries but there are 2 columns; give one alignment per column' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'table', columns: ['a'], rows: [[{}]] }])), [
    { path: 'sections[0].rows[0][0]', message: 'must be string,number' },
  ]);
});

test('checklist keys and groups', async () => {
  assert.deepEqual(await errorsOf(doc([section('checklist', { key: 'Bad Key' })])), [
    { path: 'sections[0].key', message: 'key "Bad Key" is invalid; use lowercase letters, digits, . - and _, starting with a letter or digit' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('checklist', { key: 'a'.repeat(81) })])), [
    { path: 'sections[0].key', message: 'key is 81 characters; the limit is 80 — shorten it' },
  ]);
  const one = section('checklist', { key: 'same' });
  assert.deepEqual(await errorsOf(doc([one, { ...one, title: 'Again' }])), [
    { path: 'sections[1].key', message: 'duplicate checklist key "same"; first used at sections[0].key; rename one so their ticks stay apart' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('checklist', { groups: [] })])), [
    { path: 'sections[0].groups', message: 'groups has 0 entries; at least 1 required — add more' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('checklist', { groups: [{ title: 'g', items: [] }] })])), [
    { path: 'sections[0].groups[0].items', message: 'items has 0 entries; at least 1 required — add more' },
  ]);
});

test('chart: exactly one of inline data or dashboard + chart', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'chart' }])), [
    { path: 'sections[0]', message: 'a chart needs either inline data (data + kind) or dashboard + chart; add one' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', caption: 'c', interactive: true }])), [
    { path: 'sections[0]', message: 'a chart needs either inline data (data + kind) or dashboard + chart; add one' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', dashboard: 'd.json', chart: 'c1', data: [{ a: 1 }] }])), [
    { path: 'sections[0].data', message: '"data" applies to inline data charts; remove it or drop dashboard' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', chart: 'c1', data: [{ a: 1 }], kind: 'bar' }])), [
    { path: 'sections[0].dashboard', message: 'required when chart is set' },
    { path: 'sections[0].kind', message: '"kind" applies to inline data charts; remove it or drop dashboard' },
    { path: 'sections[0].data', message: '"data" applies to inline data charts; remove it or drop dashboard' },
  ]);
});

test('chart: dashboard mode needs dashboard + chart and rejects inline-chart fields', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', dashboard: 'd.json' }])), [{ path: 'sections[0].chart', message: 'required when dashboard is set' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', chart: 'c1' }])), [{ path: 'sections[0].dashboard', message: 'required when chart is set' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', caption: 'c', interactive: true }]), { dir: path.join(FIXTURES, 'chart') }), []);
  for (const field of ['kind', 'x', 'y', 'color', 'size', 'value', 'format']) {
    assert.deepEqual(await errorsOf(doc([{ type: 'chart', dashboard: 'd.json', chart: 'c1', [field]: 'f' }])), [
      { path: `sections[0].${field}`, message: `"${field}" applies to inline data charts; remove it or drop dashboard` },
    ], field);
  }
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', dashboard: 'd.json', chart: 'c1', kind: 'bar', x: 'a', y: 'b' }])), [
    { path: 'sections[0].kind', message: '"kind" applies to inline data charts; remove it or drop dashboard' },
    { path: 'sections[0].x', message: '"x" applies to inline data charts; remove it or drop dashboard' },
    { path: 'sections[0].y', message: '"y" applies to inline data charts; remove it or drop dashboard' },
  ]);
});

test('chart: inline data needs kind and at least one row', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', data: [{ a: 1 }] }])), [
    { path: 'sections[0].kind', message: 'required for inline data charts; set kind to a chart kind such as "bar"' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', kind: 'bar', data: [] }])), [
    { path: 'sections[0].data', message: 'data has 0 entries; at least 1 required — add more' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', kind: 'bubble', x: 'a', y: 'b', size: 's', color: 'c', format: 'currency', data: [{ a: 1, b: 2, s: 3, c: 'p' }] }])), []);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', kind: 'bar', x: 'a', y: 'n', data: Array(500).fill({ a: 'q', n: 1 }) }])), []);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', kind: 'bar', data: Array(501).fill({ a: 1 }) }])), [
    { path: 'sections[0].data', message: 'data has 501 entries; the limit is 500 — chart a summary or use a dashboard instead' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'chart', kind: 'bar', data: [1] }])), [{ path: 'sections[0].data[0]', message: 'must be object' }]);
});

test('motion needs video or spec', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'motion' }])), [
    { path: 'sections[0]', message: 'a motion section needs video (an .mp4 path) or spec (a motion.json path); add one' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'motion', spec: 'motion.json' }])), []);
});

test('callout requires tone, title and text', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'callout', tone: 'info', text: 'x' }])), [{ path: 'sections[0].title', message: 'required' }]);
  assert.deepEqual(await errorsOf(doc([{ type: 'callout' }])), [
    { path: 'sections[0].tone', message: 'required' },
    { path: 'sections[0].title', message: 'required' },
    { path: 'sections[0].text', message: 'required' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'callout', tone: 'info', title: 'T', text: 'x' }])), []);
});

test('kpis values may be numbers', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a', value: 612 }, { label: 'b', value: 0.5 }, { label: 'c', value: '42' }] }])), []);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a', value: true }] }])), [
    { path: 'sections[0].items[0].value', message: 'must be string,number' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'kpis', items: [{ label: 'a', value: '  ' }] }])), [
    { path: 'sections[0].items[0].value', message: 'must contain at least one non-space character' },
  ]);
});

test('preset "slides" with mode "page" is a contradiction', async () => {
  const msg = { path: 'mode', message: 'preset "slides" renders as slides; remove mode or set it to "slides"' };
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'slides', mode: 'page' })), [msg]);
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'slides', mode: 'slides' })), []);
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'slides' })), []);
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'recap', mode: 'page' })), []);
  assert.deepEqual(await errorsOf(doc([text()], { preset: 'recap', mode: 'slides' })), []);
});

test('section ids: spelling and uniqueness', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'text', id: 'Bad_Id', text: 'x' }])), [
    { path: 'sections[0].id', message: 'id "Bad_Id" is invalid; use lowercase letters, digits and -, starting with a letter' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'text', id: '1st', text: 'x' }])), [
    { path: 'sections[0].id', message: 'id "1st" is invalid; use lowercase letters, digits and -, starting with a letter' },
  ]);
  assert.deepEqual(await errorsOf(doc([{ type: 'text', id: 'a', text: 'x' }, { type: 'text', id: 'b', text: 'y' }, { type: 'text', id: 'a', text: 'z' }])), [
    { path: 'sections[2].id', message: 'duplicate id "a"; first used at sections[0].id; rename one' },
  ]);
});

// ---- text lint inside a spec ------------------------------------------

test('TODO markers are reported anywhere, with the path and the fix', async () => {
  const spec = doc([text(), text(), text(), { type: 'text', text: 'TODO: summarise' }]);
  assert.deepEqual(await errorsOf(spec), [
    { path: 'sections[3].text', message: 'still has a TODO placeholder — replace it with real content' },
  ]);
  const spots = doc([
    { type: 'tldr', title: 'TODO: claim', text: 't', points: ['TODO: one'] },
    { type: 'code', code: '// TODO: later\n' },
    { type: 'diagram', diagram: { title: 'TODO: name', ...ONE_NODE } },
    { type: 'chart', kind: 'bar', x: 'a', y: 'n', data: [{ a: 'TODO: x', n: 1 }] },
    { type: 'checklist', key: 'k', groups: [{ title: 'g', items: [{ text: 'TODO: step' }] }] },
    { type: 'files', items: [{ path: 'TODO: path', change: 'added' }] },
  ], { subtitle: 'TODO: sub', meta: { author: 'TODO: me' } });
  assert.deepEqual((await errorsOf(spots)).map((e) => e.path).sort(), [
    'meta.author',
    'sections[0].points[0]',
    'sections[0].title',
    'sections[1].code',
    'sections[2].diagram.title',
    'sections[3].data[0].a',
    'sections[4].groups[0].items[0].text',
    'sections[5].items[0].path',
    'subtitle',
  ].sort());
  assert.ok((await errorsOf(spots)).every((e) => e.message === 'still has a TODO placeholder — replace it with real content'));
});

test('style lint runs on prose with the path of each string', async () => {
  const spec = doc([
    { type: 'text', title: 'Ship it!', text: 'We leverage 🚀 caching.' },
    { type: 'cards', items: [{ title: 'Seamless', text: 'ok' }] },
  ], { subtitle: 'Lorem ipsum' });
  assert.deepEqual(await errorsOf(spec), [
    { path: 'sections[0].title', message: 'heading ends with "!"; drop the exclamation mark and state the claim plainly' },
    { path: 'sections[0].text', message: 'banned phrase "leverage"; replace it with "use"' },
    { path: 'sections[1].items[0].title', message: 'banned phrase "Seamless"; replace it with "smooth"' },
    { path: 'subtitle', message: 'still has lorem ipsum placeholder text — replace it with real content' },
  ]);
});

test('lint skips non-prose: code, paths, ids, data, inline diagrams', async () => {
  const spec = doc([
    { type: 'code', code: '// we leverage 🚀 here\nutilize()\n' },
    { type: 'files', items: [{ path: 'src/leverage/seamless.mjs', change: 'added' }] },
    { type: 'diagram', diagram: { title: 'Seamless', ...ONE_NODE } },
    { type: 'chart', kind: 'bar', x: 'leverage', y: 'n', data: [{ leverage: 'leverage', n: 1 }] },
  ], { meta: { branch: 'feat/leverage-cache' } });
  assert.deepEqual(await errorsOf(spec), []);
});

test('numbered section titles are errors; numbered item titles are not', async () => {
  assert.deepEqual(await errorsOf(doc([{ type: 'text', title: '01 Overview', text: 'x' }])), [
    { path: 'sections[0].title', message: 'title starts with the number "01"; drop it — the page already orders sections' },
  ]);
  assert.deepEqual(await errorsOf(doc([section('steps', { title: 'Rollout', items: [{ title: '01 Merge' }] })])), []);
});

test('a long paragraph is a warning only', async () => {
  const long = Array(130).fill('word').join(' ');
  const r = await validateSpec(doc([{ type: 'text', text: long }]), { dir: FIXTURES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((x) => x.path), ['sections[0].text', 'sections[0]']);
  assert.match(r.warnings[0].message, /^paragraph is 130 words; keep it to 60/);
  const bad = await validateSpec(doc([{ type: 'text', text: `${long} leverage` }]), { dir: FIXTURES });
  assert.equal(bad.ok, false);
  assert.equal(bad.warnings.length, 2);
});

// ---- slides -----------------------------------------------------------

const slides = (sections) => doc(sections, { mode: 'slides' });
const slideErrors = (sections) => errorsOf(slides(sections));
const words = (n) => Array(n).fill('w').join(' ');

test('slides budget applies for mode: slides and for preset: slides, not for pages', async () => {
  const heavy = [{ type: 'steps', items: Array(7).fill({ title: 's' }) }];
  assert.equal((await slideErrors(heavy)).length, 1);
  assert.equal((await errorsOf(doc(heavy, { preset: 'slides' }))).length, 1);
  assert.deepEqual(await errorsOf(doc(heavy)), []);
  assert.deepEqual(await errorsOf(doc(heavy, { mode: 'page', preset: 'recap' })), []);
});

test('slide budget: points', async () => {
  const msg = (n) => ({ path: 'sections[0]', message: `slide has ${n} points; the limit is 6 — split this section into two slides` });
  assert.deepEqual(await slideErrors([{ type: 'tldr', text: 't', points: Array(6).fill('p') }]), []);
  assert.deepEqual(await slideErrors([{ type: 'steps', items: Array(6).fill({ title: 's' }) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'text', text: Array(7).fill('- a').join('\n') }]), [msg(7)]);
  assert.deepEqual(await slideErrors([{ type: 'steps', items: Array(7).fill({ title: 's' }) }]), [msg(7)]);
  assert.deepEqual(await slideErrors([{ type: 'cards', items: Array(8).fill({ title: 'a', text: 'b' }) }]), [msg(8)]);
  assert.deepEqual(await slideErrors([{ type: 'compare', columns: [{ title: 'a', points: ['1', '2', '3', '4'] }, { title: 'b', points: ['1', '2', '3'] }] }]), [msg(7)]);
  assert.deepEqual(await slideErrors([{ type: 'checklist', key: 'k', groups: [{ title: 'a', items: Array.from({ length: 4 }, (_, i) => ({ text: `x${i}` })) }, { title: 'b', items: Array.from({ length: 3 }, (_, i) => ({ text: `x${i}` })) }] }]), [msg(7)]);
});

test('slide budget: table rows, code lines, words', async () => {
  const row = ['a', 'b'];
  assert.deepEqual(await slideErrors([{ type: 'table', columns: ['x', 'y'], rows: Array(8).fill(row) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'table', columns: ['x', 'y'], rows: Array(9).fill(row) }]), [
    { path: 'sections[0].rows', message: 'slide has 9 table rows; the limit is 8 — split the table across slides' },
  ]);
  assert.deepEqual(await slideErrors([{ type: 'code', code: `${Array(12).fill('x').join('\n')}\n` }]), []);
  assert.deepEqual(await slideErrors([{ type: 'code', code: Array(13).fill('x').join('\n') }]), [
    { path: 'sections[0].code', message: 'slide has 13 code lines; the limit is 12 — show the key lines or split the section' },
  ]);
  assert.deepEqual(await slideErrors([{ type: 'text', text: words(80) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'text', text: words(81) }]), [
    { path: 'sections[0]', message: 'slide has 81 words; the limit is 80 — cut text or split this section into two slides' },
  ]);
});

test('slide words count prose across the section but not its title, captions, code or table', async () => {
  assert.deepEqual(await slideErrors([{ type: 'text', title: words(30), text: words(80) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'callout', tone: 'info', title: 'T', text: words(50) }, { type: 'callout', tone: 'info', title: 'T', text: words(30) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'tldr', text: words(50), points: [words(31)] }]), [
    { path: 'sections[0]', message: 'slide has 81 words; the limit is 80 — cut text or split this section into two slides' },
  ]);
  assert.deepEqual(await slideErrors([{ type: 'code', code: Array(10).fill(words(30)).join('\n'), caption: words(100) }]), []);
  assert.deepEqual(await slideErrors([{ type: 'table', columns: ['a'], rows: [[words(200)]] }]), []);
  assert.deepEqual(await slideErrors([{ type: 'image', src: 'pixel.png', alt: words(81) }]), [
    { path: 'sections[0]', message: 'slide has 81 words; the limit is 80 — cut text or split this section into two slides' },
  ]);
});

test('slide budget is checked per section, in order', async () => {
  const errors = await slideErrors([
    { type: 'text', text: 'fine' },
    { type: 'steps', items: Array(7).fill({ title: 's' }) },
    { type: 'text', text: words(90) },
  ]);
  assert.deepEqual(errors.map((e) => e.path), ['sections[1]', 'sections[2]']);
});

// ---- file references and the per-type check registry -------------------

test('image.src must exist inside the spec folder with an image extension', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-image-')));
  const spec = (src) => doc([{ type: 'image', src, alt: 'a' }]);
  try {
    fs.mkdirSync(path.join(dir, 'spec'));
    const folder = path.join(dir, 'spec');
    fs.copyFileSync(path.join(FIXTURES, 'pixel.png'), path.join(folder, 'ok.png'));
    fs.copyFileSync(path.join(FIXTURES, 'pixel.png'), path.join(dir, 'outside.png'));
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'x');
    fs.symlinkSync(path.join(dir, 'outside.png'), path.join(folder, 'link.png'));
    assert.deepEqual(await errorsOf(spec('ok.png'), { dir: folder }), []);
    assert.deepEqual(await errorsOf(spec('nope.png'), { dir: folder }), [
      { path: 'sections[0].src', message: `file not found: "nope.png" (relative to ${folder})` },
    ]);
    assert.deepEqual(await errorsOf(spec('../outside.png'), { dir: folder }), [
      { path: 'sections[0].src', message: `"../outside.png" is outside the spec folder; move the file under ${folder} and use a relative path` },
    ]);
    assert.deepEqual(await errorsOf(spec('link.png'), { dir: folder }), [
      { path: 'sections[0].src', message: `"link.png" goes through a symlink; symlinks are not followed — copy the file into ${folder}` },
    ]);
    assert.deepEqual(await errorsOf(spec('notes.txt'), { dir: folder }), [
      { path: 'sections[0].src', message: 'must be a .png, .jpg, .jpeg, .webp, .svg file; got ".txt"' },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('registerCheck adds a per-type check that sees the section, its path and the folder', async () => {
  const seen = [];
  const sync = ({ section: s, path: at, dir, spec }) => {
    seen.push([s.text, at, dir, spec.title]);
    return s.text === 'bad' ? [{ path: `${at}.text`, message: 'registered check says no' }] : [];
  };
  const later = async ({ path: at }) => [{ path: at, message: 'async check ran' }];
  const callout = (t) => ({ type: 'callout', tone: 'info', title: 'T', text: t });
  registerCheck('callout', sync);
  registerCheck('callout', later);
  try {
    assert.deepEqual(await errorsOf(doc([text(), callout('bad')])), [
      { path: 'sections[1].text', message: 'registered check says no' },
      { path: 'sections[1]', message: 'async check ran' },
    ]);
    assert.deepEqual(seen, [['bad', 'sections[1]', FIXTURES, 'T']]);
    assert.throws(() => registerCheck('callout', 'nope'), /must be a function/);
  } finally {
    unregisterCheck('callout', sync);
    unregisterCheck('callout', later);
  }
  assert.deepEqual(await errorsOf(doc([callout('bad')])), []);
});

test('unregisterCheck removes one check and tolerates unknown ones', () => {
  const fn = () => [];
  registerCheck('table', fn);
  assert.ok(checksFor('table').includes(fn));
  unregisterCheck('table', fn);
  assert.ok(!checksFor('table').includes(fn));
  unregisterCheck('table', fn);
  unregisterCheck('nothing-here', fn);
});

test('a checklist preset warns, never errors, when a checklist section has no intro', async () => {
  const bare = (patch = {}) => doc([{ type: 'text', text: 'x' }, { type: 'checklist', key: 'k', groups: [{ title: 'g', items: [{ text: 'a' }] }], ...patch }], { preset: 'checklist' });
  const r = await validateSpec(bare(), { dir: FIXTURES });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [{ path: 'sections[1].intro', message: 'add a "What\'s in this branch" summary (features and review-cycle fixes) — testers need the context' }]);
  assert.deepEqual((await validateSpec(bare({ intro: 'Covers two features.' }), { dir: FIXTURES })).warnings, []);
  const other = doc([{ type: 'checklist', key: 'k', groups: [{ title: 'g', items: [{ text: 'a' }] }] }], { preset: 'recap' });
  assert.deepEqual((await validateSpec(other, { dir: FIXTURES })).warnings, [], 'only the checklist preset asks for it');
});

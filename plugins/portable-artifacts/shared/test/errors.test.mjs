// formatAjvErrors over an anyOf of object shapes (branch review B, I9): only the closest branch's errors are reported, so
// a misspelled key gives one did-you-mean, not contradictory lines from the other shapes. The errors below are Ajv's own
// (allErrors, verbose), printed for a column chart's `data: [{ label: 'Q1', vale: 12 }]` against item, point and series
// shapes (.scratch/fixA/anyof-probe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { levenshtein, didYouMean, formatAjvErrors, printResult, makeResult } from '../errors.mjs';
import { GENERATED_BY_SCHEMA } from '../provenance.mjs';

const ITEM = { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'number' } } };
const POINT = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
const err = (keyword, instancePath, schemaPath, params, parentSchema) => ({ keyword, instancePath, schemaPath, params, ...(parentSchema ? { parentSchema } : {}), message: keyword === 'type' ? `must be ${params.type}` : undefined });
const MISSPELLED = Object.freeze([
  err('required', '/data/0', '#/properties/data/anyOf/0/items/required', { missingProperty: 'value' }),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/0/items/additionalProperties', { additionalProperty: 'vale' }, ITEM),
  err('required', '/data/0', '#/properties/data/anyOf/1/items/required', { missingProperty: 'x' }),
  err('required', '/data/0', '#/properties/data/anyOf/1/items/required', { missingProperty: 'y' }),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/1/items/additionalProperties', { additionalProperty: 'label' }, POINT),
  err('additionalProperties', '/data/0', '#/properties/data/anyOf/1/items/additionalProperties', { additionalProperty: 'vale' }, POINT),
  err('type', '/data', '#/properties/data/anyOf/2/type', { type: 'object' }),
  err('anyOf', '/data', '#/properties/data/anyOf', {}),
]);

test('a misspelled key in an anyOf of shapes gives one did-you-mean from the closest shape, nothing from the others', () => {
  assert.deepEqual(formatAjvErrors(MISSPELLED), [{ path: 'data[0].vale', message: 'unknown property; did you mean "value"?' }]);
});

test('a branch that fails on the value\'s own type is the farthest, even with the fewest errors', () => {
  // the series shape (one error: data must be object) is not where an array of items was meant
  const lines = formatAjvErrors(MISSPELLED);
  assert.ok(!lines.some((l) => l.path === 'data' && /must be object/.test(l.message)), JSON.stringify(lines));
});

test('of branches with as many errors, the first is kept', () => {
  const tie = [
    err('required', '/v', '#/properties/v/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/v', '#/properties/v/anyOf/1/required', { missingProperty: 'b' }),
    err('anyOf', '/v', '#/properties/v/anyOf', {}),
  ];
  assert.deepEqual(formatAjvErrors(tie), [{ path: 'v.a', message: 'required' }]);
});

test('each item of an array is judged by its own closest branch', () => {
  const two = [
    err('required', '/d/0', '#/properties/d/items/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/d/0', '#/properties/d/items/anyOf/1/required', { missingProperty: 'b' }),
    err('required', '/d/0', '#/properties/d/items/anyOf/1/required', { missingProperty: 'c' }),
    err('anyOf', '/d/0', '#/properties/d/items/anyOf', {}),
    err('required', '/d/1', '#/properties/d/items/anyOf/0/required', { missingProperty: 'a' }),
    err('required', '/d/1', '#/properties/d/items/anyOf/0/required', { missingProperty: 'z' }),
    err('required', '/d/1', '#/properties/d/items/anyOf/1/required', { missingProperty: 'b' }),
    err('anyOf', '/d/1', '#/properties/d/items/anyOf', {}),
  ];
  assert.deepEqual(formatAjvErrors(two), [{ path: 'd[0].a', message: 'required' }, { path: 'd[1].b', message: 'required' }]);
});

test('errors outside any anyOf, and errors without a schemaPath, are kept as before', () => {
  const plain = [err('required', '', '#/required', { missingProperty: 'title' }), { keyword: 'type', instancePath: '/n', params: { type: 'number' }, message: 'must be number' }];
  assert.deepEqual(formatAjvErrors(plain), [{ path: 'title', message: 'required' }, { path: 'n', message: 'must be number' }]);
});

// shared/ has no npm deps, so these are hand-built Ajv error objects (allErrors + verbose shape).
const extra = (instancePath, additionalProperty, properties) => ({ keyword: 'additionalProperties', instancePath, params: { additionalProperty }, parentSchema: { properties } });
const missing = (instancePath, missingProperty, properties) => ({ keyword: 'required', instancePath, params: { missingProperty }, parentSchema: { properties } });
const format = (...errors) => formatAjvErrors(errors);

function capture(fn) {
  let out = '';
  const w = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  try { fn(); } finally { process.stdout.write = w; }
  return out;
}

test('levenshtein and didYouMean still catch typos and swaps', () => {
  assert.equal(levenshtein('bra', 'bar'), 1);
  assert.equal(didYouMean('titel', ['title', 'text']), 'title');
  assert.equal(didYouMean('zzzzzz', ['title', 'text']), null);
});

test('unknown key with a close name keeps the did-you-mean wording', () => {
  assert.deepEqual(format(extra('/sections/0', 'tex', { type: {}, text: {} })), [{ path: 'sections[0].tex', message: 'unknown property; did you mean "text"?' }]);
});

test('synonyms: source -> from, summary -> note, host -> agent when the target is an allowed key', () => {
  assert.deepEqual(format(extra('/edges/0', 'source', { from: {}, to: {}, label: {} })), [{ path: 'edges[0].source', message: 'unknown property; did you mean "from"?' }]);
  assert.deepEqual(format(extra('/steps/1', 'summary', { title: {}, note: {} })), [{ path: 'steps[1].summary', message: 'unknown property; did you mean "note"?' }]);
  assert.deepEqual(format(extra('/generatedBy', 'host', { model: {}, effort: {}, agent: {} })), [{ path: 'generatedBy.host', message: 'unknown property; did you mean "agent"?' }]);
});

test('a synonym whose target is not an allowed key falls back to the allowed list', () => {
  assert.deepEqual(format(extra('/x', 'source', { id: {}, label: {} })), [{ path: 'x.source', message: 'unknown property; allowed: id, label' }]);
});

test('the synonym wins over a loose near-miss and still hides the matching "required"', () => {
  const props = { from: {}, to: {}, sources: {} };
  const out = format(extra('/edges/0', 'source', props), missing('/edges/0', 'from', props));
  assert.deepEqual(out, [{ path: 'edges[0].source', message: 'unknown property; did you mean "from"?' }]);
});

test('an item-level "simple" says to put it on the section as simple.items[n]', () => {
  const out = format(extra('/sections/2/items/0', 'simple', { title: {}, text: {}, status: {} }));
  assert.deepEqual(out, [{ path: 'sections[2].items[0].simple', message: 'unknown property; put the simple wording on the section, not the item: sections[2].simple.items[0]' }]);
  const second = format(extra('/sections/0/items/3', 'simple', { text: {} }));
  assert.match(second[0].message, /sections\[0\]\.simple\.items\[3\]$/);
});

test('"simple" anywhere else keeps the plain unknown-property message', () => {
  assert.deepEqual(format(extra('/sections/0', 'simple', { type: {} })), [{ path: 'sections[0].simple', message: 'unknown property; allowed: type' }]);
});

test('required names the expected type', () => {
  const props = { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, n: { type: ['integer', 'null'] }, kind: { enum: ['a', 'b'] }, loose: {} };
  assert.deepEqual(format(missing('/sections/0', 'title', props)), [{ path: 'sections[0].title', message: 'required (string)' }]);
  assert.equal(format(missing('', 'tags', props))[0].message, 'required (array of string)');
  assert.equal(format(missing('', 'n', props))[0].message, 'required (integer or null)');
  assert.equal(format(missing('', 'kind', props))[0].message, 'required (one of "a", "b")');
  const many = { type: 'string', enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
  assert.equal(format(missing('', 'kind', { kind: many }))[0].message, 'required (string)', 'a long closed set is left to the wrong-value error');
  assert.equal(format(missing('', 'kind', { kind: { enum: many.enum } }))[0].message, 'required');
});

test('required prefers the schema description and keeps "required" as the leading word', () => {
  const props = { id: { type: 'string', description: 'a short slug such as q3-revenue' } };
  assert.deepEqual(format(missing('/charts/0', 'id', props)), [{ path: 'charts[0].id', message: 'required (string): a short slug such as q3-revenue' }]);
});

test('required with nothing known about the property stays the bare word', () => {
  assert.equal(format(missing('', 'x', { y: {} }))[0].message, 'required');
  assert.equal(format({ keyword: 'required', instancePath: '', params: { missingProperty: 'x' } })[0].message, 'required');
});

test('pattern uses the schema description when it has one', () => {
  const err = { keyword: 'pattern', instancePath: '/generatedBy/model', params: { pattern: '^x$' }, message: 'must match pattern "^x$"', parentSchema: { description: 'letters and digits' } };
  assert.deepEqual(format(err), [{ path: 'generatedBy.model', message: 'must contain only letters and digits' }]);
  const bare = { ...err, parentSchema: {} };
  assert.deepEqual(format(bare), [{ path: 'generatedBy.model', message: 'must match pattern "^x$"' }]);
});

test('a meaning-style description on an unanchored pattern is not read as a character set', () => {
  // NON_SPACE ('\\S') only checks that some visible character exists; "the page heading" is what the field is for.
  // Merge: the version 2 branch words this exact pattern as "must not be blank", which is still not a character set.
  const err = { keyword: 'pattern', instancePath: '/title', params: { pattern: '\\S' }, message: 'must match pattern "\\S"', parentSchema: { type: 'string', pattern: '\\S', description: 'the page heading' } };
  assert.deepEqual(format(err), [{ path: 'title', message: 'must not be blank: write the text, or leave the field out' }]);
  assert.doesNotMatch(format(err)[0].message, /must contain only/);
  const other = { ...err, params: { pattern: '\\d' }, message: 'must match pattern "\\d"', parentSchema: { ...err.parentSchema, pattern: '\\d' } };
  assert.deepEqual(format(other), [{ path: 'title', message: 'must match pattern "\\d"' }], 'any other unanchored pattern keeps Ajv\'s wording');
});

test('a not-blank error a skill already worded keeps its own words (make-diagram spec.mjs)', () => {
  const worded = { keyword: 'pattern', instancePath: '/nodes/0/label', params: { pattern: '\\S' }, message: 'must contain at least one non-space character', parentSchema: { type: 'string', pattern: '\\S' } };
  assert.deepEqual(format(worded), [{ path: 'nodes[0].label', message: 'must contain at least one non-space character' }]);
  const { message, ...bare } = worded;
  assert.deepEqual(format(bare), [{ path: 'nodes[0].label', message: 'must not be blank: write the text, or leave the field out' }], 'no message at all: the shared wording');
});

test('required on a character-set field says what it may contain, not what it means', () => {
  const props = { model: { type: 'string', pattern: '^[a-z]+$', description: 'letters a to z' }, title: { type: 'string', description: 'the page heading' } };
  assert.equal(format(missing('', 'model', props))[0].message, 'required (string containing only letters a to z)');
  assert.equal(format(missing('', 'title', props))[0].message, 'required (string): the page heading', 'a meaning description keeps its wording');
});

test('the provenance field schema carries a description that reads as a sentence', () => {
  const field = GENERATED_BY_SCHEMA.properties.model;
  assert.match(field.description, /letters, digits, spaces/);
  const err = { keyword: 'pattern', instancePath: '/generatedBy/model', params: { pattern: field.pattern }, message: 'x', parentSchema: field };
  assert.match(format(err)[0].message, /^must contain only letters, digits, spaces/);
});

test('printResult without warnings is unchanged: text and JSON', () => {
  assert.equal(capture(() => printResult({ ok: false, errors: [{ path: 'a', message: 'bad' }] }, { label: 'f.json' })), 'a: bad\nf.json: 1 error\n');
  assert.equal(capture(() => printResult({ ok: true, errors: [] }, { label: 'f.json' })), 'f.json: valid\n');
  assert.equal(capture(() => printResult({ ok: true, errors: [] }, { json: true })), '{"ok":true,"errors":[]}\n');
  assert.equal(capture(() => printResult({ ok: true, errors: [], warnings: [] }, { json: true })), '{"ok":true,"errors":[]}\n', 'an empty warnings list leaves the JSON as it was');
});

test('printResult prints warnings after errors, in the explainer format, and they never make a result fail', () => {
  const warnings = [{ path: 'nodes[2]', message: 'no edge touches this node' }];
  assert.equal(capture(() => printResult({ ok: true, errors: [], warnings }, { label: 'f.json' })), 'nodes[2]: warning: no edge touches this node\nf.json: valid (1 warning)\n');
  const both = capture(() => printResult({ ok: false, errors: [{ path: 'a', message: 'bad' }], warnings: [...warnings, ...warnings] }, { label: 'f.json' }));
  assert.equal(both, 'a: bad\nnodes[2]: warning: no edge touches this node\nnodes[2]: warning: no edge touches this node\nf.json: 1 error, 2 warnings\n');
  assert.equal(capture(() => printResult({ ok: true, errors: [], warnings }, { json: true })), `${JSON.stringify({ ok: true, errors: [], warnings })}\n`);
});

test('makeResult: ok follows the errors alone; warnings appear only when there are some', () => {
  assert.deepEqual(makeResult([]), { ok: true, errors: [] });
  assert.deepEqual(makeResult([], []), { ok: true, errors: [] });
  assert.deepEqual(makeResult([], [{ path: 'a', message: 'w' }]), { ok: true, errors: [], warnings: [{ path: 'a', message: 'w' }] });
  assert.deepEqual(makeResult([{ path: 'a', message: 'e' }], [{ path: 'b', message: 'w' }]).ok, false);
});

// One round trip with the real Ajv when a skill's node_modules is installed (CI runs these before any npm ci).
const ajvFrom = (skill) => {
  try {
    return createRequire(fileURLToPath(new URL(`../../skills/${skill}/package.json`, import.meta.url)))('ajv');
  } catch {
    return null;
  }
};

test('real Ajv round trip: required hint, synonym and pattern wording (skipped without an installed skill)', (t) => {
  const Ajv = ajvFrom('make-diagram') ?? ajvFrom('make-explainer');
  if (!Ajv) return t.skip('no skill node_modules installed');
  const ajv = new (Ajv.default ?? Ajv)({ allErrors: true, strict: true, verbose: true });
  const validate = ajv.compile({
    type: 'object',
    additionalProperties: false,
    required: ['from', 'title'],
    properties: { from: { type: 'string' }, title: { type: 'string', description: 'the page heading' }, generatedBy: GENERATED_BY_SCHEMA },
  });
  validate({ source: 'a', generatedBy: { model: 'x"y' } });
  const out = Object.fromEntries(formatAjvErrors(validate.errors).map((e) => [e.path, e.message]));
  assert.equal(out.source, 'unknown property; did you mean "from"?');
  assert.equal(out.title, 'required (string): the page heading');
  assert.equal('from' in out, false, 'the rename already explains the missing key');
  assert.match(out['generatedBy.model'], /^must contain only letters, digits, spaces/);
  validate({ from: 'a', title: 't', generatedBy: { model: 'claude-opus-5-5[1m]' } });
  assert.equal(validate.errors, null, 'a model id with [ ] is accepted under Ajv strict mode and the u flag');
});

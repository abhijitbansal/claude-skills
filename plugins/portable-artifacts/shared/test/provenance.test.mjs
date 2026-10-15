// plugins/portable-artifacts/shared/test/provenance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATED_BY_SCHEMA, PROVENANCE_OPTIONS, mergeGeneratedBy, withGeneratedBy, buildDate,
  provenanceText, provenanceHtml, generatorMeta,
} from '../provenance.mjs';

const DATE = new Date(Date.UTC(2026, 9, 14, 12));
// shared/ has no npm deps and CI runs these tests before any skill's npm ci, so no Ajv here:
// check the schema's own constraints directly. The Ajv round-trip is pinned in Task 4.
test('schema is closed and its field rule accepts realistic values, rejects hostile or long ones', () => {
  assert.equal(GENERATED_BY_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(GENERATED_BY_SCHEMA.properties).sort(), ['agent', 'effort', 'model']);
  const f = GENERATED_BY_SCHEMA.properties.model;
  const ok = (v) => v.length >= f.minLength && v.length <= f.maxLength && new RegExp(f.pattern).test(v);
  assert.ok(ok('Claude Opus 5.5') && ok('gpt-5.4 (codex)') && ok('Claude Code') && ok('high'));
  assert.ok(!ok('x"><script>alert(1)</script>'));
  assert.ok(!ok('a'.repeat(61)));
  assert.ok(!ok(''));
});

test('flags override the spec field by field; nothing given → undefined', () => {
  assert.deepEqual(mergeGeneratedBy({ model: 'A', effort: 'low' }, { effort: 'high' }), { model: 'A', effort: 'high' });
  assert.deepEqual(mergeGeneratedBy(undefined, { agent: 'Copilot CLI' }), { agent: 'Copilot CLI' });
  assert.equal(mergeGeneratedBy(undefined, {}), undefined);
  assert.deepEqual(Object.keys(PROVENANCE_OPTIONS).sort(), ['agent', 'effort', 'model']);
});

test('text names the skill, model, effort, agent and UTC date; missing fields say not reported', () => {
  assert.equal(
    provenanceText('make-explainer', { model: 'Claude Opus 5.5', effort: 'high', agent: 'Claude Code' }, DATE),
    'make-explainer · Claude Opus 5.5 · high effort · Claude Code · 14 Oct 2026');
  assert.equal(
    provenanceText('make-diagram', undefined, DATE),
    'make-diagram · model not reported · effort not reported · agent not reported · 14 Oct 2026');
});

test('html and meta escape their values', () => {
  const gen = { model: 'A&B' };
  assert.equal(provenanceHtml('make-motion', gen, DATE),
    '<p class="pa-provenance">make-motion · A&amp;B · effort not reported · agent not reported · 14 Oct 2026</p>');
  assert.equal(generatorMeta('make-motion', gen),
    '<meta name="generator" content="portable-artifacts make-motion; model=A&amp;B; effort=not reported; agent=not reported">');
});

test('buildDate honours SOURCE_DATE_EPOCH and ignores junk', () => {
  assert.equal(buildDate({ SOURCE_DATE_EPOCH: '1792000000' }).getTime(), 1792000000 * 1000);
  const now = Date.now();
  assert.ok(Math.abs(buildDate({ SOURCE_DATE_EPOCH: 'soon' }).getTime() - now) < 5000);
  assert.ok(Math.abs(buildDate({}).getTime() - now) < 5000);
});

test('dates use a fixed UTC month table (September is Sep)', () => {
  assert.equal(provenanceText('s', undefined, new Date(Date.UTC(2026, 8, 3))), 's · model not reported · effort not reported · agent not reported · 3 Sep 2026');
});

test('out-of-range SOURCE_DATE_EPOCH falls back to now', () => {
  const d = buildDate({ SOURCE_DATE_EPOCH: '1'.repeat(20) });
  assert.ok(Number.isFinite(d.getTime()));
  assert.ok(Math.abs(d.getTime() - Date.now()) < 5000);
});

test('empty strings count as not reported in text and meta', () => {
  const gen = { model: '', effort: '', agent: '' };
  assert.match(provenanceText('s', gen, DATE), /^s · model not reported · effort not reported · agent not reported/);
  assert.match(generatorMeta('s', gen), /model=not reported; effort=not reported; agent=not reported/);
});

test('mergeGeneratedBy keeps unknown spec keys so the closed schema can reject them', () => {
  assert.deepEqual(mergeGeneratedBy({ model: 'A', modle: 'x' }, {}), { model: 'A', modle: 'x' });
  assert.deepEqual(mergeGeneratedBy({ model: 'A' }, { model: undefined, agent: 'C' }), { model: 'A', agent: 'C' });
});

test('withGeneratedBy overlays flags on a new spec and never mutates', () => {
  const spec = { title: 'T', generatedBy: { model: 'A' } };
  const out = withGeneratedBy(spec, { effort: 'high', model: 'B' });
  assert.deepEqual(out.generatedBy, { model: 'B', effort: 'high' });
  assert.deepEqual(spec.generatedBy, { model: 'A' });
  assert.notEqual(out, spec);
  assert.deepEqual(withGeneratedBy({ title: 'T' }, { agent: 'Codex' }).generatedBy, { agent: 'Codex' });
  const bare = { title: 'T' };
  assert.equal(withGeneratedBy(bare, {}), bare);
  assert.equal(withGeneratedBy(bare, { model: undefined }), bare);
});

test('withGeneratedBy leaves a non-object generatedBy untouched for the schema to reject', () => {
  for (const bad of ['Claude', ['x'], null, 5]) {
    const spec = { title: 'T', generatedBy: bad };
    assert.equal(withGeneratedBy(spec, { model: 'X' }), spec);
  }
});

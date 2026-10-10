import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {
  levenshtein, didYouMean, formatAjvErrors, pathJoin, printResult,
} from '../scripts/lib/errors.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'charts'],
  properties: {
    title: { type: 'string' },
    charts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          mark: { enum: ['bar', 'line', 'area'] },
        },
      },
    },
  },
};

function validate(data) {
  const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
  const fn = ajv.compile(schema);
  fn(data);
  return formatAjvErrors(fn.errors ?? []);
}

test('levenshtein counts edits', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
});

test('didYouMean returns closest candidate within threshold', () => {
  assert.equal(didYouMean('rev_by_regin', ['rev_by_region', 'total']), 'rev_by_region');
  assert.equal(didYouMean('titel', ['title', 'charts']), 'title');
  assert.equal(didYouMean('zzzzzz', ['title', 'charts']), null);
  assert.equal(didYouMean('x', []), null);
});

test('didYouMean accepts prefix matches', () => {
  assert.equal(didYouMean('desc', ['description', 'title']), 'description');
});

test('pathJoin builds dotted / indexed paths', () => {
  assert.equal(pathJoin('', 'charts'), 'charts');
  assert.equal(pathJoin('charts', 0), 'charts[0]');
  assert.equal(pathJoin('charts[0]', 'query'), 'charts[0].query');
});

test('unknown property gets did-you-mean and absorbs the matching required error', () => {
  const errs = validate({ titel: 'x', charts: [] });
  assert.deepEqual(errs, [
    { path: 'titel', message: 'unknown property; did you mean "title"?' },
  ]);
});

test('nested enum error lists allowed values and suggests one', () => {
  const errs = validate({ title: 't', charts: [{ id: 'a', mark: 'bra' }] });
  assert.deepEqual(errs, [
    { path: 'charts[0].mark', message: 'must be one of "bar", "line", "area"; did you mean "bar"?' },
  ]);
});

test('type and required errors use readable paths', () => {
  const errs = validate({ title: 5, charts: [{}] });
  assert.deepEqual(errs, [
    { path: 'title', message: 'must be string' },
    { path: 'charts[0].id', message: 'required' },
  ]);
});

test('unknown property without a close match has no suggestion', () => {
  const errs = validate({ title: 't', charts: [], qqqqqqq: 1 });
  assert.deepEqual(errs, [{ path: 'qqqqqqq', message: 'unknown property; allowed: title, charts' }]);
});

test('printResult writes text and JSON forms', () => {
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    printResult({ ok: false, errors: [{ path: 'a', message: 'bad' }] }, { json: false, label: 'x.json' });
    printResult({ ok: true, errors: [] }, { json: true });
  } finally {
    process.stdout.write = orig;
  }
  const text = out.join('');
  assert.match(text, /^a: bad$/m);
  assert.match(text, /x\.json: 1 error/);
  assert.match(text, /\{"ok":true,"errors":\[\]\}/);
});

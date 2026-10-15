import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json names the make-explainer skill', () => {
  assert.equal(pkg.name, 'make-explainer');
});

test('package.json requires the diagram and dashboard siblings', () => {
  assert.deepEqual(pkg.portableArtifacts.requires, ['make-diagram', 'make-dashboard']);
});

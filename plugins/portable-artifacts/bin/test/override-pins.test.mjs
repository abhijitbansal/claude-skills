import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');

// fast-uri 3.0.0 to 3.1.8 (a dependency of ajv, so in every skill's tree) has four moderate advisories:
// GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp. Fixed in 3.1.9.
const FAST_URI_PIN = '3.1.9';

const pinOf = (pkg) => pkg.overrides?.['fast-uri'];

for (const skill of fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'package.json')))) {
  test(`${skill} pins fast-uri to the patched ${FAST_URI_PIN} in package.json overrides`, () => {
    assert.equal(pinOf(JSON.parse(fs.readFileSync(path.join(SKILLS, skill, 'package.json'), 'utf8'))), FAST_URI_PIN);
  });
}

test('guardrail proof: the check flags an unpinned or vulnerable fast-uri', () => {
  assert.notEqual(pinOf({}), FAST_URI_PIN);
  assert.notEqual(pinOf({ overrides: { 'fast-uri': '3.1.8' } }), FAST_URI_PIN);
  assert.equal(pinOf({ overrides: { 'fast-uri': FAST_URI_PIN } }), FAST_URI_PIN);
});

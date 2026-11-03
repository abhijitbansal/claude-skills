import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');

// fast-uri 3.0.0 to 3.1.8 (a dependency of ajv, so in every skill's tree) has four moderate advisories:
// GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp. Fixed in 3.1.9.
const FAST_URI_PIN = '3.1.9';

const readJson = (skill, file) => JSON.parse(fs.readFileSync(path.join(SKILLS, skill, file), 'utf8'));
const skills = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'package.json')));

test('the skills folder is found and holds the five skills (an empty list would make every check below pass)', () => {
  assert.ok(skills.length >= 5, `found ${skills.length} skills with a package.json under ${SKILLS}`);
});

for (const skill of skills) {
  test(`${skill} pins fast-uri to the patched ${FAST_URI_PIN} in package.json overrides`, () => {
    assert.equal(readJson(skill, 'package.json').overrides?.['fast-uri'], FAST_URI_PIN);
  });

  // The override only reaches users through the lockfile that `npm ci` installs from.
  test(`${skill} package-lock.json resolves fast-uri to ${FAST_URI_PIN} with no nested copy`, () => {
    const packages = readJson(skill, 'package-lock.json').packages;
    assert.equal(packages['node_modules/fast-uri']?.version, FAST_URI_PIN);
    const nested = Object.keys(packages).filter((k) => k.endsWith('/node_modules/fast-uri'));
    assert.deepEqual(nested, [], 'a nested fast-uri would escape the top-level pin');
  });
}

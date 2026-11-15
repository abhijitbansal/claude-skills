// W3-M04 (PA-08): the stale-copy warning fires from the browser check script too, not only from validate and build.
// The copy holds scripts/ and shared/ only (no node_modules) and PA_NO_BROWSER=1 skips the launch, so no browser can
// start here. The copy sits under a fake HOME's plugin cache while installed_plugins.json names a newer folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function cachedCopy({ installed }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-stale-'));
  made.push(home);
  const old = path.join(home, '.claude', 'plugins', 'cache', 'mk', 'portable-artifacts', '1.0.0');
  const copy = path.join(old, 'skills', 'make-scene');
  fs.mkdirSync(copy, { recursive: true });
  fs.cpSync(path.join(SKILL, 'scripts'), path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'package.json'), '{"type":"module"}');
  const newer = path.join(home, '.claude', 'plugins', 'cache', 'mk', 'portable-artifacts', '1.1.0');
  fs.writeFileSync(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'portable-artifacts@claude-skills': [{ installPath: installed === 'newer' ? newer : old }] } }),
  );
  const page = path.join(home, 'page.html');
  fs.writeFileSync(page, '<!doctype html><title>x</title>');
  return { home, copy, page };
}

const runCheck = ({ home, copy, page }) => spawnSync(process.execPath, [path.join(copy, 'scripts', 'check.mjs'), page], {
  encoding: 'utf8',
  env: { ...process.env, HOME: home, PA_NO_BROWSER: '1' },
});

test('the browser check run from an old plugin-cache copy warns on stderr and still exits 0 (skipped)', () => {
  const r = runCheck(cachedCopy({ installed: 'newer' }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^warning: this script runs from .*1\.0\.0, not the installed copy .*1\.1\.0; run npm ci in /m);
  assert.match(r.stdout, /^check: skipped \(no browser: PA_NO_BROWSER=1;/);
});

test('the browser check run from the installed copy stays silent', () => {
  const r = runCheck(cachedCopy({ installed: 'same' }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

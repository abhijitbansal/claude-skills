import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staleCopyWarning, PLUGIN_KEY } from '../stale-copy.mjs';

const home = path.resolve('/h');
const cache = path.join(home, '.claude', 'plugins', 'cache', 'claude-skills', 'portable-artifacts');
const script = (root) => path.join(root, 'skills', 'make-explainer', 'scripts', 'build.mjs');
const installed = (...paths) => JSON.stringify({ version: 2, plugins: { [PLUGIN_KEY]: paths.map((installPath) => ({ installPath })) } });
const warn = (scriptPath, body) => staleCopyWarning({ scriptPath, home, readFile: () => { if (body instanceof Error) throw body; return body; } });

test('a script under the plugin cache but outside the installed copy draws one line naming both and the fix', () => {
  const line = warn(script(path.join(cache, '0.8.0')), installed(path.join(cache, '1.0.0')));
  assert.equal(line, `warning: this script runs from ${path.join(cache, '0.8.0')}, not the installed copy ${path.join(cache, '1.0.0')}; run npm ci in ${path.join(cache, '1.0.0', 'skills', 'make-explainer')} (or node ${path.join(cache, '1.0.0', 'skills', 'make-explainer', 'scripts', 'doctor.mjs')} --fix node_modules), then use that copy`);
  assert.equal(line.includes('\n'), false);
});

test('silent from the installed copy, also with a trailing separator or as the second entry', () => {
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '1.0.0'))), null);
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '1.0.0') + path.sep)), null);
  assert.equal(warn(script(path.join(cache, '1.0.0')), installed(path.join(cache, '0.8.0'), path.join(cache, '1.0.0'))), null);
});

test('silent outside the plugin cache, whatever the file says', () => {
  assert.equal(warn(script(path.resolve('/repo/plugins/portable-artifacts')), installed(path.join(cache, '1.0.0'))), null);
  assert.equal(warn(script(path.join(home, '.claude', 'plugins', 'marketplaces', 'x')), installed(path.join(cache, '1.0.0'))), null);
});

test('silent when the file is missing, unreadable, not JSON, or has no usable entry', () => {
  const stale = script(path.join(cache, '0.8.0'));
  const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  for (const body of [enoent, new Error('EACCES'), 'not json', '{}', '{"plugins":{}}', JSON.stringify({ plugins: { [PLUGIN_KEY]: [] } }), JSON.stringify({ plugins: { [PLUGIN_KEY]: [{ version: '1.0.0' }] } }), JSON.stringify({ plugins: { [PLUGIN_KEY]: 'x' } })]) {
    assert.equal(warn(stale, body), null, String(body));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES, runtimeSource } from '../scripts/lib/runtime.mjs';
import { viewerRuntime } from '../scripts/lib/api.mjs';

const template = (name) => fileURLToPath(new URL(`../template/${name}`, import.meta.url));
const lines = (name) => fs.readFileSync(template(name), 'utf8').split('\n').length;

test('the runtime is camera, route, explore, panel, story, transport, fullscreen, then viewer, joined in that order', () => {
  assert.deepEqual(RUNTIME_FILES, ['camera.js', 'route.js', 'explore.js', 'panel.js', 'story.js', 'transport.js', 'fullscreen.js', 'viewer.js']);
  const src = runtimeSource();
  let at = -1;
  for (const f of RUNTIME_FILES) {
    const i = src.indexOf(fs.readFileSync(template(f), 'utf8'));
    assert.ok(i > at, `${f} follows the file before it`);
    at = i;
  }
  assert.equal(viewerRuntime(), src, 'embedders get the same bundle as the page');
  assert.doesNotThrow(() => new Function(src), 'valid JavaScript');
});

test('every template file stays under 400 lines', () => {
  for (const f of [...RUNTIME_FILES, 'toolbar.js', 'viewer.html']) assert.ok(lines(f) < 400, `${f}: ${lines(f)} lines`);
});

test('each module registers a factory on window.PADiagram and viewer.js composes mount', () => {
  const factories = { 'camera.js': 'camera', 'route.js': 'route', 'explore.js': 'trace', 'panel.js': 'panel', 'story.js': 'story', 'transport.js': 'transport', 'fullscreen.js': 'fullscreen' };
  for (const f of RUNTIME_FILES.slice(0, -1)) assert.ok(fs.readFileSync(template(f), 'utf8').includes(`PADiagram.${factories[f]} = function`), `${f} registers PADiagram.${factories[f]}`);
  assert.ok(fs.readFileSync(template('viewer.js'), 'utf8').includes('PADiagram.mount = mount;'));
});

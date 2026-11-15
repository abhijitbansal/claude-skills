// Guards for the v2 engine: it reads no clock and no randomness, and only engine/page touches the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine');
const PAGE_DIR = path.join(ENGINE_DIR, 'page') + path.sep;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const engineModules = () => walk(ENGINE_DIR).filter((file) => file.endsWith('.mjs'));

test('engine code never reads a clock or Math.random', () => {
  const files = engineModules();
  assert.ok(files.length > 0, 'found no engine modules to check');
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame/, file);
  }
});

test('only engine/page touches document or window', () => {
  for (const file of engineModules().filter((f) => !f.startsWith(PAGE_DIR))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(document|window)\./, file);
  }
});

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

// ---- imports (what version 2 may import from version 1 is test/v2/standalone.test.mjs: nothing) ----

// Every specifier a module imports (static `from '...'` and bare `import '...'`, dynamic `import('...')`).
const IMPORT_RE = /(?:^\s*(?:import|export)\b[^'";]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"\n]+)['"]/gm;
const specifiers = (source) => [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
// A bare specifier: a package name, which the render page cannot resolve (only relative paths and the server's routes).
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:');
/** The bare specifiers `source` imports. */
const bareImports = (source) => specifiers(source).filter(isBare);
test('no engine module imports a package by a bare name', () => {
  for (const file of engineModules()) assert.deepEqual(bareImports(readFileSync(file, 'utf8')), [], file);
});

test('each import rule catches one bad line', () => {
  assert.deepEqual(bareImports("import { geoPath } from 'd3-geo';"), ['d3-geo']);
  assert.deepEqual(bareImports("const shiki = await import('shiki');"), ['shiki']);
  assert.deepEqual(bareImports("import { x } from '../shared.mjs';\nimport fs from 'node:fs';"), []);
  assert.deepEqual(bareImports("import {\n  a,\n  b,\n} from 'topojson-client';"), ['topojson-client'], 'an import over several lines');
  assert.deepEqual(bareImports("const { from } = params;\nthrow new Error(`from ${'x'}`);"), [], 'a variable named from is not an import');
});

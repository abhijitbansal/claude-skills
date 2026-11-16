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

// ---- imports ----

const SKILL_DIR = path.resolve(ENGINE_DIR, '..');
const V2_SCRIPTS_DIR = path.join(SKILL_DIR, 'scripts/v2');
// Every specifier a module imports (static `from '...'` and bare `import '...'`, dynamic `import('...')`).
const IMPORT_RE = /(?:^\s*(?:import|export)\b[^'";]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"\n]+)['"]/gm;
const specifiers = (source) => [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
// A bare specifier: a package name, which the render page cannot resolve (only relative paths and the server's routes).
const isBare = (spec) => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:');
/** The bare specifiers `source` imports. */
const bareImports = (source) => specifiers(source).filter(isBare);
// A version 1 module: anything under template/ or scripts/lib/, or the server's /v1/ route to one.
const V1_RE = /(?:^|\/)template\/|(?:^|\/)scripts\/lib\/|^\.\.\/lib\/|^\.\.\/\.\.\/lib\/|^\/v1\//;
/** The version 1 modules `source` imports. */
const v1Imports = (source) => specifiers(source).filter((spec) => V1_RE.test(spec));

// The version 1 imports present at HEAD (a5732f5b), file relative to the skill: this list may only shrink.
const V1_ALLOWED = Object.freeze({
  'engine/page/stage.mjs': ['/v1/formats.mjs'],
  'scripts/v2/render.mjs': ['../lib/ffmpeg.mjs'],
  'scripts/v2/run.mjs': ['../lib/ffmpeg.mjs'],
  'scripts/v2/sheets.mjs': ['../../template/formats.mjs'],
  'scripts/v2/session.mjs': ['../lib/browser.mjs', '../../template/formats.mjs'],
  'scripts/v2/review.mjs': ['../../template/formats.mjs'],
  'scripts/v2/voice/worker.mjs': ['../../lib/optional.mjs', '../../lib/doctor-hint.mjs', '../../lib/spec.mjs'],
  'scripts/v2/voice/synth.mjs': ['../../lib/doctor-hint.mjs', '../../lib/optional.mjs'],
  'scripts/v2/voice/master.mjs': ['../../lib/ffmpeg.mjs', '../../lib/loudness.mjs'],
  'scripts/v2/voice/model.mjs': ['../../lib/pinned-file.mjs'],
  'scripts/v2/voice/accuracy.mjs': ['../../lib/ffmpeg.mjs', '../../lib/optional.mjs'],
  'scripts/v2/sound/synth.mjs': ['../../lib/cues.mjs'],
  'scripts/v2/sound/events.mjs': ['../../../template/formats.mjs'],
  'scripts/v2/sound/bed.mjs': ['../../lib/ffmpeg.mjs', '../../lib/cues.mjs', '../../lib/beats.mjs'],
});

test('no engine module imports a package by a bare name', () => {
  for (const file of engineModules()) assert.deepEqual(bareImports(readFileSync(file, 'utf8')), [], file);
});

test('engine and scripts/v2 import version 1 modules only where they did at HEAD', () => {
  const files = [...engineModules(), ...walk(V2_SCRIPTS_DIR).filter((f) => f.endsWith('.mjs'))];
  for (const file of files) {
    const rel = path.relative(SKILL_DIR, file).split(path.sep).join('/');
    const extra = v1Imports(readFileSync(file, 'utf8')).filter((spec) => !(V1_ALLOWED[rel] ?? []).includes(spec));
    assert.deepEqual(extra, [], `${rel} imports version 1 modules not allowed at HEAD`);
  }
});

test('each import rule catches one bad line', () => {
  assert.deepEqual(bareImports("import { geoPath } from 'd3-geo';"), ['d3-geo']);
  assert.deepEqual(bareImports("const shiki = await import('shiki');"), ['shiki']);
  assert.deepEqual(bareImports("import { x } from '../shared.mjs';\nimport fs from 'node:fs';"), []);
  assert.deepEqual(bareImports("import {\n  a,\n  b,\n} from 'topojson-client';"), ['topojson-client'], 'an import over several lines');
  assert.deepEqual(bareImports("const { from } = params;\nthrow new Error(`from ${'x'}`);"), [], 'a variable named from is not an import');
  assert.deepEqual(v1Imports("import { MAPS } from '../../template/maps.mjs';"), ['../../template/maps.mjs']);
  assert.deepEqual(v1Imports("import { rankByPeriod } from '../lib/race.mjs';"), ['../lib/race.mjs']);
  assert.deepEqual(v1Imports("import { x } from './prepare/map.mjs';"), []);
});

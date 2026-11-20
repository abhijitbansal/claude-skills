// Version 2 stands on its own files (cut-over plan, Task 1): nothing it loads reaches the version 1 tree that the
// cut-over deletes. The walker follows every static import, dynamic import(), re-export, the render page's own absolute
// routes (/engine/, /shared/, and the old /v1/ alias for template/) and the path literals a server or script joins onto
// the skill folder, from the kept entry scripts and every file under engine/, scripts/v2/ and test/v2/, into each file
// it reaches. It fails on any edge into template/, assets/, or a scripts/lib/ file outside KEEP_LIB, and names each edge
// as `<importer> -> <imported>`. There is no allow-list: the test passes only when the list of edges is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The scripts/lib files that stay (File Structure of the cut-over plan). Anything else under scripts/lib is version 1.
const KEEP_LIB = Object.freeze(['beats', 'browser', 'cutout', 'cutout-cli', 'doctor-hint', 'ffmpeg', 'help', 'model-cache', 'optional', 'pinned-file', 'requirements', 'video-probe']);
const ENTRY_SCRIPTS = Object.freeze(['scripts/make.mjs', 'scripts/doctor.mjs', 'scripts/cutout.mjs', 'scripts/beats.mjs', 'scripts/storyboard.mjs', 'optional/voice/index.mjs']);
const WALKED_FOLDERS = Object.freeze(['engine', 'scripts/v2', 'test/v2']);
// What the render page's absolute specifiers mean on the server: the folder each prefix is served from.
const PAGE_ROUTES = Object.freeze([['/engine/', 'engine/'], ['/shared/', 'shared/'], ['/v1/', 'template/']]);
const VERSION_ONE_FOLDERS = Object.freeze(['template', 'assets']);

// Every specifier a module imports (static `from '...'`, bare `import '...'`, dynamic `import('...')`, re-exports).
const IMPORT_RE = /(?:^\s*(?:import|export)\b[^'";]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*)['"]([^'"\n]+)['"]/gm;
// A path literal that names a version 1 folder, as a server or script resolves it from its own folder
// ('../../assets/sfx/kenney') or joins it onto the skill folder (path.join(SKILL_ROOT, 'template/formats.mjs')). A film's
// own example asset ('assets/photo.png' in an error message or an example) is neither.
const FOLDER_LITERAL_RE = /(?:['"]((?:\.\.\/)+(?:template|assets)\/[^'"\n]*)['"]|\b\w*(?:ROOT|DIR|Root|Dir)\s*,\s*['"]((?:template|assets)\/[^'"\n]*)['"])/g;

const slash = (file) => file.split(path.sep).join('/');
const isTestFile = (file, skillDir) => slash(path.relative(skillDir, file)).startsWith('test/');

function walkMjs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkMjs(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

// The file a specifier means, or null for a package, a node: module or a route this guard has no view of.
function resolveSpecifier(importer, spec, skillDir) {
  if (spec.startsWith('.')) return path.resolve(path.dirname(importer), spec);
  const route = PAGE_ROUTES.find(([prefix]) => spec.startsWith(prefix));
  return route === undefined ? null : path.join(skillDir, route[1], spec.slice(route[0].length));
}

// Why `target` is version 1, or null. `skillDir`-relative, with forward slashes.
function versionOneReason(target, skillDir) {
  const rel = slash(path.relative(skillDir, target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const [top] = rel.split('/');
  if (VERSION_ONE_FOLDERS.includes(top)) return rel;
  const lib = /^scripts\/lib\/([^/]+)\.mjs$/.exec(rel);
  return lib !== null && !KEEP_LIB.includes(lib[1]) ? rel : null;
}

// Every file `file` reaches in one step: its imports, and (outside tests, whose film specs name `assets/` freely) the
// version 1 folder paths it spells out.
function targetsOf(file, skillDir) {
  const source = readFileSync(file, 'utf8');
  const imported = [...source.matchAll(IMPORT_RE)].map((m) => resolveSpecifier(file, m[1], skillDir));
  const literals = isTestFile(file, skillDir) ? [] : [...source.matchAll(FOLDER_LITERAL_RE)].map((m) => (m[1] === undefined ? path.join(skillDir, m[2]) : path.resolve(path.dirname(file), m[1])));
  return [...imported, ...literals].filter((target) => target !== null);
}

/** `<importer> -> <imported>` for every edge from `roots`, into each file they reach, that lands in version 1. Sorted. */
export function findVersionOneEdges({ skillDir, roots }) {
  const edges = new Set();
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file) || !file.endsWith('.mjs')) continue;
    seen.add(file);
    for (const target of targetsOf(file, skillDir)) {
      const reason = versionOneReason(target, skillDir);
      if (reason !== null) edges.add(`${slash(path.relative(skillDir, file))} -> ${reason}`);
      else if (!slash(target).includes('/node_modules/')) queue.push(target);
    }
  }
  return [...edges].sort();
}

const rootsOf = (skillDir) => [...ENTRY_SCRIPTS.map((rel) => path.join(skillDir, rel)), ...WALKED_FOLDERS.flatMap((dir) => walkMjs(path.join(skillDir, dir)))];

test('version 2 imports no version 1 file: no edge into template/, assets/ or a scripts/lib file outside the keep list', () => {
  assert.deepEqual(findVersionOneEdges({ skillDir: SKILL_DIR, roots: rootsOf(SKILL_DIR) }), []);
});

test('every file of the keep list exists, so a typo cannot hide an edge', () => {
  for (const name of KEEP_LIB) assert.ok(existsSync(path.join(SKILL_DIR, 'scripts/lib', `${name}.mjs`)), `scripts/lib/${name}.mjs`);
});

test('the walker reports exactly the bad edges of a fixture: static, dynamic, re-export, page route, server path literal, and one reached through a kept lib file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'standalone-'));
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  put('template/formats.mjs', 'export const FORMATS = {};\n');
  put('template/seeded.mjs', 'export const seeded = 1;\n');
  put('assets/sfx/note.wav', '');
  put('scripts/lib/spec.mjs', 'export class UsageError extends Error {}\n');
  put('scripts/lib/cues.mjs', "import { seeded } from '../../template/seeded.mjs';\nexport { seeded };\n");
  put('scripts/lib/ffmpeg.mjs', "import { UsageError } from './spec.mjs';\nexport const find = () => UsageError;\n"); // kept: reaches spec.mjs
  put('scripts/lib/help.mjs', 'export const help = 1;\n');
  put('scripts/v2/clean.mjs', "import { help } from '../lib/help.mjs';\nimport fs from 'node:fs';\nexport const x = [help, fs];\n");
  put('scripts/v2/static.mjs', "import { FORMATS } from '../../template/formats.mjs';\nexport { FORMATS };\n");
  put('scripts/v2/dynamic.mjs', "export const load = async () => (await import('../lib/cues.mjs')).seeded;\n");
  put('scripts/v2/reexport.mjs', "export * from '../lib/spec.mjs';\n");
  put('scripts/v2/server.mjs', "const FIXED = { '/v1/formats.mjs': path.join(SKILL_ROOT, 'template/formats.mjs') };\nconst KENNEY = path.resolve(here, '../../assets/sfx');\n");
  put('engine/page/stage.mjs', "import { canvasSize } from '/v1/formats.mjs';\nimport { didYouMean } from '/shared/errors.mjs';\n");
  put('shared/errors.mjs', 'export const didYouMean = () => null;\n');
  put('scripts/v2/example.mjs', "export const EXAMPLE = { id: 'a', src: 'assets/screenshot.png' };\nexport const HINT = '\"assets/photo.png\"';\n"); // a film's example asset in code is not an edge
  put('test/v2/film.test.mjs', "const film = { shots: [{ src: 'assets/photo.png' }] };\nexport { film };\n"); // a film's own asset path is not an edge
  put('scripts/make.mjs', "import { find } from './lib/ffmpeg.mjs';\nexport { find };\n");
  const roots = [path.join(dir, 'scripts/make.mjs'), ...WALKED_FOLDERS.flatMap((folder) => walkMjs(path.join(dir, folder)))];
  assert.deepEqual(findVersionOneEdges({ skillDir: dir, roots }), [
    'engine/page/stage.mjs -> template/formats.mjs',
    'scripts/lib/ffmpeg.mjs -> scripts/lib/spec.mjs',
    'scripts/v2/dynamic.mjs -> scripts/lib/cues.mjs',
    'scripts/v2/reexport.mjs -> scripts/lib/spec.mjs',
    'scripts/v2/server.mjs -> assets/sfx',
    'scripts/v2/server.mjs -> template/formats.mjs',
    'scripts/v2/static.mjs -> template/formats.mjs',
  ]);
});

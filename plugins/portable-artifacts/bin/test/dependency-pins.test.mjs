// Standing rules for what the plugin installs or downloads: no dependency range in a manifest, no install command without a
// lockfile or exact versions (never --no-save), install scripts skipped for the optional packages that carry one, every lockfile
// resolved only from registry.npmjs.org with an integrity hash, and every model or binary download pinned to a commit or version
// with a SHA-256 beside that URL. The checkers are pure and return "<where>: <what>" strings; the tests run them on the real tree
// (code, plugin docs, repo docs, site pages) and on bad fixtures, so each rule is shown to fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(PLUGIN, '../..');
const SKILLS = path.join(PLUGIN, 'skills');
const SKIP_DIRS = new Set(['node_modules', '.cache', '.git', '.scratch']);
const rel = (file) => path.relative(REPO, file).split(path.sep).join('/');

// ---- manifests ----------------------------------------------------------------------------------------------------------

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function* stringsUnder(value, prefix) {
  if (typeof value === 'string') yield [prefix, value];
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) yield* stringsUnder(inner, `${prefix}.${key}`);
}

/** Every dependency spec, and every string at any depth under `overrides`, must be an exact version. */
export function rangeViolations(manifest, where) {
  const found = [];
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (typeof spec !== 'string' || !EXACT.test(spec)) found.push(`${where}: ${field}.${name} = ${spec}`);
    }
  }
  for (const [at, value] of stringsUnder(manifest.overrides ?? {}, 'overrides')) {
    if (!EXACT.test(value)) found.push(`${where}: ${at} = ${value}`);
  }
  return found;
}

// ---- lockfiles ----------------------------------------------------------------------------------------------------------

const REGISTRY = 'https://registry.npmjs.org/';

/** Every locked package resolves from the npm registry and carries an integrity hash (links and bundled packages have neither). */
export function lockfileViolations(lock, where) {
  const found = [];
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (name === '' || entry.link || entry.inBundle) continue;
    const label = name.slice(name.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY)) found.push(`${where}: ${label} resolves from ${entry.resolved ?? 'nowhere'}, not ${REGISTRY}`);
    if (typeof entry.integrity !== 'string' || entry.integrity === '') found.push(`${where}: ${label} has no integrity`);
  }
  return found;
}

/** The names of the optional folders whose lockfile holds a package with an install script. */
export const foldersWithInstallScripts = (locks) => Object.entries(locks).filter(([, lock]) => Object.values(lock.packages ?? {}).some((p) => p.hasInstallScript)).map(([name]) => name);

// ---- install commands ---------------------------------------------------------------------------------------------------

const PACKAGE_INSTALL = /\b(?:npm\s+(?:install|i|add)|pnpm\s+add|yarn\s+add)(?=\s|$|`)([^\n`|;&)]*)/g;
const NPM_CI = /\bnpm\s+ci(?=\s|$|`)([^\n`|;&)]*)/g;
// `npx` as a command (after a quote, a backtick, `sudo`, `&&`, `$` or a line start), not the word in a sentence.
const NPX = /(?:^|[`'"(]|\bsudo\s|&&\s|\$\s)npx\s+([^\n`|;&)]*)/gm;
const INSTALL_ARGV = /['"]npm['"],\s*['"](?:install|i|add)['"]|['"](?:pnpm|yarn)['"],\s*['"]add['"]/;
const PACKAGE_SPEC = /^(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/;
const VALUE_FLAGS = new Set(['--prefix', '-C', '--workspace', '-w', '--cache', '-p', '--package']); // the next word is the flag's value

const wordsOf = (argText) => argText.trim().split(/\s+/).filter(Boolean);

function positionals(words) {
  const found = [];
  for (let i = 0; i < words.length; i++) {
    if (VALUE_FLAGS.has(words[i])) i++;
    else if (!words[i].startsWith('-')) found.push(words[i]);
  }
  return found;
}

function installProblem(argText) {
  const words = wordsOf(argText);
  if (words.includes('--no-save')) return '--no-save is refused';
  const packages = positionals(words);
  if (packages.length === 0) return 'names no package';
  const loose = packages.find((p) => !PACKAGE_SPEC.test(p));
  return loose === undefined ? null : `${loose} is not name@x.y.z`;
}

// `npx <pkg>` fetches and runs the latest version unless the package is pinned; `--no` (or --no-install) only ever runs a local one.
// A `${NAME}` argument counts as pinned when the same text says `const NAME = 'pkg@x.y.z'`.
function npxProblem(argText, text, allowed) {
  const words = wordsOf(argText);
  if (words.includes('--no') || words.includes('--no-install')) return null;
  const [first] = positionals(words);
  if (first === undefined || PACKAGE_SPEC.test(first) || allowed.includes(first)) return null;
  const name = /^\$\{(\w+)\}$/.exec(first)?.[1];
  const value = name && new RegExp(`const ${name} = ['"]([^'"]+)['"]`).exec(text)?.[1];
  return value && PACKAGE_SPEC.test(value) ? null : `${first} is not name@x.y.z (or pass --no)`;
}

/**
 * A package install in prose or code names exact versions and never --no-save; unversioned `npx <pkg>` and any install argv form
 * are refused. `allowedNpx` names packages a human-typed command in a doc may run unpinned (code allows none).
 */
export function installViolations(text, where, allowedNpx = []) {
  const found = [];
  for (const match of text.matchAll(PACKAGE_INSTALL)) {
    const problem = installProblem(match[1]);
    if (problem) found.push(`${where}: ${match[0].trim()} (${problem})`);
  }
  for (const match of text.matchAll(NPX)) {
    const problem = npxProblem(match[1], text, allowedNpx);
    if (problem) found.push(`${where}: npx ${match[1].trim()} (${problem})`);
  }
  if (INSTALL_ARGV.test(text)) found.push(`${where}: an install argv (use npm ci with a lockfile)`);
  return found;
}

const OPTIONAL_PATH = /optional[\\/]([\w-]+)/;
const NPM_ARGV = /\[\s*['"]npm['"],\s*['"](?:ci|install|i|add)['"][^\]]*\]/g;

/**
 * Any npm ci or install of an optional folder whose lockfile has an install script must carry --ignore-scripts: a command string
 * naming optional/<name>, or an argv built for an `optional` folder. `folders` is foldersWithInstallScripts().
 */
export function ignoreScriptsViolations(text, where, folders) {
  if (folders.length === 0) return [];
  const found = [];
  for (const match of [...text.matchAll(PACKAGE_INSTALL), ...text.matchAll(NPM_CI)]) {
    const folder = OPTIONAL_PATH.exec(match[1])?.[1];
    if (folder !== undefined && folders.includes(folder) && !wordsOf(match[1]).includes('--ignore-scripts')) found.push(`${where}: ${match[0].trim()} (no --ignore-scripts)`);
  }
  for (const match of text.matchAll(NPM_ARGV)) {
    if (/['"]optional['"]/.test(match[0]) && !match[0].includes('--ignore-scripts')) found.push(`${where}: ${match[0]} (no --ignore-scripts)`);
  }
  return found;
}

// ---- downloads ----------------------------------------------------------------------------------------------------------

const URL_LITERAL = /https?:\/\/[^\s'"`)<>]+/g;
const DOWNLOAD_HOSTS = ['huggingface.co', 'github.com', 'objects.githubusercontent.com', 'registry.npmjs.org', 'cdn.jsdelivr.net', 'unpkg.com'];
const DOWNLOAD_EXTENSION = /\.(?:onnx|bin|safetensors|gz|tgz|zip|exe|dmg|wasm)$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSIONED_SEGMENT = /^(?:v\d+\.\d+\.\d+|[^/@]+@\d+\.\d+\.\d+|[^/@]+@[0-9a-f]{40})$/;
const HASH_LITERAL = /['"`][0-9a-f]{64}['"`]/;
const HASH_WINDOW = 6; // lines after the URL's own line

const isDownload = (url, host) => DOWNLOAD_HOSTS.includes(host) && /\/(?:resolve|download|-)\/|^\/[^/]+@|\/npm\/|\/gh\//.test(url.pathname) || DOWNLOAD_EXTENSION.test(url.pathname);

// The version or commit must sit in the path position that selects the content, not anywhere in the string.
function pinnedPath(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const after = (word) => segments[segments.indexOf(word) + 1];
  switch (url.hostname) {
    case 'huggingface.co': return segments.includes('resolve') && COMMIT.test(after('resolve') ?? '');
    case 'github.com': return segments.includes('download') && /^v?\d+\.\d+\.\d+/.test(after('download') ?? '');
    case 'registry.npmjs.org': return segments.at(-2) === '-' && /-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz$/.test(segments.at(-1));
    case 'objects.githubusercontent.com': return false; // a signed, expiring link: nothing in it selects fixed content
    default: return segments.some((s) => COMMIT.test(s) || VERSIONED_SEGMENT.test(s));
  }
}

// Every download URL literal with its line number.
function downloadsIn(lines) {
  const found = [];
  lines.forEach((line, at) => {
    for (const raw of line.match(URL_LITERAL) ?? []) {
      let url;
      try { url = new URL(raw.replace(/[.,;:]+$/, '')); } catch { continue; }
      if (isDownload(url, url.hostname)) found.push({ at, url });
    }
  });
  return found;
}

/**
 * Each download URL must be pinned in its path, and its own sha256 must follow it: the word sha256 and a quoted 64-hex hash on
 * its line or within the next few lines, before the next download URL, so one URL cannot borrow another's hash.
 */
export function downloadViolations(source, where) {
  const lines = source.split('\n');
  const downloads = downloadsIn(lines);
  const found = [];
  for (const { at, url } of downloads) {
    const next = downloads.find((d) => d.at > at)?.at ?? Infinity;
    const window = lines.slice(at, Math.min(at + HASH_WINDOW + 1, next)).join('\n');
    if (!pinnedPath(url)) found.push(`${where}: ${url.href} (a download with no commit or version in its path)`);
    else if (!(/sha256/i.test(window) && HASH_LITERAL.test(window))) found.push(`${where}: ${url.href} (a download with no sha256 after it)`);
  }
  return found;
}

// ---- what the scans cover -----------------------------------------------------------------------------------------------

const dirsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)) : []);
const filesIn = (dir, keep) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && keep(e.name)).map((e) => path.join(dir, e.name)) : []);

function walk(dir, keep, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(file, keep, found); } else if (keep(file)) found.push(file);
  }
  return found;
}

const skillDirs = dirsIn(SKILLS);
const optionalDirs = skillDirs.flatMap((skill) => dirsIn(path.join(skill, 'optional')));
const manifests = [...skillDirs, ...optionalDirs].map((dir) => path.join(dir, 'package.json')).filter((file) => fs.existsSync(file));
const lockfiles = walk(PLUGIN, (file) => path.basename(file) === 'package-lock.json');
const isMjs = (file) => file.endsWith('.mjs');
const isDoc = (file) => /\.(?:md|html)$/.test(file);
const prose = [
  ...['README.md', 'USAGE.md'].map((name) => path.join(PLUGIN, name)),
  ...skillDirs.flatMap((skill) => ['SKILL.md', 'README.md'].map((name) => path.join(skill, name))),
  ...skillDirs.flatMap((skill) => filesIn(path.join(skill, 'references'), (name) => name.endsWith('.md'))),
].filter((file) => fs.existsSync(file));
// The repo's own docs and site pages. docs/superpowers (plans and specs that quote old commands on purpose), the generated
// showcase gallery (rebuilt by design step 9) and docs/second-wind (session notes) are left out.
const DOC_SKIPPED = ['docs/superpowers/', 'docs/features/showcase/', 'docs/second-wind/'];
const repoDocs = [
  path.join(REPO, 'AGENTS.md'),
  ...walk(path.join(REPO, 'docs'), (file) => isDoc(file) && !DOC_SKIPPED.some((skip) => rel(file).startsWith(skip))),
  ...walk(path.join(REPO, 'site'), isDoc),
].filter((file) => fs.existsSync(file));
const code = [
  ...skillDirs.flatMap((skill) => walk(path.join(skill, 'scripts'), isMjs)),
  ...optionalDirs.map((dir) => path.join(dir, 'index.mjs')).filter((file) => fs.existsSync(file)),
  ...walk(path.join(PLUGIN, 'shared'), (file) => isMjs(file) && !file.includes(`${path.sep}test${path.sep}`)),
];
const binCode = filesIn(path.join(PLUGIN, 'bin'), (name) => name.endsWith('.mjs')); // downloads only: the installer is not an install command

// An HTML page's commands sit inside tags and entities: scan what a reader sees, with <code> shown as backticks.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
const readable = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.html')) return text;
  return text.replace(/<\/?code[^>]*>/g, '`').replace(/<[^>]+>/g, '').replace(/&(?:lt|gt|amp|quot|#39);/g, (e) => ENTITIES[e]);
};
const collect = (files, check) => files.flatMap((file) => check(readable(file), rel(file)));
// Human-typed commands in docs: the install CLI (the doctor pins skills@1.7.2) and Playwright (resolved from the skill's own node_modules).
const DOC_NPX = ['skills', 'playwright'];
const docInstallCheck = (text, where) => installViolations(text, where, DOC_NPX);
const lockOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
const optionalLocks = Object.fromEntries(optionalDirs.filter((dir) => fs.existsSync(path.join(dir, 'package-lock.json'))).map((dir) => [path.basename(dir), lockOf(dir)]));
const scriptFolders = foldersWithInstallScripts(optionalLocks);

// ---- the rules, on the real tree ----------------------------------------------------------------------------------------

test('the scans find what they should', () => {
  assert.ok(manifests.length >= 7, `manifests: ${manifests.map(rel).join(', ')}`);
  assert.ok(lockfiles.length >= 7, `lockfiles: ${lockfiles.map(rel).join(', ')}`);
  const codeNames = code.map(rel);
  assert.ok(codeNames.includes('plugins/portable-artifacts/skills/make-motion/scripts/lib/voice.mjs'));
  assert.ok(codeNames.includes('plugins/portable-artifacts/skills/make-motion/scripts/lib/cutout.mjs'));
  assert.ok(codeNames.includes('plugins/portable-artifacts/shared/doctor.mjs'));
  assert.ok(prose.map(rel).includes('plugins/portable-artifacts/skills/make-motion/SKILL.md'));
  const docNames = repoDocs.map(rel);
  for (const wanted of ['AGENTS.md', 'docs/features/portable-artifacts.html', 'site/index.html']) assert.ok(docNames.includes(wanted), wanted);
  assert.deepEqual(scriptFolders.sort(), ['cutout', 'voice'], 'both optional lockfiles carry onnxruntime-node, which has a postinstall');
});

test('every manifest pins exact versions', () => {
  assert.deepEqual(manifests.flatMap((file) => rangeViolations(JSON.parse(fs.readFileSync(file, 'utf8')), rel(file))), []);
});

test('every manifest has a lockfile beside it', () => {
  const missing = manifests.filter((file) => !fs.existsSync(path.join(path.dirname(file), 'package-lock.json'))).map((file) => `${rel(file)}: no package-lock.json beside it`);
  assert.deepEqual(missing, []);
});

test('every lockfile resolves only from registry.npmjs.org and has an integrity hash for every package', () => {
  assert.deepEqual(lockfiles.flatMap((file) => lockfileViolations(JSON.parse(fs.readFileSync(file, 'utf8')), rel(file))), []);
});

test('every install command in prose, code and the repo docs names exact versions, never --no-save, and no npx runs an unpinned package', () => {
  assert.deepEqual([...collect(prose, docInstallCheck), ...collect(code, installViolations), ...collect(repoDocs, docInstallCheck)], []);
});

test('an optional package whose lockfile has an install script is only installed with --ignore-scripts', () => {
  const check = (text, where) => ignoreScriptsViolations(text, where, scriptFolders);
  assert.deepEqual([...collect(prose, check), ...collect(code, check), ...collect(repoDocs, check)], []);
});

test('every model or binary download is pinned and has a sha256 beside it', () => {
  assert.deepEqual([...collect(code, downloadViolations), ...collect(binCode, downloadViolations)], []);
});

// ---- guardrail proofs: each checker fires on a bad fixture ---------------------------------------------------------------

test('guardrail proof: rangeViolations flags every range, tag, URL and nested override, and passes exact pins', () => {
  const manifest = {
    dependencies: { a: '^1.0.0', b: '~1.0.0', c: '>=1', d: 'latest', e: 'github:x/y', f: 'https://x/y.tgz', g: '1.x', h: '1.2.3' },
    overrides: { i: { j: '^2.0.0' }, k: '3.1.9' },
  };
  assert.equal(rangeViolations(manifest, 'm').length, 8);
  assert.deepEqual(rangeViolations({ dependencies: { ajv: '^8.20.0' } }, 'skills/make-motion/package.json'), ['skills/make-motion/package.json: dependencies.ajv = ^8.20.0']);
  assert.deepEqual(rangeViolations({ devDependencies: { a: '1.0.0-rc.1' }, optionalDependencies: {}, overrides: { sharp: '0.35.5' } }, 'm'), []);
});

test('guardrail proof: lockfileViolations flags a git or URL source, a foreign registry and a missing integrity, and passes a clean lock', () => {
  const ok = { resolved: `${REGISTRY}a/-/a-1.0.0.tgz`, integrity: 'sha512-abc' };
  const lock = { packages: {
    '': { name: 'root' },
    'node_modules/a': ok,
    'node_modules/b': { resolved: 'git+ssh://git@github.com/x/b.git#abc', integrity: 'sha512-abc' },
    'node_modules/c': { resolved: 'https://evil.example/c-1.0.0.tgz', integrity: 'sha512-abc' },
    'node_modules/d': { resolved: `${REGISTRY}d/-/d-1.0.0.tgz` },
    'node_modules/e': { resolved: `${REGISTRY}e/-/e-1.0.0.tgz`, integrity: '' },
    'node_modules/f': { version: '1.0.0' },
    'node_modules/g': { link: true, resolved: '../g' },
    'node_modules/h/node_modules/i': { inBundle: true },
  } };
  assert.equal(lockfileViolations(lock, 'l').length, 6, lockfileViolations(lock, 'l').join('\n'));
  assert.deepEqual(lockfileViolations({ packages: { '': {}, 'node_modules/a': ok } }, 'l'), []);
});

test('guardrail proof: installViolations flags a bare, unpinned or --no-save install, other package managers, unpinned npx and argv forms', () => {
  const bad = ['`npm install kokoro-js --no-save`', '`npm i ffmpeg-static`', '`npm install kokoro-js@1.2.1 --no-save`', 'after `npm install`:', "['npm', 'install', PIN]",
    '`npm add left-pad`', '`pnpm add left-pad`', '`yarn add left-pad`', '`npx skills add x/y`', '`npx --yes cowsay@latest hi`', '["npm", "install", PIN]', "['pnpm', 'add', X]", '"yarn", "add"',
    "run('npx cowsay hi')", 'sudo npx cowsay hi', '`npx ${TOOL} add x`'];
  for (const text of bad) assert.equal(installViolations(text, 'x').length, 1, text);
  const good = ['`npm ci --prefix <dir>` or `npm install shiki@4.5.0`', '`npm install --prefix /x shiki@4.5.0 --save-exact`', '`pnpm add left-pad@1.3.0`', '`npx --yes skills@1.7.2 add x/y`',
    '`npx --no --prefix /x playwright install chromium`', '`npx --no-install tsc`', 'prose about npx and what it does', "const TOOL = 'skills@1.7.2';\n`npx ${TOOL} add x`"];
  for (const text of good) assert.equal(installViolations(text, 'x').length, 0, text);
  assert.equal(installViolations('`npx skills add x/y`', 'x', ['skills']).length, 0, 'an allowed human-typed docs command');
  assert.equal(installViolations('`npx cowsay hi`', 'x', ['skills']).length, 1, 'only the allowed name');
});

test('guardrail proof: ignoreScriptsViolations flags an optional install without --ignore-scripts, in a command string and in an argv', () => {
  const folders = ['voice', 'cutout'];
  const count = (text) => ignoreScriptsViolations(text, 'x', folders).length;
  assert.equal(count('`npm ci --prefix <skill-dir>/optional/voice`'), 1);
  assert.equal(count('`npm install onnxruntime-node@1.31.1 --prefix /s/optional/cutout`'), 1);
  assert.equal(count("['npm', 'ci', '--prefix', path.join(dir, 'optional', name)]"), 1);
  assert.equal(count('`npm ci --ignore-scripts --prefix <skill-dir>/optional/voice`'), 0);
  assert.equal(count("['npm', 'ci', '--ignore-scripts', '--prefix', path.join(dir, 'optional', name)]"), 0);
  assert.equal(count('`npm ci --prefix <skill-dir>` and `npm ci --prefix /s/optional/other`'), 0, 'the skill itself and a folder with no install script');
  assert.equal(ignoreScriptsViolations('`npm ci --prefix /s/optional/voice`', 'x', []).length, 0, 'no lockfile has an install script');
  assert.deepEqual(foldersWithInstallScripts({ a: { packages: { 'node_modules/x': { hasInstallScript: true } } }, b: { packages: { 'node_modules/y': {} } } }), ['a']);
});

test('guardrail proof: downloadViolations is per URL, and a pin counts only in the path position that selects the content', () => {
  const sha = 'b'.repeat(64);
  const commit = 'a'.repeat(40);
  const hf = (tail) => `https://huggingface.co/o/m/resolve/${tail}`;
  const count = (source) => downloadViolations(source, 'x').length;
  assert.equal(count(`const U = '${hf('main/f.bin')}'; // sha256\nconst H = '${sha}';`), 1, 'a branch, whatever hash is present');
  assert.equal(count(`const U = '${hf(`${commit}/f.bin`)}';`), 1, 'pinned, but no hash');
  assert.equal(count(`const U = '${hf(`${commit}/f.bin`)}'; const MODEL_SHA256 = '${sha}';`), 0);
  assert.equal(count("const U = 'https://nodejs.org';"), 0);
  assert.equal(count("const U = 'https://example.com/tool.zip';"), 1, 'an archive with no version in the URL');
  assert.equal(count(`const U = '${hf('main/f.bin')}?rev=${commit}'; const MODEL_SHA256 = '${sha}';`), 1, 'a commit in the query string does not pin the path');
  assert.equal(count(`const U = '${hf('main/')}${commit}.bin'; const MODEL_SHA256 = '${sha}';`), 1, 'a commit-looking file name is not the commit segment');
  assert.equal(count(`const A = '${hf(`${commit}/a.bin`)}'; const SHA256_A = '${sha}';\n${'// filler\n'.repeat(12)}const B = '${hf(`${commit}/b.bin`)}';`), 1, 'a second URL far from any hash fails on its own');
  assert.equal(count(`const A = '${hf(`${commit}/a.bin`)}'; const SHA256_A = '${sha}';\nconst B = '${hf(`${commit}/b.bin`)}';`), 1, 'a second URL right below the first cannot borrow its hash');
  assert.equal(count(`const A = '${hf(`${commit}/a.bin`)}';\nconst B = '${hf(`${commit}/b.bin`)}'; const SHA256_B = '${sha}';`), 1, 'nor can the first borrow the second\'s');
  assert.equal(count(`const BASE = '${hf(`${commit}/`)}';\nconst FILES = [\n  { sha256: '${sha}' },\n  { sha256: '${sha}' },\n];`), 0, 'one base URL followed by its list of hashes');
  assert.equal(count("const U = 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz'; const sha256 = '" + sha + "';"), 0);
  assert.equal(count("const U = 'https://registry.npmjs.org/left-pad/latest'; const sha256 = '" + sha + "';"), 0, 'metadata, not a tarball or a download');
  assert.equal(count("const U = 'https://github.com/o/r/releases/download/v1.2.3/a.tgz'; const sha256 = '" + sha + "';"), 0);
  assert.equal(count("const U = 'https://github.com/o/r/releases/download/latest/a.tgz'; const sha256 = '" + sha + "';"), 1);
});

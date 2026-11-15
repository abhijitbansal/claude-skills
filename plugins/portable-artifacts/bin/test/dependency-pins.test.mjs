// Standing rules for what the plugin installs or downloads: no dependency range in a manifest, no `npm install` without exact
// package versions (and never --no-save), and every model or binary download pinned to a commit or version with a SHA-256 beside it.
// Three pure checkers, each returning "<where>: <what>" strings; the tests run them on the real tree and on bad fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = path.join(PLUGIN, 'skills');
const SKIP_DIRS = new Set(['node_modules', '.cache']);
const rel = (file) => path.relative(PLUGIN, file).split(path.sep).join('/');

// ---- the checkers -------------------------------------------------------------------------------------------------------

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

const NPM_INSTALL = /\bnpm\s+(?:install|i)(?=\s|$|`)([^\n`|;&)]*)/g;
const NPM_INSTALL_ARGV = /'npm',\s*'(?:install|i)'/;
const PACKAGE_SPEC = /^(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/;
const VALUE_FLAGS = new Set(['--prefix', '-C', '--workspace', '-w', '--cache']); // the next word is the flag's value, not a package

function installProblem(argText) {
  const words = argText.trim().split(/\s+/).filter(Boolean);
  if (words.includes('--no-save')) return '--no-save is refused';
  const packages = [];
  for (let i = 0; i < words.length; i++) {
    if (VALUE_FLAGS.has(words[i])) i++;
    else if (!words[i].startsWith('-')) packages.push(words[i]);
  }
  if (packages.length === 0) return 'names no package';
  const loose = packages.find((p) => !PACKAGE_SPEC.test(p));
  return loose === undefined ? null : `${loose} is not name@x.y.z`;
}

/** An `npm install` in prose or code must name packages at exact versions, never with --no-save; an argv form is always refused. */
export function installViolations(text, where) {
  const found = [];
  for (const match of text.matchAll(NPM_INSTALL)) {
    const problem = installProblem(match[1]);
    if (problem) found.push(`${where}: ${match[0].trim()} (${problem})`);
  }
  if (NPM_INSTALL_ARGV.test(text)) found.push(`${where}: an npm install argv (use npm ci with a lockfile)`);
  return found;
}

const URL_LITERAL = /https?:\/\/[^\s'"`)<>]+/g;
const DOWNLOAD_HOSTS = [/^https?:\/\/huggingface\.co\/.*\/resolve\//, /^https?:\/\/github\.com\/.*\/releases\/download\//, /^https?:\/\/objects\.githubusercontent\.com\//,
  /^https?:\/\/registry\.npmjs\.org\//, /^https?:\/\/cdn\.jsdelivr\.net\//, /^https?:\/\/unpkg\.com\//];
const DOWNLOAD_EXTENSION = /\.(?:onnx|bin|safetensors|gz|tgz|zip|exe|dmg|wasm)$/;
const PINNED = /\/[0-9a-f]{40}(?:\/|$)|@\d+\.\d+\.\d+|\/v\d+\.\d+\.\d+\//;
const HASH_LITERAL = /['"`][0-9a-f]{64}['"`]/;

/** A download URL must hold a commit, a version or a release tag, and its file must carry a sha256 and a quoted 64-hex hash. */
export function downloadViolations(source, where) {
  const hashed = /sha256/i.test(source) && HASH_LITERAL.test(source);
  const found = [];
  for (const raw of source.match(URL_LITERAL) ?? []) {
    const url = raw.replace(/[.,;:]+$/, '');
    if (!DOWNLOAD_HOSTS.some((host) => host.test(url)) && !DOWNLOAD_EXTENSION.test(url)) continue;
    if (!PINNED.test(url)) found.push(`${where}: ${url} (a download with no commit or version in it)`);
    else if (!hashed) found.push(`${where}: ${url} (a download with no sha256 beside it)`);
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
const packageDirs = [...skillDirs, ...skillDirs.flatMap((skill) => dirsIn(path.join(skill, 'optional')))];
const manifests = packageDirs.map((dir) => path.join(dir, 'package.json')).filter((file) => fs.existsSync(file));
const prose = [
  ...['README.md', 'USAGE.md'].map((name) => path.join(PLUGIN, name)),
  ...skillDirs.flatMap((skill) => ['SKILL.md', 'README.md'].map((name) => path.join(skill, name))),
  ...skillDirs.flatMap((skill) => filesIn(path.join(skill, 'references'), (name) => name.endsWith('.md'))),
].filter((file) => fs.existsSync(file));
const isMjs = (file) => file.endsWith('.mjs');
const code = [
  ...skillDirs.flatMap((skill) => walk(path.join(skill, 'scripts'), isMjs)),
  ...skillDirs.flatMap((skill) => dirsIn(path.join(skill, 'optional')).map((dir) => path.join(dir, 'index.mjs'))).filter((file) => fs.existsSync(file)),
  ...walk(path.join(PLUGIN, 'shared'), (file) => isMjs(file) && !file.includes(`${path.sep}test${path.sep}`)),
];
const binCode = filesIn(path.join(PLUGIN, 'bin'), (name) => name.endsWith('.mjs')); // downloads only: the installer is not an install command

const read = (file) => fs.readFileSync(file, 'utf8');
const collect = (files, check) => files.flatMap((file) => check(read(file), rel(file)));

// ---- the rules, on the real tree ----------------------------------------------------------------------------------------

test('the scans find what they should', () => {
  assert.ok(manifests.length >= 7, `manifests: ${manifests.map(rel).join(', ')}`);
  const codeNames = code.map(rel);
  assert.ok(codeNames.includes('skills/make-motion/scripts/lib/voice.mjs'));
  assert.ok(codeNames.includes('skills/make-motion/scripts/lib/cutout.mjs'));
  assert.ok(prose.map(rel).includes('skills/make-motion/SKILL.md'));
  assert.ok(manifests.map(rel).includes('skills/make-motion/optional/voice/package.json'));
});

test('every manifest pins exact versions', () => {
  const found = manifests.flatMap((file) => rangeViolations(JSON.parse(read(file)), rel(file)));
  assert.deepEqual(found, []);
});

test('every manifest has a lockfile beside it', () => {
  const missing = manifests.filter((file) => !fs.existsSync(path.join(path.dirname(file), 'package-lock.json'))).map((file) => `${rel(file)}: no package-lock.json beside it`);
  assert.deepEqual(missing, []);
});

test('every npm install in prose and code names exact versions and none is --no-save', () => {
  assert.deepEqual([...collect(prose, installViolations), ...collect(code, installViolations)], []);
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

test('guardrail proof: installViolations flags a bare, unpinned or --no-save install and an argv form, and passes npm ci and a pinned install', () => {
  for (const bad of ['`npm install kokoro-js --no-save`', '`npm i ffmpeg-static`', '`npm install kokoro-js@1.2.1 --no-save`', 'after `npm install`:', "['npm', 'install', PIN]"]) {
    assert.equal(installViolations(bad, 'x').length, 1, bad);
  }
  assert.equal(installViolations('`npm ci --prefix <dir>` or `npm install shiki@4.5.0`', 'x').length, 0);
  assert.equal(installViolations('`npm install --prefix /x shiki@4.5.0 --save-exact`', 'x').length, 0, 'a flag value is not a package');
});

test('guardrail proof: downloadViolations flags an unpinned download and a pinned one with no hash, and passes a pinned, hashed one', () => {
  const sha = 'b'.repeat(64);
  const commit = 'a'.repeat(40);
  assert.equal(downloadViolations(`const U = 'https://huggingface.co/o/m/resolve/main/f.bin'; // sha256\nconst H = '${sha}';`, 'x').length, 1);
  assert.equal(downloadViolations(`const U = 'https://huggingface.co/o/m/resolve/${commit}/f.bin';`, 'x').length, 1);
  assert.equal(downloadViolations(`const U = 'https://huggingface.co/o/m/resolve/${commit}/f.bin'; const MODEL_SHA256 = '${sha}';`, 'x').length, 0);
  assert.equal(downloadViolations("const U = 'https://nodejs.org';", 'x').length, 0);
  assert.equal(downloadViolations("const U = 'https://example.com/tool.zip';", 'x').length, 1, 'an archive with no version in the URL');
});

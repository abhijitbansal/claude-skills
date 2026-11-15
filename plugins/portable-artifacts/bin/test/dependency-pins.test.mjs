// Standing rules for what the plugin installs or downloads: no dependency range in a manifest, no install command without a
// lockfile or exact versions (never --no-save), install scripts skipped for the optional packages that carry one, every lockfile
// resolved only from registry.npmjs.org (each tarball named for its own package and version) with an integrity hash, and every
// model or binary download pinned to a commit or version with its own SHA-256 after that URL and no network call outside
// scripts/lib/pinned-file.mjs.
//
// Be clear about what this is: PATTERN CHECKS over text. They raise the cost of an unlocked or unhashed install slipping in by
// accident, and they fail loudly on the common shapes (prose and doc commands, argv arrays, spawn calls, URL literals). They are
// not a proof: a command assembled at run time, an install hidden behind an indirection, or a download written in a way no
// pattern here knows will pass. The real protections are the committed lockfiles with integrity hashes, `npm ci
// --ignore-scripts`, the pinned and hashed model downloads, and review. Each checker is pure and returns "<where>: <what>"
// strings; the tests run them on the real tree and on bad fixtures, so each rule is shown to fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// The registry tarball URL of a package: <registry><name>/-/<unscoped name>-<version>.tgz.
const tarballOf = (name, version) => `${REGISTRY}${name}/-/${name.split('/').pop()}-${version}.tgz`;

/**
 * A lockfile needs a `packages` map (an old format cannot be checked). Every locked package resolves from the npm registry, to the
 * tarball of its own name and version, and carries an integrity hash (links and bundled packages have neither).
 */
export function lockfileViolations(lock, where) {
  if (lock.packages === null || typeof lock.packages !== 'object') return [`${where}: no "packages" map (lockfileVersion ${lock.lockfileVersion ?? 'unknown'})`];
  const found = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '' || entry.link || entry.inBundle) continue;
    const label = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const name = entry.name ?? label; // an npm: alias carries its real name
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY)) found.push(`${where}: ${label} resolves from ${entry.resolved ?? 'nowhere'}, not ${REGISTRY}`);
    else if (entry.resolved !== tarballOf(name, entry.version)) found.push(`${where}: ${label}@${entry.version} resolves to ${entry.resolved}, not ${tarballOf(name, entry.version)}`);
    if (typeof entry.integrity !== 'string' || entry.integrity === '') found.push(`${where}: ${label} has no integrity`);
  }
  return found;
}

/** The names of the optional folders whose lockfile holds a package with an install script. */
export const foldersWithInstallScripts = (locks) => Object.entries(locks).filter(([, lock]) => Object.values(lock.packages ?? {}).some((p) => p.hasInstallScript)).map(([name]) => name);

// ---- install commands ---------------------------------------------------------------------------------------------------

const NPM_INSTALL = new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall']);
const NPM_CI = new Set(['ci', 'ic', 'clean-install', 'install-clean', 'cit', 'clean-install-test', 'sit', 'install-ci-test']);
// per package manager: the subcommands that install named packages, and the ones that fetch and run one
const SUBCOMMANDS = {
  npm: { install: NPM_INSTALL, ci: NPM_CI, runner: new Set() },
  pnpm: { install: new Set(['add', 'install', 'i']), ci: new Set(), runner: new Set(['dlx']) },
  yarn: { install: new Set(['add']), ci: new Set(), runner: new Set(['dlx']) },
  bun: { install: new Set(['add']), ci: new Set(), runner: new Set(['x']) },
};
const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
const MANAGER_COMMAND = /\b(npm|pnpm|yarn|bun)(?=\s)([^\n`|;&)]*)/g;
// a runner as a command (after a quote, a backtick, `sudo`, `&&`, `$` or a line start), not the word in a sentence
const RUNNER_COMMAND = /(?:^|[`'"(]|\bsudo\s|&&\s|\$\s)(npx|pnpx|bunx)\s+([^\n`|;&)]*)/gm;
// spawn-family call with a literal argv array; the first argument (a path expression of any shape, even path.join(a, 'npm')) is
// only inspected for the manager's name.
const SPAWN_CALL = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*((?:[^,[()\n]|\([^()\n]*\))*?)\s*,\s*\[([^\]]*)\]/g;
const MANAGER_WORD = /\b(pnpm|pnpx|npm|npx|yarn|bunx|bun)/;
const INSTALL_ARGV = /['"]npm['"],\s*['"](?:install|i|add)['"]|['"]pnpm['"],\s*['"](?:install|i|add|dlx)['"]|['"]yarn['"],\s*['"](?:add|dlx)['"]|['"]bun['"],\s*['"](?:add|x)['"]/;
const HEAD_ARRAY = /\[\s*['"](npm|pnpm|yarn|bun)['"]\s*,([^\]]*)\]/g;
const PACKAGE_SPEC = /^(?:@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/;
const VALUE_FLAGS = new Set(['--prefix', '-C', '--workspace', '-w', '--cache', '-p', '--package']); // the next word is the flag's value

const wordsOf = (argText) => argText.trim().split(/\s+/).filter(Boolean);

// A command wrapped over lines reads as one: a trailing backslash, or a line break inside a short backtick span.
const joinWrapped = (text) => text
  .replace(/\\\r?\n[ \t]*/g, ' ')
  .replace(/`([^`\n]*(?:\n[^`\n]*){1,3})`/g, (_m, inner) => `\`${inner.replace(/\s*\n\s*/g, ' ')}\``);

// The words of a spawn argv literal: a string is its value, anything else is an unknowable expression.
function arrayWords(arrayText) {
  return arrayText.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const literal = /^(['"`])(.*)\1$/s.exec(part);
    return literal && !literal[2].includes('${') ? literal[2] : `\${${part}}`;
  });
}

function positionals(words) {
  const found = [];
  for (let i = 0; i < words.length; i++) {
    if (VALUE_FLAGS.has(words[i])) i++;
    else if (!words[i].startsWith('-')) found.push(words[i]);
  }
  return found;
}

// Splits a command's words into the subcommand and what follows, skipping flags (and their values) in front of it.
function parseWords(words) {
  let i = 0;
  while (i < words.length && words[i].startsWith('-')) i += VALUE_FLAGS.has(words[i]) ? 2 : 1;
  return { sub: words[i], rest: words.slice(i + 1) };
}

// Every package-manager command in the text: written out, or as a spawn call with an argv array.
function commandsIn(text) {
  const found = [];
  for (const m of text.matchAll(MANAGER_COMMAND)) found.push({ manager: m[1], all: wordsOf(m[2]), raw: m[2], shown: `${m[1]} ${m[2].trim()}` });
  for (const m of text.matchAll(RUNNER_COMMAND)) found.push({ manager: m[1], all: wordsOf(m[2]), raw: m[2], shown: `${m[1]} ${m[2].trim()}` });
  for (const m of text.matchAll(SPAWN_CALL)) {
    const manager = MANAGER_WORD.exec(m[1])?.[1];
    if (manager) found.push({ manager, all: arrayWords(m[2]), raw: m[2], shown: `${manager} ${arrayWords(m[2]).join(' ')}` });
  }
  return found;
}

function installProblem(words, allowed) {
  if (words.includes('--no-save')) return '--no-save is refused';
  const packages = positionals(words);
  if (packages.length === 0) return 'names no package';
  const loose = packages.find((p) => !PACKAGE_SPEC.test(p) && !allowed.includes(p));
  return loose === undefined ? null : `${loose} is not name@x.y.z`;
}

// The packages a runner fetches: the ones named by -p / --package (the first positional is then only the command to run), else
// the first positional.
function runnerTargets(words) {
  const named = [];
  words.forEach((w, i) => {
    if ((w === '-p' || w === '--package') && words[i + 1] !== undefined) named.push(words[i + 1]);
    else if (w.startsWith('--package=')) named.push(w.slice('--package='.length));
  });
  return named.length > 0 ? named : positionals(words).slice(0, 1);
}

// A runner fetches and runs the latest version unless the package is pinned; `--no` (or --no-install) only ever runs a local one.
// A `${NAME}` argument counts as pinned when the same text says `const NAME = 'pkg@x.y.z'`.
function runnerProblem(words, text, allowed) {
  if (words.includes('--no') || words.includes('--no-install')) return null;
  for (const target of runnerTargets(words)) {
    if (PACKAGE_SPEC.test(target) || allowed.includes(target)) continue;
    const name = /^\$\{(\w+)\}$/.exec(target)?.[1];
    const value = name && new RegExp(`const ${name} = ['"]([^'"]+)['"]`).exec(text)?.[1];
    if (!value || !PACKAGE_SPEC.test(value)) return `${target} is not name@x.y.z (or pass --no)`;
  }
  return null;
}

function commandProblem(command, text, allowed) {
  if (RUNNERS.has(command.manager)) return runnerProblem(command.all, text, allowed);
  const { sub, rest } = parseWords(command.all);
  const kinds = SUBCOMMANDS[command.manager];
  if (kinds.install.has(sub)) return installProblem(rest, allowed);
  return kinds.runner.has(sub) ? runnerProblem(rest, text, allowed) : null;
}

// An install argv written as a literal array, whatever flags sit between the manager and the subcommand.
function installArgvIn(text) {
  if (INSTALL_ARGV.test(text)) return true;
  return [...text.matchAll(HEAD_ARRAY)].some((m) => {
    const { sub } = parseWords(arrayWords(m[2]));
    const kinds = SUBCOMMANDS[m[1]];
    return kinds.install.has(sub) || kinds.runner.has(sub);
  });
}

/**
 * A package install in prose or code names exact versions and never --no-save, whatever the package manager (npm, pnpm, yarn,
 * bun), flags before the subcommand, command wrapping or spawn call it is written with. A runner (npx, pnpx, bunx, dlx, x) must
 * name a pinned package, the one given to -p / --package when there is one. Any install argv literal is refused.
 * `allowedUnpinned` names packages a human-typed command in a doc may install or run unpinned (code allows none).
 */
export function installViolations(text, where, allowedUnpinned = []) {
  const joined = joinWrapped(text);
  const found = [];
  for (const command of commandsIn(joined)) {
    const problem = commandProblem(command, joined, allowedUnpinned);
    if (problem) found.push(`${where}: ${command.shown} (${problem})`);
  }
  if (installArgvIn(joined)) found.push(`${where}: an install argv (use npm ci with a lockfile)`);
  return found;
}

const OPTIONAL_PATH = /optional[\\/]([\w-]+)/;
const OPTIONAL_LITERAL = /['"`]optional['"`]/;

/**
 * Any npm ci or install of an optional folder whose lockfile has an install script must carry --ignore-scripts: a command string
 * naming optional/<name>, a spawn call or an argv built for an `optional` folder, with any `ci` alias and flags in front.
 * `folders` is foldersWithInstallScripts().
 */
export function ignoreScriptsViolations(text, where, folders) {
  if (folders.length === 0) return [];
  const joined = joinWrapped(text);
  const found = [];
  for (const command of commandsIn(joined)) {
    const kinds = SUBCOMMANDS[command.manager];
    const { sub } = parseWords(command.all);
    if (!kinds || !(kinds.ci.has(sub) || kinds.install.has(sub))) continue;
    const folder = OPTIONAL_PATH.exec(command.raw)?.[1];
    const touches = (folder !== undefined && folders.includes(folder)) || OPTIONAL_LITERAL.test(command.raw);
    if (touches && !command.all.includes('--ignore-scripts')) found.push(`${where}: ${command.shown} (no --ignore-scripts)`);
  }
  for (const match of joined.matchAll(HEAD_ARRAY)) {
    const words = arrayWords(match[2]);
    const kinds = SUBCOMMANDS[match[1]];
    const { sub } = parseWords(words);
    if (kinds.ci.has(sub) || kinds.install.has(sub)) {
      if (OPTIONAL_LITERAL.test(match[0]) && !words.includes('--ignore-scripts')) found.push(`${where}: ${match[0]} (no --ignore-scripts)`);
    }
  }
  return found;
}

// ---- downloads ----------------------------------------------------------------------------------------------------------

const URL_LITERAL = /https?:\/\/[^\s'"`)<>]+/g;
const DOWNLOAD_HOSTS = ['huggingface.co', 'github.com', 'objects.githubusercontent.com', 'registry.npmjs.org', 'cdn.jsdelivr.net', 'unpkg.com'];
const DOWNLOAD_EXTENSION = /\.(?:onnx|bin|safetensors|gz|tgz|zip|exe|dmg|wasm)$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSIONED_SEGMENT = /^(?:v\d+\.\d+\.\d+|[^/@]+@\d+\.\d+\.\d+|[^/@]+@[0-9a-f]{40})$/;
const AT_VERSION = /^[^@]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/; // <name>@x.y.z: the version right after the package name
const AT_REF = /^[^@]+@(?:[0-9a-f]{40}|v?\d+\.\d+\.\d+)$/;
const HASH_LITERAL = /['"`][0-9a-f]{64}['"`]/;
const HASH_WINDOW = 6; // lines after the URL's own line

// Whole hosts that only serve files, and the path shapes that mean a file on the others (a page on github.com is not a download).
const FILE_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'objects.githubusercontent.com'];
const DOWNLOAD_PATH = { 'huggingface.co': /\/resolve\//, 'github.com': /\/(?:releases\/download|archive)\//, 'registry.npmjs.org': /\/-\// };
const isDownload = (url) => FILE_HOSTS.includes(url.hostname) || DOWNLOAD_PATH[url.hostname]?.test(url.pathname) === true || DOWNLOAD_EXTENSION.test(url.pathname);

// jsDelivr and unpkg: the version is the `@<ref>` right after the package (or repo) name, never anywhere else in the path.
function cdnPinned(host, segments) {
  if (host === 'unpkg.com') return AT_VERSION.test(segments[0]?.startsWith('@') ? segments[1] ?? '' : segments[0] ?? '');
  if (segments[0] === 'npm') return AT_VERSION.test(segments[1]?.startsWith('@') ? segments[2] ?? '' : segments[1] ?? '');
  return segments[0] === 'gh' && AT_REF.test(segments[2] ?? '');
}

// The version or commit must sit in the path position that selects the content, not anywhere in the string.
function pinnedPath(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const after = (word) => segments[segments.indexOf(word) + 1];
  switch (url.hostname) {
    case 'huggingface.co': return segments.includes('resolve') && COMMIT.test(after('resolve') ?? '');
    case 'github.com': return segments.includes('download') && /^v?\d+\.\d+\.\d+/.test(after('download') ?? '');
    case 'registry.npmjs.org': return segments.at(-2) === '-' && /-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz$/.test(segments.at(-1));
    case 'cdn.jsdelivr.net':
    case 'unpkg.com': return cdnPinned(url.hostname, segments);
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
      if (isDownload(url)) found.push({ at, url });
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

const HUGGING_FACE_URL = /https?:\/\/huggingface\.co[^\s'"`)<>]*/g;
const RESOLVE_COMMIT = /\/resolve\/[0-9a-f]{40}\//;
const HEX_64 = /^[0-9a-f]{64}$/;

/** Every huggingface.co URL literal names a 40-hex commit right after /resolve/ (never a branch such as main). */
export const huggingFaceCommitViolations = (source, where) => [...source.matchAll(HUGGING_FACE_URL)]
  .filter((m) => !RESOLVE_COMMIT.test(m[0]))
  .map((m) => `${where}: ${m[0]} (a Hugging Face URL with no 40-hex commit after /resolve/)`);

/**
 * A pinned model table (`{ id, commit, base, files: [{ path, bytes, sha256 }] }`): a 40-hex commit that its base URL ends with, and for
 * every file a path, a positive integer byte count and a 64-hex SHA-256.
 */
export function voiceModelViolations(model, where) {
  const found = [];
  if (!COMMIT.test(model.commit ?? '')) found.push(`${where}: commit ${model.commit} is not 40 hex`);
  if (!String(model.base ?? '').endsWith(`/resolve/${model.commit}/`)) found.push(`${where}: base ${model.base} does not end with /resolve/<commit>/`);
  if (!Array.isArray(model.files) || model.files.length === 0) found.push(`${where}: no files`);
  for (const file of model.files ?? []) {
    if (typeof file.path !== 'string' || file.path === '') found.push(`${where}: a file with no path`);
    if (!Number.isInteger(file.bytes) || file.bytes <= 0) found.push(`${where}: ${file.path} has no byte count`);
    if (!HEX_64.test(file.sha256 ?? '')) found.push(`${where}: ${file.path} has no 64-hex sha256`);
  }
  return found;
}

const NETWORK_CALL = /\bfetch\s*\(|\bhttps?\s*\.\s*(?:get|request)\s*\(/g;
const BUILT_URL = /['"`](https?:\/\/([^/'"`$\s]+)[^'"`\n]*?)(?:\$\{|['"`]\s*\+)/g;

/** A direct network call. Downloads go through ensurePinnedFile (scripts/lib/pinned-file.mjs, the one file allowed to fetch). */
export const networkCallViolations = (source, where) => [...source.matchAll(NETWORK_CALL)].map((m) => `${where}: ${m[0]} (a network call outside pinned-file.mjs)`);

/** A URL on a download host built by concatenation or a template literal cannot be checked, so it is refused. */
export function urlBuildViolations(source, where) {
  return [...source.matchAll(BUILT_URL)]
    .filter((m) => DOWNLOAD_HOSTS.includes(m[2]))
    .map((m) => `${where}: ${m[1]}... (a download URL built from parts; use a literal pinned table entry)`);
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
const isScript = (file) => /\.(?:mjs|js|cjs)$/.test(file);
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
  path.join(REPO, 'README.md'),
  path.join(REPO, 'AGENTS.md'),
  ...walk(path.join(REPO, 'docs'), (file) => isDoc(file) && !DOC_SKIPPED.some((skip) => rel(file).startsWith(skip))),
  ...walk(path.join(REPO, 'site'), isDoc),
].filter((file) => fs.existsSync(file));
const code = [
  ...skillDirs.flatMap((skill) => walk(path.join(skill, 'scripts'), isScript)),
  ...optionalDirs.map((dir) => path.join(dir, 'index.mjs')).filter((file) => fs.existsSync(file)),
  ...walk(path.join(PLUGIN, 'shared'), (file) => isScript(file) && !file.includes(`${path.sep}test${path.sep}`)),
];
const binCode = filesIn(path.join(PLUGIN, 'bin'), (name) => /\.(?:mjs|js|cjs)$/.test(name)); // downloads only: the installer is not an install command
const PINNED_FILE = path.join(SKILLS, 'make-motion', 'scripts', 'lib', 'pinned-file.mjs');
const motionScripts = walk(path.join(SKILLS, 'make-motion', 'scripts'), isScript);
const voiceCode = walk(path.join(SKILLS, 'make-motion', 'scripts', 'v2', 'voice'), isScript);
const { VOICE_MODEL } = await import(pathToFileURL(path.join(SKILLS, 'make-motion', 'scripts', 'v2', 'voice', 'model.mjs')).href);

// An HTML page's commands sit inside tags and entities: scan what a reader sees, with <code> shown as backticks.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
const readable = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.html')) return text;
  return text.replace(/<\/?code[^>]*>/g, '`').replace(/<[^>]+>/g, '').replace(/&(?:lt|gt|amp|quot|#39);/g, (e) => ENTITIES[e]);
};
const collect = (files, check) => files.flatMap((file) => check(readable(file), rel(file)));
// Human-typed commands in docs that may name an unpinned package: the install CLI (the doctor pins skills@1.7.2), Playwright (resolved
// from the skill's own node_modules) and cartoon-wrap (the root README's optional, separate `cartoon` tool). Code allows none.
const DOC_UNPINNED = ['skills', 'playwright', 'cartoon-wrap'];
const docInstallCheck = (text, where) => installViolations(text, where, DOC_UNPINNED);
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
  for (const wanted of ['README.md', 'AGENTS.md', 'docs/features/portable-artifacts.html', 'site/index.html']) assert.ok(docNames.includes(wanted), wanted);
  assert.ok(motionScripts.length > 5 && motionScripts.includes(PINNED_FILE));
  assert.deepEqual(scriptFolders.sort(), ['cutout', 'voice'], 'both optional lockfiles carry onnxruntime-node, which has a postinstall');
});

test('every manifest pins exact versions', () => {
  assert.deepEqual(manifests.flatMap((file) => rangeViolations(JSON.parse(fs.readFileSync(file, 'utf8')), rel(file))), []);
});

test('every manifest has a lockfile beside it', () => {
  const missing = manifests.filter((file) => !fs.existsSync(path.join(path.dirname(file), 'package-lock.json'))).map((file) => `${rel(file)}: no package-lock.json beside it`);
  assert.deepEqual(missing, []);
});

test('every lockfile has a packages map, resolves only from registry.npmjs.org to its own package tarball, and has an integrity hash', () => {
  assert.deepEqual(lockfiles.flatMap((file) => lockfileViolations(JSON.parse(fs.readFileSync(file, 'utf8')), rel(file))), []);
});

test('every install command in prose, code and the repo docs names exact versions, never --no-save, and no runner fetches an unpinned package', () => {
  assert.deepEqual([...collect(prose, docInstallCheck), ...collect(code, installViolations), ...collect(repoDocs, docInstallCheck)], []);
});

test('an optional package whose lockfile has an install script is only installed with --ignore-scripts', () => {
  const check = (text, where) => ignoreScriptsViolations(text, where, scriptFolders);
  assert.deepEqual([...collect(prose, check), ...collect(code, check), ...collect(repoDocs, check)], []);
});

test('every model or binary download is pinned and has a sha256 after it, and no download URL is built from parts', () => {
  assert.deepEqual([...collect(code, downloadViolations), ...collect(binCode, downloadViolations), ...collect(code, urlBuildViolations)], []);
});

test('make-motion makes no network call outside pinned-file.mjs, and ensurePinnedFile has only its three reviewed callers', () => {
  assert.deepEqual(collect(motionScripts.filter((file) => file !== PINNED_FILE), networkCallViolations), []);
  const callers = motionScripts.filter((file) => file !== PINNED_FILE && fs.readFileSync(file, 'utf8').includes('ensurePinnedFile(')).map((file) => path.basename(file));
  // model.mjs (scripts/v2/voice) was reviewed with the timestamped Kokoro pin: one commit, a byte count and a SHA-256 per file.
  assert.deepEqual(callers.sort(), ['cutout.mjs', 'model.mjs', 'voice.mjs'], 'a new caller needs a review of its URL table and its hashes');
});

test('every Hugging Face URL under scripts/v2/voice names a 40-hex commit, and every pinned voice file has a byte count and a 64-hex SHA-256', () => {
  assert.ok(voiceCode.map(rel).includes('plugins/portable-artifacts/skills/make-motion/scripts/v2/voice/model.mjs'), `voice code: ${voiceCode.map(rel).join(', ')}`);
  assert.deepEqual(collect(voiceCode, huggingFaceCommitViolations), []);
  assert.deepEqual(voiceModelViolations(VOICE_MODEL, 'VOICE_MODEL'), []);
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

test('guardrail proof: lockfileViolations flags a git or URL source, a foreign registry, a tarball of another package or version, a missing integrity and a lock with no packages map', () => {
  const ok = { version: '1.0.0', resolved: tarballOf('a', '1.0.0'), integrity: 'sha512-abc' };
  const lock = { packages: {
    '': { name: 'root' },
    'node_modules/a': ok,
    'node_modules/b': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/b.git#abc', integrity: 'sha512-abc' },
    'node_modules/c': { version: '1.0.0', resolved: 'https://evil.example/c-1.0.0.tgz', integrity: 'sha512-abc' },
    'node_modules/d': { version: '1.0.0', resolved: tarballOf('d', '1.0.0') },
    'node_modules/e': { version: '1.0.0', resolved: tarballOf('e', '1.0.0'), integrity: '' },
    'node_modules/f': { version: '1.0.0' },
    'node_modules/g': { link: true, resolved: '../g' },
    'node_modules/h/node_modules/i': { inBundle: true },
  } };
  assert.equal(lockfileViolations(lock, 'l').length, 6, lockfileViolations(lock, 'l').join('\n'));
  assert.deepEqual(lockfileViolations({ packages: { '': {}, 'node_modules/a': ok } }, 'l'), []);
  const resolves = (key, entry) => lockfileViolations({ packages: { '': {}, [key]: { integrity: 'sha512-x', ...entry } } }, 'l');
  assert.equal(resolves('node_modules/a', { version: '1.0.0', resolved: tarballOf('b', '1.0.0') }).length, 1, 'the tarball of another package');
  assert.equal(resolves('node_modules/a', { version: '1.0.0', resolved: tarballOf('a', '1.0.1') }).length, 1, 'the tarball of another version');
  assert.equal(resolves('node_modules/@s/a', { version: '2.0.0', resolved: tarballOf('@s/a', '2.0.0') }).length, 0, 'a scoped package');
  assert.equal(resolves('node_modules/x', { name: 'real', version: '2.0.0', resolved: tarballOf('real', '2.0.0') }).length, 0, 'an npm: alias, locked under its real name');
  assert.equal(lockfileViolations({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0' } } }, 'l').length, 1, 'no packages map');
});

test('guardrail proof: installViolations flags a bare, unpinned or --no-save install in every package manager, flag placement, wrapping and spawn form', () => {
  const bad = ['`npm install kokoro-js --no-save`', '`npm i ffmpeg-static`', '`npm install kokoro-js@1.2.1 --no-save`', 'after `npm install`:', "['npm', 'install', PIN]",
    '`npm add left-pad`', '`pnpm add left-pad`', '`yarn add left-pad`', '`npx skills add x/y`', '`npx --yes cowsay@latest hi`', '["npm", "install", PIN]', "['pnpm', 'add', X]", '"yarn", "add"',
    "run('npx cowsay hi')", 'sudo npx cowsay hi', '`npx ${TOOL} add x`',
    // flags between the manager and the subcommand
    '`npm --prefix x install left-pad`', '`npm -C x i left-pad`', '`npm --no-fund --prefix x add left-pad`', "['npm', '--prefix', dir, 'install', PIN]",
    // wrapped over lines
    'run `npm install\n  left-pad`', 'npm install \\\n  left-pad', '`npm --prefix x\n  install left-pad`',
    // spawn calls, whatever the path expression
    "spawnSync('npm', ['install', 'left-pad'])", "execFileSync(path.join(bin, 'npm'), ['install', 'left-pad@1.3.0', '--no-save'])", "spawn(npmBin, ['i', 'x'])",
    "spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['add', 'left-pad'])", "spawnSync('npx', ['cowsay', 'hi'])", "spawnSync('npx', ['-p', 'typescript', 'tsc'])",
    // the other package managers
    '`pnpm install left-pad`', '`pnpm i`', '`pnpm dlx cowsay hi`', '`yarn dlx cowsay`', '`bun add left-pad`', '`bun x cowsay`', '`bunx cowsay`', "['pnpm', 'dlx', X]", "['bun', 'add']",
    // npx with a package flag: the flag's package is what must be pinned
    '`npx -p typescript tsc`', '`npx --package typescript tsc --version`', '`npx --package=typescript tsc`', '`npx -p typescript@5.6.3 -p ts-node ts-node`'];
  for (const text of bad) assert.equal(installViolations(text, 'x').length, 1, text);
  const good = ['`npm ci --prefix <dir>` or `npm install shiki@4.5.0`', '`npm install --prefix /x shiki@4.5.0 --save-exact`', '`pnpm add left-pad@1.3.0`', '`npx --yes skills@1.7.2 add x/y`',
    '`npx --no --prefix /x playwright install chromium`', '`npx --no-install tsc`', 'prose about npx and what it does', "const TOOL = 'skills@1.7.2';\n`npx ${TOOL} add x`",
    '`npm --prefix x ci`', '`pnpm dlx cowsay@1.6.0 hi`', '`bun add left-pad@1.3.0`', '`bunx cowsay@1.6.0`', '`npx -p typescript@5.6.3 tsc`', '`npx --package=typescript@5.6.3 tsc`',
    "spawnSync('npm', ['install', 'a@1.0.0'])", "spawnSync('npx', ['-p', 'typescript@5.6.3', 'tsc'])", "spawnSync('ffmpeg', ['-version'])", "spawnSync(ctx.npm, ['ci', '--prefix', dir])"];
  for (const text of good) assert.equal(installViolations(text, 'x').length, 0, text);
  assert.equal(installViolations('`npx skills add x/y`', 'x', ['skills']).length, 0, 'an allowed human-typed docs command');
  assert.equal(installViolations('`npx cowsay hi`', 'x', ['skills']).length, 1, 'only the allowed name');
});

test('guardrail proof: ignoreScriptsViolations flags an optional install without --ignore-scripts: ci aliases, flags first, wrapping, spawn calls and argv', () => {
  const folders = ['voice', 'cutout'];
  const count = (text) => ignoreScriptsViolations(text, 'x', folders).length;
  const bad = ['`npm ci --prefix <skill-dir>/optional/voice`', '`npm install onnxruntime-node@1.31.1 --prefix /s/optional/cutout`', "['npm', 'ci', '--prefix', path.join(dir, 'optional', name)]",
    '`npm ic --prefix /s/optional/voice`', '`npm clean-install --prefix /s/optional/voice`', '`npm install-clean --prefix /s/optional/cutout`', '`npm --prefix /s/optional/voice ci`',
    '`npm ci\n  --prefix /s/optional/voice`', 'npm ci \\\n  --prefix /s/optional/voice', "spawnSync('npm', ['ci', '--prefix', path.join(root, 'optional', name)])",
    "execFile(npmBin, ['ci', '--prefix', '/s/optional/cutout'])"];
  for (const text of bad) assert.equal(count(text), 1, text);
  const good = ['`npm ci --ignore-scripts --prefix <skill-dir>/optional/voice`', "['npm', 'ci', '--ignore-scripts', '--prefix', path.join(dir, 'optional', name)]",
    '`npm ci --prefix <skill-dir>` and `npm ci --prefix /s/optional/other`', "spawnSync('npm', ['ci', '--ignore-scripts', '--prefix', path.join(root, 'optional', name)])",
    '`npm ic --ignore-scripts --prefix /s/optional/voice`'];
  for (const text of good) assert.equal(count(text), 0, text);
  assert.equal(ignoreScriptsViolations('`npm ci --prefix /s/optional/voice`', 'x', []).length, 0, 'no lockfile has an install script');
  assert.deepEqual(foldersWithInstallScripts({ a: { packages: { 'node_modules/x': { hasInstallScript: true } } }, b: { packages: { 'node_modules/y': {} } } }), ['a']);
});

test('guardrail proof: downloadViolations is per URL, and a pin counts only in the path position that selects the content', () => {
  const sha = 'b'.repeat(64);
  const commit = 'a'.repeat(40);
  const hf = (tail) => `https://huggingface.co/o/m/resolve/${tail}`;
  const count = (source) => downloadViolations(source, 'x').length;
  const hashed = (url) => count(`const U = '${url}'; const SHA256 = '${sha}';`);
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
  assert.equal(hashed('https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz'), 0);
  assert.equal(hashed('https://registry.npmjs.org/left-pad/latest'), 0, 'metadata, not a tarball or a download');
  assert.equal(hashed('https://github.com/o/r/releases/download/v1.2.3/a.tgz'), 0);
  assert.equal(hashed('https://github.com/o/r/releases/download/latest/a.tgz'), 1);
});

test('guardrail proof: for jsDelivr and unpkg the version must be the @<ref> right after the package or repo name', () => {
  const sha = 'b'.repeat(64);
  const commit = 'a'.repeat(40);
  const hashed = (url) => downloadViolations(`const U = '${url}'; const SHA256 = '${sha}';`, 'x').length;
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/pkg@1.2.3/dist/a.js'), 0);
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/dist/a.js'), 0, 'a scoped package');
  assert.equal(hashed(`https://cdn.jsdelivr.net/gh/o/r@${commit}/a.js`), 0);
  assert.equal(hashed('https://cdn.jsdelivr.net/gh/o/r@v1.2.3/a.js'), 0);
  assert.equal(hashed('https://unpkg.com/pkg@1.2.3/dist/a.js'), 0);
  assert.equal(hashed('https://unpkg.com/@scope/pkg@1.2.3/dist/a.js'), 0);
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/pkg/dist/a@1.2.3.js'), 1, 'a version in the file name');
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/pkg@latest/dist/a.js'), 1, 'a tag');
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/pkg@1/dist/a.js'), 1, 'a range');
  assert.equal(hashed('https://cdn.jsdelivr.net/npm/pkg/1.2.3/a.js'), 1, 'a version segment, not after the name');
  assert.equal(hashed('https://cdn.jsdelivr.net/gh/o/r/a@1.2.3.js'), 1);
  assert.equal(hashed('https://unpkg.com/pkg/a@1.2.3.js'), 1);
  assert.equal(hashed('https://unpkg.com/pkg@latest/a.js'), 1);
});

test('guardrail proof: networkCallViolations and urlBuildViolations catch a direct fetch and a download URL built from parts', () => {
  const calls = (source) => networkCallViolations(source, 'x').length;
  for (const bad of ['const r = await fetch(url);', 'await globalThis.fetch(u)', 'https.get(u, cb)', 'http.request(opts)', 'fetch ( `x` )']) assert.equal(calls(bad), 1, bad);
  for (const good of ['const { fetchImpl = fetch } = opts;', 'await fetchImpl(url)', 'const res = await ensurePinnedFile({ url })', '// fetch the model']) assert.equal(calls(good), 0, good);
  const built = (source) => urlBuildViolations(source, 'x').length;
  assert.equal(built("const u = 'https://huggingface.co/o/m/resolve/' + rev + '/f.bin';"), 1, 'concatenation');
  assert.equal(built('const u = `https://huggingface.co/o/m/resolve/${rev}/f.bin`;'), 1, 'a template literal');
  assert.equal(built('const u = `https://cdn.jsdelivr.net/npm/${name}@1.2.3/a.js`;'), 1);
  assert.equal(built('url: `${base}${file}`'), 0, 'a table entry passed through ensurePinnedFile');
  assert.equal(built("const u = 'https://huggingface.co/o/m/resolve/" + 'a'.repeat(40) + "/f.bin';"), 0, 'a whole literal');
  assert.equal(built('const local = `http://127.0.0.1:${port}/x`;'), 0, 'not a download host');
});

test('guardrail proof: huggingFaceCommitViolations flags a branch, a short or missing commit and a non-resolve URL; voiceModelViolations flags a bad commit, base, byte count and hash', () => {
  const commit = 'a'.repeat(40);
  const count = (source) => huggingFaceCommitViolations(source, 'x').length;
  assert.equal(count(`const B = 'https://huggingface.co/o/m/resolve/${commit}/';`), 0, 'a 40-hex commit');
  assert.equal(count("const B = 'https://huggingface.co/o/m/resolve/main/';"), 1, 'a branch');
  assert.equal(count(`const B = 'https://huggingface.co/o/m/resolve/${'a'.repeat(39)}/';`), 1, 'a short commit');
  assert.equal(count(`const B = 'https://huggingface.co/o/m/resolve/${'A'.repeat(40)}/';`), 1, 'upper case is not the pinned form');
  assert.equal(count(`const B = 'https://huggingface.co/o/m/blob/${commit}/f.bin';`), 1, 'a page URL, not /resolve/');
  assert.equal(count("const B = 'https://huggingface.co/o/m';"), 1, 'no ref at all');
  assert.equal(count("// see https://example.com/resolve/main/f"), 0, 'another host');
  const good = { commit, base: `https://huggingface.co/o/m/resolve/${commit}/`, files: [{ path: 'f.bin', bytes: 10, sha256: 'b'.repeat(64) }] };
  assert.deepEqual(voiceModelViolations(good, 'm'), []);
  const bad = (change) => voiceModelViolations({ ...good, ...change }, 'm').length;
  assert.equal(bad({ commit: 'main' }), 2, 'a branch as the commit, and a base that no longer ends with it');
  assert.equal(bad({ base: 'https://huggingface.co/o/m/resolve/main/' }), 1);
  assert.equal(bad({ files: [] }), 1, 'no files');
  assert.equal(bad({ files: [{ path: 'f.bin', sha256: 'b'.repeat(64) }] }), 1, 'no byte count');
  assert.equal(bad({ files: [{ path: 'f.bin', bytes: 0, sha256: 'b'.repeat(64) }] }), 1, 'a zero byte count');
  assert.equal(bad({ files: [{ path: 'f.bin', bytes: 10, sha256: 'b'.repeat(63) }] }), 1, 'a short hash');
  assert.equal(bad({ files: [{ path: 'f.bin', bytes: 10 }] }), 1, 'no hash');
});

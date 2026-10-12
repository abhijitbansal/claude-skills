#!/usr/bin/env node
// Install the portable-artifacts skills into another agent host's skill dir.
//   node bin/install.mjs <claude|codex|copilot|gemini|agents> [--project <dir>] [--skills a,b] [--link] [--force] [--no-deps]
// Each host reads SKILL.md folders from its own documented locations; the
// skill itself is the slash command there (/name, or $name in Codex).
// A skill's package.json "portableArtifacts": {"requires": [...]} pulls in sibling skills first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const SKILLS_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');
const SKIP = new Set(['node_modules', 'test', 'dist', 'out', '.cache']);

// host -> [user dir, project dir] relative to HOME / project root, plus how to invoke.
export const HOSTS = {
  claude: { user: '.claude/skills', project: '.claude/skills', invoke: (s) => `/${s}` },
  codex: { user: '.agents/skills', project: '.agents/skills', invoke: (s) => `$${s}` },
  copilot: { user: '.copilot/skills', project: '.github/skills', invoke: (s) => `/${s}` },
  gemini: { user: '.gemini/skills', project: '.gemini/skills', commands: '.gemini/commands', invoke: (s) => `/${s}` },
  agents: { user: '.agents/skills', project: '.agents/skills', invoke: (s) => `$${s} (Codex) or /${s} (Copilot)` },
};

export function targetsFor(host, scope, { home, proj }) {
  const h = HOSTS[host];
  const base = scope === 'user' ? home : proj;
  return {
    skills: path.join(base, h[scope]),
    commands: h.commands ? path.join(base, h.commands) : null,
  };
}

export class UsageError extends Error {}

const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

// Skills a skill needs installed beside it: package.json -> portableArtifacts.requires.
function readRequires(skill, src) {
  const file = path.join(src, skill, 'package.json');
  if (!fs.existsSync(file)) return [];
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`${skill}: package.json is not valid JSON (${e.message})`);
  }
  const requires = pkg.portableArtifacts?.requires ?? [];
  if (!Array.isArray(requires) || requires.some((r) => typeof r !== 'string')) {
    throw new UsageError(`${skill}: portableArtifacts.requires must be an array of skill names`);
  }
  return requires;
}

// Expand the requested skills with everything they require (transitively):
// dependency first, each skill once. requiredBy is set only on skills nobody asked for by name.
export function expandRequires(requested, src = SKILLS_SRC) {
  const asked = new Set(requested);
  const plan = [];
  const done = new Set();
  const visit = (skill, requiredBy, chain) => {
    if (done.has(skill)) return;
    if (chain.includes(skill)) throw new UsageError(`dependency cycle: ${[...chain.slice(chain.indexOf(skill)), skill].join(' -> ')}`);
    if (requiredBy && !(SKILL_NAME.test(skill) && fs.existsSync(path.join(src, skill, 'SKILL.md')))) {
      throw new UsageError(`${requiredBy} requires unknown skill "${skill}"`);
    }
    for (const dep of readRequires(skill, src)) visit(dep, skill, [...chain, skill]);
    done.add(skill);
    plan.push(asked.has(skill) ? { skill } : { skill, requiredBy });
  };
  for (const skill of requested) visit(skill, undefined, []);
  return plan;
}

function readDescription(skillDir) {
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  return md.match(/^description:\s*(.+)$/m)?.[1].trim() ?? '';
}

function geminiCommand(skill, description) {
  const desc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `description = "${desc}"`,
    'prompt = """',
    `Activate the ${skill} skill and follow its SKILL.md workflow exactly.`,
    'Request: {{args}}',
    '"""',
    '',
  ].join('\n');
}

function installSkill(skill, dstRoot, { link, force, deps }) {
  const src = path.join(SKILLS_SRC, skill);
  const dst = path.join(dstRoot, skill);
  if (fs.existsSync(dst) && fs.realpathSync(dst) === fs.realpathSync(src)) {
    throw new Error(`${dst} is the source skill itself (the host dir points into this checkout); refusing to replace it`);
  }
  if (fs.existsSync(dst) || isSymlink(dst)) {
    if (!force) throw new Error(`${dst} already exists; pass --force to replace it`);
    fs.rmSync(dst, { recursive: true, force: true });
  }
  fs.mkdirSync(dstRoot, { recursive: true });
  if (link) {
    fs.symlinkSync(src, dst, 'dir');
  } else {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (p) => !path.relative(src, p).split(path.sep).some((seg) => SKIP.has(seg)),
    });
  }
  if (deps) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const where = link ? src : dst;
    // A linked install runs inside the source checkout: --omit=dev there would delete the developer's dev deps.
    const args = ['ci', ...(link ? [] : ['--omit=dev']), '--no-audit', '--no-fund'];
    const r = spawnSync(npm, args, { cwd: where, stdio: 'inherit' });
    if (r.status !== 0) {
      fs.rmSync(dst, { recursive: true, force: true }); // a link is removed, never its target
      throw new Error(`npm ci failed in ${where}${r.error ? ` (${r.error.message})` : ''}; removed the partial install at ${dst}`);
    }
  }
  return dst;
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        project: { type: 'string' },
        skills: { type: 'string' },
        link: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        'no-deps': { type: 'boolean', default: false },
      },
    });
  } catch (e) {
    throw new UsageError(e.message);
  }
  const [host] = parsed.positionals;
  if (!HOSTS[host]) throw new UsageError(`unknown host "${host ?? ''}"; use one of: ${Object.keys(HOSTS).join(', ')}`);
  const all = fs.readdirSync(SKILLS_SRC).filter((d) => fs.existsSync(path.join(SKILLS_SRC, d, 'SKILL.md')));
  if (parsed.values.project === '') throw new UsageError('--project needs a directory');
  const skills = parsed.values.skills ? [...new Set(parsed.values.skills.split(','))] : all;
  const unknown = skills.filter((s) => !all.includes(s));
  if (unknown.length) throw new UsageError(`unknown skill(s): ${unknown.join(', ')}; available: ${all.join(', ')}`);
  return { ...parsed.values, host, skills };
}

// Check every destination before installing anything, so a refusal leaves no partial install.
// A skill that was only pulled in as a requirement and is already there is kept (keep: true);
// a skill the user named, or any skill under --force, is replaced or refused as before.
function preflight(plan, dstRoot, { force }) {
  return plan.map((entry) => {
    const src = path.join(SKILLS_SRC, entry.skill);
    const dst = path.join(dstRoot, entry.skill);
    const present = fs.existsSync(dst) || isSymlink(dst);
    if (present && entry.requiredBy && !force) return { ...entry, keep: true };
    if (fs.existsSync(dst) && fs.realpathSync(dst) === fs.realpathSync(src)) {
      throw new Error(`${dst} is the source skill itself (the host dir points into this checkout); refusing to replace it`);
    }
    if (present && !force) throw new Error(`${dst} already exists; pass --force to replace it`);
    return entry;
  });
}

function main() {
  const opts = parse(process.argv.slice(2));
  const scope = opts.project ? 'project' : 'user';
  const dirs = targetsFor(opts.host, scope, { home: os.homedir(), proj: path.resolve(opts.project ?? '.') });
  const h = HOSTS[opts.host];
  const plan = preflight(expandRequires(opts.skills), dirs.skills, { force: opts.force });
  for (const { skill, requiredBy, keep } of plan) {
    if (keep) process.stdout.write(`${skill} already installed (required by ${requiredBy})\n`);
    else if (requiredBy) process.stdout.write(`also installing ${skill} (required by ${requiredBy})\n`);
  }
  for (const { skill, keep } of plan) {
    if (keep) continue;
    const dst = installSkill(skill, dirs.skills, { link: opts.link, force: opts.force, deps: !opts['no-deps'] });
    if (dirs.commands) {
      fs.mkdirSync(dirs.commands, { recursive: true });
      const toml = path.join(dirs.commands, `${skill}.toml`);
      fs.writeFileSync(toml, geminiCommand(skill, readDescription(path.join(SKILLS_SRC, skill))));
    }
    process.stdout.write(`installed ${skill} -> ${dst}\n  invoke: ${h.invoke(skill)} <what to make>\n`);
  }
  if (plan.some((p) => p.skill === 'make-motion')) {
    process.stdout.write('make-motion also needs ffmpeg on PATH and, once: npx playwright install chromium (run in the skill folder)\n');
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`install: ${e.message}\n`);
    // exitCode, not process.exit(): exiting right after a pipe write can SIGSEGV on Node 24.7
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}

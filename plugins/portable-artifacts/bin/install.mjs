#!/usr/bin/env node
// Install the portable-artifacts skills into another agent host's skill dir.
//   node bin/install.mjs <claude|codex|copilot|gemini|agents> [--project <dir>] [--skills a,b] [--link] [--force] [--no-deps]
// Each host reads SKILL.md folders from its own documented locations; the
// skill itself is the slash command there (/name, or $name in Codex).
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

class UsageError extends Error {}

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

function main() {
  const opts = parse(process.argv.slice(2));
  const scope = opts.project ? 'project' : 'user';
  const dirs = targetsFor(opts.host, scope, { home: os.homedir(), proj: path.resolve(opts.project ?? '.') });
  const h = HOSTS[opts.host];
  for (const skill of opts.skills) {
    const dst = installSkill(skill, dirs.skills, { link: opts.link, force: opts.force, deps: !opts['no-deps'] });
    if (dirs.commands) {
      fs.mkdirSync(dirs.commands, { recursive: true });
      const toml = path.join(dirs.commands, `${skill}.toml`);
      fs.writeFileSync(toml, geminiCommand(skill, readDescription(path.join(SKILLS_SRC, skill))));
    }
    process.stdout.write(`installed ${skill} -> ${dst}\n  invoke: ${h.invoke(skill)} <what to make>\n`);
  }
  if (opts.skills.includes('make-motion')) {
    process.stdout.write('make-motion also needs ffmpeg on PATH and, once: npx playwright install chromium (run in the skill folder)\n');
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`install: ${e.message}\n`);
    process.exit(e instanceof UsageError ? 2 : 1);
  }
}

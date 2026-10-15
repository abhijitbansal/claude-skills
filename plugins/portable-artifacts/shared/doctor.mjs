// Dependency doctor: checks what a skill needs, reports misses with per-platform
// fix commands, and runs only consented, non-sudo fixes. Node built-ins and
// ./cli.mjs only: it must run before the skill's node_modules exists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseCli, UsageError, exitUsage } from './cli.mjs';

const REPO = 'abhijitbansal/claude-skills';
const KOKORO_PIN = 'kokoro-js@1.2.1';
const SKILLS_CLI = 'skills@1.7.2';
const USER_SCOPE_DIRS = ['.claude', '.agents', '.copilot', '.gemini'];
const USAGE = 'doctor.mjs [--json] [--for <spec.json|target>] | --fix <id[,id]>';

// Passed to requirementsFor() by --fix: every requirement the skill could need.
export const ALL = Symbol('all');

export function defaultCtx(skillDir) {
  const platform = process.platform;
  return {
    platform,
    env: process.env,
    skillDir,
    nodeVersion: process.versions.node,
    cwd: process.cwd(),
    homedir: os.homedir(),
    exists: (p) => fs.existsSync(p),
    isExecutable: (p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    which: (cmd) => spawnSync(platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0,
  };
}

const isUnder = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const manualAll = (cmd) => ({ darwin: cmd, linux: cmd, win32: cmd });
const argvOf = (step) => (Array.isArray(step) ? step : step.argv);
const quote = (a) => (/\s/.test(a) ? JSON.stringify(a) : a);
const render = (steps) => steps.map((st) => argvOf(st).map(quote).join(' ')).join(' && ');

// cmd.exe quoting: one argument -> one token. Metacharacters and whitespace
// force double quotes; an inner " doubles; % is broken out of the quotes and
// caret-escaped so %VAR% pairs cannot form.
const CMD_SPECIAL = /[\s&|<>^()%!"]/;
export function cmdQuote(arg) {
  if (arg !== '' && !CMD_SPECIAL.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""').replace(/%/g, '"^%"')}"`;
}
export const cmdLine = (argv) => argv.map(cmdQuote).join(' ');
const isExec = (ctx, p) => (ctx.isExecutable ? ctx.isExecutable(p) : ctx.exists(p));

export function nodeVersion(min = 20) {
  return {
    id: 'node',
    why: `runs the scripts (Node ${min} or newer)`,
    required: true,
    size: '—',
    check: (ctx) => Number.parseInt(String(ctx.nodeVersion).split('.')[0], 10) >= min,
    fix: () => ({ auto: null, manual: manualAll(`install Node ${min}+ from https://nodejs.org`) }),
    needsSudo: () => false,
  };
}

export function nodeModules({ omitDev = true } = {}) {
  return {
    id: 'node_modules',
    why: "installs the skill's own npm packages",
    required: true,
    size: '≈30–60 MB',
    check: (ctx) => ctx.exists(path.join(ctx.skillDir, 'node_modules')),
    fix: (ctx) => {
      const argv = ['npm', 'ci', ...(omitDev ? ['--omit=dev'] : []), '--prefix', ctx.skillDir];
      return { auto: [argv], manual: manualAll(render([argv])) };
    },
    needsSudo: () => false,
  };
}

function systemChromePaths(ctx) {
  if (ctx.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (ctx.platform === 'win32') {
    const roots = [ctx.env.ProgramFiles, ctx.env['ProgramFiles(x86)'], ctx.env.LOCALAPPDATA].filter(Boolean);
    return roots.map((r) => path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
}

// Playwright's bundled chromium, resolved from the skill's own node_modules.
async function playwrightChromiumPresent(ctx) {
  if (!ctx.exists(path.join(ctx.skillDir, 'node_modules', 'playwright-core'))) return false;
  const req = createRequire(path.join(ctx.skillDir, 'package.json'));
  for (const pkg of ['playwright', 'playwright-core']) {
    try {
      const mod = await import(pathToFileURL(req.resolve(pkg)).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium && ctx.exists(chromium.executablePath())) return true;
    } catch {
      // package absent or broken: treat as not installed
    }
  }
  return false;
}

const SISTER_NAME = /^[a-z0-9-]+$/;

// Where the skills CLI should run for a skill laid out as <root>/.<dir>/skills/<self>.
// Project scope: cwd=<root>. User scope (~/.claude, .agents, .copilot, .gemini): -g from home.
// Anything else (plugin cache, custom path): null, manual only.
function sisterPlan(ctx) {
  const skillsRoot = path.dirname(ctx.skillDir);
  const dot = path.dirname(skillsRoot);
  if (path.basename(skillsRoot) !== 'skills' || !path.basename(dot).startsWith('.')) return null;
  const root = path.dirname(dot);
  const home = ctx.homedir ?? os.homedir();
  if (root === home) return USER_SCOPE_DIRS.includes(path.basename(dot)) ? { skillsRoot, cwd: home, global: true, dot } : null;
  return { skillsRoot, cwd: root, global: false, dot };
}

export function sisterSkill(name) {
  if (typeof name !== 'string' || !SISTER_NAME.test(name)) throw new TypeError(`sisterSkill: invalid skill name ${JSON.stringify(name)}`);
  const sisterDir = (ctx) => path.join(path.dirname(ctx.skillDir), name);
  const present = (ctx) => ctx.exists(path.join(sisterDir(ctx), 'SKILL.md'));
  return {
    id: name,
    why: `sister skill ${name} is used for the matching sections`,
    required: true,
    size: '≈30–60 MB',
    check: present,
    fix: (ctx) => {
      const plan = sisterPlan(ctx);
      const add = ['npx', '--yes', SKILLS_CLI, 'add', REPO, '--skill', name, '-y', ...(plan?.global ? ['-g'] : [])];
      const install = ['npm', 'ci', '--omit=dev', '--prefix', sisterDir(ctx)];
      if (plan === null) {
        const hint = `reinstall with your host's installer (for example run \`npx ${SKILLS_CLI} add ${REPO} --skill ${name} -y\` from your project root, or reinstall the plugin), then ${render([install])}`;
        return { auto: null, manual: manualAll(hint) };
      }
      const auto = [{ argv: add, cwd: plan.cwd, verify: present }, install];
      const where = plan.global ? `your user-scope skills folder (${plan.skillsRoot}, via -g)` : plan.skillsRoot;
      const manual = manualAll(`cd ${quote(plan.cwd)} && ${render(auto)}`);
      const notes = `downloads from GitHub via npx ${SKILLS_CLI}; writes the skill into ${where}, plus skills-lock.json and agent symlinks such as .claude/skills/${name} in ${plan.cwd}`;
      return { auto, manual, notes };
    },
    needsSudo: () => false,
  };
}

export function ffmpeg() {
  const staticBinary = (ctx) => path.join(ctx.skillDir, 'node_modules', 'ffmpeg-static', ctx.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return {
    id: 'ffmpeg',
    why: 'renders the MP4',
    required: true,
    size: '≈80 MB',
    check: (ctx) => {
      const p = ctx.env.FFMPEG_PATH;
      if (p && isExec(ctx, p)) return true;
      if (ctx.which('ffmpeg')) return true;
      return isExec(ctx, staticBinary(ctx));
    },
    fix: (ctx) => {
      const hasBrew = ctx.platform === 'darwin' && ctx.which('brew');
      let auto = null;
      if (hasBrew) auto = [['brew', 'install', 'ffmpeg']];
      if (ctx.platform === 'win32') auto = [['winget', 'install', '-e', '--id', 'Gyan.FFmpeg', '--accept-source-agreements', '--accept-package-agreements']];
      return {
        auto,
        manual: {
          darwin: hasBrew
            ? 'brew install ffmpeg'
            : 'install Homebrew (https://brew.sh) and then run `brew install ffmpeg`, or download a static build from https://ffmpeg.org/download.html',
          linux: 'sudo apt-get install ffmpeg',
          win32: 'winget install -e --id Gyan.FFmpeg (then open a new terminal)',
        },
      };
    },
    needsSudo: (ctx) => ctx.platform === 'linux',
  };
}

export function browser({ required = false } = {}) {
  return {
    id: 'chromium',
    why: 'renders pages to image and video (Playwright Chromium or installed Chrome)',
    required,
    size: '≈150 MB',
    check: async (ctx) => systemChromePaths(ctx).some((p) => ctx.exists(p)) || playwrightChromiumPresent(ctx),
    fix: (ctx) => {
      // --no: never let npx fetch a different playwright; needs node_modules first.
      const argv = ['npx', '--no', '--prefix', ctx.skillDir, 'playwright', 'install', 'chromium'];
      const out = { auto: [argv], manual: manualAll(render([argv])), notes: 'downloads ≈150 MB of Chromium; run after node_modules is installed' };
      if (ctx.platform === 'linux') {
        const hint = 'sudo npx playwright install --with-deps chromium';
        out.notes += `; launching may need system libraries: ${hint}`;
        out.sudoHint = hint;
      }
      return out;
    },
    needsSudo: () => false,
  };
}

export function kokoro() {
  return {
    id: 'kokoro',
    why: 'local text-to-speech for voiceover',
    required: false,
    size: '≈250 MB, plus a 90 MB model on first use',
    check: (ctx) => ctx.exists(path.join(ctx.skillDir, 'node_modules', 'kokoro-js')),
    fix: (ctx) => {
      const argv = ['npm', 'install', KOKORO_PIN, '--no-save', '--prefix', ctx.skillDir];
      return { auto: [argv], manual: manualAll(render([argv])), notes: 'the 90 MB voice model downloads on first use' };
    },
    needsSudo: () => false,
  };
}

export async function diagnose(requirements, ctx) {
  const missing = [];
  for (const r of requirements) {
    if (await r.check(ctx)) continue;
    const fix = r.fix(ctx);
    const entry = {
      id: r.id,
      why: r.why,
      required: r.required,
      size: r.size,
      fix: { auto: fix.auto === null ? null : render(fix.auto), manual: fix.manual },
      needsSudo: r.needsSudo(ctx),
    };
    if (fix.notes) entry.notes = fix.notes;
    if (fix.sudoHint) entry.sudoHint = fix.sudoHint;
    missing.push(entry);
  }
  return { ok: !missing.some((m) => m.required), missing };
}

const defaultRun = (cmd, args, opts) => spawnSync(cmd, args, opts);

// One step: win32 gets a single cmd.exe-quoted line through a shell (npm/npx are
// .cmd shims); elsewhere argv goes straight to the program, no shell.
function runStep(step, ctx, run) {
  const argv = argvOf(step);
  const opts = { stdio: 'inherit', shell: ctx.platform === 'win32' };
  if (!Array.isArray(step) && step.cwd !== undefined) opts.cwd = step.cwd;
  return ctx.platform === 'win32' ? run(cmdLine(argv), [], opts) : run(argv[0], argv.slice(1), opts);
}

async function stillMissing(req, ctx) {
  try {
    return !(await req.check(ctx));
  } catch {
    return true;
  }
}

export async function runFixes(ids, requirements, ctx, run = defaultRun) {
  const wanted = new Set(ids);
  const results = [];
  // Requirement order (node_modules, sisters, ffmpeg, chromium, kokoro), deduped.
  for (const req of requirements) {
    if (!wanted.has(req.id)) continue;
    wanted.delete(req.id);
    results.push(await fixOne(req, ctx, run));
  }
  for (const id of wanted) results.push({ id, ok: false, refused: 'unknown id' });
  return results;
}

async function fixOne(req, ctx, run) {
  const id = req.id;
  const fix = req.fix(ctx);
  const manual = fix.manual[ctx.platform] ?? fix.manual.linux;
  if (req.needsSudo(ctx)) return { id, ok: false, refused: 'needs sudo', manual };
  if (fix.auto === null) return { id, ok: false, refused: 'no automatic fix', manual };
  const ran = render(fix.auto);
  for (const step of fix.auto) {
    const r = runStep(step, ctx, run);
    if (r.status !== 0) return { id, ok: false, ran, manual };
    if (!Array.isArray(step) && step.verify && !(await step.verify(ctx))) {
      return { id, ok: false, ran, manual: `installed elsewhere (not found next to this skill) — run: ${manual}` };
    }
  }
  if (await stillMissing(req, ctx)) {
    const hint = ctx.platform === 'win32' && id === 'ffmpeg' ? 'open a new terminal, then rerun doctor' : manual;
    return { id, ok: false, ran, stillMissing: true, manual: hint };
  }
  return { id, ok: true, ran };
}

function describe(m, platform) {
  const cmd = m.fix.auto ?? m.fix.manual[platform] ?? m.fix.manual.linux;
  const sudo = m.needsSudo ? ' (needs sudo: run it yourself)' : '';
  const notes = m.notes ? ` Note: ${m.notes}.` : '';
  return `missing (${m.required ? 'required' : 'optional'}): ${m.id} — ${m.why} (${m.size}). Run: ${cmd}${sudo}${notes}`;
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

export async function doctorMain(argv, { skill, skillDir, targets = ['check'], requirementsFor }) {
  if (!Array.isArray(targets) || targets.some((t) => typeof t !== 'string')) throw new TypeError('doctorMain: targets must be an array of strings');
  let values;
  try {
    const parsed = parseCli(argv, { json: { type: 'boolean' }, for: { type: 'string' }, fix: { type: 'string' } }, USAGE);
    if (parsed.positionals.length > 0) throw new UsageError(`unexpected argument '${parsed.positionals[0]}'; usage: ${USAGE}`);
    values = parsed.values;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e, { json: argv.includes('--json') });
    return;
  }
  const json = values.json;
  const ctx = defaultCtx(skillDir);
  const spec = values.for;
  if (spec !== undefined && !targets.includes(spec) && !(spec.endsWith('.json') && ctx.exists(spec))) {
    exitUsage(new UsageError(`--for must be one of: ${targets.join(', ')}, or an existing spec .json file; got ${JSON.stringify(spec)}`), { json });
    return;
  }
  try {
    if (values.fix !== undefined) await fixMain(values.fix, { ctx, json, requirementsFor });
    else await diagnoseMain({ ctx, json, skill, spec, requirementsFor });
  } catch (e) {
    exitUsage(new UsageError(firstLine(e)), { json });
  }
}

async function fixMain(raw, { ctx, json, requirementsFor }) {
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new UsageError(`--fix needs at least one id; usage: ${USAGE}`);
  const results = await runFixes(ids, requirementsFor(ALL), ctx);
  if (json) process.stdout.write(`${JSON.stringify(results)}\n`);
  else {
    for (const r of results) {
      if (r.ok) process.stdout.write(`fixed: ${r.id} (ran: ${r.ran})\n`);
      else if (r.refused) process.stdout.write(`refused: ${r.id} — ${r.refused}${r.manual ? `. Run it yourself: ${r.manual}` : ''}\n`);
      else if (r.stillMissing) process.stdout.write(`still missing: ${r.id} after (ran: ${r.ran}). ${r.manual}\n`);
      else process.stdout.write(`failed: ${r.id} (ran: ${r.ran}). Run it yourself: ${r.manual}\n`);
    }
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

async function diagnoseMain({ ctx, json, skill, spec, requirementsFor }) {
  const result = await diagnose(requirementsFor(spec), ctx);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.missing.length === 0) process.stdout.write(`ok: everything ${skill} needs is installed\n`);
  else for (const m of result.missing) process.stdout.write(`${describe(m, ctx.platform)}\n`);
  if (!result.ok) process.exitCode = 1;
}

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
const USAGE = 'doctor.mjs [--json] [--for <spec.json|target>] | --fix <id[,id]> [--for <spec.json|target>]';

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
    which: (cmd) => spawnSync(platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0,
  };
}

const isUnder = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const manualAll = (cmd) => ({ darwin: cmd, linux: cmd, win32: cmd });
const quote = (a) => (/\s/.test(a) ? JSON.stringify(a) : a);
const render = (argvs) => argvs.map((a) => a.map(quote).join(' ')).join(' && ');

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

export function sisterSkill(name) {
  const sisterDir = (ctx) => path.join(path.dirname(ctx.skillDir), name);
  return {
    id: name,
    why: `sister skill ${name} is used for the matching sections`,
    required: true,
    size: '≈30–60 MB',
    check: (ctx) => ctx.exists(path.join(sisterDir(ctx), 'SKILL.md')),
    fix: (ctx) => {
      const cwd = ctx.cwd ?? process.cwd();
      const home = ctx.homedir ?? os.homedir();
      const global = isUnder(ctx.skillDir, home) && !isUnder(ctx.skillDir, cwd);
      const argvs = [
        ['npx', 'skills', 'add', REPO, '--skill', name, '-y', ...(global ? ['-g'] : [])],
        ['npm', 'ci', '--omit=dev', '--prefix', sisterDir(ctx)],
      ];
      return { auto: argvs, manual: manualAll(render(argvs)) };
    },
    needsSudo: () => false,
  };
}

export function ffmpeg() {
  return {
    id: 'ffmpeg',
    why: 'renders the MP4',
    required: true,
    size: '≈80 MB',
    check: (ctx) => {
      const p = ctx.env.FFMPEG_PATH;
      if (p && ctx.exists(p)) return true;
      if (ctx.which('ffmpeg')) return true;
      return ctx.exists(path.join(ctx.skillDir, 'node_modules', 'ffmpeg-static'));
    },
    fix: (ctx) => {
      let auto = null;
      if (ctx.platform === 'darwin' && ctx.which('brew')) auto = [['brew', 'install', 'ffmpeg']];
      if (ctx.platform === 'win32') auto = [['winget', 'install', 'Gyan.FFmpeg']];
      return {
        auto,
        manual: {
          darwin: 'brew install ffmpeg (or download a build from https://ffmpeg.org/download.html)',
          linux: 'sudo apt-get install ffmpeg',
          win32: 'winget install Gyan.FFmpeg (then open a new terminal)',
        },
      };
    },
    needsSudo: (ctx) => ctx.platform === 'linux',
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

export function browser({ required = false } = {}) {
  return {
    id: 'chromium',
    why: 'renders pages to image and video (Playwright Chromium or installed Chrome)',
    required,
    size: '≈150 MB',
    check: async (ctx) => systemChromePaths(ctx).some((p) => ctx.exists(p)) || playwrightChromiumPresent(ctx),
    fix: (ctx) => {
      const argv = ['npx', '--prefix', ctx.skillDir, 'playwright', 'install', 'chromium'];
      return {
        auto: [argv],
        manual: {
          darwin: render([argv]),
          linux: `${render([argv])} (missing system libraries: npx playwright install --with-deps chromium, needs sudo)`,
          win32: render([argv]),
        },
      };
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
      return { auto: [argv], manual: manualAll(render([argv])) };
    },
    needsSudo: () => false,
  };
}

export async function diagnose(requirements, ctx) {
  const missing = [];
  for (const r of requirements) {
    if (await r.check(ctx)) continue;
    const fix = r.fix(ctx);
    missing.push({
      id: r.id,
      why: r.why,
      required: r.required,
      size: r.size,
      fix: { auto: fix.auto === null ? null : render(fix.auto), manual: fix.manual },
      needsSudo: r.needsSudo(ctx),
    });
  }
  return { ok: !missing.some((m) => m.required), missing };
}

const defaultRun = (cmd, args, opts) => spawnSync(cmd, args, opts);

export async function runFixes(ids, requirements, ctx, run = defaultRun) {
  const results = [];
  for (const id of ids) {
    const req = requirements.find((r) => r.id === id);
    if (!req) {
      results.push({ id, ok: false, refused: 'unknown id' });
      continue;
    }
    const fix = req.fix(ctx);
    const manual = fix.manual[ctx.platform] ?? fix.manual.linux;
    if (req.needsSudo(ctx)) {
      results.push({ id, ok: false, refused: 'needs sudo', manual });
      continue;
    }
    if (fix.auto === null) {
      results.push({ id, ok: false, refused: 'no automatic fix', manual });
      continue;
    }
    let ok = true;
    for (const [cmd, ...args] of fix.auto) {
      const r = run(cmd, args, { stdio: 'inherit', shell: ctx.platform === 'win32' });
      if (r.status !== 0) {
        ok = false;
        break;
      }
    }
    results.push(ok ? { id, ok, ran: render(fix.auto) } : { id, ok, ran: render(fix.auto), manual });
  }
  return results;
}

function describe(m, platform) {
  const cmd = m.fix.auto ?? m.fix.manual[platform] ?? m.fix.manual.linux;
  const sudo = m.needsSudo ? ' (needs sudo: run it yourself)' : '';
  return `missing (${m.required ? 'required' : 'optional'}): ${m.id} — ${m.why} (${m.size}). Run: ${cmd}${sudo}`;
}

// Target keywords for --fix without --for: every requirement any target knows.
function allRequirements(targets, requirementsFor) {
  const seen = new Map();
  for (const t of targets) for (const r of requirementsFor(t)) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

export async function doctorMain(argv, { skill, skillDir, targets, requirementsFor }) {
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
  const ctx = defaultCtx(skillDir);
  const spec = values.for;
  if (spec !== undefined && !targets.includes(spec) && !(spec.endsWith('.json') && ctx.exists(spec))) {
    exitUsage(new UsageError(`--for must be one of: ${targets.join(', ')}, or an existing spec .json file; got ${JSON.stringify(spec)}`), { json: values.json });
    return;
  }

  if (values.fix !== undefined) {
    const ids = values.fix.split(',').map((s) => s.trim()).filter(Boolean);
    const reqs = spec === undefined ? allRequirements(targets, requirementsFor) : requirementsFor(spec);
    const results = await runFixes(ids, reqs, ctx);
    if (values.json) process.stdout.write(`${JSON.stringify(results)}\n`);
    else {
      for (const r of results) {
        if (r.ok) process.stdout.write(`fixed: ${r.id} (ran: ${r.ran})\n`);
        else if (r.refused) process.stdout.write(`refused: ${r.id} — ${r.refused}${r.manual ? `. Run it yourself: ${r.manual}` : ''}\n`);
        else process.stdout.write(`failed: ${r.id} (ran: ${r.ran}). Run it yourself: ${r.manual}\n`);
      }
    }
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  const result = await diagnose(requirementsFor(spec ?? 'check'), ctx);
  if (values.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.missing.length === 0) process.stdout.write(`ok: everything ${skill} needs is installed\n`);
  else for (const m of result.missing) process.stdout.write(`${describe(m, ctx.platform)}\n`);
  if (!result.ok) process.exitCode = 1;
}

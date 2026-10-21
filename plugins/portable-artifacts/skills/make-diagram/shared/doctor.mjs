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
export const KOKORO_PIN = 'kokoro-js@1.2.1';
const SKILLS_CLI = 'skills@1.7.2';
const USER_SCOPE_DIRS = ['.claude', '.agents', '.copilot', '.gemini'];
const PROJECT_SCOPE_DIRS = [...USER_SCOPE_DIRS, '.github'];
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
    realpath: (p) => fs.realpathSync(p),
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

const pp = (ctx) => (ctx.platform === 'win32' ? path.win32 : path.posix);
const manualAll = (cmd) => ({ darwin: cmd, linux: cmd, win32: cmd });
const argvOf = (step) => (Array.isArray(step) ? step : step.argv);

// cmd.exe quoting: one argument -> one token. Metacharacters and whitespace
// force double quotes. Backslash runs before an inner ", before a % break-out
// or at the end double (CRT rule); " doubles to ""; % is broken out of the
// quotes and caret-escaped so %VAR% pairs cannot form.
const CMD_SPECIAL = /[\s&|<>^()%!"]/;
export function cmdQuote(arg) {
  if (/[\0\r\n]/.test(arg)) throw new TypeError('argument contains a NUL, CR or LF character');
  if (arg !== '' && !CMD_SPECIAL.test(arg)) return arg;
  const inner = arg.replace(/(\\*)("|%|$)/g, (_m, bs, c) => bs + bs + (c === '"' ? '""' : c === '%' ? '"^%"' : ''));
  return `"${inner}"`;
}
export const cmdLine = (argv) => argv.map(cmdQuote).join(' ');

// Copy-paste display quoting: POSIX single quotes, cmd.exe double quotes.
const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const posixQuote = (a) => (POSIX_SAFE.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
const quoteFor = (platform) => (platform === 'win32' ? cmdQuote : posixQuote);
// One argument, quoted for display/paste on this platform (cmd.exe rules on win32, POSIX single quotes elsewhere).
export const quoteArg = (arg, platform = process.platform) => quoteFor(platform)(arg);

// Steps joined with &&; a step with a cwd is shown as `cd <dir> && <cmd>`.
// The cd target on win32 is a builtin's argument, never a command, so plain double
// quotes suffice (Windows paths cannot hold "); cmdQuote's "^%" break-out is not
// something `cd` is known to accept.
const cdQuote = (platform, dir) => (platform === 'win32' && !dir.includes('"') ? (CMD_SPECIAL.test(dir) ? `"${dir}"` : dir) : quoteFor(platform)(dir));

export function render(steps, platform) {
  const q = quoteFor(platform);
  const cd = platform === 'win32' ? 'cd /d' : 'cd';
  return steps
    .map((st) => {
      const line = argvOf(st).map(q).join(' ');
      return !Array.isArray(st) && st.cwd !== undefined ? `${cd} ${cdQuote(platform, st.cwd)} && ${line}` : line;
    })
    .join(' && ');
}
const isExec = (ctx, p) => (ctx.isExecutable ? ctx.isExecutable(p) : ctx.exists(p));

// Fix order: lower rank first. Others (unknown ids) rank last, keeping list order.
const RANK = { node: 0, nodeModules: 1, devDeps: 2, sister: 3, ffmpeg: 4, chromium: 5, kokoro: 6, other: 7 };

export function nodeVersion(min = 20) {
  return {
    id: 'node',
    rank: RANK.node,
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
    rank: RANK.nodeModules,
    why: "installs the skill's own npm packages",
    required: true,
    size: '≈30–60 MB',
    check: (ctx) => ctx.exists(pp(ctx).join(ctx.skillDir, 'node_modules')),
    fix: (ctx) => {
      const argv = ['npm', 'ci', ...(omitDev ? ['--omit=dev'] : []), '--prefix', ctx.skillDir];
      return { auto: [argv], manual: manualAll(render([argv], ctx.platform)) };
    },
    needsSudo: () => false,
  };
}

// check.mjs and the browser steps need playwright, a devDependency: reinstalls node_modules with dev packages.
// size: disclosed per skill (measured with du on macOS, approximate).
export function devDeps({ size = '≈20–120 MB more than node_modules alone, depending on the skill', required = false } = {}) {
  return {
    id: 'dev_deps',
    rank: RANK.devDeps,
    needsNodeModules: true,
    why: 'check.mjs needs the dev tools (playwright)',
    required,
    size,
    check: (ctx) => ctx.exists(pp(ctx).join(ctx.skillDir, 'node_modules', 'playwright')),
    fix: (ctx) => {
      const argv = ['npm', 'ci', '--prefix', ctx.skillDir];
      return { auto: [argv], manual: manualAll(render([argv], ctx.platform)), notes: `reinstalls node_modules with the dev dependencies included; size measured on macOS, approximate` };
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
async function playwrightChromiumPresent(ctx, dir = ctx.skillDir) {
  if (!ctx.exists(path.join(dir, 'node_modules', 'playwright-core'))) return false;
  const req = createRequire(path.join(dir, 'package.json'));
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

// Resolved, separator-trimmed, realpath'd where the path exists; lower-cased on win32 for comparison only.
function normPath(ctx, p) {
  const P = pp(ctx);
  let out = P.resolve(p);
  try {
    if (ctx.realpath && ctx.exists(out)) out = ctx.realpath(out);
  } catch {
    // keep the resolved path
  }
  return ci(ctx, out);
}

// Names compare case-insensitively on win32 only.
const ci = (ctx, str) => (ctx.platform === 'win32' ? str.toLowerCase() : str);
const inDirs = (ctx, dirs, name) => dirs.includes(ci(ctx, name));

// Where the skills CLI should run for a skill laid out as <root>/.<dir>/skills/<self>.
// User scope (root is home, dir in USER_SCOPE_DIRS): -g from home. Project scope
// (another root, dir in PROJECT_SCOPE_DIRS): cwd=<root>, no -g. Anything else: null.
function sisterPlan(ctx) {
  const P = pp(ctx);
  const skillsRoot = P.dirname(ctx.skillDir);
  const dot = P.dirname(skillsRoot);
  const dotName = P.basename(dot);
  if (ci(ctx, P.basename(skillsRoot)) !== 'skills' || !inDirs(ctx, PROJECT_SCOPE_DIRS, dotName)) return null;
  const root = P.dirname(dot);
  const home = ctx.homedir ?? os.homedir();
  if (normPath(ctx, root) === normPath(ctx, home)) return inDirs(ctx, USER_SCOPE_DIRS, dotName) ? { skillsRoot, cwd: P.resolve(home), global: true, dot, root } : null;
  return { skillsRoot, cwd: P.resolve(root), global: false, dot, root };
}

// Where the skills CLI may have put the skill, other than next to this one.
function locateSister(ctx, plan, name) {
  const P = pp(ctx);
  for (const d of PROJECT_SCOPE_DIRS) {
    const dir = P.join(plan.cwd, d, 'skills', name);
    if (ctx.exists(P.join(dir, 'SKILL.md'))) return dir;
  }
  return null;
}

export function sisterSkill(name) {
  if (typeof name !== 'string' || !SISTER_NAME.test(name)) throw new TypeError(`sisterSkill: invalid skill name ${JSON.stringify(name)}`);
  const sisterDir = (ctx) => pp(ctx).join(pp(ctx).dirname(ctx.skillDir), name);
  const skillPresent = (ctx) => ctx.exists(pp(ctx).join(sisterDir(ctx), 'SKILL.md'));
  const depsPresent = (ctx) => ctx.exists(pp(ctx).join(sisterDir(ctx), 'node_modules'));
  const present = (ctx) => skillPresent(ctx) && depsPresent(ctx);
  return {
    id: name,
    rank: RANK.sister,
    why: (ctx) => (skillPresent(ctx) ? `${name} is installed but its dependencies are not` : `sister skill ${name} is used for the matching sections`),
    required: true,
    size: '≈30–60 MB',
    check: present,
    fix: (ctx) => {
      const plan = sisterPlan(ctx);
      const install0 = ['npm', 'ci', '--omit=dev', '--prefix', sisterDir(ctx)];
      if (skillPresent(ctx)) {
        // Folder is there, its npm packages are not: install them only, never re-add the skill.
        return { auto: [install0], manual: manualAll(render([install0], ctx.platform)), notes: `${name} is installed but its dependencies are not; this runs npm ci in ${sisterDir(ctx)} only` };
      }
      const add = ['npx', '--yes', SKILLS_CLI, 'add', REPO, '--skill', name, '-y', ...(plan?.global ? ['-g'] : [])];
      const install = ['npm', 'ci', '--omit=dev', '--prefix', sisterDir(ctx)];
      if (plan === null) {
        const hint = `reinstall with your host's installer (for example run \`npx ${SKILLS_CLI} add ${REPO} --skill ${name} -y\` from your project root, or reinstall the plugin), then ${render([install], ctx.platform)}`;
        return { auto: null, manual: manualAll(hint) };
      }
      const auto = [
        { argv: add, cwd: plan.cwd, verify: skillPresent, locate: (c) => locateSister(c, plan, name), skillsRoot: plan.skillsRoot, sisterDir: sisterDir(ctx), install },
        install,
      ];
      const where = plan.global ? `your user-scope skills folder (${plan.skillsRoot}, via -g)` : plan.skillsRoot;
      const notes = `downloads from GitHub via npx ${SKILLS_CLI}; writes the skill into ${where}, plus skills-lock.json and agent symlinks such as .claude/skills/${name} in ${plan.cwd}`;
      return { auto, manual: manualAll(render(auto, ctx.platform)), notes };
    },
    needsSudo: () => false,
  };
}

// staticDir: the node_modules folder whose ffmpeg-static counts (default: this skill's; make-explainer points at make-motion's).
export function ffmpeg({ staticDir } = {}) {
  const staticBinary = (ctx) => pp(ctx).join(staticDir?.(ctx) ?? pp(ctx).join(ctx.skillDir, 'node_modules'), 'ffmpeg-static', ctx.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return {
    id: 'ffmpeg',
    rank: RANK.ffmpeg,
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

// install-deps (system libraries only), pinned to the skill's own playwright: never an unpinned download as root.
const libsHint = (ctx, dir = ctx.skillDir) => `sudo npx --no --prefix ${quoteFor(ctx.platform)(dir)} playwright install-deps chromium`;

function browserFailManual(ctx, { dir, where, manual, first }) {
  if (dir && !ctx.exists(where)) {
    const name = pp(ctx).basename(where);
    return `${name} is not installed next to this skill: install it first (doctor --fix ${name}), then run: ${manual}`;
  }
  return ctx.exists(pp(ctx).join(where, 'node_modules', 'playwright')) ? manual : `playwright is not installed: ${first}, then run: ${manual}`;
}

// dir: (ctx) => folder whose playwright is used (default: this skill). make-explainer points it at make-motion,
// whose browser renders the video.
export function browser({ required = false, dir, id = 'chromium' } = {}) {
  const where = (ctx) => (dir ? dir(ctx) : ctx.skillDir);
  return {
    id,
    rank: RANK.chromium,
    needsNodeModules: dir === undefined,
    why: dir ? "renders make-motion's video (Playwright Chromium from make-motion, or installed Chrome)" : 'renders pages to image and video (Playwright Chromium or installed Chrome)',
    required,
    size: '≈150 MB',
    check: async (ctx) => systemChromePaths(ctx).some((p) => ctx.exists(p)) || playwrightChromiumPresent(ctx, where(ctx)),
    // Platform hint for a chromium that is already present.
    presentInfo: (ctx) => (ctx.platform === 'linux' ? { note: `launching may need system libraries: ${libsHint(ctx, where(ctx))}`, sudoHint: libsHint(ctx, where(ctx)) } : null),
    fix: (ctx) => {
      // --no: never let npx fetch a different playwright; needs that folder's node_modules first.
      const argv = ['npx', '--no', '--prefix', where(ctx), 'playwright', 'install', 'chromium'];
      const manual = render([argv], ctx.platform);
      const first = dir ? "install make-motion's node_modules first (make-motion doctor --fix node_modules)" : 'run doctor --fix dev_deps first (check.mjs needs playwright); in make-motion, run --fix node_modules';
      const out = {
        auto: [argv],
        manual: manualAll(manual),
        notes: dir
          ? `downloads ≈150 MB of Chromium for make-motion (into ${where(ctx)}'s playwright cache); make-motion's node_modules must already be installed`
          : 'downloads ≈150 MB of Chromium; run after node_modules is installed',
        failManual: browserFailManual(ctx, { dir, where: where(ctx), manual, first }),
      };
      if (ctx.platform === 'linux') {
        out.notes += `; launching may need system libraries: ${libsHint(ctx, where(ctx))}`;
        out.sudoHint = libsHint(ctx, where(ctx));
      }
      return out;
    },
    needsSudo: () => false,
  };
}

export function kokoro() {
  return {
    id: 'kokoro',
    rank: RANK.kokoro,
    needsNodeModules: true,
    why: 'local text-to-speech for voiceover',
    required: false,
    size: '≈250 MB, plus a 90 MB model on first use',
    check: (ctx) => ctx.exists(pp(ctx).join(ctx.skillDir, 'node_modules', 'kokoro-js')),
    fix: (ctx) => {
      const argv = ['npm', 'install', KOKORO_PIN, '--no-save', '--prefix', ctx.skillDir];
      return { auto: [argv], manual: manualAll(render([argv], ctx.platform)), notes: 'the 90 MB voice model downloads on first use; a later `--fix node_modules` (npm ci) removes kokoro again, so rerun `--fix kokoro`' };
    },
    needsSudo: () => false,
  };
}

// The cheap-model `artifact-builder` agent file the skills hand their build to. Optional: a missing file
// never fails doctor, and there is no auto fix (it is written by the plugin's installer, not by npm).
// Doctor does not know its host, so it looks in every host folder, user level and project level.
// It applies only where Copilot or Codex plausibly exists (~/.copilot or ~/.codex is there): on a
// Claude Code or Gemini machine no agent file is ever installed, so nothing is reported at all.
// Limit: project level means the current folder, not the git root.
const BUILDER_AGENT_HOST_DIRS = ['.copilot', '.codex'];
const BUILDER_AGENT_FILES = ['artifact-builder.agent.md', 'artifact-builder.toml'];
const BUILDER_AGENT_DIRS = (ctx) => {
  const P = pp(ctx);
  const home = ctx.homedir ?? os.homedir();
  const cwd = ctx.cwd ?? process.cwd();
  return [P.join(home, '.copilot', 'agents'), P.join(home, '.codex', 'agents'), P.join(cwd, '.github', 'agents'), P.join(cwd, '.codex', 'agents')];
};

export function builderAgent() {
  const install = 'node <path-to-claude-skills>/plugins/portable-artifacts/bin/install.mjs';
  return {
    id: 'builder_agent',
    rank: RANK.other,
    why: 'lets the skill hand the build to a cheaper model (the artifact-builder agent file for Copilot or Codex)',
    required: false,
    size: '≈2 KB',
    // diagnose() skips a requirement whose applies(ctx) is false: not missing, not listed.
    applies: (ctx) => BUILDER_AGENT_HOST_DIRS.some((d) => ctx.exists(pp(ctx).join(ctx.homedir ?? os.homedir(), d))),
    check: (ctx) => BUILDER_AGENT_DIRS(ctx).some((dir) => BUILDER_AGENT_FILES.some((f) => ctx.exists(pp(ctx).join(dir, f)))),
    fix: () => ({
      auto: null,
      manual: manualAll(`${install} copilot --agents-only (Copilot) or ${install} codex --agents-only (Codex); \`agents\` writes both; add --project <dir> to install into one repo`),
    }),
    needsSudo: () => false,
  };
}

// { ok, missing, info? }. info lists present items that carry a platform hint.
// A requirement with an applies(ctx) predicate that returns false is left out entirely.
export async function diagnose(requirements, ctx) {
  const missing = [];
  const info = [];
  for (const r of requirements) {
    if (r.applies && !r.applies(ctx)) continue;
    if (await r.check(ctx)) {
      const hint = r.presentInfo?.(ctx);
      if (hint) info.push({ id: r.id, note: hint.note, sudoHint: hint.sudoHint });
      continue;
    }
    const fix = r.fix(ctx);
    const entry = {
      id: r.id,
      why: typeof r.why === 'function' ? r.why(ctx) : r.why,
      required: r.required,
      size: r.size,
      fix: { auto: fix.auto === null ? null : render(fix.auto, ctx.platform), manual: fix.manual },
      needsSudo: r.needsSudo(ctx),
    };
    if (fix.notes) entry.notes = fix.notes;
    if (fix.sudoHint) entry.sudoHint = fix.sudoHint;
    missing.push(entry);
  }
  const result = { ok: !missing.some((m) => m.required), missing };
  if (info.length > 0) result.info = info;
  return result;
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

const spawnError = (r) => {
  if (r.error) return r.error.code ? `${r.error.code}: ${r.error.message}` : String(r.error.message);
  if (r.status === null || r.status === undefined) return r.signal ? `killed by ${r.signal}` : 'did not run';
  return undefined;
};

// Requested ids run by rank (node, node_modules, dev_deps, sisters, ffmpeg, chromium, kokoro, others),
// deduped. A failed node_modules skips the requirements that need it.
export async function runFixes(ids, requirements, ctx, run = defaultRun) {
  const wanted = new Set(ids);
  const ordered = requirements
    .map((req, index) => ({ req, index }))
    .sort((a, b) => (a.req.rank ?? RANK.other) - (b.req.rank ?? RANK.other) || a.index - b.index)
    .map((x) => x.req);
  const results = [];
  let nodeModulesFailed = false;
  for (const req of ordered) {
    if (!wanted.has(req.id)) continue;
    wanted.delete(req.id);
    if (nodeModulesFailed && req.needsNodeModules) {
      results.push({ id: req.id, ok: false, skipped: 'needs node_modules' });
      continue;
    }
    const result = await fixOne(req, ctx, run);
    if (req.id === 'node_modules' && !result.ok) nodeModulesFailed = true;
    results.push(result);
  }
  for (const id of wanted) results.push({ id, ok: false, refused: 'unknown id' });
  return results;
}

async function fixOne(req, ctx, run) {
  const id = req.id;
  try {
    return await fixSteps(req, ctx, run);
  } catch (e) {
    return { id, ok: false, error: firstLine(e) };
  }
}

async function fixSteps(req, ctx, run) {
  const id = req.id;
  const fix = req.fix(ctx);
  const manual = fix.manual[ctx.platform] ?? fix.manual.linux;
  if (req.needsSudo(ctx)) return { id, ok: false, refused: 'needs sudo', manual };
  if (fix.auto === null) return { id, ok: false, refused: 'no automatic fix', manual };
  const done = [];
  for (const step of fix.auto) {
    done.push(step);
    const r = runStep(step, ctx, run);
    if (r.status !== 0) {
      const failed = { id, ok: false, ran: render(done, ctx.platform), manual: fix.failManual ?? manual };
      const error = spawnError(r);
      return error === undefined ? failed : { ...failed, error };
    }
    if (!Array.isArray(step) && step.verify && !(await step.verify(ctx))) {
      return { id, ok: false, ran: render(done, ctx.platform), elsewhere: true, manual: elsewhereMessage(step, ctx) };
    }
  }
  const ran = render(done, ctx.platform);
  if (await stillMissing(req, ctx)) {
    const hint = ctx.platform === 'win32' && id === 'ffmpeg' ? 'open a new terminal, then rerun doctor' : manual;
    return { id, ok: false, ran, stillMissing: true, manual: hint };
  }
  const ok = { id, ok: true, ran };
  if (fix.sudoHint) {
    ok.sudoHint = fix.sudoHint;
    ok.note = `launching may need system libraries: ${fix.sudoHint}`;
  }
  return ok;
}

function elsewhereMessage(step, ctx) {
  const P = pp(ctx);
  const found = step.locate?.(ctx);
  const skillsRoot = P.resolve(step.skillsRoot);
  const target = P.resolve(step.sisterDir);
  const next = `then run: ${render([step.install], ctx.platform)} (that step was skipped)`;
  if (found) return `the skills CLI wrote it to ${P.resolve(found)}; move that folder to ${target}, ${next}`;
  return `it was not found in ${skillsRoot} or in the agent folders under ${step.cwd}; check the skills CLI output above, install it into ${target} yourself, ${next}`;
}

function describe(m, platform) {
  const cmd = m.fix.auto ?? m.fix.manual[platform] ?? m.fix.manual.linux;
  const sudo = m.needsSudo ? ' (needs sudo: run it yourself)' : '';
  const notes = m.notes ? ` Note: ${m.notes}.` : '';
  return `missing (${m.required ? 'required' : 'optional'}): ${m.id} — ${m.why} (${m.size}). Run${platform === 'win32' ? ' (cmd.exe)' : ''}: ${cmd}${sudo}${notes}`;
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

function printFixResult(r, platform) {
  const shell = platform === 'win32' ? ' (cmd.exe)' : '';
  const out = (line) => process.stdout.write(`${line}\n`);
  if (r.ok) out(`fixed: ${r.id} (ran: ${r.ran})${r.note ? ` Note: ${r.note}.` : ''}`);
  else if (r.skipped) out(`skipped: ${r.id} — ${r.skipped} (run doctor --fix node_modules first)`);
  else if (r.refused) out(`refused: ${r.id} — ${r.refused}${r.manual ? `. Run it yourself${shell}: ${r.manual}` : ''}`);
  else if (r.elsewhere) out(`installed elsewhere: ${r.id} — ${r.manual}`);
  else if (r.stillMissing) out(`still missing: ${r.id} after (ran: ${r.ran}). ${r.manual}`);
  else if (r.ran === undefined) out(`failed: ${r.id} — ${r.error}`);
  else out(`failed: ${r.id} (ran: ${r.ran})${r.error ? ` [${r.error}]` : ''}. Run it yourself${shell}: ${r.manual}`);
}

// overrides ({ ctx, run }) exist for tests: inject a fake ctx and a command recorder.
export async function doctorMain(argv, { skill, skillDir, targets = ['check'], requirementsFor }, overrides = {}) {
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
  const ctx = overrides.ctx ?? defaultCtx(skillDir);
  const spec = values.for;
  if (spec !== undefined && !targets.includes(spec) && !(spec.endsWith('.json') && ctx.exists(spec))) {
    exitUsage(new UsageError(`--for must be ${targets.length > 0 ? `one of: ${targets.join(', ')}, or ` : ''}an existing spec .json file; got ${JSON.stringify(spec)}`), { json });
    return;
  }
  try {
    if (values.fix !== undefined) await fixMain(values.fix, { ctx, json, requirementsFor, spec, run: overrides.run });
    else await diagnoseMain({ ctx, json, skill, spec, requirementsFor });
  } catch (e) {
    exitUsage(new UsageError(firstLine(e)), { json });
  }
}

async function fixMain(raw, { ctx, json, requirementsFor, spec, run }) {
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new UsageError(`--fix needs at least one id; usage: ${USAGE}`);
  const results = await runFixes(ids, requirementsFor(spec ?? ALL), ctx, run);
  if (json) process.stdout.write(`${JSON.stringify(results)}\n`);
  else for (const r of results) printFixResult(r, ctx.platform);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

async function diagnoseMain({ ctx, json, skill, spec, requirementsFor }) {
  const result = await diagnose(requirementsFor(spec), ctx);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    if (result.missing.length === 0) process.stdout.write(`ok: everything ${skill} needs is installed\n`);
    for (const m of result.missing) process.stdout.write(`${describe(m, ctx.platform)}\n`);
    for (const i of result.info ?? []) process.stdout.write(`Note: ${i.id} — ${i.note}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

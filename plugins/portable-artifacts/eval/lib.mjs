// Pure-ish helpers for the cross-host eval runner. Kept separate from the CLI
// so scoring can be tested with a fake host and no LLM.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SKILLS = {
  dashboard: {
    dir: 'make-dashboard',
    spec: 'dashboard.json',
    // Build into <work>/dist; success = dist/index.html exists.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/build.mjs'), spec, '--out', path.join(work, 'dist')],
    artifacts: ['dist/index.html'],
  },
  motion: {
    dir: 'make-motion',
    spec: 'motion.json',
    // Contact sheet into <work>/out; success = at least one PNG.
    outputCmd: (skill, spec, work) => [path.join(skill, 'scripts/render.mjs'), spec, '--contact-sheet', '--out', path.join(work, 'out')],
    artifacts: ['out'],
  },
};

export function buildPrompt(skillCfg, task) {
  return [
    `Read skills/${skillCfg.dir}/SKILL.md and follow its workflow exactly.`,
    `The skill's scripts are in skills/${skillCfg.dir}/scripts/ and its dependencies are already installed.`,
    'Work only inside the current directory.',
    `Task: ${task}`,
    `Save the spec as ./${skillCfg.spec}.`,
  ].join(' ');
}

// Substitute {prompt} {cwd} {model} in a host command template.
export function expandCmd(host, { prompt, cwd, model }) {
  const sub = (s) => s.replaceAll('{prompt}', prompt).replaceAll('{cwd}', cwd).replaceAll('{model}', model ?? '');
  const argv = host.cmd.map(sub);
  if (model && host.modelArgs) argv.push(...host.modelArgs.map(sub));
  return argv;
}

export function run(argv, { cwd, env, timeoutMs = 0, logFile } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => { out += d; };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : null;
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      if (logFile) fs.writeFileSync(logFile, out);
      resolve({ code, out, timedOut, seconds: (Date.now() - started) / 1000 });
    };
    child.on('error', (e) => { out += `\n[spawn error] ${e.message}`; finish(127); });
    child.on('close', (code) => finish(code ?? 1));
  });
}

export function countValidateRuns(logPath) {
  if (!fs.existsSync(logPath)) return 0;
  return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim()).length;
}

// Leaf-level JSON paths that differ between two values (for edit prompts:
// a targeted edit should change only a few paths).
export function diffPaths(a, b, base = '') {
  if (a === b) return [];
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [base || '(root)'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    const p = Array.isArray(a) ? `${base}[${k}]` : base ? `${base}.${k}` : k;
    out.push(...diffPaths(a[k], b[k], p));
  }
  return out;
}

// Score one finished host run in `work`. The harness re-runs validate and the
// output step itself, so a host that couldn't run commands is still scored.
export async function scoreRun({ work, skillCfg, skillDir, seedSpec, outputTimeoutMs = 300000 }) {
  const specPath = path.join(work, skillCfg.spec);
  const score = {
    specExists: fs.existsSync(specPath),
    validateRuns: countValidateRuns(path.join(work, '.eval-log.jsonl')),
    finalValid: false,
    errors: [],
    outputOk: false,
    changedPaths: null,
  };
  if (!score.specExists) return score;
  const env = { EVAL_LOG: '' };
  const v = await run(['node', path.join(skillDir, 'scripts/validate.mjs'), specPath, '--json'], { cwd: work, env });
  try {
    const parsed = JSON.parse(v.out.trim().split('\n').pop());
    score.finalValid = parsed.ok === true;
    score.errors = parsed.errors ?? [];
  } catch {
    score.errors = [{ path: '(validate)', message: v.out.slice(0, 500) }];
  }
  if (seedSpec) {
    try { score.changedPaths = diffPaths(seedSpec, JSON.parse(fs.readFileSync(specPath, 'utf8'))); } catch { /* invalid JSON already scored */ }
  }
  if (!score.finalValid) return score;
  const o = await run(['node', ...skillCfg.outputCmd(skillDir, specPath, work)], {
    cwd: work, env, timeoutMs: outputTimeoutMs, logFile: path.join(work, 'output.log'),
  });
  score.outputOk = o.code === 0 && skillCfg.artifacts.every((a) => {
    const p = path.join(work, a);
    if (!fs.existsSync(p)) return false;
    return fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).some((f) => String(f).endsWith('.png')) : true;
  });
  return score;
}

export function summarize(rows, { host, skill, model }) {
  const n = rows.length;
  const pct = (k) => `${rows.filter((r) => r[k]).length}/${n}`;
  const lines = [
    `# Eval — ${skill} on ${host}${model ? ` (${model})` : ''}`,
    '',
    `Spec written ${pct('specExists')} · valid ${pct('finalValid')} · output ok ${pct('outputOk')}`,
    '',
    '| id | spec | valid | validate runs | output | seconds | notes |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const notes = [
      r.timedOut ? 'timed out' : '',
      r.errors?.length ? `${r.errors.length} errors: ${r.errors[0].path}: ${r.errors[0].message}` : '',
      r.changedPaths ? `changed: ${r.changedPaths.join(', ')}` : '',
    ].filter(Boolean).join('; ').replaceAll('|', '\\|');
    const b = (x) => (x ? '✓' : '✗');
    lines.push(`| ${r.id} | ${b(r.specExists)} | ${b(r.finalValid)} | ${r.validateRuns} | ${b(r.outputOk)} | ${r.seconds.toFixed(0)} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

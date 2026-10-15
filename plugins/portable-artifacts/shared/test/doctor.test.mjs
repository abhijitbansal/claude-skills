import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeVersion, nodeModules, sisterSkill, ffmpeg, browser, kokoro, diagnose, runFixes, doctorMain, ALL, cmdQuote } from '../doctor.mjs';

const ctx = (over = {}) => ({
  platform: 'darwin', env: {}, skillDir: '/s/make-motion', nodeVersion: '24.7.0',
  exists: () => false, which: () => false, ...over,
});

test('node version below the floor is a required miss', async () => {
  const r = await diagnose([nodeVersion(20)], ctx({ nodeVersion: '18.19.0' }));
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].id, 'node');
});

test('guardrail proof: a stub that reports everything present yields ok', async () => {
  const r = await diagnose([nodeModules(), ffmpeg(), kokoro()], ctx({ exists: () => true, which: () => true }));
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('ffmpeg missing, no brew: manual command only', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx());
  assert.equal(missing[0].id, 'ffmpeg');
  assert.equal(missing[0].fix.auto, null);
  assert.match(missing[0].fix.manual.darwin, /brew install ffmpeg/);
});

test('ffmpeg missing, brew present: auto is brew install ffmpeg', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ which: (c) => c === 'brew' }));
  assert.equal(missing[0].fix.auto, 'brew install ffmpeg');
});

test('Windows: winget is the auto fix', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ platform: 'win32' }));
  assert.equal(missing[0].fix.auto, 'winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements');
});

test('Linux: ffmpeg needs sudo and has no auto fix', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx({ platform: 'linux' }));
  assert.equal(missing[0].needsSudo, true);
  assert.equal(missing[0].fix.auto, null);
  assert.equal(missing[0].fix.manual.linux, 'sudo apt-get install ffmpeg');
});

test('FFMPEG_PATH that exists counts as present', async () => {
  const r = await diagnose([ffmpeg()], ctx({ env: { FFMPEG_PATH: '/x/ffmpeg' }, exists: (p) => p === '/x/ffmpeg' }));
  assert.equal(r.ok, true);
});

test('sister skill: missing folder is reported with its install command', async () => {
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h' }));
  assert.equal(missing[0].id, 'make-diagram');
  assert.match(missing[0].fix.auto, /npx --yes skills@1\.7\.2 add abhijitbansal\/claude-skills --skill make-diagram -y/);
});

test('optional misses do not flip ok', async () => {
  const r = await diagnose([kokoro()], ctx());
  assert.equal(r.ok, true);
  assert.equal(r.missing[0].required, false);
});

test('runFixes runs only requested auto fixes and refuses sudo and unknown ids', async () => {
  const ran = [];
  const run = (cmd, args) => { ran.push([cmd, ...args].join(' ')); return { status: 0 }; };
  const reqs = [ffmpeg(), kokoro()];
  const res = await runFixes(['kokoro', 'ffmpeg', 'nope'], reqs, ctx({ platform: 'linux' }), run);
  assert.deepEqual(ran, ['npm install kokoro-js@1.2.1 --no-save --prefix /s/make-motion']);
  assert.equal(res.find((r) => r.id === 'ffmpeg').refused, 'needs sudo');
  assert.match(res.find((r) => r.id === 'ffmpeg').manual, /sudo apt-get install ffmpeg/);
  assert.equal(res.find((r) => r.id === 'nope').refused, 'unknown id');
});

test('a failing fix reports ok:false', async () => {
  const res = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: 1 }));
  assert.equal(res[0].ok, false);
});

// --- additions beyond the brief ---

test('nodeModules: omitDev false drops --omit=dev; present dir is fine', async () => {
  const a = await diagnose([nodeModules({ omitDev: false })], ctx());
  assert.equal(a.missing[0].fix.auto, 'npm ci --prefix /s/make-motion');
  const b = await diagnose([nodeModules()], ctx());
  assert.equal(b.missing[0].fix.auto, 'npm ci --omit=dev --prefix /s/make-motion');
  const c = await diagnose([nodeModules()], ctx({ exists: (p) => p === '/s/make-motion/node_modules' }));
  assert.equal(c.ok, true);
});

test('sister skill: present when sibling dir has SKILL.md; fix chains npm ci, project scope has no -g', async () => {
  const dir = '/p/.agents/skills/make-explainer';
  const base = { skillDir: dir, cwd: '/p', homedir: '/h' };
  const here = await diagnose([sisterSkill('make-diagram')], ctx({ ...base, exists: (p) => p === '/p/.agents/skills/make-diagram/SKILL.md' }));
  assert.equal(here.ok, true);
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx(base));
  assert.match(missing[0].fix.auto, / && npm ci --omit=dev --prefix \/p\/\.agents\/skills\/make-diagram$/);
  assert.doesNotMatch(missing[0].fix.auto, / -g/);
  assert.match(missing[0].notes, /skills-lock\.json/);
});

test('sister skill: user-scope skill dir installs globally from home', async () => {
  for (const d of ['.claude', '.agents', '.copilot', '.gemini']) {
    const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: `/h/${d}/skills/make-explainer`, cwd: '/elsewhere', homedir: '/h' }));
    assert.match(missing[0].fix.auto, /-y -g && npm ci/, d);
  }
  const calls = [];
  const exists = (p) => calls.length > 0 && p === '/h/.claude/skills/make-diagram/SKILL.md';
  await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/h/.claude/skills/make-explainer', homedir: '/h', exists }), (c, a, o) => { calls.push({ c, a, cwd: o.cwd }); return { status: 0 }; });
  assert.equal(calls[0].cwd, '/h');
  assert.equal(calls[1].cwd, undefined);
});

test('sister skill: project scope runs skills add with cwd=<root>', async () => {
  const calls = [];
  await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', cwd: '/elsewhere', homedir: '/h' }), (c, a, o) => { calls.push({ c, a, cwd: o.cwd }); return { status: 0 }; });
  assert.equal(calls[0].cwd, '/p');
  assert.deepEqual(calls[0].a.slice(0, 2), ['--yes', 'skills@1.7.2']);
});

test('sister skill: plugin cache or custom path has no auto fix', async () => {
  for (const skillDir of ['/h/.claude/plugins/cache/x/portable-artifacts/skills/make-explainer', '/opt/stuff/make-explainer', '/h/.other/skills/make-explainer']) {
    const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir, cwd: '/p', homedir: '/h' }));
    assert.equal(missing[0].fix.auto, null, skillDir);
    assert.match(missing[0].fix.manual.darwin, /host's installer/);
  }
});

test('sister skill: installed elsewhere stops before npm ci', async () => {
  const calls = [];
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h' }), (c) => { calls.push(c); return { status: 0 }; });
  assert.deepEqual(calls, ['npx']);
  assert.equal(res[0].ok, false);
  assert.match(res[0].manual, /^installed elsewhere/);
});

test('sister skill: hostile names are rejected', () => {
  for (const n of ['../../evil&calc', 'Make-Diagram', '', 'a b', undefined]) assert.throws(() => sisterSkill(n), TypeError);
});

test('browser: system Chrome counts; optional by default, required when asked', async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const ok = await diagnose([browser()], ctx({ exists: (p) => p === chrome }));
  assert.deepEqual(ok, { ok: true, missing: [] });
  const opt = await diagnose([browser()], ctx());
  assert.equal(opt.missing[0].id, 'chromium');
  assert.equal(opt.missing[0].required, false);
  const req = await diagnose([browser({ required: true })], ctx());
  assert.equal(req.ok, false);
  assert.equal(req.missing[0].fix.auto, 'npx --no --prefix /s/make-motion playwright install chromium');
});

test('runFixes: win32 uses a shell, others do not; multi-step stops at first failure', async () => {
  const opts = [];
  const run = (cmd, args, o) => { opts.push(o.shell); return { status: 0 }; };
  await runFixes(['ffmpeg'], [ffmpeg()], ctx({ platform: 'win32' }), run);
  await runFixes(['kokoro'], [kokoro()], ctx(), run);
  assert.deepEqual(opts, [true, false]);
  let n = 0;
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' }), () => { n++; return { status: 1 }; });
  assert.equal(n, 1);
  assert.equal(res[0].ok, false);
});

test('runFixes: id with no auto fix is refused with the manual command', async () => {
  const res = await runFixes(['ffmpeg'], [ffmpeg()], ctx(), () => assert.fail('must not run'));
  assert.equal(res[0].refused, 'no automatic fix');
  assert.match(res[0].manual, /brew install ffmpeg/);
});

// --- doctorMain ---

async function runMain(argv, opts) {
  let out = '';
  let err = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  const prev = process.exitCode;
  process.exitCode = undefined;
  try { await doctorMain(argv, opts); } finally { process.stdout.write = w; process.stderr.write = e; }
  const code = process.exitCode ?? 0;
  process.exitCode = prev;
  return { out, err, code };
}

const mainOpts = (over = {}) => ({
  skill: 'make-motion', skillDir: '/nonexistent/make-motion', targets: ['check', 'voiceover'],
  requirementsFor: () => [nodeVersion(20), kokoro()], ...over,
});

test('doctorMain: unknown flag exits 2 and lists accepted ones', async () => {
  const r = await runMain(['--jsno'], mainOpts());
  assert.equal(r.code, 2);
  assert.match(r.err, /--json/);
});

test('doctorMain: unknown --for exits 2 listing accepted values', async () => {
  const r = await runMain(['--for', 'bogus'], mainOpts());
  assert.equal(r.code, 2);
  assert.match(r.err, /check, voiceover/);
});

test('doctorMain: --json prints the diagnose shape; kokoro optional miss keeps exit 0', async () => {
  const r = await runMain(['--json', '--for', 'voiceover'], mainOpts());
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.missing[0].id, 'kokoro');
  assert.equal(r.code, 0);
});

test('doctorMain: required miss exits 1 with a readable line; clean run says ok', async () => {
  const miss = await runMain([], mainOpts({ requirementsFor: () => [nodeModules()] }));
  assert.equal(miss.code, 1);
  assert.match(miss.out, /missing \(required\): node_modules — /);
  const clean = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1)] }));
  assert.equal(clean.code, 0);
  assert.match(clean.out, /ok: everything make-motion needs is installed/);
});

test('doctorMain: --fix refuses an unknown id with exit 1', async () => {
  const r = await runMain(['--fix', 'nope'], mainOpts());
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /unknown id/);
});

// --- fix round 1 ---

test('cmdQuote: whitespace and cmd metacharacters stay one quoted token', () => {
  assert.equal(cmdQuote('plain'), 'plain');
  assert.equal(cmdQuote('C:\\Users\\John Doe\\s'), '"C:\\Users\\John Doe\\s"');
  assert.equal(cmdQuote('a&b'), '"a&b"');
  assert.equal(cmdQuote('50%off'), '"50"^%"off"');
  assert.equal(cmdQuote('say "hi"'), '"say ""hi"""');
  assert.equal(cmdQuote(''), '""');
});

test('win32: one quoted command line, empty args, spaced path stays one argument', async () => {
  const rec = [];
  const run = (c, a, o) => { rec.push({ c, a, shell: o.shell }); return { status: 0 }; };
  await runFixes(['node_modules'], [nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\Users\\John Doe\\skills\\x' }), run);
  assert.deepEqual(rec, [{ c: 'npm ci --omit=dev --prefix "C:\\Users\\John Doe\\skills\\x"', a: [], shell: true }]);
  rec.length = 0;
  await runFixes(['node_modules'], [nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\a&b\\100%\\x' }), run);
  assert.equal(rec[0].c, 'npm ci --omit=dev --prefix "C:\\a&b\\100"^%"\\x"');
});

test('non-win32: argv arrays, no shell, spaces untouched', async () => {
  const rec = [];
  await runFixes(['node_modules'], [nodeModules()], ctx({ skillDir: '/a b/x' }), (c, a, o) => { rec.push({ c, a, shell: o.shell }); return { status: 0 }; });
  assert.deepEqual(rec, [{ c: 'npm', a: ['ci', '--omit=dev', '--prefix', '/a b/x'], shell: false }]);
});

test('runFixes: requirement order, deduped; unknown ids last', async () => {
  const ran = [];
  const reqs = [nodeModules(), ffmpeg(), kokoro()];
  const res = await runFixes(['kokoro', 'nope', 'node_modules', 'kokoro', 'ffmpeg'], reqs, ctx({ which: (c) => c === 'brew' }), (c) => { ran.push(c); return { status: 0 }; });
  assert.deepEqual(ran, ['npm', 'brew', 'npm']);
  assert.deepEqual(res.map((r) => r.id), ['node_modules', 'ffmpeg', 'kokoro', 'nope']);
});

test('runFixes: re-checks after the fix and reports stillMissing', async () => {
  const res = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: 0 }));
  assert.equal(res[0].ok, false);
  assert.equal(res[0].stillMissing, true);
  const done = await runFixes(['kokoro'], [kokoro()], ctx({ exists: () => true }), () => ({ status: 0 }));
  assert.equal(done[0].ok, true);
  const win = await runFixes(['ffmpeg'], [ffmpeg()], ctx({ platform: 'win32' }), () => ({ status: 0 }));
  assert.match(win[0].manual, /open a new terminal/);
});

test('linux chromium carries a sudo hint; optional notes exist', async () => {
  const { missing } = await diagnose([browser(), kokoro()], ctx({ platform: 'linux' }));
  assert.match(missing[0].sudoHint, /sudo npx playwright install --with-deps chromium/);
  assert.match(missing[0].notes, /150 MB/);
  assert.match(missing[1].notes, /90 MB/);
  const mac = await diagnose([browser()], ctx());
  assert.equal(mac.missing[0].sudoHint, undefined);
});

test('ffmpeg: FFMPEG_PATH must be executable; ffmpeg-static binary counts only if executable', async () => {
  const base = { exists: () => true, isExecutable: () => false };
  assert.equal((await diagnose([ffmpeg()], ctx({ ...base, env: { FFMPEG_PATH: '/x/ffmpeg' } }))).ok, false);
  assert.equal((await diagnose([ffmpeg()], ctx({ ...base, isExecutable: (p) => p === '/x/ffmpeg', env: { FFMPEG_PATH: '/x/ffmpeg' } }))).ok, true);
  const staticOk = ctx({ ...base, isExecutable: (p) => p === '/s/make-motion/node_modules/ffmpeg-static/ffmpeg' });
  assert.equal((await diagnose([ffmpeg()], staticOk)).ok, true);
});

test('ffmpeg darwin without brew: manual says install Homebrew', async () => {
  const { missing } = await diagnose([ffmpeg()], ctx());
  assert.match(missing[0].fix.manual.darwin, /Homebrew \(https:\/\/brew\.sh\)/);
});

const sisterOpts = () => ({
  skill: 'make-explainer', skillDir: '/nonexistent/p/.agents/skills/make-explainer',
  requirementsFor: (t) => (t === ALL ? [sisterSkill('make-diagram'), kokoro()] : t === 'spec.json' ? [sisterSkill('make-diagram')] : []),
});

test('doctorMain: plain diagnosis passes undefined to requirementsFor', async () => {
  const seen = [];
  await runMain(['--json'], { ...mainOpts(), requirementsFor: (t) => { seen.push(t); return []; } });
  assert.deepEqual(seen, [undefined]);
});

test('doctorMain: --fix resolves ids against ALL (sister works without --for)', async () => {
  const seen = [];
  const r = await runMain(['--fix', 'make-diagram', '--json'], { ...sisterOpts(), requirementsFor: (t) => { seen.push(t); return sisterOpts().requirementsFor(t); } });
  assert.deepEqual(seen, [ALL]);
  assert.doesNotMatch(r.out, /unknown id/);
});

test('doctorMain: empty --fix is a usage error (exit 2)', async () => {
  for (const v of ['', ',']) assert.equal((await runMain(['--fix', v], mainOpts())).code, 2);
});

test('doctorMain: a throwing requirementsFor or check is a one-line exit 2', async () => {
  const r = await runMain([], mainOpts({ requirementsFor: () => { throw new Error('bad spec\n  at stack'); } }));
  assert.equal(r.code, 2);
  assert.equal(r.err.trim(), 'bad spec');
  const c = await runMain([], mainOpts({ requirementsFor: () => [{ ...kokoro(), check: () => { throw new Error('boom'); } }] }));
  assert.equal(c.code, 2);
});

test('doctorMain: targets defaults to check and must be strings', async () => {
  const ok = await runMain(['--for', 'check'], { skill: 's', skillDir: '/x', requirementsFor: () => [] });
  assert.equal(ok.code, 0);
  await assert.rejects(() => doctorMain([], { skill: 's', skillDir: '/x', targets: [1], requirementsFor: () => [] }), TypeError);
});

test('doctorMain: text output prints notes', async () => {
  const r = await runMain([], { ...sisterOpts(), requirementsFor: () => [kokoro()] });
  assert.match(r.out, /Note: the 90 MB voice model/);
});

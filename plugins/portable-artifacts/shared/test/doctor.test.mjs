import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTrip } from './helpers/cmdsim.mjs';
import { nodeVersion, nodeModules, devDeps, sisterSkill, ffmpeg, browser, kokoro, quoteArg, diagnose, runFixes, doctorMain, ALL, cmdQuote } from '../doctor.mjs';

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
  const here = await diagnose([sisterSkill('make-diagram')], ctx({ ...base, exists: (p) => p === '/p/.agents/skills/make-diagram/SKILL.md' || p === '/p/.agents/skills/make-diagram/node_modules' }));
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
  assert.equal(res[0].elsewhere, true);
  assert.match(res[0].manual, /not found in \/p\/\.agents\/skills .*install it into \/p\/\.agents\/skills\/make-diagram yourself, then run: npm ci/);
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

async function runMain(argv, opts, over = {}) {
  let out = '';
  let err = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  const prev = process.exitCode;
  process.exitCode = undefined;
  try { await doctorMain(argv, opts, { ctx: ctx(), run: () => ({ status: 0 }), ...over }); } finally { process.stdout.write = w; process.stderr.write = e; }
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
  const res = await runFixes(['kokoro', 'nope', 'node_modules', 'kokoro', 'ffmpeg'], reqs, ctx({ which: (c) => c === 'brew' || (c === 'ffmpeg' && ran.includes('brew')), exists: () => ran.length > 0 }), (c) => { ran.push(c); return { status: 0 }; });
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
  assert.match(missing[0].sudoHint, /^sudo npx --no --prefix \/s\/make-motion playwright install-deps chromium$/);
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

// --- fix round 2 ---

test('R24/R25: linux chromium present yields an info entry; other platforms none', async () => {
  const present = (platform) => ctx({ platform, exists: (p) => p === '/usr/bin/google-chrome' || p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const linux = await diagnose([browser()], present('linux'));
  assert.deepEqual(linux.missing, []);
  assert.equal(linux.info[0].id, 'chromium');
  assert.match(linux.info[0].sudoHint, /^sudo npx --no --prefix \/s\/make-motion playwright install-deps chromium$/);
  assert.doesNotMatch(linux.info[0].sudoHint, /with-deps/);
  assert.equal((await diagnose([browser()], present('darwin'))).info, undefined);
  const text = await runMain([], { ...mainOpts(), requirementsFor: () => [browser()] }, { ctx: present('linux') });
  assert.match(text.out, /Note: chromium — launching may need system libraries/);
});

test('R24/R25: a successful linux --fix chromium carries the sudo hint', async () => {
  const res = await runFixes(['chromium'], [browser()], ctx({ platform: 'linux', exists: (p) => p === '/usr/bin/google-chrome' }), () => ({ status: 0 }));
  assert.equal(res[0].ok, true);
  assert.match(res[0].sudoHint, /install-deps chromium/);
  const mac = await runFixes(['chromium'], [browser()], ctx({ exists: (p) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), () => ({ status: 0 }));
  assert.equal(mac[0].sudoHint, undefined);
});

test('N2: the shown sister command includes cd <root>; ran includes it; win32 uses cd /d', async () => {
  const base = { skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' };
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx(base));
  assert.match(missing[0].fix.auto, /^cd \/p && npx --yes skills@1\.7\.2 add /);
  assert.match(missing[0].fix.manual.darwin, /^cd \/p && /);
  const win = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'win32', skillDir: 'C:\\p\\.agents\\skills\\make-explainer', homedir: 'C:\\Users\\u' }));
  assert.match(win.missing[0].fix.auto, /^cd \/d C:\\p && npx /);
  // the skill folder appears once the add step has run; node_modules appears after npm ci
  const seen = new Set();
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ ...base, exists: (p) => (p.endsWith('SKILL.md') ? seen.has('npx') : seen.has('npm')) }), (c) => { seen.add(c); return { status: 0 }; });
  assert.match(res[0].ran, /^cd \/p && npx .* && npm ci/);
});

test('N3: doctorMain with injected ctx/run never reaches spawnSync; --fix uses the recorder', async () => {
  const calls = [];
  const r = await runMain(['--fix', 'kokoro', '--json'], { ...mainOpts(), requirementsFor: () => [kokoro()] }, { run: (c, a) => { calls.push([c, ...a].join(' ')); return { status: 0 }; } });
  assert.deepEqual(calls, ['npm install kokoro-js@1.2.1 --no-save --prefix /s/make-motion']);
  assert.equal(JSON.parse(r.out)[0].id, 'kokoro');
});

const SIM_CASES = ['C:\\Users\\John Doe\\s', 'a&b', '50%off', '%PATH%', 'x%USERNAME%y', 'C:\\x y\\', 'C:\\x\\', 'say "hi"', 'a"&calc&"b', 'x\\"&calc', 'C:\\a&b\\100%\\x', 'C:\\a\\%PATH%', 'a|b<c>d', 'a^b', '(x)', '%', 'C:\\dir with space\\"q"\\'];
test('N4: cmdLine round-trips through the cmd + UCRT model with no unquoted & | < >', () => {
  for (const c of SIM_CASES) {
    const r = roundTrip(['npx', '--prefix', c, 'playwright']);
    assert.deepEqual(r.argv, ['npx', '--prefix', c, 'playwright'], JSON.stringify(c));
    assert.equal(r.unquotedMeta, '', JSON.stringify(c));
  }
});

test('N4: cmdQuote rejects NUL, CR and LF', () => {
  for (const bad of ['a\0b', 'a\nb', 'a\rb']) assert.throws(() => cmdQuote(bad), TypeError);
});

test('N4: a failure from a bad argument becomes that id\'s failure result', async () => {
  const res = await runFixes(['node_modules'], [nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\a\nb' }), () => ({ status: 0 }));
  assert.equal(res[0].ok, false);
  assert.match(res[0].error, /NUL, CR or LF/);
});

test('N5: fix order is by rank regardless of wrapper order; failed node_modules skips chromium and kokoro', async () => {
  const ran = [];
  const reqs = [kokoro(), browser(), ffmpeg(), sisterSkill('make-diagram'), nodeModules(), nodeVersion(20)];
  const base = ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h', which: (c) => c === 'brew' });
  const res = await runFixes(['kokoro', 'chromium', 'ffmpeg', 'make-diagram', 'node_modules'], reqs, base, (c, a) => { ran.push(`${c} ${a[0]}`); return { status: ran.length === 1 ? 1 : 0 }; });
  assert.deepEqual(res.map((r) => r.id), ['node_modules', 'make-diagram', 'ffmpeg', 'chromium', 'kokoro']);
  assert.equal(res.find((r) => r.id === 'chromium').skipped, 'needs node_modules');
  assert.equal(res.find((r) => r.id === 'kokoro').skipped, 'needs node_modules');
  assert.equal(ran[0].startsWith('npm'), true);
  assert.ok(!ran.some((r) => r.startsWith('npx --no')));
});

test('N5: chromium failure says to install playwright (dev_deps) first', async () => {
  const res = await runFixes(['chromium'], [browser()], ctx(), () => ({ status: 1 }));
  assert.match(res[0].manual, /playwright is not installed: run doctor --fix dev_deps/);
});

test('N6: installed elsewhere names where it landed and what to do', async () => {
  const exists = (p) => p === '/p/.claude/skills/make-diagram/SKILL.md';
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h', exists }), () => ({ status: 0 }));
  assert.match(res[0].manual, /wrote it to \/p\/\.claude\/skills\/make-diagram; move that folder to \/p\/\.agents\/skills\/make-diagram, then run: npm ci --omit=dev --prefix \/p\/\.agents\/skills\/make-diagram \(that step was skipped\)/);
  const text = await runMain(['--fix', 'make-diagram'], { ...mainOpts(), requirementsFor: () => [sisterSkill('make-diagram')] }, { ctx: ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' }) });
  assert.match(text.out, /^installed elsewhere: make-diagram — /);
});

test('N7: ran lists only the steps that ran', async () => {
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' }), () => ({ status: 1 }));
  assert.doesNotMatch(res[0].ran, /npm ci/);
  assert.match(res[0].ran, /npx --yes/);
});

test('N9: win32 home compares case-insensitively; unknown dot-dir and unknown scope fall back to manual', async () => {
  const w = ctx({ platform: 'win32', skillDir: 'c:\\users\\u\\.claude\\skills\\make-explainer', homedir: 'C:\\Users\\u\\' });
  const g = await diagnose([sisterSkill('make-diagram')], w);
  assert.match(g.missing[0].fix.auto, /-y -g/);
  const unknown = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/p/.cursor/skills/make-explainer', homedir: '/h' }));
  assert.equal(unknown.missing[0].fix.auto, null);
  const github = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/p/.github/skills/make-explainer', homedir: '/h' }));
  assert.match(github.missing[0].fix.auto, /^cd \/p && /);
  const homeGithub = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/h/.github/skills/make-explainer', homedir: '/h' }));
  assert.equal(homeGithub.missing[0].fix.auto, null);
});

test('N9: realpath resolves a symlinked home', async () => {
  const c = ctx({ skillDir: '/link/.claude/skills/make-explainer', homedir: '/real/home', exists: () => true, realpath: (p) => p.replace('/link', '/real/home') });
  const { ok } = await diagnose([sisterSkill('make-diagram')], c);
  assert.equal(ok, true);
  const c2 = ctx({ skillDir: '/link/.claude/skills/make-explainer', homedir: '/real/home', realpath: (p) => p.replace('/link', '/real/home'), exists: (p) => p === '/link' || p === '/real/home' });
  const { missing } = await diagnose([sisterSkill('make-diagram')], c2);
  assert.match(missing[0].fix.auto, /-y -g/);
});

test('N10: an error thrown by fix() is that id\'s failure; other results still come', async () => {
  const bad = { ...kokoro(), id: 'bad', fix: () => { throw new Error('exploded\nstack'); } };
  const res = await runFixes(['bad', 'kokoro'], [bad, kokoro()], ctx(), () => ({ status: 0 }));
  assert.deepEqual(res.map((r) => r.id), ['bad', 'kokoro']);
  assert.equal(res[0].error, 'exploded');
});

test('N11: spawn errors surface in the result', async () => {
  const enoent = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: null, error: Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }) }));
  assert.equal(enoent[0].error, 'ENOENT: spawn npm ENOENT');
  const killed = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: null, signal: 'SIGKILL' }));
  assert.equal(killed[0].error, 'killed by SIGKILL');
  const plain = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: 1 }));
  assert.equal(plain[0].error, undefined);
});

test('N12: display quoting is shell-safe per platform', async () => {
  const mac = await diagnose([nodeModules()], ctx({ skillDir: "/Users/o'neil/a&b $HOME/x" }));
  assert.equal(mac.missing[0].fix.auto, "npm ci --omit=dev --prefix '/Users/o'\\''neil/a&b $HOME/x'");
  const win = await diagnose([nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\John Doe\\x\\' }));
  assert.equal(win.missing[0].fix.auto, 'npm ci --omit=dev --prefix "C:\\John Doe\\x\\\\"');
  const plain = await diagnose([nodeModules()], ctx());
  assert.equal(plain.missing[0].fix.auto, 'npm ci --omit=dev --prefix /s/make-motion');
});

// --- fix round 3 ---

test('R3-1: the linux hint is install-deps pinned to the skill prefix, never an unpinned install as root', async () => {
  const { missing } = await diagnose([browser()], ctx({ platform: 'linux', skillDir: '/s/my skill' }));
  assert.equal(missing[0].sudoHint, "sudo npx --no --prefix '/s/my skill' playwright install-deps chromium");
  assert.doesNotMatch(missing[0].notes, /with-deps/);
});

test('R3-2/3: win32 compares skills and dot-dir names case-insensitively; linux does not', async () => {
  const g = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'win32', skillDir: 'C:\\Users\\u\\.Claude\\skills\\make-explainer', homedir: 'C:\\Users\\u' }));
  assert.match(g.missing[0].fix.auto, /-y -g/);
  const s2 = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'win32', skillDir: 'C:\\p\\.agents\\Skills\\make-explainer', homedir: 'C:\\Users\\u' }));
  assert.match(s2.missing[0].fix.auto, /^cd \/d C:\\p && /);
  const lin = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'linux', skillDir: '/p/.CLAUDE/skills/x', homedir: '/h' }));
  assert.equal(lin.missing[0].fix.auto, null);
  const lin2 = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'linux', skillDir: '/p/.claude/Skills/x', homedir: '/h' }));
  assert.equal(lin2.missing[0].fix.auto, null);
});

test('R3-4: the rendered cd target is quoted for spaces and quotes', async () => {
  const mk = (over) => diagnose([sisterSkill('make-diagram')], ctx({ homedir: '/h', ...over }));
  const spaced = await mk({ skillDir: '/my proj/.agents/skills/make-explainer' });
  assert.match(spaced.missing[0].fix.auto, /^cd '\/my proj' && /);
  const quoted = await mk({ skillDir: "/o'neil/.agents/skills/make-explainer" });
  assert.match(quoted.missing[0].fix.auto, /^cd '\/o'\\''neil' && /);
  const win = await mk({ platform: 'win32', skillDir: 'C:\\John Doe\\.agents\\skills\\make-explainer', homedir: 'C:\\Users\\u' });
  assert.match(win.missing[0].fix.auto, /^cd \/d "C:\\John Doe" && /);
});

test('R3-6: win32 cd path containing % uses plain double quotes (no "^%" break-out)', async () => {
  const win = await diagnose([sisterSkill('make-diagram')], ctx({ platform: 'win32', skillDir: 'C:\\100%\\.agents\\skills\\make-explainer', homedir: 'C:\\Users\\u' }));
  assert.match(win.missing[0].fix.auto, /^cd \/d "C:\\100%" && /);
});

test('R3-7: -g display cwd is the normalised home, without a trailing separator', async () => {
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/h/.claude/skills/make-explainer', homedir: '/h/' }));
  assert.match(missing[0].fix.auto, /^cd \/h && /);
});

test('R3-8: spawn errors show code and message', async () => {
  const res = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: null, error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }) }));
  assert.equal(res[0].error, 'ENOENT: spawn npx ENOENT');
  const noCode = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: null, error: new Error('weird') }));
  assert.equal(noCode[0].error, 'weird');
});

test('sister skill: SKILL.md present but node_modules missing fixes with npm ci only', async () => {
  const base = { skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h', exists: (p) => p === '/p/.agents/skills/make-diagram/SKILL.md' };
  const { ok, missing } = await diagnose([sisterSkill('make-diagram')], ctx(base));
  assert.equal(ok, false);
  assert.equal(missing[0].why, 'make-diagram is installed but its dependencies are not');
  assert.equal(missing[0].fix.auto, 'npm ci --omit=dev --prefix /p/.agents/skills/make-diagram');
  assert.doesNotMatch(missing[0].fix.auto, /npx/);
  assert.match(missing[0].notes, /npm ci/);
  const calls = [];
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx(base), (c, a) => { calls.push([c, ...a]); return { status: 0 }; });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'npm');
  assert.equal(res[0].ok, false); // still no node_modules in the fake fs: reported, not claimed fixed
});

test('sister skill: absent skill still reports the add + npm ci chain', async () => {
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h' }));
  assert.match(missing[0].why, /is used for the matching sections/);
  assert.match(missing[0].fix.auto, /npx/);
});

test('doctorMain: empty targets accept only a spec .json for --for', async () => {
  const r = await runMain(['--for', 'check'], mainOpts({ targets: [] }));
  assert.equal(r.code, 2);
  assert.match(r.err, /--for must be an existing spec \.json file/);
});

test('dev_deps: present when node_modules/playwright exists; fix is a full npm ci with disclosure', async () => {
  const ok = await diagnose([devDeps()], ctx({ exists: (p) => p === '/s/make-motion/node_modules/playwright' }));
  assert.equal(ok.ok, true);
  const { missing } = await diagnose([devDeps()], ctx());
  assert.equal(missing[0].id, 'dev_deps');
  assert.equal(missing[0].required, false);
  assert.equal(missing[0].fix.auto, 'npm ci --prefix /s/make-motion');
  assert.match(missing[0].notes, /dev dependencies/);
});

test('consent text equals the run command for node_modules and dev_deps', async () => {
  const calls = [];
  const { missing } = await diagnose([nodeModules(), devDeps()], ctx());
  const c = ctx({ exists: (p) => p === '/s/make-motion/node_modules' && calls.length > 0 });
  await runFixes(['node_modules', 'dev_deps'], [nodeModules(), devDeps()], c, (cmd, a) => { calls.push([cmd, ...a].join(' ')); return { status: 0 }; });
  assert.deepEqual(calls, missing.map((m) => m.fix.auto));
});

test('fix order: node_modules, dev_deps, sisters, ffmpeg, chromium, kokoro', async () => {
  const reqs = [kokoro(), browser(), ffmpeg(), sisterSkill('make-diagram'), devDeps(), nodeModules(), nodeVersion(20)];
  const res = await runFixes(reqs.map((r) => r.id), reqs, ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' }), () => ({ status: 0 }));
  assert.deepEqual(res.map((r) => r.id), ['node', 'node_modules', 'dev_deps', 'make-diagram', 'ffmpeg', 'chromium', 'kokoro']);
});

test('ffmpeg staticDir: a static binary in another skill counts', async () => {
  const dir = (c) => '/s/make-motion-sibling/node_modules';
  const isExecutable = (p) => p === '/s/make-motion-sibling/node_modules/ffmpeg-static/ffmpeg';
  assert.equal((await diagnose([ffmpeg({ staticDir: dir })], ctx({ isExecutable }))).ok, true);
  assert.equal((await diagnose([ffmpeg()], ctx({ isExecutable }))).ok, false);
});

test('quoteArg: POSIX single quotes, cmd.exe double quotes, safe words bare', () => {
  assert.equal(quoteArg('/a/b', 'darwin'), '/a/b');
  assert.equal(quoteArg('/a b/c', 'linux'), "'/a b/c'");
  assert.equal(quoteArg('C:\\a b\\c', 'win32'), '"C:\\a b\\c"');
});

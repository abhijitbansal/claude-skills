import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTrip } from './helpers/cmdsim.mjs';
import { nodeVersion, nodeModules, devDeps, sisterSkill, builderAgent, ffmpeg, browser, kokoro, cutout, OPTIONAL, optionalInstallArgv, quoteArg, diagnose, runFixes, doctorMain, ALL, cmdQuote } from '../doctor.mjs';

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
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []); // `exists: () => true` also finds the old in-skill kokoro-js, which adds an info note, not a miss
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
  const cwds = [];
  const run = (cmd, args, o) => { ran.push([cmd, ...args].join(' ')); cwds.push(o.cwd); return { status: 0 }; };
  const reqs = [ffmpeg(), kokoro()];
  const res = await runFixes(['kokoro', 'ffmpeg', 'nope'], reqs, ctx({ platform: 'linux' }), run);
  assert.deepEqual(ran, ['npm ci --ignore-scripts --prefix /s/make-motion/optional/voice']);
  assert.deepEqual(cwds, [undefined], 'kokoro installs with --prefix into its own folder, no cwd');
  assert.equal(res.find((r) => r.id === 'ffmpeg').refused, 'needs sudo');
  assert.match(res.find((r) => r.id === 'ffmpeg').manual, /sudo apt-get install ffmpeg/);
  assert.equal(res.find((r) => r.id === 'nope').refused, 'unknown id');
});

test('a failing fix reports ok:false', async () => {
  const res = await runFixes(['kokoro'], [kokoro()], ctx(), () => ({ status: 1 }));
  assert.equal(res[0].ok, false);
});

// Everything exists except the dev package playwright: a production-only install.
const noPlaywright = (p) => !/[\\/]node_modules[\\/]playwright$/.test(p);

// A lockfile whose tree holds fast-uri (via ajv) but not sharp or global-agent.
const LOCK = JSON.stringify({ packages: { '': {}, 'node_modules/ajv': {}, 'node_modules/fast-uri': {}, 'node_modules/@scope/pkg': {} } });

test('node_modules installed before an overrides pin existed counts as missing until npm ci reruns', async () => {
  const files = {
    '/s/make-motion/package.json': JSON.stringify({ overrides: { 'fast-uri': '3.1.9', other: '^1.0.0' } }),
    '/s/make-motion/package-lock.json': LOCK,
    '/s/make-motion/node_modules/fast-uri/package.json': JSON.stringify({ version: '3.1.8' }),
  };
  const readFile = (p) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p];
  };
  const stale = await diagnose([nodeModules()], ctx({ exists: noPlaywright, readFile }));
  assert.equal(stale.ok, false, 'the stale install must go red, node_modules is a required requirement');
  assert.equal(stale.missing[0].id, 'node_modules');
  assert.match(stale.missing[0].why, /reinstall to get the patched fast-uri pinned in package\.json "overrides"/);
  assert.equal(stale.missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /s/make-motion');
  files['/s/make-motion/node_modules/fast-uri/package.json'] = JSON.stringify({ version: '3.1.9' });
  assert.deepEqual(await diagnose([nodeModules()], ctx({ exists: () => true, readFile })), { ok: true, missing: [] });
});

test('node_modules fix on an existing install says what npm ci removes and which --fix ids restore it', async () => {
  const exists = noPlaywright;
  const dev = (await diagnose([nodeModules({ restore: ['dev_deps'] })], ctx({ exists, readFile: () => { throw new Error('x'); }, skillDir: '/s/x' })));
  assert.deepEqual(dev, { ok: true, missing: [] });
  const stale = { '/s/x/package.json': JSON.stringify({ overrides: { 'fast-uri': '3.1.9' } }), '/s/x/package-lock.json': LOCK, '/s/x/node_modules/fast-uri/package.json': JSON.stringify({ version: '3.1.8' }) };
  const readFile = (p) => { if (!(p in stale)) throw new Error('ENOENT'); return stale[p]; };
  const note = async (opts, over = {}) => (await diagnose([nodeModules(opts)], ctx({ exists, readFile, skillDir: '/s/x', ...over }))).missing[0].notes;
  assert.match(await note({ restore: ['dev_deps'] }), /removes the dev packages; restore with --fix dev_deps$/);
  assert.match(await note({}), /removes the dev packages; restore the dev packages with npm ci --ignore-scripts --prefix \/s\/x \(this skill's doctor has no --fix id/);
  assert.equal(await note({ omitDev: false }), undefined, 'nothing removed, nothing to disclose');
  assert.equal((await diagnose([nodeModules({ restore: ['dev_deps'] })], ctx({ exists: () => false, skillDir: '/s/x' }))).missing[0].notes, undefined, 'a first install removes nothing');
});

test('sister skill: a node_modules that predates a pin in the sister package.json counts as missing', async () => {
  const dir = '/p/.agents/skills/make-diagram';
  const files = {
    [dir + '/package.json']: JSON.stringify({ overrides: { 'fast-uri': '3.1.9' } }),
    [dir + '/package-lock.json']: LOCK,
    [dir + '/node_modules/fast-uri/package.json']: JSON.stringify({ version: '3.1.8' }),
  };
  const readFile = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
  const base = { skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h', exists: noPlaywright, readFile };
  const stale = await diagnose([sisterSkill('make-diagram')], ctx(base));
  assert.equal(stale.ok, false);
  assert.match(stale.missing[0].why, /make-diagram is installed but its dependencies predate the patched fast-uri/);
  assert.equal(stale.missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix ' + dir);
  assert.match(stale.missing[0].notes, /removes its dev packages/);
  files[dir + '/node_modules/fast-uri/package.json'] = JSON.stringify({ version: '3.1.9' });
  assert.deepEqual(await diagnose([sisterSkill('make-diagram')], ctx(base)), { ok: true, missing: [] });
});

// --- additions beyond the brief ---

test('nodeModules: omitDev false drops --omit=dev; present dir is fine', async () => {
  const a = await diagnose([nodeModules({ omitDev: false })], ctx());
  assert.equal(a.missing[0].fix.auto, 'npm ci --ignore-scripts --prefix /s/make-motion');
  const b = await diagnose([nodeModules()], ctx());
  assert.equal(b.missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /s/make-motion');
  const c = await diagnose([nodeModules()], ctx({ exists: (p) => p === '/s/make-motion/node_modules' }));
  assert.equal(c.ok, true);
});

test('sister skill: present when sibling dir has SKILL.md; fix chains npm ci, project scope has no -g', async () => {
  const dir = '/p/.agents/skills/make-explainer';
  const base = { skillDir: dir, cwd: '/p', homedir: '/h' };
  const here = await diagnose([sisterSkill('make-diagram')], ctx({ ...base, exists: (p) => p === '/p/.agents/skills/make-diagram/SKILL.md' || p === '/p/.agents/skills/make-diagram/node_modules' }));
  assert.equal(here.ok, true);
  const { missing } = await diagnose([sisterSkill('make-diagram')], ctx(base));
  assert.match(missing[0].fix.auto, / && npm ci --ignore-scripts --omit=dev --prefix \/p\/\.agents\/skills\/make-diagram$/);
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
  assert.deepEqual(rec, [{ c: 'npm ci --ignore-scripts --omit=dev --prefix "C:\\Users\\John Doe\\skills\\x"', a: [], shell: true }]);
  rec.length = 0;
  await runFixes(['node_modules'], [nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\a&b\\100%\\x' }), run);
  assert.equal(rec[0].c, 'npm ci --ignore-scripts --omit=dev --prefix "C:\\a&b\\100"^%"\\x"');
});

test('non-win32: argv arrays, no shell, spaces untouched', async () => {
  const rec = [];
  await runFixes(['node_modules'], [nodeModules()], ctx({ skillDir: '/a b/x' }), (c, a, o) => { rec.push({ c, a, shell: o.shell }); return { status: 0 }; });
  assert.deepEqual(rec, [{ c: 'npm', a: ['ci', '--ignore-scripts', '--omit=dev', '--prefix', '/a b/x'], shell: false }]);
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
  assert.match(missing[1].notes, /93 MB/);
  const mac = await diagnose([browser()], ctx());
  assert.equal(mac.missing[0].sudoHint, undefined);
});

test('ffmpeg: an ffmpeg-static binary in node_modules no longer counts; FFMPEG_PATH pointing at it does', async () => {
  const base = { exists: () => true, isExecutable: () => false };
  assert.equal((await diagnose([ffmpeg()], ctx({ ...base, env: { FFMPEG_PATH: '/x/ffmpeg' } }))).ok, false);
  assert.equal((await diagnose([ffmpeg()], ctx({ ...base, isExecutable: (p) => p === '/x/ffmpeg', env: { FFMPEG_PATH: '/x/ffmpeg' } }))).ok, true);
  const staticBinary = '/s/make-motion/node_modules/ffmpeg-static/ffmpeg';
  const staticOk = ctx({ ...base, isExecutable: (p) => p === staticBinary });
  assert.equal((await diagnose([ffmpeg()], staticOk)).ok, false);
  assert.equal((await diagnose([ffmpeg()], { ...staticOk, env: { FFMPEG_PATH: staticBinary } })).ok, true);
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

test('R44: --fix honours --for (ids resolve against that target)', async () => {
  const seen = [];
  const r = await runMain(['--for', 'check', '--fix', 'make-diagram', '--json'], { ...sisterOpts(), targets: ['check'], requirementsFor: (t) => { seen.push(t); return t === 'check' ? [] : sisterOpts().requirementsFor(t); } });
  assert.deepEqual(seen, ['check']);
  assert.match(r.out, /unknown id/);
});

test('R44: browser({ id }) names the requirement; default stays chromium', () => {
  assert.equal(browser().id, 'chromium');
  assert.equal(browser({ id: 'motion_chromium', dir: () => '/s/make-motion' }).id, 'motion_chromium');
});

test('T12: win32 text output labels manual and auto command lines (cmd.exe)', async () => {
  const w = ctx({ platform: 'win32' });
  const r = await runMain([], { ...mainOpts(), requirementsFor: () => [ffmpeg()] }, { ctx: w });
  assert.match(r.out, /Run \(cmd\.exe\): /);
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
  assert.match(r.out, /Note: installs from optional\/voice\/package-lock\.json; the 93 MB voice model/);
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
  assert.deepEqual(calls, ['npm ci --ignore-scripts --prefix /s/make-motion/optional/voice']);
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
  assert.match(res[0].manual, /playwright is not installed: run doctor --fix dev_deps first \(check\.mjs needs playwright\); in make-motion, run --fix node_modules/);
});

test('N6: installed elsewhere names where it landed and what to do', async () => {
  const exists = (p) => p === '/p/.claude/skills/make-diagram/SKILL.md';
  const res = await runFixes(['make-diagram'], [sisterSkill('make-diagram')], ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h', exists }), () => ({ status: 0 }));
  assert.match(res[0].manual, /wrote it to \/p\/\.claude\/skills\/make-diagram; move that folder to \/p\/\.agents\/skills\/make-diagram, then run: npm ci --ignore-scripts --omit=dev --prefix \/p\/\.agents\/skills\/make-diagram \(that step was skipped\)/);
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
  assert.equal(mac.missing[0].fix.auto, "npm ci --ignore-scripts --omit=dev --prefix '/Users/o'\\''neil/a&b $HOME/x'");
  const win = await diagnose([nodeModules()], ctx({ platform: 'win32', skillDir: 'C:\\John Doe\\x\\' }));
  assert.equal(win.missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix "C:\\John Doe\\x\\\\"');
  const plain = await diagnose([nodeModules()], ctx());
  assert.equal(plain.missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /s/make-motion');
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
  assert.equal(missing[0].fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /p/.agents/skills/make-diagram');
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
  assert.equal(missing[0].fix.auto, 'npm ci --ignore-scripts --prefix /s/make-motion');
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

test('quoteArg: POSIX single quotes, cmd.exe double quotes, safe words bare', () => {
  assert.equal(quoteArg('/a/b', 'darwin'), '/a/b');
  assert.equal(quoteArg('/a b/c', 'linux'), "'/a b/c'");
  assert.equal(quoteArg('C:\\a b\\c', 'win32'), '"C:\\a b\\c"');
});

test('browser({ dir }): checks and installs into the other skill, quoted; not skipped by this skill\'s node_modules', async () => {
  const dir = (c) => '/s/make motion';
  const b = browser({ required: true, dir });
  assert.equal(b.needsNodeModules, false);
  const { missing } = await diagnose([b], ctx({ skillDir: '/s/make-explainer' }));
  assert.equal(missing[0].required, true);
  assert.equal(missing[0].fix.auto, "npx --no --prefix '/s/make motion' playwright install chromium");
  assert.match(missing[0].why, /make-motion/);
  assert.match(missing[0].notes, /make-motion/);
  assert.match(b.fix(ctx({ skillDir: '/s/make-explainer', exists: (p) => p === '/s/make motion' })).failManual, /make-motion's node_modules first/);
  const absent = b.fix(ctx({ skillDir: '/s/make-explainer' })).failManual;
  assert.match(absent, /^make motion is not installed next to this skill: install it first \(doctor --fix make motion\)/);
});

test('devDeps required option (check.mjs skips without playwright)', async () => {
  assert.equal(devDeps().required, false);
  const { ok, missing } = await diagnose([devDeps({ required: true })], ctx());
  assert.equal(ok, false);
  assert.equal(missing[0].required, true);
});

test('devDeps size option is disclosed', async () => {
  const { missing } = await diagnose([devDeps({ size: '≈118 MB' })], ctx());
  assert.equal(missing[0].size, '≈118 MB');
  assert.match(missing[0].notes, /measured on macOS, approximate/);
});

// --- builderAgent: the optional artifact-builder agent file ---

const AGENT_DIRS = ["/h/.claude/agents", "/h/.copilot/agents", "/h/.codex/agents", "/p/.claude/agents", "/p/.github/agents", "/p/.codex/agents"];
const AGENT_FILE_NAMES = ["artifact-builder.md", "artifact-builder.agent.md", "artifact-builder.toml"];
// A current agent file carries make.mjs; the text before this plan told the builder to write the spec and run two scripts.
const CURRENT_TEXT = "Run: node <skill-dir>/scripts/make.mjs <spec> --json";
const OLD_TEXT = "Run the skill's validate script on the spec, then its build script.";
const readerOf = (files) => (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; };
// files: existing agent files; dirs: other existing folders (the host's home folder is what makes the requirement apply).
const agentCtx = (files = [], dirs = ["/h/.codex"]) => ctx({ homedir: "/h", cwd: "/p", execPath: "/n/node", exists: (p) => files.includes(p) || dirs.includes(p) });
const EMPTY_HOME = [];

test("builderAgent: false on an empty home and cwd; optional with the shared requirement fields", async () => {
  const b = builderAgent();
  assert.equal(b.id, "builder_agent");
  assert.equal(b.required, false);
  assert.equal(b.needsSudo(agentCtx()), false);
  assert.equal(typeof (typeof b.why === "function" ? b.why(agentCtx()) : b.why), "string");
  assert.equal(typeof b.rank, "number");
  assert.equal(typeof b.size, "string");
  assert.equal(await b.check(agentCtx()), false);
});

// builderAgent knows three file names (one per host) in six folders (user and project level): every pair counts.
for (const dir of AGENT_DIRS) {
  for (const file of AGENT_FILE_NAMES) {
    test(`builderAgent: ${file} in ${dir} counts as installed`, async () => {
      assert.equal(await builderAgent().check(agentCtx([`${dir}/${file}`])), true);
    });
  }
}

test("builderAgent: another file in an agents folder does not count", async () => {
  assert.equal(await builderAgent().check(agentCtx(["/h/.copilot/agents/other.agent.md", "/h/.codex/agents/artifact-builder.yaml"])), false);
});

test("builderAgent: the plugin's own agents/artifact-builder.md counts as installed", async () => {
  // skillDir is <plugin>/skills/<skill>; the plugin file is <plugin>/agents/artifact-builder.md
  const c = ctx({ homedir: "/h", cwd: "/p", skillDir: "/plug/skills/make-motion", exists: (p) => p === "/plug/agents/artifact-builder.md" || p === "/h/.claude" });
  assert.deepEqual(await diagnose([builderAgent()], c), { ok: true, missing: [] });
});

test("builderAgent: the plugin file satisfies Claude Code only; ~/.codex or ~/.copilot still wants its own file, and no claude file is written beside the plugin's", async () => {
  const plugin = "/plug/agents/artifact-builder.md";
  for (const other of ["/h/.codex", "/h/.copilot"]) {
    const c = ctx({ homedir: "/h", cwd: "/p", execPath: "/n/node", skillDir: "/plug/skills/make-motion", exists: (p) => [plugin, "/h/.claude", other].includes(p) });
    const { missing } = await diagnose([builderAgent()], c);
    assert.deepEqual(missing.map((m) => m.id), ["builder_agent"], other);
    const hosts = builderAgent().fix(c).auto.map((argv) => argv[3]);
    assert.deepEqual(hosts, [other === "/h/.codex" ? "codex" : "copilot"], "the writer skips claude: the plugin already ships that agent");
  }
});

// An agent file is outdated when it lacks make.mjs: the earlier text told the builder to write the spec itself.
const stateCtx = (path, text, dirs = ["/h/.claude"]) => ctx({
  homedir: "/h", cwd: "/p", execPath: "/n/node",
  exists: (p) => p === path || dirs.includes(p),
  readFile: readerOf({ [path]: text }),
});

test("builderAgent: a file without the text make.mjs is reported as outdated with the command that replaces it", async () => {
  const file = "/h/.claude/agents/artifact-builder.md";
  const c = stateCtx(file, OLD_TEXT);
  assert.equal(await builderAgent().check(c), false);
  const { ok, missing } = await diagnose([builderAgent()], c);
  assert.equal(ok, true);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "builder_agent");
  assert.deepEqual(missing[0].outdated, [file]);
  assert.match(missing[0].why, /outdated/);
  assert.equal(missing[0].fix.auto, null, "no automatic fix: the doctor never overwrites");
  assert.match(missing[0].fix.manual.darwin, /install\.mjs claude --agents-only --force/);
  const human = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1), builderAgent()] }), { ctx: c });
  assert.equal(human.code, 0);
  assert.match(human.out, /outdated \(optional\): builder_agent — /);
  assert.match(human.out, /install\.mjs claude --agents-only --force/);
});

test("builderAgent: an outdated project-level file names the project in the replacing command, and each host its own", async () => {
  const proj = "/p/.github/agents/artifact-builder.agent.md";
  const c1 = stateCtx(proj, OLD_TEXT, ["/h/.copilot"]);
  const m1 = (await diagnose([builderAgent()], c1)).missing[0];
  assert.match(m1.fix.manual.linux, /install\.mjs copilot --agents-only --force --project \/p/);
  const toml = "/h/.codex/agents/artifact-builder.toml";
  const m2 = (await diagnose([builderAgent()], stateCtx(toml, OLD_TEXT, ["/h/.codex"]))).missing[0];
  assert.match(m2.fix.manual.linux, /install\.mjs codex --agents-only --force(?! --project)/);
});

test("builderAgent: an up-to-date file is ok, and an unreadable one is not called outdated", async () => {
  const file = "/h/.claude/agents/artifact-builder.md";
  assert.deepEqual(await diagnose([builderAgent()], stateCtx(file, `---\n---\n${CURRENT_TEXT}\n`)), { ok: true, missing: [] });
  const unreadable = ctx({ homedir: "/h", cwd: "/p", exists: (p) => p === file || p === "/h/.claude", readFile: () => { throw new Error("EACCES"); } });
  assert.deepEqual(await diagnose([builderAgent()], unreadable), { ok: true, missing: [] });
});

test("builderAgent: the outdated report never fails doctor, and --fix refuses it and writes nothing", async () => {
  const file = "/h/.claude/agents/artifact-builder.md";
  const c = stateCtx(file, OLD_TEXT);
  const run = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1), builderAgent()] }), { ctx: c });
  assert.equal(run.code, 0);
  const json = JSON.parse((await runMain(["--json"], mainOpts({ requirementsFor: () => [builderAgent()] }), { ctx: c })).out);
  assert.equal(json.ok, true);
  const ran = [];
  const res = await runFixes(["builder_agent"], [builderAgent()], c, (...a) => { ran.push(a); return { status: 0 }; });
  assert.deepEqual(ran, []);
  assert.equal(res[0].refused, "no automatic fix");
  assert.match(res[0].manual, /--agents-only --force/);
});

test("builderAgent: one outdated file among current ones still reports, and names only the outdated one", async () => {
  const old = "/h/.claude/agents/artifact-builder.md";
  const cur = "/h/.codex/agents/artifact-builder.toml";
  const c = ctx({ homedir: "/h", cwd: "/p", exists: (p) => [old, cur, "/h/.claude"].includes(p), readFile: readerOf({ [old]: OLD_TEXT, [cur]: CURRENT_TEXT }) });
  const m = (await diagnose([builderAgent()], c)).missing[0];
  assert.deepEqual(m.outdated, [old]);
});

test("builderAgent: auto fix writes the agent file for each host folder that exists; manual names the installer", () => {
  const both = builderAgent().fix(agentCtx([], ["/h/.codex", "/h/.copilot"]));
  assert.deepEqual(both.auto.map((s) => s.slice(1)), [
    ["/s/make-motion/shared/agents.mjs", "write", "copilot", "/h/.copilot/agents"],
    ["/s/make-motion/shared/agents.mjs", "write", "codex", "/h/.codex/agents"],
  ]);
  assert.ok(both.auto.every((s) => s[0] === "/n/node"), "runs this process's Node, not node from PATH");
  const withClaude = builderAgent().fix(agentCtx([], ["/h/.claude", "/h/.codex"]));
  assert.deepEqual(withClaude.auto.map((s) => s.slice(1)), [
    ["/s/make-motion/shared/agents.mjs", "write", "codex", "/h/.codex/agents"],
    ["/s/make-motion/shared/agents.mjs", "write", "claude", "/h/.claude/agents"],
  ]);
  assert.match(withClaude.notes, /\/h\/\.claude\/agents\/artifact-builder\.md/);
  assert.match(withClaude.manual.darwin, /install\.mjs claude --agents-only/);
  const codexOnly = builderAgent().fix(agentCtx([], ["/h/.codex"]));
  assert.deepEqual(codexOnly.auto.map((s) => s.slice(1)), [["/s/make-motion/shared/agents.mjs", "write", "codex", "/h/.codex/agents"]]);
  assert.match(codexOnly.notes, /\/h\/\.codex\/agents\/artifact-builder\.toml/);
  const f = builderAgent().fix(agentCtx());
  const text = f.manual.darwin;
  assert.match(text, /node <path-to-claude-skills>\/plugins\/portable-artifacts\/bin\/install\.mjs copilot --agents-only/);
  assert.match(text, /install\.mjs codex --agents-only/);
  assert.match(text, /<path-to-claude-skills> is a local checkout \(or clone the repo\)/);
  assert.match(text, /\bagents\b[^.]*both/);
  assert.deepEqual(Object.keys(f.manual).sort(), ["darwin", "linux", "win32"]);
});

test("builderAgent: a missing agent file is optional and never makes doctor exit 1", async () => {
  const r = await diagnose([builderAgent()], agentCtx());
  assert.equal(r.ok, true);
  assert.equal(r.missing[0].id, "builder_agent");
  assert.equal(r.missing[0].required, false);
  assert.match(r.missing[0].fix.auto, /agents\.mjs write codex \/h\/\.codex\/agents/);
  const run = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1), builderAgent()] }), { ctx: agentCtx() });
  assert.equal(run.code, 0);
  assert.match(run.out, /missing \(optional\): builder_agent — /);
  assert.match(run.out, /Run: \/n\/node \/s\/make-motion\/shared\/agents\.mjs write codex \/h\/\.codex\/agents/);
  assert.match(run.out, /writes \/h\/\.codex\/agents\/artifact-builder\.toml/);
  const json = JSON.parse((await runMain(["--json"], mainOpts({ requirementsFor: () => [builderAgent()] }), { ctx: agentCtx() })).out);
  assert.equal(json.ok, true);
});

test("builderAgent: not reported at all when none of ~/.claude, ~/.copilot and ~/.codex exists (Gemini)", async () => {
  const empty = agentCtx([], EMPTY_HOME);
  assert.equal(builderAgent().applies(empty), false);
  assert.deepEqual(await diagnose([builderAgent()], empty), { ok: true, missing: [] });
  const opts = mainOpts({ requirementsFor: () => [nodeVersion(1), builderAgent()] });
  const human = await runMain([], opts, { ctx: empty });
  assert.equal(human.code, 0);
  assert.match(human.out, /ok: everything make-motion needs is installed/);
  assert.doesNotMatch(human.out, /builder_agent/);
  const json = JSON.parse((await runMain(["--json"], opts, { ctx: empty })).out);
  assert.deepEqual(json, { ok: true, missing: [] });
});

test("builderAgent: ~/.claude, ~/.codex or ~/.copilot present without the file is a missing optional, exit 0", async () => {
  for (const dir of ["/h/.claude", "/h/.codex", "/h/.copilot"]) {
    const c = agentCtx([], [dir]);
    assert.equal(builderAgent().applies(c), true, dir);
    const { ok, missing } = await diagnose([builderAgent()], c);
    assert.equal(ok, true);
    assert.deepEqual(missing.map((m) => [m.id, m.required]), [["builder_agent", false]]);
    const human = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1), builderAgent()] }), { ctx: c });
    assert.equal(human.code, 0);
    assert.match(human.out, /missing \(optional\): builder_agent — .*Run: \/n\/node \/s\/make-motion\/shared\/agents\.mjs write (claude|codex|copilot) \/h\/\.(claude|codex|copilot)\/agents/);
  }
});

test("builderAgent: ~/.copilot present and the file installed is not missing", async () => {
  const c = agentCtx(["/h/.copilot/agents/artifact-builder.agent.md"], ["/h/.copilot"]);
  assert.deepEqual(await diagnose([builderAgent()], c), { ok: true, missing: [] });
});

test("builderAgent: --fix builder_agent runs the shared writer once per host folder and succeeds once the file exists", async () => {
  const ran = [];
  const written = new Set();
  const c = agentCtx([], ["/h/.codex", "/h/.copilot"]);
  const live = { ...c, exists: (p) => written.has(p) || c.exists(p) };
  const run = (cmd, args) => {
    ran.push([cmd, ...args]);
    written.add(`${args[3]}/${args[2] === "copilot" ? "artifact-builder.agent.md" : "artifact-builder.toml"}`);
    return { status: 0 };
  };
  const res = await runFixes(["builder_agent"], [builderAgent()], live, run);
  assert.deepEqual(ran.map((r) => r.slice(1)), [
    ["/s/make-motion/shared/agents.mjs", "write", "copilot", "/h/.copilot/agents"],
    ["/s/make-motion/shared/agents.mjs", "write", "codex", "/h/.codex/agents"],
  ]);
  assert.equal(res[0].id, "builder_agent");
  assert.equal(res[0].ok, true);
});

test("builderAgent: --fix reports a failed write with the writer command first, then the installer", async () => {
  const res = await runFixes(["builder_agent"], [builderAgent()], agentCtx(), () => ({ status: 1 }));
  assert.equal(res[0].ok, false);
  assert.match(res[0].ran, /agents\.mjs write codex \/h\/\.codex\/agents/);
  assert.match(res[0].manual, /^node \/s\/make-motion\/shared\/agents\.mjs write codex \/h\/\.codex\/agents \(this skill's own writer\); or /);
  assert.match(res[0].manual, /install\.mjs codex --agents-only/);
});

test("builderAgent: --fix with no host folder has no automatic fix and runs nothing", async () => {
  const ran = [];
  const none = agentCtx([], []);
  assert.equal(builderAgent().fix(none).auto, null);
  const res = await runFixes(["builder_agent"], [builderAgent()], none, (...a) => { ran.push(a); return { status: 0 }; });
  assert.deepEqual(ran, []);
  assert.equal(res[0].refused, "no automatic fix");
  assert.match(res[0].manual, /install\.mjs copilot --agents-only/);
  assert.doesNotMatch(res[0].manual, /this skill's own writer/);
});

// --- kokoro and cutout: each is its own locked package under <skill>/optional/, installed with npm ci ---

const VOICE = '/s/make-motion/optional/voice';
const CUT = '/s/make-motion/optional/cutout';
const jsonFiles = (files) => (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

test('kokoro and cutout install with npm ci from their own locked folder', async () => {
  const r = await diagnose([kokoro(), cutout()], ctx({ platform: 'linux' }));
  assert.deepEqual(r.missing.map((m) => m.fix.auto), [`npm ci --ignore-scripts --prefix ${VOICE}`, `npm ci --ignore-scripts --prefix ${CUT}`]);
  assert.equal(r.ok, true, 'both are opt-in');
  assert.match(r.missing[1].size, /25 MB/, 'the size names the model download');
});

test('OPTIONAL names the folder and package of each, and optionalInstallArgv is npm ci into that folder', () => {
  assert.deepEqual(OPTIONAL, { kokoro: { dir: 'voice', pkg: 'phonemizer' }, cutout: { dir: 'cutout', pkg: 'onnxruntime-node' } });
  // --ignore-scripts: onnxruntime-node's postinstall downloads Linux x64 CUDA binaries unhashed; the CPU binaries ship in the tarball.
  assert.deepEqual(optionalInstallArgv(ctx(), 'kokoro'), ['npm', 'ci', '--ignore-scripts', '--prefix', VOICE]);
  assert.deepEqual(optionalInstallArgv(ctx(), 'cutout'), ['npm', 'ci', '--ignore-scripts', '--prefix', CUT]);
});

test('the optional installs say where they come from, that the model downloads once, and that npm ci in the skill folder leaves them alone', async () => {
  const r = await diagnose([kokoro(), cutout()], ctx());
  assert.match(r.missing[0].notes, /installs from optional\/voice\/package-lock\.json; the 93 MB voice model downloads on first use, pinned to one commit and checked against SHA-256; npm ci in the skill folder leaves it alone/);
  assert.match(r.missing[1].notes, /installs from optional\/cutout\/package-lock\.json; the 25 MB MODNet model downloads on first use, pinned to one commit and checked against SHA-256; npm ci in the skill folder leaves it alone/);
});

test('an old in-skill install does not count', async () => {
  const r = await diagnose([kokoro()], ctx({ platform: 'linux', exists: (p) => p === '/s/make-motion/node_modules/kokoro-js' }));
  assert.equal(r.missing[0].id, 'kokoro');
  assert.match(r.missing[0].why, /the old kokoro-js install in \/s\/make-motion\/node_modules is no longer used; --fix node_modules removes it/);
});

test('installed in its folder is present; an old in-skill copy beside it is an info note', async () => {
  const exists = (p) => p === `${VOICE}/node_modules/phonemizer` || p === '/s/make-motion/node_modules/kokoro-js';
  const r = await diagnose([kokoro()], ctx({ exists, readFile: () => { throw new Error('ENOENT'); } }));
  assert.deepEqual(r.missing, []);
  assert.equal(r.info[0].id, 'kokoro');
  assert.match(r.info[0].note, /no longer used; --fix node_modules removes it/);
});

// Decision 11: version 2 needs onnxruntime-node and phonemizer only. The voice requirement is found by phonemizer, so a folder
// installed before the trim (it also holds kokoro-js, transformers and sharp) still counts as present until the next `--fix`.
test('the voice requirement is present when optional/voice/node_modules/phonemizer exists, and absent without it', async () => {
  const present = await diagnose([kokoro()], ctx({ exists: (p) => p === `${VOICE}/node_modules/phonemizer` }));
  assert.deepEqual(present.missing, []);
  const onlyOnnx = await diagnose([kokoro()], ctx({ exists: (p) => p === `${VOICE}/node_modules/onnxruntime-node` }));
  assert.equal(onlyOnnx.missing[0].id, 'kokoro', 'onnxruntime-node alone is not the voice stack');
  const kokoroOnly = await diagnose([kokoro()], ctx({ exists: (p) => p === `${VOICE}/node_modules/kokoro-js` }));
  assert.equal(kokoroOnly.missing[0].id, 'kokoro', 'kokoro-js alone is no longer the sign of an install');
});

test('an install made before the trim, which also holds kokoro-js, still counts as present', async () => {
  const exists = (p) => [`${VOICE}/node_modules/phonemizer`, `${VOICE}/node_modules/kokoro-js`, `${VOICE}/node_modules/sharp`].includes(p);
  const r = await diagnose([kokoro()], ctx({ exists, readFile: () => { throw new Error('ENOENT'); } }));
  assert.deepEqual(r.missing, []);
  assert.equal(r.ok, true);
});

test('the voice requirement states the measured sizes and names no kokoro-js', async () => {
  const { missing } = await diagnose([kokoro()], ctx());
  const [voice] = missing;
  assert.equal(voice.size, '≈227 MB, plus a 93 MB model on first use');
  assert.doesNotMatch(`${voice.why} ${voice.size} ${voice.notes}`, /kokoro-js/);
  assert.doesNotMatch(JSON.stringify(voice.fix), /kokoro-js|huggingface|sharp/);
});

test('an optional install that predates a pin counts as missing until npm ci reruns', async () => {
  const files = {
    [`${VOICE}/package.json`]: JSON.stringify({ dependencies: { phonemizer: '1.2.1' }, overrides: { 'global-agent': '4.1.3' } }),
    [`${VOICE}/node_modules/phonemizer/package.json`]: JSON.stringify({ version: '1.2.1' }),
    [`${VOICE}/node_modules/global-agent/package.json`]: JSON.stringify({ version: '4.1.2' }),
  };
  const exists = (p) => p === `${VOICE}/node_modules/phonemizer`;
  const stale = await diagnose([kokoro()], ctx({ exists, readFile: jsonFiles(files) }));
  assert.equal(stale.missing[0].id, 'kokoro');
  assert.match(stale.missing[0].why, /reinstall to get global-agent as pinned in optional\/voice\/package\.json/);
  files[`${VOICE}/node_modules/global-agent/package.json`] = JSON.stringify({ version: '4.1.3' });
  assert.deepEqual((await diagnose([kokoro()], ctx({ exists, readFile: jsonFiles(files) }))).missing, []);
});

test('a pinned package that is not installed, or whose file cannot be read, is not stale', async () => {
  const files = { [`${VOICE}/package.json`]: JSON.stringify({ dependencies: { phonemizer: '1.2.1' }, overrides: { 'fast-uri': '3.1.9', 'global-agent': { nested: '^1.0.0' } } }) };
  const exists = (p) => p === `${VOICE}/node_modules/phonemizer`;
  assert.deepEqual((await diagnose([kokoro()], ctx({ exists, readFile: jsonFiles(files) }))).missing, []);
});

test('offline: a failed npm ci reports that command and runs nothing else', async () => {
  const ran = [];
  const res = await runFixes(['kokoro'], [kokoro()], ctx({ platform: 'linux' }), (c, a) => { ran.push([c, ...a].join(' ')); return { status: 1 }; });
  assert.deepEqual(ran, [`npm ci --ignore-scripts --prefix ${VOICE}`]);
  assert.equal(res[0].ok, false);
  assert.equal(res[0].manual, `npm ci --ignore-scripts --prefix ${VOICE}`);
});

test('win32: one npm ci with the backslash folder quoted', async () => {
  const skillDir = 'C:\\Users\\a b\\make-motion';
  const r = await diagnose([kokoro()], ctx({ platform: 'win32', skillDir }));
  assert.equal(r.missing[0].fix.auto, 'npm ci --ignore-scripts --prefix "C:\\Users\\a b\\make-motion\\optional\\voice"');
  const installed = 'C:\\Users\\a b\\make-motion\\optional\\voice\\node_modules\\phonemizer';
  assert.deepEqual((await diagnose([kokoro()], ctx({ platform: 'win32', skillDir, exists: (p) => p === installed }))).missing, []);
});

test('--fix kokoro,cutout runs one npm ci per folder, after node_modules', async () => {
  const ran = [];
  const reqs = [cutout(), kokoro(), nodeModules()];
  const res = await runFixes(['kokoro', 'cutout', 'node_modules'], reqs, ctx({ platform: 'linux', exists: () => ran.length > 0 }), (c, a) => { ran.push([c, ...a].join(' ')); return { status: 0 }; });
  assert.deepEqual(res.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(ran, ['npm ci --ignore-scripts --omit=dev --prefix /s/make-motion', `npm ci --ignore-scripts --prefix ${VOICE}`, `npm ci --ignore-scripts --prefix ${CUT}`]);
});

test('the make-motion node_modules reinstall names no optional install', async () => {
  const stale = { '/s/x/package.json': JSON.stringify({ overrides: { 'fast-uri': '3.1.9' } }), '/s/x/package-lock.json': LOCK, '/s/x/node_modules/fast-uri/package.json': JSON.stringify({ version: '3.1.8' }) };
  const r = await diagnose([nodeModules({ omitDev: false })], ctx({ exists: () => true, readFile: jsonFiles(stale), skillDir: '/s/x' }));
  assert.equal(r.missing[0].id, 'node_modules', 'the stale install is still reported');
  assert.equal(r.missing[0].notes, undefined);
});

// --- PA-14: an unknown --fix id lists the ids that exist ---

test('PA-14: an unknown --fix id keeps refused "unknown id" and lists the accepted ids, in JSON and in text', async () => {
  const res = await runFixes(['nope'], [nodeVersion(20), kokoro()], ctx(), () => assert.fail('must not run'));
  assert.equal(res[0].refused, 'unknown id');
  assert.deepEqual(res[0].accepted, ['node', 'kokoro']);
  const json = await runMain(['--fix', 'nope', '--json'], mainOpts());
  assert.deepEqual(JSON.parse(json.out)[0].accepted, ['node', 'kokoro']);
  const text = await runMain(['--fix', 'nope'], mainOpts());
  assert.match(text.out, /^refused: nope — unknown id \(accepted ids: node, kokoro\)/m);
  assert.equal(text.code, 1);
  const known = await runFixes(['kokoro'], [kokoro()], ctx({ exists: () => true }), () => ({ status: 0 }));
  assert.equal('accepted' in known[0], false, 'only a refused unknown id carries the list');
});

// --- G-66: a stale install is "stale", not "missing", and a dev checkout keeps its dev packages ---

const STALE_FILES = (dir) => ({
  [`${dir}/package.json`]: JSON.stringify({ overrides: { 'fast-uri': '3.1.9' } }),
  [`${dir}/package-lock.json`]: LOCK,
  [`${dir}/node_modules/fast-uri/package.json`]: JSON.stringify({ version: '3.1.8' }),
});
const reader = (files) => (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };

test('G-66: a stale install is reported as stale (older than the pinned override), still required, still exit 1', async () => {
  const readFile = reader(STALE_FILES('/s/make-motion'));
  const c = ctx({ exists: noPlaywright, readFile });
  const r = await diagnose([nodeModules()], c);
  assert.deepEqual(r.missing[0].stale, ['fast-uri']);
  assert.equal(r.missing[0].required, true);
  const text = await runMain([], mainOpts({ requirementsFor: () => [nodeModules()] }), { ctx: c });
  assert.match(text.out, /^stale \(older than the pinned fast-uri override\) \(required\): node_modules — /m);
  assert.doesNotMatch(text.out, /missing \(required\)/);
  assert.equal(text.code, 1, 'a stale security pin stays a failure');
  const json = JSON.parse((await runMain(['--json'], mainOpts({ requirementsFor: () => [nodeModules()] }), { ctx: c })).out);
  assert.deepEqual(json.missing[0].stale, ['fast-uri']);
  assert.equal(json.ok, false);
});

test('G-66: a node_modules that is truly absent is still "missing", and carries no stale marker', async () => {
  const r = await diagnose([nodeModules()], ctx());
  assert.equal('stale' in r.missing[0], false);
  const text = await runMain([], mainOpts({ requirementsFor: () => [nodeModules()] }));
  assert.match(text.out, /^missing \(required\): node_modules — /m);
  assert.doesNotMatch(text.out, /stale/);
});

test('G-66: keep dev packages when node_modules/playwright exists, at the skill and at a sister skill', async () => {
  const readFile = reader(STALE_FILES('/s/make-diagram'));
  const dev = (await diagnose([nodeModules()], ctx({ skillDir: '/s/make-diagram', exists: () => true, readFile }))).missing[0];
  assert.equal(dev.fix.auto, 'npm ci --ignore-scripts --prefix /s/make-diagram', 'no --omit=dev: it would delete the playwright that check.mjs uses');
  assert.doesNotMatch(dev.notes ?? '', /removes the dev packages/);
  const prod = (await diagnose([nodeModules()], ctx({ skillDir: '/s/make-diagram', exists: noPlaywright, readFile }))).missing[0];
  assert.equal(prod.fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /s/make-diagram');
  const fresh = (await diagnose([nodeModules()], ctx({ skillDir: '/s/make-diagram' }))).missing[0];
  assert.equal(fresh.fix.auto, 'npm ci --ignore-scripts --omit=dev --prefix /s/make-diagram', 'a first install stays production-only');

  const dir = '/p/.agents/skills/make-diagram';
  const sisterFiles = reader(STALE_FILES(dir));
  const base = { skillDir: '/p/.agents/skills/make-explainer', cwd: '/p', homedir: '/h', readFile: sisterFiles };
  const withDev = (await diagnose([sisterSkill('make-diagram')], ctx({ ...base, exists: () => true }))).missing[0];
  assert.equal(withDev.fix.auto, `npm ci --ignore-scripts --prefix ${dir}`);
  assert.match(withDev.notes, /keeps its dev packages/);
  assert.deepEqual(withDev.stale, ['fast-uri']);
  assert.match(withDev.why, /predate the patched fast-uri/);
  const text = await runMain([], { ...mainOpts(), requirementsFor: () => [sisterSkill('make-diagram')] }, { ctx: ctx({ ...base, exists: () => true }) });
  assert.match(text.out, /^stale \(older than the pinned fast-uri override\) \(required\): make-diagram — /m);
});

test('G-66: an explicit --fix node_modules on a dev checkout does not strip playwright either', async () => {
  const ran = [];
  await runFixes(['node_modules'], [nodeModules()], ctx({ exists: () => true }), (c, a) => { ran.push([c, ...a].join(' ')); return { status: 0 }; });
  assert.deepEqual(ran, ['npm ci --ignore-scripts --prefix /s/make-motion']);
});

// --- PA-11: sizes are per skill and measured ---

test('PA-11: node_modules and sister sizes come from a per-skill table, not one fixed 30-60 MB', async () => {
  const size = async (skill) => (await diagnose([nodeModules()], ctx({ skillDir: `/s/${skill}` }))).missing[0].size;
  assert.equal(await size('make-explainer'), '≈3 MB');
  assert.equal(await size('make-diagram'), '≈11 MB');
  assert.equal(await size('make-dashboard'), '≈150 MB');
  assert.equal(await size('make-motion'), '≈58 MB');
  assert.equal(await size('make-scene'), '≈3 MB');
  assert.match(await size('make-future'), /depending on the skill/, 'an unknown skill gets an honest range');
  const own = (await diagnose([nodeModules({ size: '≈1 MB' })], ctx())).missing[0].size;
  assert.equal(own, '≈1 MB', 'an explicit size wins');
  const sister = async (name, opts) => (await diagnose([sisterSkill(name, opts)], ctx({ skillDir: '/p/.agents/skills/make-explainer', homedir: '/h' }))).missing[0].size;
  assert.equal(await sister('make-dashboard'), '≈150 MB');
  assert.equal(await sister('make-diagram'), '≈11 MB');
  assert.equal(await sister('make-diagram', { size: '≈2 MB' }), '≈2 MB');
});

test('PA-11: kokoro states the measured size of its own locked folder, and the old 250 MB, 440 MB and 30-60 MB figures are gone', async () => {
  const { missing } = await diagnose([kokoro()], ctx());
  assert.match(missing[0].size, /^≈227 MB/);
  assert.match(missing[0].size, /93 MB model/);
  assert.doesNotMatch(JSON.stringify(missing), /250 MB|440 MB/);
  assert.doesNotMatch(JSON.stringify(missing), /30–60 MB/);
});

// --- PA-10: the install hints a script prints are the doctor's own step ---
// (Merge note: main's form was `npm install <pin> --no-save` plus ffmpeg-static; this branch installs each optional stack
// with npm ci into its own locked folder and dropped ffmpeg-static, so the hint is optionalInstallArgv.)

test('PA-10: the optional install hint is exactly the step the doctor runs, and installing one stack never touches the other', async () => {
  const { render } = await import('../doctor.mjs');
  // The other stack is installed in its own folder: the step names only this one's folder.
  const other = { kokoro: '/optional/cutout/node_modules/onnxruntime-node', cutout: '/optional/voice/node_modules/phonemizer' };
  for (const [id, req] of [['kokoro', kokoro()], ['cutout', cutout()]]) {
    const c = ctx({ platform: 'linux', exists: (p) => p.endsWith(other[id]) });
    const doctorSays = (await diagnose([req], c)).missing[0].fix.auto;
    assert.equal(render([optionalInstallArgv(c, id)], 'linux'), doctorSays);
    assert.equal(doctorSays, `npm ci --ignore-scripts --prefix /s/make-motion/optional/${OPTIONAL[id].dir}`);
    assert.doesNotMatch(doctorSays, /--no-save|npm install/);
  }
  assert.throws(() => optionalInstallArgv(ctx(), 'ffmpeg-static'), /unknown optional install "ffmpeg-static"; known: kokoro, cutout/);
  assert.throws(() => optionalInstallArgv(ctx(), 'nope'), /unknown optional install "nope"/);
});

// --- PA-09: a stable cache dir, and a list of older plugin-cache copies (printed, never removed) ---

test('PA-09: stableCacheDir is CLAUDE_PLUGIN_DATA, else the OS cache dir, else <skill>/.cache', async () => {
  const { stableCacheDir } = await import('../doctor.mjs');
  const base = { skillDir: '/s/make-motion', homedir: '/home/u' };
  assert.equal(stableCacheDir({ ...base, env: { CLAUDE_PLUGIN_DATA: '/data/pa' }, platform: 'linux' }), '/data/pa');
  assert.equal(stableCacheDir({ ...base, env: { CLAUDE_PLUGIN_DATA: '' }, platform: 'darwin' }), '/home/u/Library/Caches/portable-artifacts');
  assert.equal(stableCacheDir({ ...base, env: {}, platform: 'linux' }), '/home/u/.cache/portable-artifacts');
  assert.equal(stableCacheDir({ ...base, env: { XDG_CACHE_HOME: '/xdg' }, platform: 'linux' }), '/xdg/portable-artifacts');
  assert.equal(stableCacheDir({ ...base, env: { XDG_CACHE_HOME: 'relative' }, platform: 'linux' }), '/home/u/.cache/portable-artifacts', 'a relative XDG_CACHE_HOME is ignored');
  assert.equal(stableCacheDir({ skillDir: 'C:\\s\\make-motion', homedir: 'C:\\Users\\u', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, platform: 'win32' }), 'C:\\Users\\u\\AppData\\Local\\portable-artifacts\\Cache');
  assert.equal(stableCacheDir({ skillDir: '/s/make-motion', homedir: '', env: {}, platform: 'linux' }), '/s/make-motion/.cache', 'no home to anchor an OS dir: the old location');
});

const CACHE_HOME = '/h';
const CACHE = `${CACHE_HOME}/.claude/plugins/cache/mkt/portable-artifacts`;
const MB = 1e6;
const cacheCtx = (version, over = {}) => ctx({
  skillDir: `${CACHE}/${version}/skills/make-motion`,
  homedir: CACHE_HOME,
  exists: () => true,
  readdir: () => ['0.8.0', '1.0.0', '1.1.0', '1.2.0', '1.3.0', 'latest', '.DS_Store'],
  dirSize: (p) => ({ [`${CACHE}/0.8.0`]: 57 * MB, [`${CACHE}/1.0.0`]: 565 * MB, [`${CACHE}/1.1.0`]: 715 * MB })[p] ?? 1,
  ...over,
});

test('PA-09: olderPluginCopies lists only older semver copies of this plugin, with sizes', async () => {
  const { olderPluginCopies } = await import('../doctor.mjs');
  assert.deepEqual(olderPluginCopies(cacheCtx('1.2.0')), [
    { version: '0.8.0', path: `${CACHE}/0.8.0`, bytes: 57 * MB },
    { version: '1.0.0', path: `${CACHE}/1.0.0`, bytes: 565 * MB },
    { version: '1.1.0', path: `${CACHE}/1.1.0`, bytes: 715 * MB },
  ]);
  assert.deepEqual(olderPluginCopies(cacheCtx('1.0.0')).map((c) => c.version), ['0.8.0'], 'a newer copy is never listed as removable');
  assert.deepEqual(olderPluginCopies(cacheCtx('0.8.0')), []);
});

test('PA-09: olderPluginCopies is empty outside the plugin cache and when the folder cannot be read', async () => {
  const { olderPluginCopies } = await import('../doctor.mjs');
  assert.deepEqual(olderPluginCopies(cacheCtx('1.2.0', { skillDir: '/repo/plugins/portable-artifacts/skills/make-motion' })), []);
  assert.deepEqual(olderPluginCopies(cacheCtx('1.2.0', { readdir: () => { throw new Error('EACCES'); } })), []);
  assert.deepEqual(olderPluginCopies(ctx({ skillDir: '/repo/x' })), [], 'a ctx with no readdir is fine');
});

test('PA-09: doctor prints the older copies with sizes and an rm line for the user, and runs nothing', async () => {
  const run = (c) => assert.fail(`must not run ${c}`);
  const text = await runMain([], mainOpts({ requirementsFor: () => [nodeVersion(1)] }), { ctx: cacheCtx('1.2.0'), run });
  assert.equal(text.code, 0, 'old copies are a note, not a failure');
  assert.match(text.out, /^ok: everything make-motion needs is installed$/m);
  assert.match(text.out, /Note: older copies of this plugin sit in the plugin cache: 0\.8\.0 \(57 MB\), 1\.0\.0 \(565 MB\), 1\.1\.0 \(715 MB\)\. To free about 1\.3 GB, run: rm -rf \/h\/\.claude\/plugins\/cache\/mkt\/portable-artifacts\/0\.8\.0 /);
  const json = JSON.parse((await runMain(['--json'], mainOpts({ requirementsFor: () => [nodeVersion(1)] }), { ctx: cacheCtx('1.2.0'), run })).out);
  assert.equal(json.ok, true);
  assert.equal(json.olderCopies.length, 3);
  const none = JSON.parse((await runMain(['--json'], mainOpts({ requirementsFor: () => [nodeVersion(1)] }), { ctx: ctx() })).out);
  assert.deepEqual(none, { ok: true, missing: [] }, 'no older copies: the JSON is unchanged');
});

// Failure paths of the cloud icon allow-list, the importer and the read-time guard (Task 21 fix round 1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'md-cloud-hard-')));
process.env.MAKE_DIAGRAM_ICON_DIR = path.join(ROOT_DIR, 'none');
after(() => {
  for (const f of LOCKED) { try { fs.chmodSync(f, 0o700); } catch { /* already gone */ } }
  fs.rmSync(ROOT_DIR, { recursive: true, force: true });
});
const LOCKED = [];

const { iconSvg, hasIcon, searchIcons, listIcons, importedIcons, iconDir, IconError, forgetImported, isCloudName } = await import('../scripts/lib/icons.mjs');
const { sanitizeSvg } = await import('../scripts/lib/svg-safe.mjs');
const { importIcons, ImportError } = await import('../scripts/lib/icon-import.mjs');
const { buildDiagram } = await import('../scripts/lib/api.mjs');
const { validateSpec } = await import('../scripts/lib/spec.mjs');

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const AWS_FIXTURE = path.join(SKILL, 'test/fixtures/cloud-import/aws');
const ICONS_CLI = path.join(SKILL, 'scripts/icons.mjs');
const cloud = JSON.parse(fs.readFileSync(path.join(SKILL, 'icons/cloud.json'), 'utf8'));

let counter = 0;
const tempDir = (label) => {
  const dir = path.join(ROOT_DIR, `${label}-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const wrap = (inner, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const SHAPE = '<rect width="24" height="24" fill="#123456"/>';
const run = (args, env = {}, cwd) => spawnSync(process.execPath, [ICONS_CLI, ...args], { encoding: 'utf8', cwd, env: { ...process.env, ...env } });
const archSpec = (nodes) => ({ title: 'Cloud', type: 'architecture', nodes, edges: [] });

async function withIconDir(dir, fn) {
  const before = process.env.MAKE_DIAGRAM_ICON_DIR;
  process.env.MAKE_DIAGRAM_ICON_DIR = dir;
  try {
    return await fn();
  } finally {
    process.env.MAKE_DIAGRAM_ICON_DIR = before;
  }
}

// ---- 1, 5, 15: reference chains and cycles -------------------------------------------------------

function forwardUseChain(pairs) {
  let body = '';
  for (let i = 0; i < pairs; i++) body += `<g id="g${i}"><use href="#g${i + 1}"/></g>`;
  return wrap(`${body}<rect id="g${pairs}" width="1" height="1"/><use href="#g0"/>`);
}

test('a forward <use> chain of 1990 pairs is refused, and sanitizeSvg does not throw', () => {
  const result = sanitizeSvg(forwardUseChain(1990));
  assert.equal(typeof result.skipped, 'string');
  assert.match(result.skipped, /too deep|too many|nested/);
});

test('a forward <use> chain inside an import is skipped and reported, and the other file still imports', () => {
  const folder = tempDir('chain');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Fine_64.svg'), wrap(SHAPE));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Chain_64.svg'), forwardUseChain(1990));
  const { added, skipped } = importIcons('aws', folder, tempDir('out'));
  assert.deepEqual(added, ['aws-fine']);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].file, /Chain/);
});

function doublingChain(element, attr) {
  let body = `<${element} id="n0"><rect width="1" height="1"/></${element}>`;
  for (let i = 1; i <= 30; i++) body += `<${element} id="n${i}"><rect ${attr}="url(#n${i - 1})" width="1" height="1"/><rect ${attr}="url(#n${i - 1})" width="1" height="1"/></${element}>`;
  return wrap(`${body}<rect ${attr}="url(#n30)" width="24" height="24"/>`);
}

const CYCLES = {
  'a 30-level doubling chain of masks': doublingChain('mask', 'mask'),
  'a 30-level doubling chain of clip paths': doublingChain('clipPath', 'clip-path'),
  'a mask that masks itself': wrap('<mask id="m" mask="url(#m)"><rect width="1" height="1"/></mask><rect width="24" height="24" mask="url(#m)"/>'),
  'a mask whose content uses the mask': wrap('<mask id="m"><rect width="1" height="1" mask="url(#m)"/></mask><rect width="24" height="24" mask="url(#m)"/>'),
  'a gradient that refers to itself': wrap('<linearGradient id="g" href="#g"/><rect width="24" height="24" fill="url(#g)"/>'),
  'two gradients that refer to each other': wrap('<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/><rect width="24" height="24" fill="url(#a)"/>'),
  'a clip path inside a use inside itself': wrap('<clipPath id="c"><use href="#s"/></clipPath><rect id="s" width="1" height="1" clip-path="url(#c)"/><rect width="24" height="24" clip-path="url(#c)"/>'),
};
for (const [what, input] of Object.entries(CYCLES)) {
  test(`sanitizeSvg refuses ${what} without throwing`, () => {
    assert.equal(typeof sanitizeSvg(input).skipped, 'string');
  });
}

// ---- 15: more hostile inputs -------------------------------------------------------------------

const MORE_HOSTILE = {
  'a prefixed script element (svg:script)': wrap(`${SHAPE}<svg:script>alert(1)</svg:script>`),
  'an upper-case HREF attribute': wrap(`<use HREF="http://example.com/a.svg#x"/>${SHAPE}`),
  'an upper-case ONCLICK attribute': wrap('<rect width="24" height="24" ONCLICK="alert(1)"/>'),
  'a javascript: href spelt with a character reference': wrap(`<use href="&#106;avascript:alert(1)"/>${SHAPE}`),
  'a url( spelt with a hex reference': wrap('<rect width="24" height="24" fill="&#x75;rl(http://example.com/a.svg#g)"/>'),
  'a transform with a script': wrap('<rect width="24" height="24" transform="translate(1) <script>"/>'),
  'a style property that is not paint (transform)': wrap('<rect width="24" height="24" style="transform:translate(1 1)"/>'),
  'a style property that is not paint (x)': wrap('<rect width="24" height="24" style="x:5"/>'),
  'a style property that is not paint (d)': wrap('<path style="d:path(\'M0 0\')"/>'),
  'a style property that is not paint (id)': wrap('<rect width="24" height="24" style="id:foo"/>'),
};
for (const [what, input] of Object.entries(MORE_HOSTILE)) {
  test(`sanitizeSvg refuses ${what}`, () => {
    assert.equal(typeof sanitizeSvg(input).skipped, 'string');
  });
}

test('a script inside <title> is dropped with the title and never reaches the output', () => {
  const result = sanitizeSvg(wrap(`<title><script>alert(1)</script></title>${SHAPE}`));
  assert.equal(result.markup, SHAPE);
});

test('sanitizeSvg never throws, whatever it is given', () => {
  for (const input of [undefined, null, 42, {}, '', '<', '<svg', wrap('<g'.repeat(5000)), `<svg viewBox="0 0 1 1">${'<g>'.repeat(40)}`, '\u0000', wrap('<path d="M0 0"').repeat(3)]) {
    const result = sanitizeSvg(input);
    assert.equal(typeof result.skipped, 'string', String(input).slice(0, 30));
  }
});

test('a reason never echoes more than a short piece of hostile input', () => {
  const long = 'x'.repeat(200000);
  for (const input of [
    wrap(`<rect width="1" height="1" fill="url(#${long})"/>`),
    wrap(`<${long}/>`),
    wrap(`<rect ${long}="1"/>`),
    wrap(`<rect id="${long}" width="1" height="1"/>`),
    wrap(`<use href="#${long}"/>`),
  ]) {
    const result = sanitizeSvg(input);
    assert.equal(typeof result.skipped, 'string');
    assert.ok(result.skipped.length < 200, `${result.skipped.length} characters`);
  }
});

test('cloud lookups of names that exist on Object.prototype are plain misses', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(hasIcon(`cloud:${name}`), false, name);
    assert.throws(() => iconSvg(`cloud:${name}`), IconError, name);
  }
});

// ---- 2: file system failures --------------------------------------------------------------------

const canLock = () => process.platform !== 'win32' && process.getuid?.() !== 0;

test('an unreadable file and an unreadable folder are skipped and reported; the rest imports', (t) => {
  if (!canLock()) { t.skip('cannot make a file unreadable here (root or Windows)'); return; }
  const folder = tempDir('locked');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Fine_64.svg'), wrap(SHAPE));
  const lockedFile = path.join(folder, 'Arch_A/64/Arch_Amazon-Locked_64.svg');
  write(lockedFile, wrap(SHAPE));
  const lockedDir = path.join(folder, 'Arch_B');
  write(path.join(lockedDir, '64/Arch_Amazon-Hidden_64.svg'), wrap(SHAPE));
  fs.chmodSync(lockedFile, 0o000);
  fs.chmodSync(lockedDir, 0o000);
  LOCKED.push(lockedFile, lockedDir);
  const { added, skipped } = importIcons('aws', folder, tempDir('out'));
  assert.deepEqual(added, ['aws-fine']);
  assert.ok(skipped.some((s) => /Locked/.test(s.file) && /cannot read file \(EACCES\)/.test(s.reason)), JSON.stringify(skipped));
  assert.ok(skipped.some((s) => /Arch_B$/.test(s.file) && /cannot read folder \(EACCES\)/.test(s.reason)), JSON.stringify(skipped));
});

test('a symlink loop is reported and ends', () => {
  const folder = tempDir('loop');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Fine_64.svg'), wrap(SHAPE));
  fs.symlinkSync(folder, path.join(folder, 'Arch_A/up'));
  const { added, skipped } = importIcons('aws', folder, tempDir('out'));
  assert.deepEqual(added, ['aws-fine']);
  assert.equal(skipped.filter((s) => /symlink/.test(s.reason)).length, 1);
});

test('a target that is a file, or sits under one, is an ImportError, not an uncaught one', () => {
  const file = path.join(tempDir('target'), 'plain-file');
  fs.writeFileSync(file, 'x');
  assert.throws(() => importIcons('aws', AWS_FIXTURE, file), (e) => e instanceof ImportError && /cannot create the icon folder/.test(e.message));
  assert.throws(() => importIcons('aws', AWS_FIXTURE, path.join(file, 'below')), (e) => e instanceof ImportError && /cannot create the icon folder/.test(e.message));
  const r = run(['import', 'aws', AWS_FIXTURE], { MAKE_DIAGRAM_ICON_DIR: file });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('the temp file is not at a predictable path, and is never written through a symlink', () => {
  const out = tempDir('tmp');
  const victim = path.join(tempDir('victim'), 'victim.txt');
  fs.writeFileSync(victim, 'keep me');
  fs.symlinkSync(victim, path.join(out, `.imported-aws.json.${process.pid}.tmp`));
  importIcons('aws', AWS_FIXTURE, out);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me');
  assert.ok(Object.hasOwn(importedIcons(out), 'aws-lambda'));
  assert.deepEqual(fs.readdirSync(out).filter((f) => f.startsWith('.imported-aws.json.') && !f.includes(String(process.pid))), []);
});

// ---- 4: what import adds must resolve --------------------------------------------------------------

const bigPath = (bytes) => `M0 0${' L1 1'.repeat(Math.floor(bytes / 5))}`;

function limitFiles(folder) {
  // Files whose output sits at a cap: size, nesting depth and element count, with and without a root paint attribute.
  const put = (name, text) => write(path.join(folder, `Arch_A/64/Arch_Amazon-${name}_64.svg`), text);
  put('Nearcap', `<svg viewBox="0 0 24 24"><path d="${bigPath(262144 - 80)}"/></svg>`);
  put('Overcap', `<svg viewBox="0 0 24 24"><path d="${bigPath(262144)}"/></svg>`);
  for (const depth of [13, 14, 15, 16, 17]) put(`Deep${depth}`, `<svg viewBox="0 0 24 24" fill="#fff">${'<g>'.repeat(depth)}<rect width="1" height="1"/>${'</g>'.repeat(depth)}</svg>`);
  for (const count of [3996, 3997, 3998, 3999, 4000]) put(`Many${count}`, `<svg viewBox="0 0 24 24" fill="#fff">${'<rect width="1" height="1"/>'.repeat(count - 1)}</svg>`);
}

test('every name an import reports as added resolves afterwards, also at the size, depth and element caps', async () => {
  const folder = tempDir('caps');
  limitFiles(folder);
  const out = tempDir('out');
  const { added, skipped } = importIcons('aws', folder, out);
  assert.ok(added.length >= 3, `added ${added.join(',')}; skipped ${JSON.stringify(skipped)}`);
  await withIconDir(out, () => {
    for (const name of added) {
      assert.equal(hasIcon(`cloud:${name}`), true, `${name} was added but does not resolve`);
      assert.doesNotThrow(() => iconSvg(`cloud:${name}`), name);
    }
  });
  for (const s of skipped) assert.ok(s.reason.length > 0);
});

// ---- 3: a damaged cache file leaves bundled icons alone -----------------------------------------------

function corruptDir(content = '{not json') {
  const dir = tempDir('corrupt');
  fs.writeFileSync(path.join(dir, 'imported-aws.json'), content);
  return dir;
}

test('with a corrupt imported-aws.json, bundled lookups, validation and builds all work', async () => {
  const dir = corruptDir();
  await withIconDir(dir, async () => {
    assert.equal(hasIcon('cloud:aws-lambda'), true);
    assert.equal(iconSvg('cloud:aws-lambda').markup, cloud.icons['aws-lambda'].markup);
    const spec = archSpec([{ id: 'a', label: 'Fn', icon: 'cloud:aws-lambda' }]);
    assert.deepEqual((await validateSpec(spec)).errors, []);
    assert.match((await buildDiagram(spec)).svg, /pa-icon-cloud/);
  });
});

test('with a corrupt imported-aws.json, an imported-only ref gets an error naming the file, and hasIcon stays a predicate', async () => {
  const dir = corruptDir();
  await withIconDir(dir, async () => {
    assert.equal(hasIcon('cloud:aws-simple-storage-service'), false);
    assert.throws(() => iconSvg('cloud:aws-simple-storage-service'), (e) => e instanceof IconError && e.message.includes(path.join(dir, 'imported-aws.json')) && /import/.test(e.message));
    const result = await validateSpec(archSpec([{ id: 'a', label: 'Bucket', icon: 'cloud:aws-simple-storage-service' }]));
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].message.includes('imported-aws.json'));
  });
});

test('with a corrupt imported-aws.json, search and list warn on stderr and carry on with bundled icons', () => {
  const dir = corruptDir();
  const env = { MAKE_DIAGRAM_ICON_DIR: dir };
  const search = run(['search', 'database'], env);
  assert.equal(search.status, 0, search.stderr);
  assert.match(search.stdout, /lucide:database/);
  assert.match(search.stderr, /warning: .*imported-aws\.json/);
  assert.doesNotMatch(search.stderr, /\n\s+at /);
  const cloudSearch = run(['search', 'lambda'], env);
  assert.match(cloudSearch.stdout, /cloud:aws-lambda/);
  const list = run(['list'], env);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.split('\n').includes('cloud:aws-lambda'));
  assert.match(list.stderr, /warning: .*imported-aws\.json/);
  const listCloud = run(['list', 'cloud'], env);
  assert.equal(listCloud.status, 0);
  assert.equal(listCloud.stdout.trim().split('\n').length, Object.keys(cloud.icons).length);
});

test('a catalog whose icons are not an object holds no icons, and leaves bundled ones alone', async () => {
  for (const content of ['[]', '"text"', '{"icons":[1,2]}', '{"icons":"abc"}', 'null']) {
    const dir = corruptDir(content);
    await withIconDir(dir, () => {
      assert.deepEqual(importedIcons(dir), {}, content);
      assert.equal(iconSvg('cloud:aws-lambda').kind, 'cloud');
    });
  }
});

test('with no usable home folder, a relative override or an empty HOME is an error, never a relative folder', () => {
  const cwd = tempDir('cwd');
  const empty = run(['import', 'aws', AWS_FIXTURE], { HOME: '', MAKE_DIAGRAM_ICON_DIR: '' }, cwd);
  assert.equal(empty.status, 2, empty.stdout + empty.stderr);
  assert.match(empty.stderr, /MAKE_DIAGRAM_ICON_DIR/);
  assert.deepEqual(fs.readdirSync(cwd), [], 'nothing was written under the working folder');
  const relative = run(['import', 'aws', AWS_FIXTURE], { MAKE_DIAGRAM_ICON_DIR: 'relative/icons' }, cwd);
  assert.equal(relative.status, 2);
  assert.match(relative.stderr, /absolute/);
  assert.deepEqual(fs.readdirSync(cwd), []);
  assert.doesNotMatch(empty.stderr + relative.stderr, /\n\s+at /);
});

test('iconDir is absolute', () => {
  assert.ok(path.isAbsolute(iconDir()));
});

// ---- 6: the read-time guard ----------------------------------------------------------------------

const GOOD_ENTRY = { viewBox: '0 0 24 24', markup: SHAPE };
const entryText = (entry) => JSON.stringify(entry);

function hostileCatalog() {
  return `{"provider":"aws","icons":{
"aws-good":${entryText(GOOD_ENTRY)},
"aws-script":${entryText({ viewBox: '0 0 24 24', markup: `<script>alert(1)</script>${SHAPE}` })},
"aws-breakout":${entryText({ viewBox: '0 0 24 24', markup: `${SHAPE}</svg><script>alert(1)</script><svg>` })},
"aws-comment":${entryText({ viewBox: '0 0 24 24', markup: `<!-- x -->${SHAPE}` })},
"aws-handler":${entryText({ viewBox: '0 0 24 24', markup: '<rect width="24" height="24" onclick="alert(1)"/>' })},
"aws-viewbox":${entryText({ viewBox: '0 0 24 24" onload="alert(1)', markup: SHAPE })},
"aws-viewbox-lt":${entryText({ viewBox: '0 0 24 24"><script>alert(1)</script><svg viewBox="0 0 1 1', markup: SHAPE })},
"aws-extra":${entryText({ viewBox: '0 0 24 24', markup: SHAPE, extra: '<script>' })},
"aws-nonstring":${entryText({ viewBox: 24, markup: { x: 1 } })},
"aws-unscoped":${entryText({ viewBox: '0 0 24 24', markup: '<rect width="24" height="24" fill="url(#gone)"/>' })},
"__proto__":${entryText(GOOD_ENTRY)},
"constructor":${entryText(GOOD_ENTRY)},
"../../evil":${entryText(GOOD_ENTRY)},
"AWS-Upper":${entryText(GOOD_ENTRY)},
"${'a'.repeat(100)}":${entryText(GOOD_ENTRY)}
}}`;
}

test('the read-time guard keeps only entries the allow-list returns unchanged', () => {
  const dir = tempDir('hostile');
  fs.writeFileSync(path.join(dir, 'imported-aws.json'), hostileCatalog());
  const icons = importedIcons(dir);
  assert.deepEqual(Object.keys(icons), ['aws-good']);
  assert.deepEqual(icons['aws-good'], GOOD_ENTRY);
  assert.equal(Object.getPrototypeOf(icons), Object.prototype);
  assert.equal({}.viewBox, undefined);
  assert.equal({}.markup, undefined);
});

test('a hostile catalog never reaches a drawn diagram', async () => {
  const dir = tempDir('hostile-draw');
  fs.writeFileSync(path.join(dir, 'imported-aws.json'), hostileCatalog());
  await withIconDir(dir, async () => {
    assert.equal(hasIcon('cloud:aws-good'), true);
    for (const name of ['aws-script', 'aws-breakout', 'aws-comment', 'aws-viewbox', 'aws-extra', '__proto__', '../../evil']) {
      assert.equal(hasIcon(`cloud:${name}`), false, name);
      assert.throws(() => iconSvg(`cloud:${name}`), IconError, name);
    }
    assert.ok(listIcons('cloud').includes('cloud:aws-good'));
    assert.ok(!listIcons('cloud').some((r) => /script|breakout|evil|proto/.test(r)));
    assert.ok(searchIcons('good').includes('cloud:aws-good'));
    const { svg } = await buildDiagram(archSpec([{ id: 'a', label: 'Good', icon: 'cloud:aws-good' }]));
    assert.doesNotMatch(svg, /script|onclick|onload/);
  });
});

test('a corrupt file is reported by name, a huge one is refused unread', async () => {
  const dir = tempDir('huge');
  const file = path.join(dir, 'imported-aws.json');
  fs.writeFileSync(file, `{"icons":{"aws-good":${entryText(GOOD_ENTRY)}}}`);
  fs.truncateSync(file, 70 * 1024 * 1024); // sparse: cheap to make, over the 64 MiB limit
  await withIconDir(dir, () => {
    assert.throws(() => importedIcons(dir), (e) => e instanceof IconError && e.message.includes(file) && /too large|over/.test(e.message));
    assert.equal(iconSvg('cloud:aws-lambda').kind, 'cloud');
  });
});

// ---- 7: what the CLI prints ----------------------------------------------------------------------

test('the CLI never prints a raw file name or reason: no escape, no line break, bounded length', (t) => {
  const folder = tempDir('names');
  const nasty = `Arch_Amazon-Evil\u001b[31m\nadded 99: fake_64.svg`;
  try {
    write(path.join(folder, `Arch_A/64/${nasty}.svg`), wrap(`${SHAPE}<script>alert(1)</script>`));
  } catch {
    t.skip('this file system refuses the file name');
    return;
  }
  write(path.join(folder, `Arch_A/64/Arch_Amazon-${'long'.repeat(55)}_64.svg`), wrap(`${SHAPE}<script>alert(1)</script>`));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Url_64.svg'), wrap(`<rect width="1" height="1" fill="url(#${'x'.repeat(200000)})"/>`));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Fine_64.svg'), wrap(SHAPE));
  const r = run(['import', 'aws', folder], { MAKE_DIAGRAM_ICON_DIR: tempDir('out') });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\u001b/);
  for (const line of r.stdout.split('\n')) assert.ok(line.length <= 200, `${line.length} characters: ${line.slice(0, 80)}`);
  assert.equal(r.stdout.split('\n').filter((l) => /^added 99/.test(l)).length, 0, 'a file name cannot forge a report line');
  assert.match(r.stdout, /^added 1: aws-fine$/m);
  assert.match(r.stdout, /skipped 3:/);
});

// ---- 11, 13: nothing imported, size cap -------------------------------------------------------------

test('a folder where every icon is refused exits non-zero with a message, not "added 0"', () => {
  const folder = tempDir('allbad');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Evil_64.svg'), wrap(`${SHAPE}<script>alert(1)</script>`));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Styled_64.svg'), wrap(`<style>*{fill:red}</style>${SHAPE}`));
  const out = tempDir('out');
  const r = run(['import', 'aws', folder], { MAKE_DIAGRAM_ICON_DIR: out });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /added 0/);
  assert.match(r.stderr, /nothing was imported.*2 files? (were )?skipped/i);
  assert.deepEqual(fs.readdirSync(out), [], 'no catalog is written when nothing was added');
});

test('an import stops reading at a total size cap, and names it in what it skipped', () => {
  const folder = tempDir('total');
  for (let i = 0; i < 6; i++) write(path.join(folder, `Arch_A/64/Arch_Amazon-Item${String.fromCharCode(97 + i)}_64.svg`), wrap(`<path d="${bigPath(20000)}"/>`));
  const { added, skipped } = importIcons('aws', folder, tempDir('out'), { maxBytes: 70000 });
  assert.equal(added.length, 3);
  assert.equal(skipped.length, 3);
  assert.ok(skipped.every((s) => /import size limit \(\d+ KiB\)/.test(s.reason)), JSON.stringify(skipped));
});

// ---- round 2 ---------------------------------------------------------------------------------------

test('a 200,000-digit number in any numeric spot returns in under 2 s', () => {
  const digits = '1'.repeat(200000);
  const inputs = [
    `<svg width="${digits}x" height="1"><path d="M0 0"/></svg>`,
    `<svg width="1" height="${digits}px"><path d="M0 0"/></svg>`,
    `<svg viewBox="0 0 ${digits}x 1"><path d="M0 0"/></svg>`,
    wrap(`<rect width="${digits}x" height="1"/>`),
    wrap(`<rect width="1" height="1" opacity="${digits}x"/>`),
    wrap(`<rect width="1" height="1" stroke-width="${digits}x"/>`),
    wrap(`<linearGradient id="g"><stop offset="${digits}x" stop-color="#fff"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>`),
    wrap(`<rect width="1" height="1" fill="rgb(${digits}x)"/>`),
    wrap(`<rect width="1" height="1" transform="translate(${digits}x)"/>`),
    wrap(`<rect width="1" height="1" stroke-dasharray="${digits}x"/>`),
    wrap(`<polygon points="${digits}x"/>`),
  ];
  const started = Date.now();
  for (const input of inputs) assert.equal(typeof sanitizeSvg(input).skipped, 'string');
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
});

test('a # value is not a reference unless it is an href or inside url()', () => {
  const result = sanitizeSvg(wrap('<mask id="abc"><rect width="1" height="1" fill="#abc"/></mask><rect width="24" height="24" mask="url(#abc)" fill="#fff"/>'));
  assert.equal(result.skipped, undefined, result.skipped);
  assert.match(result.markup, /fill="#abc"/);
  assert.equal(typeof sanitizeSvg(wrap('<mask id="abc"><use href="#abc"/></mask><rect width="24" height="24" mask="url(#abc)"/>')).skipped, 'string', 'a real href cycle is still refused');
});

test('a viewBox or size outside a sane range is refused', () => {
  for (const viewBox of ['0 0 1e-300 1e-300', '0 0 0.001 1', '0 0 1 0.001', '0 0 100001 1', '0 0 1e999 1', '0 0 0 1', '0 0 -1 1']) {
    assert.match(sanitizeSvg(`<svg viewBox="${viewBox}"><path d="M0 0h1v1z"/></svg>`).skipped ?? '', /viewBox/, viewBox);
  }
  assert.equal(typeof sanitizeSvg('<svg width="0.000001" height="1"><path d="M0 0h1v1z"/></svg>').skipped, 'string');
  assert.equal(sanitizeSvg('<svg viewBox="0 0 0.5 100000"><path d="M0 0h1v1z"/></svg>').viewBox, '0 0 0.5 100000');
});

const catalogOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'imported-aws.json'), 'utf8'));

test('an import over a damaged catalog replaces it: icons as a string or array add no keys 0 and 1', () => {
  for (const icons of ['"abc"', '[1,2]', '42', 'null']) {
    const out = tempDir('stored');
    fs.writeFileSync(path.join(out, 'imported-aws.json'), `{"provider":"aws","icons":${icons}}`);
    importIcons('aws', AWS_FIXTURE, out);
    assert.deepEqual(Object.keys(catalogOf(out).icons), ['aws-lambda', 'aws-simple-storage-service'], icons);
  }
});

test('an import keeps only the stored entries that pass the guard, and ignores a catalog over the size limit', () => {
  const out = tempDir('stored-hostile');
  fs.writeFileSync(path.join(out, 'imported-aws.json'), hostileCatalog());
  importIcons('aws', AWS_FIXTURE, out);
  assert.deepEqual(Object.keys(catalogOf(out).icons), ['aws-good', 'aws-lambda', 'aws-simple-storage-service']);
  const huge = tempDir('stored-huge');
  const file = path.join(huge, 'imported-aws.json');
  fs.writeFileSync(file, `{"icons":{"aws-old":${entryText(GOOD_ENTRY)}}}`);
  fs.truncateSync(file, 70 * 1024 * 1024);
  importIcons('aws', AWS_FIXTURE, huge);
  assert.ok(fs.statSync(file).size < 100000, 'the oversize catalog was replaced, not read');
  assert.deepEqual(Object.keys(catalogOf(huge).icons), ['aws-lambda', 'aws-simple-storage-service']);
});

test('the name limit the importer reports is the one isCloudName applies', () => {
  const limit = 64;
  const name = (n) => `aws-${'a'.repeat(n - 4)}`;
  assert.equal(isCloudName(name(limit)), true);
  assert.equal(isCloudName(name(limit + 1)), false);
  assert.equal(isCloudName(`google-${'a'.repeat(limit - 7)}`), true);
  const folder = tempDir('names-limit');
  write(path.join(folder, `Arch_A/64/Arch_Amazon-${'a'.repeat(limit - 4)}_64.svg`), wrap(SHAPE));
  write(path.join(folder, `Arch_A/64/Arch_Amazon-${'b'.repeat(limit - 3)}_64.svg`), wrap(SHAPE));
  const out = tempDir('out');
  const { added, skipped } = importIcons('aws', folder, out);
  assert.deepEqual(added, [name(limit)]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /longer than 64 characters/);
});

test('a damaged catalog is parsed once, not on every lookup, and its warning has one semicolon', async () => {
  const dir = corruptDir();
  await withIconDir(dir, () => {
    assert.equal(hasIcon('cloud:aws-s3-nope'), false);
    fs.writeFileSync(path.join(dir, 'imported-aws.json'), `{"icons":{"aws-good":${entryText(GOOD_ENTRY)}}}`);
    assert.equal(hasIcon('cloud:aws-good'), false, 'the failure is remembered');
    forgetImported(dir);
    assert.equal(hasIcon('cloud:aws-good'), true, 'forgetting it reads the folder again');
  });
  const r = run(['search', 'lambda'], { MAKE_DIAGRAM_ICON_DIR: corruptDir() });
  const warning = r.stderr.split('\n').find((l) => l.startsWith('warning:'));
  assert.ok(warning, r.stderr);
  assert.ok((warning.match(/;/g) ?? []).length <= 1, warning);
});

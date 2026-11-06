import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Every test here reads and writes icons under a temp folder, never the real home folder.
const ROOT_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'md-cloud-')));
const EMPTY_DIR = path.join(ROOT_DIR, 'none');
process.env.MAKE_DIAGRAM_ICON_DIR = EMPTY_DIR;
after(() => fs.rmSync(ROOT_DIR, { recursive: true, force: true }));

const { iconSvg, hasIcon, searchIcons, listIcons, importedIcons, bundledCloudNames, IconError } = await import('../scripts/lib/icons.mjs');
const { sanitizeSvg, scopeIds } = await import('../scripts/lib/svg-safe.mjs');
const { importIcons, ImportError } = await import('../scripts/lib/icon-import.mjs');
const { iconGroup } = await import('../scripts/lib/svg.mjs');
const { diagramCss } = await import('../scripts/lib/render.mjs');
const { buildDiagram } = await import('../scripts/lib/api.mjs');
const { validateSpec } = await import('../scripts/lib/spec.mjs');

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(SKILL, 'test/fixtures/cloud-import');
const AWS_FIXTURE = path.join(FIXTURES, 'aws');
const GCP_FIXTURE = path.join(FIXTURES, 'gcp');
const ICONS_CLI = path.join(SKILL, 'scripts/icons.mjs');
const BUILD_CLI = path.join(SKILL, 'scripts/build.mjs');
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
const run = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

async function withIconDir(dir, fn) {
  const before = process.env.MAKE_DIAGRAM_ICON_DIR;
  process.env.MAKE_DIAGRAM_ICON_DIR = dir;
  try {
    return await fn();
  } finally {
    process.env.MAKE_DIAGRAM_ICON_DIR = before;
  }
}

const archSpec = (nodes, extra = {}) => ({ title: 'Cloud', type: 'architecture', nodes, edges: [], ...extra });
const idsOf = (markup) => [...markup.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

// ---- the bundled catalog ----------------------------------------------------------------

test('cloud:aws-lambda and cloud:google-cloud-run resolve', () => {
  const lambda = iconSvg('cloud:aws-lambda');
  assert.equal(lambda.kind, 'cloud');
  assert.equal(lambda.viewBox, '0 0 256 256');
  assert.match(lambda.markup, /^<defs>/);
  const cloudRun = iconSvg('cloud:google-cloud-run');
  assert.equal(cloudRun.kind, 'cloud');
  assert.match(cloudRun.viewBox, /^0 0 256 \d+$/);
  assert.equal(hasIcon('cloud:aws-lambda'), true);
  assert.equal(hasIcon('cloud:nope'), false);
});

test('search lambda, search "cloud run" and search gcp find them', () => {
  assert.ok(searchIcons('lambda').includes('cloud:aws-lambda'));
  assert.ok(searchIcons('cloud run').includes('cloud:google-cloud-run'));
  const gcp = searchIcons('gcp');
  assert.ok(gcp.includes('cloud:google-cloud-run'));
  assert.deepEqual(gcp.slice(0, 4).sort(), ['cloud:google-cloud', 'cloud:google-cloud-functions', 'cloud:google-cloud-platform', 'cloud:google-cloud-run'], 'the four Google names come first, typo matches after');
  assert.ok(listIcons('cloud').includes('cloud:aws-s3'));
});

test('an unknown cloud icon suggests a near name, and names the import command when nothing is near', () => {
  assert.throws(() => iconSvg('cloud:aws-lambdaa'), (e) => {
    assert.ok(e instanceof IconError);
    assert.equal(e.suggestion, 'cloud:aws-lambda');
    assert.match(e.message, /did you mean "cloud:aws-lambda"\?/);
    return true;
  });
  assert.throws(() => iconSvg('cloud:lambda'), (e) => e instanceof IconError && e.suggestion === 'cloud:aws-lambda');
  assert.throws(() => iconSvg('cloud:zzzzzzzzzzzz'), (e) => {
    assert.ok(e instanceof IconError);
    assert.equal(e.suggestion, null);
    assert.match(e.message, /node scripts\/icons\.mjs import <aws\|gcp> <folder>/);
    return true;
  });
  assert.throws(() => iconSvg('clod:aws-lambda'), (e) => e instanceof IconError && e.suggestion === 'cloud:aws-lambda');
});

test('the catalog holds no dropped name', () => {
  for (const dropped of ['aws-elastic-cache', 'aws-mobilehub', 'aws-codestar', 'aws-opsworks']) {
    assert.equal(Object.hasOwn(cloud.icons, dropped), false, dropped);
  }
  assert.ok(Object.hasOwn(cloud.icons, 'aws-elasticache'), 'the kept spelling stays');
});

test('the AWS wordmark is left out: its dark lettering cannot be read on a dark card', () => {
  assert.equal(Object.hasOwn(cloud.icons, 'aws'), false);
});

test('the catalog records its source and holds 60 AWS and four Google Cloud names', () => {
  assert.equal(cloud.version, '1.2.19');
  assert.equal(cloud.source, '@iconify-json/logos');
  const names = Object.keys(cloud.icons);
  assert.deepEqual(names.filter((n) => n.startsWith('google')).sort(), ['google-cloud', 'google-cloud-functions', 'google-cloud-platform', 'google-cloud-run']);
  assert.equal(names.filter((n) => n.startsWith('aws-')).length, 60);
  assert.deepEqual(bundledCloudNames().sort(), names.sort());
});

// ---- the allow-list ---------------------------------------------------------------------

const HOSTILE = {
  'a script element': wrap(`${SHAPE}<script>alert(1)</script>`),
  'an upper-case script element': wrap(`${SHAPE}<SCRIPT>alert(1)</SCRIPT>`),
  'an event handler on a shape': wrap('<rect width="24" height="24" onclick="alert(1)"/>'),
  'an event handler on the root': wrap(SHAPE, 'viewBox="0 0 24 24" onload="alert(1)"'),
  'a foreignObject': wrap(`${SHAPE}<foreignObject width="24" height="24"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>`),
  'a style element': wrap(`<style>rect{fill:red}</style>${SHAPE}`),
  'a style element in a CDATA section': wrap(`<style type="text/css"><![CDATA[.a{fill:red}]]></style>${SHAPE}`),
  'an external href on use': wrap(`<use href="http://example.com/a.svg#x"/>${SHAPE}`),
  'an external xlink:href on use': wrap(`<use xlink:href="https://example.com/a.svg#x"/>${SHAPE}`),
  'a javascript: href': wrap(`<use href="javascript:alert(1)"/>${SHAPE}`),
  'a data: href': wrap(`<use href="data:image/svg+xml;base64,PHN2Zy8+"/>${SHAPE}`),
  'an image element': wrap(`<image href="http://example.com/a.png" width="24" height="24"/>${SHAPE}`),
  'an external url() in fill': wrap('<rect width="24" height="24" fill="url(http://example.com/a.svg#g)"/>'),
  'an external url() in a style attribute': wrap('<rect width="24" height="24" style="fill:url(//example.com/a.svg#g)"/>'),
  'an external url() in mask': wrap('<rect width="24" height="24" mask="url(https://example.com/m.svg#m)"/>'),
  'a javascript: url()': wrap('<rect width="24" height="24" fill="url(javascript:alert(1))"/>'),
  'a reference to an id outside the icon': wrap('<rect width="24" height="24" fill="url(#missing)"/>'),
  'a use of an id outside the icon': wrap('<use href="#missing"/>'),
  'a style declaration that is not paint': wrap('<rect width="24" height="24" style="behavior:url(x.htc)"/>'),
  'an @import in a style attribute': wrap('<rect width="24" height="24" style="fill:red;@import url(x.css)"/>'),
  '!important in a style attribute': wrap('<rect width="24" height="24" style="fill:red !important"/>'),
  'a DOCTYPE': `<!DOCTYPE svg [<!ENTITY x "y">]>${wrap(SHAPE)}`,
  'a CDATA section': wrap(`${SHAPE}<![CDATA[x]]>`),
  'a processing instruction': `<?xml-stylesheet href="x.css"?>${wrap(SHAPE)}`,
  'an unknown entity': wrap('<rect width="24" height="24" fill="&xxe;"/>'),
  'an element the list does not know': wrap(`${SHAPE}<filter id="f"><feGaussianBlur stdDeviation="2"/></filter>`),
  'an attribute the list does not know': wrap('<rect width="24" height="24" filter="blur(2px)"/>'),
  'a non-colour fill': wrap('<rect width="24" height="24" fill="expression(alert(1))"/>'),
  'a quote that closes the attribute': wrap('<rect width="24" height="24" fill="red&quot; onclick=&quot;alert(1)"/>'),
  'path data with a script': wrap('<path d="M0 0 L1 1 <script>"/>'),
  'a nested svg': wrap(`<svg viewBox="0 0 1 1">${SHAPE}</svg>`),
  'text content': wrap(`${SHAPE}hello`),
  'a link element': wrap(`<a href="http://example.com">${SHAPE}</a>`),
  'an animation element': wrap('<rect width="24" height="24"><animate attributeName="x" to="1"/></rect>'),
  'a second root': `${wrap(SHAPE)}${wrap(SHAPE)}`,
  'a use that refers back to itself': wrap('<g id="a"><use href="#a"/><rect width="1" height="1"/></g>'),
  'a duplicated id': wrap('<rect id="a" width="1" height="1"/><rect id="a" width="1" height="1"/>'),
  'a file that is not an svg': '<html><body>hi</body></html>',
  'an unterminated tag': '<svg viewBox="0 0 24 24"><rect width="24"',
  'no drawing': wrap('<defs/>'),
  'a file over 256 KiB': wrap(`${SHAPE}<!-- ${'x'.repeat(256 * 1024)} -->`),
};

for (const [what, input] of Object.entries(HOSTILE)) {
  test(`sanitizeSvg refuses ${what}`, () => {
    const result = sanitizeSvg(input);
    assert.equal(typeof result.skipped, 'string', JSON.stringify(result).slice(0, 200));
    assert.equal(result.markup, undefined);
  });
}

test('sanitizeSvg names the reason for the five named dangers', () => {
  assert.match(sanitizeSvg(HOSTILE['a script element']).skipped, /script/);
  assert.match(sanitizeSvg(HOSTILE['an event handler on a shape']).skipped, /event handler/);
  assert.match(sanitizeSvg(HOSTILE['a foreignObject']).skipped, /foreignObject/);
  assert.match(sanitizeSvg(HOSTILE['a style element']).skipped, /style/);
  assert.match(sanitizeSvg(HOSTILE['an external href on use']).skipped, /external href/);
  assert.match(sanitizeSvg(HOSTILE['an external url() in fill']).skipped, /external url\(\)/);
});

test('sanitizeSvg refuses a billion-use expansion without running out of time', () => {
  let body = '<rect id="b0" width="1" height="1"/>';
  for (let i = 1; i <= 12; i++) body += `<g id="b${i}"><use href="#b${i - 1}"/><use href="#b${i - 1}"/><use href="#b${i - 1}"/></g>`;
  const started = Date.now();
  const result = sanitizeSvg(wrap(`${body}<use href="#b12"/>`));
  assert.match(result.skipped, /too many drawn elements/);
  assert.ok(Date.now() - started < 2000);
});

test('sanitizeSvg does not backtrack on long hostile values', () => {
  const started = Date.now();
  for (const attr of [`transform="${'1'.repeat(50000)}x"`, `fill="rgb(${' '.repeat(50000)}x"`, `opacity="${'1'.repeat(50000)}x"`]) {
    assert.equal(typeof sanitizeSvg(wrap(`<rect width="1" height="1" ${attr}/>`)).skipped, 'string');
  }
  assert.ok(Date.now() - started < 2000);
});

test('sanitizeSvg keeps a plain icon and writes it out itself', () => {
  const result = sanitizeSvg(`<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" class="x" viewBox="0 0 48 32">
  <title>Hand written</title>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="100%" style="stop-color:#000;stop-opacity:.5"/></linearGradient></defs>
  <g class="layer" data-name="Layer" style="fill:url(#g);stroke:none"><path d="M0 0h48v32H0z" transform="translate(1,2) scale(1)"/></g>
  <use xlink:href="#g"/>
</svg>`);
  assert.equal(result.skipped, undefined);
  assert.equal(result.viewBox, '0 0 48 32');
  assert.equal(
    result.markup,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="100%" stop-color="#000" stop-opacity=".5"/></linearGradient></defs>'
    + '<g fill="url(#g)" stroke="none"><path d="M0 0h48v32H0z" transform="translate(1 2) scale(1)"/></g><use href="#g"/>',
  );
});

test('sanitizeSvg builds a viewBox from width and height, and keeps the root paint on a group', () => {
  assert.deepEqual(sanitizeSvg('<svg width="40px" height="30"><path d="M0 0h1v1z"/></svg>'), { markup: '<path d="M0 0h1v1z"/>', viewBox: '0 0 40 30' });
  assert.deepEqual(sanitizeSvg('<svg viewBox="0,0,24,24" fill="none" stroke="#000"><path d="M0 0h1v1z"/></svg>'), {
    markup: '<g fill="none" stroke="#000"><path d="M0 0h1v1z"/></g>',
    viewBox: '0 0 24 24',
  });
  assert.match(sanitizeSvg('<svg><path d="M0 0"/></svg>').skipped, /viewBox/);
});

test('sanitizeSvg is idempotent: its own output, wrapped, comes back unchanged', () => {
  const first = sanitizeSvg(fs.readFileSync(path.join(GCP_FIXTURE, 'cloud_functions/cloud_functions.svg'), 'utf8'));
  const second = sanitizeSvg(wrap(first.markup, `viewBox="${first.viewBox}"`));
  assert.deepEqual(second, first);
});

test('every shipped cloud icon passes sanitizeSvg unchanged in meaning', () => {
  const entries = Object.entries(cloud.icons);
  assert.ok(entries.length >= 60);
  for (const [name, entry] of entries) {
    const again = sanitizeSvg(wrap(entry.markup, `viewBox="${entry.viewBox}"`));
    assert.deepEqual(again, { markup: entry.markup, viewBox: entry.viewBox }, name);
    assert.match(entry.viewBox, /^0 0 256 \d+$/, name);
  }
});

test('every shipped cloud icon holds only the allow-listed tags and attributes', () => {
  const tags = new Set(['defs', 'linearGradient', 'stop', 'path', 'mask', 'use', 'circle']);
  const attrs = new Set(['id', 'x1', 'x2', 'y1', 'y2', 'offset', 'stop-color', 'fill', 'd', 'stop-opacity', 'href', 'mask', 'opacity', 'cx', 'cy', 'r', 'fill-opacity']);
  for (const [name, entry] of Object.entries(cloud.icons)) {
    for (const m of entry.markup.matchAll(/<\/?([A-Za-z][\w-]*)/g)) assert.ok(tags.has(m[1]), `${name}: <${m[1]}>`);
    for (const m of entry.markup.matchAll(/ ([A-Za-z:-]+)="/g)) assert.ok(attrs.has(m[1]), `${name}: ${m[1]}`);
    assert.doesNotMatch(entry.markup, /<script|<style|foreignObject|javascript:|https?:|\son[a-z]+=/i, name);
  }
});

// ---- drawing ----------------------------------------------------------------------------

test('the viewBox keeps the icon\'s proportions', () => {
  const tall = Object.entries(cloud.icons).find(([, e]) => e.viewBox !== '0 0 256 256');
  assert.ok(tall, 'the pack has a non-square icon');
  const [name, entry] = tall;
  const drawn = iconGroup(`cloud:${name}`, 0, 0);
  assert.ok(drawn.includes(`viewBox="${entry.viewBox}"`), drawn.slice(0, 200));
  assert.doesNotMatch(drawn, /preserveAspectRatio="none"/);
  assert.match(drawn, /^<g class="pa-icon pa-icon-cloud" transform="translate\(0 0\) scale\(0\.75\)"><svg /);
});

test('two drawn copies of a gradient icon on one page have no duplicate ids', async () => {
  const spec = archSpec([
    { id: 'a', label: 'First', icon: 'cloud:aws-lambda' },
    { id: 'b', label: 'Second', icon: 'cloud:aws-lambda' },
    { id: 'c', label: 'Third', icon: 'cloud:aws-dynamodb' },
  ]);
  assert.ok(/<linearGradient id=/.test(iconSvg('cloud:aws-lambda').markup), 'lambda carries a gradient id');
  const one = (await buildDiagram(spec, { idPrefix: 'one' })).svg;
  const two = (await buildDiagram(spec, { idPrefix: 'two' })).svg;
  const ids = [...idsOf(one), ...idsOf(two)];
  assert.ok(ids.length > 6);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  for (const m of one.matchAll(/url\(#([^)]*)\)|href="#([^"]*)"/g)) assert.ok(idsOf(one).includes(m[1] ?? m[2]), `dangling reference ${m[0]}`);
});

test('scopeIds prefixes ids, url() and href together', () => {
  assert.equal(
    scopeIds('<defs><mask id="m"/></defs><path fill="url(#g)" mask="url(#m)"/><use href="#m"/>', 'p-ic1'),
    '<defs><mask id="p-ic1-m"/></defs><path fill="url(#p-ic1-g)" mask="url(#p-ic1-m)"/><use href="#p-ic1-m"/>',
  );
});

test('tone does not tint a cloud icon', async () => {
  // Tone and family rules set `color` on .pa-icon; that reaches an icon only through currentColor.
  for (const [name, entry] of Object.entries(cloud.icons)) assert.doesNotMatch(entry.markup, /currentColor/, `${name} paints in the inherited colour`);
  const { svg } = await buildDiagram(archSpec([{ id: 'a', label: 'Fn', icon: 'cloud:aws-lambda', tone: 'bad' }]));
  assert.match(svg, /class="pa-node pa-kind-service pa-family-service pa-tone-bad"/);
  assert.match(svg, /<g class="pa-icon pa-icon-cloud"/);
  assert.doesNotMatch(svg.slice(svg.indexOf('pa-icon-cloud')), /currentColor| color="/);
  // An imported icon that does paint in currentColor is pinned to a fixed colour inside the icon.
  const out = tempDir('current');
  const folder = tempDir('current-src');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Mono_64.svg'), wrap('<path d="M0 0h24v24H0z" fill="currentColor"/>'));
  importIcons('aws', folder, out);
  return withIconDir(out, async () => {
    const group = iconGroup('cloud:aws-mono', 0, 0);
    assert.match(group, /<svg viewBox="0 0 24 24" width="24" height="24" color="#6b7280">/);
  });
});

test('the css is unchanged by cloud icons: no rule for them, no fill or stroke on the group', () => {
  assert.doesNotMatch(diagramCss(), /pa-icon-cloud/);
});

// ---- the import -------------------------------------------------------------------------

test('import on a fake AWS layout adds names like aws-lambda and picks the largest size', () => {
  const dir = tempDir('aws');
  const { added, skipped } = importIcons('aws', AWS_FIXTURE, dir);
  assert.deepEqual(added, ['aws-lambda', 'aws-simple-storage-service']);
  const stored = importedIcons(dir);
  assert.match(stored['aws-lambda'].markup, /#6400ff/, 'the 64 px file won');
  assert.doesNotMatch(stored['aws-lambda'].markup, /#1600ff/);
  assert.match(stored['aws-simple-storage-service'].markup, /#3f8624/, 'the 64 px file won');
  assert.equal(stored['aws-lambda'].viewBox, '0 0 64 64');
  assert.ok(skipped.some((s) => /Res_Amazon-Simple-Storage-Service_Bucket_48\.svg$/.test(s.file) && /service icon/.test(s.reason)), JSON.stringify(skipped));
  assert.ok(skipped.every((s) => typeof s.file === 'string' && typeof s.reason === 'string'));
});

test('import on a fake Google layout adds names like google-cloud-run', () => {
  const dir = tempDir('gcp');
  const { added } = importIcons('gcp', GCP_FIXTURE, dir);
  assert.deepEqual(added.sort(), ['google-bigquery', 'google-cloud-functions', 'google-cloud-run']);
  const stored = importedIcons(dir);
  assert.equal(stored['google-bigquery'].viewBox, '0 0 40 30');
  assert.match(stored['google-bigquery'].markup, /<g fill="#669df6" stroke="none">/);
});

test('a folder with no icons is an error naming the provider\'s expected layout', () => {
  const empty = tempDir('empty');
  assert.throws(() => importIcons('aws', empty, tempDir('out')), (e) => {
    assert.ok(e instanceof ImportError);
    assert.match(e.message, /Architecture-Service-Icons_<date>\/Arch_<Category>\/<size>\/Arch_<Service>_<size>\.svg/);
    return true;
  });
  assert.throws(() => importIcons('gcp', empty, tempDir('out')), (e) => e instanceof ImportError && /Cloud_Run\.svg/.test(e.message));
  assert.throws(() => importIcons('aws', path.join(empty, 'missing'), tempDir('out')), (e) => e instanceof ImportError && /not a folder/.test(e.message));
});

test('an unknown provider lists aws and gcp', () => {
  assert.throws(() => importIcons('azure', AWS_FIXTURE, tempDir('out')), (e) => e instanceof ImportError && /accepted: aws, gcp/.test(e.message));
  const r = run(ICONS_CLI, ['import', 'azure', AWS_FIXTURE]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /accepted: aws, gcp/);
});

test('a symlink is not followed', () => {
  const outside = tempDir('outside');
  write(path.join(outside, 'secret.svg'), wrap(SHAPE));
  write(path.join(outside, 'Arch_Hidden/64/Arch_Amazon-Hidden_64.svg'), wrap(SHAPE));
  const folder = tempDir('links');
  write(path.join(folder, 'Arch_Real/64/Arch_Amazon-Real_64.svg'), wrap(SHAPE));
  fs.mkdirSync(path.join(folder, 'Arch_Link/64'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'secret.svg'), path.join(folder, 'Arch_Link/64/Arch_Amazon-Linked_64.svg'));
  fs.symlinkSync(path.join(outside, 'Arch_Hidden'), path.join(folder, 'Arch_Dir'));
  const { added, skipped } = importIcons('aws', folder, tempDir('out'));
  assert.deepEqual(added, ['aws-real']);
  assert.equal(skipped.filter((s) => /symlink/.test(s.reason)).length, 2, JSON.stringify(skipped));
});

test('a file over 256 KiB is skipped and reported', () => {
  const folder = tempDir('big');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Small_64.svg'), wrap(SHAPE));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Huge_64.svg'), wrap(`${SHAPE}<!-- ${'x'.repeat(260 * 1024)} -->`));
  const { added, skipped } = importIcons('aws', folder, tempDir('out'));
  assert.deepEqual(added, ['aws-small']);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].file, /Arch_Amazon-Huge_64\.svg$/);
  assert.match(skipped[0].reason, /256 KiB/);
});

test('an unsafe file is skipped and reported', () => {
  const folder = tempDir('unsafe');
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Fine_64.svg'), wrap(SHAPE));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Evil_64.svg'), wrap(`${SHAPE}<script>alert(1)</script>`));
  write(path.join(folder, 'Arch_A/64/Arch_Amazon-Styled_64.svg'), wrap(`<style>*{fill:red}</style>${SHAPE}`));
  const out = tempDir('out');
  const { added, skipped } = importIcons('aws', folder, out);
  assert.deepEqual(added, ['aws-fine']);
  assert.deepEqual(skipped.map((s) => path.basename(s.file)).sort(), ['Arch_Amazon-Evil_64.svg', 'Arch_Amazon-Styled_64.svg']);
  assert.match(skipped.find((s) => /Evil/.test(s.file)).reason, /script/);
  assert.match(skipped.find((s) => /Styled/.test(s.file)).reason, /style/);
  assert.equal(Object.hasOwn(importedIcons(out), 'aws-evil'), false);
});

test('importing twice keeps what was imported before, and leaves no temp file behind', () => {
  const out = tempDir('twice');
  importIcons('aws', AWS_FIXTURE, out);
  importIcons('gcp', GCP_FIXTURE, out);
  const again = importIcons('aws', AWS_FIXTURE, out);
  assert.ok(again.added.includes('aws-lambda'));
  const names = Object.keys(importedIcons(out));
  assert.ok(names.includes('aws-simple-storage-service') && names.includes('google-bigquery'));
  assert.deepEqual(fs.readdirSync(out).filter((f) => f.endsWith('.tmp')), []);
});

test('a bundled name wins over an imported one', async () => {
  const out = tempDir('wins');
  importIcons('aws', AWS_FIXTURE, out);
  await withIconDir(out, () => {
    assert.equal(iconSvg('cloud:aws-lambda').markup, cloud.icons['aws-lambda'].markup);
    assert.equal(iconSvg('cloud:aws-lambda').viewBox, '0 0 256 256');
  });
});

test('an imported-only icon resolves, and a built page embeds its markup and reads no file at view time', async () => {
  const out = tempDir('only');
  importIcons('aws', AWS_FIXTURE, out);
  await withIconDir(out, async () => {
    assert.equal(hasIcon('cloud:aws-simple-storage-service'), true);
    assert.ok(searchIcons('simple storage').includes('cloud:aws-simple-storage-service'));
    assert.ok(listIcons('cloud').includes('cloud:aws-simple-storage-service'));
    const { svg } = await buildDiagram(archSpec([{ id: 'a', label: 'Bucket', icon: 'cloud:aws-simple-storage-service' }]));
    assert.ok(svg.includes('#3f8624'), 'the imported markup is in the svg');
  });
  const spec = path.join(out, 'd.diagram.json');
  fs.writeFileSync(spec, JSON.stringify(archSpec([{ id: 'a', label: 'Bucket', icon: 'cloud:aws-simple-storage-service' }])));
  const page = path.join(out, 'd.html');
  const built = run(BUILD_CLI, [spec, '--out', page], { MAKE_DIAGRAM_ICON_DIR: out });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  fs.rmSync(path.join(out, 'imported-aws.json'));
  const html = fs.readFileSync(page, 'utf8');
  assert.ok(html.includes('#3f8624'));
  assert.ok(!html.includes(out), 'the page names no path from the icon folder');
  assert.doesNotMatch(html, /<img\b|<link\b[^>]*href="(?!data:)|\ssrc="(?!data:)/, 'nothing in the page points at a file');
});

test('a spec naming a missing imported icon fails validation naming the import command', async () => {
  const result = await validateSpec(archSpec([{ id: 'a', label: 'Vault', icon: 'cloud:aws-zzzz-unlisted-service' }]));
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].path, 'nodes[0].icon');
  assert.match(result.errors[0].message, /node scripts\/icons\.mjs import <aws\|gcp> <folder>/);
});

// ---- the command line ------------------------------------------------------------------

test('CLI import reports what it added and skipped, and says who accepted the vendor terms', () => {
  const out = tempDir('cli');
  const r = run(ICONS_CLI, ['import', 'aws', AWS_FIXTURE], { MAKE_DIAGRAM_ICON_DIR: out });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added 2: aws-lambda, aws-simple-storage-service/);
  assert.match(r.stdout, /skipped 1/);
  assert.match(r.stdout, /Res_Amazon-Simple-Storage-Service_Bucket_48\.svg/);
  assert.match(r.stdout, /bundled icons of the same name win: aws-lambda/);
  assert.match(r.stdout, /You are responsible for having accepted the vendor's terms/);
  assert.match(r.stdout, new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('CLI import rejects bad usage with the accepted values, and never prompts', () => {
  const missing = run(ICONS_CLI, ['import']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /aws\|gcp/);
  const noFolder = run(ICONS_CLI, ['import', 'aws']);
  assert.equal(noFolder.status, 2);
  const extra = run(ICONS_CLI, ['import', 'aws', AWS_FIXTURE, 'extra']);
  assert.equal(extra.status, 2);
  const flag = run(ICONS_CLI, ['import', 'aws', AWS_FIXTURE, '--force']);
  assert.equal(flag.status, 2);
  const empty = run(ICONS_CLI, ['import', 'gcp', tempDir('nothing')]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /Cloud_Run\.svg/);
});

test('CLI list cloud prints the bundled catalog, and list with no argument adds it', () => {
  const l = run(ICONS_CLI, ['list', 'cloud']);
  assert.equal(l.status, 0);
  assert.equal(l.stdout.trim().split('\n').length, Object.keys(cloud.icons).length);
  assert.ok(l.stdout.split('\n').includes('cloud:aws-lambda'));
  assert.match(run(ICONS_CLI, ['list', 'emoji']).stderr, /lucide.*brand.*cloud/);
});

test('the default import folder is under the home folder and MAKE_DIAGRAM_ICON_DIR overrides it', async () => {
  const { iconDir } = await import('../scripts/lib/icons.mjs');
  assert.equal(iconDir(), EMPTY_DIR);
  const saved = process.env.MAKE_DIAGRAM_ICON_DIR;
  delete process.env.MAKE_DIAGRAM_ICON_DIR;
  try {
    assert.equal(iconDir(), path.join(os.homedir(), '.cache', 'portable-artifacts', 'make-diagram'));
  } finally {
    process.env.MAKE_DIAGRAM_ICON_DIR = saved;
  }
});

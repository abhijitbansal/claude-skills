import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { iconSvg, hasIcon, searchIcons, listIcons, DEFAULT_ICON, IconError } from '../scripts/lib/icons.mjs';
import { sanitizeNodes, resolveCurated, brandEntry, licenseOf } from '../scripts/dev/build-icons.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const lucide = read('../icons/lucide.json');
const brands = read('../icons/brands.json');
const CLI = fileURLToPath(new URL('../scripts/icons.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

// Every non-null default must resolve. These kinds are drawn as pure shapes
// (or a plain box), so they carry no icon.
const SHAPE_ONLY = ['choice', 'decision', 'end', 'start', 'state', 'step'];
const ALL_KINDS = [
  // architecture
  'service', 'client', 'user', 'database', 'storage', 'queue', 'cache', 'function', 'gateway', 'external', 'other',
  // flow
  'step', 'start', 'end', 'decision', 'io', 'subprocess', 'wait',
  // state
  'state', 'choice',
  // sequence participants
  'actor',
];

test('catalogs record their upstream version and are non-trivial', () => {
  assert.equal(lucide.version, '1.55.0');
  assert.equal(brands.version, '16.35.0');
  assert.ok(Object.keys(lucide.icons).length >= 240, 'lucide catalog too small');
  assert.ok(Object.keys(brands.icons).length >= 120, 'brand catalog too small');
});

test('DEFAULT_ICON covers every kind of every type', () => {
  for (const kind of ALL_KINDS) assert.ok(kind in DEFAULT_ICON, `no default for kind ${kind}`);
});

test('every non-null DEFAULT_ICON resolves to a lucide icon', () => {
  for (const [kind, ref] of Object.entries(DEFAULT_ICON)) {
    if (ref === null) continue;
    assert.ok(ref.startsWith('lucide:'), `${kind} default must be lucide, got ${ref}`);
    assert.ok(hasIcon(ref), `${kind} -> ${ref} does not resolve`);
    assert.equal(iconSvg(ref).kind, 'lucide');
  }
});

test('null defaults are exactly the shape-only kinds', () => {
  const nulls = Object.entries(DEFAULT_ICON).filter(([, v]) => v === null).map(([k]) => k).sort();
  assert.deepEqual(nulls, SHAPE_ONLY);
});

test('iconSvg returns kind, markup and viewBox', () => {
  const l = iconSvg('lucide:database');
  assert.equal(l.kind, 'lucide');
  assert.equal(l.viewBox, '0 0 24 24');
  assert.match(l.markup, /<ellipse /);
  const b = iconSvg('brand:postgresql');
  assert.equal(b.kind, 'brand');
  assert.equal(b.viewBox, '0 0 24 24');
  assert.match(b.markup, /^<path d="[^"]+"\/>$/);
});

test('iconSvg typo in a lucide name throws with the closest ref', () => {
  assert.throws(() => iconSvg('lucide:databse'), (e) => {
    assert.ok(e instanceof IconError);
    assert.equal(e.suggestion, 'lucide:database');
    assert.match(e.message, /did you mean "lucide:database"\?/);
    return true;
  });
});

test('iconSvg typo in a brand slug suggests the real slug', () => {
  assert.throws(() => iconSvg('brand:postgres'), (e) => {
    assert.ok(e instanceof IconError);
    assert.equal(e.suggestion, 'brand:postgresql');
    return true;
  });
});

test('iconSvg rejects a missing or unknown prefix with a hint', () => {
  assert.throws(() => iconSvg('database'), (e) => e instanceof IconError && e.suggestion === 'lucide:database');
  assert.throws(() => iconSvg('lucid:database'), (e) => e instanceof IconError && e.suggestion === 'lucide:database');
  assert.throws(() => iconSvg('foo:bar'), (e) => e instanceof IconError && /lucide:<name> or brand:<slug>/.test(e.message));
  assert.throws(() => iconSvg(42), IconError);
  assert.throws(() => iconSvg('lucide:zzzzzzzzzzzz'), (e) => e instanceof IconError && e.suggestion === null);
});

test('hasIcon is a boolean and never throws', () => {
  assert.equal(hasIcon('lucide:server'), true);
  assert.equal(hasIcon('brand:docker'), true);
  assert.equal(hasIcon('lucide:nope-nope'), false);
  assert.equal(hasIcon('nope'), false);
  assert.equal(hasIcon(undefined), false);
});

test('searchIcons ranks exact, then prefix, then substring, then near misses', () => {
  const data = searchIcons('data');
  assert.ok(data.includes('lucide:database'));
  assert.ok(data.length <= 12);
  const redis = searchIcons('redis');
  assert.equal(redis[0], 'brand:redis');
  const sub = searchIcons('base', 50);
  assert.ok(sub.indexOf('lucide:database') > -1);
  const typo = searchIcons('databse');
  assert.ok(typo.includes('lucide:database'), 'did-you-mean tier');
  assert.deepEqual(searchIcons('zzzzzzzzzz'), []);
});

test('searchIcons matches brand titles and respects limit', () => {
  assert.ok(searchIcons('postgres').includes('brand:postgresql'));
  assert.equal(searchIcons('a', 3).length, 3);
});

test('listIcons returns every ref for a catalog', () => {
  assert.equal(listIcons('lucide').length, Object.keys(lucide.icons).length);
  assert.equal(listIcons('brand').length, Object.keys(brands.icons).length);
  assert.equal(listIcons().length, listIcons('lucide').length + listIcons('brand').length);
});

const ALLOWED_TAG = /^(path|circle|line|polyline|polygon|rect|ellipse)$/;
const ALLOWED_ATTR = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill']);

test('every lucide entry holds only geometric elements and attributes', () => {
  for (const [name, markup] of Object.entries(lucide.icons)) {
    assert.ok(markup.length > 0, `${name} empty`);
    const stripped = markup.replace(/<([a-z]+)((?:\s+[a-z0-9]+="[^"<>]*")*)\s*\/>/g, (_, tag, attrs) => {
      assert.match(tag, ALLOWED_TAG, `${name}: tag ${tag}`);
      for (const m of attrs.matchAll(/([a-z0-9]+)="([^"]*)"/g)) {
        assert.ok(ALLOWED_ATTR.has(m[1]), `${name}: attribute ${m[1]}`);
        if (m[1] === 'fill') assert.equal(m[2], 'currentColor', `${name}: fill`);
      }
      return '';
    });
    assert.equal(stripped, '', `${name}: leftover markup ${stripped}`);
  }
});

test('no catalog markup contains script, handlers, href, style, class or id', () => {
  const blobs = [
    ...Object.entries(lucide.icons).map(([k, v]) => [`lucide:${k}`, v]),
    ...Object.entries(brands.icons).map(([k, v]) => [`brand:${k}`, `<path d="${v.path}"/>`]),
  ];
  for (const [ref, markup] of blobs) {
    assert.doesNotMatch(markup, /<script/i, ref);
    assert.doesNotMatch(markup, /\son[a-z]+\s*=/i, ref);
    assert.doesNotMatch(markup, /href\s*=/i, ref);
    assert.doesNotMatch(markup, /style\s*=/i, ref);
    assert.doesNotMatch(markup, /class\s*=/i, ref);
    assert.doesNotMatch(markup, /\sid\s*=/i, ref);
    assert.doesNotMatch(markup, /<(?!\/?(path|circle|line|polyline|polygon|rect|ellipse)[\s/>])/i, ref);
  }
});

test('every brand entry is a title plus a clean path data string', () => {
  for (const [slug, e] of Object.entries(brands.icons)) {
    assert.match(slug, /^[a-z0-9]+$/);
    assert.ok(e.title && typeof e.title === 'string', slug);
    assert.match(e.path, /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/, `${slug}: path data charset`);
    assert.deepEqual(Object.keys(e).sort(), ['path', 'title']);
  }
});

test('sanitizeNodes drops hostile tags and attributes', () => {
  const out = sanitizeNodes([
    ['path', { d: 'M0 0L1 1', class: 'x', style: 'fill:red', onload: 'alert(1)', id: 'a', key: 'k', 'xlink:href': 'http://e', href: 'http://e' }],
    ['circle', { cx: '1', cy: '2', r: '3', fill: 'currentColor' }],
    ['circle', { cx: '1', cy: '2', r: '3', fill: 'red' }],
    ['script', { d: 'x' }],
    ['rect', { x: '1', y: '1', width: '2', height: '2', rx: '"><script>' }],
  ]);
  assert.equal(
    out,
    '<path d="M0 0L1 1"/><circle cx="1" cy="2" r="3" fill="currentColor"/><circle cx="1" cy="2" r="3"/><rect x="1" y="1" width="2" height="2" rx="&quot;&gt;&lt;script&gt;"/>',
  );
});

test('resolveCurated reports every missing name instead of dropping silently', () => {
  const { found, missing } = resolveCurated(['a', 'b', 'gone', 'also-gone', 'a'], { a: [], b: [] });
  assert.deepEqual(found, ['a', 'b']);
  assert.deepEqual(missing, ['gone', 'also-gone']);
});

test('brandEntry decodes the title and extracts the path', () => {
  const e = brandEntry('<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>A &amp; B</title><path d="M1 2L3 4Z"/></svg>');
  assert.deepEqual(e, { title: 'A & B', path: 'M1 2L3 4Z' });
  assert.equal(brandEntry('<svg><title>x</title><g/></svg>'), null);
});

test('CLI search prints matching refs one per line', () => {
  const r = run('search', 'data');
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.includes('lucide:database'));
  assert.ok(lines.every((l) => /^(lucide|brand):/.test(l)));
});

test('CLI list prints a whole catalog or both', () => {
  const l = run('list', 'lucide');
  assert.equal(l.status, 0);
  assert.equal(l.stdout.trim().split('\n').length, Object.keys(lucide.icons).length);
  const b = run('list', 'brand');
  assert.equal(b.stdout.trim().split('\n').length, Object.keys(brands.icons).length);
  const all = run('list');
  assert.equal(all.stdout.trim().split('\n').length, Object.keys(lucide.icons).length + Object.keys(brands.icons).length);
});

test('CLI exits 2 with the accepted subcommands on bad usage', () => {
  const unknown = run('frobnicate');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /search.*list/);
  const none = run();
  assert.equal(none.status, 2);
  assert.equal(run('search').status, 2);
  assert.equal(run('list', 'emoji').status, 2);
  assert.match(run('list', 'emoji').stderr, /lucide.*brand/);
  assert.equal(run('search', 'a', 'b').status, 2);
  assert.equal(run('search', 'x', '--bogus').status, 2);
});

test('CLI search with no match exits 0 and prints nothing', () => {
  const r = run('search', 'zzzzzzzzzz');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('brandEntry rejects path data outside the SVG path charset', () => {
  const svg = (d) => `<svg><title>x</title><path d="${d}"/></svg>`;
  assert.deepEqual(brandEntry(svg('M1 2l-3.5e2,4z')), { title: 'x', path: 'M1 2l-3.5e2,4z' });
  assert.equal(brandEntry(svg('M1 2&quot;onload=alert(1)')), null);
  assert.equal(brandEntry(svg('M1 2;<script>')), null);
  assert.equal(brandEntry(svg('M1 2 url(#x)')), null);
});

test('licenseOf reads the upstream licence type, null when absent', () => {
  assert.equal(licenseOf({ license: { type: 'CC0-1.0' } }), 'CC0-1.0');
  assert.equal(licenseOf({ license: { type: 'custom', url: 'u' } }), 'custom');
  assert.equal(licenseOf({}), null);
});

test('every shipped brand is CC0 upstream or carries no licence entry', () => {
  const upstream = JSON.parse(fs.readFileSync(
    new URL('../node_modules/simple-icons/data/simple-icons.json', import.meta.url), 'utf8'));
  const bySlug = new Map(upstream.map((e) => [e.slug, e]));
  for (const slug of Object.keys(brands.icons)) {
    const meta = bySlug.get(slug);
    assert.ok(meta, `${slug} not in upstream simple-icons.json`);
    const lic = licenseOf(meta);
    assert.ok(lic === null || lic === 'CC0-1.0', `${slug} is ${lic}, not CC0`);
  }
});

test('CLI works when the skill directory is reached through a symlink', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-icons-'));
  try {
    const link = path.join(tmp, 'skill');
    fs.symlinkSync(fileURLToPath(new URL('..', import.meta.url)), link, 'dir');
    const go = (...args) => spawnSync(process.execPath, [path.join(link, 'scripts/icons.mjs'), ...args], { encoding: 'utf8' });
    const ok = go('search', 'data');
    assert.equal(ok.status, 0);
    assert.ok(ok.stdout.split('\n').includes('lucide:database'), 'symlinked search printed nothing');
    const bad = go('frobnicate');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /accepted: search, list/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

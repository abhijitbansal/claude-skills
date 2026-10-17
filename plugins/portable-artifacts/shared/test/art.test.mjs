import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artSvg, seedFrom, assertHex, ART_STYLES } from '../art.mjs';
import { ThemeError } from '../theme.mjs';

const THEMES = ['dusk', 'press', 'poster'];
const MODES = ['light', 'dark'];
const base = { theme: 'dusk', seed: 'Launch review', width: 1280, height: 720, mode: 'dark' };

const XMLNS = ' xmlns="http://www.w3.org/2000/svg"';
const ids = (svg) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const refs = (svg) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);

test('same arguments give byte-identical SVG; a different seed gives a different one', () => {
  for (const theme of THEMES) {
    const a = artSvg({ ...base, theme });
    assert.equal(a, artSvg({ ...base, theme }), theme);
    assert.notEqual(a, artSvg({ ...base, theme, seed: 'Launch review 2' }), theme);
  }
});

test('mode defaults to dark', () => {
  for (const theme of THEMES) {
    const { mode, ...noMode } = base;
    assert.equal(artSvg({ ...noMode, theme }), artSvg({ ...base, theme, mode: 'dark' }), theme);
    assert.notEqual(artSvg({ ...base, theme, mode: 'light' }), artSvg({ ...base, theme, mode: 'dark' }), theme);
  }
});

test('every theme and mode: standalone svg, viewBox, no external refs, one filter, under 60 KB', () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const svg = artSvg({ ...base, theme, mode });
      const label = `${theme}/${mode}`;
      assert.ok(svg.startsWith('<svg'), label);
      assert.ok(svg.endsWith('</svg>'), label);
      assert.match(svg, /viewBox="0 0 1280 720"/, label);
      assert.equal(svg.split(XMLNS).length, 2, `${label} has exactly one xmlns`);
      const rest = svg.replace(XMLNS, '');
      for (const bad of ['http', 'href', 'url(http', '<script', '<foreignObject', '<image', 'var(']) {
        assert.ok(!rest.includes(bad), `${label} contains ${bad} outside the xmlns`);
      }
      assert.equal((svg.match(/<filter\b/g) || []).length, 1, `${label} filter count`);
      assert.ok(Buffer.byteLength(svg) < 60 * 1024, `${label} is ${Buffer.byteLength(svg)} bytes`);
    }
  }
});

test('the root <svg> carries the SVG namespace so <img>, data: URIs and .svg files render', () => {
  for (const theme of THEMES) assert.ok(artSvg({ ...base, theme }).startsWith(`<svg${XMLNS} `), theme);
});

test('extreme aspect ratios and the size limits: no throw, under 60 KB, for every theme and mode', () => {
  const sizes = [[1920, 200], [200, 1920], [3000, 100], [100, 3000], [8192, 16], [16, 8192], [16, 16], [8192, 8192]];
  for (const theme of THEMES) {
    for (const mode of MODES) {
      for (const [width, height] of sizes) {
        for (const seed of ['Launch review', 'Q3 roadmap', 'Design refresh']) {
          const svg = artSvg({ theme, mode, seed, width, height });
          const label = `${theme}/${mode} ${width}x${height} ${seed}`;
          assert.ok(Buffer.byteLength(svg) < 60 * 1024, `${label} is ${Buffer.byteLength(svg)} bytes`);
          assert.ok(!/NaN|Infinity|undefined/.test(svg), label);
        }
      }
    }
  }
});

test('small 400x300 renders within budget too', () => {
  for (const theme of THEMES) {
    const svg = artSvg({ ...base, theme, width: 400, height: 300 });
    assert.match(svg, /viewBox="0 0 400 300"/);
    assert.ok(Buffer.byteLength(svg) < 60 * 1024);
  }
});

test('only #rrggbb colours appear, and they come from the theme tokens', () => {
  const svg = artSvg({ ...base, theme: 'press', mode: 'light' });
  const colours = [...svg.matchAll(/(?:fill|stroke|stop-color|flood-color)="([^"]+)"/g)].map((m) => m[1]).filter((c) => !c.startsWith('url(') && c !== 'none');
  assert.ok(colours.length > 0);
  for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/, c);
});

test('assertHex accepts #rrggbb and throws on anything else', () => {
  assert.equal(assertHex('#a1b2c3', 'k'), '#a1b2c3');
  for (const bad of ['red', '#abc', '#a1b2c3"/><script>', 'url(http://x)', undefined, 42]) {
    assert.throws(() => assertHex(bad, 'k'), TypeError, String(bad));
  }
});

test('unknown theme throws ThemeError; legacy themes fall back to the press style', () => {
  assert.throws(() => artSvg({ ...base, theme: 'nope' }), ThemeError);
  assert.throws(() => artSvg({ ...base, theme: '../themes/dusk' }), ThemeError);
  assert.equal(ART_STYLES.paper, undefined);
  const svg = artSvg({ ...base, theme: 'paper' });
  assert.match(svg, /data-art="press"/);
});

test('bad mode, size or seed type is rejected', () => {
  assert.throws(() => artSvg({ ...base, mode: 'dim' }), TypeError);
  for (const width of [NaN, Infinity, '1280', undefined]) assert.throws(() => artSvg({ ...base, width }), TypeError, String(width));
  for (const width of [0, -1, 1e-9, 15.9, 8192.1, 1e6]) assert.throws(() => artSvg({ ...base, width }), RangeError, String(width));
  assert.throws(() => artSvg({ ...base, height: 0 }), RangeError);
  assert.throws(() => artSvg({ ...base, width: NaN }), /got NaN/, 'NaN is named, not "null"');
  assert.throws(() => artSvg({ ...base, width: 10 }), /between 16 and 8192/);
  assert.ok(artSvg({ ...base, width: 16, height: 8192 }).startsWith('<svg'));
  assert.throws(() => artSvg({ ...base, seed: 42 }), TypeError);
});

test('artSvg() with no argument throws the module error, not a destructuring error', () => {
  assert.throws(() => artSvg(), ThemeError);
});

test('seedFrom is a stable non-negative 32-bit integer', () => {
  assert.notEqual(seedFrom('a'), seedFrom('b'));
  for (const s of ['a', '', 'Launch review', 'emoji \u{1F305} <tag>']) {
    const n = seedFrom(s);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, `${s} -> ${n}`);
    assert.equal(seedFrom(s), n);
  }
  assert.equal(seedFrom('a'), 0xe40c292c, 'FNV-1a 32 of "a" is pinned');
});

test('ids are unique within an SVG, disjoint across seeds and themes, and every url(#) resolves', () => {
  const one = artSvg({ ...base, seed: 'first' });
  const two = artSvg({ ...base, seed: 'second' });
  const three = artSvg({ ...base, seed: 'first', theme: 'press' });
  for (const svg of [one, two, three]) {
    const own = ids(svg);
    assert.ok(own.length > 0);
    assert.equal(new Set(own).size, own.length, 'unique within one SVG');
    for (const r of refs(svg)) assert.ok(own.includes(r), `dangling url(#${r})`);
  }
  const all = [...ids(one), ...ids(two), ...ids(three)];
  assert.equal(new Set(all).size, all.length, 'no id shared between SVGs on one page');
});

test('seed text is never interpolated into the SVG', () => {
  const seed = '<script>alert("x")</script>\'&\u{1F305}';
  for (const theme of THEMES) {
    const svg = artSvg({ ...base, theme, seed });
    for (const bad of ['<script', 'alert', '"x"', "'", '&', '\u{1F305}']) assert.ok(!svg.includes(bad), `${theme} leaks ${bad}`);
  }
});

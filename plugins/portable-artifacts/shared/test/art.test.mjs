import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { artSvg, seedFrom, assertHex, ART_STYLES } from '../art.mjs';
import { ThemeError, listThemes, loadTheme } from '../theme.mjs';

const THEMES = listThemes();
const ORIGINAL = ['dusk', 'press', 'poster'];
const NEW_STYLES = THEMES.filter((t) => !ORIGINAL.includes(t));
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
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const svg = artSvg({ ...base, theme, mode });
      const colours = [...svg.matchAll(/(?:fill|stroke|stop-color|flood-color)="([^"]+)"/g)].map((m) => m[1]).filter((c) => !c.startsWith('url(') && c !== 'none');
      assert.ok(colours.length > 0, `${theme}/${mode}`);
      for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/, `${theme}/${mode}: ${c}`);
    }
  }
});

test('assertHex accepts #rrggbb and throws on anything else', () => {
  assert.equal(assertHex('#a1b2c3', 'k'), '#a1b2c3');
  for (const bad of ['red', '#abc', '#a1b2c3"/><script>', 'url(http://x)', undefined, 42]) {
    assert.throws(() => assertHex(bad, 'k'), TypeError, String(bad));
  }
});

test('every theme has its own style and an unknown theme still throws ThemeError', () => {
  assert.throws(() => artSvg({ ...base, theme: 'nope' }), ThemeError);
  assert.throws(() => artSvg({ ...base, theme: '../themes/dusk' }), ThemeError);
  assert.deepEqual(Object.keys(ART_STYLES).sort(), THEMES, 'one style per shipped theme');
  for (const theme of THEMES) {
    assert.equal(ART_STYLES[theme], theme, theme);
    assert.match(artSvg({ ...base, theme }), new RegExp(`data-art="${theme}"`), theme);
  }
});

test('no two themes give the same bytes for the same seed, in either mode', () => {
  for (const mode of MODES) {
    for (const seed of ['Launch review', 'cover-7']) {
      const seen = new Map();
      for (const theme of THEMES) {
        // the style name and the theme are both in the id prefix; strip ids so only the drawing is compared
        const drawing = artSvg({ ...base, theme, mode, seed }).replace(/\bid="[^"]+"|url\(#[^)]+\)|data-art="[^"]+"/g, '');
        assert.ok(!seen.has(drawing), `${theme} draws the same as ${seen.get(drawing)} (${mode}, ${seed})`);
        seen.set(drawing, theme);
      }
    }
  }
});

test('the three original styles keep their bytes (pinned at HEAD before the move into shared/art/)', () => {
  const pins = JSON.parse(fs.readFileSync(new URL('./fixtures/art-pins.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(pins).length, 90);
  for (const [key, sha] of Object.entries(pins)) {
    const [theme, mode, size, seed] = key.split('|');
    const [width, height] = size.split('x').map(Number);
    const got = crypto.createHash('sha256').update(artSvg({ theme, mode, width, height, seed })).digest('hex');
    assert.equal(got, sha, key);
  }
});

test('the six new styles paint only their own theme tokens, in both modes', () => {
  for (const theme of NEW_STYLES) {
    for (const mode of MODES) {
      const tokens = new Set(Object.values(loadTheme(theme)[mode]).map((v) => v.toLowerCase()));
      const svg = artSvg({ ...base, theme, mode });
      const colours = [...svg.matchAll(/(?:fill|stroke|stop-color|flood-color)="([^"]+)"/g)].map((m) => m[1]).filter((c) => !c.startsWith('url(') && c !== 'none');
      assert.ok(colours.length > 0, `${theme}/${mode} paints something`);
      for (const c of colours) assert.ok(tokens.has(c), `${theme}/${mode}: ${c} is not a ${mode} token`);
    }
  }
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
  const svgs = THEMES.flatMap((theme) => MODES.flatMap((mode) => ['first', 'second'].map((seed) => artSvg({ ...base, theme, mode, seed }))));
  for (const svg of svgs) {
    const own = ids(svg);
    assert.ok(own.length > 0);
    assert.equal(new Set(own).size, own.length, 'unique within one SVG');
    for (const r of refs(svg)) assert.ok(own.includes(r), `dangling url(#${r})`);
  }
  const all = svgs.flatMap(ids);
  assert.equal(new Set(all).size, all.length, 'no id shared between SVGs on one page');
});

test('seed text is never interpolated into the SVG', () => {
  const seed = '<script>alert("x")</script>\'&\u{1F305}';
  for (const theme of THEMES) {
    const svg = artSvg({ ...base, theme, seed });
    for (const bad of ['<script', 'alert', '"x"', "'", '&', '\u{1F305}']) assert.ok(!svg.includes(bad), `${theme} leaks ${bad}`);
  }
});

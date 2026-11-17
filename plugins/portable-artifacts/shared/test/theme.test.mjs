import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, TOKENS, listThemes, loadTheme, themeCss, fontPayloadBytes, ThemeError, themeWeights, nearestWeight } from '../theme.mjs';

test('nine themes ship, paper is the default', () => {
  assert.deepEqual(listThemes(), ['blueprint', 'brief', 'dusk', 'editorial', 'ink', 'mono', 'paper', 'poster', 'press']);
  assert.equal(DEFAULT_THEME, 'paper');
});

test('unknown theme throws ThemeError listing what exists', () => {
  assert.throws(() => loadTheme('papr'), (e) => e instanceof ThemeError && e.available.includes('paper'));
  assert.throws(() => loadTheme('../etc/passwd'), ThemeError, 'names are checked, not resolved as paths');
});

test('themeCss: light tokens on :root, dark under the media query AND data-theme, fonts embedded', () => {
  const css = themeCss(loadTheme('paper'));
  for (const v of ['--page', '--surface', '--text-3', '--s8', '--seq7', '--font-display', '--font', '--mono', '--accent-soft']) {
    assert.ok(css.includes(`${v}:`), v);
  }
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{color-scheme:dark;/);
  assert.match(css, /:root\[data-theme="dark"\]\{color-scheme:dark;/);
  assert.match(css, /@font-face\{font-family:"Geist";font-style:normal;font-weight:400;font-display:swap;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)\}/);
  assert.ok(!/url\((?!data:)/.test(css), 'no external url() anywhere');
});

test('every theme defines every token in both modes and stays within the font budget', () => {
  for (const name of listThemes()) {
    const t = loadTheme(name);
    for (const mode of ['light', 'dark']) for (const k of TOKENS) assert.match(t[mode][k] ?? '', /^#[0-9a-f]{6}$/, `${name}.${mode}.${k}`);
    const files = new Set(Object.values(t.fonts).flatMap((f) => Object.values(f.weights)));
    assert.ok(files.size <= 6, `${name} uses ${files.size} font files`);
    assert.ok(fontPayloadBytes(t) <= 200 * 1024, `${name} fonts ${fontPayloadBytes(t)} bytes`);
  }
});

test('surface steps and the shadow colour are tokens; the elevation scale has a plain fallback before color-mix', () => {
  for (const k of ['surface2', 'surface3', 'shadow']) assert.ok(TOKENS.includes(k), k);
  const css = themeCss(loadTheme('editorial'));
  assert.ok(css.includes('--surface-2:#f8f7f4') && css.includes('--surface-3:#f1f0ed') && css.includes('--shadow:#1b1a17'), 'light steps on :root');
  assert.ok(css.includes('--surface-2:#21201d') && css.includes('--shadow:#080706'), 'dark steps');
  const plain = css.indexOf(':root{--elev-1:');
  const mixed = css.indexOf('@supports (color: color-mix(in srgb, red, red)){:root{--elev-1:');
  assert.ok(plain >= 0 && mixed > plain, 'fallback first, then the color-mix scale');
  for (const n of [1, 2, 3]) assert.match(css.slice(mixed), new RegExp(`--elev-${n}:[^;}]*color-mix\\(in srgb, var\\(--shadow\\) \\d+%, transparent\\)`));
  assert.doesNotMatch(css.slice(plain, mixed), /var\(--shadow\)/, 'the fallback needs no color-mix');
});

test('kind hues and the glow are tokens with their own CSS variables', () => {
  for (const k of ['kindPerson', 'kindService', 'kindData', 'kindQueue', 'kindExternal', 'kindDecision', 'glow']) assert.ok(TOKENS.includes(k), k);
  const css = themeCss(loadTheme('blueprint'));
  assert.ok(css.includes('--k-person:#a3480a'), 'light person hue on :root');
  assert.ok(css.includes('--k-service:#38bdf8'), 'dark service hue');
  assert.ok(css.includes('--glow:#8fd0ff'), 'dark glow');
  for (const v of ['--k-data', '--k-queue', '--k-external', '--k-decision']) assert.ok(css.includes(`${v}:`), v);
});

test('type systems: Geist for paper/blueprint/ink, serif editorial and brief, mono for mono, and the dusk, press and poster pairings', () => {
  const fam = (t, role) => loadTheme(t).fonts[role].family;
  for (const t of ['paper', 'blueprint']) {
    assert.equal(fam(t, 'display'), 'Geist');
    assert.equal(fam(t, 'body'), 'Geist');
  }
  assert.equal(fam('ink', 'display'), 'Bricolage Grotesque');
  assert.equal(fam('ink', 'body'), 'Geist');
  assert.equal(fam('editorial', 'display'), 'Newsreader');
  assert.equal(fam('editorial', 'body'), 'Atkinson Hyperlegible');
  for (const t of ['paper', 'blueprint', 'ink', 'editorial']) assert.equal(fam(t, 'mono'), 'Geist Mono');
  assert.equal(fam('dusk', 'display'), 'Funnel Display');
  assert.equal(fam('dusk', 'body'), 'Host Grotesk');
  assert.equal(fam('dusk', 'mono'), 'Commit Mono');
  assert.equal(fam('press', 'display'), 'Young Serif');
  assert.equal(fam('press', 'body'), 'Schibsted Grotesk');
  assert.equal(fam('press', 'mono'), 'JetBrains Mono');
  assert.equal(fam('poster', 'display'), 'Big Shoulders Display');
  assert.equal(fam('poster', 'body'), 'Familjen Grotesk');
  assert.equal(fam('poster', 'mono'), 'Martian Mono');
  for (const role of ['display', 'body', 'mono']) assert.equal(fam('mono', role), 'JetBrains Mono');
  assert.equal(fam('brief', 'display'), 'Newsreader');
  assert.equal(fam('brief', 'body'), 'Atkinson Hyperlegible');
  assert.equal(fam('brief', 'mono'), 'Geist Mono');
});

test('weights: --display-weight and --strong-weight are declared once, and the value is a weight the theme ships', () => {
  for (const name of listThemes()) {
    const theme = loadTheme(name);
    const css = themeCss(theme);
    for (const [v, role] of [['--display-weight', 'display'], ['--strong-weight', 'body']]) {
      // one declaration only: a later default (typeCss, a dark block) would override the theme value at equal specificity
      const all = [...css.matchAll(new RegExp(`${v}:(\\d+)`, 'g'))].map((m) => Number(m[1]));
      assert.equal(all.length, 1, `${name}: ${v} declared ${all.length} times`);
      assert.ok(Object.keys(theme.fonts[role].weights).map(Number).includes(all[0]), `${name}: ${v} ${all[0]} is not shipped by ${role}`);
    }
  }
});

test('weights: nearest to 600, heavier on a tie; press draws Young Serif at 400, editorial strong text at 700', () => {
  assert.equal(nearestWeight({ weights: { 400: 'a', 700: 'b' } }), 700);
  assert.equal(nearestWeight({ weights: { 400: 'a', 800: 'b' } }), 800, 'a tie goes to the heavier');
  assert.equal(nearestWeight({ weights: { 400: 'a' } }), 400);
  assert.deepEqual(themeWeights(loadTheme('press')), { display: 400, strong: 700 });
  assert.deepEqual(themeWeights(loadTheme('blueprint')), { display: 600, strong: 600 });
  assert.equal(themeWeights(loadTheme('editorial')).strong, 700);
});

// Theme JSON -> CSS custom properties (light, dark, data-theme overrides) and
// @font-face rules with embedded woff2. Zero dependencies: skills with
// different lockfiles import this file from their own shared/ copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeCss } from './type.mjs';
import { withTokenFallbacks } from './contrast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEMES = path.join(HERE, 'themes');
const FONTS = path.join(HERE, 'fonts');
const NAME = /^[a-z][a-z0-9-]*$/;

export const DEFAULT_THEME = 'paper';

// JSON token -> CSS variable. The CSS names are the ones template/page.html
// and template/runtime.js read; keep them stable.
const VARS = {
  page: '--page', surface: '--surface', text: '--text', text2: '--text-2', text3: '--text-3',
  // surface steps above --surface (light: darker wells and bands; dark: lighter raised steps) and the colour the
  // elevation scale (--elev-1..3) mixes its shadows from
  surface2: '--surface-2', surface3: '--surface-3', shadow: '--shadow',
  line: '--line', grid: '--grid', accent: '--accent', accentSoft: '--accent-soft',
  warn: '--warn', good: '--good', bad: '--bad',
  cat1: '--s1', cat2: '--s2', cat3: '--s3', cat4: '--s4', cat5: '--s5', cat6: '--s6', cat7: '--s7', cat8: '--s8',
  seq1: '--seq1', seq2: '--seq2', seq3: '--seq3', seq4: '--seq4', seq5: '--seq5', seq6: '--seq6', seq7: '--seq7',
  // make-diagram's kind families (one hue each) and the dark-mode glow
  kindPerson: '--k-person', kindService: '--k-service', kindData: '--k-data', kindQueue: '--k-queue', kindExternal: '--k-external', kindDecision: '--k-decision',
  glow: '--glow',
};
export const TOKENS = Object.keys(VARS);

export class ThemeError extends Error {
  constructor(name, available) {
    super(`unknown theme ${JSON.stringify(name)}; available: ${available.join(', ')}`);
    this.name = 'ThemeError';
    this.available = available;
  }
}

export function listThemes() {
  return fs.readdirSync(THEMES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

export function loadTheme(name) {
  const available = listThemes();
  if (!NAME.test(String(name)) || !available.includes(name)) throw new ThemeError(name, available);
  return JSON.parse(fs.readFileSync(path.join(THEMES, `${name}.json`), 'utf8'));
}

const family = (f) => `"${f.family}", ${f.fallback}`;

const WANTED_WEIGHT = 600; // what headings and strong labels ask for
/**
 * The weight of `role` (a theme font role) nearest to `wanted`, the heavier on a tie. A weight the font does not
 * ship is drawn by the browser as synthesised bold (Young Serif in press ships 400 only), so pages ask for a real one.
 */
export function nearestWeight(role, wanted = WANTED_WEIGHT) {
  const have = Object.keys(role.weights).map(Number).sort((a, b) => a - b);
  return have.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) || (Math.abs(w - wanted) === Math.abs(best - wanted) && w > best) ? w : best), have[0]);
}

/** { display, strong }: the heading weight (display font) and the emphasis weight (body font) the theme ships. */
export const themeWeights = (theme) => ({ display: nearestWeight(theme.fonts.display), strong: nearestWeight(theme.fonts.body) });

// Fonts and weights are mode-independent: they are declared once, on the light :root, and never repeated, so no
// later block can override them.
// A token is written only when it holds a value: never `undefined`, `null` or `NaN`. surface2, surface3 and shadow,
// which older themes lack, are derived first (see withTokenFallbacks); any other missing token is left out.
const hasValue = (v) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));

function vars(rawTokens, theme) {
  const tokens = withTokenFallbacks(rawTokens);
  const colours = TOKENS.filter((k) => hasValue(tokens[k])).map((k) => `${VARS[k]}:${tokens[k]}`).join(';');
  if (!theme) return colours;
  const { fonts } = theme;
  const w = themeWeights(theme);
  return `${colours};--font-display:${family(fonts.display)};--font:${family(fonts.body)};--mono:${family(fonts.mono)}`
    + `;--display-weight:${w.display};--strong-weight:${w.strong}`;
}

// One @font-face per distinct family+weight across the three roles.
function faces(theme) {
  const seen = new Map();
  for (const role of Object.values(theme.fonts)) {
    for (const [weight, file] of Object.entries(role.weights)) seen.set(`${role.family}|${weight}`, { family: role.family, weight, file });
  }
  return [...seen.values()];
}

export function fontPayloadBytes(theme) {
  return [...new Set(faces(theme).map((f) => f.file))].reduce((n, file) => n + fs.statSync(path.join(FONTS, file)).size, 0);
}

// The elevation scale: two shadow layers per level as [y, blur, strength %]. One light source (straight above), so
// every level only moves down. With color-mix the shadows take the theme's --shadow hue (tinted, never plain grey);
// older browsers get black at the same strength, declared first.
const ELEVATION = [
  [[1, 2, 8], [2, 6, 6]],
  [[2, 6, 10], [10, 24, 10]],
  [[6, 16, 14], [20, 48, 16]],
];
const elevation = (paint) => ELEVATION.map((layers, i) => `--elev-${i + 1}:${layers.map(([y, blur, p]) => `0 ${y}px ${blur}px ${paint(p)}`).join(',')}`).join(';');
const ELEVATION_CSS = [
  `:root{${elevation((p) => `rgba(0,0,0,${p / 100})`)}}`,
  `@supports (color: color-mix(in srgb, red, red)){:root{${elevation((p) => `color-mix(in srgb, var(--shadow) ${p}%, transparent)`)}}}`,
].join('\n');

export function themeCss(theme) {
  const fontFaces = faces(theme).map(({ family: fam, weight, file }) => {
    const b64 = fs.readFileSync(path.join(FONTS, file)).toString('base64');
    return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  });
  return [
    ...fontFaces,
    `:root{color-scheme:light;${vars(theme.light, theme)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(theme.dark)}}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${vars(theme.dark)}}`,
    ELEVATION_CSS,
    typeCss(),
  ].join('\n');
}

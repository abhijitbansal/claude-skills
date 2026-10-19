// Theme JSON -> CSS custom properties (light, dark, data-theme overrides) and
// @font-face rules with embedded woff2. Zero dependencies: skills with
// different lockfiles import this file from their own shared/ copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typeCss } from './type.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEMES = path.join(HERE, 'themes');
const FONTS = path.join(HERE, 'fonts');
const NAME = /^[a-z][a-z0-9-]*$/;

export const DEFAULT_THEME = 'paper';

// JSON token -> CSS variable. The CSS names are the ones template/page.html
// and template/runtime.js read; keep them stable.
const VARS = {
  page: '--page', surface: '--surface', text: '--text', text2: '--text-2', text3: '--text-3',
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

function vars(tokens, fonts) {
  const colours = TOKENS.map((k) => `${VARS[k]}:${tokens[k]}`).join(';');
  return fonts
    ? `${colours};--font-display:${family(fonts.display)};--font:${family(fonts.body)};--mono:${family(fonts.mono)}`
    : colours;
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

export function themeCss(theme) {
  const fontFaces = faces(theme).map(({ family: fam, weight, file }) => {
    const b64 = fs.readFileSync(path.join(FONTS, file)).toString('base64');
    return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  });
  return [
    ...fontFaces,
    `:root{color-scheme:light;${vars(theme.light, theme.fonts)}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){color-scheme:dark;${vars(theme.dark)}}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${vars(theme.dark)}}`,
    typeCss(),
  ].join('\n');
}

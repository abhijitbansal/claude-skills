// Guards templates against ad-hoc underlines and unbundled fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const SOURCES = ['make-explainer/template/base.css', 'make-explainer/template/chart.css', 'make-explainer/template/diagram.css',
  'make-explainer/template/motion.css', 'make-explainer/template/slides.html', 'make-explainer/template/page.html',
  'make-diagram/template/viewer.html', 'make-diagram/scripts/lib/css.mjs', 'make-dashboard/template/page.html', 'make-motion/template/styles.css'];

export const findUnderlines = (css) => [...css.matchAll(/text-decoration(?:-line)?\s*:\s*[^;}]*underline/g)].map((m) => m[0]);
export const findFontFamilies = (css) => [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());

// Split on whitespace outside parentheses.
const topLevelTokens = (v) => {
  const out = []; let depth = 0; let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
// The family part of a `font:` shorthand: everything after the size[/line-height] token.
export function shorthandFamily(value) {
  const t = topLevelTokens(value);
  if (t.length === 1) return t[0];
  const i = t.findIndex((x) => /^(?:\.?\d|var\(--fs|clamp\(|calc\()/.test(x) && !/^\d{3}$/.test(x));
  return i < 0 ? '' : t.slice(i + 1).join(' ');
}
export const findShorthandFamilies = (css) => [...css.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/g)].map((m) => shorthandFamily(m[1])).filter(Boolean);
export const findFontVars = (css) => [...css.matchAll(/(--(?:font|font-display|mono|sans)|--[\w-]*font[\w-]*)\s*:\s*([^;}]+)/g)].map((m) => m[2].trim());

// Only the FIRST family is checked: a theme variable, a generic/system keyword, or a bundled family.
// Inter, JetBrains Mono and --sans are make-motion's own bundled default look, so only its sources may use them.
const BASE_BUNDLED = ['Geist', 'Geist Mono', 'Newsreader', 'Bricolage Grotesque', 'Atkinson Hyperlegible'];
const MOTION_BUNDLED = ['Inter', 'JetBrains Mono'];
const KEYWORDS = 'inherit|system-ui|-apple-system|ui-monospace|monospace|sans-serif|serif';
export function allowedFamily(skill) {
  const motion = skill === 'make-motion';
  const names = (motion ? [...BASE_BUNDLED, ...MOTION_BUNDLED] : BASE_BUNDLED).join('|');
  const vars = motion ? 'font|font-display|mono|sans' : 'font|font-display|mono';
  return new RegExp(`^(?:var\\(--(?:${vars})\\)|${KEYWORDS}|(['"])(?:${names})\\1|(?:${names}))\\s*(?:,|$)`);
}

// strip @font-face -> find every family declaration (font-family, font shorthand, font custom properties) -> match.
export function lintFonts(src, skill) {
  const re = allowedFamily(skill);
  const body = src.replace(/@font-face\s*\{[^}]*\}/g, '');
  return [...findFontFamilies(body), ...findShorthandFamilies(body), ...findFontVars(body)]
    .filter((fam) => !re.test(fam));
}

test('lint catches what it should (guardrail proof)', () => {
  assert.deepEqual(findUnderlines('a{text-decoration: underline}'), ['text-decoration: underline']);
  assert.deepEqual(findUnderlines('a{text-decoration-line:underline}'), ['text-decoration-line:underline']);
  assert.deepEqual(lintFonts("a{font-family:'Comic Sans MS'}", 'make-explainer'), ["'Comic Sans MS'"]);
  assert.deepEqual(lintFonts("a{font-family:'Comic Sans MS', var(--font)}", 'make-explainer'), ["'Comic Sans MS', var(--font)"]);
  assert.deepEqual(lintFonts("a{font: 600 1rem 'Comic Sans MS'}", 'make-explainer'), ["'Comic Sans MS'"]);
  assert.deepEqual(lintFonts("a{font: 600 clamp(1rem, 2vw, 3rem)/1.1 'Comic Sans MS', serif}", 'make-explainer'), ["'Comic Sans MS', serif"]);
  assert.deepEqual(lintFonts(":root{--sans: 'Comic Sans MS'}", 'make-motion'), ["'Comic Sans MS'"]);
  assert.deepEqual(lintFonts(":root{--ui-font: 'Comic Sans MS'}", 'make-explainer'), ["'Comic Sans MS'"]);
  // Inter / --sans belong to make-motion only.
  assert.deepEqual(lintFonts("a{font-family:'Inter', sans-serif}", 'make-explainer'), ["'Inter', sans-serif"]);
  assert.deepEqual(lintFonts('a{font-family:var(--sans)}', 'make-dashboard'), ['var(--sans)']);
  assert.deepEqual(lintFonts("a{font-family:'Inter', sans-serif}", 'make-motion'), []);
  // the passing shapes
  assert.deepEqual(lintFonts('a{font: 600 var(--fs-lg)/var(--lh-head) var(--font-display); font: 12px/1.5 var(--mono); font: inherit}', 'make-explainer'), []);
  assert.deepEqual(lintFonts("a{font-family:'Geist Mono', monospace}", 'make-diagram'), []);
});

for (const rel of SOURCES) {
  test(`${rel}: no ad-hoc underline; fonts come from theme variables`, () => {
    const skill = rel.split('/')[0];
    const src = fs.readFileSync(path.join(SKILLS, rel), 'utf8');
    assert.deepEqual(findUnderlines(src), []);
    // make-diagram css.mjs interpolates its emoji stack from EMOJI_FONTS, which is asserted below.
    assert.deepEqual(lintFonts(src.replace(/font-family:\$\{EMOJI_FONTS\}/g, ''), skill), [], `${rel}: unbundled font family`);
  });
}

test('make-diagram EMOJI_FONTS holds only emoji and system families', () => {
  const src = fs.readFileSync(path.join(SKILLS, 'make-diagram/scripts/lib/css.mjs'), 'utf8');
  const m = src.match(/const EMOJI_FONTS = '([^']+)'/);
  assert.ok(m, 'EMOJI_FONTS constant found');
  const families = m[1].split(',').map((f) => f.trim().replace(/^"|"$/g, ''));
  const OK = new Set(['Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'sans-serif']);
  for (const f of families) assert.ok(OK.has(f), `unexpected emoji-stack family ${f}`);
});

test('nav links keep text-decoration:none against the shared li a prose-link rule', () => {
  const base = fs.readFileSync(path.join(SKILLS, 'make-explainer/template/base.css'), 'utf8');
  const slides = fs.readFileSync(path.join(SKILLS, 'make-explainer/template/slides.html'), 'utf8');
  assert.match(base, /\.toc a \{[^}]*text-decoration: none/);
  assert.match(slides, /\.outline-list a \{[^}]*text-decoration: none/);
});

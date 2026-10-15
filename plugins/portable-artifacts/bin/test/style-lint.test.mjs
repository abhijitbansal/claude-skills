// Guards templates against ad-hoc underlines and unbundled fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const SOURCES = ['make-explainer/template/base.css', 'make-explainer/template/slides.html', 'make-explainer/template/page.html',
  'make-diagram/template/viewer.html', 'make-diagram/scripts/lib/css.mjs', 'make-dashboard/template/page.html', 'make-motion/template/styles.css'];

export const findUnderlines = (css) => [...css.matchAll(/text-decoration(?:-line)?\s*:\s*[^;}]*underline/g)].map((m) => m[0]);
export const findFontFamilies = (css) => [...css.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());

// Only the FIRST family is checked: a theme variable, a generic/system keyword, or a bundled family.
// Inter and JetBrains Mono are make-motion's own bundled default look. --sans is motion's alias for Inter.
const VARS = 'var\\(--(?:font|font-display|mono|sans)\\)';
const KEYWORDS = 'inherit|system-ui|-apple-system|ui-monospace|monospace|sans-serif|serif';
const BUNDLED = ['Geist', 'Geist Mono', 'Newsreader', 'Bricolage Grotesque', 'Atkinson Hyperlegible', 'Inter', 'JetBrains Mono'].join('|');
const ALLOWED_FAMILY = new RegExp(`^(?:${VARS}|${KEYWORDS}|(['"])(?:${BUNDLED})\\1|(?:${BUNDLED}))\\s*(?:,|$)`);
// An emoji stack is interpolated from a JS constant in css.mjs; its first family is a colour-emoji font.
// (the capture stops at the closing brace, so it arrives as "${EMOJI_FONTS").
const EMOJI_STACK = /^\$\{EMOJI_FONTS\}?$/;

test('lint catches what it should (guardrail proof)', () => {
  assert.deepEqual(findUnderlines('a{text-decoration: underline}'), ['text-decoration: underline']);
  assert.deepEqual(findUnderlines('a{text-decoration-line:underline}'), ['text-decoration-line:underline']);
  assert.equal(ALLOWED_FAMILY.test("'Comic Sans MS'"), false);
  assert.equal(ALLOWED_FAMILY.test("'Comic Sans MS', var(--font)"), false);
  assert.equal(ALLOWED_FAMILY.test('var(--font), Arial'), true);
  assert.equal(ALLOWED_FAMILY.test("'Geist Mono', monospace"), true);
});

for (const rel of SOURCES) {
  test(`${rel}: no ad-hoc underline; fonts come from theme variables`, () => {
    const src = fs.readFileSync(path.join(SKILLS, rel), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '');
    assert.deepEqual(findUnderlines(src), []);
    for (const fam of findFontFamilies(src)) {
      if (EMOJI_STACK.test(fam)) continue;
      assert.match(fam, ALLOWED_FAMILY, `${rel}: font-family ${fam}`);
    }
  });
}

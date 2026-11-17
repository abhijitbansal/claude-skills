// Every display-font weight the page template asks for is drawn from a real face in every theme: no browser
// faux bold (press ships Young Serif 400 only, and an h1 at 600 used to come out smeared).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listThemes, loadTheme, themeWeights } from '../shared/theme.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'template/page.html'), 'utf8');
const BOLD = 600; // from here a browser synthesises bold when no face is heavy enough

// [selector, declarations] for every rule in the template's own <style> that sets the display font.
function displayRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*var\(--font-display\)[^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
// A literal weight, or the theme's weight token resolved the way shared/theme.mjs declares it; 400 when none is set.
function weightOf(decls, theme) {
  const token = /(?:font:|font-weight:)\s*var\(--(display|strong)-weight\)/.exec(decls)?.[1];
  if (token) return themeWeights(theme)[token];
  return Number(/font:\s*(\d{3})\s/.exec(decls)?.[1] ?? /font-weight:\s*(\d{3})/.exec(decls)?.[1] ?? 400);
}

test('weightOf reads the weight tokens, not 400', () => {
  const press = loadTheme('press');
  const paper = loadTheme('paper');
  assert.equal(weightOf('font: var(--display-weight) 1px/1 var(--font-display)', paper), themeWeights(paper).display);
  assert.equal(weightOf('font-weight: var(--display-weight); font-family: var(--font-display)', press), themeWeights(press).display);
  assert.equal(weightOf('font: 700 1px/1 var(--font-display)', press), 700);
});

test('every display-font weight the template requests exists in each theme, or synthesis is off', () => {
  const rules = displayRules(PAGE);
  assert.ok(rules.length > 0, 'the template sets the display font somewhere');
  const problems = [];
  for (const name of listThemes()) {
    const theme = loadTheme(name);
    const weights = Object.keys(theme.fonts.display.weights).map(Number);
    for (const [selector, decls] of rules) {
      const wanted = weightOf(decls, theme);
      const real = weights.includes(wanted) || (wanted >= BOLD && weights.some((w) => w >= BOLD));
      if (!real && !/font-synthesis:\s*none/.test(decls)) problems.push(`${name}: ${selector} asks for ${wanted}; the display font has ${weights.join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

// The declarations of the one template rule whose selector is exactly `selector`.
function rule(selector) {
  const css = PAGE.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector);
  assert.equal(found.length, 1, `one rule for ${selector}`);
  return found[0][2];
}

test('type roles: the page title is the second display step, a chart title the claim in the display face', () => {
  assert.match(rule('h1'), /font:\s*var\(--display-weight\)\s+var\(--fs-d2\)\/var\(--lh-tight\)\s+var\(--font-display\)/);
  const h2 = rule('.card h2');
  assert.match(h2, /font:\s*var\(--display-weight\)\s+var\(--fs-md\)\/var\(--lh-tight\)\s+var\(--font-display\)/);
  assert.match(h2, /text-wrap:\s*balance/);
});

test('type roles: the KPI numeral is the third display step at most, in the display face', () => {
  const value = rule('.kpi-value');
  assert.match(value, /font-family:\s*var\(--font-display\)/);
  assert.match(value, /font-size:\s*min\(var\(--fs-d3\),\s*var\(--kpi-fit\)\)/);
  assert.match(value, /font-weight:\s*var\(--display-weight\)/);
});

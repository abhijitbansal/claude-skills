// Every display-font weight the page template asks for is drawn from a real face in every theme: no browser
// faux bold (press ships Young Serif 400 only, and an h1 at 600 used to come out smeared).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listThemes, loadTheme } from '../shared/theme.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'template/page.html'), 'utf8');
const BOLD = 600; // from here a browser synthesises bold when no face is heavy enough

// [selector, declarations] for every rule in the template's own <style> that sets the display font.
function displayRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*var\(--font-display\)[^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}
const weightOf = (decls) => Number(/font:\s*(\d{3})\s/.exec(decls)?.[1] ?? /font-weight:\s*(\d{3})/.exec(decls)?.[1] ?? 400);

test('every display-font weight the template requests exists in each theme, or synthesis is off', () => {
  const rules = displayRules(PAGE);
  assert.ok(rules.length > 0, 'the template sets the display font somewhere');
  const problems = [];
  for (const name of listThemes()) {
    const weights = Object.keys(loadTheme(name).fonts.display.weights).map(Number);
    for (const [selector, decls] of rules) {
      const wanted = weightOf(decls);
      const real = weights.includes(wanted) || (wanted >= BOLD && weights.some((w) => w >= BOLD));
      if (!real && !/font-synthesis:\s*none/.test(decls)) problems.push(`${name}: ${selector} asks for ${wanted}; the display font has ${weights.join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

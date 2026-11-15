// G-65: a pin on the stylesheet itself, so the poster rules cannot disappear unseen. What they do to the layout
// (one heading height on every slide, room beside the ghost numeral) is measured by a browser test in
// slides-browser.test.mjs, listed for the serial browser run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../template/deck-flavors.css', import.meta.url), 'utf8');
const CONTENT = ':root\\[data-flavor="poster"\\] \\.slide:not\\(\\.slide-has-art\\):not\\(\\.slide-cover\\)';

test('poster: a content slide is pinned to the top and the base margin: auto is left to the other themes', () => {
  assert.match(css, new RegExp(`${CONTENT} \\.slide-inner \\{ margin-block: 0 auto; \\}`));
  assert.doesNotMatch(css, /:root\[data-flavor\] \.slide-inner[^{]*\{[^}]*margin-block: 0 auto/, 'only the poster is pinned');
});

test('poster: the title reserves room beside the ghost numeral above 900 px, where the numeral shows', () => {
  assert.match(css, new RegExp(`@media \\(min-width: 901px\\) \\{\\s*${CONTENT} \\.slide-title \\{ padding-inline-end: clamp\\(`));
  assert.match(css, /\.slide:not\(\.slide-has-art\)::before \{ display: none; \}/, 'the numeral is hidden at 900 px and below');
});

test('poster: the numeral is at most 12rem, so the reservation (13.2rem) covers it', () => {
  assert.match(css, /font-size: clamp\(5rem, 1rem \+ 9vw, 12rem\)/);
  assert.match(css, /padding-inline-end: clamp\(5\.5rem, 1\.1rem \+ 9\.9vw, 13\.2rem\)/);
});

// The explainer refresh (hero, section rhythm, cards, quote, deck title and closing slides) as stylesheet contracts.
// The pixels are judged by looking (the look gate); these tests pin the rules a later edit could silently drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8');
const STYLESHEETS = ['base.css', 'flavors.css', 'deck-flavors.css', 'deck-art.css', 'quote.css'];
// The declaration block of the first rule whose selector is exactly `sel`, anywhere in the sheet.
const rule = (css, sel) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.[\]()*+?^$|]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

// A print rule may only clear a shadow, or draw the flavored look's hairline ring in ink (inset, no blur, --text):
// never a soft or offset shadow, which prints as a grey box.
const PRINT_SHADOW = /^(?:none\b|inset 0 0 0 \d(?:\.\d)?px var\(--text\))/;

test('print rules carry no soft box-shadow in any explainer stylesheet', () => {
  for (const file of STYLESHEETS) {
    const print = read(file).split('@media print {')[1] ?? '';
    for (const m of print.matchAll(/box-shadow:\s*([^;}]*)/g)) {
      assert.match(m[1].trim(), PRINT_SHADOW, `${file}: a print rule sets box-shadow ${m[1].trim()}`);
    }
  }
});

test('print resets every shadow the screen rules add: the band, the quote and the deck art', () => {
  const printBase = read('base.css').split('@media print {')[1] ?? '';
  assert.match(printBase, /\.sec-alt[^{]*\{[^}]*box-shadow: none/, 'the lifted band is flat in print');
  assert.ok(!/box-shadow/.test(read('quote.css')), 'the quote is flat: no shadow to reset');
  const art = read('deck-art.css').split('@media print {')[1] ?? '';
  assert.match(art, /\.slide-art[^{]*\{[^}]*display: none/, 'the deck art does not print');
});

test('hero: air above the verdict card, and quiet meta chips (no box) on a classic page only', () => {
  const base = read('base.css');
  assert.match(rule(base, '.hero-tldr'), /margin: var\(--sp-7\) calc\(-1 \* var\(--band-x\)\) 0/);
  const quiet = rule(base, ':root[data-flavor="classic"] .hero .meta div');
  assert.match(quiet, /border: 0/);
  assert.match(quiet, /background: none/);
  // the flavored pages and the deck cover still get the boxed chip their own rules were drawn over
  const chip = rule(base, '.meta div');
  assert.match(chip, /border: 1px solid var\(--line\)/);
  assert.match(chip, /background: var\(--surface\)/);
});

test('the KPI label keeps the second text ink the caps style would have lightened', () => {
  assert.match(rule(read('base.css'), '.kpi dt'), /color: var\(--text-2\)/);
});

test('rhythm: the gap between sections depends on their role, by two tokens', () => {
  const base = read('base.css');
  assert.match(base, /--gap-text: \d+px/);
  assert.match(base, /--gap-band: \d+px/);
  assert.match(rule(base, '.sec + .sec'), /margin-top: var\(--gap-band\)/);
  assert.match(rule(base, '.sec-text + .sec-text'), /margin-top: var\(--gap-text\)/);
});

test('bands lift with the shared elevation', () => {
  assert.match(rule(read('base.css'), '.sec-alt'), /box-shadow: var\(--elev-1\)/);
});

test('cards and columns: a tone is a top rule, not a full border; the heading is a step up', () => {
  const base = read('base.css');
  assert.ok(!/\.card\.tone-accent \{ border-color/.test(base), 'no full accent border on a card');
  assert.ok(!/\.cmp-col\.tone-accent \{ border-color/.test(base), 'no full accent border on a column');
  const top = rule(base, '.card:not(.tone-neutral), .cmp-col:not(.tone-neutral)');
  assert.match(top, /border-top: var\(--card-rule\) solid var\(--tc\)/);
  assert.match(rule(base, '.card-head h3'), /font-size: var\(--fs-md\)/);
  assert.match(rule(base, '.cmp-col h3'), /font-size: var\(--fs-md\)/);
});

test('the quote: display face, a hanging mark, and no motion of its own', () => {
  const css = read('quote.css');
  assert.match(rule(css, '.quote blockquote'), /font: var\(--display-weight\)/);
  assert.match(rule(css, '.quote blockquote'), /var\(--font-display\)/);
  assert.match(css, /\.quote blockquote::before \{[^}]*content: "\\201C"/, 'the opening mark is drawn by the stylesheet');
  assert.match(rule(css, '.quote blockquote'), /text-indent: -0\.\d+em/, 'the first line is pulled back by the mark, so the mark hangs');
  assert.ok(!/transition|animation/.test(css), 'a quote adds no motion');
});

test('on a phone the cover chips are plain text on the scrim: no fill behind a box that has no padding', () => {
  const phone = read('deck-art.css').split('@media (max-width: 640px) {')[1] ?? '';
  assert.match(phone, /\.slide-cover \.meta div \{ background: none; \}/);
  // base.css has two 640px blocks (the stacked risks table, then the hero and layout): the chip rule is in the last
  assert.match(read('base.css').split('@media (max-width: 640px) {').at(-1), /\n {2}\.meta div \{ padding: 0; border: 0; background: none; \}/);
});

test('the cover and the closing slide: the cover takes the scrim, the closing slide centres one statement', () => {
  const css = read('deck-art.css');
  assert.match(rule(css, '.slide-cover .slide-inner'), /background: var\(--scrim\)/);
  assert.match(css, /\.slide-close \.slide-inner \{/);
  assert.match(css, /\.slide-close \.lead/);
});

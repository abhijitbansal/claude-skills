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

// ---- the look-gate round: feathered cards, art out of the text, one-line colophon --------------------------------

const CLASSIC = ':root[data-flavor="classic"]';
// `box-shadow: 0 0 <blur>px <spread>px var(--page)` -> { blur, spread }
const halo = (decl) => {
  const m = /box-shadow: 0 0 (\d+)px (\d+)px var\(--page\)/.exec(decl);
  return m ? { blur: Number(m[1]), spread: Number(m[2]) } : null;
};

test('a classic title card is solid page under the text with a feathered halo, never a hard-edged scrim', () => {
  const card = rule(read('deck-art.css'), `${CLASSIC} .slide-cover .slide-inner`);
  assert.match(card, /background: var\(--page\)/, 'solid under the text: no art behind a letter, however the art is drawn');
  assert.match(card, /padding: 0/, 'the title sits at the slide gutter, as the page hero does');
  const h = halo(card);
  assert.ok(h, 'a halo of the page colour round the card');
  assert.ok(h.blur >= 24, 'a wide feather');
  assert.ok(h.spread >= h.blur, 'the halo is ~98% opaque where it meets the card: no outline of the box, no band of faded art touching a letter');
  assert.ok(!/--scrim/.test(card), 'not the translucent scrim');
});

test('a classic closing card and its footer feather the same way', () => {
  const css = read('deck-art.css');
  const card = rule(css, `${CLASSIC} .slide-has-art:not(.slide-cover) .slide-inner`);
  const foot = rule(css, `${CLASSIC} .slide-has-art:not(.slide-cover) .pa-footer`);
  for (const [name, decl] of [['card', card], ['footer', foot]]) {
    const h = halo(decl);
    assert.ok(h, `${name}: a feathered halo`);
    assert.ok(h.spread >= h.blur * 0.7, `${name}: opaque at the edge`);
    if (name === 'card') assert.ok(h.spread >= h.blur, 'the card: no outline of the box shows against the art');
  }
});

test('the title slide chips are the page\'s unboxed caps labels on a classic deck', () => {
  const chip = rule(read('deck-art.css'), `${CLASSIC} .slide-cover .meta div`);
  assert.match(chip, /padding: 0/);
  assert.match(chip, /border: 0/);
  assert.match(chip, /background: none/);
  assert.match(rule(read('deck-art.css'), `${CLASSIC} .slide-cover .meta`), /gap: 6px 22px/, 'the page hero\'s spacing between labels');
});

test('the phone title is no smaller than the page hero\'s phone size (about 38px at 390 wide)', () => {
  const phone = read('deck-art.css').split('@media (max-width: 640px) {')[1] ?? '';
  const m = /\.slide-cover h1 \{ font-size: clamp\(([\d.]+)rem, ([\d.]+)vw, ([\d.]+)rem\); \}/.exec(phone);
  assert.ok(m, 'the phone cover title size');
  assert.ok(Math.max(Number(m[1]) * 16, Math.min(390 * Number(m[2]) / 100, Number(m[3]) * 16)) >= 38, 'at least 38px on a 390px phone');
});

test('orientation picks the wide or the tall art over the colour-mode rules', () => {
  const css = read('deck-art.css');
  assert.match(css, /@media \(orientation: landscape\) \{ \.slide-art \.art-tall \{ display: none !important; \} \}/);
  assert.match(css, /@media \(orientation: portrait\) \{ \.slide-art \.art-wide \{ display: none !important; \} \}/);
});

test('the colophon is one quiet nowrap line in the small size, on one class', () => {
  const line = rule(read('deck-art.css'), '.pa-colophon');
  assert.match(line, /white-space: nowrap/);
  assert.match(line, /font-size: var\(--fs-xs\)/);
  assert.match(line, /color: var\(--text-2\)/);
});

test('the closing verdict is set in the heading face', () => {
  assert.match(read('deck-art.css'), /\.slide-close \.lead \{ font-family: var\(--font-display\); \}/);
});

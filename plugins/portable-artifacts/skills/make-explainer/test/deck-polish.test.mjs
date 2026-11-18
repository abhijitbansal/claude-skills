// Look gate round 2 (r13): the title and closing slides' art and colophon, as rules a later edit could silently drop.
// The pixels are judged by looking; these pin what can be stated: no placeholder-looking bars, ink kept clear of the
// card, the colophon on the slide's own ground, the stamp's word, the crease that does not glow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deckArtPair, WIDE, TALL } from '../scripts/lib/deck-art.mjs';
import { loadTheme } from '../shared/theme.mjs';

const read = (f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8');
const rule = (css, sel) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.[\]()*+?^$|]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
const pictures = (html) => html.split('</svg>').filter(Boolean).map((s) => `${s}</svg>`);
const SEEDS = ['a', 'b', 'Four skills, one rule2', 'Four skills, one rule12', 'closing', 'seed 7', 'seed 8'];
const numbers = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

// ---- N1: editorial reads as a newspaper, not a loading skeleton -----------------------------------------------------

test('editorial: no rows of grey text bars; a masthead, column hairlines and one fleuron', () => {
  for (const seed of SEEDS) {
    for (const svg of pictures(deckArtPair('editorial', seed))) {
      assert.ok((svg.match(/<rect /g) ?? []).length <= 6, `seed ${seed}: more than a few rects means rows of bars`);
      assert.equal((svg.match(/data-art-part="fleuron"/g) ?? []).length, 1, 'one fleuron');
      assert.ok(/data-art-part="column-rules"/.test(svg), 'column hairlines');
      assert.ok(/data-art-part="masthead"/.test(svg), 'a masthead rule');
    }
  }
});

test('editorial: a phone picture has column hairlines too (two or more columns)', () => {
  const tall = pictures(deckArtPair('editorial', SEEDS[2]))[2];
  const d = /data-art-part="column-rules" d="([^"]*)"/.exec(tall)?.[1];
  assert.ok(d, 'column rules path');
  assert.ok(d.split('M').filter(Boolean).length >= 2, 'at least two hairlines on a portrait picture');
});

// ---- N2: ink strokes stay in a margin the card never reaches --------------------------------------------------------

function inkParts(svg) {
  const m = /<g fill="#[0-9a-f]{6}" opacity="\.82">(.*?)<\/g><g fill="#[0-9a-f]{6}" opacity="\.6">(.*?)<\/g>/.exec(svg);
  assert.ok(m, 'the ink strokes and specks groups');
  const strokes = [...m[1].matchAll(/<path d="([^"]*)"/g)].map((p) => numbers(p[1]));
  const specks = [...m[2].matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g)].map((c) => [Number(c[1]), Number(c[2]), Number(c[3])]);
  return { strokes, specks };
}

test('ink: on a wide picture every stroke point and speck sits in the right margin, clear of the title and closing cards', () => {
  for (const seed of SEEDS) {
    const wide = pictures(deckArtPair('ink', seed))[0];
    const { strokes, specks } = inkParts(wide);
    assert.ok(strokes.length >= 1, 'strokes are drawn');
    for (const nums of strokes) {
      for (let i = 0; i < nums.length; i += 2) assert.ok(nums[i] >= WIDE.width * 0.82, `seed ${seed}: a stroke point at x=${nums[i]} is left of the margin`);
    }
    for (const [x, , r] of specks) assert.ok(x - r >= WIDE.width * 0.82, `seed ${seed}: a speck at x=${x}`);
  }
});

test('ink: on a tall picture every stroke point and speck sits in the top band, above the card', () => {
  for (const seed of SEEDS) {
    const tall = pictures(deckArtPair('ink', seed))[2];
    const { strokes, specks } = inkParts(tall);
    assert.ok(strokes.length >= 1);
    for (const nums of strokes) {
      for (let i = 1; i < nums.length; i += 2) assert.ok(nums[i] <= TALL.height * 0.16, `seed ${seed}: a stroke point at y=${nums[i]} is below the band`);
    }
    for (const [, y, r] of specks) assert.ok(y + r <= TALL.height * 0.16, `seed ${seed}: a speck at y=${y}`);
  }
});

// ---- N7: the brief stamp has its word ------------------------------------------------------------------------------

test('brief: the stamp carries a word and is never an empty frame', () => {
  for (const svg of pictures(deckArtPair('brief', SEEDS[2]))) {
    const stamp = /<g data-art-part="stamp"[^>]*>(.*?)<\/g>/.exec(svg)?.[1] ?? '';
    assert.match(stamp, /<text [^>]*>FILED<\/text>/, 'a word inside the frame');
  }
});

// ---- N8: paper's dark crease is a shadow, not a glow ----------------------------------------------------------------

test('paper dark: the crease gradients carry no light stop; light mode is unchanged', () => {
  const t = loadTheme('paper');
  const [lightWide, darkWide] = pictures(deckArtPair('paper', SEEDS[2]));
  const stops = (svg) => [...svg.matchAll(/<stop offset="[^"]*" stop-color="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.ok(stops(lightWide).includes(t.light.text), 'light: the crease is the text colour at low opacity (unchanged)');
  assert.ok(stops(darkWide).length > 0, 'dark: still a crease');
  assert.ok(!stops(darkWide).includes(t.dark.text), 'dark: the crease is not the light text colour, which glows on a dark sheet');
});

// ---- N6, N9: mono dark quieter, the poster's bottom crosshair gone ------------------------------------------------------

test('mono dark: the dot field is dimmed so the card halo leaves no visible panel; light is untouched', () => {
  const [light, dark] = pictures(deckArtPair('mono', SEEDS[2]));
  assert.ok(!/opacity:/.test(/style="[^"]*"/.exec(light)?.[0] ?? ''), 'light mode keeps full strength');
  const o = /style="[^"]*opacity:\s*([\d.]+)/.exec(dark)?.[1];
  assert.ok(o && Number(o) <= 0.6, `dark mode dimmed (${o})`);
});

test('poster: only the top registration mark is kept; none sits at the footer', () => {
  for (const svg of pictures(deckArtPair('poster', SEEDS[2]))) {
    const marks = [...svg.matchAll(/<g fill="none" stroke="#[0-9a-f]{6}" stroke-width="[^"]*"><circle cx="(\d+)" cy="(\d+)"/g)].map((m) => Number(m[2]));
    assert.equal(marks.length, 1, 'one registration mark');
    assert.ok(marks[0] < 1080 / 2, 'it is the top one');
  }
});

// ---- N3, N4, N14: the colophon and the dusk chips (stylesheet rules) ---------------------------------------------------

const CLASSIC = ':root[data-flavor="classic"]';

test('classic closing: the colophon has no band of its own; the art fades out above it instead', () => {
  const css = read('deck-art.css');
  const foot = rule(css, `${CLASSIC} .slide-has-art:not(.slide-cover) .pa-footer`);
  assert.match(foot, /background: none/, 'no page-coloured band');
  assert.ok(!/box-shadow/.test(foot), 'no halo');
  const art = rule(css, `${CLASSIC} .slide-has-art:not(.slide-cover) .slide-art`);
  assert.match(art, /mask-image: linear-gradient\(#000 calc\(100% - [\d.]+rem\), transparent calc\(100% - [\d.]+rem\)\)/, 'the art fades into the ground at the bottom');
});

test('flavored closing: the colophon strip is sized to its text and centred, with all four borders or none', () => {
  const css = read('deck-flavors.css');
  const foot = rule(css, ':root[data-flavor] .slide-has-art:not(.slide-cover) .pa-footer');
  assert.match(foot, /width: fit-content/);
  assert.match(foot, /margin-inline: auto/);
  assert.match(foot, /justify-content: center/);
  const poster = rule(css, ':root[data-flavor="poster"] .slide-has-art:not(.slide-cover) .pa-footer');
  assert.match(poster, /border: 1px solid var\(--text\)/);
  assert.ok(!/border-top-width/.test(poster), 'the box is closed');
});

test('dusk title chips are the unboxed caps labels like the other themes', () => {
  const chip = rule(read('deck-flavors.css'), ':root[data-flavor="dusk"] .slide-cover .meta div');
  for (const re of [/padding: 0/, /border: 0/, /background: none/, /border-radius: 0/]) assert.match(chip, re);
});

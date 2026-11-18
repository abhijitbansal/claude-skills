// The deck's own art pairs (scripts/lib/deck-art.mjs): shared/art draws one landscape picture per theme; the deck
// adds a portrait picture for the six classic themes (a phone shows a 16:9 drawing as a narrow slice of its middle),
// keeps pen ticks from overlapping, keeps the editorial ornament inside the slice, and draws brief as a stamped
// memo instead of rows of grey bars (which read as a loading skeleton).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckArtPair, CLASSIC_ART_THEMES, WIDE, TALL } from '../scripts/lib/deck-art.mjs';

const svgs = (html) => [...html.matchAll(/<svg class="([^"]*)" xmlns="[^"]*" viewBox="0 0 (\d+) (\d+)"/g)].map((m) => ({ cls: m[1], w: +m[2], h: +m[3] }));
const opts = { seed: 'Four skills, one rule2' };

test('a classic theme draws four pictures: light and dark, wide and tall; a flavored theme keeps its two', () => {
  assert.deepEqual([...CLASSIC_ART_THEMES].sort(), ['blueprint', 'brief', 'editorial', 'ink', 'mono', 'paper']);
  for (const theme of CLASSIC_ART_THEMES) {
    const found = svgs(deckArtPair(theme, opts.seed));
    assert.deepEqual(found.map((s) => s.cls), ['art-light art-wide', 'art-dark art-wide', 'art-light art-tall', 'art-dark art-tall'], theme);
    assert.deepEqual(found.map((s) => [s.w, s.h]), [WIDE, WIDE, TALL, TALL].map(({ width, height }) => [width, height]), theme);
  }
  for (const theme of ['dusk', 'press', 'poster']) {
    assert.deepEqual(svgs(deckArtPair(theme, opts.seed)).map((s) => s.cls), ['art-light', 'art-dark'], theme);
  }
});

test('the same arguments give the same bytes', () => {
  for (const theme of CLASSIC_ART_THEMES) assert.equal(deckArtPair(theme, opts.seed), deckArtPair(theme, opts.seed), theme);
});

// Every tick is one `M x y l dx dy l dx dy` stroke; its box must not meet another tick's box.
function tickBoxes(svg) {
  const d = /<path data-art-part="ticks" d="([^"]*)"/.exec(svg)?.[1];
  assert.ok(d, 'the paper art has a ticks path');
  return d.split('M').filter(Boolean).map((seg) => {
    const [x, y, ...rest] = seg.replace(/l/g, ' ').trim().split(/\s+/).map(Number);
    let px = x; let py = y; const xs = [x]; const ys = [y];
    for (let i = 0; i < rest.length; i += 2) { px += rest[i]; py += rest[i + 1]; xs.push(px); ys.push(py); }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
}
const meet = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

test('paper: no two pen ticks overlap, in any seed, either orientation', () => {
  for (const seed of ['a', 'b', 'Four skills, one rule2', 'Four skills, one rule12', 'closing', 'x'.repeat(40), 'seed 7', 'seed 8', 'seed 9']) {
    const html = deckArtPair('paper', seed);
    for (const svg of html.split('</svg>').filter(Boolean).map((s) => `${s}</svg>`)) {
      const boxes = tickBoxes(svg);
      assert.ok(boxes.length >= 3, 'there are ticks to check');
      boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => assert.ok(!meet(a, b), `seed ${seed}: two ticks overlap`)));
    }
  }
});

test('paper: the shared generator\'s random ticks are replaced by one even column (one ticks path per picture)', () => {
  const html = deckArtPair('paper', opts.seed);
  assert.equal((html.match(/stroke-linejoin="round" opacity="\.8"/g) ?? []).length, 4, 'one ticks path per picture, no random set beside it');
  const svg = html.split('</svg>')[0];
  const boxes = tickBoxes(svg);
  assert.equal(new Set(boxes.map((b) => b.x0)).size, 1, 'one column');
  const gaps = boxes.slice(1).map((b, i) => b.y0 - boxes[i].y0);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) <= 1), 'even gaps');
});

test('brief: a stamped memo, no rows of text bars', () => {
  const html = deckArtPair('brief', opts.seed);
  assert.ok(html.includes('data-art-part="stamp"'));
  assert.ok(!/<g fill="#[0-9a-f]{6}" opacity="\.45">/.test(html), 'no grey text bars');
  assert.ok((html.match(/<rect /g) ?? []).length < 80, 'few shapes: a memo, not a wall of bars');
});

test('editorial: the ornament and its rules stay inside the middle slice a phone shows', () => {
  for (const seed of ['a', 'b', 'Four skills, one rule2', 'Four skills, one rule12', 'closing', 'seed 7']) {
    const tall = deckArtPair('editorial', seed).split('</svg>')[2];
    const flank = /<path d="M(\d+) (\d+)H(\d+)M(\d+) (\d+)H(\d+)"/.exec(tall);
    assert.ok(flank, 'the ornament has its flanking rules');
    const xs = [flank[1], flank[3], flank[4], flank[6]].map(Number);
    // a 390x800 phone shows 87% of the 1080-wide art: the outer 6.5% each side is cropped
    assert.ok(Math.min(...xs) >= TALL.width * 0.08 && Math.max(...xs) <= TALL.width * 0.92, `seed ${seed}: a rule end reaches the cropped edge`);
  }
});

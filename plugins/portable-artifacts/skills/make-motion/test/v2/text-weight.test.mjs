// A text's words take optional `weight` and `width` tracks, each for the whole word, and layout takes `reserve:
// { weight?, width? }`: every word is measured at the reserved weight and width, and a word drawn lighter or narrower
// is centred in its reserved room, so nothing re-flows when a weight or a width changes (looks-four Task 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, fitText, drawnFont, reservedInset } from '../../engine/text/layout.mjs';
import { node } from '../../engine/graph/node.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { track } from '../../engine/time/track.mjs';
import { STRETCH_KEYWORDS } from '../../engine/fonts/index.mjs';

const UNIT = 1; // px per unit on a 1080 short side
const STRETCH = new Map(STRETCH_KEYWORDS.map(([percent, keyword]) => [keyword, percent / 100]));
// A fake measure whose advance follows the weight and the width, as a variable face's does: heavier and wider is longer.
const measure = (text, font) => {
  const width = [...text].length * font.size * 0.55 * ((font.weight ?? 400) / 400) * (STRETCH.get(font.width ?? 'normal') ?? 1);
  return { width, ascent: font.size * 0.8, descent: font.size * 0.2, inkAscent: 0.74 * font.size, inkDescent: 0, inkLeft: 0.02 * font.size, inkRight: width - 0.02 * font.size };
};
const FONT = Object.freeze({ family: 'Archivo', size: 80, weight: 300, width: 'extra-condensed', tracking: -0.01 });
const TEXT = 'Weight moves by word only';
const opts = (extra = {}) => ({ text: TEXT, font: FONT, maxWidth: 900, measure, ...extra });
const boxes = (layout) => layout.lines.flatMap((line) => line.words.map((w) => [w.index, line.x + w.x, line.y, w.width]));

// A text node over `layout` whose word 1 carries `tracks`, sampled at t.
function sampledWords(layout, tracks, t = 1) {
  const wordTracks = layout.lines.flatMap((l) => l.words).map((w) => (w.index === 1 ? tracks : {}));
  return sampleGraph([node('text', 'w', { layout, font: FONT }, { wordTracks })], t)[0].words;
}

test('no word\'s box moves when one word\'s weight track changes', () => {
  const layout = layoutText(opts({ reserve: { weight: 800 } }));
  const light = sampledWords(layout, { weight: track([{ t: 0, v: 300 }]) });
  const heavy = sampledWords(layout, { weight: track([{ t: 0, v: 800 }]) });
  assert.equal(light[1].weight, 300);
  assert.equal(heavy[1].weight, 800);
  // the boxes are the layout's: measured once at the reserved weight, so a word at 300 and at 800 sits in the same room
  for (const [index, , , width] of boxes(layout)) {
    const word = layout.lines.flatMap((l) => l.words).find((w) => w.index === index);
    const reserved = measure(word.text, { ...FONT, weight: 800 }).width + FONT.tracking * FONT.size * [...word.text].length;
    assert.ok(Math.abs(width - reserved) < 1e-9, `word ${index} reserves its heaviest advance`);
  }
  assert.notDeepEqual(boxes(layout), boxes(layoutText(opts())), 'the reserve took effect (measured at 300 the words are narrower)');
});

test('no word\'s box moves when one word steps from extra-condensed to condensed with reserve: { width: \'condensed\' }', () => {
  const layout = layoutText(opts({ reserve: { width: 'condensed' } }));
  const narrow = sampledWords(layout, { width: track([{ t: 0, v: 'extra-condensed' }]) });
  const wide = sampledWords(layout, { width: track([{ t: 0, v: 'extra-condensed' }, { t: 0.5, v: 'condensed' }]) });
  assert.equal(narrow[1].width, 'extra-condensed');
  assert.equal(wide[1].width, 'condensed');
  const first = layout.lines[0].words[0];
  const reserved = measure(first.text, { ...FONT, width: 'condensed' }).width + FONT.tracking * FONT.size * [...first.text].length;
  assert.ok(Math.abs(first.width - reserved) < 1e-9, 'measured at the reserved width');
});

test('without reserve layout is exactly as before', () => {
  const plain = layoutText(opts());
  assert.deepEqual(layoutText(opts({ reserve: undefined })), plain);
  assert.equal('reserve' in plain, false, 'a layout without reserve carries no reserve key');
  const fitted = fitText(opts(), { min: 40, max: 120, maxHeight: 400 });
  assert.deepEqual(fitText(opts({ reserve: undefined }), { min: 40, max: 120, maxHeight: 400 }), fitted);
  // with a reserve, fitText measures at it too and records it for the draw layer
  const reservedFit = fitText(opts({ reserve: { weight: 800 } }), { min: 40, max: 120, maxHeight: 400 });
  assert.deepEqual(reservedFit.reserve, { weight: 800 });
  assert.ok(reservedFit.size <= fitted.size, 'heavier advances fit no larger');
});

test('a lighter or narrower word\'s ink is centred in its reserved room within one unit', () => {
  for (const reserve of [{ weight: 800 }, { width: 'condensed' }, { weight: 900, width: 'normal' }]) {
    const layout = layoutText(opts({ reserve }));
    const measuredAt = { ...FONT, ...reserve };
    for (const word of layout.lines.flatMap((l) => l.words)) {
      const drawn = drawnFont(FONT, { weight: 300, width: 'extra-condensed' });
      const inset = reservedInset(measure, measuredAt, drawn, word.text);
      const m = measure(word.text, drawn);
      const advance = m.width + FONT.tracking * FONT.size * [...word.text].length;
      const left = inset + m.inkLeft;
      const right = word.width - (inset + advance - (m.width - m.inkRight));
      assert.ok(inset > 0, `${JSON.stringify(reserve)} ${word.text}: the drawn word is narrower than its room`);
      assert.ok(Math.abs(left - right) <= UNIT, `${JSON.stringify(reserve)} ${word.text}: ink gaps ${left.toFixed(2)} and ${right.toFixed(2)}`);
    }
  }
  assert.equal(reservedInset(measure, { ...FONT, weight: 800 }, { ...FONT, weight: 800 }, 'same'), 0, 'a word drawn at the reserve fills its room');
});

test('drawnFont takes a word\'s weight and width over the node\'s font, and leaves the font as it is without them', () => {
  assert.equal(drawnFont(FONT, {}), FONT);
  assert.deepEqual(drawnFont(FONT, { weight: 650 }), { ...FONT, weight: 650 });
  assert.deepEqual(drawnFont(FONT, { width: 'normal' }), { ...FONT, width: 'normal' });
});

test('the sampled weight is an integer from 100 to 900 and the sampled width one of the six keywords', () => {
  const layout = layoutText(opts());
  const weight = track([{ t: 0, v: 40 }, { t: 1, v: 960 }]);
  for (let t = 0; t <= 1; t += 1 / 30) {
    const w = sampledWords(layout, { weight }, t)[1].weight;
    assert.ok(Number.isInteger(w) && w >= 100 && w <= 900, `weight ${w} at ${t.toFixed(3)} s`);
  }
  const keywords = STRETCH_KEYWORDS.map(([, k]) => k);
  assert.equal(keywords.length, 6);
  const width = track([{ t: 0, v: 'extra-condensed' }, { t: 0.5, v: 'semi-expanded' }]);
  for (const t of [0, 0.25, 0.5, 1]) assert.ok(keywords.includes(sampledWords(layout, { width }, t)[1].width), `width at ${t}`);
  assert.throws(() => sampledWords(layout, { width: track([{ t: 0, v: 'ultra-condensed' }]) }), /width.*one of extra-condensed, condensed, semi-condensed, normal, semi-expanded, expanded/);
  assert.equal('weight' in sampledWords(layout, {})[1], false, 'a word without a weight track has no weight');
});

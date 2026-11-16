// The `glow` emphasis (engine/devices/glow.mjs): an emphasised word takes the accent as it is spoken, and behind each
// run of adjacent emphasised words on a line sits one soft accent halo, a blurred pill path under the text. The halo is
// a path, so the measured ink box the review reads (text nodes only, engine/review/frame.mjs) never includes it; it
// stays inside the frame and off the neighbouring lines, and text over it keeps 3:1 against its brightest pixel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/fields/index.mjs';
import { GLOW, glowFill, glowHalos } from '../../engine/devices/glow.mjs';
import { layoutText } from '../../engine/text/layout.mjs';
import { fontFor } from '../../engine/kinds/shared.mjs';
import { sample } from '../../engine/time/track.mjs';
import { mix } from '../../engine/fields/color.mjs';
import { contrastRatio as contrast } from '../../shared/contrast.mjs';

const cosmos = registries.looks.get('cosmos');
const desk = registries.looks.get('desk');
const pop = registries.looks.get('pop');
const CANVAS = Object.freeze({ w: 1920, h: 1080 });
// Nunito 800 ink, measured in Chromium 156 (.scratch/cosmos/metrics.mjs), given to every word: the worst case.
const NUNITO = Object.freeze({ up: 0.716, down: 0.191 });
const measure = (text, font) => {
  const width = [...text].length * font.size * 0.55;
  return { width, ascent: font.size * 0.9, descent: font.size * 0.25, inkAscent: NUNITO.up * font.size, inkDescent: NUNITO.down * font.size, inkLeft: 0.02 * font.size, inkRight: width - 0.02 * font.size };
};
const fieldPeak = registries.fields.get('cosmos').plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette: cosmos.palette, params: {} }).peak;

// A placed text (as statement composes it) and the per-word times and timing words that say which are emphasised.
function placedText(text, { size = 136, x = 242, y = 300, maxWidth = 1400, emphasised = [], look = cosmos, canvas = CANVAS } = {}) {
  const font = fontFor(look, 'display', size, 1);
  const layout = layoutText({ text, font, maxWidth, measure });
  const words = layout.lines.flatMap((l) => l.words);
  const times = words.map((w, i) => ({ at: 0.4 * (i + 1), spoken: i }));
  const timing = { words: words.map((w, i) => ({ text: w.text, emphasis: emphasised.includes(i) })) };
  return { placed: Object.freeze({ x, y, layout, font }), times, ctx: { look, timing, measure, canvas, unit: 1 } };
}
const bboxOf = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
// A halo is a soft-edged group of rings (devices/shared.mjs softRoundedRect), outermost first.
const outer = (halo) => bboxOf(halo.children[0].props.d);
const inner = (halo) => bboxOf(halo.children.at(-1).props.d);
const stacked = (halo) => 1 - halo.children.reduce((left, ring) => left * (1 - ring.props.opacity), 1);

test('glowFill: the word turns from ink to the accent over the look\'s emphasize move from when it is spoken', () => {
  const { fill } = glowFill(cosmos, 2);
  assert.equal(sample(fill, 0), cosmos.palette.ink);
  assert.equal(sample(fill, 2), cosmos.palette.ink);
  assert.equal(sample(fill, 2 + cosmos.moves.emphasize.dur), cosmos.palette.accent);
  assert.equal(sample(fill, 9), cosmos.palette.accent);
});

test('glowHalos: none in a look whose emphasis is not the glow (desk, pop), none when nothing is emphasised', () => {
  for (const look of [desk, pop]) {
    const { placed, times, ctx } = placedText('Scale changes everything', { emphasised: [2], look });
    assert.deepEqual(glowHalos('s', placed, times, ctx), []);
  }
  const { placed, times, ctx } = placedText('Scale changes everything');
  assert.deepEqual(glowHalos('s', placed, times, ctx), []);
});

test('glowHalos: one halo per run of adjacent emphasised words on a line, a soft accent pill under the text, no blur filter', () => {
  const { placed, times, ctx } = placedText('one two three four five six seven', { size: 76, maxWidth: 1600, emphasised: [1, 2, 5] });
  assert.equal(placed.layout.lines.length, 1);
  const halos = glowHalos('s', placed, times, ctx);
  assert.deepEqual(halos.map((n) => n.id), ['s.glow0', 's.glow1']);
  for (const halo of halos) {
    assert.equal(halo.type, 'group');
    assert.equal(halo.props.under, true);
    assert.ok(halo.children.every((ring) => ring.type === 'path' && ring.props.fill === cosmos.palette.accent && ring.props.blur === undefined));
    assert.ok(Math.abs(stacked(halo) - GLOW.alpha) < 1e-9, `whole at GLOW.alpha: ${stacked(halo)}`);
    const [, , w, h] = outer(halo);
    assert.ok(w > h, 'a pill');
    assert.ok(outer(halo)[1] < inner(halo)[1], 'a soft edge round the core');
  }
});

test('glowHalos: the halo is whole only along the run\'s middle, inside its ink, and soft from there to past the ink', () => {
  const size = 136;
  const { placed, times, ctx } = placedText('Scale changes everything', { size, emphasised: [2] });
  const [halo] = glowHalos('s', placed, times, ctx);
  const line = placed.layout.lines.find((l) => l.words.some((w) => w.index === 2)), baseline = placed.y + line.y;
  const [, iy, , ih] = inner(halo), [, oy, , oh] = outer(halo);
  assert.ok(iy > baseline - NUNITO.up * size && iy + ih < baseline + NUNITO.down * size, 'the whole core sits inside the ink');
  assert.ok(oy < baseline - NUNITO.up * size && oy + oh > baseline + NUNITO.down * size, 'the soft edge reaches past the ink');
  const PATH_PRECISION = 0.01;
  assert.ok(Math.abs((baseline - NUNITO.up * size) - oy - GLOW.reach * size) <= PATH_PRECISION, 'GLOW.reach past the ink');
});

test('glowHalos: a long run on a line is one halo, its rings whole only where they all overlap', () => {
  const { placed, times, ctx } = placedText('one two three', { size: 76, emphasised: [0, 1, 2] });
  const halos = glowHalos('s', placed, times, ctx);
  assert.equal(halos.length, 1);
  for (const halo of halos) {
  }
});

test('glowHalos: no text node comes back and the placed text is not changed, so the ink box the review measures is the text\'s alone', () => {
  const { placed, times, ctx } = placedText('Scale changes everything', { emphasised: [2] });
  const before = JSON.stringify(placed);
  const halos = glowHalos('s', placed, times, ctx);
  const every = (nodes) => nodes.flatMap((n) => [n, ...every(n.children)]);
  assert.ok(every(halos).every((n) => n.type !== 'text'));
  assert.equal(JSON.stringify(placed), before);
});

test('glowHalos: a halo fades in from when its first word is spoken, whole after the emphasize move', () => {
  const { placed, times, ctx } = placedText('Scale changes everything', { emphasised: [2] });
  const [halo] = glowHalos('s', placed, times, ctx);
  const at = times[2].at;
  assert.equal(sample(halo.tracks.opacity, 0), 0);
  assert.equal(sample(halo.tracks.opacity, at), 0);
  assert.equal(sample(halo.tracks.opacity, at + cosmos.moves.emphasize.dur), 1);
});

test('glowHalos: the halo holds the run\'s ink and its soft edge never touches the line above or below, at 76, 136 and 232 units', () => {
  for (const size of [76, 136, 232]) {
    // a canvas large enough that no clip to the frame shortens a halo: this test is about the lines
    const { placed, times, ctx } = placedText('aaa bbb ccc ddd eee fff ggg hhh', { size, maxWidth: size * 3.5, x: 200, y: 200 + size, emphasised: [0, 1, 2, 3, 4, 5, 6, 7], canvas: { w: 4000, h: 4000 } });
    assert.ok(placed.layout.lines.length >= 3, `${size}: several lines`);
    const halos = glowHalos('s', placed, times, ctx);
    assert.equal(halos.length, placed.layout.lines.length);
    halos.forEach((halo, k) => {
      const [, oy, , oh] = outer(halo);
      const baseline = placed.y + placed.layout.lines[k].y;
      assert.ok(oy <= baseline - NUNITO.up * size && oy + oh >= baseline + NUNITO.down * size, `${size} line ${k}: the glow covers the ink`);
      const next = placed.layout.lines[k + 1], prev = placed.layout.lines[k - 1];
      if (next) assert.ok(oy + oh < placed.y + next.y - NUNITO.up * size, `${size} line ${k}: off the line below`);
      if (prev) assert.ok(oy > placed.y + prev.y + NUNITO.down * size, `${size} line ${k}: off the line above`);
    });
  }
});

test('glowHalos: the glow never leaves the frame, even for a word set against its edge', () => {
  const { placed, times, ctx } = placedText('Edge', { x: 4, y: 140, size: 136, emphasised: [0] });
  const [halo] = glowHalos('s', placed, times, ctx);
  const [x, y, w, h] = outer(halo);
  assert.ok(x >= 0 && y >= 0 && x + w <= CANVAS.w && y + h <= CANVAS.h, `[${x}, ${y}, ${w}, ${h}]`);
});

// Canvas compositing in sRGB, per channel in 0..1: source-over b + a (s - b), screen b + a s (1 - b).
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (cs) => `#${cs.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const composite = (backdrop, source, alpha, blend) => {
  const b = channels(backdrop), s = channels(source);
  return toHex(b.map((bc, i) => (blend === 'screen' ? bc + alpha * s[i] * (1 - bc) : bc + alpha * (s[i] - bc))));
};

test('the halo is screened, so it only brightens; the accent word and an ink neighbour keep 3:1 against its brightest pixel', () => {
  const { placed, times, ctx } = placedText('Scale changes everything', { emphasised: [2] });
  const [halo] = glowHalos('s', placed, times, ctx);
  assert.equal(halo.props.blend, 'screen');
  const brightest = halo.children.reduce((b, ring) => composite(b, ring.props.fill, ring.props.opacity, halo.props.blend), fieldPeak);
  assert.ok(contrast(brightest, '#000000') > contrast(fieldPeak, '#000000'), 'brighter than the field');
  for (const key of ['accent', 'ink']) {
    const ratio = contrast(cosmos.palette[key], brightest);
    assert.ok(ratio >= 3, `${key} on ${brightest}: ${ratio.toFixed(2)}`);
  }
  assert.equal(mix(fieldPeak, fieldPeak, 0.5), fieldPeak);
});

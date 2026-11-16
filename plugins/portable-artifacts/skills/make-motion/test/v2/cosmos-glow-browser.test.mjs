// The cosmos glyph glow, drawn by the real draw layer in the browser: the accent keeps 3:1 against the brightest glow
// pixel beside its glyphs (over the field's lift peak, the lightest ground), at display sizes; the glow lights only
// where its word track says, and a text without props.glow draws exactly as before. Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openStage } from './helpers/stage.mjs';

const FILM = { version: 2, mode: 'pro', look: 'cosmos', format: '16:9', fps: 30, seed: 1, shots: [{ id: 's', show: 'statement', hold: 1, text: 'Glow' }] };

let stage = null;
before(async () => { stage = await openStage(FILM); });
after(async () => { if (stage) await stage.close(); });

// Draws "Every tonight" in the accent at `size` on the lift peak, lit to `share`, with and without props.glow, and
// returns the brightest luminance outside the glyphs and whether the unlit and glowless drawings are identical.
function measure(size, share) {
  return stage.page.evaluate(async ({ size: px, share: lit }) => {
    const { registries } = await import('/engine/registry.mjs');
    await import('/engine/looks/index.mjs');
    const { node } = await import('/engine/graph/node.mjs');
    const { track } = await import('/engine/time/track.mjs');
    const { sampleGraph } = await import('/engine/graph/sample.mjs');
    const { drawFrame } = await import('/engine/page/draw.mjs');
    const { createMeasure } = await import('/engine/page/text-style.mjs');
    const { layoutText } = await import('/engine/text/layout.mjs');
    const { fontFor } = await import('/engine/kinds/shared.mjs');
    const { glowStyle } = await import('/engine/devices/glow.mjs');
    const look = registries.looks.get('cosmos');
    const peak = registries.fields.get('cosmos').plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette: look.palette, params: {} }).peak;
    const font = fontFor(look, 'display', px, 1);
    const layout = layoutText({ text: 'Every tonight', font, maxWidth: 1e6, measure: createMeasure(new OffscreenCanvas(8, 8).getContext('2d')) });
    const w = Math.ceil(layout.width + 2 * px), h = Math.ceil(px * 2.2);
    const wordTracks = layout.lines[0].words.map(() => ({ glow: track([{ t: 0, v: lit }]) }));
    const draw = (props) => {
      const c = new OffscreenCanvas(w, h).getContext('2d');
      c.fillStyle = peak;
      c.fillRect(0, 0, w, h);
      drawFrame(c, sampleGraph([node('text', 't', { x: px, y: px * 0.4, layout, font, fill: look.palette.accent, ...props }, { wordTracks })], 0), { canvas: { w, h } });
      return c.getImageData(0, 0, w, h).data;
    };
    const plain = draw({}), lit2 = draw(glowStyle(look, font, 1));
    const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(peak.slice(i, i + 2), 16));
    const lum = (r, g, b) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    let brightest = 0, same = true;
    for (let i = 0; i < plain.length; i += 4) {
      if (plain[i] !== lit2[i] || plain[i + 1] !== lit2[i + 1] || plain[i + 2] !== lit2[i + 2]) same = false;
      if (plain[i] === pr && plain[i + 1] === pg && plain[i + 2] === pb) brightest = Math.max(brightest, lum(lit2[i], lit2[i + 1], lit2[i + 2]));
    }
    return { brightest, accent: lum(255, 209, 102), same };
  }, { size, share });
}

for (const size of [76, 136, 232]) {
  test(`the accent keeps 3:1 against the brightest glow pixel beside its glyphs at ${size} px`, async (t) => {
    if (!stage) return t.skip('no browser');
    const { brightest, accent, same } = await measure(size, 1);
    assert.equal(same, false, 'the glow draws');
    const ratio = (accent + 0.05) / (brightest + 0.05);
    assert.ok(ratio >= 3, `${ratio.toFixed(2)} (brightest L ${brightest.toFixed(4)})`);
  });
}

test('a word whose glow track is 0 draws exactly as a text without props.glow', async (t) => {
  if (!stage) return t.skip('no browser');
  assert.equal((await measure(136, 0)).same, true);
});

// A filled path with props.glow ({ color, alpha, radius }) under it: light outside its edge that falls off smoothly (no
// steps: each pixel on a line out from the edge no brighter than the one before), none inside, and none without it.
function pathGlow(glow) {
  return stage.page.evaluate(async ({ glow: g }) => {
    const { node } = await import('/engine/graph/node.mjs');
    const { sampleGraph } = await import('/engine/graph/sample.mjs');
    const { drawFrame } = await import('/engine/page/draw.mjs');
    const c = new OffscreenCanvas(300, 200).getContext('2d');
    c.fillStyle = '#2a1a5e';
    c.fillRect(0, 0, 300, 200);
    drawFrame(c, sampleGraph([node('path', 'p', { d: 'M100 60H200V140H100Z', fill: '#2e2770', ...(g ? { glow: g } : {}) })], 0), { canvas: { w: 300, h: 200 } });
    const at = (x, y) => [...c.getImageData(x, y, 1, 1).data.slice(0, 3)];
    const ray = Array.from({ length: 40 }, (_, i) => at(201 + i, 100)[0]);
    return { inside: at(150, 100), ray };
  }, { glow });
}

test('a path with props.glow lights a smooth falloff outside its edge in the glow colour, none inside; none without it', async (t) => {
  if (!stage) return t.skip('no browser');
  const lit = await pathGlow({ color: '#ffd166', alpha: 0.5, radius: 24 });
  assert.deepEqual(lit.inside, [0x2e, 0x27, 0x70], 'the fill on top, unchanged');
  assert.ok(lit.ray[0] > 0x2a + 20, `light at the edge: red ${lit.ray[0]}`);
  for (let i = 1; i < lit.ray.length; i++) assert.ok(lit.ray[i] <= lit.ray[i - 1], `no step at ${i}: ${lit.ray.join(',')}`);
  const plain = await pathGlow(null);
  assert.equal(plain.ray[0], 0x2a, 'no glow without props.glow');
});

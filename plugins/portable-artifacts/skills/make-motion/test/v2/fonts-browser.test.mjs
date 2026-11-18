// Which font axes canvas text can actually reach, measured in the browser, and checked against the `reach` flags
// recorded in engine/fonts/index.mjs. The findings below are the ones engine/fonts/CANVAS-NOTES.md reports.
// Run with --test-concurrency=1 (one headless browser at a time).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FONTS, STRETCH_KEYWORDS } from '../../engine/fonts/index.mjs';
import { openStage } from './helpers/stage.mjs';

const PROBE_TEXT = 'Rag';
const PROBE_SIZE = 120;
const AXIS_TAGS = ['wght', 'wdth', 'opsz', 'SOFT'];

// A free shot with one text node per family, so the stage loads every face through facesFor (the seam under test).
const FILM = {
  fps: 30,
  shots: [{
    id: 'faces', show: 'free', hold: 1, background: '#ffffff',
    nodes: [...FONTS.map((f) => f.family), 'JetBrains Mono'].map((family, i) => ({
      type: 'text', id: `t${i}`, props: { x: 40, y: 100 + i * 90, text: PROBE_TEXT, font: { family, size: 60 }, maxWidth: 800, fill: '#000000' },
    })),
  }],
};

let stage = null;
before(async () => { stage = await openStage(FILM); });
after(async () => { if (stage) await stage.close(); });

// Draw on a fresh 600x200 canvas and return its PNG data URL. `props` are extra ctx properties set after ctx.font
// (setting ctx.font resets fontStretch); `css` is set on the canvas element, which may be attached to the page.
function draw(spec) {
  const full = { weight: 400, size: PROBE_SIZE, text: PROBE_TEXT, props: {}, scale: 1, attached: false, ...spec };
  return stage.page.evaluate(({ family, weight, size, text, stretch, props, scale, css, attached }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    if (css) Object.assign(canvas.style, css);
    if (attached) document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 200);
    ctx.fillStyle = '#000000';
    ctx.scale(scale, scale);
    ctx.font = `${weight} ${size}px "${family}"`;
    if (stretch) ctx.fontStretch = stretch;
    for (const [key, value] of Object.entries(props)) ctx[key] = value;
    ctx.fillText(text, 10 / scale, 150 / scale);
    const url = canvas.toDataURL();
    canvas.remove();
    return url;
  }, full);
}

const hash = (url) => createHash('sha256').update(url).digest('hex');
const differs = async (a, b) => hash(await draw(a)) !== hash(await draw(b));

// Differing pixels between two draws, counted in the page (a control family shows the scale-only noise).
function pixelDiff(a, b) {
  return stage.page.evaluate(([specA, specB]) => {
    const render = ({ family, size, scale }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 900, 300);
      ctx.fillStyle = '#000000';
      ctx.scale(scale, scale);
      ctx.font = `400 ${size}px "${family}"`;
      ctx.fillText('Rag', 10 / scale, 200 / scale);
      return ctx.getImageData(0, 0, 900, 300).data;
    };
    const [da, db] = [render(specA), render(specB)];
    let count = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i]) count += 1;
    return count;
  }, [a, b]);
}

// The ctx.fontStretch keyword nearest a width percentage.
const keywordFor = (percent) => STRETCH_KEYWORDS.reduce((best, entry) => (Math.abs(entry[0] - percent) < Math.abs(best[0] - percent) ? entry : best))[1];

// The two draws that put an axis at its minimum and its maximum through the route the engine has for it. wght and
// wdth have a ctx route (ctx.font weight, ctx.fontStretch keyword). opsz and SOFT have none on ctx: the probe tries
// the property a browser would add (ctx.fontVariationSettings), so the day one ships this test notices.
const AXIS_PROBES = {
  wght: (family, [lo, hi]) => [{ family, weight: lo }, { family, weight: hi }],
  wdth: (family, [lo, hi]) => [{ family, stretch: keywordFor(lo) }, { family, stretch: keywordFor(hi) }],
  opsz: (family, [lo, hi]) => [
    { family, props: { fontVariationSettings: `"opsz" ${lo}` } }, { family, props: { fontVariationSettings: `"opsz" ${hi}` } }],
  SOFT: (family, [lo, hi]) => [
    { family, props: { fontVariationSettings: `"SOFT" ${lo}` } }, { family, props: { fontVariationSettings: `"SOFT" ${hi}` } }],
};

test('the stage loads every FONTS face through the seam, with no page errors and no blocked requests', async (t) => {
  if (!stage) return t.skip('no browser');
  t.diagnostic(`browser ${stage.page.context().browser().version()}`);
  for (const font of FONTS) {
    assert.equal(await stage.page.evaluate((family) => document.fonts.check(`400 20px "${family}"`), font.family), true, font.family);
  }
  assert.deepEqual(stage.errors, []);
  assert.deepEqual(stage.blocked, []);
});

for (const font of FONTS) {
  test(`canvas text changes when the axis changes, where reach says it does: ${font.family}`, async (t) => {
    if (!stage) return t.skip('no browser');
    for (const [axis, range] of Object.entries(font.axes)) {
      const [low, high] = AXIS_PROBES[axis](font.family, range);
      assert.equal(await differs(low, high), font.reach[axis], `${font.family} ${axis} ${range}: reach says ${font.reach[axis]}`);
    }
    for (const axis of AXIS_TAGS.filter((tag) => font.axes[tag] === undefined && font.fixed?.[tag] === undefined)) {
      assert.equal(font.reach[axis], false, `${font.family} declares no ${axis}, so reach.${axis} is false`);
    }
  });

  if (font.fixed) {
    test(`a pinned axis shows in canvas text only through its derived family, where reach says it does: ${font.family}`, async (t) => {
      if (!stage) return t.skip('no browser');
      for (const axis of Object.keys(font.fixed)) {
        assert.equal(await differs({ family: font.of }, { family: font.family }), font.reach[axis], `${font.family} ${axis} ${font.fixed[axis]} against ${font.of}`);
      }
    });
  }
}

// keynote (looks-four Task 9): the weight sweep animates Geist Variable's wght through ctx.font
test('keynote: Geist Variable at 100 and at 900 draw differently on canvas, and the stage loads it with no page error', async (t) => {
  if (!stage) return t.skip('no browser');
  assert.equal(await stage.page.evaluate(() => document.fonts.check('400 20px "Geist Variable"')), true, 'loaded through facesFor');
  assert.ok(await differs({ family: 'Geist Variable', weight: 100 }, { family: 'Geist Variable', weight: 900 }), '100 against 900');
  assert.ok(await differs({ family: 'Geist Variable', weight: 300 }, { family: 'Geist Variable', weight: 800 }), 'the sweep\'s 300 against 800');
  assert.deepEqual(stage.errors, []);
});

test('ctx.fontStretch takes keywords only: a percentage is ignored, and six keywords give six distinct widths for Archivo', async (t) => {
  if (!stage) return t.skip('no browser');
  const widths = await stage.page.evaluate((keywords) => {
    const ctx = document.createElement('canvas').getContext('2d');
    const widthAt = (stretch) => { ctx.font = '400 120px "Archivo"'; ctx.fontStretch = stretch; return [ctx.fontStretch, ctx.measureText('Rag').width]; };
    return { percent: widthAt('70%')[0], byKeyword: keywords.map((k) => widthAt(k)[1]), expanded: widthAt('expanded')[1], ultra: widthAt('ultra-expanded')[1] };
  }, STRETCH_KEYWORDS.map((entry) => entry[1]));
  assert.equal(widths.percent, 'normal', 'a percentage string leaves fontStretch at normal');
  assert.equal(new Set(widths.byKeyword).size, STRETCH_KEYWORDS.length);
  assert.deepEqual([...widths.byKeyword].sort((a, b) => a - b), widths.byKeyword, 'wider keywords are wider');
  assert.equal(widths.ultra, widths.expanded, 'widths past 125% clamp to the face\'s maximum');
});

test('assigning ctx.font resets ctx.fontStretch to normal, so set the stretch after the font', async (t) => {
  if (!stage) return t.skip('no browser');
  const seen = await stage.page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '400 50px "Archivo"';
    ctx.fontStretch = 'condensed';
    const before = ctx.fontStretch;
    ctx.font = '400 50px "Archivo"';
    return [before, ctx.fontStretch];
  });
  assert.deepEqual(seen, ['condensed', 'normal']);
});

test('canvas applies optical size automatically from the pixel size: Fraunces at 24 px x8 differs from 192 px, the Archivo control does not', async (t) => {
  if (!stage) return t.skip('no browser');
  const fraunces = await pixelDiff({ family: 'Fraunces', size: 24, scale: 8 }, { family: 'Fraunces', size: 192, scale: 1 });
  const control = await pixelDiff({ family: 'Archivo', size: 24, scale: 8 }, { family: 'Archivo', size: 192, scale: 1 });
  assert.ok(control < 100, `scale-only noise (Archivo): ${control} pixels`);
  assert.ok(fraunces > 1000, `Fraunces: ${fraunces} pixels differ, so opsz follows the unscaled pixel size`);
});

test('a derived opsz family matches the automatic optical size at that same pixel size', async (t) => {
  if (!stage) return t.skip('no browser');
  assert.equal(await pixelDiff({ family: 'Fraunces', size: 9, scale: 1 }, { family: 'Fraunces Text', size: 9, scale: 1 }), 0, 'opsz 9 at 9 px');
  assert.equal(await pixelDiff({ family: 'Fraunces', size: 192, scale: 1 }, { family: 'Fraunces Display', size: 192, scale: 1 }), 0, 'opsz 144 at 192 px (clamped)');
  assert.ok(await pixelDiff({ family: 'Fraunces', size: 24, scale: 1 }, { family: 'Fraunces Display', size: 24, scale: 1 }) > 100, 'opsz 144 against automatic at 24 px');
});

test('font-variation-settings on a canvas element reaches canvas text continuously, but only when the element is in the page', async (t) => {
  if (!stage) return t.skip('no browser');
  const soft = (value, attached) => draw({ family: 'Fraunces', css: { fontVariationSettings: `"SOFT" ${value}` }, attached });
  const [s0, s50, s100] = await Promise.all([0, 50, 100].map((v) => soft(v, true)));
  assert.equal(new Set([s0, s50, s100].map(hash)).size, 3, 'SOFT 0, 50, 100 on an attached canvas are three different drawings');
  const [d0, d100] = await Promise.all([soft(0, false), soft(100, false)]);
  assert.equal(hash(d0), hash(d100), 'a detached canvas ignores the element style');
  assert.equal(hash(await soft(50, true)), hash(s50), 'the same setting draws the same pixels twice');
  const wdth = (value) => draw({ family: 'Archivo', css: { fontVariationSettings: `"wdth" ${value}` }, attached: true });
  assert.notEqual(hash(await wdth(80)), hash(await wdth(81)), 'wdth moves in steps of 1, not in keyword jumps');
});

test('on an attached canvas the element style moves opsz, overrides the ctx weight, and font-optical-sizing none stops automatic opsz', async (t) => {
  if (!stage) return t.skip('no browser');
  const opsz = (value) => draw({ family: 'Fraunces', css: { fontVariationSettings: `"opsz" ${value}` }, attached: true });
  assert.notEqual(hash(await opsz(9)), hash(await opsz(144)), 'opsz 9 against 144');
  const archivo = (weight, css) => draw({ family: 'Archivo', weight, css, attached: true });
  assert.equal(hash(await archivo(400, { fontVariationSettings: '"wght" 900' })), hash(await archivo(900)), 'CSS wght 900 over ctx weight 400 draws as weight 900');
  const sized = (size, scale, fontOpticalSizing) => draw({ family: 'Fraunces', size, scale, css: { fontOpticalSizing }, attached: true });
  assert.notEqual(hash(await sized(24, 8, 'auto')), hash(await sized(192, 1, 'auto')), 'automatic: 24 px x8 differs from 192 px');
  assert.equal(hash(await sized(24, 8, 'none')), hash(await sized(192, 1, 'none')), 'none: 24 px x8 equals 192 px');
});

test('measureText follows the automatic optical size: Fraunces measures differently at 24 px x8 and 192 px, Archivo does not', async (t) => {
  if (!stage) return t.skip('no browser');
  const [fraunces, archivo] = await stage.page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const widths = (family) => { ctx.font = `400 24px "${family}"`; const small = ctx.measureText('Rag').width * 8; ctx.font = `400 192px "${family}"`; return [small, ctx.measureText('Rag').width]; };
    return [widths('Fraunces'), widths('Archivo')];
  });
  assert.ok(Math.abs(fraunces[0] - fraunces[1]) > 10, `Fraunces ${fraunces}`);
  assert.ok(Math.abs(archivo[0] - archivo[1]) < 0.01, `Archivo ${archivo}`);
});

test('ctx.fontKerning, ctx.letterSpacing and ctx.fontVariantCaps small-caps each change canvas text', async (t) => {
  if (!stage) return t.skip('no browser');
  for (const family of ['Fraunces', 'Archivo']) {
    assert.ok(await differs({ family, size: 80, text: 'AVATAR To', props: { fontKerning: 'none' } }, { family, size: 80, text: 'AVATAR To', props: { fontKerning: 'normal' } }), `${family} kerning`);
    assert.ok(await differs({ family, props: { letterSpacing: '0px' } }, { family, props: { letterSpacing: '10px' } }), `${family} letterSpacing`);
    assert.ok(await differs({ family, text: 'rag', props: { fontVariantCaps: 'normal' } }, { family, text: 'rag', props: { fontVariantCaps: 'small-caps' } }), `${family} small-caps`);
  }
});

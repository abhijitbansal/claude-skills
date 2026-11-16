// The `cosmos` field (engine/fields/cosmos.mjs): a vertical gradient from the palette's deep navy to its violet paper,
// a soft radial lift behind the hero area, two seeded star layers drifting at different slow speeds, a faint vignette.
// Plans are pure frozen data; stars sit one to a cell of a jittered grid, so their density is bounded everywhere.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/fields/index.mjs';
import * as cosmos from '../../engine/fields/cosmos.mjs';
import { mix, parseHex } from '../../engine/fields/color.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';

const palette = Object.freeze({
  paper: '#2a1a5e', deep: '#0b1030', ink: '#f4f1ff', ink2: '#a9a4d6', accent: '#ffd166', accent2: '#4de2c5', rule: '#3a3470',
});
const LANDSCAPE = { w: 1920, h: 1080 };
const PORTRAIT = { w: 1080, h: 1920 };
// a 1920x1080 canvas with the field's 6% bleed (kinds/shared.mjs fieldNode), which passes the canvas unit
const BLED = { w: 2150, h: 1210, unit: 1 };
const TIMES = [0, 0.5, 1.7, 5, 13.3, 30, 61];
const SEEDS = [1, 2, 7, 42, 1234];
const field = () => registries.fields.get('cosmos');
const isFrozenDeep = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(isFrozenDeep));
const luminanceOrder = (a, b) => contrastRatio(a, '#000000') - contrastRatio(b, '#000000');

// ---- a recording 2d context and OffscreenCanvas, as in fields.test.mjs ----
function recordingContext() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createRadialGradient' || key === 'createLinearGradient') {
        return (...args) => { calls.push([key, ...args]); return { addColorStop: (...stop) => calls.push(['addColorStop', ...stop]) }; };
      }
      return (...args) => { calls.push([String(key), ...args]); };
    },
    set(target, key, value) { calls.push([`=${String(key)}`, value]); target[key] = value; return true; },
  });
  return { ctx, calls };
}

let surfaces;
let savedOffscreen;
beforeEach(() => {
  surfaces = [];
  savedOffscreen = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; this.rec = recordingContext(); surfaces.push(this); }
    getContext() { return this.rec.ctx; }
  };
});
afterEach(() => {
  if (savedOffscreen === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = savedOffscreen;
});

// ---- plan ----

test('importing the fields index registers cosmos as an animated field with a summary', () => {
  assert.equal(field().plan, cosmos.plan);
  assert.equal(field().paint, cosmos.paint);
  assert.equal(field().animated, true);
  assert.ok(field().summary.length > 10);
});

test('the plan is deterministic for a seed, differs across seeds, and is plain frozen JSON', () => {
  const a = cosmos.plan({ ...LANDSCAPE, seed: 11, palette });
  assert.deepEqual(a, cosmos.plan({ ...LANDSCAPE, seed: 11, palette }));
  assert.notDeepEqual(a.layers, cosmos.plan({ ...LANDSCAPE, seed: 12, palette }).layers);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.ok(isFrozenDeep(a));
});

test('the gradient runs from palette.deep at the top to palette.paper at the bottom', () => {
  const p = cosmos.plan({ ...LANDSCAPE, seed: 1, palette });
  assert.equal(p.top, palette.deep);
  assert.equal(p.bottom, palette.paper);
});

test('a palette without deep is refused with a message naming it', () => {
  const { deep: _gone, ...bare } = palette;
  assert.throws(() => cosmos.plan({ ...LANDSCAPE, seed: 1, palette: bare }), /field "cosmos" needs palette\.deep as #rrggbb/);
});

test('the lift is soft, behind the hero area, and peak is the lightest colour the field paints', () => {
  const p = cosmos.plan({ ...LANDSCAPE, seed: 1, palette });
  assert.ok(p.lift.x > 0.2 * p.w && p.lift.x < 0.6 * p.w, 'left of centre, where a flush-left hero sits');
  assert.ok(p.lift.y > 0.3 * p.h && p.lift.y < 0.6 * p.h);
  assert.ok(p.lift.alpha > 0 && p.lift.alpha <= 0.5, 'soft');
  const behindLift = mix(mix(p.top, p.bottom, p.lift.y / p.h), p.lift.color, p.lift.alpha);
  const lightest = [behindLift, p.bottom].sort(luminanceOrder).at(-1);
  assert.equal(p.peak, lightest);
});

test('two star layers of 60 to 140 stars at 16:9, the count scaled by area', () => {
  for (const seed of SEEDS) {
    const p = cosmos.plan({ ...LANDSCAPE, seed, palette });
    assert.equal(p.layers.length, 2);
    for (const layer of p.layers) assert.ok(layer.stars.length >= 60 && layer.stars.length <= 140, `seed ${seed}: ${layer.stars.length}`);
    const tall = cosmos.plan({ ...PORTRAIT, seed, palette });
    assert.deepEqual(tall.layers.map((l) => l.stars.length), p.layers.map((l) => l.stars.length), 'the same area, the same count');
    const uhd = cosmos.plan({ w: 3840, h: 2160, seed, palette });
    assert.deepEqual(uhd.layers.map((l) => l.stars.length), p.layers.map((l) => l.stars.length), 'counts follow the area in units, not pixels');
    const bled = cosmos.plan({ ...BLED, seed, palette });
    const scale = (BLED.w * BLED.h) / (LANDSCAPE.w * LANDSCAPE.h);
    bled.layers.forEach((l, i) => assert.ok(Math.abs(l.stars.length - p.layers[i].stars.length * scale) <= 1, `bled layer ${i}`));
  }
});

test('stars come in three small sizes per layer, and the layers drift at different slow speeds', () => {
  const p = cosmos.plan({ ...LANDSCAPE, seed: 5, palette });
  for (const layer of p.layers) {
    assert.equal(layer.radii.length, 3);
    assert.deepEqual([...layer.radii], [...layer.radii].sort((a, b) => a - b));
    assert.ok(layer.radii.every((r) => r > 0 && r <= cosmos.MAX_STAR_RADIUS));
    assert.equal(new Set(layer.stars.map((s) => s[2])).size, 3, 'all three sizes are used');
    const speed = Math.hypot(layer.vx, layer.vy);
    assert.ok(speed > 0 && speed <= cosmos.MAX_DRIFT_SPEED, `speed ${speed} units/s`);
  }
  const [far, near] = p.layers.map((l) => Math.hypot(l.vx, l.vy));
  assert.ok(near > far * 1.5, 'the near layer drifts faster');
});

test('params: stars overrides the count per layer at 16:9, unknown or bad params throw', () => {
  const p = cosmos.plan({ ...LANDSCAPE, seed: 3, palette, params: { stars: 100 } });
  assert.deepEqual(p.layers.map((l) => l.stars.length), [100, 100]);
  assert.throws(() => cosmos.plan({ ...LANDSCAPE, seed: 3, palette, params: { glow: 1 } }), /unknown param "glow" for field "cosmos"; accepted: stars/);
  assert.throws(() => cosmos.plan({ ...LANDSCAPE, seed: 3, palette, params: { stars: 1000 } }), /param "stars" must be an integer in \[0, 200\]/);
});

// ---- drift ----

const wrap = (v, size) => ((v % size) + size) % size;

test('a star at time t is its position at 0 plus drift (wrapped to the field), the same star every frame', () => {
  const p = cosmos.plan({ ...BLED, seed: 9, palette });
  const at0 = cosmos.starsAt(p, 0);
  for (const t of TIMES) {
    const now = cosmos.starsAt(p, t);
    p.layers.forEach((layer, li) => {
      assert.equal(now[li].length, at0[li].length);
      now[li].forEach(([x, y, r], i) => {
        const [x0, y0, r0] = at0[li][i];
        assert.ok(Math.abs(x - wrap(x0 + layer.vx * t, p.w)) < 1e-6, `layer ${li} star ${i} x at ${t}`);
        assert.ok(Math.abs(y - wrap(y0 + layer.vy * t, p.h)) < 1e-6, `layer ${li} star ${i} y at ${t}`);
        assert.equal(r, r0, 'a star keeps its size');
      });
    });
  }
});

// ---- density ----

// The smallest distance between two stars of one layer, measured across the wrap.
function minGap(points, w, h) {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = Math.abs(points[i][0] - points[j][0]), dy = Math.abs(points[i][1] - points[j][1]);
      best = Math.min(best, Math.hypot(Math.min(dx, w - dx), Math.min(dy, h - dy)));
    }
  }
  return best;
}

test('stars of one layer never crowd: at every t no two are closer than MIN_STAR_GAP units', () => {
  for (const seed of SEEDS) {
    const p = cosmos.plan({ ...BLED, seed, palette, params: { stars: 200 } });
    for (const t of TIMES) {
      cosmos.starsAt(p, t).forEach((points, li) => {
        const gap = minGap(points, p.w, p.h) / p.unit;
        assert.ok(gap >= cosmos.MIN_STAR_GAP, `seed ${seed} layer ${li} t ${t}: ${gap.toFixed(1)} units`);
      });
    }
  }
});

// Text areas a kind reports: the composition area inside the grid margin (96 units), a two-line hero block, and the
// platform safe zone of a 9:16 viral film (template/formats.mjs VIRAL_SAFE_ZONE: top 290, bottom 675, left 120, right
// 195 px of 1080x1920). Rectangles are in the bled field's pixels (the canvas sits 6% in).
const TEXT_AREAS = [
  { size: BLED, rect: { x: 115 + 96, y: 65 + 96, w: 1728, h: 888 } },
  { size: BLED, rect: { x: 115 + 242, y: 65 + 330, w: 1440, h: 420 } },
  { size: { w: 1210, h: 2150, unit: 1 }, rect: { x: 65 + 120, y: 115 + 290, w: 765, h: 955 } },
];

test('inside a text area the stars of both layers stay under STAR_CAP per million square units, at every t', () => {
  for (const seed of SEEDS) {
    for (const { size, rect } of TEXT_AREAS) {
      const p = cosmos.plan({ ...size, seed, palette, params: { stars: 140 } });
      const areaUnits = (rect.w * rect.h) / (p.unit * p.unit);
      for (const t of TIMES) {
        const density = (cosmos.starsIn(p, rect, t) / areaUnits) * 1e6;
        assert.ok(density <= cosmos.STAR_CAP, `seed ${seed} ${rect.w}x${rect.h} t ${t}: ${density.toFixed(1)}`);
      }
    }
  }
});

test('starsIn counts the stars of both layers whose centre lies in the rectangle', () => {
  const p = cosmos.plan({ ...LANDSCAPE, seed: 4, palette });
  const all = cosmos.starsAt(p, 2).flat().length;
  assert.equal(cosmos.starsIn(p, { x: 0, y: 0, w: p.w, h: p.h }, 2), all);
  assert.equal(cosmos.starsIn(p, { x: 0, y: 0, w: 0, h: 0 }, 2), 0);
});

// ---- paint ----

test('paint builds the still layers once per plan, then each frame blits them around one fill per star size', () => {
  const p = cosmos.plan({ w: 640, h: 360, seed: 3, palette });
  const main = recordingContext();
  cosmos.paint(main.ctx, p, 0);
  assert.equal(surfaces.length, 2, 'ground (gradient and lift) and vignette');
  main.calls.length = 0;
  cosmos.paint(main.ctx, p, 1);
  assert.equal(surfaces.length, 2, 'cached: no new surface on a later frame');
  const kinds = main.calls.map((c) => c[0]);
  assert.equal(kinds.filter((k) => k === 'drawImage').length, 2);
  assert.equal(kinds.filter((k) => k === 'fill').length, 6, 'two layers, three sizes, one batched path each');
  assert.equal(kinds[0], 'save');
  assert.equal(kinds.at(-1), 'restore');
  assert.equal(kinds.includes('=globalAlpha'), false, 'the caller alpha (a cut fading the field) is left alone');
  assert.equal(kinds.includes('setTransform'), false, 'the caller transform (the camera) is left alone');
});

test('the ground surface paints the gradient and the lift; the vignette darkens toward the corners in palette.deep', () => {
  const p = cosmos.plan({ w: 640, h: 360, seed: 3, palette });
  cosmos.paint(recordingContext().ctx, p, 0);
  const [ground, vignette] = surfaces.map((s) => s.rec.calls);
  assert.ok(ground.some((c) => c[0] === 'createLinearGradient'));
  assert.ok(ground.some((c) => c[0] === 'createRadialGradient' && c[1] === p.lift.x && c[2] === p.lift.y));
  const vignetteStops = vignette.filter((c) => c[0] === 'addColorStop').map((c) => c[2]);
  const [r, g, b] = parseHex(palette.deep);
  assert.match(vignetteStops.at(-1), new RegExp(`^rgba\\(${r}, ${g}, ${b}, 0\\.\\d+\\)$`));
  assert.match(vignetteStops[0], /, 0\)$/, 'clear in the middle');
});

test('the same t paints the same calls; a later t moves the stars', () => {
  const p = cosmos.plan({ w: 640, h: 360, seed: 3, palette });
  const draw = (t) => { const r = recordingContext(); cosmos.paint(r.ctx, p, t); return r.calls; };
  assert.deepEqual(draw(2), draw(2));
  assert.notDeepEqual(draw(2), draw(2.5));
});

test('paint rejects a plan of another field and a t that is not finite', () => {
  const p = cosmos.plan({ w: 640, h: 360, seed: 3, palette });
  assert.throws(() => cosmos.paint(recordingContext().ctx, { field: 'paper' }, 0), /cosmos\.paint: expected a cosmos plan, got paper/);
  assert.throws(() => cosmos.paint(recordingContext().ctx, p, Number.NaN), /cosmos\.paint: t must be a finite number/);
});

test('the field source avoids document, window, Math.random, Date, performance and timers', () => {
  const source = readFileSync(new URL('../../engine/fields/cosmos.mjs', import.meta.url), 'utf8');
  for (const banned of [/\bdocument\b/, /\bwindow\b/, /Math\.random/, /\bDate\b/, /performance\.now/, /requestAnimationFrame/, /setTimeout|setInterval/]) {
    assert.doesNotMatch(source, banned);
  }
});

test('the bloom param plans a large soft disc low on the field, and the peak the review reads takes it into account', async () => {
  const { registries: regs } = await import('../../engine/registry.mjs');
  await import('../../engine/fields/index.mjs');
  const palette = { paper: '#2a1a5e', deep: '#0b1030', ink: '#f4f1ff', ink2: '#a9a4d6', accent: '#ffd166', accent2: '#4de2c5', rule: '#3d3478' };
  const field = regs.fields.get('cosmos');
  const none = field.plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette, params: {} });
  const lit = field.plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette, params: { bloom: 0.08 } });
  assert.equal(none.bloom, null, 'no bloom by default');
  assert.ok(lit.bloom.y > 0.75 * 1080, 'low on the field');
  assert.ok(lit.bloom.r >= 0.5 * 1080, 'large');
  assert.equal(lit.bloom.alpha, 0.08);
  assert.throws(() => field.plan({ w: 1920, h: 1080, unit: 1, seed: 1, palette, params: { bloom: 0.5 } }), /bloom/);
});

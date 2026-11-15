import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/fields/index.mjs';
import * as paperModule from '../../engine/fields/paper.mjs';
import * as meshModule from '../../engine/fields/mesh.mjs';
import * as halftoneModule from '../../engine/fields/halftone.mjs';
import { mix } from '../../engine/fields/color.mjs';

const palette = { paper: '#f4ecd8', ink: '#1d1a16', ink2: '#5a5247', accent: '#d9482b', accent2: '#2b6cd9', rule: '#c9bfa6' };
const FIELD_NAMES = ['paper', 'mesh', 'halftone'];
const get = (name) => registries.fields.get(name);

// A recording fake: every method call on a context is logged as [name, ...args]; gradients are objects
// that log addColorStop into the same list. OffscreenCanvas instances are collected in `surfaces`.
// A gradient whose methods live on the prototype, so two recorded gradients compare equal in deepEqual.
class FakeGradient {
  constructor(calls) { Object.defineProperty(this, 'calls', { value: calls, enumerable: false }); }
  addColorStop(...stop) { this.calls.push(['addColorStop', ...stop]); }
}

// Property writes are logged too, as ['=name', value], so tests can see state changes in call order.
// throwOn names a method that throws when called, to test cleanup.
function recordingContext({ throwOn } = {}) {
  const calls = [];
  const props = {};
  const ctx = new Proxy(props, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === throwOn) return () => { calls.push([String(key)]); throw new Error(`${String(key)} failed`); };
      if (key === 'createRadialGradient' || key === 'createLinearGradient') {
        return (...args) => {
          calls.push([key, ...args]);
          return new FakeGradient(calls);
        };
      }
      if (key === 'createImageData') {
        return (w, h) => {
          const image = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          calls.push(['createImageData', w, h]);
          return image;
        };
      }
      return (...args) => { calls.push([String(key), ...args]); };
    },
    set(target, key, value) { calls.push([`=${String(key)}`, value]); target[key] = value; return true; },
  });
  return { ctx, calls, props };
}

let surfaces;
let hadOffscreen;
let savedOffscreen;
beforeEach(() => {
  surfaces = [];
  hadOffscreen = 'OffscreenCanvas' in globalThis;
  savedOffscreen = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
    constructor(w, h) {
      this.width = w; this.height = h;
      this.rec = recordingContext();
      surfaces.push(this);
    }
    getContext(kind) { assert.equal(kind, '2d'); return this.rec.ctx; }
  };
});
afterEach(() => {
  if (hadOffscreen) globalThis.OffscreenCanvas = savedOffscreen; else delete globalThis.OffscreenCanvas;
});

const names = (calls) => calls.map((c) => c[0]);
const isFrozenDeep = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(isFrozenDeep));

test('the same seed plans the same field and a different seed a different one', () => {
  const f = registries.fields.get('paper'), a = f.plan({ w: 1920, h: 1080, seed: 7, palette }), b = f.plan({ w: 1920, h: 1080, seed: 7, palette });
  assert.deepEqual(a, b); assert.notDeepEqual(a, f.plan({ w: 1920, h: 1080, seed: 8, palette }));
});

test('mesh blobs stay within one radius of the canvas', () => {
  const p = registries.fields.get('mesh').plan({ w: 1080, h: 1920, seed: 3, palette });
  assert.ok(p.blobs.length >= 4 && p.blobs.length <= 6);
  assert.ok(p.blobs.every((b) => b.x > -b.r && b.x < 1080 + b.r && b.y > -b.r && b.y < 1920 + b.r));
});

test('importing the index registers paper, mesh and halftone with plan and paint', () => {
  for (const name of FIELD_NAMES) {
    assert.equal(registries.fields.has(name), true);
    assert.equal(typeof get(name).plan, 'function');
    assert.equal(typeof get(name).paint, 'function');
  }
  assert.equal(get('paper').plan, paperModule.plan);
  assert.equal(get('mesh').paint, meshModule.paint);
  assert.equal(get('halftone').plan, halftoneModule.plan);
});

test('every field is deterministic per seed, differs across seeds and is plain frozen JSON', () => {
  for (const name of FIELD_NAMES) {
    const f = get(name);
    const a = f.plan({ w: 1280, h: 720, unit: 720 / 1080, seed: 11, palette });
    assert.deepEqual(a, f.plan({ w: 1280, h: 720, unit: 720 / 1080, seed: 11, palette }), name);
    assert.notDeepEqual(a, f.plan({ w: 1280, h: 720, unit: 720 / 1080, seed: 12, palette }), name);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a, `${name} survives a JSON round trip`);
    assert.ok(isFrozenDeep(a), `${name} plan is deeply frozen`);
  }
});

test('unit defaults to short side / 1080 when omitted', () => {
  for (const name of FIELD_NAMES) {
    const f = get(name);
    assert.deepEqual(f.plan({ w: 540, h: 960, seed: 2, palette }), f.plan({ w: 540, h: 960, unit: 0.5, seed: 2, palette }), name);
  }
});

test('paper plans 14 to 20 low-contrast blotches of 30% to 60% of the short side, 2000 to 4000 fibres of 4 to 14 units, and a 256 px grain tile seed', () => {
  const p = get('paper').plan({ w: 1920, h: 1080, unit: 1, seed: 5, palette });
  assert.ok(p.blotches.length >= 14 && p.blotches.length <= 20, `${p.blotches.length} blotches`);
  assert.ok(p.blotches.every((bl) => bl.r >= 0.3 * 1080 && bl.r <= 0.6 * 1080), 'radii 30% to 60% of the short side');
  assert.equal(p.blotchAlpha, 0.035);
  for (const seed of [1, 2, 3, 4, 6, 7]) {
    const n = get('paper').plan({ w: 1080, h: 1920, unit: 1, seed, palette }).blotches.length;
    assert.ok(n >= 14 && n <= 20, `seed ${seed}: ${n}`);
  }
  assert.ok(p.fibres.length >= 2000 && p.fibres.length <= 4000);
  assert.ok(p.fibres.every(([, , len]) => len >= 4 && len <= 14));
  assert.equal(p.tint, palette.paper);
  assert.equal(p.grain.size, 256);
  assert.equal(typeof p.grain.seed, 'number');
  assert.ok(p.specks.length > 0);
});

test('paper fibres, specks and blotches sit inside the canvas', () => {
  const p = get('paper').plan({ w: 1080, h: 1920, unit: 1, seed: 9, palette });
  assert.ok(p.fibres.every(([x, y]) => x >= 0 && x <= 1080 && y >= 0 && y <= 1920));
  assert.ok(p.specks.every(([x, y]) => x >= 0 && x <= 1080 && y >= 0 && y <= 1920));
  assert.ok(p.blotches.every((b) => b.x >= 0 && b.x <= 1080 && b.y >= 0 && b.y <= 1920));
});

test('lengths scale with unit: a 4K canvas has twice the fibre length, blotch radius and halftone cell of 1080p', () => {
  const small = get('paper').plan({ w: 1920, h: 1080, unit: 1, seed: 5, palette });
  const big = get('paper').plan({ w: 3840, h: 2160, unit: 2, seed: 5, palette });
  assert.ok(big.fibres.every(([, , len]) => len >= 8 && len <= 28));
  assert.ok(Math.max(...big.blotches.map((b) => b.r)) > Math.max(...small.blotches.map((b) => b.r)));
  assert.equal(get('halftone').plan({ w: 3840, h: 2160, unit: 2, seed: 5, palette }).cell,
    2 * get('halftone').plan({ w: 1920, h: 1080, unit: 1, seed: 5, palette }).cell);
});

test('a 9:16 and a 16:9 canvas get the same physical texture', () => {
  const tall = get('halftone').plan({ w: 1080, h: 1920, seed: 4, palette });
  const wide = get('halftone').plan({ w: 1920, h: 1080, seed: 4, palette });
  assert.equal(tall.cell, wide.cell);
  assert.equal(tall.unit, wide.unit);
});

test('mesh plans 4 to 6 blobs coloured from the palette and its mixes toward paper', () => {
  const pool = new Set([
    palette.accent, palette.accent2, palette.ink2,
    mix(palette.accent, palette.paper, 0.5), mix(palette.accent2, palette.paper, 0.5), mix(palette.ink2, palette.paper, 0.5),
  ]);
  const p = get('mesh').plan({ w: 1920, h: 1080, seed: 21, palette });
  assert.ok(p.blobs.length >= 4 && p.blobs.length <= 6);
  for (const b of p.blobs) {
    assert.ok(pool.has(b.color), `${b.color} is a palette colour or a mix toward paper`);
    assert.ok(b.r >= 500 && b.r <= 900);
  }
  assert.equal(new Set(p.blobs.map((b) => b.color)).size, p.blobs.length, 'colours do not repeat before the pool runs out');
  assert.ok(p.blobs.some((b) => [palette.accent, palette.accent2, palette.ink2].includes(b.color)));
});

test('mesh blob radius and sway amplitude scale with unit; periods do not', () => {
  const a = get('mesh').plan({ w: 1920, h: 1080, unit: 1, seed: 8, palette });
  const b = get('mesh').plan({ w: 3840, h: 2160, unit: 2, seed: 8, palette });
  assert.ok(b.blobs.every((blob) => blob.r >= 1000 && blob.r <= 1800));
  assert.ok(b.blobs.every((blob) => blob.ampX >= 40 && blob.ampX <= 120 && blob.ampY >= 40 && blob.ampY <= 120));
  assert.deepEqual(b.blobs.map((blob) => blob.period), a.blobs.map((blob) => blob.period));
});

test('halftone plans a rotated grid: cell, angle, colour and a falloff line across the canvas', () => {
  const p = get('halftone').plan({ w: 1920, h: 1080, unit: 1, seed: 6, palette });
  assert.equal(typeof p.cell, 'number');
  assert.ok(p.cell > 0);
  assert.ok(Number.isFinite(p.angle));
  assert.match(p.color, /^#[0-9a-f]{6}$/);
  const { x0, y0, x1, y1 } = p.falloff;
  assert.ok([x0, y0, x1, y1].every(Number.isFinite));
  assert.ok(Math.hypot(x1 - x0, y1 - y0) > 0);
});

test('params override counts and strengths', () => {
  const p = get('paper').plan({ w: 1920, h: 1080, seed: 5, palette, params: { fibres: 10, blotches: 2, specks: 3, grainAlpha: 0.1 } });
  assert.equal(p.fibres.length, 10);
  assert.equal(p.blotches.length, 2);
  assert.equal(p.specks.length, 3);
  assert.equal(p.grain.alpha, 0.1);
  const m = get('mesh').plan({ w: 1920, h: 1080, seed: 5, palette, params: { blobs: 5, strength: 0.3 } });
  assert.equal(m.blobs.length, 5);
  assert.equal(m.alpha, 0.3);
  const h = get('halftone').plan({ w: 1920, h: 1080, unit: 1, seed: 5, palette, params: { cell: 30, angle: 0, color: 'accent2', strength: 1 } });
  assert.equal(h.cell, 30);
  assert.equal(h.angle, 0);
  assert.equal(h.color, palette.accent2);
});

test('an override does not move the other randomly drawn values', () => {
  const base = get('paper').plan({ w: 1920, h: 1080, seed: 5, palette });
  const fewer = get('paper').plan({ w: 1920, h: 1080, seed: 5, palette, params: { blotches: 3 } });
  assert.deepEqual(fewer.blotches, base.blotches.slice(0, 3));
});

test('unknown params throw and list the accepted names', () => {
  assert.throws(() => get('paper').plan({ w: 300, h: 300, seed: 1, palette, params: { fibers: 5 } }),
    /unknown param "fibers" for field "paper"; accepted: blotches, blotchAlpha, fibres, fibreAlpha, specks, grainAlpha/);
  assert.throws(() => get('mesh').plan({ w: 300, h: 300, seed: 1, palette, params: { x: 1 } }),
    /unknown param "x" for field "mesh"; accepted: blobs, strength/);
  assert.throws(() => get('halftone').plan({ w: 300, h: 300, seed: 1, palette, params: { size: 1 } }),
    /unknown param "size" for field "halftone"; accepted: cell, angle, color, strength/);
});

test('params with a bad value throw naming the param and its range', () => {
  assert.throws(() => get('paper').plan({ w: 300, h: 300, seed: 1, palette, params: { fibres: 2.5 } }), /param "fibres" must be an integer/);
  assert.throws(() => get('paper').plan({ w: 300, h: 300, seed: 1, palette, params: { grainAlpha: 2 } }), /param "grainAlpha" must be a number in \[0, 1\]/);
  assert.throws(() => get('mesh').plan({ w: 300, h: 300, seed: 1, palette, params: { blobs: 0 } }), /param "blobs" must be an integer in \[1, 8\]/);
  assert.throws(() => get('halftone').plan({ w: 300, h: 300, seed: 1, palette, params: { color: 'neon' } }), /param "color" must be one of: ink, ink2, accent, accent2, rule/);
  assert.throws(() => get('halftone').plan({ w: 300, h: 300, seed: 1, palette, params: [] }), /params must be an object/);
});

test('plan rejects a bad size, unit, seed or palette', () => {
  for (const name of FIELD_NAMES) {
    const f = get(name);
    assert.throws(() => f.plan({ w: 0, h: 300, seed: 1, palette }), /w and h must be positive integers/, name);
    assert.throws(() => f.plan({ w: 300, h: NaN, seed: 1, palette }), /w and h must be positive integers/, name);
    assert.throws(() => f.plan({ w: 300.5, h: 300, seed: 1, palette }), /w and h must be positive integers/, name);
    assert.throws(() => f.plan({ w: 300, h: -300, seed: 1, palette }), /w and h must be positive integers/, name);
    assert.throws(() => f.plan({ w: 300, h: 300, unit: -1, seed: 1, palette }), /unit must be at least 0\.25/, name);
    assert.throws(() => f.plan({ w: 300, h: 300, unit: 0.24, seed: 1, palette }), /unit must be at least 0\.25/, name);
    assert.throws(() => f.plan({ w: 300, h: 300, unit: NaN, seed: 1, palette }), /unit must be at least 0\.25/, name);
    assert.throws(() => f.plan({ w: 300, h: 200, seed: 1, palette }), /unit must be at least 0\.25/, `${name}: default unit 200/1080 is too small`);
    assert.doesNotThrow(() => f.plan({ w: 300, h: 270, seed: 1, palette }), name);
    assert.throws(() => f.plan({ w: 300, h: 300, seed: 'x', palette }), /seed must be an integer/, name);
    assert.throws(() => f.plan({ w: 300, h: 300, seed: 1.5, palette }), /seed must be an integer/, name);
    for (const bad of [null, undefined, 7, 'plan', []]) {
      assert.throws(() => f.plan(bad), /plan input must be an object/, `${name}: ${JSON.stringify(bad)}`);
    }
    assert.throws(() => f.plan({ w: 300, h: 300, seed: 1, palette: { ...palette, accent: 'red' } }), /palette\.accent must be #rrggbb/, name);
    assert.throws(() => f.plan({ w: 300, h: 300, seed: 1 }), /palette must be an object/, name);
  }
});

test('paper paints once into an offscreen canvas of the plan size, then only blits it', () => {
  const p = get('paper').plan({ w: 640, h: 360, seed: 5, palette });
  const main = recordingContext();
  get('paper').paint(main.ctx, p, 0);
  const surface = surfaces[0];
  assert.equal(surface.width, 640);
  assert.equal(surface.height, 360);
  assert.ok(names(surface.rec.calls).filter((n) => n === 'stroke').length >= p.fibres.length, 'fibres were stroked into the cache');
  assert.deepEqual(main.calls, [['save'], ['drawImage', surface, 0, 0], ['restore']]);
  const made = surfaces.length;
  const cachedCalls = surface.rec.calls.length;

  const again = recordingContext();
  get('paper').paint(again.ctx, p, 3.5);
  assert.equal(surfaces.length, made, 'no new offscreen canvas on the second paint');
  assert.equal(surface.rec.calls.length, cachedCalls, 'fibres were not redrawn');
  assert.deepEqual(again.calls, [['save'], ['drawImage', surface, 0, 0], ['restore']]);
});

test('paper caches per plan object: a separate plan gets its own surface', () => {
  const a = get('paper').plan({ w: 480, h: 270, seed: 1, palette });
  const b = get('paper').plan({ w: 480, h: 270, seed: 2, palette });
  get('paper').paint(recordingContext().ctx, a, 0);
  const afterA = surfaces.length;
  get('paper').paint(recordingContext().ctx, b, 0);
  assert.ok(surfaces.length > afterA);
});

test('paper layers a tint, blotch gradients, fibres, specks and a grain tile', () => {
  const p = get('paper').plan({ w: 640, h: 360, seed: 5, palette });
  get('paper').paint(recordingContext().ctx, p, 0);
  const all = surfaces.flatMap((s) => s.rec.calls);
  assert.equal(all.filter((c) => c[0] === 'createRadialGradient').length, p.blotches.length);
  assert.ok(all.some((c) => c[0] === 'fillRect' && c.slice(1).join() === `0,0,640,360`), 'tint fills the canvas');
  assert.ok(all.filter((c) => c[0] === 'drawImage').length >= 1, 'grain tile is drawn onto the paper');
  assert.equal(surfaces.some((s) => s.width === p.grain.size && s.height === p.grain.size), true);
});

test('paper grain is the same pixel for pixel for the same seed', () => {
  const a = get('paper').plan({ w: 480, h: 300, seed: 5, palette });
  const b = get('paper').plan({ w: 480, h: 300, seed: 5, palette });
  get('paper').paint(recordingContext().ctx, a, 0);
  const first = surfaces.map((s) => s.rec.calls);
  surfaces.length = 0;
  get('paper').paint(recordingContext().ctx, b, 0);
  assert.deepEqual(surfaces.map((s) => s.rec.calls), first);
});

test('paper and halftone paint the same whatever t is; mesh does not', () => {
  for (const name of ['paper', 'halftone']) {
    const f = get(name);
    const run = (t) => {
      surfaces.length = 0;
      const main = recordingContext();
      f.paint(main.ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), t);
      return { main: main.calls.map((c) => c[0]), cache: surfaces.map((s) => s.rec.calls) };
    };
    assert.deepEqual(run(0), run(9), name);
  }
  const mesh = get('mesh');
  const at = (t) => {
    const main = recordingContext();
    mesh.paint(main.ctx, mesh.plan({ w: 480, h: 300, seed: 3, palette }), t);
    return main.calls;
  };
  assert.notDeepEqual(at(0), at(9));
});

// Paints the mesh at t and returns the gradient centre [x, y] of each blob, in plan order.
function meshCentres(p, t) {
  const main = recordingContext();
  get('mesh').paint(main.ctx, p, t);
  return main.calls.filter((c) => c[0] === 'createRadialGradient').map((c) => [c[1], c[2]]);
}

test('mesh blobs sway on a closed path: never beyond their amplitude of the base, at any t', () => {
  const p = get('mesh').plan({ w: 1920, h: 1080, seed: 3, palette });
  for (const t of [0, 5, 500, 50000]) {
    meshCentres(p, t).forEach(([x, y], i) => {
      const b = p.blobs[i];
      assert.ok(Math.abs(x - b.x) <= b.ampX + 1e-6, `blob ${i} x at t=${t}`);
      assert.ok(Math.abs(y - b.y) <= b.ampY + 1e-6, `blob ${i} y at t=${t}`);
    });
  }
});

test('mesh blobs are always moving: positions at t and t + 0.5 differ', () => {
  const p = get('mesh').plan({ w: 1920, h: 1080, seed: 3, palette });
  for (const t of [0, 5, 500, 50000]) {
    const a = meshCentres(p, t), b = meshCentres(p, t + 0.5);
    a.forEach(([x, y], i) => assert.ok(x !== b[i][0] || y !== b[i][1], `blob ${i} moved between ${t} and ${t + 0.5}`));
  }
});

test('mesh sway amplitude is 20 to 60 units, period 9 to 17 s, ratio 1.2 to 1.6, and phases are in one turn', () => {
  const p = get('mesh').plan({ w: 1920, h: 1080, unit: 1, seed: 14, palette });
  for (const b of p.blobs) {
    assert.ok(b.ampX >= 20 && b.ampX <= 60 && b.ampY >= 20 && b.ampY <= 60);
    assert.ok(b.period >= 9 && b.period <= 17);
    assert.ok(b.ratio >= 1.2 && b.ratio <= 1.6);
    assert.ok([b.phase, b.phase2].every((ph) => ph >= 0 && ph < 2 * Math.PI));
  }
});

test('mesh draws each blob as a radial gradient centred on its swaying position', () => {
  const p = get('mesh').plan({ w: 640, h: 360, seed: 3, palette });
  const main = recordingContext();
  get('mesh').paint(main.ctx, p, 4);
  const gradients = main.calls.filter((c) => c[0] === 'createRadialGradient');
  assert.equal(gradients.length, p.blobs.length);
  p.blobs.forEach((b, i) => {
    const [, x0, y0, r0, x1, y1, r1] = gradients[i];
    const tau = 2 * Math.PI;
    assert.ok(Math.abs(x0 - (b.x + b.ampX * Math.sin(tau * 4 / b.period + b.phase))) < 1e-9);
    assert.ok(Math.abs(y0 - (b.y + b.ampY * Math.sin(tau * 4 / (b.period * b.ratio) + b.phase2))) < 1e-9);
    assert.equal(x1, x0);
    assert.equal(y1, y0);
    assert.equal(r0, 0);
    assert.equal(r1, b.r);
  });
  assert.equal(surfaces.length, 0, 'mesh needs no cache');
  assert.equal(main.calls.filter((c) => c[0] === 'fillRect').length, p.blobs.length + 1, 'paper base plus one fill per blob');
});

test('every field paint rejects a t that is not a finite number, naming the field', () => {
  for (const name of FIELD_NAMES) {
    const p = get(name).plan({ w: 640, h: 360, seed: 3, palette });
    for (const bad of [NaN, Infinity, '1', undefined, null]) {
      assert.throws(() => get(name).paint(recordingContext().ctx, p, bad), new RegExp(`${name}\\.paint: t must be a finite number`), `${name} t=${String(bad)}`);
    }
  }
});

test('paint rejects a plan of the wrong field and names both', () => {
  const plans = Object.fromEntries(FIELD_NAMES.map((n) => [n, get(n).plan({ w: 480, h: 300, seed: 3, palette })]));
  for (const name of FIELD_NAMES) {
    for (const other of FIELD_NAMES.filter((n) => n !== name)) {
      assert.throws(() => get(name).paint(recordingContext().ctx, plans[other], 0), { message: `${name}.paint: expected a ${name} plan, got ${other}` }, `${name} given ${other}`);
    }
    assert.throws(() => get(name).paint(recordingContext().ctx, null, 0), new RegExp(`${name}\\.paint: expected a ${name} plan, got null`));
    assert.throws(() => get(name).paint(recordingContext().ctx, {}, 0), new RegExp(`${name}\\.paint: expected a ${name} plan, got object`));
    assert.throws(() => get(name).paint(recordingContext().ctx, undefined, 0), new RegExp(`${name}\\.paint: expected a ${name} plan, got undefined`));
  }
  assert.equal(surfaces.length, 0, 'a rejected plan creates no canvas');
});

const STATE_CALLS = /^(=|setTransform$|resetTransform$|transform$|scale$|rotate$|translate$)/;

test('paint leaves no state behind: one save/restore pair around every state change', () => {
  for (const name of FIELD_NAMES) {
    const f = get(name);
    const main = recordingContext();
    f.paint(main.ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), 1);
    const list = names(main.calls);
    assert.equal(list[0], 'save', name);
    assert.equal(list.at(-1), 'restore', name);
    assert.equal(list.filter((n) => n === 'save').length, 1, name);
    assert.equal(list.filter((n) => n === 'restore').length, 1, name);
    const outside = [...list.slice(0, 1), ...list.slice(-1)];
    assert.ok(outside.every((n) => !STATE_CALLS.test(n)), `${name}: no state change outside the pair`);
  }
});

test('paint honours the caller transform, alpha and composite mode: it never resets them on the caller context', () => {
  for (const name of FIELD_NAMES) {
    const f = get(name);
    const main = recordingContext();
    f.paint(main.ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), 1);
    const touched = names(main.calls).filter((n) => /^(=globalAlpha|=globalCompositeOperation|setTransform|resetTransform|transform|scale|rotate|translate)$/.test(n));
    assert.deepEqual(touched, [], name);
  }
});

test('paint restores the context even when a draw call throws', () => {
  const cases = [['paper', 'drawImage'], ['halftone', 'drawImage'], ['mesh', 'createRadialGradient']];
  for (const [name, failing] of cases) {
    const f = get(name);
    const main = recordingContext({ throwOn: failing });
    assert.throws(() => f.paint(main.ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), 1), new RegExp(`${failing} failed`), name);
    const list = names(main.calls);
    assert.equal(list.filter((n) => n === 'save').length, 1, name);
    assert.equal(list.at(-1), 'restore', name);
  }
});

test('paint restores the context when the cache cannot be built', () => {
  delete globalThis.OffscreenCanvas;
  const f = get('paper');
  const main = recordingContext();
  assert.throws(() => f.paint(main.ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), 0), /OffscreenCanvas is not available/);
  assert.deepEqual(names(main.calls), ['save', 'restore']);
});

test('an offscreen build context sets its own transform, alpha and composite before it draws', () => {
  const DRAWS = new Set(['fillRect', 'fill', 'stroke', 'arc', 'drawImage', 'putImageData']);
  for (const name of ['paper', 'halftone']) {
    surfaces.length = 0;
    const f = get(name);
    f.paint(recordingContext().ctx, f.plan({ w: 480, h: 300, seed: 3, palette }), 0);
    assert.ok(surfaces.length >= 1);
    for (const s of surfaces) {
      const calls = s.rec.calls;
      const firstDraw = calls.findIndex((c) => DRAWS.has(c[0]));
      const before = calls.slice(0, firstDraw);
      assert.ok(before.some((c) => c[0] === 'setTransform' && c.slice(1).join() === '1,0,0,1,0,0'), `${name}: identity transform set`);
      assert.ok(before.some((c) => c[0] === '=globalAlpha' && c[1] === 1), `${name}: alpha set to 1`);
      assert.ok(before.some((c) => c[0] === '=globalCompositeOperation' && c[1] === 'source-over'), `${name}: composite set to source-over`);
    }
  }
});

test('mesh and halftone draw from different random streams for the same seed', () => {
  let agree = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const meshBucket = get('mesh').plan({ w: 480, h: 300, seed, palette }).blobs.length - 4;
    const angle = get('halftone').plan({ w: 480, h: 300, seed, palette }).angle;
    if (meshBucket === Math.min(2, Math.floor(((angle - 15) / 60) * 3))) agree += 1;
  }
  assert.ok(agree < 30, `first draws agreed for ${agree} of 40 seeds: the streams look shared`);
});

test('the paper grain tile is written with one ImageData, in 8 grey steps at the plan alpha', () => {
  const p = get('paper').plan({ w: 480, h: 300, seed: 5, palette });
  get('paper').paint(recordingContext().ctx, p, 0);
  const tile = surfaces.find((s) => s.width === p.grain.size && s.height === p.grain.size);
  const calls = tile.rec.calls;
  assert.deepEqual(calls.filter((c) => c[0] === 'createImageData').map((c) => c.slice(1)), [[256, 256]]);
  const puts = calls.filter((c) => c[0] === 'putImageData');
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].slice(2), [0, 0]);
  assert.equal(calls.filter((c) => c[0] === 'fillRect').length, 0, 'no per-pixel rects');
  const { data } = puts[0][1];
  const alpha = Math.round(p.grain.alpha * 255);
  const greys = new Set();
  for (let i = 0; i < data.length; i += 4) {
    assert.ok(data[i] === data[i + 1] && data[i] === data[i + 2], 'grey');
    assert.equal(data[i + 3], alpha);
    greys.add(data[i]);
  }
  assert.deepEqual([...greys].sort((a, b) => a - b), [0, 36, 73, 109, 146, 182, 219, 255]);
});

test('halftone dots sit on a grid rotated by the plan angle', () => {
  const dots = (angle) => {
    surfaces.length = 0;
    const f = get('halftone');
    f.paint(recordingContext().ctx, f.plan({ w: 600, h: 600, unit: 1, seed: 1, palette, params: { angle, cell: 30 } }), 0);
    return surfaces[0].rec.calls.filter((c) => c[0] === 'arc');
  };
  const distinctX = (arcs) => new Set(arcs.map((c) => c[1].toFixed(3))).size;
  assert.ok(distinctX(dots(0)) <= 25, 'angle 0 gives a handful of columns');
  assert.ok(distinctX(dots(30)) > 100, 'angle 30 spreads the dots over many x values');
});

test('halftone dot radius falls off along the falloff line and never exceeds half a cell', () => {
  const f = get('halftone');
  const p = f.plan({ w: 1200, h: 800, unit: 1, seed: 2, palette });
  f.paint(recordingContext().ctx, p, 0);
  const arcs = surfaces[0].rec.calls.filter((c) => c[0] === 'arc');
  assert.ok(arcs.length > 50);
  assert.ok(arcs.every((c) => c[3] > 0 && c[3] <= p.cell / 2));
  const { x0, y0, x1, y1 } = p.falloff;
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  const along = (c) => ((c[1] - x0) * (x1 - x0) + (c[2] - y0) * (y1 - y0)) / len2;
  const mean = (list) => list.reduce((s, c) => s + c[3], 0) / list.length;
  const near = arcs.filter((c) => along(c) < 0.33), far = arcs.filter((c) => along(c) > 0.6);
  assert.ok(near.length > 0 && far.length > 0);
  assert.ok(mean(near) > mean(far) * 1.5, 'dots near the start are clearly bigger than near the end');
});

test('halftone fills its background and caches like paper', () => {
  const f = get('halftone');
  const p = f.plan({ w: 400, h: 300, unit: 1, seed: 2, palette });
  const main = recordingContext();
  f.paint(main.ctx, p, 0);
  const surface = surfaces[0];
  assert.deepEqual(main.calls, [['save'], ['drawImage', surface, 0, 0], ['restore']]);
  assert.ok(surface.rec.calls.some((c) => c[0] === 'fillRect' && c.slice(1).join() === '0,0,400,300'));
  const count = surface.rec.calls.length;
  f.paint(recordingContext().ctx, p, 5);
  assert.equal(surface.rec.calls.length, count);
  assert.equal(surfaces.length, 1);
});

test('paint without OffscreenCanvas fails with a clear message instead of a ReferenceError', () => {
  delete globalThis.OffscreenCanvas;
  const p = get('paper').plan({ w: 300, h: 300, seed: 1, palette });
  assert.throws(() => get('paper').paint(recordingContext().ctx, p, 0), /OffscreenCanvas is not available/);
});

test('field sources avoid document, window, Math.random, Date and timers', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['paper', 'mesh', 'halftone', 'color', 'shared', 'index']) {
    const src = await readFile(new URL(`../../engine/fields/${file}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\b(document|window|requestAnimationFrame)\b|Math\.random|Date\.|performance\.now/, file);
  }
});

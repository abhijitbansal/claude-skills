// The `cosmos` look's base data (engine/looks/cosmos.mjs): registered and validated, experimental (resolvable by name but
// left out of every listing until it has its kinds data, devices and captions), the brief's values, a sound for every
// event, contrast of every colour it draws with against the field at its darkest, lightest and lifted points, and the
// rules test/v2/looks.test.mjs applies to every listed look, repeated here because an experimental look is not listed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegistry, registries } from '../../engine/registry.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { FONTS } from '../../engine/fonts/index.mjs';
import { facesFor } from '../../engine/page/fonts-shared.mjs';
import '../../engine/fields/index.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/kinds/index.mjs'; // the kinds, for the devices they send through their events hook
import { kindSupportProblems, validateLook } from '../../engine/looks/index.mjs';
import { cosmos as cosmosDefinition } from '../../engine/looks/cosmos.mjs';
import { contrastRatio as contrast } from '../../shared/contrast.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';

const look = () => registries.looks.get('cosmos');
const MIN_CONTRAST = 3; // the review's rule for any mark or text
const TEXT_CONTRAST = 4.5; // ink and ink2 carry body text
const isFrozenDeep = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(isFrozenDeep));
const kindDevices = () => registries.kinds.names().flatMap((k) => registries.kinds.get(k).eventDevices ?? []);

// ---- registration ----

test('cosmos is registered, validated, frozen, and resolvable by name', () => {
  assert.equal(registries.looks.has('cosmos'), true);
  assert.equal(look().name, 'cosmos');
  assert.equal(validateLook(look()), look());
  assert.ok(isFrozenDeep(look()));
});

test('cosmos is experimental: left out of the look names, --list looks and unknown-look hints; desk and pop stay listed', () => {
  assert.equal(look().experimental, true);
  assert.deepEqual(registries.looks.names(), ['desk', 'pop']);
  assert.deepEqual(listEntries('looks').map((e) => e.name), ['desk', 'pop']);
  assert.throws(() => registries.looks.get('cosmo'), { message: 'unknown look "cosmo" (have: desk, pop)' });
  assert.throws(() => registries.looks.get('dsk'), { message: 'unknown look "dsk"; did you mean "desk"? (have: desk, pop)' });
  assert.deepEqual(kindSupportProblems('end', look()), [{ path: 'show', message: 'kind "end" is not supported by look "cosmos"; the looks that support it: desk, pop' }]);
});

test('a second evaluation of the looks index keeps one wrapper and the same listing', async () => {
  await assert.doesNotReject(() => import('../../engine/looks/index.mjs?cosmos-again'));
  assert.deepEqual(registries.looks.names(), ['desk', 'pop']);
  assert.equal(registries.looks.has('cosmos'), true);
});

// ---- the brief's values ----

test('palette: deep navy to violet field, ink, ink2, the glow accent, accent2 and two shape colours', () => {
  assert.deepEqual({ ...look().palette }, {
    paper: '#2a1a5e', deep: '#0b1030', ink: '#f4f1ff', ink2: '#a9a4d6', accent: '#ffd166', accent2: '#4de2c5',
    shape: '#ff6b9a', shape2: '#6ea8ff', rule: '#3d3478',
  });
});

test('type: Nunito at medium to bold weights in every role, sentence case, the brief scale and grid', () => {
  const l = look();
  for (const role of ['display', 'text', 'label']) {
    assert.equal(l.fonts[role].family, 'Nunito', role);
    assert.ok(l.fonts[role].weight >= 500 && l.fonts[role].weight <= 900, `${role} weight ${l.fonts[role].weight}`);
    assert.equal(l.fonts[role].width, 'normal', role);
  }
  assert.deepEqual({ ...l.caps }, { display: false, label: false });
  assert.deepEqual([...l.scale], [32, 46, 76, 136, 232]);
  assert.deepEqual({ ...l.grid }, { columns: 12, margin: 96, gutter: 24 });
});

test('composition, emphasis, field, camera, cuts, grain, captions and modes', () => {
  const l = look();
  assert.equal(l.composition, 'editorial', 'statements flush left on the grid');
  assert.equal(l.emphasis, 'glow');
  assert.deepEqual({ ...l.field, params: { ...l.field.params } }, { field: 'cosmos', params: {} });
  assert.equal(l.camera.style, 'desk', 'the resting drift: linear, no shake');
  assert.ok(l.camera.drift > 0 && l.camera.drift <= 12, `a slow drift: ${l.camera.drift} units`);
  assert.deepEqual([...l.cuts], ['cut', 'match']);
  assert.equal(l.post.grain, 0.01);
  assert.equal(l.post.halftone, 0, 'no halftone');
  assert.equal(registries.captions.has(l.captions), true);
  assert.deepEqual([...l.modes], ['pro', 'viral']);
});

test('motion: smooth in-out curves with a small overshoot, entrances scale from 0.92 with a fade, nothing steps', () => {
  const { moves } = look();
  assert.equal(moves.enter.scale, 0.92);
  assert.equal(moves.enter.dist, undefined, 'entrances scale, they do not travel');
  for (const [key, move] of Object.entries(moves)) {
    assert.equal(move.step, undefined, `${key} is smooth, not stepped`);
    assert.match(move.ease, /^inOut/, `${key} eases in and out`);
  }
  const curve = ease(moves.enter.ease);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => curve(i / 100)));
  assert.ok(peak > 1 && peak < 1.15, `a small overshoot: ${peak.toFixed(3)}`);
});

test('sounds are the brief values, one for every registered cut, device and kind event device', () => {
  const { sounds } = look();
  assert.deepEqual({ ...sounds.cut }, { cut: null, slide: 'whoosh', punch: 'sub', match: null });
  assert.deepEqual({ ...sounds.device }, {
    highlight: 'chime', circle: 'chime', underline: 'chime', arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: null, item: 'pop', turn: 'whoosh',
  });
  assert.equal(sounds.emphasis, null);
  assert.equal(sounds.land, 'ding');
  assert.deepEqual(Object.keys(sounds.cut).sort(), registries.cuts.names().sort());
  assert.deepEqual(Object.keys(sounds.device).sort(), [...registries.devices.names(), ...kindDevices()].sort());
});

// ---- contrast ----

test('ink, ink2, the accent and both shape colours hold 3:1 against the field top, bottom and lift peak; ink and ink2 hold 4.5:1', () => {
  const l = look();
  const fieldPlan = registries.fields.get('cosmos').plan({ w: 2150, h: 1210, unit: 1, seed: 1, palette: l.palette, params: l.field.params });
  const grounds = { deep: l.palette.deep, paper: l.palette.paper, peak: fieldPlan.peak };
  for (const key of ['ink', 'ink2', 'accent', 'accent2', 'shape', 'shape2']) {
    for (const [name, ground] of Object.entries(grounds)) {
      const ratio = contrast(l.palette[key], ground);
      assert.ok(ratio >= MIN_CONTRAST, `${key} on ${name}: ${ratio.toFixed(2)}`);
      if (key === 'ink' || key === 'ink2') assert.ok(ratio >= TEXT_CONTRAST, `${key} on ${name}: ${ratio.toFixed(2)}`);
    }
  }
});

test('palette.paper is the lighter field colour, so the review contrast rule (which reads paper) measures the worse end', () => {
  const { palette } = look();
  assert.ok(contrast(palette.ink, palette.paper) < contrast(palette.ink, palette.deep));
});

// ---- the rules looks.test.mjs applies to every listed look ----

test('the type rules: hero at least 3x the supporting text, a floor of 28, five ascending steps, twelve columns', () => {
  const l = look();
  assert.ok(l.scale[4] / l.scale[1] >= 3);
  assert.ok(l.scale[0] >= 28);
  assert.deepEqual([...l.scale], [...l.scale].sort((a, b) => a - b));
  assert.equal(l.grid.columns, 12);
});

test('every font it names is bundled at a weight its family reaches, the stage can load it, and no move animates an axis', () => {
  const l = look();
  for (const role of ['display', 'text', 'label']) {
    const font = l.fonts[role];
    const entry = FONTS.find((f) => f.family === font.family);
    assert.ok(entry, `${role}: ${font.family} is bundled`);
    assert.equal(entry.reach.wght, true);
    const [lo, hi] = entry.axes.wght;
    assert.ok(font.weight >= lo && font.weight <= hi, `${role}: weight ${font.weight} in ${lo}..${hi}`);
  }
  assert.deepEqual(facesFor({ fonts: l.fonts }).map((f) => f.family), ['Nunito']);
  for (const move of Object.values(l.moves)) assert.equal('axis' in move, false);
});

test('its field is registered and plans with its params at 16:9 and 9:16', () => {
  const l = look();
  for (const size of [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }]) {
    assert.doesNotThrow(() => registries.fields.get(l.field.field).plan({ ...size, seed: 1, palette: l.palette, params: l.field.params }));
  }
});

test('every move parses and has the grammar keys; tracking answers each role and refuses others', () => {
  const l = look();
  assert.deepEqual(Object.keys(l.moves), ['enter', 'exit', 'emphasize', 'draw', 'count']);
  for (const [key, move] of Object.entries(l.moves)) {
    assert.equal(typeof ease(move.ease), 'function', key);
    assert.ok(move.dur > 0, key);
  }
  for (const role of ['display', 'text', 'label']) assert.equal(typeof l.tracking(76, role), 'number');
  assert.throws(() => l.tracking(76, 'caption'), /tracking role must be one of display, text, label/);
});

// ---- the validator ----

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-cosmos-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));

function realRegistries() {
  const kinds = createRegistry('kind');
  kinds.add('plain', { schema: { properties: {} } });
  return { ...registries, kinds };
}
const validate = (film) => validateFilm(film, { specDir, registries: realRegistries() });
const shots = (...cuts) => cuts.map((cut, i) => ({ id: `s${i}`, show: 'plain', hold: 2, ...(cut ? { cut } : {}) }));

test('a film may name cosmos in pro at 16:9 and in viral at 9:16; its cuts are cut and match', () => {
  assert.deepEqual(validate({ version: 2, mode: 'pro', look: 'cosmos', format: '16:9', shots: shots(undefined, 'match', 'cut') }), { ok: true, errors: [] });
  assert.deepEqual(validate({ version: 2, mode: 'viral', look: 'cosmos', format: '9:16', shots: shots(undefined, 'match') }), { ok: true, errors: [] });
  const slide = validate({ version: 2, mode: 'pro', look: 'cosmos', shots: shots(undefined, 'slide') });
  assert.match(slide.errors[0].message, /look "cosmos" has no cut "slide".* its cuts are: cut, match/);
});

test('the definition module exports the plain data the index freezes and registers', () => {
  assert.equal(cosmosDefinition.name, 'cosmos');
  assert.deepEqual(cosmosDefinition.scale, [...look().scale]);
});

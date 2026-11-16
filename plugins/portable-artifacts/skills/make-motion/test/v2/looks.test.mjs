import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegistry, registries } from '../../engine/registry.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { FONTS, STRETCH_KEYWORDS } from '../../engine/fonts/index.mjs';
import { facesFor } from '../../engine/page/fonts-shared.mjs';
import '../../engine/fields/index.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { applyAccent, gridX, gridSpan, unit } from '../../engine/looks/index.mjs';
import { unitOf } from '../../engine/units.mjs';
import { FORMATS } from '../../template/formats.mjs';
import { contrastRatio as contrast } from '../../shared/contrast.mjs';
import { validateFilm, withFilmDefaults } from '../../scripts/v2/spec.mjs';

const LANDSCAPE = { w: 1920, h: 1080 };
const PORTRAIT = { w: 1080, h: 1920 };
const UHD = { w: 3840, h: 2160 };
const KNOWN_CUTS = ['cut', 'match', 'slide', 'punch'];
const FONT_ROLES = ['display', 'text', 'label'];
const ACCENT_SAMPLE = '#ff6600';
const lookNames = () => registries.looks.names();
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);

test('desk and pop are registered, in showreel order', () => {
  assert.deepEqual(lookNames(), ['desk', 'pop']);
  assert.deepEqual(registries.modes.names(), ['pro', 'viral']);
  assert.equal(registries.looks.get('desk').name, 'desk');
  assert.equal(registries.looks.get('pop').name, 'pop');
});

test('every look meets the type rules', () => {
  for (const name of lookNames()) {
    const l = registries.looks.get(name);
    assert.ok(l.scale[4] / l.scale[1] >= 3, name + ' hero is at least 3x the supporting text');
    assert.ok(l.scale[0] >= 28, name + ' floor');
    assert.equal(l.scale.length, 5, name + ' has five steps');
    assert.deepEqual([...l.scale], [...l.scale].sort((a, b) => a - b), name + ' scale runs small to large');
    assert.equal(l.grid.columns, 12);
    for (const m of Object.values(l.moves)) assert.doesNotThrow(() => ease(m.ease));
    for (const c of l.cuts) assert.ok(KNOWN_CUTS.includes(c));
  }
});

test('ink on paper passes 4.5:1 and the accent is used behind ink, not as text on paper', () => {
  for (const name of ['desk', 'pop']) {
    const { palette: p } = registries.looks.get(name);
    assert.ok(contrast(p.ink, p.paper) >= 4.5);
    assert.ok(contrast(p.ink2, p.paper) >= 4.5);
  }
  assert.ok(contrast('#15130f', registries.looks.get('desk').palette.accent) >= 4.5);
});

test('every font a look names is bundled, at a weight and width its family can reach', () => {
  const widthKeywords = new Set(STRETCH_KEYWORDS.map(([, keyword]) => keyword));
  for (const name of lookNames()) {
    const { fonts } = registries.looks.get(name);
    assert.deepEqual(Object.keys(fonts), FONT_ROLES);
    for (const role of FONT_ROLES) {
      const font = fonts[role];
      assert.equal(typeof font.family, 'string');
      assert.equal('size' in font, false, `${name}.${role} carries no size`);
      assert.ok(widthKeywords.has(font.width), `${name}.${role}.width is a stretch keyword, got ${font.width}`);
      const variable = FONTS.find((f) => f.family === font.family);
      if (variable) {
        assert.equal(variable.reach.wght, true, `${name}.${role} weight is reachable`);
        assert.equal(variable.fixed, undefined, `${name}.${role} uses a base family, not a derived one`);
        if (font.width !== 'normal') assert.equal(variable.reach.wdth, true, `${name}.${role} width is reachable`);
      } else {
        assert.equal(font.width, 'normal', `${name}.${role} is a static face with no width axis`);
        const faces = facesFor({ font });
        assert.ok(faces.some((face) => face.descriptors.weight === String(font.weight)), `${font.family} ${font.weight} is bundled`);
      }
    }
  }
});

test('looks never animate an axis the canvas cannot reach', () => {
  for (const name of lookNames()) {
    const { fonts, moves } = registries.looks.get(name);
    const used = FONT_ROLES.map((role) => fonts[role]).filter((f) => FONTS.some((x) => x.family === f.family));
    for (const font of used) {
      const entry = FONTS.find((f) => f.family === font.family);
      assert.equal(entry.reach.wght, true);
    }
    for (const move of Object.values(moves)) assert.equal('axis' in move, false, `${name}: moves animate no font axis`);
  }
});

test('desk display is the base Fraunces at 600 and lets canvas pick the optical size', () => {
  const { fonts } = registries.looks.get('desk');
  assert.deepEqual({ ...fonts.display }, { family: 'Fraunces', weight: 600, width: 'normal' });
  assert.deepEqual({ ...fonts.text }, { family: 'Schibsted Grotesk', weight: 400, width: 'normal' });
  assert.deepEqual({ ...fonts.label }, { family: 'JetBrains Mono', weight: 400, width: 'normal' });
  assert.equal(FONTS.some((f) => f.family === 'Fraunces' && f.fixed === undefined), true);
});

test('pop type is Archivo with width as a keyword', () => {
  const { fonts } = registries.looks.get('pop');
  assert.deepEqual({ ...fonts.display }, { family: 'Archivo', weight: 900, width: 'extra-condensed', wordSpace: 0.26 });
  assert.deepEqual({ ...fonts.text }, { family: 'Archivo', weight: 700, width: 'condensed' });
  assert.deepEqual({ ...fonts.label }, { family: 'Archivo', weight: 700, width: 'normal' });
});

test('every field a look names is registered and accepts the look params', () => {
  for (const name of lookNames()) {
    const { field, palette } = registries.looks.get(name);
    assert.ok(registries.fields.has(field.field), `${name} names field ${field.field}`);
    for (const size of [LANDSCAPE, PORTRAIT]) {
      assert.doesNotThrow(() => registries.fields.get(field.field).plan({ ...size, seed: 1, palette, params: field.params }));
    }
  }
});

test('every move names a curve that parses and has the keys the grammar needs', () => {
  for (const name of lookNames()) {
    const { moves } = registries.looks.get(name);
    assert.deepEqual(Object.keys(moves), ['enter', 'exit', 'emphasize', 'draw', 'count']);
    for (const [key, move] of Object.entries(moves)) {
      assert.equal(typeof ease(move.ease), 'function', `${name}.${key}`);
      assert.ok(move.dur > 0, `${name}.${key} has a duration`);
    }
  }
  assert.throws(() => ease('wobble'), /unknown ease/);
});

test('desk values are the brief values', () => {
  const l = registries.looks.get('desk');
  assert.deepEqual([...l.modes], ['pro']);
  assert.deepEqual({ ...l.palette }, { paper: '#f3eee3', ink: '#15130f', ink2: '#5b554a', accent: '#ffe14a', accent2: '#d63a2f', rule: '#cfc7b6' });
  assert.deepEqual([...l.scale], [30, 44, 72, 132, 220]);
  assert.deepEqual({ ...l.grid }, { columns: 12, margin: 96, gutter: 24 });
  assert.equal(l.field.field, 'paper');
  assert.equal(l.emphasis, 'highlight');
  assert.deepEqual({ ...l.moves.enter }, { ease: 'outCubic', dur: 0.5, dist: 24 });
  assert.deepEqual({ ...l.moves.draw }, { ease: 'linear', dur: 0.5, step: 12 });
  assert.equal(l.moves.emphasize.dur, 0.25);
  assert.equal(l.moves.emphasize.step, 12);
  assert.equal(l.wordStagger, 0);
  assert.deepEqual({ ...l.camera }, { drift: 12, style: 'desk' });
  assert.deepEqual([...l.cuts], ['cut', 'match', 'slide']);
  assert.equal(l.post.grain, 0.02);
  assert.deepEqual({ ...l.caps }, { display: false, label: true });
  assert.deepEqual({ ...l.lineHeight }, { display: 1.1, text: 1.3 });
  assert.deepEqual({ ...l.maxLines }, { display: 4, text: 3 });
  assert.deepEqual({ ...l.wordsPerLine }, { text: 12 });
  assert.equal(l.keyline, 8);
  assert.deepEqual({ ...l.shadow }, { dx: 10, dy: 14, blur: 18, alpha: 0.25, color: '#000000' });
});

test('pop values are the brief values', () => {
  const l = registries.looks.get('pop');
  assert.deepEqual([...l.modes], ['viral']);
  assert.deepEqual({ ...l.palette }, { paper: '#111111', ink: '#ffffff', ink2: '#b8b8b8', accent: '#d7ff3f', accent2: '#ff4d2e', rule: '#2a2a2a' });
  assert.deepEqual([...l.scale], [36, 56, 96, 180, 320]);
  assert.deepEqual({ ...l.grid }, { columns: 12, margin: 72, gutter: 20 });
  assert.equal(l.field.field, 'halftone');
  assert.equal(l.emphasis, 'recolor');
  assert.deepEqual({ ...l.moves.enter }, { ease: 'spring(260,16)', dur: 0.28, scale: 0.6 });
  assert.deepEqual({ ...l.moves.emphasize }, { ease: 'spring(300,12)', dur: 0.2, scale: 1.12 });
  assert.deepEqual({ ...l.moves.draw }, { ease: 'outExpo', dur: 0.2 });
  assert.deepEqual({ ...l.camera }, { drift: 0, style: 'locked' });
  assert.deepEqual([...l.cuts], ['cut', 'punch', 'slide']);
  assert.deepEqual({ ...l.post }, { grain: 0.02, halftone: 0, bloom: 0 });
  assert.deepEqual({ ...l.caps }, { display: true, label: true });
  assert.deepEqual({ ...l.lineHeight }, { display: 0.92, text: 1.15 });
  assert.deepEqual({ ...l.maxLines }, { display: 3, text: 3 });
  assert.deepEqual({ ...l.wordsPerLine }, { text: 12 });
  assert.equal(l.keyline, 14);
  assert.deepEqual({ ...l.shadow }, { dx: 10, dy: 10, blur: 0, alpha: 1, color: '#ff4d2e' });
  assert.equal(l.shadow.color, l.palette.accent2);
});

test('looks and their parts are frozen, and the registry hands back the same object', () => {
  for (const name of lookNames()) {
    const l = registries.looks.get(name);
    for (const part of [l, l.fonts, l.fonts.display, l.palette, l.scale, l.grid, l.caps, l.field, l.field.params, l.moves, l.moves.enter,
      l.camera, l.cuts, l.devices, l.post, l.lineHeight, l.maxLines, l.wordsPerLine, l.shadow, l.modes]) {
      assert.ok(Object.isFrozen(part), `${name} part is frozen`);
    }
    for (const device of Object.values(l.devices)) assert.ok(Object.isFrozen(device));
    assert.throws(() => { l.palette.accent = '#000000'; }, TypeError);
    assert.throws(() => { l.scale[0] = 1; }, TypeError);
  }
  for (const n of registries.modes.names()) assert.ok(Object.isFrozen(registries.modes.get(n)));
});

test('tracking: desk display tightens from 132 units, pop display is a constant -0.02, labels are tracked out', () => {
  const desk = registries.looks.get('desk'), pop = registries.looks.get('pop');
  for (const size of [30, 44, 72, 131.9]) assert.equal(desk.tracking(size), 0, `desk display at ${size}`);
  for (const size of [132, 220, 400]) assert.equal(desk.tracking(size), -0.01, `desk display at ${size}`);
  for (const size of [36, 56, 96, 180, 320]) assert.equal(pop.tracking(size), -0.02, `pop display at ${size}`);
  assert.equal(desk.tracking(30, 'label'), 0.08);
  assert.equal(desk.tracking(200, 'label'), 0.08);
  assert.equal(pop.tracking(36, 'label'), 0.06);
  assert.equal(desk.tracking(44, 'text'), 0);
  assert.equal(pop.tracking(56, 'text'), 0);
  assert.throws(() => desk.tracking(44, 'caption'), /tracking role must be one of display, text, label/);
});

test('gridX on 1920x1080 and 1080x1920 for desk (hand computed: columns are 122 and 52 px)', () => {
  const desk = registries.looks.get('desk');
  assert.equal(unit(LANDSCAPE), 1);
  assert.equal(gridX(desk, LANDSCAPE, 1), 96);
  assert.equal(gridX(desk, LANDSCAPE, 2), 242);
  assert.equal(gridX(desk, LANDSCAPE, 7), 972);
  assert.equal(gridX(desk, LANDSCAPE, 12), 1702);
  assert.equal(gridX(desk, LANDSCAPE, 13), 1824);
  assert.equal(gridX(desk, PORTRAIT, 1), 96);
  assert.equal(gridX(desk, PORTRAIT, 2), 172);
  assert.equal(gridX(desk, PORTRAIT, 7), 552);
  assert.equal(gridX(desk, PORTRAIT, 13), 984);
});

test('gridX on 1920x1080 and 1080x1920 for pop (columns are 1556/12 and 716/12 px)', () => {
  const pop = registries.looks.get('pop');
  closeTo(gridX(pop, LANDSCAPE, 1), 72, 'landscape 1');
  closeTo(gridX(pop, LANDSCAPE, 2), 72 + 1556 / 12 + 20, 'landscape 2');
  closeTo(gridX(pop, LANDSCAPE, 13), 1848, 'landscape right edge');
  closeTo(gridX(pop, PORTRAIT, 2), 72 + 716 / 12 + 20, 'portrait 2');
  closeTo(gridX(pop, PORTRAIT, 13), 1008, 'portrait right edge');
});

test('gridX scales with the canvas unit', () => {
  const desk = registries.looks.get('desk');
  assert.equal(unitOf(UHD), 2);
  assert.equal(gridX(desk, UHD, 1), 192);
  assert.equal(gridX(desk, UHD, 2), 484);
  assert.equal(gridX(desk, UHD, 13), 3648);
});

test('gridSpan gives the left edge and width of columns from through to', () => {
  const desk = registries.looks.get('desk'), pop = registries.looks.get('pop');
  assert.deepEqual(gridSpan(desk, LANDSCAPE, 1, 12), { x: 96, w: 1728 });
  assert.deepEqual(gridSpan(desk, LANDSCAPE, 1, 1), { x: 96, w: 122 });
  assert.deepEqual(gridSpan(desk, LANDSCAPE, 2, 6), { x: 242, w: 5 * 122 + 4 * 24 });
  assert.deepEqual(gridSpan(desk, PORTRAIT, 1, 12), { x: 96, w: 888 });
  assert.deepEqual(gridSpan(desk, PORTRAIT, 3, 4), { x: 248, w: 2 * 52 + 24 });
  const { x, w } = gridSpan(pop, LANDSCAPE, 1, 12);
  closeTo(x, 72, 'pop span x');
  closeTo(w, 1776, 'pop full span');
  assert.deepEqual(gridSpan(desk, UHD, 1, 12), { x: 192, w: 3456 });
});

test('gridX and gridSpan reject columns off the grid', () => {
  const desk = registries.looks.get('desk');
  for (const column of [0, 14, 1.5, '2', NaN]) assert.throws(() => gridX(desk, LANDSCAPE, column), /column must be an integer from 1 to 13/);
  for (const [from, to] of [[0, 3], [3, 13], [5, 4], [1.5, 2]]) assert.throws(() => gridSpan(desk, LANDSCAPE, from, to), /columns? .*1 to 12/);
  assert.throws(() => gridX(desk, { w: 0, h: 1080 }, 1), /unitOf/);
});

test('applyAccent returns a frozen copy with only the accent changed', () => {
  const desk = registries.looks.get('desk');
  const tinted = applyAccent(desk, ACCENT_SAMPLE);
  assert.equal(tinted.palette.accent, ACCENT_SAMPLE);
  assert.notEqual(tinted, desk);
  assert.equal(desk.palette.accent, '#ffe14a', 'the registered look is untouched');
  assert.deepEqual({ ...tinted.palette, accent: desk.palette.accent }, { ...desk.palette });
  assert.deepEqual({ ...tinted.shadow }, { ...desk.shadow });
  assert.equal(tinted.fonts, desk.fonts);
  assert.equal(tinted.tracking(220), -0.01, 'functions survive the copy');
  assert.ok(Object.isFrozen(tinted) && Object.isFrozen(tinted.palette) && Object.isFrozen(tinted.shadow));
  assert.equal(registries.looks.get('pop').shadow.color, registries.looks.get('pop').palette.accent2);
  assert.equal(applyAccent(registries.looks.get('pop'), '#FF6600').palette.accent, '#FF6600');
});

test('applyAccent also recolours a shadow that was the accent', () => {
  const look = registries.looks.get('desk');
  const accentShadow = Object.freeze({ ...look, shadow: Object.freeze({ ...look.shadow, color: look.palette.accent }) });
  assert.equal(applyAccent(accentShadow, ACCENT_SAMPLE).shadow.color, ACCENT_SAMPLE);
});

test('applyAccent rejects anything that is not #rrggbb', () => {
  const desk = registries.looks.get('desk');
  for (const bad of ['red', '#fff', '#ff66000', 'ff6600', '#gg0000', '', undefined, null, 255, {}]) {
    assert.throws(() => applyAccent(desk, bad), /accent must be #rrggbb/, String(bad));
  }
});

test('each mode names a default look that serves it', () => {
  for (const n of registries.modes.names()) {
    const m = registries.modes.get(n);
    assert.ok(registries.looks.get(m.defaultLook).modes.includes(n));
    assert.ok(Object.hasOwn(FORMATS, m.defaultFormat), `${n} default format ${m.defaultFormat} exists`);
  }
});

test('mode values are the brief values', () => {
  // Compared field by field: a mode also carries `summary`, the one-line text make.mjs --list prints.
  const brief = {
    pro: { name: 'pro', defaultLook: 'desk', defaultFormat: '16:9', wpm: 150, tail: 0.6, maxStillSeconds: 6, captions: false },
    viral: { name: 'viral', defaultLook: 'pop', defaultFormat: '9:16', wpm: 175, tail: 0.3, maxStillSeconds: 3, captions: true },
  };
  for (const [name, values] of Object.entries(brief)) {
    const mode = registries.modes.get(name);
    for (const [field, want] of Object.entries(values)) assert.equal(mode[field], want, `${name}.${field}`);
    assert.equal(typeof mode.summary, 'string', `${name} has a summary`);
  }
});

test('registering twice is harmless: a second evaluation of the index does not throw', async () => {
  await assert.doesNotReject(() => import('../../engine/looks/index.mjs?again'));
  await assert.doesNotReject(() => import('../../engine/modes/index.mjs?again'));
  assert.deepEqual(lookNames(), ['desk', 'pop']);
  assert.deepEqual(registries.modes.names(), ['pro', 'viral']);
});

// --- the validator, with the real looks and modes and one stub kind ---

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-looks-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));

function realRegistries() {
  const kinds = createRegistry('kind');
  kinds.add('plain', { schema: { properties: {} } });
  return { ...registries, kinds };
}
const shots = (...cuts) => cuts.map((cut, i) => ({ id: `s${i}`, show: 'plain', hold: 2, ...(cut ? { cut } : {}) }));
const validate = (film) => validateFilm(film, { specDir, registries: realRegistries() });

test('scripts/v2/spec.mjs validates a minimal film for each mode with its default look and format filled in', () => {
  for (const [mode, look, format] of [['pro', 'desk', '16:9'], ['viral', 'pop', '9:16']]) {
    const film = { version: 2, mode, shots: shots(undefined) };
    assert.deepEqual(validate(film), { ok: true, errors: [] }, mode);
    const filled = withFilmDefaults(film, realRegistries());
    assert.equal(filled.look, look);
    assert.equal(filled.format, format);
    assert.deepEqual(validate(filled), { ok: true, errors: [] }, `${mode} filled`);
  }
  assert.deepEqual(validate({ version: 2, shots: shots(undefined) }), { ok: true, errors: [] }, 'mode defaults to pro');
});

test('the validator refuses mode viral with look desk, and pro with pop', () => {
  const viral = validate({ version: 2, mode: 'viral', look: 'desk', shots: shots(undefined) });
  assert.equal(viral.ok, false);
  assert.deepEqual(viral.errors, [{ path: 'look', message: 'look "desk" does not serve mode "viral" (it serves: pro)' }]);
  const pro = validate({ version: 2, mode: 'pro', look: 'pop', shots: shots(undefined) });
  assert.deepEqual(pro.errors, [{ path: 'look', message: 'look "pop" does not serve mode "pro" (it serves: viral)' }]);
});

test('the validator reads each look cuts: punch is pop only, match is desk only', () => {
  assert.equal(validate({ version: 2, mode: 'pro', shots: shots(undefined, 'match', 'slide', 'cut') }).ok, true);
  assert.equal(validate({ version: 2, mode: 'viral', shots: shots(undefined, 'punch', 'slide', 'cut') }).ok, true);
  const proPunch = validate({ version: 2, mode: 'pro', shots: shots(undefined, 'punch') });
  assert.match(proPunch.errors[0].message, /look "desk" has no cut "punch".* its cuts are: cut, match, slide/);
  const viralMatch = validate({ version: 2, mode: 'viral', shots: shots(undefined, 'match') });
  assert.match(viralMatch.errors[0].message, /look "pop" has no cut "match".* its cuts are: cut, punch, slide/);
});

test('an unknown look still lists the real ones', () => {
  const r = validate({ version: 2, look: 'dsk', shots: shots(undefined) });
  assert.deepEqual(r.errors, [{ path: 'look', message: 'unknown look "dsk"; did you mean "desk"? (have: desk, pop)' }]);
});

test('every look names its composition: desk is editorial, pop is a stack', () => {
  assert.equal(registries.looks.get('desk').composition, 'editorial');
  assert.equal(registries.looks.get('pop').composition, 'stack');
  for (const name of registries.looks.names()) assert.ok(['editorial', 'centred', 'stack'].includes(registries.looks.get(name).composition), name);
});

test('revision 1 look data: desk display line height 1.1; pop word space, recolour emphasis, quieter halftone, region emphasis on the cut-out', () => {
  const desk = registries.looks.get('desk'), pop = registries.looks.get('pop');
  assert.equal(desk.lineHeight.display, 1.1);
  assert.equal(pop.fonts.display.wordSpace, 0.26);
  assert.equal(pop.emphasis, 'recolor');
  assert.equal(pop.field.params.strength, 0.5);
  assert.deepEqual({ ...pop.devices.cutout }, { keylineColor: '#ffffff', emphasis: { shadow: 'accent', offset: 18 } });
  assert.equal(Object.hasOwn(pop.devices, 'highlight'), false, 'pop still does not style the highlight device');
});

// ---- sounds: which cue each event makes is look data (scripts/v2/sound/cues.mjs reads it) ----

test('desk sounds are the brief values: paper cuts and slides, marker hand marks, a paper card, a click on the landing', () => {
  const { sounds } = registries.looks.get('desk');
  assert.deepEqual({ ...sounds.cut }, { cut: 'paper', slide: 'paper', punch: null, match: null });
  assert.deepEqual({ ...sounds.device }, {
    highlight: 'marker', circle: 'marker', underline: 'marker', arrow: null, bracket: null, cutout: null, card: 'paper', tag: null, punch: null,
  });
  assert.equal(sounds.emphasis, null);
  assert.equal(sounds.land, 'click');
});

test('pop sounds are the brief values: click, whoosh and impact cuts, a pop highlight, an impact punch, a pop on emphasis, a sub on the landing', () => {
  const { sounds } = registries.looks.get('pop');
  assert.deepEqual({ ...sounds.cut }, { cut: 'click', slide: 'whoosh', punch: 'impact', match: null });
  assert.deepEqual({ ...sounds.device }, {
    highlight: 'pop', circle: null, underline: null, arrow: null, bracket: null, cutout: null, card: null, tag: null, punch: 'impact',
  });
  assert.equal(sounds.emphasis, 'pop');
  assert.equal(sounds.land, 'sub');
});

test('every look names a sound (or null) for exactly the registered cuts and devices, and its sounds are frozen', () => {
  assert.deepEqual(registries.cuts.names().sort(), [...KNOWN_CUTS].sort(), 'the look index registers the cuts it checks against');
  assert.equal(registries.devices.names().length, 9, 'the look index registers the devices it checks against');
  for (const name of lookNames()) {
    const { sounds } = registries.looks.get(name);
    assert.deepEqual(Object.keys(sounds.cut).sort(), registries.cuts.names().sort(), `${name} sounds.cut`);
    assert.deepEqual(Object.keys(sounds.device).sort(), registries.devices.names().sort(), `${name} sounds.device`);
    assert.ok(Object.isFrozen(sounds) && Object.isFrozen(sounds.cut) && Object.isFrozen(sounds.device), `${name} sounds frozen`);
  }
});

test('a look added to the shared registry is checked as it is added: a missing sound for a registered cut or device cannot register', () => {
  const desk = registries.looks.get('desk');
  const without = (part, key) => {
    const { [key]: _gone, ...rest } = desk.sounds[part];
    return { ...desk.sounds, [part]: rest };
  };
  assert.throws(() => registries.looks.add('test-no-match-sound', { ...desk, name: 'test-no-match-sound', sounds: without('cut', 'match') }),
    /look "test-no-match-sound": sounds\.cut\.match must be a cue name or null, got undefined/);
  assert.equal(registries.looks.has('test-no-match-sound'), false);
  assert.throws(() => registries.looks.add('test-no-tag-sound', { ...desk, name: 'test-no-tag-sound', sounds: without('device', 'tag') }),
    /look "test-no-tag-sound": sounds\.device\.tag must be a cue name or null, got undefined/);
  assert.throws(() => registries.looks.add('test-no-sounds', { ...desk, name: 'test-no-sounds', sounds: undefined }),
    /look "test-no-sounds": sounds must be \{ cut, device, emphasis, land \}, got undefined/);
  assert.throws(() => registries.looks.add('test-bad-land', { ...desk, name: 'test-bad-land', sounds: { ...desk.sounds, land: 3 } }),
    /look "test-bad-land": sounds\.land must be a cue name or null, got 3/);
  assert.throws(() => registries.looks.add('test-no-emphasis', { ...desk, name: 'test-no-emphasis', sounds: { ...desk.sounds, emphasis: undefined } }),
    /look "test-no-emphasis": sounds\.emphasis must be a cue name or null, got undefined/);
  registries.looks.add('test-sounded', { ...desk, name: 'test-sounded' });
  assert.equal(registries.looks.get('test-sounded').sounds.land, 'click');
});

// The assertions every look owes (looks-four plan, "Interfaces shared by every look task"). lookContract(name, opts)
// registers one node:test per assertion, named "(a)" to "(j)" in the output; contractChecks returns the same checks as
// { key, title, run } so a test can prove each one fires (look-contract.test.mjs).
//
// opts: `modes`; `grounds`: every #rrggbb a text or mark can sit on; `pairs`: [fg, ground, min] for every pairing the
// look permits (a palette key or #rrggbb each); `banned`: [fg, ground] pairings no kind may produce; `secondaryMin`;
// `kinds`: the kinds it has data for; `parked`: { [kind]: true } for the kinds it parks; `listed`: false while the look
// is experimental (the default), true once its gate says SHIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/kinds/index.mjs';
import { validateLook, allLookNames, applyAccent, supportsKind, isParkedKind, kindSupportProblems, kindLooks } from '../../../engine/looks/index.mjs';
import { ease } from '../../../engine/time/ease.mjs';
import { FONTS, STRETCH_KEYWORDS } from '../../../engine/fonts/index.mjs';
import { facesFor } from '../../../engine/page/fonts-shared.mjs';
import { contrastRatio } from '../../../shared/contrast.mjs';
import { listEntries } from '../../../scripts/v2/list.mjs';
import { validateFilm } from '../../../scripts/v2/spec.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const STEPS = 5;
const MIN_FIRST_STEP = 28;
const HERO_STEP_RATIO = 3;
const COLUMNS = 12;
const BANNED_BELOW = 3;
const CONTRAST_FORMATS = Object.freeze(['16:9', '9:16']);
const PROBE_ACCENT = '#00aa55';
const FILM_DIR = '.';

const sorted = (values) => [...new Set(values)].sort();
const isObject = (v) => v !== null && typeof v === 'object';

function deeplyFrozen(value, at = 'look') {
  if (!isObject(value)) return [];
  if (!Object.isFrozen(value)) return [at];
  return Object.entries(value).flatMap(([key, v]) => deeplyFrozen(v, `${at}.${key}`));
}

// Every string value reachable from `value`, with its path.
function strings(value, at = 'look') {
  if (typeof value === 'string') return [[at, value]];
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, v]) => strings(v, `${at}.${key}`));
}

const colourOf = (look, value) => (HEX.test(value) ? value : look.palette[value]);

// The problems with one of a look's fonts: no face for it, or a weight or width canvas cannot reach in its file.
function fontProblems(role, font) {
  const faces = facesFor({ font });
  if (faces.length === 0) return [`${role}: facesFor loads no face for "${font.family}"`];
  const variable = FONTS.find((entry) => entry.family === font.family);
  if (!variable) {
    const weights = faces.map((face) => Number(face.descriptors.weight));
    return [
      ...(weights.includes(font.weight) ? [] : [`${role}: "${font.family}" is bundled at ${weights.join(', ')}, not ${font.weight}`]),
      ...(font.width === 'normal' ? [] : [`${role}: "${font.family}" is a static face; width "${font.width}" cannot be reached`]),
    ];
  }
  const [low, high] = variable.axes.wght ?? [font.weight, font.weight];
  const weight = variable.reach.wght && font.weight >= low && font.weight <= high ? [] : [`${role}: weight ${font.weight} is outside ${font.family}'s reachable ${low} to ${high}`];
  const percent = STRETCH_KEYWORDS.find(([, keyword]) => keyword === font.width)?.[0];
  const wdth = variable.axes.wdth;
  const widthOk = font.width === 'normal' || (variable.reach.wdth && percent !== undefined && percent >= wdth[0] && percent <= wdth[1]);
  return [...weight, ...(widthOk ? [] : [`${role}: width "${font.width}" is not reachable in ${font.family}`])];
}

// The device names a look's sounds.device must cover: every registered device and every kind's event devices.
const soundDevices = () => sorted([...registries.devices.names(), ...registries.kinds.names().flatMap((k) => registries.kinds.get(k).eventDevices ?? [])]);

const filmIn = (name, mode, format) => ({ version: 2, mode, look: name, format, shots: [{ id: 'a', show: 'statement', say: 'One line to check the look.' }] });

/** The checks of the contract, each { key, title, run }; `looks` is the registry the look is read from. */
export function contractChecks(name, { modes, grounds = [], pairs = [], banned = [], secondaryMin = 0, kinds = [], parked = {}, listed = false }, { looks = registries.looks } = {}) {
  const look = () => looks.get(name);
  return [
    { key: 'a', title: 'registered, validated, deep-frozen, resolvable', run: () => {
      assert.ok(allLookNames().includes(name) || looks !== registries.looks, `"${name}" is registered`);
      assert.doesNotThrow(() => validateLook(look()));
      assert.deepEqual(deeplyFrozen(look()), [], 'every object reachable from the look is frozen');
      assert.equal(look().name, name);
    } },
    { key: 'b', title: listed ? 'listed after SHIP' : 'hidden while experimental', run: () => {
      const shown = listEntries('looks').map((entry) => entry.name);
      assert.equal(registries.looks.names().includes(name), listed, `registries.looks.names() ${listed ? 'lists' : 'hides'} it`);
      assert.equal(shown.includes(name), listed, `--list looks ${listed ? 'lists' : 'hides'} it`);
      assert.ok(allLookNames().includes(name), 'allLookNames() has it');
    } },
    { key: 'c', title: 'type rules: five ascending steps, scale[0] >= 28, scale[4] / scale[1] >= 3, twelve columns, secondary.min', run: () => {
      const { scale, grid } = look();
      assert.equal(scale.length, STEPS);
      assert.ok(scale.every((v, i) => i === 0 || v > scale[i - 1]), `ascending: ${scale.join(', ')}`);
      assert.ok(scale[0] >= MIN_FIRST_STEP, `scale[0] ${scale[0]} >= ${MIN_FIRST_STEP}`);
      assert.ok(scale[4] / scale[1] >= HERO_STEP_RATIO, `scale[4] / scale[1] = ${(scale[4] / scale[1]).toFixed(2)}`);
      assert.equal(grid.columns, COLUMNS);
      assert.ok((look().secondary?.min ?? 0) >= secondaryMin, `secondary.min ${look().secondary?.min} >= ${secondaryMin}`);
    } },
    { key: 'd', title: 'every font bundled at a reachable weight and width, and facesFor loads it', run: () => {
      assert.deepEqual(Object.entries(look().fonts).flatMap(([role, font]) => fontProblems(role, font)), []);
    } },
    { key: 'e', title: 'a sound for exactly the registered cuts, devices and kind event devices', run: () => {
      assert.deepEqual(sorted(Object.keys(look().sounds.cut)), sorted(registries.cuts.names()), 'sounds.cut');
      assert.deepEqual(sorted(Object.keys(look().sounds.device)), soundDevices(), 'sounds.device');
    } },
    { key: 'f', title: 'a Move for every registered move, each ease parsing', run: () => {
      for (const move of registries.moves.names()) {
        assert.ok(move in look().moves, `moves.${move} is given (a Move or null)`);
        const value = look().moves[move];
        if (value !== null) assert.doesNotThrow(() => ease(value.ease), `moves.${move}.ease "${value.ease}"`);
      }
    } },
    { key: 'g', title: 'contrast: every permitted pair at its minimum, every banned pair under 3', run: () => {
      for (const ground of grounds) assert.match(ground, HEX, `ground ${ground} is #rrggbb`);
      for (const [fg, ground, min] of pairs) {
        const ratio = contrastRatio(colourOf(look(), fg), colourOf(look(), ground));
        assert.ok(ratio >= min, `${fg} on ${ground}: ${ratio.toFixed(2)}:1, needs ${min}`);
      }
      for (const [fg, ground] of banned) {
        const ratio = contrastRatio(colourOf(look(), fg), colourOf(look(), ground));
        assert.ok(ratio < BANNED_BELOW, `banned ${fg} on ${ground} is ${ratio.toFixed(2)}:1: a ban over ${BANNED_BELOW} is decorative`);
      }
    } },
    { key: 'h', title: 'kinds: supported, refused naming the looks that have them, parked exactly as stated', run: () => {
      for (const kind of kinds) assert.ok(supportsKind(look(), kind), `supports ${kind}`);
      const gated = registries.kinds.names().filter((kind) => registries.kinds.get(kind).lookData === true && !kinds.includes(kind));
      for (const kind of gated) {
        const problems = kindSupportProblems(kind, look());
        assert.equal(problems.length, 1, `${kind} is refused`);
        assert.ok(problems[0].message.endsWith(kindLooks(kind).join(', ') || 'none'), `${kind}: names the looks that ship it`);
      }
      const isParked = registries.kinds.names().filter((kind) => isParkedKind(look(), kind));
      assert.deepEqual(sorted(isParked), sorted(Object.keys(parked).filter((kind) => parked[kind])));
    } },
    { key: 'i', title: 'an accent override moves every colour derived from the accent', run: () => {
      const old = look().palette.accent.toLowerCase();
      const left = strings(applyAccent(look(), PROBE_ACCENT)).filter(([, v]) => v.toLowerCase() === old).map(([at]) => at);
      assert.deepEqual(left, [], `values still ${old} after applyAccent: use the palette key "accent"`);
    } },
    { key: 'j', title: 'modes: a film validates in each of its modes at 16:9 and 9:16, and is refused in any other', run: () => {
      for (const mode of registries.modes.names()) {
        for (const format of CONTRAST_FORMATS) {
          const { ok, errors } = validateFilm(filmIn(name, mode, format), { specDir: FILM_DIR });
          assert.equal(ok, modes.includes(mode), `${mode} ${format}: ${ok ? 'validates' : errors.map((e) => e.message ?? e).join('; ')}`);
        }
      }
    } },
  ];
}

/** Registers one test per contract check for look `name`. */
export function lookContract(name, opts) {
  for (const check of contractChecks(name, opts)) test(`${name} contract (${check.key}): ${check.title}`, check.run);
}

// Version 2 film schema, validation and defaults. A model writes the film, so
// every error is { path, message }: the path names the field ("shots[0].show")
// and the message says what to write instead. validateFilm collects every error
// it can and never throws for a bad film.
import path from 'node:path';
import Ajv from 'ajv';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { validateMode } from '../../engine/modes/index.mjs';
import { parseSay, SayError } from '../../engine/script/say.mjs';
import { hintRefusals } from './voice/calls.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveAnchor, anchorSeconds, AnchorError, echoValue, showValue } from '../../engine/script/anchors.mjs';
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
import { REGION_PREFIX } from '../../engine/kinds/shared.mjs';
import { fieldAt } from '../../engine/assets.mjs';
import { SpecError, isPlainObject, quote, schemaErrors, srcProblem } from './spec-common.mjs';
import { CUES_MAX, MUSIC_SCHEMA, VOICE_SCHEMA, checkCueItems, checkMusic, checkVoice, isRecordingVoice, readRecording } from './spec-sound.mjs';

// What other modules import from here, wherever it now lives.
export { SpecError } from './spec-common.mjs';
export { MUSIC_BEDS, WORDS_MAX_BYTES, readRecording, recordingFile } from './spec-sound.mjs';

export const FILM_VERSION = 2;
export const FORMATS = Object.freeze(['16:9', '9:16', '1:1', '4:5']);
export const FPS_CHOICES = Object.freeze([24, 25, 30, 60]);
export const DEFAULT_MODE = 'pro';
export const DEFAULT_FPS = 30;
export const DEFAULT_SEED = 1;
const SEED_MAX = 7918;
const SHOTS_MAX = 60;
const SAY_MAX = 400;
const HOLD_MIN = 1; // every shot lasts at least 1 s (engine/script/timing.mjs MIN_SHOT_SECONDS)
const HOLD_MAX = 30;
const ON_MAX = 8;
const SPAN_DECIMALS = 2;

const V1_MESSAGE = 'this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md';
const NOT_OBJECT_MESSAGE = 'a film must be a JSON object such as { "version": 2, "shots": [ ... ] }';
const ID_RE = /^[a-z][a-z0-9-]*$/;
const ACCENT_RE = /^#[0-9a-f]{6}$/i;

// --- schemas ---

const ROOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    sound: { enum: ['on', 'off'] },
    captions: { type: 'boolean' }, // whether captions are drawn (engine/captions); validated here only
    music: MUSIC_SCHEMA, // checkMusic: one of the two shapes, a file inside the folder
    // Items are not listed, as for shots: checkCueItems checks the first CUES_MAX.
    cues: { type: 'array', maxItems: CUES_MAX },
    version: {}, // checked by checkVersion, which says what to write
    mode: { type: 'string' }, // checkMode: one of the registered modes, with a did-you-mean
    look: { type: 'string', minLength: 1 },
    format: { enum: [...FORMATS] },
    fps: { enum: [...FPS_CHOICES] },
    seed: { type: 'integer', minimum: 0, maximum: SEED_MAX },
    accent: { type: 'string' }, // #rrggbb: checkAccent shows an example
    generatedBy: GENERATED_BY_SCHEMA,
    voice: VOICE_SCHEMA, // checkVoice: one of the two shapes, a voice that exists
    // Items are not listed: Ajv would walk and report every one of a huge array.
    // checkShots reports a shot that is not an object, for the first SHOTS_MAX.
    shots: { type: 'array', minItems: 1, maxItems: SHOTS_MAX },
  },
};

const ON_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'do'],
  properties: {
    at: {}, // a number or an anchor string: resolveAnchor says which forms exist
    do: { type: 'string', minLength: 1 },
    target: { type: 'string', minLength: 1 },
  },
};

const SHOT_PROPERTIES = {
  id: { type: 'string' }, // checkShotId shows the allowed spelling
  show: { type: 'string' },
  say: { type: 'string', minLength: 1, maxLength: SAY_MAX },
  hold: { type: 'number', minimum: HOLD_MIN, maximum: HOLD_MAX },
  cut: { type: 'string', minLength: 1 },
  on: { type: 'array', maxItems: ON_MAX, items: ON_ITEM_SCHEMA },
};

// strict is off because kind schemas arrive from other modules: a keyword
// Ajv does not know must not turn a bad film into a crash.
const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
const checkRootSchema = ajv.compile(ROOT_SCHEMA);
// Used when the kind is missing or unknown: the kind's own fields are not known.
const checkBaseShot = ajv.compile({ type: 'object', required: ['id'], properties: SHOT_PROPERTIES });
const kindChecks = new WeakMap();

function shotCheckerFor(name, kind) {
  if (kindChecks.has(kind)) return kindChecks.get(kind);
  const { properties = {}, required = [], ...rest } = kind.schema ?? {};
  for (const key of Object.keys(properties)) {
    if (Object.hasOwn(SHOT_PROPERTIES, key)) throw new Error(`kind "${name}" schema redefines the shot field "${key}"`);
  }
  const check = ajv.compile({
    ...rest,
    type: 'object',
    additionalProperties: false,
    required: ['id', ...required],
    properties: { ...SHOT_PROPERTIES, ...properties },
  });
  kindChecks.set(kind, check);
  return check;
}


// --- registries ---

// { value } or { error }: the registry's own did-you-mean message on a miss.
// The miss is asked about the name as an error may repeat it (cut short), so a
// huge name cannot fill the message.
function lookup(registry, name) {
  if (registry.has(name)) return { value: registry.get(name) };
  try {
    registry.get(echoValue(name));
  } catch (err) {
    return { error: err.message };
  }
  return { error: `unknown name ${quote(name)}` };
}

// The film's mode name as written (else the default), or null when no such mode is registered.
function modeName(spec, regs) {
  const name = spec.mode ?? DEFAULT_MODE;
  return typeof name === 'string' && regs.modes.has(name) ? name : null;
}

// A mode that is not registered gets the registry's own did-you-mean; one that is not a string has its schema error.
// A registered mode must carry its voice data (voiceSpeed, emphasisPause, loudness): the shared registry refuses one without when
// it is added, and this catches a mode that reached a registry some other way (a registry passed in, or a mode added
// before engine/modes/index.mjs loaded). Reported at `mode`.
function checkMode(spec, regs) {
  const name = spec.mode ?? DEFAULT_MODE;
  if (typeof name !== 'string') return [];
  if (!regs.modes.has(name)) return [{ path: 'mode', message: lookup(regs.modes, name).error }];
  try {
    validateMode({ ...regs.modes.get(name), name });
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return [{ path: 'mode', message: `${err.message}; the mode's data is incomplete or out of range: add or fix the field named above in the mode's registration` }];
  }
  return [];
}

// --- the film's own settings: version, mode, look, fps ---

function checkVersion(spec) {
  if (spec.version === undefined) return [{ path: 'version', message: `required; write "version": ${FILM_VERSION}` }];
  if (spec.version === FILM_VERSION) return [];
  return [{ path: 'version', message: `must be ${FILM_VERSION}, the only version make-motion 2 reads; got ${quote(spec.version)}` }];
}

function checkAccent(spec) {
  if (typeof spec.accent !== 'string' || ACCENT_RE.test(spec.accent)) return [];
  return [{ path: 'accent', message: `${quote(spec.accent)} is not a colour; write it as #rrggbb, for example "#ff6600"` }];
}

// The look the film uses, as { look, errors }. A look that is missing, unknown,
// or does not serve the mode is an error; `look` is null in the first two cases.
function resolveLook(spec, mode, regs) {
  const explicit = typeof spec.look === 'string' && spec.look !== '';
  if (!explicit && (spec.look !== undefined || mode === null)) return { look: null, errors: [] };
  const name = explicit ? spec.look : regs.modes.get(mode).defaultLook;
  const found = lookup(regs.looks, name);
  if (found.error && explicit) return { look: null, errors: [{ path: 'look', message: found.error }] };
  if (found.error) {
    const have = regs.looks.names().join(', ') || 'none';
    const message = `the default look for mode "${mode}" is "${name}", which is not registered (have: ${have}); write "look" with a registered look`;
    return { look: null, errors: [{ path: 'look', message }] };
  }
  const serves = found.value.modes ?? [];
  if (mode === null || serves.includes(mode)) return { look: found.value, errors: [] };
  return { look: found.value, errors: [{ path: 'look', message: `look "${name}" does not serve mode "${mode}" (it serves: ${serves.join(', ')})` }] };
}

function resolveContext(spec, specDir, regs) {
  const mode = modeName(spec, regs);
  const fps = spec.fps === undefined ? DEFAULT_FPS : FPS_CHOICES.find((f) => f === spec.fps) ?? null;
  const { look, errors } = resolveLook(spec, mode, regs);
  // A voiced film's anchors land on measured times, known only after synthesis: timedAnchorErrors checks them then.
  return { ctx: { mode, fps, look, regs, specDir, voiced: isPlainObject(spec.voice) }, errors };
}

// --- shots ---

function checkShotId(shot, base, seen) {
  if (typeof shot.id !== 'string') return [];
  const at = pathJoin(base, 'id');
  if (!ID_RE.test(shot.id)) {
    return [{ path: at, message: `id ${quote(shot.id)} must start with a lowercase letter and use only lowercase letters, digits and hyphens, for example "intro-2"` }];
  }
  if (seen.has(shot.id)) return [{ path: at, message: `duplicate id ${quote(shot.id)} (first used at ${seen.get(shot.id)})` }];
  seen.set(shot.id, base);
  return [];
}

// Which kind a shot shows: { kind, name } or { errors }.
function resolveKind(shot, base, regs) {
  const at = pathJoin(base, 'show');
  if (shot.show === undefined) return { errors: [{ path: at, message: `required; one of: ${regs.kinds.names().join(', ')}` }] };
  if (typeof shot.show !== 'string') return { errors: [] }; // the schema says "must be string"
  const found = lookup(regs.kinds, shot.show);
  if (found.error) return { errors: [{ path: at, message: found.error }] };
  return { kind: found.value, name: shot.show, errors: [] };
}

// A say worth parsing: a string within the schema's length range. A longer or
// empty one already has its schema error, and parsing it would only cost time.
const isParsableSay = (say) => typeof say === 'string' && say !== '' && say.length <= SAY_MAX;

// One message for the pronunciation hints of a say that hold refused characters (voice/calls.mjs hintRefusals: after NFC,
// the same check the synthesiser goes through), or null. The phonemiser's own output outside the vocab is not checked
// here: it is dropped at synthesis.
function ipaHintProblem(tokens) {
  const bad = tokens.flatMap((token) => {
    const refused = token.ipa === undefined ? [] : hintRefusals(token.ipa);
    return refused.length === 0 ? [] : [`/${token.ipa}/ on "${token.text}" has ${refused.join(', ')}`];
  });
  if (bad.length === 0) return null;
  return `pronunciation hints use characters the voice cannot take: ${bad.join('; ')}; write the sound with IPA phoneme characters of the voice, or remove the hint`;
}

// Narration: say must parse, hold only without say. Returns { errors, hasLength },
// hasLength: whether the shot has a length its anchors can be resolved against.
function checkNarration(shot, base) {
  const errors = [];
  let hasLength = true;
  if (shot.say !== undefined && shot.hold !== undefined) {
    errors.push({ path: pathJoin(base, 'hold'), message: 'hold cannot be used with say: the narration sets the length of the shot; remove "hold", or remove "say" to hold for a set time' });
  }
  if (shot.say !== undefined) {
    hasLength = isParsableSay(shot.say);
    if (hasLength) {
      try {
        const problem = ipaHintProblem(parseSay(shot.say).tokens);
        if (problem) errors.push({ path: pathJoin(base, 'say'), message: problem });
      } catch (err) {
        if (!(err instanceof SayError)) throw err;
        errors.push({ path: pathJoin(base, 'say'), message: err.message });
        hasLength = false;
      }
    }
  } else if (shot.hold !== undefined) {
    hasLength = Number.isFinite(shot.hold) && shot.hold > 0;
  }
  return { errors, hasLength };
}

function checkCut(shot, index, base, ctx) {
  if (typeof shot.cut !== 'string' || shot.cut === '') return [];
  const at = pathJoin(base, 'cut');
  if (index === 0) {
    if (shot.cut === 'cut') return [];
    return [{ path: at, message: `the first shot has nothing before it to cut from; remove "cut", or write "cut": "cut" (got ${quote(shot.cut)})` }];
  }
  if (!ctx.look) return [];
  const cuts = ctx.look.cuts ?? [];
  if (cuts.includes(shot.cut)) return [];
  const hint = didYouMean(shot.cut, cuts);
  return [{ path: at, message: `look "${ctx.look.name}" has no cut ${quote(shot.cut)}; ${hint ? `did you mean "${hint}"? Its` : 'its'} cuts are: ${cuts.join(', ')}` }];
}

// The shot as the timeline sees it, so anchors resolve against real word times.
function timelineShot(shot, ctx) {
  if (ctx.mode === null || ctx.fps === null) return null;
  const film = { mode: ctx.mode, shots: [{ id: shot.id, say: shot.say, hold: shot.hold }] };
  return buildTimeline(film, { fps: ctx.fps, modes: ctx.regs.modes }).shots[0];
}

// An anchor must parse and land inside its shot. Up to one frame outside is rounding and is clamped
// (engine/script/anchors.mjs resolveAnchor); further out, the device would fire on the shot's edge, unseen.
// `inside: false` checks only that it parses and names a word that is spoken (a voiced film at validation). A measured
// shot is as long as its narration, so its advice names the one way to lengthen it.
const LENGTHEN = 'anchor it inside the shot, or lengthen the shot';
const LENGTHEN_MEASURED = 'anchor it inside the shot, or end its say with a pause such as (0.5) to lengthen it';

function checkAnchor(item, at, entry, { fps, inside = true, measured = false }) {
  if (entry === null || item.at === undefined) return [];
  let seconds;
  try {
    seconds = anchorSeconds(item.at, entry);
  } catch (err) {
    if (!(err instanceof AnchorError)) throw err;
    return [{ path: pathJoin(at, 'at'), message: err.message }];
  }
  if (!inside) return [];
  const slack = 1 / fps;
  if (seconds >= -slack && seconds <= entry.duration + slack) return [];
  const span = `0 to ${Number(entry.duration.toFixed(SPAN_DECIMALS))} s`;
  return [{ path: pathJoin(at, 'at'), message: `${quote(item.at)} resolves to ${seconds} s, outside the shot, which runs from ${span}; ${measured ? LENGTHEN_MEASURED : LENGTHEN}` }];
}

const supportsLook = (device, look) => typeof device.supports !== 'function' || Boolean(device.supports(look));

// A kind may draw some devices itself when they aim at one of its regions (kind.regionDevices, e.g. clipping draws a
// region highlight as a frame): those are allowed in any look, on a region: target only.
const kindDrawsIt = (item, kind) => Array.isArray(kind?.regionDevices) && kind.regionDevices.includes(item.do)
  && typeof item.target === 'string' && item.target.startsWith(REGION_PREFIX);

function checkDevice(item, at, ctx, kind) {
  if (typeof item.do !== 'string' || item.do === '') return [];
  const found = lookup(ctx.regs.devices, item.do);
  if (found.error) return [{ path: pathJoin(at, 'do'), message: found.error }];
  if (!ctx.look || supportsLook(found.value, ctx.look) || kindDrawsIt(item, kind)) return [];
  const supported = ctx.regs.devices.names().filter((name) => supportsLook(ctx.regs.devices.get(name), ctx.look));
  const message = `device "${item.do}" is not supported by look "${ctx.look.name}"; it supports: ${supported.join(', ') || 'no devices'}`;
  return [{ path: pathJoin(at, 'do'), message }];
}

function checkTarget(item, at, targets, kindName) {
  if (typeof item.target !== 'string' || targets === null) return [];
  const where = pathJoin(at, 'target');
  if (targets.length === 0) return [{ path: where, message: 'this kind has no targets; remove "target"' }];
  if (targets.includes(item.target)) return [];
  const hint = didYouMean(item.target, targets);
  return [{ path: where, message: `unknown target ${quote(item.target)}; ${hint ? `did you mean "${hint}"? The` : 'the'} targets of ${kindName} are: ${targets.join(', ')}` }];
}

// The kind's target names for a shot: [] for a kind with no `targets` function,
// null when they cannot be known (no kind, or `targets` throws or misbehaves on
// a shot that already has schema errors). On a schema-valid shot a throw, or a
// result that is not an array, is the kind's bug and is raised as one.
function kindTargets(kind, name, shot, shapeIsValid) {
  if (!kind) return null;
  if (typeof kind.targets !== 'function') return [];
  try {
    const names = kind.targets(shot);
    if (Array.isArray(names)) return names;
    if (shapeIsValid) throw new Error(`kind "${name}": targets(shot) must return an array of target names, got ${showValue(names)}`);
    return null;
  } catch (err) {
    if (shapeIsValid) throw err;
    return null;
  }
}

// The shot as Ajv and the kind see it: at most ON_MAX `on` entries, on a copy,
// so a huge array is never walked. onCountErrors reports the excess.
function boundedShot(shot) {
  return Array.isArray(shot.on) && shot.on.length > ON_MAX ? { ...shot, on: shot.on.slice(0, ON_MAX) } : shot;
}

function onCountErrors(shot, base) {
  if (!Array.isArray(shot.on) || shot.on.length <= ON_MAX) return [];
  return [{ path: pathJoin(base, 'on'), message: `must NOT have more than ${ON_MAX} items` }];
}

// `entry`: the shot's timeline entry for its anchors, or null. `targets`: see kindTargets.
// Only the first ON_MAX entries are checked; the schema reports the excess.
function checkOn(shot, base, ctx, { entry, targets, kindName, kind }) {
  if (!Array.isArray(shot.on)) return [];
  return shot.on.slice(0, ON_MAX).flatMap((item, j) => {
    if (!isPlainObject(item)) return [];
    const at = pathJoin(pathJoin(base, 'on'), j);
    const anchor = checkAnchor(item, at, entry, { fps: ctx.fps, inside: !ctx.voiced });
    return [...anchor, ...checkDevice(item, at, ctx, kind), ...checkTarget(item, at, targets, kindName)];
  });
}

/**
 * The anchors of a validated `film` checked against `timeline`, the one the film is drawn with: each must land inside
 * its shot. For a voiced film this runs after synthesis, on the measured timeline (validateFilm skips the check, since
 * estimated times say nothing about where a measured word falls). -> [{ path, message }], the validator's form.
 */
export function anchorSpanErrors(film, timeline) {
  const measured = timeline.timed === 'measured';
  return film.shots.slice(0, SHOTS_MAX).flatMap((shot, index) => {
    if (!isPlainObject(shot) || !Array.isArray(shot.on)) return [];
    const entry = timeline.shots[index] ?? null;
    const base = pathJoin(pathJoin('shots', index), 'on');
    return shot.on.slice(0, ON_MAX).flatMap((item, j) => (
      isPlainObject(item) ? checkAnchor(item, pathJoin(base, j), entry, { fps: timeline.fps, measured }) : []
    ));
  });
}

// The kind rules of each shot of a validated `film` with its anchors resolved on `timeline` (validateFilm ran them
// without times for a voiced film, so only the rules that judge times can fail here).
function timedKindErrors(film, timeline, regs) {
  const { look } = resolveLook(film, modeName(film, regs), regs); // as validateFilm chose it: the film's, else its mode's
  return film.shots.slice(0, SHOTS_MAX).flatMap((shot, index) => {
    if (!isPlainObject(shot) || typeof shot.show !== 'string' || !regs.kinds.has(shot.show)) return [];
    const entry = timeline.shots[index] ?? null;
    const kind = regs.kinds.get(shot.show);
    return checkKindRules(boundedShot(shot), pathJoin('shots', index), { look }, { kind, entry, shapeIsValid: true });
  });
}

/**
 * Everything about a validated `film`'s anchors that depends on the times they resolve to, judged on `timeline`: each
 * anchor inside its shot (anchorSpanErrors) and the kind rules that resolve anchors (the clipping close-up timing).
 * validateFilm skips both for a voiced film; run.mjs calls this on its measured timeline. -> [{ path, message }].
 */
export function timedAnchorErrors(film, timeline, { registries = defaultRegistries } = {}) {
  return [...anchorSpanErrors(film, timeline), ...timedKindErrors(film, timeline, registries)];
}

// Each picture a kind's srcFields name ("src", or a dotted path such as "left.src"), held to the film folder.
function checkSrcFields(shot, base, kind, specDir) {
  return (kind?.srcFields ?? []).flatMap((field) => {
    const value = fieldAt(shot, field);
    if (typeof value !== 'string' || value === '') return [];
    const problem = srcProblem(value, specDir);
    return problem ? [{ path: field.split('.').reduce((acc, key) => pathJoin(acc, key), base), message: problem }] : [];
  });
}

// A kind's own rules (kind.validate(shot, { look, at }) -> [{ path, message }] with paths relative to the shot, such as
// "regions.q" or "on.1.at"), run on a shot whose shape is already valid. `at` resolves an anchor in the shot, or is
// null when the shot's length is not known.
function checkKindRules(shot, base, ctx, { kind, entry, shapeIsValid }) {
  if (!shapeIsValid || typeof kind?.validate !== 'function') return [];
  const at = entry === null ? null : (ref) => resolveAnchor(ref, entry);
  return kind.validate(shot, { look: ctx.look, at }).map(({ path: rel, message }) => ({
    path: String(rel).split('.').reduce((acc, part) => pathJoin(acc, /^\d+$/.test(part) ? Number(part) : part), base),
    message,
  }));
}

function checkShot(shot, index, ctx, seen) {
  const base = pathJoin('shots', index);
  const resolved = resolveKind(shot, base, ctx.regs);
  const check = resolved.kind ? shotCheckerFor(resolved.name, resolved.kind) : checkBaseShot;
  const bounded = boundedShot(shot);
  const shape = [...schemaErrors(check, bounded, base), ...onCountErrors(shot, base)];
  const narration = checkNarration(shot, base);
  const entry = narration.hasLength ? timelineShot(shot, ctx) : null;
  const targets = kindTargets(resolved.kind, resolved.name, bounded, shape.length === 0);
  return [
    ...resolved.errors,
    ...shape,
    ...checkShotId(shot, base, seen),
    ...narration.errors,
    ...checkCut(shot, index, base, ctx),
    ...checkOn(shot, base, ctx, { entry, targets, kindName: resolved.name, kind: resolved.kind }),
    ...checkSrcFields(shot, base, resolved.kind, ctx.specDir),
    // A voiced film's kind rules run without times here (their timing rules are skipped) and with measured ones after
    // synthesis (timedAnchorErrors).
    ...checkKindRules(bounded, base, ctx, { kind: resolved.kind, entry: ctx.voiced ? null : entry, shapeIsValid: shape.length === 0 }),
  ];
}

// Only the first SHOTS_MAX shots are checked; the schema reports the excess.
function checkShots(spec, ctx) {
  if (!Array.isArray(spec.shots)) return [];
  const seen = new Map();
  return spec.shots.slice(0, SHOTS_MAX).flatMap((shot, index) => (
    isPlainObject(shot) ? checkShot(shot, index, ctx, seen) : [{ path: pathJoin('shots', index), message: 'must be object' }]
  ));
}

// --- match cuts ---

// The node ids a shot puts on screen as its kind reports them (kind.ids), or null when that cannot be known: no
// such kind, or a kind without `ids`.
function shotIds(shot, regs) {
  if (!isPlainObject(shot) || typeof shot.show !== 'string' || !regs.kinds.has(shot.show)) return null;
  const kind = regs.kinds.get(shot.show);
  if (typeof kind.ids !== 'function') return null;
  const ids = kind.ids(shot);
  return Array.isArray(ids) ? ids : null;
}

// A match cut carries a node across: the shot and the one before it must share a node id. Kinds whose ids are not
// known are not checked.
function checkMatchCuts(spec, regs) {
  if (!Array.isArray(spec.shots)) return [];
  const shots = spec.shots.slice(0, SHOTS_MAX);
  return shots.flatMap((shot, index) => {
    if (index === 0 || !isPlainObject(shot) || shot.cut !== 'match') return [];
    const prev = shots[index - 1];
    const before = shotIds(prev, regs), after = shotIds(shot, regs);
    if (before === null || after === null || after.some((id) => before.includes(id))) return [];
    return [{ path: pathJoin(pathJoin('shots', index), 'cut'), message: `"match" needs a node id shared with shot ${quote(prev.id)}; shared ids come from "hero"` }];
  });
}

// The shots as the words can be fitted to them: an array of objects with string ids whose says all parse. Otherwise
// their own errors are reported and the words are not looked at.
function saysReady(spec) {
  if (!Array.isArray(spec.shots) || spec.shots.length > SHOTS_MAX) return false;
  return spec.shots.every((shot) => {
    if (!isPlainObject(shot) || typeof shot.id !== 'string') return false;
    if (shot.say === undefined) return true;
    if (!isParsableSay(shot.say)) return false;
    try {
      parseSay(shot.say);
      return true;
    } catch (err) {
      if (err instanceof SayError) return false;
      throw err;
    }
  });
}

function checkRecording(spec, specDir) {
  if (!isRecordingVoice(spec.voice) || !saysReady(spec)) return [];
  try {
    readRecording(spec, specDir);
    return [];
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    return err.errors;
  }
}

function collectErrors(spec, specDir, regs) {
  if (!isPlainObject(spec)) return [{ path: '', message: NOT_OBJECT_MESSAGE }];
  if (Array.isArray(spec.scenes) || spec.version === 1) return [{ path: '', message: V1_MESSAGE }];
  const { ctx, errors: settings } = resolveContext(spec, specDir, regs);
  return [
    ...checkVersion(spec),
    ...schemaErrors(checkRootSchema, spec, ''),
    ...checkMode(spec, regs),
    ...checkVoice(spec),
    ...checkRecording(spec, specDir),
    ...checkMusic(spec, specDir),
    ...checkCueItems(spec),
    ...checkAccent(spec),
    ...settings,
    ...checkShots(spec, ctx),
    ...checkMatchCuts(spec, regs),
  ];
}

// validateFilm(spec, { specDir, registries? }) -> { ok, errors }.
// `registries` defaults to the shared ones; tests pass their own stubs.
export function validateFilm(spec, { specDir, registries = defaultRegistries } = {}) {
  if (typeof specDir !== 'string' || specDir === '') throw new TypeError('validateFilm needs { specDir }: the folder the film file is in');
  const errors = collectErrors(spec, specDir, registries);
  return { ok: errors.length === 0, errors };
}

// A new film with every root default filled in; `spec` is not changed. Call it
// on a film that validated.
export function withFilmDefaults(spec, regs = defaultRegistries) {
  const mode = spec.mode ?? DEFAULT_MODE;
  const defaults = regs.modes.get(mode);
  return {
    ...structuredClone(spec),
    mode,
    look: spec.look ?? defaults.defaultLook,
    format: spec.format ?? defaults.defaultFormat,
    fps: spec.fps ?? DEFAULT_FPS,
    seed: spec.seed ?? DEFAULT_SEED,
  };
}

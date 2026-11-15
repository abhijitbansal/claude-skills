// Version 2 film schema, validation and defaults. A model writes the film, so
// every error is { path, message }: the path names the field ("shots[0].show")
// and the message says what to write instead. validateFilm collects every error
// it can and never throws for a bad film.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { parseSay, SayError } from '../../engine/script/say.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveAnchor, AnchorError } from '../../engine/script/anchors.mjs';
import { didYouMean, formatAjvErrors, pathJoin } from '../../shared/errors.mjs';
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';

export const FILM_VERSION = 2;
export const MODES = Object.freeze(['pro', 'viral']);
export const FORMATS = Object.freeze(['16:9', '9:16', '1:1', '4:5']);
export const FPS_CHOICES = Object.freeze([24, 25, 30, 60]);
export const DEFAULT_MODE = 'pro';
export const DEFAULT_FPS = 30;
export const DEFAULT_SEED = 1;
const SEED_MAX = 7918;
const SHOTS_MAX = 60;
const SAY_MAX = 400;
const HOLD_MIN = 0.5;
const HOLD_MAX = 30;
const ON_MAX = 8;

// Used when the modes registry has no entry for the film's mode.
const MODE_DEFAULTS = Object.freeze({
  pro: Object.freeze({ defaultLook: 'desk', defaultFormat: '16:9' }),
  viral: Object.freeze({ defaultLook: 'pop', defaultFormat: '9:16' }),
});

const V1_MESSAGE = 'this is a version 1 spec; make-motion 2 reads version 2 only. See references/migrating.md';
const NOT_OBJECT_MESSAGE = 'a film must be a JSON object such as { "version": 2, "shots": [ ... ] }';
const ID_RE = /^[a-z][a-z0-9-]*$/;
const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const URL_RE = /^[a-z][a-z0-9+.-]+:/i;
const DRIVE_RE = /^[a-z]:[\\/]/i;
const SRC_EXAMPLE = '"assets/photo.png"';

export class SpecError extends Error {
  constructor(errors) {
    super(errors.map(({ path: at, message }) => `${at || '(root)'}: ${message}`).join('\n'));
    this.name = 'SpecError';
    this.errors = errors;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// --- schemas ---

const ROOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    version: {}, // checked by checkVersion, which says what to write
    mode: { enum: [...MODES] },
    look: { type: 'string', minLength: 1 },
    format: { enum: [...FORMATS] },
    fps: { enum: [...FPS_CHOICES] },
    seed: { type: 'integer', minimum: 0, maximum: SEED_MAX },
    accent: { type: 'string' }, // #rrggbb: checkAccent shows an example
    generatedBy: GENERATED_BY_SCHEMA,
    shots: { type: 'array', minItems: 1, maxItems: SHOTS_MAX, items: { type: 'object' } },
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

// Ajv errors for a value at `base`, as { path, message } with full paths.
function schemaErrors(check, value, base) {
  if (check(value)) return [];
  return formatAjvErrors(check.errors).map(({ path: at, message }) => ({ path: at ? pathJoin(base, at) : base, message }));
}

// --- registries ---

// { value } or { error }: the registry's own did-you-mean message on a miss.
function lookup(registry, name) {
  try {
    return { value: registry.get(name) };
  } catch (err) {
    return { error: err.message };
  }
}

function modeDefinition(mode, regs) {
  const registered = regs.modes.has(mode) ? regs.modes.get(mode) : {};
  return { ...MODE_DEFAULTS[mode], ...registered };
}

// --- the film's own settings: version, mode, look, fps ---

function checkVersion(spec) {
  if (spec.version === undefined) return [{ path: 'version', message: `required; write "version": ${FILM_VERSION}` }];
  if (spec.version === FILM_VERSION) return [];
  return [{ path: 'version', message: `must be ${FILM_VERSION}, the only version make-motion 2 reads; got ${JSON.stringify(spec.version)}` }];
}

function checkAccent(spec) {
  if (typeof spec.accent !== 'string' || ACCENT_RE.test(spec.accent)) return [];
  return [{ path: 'accent', message: `${JSON.stringify(spec.accent)} is not a colour; write it as #rrggbb, for example "#ff6600"` }];
}

// The look the film uses, as { look, errors }. A look that is missing, unknown,
// or does not serve the mode is an error; `look` is null in the first two cases.
function resolveLook(spec, mode, regs) {
  const explicit = typeof spec.look === 'string' && spec.look !== '';
  if (!explicit && (spec.look !== undefined || mode === null)) return { look: null, errors: [] };
  const name = explicit ? spec.look : modeDefinition(mode, regs).defaultLook;
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
  const mode = spec.mode === undefined ? DEFAULT_MODE : MODES.find((m) => m === spec.mode) ?? null;
  const fps = spec.fps === undefined ? DEFAULT_FPS : FPS_CHOICES.find((f) => f === spec.fps) ?? null;
  const { look, errors } = resolveLook(spec, mode, regs);
  return { ctx: { mode, fps, look, regs, specDir }, errors };
}

// --- shots ---

function checkShotId(shot, base, seen) {
  if (typeof shot.id !== 'string') return [];
  const at = pathJoin(base, 'id');
  if (!ID_RE.test(shot.id)) {
    return [{ path: at, message: `id ${JSON.stringify(shot.id)} must start with a lowercase letter and use only lowercase letters, digits and hyphens, for example "intro-2"` }];
  }
  if (seen.has(shot.id)) return [{ path: at, message: `duplicate id "${shot.id}" (first used at ${seen.get(shot.id)})` }];
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

// Narration: say must parse, hold only without say. Returns { errors, timed },
// timed: whether the shot has a length the anchors can be resolved against.
function checkNarration(shot, base) {
  const errors = [];
  let timed = true;
  if (shot.say !== undefined && shot.hold !== undefined) {
    errors.push({ path: pathJoin(base, 'hold'), message: 'hold cannot be used with say: the narration sets the length of the shot; remove "hold", or remove "say" to hold for a set time' });
  }
  if (shot.say !== undefined) {
    timed = typeof shot.say === 'string' && shot.say !== '';
    if (timed) {
      try {
        parseSay(shot.say);
      } catch (err) {
        if (!(err instanceof SayError)) throw err;
        errors.push({ path: pathJoin(base, 'say'), message: err.message });
        timed = false;
      }
    }
  } else if (shot.hold !== undefined) {
    timed = Number.isFinite(shot.hold) && shot.hold > 0;
  }
  return { errors, timed };
}

function checkCut(shot, index, base, ctx) {
  if (typeof shot.cut !== 'string' || shot.cut === '') return [];
  const at = pathJoin(base, 'cut');
  if (index === 0) {
    if (shot.cut === 'cut') return [];
    return [{ path: at, message: `the first shot has nothing before it to cut from; remove "cut", or write "cut": "cut" (got ${JSON.stringify(shot.cut)})` }];
  }
  if (!ctx.look) return [];
  const cuts = ctx.look.cuts ?? [];
  if (cuts.includes(shot.cut)) return [];
  const hint = didYouMean(shot.cut, cuts);
  return [{ path: at, message: `look "${ctx.look.name}" has no cut ${JSON.stringify(shot.cut)}; ${hint ? `did you mean "${hint}"? ` : ''}its cuts are: ${cuts.join(', ')}` }];
}

// The shot as the timeline sees it, so anchors resolve against real word times.
function timelineShot(shot, ctx) {
  if (ctx.mode === null || ctx.fps === null) return null;
  const film = { mode: ctx.mode, shots: [{ id: shot.id, say: shot.say, hold: shot.hold }] };
  return buildTimeline(film, { fps: ctx.fps }).shots[0];
}

function checkAnchor(item, at, timed) {
  if (timed === null || item.at === undefined) return [];
  try {
    resolveAnchor(item.at, timed);
  } catch (err) {
    if (!(err instanceof AnchorError)) throw err;
    return [{ path: pathJoin(at, 'at'), message: err.message }];
  }
  return [];
}

const supportsLook = (device, look) => typeof device.supports !== 'function' || Boolean(device.supports(look));

function checkDevice(item, at, ctx) {
  if (typeof item.do !== 'string' || item.do === '') return [];
  const found = lookup(ctx.regs.devices, item.do);
  if (found.error) return [{ path: pathJoin(at, 'do'), message: found.error }];
  if (!ctx.look || supportsLook(found.value, ctx.look)) return [];
  const supported = ctx.regs.devices.names().filter((name) => supportsLook(ctx.regs.devices.get(name), ctx.look));
  const message = `device "${item.do}" is not supported by look "${ctx.look.name}"; it supports: ${supported.join(', ') || 'no devices'}`;
  return [{ path: pathJoin(at, 'do'), message }];
}

function checkTarget(item, at, targets, kindName) {
  if (typeof item.target !== 'string' || targets === null) return [];
  const where = pathJoin(at, 'target');
  if (targets.length === 0) return [{ path: where, message: `${kindName} has no targets; remove "target"` }];
  if (targets.includes(item.target)) return [];
  const hint = didYouMean(item.target, targets);
  return [{ path: where, message: `unknown target ${JSON.stringify(item.target)}; ${hint ? `did you mean "${hint}"? ` : ''}the targets of ${kindName} are: ${targets.join(', ')}` }];
}

// `targets`: the kind's target names for this shot, or null when they cannot be known.
function checkOn(shot, base, ctx, { timed, targets, kindName }) {
  if (!Array.isArray(shot.on)) return [];
  return shot.on.flatMap((item, j) => {
    if (!isPlainObject(item)) return [];
    const at = pathJoin(pathJoin(base, 'on'), j);
    return [...checkAnchor(item, at, timed), ...checkDevice(item, at, ctx), ...checkTarget(item, at, targets, kindName)];
  });
}

// What is wrong with a `src` as written, or null. Checked by hand so the
// message can say which rule it broke: relative, inside the folder, exists.
function srcProblem(src, specDir) {
  const quoted = JSON.stringify(src);
  if (path.isAbsolute(src) || DRIVE_RE.test(src)) return `${quoted} is an absolute path; write a path relative to the spec folder, such as ${SRC_EXAMPLE}`;
  if (URL_RE.test(src)) return `${quoted} is a URL; write a path relative to the spec folder, such as ${SRC_EXAMPLE}`;
  const outside = `${quoted} is outside the spec folder; move the file inside it and write its path relative to the spec file, such as ${SRC_EXAMPLE}`;
  if (leavesFolder(specDir, path.resolve(specDir, src))) return outside;
  let real;
  let realRoot;
  try {
    realRoot = realpathSync(specDir);
    real = realpathSync(path.resolve(specDir, src));
  } catch {
    return `file not found: ${quoted} (paths are relative to the spec folder)`;
  }
  if (leavesFolder(realRoot, real)) return outside;
  return statSync(real).isDirectory() ? `${quoted} is a folder, not a file; name the file inside it` : null;
}

function leavesFolder(root, target) {
  const rel = path.relative(root, target);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function checkSrcFields(shot, base, kind, specDir) {
  return (kind?.srcFields ?? []).flatMap((field) => {
    const value = shot[field];
    if (typeof value !== 'string' || value === '') return [];
    const problem = srcProblem(value, specDir);
    return problem ? [{ path: pathJoin(base, field), message: problem }] : [];
  });
}

function checkShot(shot, index, ctx, seen) {
  const base = pathJoin('shots', index);
  const resolved = resolveKind(shot, base, ctx.regs);
  const check = resolved.kind ? shotCheckerFor(resolved.name, resolved.kind) : checkBaseShot;
  const shape = schemaErrors(check, shot, base);
  const narration = checkNarration(shot, base);
  const timed = narration.timed ? timelineShot(shot, ctx) : null;
  const targets = shape.length === 0 && typeof resolved.kind?.targets === 'function' ? resolved.kind.targets(shot) : null;
  return [
    ...resolved.errors,
    ...shape,
    ...checkShotId(shot, base, seen),
    ...narration.errors,
    ...checkCut(shot, index, base, ctx),
    ...checkOn(shot, base, ctx, { timed, targets, kindName: resolved.name }),
    ...checkSrcFields(shot, base, resolved.kind, ctx.specDir),
  ];
}

function checkShots(spec, ctx) {
  if (!Array.isArray(spec.shots)) return [];
  const seen = new Map();
  return spec.shots.flatMap((shot, index) => (isPlainObject(shot) ? checkShot(shot, index, ctx, seen) : []));
}

function collectErrors(spec, specDir, regs) {
  if (!isPlainObject(spec)) return [{ path: '', message: NOT_OBJECT_MESSAGE }];
  if (Array.isArray(spec.scenes) || spec.version === 1) return [{ path: '', message: V1_MESSAGE }];
  const { ctx, errors: settings } = resolveContext(spec, specDir, regs);
  return [
    ...checkVersion(spec),
    ...schemaErrors(checkRootSchema, spec, ''),
    ...checkAccent(spec),
    ...settings,
    ...checkShots(spec, ctx),
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
  const defaults = modeDefinition(mode, regs);
  return {
    ...structuredClone(spec),
    mode,
    look: spec.look ?? defaults.defaultLook,
    format: spec.format ?? defaults.defaultFormat,
    fps: spec.fps ?? DEFAULT_FPS,
    seed: spec.seed ?? DEFAULT_SEED,
  };
}

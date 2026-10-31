// motion.json schema, loading, cross-field validation and defaults.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { compile as compileVegaLite } from 'vega-lite';
import { formatAjvErrors, pathJoin, didYouMean } from '../../shared/errors.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
import { resolveAsset } from './paths.mjs';
import { AUDIO_EXTENSIONS, MAX_AUDIO_TRACKS, CUE_NAMES, KENNEY_NAMES, KENNEY_PREFIX, PITCHED_CUES, MAX_CUES, NOTE_PATTERN, trackStart, typingFollow } from '../../template/audio.mjs';
import { flattenElements, isGroup, MAX_GROUP_DEPTH, MAX_GROUP_CHILDREN } from '../../template/groups.mjs';
import { FORMATS, FORMAT_NAMES, VIRAL_REFERENCE, VIRAL_CAPTION_TOP } from '../../template/formats.mjs';
import { CAPTION_STYLES, CAPTION_EXTENSIONS, MAX_CAPTION_TRACKS, CaptionError, parseCaptions, trackGroups } from '../../template/captions.mjs';
import { VIDEO_EXTENSIONS, isVideo, probeVideo } from './video.mjs';
import { findFfprobe } from './ffmpeg.mjs';
import { doctorCommand } from './doctor-hint.mjs';

import { BLOCKS, BLOCK_NAMES, isBlock, blockDef, blockAssetFiles } from '../../template/blocks/index.mjs';
import { VIRAL_MODE } from '../../template/viral.mjs';

// Browser-safe pieces live in template/ so the renderer can import them too.
export { withDefaults } from '../../template/defaults.mjs';
import { expandSpec, EASE_CURVES, COLOR_TOKENS, TYPING_SECONDS_PER_CHAR, ARROW_HEAD_LENGTH, DEFAULT_SHAPE_SIZE, DEFAULT_LINE_STROKE, typingLength } from '../../template/defaults.mjs';

export class UsageError extends Error {}

const MAX_TOTAL_SECONDS = 120;

const EASE_FAMILIES = ['Quad', 'Cubic', 'Quart', 'Back', 'Elastic', 'Bounce', 'Sine', 'Expo', 'Circ'];
export const EASES = ['linear', ...['in', 'out', 'inOut'].flatMap((d) => EASE_FAMILIES.map((f) => d + f)), ...Object.keys(EASE_CURVES)];

const POSE = ['opacity', 'x', 'y', 'scale', 'rotate'];
export const ANIMATABLE = {
  text: [...POSE],
  counter: [...POSE, 'value'],
  shape: [...POSE, 'draw'],
  image: [...POSE],
  chart: [...POSE, 'reveal'],
  group: [...POSE],
  video: [...POSE],
  block: [...POSE], // a block's pose and keyframes become its group's
};

const COMMON = ['id', 'type', 'x', 'y', 'opacity', 'scale', 'rotate', 'keyframes', 'hold'];
const TEXT_STYLE = ['fontSize', 'fontWeight', 'color', 'align', 'maxWidth', 'font'];
const FIELDS = {
  text: [...COMMON, 'text', 'role', 'exit', 'typing', ...TEXT_STYLE],
  counter: [...COMMON, 'from', 'to', 'decimals', 'prefix', 'suffix', ...TEXT_STYLE],
  shape: [...COMMON, 'shape', 'width', 'height', 'radius', 'fill', 'stroke', 'strokeWidth', 'elevated', 'cap', 'arrow'],
  image: [...COMMON, 'src', 'width', 'height', 'fit'],
  chart: [...COMMON, 'vegaLite', 'width', 'height'],
  group: [...COMMON, 'children'],
  video: [...COMMON, 'src', 'width', 'height', 'fit', 'trimStart', 'trimEnd', 'offset', 'mute', 'volume'],
  block: [...COMMON, 'block', 'params'],
};
const REQUIRED = {
  text: ['text'],
  counter: ['to'],
  shape: ['shape'],
  image: ['src', 'width', 'height'],
  chart: ['vegaLite', 'width', 'height'],
  group: ['children'],
  video: ['src', 'width', 'height'],
  block: ['block', 'params'],
};

const num = { type: 'number' };
const unit = { type: 'number', minimum: 0, maximum: 1 };
const color = { type: 'string', minLength: 1 };
const keyframe = {
  type: 'object',
  additionalProperties: false,
  required: ['t'],
  properties: {
    t: { type: 'number', minimum: 0 },
    ease: { enum: EASES },
    opacity: unit, x: num, y: num, scale: num, rotate: num, draw: unit, reveal: unit, value: num,
  },
};
const element = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'x', 'y'],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { enum: Object.keys(FIELDS) },
    x: num, y: num, opacity: unit, scale: num, rotate: num,
    keyframes: { type: 'array', items: keyframe },
    hold: { type: 'boolean' }, // check.mjs: this element (a group's children too) may sit still for more than 3 s
    text: { type: 'string' },
    role: { type: 'string' },
    exit: { type: 'boolean' },
    typing: { type: 'boolean' },
    fontSize: { type: 'number', minimum: 1 },
    fontWeight: { enum: [400, 500, 600, 700, 800] },
    color,
    align: { enum: ['left', 'center', 'right'] },
    maxWidth: { type: 'number', minimum: 1 },
    font: { enum: ['sans', 'mono'] },
    from: num, to: num,
    decimals: { type: 'integer', minimum: 0, maximum: 6 },
    prefix: { type: 'string' }, suffix: { type: 'string' },
    shape: { enum: ['rect', 'ellipse', 'line'] },
    width: { type: 'number', minimum: 0 },
    height: { type: 'number', minimum: 0 },
    radius: { type: 'number', minimum: 0 },
    fill: color, stroke: color,
    strokeWidth: { type: 'number', minimum: 0 },
    elevated: { type: 'boolean' },
    cap: { enum: ['round'] },
    arrow: { enum: ['end'] },
    src: { type: 'string', minLength: 1 },
    fit: { enum: ['contain', 'cover', 'fill'] },
    vegaLite: { type: 'object' },
    trimStart: { type: 'number', minimum: 0 }, trimEnd: { type: 'number', exclusiveMinimum: 0 }, offset: { type: 'number', minimum: 0 },
    mute: { type: 'boolean' }, volume: unit,
    block: { type: 'string', minLength: 1 },
    params: { type: 'object' }, // checked against the named block's own schema (checkBlock)
    // A group's children are elements again (groups nest; checkElement caps the depth with a message that names the limit).
    children: { type: 'array', minItems: 1, maxItems: MAX_GROUP_CHILDREN, items: { $ref: '#/definitions/element' } },
  },
};
const seconds = { type: 'number', minimum: 0 };
const transition = { enum: ['none', 'fade', 'crossfade'] };
export const MAX_GRAIN = 0.15;
const texture = {
  type: 'object',
  additionalProperties: false,
  properties: { vignette: { type: 'boolean' }, grain: { type: 'number', minimum: 0, maximum: MAX_GRAIN } },
};
const audioTrack = {
  type: 'object',
  additionalProperties: false,
  required: ['src'],
  properties: {
    src: { type: 'string', minLength: 1 },
    scene: { type: 'string', minLength: 1 },
    at: seconds,
    duration: { type: 'number', exclusiveMinimum: 0 },
    volume: unit,
    fadeIn: seconds,
    fadeOut: seconds,
  },
};
const cue = {
  type: 'object',
  additionalProperties: false,
  required: ['cue'], // `at` too, unless a typing cue has `follow`: checkCues says so
  properties: {
    cue: { enum: [...CUE_NAMES, ...KENNEY_NAMES.map((n) => `${KENNEY_PREFIX}${n}`)] }, // a synth name, or a recorded sample
    scene: { type: 'string', minLength: 1 },
    at: seconds,
    follow: { type: 'string', minLength: 1 },
    volume: unit,
    pan: { type: 'number', minimum: -1, maximum: 1 },
    note: { type: 'string' },
  },
};
// A captions track is timed like an audio track (`scene` + `at`); checkCaptions reads and parses its file.
const captionTrack = {
  type: 'object',
  additionalProperties: false,
  required: ['src'],
  properties: {
    src: { type: 'string', minLength: 1 },
    style: { enum: [...CAPTION_STYLES] },
    scene: { type: 'string', minLength: 1 },
    at: seconds,
  },
};
// Viral mode (template/viral.mjs): the platform safe zone in px at 1080x1920, and whether the clip should loop.
const MAX_ZONE_PX = 800;
const zonePx = { type: 'integer', minimum: 0, maximum: MAX_ZONE_PX };
const viral = {
  type: 'object',
  additionalProperties: false,
  properties: {
    safeZone: { type: 'object', additionalProperties: false, required: ['top', 'bottom', 'left', 'right'], properties: { top: zonePx, bottom: zonePx, left: zonePx, right: zonePx } },
    loop: { type: 'boolean' },
  },
};
// A loudness target for the mix: render.mjs reports the measured level against it.
const loudness = {
  type: 'object',
  additionalProperties: false,
  required: ['integrated', 'truePeak'],
  properties: { integrated: { type: 'number', minimum: -30, maximum: -5 }, truePeak: { type: 'number', minimum: -3, maximum: 0 } },
};
export const SCHEMA = {
  definitions: { element },
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    audio: { type: 'array', maxItems: MAX_AUDIO_TRACKS, items: audioTrack },
    cues: { type: 'array', maxItems: MAX_CUES, items: cue },
    captions: { type: 'array', maxItems: MAX_CAPTION_TRACKS, items: captionTrack },
    format: { enum: [...FORMAT_NAMES] },
    size: {
      type: 'array', minItems: 2, maxItems: 2,
      items: { type: 'integer', minimum: 16, maximum: 3840 },
    },
    fps: { enum: [24, 25, 30, 60] },
    background: color,
    theme: { type: 'string', minLength: 1 },
    transition,
    texture,
    generatedBy: GENERATED_BY_SCHEMA,
    mode: { enum: [VIRAL_MODE] },
    viral,
    loudness,
    scenes: {
      type: 'array', minItems: 1, maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'duration', 'elements'],
        properties: {
          id: { type: 'string', minLength: 1 },
          duration: { type: 'number', minimum: 0.2, maximum: 60 },
          background: color,
          transition,
          elements: { type: 'array', items: { $ref: '#/definitions/element' } },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
const schemaCheck = ajv.compile(SCHEMA);
const paramsChecks = Object.assign(Object.create(null), Object.fromEntries(Object.entries(BLOCKS).map(([name, def]) => [name, ajv.compile(def.params)])));
const generatedByCheck = ajv.compile(GENERATED_BY_SCHEMA);

// True only for a present, schema-valid `generatedBy`; the preview footer uses it without validating the whole spec.
export const checkGeneratedBy = (value) => value !== undefined && generatedByCheck(value);

export function loadSpec(file) {
  const abs = path.resolve(file);
  let raw;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return { spec: JSON.parse(raw), dir: path.dirname(abs) };
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
}

function checkIds(spec, errors) {
  const seen = new Map();
  const claim = (id, at) => {
    if (seen.has(id)) errors.push({ path: at, message: `duplicate id "${id}" (first used at ${seen.get(id)})` });
    else seen.set(id, at);
  };
  spec.scenes.forEach((scene, si) => {
    claim(scene.id, `scenes[${si}].id`);
    for (const { el, path: at } of flattenElements(scene.elements, `scenes[${si}]`)) claim(el.id, pathJoin(at, 'id'));
  });
}

function checkKeyframes(el, base, sceneDuration, errors) {
  const allowed = el.type === 'text' && el.typing ? [...ANIMATABLE.text, 'value'] : ANIMATABLE[el.type]; // a typing text's `value` is its character count
  const typingHint = el.type === 'text' && !el.typing ? ' (value needs "typing": true)' : '';
  (el.keyframes ?? []).forEach((kf, i) => {
    const at = pathJoin(pathJoin(base, 'keyframes'), i);
    for (const prop of Object.keys(kf)) {
      if (prop === 't' || prop === 'ease' || allowed.includes(prop)) continue;
      errors.push({
        path: pathJoin(at, prop),
        message: `not animatable on ${el.type}; animatable: ${allowed.join(', ')}${prop === 'value' ? typingHint : ''}`,
      });
    }
    const prev = el.keyframes[i - 1];
    if (prev && kf.t < prev.t) {
      errors.push({
        path: pathJoin(at, 't'),
        message: `${kf.t} is before previous keyframe t=${prev.t}; keyframes must be sorted by t`,
      });
    }
    if (kf.t > sceneDuration) {
      errors.push({ path: pathJoin(at, 't'), message: `${kf.t} exceeds scene duration ${sceneDuration}` });
    }
  });
}

const CSS_NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod '
  + 'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon '
  + 'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey '
  + 'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey '
  + 'honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral '
  + 'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue '
  + 'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine '
  + 'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise '
  + 'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange '
  + 'orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna '
  + 'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet '
  + 'wheat white whitesmoke yellow yellowgreen transparent currentcolor').split(' '));
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|hsl)a?\([0-9a-z\s.,%/+-]*\)$/i; // one flat call: no nesting, so no url()/var()/calc()

function isCssColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return HEX_COLOR.test(v) || FUNC_COLOR.test(v) || CSS_NAMED.has(v.toLowerCase());
}

const COLOUR_MESSAGE = 'must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a named colour)';
// `tokens`: the field also takes a theme colour token (shape fill/stroke, text colour), not a background.
function checkColor(obj, key, base, errors, { tokens = false } = {}) {
  if (obj[key] === undefined || isCssColor(obj[key]) || (tokens && COLOR_TOKENS.includes(obj[key]))) return;
  const art = obj[key] === ART_BACKGROUND ? `; "${ART_BACKGROUND}" is only valid as a scene background` : '';
  const token = tokens ? ` or a theme token: ${COLOR_TOKENS.join(', ')}` : '';
  errors.push({ path: pathJoin(base, key), message: COLOUR_MESSAGE + token + art });
}

// A scene background is a colour or "art": the theme's seeded art, drawn full-bleed behind the elements.
export const ART_BACKGROUND = 'art';
function checkSceneBackground(scene, base, errors) {
  if (scene.background !== ART_BACKGROUND) checkColor(scene, 'background', base, errors);
}

// `role` marks a text's job. Only "title" exists (display font, the theme's kinetic preset), so any
// other value is a near miss for it.
const ROLES = ['title'];
function checkRole(el, base, errors) {
  if (el.role === undefined || ROLES.includes(el.role)) return;
  const near = didYouMean(el.role, ROLES) ?? (ROLES.length === 1 ? ROLES[0] : null);
  errors.push({ path: pathJoin(base, 'role'), message: `unknown role ${JSON.stringify(el.role)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `allowed: ${ROLES.join(', ')}`}` });
}

const REMOTE_DATA = 'remote data is not allowed — inline data.values';
const REMOTE_OTHER = 'remote URLs are not allowed — charts cannot load external resources';
const DATA_ROWS = new Set(['values', 'datasets']); // row contents may legitimately have a "url" column

// Every `url` key anywhere in the Vega-Lite spec, except inside inline data rows.
function findUrls(node, at, found = []) {
  if (!node || typeof node !== 'object') return found;
  for (const [key, child] of Object.entries(node)) {
    const here = pathJoin(at, Array.isArray(node) ? Number(key) : key);
    if (key === 'url') found.push(here);
    else if (!DATA_ROWS.has(key)) findUrls(child, here, found);
  }
  return found;
}

function checkChart(el, base, errors) {
  const vl = el.vegaLite;
  const vlPath = pathJoin(base, 'vegaLite');
  const urls = findUrls(vl, vlPath);
  for (const at of urls) errors.push({ path: at, message: at.endsWith('.data.url') ? REMOTE_DATA : REMOTE_OTHER });
  if (urls.length) return;
  const named = vl.data?.name;
  if (typeof named === 'string' && !Array.isArray(vl.datasets?.[named])) {
    errors.push({ path: pathJoin(vlPath, 'data.name'), message: `dataset "${named}" not found in vegaLite.datasets` });
    return;
  }
  if (typeof named !== 'string' && !Array.isArray(vl.data?.values)) {
    errors.push({ path: pathJoin(vlPath, 'data.values'), message: 'required — chart needs inline data.values' });
    return;
  }
  try {
    compileVegaLite({ ...vl, width: el.width, height: el.height });
  } catch (e) {
    errors.push({ path: vlPath, message: `Vega-Lite compile error: ${String(e.message).split('\n')[0]}` });
  }
}

function checkAssetPath(src, at, dir, errors) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || path.isAbsolute(src)) {
    errors.push({ path: at, message: 'must be a path relative to the spec file' });
    return false;
  }
  const { error } = resolveAsset(dir, src);
  if (error) errors.push({ path: at, message: error });
  return !error;
}

// Fades must fit inside the time the track plays, so the preview ramps and ffmpeg's afade agree.
function checkFades(track, start, total, base, errors) {
  const fadeIn = track.fadeIn ?? 0;
  const fadeOut = track.fadeOut ?? 0;
  const end = track.duration === undefined ? total : Math.min(total, start + track.duration);
  const plays = Math.round((end - start) * 1000) / 1000;
  if (fadeIn + fadeOut <= plays) return;
  const until = track.duration === undefined ? `the video end at ${total}s` : `${end}s`;
  errors.push({ path: pathJoin(base, 'fadeOut'), message: `fadeIn ${fadeIn}s + fadeOut ${fadeOut}s exceed the ${plays}s the track plays (from ${start}s to ${until})` });
}

const totalSeconds = (spec) => spec.scenes.reduce((a, s) => a + s.duration, 0);

// Where an audio track or a cue starts must exist: its `scene` must be one of the spec's, it must start before the video
// ends, and (`inScene`, for cues) its `at` must lie inside that scene, or it would play in a later one unannounced.
// Pushes the error and returns false when it does not.
function checkStart(item, spec, base, errors, { inScene = false } = {}) {
  const scene = item.scene === undefined ? undefined : spec.scenes.find((s) => s.id === item.scene);
  if (item.scene !== undefined && !scene) {
    errors.push({ path: pathJoin(base, 'scene'), message: `scene "${item.scene}" not found; scenes: ${spec.scenes.map((s) => s.id).join(', ')}` });
    return false;
  }
  if (inScene && scene && item.at >= scene.duration) {
    errors.push({ path: pathJoin(base, 'at'), message: `${item.at}s is past the end of scene "${scene.id}", which lasts ${scene.duration}s; use a smaller at, or put the cue in a later scene` });
    return false;
  }
  const start = trackStart(item, spec);
  if (start < totalSeconds(spec)) return true;
  const how = scene ? ` (scene "${scene.id}" + ${item.at ?? 0}s)` : '';
  errors.push({ path: pathJoin(base, 'at'), message: `starts at ${start}s${how}, but the video ends at ${totalSeconds(spec)}s` });
  return false;
}

function checkAudio(spec, dir, errors) {
  const total = totalSeconds(spec);
  (spec.audio ?? []).forEach((track, i) => {
    const base = `audio[${i}]`;
    const ext = path.extname(track.src).slice(1).toLowerCase();
    if (checkAssetPath(track.src, pathJoin(base, 'src'), dir, errors) && !AUDIO_EXTENSIONS.includes(ext)) {
      const list = `${AUDIO_EXTENSIONS.slice(0, -1).join(', ')} or ${AUDIO_EXTENSIONS.at(-1)}`;
      errors.push({ path: pathJoin(base, 'src'), message: `unsupported audio format "${path.extname(track.src)}"; use ${list}` });
    }
    if (!checkStart(track, spec, base, errors)) return;
    checkFades(track, trackStart(track, spec), total, base, errors);
  });
}

// A captions file must be one the page can read (srt, vtt or json, inside the spec folder) and must parse: a cue out of
// order or ending before it starts is reported here, at the track's `src`, naming the cue and its line. A track must
// show something, and two tracks must never be on screen at once (they would draw over each other in the zone).
function checkCaptions(spec, dir, errors) {
  const shown = [];
  (spec.captions ?? []).forEach((track, i) => {
    const base = `captions[${i}]`;
    const at = pathJoin(base, 'src');
    const words = checkAssetPath(track.src, at, dir, errors) ? captionWords(track.src, at, dir, errors) : null;
    if (!checkStart(track, spec, base, errors) || !words) return;
    const groups = captionErrorAt(at, errors, () => trackGroups(words, trackStart(track, spec)));
    if (groups) shown.push({ index: i, groups });
  });
  checkCaptionOverlaps(shown, totalSeconds(spec), errors);
}

// `run()`'s result, or null with its CaptionError pushed at `at`.
function captionErrorAt(at, errors, run) {
  try {
    return run();
  } catch (e) {
    if (!(e instanceof CaptionError)) throw e;
    errors.push({ path: at, message: e.message });
    return null;
  }
}

function captionWords(src, at, dir, errors) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!CAPTION_EXTENSIONS.includes(ext)) {
    errors.push({ path: at, message: `unsupported captions format "${path.extname(src)}"; use srt, vtt or json` });
    return null;
  }
  return captionErrorAt(at, errors, () => parseCaptions(readFileSync(resolveAsset(dir, src).file, 'utf8'), ext));
}

const msOf = (seconds) => Math.round(seconds * 1000);
// The first moment before the video ends (`total`) that two tracks' groups are on screen together, or null.
function firstOverlap(a, b, total) {
  const end = (g) => Math.min(msOf(g.end), msOf(total));
  let first = null;
  for (const x of a) {
    for (const y of b) {
      if (msOf(x.start) < end(y) && msOf(y.start) < end(x)) first = Math.min(first ?? Infinity, Math.max(x.start, y.start));
    }
  }
  return first;
}

function checkCaptionOverlaps(tracks, total, errors) {
  tracks.forEach((later, k) => {
    const hit = tracks.slice(0, k).map((earlier) => ({ earlier, t: firstOverlap(earlier.groups, later.groups, total) })).find(({ t }) => t !== null);
    if (!hit) return;
    errors.push({ path: `captions[${later.index}]`, message: `on screen at ${hit.t.toFixed(2)}s together with captions[${hit.earlier.index}]; only one captions track can show at a time: move one with at or scene, or merge the files` });
  });
}

// `elevated` belongs to rects, `cap` and `arrow` to lines.
const SHAPE_ONLY = { elevated: 'rect', cap: 'line', arrow: 'line' };
function checkShapeStyle(el, base, errors) {
  for (const [key, shape] of Object.entries(SHAPE_ONLY)) {
    if (el[key] !== undefined && el[key] !== false && el.shape !== shape) errors.push({ path: pathJoin(base, key), message: `only valid on a ${shape} shape` });
  }
  if (el.shape === 'line') checkLineLength(el, base, errors);
}

// An arrow head takes ARROW_HEAD_LENGTH stroke widths off the line and a round cap half a stroke width at each end: the
// line must be longer than what they use, or it would vanish or run backwards.
function checkLineLength(el, base, errors) {
  const stroke = el.strokeWidth ?? DEFAULT_LINE_STROKE;
  const width = el.width ?? DEFAULT_SHAPE_SIZE;
  const round = el.cap === 'round';
  const arrow = el.arrow === 'end';
  const minimum = (arrow ? ARROW_HEAD_LENGTH * stroke : 0) + (round ? (arrow ? 0.5 : 1) * stroke : 0);
  if (!(arrow || round) || width > minimum) return;
  const what = arrow ? `an arrow${round ? ' and a round cap' : ''}` : 'a round cap';
  errors.push({ path: pathJoin(base, 'width'), message: `${width} is too short for ${what} with strokeWidth ${stroke}; the width must be more than ${minimum}` });
}

// A typing cue with `follow` takes its start and its clicks from a typing text, so it has no `at` or `scene`. Its clicks
// must end inside the text's scene (at the default pace from where the text starts typing).
const FOLLOW_EPSILON = 1e-9;
function checkFollow(c, spec, base, errors) {
  const fail = (key, message) => errors.push({ path: pathJoin(base, key), message });
  if (c.cue !== 'typing') return fail('follow', 'only typing takes follow');
  const instead = `not with follow; the cue starts when ${JSON.stringify(c.follow)} starts typing`;
  if (c.at !== undefined) return fail('at', instead);
  if (c.scene !== undefined) return fail('scene', instead);
  const typing = typingFollow(spec, c.follow);
  if (!typing) {
    const texts = spec.scenes.flatMap((s) => flattenElements(s.elements).filter(({ el }) => el.type === 'text' && el.typing).map(({ el }) => el.id));
    return fail('follow', `element ${JSON.stringify(c.follow)} not found; typing texts: ${texts.join(', ') || 'none'}`);
  }
  const name = JSON.stringify(c.follow);
  if (typing.el.type !== 'text') return fail('follow', `element ${name} is a ${typing.el.type}, not a text; follow a typing text`);
  if (!typing.el.typing) return fail('follow', `element ${name} is not a typing text (set "typing": true on it, or drop follow)`);
  if (typing.chars === 0) return fail('follow', `${name} never types a character (it needs text, and value keyframes that rise if it has any); fix the text or drop follow`);
  const sceneEnd = trackStart({ scene: typing.scene.id }, spec) + typing.scene.duration;
  if (typing.start + typing.chars * TYPING_SECONDS_PER_CHAR > sceneEnd + FOLLOW_EPSILON) {
    fail('follow', `${name} types past the end of scene ${JSON.stringify(typing.scene.id)}`);
  }
  return undefined;
}

// A cue is timed like an audio track (`scene` + `at`), or follows a typing text; a `note` tunes only the pitched cues.
function checkCues(spec, errors) {
  (spec.cues ?? []).forEach((c, i) => {
    const base = `cues[${i}]`;
    if (c.note !== undefined && !NOTE_PATTERN.test(c.note)) {
      errors.push({ path: pathJoin(base, 'note'), message: 'must be a note name such as A4, C#5 or Bb3 (A-G, optional # or b, octave 0-8)' });
    } else if (c.note !== undefined && !PITCHED_CUES.includes(c.cue)) {
      errors.push({ path: pathJoin(base, 'note'), message: `${c.cue} has no pitch; note is for ${PITCHED_CUES.slice(0, -1).join(', ')} and ${PITCHED_CUES.at(-1)}` });
    }
    if (c.follow !== undefined) checkFollow(c, spec, base, errors);
    else if (c.at === undefined) errors.push({ path: pathJoin(base, 'at'), message: 'required' });
    else checkStart(c, spec, base, errors, { inScene: true });
  });
}

// A typing text with no `value` keyframes types at a fixed pace from the scene start; it must finish (a frame before
// the scene ends, so its last frame shows the whole line) or the video would cut it off silently.
const TYPING_FALLBACK_FPS = 30;
const CENTISECONDS = 100;
function checkTyping(el, base, scene, fps, errors) {
  if (!el.typing || typeof el.text !== 'string' || el.keyframes?.some((kf) => kf.value !== undefined)) return;
  const chars = typingLength(el.text);
  const takes = chars * TYPING_SECONDS_PER_CHAR;
  const needs = takes + 1 / fps;
  if (needs <= scene.duration) return;
  errors.push({ path: pathJoin(base, 'text'), message: `typing ${chars} characters takes ${takes.toFixed(2)}s but scene "${scene.id}" lasts ${scene.duration}s (it must finish a frame before the scene ends at ${fps} fps); shorten the text or lengthen the scene to at least ${Math.ceil(needs * CENTISECONDS) / CENTISECONDS}s` });
}

// The typing errors of `spec` at frame rate `fps`: render.mjs asks again with its --fps, which overrides the spec's.
export function typingErrors(spec, fps) {
  const errors = [];
  spec.scenes.forEach((scene, si) => flattenElements(scene.elements, `scenes[${si}]`).forEach(({ el, path: at }) => {
    if (el.type === 'text') checkTyping(el, at, scene, fps, errors);
  }));
  return errors;
}

// A group's children are checked as elements in their own right, at their nested path; a group may not nest deeper
// than MAX_GROUP_DEPTH, and says so once, at the first group past the limit.
function checkGroup(el, base, scene, dir, errors, fps, depth) {
  if (depth >= MAX_GROUP_DEPTH) {
    errors.push({ path: pathJoin(base, 'children'), message: `groups nest at most ${MAX_GROUP_DEPTH} deep; move this group's children up a level, or out of the outer groups` });
    return;
  }
  (el.children ?? []).forEach((child, i) => checkElement(child, pathJoin(pathJoin(base, 'children'), i), scene, dir, errors, fps, depth + 1));
}

// The fields `el` may carry as its type, and the ones it must.
function checkFields(el, base, errors) {
  const fields = FIELDS[el.type];
  for (const key of Object.keys(el)) {
    if (!fields.includes(key)) {
      errors.push({ path: pathJoin(base, key), message: `not valid on ${el.type}; allowed: ${fields.join(', ')}` });
    }
  }
  for (const key of REQUIRED[el.type]) {
    if (el[key] === undefined) errors.push({ path: pathJoin(base, key), message: `required for type ${el.type}` });
  }
}

// `depth`: how many groups enclose `el` (0 at the top level of a scene).
function checkElement(el, base, scene, dir, errors, fps = TYPING_FALLBACK_FPS, depth = 0) {
  checkFields(el, base, errors);
  checkKeyframes(el, base, scene.duration, errors);
  if (el.type === 'text') { checkRole(el, base, errors); checkTyping(el, base, scene, fps, errors); }
  for (const key of ['color', 'fill', 'stroke']) checkColor(el, key, base, errors, { tokens: true });
  if (el.type === 'shape') checkShapeStyle(el, base, errors);
  if (el.type === 'image' && typeof el.src === 'string') checkAssetPath(el.src, pathJoin(base, 'src'), dir, errors);
  if (el.type === 'chart' && el.vegaLite) checkChart(el, base, errors);
  if (isGroup(el)) checkGroup(el, base, scene, dir, errors, fps, depth);
}

// A video `src` follows the image path rules and must be a clip ffprobe can read; its trimmed range must lie inside the
// clip. Without ffprobe nothing about the clip can be known, so the spec gets one error, at its first video element.
function checkVideos(spec, dir, errors) {
  const videos = spec.scenes.flatMap((s, si) => flattenElements(s.elements, `scenes[${si}]`)).filter(({ el }) => isVideo(el));
  if (!videos.length) return;
  const ffprobe = findFfprobe();
  if (!ffprobe) errors.push({ path: pathJoin(videos[0].path, 'src'), message: `ffprobe not found (needed to check video elements); install ffmpeg: ${doctorCommand('--fix', 'ffmpeg')}` });
  for (const { el, path: base } of videos) checkVideo(el, base, dir, ffprobe, errors);
}

function checkVideo(el, base, dir, ffprobe, errors) {
  const at = pathJoin(base, 'src');
  if (typeof el.src !== 'string' || !checkAssetPath(el.src, at, dir, errors)) return;
  if (!VIDEO_EXTENSIONS.includes(path.extname(el.src).slice(1).toLowerCase())) {
    const list = `${VIDEO_EXTENSIONS.slice(0, -1).join(', ')} or ${VIDEO_EXTENSIONS.at(-1)}`;
    errors.push({ path: at, message: `unsupported video format "${path.extname(el.src)}"; use ${list}` });
    return;
  }
  const trimStart = el.trimStart ?? 0;
  const trimOrder = { path: pathJoin(base, 'trimStart'), message: 'trimStart must be less than trimEnd' };
  if (el.trimEnd !== undefined && trimStart >= el.trimEnd) {
    errors.push(trimOrder);
    return;
  }
  if (!ffprobe) return;
  const info = probeVideo(ffprobe, resolveAsset(dir, el.src).file);
  if (info.error) errors.push({ path: at, message: `ffprobe cannot read ${el.src}: ${info.error}` });
  else if (el.trimEnd > info.duration) errors.push({ path: pathJoin(base, 'trimEnd'), message: `trimEnd ${el.trimEnd} exceeds the clip length ${info.duration}s` });
  else if (trimStart >= (el.trimEnd ?? info.duration)) errors.push(trimOrder);
}

// A theme is a name from the shared themes; its dark colours and fonts become the defaults.
function checkTheme(spec, errors) {
  if (spec.theme === undefined) return;
  const themes = listThemes();
  if (themes.includes(spec.theme)) return;
  const near = didYouMean(spec.theme, themes);
  errors.push({ path: 'theme', message: `unknown theme ${JSON.stringify(spec.theme)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `available: ${themes.join(', ')}`}` });
}

// A `format` fixes the canvas size, so a `size` beside it must be the same one; either alone is enough.
function checkFormat(spec, errors) {
  if (spec.format === undefined || spec.size === undefined) return;
  const [w, h] = FORMATS[spec.format].size;
  if (spec.size[0] === w && spec.size[1] === h) return;
  errors.push({ path: 'size', message: `${JSON.stringify(spec.size)} does not match format "${spec.format}" (${w}x${h}); drop one of them` });
}

// A block as written, at its own path: its element fields and keyframes, the block name, its params against the block's
// schema, the files its params name (checked like an image src) and what its definition adds (`validate`, such as a
// scene too short for its schedule). Params that pass expand without error.
function checkBlock(el, base, scene, dir, errors) {
  checkFields(el, base, errors);
  checkKeyframes(el, base, scene.duration, errors);
  if (el.block === undefined) return;
  const def = blockDef(el.block);
  if (!def) {
    const near = didYouMean(el.block, BLOCK_NAMES);
    errors.push({ path: pathJoin(base, 'block'), message: `unknown block ${JSON.stringify(el.block)}${near ? `; did you mean ${JSON.stringify(near)}?` : ''} (blocks: ${BLOCK_NAMES.join(', ')})` });
    return;
  }
  if (el.params === undefined) return;
  const at = pathJoin(base, 'params');
  const check = paramsChecks[el.block];
  if (!check(el.params)) {
    errors.push(...formatAjvErrors(check.errors).map((e) => ({ path: e.path ? `${at}.${e.path}` : at, message: e.message })));
    return;
  }
  for (const file of blockAssetFiles(el)) checkAssetPath(file.src, pathJoin(at, file.at), dir, errors);
  for (const e of def.validate?.(el.params, { sceneDuration: scene.duration }) ?? []) errors.push({ path: pathJoin(at, e.path), message: e.message });
}

// Every block, checked before anything expands. A block goes directly in a scene's elements: expandBlocks expands only
// those, so one inside a group is refused here, naming the group.
function checkBlocks(spec, dir, errors) {
  spec.scenes.forEach((scene, si) => {
    const chain = [];
    for (const { el, path: base, depth } of flattenElements(scene.elements, `scenes[${si}]`)) {
      chain.length = depth;
      chain.push(el);
      if (!isBlock(el)) continue;
      if (depth === 0) checkBlock(el, base, scene, dir, errors);
      else errors.push({ path: pathJoin(base, 'type'), message: `a block goes directly in a scene's elements, not inside a group; move ${JSON.stringify(el.id)} out of group ${JSON.stringify(chain[depth - 1].id)}` });
    }
  });
}

// The full check runs on the expanded spec, where a block is a group of parts. Valid params never make a part fail, but
// an error that does land inside a block (a part id another element also uses) is moved to the block itself: its `id`
// for an id clash, else its `params`; a path to a part named inside a message is moved the same way.
const PART_PATH = /scenes\[\d+\]\.elements\[\d+\](?:\.children\[\d+\])+(?:\.[A-Za-z]+(?:\[\d+\])*)*/g;
function atBlocks(written, errors) {
  const blocks = written.scenes.flatMap((scene, si) => scene.elements.flatMap((el, ei) => (isBlock(el) ? [{ base: `scenes[${si}].elements[${ei}]`, el }] : [])));
  const owner = (at) => blocks.find(({ base }) => at.startsWith(`${base}.children[`));
  const lift = (at) => {
    const block = owner(at);
    if (!block) return at;
    return at.endsWith('.id') ? `${block.base}.id` : `${block.base}.params`;
  };
  const lifted = errors.map(({ path: at, message }) => {
    const block = owner(at);
    const text = message.replace(PART_PATH, lift);
    if (!block) return { path: at, message: text };
    return { path: lift(at), message: `${text} (block ${JSON.stringify(block.el.id)} names its parts "${block.el.id}/<part>")` };
  });
  // A block id used twice clashes once for the block and once per part: keep only the first error at each block's id.
  const blockIds = new Set(blocks.map(({ base }) => `${base}.id`));
  const seen = new Set();
  return lifted.filter(({ path: at }) => {
    if (!blockIds.has(at)) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    return true;
  });
}

// What a `viral.safeZone` must leave free, in px at 1080x1920: room across for text and captions, room above the
// lifted caption zone (it starts at VIRAL_CAPTION_TOP of the height) for the content, and room in it for two lines.
const MIN_SAFE_WIDTH = 360;
const MIN_CONTENT_HEIGHT = 240;
const MIN_CAPTION_HEIGHT = 160;

// `viral` settings mean nothing without viral mode, so they are refused rather than silently ignored; a safe zone whose
// bands overlap (or crowd out the content or the captions) would lay everything out in an inverted box.
function checkViral(written, errors) {
  if (written.viral !== undefined && written.mode !== VIRAL_MODE) {
    errors.push({ path: 'viral', message: `needs "mode": "${VIRAL_MODE}"` });
    return;
  }
  const zone = written.viral?.safeZone;
  if (!zone) return;
  const [w, h] = VIRAL_REFERENCE;
  const captionTop = Math.round(h * VIRAL_CAPTION_TOP);
  const at = 'viral.safeZone';
  if (zone.left + zone.right > w - MIN_SAFE_WIDTH) {
    errors.push({ path: at, message: `left ${zone.left} + right ${zone.right} leave ${Math.max(0, w - zone.left - zone.right)} px of the ${w} px width; keep left + right at most ${w - MIN_SAFE_WIDTH}` });
  }
  if (zone.top > captionTop - MIN_CONTENT_HEIGHT) {
    errors.push({ path: `${at}.top`, message: `${zone.top} leaves ${Math.max(0, captionTop - zone.top)} px above the captions (they start at y ${captionTop}); keep top at most ${captionTop - MIN_CONTENT_HEIGHT}` });
  }
  if (h - zone.bottom - captionTop < MIN_CAPTION_HEIGHT) {
    errors.push({ path: `${at}.bottom`, message: `${zone.bottom} leaves the captions ${Math.max(0, h - zone.bottom - captionTop)} px (y ${captionTop} to ${h - zone.bottom}); keep bottom at most ${h - captionTop - MIN_CAPTION_HEIGHT}` });
  }
}

export function validateSpec(written, { dir = process.cwd() } = {}) {
  if (!schemaCheck(written)) return { ok: false, errors: formatAjvErrors(schemaCheck.errors) };
  const blockErrors = [];
  checkBlocks(written, dir, blockErrors);
  if (blockErrors.length) return { ok: false, errors: blockErrors };
  const spec = expandSpec(written); // pipeline steps 1-3 (template/defaults.mjs); the checks below see plain elements
  const errors = [];
  checkViral(written, errors);
  checkIds(spec, errors);
  checkFormat(spec, errors);
  checkTheme(spec, errors);
  checkColor(spec, 'background', '', errors);
  spec.scenes.forEach((scene, si) => {
    checkSceneBackground(scene, `scenes[${si}]`, errors);
    if (si === 0 && scene.transition === 'crossfade') {
      errors.push({ path: 'scenes[0].transition', message: 'crossfade needs a previous scene to fade in over; use "fade" or "none" on the first scene' });
    }
    scene.elements.forEach((el, ei) => checkElement(el, `scenes[${si}].elements[${ei}]`, scene, dir, errors, spec.fps));
  });
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  if (total > MAX_TOTAL_SECONDS) {
    errors.push({ path: 'scenes', message: `total duration ${total}s exceeds the ${MAX_TOTAL_SECONDS}s limit` });
  }
  checkVideos(spec, dir, errors);
  checkAudio(spec, dir, errors);
  checkCues(spec, errors);
  checkCaptions(spec, dir, errors);
  return { ok: errors.length === 0, errors: atBlocks(written, errors) };
}

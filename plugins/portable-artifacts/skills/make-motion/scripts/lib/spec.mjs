// motion.json schema, loading, cross-field validation and defaults.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { compile as compileVegaLite } from 'vega-lite';
import { formatAjvErrors, pathJoin, didYouMean } from '../../shared/errors.mjs';
import { listThemes } from '../../shared/theme.mjs';
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
import { resolveAsset } from './paths.mjs';
import { AUDIO_EXTENSIONS, MAX_AUDIO_TRACKS, CUE_NAMES, PITCHED_CUES, MAX_CUES, NOTE_PATTERN, trackStart } from '../../template/audio.mjs';

// Browser-safe pieces live in template/ so the renderer can import them too.
export { withDefaults } from '../../template/defaults.mjs';
import { EASE_CURVES, COLOR_TOKENS, TYPING_SECONDS_PER_CHAR, typingLength } from '../../template/defaults.mjs';

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
};

const COMMON = ['id', 'type', 'x', 'y', 'opacity', 'scale', 'rotate', 'keyframes'];
const TEXT_STYLE = ['fontSize', 'fontWeight', 'color', 'align', 'maxWidth', 'font'];
const FIELDS = {
  text: [...COMMON, 'text', 'role', 'exit', 'typing', ...TEXT_STYLE],
  counter: [...COMMON, 'from', 'to', 'decimals', 'prefix', 'suffix', ...TEXT_STYLE],
  shape: [...COMMON, 'shape', 'width', 'height', 'radius', 'fill', 'stroke', 'strokeWidth', 'elevated', 'cap', 'arrow'],
  image: [...COMMON, 'src', 'width', 'height', 'fit'],
  chart: [...COMMON, 'vegaLite', 'width', 'height'],
};
const REQUIRED = {
  text: ['text'],
  counter: ['to'],
  shape: ['shape'],
  image: ['src', 'width', 'height'],
  chart: ['vegaLite', 'width', 'height'],
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
  required: ['cue', 'at'],
  properties: {
    cue: { enum: [...CUE_NAMES] },
    scene: { type: 'string', minLength: 1 },
    at: seconds,
    volume: unit,
    pan: { type: 'number', minimum: -1, maximum: 1 },
    note: { type: 'string' },
  },
};
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    audio: { type: 'array', maxItems: MAX_AUDIO_TRACKS, items: audioTrack },
    cues: { type: 'array', maxItems: MAX_CUES, items: cue },
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
          elements: { type: 'array', items: element },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true });
const schemaCheck = ajv.compile(SCHEMA);
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
    scene.elements.forEach((el, ei) => claim(el.id, `scenes[${si}].elements[${ei}].id`));
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

function checkAudio(spec, dir, errors) {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const sceneIds = spec.scenes.map((s) => s.id);
  (spec.audio ?? []).forEach((track, i) => {
    const base = `audio[${i}]`;
    const ext = path.extname(track.src).slice(1).toLowerCase();
    if (checkAssetPath(track.src, pathJoin(base, 'src'), dir, errors) && !AUDIO_EXTENSIONS.includes(ext)) {
      const list = `${AUDIO_EXTENSIONS.slice(0, -1).join(', ')} or ${AUDIO_EXTENSIONS.at(-1)}`;
      errors.push({ path: pathJoin(base, 'src'), message: `unsupported audio format "${path.extname(track.src)}"; use ${list}` });
    }
    if (track.scene !== undefined && !sceneIds.includes(track.scene)) {
      errors.push({ path: pathJoin(base, 'scene'), message: `scene "${track.scene}" not found; scenes: ${sceneIds.join(', ')}` });
      return;
    }
    const start = trackStart(track, spec);
    if (start >= total) {
      const how = track.scene === undefined ? '' : ` (scene "${track.scene}" + ${track.at ?? 0}s)`;
      errors.push({ path: pathJoin(base, 'at'), message: `starts at ${start}s${how}, but the video ends at ${total}s` });
      return;
    }
    checkFades(track, start, total, base, errors);
  });
}

// `elevated` belongs to rects, `cap` and `arrow` to lines.
const SHAPE_ONLY = { elevated: 'rect', cap: 'line', arrow: 'line' };
function checkShapeStyle(el, base, errors) {
  for (const [key, shape] of Object.entries(SHAPE_ONLY)) {
    if (el[key] !== undefined && el.shape !== shape) errors.push({ path: pathJoin(base, key), message: `only valid on a ${shape} shape` });
  }
}

// A cue is timed like an audio track (`scene` + `at`); a `note` tunes only the pitched cues.
function checkCues(spec, errors) {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  const sceneIds = spec.scenes.map((s) => s.id);
  (spec.cues ?? []).forEach((c, i) => {
    const base = `cues[${i}]`;
    if (c.note !== undefined && !NOTE_PATTERN.test(c.note)) {
      errors.push({ path: pathJoin(base, 'note'), message: 'must be a note name such as A4, C#5 or Bb3 (A-G, optional # or b, octave 0-8)' });
    } else if (c.note !== undefined && !PITCHED_CUES.includes(c.cue)) {
      errors.push({ path: pathJoin(base, 'note'), message: `${c.cue} has no pitch; note is for ${PITCHED_CUES.slice(0, -1).join(', ')} and ${PITCHED_CUES.at(-1)}` });
    }
    if (c.scene !== undefined && !sceneIds.includes(c.scene)) {
      errors.push({ path: pathJoin(base, 'scene'), message: `scene "${c.scene}" not found; scenes: ${sceneIds.join(', ')}` });
      return;
    }
    const start = trackStart(c, spec);
    if (start >= total) {
      const how = c.scene === undefined ? '' : ` (scene "${c.scene}" + ${c.at}s)`;
      errors.push({ path: pathJoin(base, 'at'), message: `starts at ${start}s${how}, but the video ends at ${total}s` });
    }
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
  errors.push({ path: pathJoin(base, 'text'), message: `typing ${chars} characters takes ${takes.toFixed(2)}s but scene "${scene.id}" lasts ${scene.duration}s (it must finish a frame before the scene ends); shorten the text or lengthen the scene to at least ${Math.ceil(needs * CENTISECONDS) / CENTISECONDS}s` });
}

function checkElement(el, base, scene, dir, errors, fps = TYPING_FALLBACK_FPS) {
  const fields = FIELDS[el.type];
  for (const key of Object.keys(el)) {
    if (!fields.includes(key)) {
      errors.push({ path: pathJoin(base, key), message: `not valid on ${el.type}; allowed: ${fields.join(', ')}` });
    }
  }
  for (const key of REQUIRED[el.type]) {
    if (el[key] === undefined) errors.push({ path: pathJoin(base, key), message: `required for type ${el.type}` });
  }
  checkKeyframes(el, base, scene.duration, errors);
  if (el.type === 'text') { checkRole(el, base, errors); checkTyping(el, base, scene, fps, errors); }
  for (const key of ['color', 'fill', 'stroke']) checkColor(el, key, base, errors, { tokens: true });
  if (el.type === 'shape') checkShapeStyle(el, base, errors);
  if (el.type === 'image' && typeof el.src === 'string') checkAssetPath(el.src, pathJoin(base, 'src'), dir, errors);
  if (el.type === 'chart' && el.vegaLite) checkChart(el, base, errors);
}

// A theme is a name from the shared themes; its dark colours and fonts become the defaults.
function checkTheme(spec, errors) {
  if (spec.theme === undefined) return;
  const themes = listThemes();
  if (themes.includes(spec.theme)) return;
  const near = didYouMean(spec.theme, themes);
  errors.push({ path: 'theme', message: `unknown theme ${JSON.stringify(spec.theme)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `available: ${themes.join(', ')}`}` });
}

export function validateSpec(spec, { dir = process.cwd() } = {}) {
  if (!schemaCheck(spec)) return { ok: false, errors: formatAjvErrors(schemaCheck.errors) };
  const errors = [];
  checkIds(spec, errors);
  checkTheme(spec, errors);
  checkColor(spec, 'background', '', errors);
  spec.scenes.forEach((scene, si) => {
    checkSceneBackground(scene, `scenes[${si}]`, errors);
    if (si === 0 && scene.transition === 'crossfade') {
      errors.push({ path: 'scenes[0].transition', message: 'crossfade needs a previous scene to fade out; use "fade" or "none" on the first scene' });
    }
    scene.elements.forEach((el, ei) => checkElement(el, `scenes[${si}].elements[${ei}]`, scene, dir, errors, spec.fps));
  });
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  if (total > MAX_TOTAL_SECONDS) {
    errors.push({ path: 'scenes', message: `total duration ${total}s exceeds the ${MAX_TOTAL_SECONDS}s limit` });
  }
  checkAudio(spec, dir, errors);
  checkCues(spec, errors);
  return { ok: errors.length === 0, errors };
}

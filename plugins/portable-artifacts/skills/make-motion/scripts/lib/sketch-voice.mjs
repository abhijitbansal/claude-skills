// Voice sync for hand-drawn scenes (pipeline step 1b, after the beats): a sketch scene whose audio track has a voice sidecar
// beside it (voice.mjs writes <name>.json next to <name>.wav) gets `narration`, [{ start, end }] in scene seconds, one per
// sentence, which the stroke plan lines the drawing up with; and a drawAt "sentence:<n>" becomes { sentence: n }. Everything
// comes from the sidecar and the spec, so the same files give the same frames. Called by resolveSpecBeats
// (beats-file.mjs), the one entry validateSpec, render, check and the preview server share. Node only (it reads files).
import { readFileSync, statSync } from 'node:fs';
import { pathJoin } from '../../shared/errors.mjs';
import { isSketchScene, SENTENCE_REF } from '../../template/sketch/style.mjs';
import { resolveSpecPath } from './paths.mjs';
import { sidecarPath } from './voice-sidecar.mjs'; // a leaf: not voice.mjs, which would pull the spec module and the model code in

export const MAX_SIDECAR_BYTES = 1024 * 1024;
export const MAX_SENTENCES = 2000;
export const MAX_SENTENCE_SECONDS = 86400; // a day: no time in a voice file is beyond it
const SECONDS_DECIMALS = 1e4;
const NOT_FOUND = /^file not found/;
// Ends the errors that say the file is no voice file at all (not JSON, not an object, no sentences list). Any .json beside a
// scene-bound .wav is read as its voice sidecar, so a stray one (a Whisper transcript) lands here and must be told why.
const NOT_VOICE_FILE = " That file sits beside the audio track, so it was read as the track's voice sidecar. If it is not one, rename or move it, or write the voice file with voice.mjs.";

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (t) => Math.round(t * SECONDS_DECIMALS) / SECONDS_DECIMALS;
const shown = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v));

// The first problem with the parsed contents of sidecar `name`, as a message that names it, or null. The file is untrusted
// content: every sentence needs finite seconds with start <= end, and the starts must not go backwards.
function problemWith(data, name) {
  if (!isPlain(data)) return `${name}: must be an object like { "sentences": [{ "start": 0, "end": 2.1 }] }.${NOT_VOICE_FILE}`;
  const { sentences } = data;
  if (!Array.isArray(sentences)) return `${name}: "sentences" must be an array like [{ "start": 0, "end": 2.1 }].${NOT_VOICE_FILE}`;
  if (sentences.length === 0) return `${name}: "sentences" has no sentences; the voice file says nothing`;
  if (sentences.length > MAX_SENTENCES) return `${name}: "sentences" lists ${sentences.length} sentences; at most ${MAX_SENTENCES}`;
  for (const [i, s] of sentences.entries()) {
    const at = `${name}: sentences[${i}]`;
    if (!isPlain(s)) return `${at} must be an object like { "start": 0, "end": 2.1 }`;
    if (!isNumber(s.start) || s.start < 0) return `${at}.start is ${shown(s.start)}; it must be a number of seconds, 0 or more`;
    if (!isNumber(s.end)) return `${at}.end is ${shown(s.end)}; it must be a number of seconds`;
    for (const key of ['start', 'end']) {
      if (s[key] > MAX_SENTENCE_SECONDS) return `${at}.${key} is ${s[key]}; a voice file may say ${MAX_SENTENCE_SECONDS} seconds at most`;
    }
    if (s.start > s.end) return `${at} ends (${s.end}) before it starts (${s.start})`;
    if (i > 0 && s.start < sentences[i - 1].start) return `${at}.start (${s.start}) comes before sentences[${i - 1}].start (${sentences[i - 1].start}); list the sentences in order`;
  }
  return null;
}

// The sidecar beside audio `src`: { name, file } for a file that exists, null when `src` has none (it is not a .wav, its own
// path is bad and checkAudio says so, or no sidecar sits beside it), else { name, error } for a sidecar that cannot be used.
function locateSidecar(src, dir) {
  const name = sidecarPath(src);
  if (name === src || resolveSpecPath(dir, src).error) return null;
  const { file, error } = resolveSpecPath(dir, name); // the same containment as every asset: inside the folder, no link out of it
  if (file) return { name, file };
  return NOT_FOUND.test(error) ? null : { name, error };
}

function readSentences({ name, file, error }) {
  if (error) return { error: `${name}: ${error}` };
  const { size } = statSync(file);
  if (size > MAX_SIDECAR_BYTES) return { error: `${name} is ${size} bytes; a voice file is at most ${MAX_SIDECAR_BYTES} bytes` };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `${name} is not valid JSON: ${e.message}.${NOT_VOICE_FILE}` };
  }
  const problem = problemWith(data, name);
  return problem ? { error: problem } : { sentences: data.sentences };
}

// What a scene's voice track gives it: { narration } in scene seconds, null for a scene with no voice track, or { skip: true }
// when the track cannot be read in time (a bad `at` is the schema's to report, once resolving is done).
function voiceOf(spec, scene, dir, errors) {
  const found = [];
  (Array.isArray(spec.audio) ? spec.audio : []).forEach((track, i) => {
    if (!isPlain(track) || track.scene !== scene.id || typeof track.src !== 'string') return;
    const sidecar = locateSidecar(track.src, dir);
    if (sidecar) found.push({ track, at: pathJoin(pathJoin('audio', i), 'src'), index: i, sidecar });
  });
  if (found.length === 0) return null;
  if (found.length > 1) {
    errors.push({ path: pathJoin(pathJoin('audio', found[1].index), 'src'), message: `scene "${scene.id}" has a second voice track; a drawn scene lines up with one (audio[${found[0].index}] is the first)` });
    return { skip: true };
  }
  const [{ track, at, sidecar }] = found;
  const read = readSentences(sidecar);
  if (read.error) {
    errors.push({ path: at, message: read.error });
    return { skip: true };
  }
  const start = track.at ?? 0;
  if (!isNumber(start)) return { skip: true };
  return { narration: read.sentences.map((s) => ({ start: round(start + s.start), end: round(start + s.end) })) };
}

/**
 * The voice files a spec may read, as it writes them: the sidecar name of every audio track that names a scene and is a .wav
 * (whether or not the file exists yet). The preview server watches them and render refuses an --out over one, as for the
 * beats file.
 */
export function voiceSidecars(spec) {
  const tracks = isPlain(spec) && Array.isArray(spec.audio) ? spec.audio : [];
  return tracks.filter((t) => isPlain(t) && t.scene !== undefined && typeof t.src === 'string' && sidecarPath(t.src) !== t.src).map((t) => sidecarPath(t.src));
}

const SHOWN_DIGITS = 12;

// The sentence `drawAt` points at, as a number (Infinity for digits beyond a double, which is past any narration), or
// undefined when it is no sentence reference.
function sentenceOf(drawAt) {
  if (typeof drawAt === 'string') {
    const match = SENTENCE_REF.exec(drawAt);
    return match ? Number(match[1]) : undefined;
  }
  return isPlain(drawAt) && Object.keys(drawAt).length === 1 && Number.isInteger(drawAt.sentence) && drawAt.sentence >= 0 ? drawAt.sentence : undefined;
}

// "sentence:<n>" for the messages, a number of any length cut short.
const refName = (drawAt) => {
  const n = typeof drawAt === 'string' ? SENTENCE_REF.exec(drawAt)[1] : String(drawAt.sentence);
  return `sentence:${n.length > SHOWN_DIGITS ? `${n.slice(0, SHOWN_DIGITS)}...` : n}`;
};

const NEEDS_VOICE = (scene) => `needs a voice track: an audio entry with "scene": "${scene}" whose file has a voice sidecar beside it (node scripts/voice.mjs writes one next to the .wav)`;

// `list` of elements with every sentence reference in a drawAt turned into { sentence: n } (the very same array when nothing
// changed), or an error at the field: no narration to point into, or a sentence past its end.
function resolveElements(list, at, scene, narration, errors) {
  if (!Array.isArray(list)) return list;
  const next = list.map((el, i) => {
    if (!isPlain(el)) return el;
    const here = pathJoin(at, i);
    const sentence = sentenceOf(el.drawAt);
    let out = el;
    if (sentence !== undefined && !narration) {
      errors.push({ path: pathJoin(here, 'drawAt'), message: `drawAt "${refName(el.drawAt)}" ${NEEDS_VOICE(scene.id)}` });
    } else if (sentence !== undefined && sentence >= narration.length) {
      errors.push({ path: pathJoin(here, 'drawAt'), message: `${refName(el.drawAt)} does not exist; the narration of scene "${scene.id}" has ${narration.length} sentence${narration.length === 1 ? '' : 's'} (0 to ${narration.length - 1})` });
    } else if (typeof el.drawAt === 'string' && sentence !== undefined) {
      out = { ...el, drawAt: { sentence } };
    }
    const children = resolveElements(el.children, pathJoin(here, 'children'), scene, narration, errors);
    return children === el.children ? out : { ...out, children };
  });
  return next.some((el, i) => el !== list[i]) ? next : list;
}

// The top-level elements are matched to the sentences in order, so their pins must not go backwards: an error at the drawAt
// that does, naming both pins. Equal pins are fine (those elements share that sentence onward). A reference already refused
// (no narration, past its end) is left to resolveElements.
function checkPinOrder(elements, at, narration, errors) {
  let last = null;
  (Array.isArray(elements) ? elements : []).forEach((el, i) => {
    const sentence = isPlain(el) ? sentenceOf(el.drawAt) : undefined;
    if (sentence === undefined || !narration || sentence >= narration.length) return;
    const here = pathJoin(at, i);
    if (last && sentence < last.sentence) {
      errors.push({ path: pathJoin(here, 'drawAt'), message: `${refName(el.drawAt)} comes before sentence:${last.sentence}, pinned on ${last.path}; pin the elements in the order of the narration` });
      return;
    }
    last = { sentence, path: here };
  });
}

const sameNarration = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveScene(spec, scene, si, dir, errors) {
  if (!isPlain(scene)) return scene;
  const base = pathJoin('scenes', si);
  const voice = isSketchScene(spec, scene) ? voiceOf(spec, scene, dir, errors) : null;
  if (voice?.skip) return scene;
  const narration = voice?.narration;
  // `narration` is the voice step's own field: a written one is refused unless it is exactly what the sidecar gives (a spec
  // that was already resolved, which render and check validate again).
  if (Object.hasOwn(scene, 'narration') && !sameNarration(scene.narration, narration)) {
    errors.push({ path: pathJoin(base, 'narration'), message: 'narration is set from the voice file beside the audio track, not written in the spec; remove it' });
  }
  const sketch = isSketchScene(spec, scene);
  const elements = sketch ? resolveElements(scene.elements, pathJoin(base, 'elements'), scene, narration, errors) : scene.elements;
  if (sketch) checkPinOrder(scene.elements, pathJoin(base, 'elements'), narration, errors);
  const withNarration = narration && !Object.hasOwn(scene, 'narration') ? { ...scene, narration } : scene;
  return elements === scene.elements ? withNarration : { ...withNarration, elements };
}

/**
 * `{ spec }` with, in every hand-drawn scene that has a voice track, `narration` set and each drawAt "sentence:<n>" replaced
 * by { sentence: n }, or `{ errors }` ([{ path, message }], the validator's shape): a voice file that cannot be used (at
 * `audio[i].src`, naming the file), a sentence reference with no voice track or past the last sentence, a second voice track
 * for a scene, a written `narration`. `dir`: the spec folder; the voice file follows the containment of every asset.
 * A spec with no voice track is returned as the same object; resolving a resolved spec changes nothing.
 */
export function resolveSketchVoice(spec, dir) {
  if (!isPlain(spec) || !Array.isArray(spec.scenes)) return { spec };
  const errors = [];
  const scenes = spec.scenes.map((scene, si) => resolveScene(spec, scene, si, dir, errors));
  if (errors.length) return { errors };
  return { spec: scenes.every((scene, i) => scene === spec.scenes[i]) ? spec : { ...spec, scenes } };
}

// The film validator's voice and sound fields (split out of spec.mjs, behaviour unchanged): the voice's two shapes and
// an author's own recording read inside the film's folder (voice { src, words }), the music's two shapes, and the film's
// own cue list. spec.mjs calls these from validateFilm and re-exports what other modules import.
import { accessSync, closeSync, constants as fsConstants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { ACCEPTED_VOICES } from './voice/kokoro.mjs';
import { RecordingWordsError, WHISPER_SHAPE, fromWhisper } from './voice/sidecar.mjs';
import { KNOWN_CUES } from './sound/synth.mjs';
import { BeatsFileError, readBeatsFile } from './sound/beats-file.mjs';
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { SpecError, errorCode, isPlainObject, quote, schemaErrors, srcProblem } from './spec-common.mjs';

export const CUES_MAX = 64;
const BPM_MIN = 60;
const BPM_MAX = 180;
/** The music beds a film may name: sound/bed.mjs BEDS, written out here because bed.mjs imports the validator (spec.test checks they agree). */
export const MUSIC_BEDS = Object.freeze(['pulse', 'drift', 'tape']);

// The film's voice: { name } (synthesised) or { src, words } (a recording of the user's own, with its word times).
export const VOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    src: { type: 'string', minLength: 1 },
    words: { type: 'string', minLength: 1 },
  },
};

// The film's music: { bed, bpm? } (a synthesised bed, sound/bed.mjs) or { src, beats?, snap? } (a file of the author's
// own; beats: the grid scripts/beats.mjs wrote for it, used instead of detecting one; snap: cuts moved onto its beats,
// sound/snap.mjs). checkMusic says which shape is meant; the music file is read when the sound is made, the beats file
// here.
export const MUSIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bed: { enum: [...MUSIC_BEDS] },
    bpm: { type: 'number', minimum: BPM_MIN, maximum: BPM_MAX },
    src: { type: 'string', minLength: 1 },
    beats: { type: 'string', minLength: 1 },
    snap: { type: 'boolean' },
  },
};

// One cue of the film's own list: `at` a number of seconds or an anchor across the film (sound/cues.mjs resolves it
// when the sound is made), `cue` a name the synth knows.
const CUE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'cue'],
  properties: {
    at: { type: ['number', 'string'] },
    cue: { enum: [...KNOWN_CUES] },
  },
};

// strict is off, as in spec.mjs.
const checkCueItem = new Ajv({ allErrors: true, strict: false, verbose: true }).compile(CUE_ITEM_SCHEMA);

const VOICE_SHAPES = 'use { "name": "af_heart" } to synthesise the narration, or { "src": "vo.wav", "words": "vo.json" } for a recording of your own with its word times';

// The voice's shape (one of the two) and its name. Unknown keys and wrong types are the schema's; the paths in
// { src, words } are read when that voice is built.
export function checkVoice(spec) {
  const { voice } = spec;
  if (!isPlainObject(voice)) return [];
  const keys = Object.keys(voice).filter((key) => Object.hasOwn(VOICE_SCHEMA.properties, key));
  if (keys.length < Object.keys(voice).length) return []; // an unknown key: the schema's did-you-mean says enough
  const own = keys.includes('src') || keys.includes('words');
  if (keys.length === 0) return [{ path: 'voice', message: `is empty; ${VOICE_SHAPES}` }];
  if (keys.includes('name') && own) return [{ path: 'voice', message: `has a name and a recording; ${VOICE_SHAPES}` }];
  if (own && !(keys.includes('src') && keys.includes('words'))) return [{ path: 'voice', message: `a recording needs both src and words; ${VOICE_SHAPES}` }];
  if (own || typeof voice.name !== 'string' || ACCEPTED_VOICES.includes(voice.name)) return [];
  const hint = didYouMean(voice.name, ACCEPTED_VOICES);
  const accepted = `${hint ? `did you mean "${hint}"? The` : 'the'} accepted voice is: ${ACCEPTED_VOICES.join(', ')}`;
  return [{ path: 'voice.name', message: `voice ${quote(voice.name)} is not available; ${accepted}` }];
}

// The film's own cues, the first CUES_MAX of them (the schema reports a longer list), each against CUE_ITEM_SCHEMA.
export function checkCueItems(spec) {
  if (!Array.isArray(spec.cues)) return [];
  return spec.cues.slice(0, CUES_MAX).flatMap((item, i) => schemaErrors(checkCueItem, item, pathJoin('cues', i)));
}

const MUSIC_SHAPES = 'use { "bed": "pulse" } (pulse, drift or tape, with an optional "bpm" from 60 to 180) for a synthesised bed, or { "src": "track.mp3" } for music of your own';

// The music's shape (one of the two); a file of the author's own must be inside the folder (as a recording is: its
// audio is probed when the sound is made). Unknown keys and wrong types are the schema's.
export function checkMusic(spec, specDir) {
  const { music } = spec;
  if (!isPlainObject(music)) return [];
  const keys = Object.keys(music);
  if (keys.some((key) => !Object.hasOwn(MUSIC_SCHEMA.properties, key))) return []; // the schema's did-you-mean says enough
  if (keys.length === 0) return [{ path: 'music', message: `is empty; ${MUSIC_SHAPES}` }];
  if (keys.includes('bed') && keys.includes('src')) return [{ path: 'music', message: `has a bed and a src; ${MUSIC_SHAPES}` }];
  if (keys.includes('bpm') && !keys.includes('bed')) return [{ path: 'music', message: `bpm sets the tempo of a bed; a file of your own keeps its own tempo. ${MUSIC_SHAPES}` }];
  if ((keys.includes('beats') || keys.includes('snap')) && !keys.includes('src')) {
    return [{ path: 'music', message: `beats and snap go with a music file of your own ({ "src": "track.mp3", "beats": "track.beats.json", "snap": true }); a bed already follows the cuts. ${MUSIC_SHAPES}` }];
  }
  if (typeof music.src !== 'string' || music.src === '') return [];
  const read = recordingFile(music.src, 'music.src', specDir);
  return [...(read.error ? [read.error] : []), ...beatsErrors(music, specDir), ...snapErrors(spec)];
}

// music.beats: the beats file inside the folder, of the right shape (sound/beats-file.mjs readBeatsFile).
function beatsErrors(music, specDir) {
  if (typeof music.beats !== 'string' || music.beats === '') return [];
  try {
    readBeatsFile(music.beats, specDir);
    return [];
  } catch (err) {
    if (!(err instanceof BeatsFileError)) throw err;
    return [{ path: 'music.beats', message: err.message }];
  }
}

// music.snap moves cuts, and a narrated film's cuts are where its words put them: snap needs a film with no say.
function snapErrors(spec) {
  if (spec.music.snap !== true || !Array.isArray(spec.shots)) return [];
  const narrated = spec.shots.findIndex((shot) => isPlainObject(shot) && typeof shot.say === 'string');
  if (narrated === -1) return [];
  return [{ path: 'music.snap', message: `snap moves cuts onto the music's beats, so it needs a film with no narration; shots[${narrated}] has a say, and a narrated film's cuts follow its words. Remove snap, or the narration` }];
}


// --- extra audio files: audio [{ src, at? }] ---

/** At most this many extra audio files: a sound effect or a second music file each, mixed under the voice. */
export const AUDIO_MAX = 20;
const AUDIO_ITEM_KEYS = Object.freeze(['src', 'at']);
export const AUDIO_SCHEMA = { type: 'array', maxItems: AUDIO_MAX };

// Each extra audio file: { src, at? } with src inside the folder, as a music file is checked (its audio is probed and
// measured when the sound is made), and at a number of seconds from the film's start, 0 or more.
export function checkAudio(spec, specDir) {
  if (!Array.isArray(spec.audio)) return [];
  return spec.audio.slice(0, AUDIO_MAX).flatMap((item, i) => {
    const at = pathJoin('audio', i);
    if (!isPlainObject(item)) return [{ path: at, message: 'must be { "src": "sting.wav", "at": 2.5 } (at: seconds from the film\'s start, default 0)' }];
    const unknown = Object.keys(item).find((k) => !AUDIO_ITEM_KEYS.includes(k));
    if (unknown) return [{ path: pathJoin(at, unknown), message: `unknown field; accepted: ${AUDIO_ITEM_KEYS.join(', ')}` }];
    if (item.at !== undefined && !(typeof item.at === 'number' && Number.isFinite(item.at) && item.at >= 0)) return [{ path: pathJoin(at, 'at'), message: `must be a number of seconds, 0 or more, got ${JSON.stringify(item.at)}` }];
    if (typeof item.src !== 'string' || item.src === '') return [{ path: pathJoin(at, 'src'), message: 'must be the path of an audio file in the film\'s folder, such as "sounds/sting.wav"' }];
    const read = recordingFile(item.src, pathJoin(at, 'src'), specDir);
    return read.error ? [read.error] : [];
  });
}

// --- an author's own recording: voice { src, words } ---

// A Whisper word-timestamp JSON for a long film runs to a few MB; past this it is not one, and reading it costs time.
export const WORDS_MAX_BYTES = 16 * 1024 * 1024;

export const isRecordingVoice = (voice) => isPlainObject(voice) && Object.keys(voice).length === 2
  && typeof voice.src === 'string' && voice.src !== '' && typeof voice.words === 'string' && voice.words !== '';

const notRegularMessage = (value) => `${quote(value)} is not a regular file (a FIFO, a device or another special file); name the file itself`;

// { real } (the file's real path, inside the spec folder, a regular file and readable) or { error } at `at`: the same
// rules as a picture's src (relative, inside the folder after links are followed, a file that exists), and never a FIFO
// or a device, which a reader would wait on. Exported for a user's music file (sound/bed.mjs musicInput), checked alike.
export function recordingFile(value, at, specDir) {
  const problem = srcProblem(value, specDir);
  if (problem) return { error: { path: at, message: problem } };
  try {
    const real = realpathSync(path.resolve(specDir, value));
    if (!statSync(real).isFile()) return { error: { path: at, message: notRegularMessage(value) } };
    accessSync(real, fsConstants.R_OK);
    return { real };
  } catch (err) {
    return { error: { path: at, message: `cannot read ${quote(value)}: ${errorCode(err)}` } };
  }
}

// The words file at `real` read through one descriptor, opened without blocking (a FIFO swapped in after the check is
// refused, not waited on), and never more than WORDS_MAX_BYTES + 1 bytes of it: { text } or { size } (over the cap) or
// { special: true }.
function readWords(real) {
  const fd = openSync(real, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { special: true };
    if (stat.size > WORDS_MAX_BYTES) return { size: stat.size };
    const buffer = Buffer.alloc(WORDS_MAX_BYTES + 1);
    let length = 0;
    let n;
    do {
      n = readSync(fd, buffer, length, buffer.length - length, null);
      length += n;
    } while (n > 0 && length < buffer.length);
    return length > WORDS_MAX_BYTES ? { size: length } : { text: buffer.toString('utf8', 0, length) };
  } finally {
    closeSync(fd);
  }
}

// The parsed words file at `real`, or { error } at voice.words.
function wordsJson(real, value) {
  const refused = (message) => ({ error: { path: 'voice.words', message } });
  try {
    const read = readWords(real);
    if (read.special) return refused(notRegularMessage(value));
    if (read.text === undefined) return refused(`${quote(value)} is ${read.size} bytes or more; a words file can be at most ${WORDS_MAX_BYTES} bytes`);
    return { json: JSON.parse(read.text) };
  } catch (err) {
    const why = err instanceof SyntaxError ? `is not valid JSON: ${err.message}` : `cannot be read: ${errorCode(err)}`;
    return refused(`${quote(value)} ${why}; it must be ${WHISPER_SHAPE}`);
  }
}

/**
 * A film's own recording, `voice: { src, words }` with paths relative to `specDir`: -> { src, sidecar }, `src` the
 * recording's real path (inside the folder, readable) and `sidecar` its words fitted to the film (voice/sidecar.mjs
 * fromWhisper: the words file is Whisper's word-timestamp JSON). Throws a SpecError at voice.src and voice.words for a
 * path that leaves the folder, a missing, unreadable or special (FIFO, device) file, a words file over WORDS_MAX_BYTES or
 * not JSON, or words that do not fit the film's says. The audio itself is not opened here: the voice stage probes it
 * (run.mjs, voice/master.mjs probeRecording) and the render decodes it.
 */
export function readRecording(spec, specDir) {
  const { src, words } = spec.voice;
  const audio = recordingFile(src, 'voice.src', specDir);
  const file = recordingFile(words, 'voice.words', specDir);
  const errors = [audio.error, file.error].filter(Boolean);
  let sidecar = null;
  const parsed = file.error ? null : wordsJson(file.real, words);
  if (parsed?.error) errors.push(parsed.error);
  if (parsed?.json !== undefined) {
    try {
      sidecar = fromWhisper(parsed.json, spec);
    } catch (err) {
      if (!(err instanceof RecordingWordsError)) throw err;
      errors.push({ path: err.path, message: err.message });
    }
  }
  if (errors.length > 0) throw new SpecError(errors);
  return { src: audio.real, sidecar };
}


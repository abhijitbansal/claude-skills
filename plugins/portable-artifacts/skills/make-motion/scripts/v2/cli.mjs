// The command line of scripts/make.mjs: strict flags, one film path, and a UsageError (exit 2) that says what is
// accepted. Pure: it reads nothing and touches no file.
import { parseCli, UsageError } from '../../shared/cli.mjs';
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';
import { MAX_WORKERS, autoWorkers } from './workers.mjs';

export const LIST_NAMES = Object.freeze(['kinds', 'looks', 'modes', 'devices', 'moves', 'cuts', 'fields', 'voices']);
export const FLAGS = Object.freeze(['--out', '--json', '--sheets-only', '--outline', '--list', '--exact', '--no-render', '--all', '--model', '--effort', '--agent', '--no-provenance', '--phonemes', '--poster', '--poster-out', '--batch', '--subtitles', '--workers']);
const USAGE = `node scripts/make.mjs <film.json>; accepted flags: ${FLAGS.join(', ')}; exit codes: 0 ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted`;
const OPTIONS = Object.freeze({
  out: { type: 'string' },
  json: { type: 'boolean' },
  'sheets-only': { type: 'boolean' },
  outline: { type: 'boolean' },
  list: { type: 'string' },
  exact: { type: 'boolean' },
  'no-render': { type: 'boolean' },
  all: { type: 'boolean' },
  model: { type: 'string' },
  effort: { type: 'string' },
  agent: { type: 'string' },
  'no-provenance': { type: 'boolean' },
  phonemes: { type: 'boolean' },
  poster: { type: 'string' },
  'poster-out': { type: 'string' },
  batch: { type: 'string' },
  subtitles: { type: 'string' },
  workers: { type: 'string' },
});
const SUBTITLE_FORMATS = Object.freeze(['srt', 'vtt']);
const POSTER_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png']);
// The flags each mode refuses beside it (a mode is a run that does one thing other than render).
const MODE_CONFLICTS = Object.freeze({
  phonemes: ['outline', 'out', 'no-render', 'sheets-only', 'poster', 'batch', 'subtitles'],
  poster: ['out', 'batch', 'no-render', 'sheets-only', 'outline', 'phonemes', 'subtitles'],
  batch: ['poster', 'outline', 'phonemes', 'subtitles'],
  subtitles: ['outline', 'phonemes', 'poster', 'batch'],
});
const BATCH_KEYS_RE = /\{(index|[a-zA-Z][a-zA-Z0-9]*)\}/;
const PROVENANCE_FLAGS = Object.freeze(['model', 'effort', 'agent']);

/** The version 1 flags version 2 does not take, each with what to do instead. */
export const REMOVED_FLAGS = Object.freeze({
  '--contact-sheet': 'sheets are written on every run; use --sheets-only for sheets alone',
  '--quality': 'use --preview for a quick look at the film (--sheets-only writes the stills alone)',
  '--fps': 'set fps and format in the film',
  '--size': 'set fps and format in the film',
  '--theme': 'a film has a look; see --list looks',
  '--loudness': "a film is mastered to its mode's level",
  '--true-peak': "a film is mastered to its mode's level",
});

// The flags whose value is the next argument when it is not joined with "=": that argument is a value, never a flag.
const VALUE_FLAGS = Object.freeze(Object.keys(OPTIONS).filter((name) => OPTIONS[name].type === 'string').map((name) => `--${name}`));

/** A usage error about a removed flag: `hint` is what to do instead, then the accepted flags. */
function removedFlagError(flag) {
  const hint = `${REMOVED_FLAGS[flag]}; usage: ${USAGE}`;
  return Object.assign(new UsageError(`${flag} is not a flag in version 2: ${hint}`), { flag, hint });
}

// The first removed flag in argv, or null. Stops at "--"; skips the value of a flag that takes one.
function findRemovedFlag(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') return null;
    if (VALUE_FLAGS.includes(arg)) { i++; continue; }
    const name = arg.split('=')[0];
    if (Object.hasOwn(REMOVED_FLAGS, name)) return name;
  }
  return null;
}

// The stamp flags as the run takes them (stamp.mjs): the given --model, --effort, --agent, each checked as the film's
// generatedBy field would be, and noProvenance. --no-provenance with any of the three contradicts itself.
function provenanceFlags(values) {
  const given = PROVENANCE_FLAGS.filter((name) => values[name] !== undefined);
  const noProvenance = values['no-provenance'] === true;
  if (noProvenance && given.length > 0) throw new UsageError(`--no-provenance leaves the stamp out, so it does not go with --${given.join(', --')}`);
  for (const name of given) {
    const rule = GENERATED_BY_SCHEMA.properties[name];
    if (values[name].length > rule.maxLength || !new RegExp(rule.pattern).test(values[name])) {
      throw new UsageError(`--${name} takes 1 to ${rule.maxLength} letters, digits, spaces and . _ : / ( ) + -; got ${JSON.stringify(values[name])}`);
    }
  }
  return { ...Object.fromEntries(given.map((name) => [name, values[name]])), noProvenance };
}

// A mode flag beside a flag it refuses (MODE_CONFLICTS) is a usage error.
function checkConflicts(values) {
  for (const [mode, refused] of Object.entries(MODE_CONFLICTS)) {
    if (values[mode] === undefined || values[mode] === false) continue;
    const clash = refused.find((name) => values[name] !== undefined && values[name] !== false);
    if (clash) throw new UsageError(`--${mode} does not go with --${clash}`);
  }
}

// --poster <seconds>: a plain non-negative number; --poster-out needs it and names a .jpg, .jpeg or .png file.
function posterFlags(values) {
  if (values['poster-out'] !== undefined && values.poster === undefined) throw new UsageError('--poster-out needs --poster <seconds>');
  if (values.poster === undefined) return { poster: null, posterOut: null };
  if (!/^\d+(\.\d+)?$/.test(values.poster)) throw new UsageError(`--poster takes a time in seconds from the film's start, such as 2.5; got ${JSON.stringify(values.poster)}`);
  const out = values['poster-out'];
  if (out !== undefined && !POSTER_EXTENSIONS.includes(out.slice(out.lastIndexOf('.')).toLowerCase())) {
    throw new UsageError(`--poster-out must name a ${POSTER_EXTENSIONS.join(', ')} file, got ${JSON.stringify(out)}`);
  }
  return { poster: Number(values.poster), posterOut: out ?? null };
}

// --workers <1-8 | auto> (default 1): the pages that capture the frames, in the run's one browser (workers.mjs).
function workersFlag(text) {
  if (text === undefined) return 1;
  if (text === 'auto') return autoWorkers();
  if (!/^[1-9]$/.test(text) || Number(text) > MAX_WORKERS) throw new UsageError(`--workers takes 1 to ${MAX_WORKERS} or auto; got ${JSON.stringify(text)}`);
  return Number(text);
}

// The mode flags: --phonemes, --poster (and --poster-out), --batch (with an --out template), --subtitles srt|vtt.
function modeFlags(values) {
  checkConflicts(values);
  if (values.batch !== undefined && (values.out === undefined || !BATCH_KEYS_RE.test(values.out))) {
    throw new UsageError('--batch needs --out with a {index} or {<var>} in it, such as --out "renders/{name}.mp4"');
  }
  if (values.subtitles !== undefined && !SUBTITLE_FORMATS.includes(values.subtitles)) {
    throw new UsageError(`--subtitles takes one of: ${SUBTITLE_FORMATS.join(', ')}; got ${JSON.stringify(values.subtitles)}`);
  }
  return { phonemes: values.phonemes === true, ...posterFlags(values), batch: values.batch ?? null, subtitles: values.subtitles ?? null, workers: workersFlag(values.workers) };
}

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ specPath: string | null, out: string | null, json: boolean, noRender: boolean, outline: boolean, list: string | null, exact: boolean, all: boolean,
 *   provenance: { model?: string, effort?: string, agent?: string, noProvenance: boolean }, phonemes: boolean,
 *   poster: number | null, posterOut: string | null, batch: string | null, subtitles: 'srt' | 'vtt' | null }}
 * @throws {UsageError} for a removed version 1 flag (with `hint`: what to do instead), an unknown or misspelled flag, a
 *   bad --list value, a missing or extra film path, an --out that is not .mp4, or a stamp flag that is refused
 */
export function parseMakeArgs(argv) {
  const removed = findRemovedFlag(argv);
  if (removed !== null) throw removedFlagError(removed);
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  const provenance = provenanceFlags(values);
  const modes = modeFlags(values);
  if (values.list !== undefined && !LIST_NAMES.includes(values.list)) {
    throw new UsageError(`--list takes one of: ${LIST_NAMES.join(', ')}; got "${values.list}"`);
  }
  if (values.all === true && values.list === undefined) throw new UsageError('--all only goes with --list (--list looks --all also shows the experimental looks, --list kinds --all the parked kinds)');
  if (values.list === undefined && positionals.length !== 1) {
    throw new UsageError(`give the path of one film .json file (got ${positionals.length}); usage: ${USAGE}`);
  }
  if (values.out !== undefined && !values.out.toLowerCase().endsWith('.mp4')) {
    throw new UsageError(`--out must name an .mp4 file, got "${values.out}"`);
  }
  return {
    specPath: positionals[0] ?? null,
    out: values.out ?? null,
    json: values.json === true,
    noRender: values['no-render'] === true || values['sheets-only'] === true,
    outline: values.outline === true,
    list: values.list ?? null,
    exact: values.exact === true,
    all: values.all === true,
    provenance,
    ...modes,
  };
}

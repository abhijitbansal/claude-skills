// The v2 load pipeline: read a film file, validate it, fill in the defaults and
// build its timeline. The CLI (a later task) turns a thrown Error into exit 2.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { SpecError, validateFilm, withFilmDefaults } from './spec.mjs';
import { prepareFilm } from './prepare/index.mjs';
import { substitute } from './vars.mjs';

// A film is a short script; a file past this size is not one, and parsing it would only cost time.
export const MAX_FILM_BYTES = 1024 * 1024;

const unreadable = (specPath, err) => new Error(`cannot read ${specPath}: ${err.code ?? err.message}`);

/** The parsed JSON of a film file (at most MAX_FILM_BYTES, a regular file), or an Error naming the path. */
export function readFilmFile(specPath) {
  let stat;
  try {
    stat = statSync(specPath);
  } catch (err) {
    throw unreadable(specPath, err);
  }
  // Only a regular file has a size to check: a FIFO or device would be read without end.
  if (!stat.isFile()) throw new Error(`${specPath} is not a regular file; give the path of a film .json file`);
  if (stat.size > MAX_FILM_BYTES) {
    throw new Error(`${specPath} is ${stat.size} bytes; a film file can be at most 1 MB (${MAX_FILM_BYTES} bytes)`);
  }
  let raw;
  try {
    raw = readFileSync(specPath, 'utf8');
  } catch (err) {
    throw unreadable(specPath, err);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${specPath} is not valid JSON: ${err.message}`);
  }
}

// loadFilm(specPath, { registries? }) -> { film, timeline, specDir, prepared, timingJudged }.
// Throws SpecError (carrying `errors`) for an invalid film, and a plain Error
// naming the path for a file that cannot be read or parsed.
// timingJudged is false for a film with a voice: its timeline here is the
// estimate, and the checks that depend on where its words fall (each anchor
// inside its shot, the kind rules that resolve anchors) were not run; they
// belong to its measured timeline (spec.mjs timedAnchorErrors, which make.mjs
// runs after the voice stage). True for a film without one: all were run.
// `prepared`: the data of the shots whose kinds need a Node-only library (scripts/v2/prepare), by shot id; a preparer's
// problems are the film's, thrown as a SpecError with the validation errors' paths.
// `values`: the film's vars (vars.mjs substitute, before validation; a var left out takes its default).
export function loadFilm(specPath, { registries = defaultRegistries, values = {} } = {}) {
  const raw = readFilmFile(specPath);
  // Only a version 2 film is substituted: anything else gets the validator's own message (a version 1 spec's says what to do).
  const spec = raw?.version === 2 && typeof raw === 'object' && !Array.isArray(raw) ? substitute(raw, values) : raw;
  const specDir = path.dirname(path.resolve(specPath));
  const { ok, errors } = validateFilm(spec, { specDir, registries });
  if (!ok) throw new SpecError(errors);
  const film = withFilmDefaults(spec, registries);
  const { prepared, problems } = prepareFilm(film, { filmDir: specDir, kinds: registries.kinds });
  if (problems.length > 0) throw new SpecError(problems);
  const timeline = buildTimeline(film, { fps: film.fps, modes: registries.modes });
  return { film, timeline, specDir, prepared, timingJudged: film.voice === undefined };
}

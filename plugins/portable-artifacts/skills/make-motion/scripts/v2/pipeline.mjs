// The v2 load pipeline: read a film file, validate it, fill in the defaults and
// build its timeline. The CLI (a later task) turns a thrown Error into exit 2.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { SpecError, validateFilm, withFilmDefaults } from './spec.mjs';

// A film is a short script; a file past this size is not one, and parsing it would only cost time.
export const MAX_FILM_BYTES = 1024 * 1024;

const unreadable = (specPath, err) => new Error(`cannot read ${specPath}: ${err.code ?? err.message}`);

function readFilmFile(specPath) {
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

// loadFilm(specPath, { registries? }) -> { film, timeline, specDir }.
// Throws SpecError (carrying `errors`) for an invalid film, and a plain Error
// naming the path for a file that cannot be read or parsed.
export function loadFilm(specPath, { registries = defaultRegistries } = {}) {
  const spec = readFilmFile(specPath);
  const specDir = path.dirname(path.resolve(specPath));
  const { ok, errors } = validateFilm(spec, { specDir, registries });
  if (!ok) throw new SpecError(errors);
  const film = withFilmDefaults(spec, registries);
  const timeline = buildTimeline(film, { fps: film.fps });
  return { film, timeline, specDir };
}

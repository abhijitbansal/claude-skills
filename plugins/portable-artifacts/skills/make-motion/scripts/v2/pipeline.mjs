// The v2 load pipeline: read a film file, validate it, fill in the defaults and
// build its timeline. The CLI (a later task) turns a thrown Error into exit 2.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { SpecError, validateFilm, withFilmDefaults } from './spec.mjs';

function readFilmFile(specPath) {
  let raw;
  try {
    raw = readFileSync(specPath, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${specPath}: ${err.code ?? err.message}`);
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

// What the schema cannot say about a `lottie` element (spec.mjs runs it with the other element checks): its `src` follows
// the asset path rules (relative, inside the spec folder, no symlink out, no dotfile), is a Lottie JSON file under the
// size cap, and passes lottieProblems (template/lottie-guard.mjs), the same check the page runs before lottie-web sees it.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathJoin } from '../../shared/errors.mjs';
import { resolveSpecPath } from './paths.mjs';
import { lottieProblems, MAX_LOTTIE_BYTES } from '../../template/lottie-guard.mjs';

const SHOWN_PROBLEMS = 5; // a file with more gets a line that counts the rest
const MIB = 1024 * 1024;

/** Pushes the errors of lottie element `el` at `base` (its path) onto `errors`; `dir` is the spec folder. */
export function checkLottie(el, base, dir, errors) {
  const fail = (message) => errors.push({ path: pathJoin(base, 'src'), message });
  const { file, error } = resolveSpecPath(dir, el.src);
  if (error) return fail(error);
  const ext = path.extname(el.src).toLowerCase();
  if (ext === '.lottie') return fail('a .lottie archive is not supported; export the animation as Lottie JSON (.json)');
  if (ext !== '.json') return fail(`unsupported lottie format "${path.extname(el.src)}"; use a Lottie JSON file (.json)`);
  const { size } = statSync(file);
  if (size > MAX_LOTTIE_BYTES) return fail(`${el.src} is ${size} bytes; a Lottie file may be at most ${MAX_LOTTIE_BYTES} bytes (${MAX_LOTTIE_BYTES / MIB} MiB)`);
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); // a byte-order mark, as the page's TextDecoder drops it
  } catch (e) {
    return fail(`${el.src} is not valid JSON: ${e.message}`);
  }
  const problems = lottieProblems(json);
  for (const p of problems.slice(0, SHOWN_PROBLEMS)) fail(`${p.path}: ${p.message} (in ${el.src})`);
  if (problems.length > SHOWN_PROBLEMS) fail(`and ${problems.length - SHOWN_PROBLEMS} more problems in ${el.src}`);
  return undefined;
}

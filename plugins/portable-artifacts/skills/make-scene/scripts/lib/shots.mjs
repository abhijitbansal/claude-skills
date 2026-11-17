// What --shots takes and what it calls the files. Pure (no browser). A still is the whole page at one width in one
// colour scheme; the beat frames walk the tour at the widest width in the light scheme (check.mjs), so a reader can
// see that each beat's camera lands on what its caption names.
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';
import { slugify } from '../../shared/output.mjs';

export const SCHEMES = ['light', 'dark'];
const FALLBACK_SLUG = 'scene';

/** The folder named by --shots, resolved; null when the flag is absent. */
export function parseShotsDir(value) {
  if (value === undefined) return null;
  if (String(value).trim() === '') throw new UsageError('--shots needs a folder to write the PNGs to (for example --shots .scratch/shots)');
  return path.resolve(value);
}

/** <page>-<width>-<scheme>[-beat-NN].png */
export function shotName(file, { width, scheme, beat }) {
  const slug = slugify(path.basename(file).replace(/\.html?$/i, ''), FALLBACK_SLUG);
  return `${slug}-${width}-${scheme}${beat === undefined ? '' : `-beat-${String(beat).padStart(2, '0')}`}.png`;
}

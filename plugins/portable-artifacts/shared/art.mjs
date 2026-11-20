// Seeded procedural art: artSvg() returns one inline <svg> string drawn in a
// theme's own tokens. Pure and dependency-free: no Math.random, no Date, so the
// same arguments always give the same bytes (Math.sin/cos are rounded to 0.1,
// which keeps output stable across V8 versions in practice, not by spec).
// One style per theme, one module per style under shared/art/ (shared pieces in
// art/pieces.mjs). dusk, press and poster are ported from the three specimen
// sheets: dusk = grainy blobs, duotone orbs and wave bands; press = halftone
// screens and contour lines in overprint; poster = halftone gradient, grid warp
// and registration marks.
//
// Safety contract: the output has no script, no foreignObject, no href and no
// external url(); the only colours interpolated are #rrggbb tokens checked by
// assertHex; the seed text is only ever hashed, never written out. The root
// carries the SVG namespace (a name, not a reference) so the string also works
// in <img>, data: URIs, CSS backgrounds, canvas and as a saved .svg file.
// Ids are unique per argument set: inlining the exact same call twice on one
// page duplicates its ids (harmless, identical defs), so vary the seed if a
// page shows one title twice and you need distinct ids.
import { loadTheme, ThemeError } from './theme.mjs';
import { assertHex, seedFrom, mulberry32, f, grain } from './art/pieces.mjs';
import { dusk } from './art/dusk.mjs';
import { press } from './art/press.mjs';
import { poster } from './art/poster.mjs';
import { paper } from './art/paper.mjs';
import { ink } from './art/ink.mjs';
import { blueprint } from './art/blueprint.mjs';
import { mono } from './art/mono.mjs';
import { brief } from './art/brief.mjs';
import { editorial } from './art/editorial.mjs';

export { ThemeError, assertHex, seedFrom };

// paper = ruled sheet and folds; ink = brush washes; blueprint = drafting grid and dimensions; mono = dot-matrix
// raster; brief = memo tabs and rules; editorial = column rules and a fleuron.
const GENERATORS = { dusk, press, poster, paper, ink, blueprint, mono, brief, editorial };

// Theme name -> style: one per shipped theme. A theme file added later without its own style falls back to press,
// whose print look reads well in any palette.
export const ART_STYLES = Object.freeze(Object.fromEntries(Object.keys(GENERATORS).map((k) => [k, k])));
const FALLBACK_STYLE = 'press';
const MODES = ['light', 'dark'];
const MIN_SIZE = 16;
const MAX_SIZE = 8192;
const XMLNS = 'http://www.w3.org/2000/svg';

function size(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${typeof value === 'number' ? String(value) : JSON.stringify(value) ?? String(value)}`);
  }
  if (value < MIN_SIZE || value > MAX_SIZE) {
    throw new RangeError(`${name} must be between ${MIN_SIZE} and ${MAX_SIZE}, got ${String(value)}`);
  }
  return value;
}

// mode defaults to 'dark': the dusk and poster specimens are dark-first.
export function artSvg({ theme, seed, width, height, mode = 'dark' } = {}) {
  const tokens = loadTheme(theme);
  if (!MODES.includes(mode)) throw new TypeError(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(mode)}`);
  const W = size('width', width);
  const H = size('height', height);
  const seedInt = seedFrom(seed);
  const style = Object.hasOwn(ART_STYLES, theme) ? ART_STYLES[theme] : FALLBACK_STYLE;
  const c = Object.fromEntries(Object.entries(tokens[mode]).map(([k, v]) => [k, assertHex(v, k)]));
  // ids: a letter, then a hash of every argument, so two different pieces on
  // one page never share an id (identical pieces have identical defs anyway).
  const prefix = `a${seedFrom(`${style}|${theme}|${mode}|${W}x${H}|${seed}`).toString(36)}-`;
  const ctx = {
    W, H, S: Math.min(W, H), L: Math.max(W, H), c, mode, seedInt,
    r: mulberry32(seedInt), blend: mode === 'light' ? 'multiply' : 'screen',
    id: (name) => prefix + name,
    // seq ramps run page -> contrast in both modes, so mirror them to keep
    // "tone(n)" meaning the same hue family: dark seqN is light seq(7-N).
    tone: (n) => assertHex(c[`seq${mode === 'dark' ? n : 7 - n}`], `tone(${n})`),
  };
  const art = GENERATORS[style](ctx);
  const g = grain(ctx, art.grain);
  return `<svg xmlns="${XMLNS}" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-art="${style}" style="isolation:isolate">`
    + `<defs>${art.defs}${g.defs}</defs>${art.body}${g.layer}</svg>`;
}

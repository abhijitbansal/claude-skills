// The deck's art for its title and closing slides. shared/art.mjs draws one landscape picture per theme; the deck
// builds on it and changes these things (each has a test in test/deck-art.test.mjs or test/deck-polish.test.mjs):
//  - the six classic themes also get a portrait picture, shown on a phone (a 16:9 drawing under `slice` shows a
//    narrow strip of its middle, so its shapes are cropped mid-stroke);
//  - paper's pen ticks are placed on an even column instead of at random, so two never overlap; its dark crease is a
//    shadow, not a glowing band;
//  - brief is a stamped memo (tabs, a header rule, ruled lines, a stamp with its word) instead of rows of grey bars,
//    which read as a loading skeleton;
//  - editorial is a masthead, column hairlines and one fleuron, with no set lines (they read as a loading skeleton too);
//  - ink's brush strokes are drawn in a margin the title and closing cards never reach, so no stroke is cut by a card;
//  - poster keeps only its top registration mark (the bottom one ended under the colophon); mono's dark field is dimmed.
// shared/ is a synced copy in every skill, so these live here and call into it. Output is pure: same arguments, same bytes.
import { artSvg } from '../../shared/art.mjs';
import { loadTheme } from '../../shared/theme.mjs';
import { TAU, f, fi, assertHex, seedFrom, mulberry32, grain, bounded, ring } from '../../shared/art/pieces.mjs';

export const WIDE = Object.freeze({ width: 1920, height: 1080 });
export const TALL = Object.freeze({ width: 1080, height: 1920 });
// The six themes whose deck draws on the classic layout (no flavor stylesheet): their title card is feathered and
// they get the portrait picture. dusk, press and poster keep their own cards and their one picture.
export const CLASSIC_ART_THEMES = Object.freeze(['blueprint', 'brief', 'editorial', 'ink', 'mono', 'paper']);
const MODES = ['light', 'dark'];
const XMLNS = 'http://www.w3.org/2000/svg';

// paper: the shared generator draws its ticks as the one path with round joins; swap it for an even column in the
// gutter left of the margin rule. Fails loudly when the shared art changes shape, so this cannot go stale unseen.
const SHARED_TICKS = /<path d="[^"]*" fill="none" stroke="(#[0-9a-f]{6})" stroke-width="[^"]*" stroke-linecap="round" stroke-linejoin="round" opacity="\.8"\/>/;
const TICKS = 4;

function evenTicks(svg, W, H, S) {
  const shared = SHARED_TICKS.exec(svg);
  const margin = /<path d="M(\d+) 0V\d+" stroke="#[0-9a-f]{6}"/.exec(svg);
  if (!shared || !margin) throw new Error('deck-art: the shared paper art changed shape (ticks or margin rule not found); update deck-art.mjs');
  const u = S * 0.03;
  const x = Number(margin[1]) + u * 1.2; // just inside the margin rule: the portrait picture's outer 7% is cropped on a phone
  const gap = H / (TICKS + 1);
  let d = '';
  for (let i = 1; i <= TICKS; i++) d += `M${fi(x)} ${fi(gap * i)}l${fi(u * 0.4)} ${fi(u * 0.45)}l${fi(u * 0.9)} ${fi(-u)}`;
  const sw = f(Math.max(1, S / 260));
  return svg.replace(SHARED_TICKS, `<path data-art-part="ticks" d="${d}" fill="none" stroke="${shared[1]}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`);
}

function paperSvg(theme, seed, size, mode) {
  return evenTicks(artSvg({ theme, seed, ...size, mode }), size.width, size.height, Math.min(size.width, size.height));
}

// ---- brief ---------------------------------------------------------------------------------------------------

const MAX_TABS = 6;

function tabs(ctx, tabH, chosen) {
  const { c, W, S } = ctx;
  const n = bounded(W, S * 0.7, MAX_TABS);
  const tw = W / (n + 0.6);
  const fills = [c.surface3, c.surface2, c.surface];
  const w = f(Math.max(1, S / 600));
  const pick = chosen % n;
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = tw * 0.3 + i * tw;
    const slant = tw * 0.08;
    const up = i === pick ? tabH : tabH * 0.8;
    const y = tabH - up;
    out += `<path d="M${fi(x)} ${fi(tabH)}L${fi(x + slant)} ${fi(y)}H${fi(x + tw * 0.9 - slant)}L${fi(x + tw * 0.9)} ${fi(tabH)}Z" fill="${i === pick ? c.surface : fills[i % 2]}" stroke="${c.line}" stroke-width="${w}"/>`;
    if (i === pick) out += `<rect x="${fi(x + slant)}" y="${fi(y)}" width="${fi(tw * 0.9 - 2 * slant)}" height="${fi(Math.max(1, tabH * 0.12))}" fill="${c.accent}"/>`;
  }
  return out;
}

// A double-ruled stamp, tilted, in the accent: the memo's "received" mark, with its word (an empty frame reads as an
// empty input field).
const STAMP_WORD = 'FILED';
function stamp(ctx, cx, cy) {
  const { c, S } = ctx;
  const w = S * 0.22;
  const h = S * 0.1;
  const sw = Math.max(2, S / 200);
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `<g data-art-part="stamp" transform="rotate(-8 ${fi(cx)} ${fi(cy)})" fill="none" stroke="${c.accent}" opacity=".75">`
    + `<rect x="${fi(x)}" y="${fi(y)}" width="${fi(w)}" height="${fi(h)}" stroke-width="${f(sw)}"/>`
    + `<rect x="${fi(x + sw * 3)}" y="${fi(y + sw * 3)}" width="${fi(w - sw * 6)}" height="${fi(h - sw * 6)}" stroke-width="${f(sw / 2)}"/>`
    + `<text x="${fi(cx)}" y="${fi(cy)}" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" font-size="${fi(h * 0.46)}" letter-spacing="${f(h * 0.06)}" fill="${c.accent}" stroke="none">${STAMP_WORD}</text></g>`;
}

function briefSvg(theme, seed, size, mode) {
  const tokens = loadTheme(theme);
  const { width: W, height: H } = size;
  const S = Math.min(W, H);
  const seedInt = seedFrom(`brief|${theme}|${mode}|${W}x${H}|${seed}`);
  const c = Object.fromEntries(Object.entries(tokens[mode]).map(([k, v]) => [k, assertHex(v, k)]));
  const ctx = { W, H, S, c, mode, seedInt, id: (name) => `b${seedInt.toString(36)}-${name}` };
  const tabH = Math.max(6, S * 0.1);
  const pitch = Math.max(12, S / 11);
  const sw = f(Math.max(1, S / 600));
  const sheet = `<rect x="0" y="${fi(tabH)}" width="${f(W)}" height="${fi(Math.max(1, H - tabH))}" fill="${c.surface}" stroke="${c.line}" stroke-width="${sw}"/>`;
  // ruled lines below the header rule
  const band = tabH + pitch * 0.3; // high on the sheet, above where the centred title card starts
  let ruled = '';
  for (let y = band + pitch * 1.4; y < H - pitch * 0.5; y += pitch) ruled += `M0 ${fi(y)}H${fi(W)}`;
  // The title and closing cards sit in the middle and hide what is under them, so the memo's marks stand in the
  // free margins: the stamp at the right (landscape) or low in the middle (portrait).
  const wide = W > H;
  const header = `<path d="M${fi(W * 0.05)} ${fi(band + S * 0.06)}H${fi(W * 0.95)}" stroke="${c.text3}" stroke-width="${sw}" opacity=".6"/>`;
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${tabs(ctx, tabH, seedInt)}${sheet}`
    + `<path d="${ruled}" fill="none" stroke="${c.line}" stroke-width="${sw}"/>${header}${wide ? stamp(ctx, W * 0.88, H * 0.55) : stamp(ctx, W * 0.5, H * 0.78)}`;
  const g = grain(ctx, 0.18);
  return `<svg xmlns="${XMLNS}" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-art="brief" style="isolation:isolate"><defs>${g.defs}</defs>${body}${g.layer}</svg>`;
}

// ---- editorial -----------------------------------------------------------------------------------------------
// A masthead (a thick and a thin rule broken by one fleuron) and hairlines between the columns. No set lines: rows of
// grey bars read as a loading skeleton, the look the brief calls a failure.

const MAX_COLUMNS = 5;
const MIN_COLUMNS = 3;

function fleuron(ctx, cx, cy) {
  const { c, S } = ctx;
  const rad = S * 0.032;
  const petals = ring(cx, cy, rad, (t) => 0.35 + 0.65 * Math.abs(Math.cos(2 * t + TAU / 8)), 32);
  const reach = rad * 3.2;
  const w = f(Math.max(1, S / 400));
  return `<g data-art-part="fleuron"><rect x="${fi(cx - reach * 1.15)}" y="${fi(cy - rad * 1.4)}" width="${fi(reach * 2.3)}" height="${fi(rad * 2.8)}" fill="${c.page}"/>`
    + `<path d="${petals}" fill="${c.accent}"/><circle cx="${fi(cx)}" cy="${fi(cy)}" r="${f(rad * 0.22)}" fill="${c.page}"/>`
    + `<path d="M${fi(cx - reach)} ${fi(cy)}H${fi(cx - rad * 1.3)}M${fi(cx + rad * 1.3)} ${fi(cy)}H${fi(cx + reach)}" stroke="${c.accent}" stroke-width="${w}"/></g>`;
}

function editorialSvg(theme, seed, size, mode) {
  const tokens = loadTheme(theme);
  const { width: W, height: H } = size;
  const S = Math.min(W, H);
  const seedInt = seedFrom(`editorial|${theme}|${mode}|${W}x${H}|${seed}`);
  const c = Object.fromEntries(Object.entries(tokens[mode]).map(([k, v]) => [k, assertHex(v, k)]));
  const ctx = { W, H, S, c, mode, seedInt, id: (name) => `e${seedInt.toString(36)}-${name}` };
  const m = W * 0.06;
  const y0 = Math.max(4, S * 0.08);
  const thin = y0 + Math.max(4, S / 45);
  const masthead = `<g data-art-part="masthead"><rect x="${fi(m)}" y="${fi(y0)}" width="${fi(W - 2 * m)}" height="${f(Math.max(1.5, S / 120))}" fill="${c.text}"/>`
    + `<rect x="${fi(m)}" y="${fi(thin)}" width="${fi(W - 2 * m)}" height="${f(Math.max(1, S / 500))}" fill="${c.text}"/></g>`;
  const k = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(W / (S * 0.36))));
  const cw = (W - 2 * m) / k;
  const top = thin + S * 0.05;
  let rules = '';
  // a wide picture also rules both outer edges of the page; a tall one's edges are cropped on a phone
  for (let j = W > H ? 0 : 1; j <= (W > H ? k : k - 1); j++) rules += `M${fi(m + j * cw)} ${fi(top)}V${fi(H - S * 0.07)}`;
  const columnRules = `<path data-art-part="column-rules" d="${rules}" fill="none" stroke="${c.line}" stroke-width="${f(Math.max(1, S / 600))}"/>`;
  const body = `<rect width="${f(W)}" height="${f(H)}" fill="${c.page}"/>${columnRules}${masthead}${fleuron(ctx, W / 2, (y0 + thin) / 2)}`;
  const g = grain(ctx, 0.2);
  return `<svg xmlns="${XMLNS}" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-art="editorial" style="isolation:isolate"><defs>${g.defs}</defs>${body}${g.layer}</svg>`;
}

// ---- ink -----------------------------------------------------------------------------------------------------
// The shared art lays its brush strokes anywhere, so the card (solid ground with a feather) cut them mid-stroke: a flat
// edge, a stranded wedge. Here the washes stay as drawn and the strokes are redrawn in a margin the cards never
// reach: down the right edge of a wide picture, along the top of a tall one.

const SHARED_STROKES = /<g fill="(#[0-9a-f]{6})" opacity="\.82">(?:<path d="[^"]*"\/>)+<\/g><g fill="#[0-9a-f]{6}" opacity="\.6">(?:<circle [^>]*\/>)+<\/g>/;
const STROKE_SAMPLES = 24;

// One stroke as a filled outline that swells and tapers, roughened by a seeded wobble.
function brush(r, x0, y0, ang, len, bend, w0) {
  const phase = r() * TAU;
  const top = [];
  const bottom = [];
  for (let i = 0; i <= STROKE_SAMPLES; i++) {
    const t = i / STROKE_SAMPLES;
    const off = Math.sin(t * Math.PI) * bend;
    const x = x0 + Math.cos(ang) * t * len - Math.sin(ang) * off;
    const y = y0 + Math.sin(ang) * t * len + Math.cos(ang) * off;
    const w = w0 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6 * (0.85 + 0.2 * Math.sin(t * 9 + phase));
    top.push(`${fi(x - Math.sin(ang) * w)} ${fi(y + Math.cos(ang) * w)}`);
    bottom.unshift(`${fi(x + Math.sin(ang) * w)} ${fi(y - Math.cos(ang) * w)}`);
  }
  return { d: `M${top.join('L')}L${bottom.join('L')}Z`, end: [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len] };
}

function inkStrokes(seed, size, mode, ink) {
  const { width: W, height: H } = size;
  const S = Math.min(W, H);
  const r = mulberry32(seedFrom(`ink-strokes|${mode}|${W}x${H}|${seed}`));
  const jitter = (n) => (r() - 0.5) * n;
  const wide = W > H;
  const plan = wide
    ? [[W * (0.93 + r() * 0.01), H * (0.12 + r() * 0.04), Math.PI / 2 + 0.2 + jitter(0.08), H * 0.44, S * 0.03 * (r() < 0.5 ? -1 : 1), S * 0.026],
      [W * (0.925 + r() * 0.008), H * (0.6 + r() * 0.04), Math.PI / 2 + 0.2 + jitter(0.08), H * 0.28, S * 0.02 * (r() < 0.5 ? -1 : 1), S * 0.02]]
    : [[W * (0.1 + r() * 0.05), H * (0.055 + r() * 0.015), jitter(0.1), W * 0.62, S * 0.02 * (r() < 0.5 ? -1 : 1), S * 0.022]];
  let paths = '';
  let specks = '';
  for (const [x0, y0, ang, len, bend, w0] of plan) {
    const s = brush(r, x0, y0, ang, len, bend, w0);
    paths += `<path d="${s.d}"/>`;
    for (let i = 0; i < 8 + Math.floor(r() * 8); i++) {
      const a = r() * TAU;
      const dist = S * (0.015 + r() * 0.04);
      specks += `<circle cx="${fi(s.end[0] + Math.cos(a) * dist)}" cy="${fi(s.end[1] + Math.sin(a) * dist)}" r="${f(Math.max(0.6, S * (0.002 + r() * 0.006)))}"/>`;
    }
  }
  return `<g fill="${ink}" opacity=".82">${paths}</g><g fill="${ink}" opacity=".6">${specks}</g>`;
}

function inkSvg(theme, seed, size, mode) {
  const svg = artSvg({ theme, seed, ...size, mode });
  const shared = SHARED_STROKES.exec(svg);
  if (!shared) throw new Error('deck-art: the shared ink art changed shape (strokes not found); update deck-art.mjs');
  return svg.replace(SHARED_STROKES, inkStrokes(seed, size, mode, shared[1]));
}

// ---- small fixes to the shared pictures ----------------------------------------------------------------------------

// paper, dark: the crease is the text colour (light) at low opacity, which glows as a grey band on a dark sheet. Make it
// a shadow: black, a little stronger so it still reads.
function darkCrease(svg, theme) {
  const text = loadTheme(theme).dark.text;
  const stop = new RegExp(`(<stop offset="[^"]*" stop-color=")${text}(" stop-opacity=")`, 'g');
  if (!stop.test(svg)) throw new Error('deck-art: the shared paper crease changed shape; update deck-art.mjs');
  return svg.replace(stop, '$1#000000$2').replace(/stop-opacity="0\.18"/g, 'stop-opacity="0.35"');
}

// poster: the shared art's registration marks sit top and bottom centre; the bottom one ended under the colophon and
// the controls bar. Only the top one stays.
const REGISTRATION = /<g fill="none" stroke="#[0-9a-f]{6}" stroke-width="[^"]*"><circle [^>]*\/><circle [^>]*\/><path d="M[^"]*H[^"]*M[^"]*V[^"]*"\/><\/g>/g;
function topMarkOnly(svg) {
  const marks = svg.match(REGISTRATION) ?? [];
  if (marks.length !== 2) throw new Error('deck-art: the shared poster art changed shape (expected two registration marks); update deck-art.mjs');
  return svg.replace(marks[1], '');
}

// mono, dark: the bright squares against the page-coloured card halo showed as a darker panel; dimmed, the edge is not seen.
const MONO_DARK_OPACITY = 0.4;

// ---- one picture per (mode, size) ---------------------------------------------------------------------------------

function drawing(theme, seed, size, mode) {
  if (theme === 'paper') {
    const svg = paperSvg(theme, seed, size, mode);
    return mode === 'dark' ? darkCrease(svg, theme) : svg;
  }
  if (theme === 'brief') return briefSvg(theme, seed, size, mode);
  if (theme === 'editorial') return editorialSvg(theme, seed, size, mode);
  if (theme === 'ink') return inkSvg(theme, seed, size, mode);
  const svg = artSvg({ theme, seed, ...size, mode });
  if (theme === 'poster') return topMarkOnly(svg);
  if (theme === 'mono' && mode === 'dark') return svg.replace('style="isolation:isolate"', `style="isolation:isolate;opacity:${MONO_DARK_OPACITY}"`);
  return svg;
}

const tag = (svg, cls) => svg.replace(/^<svg /, `<svg class="${cls}" `);

/**
 * The deck art for one slide: the classic themes' four pictures (light, dark; wide, tall) or the flavored themes'
 * two (light, dark). `class` lets the deck stylesheet pick one by colour mode and orientation.
 */
export function deckArtPair(theme, seed) {
  if (!CLASSIC_ART_THEMES.includes(theme)) return MODES.map((mode) => tag(drawing(theme, seed, WIDE, mode), `art-${mode}`)).join('');
  const out = [];
  for (const [shape, size] of [['wide', WIDE], ['tall', TALL]]) {
    for (const mode of MODES) out.push(tag(drawing(theme, `${seed}${shape === 'tall' ? '|tall' : ''}`, size, mode), `art-${mode} art-${shape}`));
  }
  return out.join('');
}

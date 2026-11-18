// The deck's art for its title and closing slides. shared/art.mjs draws one landscape picture per theme; the deck
// builds on it and changes four things (each has a test in test/deck-art.test.mjs):
//  - the six classic themes also get a portrait picture, shown on a phone (a 16:9 drawing under `slice` shows a
//    narrow strip of its middle, so its shapes are cropped mid-stroke);
//  - paper's pen ticks are placed on an even column instead of at random, so two never overlap;
//  - brief is a stamped memo (tabs, a header rule, ruled lines, a stamp) instead of rows of grey bars,
//    which read as a loading skeleton.
// shared/ is a synced copy in every skill, so these live here and call into it. Output is pure: same arguments, same bytes.
import { artSvg } from '../../shared/art.mjs';
import { loadTheme } from '../../shared/theme.mjs';
import { f, fi, op, assertHex, seedFrom, grain, bounded } from '../../shared/art/pieces.mjs';

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

// A double-ruled stamp, tilted, in the accent: the memo's "received" mark, wordless.
function stamp(ctx, cx, cy) {
  const { c, S } = ctx;
  const w = S * 0.22;
  const h = S * 0.1;
  const sw = Math.max(2, S / 200);
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `<g data-art-part="stamp" transform="rotate(-8 ${fi(cx)} ${fi(cy)})" fill="none" stroke="${c.accent}" opacity=".75">`
    + `<rect x="${fi(x)}" y="${fi(y)}" width="${fi(w)}" height="${fi(h)}" stroke-width="${f(sw)}"/>`
    + `<rect x="${fi(x + sw * 3)}" y="${fi(y + sw * 3)}" width="${fi(w - sw * 6)}" height="${fi(h - sw * 6)}" stroke-width="${f(sw / 2)}"/></g>`;
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

// ---- one picture per (mode, size) ---------------------------------------------------------------------------------

function drawing(theme, seed, size, mode) {
  if (theme === 'paper') return paperSvg(theme, seed, size, mode);
  if (theme === 'brief') return briefSvg(theme, seed, size, mode);
  return artSvg({ theme, seed, ...size, mode });
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

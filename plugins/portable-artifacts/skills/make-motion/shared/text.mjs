// Browser-free text measurement from committed font metrics (fonts/metrics.json).
// Advances are summed per codepoint, so kerning is ignored (within ~1% of Chrome
// for UI labels). Zero dependencies; reads metrics.json next to this file.
import fs from 'node:fs';

const METRICS = JSON.parse(fs.readFileSync(new URL('./fonts/metrics.json', import.meta.url), 'utf8'));
const CJK_START = 0x2e80; // codepoints from here up are full-width-ish: fallback x 1.6
const CJK_FACTOR = 1.6;
const MIN_LINE_RATIO = 1.3;
const ROLES = ['display', 'body', 'mono'];

// family -> sorted [{ weight, m }]
const FAMILIES = new Map();
for (const [key, m] of Object.entries(METRICS)) {
  const [family, weight] = key.split('|');
  if (!FAMILIES.has(family)) FAMILIES.set(family, []);
  FAMILIES.get(family).push({ weight: Number(weight), m });
}
for (const list of FAMILIES.values()) list.sort((a, b) => a.weight - b.weight);

// Exact weight, else the nearest declared one (ties go lighter).
function metricsFor({ family, weight = 400 }) {
  const list = FAMILIES.get(family);
  if (!list) throw new Error(`unknown font family ${JSON.stringify(family)}; available: ${[...FAMILIES.keys()].sort().join(', ')}`);
  let best = list[0];
  for (const c of list) if (Math.abs(c.weight - weight) < Math.abs(best.weight - weight)) best = c;
  return best.m;
}

const sizeOf = (font) => font.size ?? 14;

/** Width in px of `text` on one line. */
export function measure(text, font) {
  const m = metricsFor(font);
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    units += m.advance[cp] ?? (cp >= CJK_START ? m.fallback * CJK_FACTOR : m.fallback);
  }
  return (units / m.unitsPerEm) * sizeOf(font);
}

/** Line box height in px: size x 1.3, or the font's own ascent+descent+gap if larger. */
export function lineHeight(font) {
  const m = metricsFor(font);
  const own = ((m.ascender - m.descender + m.lineGap) / m.unitsPerEm) * sizeOf(font);
  return Math.max(sizeOf(font) * MIN_LINE_RATIO, own);
}

// Split one over-wide word into pieces that each fit (at least one codepoint per piece).
function hardBreak(word, maxWidth, font) {
  const pieces = [];
  let piece = '';
  for (const ch of word) {
    if (piece && measure(piece + ch, font) > maxWidth) {
      pieces.push(piece);
      piece = '';
    }
    piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapParagraph(paragraph, maxWidth, font) {
  const lines = [];
  let line = '';
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined, font) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word, font) <= maxWidth) {
      line = word;
      continue;
    }
    const pieces = hardBreak(word, maxWidth, font);
    line = pieces.pop();
    lines.push(...pieces);
  }
  if (line) lines.push(line);
  return lines;
}

/** Greedy word wrap; a single word wider than maxWidth is hard-broken (no hyphen). "\n" forces a break. */
export function wrap(text, maxWidth, font) {
  if (text === '') return [];
  return text.split('\n').flatMap((p) => (p.trim() === '' ? [''] : wrapParagraph(p, maxWidth, font)));
}

/** The theme role's family and its lowest declared weight. Callers pass `weight` themselves for bold. */
export function fontFor(theme, role) {
  const def = theme.fonts?.[role];
  if (!def) throw new Error(`unknown font role ${JSON.stringify(role)}; available: ${ROLES.join(', ')}`);
  return { family: def.family, weight: Math.min(...Object.keys(def.weights).map(Number)) };
}

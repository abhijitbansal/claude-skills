#!/usr/bin/env node
// Dev only. Regenerates shared/fonts/metrics.json from the @fontsource .woff files
// (devDependencies). Run from skills/make-diagram after `npm install`:
//   node scripts/dev/font-metrics.mjs
// The output is committed; nothing at run time needs opentype.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { listThemes, loadTheme } from '../../../../shared/theme.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../../shared/fonts/metrics.json');
const require = createRequire(import.meta.url);
const LATIN = [[0x20, 0x7e], [0xa0, 0xff]];
const fallbackChars = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'];

// family|weight -> woff2 file name, for every pair any shipped theme uses.
function pairs() {
  const out = new Map();
  for (const name of listThemes()) {
    for (const def of Object.values(loadTheme(name).fonts)) {
      for (const [weight, file] of Object.entries(def.weights)) out.set(`${def.family}|${weight}`, file);
    }
  }
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

// geist-sans-latin-400-normal.woff2 -> @fontsource/geist-sans/files/<same>.woff
function woffPath(file) {
  const pkg = file.slice(0, file.indexOf('-latin-'));
  return require.resolve(`@fontsource/${pkg}/files/${file.replace(/\.woff2$/, '.woff')}`);
}

function metricsFor(file) {
  const buf = fs.readFileSync(woffPath(file));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const advance = {};
  for (const [lo, hi] of LATIN) {
    for (let cp = lo; cp <= hi; cp++) {
      const glyph = font.charToGlyph(String.fromCodePoint(cp));
      // Codepoints the font lacks stay out of the table; measure() then uses `fallback`.
      if (!glyph || glyph.index === 0) {
        if (cp <= 0x7e) throw new Error(`${file}: no glyph for ASCII U+${cp.toString(16)}`);
        continue;
      }
      advance[cp] = glyph.advanceWidth;
    }
  }
  const avg = fallbackChars.reduce((sum, c) => sum + advance[c.codePointAt(0)], 0) / fallbackChars.length;
  const { hhea } = font.tables;
  return {
    advance,
    ascender: hhea.ascender,
    descender: hhea.descender,
    fallback: Math.round(avg * 100) / 100,
    lineGap: hhea.lineGap,
    unitsPerEm: font.unitsPerEm,
  };
}

const result = {};
for (const [key, file] of pairs()) result[key] = metricsFor(file);
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${OUT}: ${Object.keys(result).length} fonts, ${fs.statSync(OUT).size} bytes`);

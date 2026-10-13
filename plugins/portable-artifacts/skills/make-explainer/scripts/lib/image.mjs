// image sections: read a local picture and decide if it is safe to inline as a
// data: URI. Size cap, content sniffing (the extension must match the bytes) and
// a strict rule for SVG: no script, no event handlers, no external references.
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const startsWith = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const SNIFF = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  'image/svg+xml': (b) => /<svg[\s>]/i.test(b.toString('utf8', 0, Math.min(b.length, 4096))),
};

// Whole-text scan, on purpose: a tag-by-tag scan can be hidden by a ">" inside a
// quoted attribute value. Strict means a few harmless files are refused (for
// example text that mentions "onclick ="); export a png for those.
// The scan runs on the text as a consumer reads it: XML character references decoded (an XML parser
// decodes them before CSS sees a <style> body), and, for the CSS rules, CSS escapes too (u\72l( is url().
const HREF = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\(\s*(["']?)\s*([^)]*)/gi;
const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g;
const CSS_ESCAPE = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g;
const MAX_DECODE_PASSES = 4;
const MAX_CODE_POINT = 0x10ffff;

const fromCodePoint = (cp, fallback) => (cp > 0 && cp <= MAX_CODE_POINT ? String.fromCodePoint(cp) : fallback);

// Decoded until nothing changes (a reference to a reference is decoded too), so no spelling hides a pattern.
function decodeReferences(text) {
  let out = text;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = out.replace(REFERENCE, (m, dec, hex, name) => (name ? XML_ENTITIES[name] : fromCodePoint(Number.parseInt(dec ?? hex, dec === undefined ? 16 : 10), m)));
    if (next === out) break;
    out = next;
  }
  return out;
}

const decodeCssEscapes = (text) => text.replace(CSS_ESCAPE, (m, hex, char) => (char ?? fromCodePoint(Number.parseInt(hex, 16), '�')));

export function svgProblem(raw) {
  const svg = decodeReferences(raw);
  const css = decodeCssEscapes(svg);
  // An optional namespace prefix on the element name: <x:script>, <svg:foreignObject>.
  if (/<(?:[\w.-]+:)*script/i.test(svg)) return 'contains <script';
  if (/<(?:[\w.-]+:)*foreignObject/i.test(svg)) return 'contains <foreignObject';
  if (/<!ENTITY/i.test(svg)) return 'declares an entity';
  if (/javascript\s*:/i.test(css)) return 'contains a javascript: URL';
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) return 'contains an event handler attribute (on…=)';
  if (/@import/i.test(css)) return 'contains an @import';
  if (/attributeName\s*=\s*["']?\s*(?:[\w.-]+:)?href/i.test(svg)) return 'animates an href';
  for (const m of svg.matchAll(HREF)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!value.startsWith('#')) return `has an href that is not a #fragment (${JSON.stringify(value.slice(0, 40))})`;
  }
  for (const m of css.matchAll(CSS_URL)) {
    if (!m[2].trim().startsWith('#')) return `has a url() that is not a #fragment (${JSON.stringify(m[2].trim().slice(0, 40))})`;
  }
  return null;
}

/**
 * -> { mime, bytes } for a usable image, else { error } naming the fix.
 * `abs` is an already-resolved file (see paths.mjs resolveRef).
 */
export function readImage(abs) {
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) return { error: `unsupported image type ${JSON.stringify(path.extname(abs))}; use png, jpg, webp or svg` };
  const size = fs.statSync(abs).size;
  if (size > IMAGE_MAX_BYTES) {
    return { error: `image is ${(size / 1024 / 1024).toFixed(2)} MB; the limit is ${IMAGE_MAX_BYTES / 1024 / 1024} MB — shrink or resize it` };
  }
  const bytes = fs.readFileSync(abs);
  if (!SNIFF[mime](bytes)) return { error: `file content is not a ${mime.replace('image/', '').replace('+xml', '')} image; check the extension` };
  if (mime === 'image/svg+xml') {
    const problem = svgProblem(bytes.toString('utf8'));
    if (problem) return { error: `svg is not safe to inline: it ${problem}; remove it or export a png` };
  }
  return { mime, bytes };
}

export const dataUri = ({ mime, bytes }) => `data:${mime};base64,${bytes.toString('base64')}`;

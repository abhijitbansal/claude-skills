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

// Every tag is inspected on its own so text content such as "onclick = x" is not a false hit.
export function svgProblem(svg) {
  if (/<script/i.test(svg)) return 'contains <script';
  if (/<foreignObject/i.test(svg)) return 'contains <foreignObject';
  if (/<!ENTITY/i.test(svg)) return 'declares an entity';
  for (const tag of svg.match(/<[^>]+>/g) ?? []) {
    if (/[\s"'/]on[a-z]+\s*=/i.test(tag)) return 'contains an event handler attribute (on…=)';
    for (const m of tag.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!value.startsWith('#')) return `has an href that is not a #fragment (${JSON.stringify(value.slice(0, 40))})`;
    }
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

// Bundled fonts the stage loads through FontFace: shared/fonts/*.woff2 (served at /engine/fonts/shared/<file>) and the
// variable display faces engine/fonts/index.mjs lists (served at /engine/fonts/<file>).
// facesFor(film) is the seam: it returns every face the film needs, each as { family, url, descriptors }. A later
// task widens it (theme fonts); the stage only ever calls facesFor and loadFaces.
import { fontFaces } from '../fonts/index.mjs';

const FONT_URL_PREFIX = '/engine/fonts/shared/';

// [family, weight, file] for every file in shared/fonts/ (the family name is the key shared/fonts/metrics.json uses).
const SHARED_FACES = Object.freeze([
  ['Atkinson Hyperlegible', 400, 'atkinson-hyperlegible-latin-400-normal.woff2'],
  ['Atkinson Hyperlegible', 700, 'atkinson-hyperlegible-latin-700-normal.woff2'],
  ['Big Shoulders Display', 900, 'big-shoulders-display-latin-900-normal.woff2'],
  ['Bricolage Grotesque', 600, 'bricolage-grotesque-latin-600-normal.woff2'],
  ['Commit Mono', 400, 'commit-mono-latin-400-normal.woff2'],
  ['Familjen Grotesk', 400, 'familjen-grotesk-latin-400-normal.woff2'],
  ['Familjen Grotesk', 700, 'familjen-grotesk-latin-700-normal.woff2'],
  ['Funnel Display', 700, 'funnel-display-latin-700-normal.woff2'],
  ['Geist Mono', 400, 'geist-mono-latin-400-normal.woff2'],
  ['Geist', 400, 'geist-sans-latin-400-normal.woff2'],
  ['Geist', 600, 'geist-sans-latin-600-normal.woff2'],
  ['Host Grotesk', 400, 'host-grotesk-latin-400-normal.woff2'],
  ['Host Grotesk', 700, 'host-grotesk-latin-700-normal.woff2'],
  ['JetBrains Mono', 400, 'jetbrains-mono-latin-400-normal.woff2'],
  ['Martian Mono', 400, 'martian-mono-latin-400-normal.woff2'],
  ['Newsreader', 600, 'newsreader-latin-600-normal.woff2'],
  ['Schibsted Grotesk', 400, 'schibsted-grotesk-latin-400-normal.woff2'],
  ['Schibsted Grotesk', 700, 'schibsted-grotesk-latin-700-normal.woff2'],
  ['Young Serif', 400, 'young-serif-latin-400-normal.woff2'],
].map(([family, weight, file]) => Object.freeze({
  family,
  url: `${FONT_URL_PREFIX}${file}`,
  descriptors: Object.freeze({ weight: String(weight), style: 'normal' }),
})));

// Every string a `family` key holds anywhere in the film (a node's font object names one).
function familiesIn(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => familiesIn(v, found));
  else if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'family' && typeof v === 'string') found.add(v);
      else familiesIn(v, found);
    }
  }
  return found;
}

export function facesFor(film) {
  const wanted = familiesIn(film);
  const available = [...SHARED_FACES, ...fontFaces()];
  const bundled = new Set(available.map((face) => face.family));
  for (const family of wanted) {
    if (!bundled.has(family)) throw new Error(`unknown font family "${family}" (bundled: ${[...bundled].join(', ')})`);
  }
  return available.filter((face) => wanted.has(face.family));
}

export async function loadFaces(faces) {
  const loaded = await Promise.all(faces.map((face) => new FontFace(face.family, `url(${face.url})`, face.descriptors).load()));
  for (const face of loaded) document.fonts.add(face);
  await document.fonts.ready;
}

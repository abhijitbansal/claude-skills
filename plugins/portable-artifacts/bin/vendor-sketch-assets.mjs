#!/usr/bin/env node
// Development tool (not run in CI, not a runtime dependency): generates the hand-drawn style's assets in
// skills/make-motion/template/sketch/ from two pinned npm packages.
//
//   caveat-700.woff2      the Latin subset of Caveat 700 (@fontsource/caveat)
//   caveat-metrics.mjs    { unitsPerEm, ascent, descent, advance: { [char]: units } } for every printable glyph in that file
//   lucide.mjs            { [icon name]: Array<Array<[x, y]>> }: polylines in the 24-unit box (lucide-static)
//   LICENSES              both licence texts
//
// Sanctioned invocation (fonttools + brotli live in a throwaway venv, never in system Python; --sources is a folder whose
// node_modules holds the two pinned packages and playwright):
//
//   python3 -m venv <scratch>/v && <scratch>/v/bin/pip install fonttools brotli
//   node bin/vendor-sketch-assets.mjs --sources <scratch>/spike --python <scratch>/v/bin/python
//
// Icons are flattened here, once, with the browser's getPointAtLength (every SVG shape is a geometry element), then
// simplified to ICON_TOLERANCE units, so the page and the validator never run path maths. Alias icons (names lucide-static
// lists only as .svg files, not in icon-nodes.json) are dropped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node bin/vendor-sketch-assets.mjs --sources <dir> --python <path>';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../skills/make-motion/template/sketch');
const METRICS_PY = path.join(HERE, 'font-metrics.py');

const PINS = { '@fontsource/caveat': '5.3.0', 'lucide-static': '1.69.0' };
const FONT_FILE = 'caveat-latin-700-normal.woff2';
const METRICS_KEY = 'Caveat|700';
const SAMPLE_STEP = 0.1; // units between samples along a shape, before simplifying
const SAMPLE_INSET = 0.001; // a subpath's first and last sample sit this far inside it: a boundary belongs to both neighbours
const ICON_TOLERANCE = 0.05; // Douglas-Peucker, in units of the 24-unit box
const CLOSED_GAP = 0.01; // ends this close are one point: the shape is closed
const BATCH = 100; // icons per browser round trip
const DECIMALS = 100; // coordinates keep two decimals

// Runs in the page. For each icon, each of its SVG shapes becomes one sampled polyline per subpath: a path's `M`/`m`
// commands split it, and subpath k covers the arc lengths between the totals of the paths cut before k and before k+1.
function flattenInPage({ icons, step, inset }) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  document.body.append(svg);
  const shape = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
    return el;
  };
  const totalOf = (d) => {
    const probe = shape('path', { d });
    const total = probe.getTotalLength();
    probe.remove();
    return total;
  };
  const rangesOf = (tag, attrs, el) => {
    const total = el.getTotalLength();
    if (tag !== 'path') return [[0, total]];
    const cuts = [...attrs.d.matchAll(/[Mm]/g)].map((m) => m.index).slice(1);
    const bounds = [0, ...cuts.map((at) => totalOf(attrs.d.slice(0, at))), total];
    return bounds.slice(1).map((hi, k) => [bounds[k], hi]);
  };
  const sample = (el, [lo, hi]) => {
    if (hi - lo <= 2 * inset) return null;
    const n = Math.max(1, Math.ceil((hi - lo) / step));
    const points = [];
    for (let i = 0; i <= n; i += 1) {
      const at = lo + inset + ((hi - lo - 2 * inset) * i) / n;
      const p = el.getPointAtLength(at);
      points.push([p.x, p.y]);
    }
    return points;
  };
  const out = {};
  for (const [name, nodes] of Object.entries(icons)) {
    out[name] = nodes.flatMap(([tag, attrs]) => {
      const el = shape(tag, attrs);
      const lines = rangesOf(tag, attrs, el).map((range) => sample(el, range)).filter(Boolean);
      el.remove();
      return lines;
    });
  }
  svg.remove();
  return out;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function distanceToSegment(p, a, b) {
  const length = distance(a, b);
  if (length === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (length * length)));
  return distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}

// Douglas-Peucker, iterative.
export function simplify(points, tolerance) {
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;
  const stack = [[0, last]];
  while (stack.length) {
    const [from, to] = stack.pop();
    let far = -1;
    let widest = tolerance;
    for (let i = from + 1; i < to; i += 1) {
      const d = distanceToSegment(points[i], points[from], points[to]);
      if (d > widest) { widest = d; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([from, far], [far, to]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const round = (n) => Math.round(n * DECIMALS) / DECIMALS;

function tidy(points) {
  const closed = distance(points[0], points[points.length - 1]) < CLOSED_GAP;
  const simple = simplify(points, ICON_TOLERANCE).map(([x, y]) => [round(x), round(y)]);
  if (closed && simple.length > 2) simple[simple.length - 1] = [...simple[0]];
  return simple;
}

function readPackage(sources, name) {
  const dir = path.join(sources, 'node_modules', name);
  const pkgFile = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new UsageError(`${name} not found under ${path.join(sources, 'node_modules')}; npm install ${name}@${PINS[name]} there`);
  const { version } = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  if (version !== PINS[name]) throw new UsageError(`${name} is ${version} under --sources; this tool is pinned to ${PINS[name]}`);
  return dir;
}

function copyFont(caveat) {
  fs.copyFileSync(path.join(caveat, 'files', FONT_FILE), path.join(OUT, 'caveat-700.woff2'));
}

// font-metrics.py reads every printable glyph out of the subset font into a scratch JSON; the module is that entry reshaped.
function writeMetrics(python) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sketch-metrics-'));
  try {
    const merge = path.join(scratch, 'metrics.json');
    fs.writeFileSync(merge, '{}\n');
    const run = spawnSync(python, [METRICS_PY, path.join(OUT, 'caveat-700.woff2'), '--merge', merge, '--name', METRICS_KEY, '--every-glyph'], { encoding: 'utf8' });
    if (run.status !== 0) throw new UsageError(`font-metrics.py failed (${python}): ${(run.stderr || run.error?.message || '').trim().split('\n').at(-1)}`);
    const entry = JSON.parse(fs.readFileSync(merge, 'utf8'))[METRICS_KEY];
    const advance = Object.fromEntries(Object.entries(entry.advance).map(([code, units]) => [String.fromCodePoint(Number(code)), units]));
    const metrics = { unitsPerEm: entry.unitsPerEm, ascent: entry.ascender, descent: entry.descender, advance };
    fs.writeFileSync(path.join(OUT, 'caveat-metrics.mjs'), [
      '// Generated by bin/vendor-sketch-assets.mjs from caveat-700.woff2 (Caveat 700, Latin subset). Do not edit.',
      '// Font units. `descent` is negative (below the baseline), as in the font\'s hhea table. `advance` is keyed by character:',
      '// a character with no entry is not in the font.',
      `export default ${JSON.stringify(metrics)};`,
      '',
    ].join('\n'));
    return Object.keys(advance).length;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function launch(chromium) {
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist/i.test(e.message)) throw e;
    return chromium.launch({ channel: 'chrome' });
  }
}

async function writeIcons(sources, lucide) {
  const { chromium } = createRequire(path.join(sources, 'package.json'))('playwright');
  const nodes = JSON.parse(fs.readFileSync(path.join(lucide, 'icon-nodes.json'), 'utf8'));
  const names = Object.keys(nodes).sort();
  const icons = {};
  const browser = await launch(chromium);
  try {
    const page = await browser.newPage();
    for (let i = 0; i < names.length; i += BATCH) {
      const batch = Object.fromEntries(names.slice(i, i + BATCH).map((name) => [name, nodes[name]]));
      const flat = await page.evaluate(flattenInPage, { icons: batch, step: SAMPLE_STEP, inset: SAMPLE_INSET });
      for (const [name, lines] of Object.entries(flat)) icons[name] = lines.map(tidy);
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'lucide.mjs'), [
    '// Generated by bin/vendor-sketch-assets.mjs from lucide-static (ISC, see LICENSES). Do not edit.',
    '// { [icon name]: Array<Array<[x, y]>> }: polylines in the 24-unit box. Load with a dynamic import.',
    `export default ${JSON.stringify(icons)};`,
    '',
  ].join('\n'));
  return names.length;
}

function writeLicenses(caveat, lucide) {
  const part = (title, source, note, file) => `== ${title} ==\nSource: ${source}\n${note}\n\n${fs.readFileSync(file, 'utf8').trim()}\n`;
  const text = [
    'Third-party material in make-motion\'s hand-drawn style (template/sketch/).',
    'Regenerate with: node bin/vendor-sketch-assets.mjs (see its header).\n',
    part('Caveat (caveat-700.woff2)', `@fontsource/caveat@${PINS['@fontsource/caveat']}, ${FONT_FILE}`, 'Licence: SIL Open Font License 1.1. The file is unmodified.', path.join(caveat, 'LICENSE')),
    part('Lucide (lucide.mjs)', `lucide-static@${PINS['lucide-static']}`, 'Licence: ISC, and MIT for the icons derived from Feather (listed below). The shapes are flattened to polylines.', path.join(lucide, 'LICENSE')),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'LICENSES'), text);
}

export async function main(argv) {
  try {
    const { values, positionals } = parseCli(argv, { sources: { type: 'string' }, python: { type: 'string' } }, USAGE);
    if (positionals.length) throw new UsageError(`takes no arguments, only flags; usage: ${USAGE}`);
    for (const flag of ['sources', 'python']) if (values[flag] === undefined) throw new UsageError(`--${flag} is required; usage: ${USAGE}`);
    const sources = path.resolve(values.sources);
    const caveat = readPackage(sources, '@fontsource/caveat');
    const lucide = readPackage(sources, 'lucide-static');
    fs.mkdirSync(OUT, { recursive: true });
    copyFont(caveat);
    const glyphs = writeMetrics(path.resolve(values.python));
    const icons = await writeIcons(sources, lucide);
    writeLicenses(caveat, lucide);
    process.stdout.write(`vendored ${glyphs} glyph advances and ${icons} icons into ${path.relative(process.cwd(), OUT)}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e);
    return 2;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

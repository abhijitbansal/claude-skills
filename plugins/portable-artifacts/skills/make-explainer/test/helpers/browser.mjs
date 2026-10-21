// Shared by the browser tests: launch (bundled Chromium, else system Chrome),
// build a spec file to a page, and open it with the console watched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../../scripts/lib/browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = path.join(ROOT, 'scripts/build.mjs');

export const EXAMPLES = ['concept', 'checklist', 'slides', 'recap', 'plan'];
export const exampleFile = (name) => path.join(ROOT, `references/examples/${name}.explainer.json`);

export { launchBrowser };

let cached;
export async function haveBrowser() {
  if (cached === undefined) {
    try { await (await launchBrowser()).close(); cached = true; } catch { cached = false; }
  }
  return cached;
}

let scratch;
/** A temp dir shared by the whole run; screenshots and builds land here. */
export function scratchDir() {
  scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-ui-'));
  return scratch;
}

/** Build a spec file to a page in the scratch dir; returns { file, url, html }. */
export function buildFile(specFile, { theme, name = 'page' } = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir(), 'build-'));
  const file = path.join(dir, `${name}.html`);
  const args = [BUILD, specFile, '--out', file, ...(theme ? ['--theme', theme] : [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, PA_OUTPUT_DIR: path.join(dir, 'unused'), EVAL_LOG: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { file, url: pathToFileURL(file).href, html: fs.readFileSync(file, 'utf8') };
}

/** Write a spec object next to `assetsFrom`'s files (so relative paths work), build it, return the page. */
export function buildSpec(spec, { name = 'page', files = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir(), 'spec-'));
  for (const f of files) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  const specFile = path.join(dir, 'spec.explainer.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  return buildFile(specFile, { name });
}

/**
 * Open a built page in a fresh context; resolves { page, problems, context } once the runtime has started.
 * `problems` collects every console error/warning and page error. `blockStorage` makes localStorage throw;
 * `seed` is a { key: value } map written to localStorage before any page script runs; `init` is a function run in the page before its scripts.
 */
let shared;
/** Closes the browser openPage launched; call it from the test file's `after`. */
export async function closeSharedBrowser() {
  await shared?.close();
  shared = undefined;
}

export async function openPage(url, { width = 1280, height = 900, colorScheme = 'light', reducedMotion = 'reduce', blockStorage = false, seed = {}, init, context: existing } = {}) {
  shared ??= await launchBrowser();
  const context = existing ?? await shared.newContext({ viewport: { width, height }, colorScheme, reducedMotion });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('dialog', (d) => { problems.push(`dialog: ${d.type()}`); d.dismiss(); });
  if (blockStorage) {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
      }
    });
  }
  if (init) await page.addInitScript(init);
  if (Object.keys(seed).length > 0) {
    await page.addInitScript((entries) => {
      if (!window.name.includes('seeded')) {
        for (const [k, v] of Object.entries(entries)) window.localStorage.setItem(k, v);
        window.name += 'seeded';
      }
    }, seed);
  }
  await page.goto(url);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

/**
 * In-page contrast helpers for the deck tests, added with page.addScriptTag({ content: DECK_CONTRAST_JS }).
 * window.__deck.backdrops(el) lists every colour that can sit behind el: its own and its ancestors' fills,
 * each gradient stop and an inset-0 ::before fill, down to the first opaque ground. A walk that reaches a slide
 * with full-bleed art before any opaque ground ends on the art, which can be any colour: pure black and pure
 * white then stand in for its worst pixel. window.__deck.textProblems(root, min) and ringProblem(el, min)
 * report what falls below a ratio.
 */
export const DECK_CONTRAST_JS = `
window.__deck = (() => {
  const nums = (c) => (c.match(/-?\\d*\\.?\\d+(?:e-?\\d+)?/g) || []).map(Number);
  const parse = (c) => {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    const n = nums(c);
    const rgb = c.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
    return [...rgb, n.length > 3 ? n[3] : 1];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const STOP = /rgba?\\([^)]*\\)|color\\([^)]*\\)/g;
  const insetZero = (cs) => ['top', 'right', 'bottom', 'left'].every((k) => cs[k] === '0px');
  // One element's paint under its text, bottom first: its fill, an inset-0 ::before fill, gradient stops (any one of them, or none).
  function layer(n) {
    const cs = getComputedStyle(n);
    const fills = [];
    const bg = parse(cs.backgroundColor);
    if (bg[3] > 0) fills.push(bg);
    const pre = getComputedStyle(n, '::before');
    if (pre.content !== 'none' && pre.position === 'absolute' && insetZero(pre)) {
      const fill = parse(pre.backgroundColor);
      if (fill[3] > 0) fills.push(fill);
    }
    const stops = (cs.backgroundImage === 'none' ? [] : cs.backgroundImage.match(STOP) || []).map(parse).filter((s) => s[3] > 0);
    return { fills, stops, opaque: stops.length === 0 && fills.some((f) => f[3] >= 1) };
  }
  function backdrops(el) {
    const layers = [];
    let base = null;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const l = layer(n);
      layers.push(l);
      if (l.opaque) { base = [[255, 255, 255, 1]]; break; }
      if (n.matches('.slide-has-art')) { base = [[0, 0, 0, 1], [255, 255, 255, 1]]; break; }
    }
    if (!base) base = [parse(getComputedStyle(document.body).backgroundColor)];
    let cands = base;
    for (const l of layers.reverse()) {
      const next = [];
      for (const c of cands) {
        const filled = l.fills.reduce((acc, f) => over(f, acc), c);
        next.push(filled, ...l.stops.map((s) => over(s, filled)));
      }
      const seen = new Set();
      cands = next.filter((c) => { const k = c.map(Math.round).join(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 400);
    }
    return cands;
  }
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const ownText = (el) => [...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim() !== '');
  const minRatio = (fg, el, at) => Math.min(...backdrops(at).map((b) => ratio(over(fg, b), b)));
  function textProblems(root, min) {
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      // WCAG exempts inactive controls (a checklist's Reset before anything is ticked) from the text minimum.
      if (!ownText(el) || el.closest('svg, .sr-only, video, [hidden], [aria-disabled="true"], :disabled') || el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible') continue;
      const fg = parse(cs.color);
      fg[3] *= opacity(el);
      const r = minRatio(fg, el, el);
      if (r < min) out.push((el.closest('.slide')?.id ?? 'chrome') + ' ' + el.tagName.toLowerCase() + '.' + el.className + ' "' + el.textContent.trim().slice(0, 32) + '" ' + r.toFixed(2) + ':1');
    }
    return out;
  }
  // The ring is drawn just outside the element, so it is judged on the parent's ground.
  function ringProblem(el, min) {
    const cs = getComputedStyle(el);
    const name = (el.closest('.slide')?.id ?? 'chrome') + ' ' + el.tagName.toLowerCase() + '.' + el.className;
    if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) < 1) return name + ': no focus ring';
    const r = minRatio(parse(cs.outlineColor), el, el.parentElement);
    return r < min ? name + ': ring ' + r.toFixed(2) + ':1' : null;
  }
  return { backdrops, textProblems, ringProblem, ratio, parse };
})();`;

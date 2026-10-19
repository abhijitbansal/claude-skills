#!/usr/bin/env node
// node scripts/check.mjs <motion.json> [--json]
// Seeks the real render page to every contact-sheet moment of every scene (sheetTimes) and reads each element's box
// and opacity from the DOM. Fails on: a visible text element outside the safe area once it has settled; two visible
// text boxes overlapping at the same moment; a scene with every element invisible at its last frame.
// exit 0 ok or skipped (no browser), 1 problems (or an invalid spec), 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, withDefaults, UsageError as SpecUsageError } from './lib/spec.mjs';
import { printResult } from '../shared/errors.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { sheetTimes } from './lib/sheet.mjs';
import { doctorCommand } from './lib/doctor-hint.mjs';

const USAGE = 'node scripts/check.mjs <motion.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const SAFE_MARGIN_PX = 60; // at 1080 px on the canvas's short side; scaled by short side / 1080
const SAFE_REFERENCE_SIDE = 1080;
const SUBPIXEL_PX = 0.5; // a box edge this close to the safe line is on it
const VISIBLE_OPACITY = 0.05; // rendered opacity (element x scene) above this counts as visible
const OVERLAP_TOLERANCE_PX = 2; // an intersection this thin on either axis is a shared edge, not an overlap
const GEOMETRY = ['x', 'y', 'scale', 'rotate']; // keyframed props that move or resize a box (opacity does not)
const EPSILON = 1e-6;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
// The safe-area margin on every side: 60 px at 1080 on the short side (the rule comes from a 1080x1080 canvas), so
// 1920x1080, 1080x1350 and 1080x1080 all get 60 px and 3840x2160 gets 120.
export const safeMargin = (size) => (SAFE_MARGIN_PX * Math.min(size[0], size[1])) / SAFE_REFERENCE_SIDE;
const skipHint = () => `ask the user, then run: ${doctorCommand('--for', 'check', '--fix', 'chromium')}`;

// Scene-local second at which the element's box stops moving: its last x/y/scale/rotate keyframe (0 if it never moves).
// The safe-area rule judges an element only from then on, so an entrance from off-canvas is not a finding, but where
// it lands is. sheetTimes samples every landing + 0.1 s, so every element gets at least one settled moment; the
// scene's last frame always counts as settled (an element still moving there never settles on screen).
const settledAt = (el) => Math.max(0, ...el.keyframes.filter((kf) => GEOMETRY.some((p) => kf[p] !== undefined)).map((kf) => kf.t));

// Runs in the page: seek to `sec`, then each element of scene layer `index` as {id, opacity, box} in canvas pixels.
// Rendered opacity multiplies the element's and every ancestor's up to the stage (the scene fade); a hidden layer is 0.
const measure = ([sec, index]) => {
  window.__motion.seek(sec);
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const k = window.__motion.size[0] / s.width;
  const layer = stage.querySelectorAll(':scope > .scene')[index];
  const shown = getComputedStyle(layer).display !== 'none';
  return [...layer.querySelectorAll(':scope > .el')].map((node) => {
    let opacity = shown ? 1 : 0;
    for (let n = node; n && n !== stage; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    const r = node.getBoundingClientRect();
    const box = { left: (r.left - s.left) * k, top: (r.top - s.top) * k, right: (r.right - s.left) * k, bottom: (r.bottom - s.top) * k };
    return { id: node.dataset.id, opacity, box };
  });
};

const at = (t) => `${t.toFixed(2)}s`;
const isVisible = (m) => m.opacity > VISIBLE_OPACITY;

function safeAreaProblems(scene, i, samples, margin, size) {
  const problems = [];
  scene.elements.forEach((el, j) => {
    if (el.type !== 'text') return;
    const from = settledAt(el);
    for (const [n, { t, els }] of samples.entries()) {
      const { box } = els[j];
      if (!isVisible(els[j]) || (t < from - EPSILON && n !== samples.length - 1)) continue;
      const edges = [['top', margin - box.top], ['bottom', box.bottom - (size[1] - margin)], ['left', margin - box.left], ['right', box.right - (size[0] - margin)]]
        .filter(([, by]) => by > SUBPIXEL_PX).map(([edge]) => edge);
      if (!edges.length) continue;
      problems.push({ path: `scenes[${i}].elements[${j}]`, message: `text "${el.id}" leaves the safe area (${edges.join(', ')}) at ${at(t)}` });
      return;
    }
  });
  return problems;
}

const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > OVERLAP_TOLERANCE_PX
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > OVERLAP_TOLERANCE_PX;

function overlapProblems(scene, i, samples) {
  const problems = [];
  const texts = scene.elements.map((el, j) => ({ el, j })).filter(({ el }) => el.type === 'text');
  for (const [b, second] of texts.entries()) {
    for (const first of texts.slice(0, b)) {
      const hit = samples.find(({ els }) => isVisible(els[first.j]) && isVisible(els[second.j]) && overlaps(els[first.j].box, els[second.j].box));
      if (hit) problems.push({ path: `scenes[${i}].elements[${second.j}]`, message: `text "${second.el.id}" overlaps text "${first.el.id}" at ${at(hit.t)}` });
    }
  }
  return problems;
}

function emptyEndProblems(scene, i, samples) {
  const last = samples[samples.length - 1];
  if (!scene.elements.length || last.els.some(isVisible)) return [];
  return [{ path: `scenes[${i}]`, message: `scene "${scene.id}" ends with every element invisible (at ${at(last.t)})` }];
}

async function sampleScene(page, scene, index, start, fps) {
  const samples = [];
  for (const t of sheetTimes(scene, fps)) {
    const els = await page.evaluate(measure, [start + t, index]);
    const ids = els.map((m) => m.id).join();
    if (ids !== scene.elements.map((el) => el.id).join()) throw new Error(`scene "${scene.id}": the page shows elements ${ids}, not the spec's`);
    samples.push({ t, els });
  }
  return samples;
}

async function inspect(browser, spec, server) {
  const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] }, deviceScaleFactor: 1 });
  await guardNetwork(page, new URL(server.url).origin, (url) => process.stderr.write(`blocked network request: ${url}\n`));
  await page.goto(server.url);
  await page.waitForFunction(() => window.__motion);
  await page.evaluate(() => window.__motion.ready);
  const starts = await page.evaluate(() => window.__motion.sceneStarts);
  const margin = safeMargin(spec.size);
  const problems = [];
  let moments = 0;
  for (const [i, scene] of spec.scenes.entries()) {
    const samples = await sampleScene(page, scene, i, starts[i], spec.fps);
    moments += samples.length;
    problems.push(...safeAreaProblems(scene, i, samples, margin, spec.size), ...overlapProblems(scene, i, samples), ...emptyEndProblems(scene, i, samples));
  }
  return { status: problems.length ? 'failed' : 'ok', scenes: spec.scenes.length, moments, problems };
}

async function checkSpec(specPath, spec, env) {
  if (env.PA_NO_BROWSER === '1') return { status: 'skipped', reason: 'PA_NO_BROWSER=1' };
  let browser;
  try {
    browser = await launchBrowser({ quiet: true });
  } catch (e) {
    return { status: 'skipped', reason: firstLine(e) };
  }
  const server = await startServer({ specPath, mode: 'render' });
  try {
    return await inspect(browser, spec, server);
  } finally {
    await browser.close().catch(() => {});
    await server.close();
  }
}

function report(result, json) {
  const { status, problems = [] } = result;
  if (json) {
    const body = status === 'skipped' ? { ok: true, skipped: true, reason: result.reason, hint: skipHint() }
      : status === 'ok' ? { ok: true, scenes: result.scenes, moments: result.moments }
        : { ok: false, errors: problems };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; ${skipHint()})\n`);
  else if (status === 'ok') process.stdout.write(`check: ok (${result.scenes} scene${result.scenes === 1 ? '' : 's'}, ${result.moments} moments)\n`);
  else {
    for (const p of problems) process.stdout.write(p.path ? `${p.path}: ${p.message}\n` : `${p.message}\n`);
    process.stdout.write(`check: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
  }
}

async function main(argv) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one motion.json; usage: ${USAGE}`);
    const { spec: raw, dir } = loadSpec(positionals[0]);
    const valid = validateSpec(raw, { dir });
    if (!valid.ok) {
      printResult(valid, { json, label: positionals[0] });
      return 1;
    }
    const result = await checkSpec(path.resolve(positionals[0]), withDefaults(raw), process.env);
    report(result, json);
    return result.status === 'failed' ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError || e instanceof SpecUsageError) {
      exitUsage(e, { json });
      return 2;
    }
    report({ status: 'failed', problems: [{ path: '', message: `check crashed: ${firstLine(e)}` }] }, json); // never a stack trace
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

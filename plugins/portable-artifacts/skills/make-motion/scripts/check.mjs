#!/usr/bin/env node
// node scripts/check.mjs <motion.json> [--json] [--theme <name>]
// Seeks the real render page to every contact-sheet moment of every scene (sheetTimes) and reads each element's box
// and opacity from the DOM. Fails on: a visible text or counter outside the safe area while it is not moving; two
// visible text or counter boxes overlapping while neither is moving or fading; a scene with nothing on screen at its
// last frame (a title whose `exit` preset was applied left on purpose and counts as present); a number-plus-unit token
// ("1,204 ms", "87%") drawn across more than one line, reported once per token per scene. A box wholly off the canvas
// has left the frame: it is never clipped, overlaps nothing, and is not on screen.
// A warning (never a failure; exit stays 0) when the first scene shows nothing at t = 0: stderr, or `warnings` in --json.
// A scene is judged on its own layer, so the outgoing scene of a crossfade is not part of the incoming scene's own
// checks (the incoming scene's first 0.4 s are sampled, from the 0.1 s first look on). Instead each crossfade window is
// sampled at its midpoint, and a visible text or counter of the incoming scene that overlaps one of the outgoing scene
// there is a warning (never a failure).
// --theme: the theme render.mjs --theme would draw a spec that names none in (a spec's own `theme` wins).
// exit 0 ok or skipped (no browser), 1 problems (or an invalid spec), 2 usage/IO
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, withDefaults, ART_BACKGROUND, UsageError as SpecUsageError } from './lib/spec.mjs';
import { printResult, didYouMean } from '../shared/errors.mjs';
import { listThemes } from '../shared/theme.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { startServer } from './lib/server.mjs';
import { launchBrowser, guardNetwork } from './lib/browser.mjs';
import { sheetTimes } from './lib/sheet.mjs';
import { nowrapProblems } from '../shared/nowrap-probe.mjs';
import { doctorCommand } from './lib/doctor-hint.mjs';

const USAGE = 'node scripts/check.mjs <motion.json> [--json] [--theme <name>]';
const OPTIONS = { json: { type: 'boolean' }, theme: { type: 'string' } };
const READY_MS = 30000; // the page must build its stage within this (render.mjs's first wait), or the check fails instead of hanging
const CHECKED = new Set(['text', 'counter']); // rendered text: the element types rules 1 and 2 judge
const SAFE_MARGIN_PX = 60; // at 1080 px on the canvas's short side; scaled by short side / 1080
const SAFE_REFERENCE_SIDE = 1080;
const SUBPIXEL_PX = 0.5; // a box edge this close to the safe line is on it
const VISIBLE_OPACITY = 0.05; // rendered opacity (element x scene) above this counts as visible
const OVERLAP_TOLERANCE_PX = 2; // an intersection this thin on either axis is a shared edge, not an overlap
const GEOMETRY = ['x', 'y', 'scale', 'rotate']; // keyframed props that move or resize a box (opacity does not)
const POSE = [...GEOMETRY, 'opacity']; // ... and, for overlaps, the ones that fade it in or out too
const EPSILON = 1e-6;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
// A page error surfaces as "page.evaluate: Error: <message>"; the crash line keeps only the message.
const crashLine = (e) => firstLine(e).replace(/^(page|frame)\.\w+: (Error: )?/, '');
// The safe-area margin on every side: 60 px at 1080 on the short side (the rule comes from a 1080x1080 canvas), so
// 1920x1080, 1080x1350 and 1080x1080 all get 60 px and 3840x2160 gets 120.
export const safeMargin = (size) => (SAFE_MARGIN_PX * Math.min(size[0], size[1])) / SAFE_REFERENCE_SIDE;
const skipHint = () => `ask the user, then run: ${doctorCommand('--for', 'check', '--fix', 'chromium')}`;

// Holds: an element is in motion at scene-local `t` when `t` lies strictly inside the span between two consecutive
// keyframes that set the same prop of a rule's set, and in a hold otherwise (before its first keyframe, between
// tweens, after its last). The safe-area rule judges an element only in a GEOMETRY hold, so an entrance from
// off-canvas is not a finding but where it lands is, and a placement held before an exit is. The overlap rule judges a
// pair only when both are in a POSE hold, so a cross-fade swap in one spot is not a finding but an overlap held before
// an exit fade is. sheetTimes samples every landing + 0.1 s, so every element gets a held moment after each move; the
// scene's last frame is always judged (the fallback for a continuous drift that never holds).
const tweenSpans = (el, props) => props.flatMap((p) => {
  const times = el.keyframes.filter((kf) => kf[p] !== undefined).map((kf) => kf.t);
  return times.slice(1).map((to, k) => [times[k], to]);
});
const isHeld = (spans, t, n, samples) => n === samples.length - 1 || !spans.some(([from, to]) => t > from + EPSILON && t < to - EPSILON);

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
    // Nothing drawn yet: a chart at reveal 0, a line (or unfilled shape) at draw 0 (a filled shape shows its fill), or a
    // typing text with no characters typed (its caret alone is not content).
    const mark = node.querySelector(':scope > svg > :first-child');
    const untyped = node.querySelector(':scope > .typed')?.textContent === '';
    const undrawn = untyped || node.dataset.reveal === '0' || (mark !== null && mark.getAttribute('stroke-dashoffset') === '1' && (mark.tagName === 'line' || mark.getAttribute('fill') === 'none'));
    return { id: node.dataset.id, opacity, box, undrawn };
  });
};

const at = (t) => `${t.toFixed(2)}s`;
const isVisible = (m) => m.opacity > VISIBLE_OPACITY;
const onCanvas = ({ box }, size) => box.right > 0 && box.left < size[0] && box.bottom > 0 && box.top < size[1];
const isShown = (m, size) => isVisible(m) && onCanvas(m, size) && !m.undrawn; // seen in the frame, at least in part

function safeAreaProblems(scene, i, samples, margin, size) {
  const problems = [];
  scene.elements.forEach((el, j) => {
    if (!CHECKED.has(el.type)) return;
    const spans = tweenSpans(el, GEOMETRY);
    for (const [n, { t, els }] of samples.entries()) {
      const { box } = els[j];
      if (!isShown(els[j], size) || !isHeld(spans, t, n, samples)) continue;
      const edges = [['top', margin - box.top], ['bottom', box.bottom - (size[1] - margin)], ['left', margin - box.left], ['right', box.right - (size[0] - margin)]]
        .filter(([, by]) => by > SUBPIXEL_PX).map(([edge]) => edge);
      if (!edges.length) continue;
      problems.push({ path: `scenes[${i}].elements[${j}]`, message: `${el.type} "${el.id}" leaves the safe area (${edges.join(', ')}) at ${at(t)}` });
      return;
    }
  });
  return problems;
}

const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > OVERLAP_TOLERANCE_PX
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > OVERLAP_TOLERANCE_PX;

function overlapProblems(scene, i, samples, size) {
  const problems = [];
  const texts = scene.elements.map((el, j) => ({ el, j, spans: tweenSpans(el, POSE) })).filter(({ el }) => CHECKED.has(el.type));
  for (const [b, second] of texts.entries()) {
    for (const first of texts.slice(0, b)) {
      const hit = samples.find(({ t, els }, n) => isHeld(first.spans, t, n, samples) && isHeld(second.spans, t, n, samples)
        && isShown(els[first.j], size) && isShown(els[second.j], size) && overlaps(els[first.j].box, els[second.j].box));
      if (hit) {
        problems.push({ path: `scenes[${i}].elements[${second.j}]`, message: `${second.el.type} "${second.el.id}" overlaps ${first.el.type} "${first.el.id}" at ${at(hit.t)}` });
      }
    }
  }
  return problems;
}

// What an element looks like before its first keyframe: the first opacity keyframe's value (the preset a title gets is
// one), else its own opacity; and whether a drawing or reveal property starts at 0.
const startsInvisible = (el) => (el.keyframes.find((kf) => kf.opacity !== undefined)?.opacity ?? el.opacity) <= VISIBLE_OPACITY;
const startsUndrawn = (el) => ['draw', 'reveal'].some((p) => el.keyframes.find((kf) => kf[p] !== undefined)?.[p] === 0);
const startsEmpty = (el) => Boolean(el.typing) && (el.keyframes.find((kf) => kf.value !== undefined)?.value ?? 0) === 0;
const quoted = (els) => els.map((el) => `"${el.id}"`).join(', ');

// Frame 0 is the video's first frame and so its thumbnail: a warning when the first scene shows nothing there. An art
// background is on screen at t = 0, so it counts. The message names what keeps the frame blank.
function frameZeroWarnings(scene, els, size) {
  if (scene.background === ART_BACKGROUND || !scene.elements.length || els.some((m) => isShown(m, size))) return [];
  const invisible = scene.elements.filter(startsInvisible);
  const undrawn = scene.elements.filter(startsUndrawn);
  const empty = scene.elements.filter(startsEmpty);
  const causes = [
    scene.transition === 'fade' && 'the scene fades in from the background ("fade" on scene 1)',
    invisible.length && `${quoted(invisible)} ${invisible.length === 1 ? 'has' : 'have'} an opacity 0 first keyframe${invisible.some((el) => el.role === 'title') ? " (a title's theme entrance starts at 0)" : ''}`,
    undrawn.length && `${quoted(undrawn)} ${undrawn.length === 1 ? 'starts' : 'start'} undrawn (draw or reveal 0)`,
    empty.length && `${quoted(empty)} ${empty.length === 1 ? 'starts' : 'start'} empty (a typing text types from no characters)`,
  ].filter(Boolean);
  const why = causes.length ? causes.join('; ') : 'every element is off the canvas';
  return [{ path: 'scenes[0]', message: `scene "${scene.id}" shows nothing at ${at(0)}: the first frame, the video's thumbnail, is blank; ${why}. Show something at t = 0, or accept a blank thumbnail` }];
}

// A title whose `exit` preset was applied (withDefaults marks it `exitPreset`) left on purpose: it counts as present.
function emptyEndProblems(scene, i, samples, size) {
  const last = samples[samples.length - 1];
  if (!scene.elements.length || last.els.some((m, j) => isShown(m, size) || scene.elements[j].exitPreset)) return [];
  return [{ path: `scenes[${i}]`, message: `scene "${scene.id}" ends with nothing on screen: every element is invisible or off the canvas (at ${at(last.t)})` }];
}

// A number-plus-unit token that wraps at any sampled moment, once per distinct token, at the first moment it was seen.
// The renderer binds tokens with U+00A0 (template/renderer.mjs), so this fires only when that binding is lost.
export function wrapProblems(scene, i, samples) {
  const first = new Map();
  for (const { t, wraps } of samples) for (const { text } of wraps) if (!first.has(text)) first.set(text, t);
  return [...first].map(([text, t]) => ({ path: `scenes[${i}]`, message: `a number-plus-unit token wraps across lines: "${text}" at ${at(t)}` }));
}

// The two layers of a crossfade are both on screen at the window's midpoint: warn about text over text.
async function crossfadeWarnings(page, spec, fade, size) {
  const mid = (fade.start + fade.end) / 2;
  const outgoing = await page.evaluate(measure, [mid, fade.from]);
  const incoming = await page.evaluate(measure, [mid, fade.to]);
  const from = spec.scenes[fade.from];
  const to = spec.scenes[fade.to];
  const texts = (scene, els) => els.map((m, j) => ({ m, el: scene.elements[j], j })).filter(({ m, el }) => CHECKED.has(el.type) && isShown(m, size));
  const old = texts(from, outgoing);
  return texts(to, incoming).flatMap((now) => {
    const under = old.find((o) => overlaps(o.m.box, now.m.box));
    if (!under) return [];
    return [{ path: `scenes[${fade.to}].elements[${now.j}]`, message: `${now.el.type} "${now.el.id}" overlaps ${under.el.type} "${under.el.id}" of the outgoing scene "${from.id}" during the crossfade at ${at(mid)}; move one of them, or let the outgoing text exit first` }];
  });
}

async function sampleScene(page, scene, index, start, fps) {
  const samples = [];
  for (const t of sheetTimes(scene, fps)) {
    const els = await page.evaluate(measure, [start + t, index]);
    const ids = els.map((m) => m.id).join();
    if (ids !== scene.elements.map((el) => el.id).join()) throw new Error(`scene "${scene.id}": the page shows elements ${ids}, not the spec's`);
    samples.push({ t, els, wraps: await nowrapProblems(page, { root: '#stage' }) });
  }
  return samples;
}

// Wait until the page has built its stage (window.__motion.ready), at most `ms`: a page that never gets there fails the
// check with a clear message instead of hanging. A failed build rejects `ready` and surfaces its own message.
export async function waitReady(page, ms = READY_MS) {
  const work = (async () => {
    await page.waitForFunction(() => window.__motion, null, { timeout: 0 });
    await page.evaluate(() => window.__motion.ready);
  })();
  work.catch(() => {}); // after a timeout, closing the browser rejects whatever was in flight
  let timer;
  const seconds = Number((ms / 1000).toFixed(2));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the page did not become ready within ${seconds} s (any page error is printed above)`)), ms);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// `prepare(page)`: an optional hook run once the page is ready and before any sampling (tests use it to undo the
// renderer's U+00A0 binding, so the wrap rule can be shown firing through the real sampling, report and exit code).
async function inspect(browser, spec, server, prepare) {
  const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`));
  await guardNetwork(page, new URL(server.url).origin, (url) => process.stderr.write(`blocked network request: ${url}\n`));
  await page.goto(server.url);
  await waitReady(page);
  await prepare?.(page);
  const starts = await page.evaluate(() => window.__motion.sceneStarts);
  const margin = safeMargin(spec.size);
  const problems = [];
  const warnings = frameZeroWarnings(spec.scenes[0], await page.evaluate(measure, [0, 0]), spec.size);
  let moments = 0;
  for (const [i, scene] of spec.scenes.entries()) {
    const samples = await sampleScene(page, scene, i, starts[i], spec.fps);
    moments += samples.length;
    problems.push(...safeAreaProblems(scene, i, samples, margin, spec.size), ...overlapProblems(scene, i, samples, spec.size), ...emptyEndProblems(scene, i, samples, spec.size), ...wrapProblems(scene, i, samples));
  }
  for (const fade of await page.evaluate(() => window.__motion.crossfades)) warnings.push(...await crossfadeWarnings(page, spec, fade, spec.size));
  return { status: problems.length ? 'failed' : 'ok', scenes: spec.scenes.length, moments, problems, warnings };
}

async function checkSpec(specPath, spec, { env, theme, prepare }) {
  if (env.PA_NO_BROWSER === '1') return { status: 'skipped', reason: 'PA_NO_BROWSER=1' };
  let browser;
  try {
    browser = await launchBrowser({ quiet: true });
  } catch (e) {
    return { status: 'skipped', reason: firstLine(e) };
  }
  let server;
  try {
    server = await startServer({ specPath, mode: 'render', theme });
    return await inspect(browser, spec, server, prepare);
  } finally {
    await browser.close().catch(() => {});
    await server?.close();
  }
}

function checkTheme(name) {
  const themes = listThemes();
  if (themes.includes(name)) return;
  const near = didYouMean(name, themes);
  throw new UsageError(`--theme: unknown theme ${JSON.stringify(name)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `available: ${themes.join(', ')}`}`);
}

function report(result, json) {
  const { status, problems = [], warnings = [] } = result;
  const noted = warnings.length ? { warnings } : {};
  if (json) {
    const body = status === 'skipped' ? { ok: true, skipped: true, reason: result.reason, hint: skipHint() }
      : status === 'ok' ? { ok: true, scenes: result.scenes, moments: result.moments, ...noted }
        : { ok: false, ...(result.crashed ? { crashed: true } : {}), errors: problems, ...noted };
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return;
  }
  for (const w of warnings) process.stderr.write(`warning: ${w.path}: ${w.message}\n`); // stderr: stdout stays the verdict alone
  if (status === 'skipped') process.stdout.write(`check: skipped (no browser: ${result.reason}; ${skipHint()})\n`);
  else if (status === 'ok') process.stdout.write(`check: ok (${result.scenes} scene${result.scenes === 1 ? '' : 's'}, ${result.moments} moments)\n`);
  else {
    for (const p of problems) process.stdout.write(p.path ? `${p.path}: ${p.message}\n` : `${p.message}\n`);
    // A crash is not a spec problem: its line stands alone, with no tally to "fix".
    if (!result.crashed) process.stdout.write(`check: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
  }
}

export async function main(argv, { prepare } = {}) {
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
    json = values.json === true;
    if (positionals.length !== 1) throw new UsageError(`expected one motion.json; usage: ${USAGE}`);
    if (values.theme !== undefined) checkTheme(values.theme);
    const { spec: raw, dir } = loadSpec(positionals[0]);
    const valid = validateSpec(raw, { dir });
    if (!valid.ok) {
      printResult(valid, { json, label: positionals[0] });
      return 1;
    }
    // The theme the page draws decides the title presets (and so the settle times): the spec's own, else --theme.
    const spec = withDefaults(raw.theme === undefined && values.theme !== undefined ? { ...raw, theme: values.theme } : raw);
    const result = await checkSpec(path.resolve(positionals[0]), spec, { env: process.env, theme: values.theme, prepare });
    report(result, json);
    return result.status === 'failed' ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError || e instanceof SpecUsageError) {
      exitUsage(e, { json });
      return 2;
    }
    report({ status: 'failed', crashed: true, problems: [{ path: '', message: `check crashed: ${crashLine(e)}` }] }, json); // never a stack trace
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

#!/usr/bin/env node
// node scripts/check.mjs <motion.json> [--json] [--theme <name>]
// Seeks the real render page to every contact-sheet moment of every scene (sheetTimes) and reads each element's box
// and opacity from the DOM. Fails on: a visible text or counter outside the safe area while it is not moving; two
// visible text or counter boxes overlapping while neither is moving or fading; a scene with nothing on screen at its
// last frame (a title whose `exit` preset was applied left on purpose and counts as present); a number-plus-unit token
// ("1,204 ms", "87%") drawn across more than one line, reported once per token per scene. A box wholly off the canvas
// has left the frame: it is never clipped, overlaps nothing, and is not on screen.
// A `group` is not judged itself; each of its children is, at its nested path (scenes[0].elements[2].children[1]), and a
// child counts as moving while any group around it moves.
// A warning (never a failure; exit stays 0) when the first scene shows nothing at t = 0: stderr, or `warnings` in --json.
// A scene is judged on its own layer, so the outgoing scene of a crossfade is not part of the incoming scene's own
// checks (the incoming scene's first 0.4 s are sampled, from the 0.1 s first look on). Instead each crossfade window is
// sampled at its midpoint, and a visible text or counter of the incoming scene that overlaps one of the outgoing scene
// there is a warning (never a failure).
// With a `captions` track: a visible text or counter that sits in the caption zone (template/formats.mjs captionZone)
// while it is not moving and a caption is on screen is a problem, and so is a captions layer that leaves the zone: each
// layer is measured once per caption group (at its midpoint, and for kinetic at each word's start), its box joined with
// every word's so transforms and the kinetic pop count.
// A finding inside a block (a part of its expansion) names the block instead: its own path, the block and part, and the
// param to change (`scenes[0].elements[1]: text "lt/name" leaves the safe area (right) at 0.90s (block "lower-third",
// part "name"); shorten params.name or move the block`).
// --theme: the theme render.mjs --theme would draw a spec that names none in (a spec's own `theme` wins).
// A spec with a video element has its frames decoded first, as render.mjs does, so it needs ffmpeg and ffprobe too.
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
import { flattenElements, isGroup } from '../template/groups.mjs';
import { isBlock, paramOfPart } from '../template/blocks/index.mjs';
import { safeMargin, safeInsets, captionZone } from '../template/formats.mjs';
import { nowrapProblems } from '../shared/nowrap-probe.mjs';
import { doctorCommand } from './lib/doctor-hint.mjs';
import { findFfmpeg, findFfprobe } from './lib/ffmpeg.mjs';
import { specHasVideo, prepareVideo } from './lib/video.mjs';
import { themeData } from './lib/theme.mjs';
import {
  CHECKED_TYPES, tweenSpans, inTween, auditTimes, backdropColors, contrastFindings, textFloorFindings, readingFloorFindings, deadStretchProblems,
} from './lib/audits.mjs';

const USAGE = 'node scripts/check.mjs <motion.json> [--json] [--theme <name>]';
const OPTIONS = { json: { type: 'boolean' }, theme: { type: 'string' } };
const READY_MS = 30000; // the page must build its stage within this (render.mjs's first wait), or the check fails instead of hanging
const CHECKED = new Set(CHECKED_TYPES); // rendered text: the element types the rules judge
const SUBPIXEL_PX = 0.5; // a box edge this close to the safe line is on it
const VISIBLE_OPACITY = 0.05; // rendered opacity (element x scene) above this counts as visible
const OVERLAP_TOLERANCE_PX = 2; // an intersection this thin on either axis is a shared edge, not an overlap
const GEOMETRY = ['x', 'y', 'scale', 'rotate']; // keyframed props that move or resize a box (opacity does not)
const POSE = [...GEOMETRY, 'opacity']; // ... and, for overlaps, the ones that fade it in or out too
const EPSILON = 1e-6;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
// A page error surfaces as "page.evaluate: Error: <message>"; the crash line keeps only the message.
const crashLine = (e) => firstLine(e).replace(/^(page|frame)\.\w+: (Error: )?/, '');
export { safeMargin }; // the safe-area margin lives in template/formats.mjs; this export stays for callers of check.mjs
const skipHint = () => `ask the user, then run: ${doctorCommand('--for', 'check', '--fix', 'chromium')}`;

// Holds: an element is in motion at scene-local `t` when `t` lies strictly inside the span between two consecutive
// keyframes that set the same prop of a rule's set, and in a hold otherwise (before its first keyframe, between
// tweens, after its last). The safe-area rule judges an element only in a GEOMETRY hold, so an entrance from
// off-canvas is not a finding but where it lands is, and a placement held before an exit is. The overlap rule judges a
// pair only when both are in a POSE hold, so a cross-fade swap in one spot is not a finding but an overlap held before
// an exit fade is. sheetTimes samples every landing + 0.1 s, so every element gets a held moment after each move; the
// scene's last frame is always judged (the fallback for a continuous drift that never holds).
const isHeld = (spans, t, n, samples) => n === samples.length - 1 || !inTween(spans, t); // tweenSpans and inTween: lib/audits.mjs

// What the rules judge in a scene, as the page draws it: every element that is not a group, at any depth, in document
// order, each as { el, path, chain }. `path` is where it sits in the spec; `chain` is the groups around it, outermost
// first, then the element itself, because a child's keyframes are not the only thing that moves it. `hold`: the element
// or a group around it says "hold": true (it may sit still).
export function sceneItems(scene, index) {
  const chain = [];
  return flattenElements(scene.elements, `scenes[${index}]`).flatMap(({ el, path: where, depth }) => {
    chain.length = depth;
    chain.push(el);
    return isGroup(el) ? [] : [{ el, path: where, chain: [...chain], hold: chain.some((c) => c.hold === true) }];
  });
}

// Runs in the page: seek to `sec`, then each element of scene layer `index` (a group's children included, the groups
// themselves not) as {id, opacity, ownOpacity, box, undrawn, sig, fontSize, weight, color, alpha} in canvas pixels.
// Rendered opacity multiplies the element's and every ancestor's up to the stage (a group's, the scene fade); a hidden
// layer is 0. `ownOpacity` leaves the scene's fade out. `types`: the element types that are text (CHECKED_TYPES).
// `fontSize` is a text's or counter's size as drawn (its font size times every scale around it), `weight` and `color`
// (#rrggbb) are what it is drawn with, and `sig` a string that differs whenever the element looks different (position,
// size, opacity, text, drawing, reveal, video frame), for the dead-stretch audit.
const measure = async ([sec, index, types]) => {
  await window.__motion.seek(sec); // a video element's frame is decoded before anything is read
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const k = window.__motion.size[0] / s.width;
  const layer = stage.querySelectorAll(':scope > .scene')[index];
  const shown = getComputedStyle(layer).display !== 'none';
  const hex = (css) => `#${(css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`;
  return [...layer.querySelectorAll('.el:not(.group)')].map((node) => {
    let opacity = shown ? 1 : 0;
    let ownOpacity = 1;
    let scale = 1;
    for (let n = node; n && n !== stage; n = n.parentElement) {
      const style = getComputedStyle(n);
      opacity *= Number(style.opacity);
      if (n !== layer) ownOpacity *= Number(style.opacity);
      const m = new DOMMatrix(style.transform);
      scale *= Math.hypot(m.a, m.b);
    }
    const r = node.getBoundingClientRect();
    const box = { left: (r.left - s.left) * k, top: (r.top - s.top) * k, right: (r.right - s.left) * k, bottom: (r.bottom - s.top) * k };
    // Nothing drawn yet: a chart at reveal 0, a line (or unfilled shape) at draw 0 (a filled shape shows its fill), or a
    // typing text with no characters typed (its caret alone is not content).
    const mark = node.querySelector(':scope > svg > :first-child');
    const untyped = node.querySelector(':scope > .typed')?.textContent === '';
    const undrawn = untyped || node.dataset.reveal === '0' || (mark !== null && mark.getAttribute('stroke-dashoffset') === '1' && (mark.tagName === 'line' || mark.getAttribute('fill') === 'none'));
    const own = getComputedStyle(node);
    const isText = types.some((type) => node.classList.contains(type));
    const colour = own.color.match(/[\d.]+/g) ?? [];
    const content = [node.textContent, node.dataset.reveal ?? '', mark?.getAttribute('stroke-dashoffset') ?? '', node.querySelector('img')?.getAttribute('src') ?? ''].join('\u0001');
    const sig = `${[box.left, box.top, box.right, box.bottom].map((v) => v.toFixed(1)).join(',')}|${opacity.toFixed(2)}|${content}`;
    return {
      id: node.dataset.id, opacity, ownOpacity, box, undrawn, sig,
      fontSize: isText ? parseFloat(own.fontSize) * scale : 0, weight: Number(own.fontWeight), color: isText ? hex(own.color) : '#000000', alpha: isText && colour.length > 3 ? Number(colour[3]) : 1,
    };
  });
};

// Runs in the page: seek to `sec` (null: stay where `measure` put it), then each captions layer (a stage child, one
// per track) as {index, shown, box, text} in canvas pixels; `shown` is false while the track has no group on screen. The box
// joins the layer's with each word's, so a scaled (kinetic) word that pokes out of the layer counts.
const measureCaptions = async (sec) => {
  if (sec !== null) await window.__motion.seek(sec);
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const k = window.__motion.size[0] / s.width;
  return [...stage.querySelectorAll(':scope > .captions')].map((node) => {
    const rects = [node, ...node.querySelectorAll('.word')].map((n) => n.getBoundingClientRect());
    const edge = (side, pick) => pick(...rects.map((r) => r[side]));
    const box = { left: (edge('left', Math.min) - s.left) * k, top: (edge('top', Math.min) - s.top) * k, right: (edge('right', Math.max) - s.left) * k, bottom: (edge('bottom', Math.max) - s.top) * k };
    return { index: Number(node.dataset.index), shown: getComputedStyle(node).display !== 'none', box, text: node.textContent };
  });
};

// `measure` at video second `sec` for scene layer `index`.
const measureAt = (page, sec, index) => page.evaluate(measure, [sec, index, [...CHECKED_TYPES]]);

const at = (t) => `${t.toFixed(2)}s`;
const isVisible = (m) => m.opacity > VISIBLE_OPACITY;
const onCanvas = ({ box }, size) => box.right > 0 && box.left < size[0] && box.bottom > 0 && box.top < size[1];
const isShown = (m, size) => isVisible(m) && onCanvas(m, size) && !m.undrawn; // seen in the frame, at least in part

function safeAreaProblems(items, samples, insets, size) {
  const problems = [];
  items.forEach(({ el, path: where, chain }, j) => {
    if (!CHECKED.has(el.type)) return;
    const spans = tweenSpans(chain, GEOMETRY);
    for (const [n, { t, els }] of samples.entries()) {
      const { box } = els[j];
      if (!isShown(els[j], size) || !isHeld(spans, t, n, samples)) continue;
      const edges = [['top', insets.top - box.top], ['bottom', box.bottom - (size[1] - insets.bottom)], ['left', insets.left - box.left], ['right', box.right - (size[0] - insets.right)]]
        .filter(([, by]) => by > SUBPIXEL_PX).map(([edge]) => edge);
      if (!edges.length) continue;
      problems.push({ path: where, message: `${el.type} "${el.id}" leaves the safe area (${edges.join(', ')}) at ${at(t)}` });
      return;
    }
  });
  return problems;
}

// The edges of `box` that lie more than half a pixel outside `rect`.
const edgesOutside = (box, rect) => [['top', rect.top - box.top], ['bottom', box.bottom - rect.bottom], ['left', rect.left - box.left], ['right', box.right - rect.right]]
  .filter(([, by]) => by > SUBPIXEL_PX).map(([edge]) => edge);

/** The problem when a visible captions box at video time `t` is not inside the caption zone, else null. Pure. */
export function captionBoxProblem(box, zone, t) {
  const edges = edgesOutside(box, zone);
  return edges.length ? `captions leave the caption zone (${edges.join(', ')}) at ${at(t)}` : null;
}

const intersects = (box, rect) => Math.min(box.right, rect.right) - Math.max(box.left, rect.left) > SUBPIXEL_PX
  && Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top) > SUBPIXEL_PX;

// A visible text or counter held in the caption zone while a caption is on screen would sit under it: once per element,
// as the safe area. With no caption showing, the lower band is free to use. Judged at the scene's sheet moments and at
// `extra`, the caption moments inside the scene (every group's midpoint), so a caption shown only between sheet moments
// is seen too; only the scene's last sheet moment counts as held whatever moves.
function captionZoneProblems(items, samples, extra, zone, size) {
  const problems = [];
  const moments = [...samples.map((m, n) => ({ ...m, last: n === samples.length - 1 })), ...extra.map((m) => ({ ...m, last: false }))].sort((a, b) => a.t - b.t);
  items.forEach(({ el, path: where, chain }, j) => {
    if (!CHECKED.has(el.type)) return;
    const spans = tweenSpans(chain, GEOMETRY);
    const held = ({ t, last }) => last || isHeld(spans, t, -1, samples);
    const hit = moments.find((m) => m.captions.some((c) => c.shown) && isShown(m.els[j], size) && held(m) && intersects(m.els[j].box, zone));
    if (hit) problems.push({ path: where, message: `${el.type} "${el.id}" sits in the caption zone (y >= ${zone.top}) at ${at(hit.t)}; move it above y ${zone.top} or end the captions before it` });
  });
  return problems;
}

// Each captions track whose layer leaves the zone, once, at the first of its moments (window.__motion.captionMoments,
// video time) where it does.
async function captionLayerProblems(page, zone) {
  const problems = [];
  const reported = new Set();
  for (const { index, t } of await page.evaluate(() => window.__motion.captionMoments)) {
    if (reported.has(index)) continue;
    const layer = (await page.evaluate(measureCaptions, t)).find((c) => c.index === index);
    const message = layer?.shown ? captionBoxProblem(layer.box, zone, t) : null;
    if (!message) continue;
    reported.add(index);
    problems.push({ path: `captions[${index}]`, message });
  }
  return problems;
}

const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > OVERLAP_TOLERANCE_PX
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > OVERLAP_TOLERANCE_PX;

function overlapProblems(items, samples, size) {
  const problems = [];
  const texts = items.map((item, j) => ({ ...item, j, spans: tweenSpans(item.chain, POSE) })).filter(({ el }) => CHECKED.has(el.type));
  for (const [b, second] of texts.entries()) {
    for (const first of texts.slice(0, b)) {
      const hit = samples.find(({ t, els }, n) => isHeld(first.spans, t, n, samples) && isHeld(second.spans, t, n, samples)
        && isShown(els[first.j], size) && isShown(els[second.j], size) && overlaps(els[first.j].box, els[second.j].box));
      if (hit) {
        problems.push({ path: second.path, message: `${second.el.type} "${second.el.id}" overlaps ${first.el.type} "${first.el.id}" at ${at(hit.t)}` });
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
function frameZeroWarnings(scene, items, els, size) {
  if (scene.background === ART_BACKGROUND || !items.length || els.some((m) => isShown(m, size))) return [];
  const involved = [...new Set(items.flatMap(({ chain }) => chain))]; // a group that starts invisible hides its children
  const invisible = involved.filter(startsInvisible);
  const undrawn = involved.filter(startsUndrawn);
  const empty = involved.filter(startsEmpty);
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
function emptyEndProblems(scene, i, items, samples, size) {
  const last = samples[samples.length - 1];
  if (!items.length || last.els.some((m, j) => isShown(m, size) || items[j].el.exitPreset)) return [];
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
async function crossfadeWarnings(page, spec, itemsOf, fade, size) {
  const mid = (fade.start + fade.end) / 2;
  const outgoing = await measureAt(page, mid, fade.from);
  const incoming = await measureAt(page, mid, fade.to);
  const from = spec.scenes[fade.from];
  const texts = (items, els) => els.map((m, j) => ({ m, ...items[j] })).filter(({ m, el }) => CHECKED.has(el.type) && isShown(m, size));
  const old = texts(itemsOf[fade.from], outgoing);
  return texts(itemsOf[fade.to], incoming).flatMap((now) => {
    const under = old.find((o) => overlaps(o.m.box, now.m.box));
    if (!under) return [];
    return [{ path: now.path, message: `${now.el.type} "${now.el.id}" overlaps ${under.el.type} "${under.el.id}" of the outgoing scene "${from.id}" during the crossfade at ${at(mid)}; move one of them, or let the outgoing text exit first` }];
  });
}

// `withCaptions`: also measure the captions layers at each moment. `times`: scene-local seconds (the sheet moments).
// `withBackdrop`: also read the colour behind every text that is on screen (one screenshot per moment), for the contrast
// audit: `back[j]` for item j, the colours of the cells behind it (see backdropColors), null where they were not read.
async function sampleScene(page, scene, items, index, start, times, withCaptions, size, withBackdrop = false) {
  const fading = items.map(({ chain }) => tweenSpans(chain, ['opacity'])); // the contrast audit leaves a text mid-fade alone
  const samples = [];
  for (const t of times) {
    const measured = await measureAt(page, start + t, index);
    const ids = measured.map((m) => m.id).join();
    if (ids !== items.map(({ el }) => el.id).join()) throw new Error(`scene "${scene.id}": the page shows elements ${ids}, not the spec's`);
    const els = measured.map((m) => ({ ...m, shown: isShown(m, size) }));
    const judged = els.flatMap((m, j) => (CHECKED.has(items[j].el.type) && m.shown && !inTween(fading[j], t) ? [j] : []));
    const back = els.map(() => null);
    if (withBackdrop && judged.length) (await backdropColors(page, judged.map((j) => els[j].box), [...CHECKED])).forEach((cells, n) => { back[judged[n]] = cells; });
    const captions = withCaptions ? await page.evaluate(measureCaptions, null) : [];
    samples.push({ t, els, back, captions, wraps: await nowrapProblems(page, { root: '#stage' }) });
  }
  return samples;
}

// The AUDIT_STEP grid of one scene, exported for the checks that build on it (`stillStretches` takes the steps of every
// scene in order): { t (video seconds), scene, local (scene seconds), els, captions } per step. Each
// element carries `shown`, `hold` (it, or a group around it, says "hold": true) and `held` (its size is not being tweened,
// so the text floor judges it); `captions` is a string that changes when the words on screen do.
export async function sampleSteps(page, items, index, scene, start, withCaptions, size) {
  const sizeSpans = items.map(({ chain }) => tweenSpans(chain, ['scale']));
  const steps = [];
  for (const local of auditTimes(scene.duration)) {
    const measured = await measureAt(page, start + local, index);
    const els = measured.map((m, j) => ({ ...m, shown: isShown(m, size), hold: items[j].hold, held: !inTween(sizeSpans[j], local) }));
    const layers = withCaptions ? await page.evaluate(measureCaptions, null) : [];
    steps.push({ t: start + local, scene: index, local, els, captions: layers.map((c) => `${c.shown}:${c.text}`).join('\u0001') });
  }
  return steps;
}

// The caption moments (video seconds) inside a scene that starts at `start`, as scene-local seconds, leaving out the
// sheet moments already sampled.
function captionMomentsIn(captionTimes, start, duration, sheet) {
  const ms = (sec) => Math.round(sec * 1000);
  const taken = new Set(sheet.map(ms));
  const local = captionTimes.filter((t) => t >= start && t < start + duration).map((t) => t - start);
  return [...new Map(local.filter((t) => !taken.has(ms(t))).map((t) => [ms(t), t])).values()].sort((a, b) => a - b);
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
  const insets = safeInsets(spec.size);
  const problems = [];
  const itemsOf = spec.scenes.map(sceneItems); // the non-group elements of each scene, indexed as the page measures them
  const warnings = frameZeroWarnings(spec.scenes[0], itemsOf[0], await measureAt(page, 0, 0), spec.size);
  const zone = spec.captions.length ? captionZone(spec.size, spec.format) : null; // the caption rules need captions
  const captionTimes = zone ? await page.evaluate(() => window.__motion.captionMoments.map((m) => m.t)) : [];
  const colors = themeData(spec.theme)?.dark ?? {};
  const steps = [];
  let moments = 0;
  for (const [i, scene] of spec.scenes.entries()) {
    const items = itemsOf[i];
    const times = sheetTimes(scene, spec.fps);
    const samples = await sampleScene(page, scene, items, i, starts[i], times, zone !== null, spec.size, true);
    const extraTimes = captionMomentsIn(captionTimes, starts[i], scene.duration, times);
    const extra = extraTimes.length ? await sampleScene(page, scene, items, i, starts[i], extraTimes, true, spec.size) : [];
    const own = await sampleSteps(page, items, i, scene, starts[i], zone !== null, spec.size);
    steps.push(...own);
    moments += samples.length + extra.length;
    const contrast = contrastFindings(items, samples, colors, spec.size);
    const floor = textFloorFindings(items, own, scene.duration, spec.size);
    problems.push(...safeAreaProblems(items, samples, insets, spec.size), ...overlapProblems(items, samples, spec.size), ...emptyEndProblems(scene, i, items, samples, spec.size), ...wrapProblems(scene, i, samples), ...contrast.problems, ...floor.problems);
    warnings.push(...contrast.warnings, ...floor.warnings);
    if (zone) problems.push(...captionZoneProblems(items, samples, extra, zone, spec.size));
  }
  const probe = async (i, j, local) => isShown((await measureAt(page, starts[i] + local, i))[j], spec.size); // the reading floor places a span's edges with these
  const reading = await readingFloorFindings(spec, itemsOf, steps, probe);
  problems.push(...reading.problems, ...deadStretchProblems(spec, steps, itemsOf));
  if (zone) problems.push(...await captionLayerProblems(page, zone));
  for (const fade of await page.evaluate(() => window.__motion.crossfades)) warnings.push(...await crossfadeWarnings(page, spec, itemsOf, fade, spec.size));
  return { status: problems.length ? 'failed' : 'ok', scenes: spec.scenes.length, moments, problems, warnings, info: reading.info };
}

// Decoding needs ffmpeg; without it findFfmpeg's install hint ends the check as a crash line.
async function prepareFrames(specPath, spec) {
  const ffmpeg = await findFfmpeg();
  return prepareVideo(spec, path.dirname(specPath), ffmpeg, findFfprobe({ ffmpeg }), spec.fps);
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
    // The render page draws a video element from its decoded frames, so they are prepared as render.mjs prepares them.
    const videoFrames = specHasVideo(spec) ? await prepareFrames(specPath, spec) : {};
    server = await startServer({ specPath, mode: 'render', theme, videoFrames });
    return await inspect(browser, spec, server, prepare);
  } finally {
    await browser.close().catch(() => {});
    await server?.close();
  }
}

// `findings` (problems or warnings, on the expanded `spec`) with each one inside a block moved to the block as `written`.
const PART_PATH = /^scenes\[(\d+)\]\.elements\[(\d+)\]\.children\[(\d+)\]/;
export function atBlockParts(written, spec, findings) {
  return findings.map((finding) => {
    const m = PART_PATH.exec(finding.path ?? '');
    const el = m && written.scenes[m[1]]?.elements?.[m[2]];
    if (!isBlock(el)) return finding;
    const part = spec.scenes[m[1]].elements[m[2]].children[m[3]].id.slice(el.id.length + 1);
    const hint = blockHint(finding.message, paramOfPart(el.block, part));
    return { path: `scenes[${m[1]}].elements[${m[2]}]`, message: `${finding.message} (block ${JSON.stringify(el.block)}, part ${JSON.stringify(part)})${hint ? `; ${hint}` : ''}` };
  });
}

// What to change for a finding about a block part, matched to the finding; null when its message already says it (the
// caption-zone rule says to move it above the zone, the crossfade warning to move one or let the other exit).
function blockHint(message, param) {
  const shorten = param ? ` or shorten params.${param}` : '';
  if (message.includes(' sits in the caption zone ') || message.includes(' during the crossfade')) return null;
  if (message.includes(' contrast against its backdrop ')) return 'blocks use theme colours; change "theme" or the scene background';
  if (/ is \d+px \(below /.test(message)) return 'raise the block\'s "scale" or use a larger format';
  if (message.includes(' shows for ')) return `lengthen the scene${shorten}`;
  const other = / overlaps \w+ "([^"]+)"/.exec(message);
  if (other) return other[1].includes('/') ? `move one of the blocks${shorten}` : `move the block or the other element${shorten}`;
  return param ? `shorten params.${param} or move the block` : 'move the block or change its params';
}

function checkTheme(name) {
  const themes = listThemes();
  if (themes.includes(name)) return;
  const near = didYouMean(name, themes);
  throw new UsageError(`--theme: unknown theme ${JSON.stringify(name)}; ${near ? `did you mean ${JSON.stringify(near)}?` : `available: ${themes.join(', ')}`}`);
}

function report(result, json) {
  const { status, problems = [], warnings = [], info = [] } = result;
  const noted = { ...(warnings.length ? { warnings } : {}), ...(info.length ? { info } : {}) };
  if (json) {
    const body = status === 'skipped' ? { ok: true, skipped: true, reason: result.reason, hint: skipHint() }
      : status === 'ok' ? { ok: true, scenes: result.scenes, moments: result.moments, ...noted }
        : { ok: false, ...(result.crashed ? { crashed: true } : {}), errors: problems, ...noted };
    process.stdout.write(`${JSON.stringify(body)}\n`);
    return;
  }
  for (const w of warnings) process.stderr.write(`warning: ${w.path}: ${w.message}\n`); // stderr: stdout stays the verdict alone
  for (const n of info) process.stderr.write(`info: ${n.path}: ${n.message}\n`); // information only: never changes the verdict
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
    const checked = await checkSpec(path.resolve(positionals[0]), spec, { env: process.env, theme: values.theme, prepare });
    const result = { ...checked, ...(checked.problems && { problems: atBlockParts(raw, spec, checked.problems) }), ...(checked.warnings && { warnings: atBlockParts(raw, spec, checked.warnings) }), ...(checked.info && { info: atBlockParts(raw, spec, checked.info) }) };
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

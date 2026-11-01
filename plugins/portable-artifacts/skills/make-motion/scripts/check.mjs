#!/usr/bin/env node
// node scripts/check.mjs <motion.json> [--json] [--theme <name>]
// Seeks the real render page to every contact-sheet moment of every scene (sheetTimes) and reads each element's box
// and opacity from the DOM. Fails on: a visible text or counter outside the safe area while it is not moving; two
// visible text or counter boxes overlapping while neither is moving or fading; a scene with nothing on screen at its
// last frame (a title whose `exit` preset was applied left on purpose and counts as present); a number-plus-unit token
// ("1,204 ms", "87%") drawn across more than one line, reported once per token per scene. A box wholly off the canvas
// has left the frame: it is never clipped, overlaps nothing, and is not on screen. A `code` element is text to every rule
// here (CHECKED_TYPES), its contrast judged by its worst token colour.
// A scene `camera` is part of every box and font size (the page is read after it). A camera tween counts as every element
// of the scene moving for the safe-area, overlap and caption-zone rules, exactly as an element's own tween does (judged
// where it settles and at the last frame; spansOf, isHeld); two equal keyframes are a hold, not a move. A shake has no
// keyframes and does not count as moving, so its elements are judged where the shake puts them. The dead-stretch audit
// reads the camera node's transform at every step (sampleSteps), so only a camera that really changes counts as change.
// A `group` is not judged itself; each of its children is, at its nested path (scenes[0].elements[2].children[1]), and a
// child counts as moving while any group around it moves.
// A warning (never a failure; exit stays 0) when the first scene shows nothing at t = 0: stderr, or `warnings` in --json.
// A scene is judged on its own layer, where it settles, so the outgoing scene of a transition (crossfade, push, slide,
// wipe, zoom, blur or iris) is not part of the incoming scene's own checks, nor is the styling that carries it in (it is
// lifted for every sample, so the samples inside the window, 0.1 to 2 s long, judge the scene where it settles). Instead
// each transition window is sampled at its midpoint, with both layers drawn as they are, and a visible text or counter of
// the incoming scene that overlaps one of the outgoing scene there is a warning (never a failure). A window, a `fade`'s
// included, is change for the dead-stretch audit, and a text is not judged for contrast while its scene is coming in
// (the screenshot is two layers then, or the scene half faded in); a text that shows only inside its window gets an
// `info:` line (never changing the exit code).
// With a `captions` track: a visible text or counter that sits in the caption zone (template/formats.mjs captionZone)
// while it is not moving and a caption is on screen is a problem, and so is a captions layer that leaves the zone: each
// layer is measured once per caption group (at its midpoint, and for kinetic at each word's start), its box joined with
// every word's so transforms and the kinetic pop count.
// A finding inside a block (a part of its expansion) names the block instead: its own path, the block and part, and the
// param to change (`scenes[0].elements[1]: text "lt/name" leaves the safe area (right) at 0.90s (block "lower-third",
// part "name"); shorten params.name or move the block`).
// With `"mode": "viral"`, warnings only (scripts/lib/viral-checks.mjs): a canvas that is not 9:16, audio without
// captions, no 3-7 word hook at frame 0, a held text or counter under a platform band (inside the 60 px safe area), a
// still stretch the dead-stretch audit exempts (the final 3 s, `hold`), and with `viral.loop` a last frame unlike the
// first. The caption rules use the lifted viral zone the page draws captions in. Without a browser the spec-level
// ones (format, captions, change gaps read from the spec's keyframes and captions files) still print.
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
import { isViral } from '../template/viral.mjs';
import { substituteVars } from '../template/vars.mjs';
import { TRANSITIONS, comesInOver, normalizeTransition, windowSeconds } from '../template/transitions.mjs';
import { cameraTweens } from '../template/camera.mjs';
import { specWarnings, hookWarnings, stillWarnings, gapWarnings, loopWarnings, frameDifference } from './lib/viral-checks.mjs';
import { findFfmpeg, findFfprobe } from './lib/ffmpeg.mjs';
import { specHasVideo, prepareVideo } from './lib/video.mjs';
import { themeData } from './lib/theme.mjs';
import {
  CHECKED_TYPES, NO_PASSING_COLOUR, tweenSpans, inTween, auditTimes, backdropColors, contrastFindings, unjudgedContrast, textFloorFindings, readingFloorFindings, deadStretchProblems,
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
// A scene camera move (`spans.camera`: a property that changes value, not two equal keyframes) is a move of everything and is
// exempt while it runs exactly as an element's own move is: where it starts is not judged, where it settles is.
const isHeld = ({ own, camera }, t, n, samples) => n === samples.length - 1 || (!inTween(own, t) && !inTween(camera, t)); // tweenSpans and inTween: lib/audits.mjs

// What the rules judge in a scene, as the page draws it: every element that is not a group, at any depth, in document
// order, each as { el, path, chain, camera }. `path` is where it sits in the spec; `chain` is the groups around it, outermost
// first, then the element itself, because a child's keyframes are not the only thing that moves it. `camera`: the scene's
// camera, or null: the camera moves everything in the scene, so a move of it (cameraTweens) is a move of every item
// (spansOf). A shake has no keyframes, so it is never "moving" here: the rules judge an element
// under a shake where it is at each sampled moment. `hold`: the element or a group around it says "hold": true (it may
// sit still).
export function sceneItems(scene, index) {
  const chain = [];
  const camera = scene.camera ?? null;
  return flattenElements(scene.elements, `scenes[${index}]`).flatMap(({ el, path: where, depth }) => {
    chain.length = depth;
    chain.push(el);
    return isGroup(el) ? [] : [{ el, path: where, chain: [...chain], camera, hold: chain.some((c) => c.hold === true) }];
  });
}

// The tween spans of `props` that move an item: { own: its own and its groups', camera: the scene camera's }.
const spansOf = ({ chain, camera }, props) => ({ own: tweenSpans(chain, props), camera: cameraTweens(camera, props) });

// Runs in the page: seek to `sec`, then each element of scene layer `index` (a group's children included, the groups
// themselves not) as {id, opacity, ownOpacity, box, undrawn, sig, inks, fontSize, weight, color, alpha} in canvas pixels.
// A scene is judged where it settles: unless `placed`, the layer's transition styles (the push or zoom that carries it
// in, a wipe or iris clip, a blur) are lifted first and stay lifted until the next seek, so the boxes, and the
// screenshot the contrast audit reads, are the scene's own. `placed` keeps them, for the overlap check of a window.
// Rendered opacity multiplies the element's and every ancestor's up to the stage (a group's, the scene fade); a hidden
// layer is 0. `ownOpacity` leaves the scene's fade out. `types`: the element types that are text (CHECKED_TYPES).
// `fontSize` is a text's or counter's size as drawn (its font size times every scale around it), `weight` and `color`
// (#rrggbb) are what it is drawn with, and `sig` a string that differs whenever the element looks different (position,
// size, opacity, text, drawing, reveal, video frame), for the dead-stretch audit.
const measure = async ([sec, index, types, placed]) => {
  await window.__motion.seek(sec); // a video element's frame is decoded before anything is read
  const stage = document.getElementById('stage');
  const s = stage.getBoundingClientRect();
  const k = window.__motion.size[0] / s.width;
  const layer = stage.querySelectorAll(':scope > .scene')[index];
  if (!placed) for (const prop of ['transform', 'clipPath', 'filter']) layer.style[prop] = '';
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
    const untyped = node.querySelector(':scope > .typed')?.textContent === '' || node.dataset.typed === '0'; // a typing code element says its count
    const undrawn = untyped || node.dataset.reveal === '0' || (mark !== null && mark.getAttribute('stroke-dashoffset') === '1' && (mark.tagName === 'line' || mark.getAttribute('fill') === 'none'));
    const own = getComputedStyle(node);
    const isText = types.some((type) => node.classList.contains(type));
    const colour = own.color.match(/[\d.]+/g) ?? [];
    // A typing text's node holds its whole text at every moment (typed, caret, untyped rest), so what is typed so far is
    // read from its `.typed` span; a typing code element says its count in data-typed.
    const typed = node.querySelector(':scope > .typed')?.textContent ?? '';
    const content = [node.textContent, node.dataset.reveal ?? '', mark?.getAttribute('stroke-dashoffset') ?? '', node.querySelector('img')?.getAttribute('src') ?? '', node.dataset.typed ?? '', typed].join('\u0001');
    const sig = `${[box.left, box.top, box.right, box.bottom].map((v) => v.toFixed(1)).join(',')}|${opacity.toFixed(2)}|${content}`;
    // A code element's token colours (template/code-view.mjs marks each coloured span data-ink): the contrast audit judges every one.
    const inks = isText ? [...new Set([...node.querySelectorAll('[data-ink]')].map((n) => hex(getComputedStyle(n).color)))] : [];
    return {
      id: node.dataset.id, opacity, ownOpacity, box, undrawn, sig, inks,
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

// Runs in the page, after a seek: the transform of scene layer `index`'s camera node ('' when it has none).
const measureCamera = (index) => document.getElementById('stage').querySelectorAll(':scope > .scene')[index].querySelector(':scope > .camera')?.style.transform ?? '';

// `measure` at video second `sec` for scene layer `index`; `placed`: where the layer is drawn, transition and all.
const measureAt = (page, sec, index, placed = false) => page.evaluate(measure, [sec, index, [...CHECKED_TYPES], placed]);

const at = (t) => `${t.toFixed(2)}s`;
const isVisible = (m) => m.opacity > VISIBLE_OPACITY;
const onCanvas = ({ box }, size) => box.right > 0 && box.left < size[0] && box.bottom > 0 && box.top < size[1];
const isShown = (m, size) => isVisible(m) && onCanvas(m, size) && !m.undrawn; // seen in the frame, at least in part

function safeAreaProblems(items, samples, insets, size) {
  const problems = [];
  items.forEach((item, j) => {
    const { el, path: where } = item;
    if (!CHECKED.has(el.type)) return;
    const spans = spansOf(item, GEOMETRY);
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

// Viral: a text or counter held inside the plain safe area but under one of the platform bands (`insets`, from the
// spec's `viral.safeZone` px values `zone`), once per element at the first such moment.
function bandWarnings(items, samples, insets, zone, size) {
  const inner = (m) => ({ top: m.top, bottom: size[1] - m.bottom, left: m.left, right: size[0] - m.right });
  const plain = inner(safeInsets(size));
  const platform = inner(insets);
  const warnings = [];
  items.forEach((item, j) => {
    const { el, path: where } = item;
    if (!CHECKED.has(el.type)) return;
    const spans = spansOf(item, GEOMETRY);
    const hit = samples.find(({ t, els }, n) => isShown(els[j], size) && isHeld(spans, t, n, samples)
      && !edgesOutside(els[j].box, plain).length && edgesOutside(els[j].box, platform).length);
    if (!hit) return;
    const bands = edgesOutside(hit.els[j].box, platform).map((edge) => `${edge} ${zone[edge]} px`).join(', ');
    warnings.push({ path: where, message: `viral: ${el.type} "${el.id}" sits under the platform UI (${bands}) at ${at(hit.t)}` });
  });
  return warnings;
}

// Viral: every warning that needs the page. `frame0` is scene 0 measured at t 0; `band` the bandWarnings of every scene.
async function viralWarnings(page, spec, itemsOf, frame0, steps, band) {
  const texts = itemsOf[0].flatMap(({ el, path: where }, j) => (el.type === 'text' && isShown(frame0[j], spec.size) ? [{ el, path: where, fontSize: frame0[j].fontSize }] : []));
  const total = spec.scenes.reduce((n, scene) => n + scene.duration, 0);
  const loop = spec.viral.loop === true ? loopWarnings(await frameDifference(page, 0, total - 1 / spec.fps)) : [];
  return [...specWarnings(spec), ...hookWarnings(texts), ...band, ...stillWarnings(spec, steps), ...loop];
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
  items.forEach((item, j) => {
    const { el, path: where } = item;
    if (!CHECKED.has(el.type)) return;
    const spans = spansOf(item, GEOMETRY);
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
  const texts = items.map((item, j) => ({ ...item, j, spans: spansOf(item, POSE) })).filter(({ el }) => CHECKED.has(el.type));
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
// What the typing elements `els` are, for the blank-frame cause: text, code, or both.
const typingKind = (els) => (els.every((el) => el.type === 'code') ? 'a typing code element' : els.some((el) => el.type === 'code') ? 'a typing text or code element' : 'a typing text');

// Frame 0 is the video's first frame and so its thumbnail: a warning when the first scene shows nothing there. An art
// background is on screen at t = 0, so it counts. The message names what keeps the frame blank.
function frameZeroWarnings(scene, items, els, size) {
  if (scene.background === ART_BACKGROUND || !items.length || els.some((m) => isShown(m, size))) return [];
  const involved = [...new Set(items.flatMap(({ chain }) => chain))]; // a group that starts invisible hides its children
  const invisible = involved.filter(startsInvisible);
  const undrawn = involved.filter(startsUndrawn);
  const empty = involved.filter(startsEmpty);
  const causes = [
    normalizeTransition(scene.transition).type === 'fade' && 'the scene fades in from the background ("fade" on scene 1)',
    invisible.length && `${quoted(invisible)} ${invisible.length === 1 ? 'has' : 'have'} an opacity 0 first keyframe${invisible.some((el) => el.role === 'title') ? " (a title's theme entrance starts at 0)" : ''}`,
    undrawn.length && `${quoted(undrawn)} ${undrawn.length === 1 ? 'starts' : 'start'} undrawn (draw or reveal 0)`,
    empty.length && `${quoted(empty)} ${empty.length === 1 ? 'starts' : 'start'} empty (${typingKind(empty)} types from no characters)`,
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

// The two layers of a transition window are both on screen at its midpoint, where they are drawn (not where each settles:
// a push carries them apart): warn about text over text. A push leaves no such place, so it never warns.
async function overlapWarnings(page, spec, itemsOf, span, size) {
  const mid = (span.start + span.end) / 2;
  const outgoing = await measureAt(page, mid, span.from, true);
  const incoming = await measureAt(page, mid, span.to, true);
  const from = spec.scenes[span.from];
  const texts = (items, els) => els.map((m, j) => ({ m, ...items[j] })).filter(({ m, el }) => CHECKED.has(el.type) && isShown(m, size));
  const old = texts(itemsOf[span.from], outgoing);
  return texts(itemsOf[span.to], incoming).flatMap((now) => {
    const under = old.find((o) => overlaps(o.m.box, now.m.box));
    if (!under) return [];
    return [{ path: now.path, message: `${now.el.type} "${now.el.id}" overlaps ${under.el.type} "${under.el.id}" of the outgoing scene "${from.id}" during the ${span.type} at ${at(mid)}; move one of them, or let the outgoing text exit first` }];
  });
}

// The transition window of `windows` (those a scene comes in through) that video second `sec` falls in, else undefined.
const windowAt = (windows, sec) => windows.find((w) => sec >= w.start - EPSILON && sec < w.end - EPSILON);

// The windows scene `i` (starting at video second `start`) comes in through: the page's (`overlaps`, every transition that
// comes in over the scene before), and a `fade`'s, which the page does not list because nothing is under it (the scene
// fades in from the background, the first scene too). A fade is a window as the others are: its frames are half the scene.
function windowsInto(scene, i, start, overlaps) {
  const own = overlaps.filter((w) => w.to === i);
  const seconds = normalizeTransition(scene.transition).type === 'fade' ? windowSeconds(scene, i) : 0;
  return seconds > 0 ? [...own, { from: null, to: i, start, end: start + seconds, type: 'fade' }] : own;
}

// `withCaptions`: also measure the captions layers at each moment. `times`: scene-local seconds (the sheet moments).
// `withBackdrop`: also read the colour behind every text that is on screen (one screenshot per moment), for the contrast
// audit: `back[j]` for item j, the colours of the cells behind it (see backdropColors), null where they were not read.
// `windows`: the transition windows this scene comes in through. The screenshot there is two layers (the outgoing scene
// draws over, under or beside this one), so no backdrop is read inside one: the contrast audit leaves a text coming in
// alone, as it leaves a text inside an opacity tween of its own.
async function sampleScene(page, scene, items, index, start, times, withCaptions, size, withBackdrop = false, windows = []) {
  const fading = items.map(({ chain }) => tweenSpans(chain, ['opacity'])); // the contrast audit leaves a text mid-fade alone
  const samples = [];
  for (const t of times) {
    const measured = await measureAt(page, start + t, index);
    const ids = measured.map((m) => m.id).join();
    if (ids !== items.map(({ el }) => el.id).join()) throw new Error(`scene "${scene.id}": the page shows elements ${ids}, not the spec's`);
    const els = measured.map((m) => ({ ...m, shown: isShown(m, size) }));
    const judged = els.flatMap((m, j) => (CHECKED.has(items[j].el.type) && m.shown && !inTween(fading[j], t) ? [j] : []));
    const back = els.map(() => null);
    const open = windowAt(windows, start + t);
    if (withBackdrop && judged.length && !open) (await backdropColors(page, judged.map((j) => els[j].box), [...CHECKED])).forEach((cells, n) => { back[judged[n]] = cells; });
    const captions = withCaptions ? await page.evaluate(measureCaptions, null) : [];
    samples.push({ t, els, back, captions, window: open?.type ?? null, wraps: await nowrapProblems(page, { root: '#stage' }) });
  }
  return samples;
}

// The AUDIT_STEP grid of one scene, exported for the checks that build on it (`stillStretches` takes the steps of every
// scene in order): { t (video seconds), scene, local (scene seconds), els, captions } per step. Each
// element carries `shown`, `hold` (it, or a group around it, says "hold": true) and `held` (its size is not being tweened,
// so the text floor judges it); `captions` is a string that changes when the words on screen do.
export async function sampleSteps(page, items, index, scene, start, withCaptions, size, windows = []) {
  const sizeSpans = items.map(({ chain }) => tweenSpans(chain, ['scale'])); // measure reads the size as drawn, camera zoom included
  const steps = [];
  for (const local of auditTimes(scene.duration)) {
    const measured = await measureAt(page, start + local, index);
    const els = measured.map((m, j) => ({ ...m, shown: isShown(m, size), hold: items[j].hold, held: !inTween(sizeSpans[j], local) }));
    const layers = withCaptions ? await page.evaluate(measureCaptions, null) : [];
    const moving = windowAt(windows, start + local) ? String(local) : undefined; // a transition window is change
    // What the camera node is drawn with, so a pan or a shake is change even over a scene that shows no element (an art plate
    // alone), and a camera held with two equal keyframes is not.
    const camera = scene.camera ? await page.evaluate(measureCamera, index) : undefined;
    steps.push({ t: start + local, scene: index, local, els, moving, camera, captions: layers.map((c) => `${c.shown}:${c.text}`).join('\u0001') });
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
async function inspect(browser, spec, server, prepare, written) {
  const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => process.stderr.write(`page error: ${e.message}\n`));
  await guardNetwork(page, new URL(server.url).origin, (url) => process.stderr.write(`blocked network request: ${url}\n`));
  await page.goto(server.url);
  await waitReady(page);
  await prepare?.(page);
  const starts = await page.evaluate(() => window.__motion.sceneStarts);
  const overlapsAll = await page.evaluate(() => window.__motion.overlaps); // every transition window
  const insets = safeInsets(spec.size);
  const problems = [];
  const itemsOf = spec.scenes.map(sceneItems); // the non-group elements of each scene, indexed as the page measures them
  const blocksOf = written.scenes.map((scene) => new Set((scene.elements ?? []).filter(isBlock).map((el) => el.id))); // `hold` goes on these, not on their parts
  const frame0 = await measureAt(page, 0, 0);
  const warnings = frameZeroWarnings(spec.scenes[0], itemsOf[0], frame0, spec.size);
  const platform = isViral(spec) ? safeInsets(spec.size, spec.viral.safeZone) : null; // viral: the platform bands
  const band = [];
  const zone = spec.captions.length ? captionZone(spec.size, spec.format, platform) : null; // the caption rules need captions
  const captionTimes = zone ? await page.evaluate(() => window.__motion.captionMoments.map((m) => m.t)) : [];
  const colors = themeData(spec.theme)?.dark ?? {};
  const steps = [];
  const unjudged = []; // info: a text no contrast sample could judge because of a window
  let moments = 0;
  for (const [i, scene] of spec.scenes.entries()) {
    const items = itemsOf[i];
    const times = sheetTimes(scene, spec.fps);
    const windows = windowsInto(scene, i, starts[i], overlapsAll);
    const samples = await sampleScene(page, scene, items, i, starts[i], times, zone !== null, spec.size, true, windows);
    const extraTimes = captionMomentsIn(captionTimes, starts[i], scene.duration, times);
    const extra = extraTimes.length ? await sampleScene(page, scene, items, i, starts[i], extraTimes, true, spec.size) : [];
    const own = await sampleSteps(page, items, i, scene, starts[i], zone !== null, spec.size, windows);
    steps.push(...own);
    moments += samples.length + extra.length;
    const contrast = contrastFindings(items, samples, colors, spec.size);
    const floor = textFloorFindings(items, own, scene.duration, spec.size);
    unjudged.push(...unjudgedContrast(items, samples));
    problems.push(...safeAreaProblems(items, samples, insets, spec.size), ...overlapProblems(items, samples, spec.size), ...emptyEndProblems(scene, i, items, samples, spec.size), ...wrapProblems(scene, i, samples), ...contrast.problems, ...floor.problems);
    warnings.push(...contrast.warnings, ...floor.warnings);
    if (zone) problems.push(...captionZoneProblems(items, samples, extra, zone, spec.size));
    if (platform) band.push(...bandWarnings(items, samples, platform, spec.viral.safeZone, spec.size));
  }
  const probe = async (i, j, local) => isShown((await measureAt(page, starts[i] + local, i))[j], spec.size); // the reading floor places a span's edges with these
  const reading = await readingFloorFindings(spec, itemsOf, steps, probe);
  problems.push(...reading.problems, ...deadStretchProblems(spec, steps, itemsOf, blocksOf));
  if (zone) problems.push(...await captionLayerProblems(page, zone));
  for (const open of overlapsAll) warnings.push(...await overlapWarnings(page, spec, itemsOf, open, spec.size));
  if (platform) warnings.push(...await viralWarnings(page, spec, itemsOf, frame0, steps, band));
  return { status: problems.length ? 'failed' : 'ok', scenes: spec.scenes.length, moments, problems, warnings, info: [...reading.info, ...unjudged] };
}

// Decoding needs ffmpeg; without it findFfmpeg's install hint ends the check as a crash line.
async function prepareFrames(specPath, spec) {
  const ffmpeg = await findFfmpeg();
  return prepareVideo(spec, path.dirname(specPath), ffmpeg, findFfprobe({ ffmpeg }), spec.fps);
}

async function checkSpec(specPath, spec, { env, theme, prepare, written }) {
  // Without a page, a viral spec still gets the warnings its spec alone can show.
  const skipped = (reason) => ({ status: 'skipped', reason, warnings: isViral(spec) ? [...specWarnings(spec), ...gapWarnings(spec, path.dirname(specPath))] : [] });
  if (env.PA_NO_BROWSER === '1') return skipped('PA_NO_BROWSER=1');
  let browser;
  try {
    browser = await launchBrowser({ quiet: true });
  } catch (e) {
    return skipped(firstLine(e));
  }
  let server;
  try {
    // The render page draws a video element from its decoded frames, so they are prepared as render.mjs prepares them.
    const videoFrames = specHasVideo(spec) ? await prepareFrames(specPath, spec) : {};
    server = await startServer({ specPath, mode: 'render', theme, videoFrames });
    return await inspect(browser, spec, server, prepare, written);
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
    const hint = blockHint(finding.message, paramOfPart(el.block, part), Boolean(written.scenes[m[1]].camera));
    const said = finding.message.replace(NO_PASSING_COLOUR, NO_PASSING_IN_BLOCK); // block terms, in place of the generic advice
    return { path: `scenes[${m[1]}].elements[${m[2]}]`, message: `${said} (block ${JSON.stringify(el.block)}, part ${JSON.stringify(part)})${hint ? `; ${hint}` : ''}` };
  });
}

const NO_PASSING_IN_BLOCK = 'no theme colour passes over this background; change "theme" or the scene background';

const TRANSITION_WINDOW = new RegExp(` during the (${TRANSITIONS.filter(comesInOver).join('|')}) at `);

// A finding about where a part sits or how large it is drawn: in a scene with a camera, its zoom or pan may be the cause.
const PLACED = / leaves the safe area | overlaps | sits under the platform UI | is \d+px \(below /;

// What to change for a finding about a block part, matched to the finding; null when its message already says it (the
// caption-zone rule says to move it above the zone, the crossfade warning to move one or let the other exit, the contrast
// finding that nothing passes is reworded in atBlockParts). `camera`: the part's scene has one, so a placement or size
// finding also names it.
function blockHint(message, param, camera = false) {
  const hint = partHint(message, param);
  return hint && camera && PLACED.test(message) ? `${hint}, or ease the scene camera` : hint;
}

function partHint(message, param) {
  const shorten = param ? ` or shorten params.${param}` : '';
  if (message.includes(' sits in the caption zone ') || TRANSITION_WINDOW.test(message)) return null;
  if (message.includes(NO_PASSING_COLOUR) || message.includes(' was not judged for contrast')) return null;
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
    const body = status === 'skipped' ? { ok: true, skipped: true, reason: result.reason, hint: skipHint(), ...noted }
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
    const { spec: loaded, dir } = loadSpec(positionals[0]);
    const valid = validateSpec(loaded, { dir });
    if (!valid.ok) {
      printResult(valid, { json, label: positionals[0] });
      return 1;
    }
    const raw = substituteVars(loaded); // its vars at their defaults: block ids and params as the page draws them
    // The theme the page draws decides the title presets (and so the settle times): the spec's own, else --theme.
    const spec = withDefaults(raw.theme === undefined && values.theme !== undefined ? { ...raw, theme: values.theme } : raw);
    const checked = await checkSpec(path.resolve(positionals[0]), spec, { env: process.env, theme: values.theme, prepare, written: raw });
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

// The four audits check.mjs adds to its geometry rules, as pure functions over what the page measured (no browser import
// but `backdropColors`, which is handed its page):
//   contrast       WCAG AA (4.5:1, or 3:1 for large text) of a text's colour against the pixels behind it
//   reading floor  a text stays on screen long enough to read (0.75 x (0.5 + 0.3 x words) s); the last line at most 2 s
//   dead stretch   more than 3 s in which nothing on screen changes (not in the final 3 s, not for `hold` elements)
//   text floor     rendered text under 28 px at 1080 on the short side, on screen for 0.5 s or more
// Severity follows HyperFrames: a contrast or text-floor finding at a single sampled moment is a warning, a held one a
// problem; reading floor and dead stretch are always problems.
//
// Two sample sets feed them. `samples` are the sheet moments of one scene ({ t, els, back }, `back[j]` the backdrop colour
// behind text j, taken with the screenshot). `steps` are the AUDIT_STEP grid of the whole video, in order
// ({ t, scene, local, els, captions }): `t` video seconds, `local` scene seconds. Both carry, per element j of the scene's
// item list, what check.mjs's `measure` read (`opacity`, `box`, `fontSize` rendered px, `weight`, `color` #rrggbb, `sig`
// a string that changes when the element looks different) plus `shown` (visible and on the canvas) and, in steps,
// `hold` (the element or a group around it says "hold": true) and `held` (its size is not being tweened).
import { contrastRatio } from '../../shared/contrast.mjs';
import { COLOR_TOKENS } from '../../template/defaults.mjs';

export const CHECKED_TYPES = Object.freeze(['text', 'counter']); // rendered text: the element types the audits judge
export const AUDIT_STEP = 0.25; // seconds between the steps every scene is sampled at
export const DEAD_STRETCH_SECONDS = 3; // nothing changing for longer than this is a dead stretch ...
export const TAIL_EXEMPT_SECONDS = 3; // ... except in the last this many seconds of the video
export const CONTRAST_NORMAL = 4.5;
export const CONTRAST_LARGE = 3;
export const LARGE_TEXT_PX = 24; // at 1080 on the short side: large text from here (WCAG 18 pt)
export const LARGE_BOLD_TEXT_PX = 18.67; // ... or from here at a weight of at least BOLD_WEIGHT (WCAG 14 pt bold)
export const BOLD_WEIGHT = 700;
export const CONTRAST_MIN_OPACITY = 0.5; // a text fainter than this is mid-fade: its colour is judged once it is in
export const READING_SCALE = 0.75;
export const READING_BASE_SECONDS = 0.5;
export const READING_WORD_SECONDS = 0.3;
export const LAST_LINE_SECONDS = 2; // the last line of the video reads best on screen at least this long (info, not an error)
export const TEXT_FLOOR_PX = 28; // at 1080 on the short side
export const TEXT_FLOOR_SECONDS = 0.5;
const REFERENCE_SIDE = 1080;
const EPSILON = 1e-6;
const HEX = /^#[0-9a-f]{6}$/i;
const seconds = (n) => `${n.toFixed(2)}s`;
const unitOf = (size) => Math.min(size[0], size[1]) / REFERENCE_SIDE;
const isChecked = (el) => CHECKED_TYPES.includes(el.type);

/** Scene-local seconds an AUDIT_STEP grid samples a scene of `duration` at: 0, 0.25, ... below the duration. */
export function auditTimes(duration, step = AUDIT_STEP) {
  const count = Math.max(1, Math.ceil(duration / step - EPSILON));
  return Array.from({ length: count }, (_, n) => n * step);
}

// Maximal runs of consecutive truthy flags, as inclusive [first, last] index pairs.
function runsOf(flags) {
  const runs = [];
  flags.forEach((on, n) => {
    if (!on) return;
    if (n > 0 && flags[n - 1]) runs[runs.length - 1][1] = n;
    else runs.push([n, n]);
  });
  return runs;
}

// Seconds covered by a scene's steps a..b (inclusive): each step stands for the time up to the next, the last up to the
// scene's end.
const covered = (steps, a, b, duration) => (steps[b + 1]?.local ?? duration) - steps[a].local;

const stepsOfScene = (steps, i) => steps.filter((s) => s.scene === i);

// ---- contrast -----------------------------------------------------------------------------------------------------

/** The ratio a text needs: 3 when large (`fontPx` >= 24 x k, or >= 18.67 x k at weight 700+; k = short side / 1080), else 4.5. */
export function contrastNeed(fontPx, weight, k) {
  const large = fontPx >= LARGE_TEXT_PX * k - EPSILON || (weight >= BOLD_WEIGHT && fontPx >= LARGE_BOLD_TEXT_PX * k - EPSILON);
  return large ? CONTRAST_LARGE : CONTRAST_NORMAL;
}

/** The theme token (of COLOR_TOKENS, resolved in `colors`) with the smallest contrast against `backdrop` that still reaches `need`, or null. */
export function nearestToken(backdrop, need, colors) {
  let best = null;
  for (const token of COLOR_TOKENS) {
    if (!HEX.test(colors[token] ?? '')) continue;
    const ratio = contrastRatio(colors[token], backdrop);
    if (ratio >= need && (best === null || ratio < best.ratio)) best = { token, ratio };
  }
  return best?.token ?? null;
}

// A ratio as shown: cut, never rounded up, so a failing 4.46 never reads "4.5:1; needs 4.5:1".
const ratioText = (ratio) => `${(Math.floor(ratio * 10 + EPSILON) / 10).toFixed(1)}:1`;

/**
 * Contrast findings for one scene: `items` are its non-group elements (sceneItems), `samples` its sheet moments with the
 * backdrop colour behind each text (`back`, null where it was not read), `colors` the active theme's colour tokens. A
 * text is judged where it is shown and at least CONTRAST_MIN_OPACITY. Once per element: a problem when two or more
 * consecutive samples fail (reported at the first), else a warning for the first single failing sample.
 * -> { problems, warnings }, each { path, message }.
 */
export function contrastFindings(items, samples, colors, size) {
  const k = unitOf(size);
  const found = { problems: [], warnings: [] };
  items.forEach(({ el, path }, j) => {
    if (!isChecked(el)) return;
    const fails = samples.map(({ t, els, back }) => {
      const m = els[j];
      const backdrop = back?.[j];
      if (!backdrop || !m.shown || m.opacity < CONTRAST_MIN_OPACITY) return null;
      const need = contrastNeed(m.fontSize, m.weight, k);
      const ratio = contrastRatio(m.color, backdrop);
      return ratio < need ? { t, ratio, need, backdrop } : null;
    });
    const runs = runsOf(fails.map(Boolean));
    const run = runs.find(([a, b]) => b > a) ?? runs[0];
    if (!run) return;
    const { t, ratio, need, backdrop } = fails[run[0]];
    const token = nearestToken(backdrop, need, colors);
    const fix = token ? `nearest passing token: ${token}` : 'no theme token passes; change the background';
    const message = `${el.type} "${el.id}" has ${ratioText(ratio)} contrast against its backdrop at ${seconds(t)}; needs ${need}:1; ${fix}`;
    (run[1] > run[0] ? found.problems : found.warnings).push({ path, message });
  });
  return found;
}

/**
 * The mean colour (#rrggbb) of each of `boxes` (canvas pixels) in the page with every `.el.<type>` of `types` made
 * transparent: the pixels a text of that box is drawn over. One PNG screenshot, decoded in the page. The text goes
 * transparent instead of hidden so the soft plate a text on an art background carries (it is part of what the viewer
 * reads against) stays. A box wholly off the canvas gives null.
 */
export async function backdropColors(page, boxes, types = CHECKED_TYPES) {
  const rules = types.map((type) => `.el.${type}, .el.${type} * { color: transparent !important; text-shadow: none !important; }`).join('\n');
  await page.evaluate((css) => {
    const style = document.createElement('style');
    style.id = 'audit-hide';
    style.textContent = css;
    document.head.append(style);
  }, rules);
  let png;
  try {
    png = await page.screenshot({ type: 'png' });
  } finally {
    await page.evaluate(() => document.getElementById('audit-hide')?.remove());
  }
  return page.evaluate(async ([base64, rects]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const s = document.getElementById('stage').getBoundingClientRect();
    const k = window.__motion.size[0] / s.width; // canvas px per screen px
    const clamp = (v, max) => Math.min(max, Math.max(0, v));
    return rects.map((box) => {
      const x0 = clamp(Math.floor(box.left / k + s.left), canvas.width);
      const y0 = clamp(Math.floor(box.top / k + s.top), canvas.height);
      const x1 = clamp(Math.ceil(box.right / k + s.left), canvas.width);
      const y1 = clamp(Math.ceil(box.bottom / k + s.top), canvas.height);
      if (x1 <= x0 || y1 <= y0) return null;
      const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0);
      const sum = [0, 0, 0];
      for (let p = 0; p < data.length; p += 4) for (let c = 0; c < 3; c++) sum[c] += data[p + c];
      const n = data.length / 4;
      return `#${sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`;
    });
  }, [png.toString('base64'), boxes]);
}

// ---- reading floor ------------------------------------------------------------------------------------------------

const wordCount = (text) => String(text).split(/\s+/).filter(Boolean).length;

/** Seconds a text of `words` words must stay on screen: 0.75 x (0.5 + 0.3 x words). */
export const readingSeconds = (words) => READING_SCALE * (READING_BASE_SECONDS + READING_WORD_SECONDS * words);

/**
 * Every `text` (not counters, not captions) must keep one contiguous visible span of at least readingSeconds(words); the
 * longest of its spans counts, the last line of the video included. A grid cannot place a span's edges nearer than a
 * step, so a text is reported only when it is provably too short: even stretched to the step before its first visible
 * one and the step after its last it falls short. The message gives the span as sampled (each visible step stands for
 * the time until the next). The last line (a text still shown at the video's final step) that clears that rule but
 * shows for under LAST_LINE_SECONDS gets an info finding instead: nothing fails, the line just reads best longer.
 * `itemsOf[i]` are scene i's items, `steps` the whole video's AUDIT_STEP grid. -> { problems, info }, each { path, message }.
 */
export function readingFloorFindings(spec, itemsOf, steps) {
  const found = { problems: [], info: [] };
  spec.scenes.forEach((scene, i) => {
    const own = stepsOfScene(steps, i);
    if (!own.length) return;
    const isFinalScene = i === spec.scenes.length - 1;
    itemsOf[i].forEach(({ el, path }, j) => {
      if (el.type !== 'text') return;
      const spans = runsOf(own.map((s) => s.els[j].shown)).map(([first, last]) => {
        const end = own[last + 1]?.local ?? scene.duration;
        return { seconds: end - own[first].local, atMost: end - (own[first - 1]?.local ?? 0), reachesEnd: last === own.length - 1 };
      });
      if (!spans.length) return;
      const words = wordCount(el.text);
      const need = readingSeconds(words);
      const best = spans.reduce((x, y) => (y.atMost > x.atMost ? y : x));
      const phrase = (span) => `text "${el.id}" (${words} word${words === 1 ? '' : 's'}) shows for ${seconds(span.seconds)}`;
      if (best.atMost < need - EPSILON) {
        found.problems.push({ path, message: `${phrase(best)}; needs ${seconds(need)}` });
        return;
      }
      const lastSpan = spans.at(-1);
      if (isFinalScene && lastSpan.reachesEnd && lastSpan.atMost < LAST_LINE_SECONDS - EPSILON) {
        found.info.push({ path, message: `${phrase(lastSpan)}; a last line reads best at ${LAST_LINE_SECONDS} s or more` });
      }
    });
  });
  return found;
}

// ---- text floor ---------------------------------------------------------------------------------------------------

/**
 * Text drawn under TEXT_FLOOR_PX x k (k = short side / 1080) on screen while its size is not being tweened. Once per
 * element: a problem when it stays so for TEXT_FLOOR_SECONDS or more, else a warning for the first shorter run (a single
 * step). `own` are the scene's steps, `duration` its length. -> { problems, warnings }.
 */
export function textFloorFindings(items, own, duration, size) {
  const k = unitOf(size);
  const found = { problems: [], warnings: [] };
  items.forEach(({ el, path }, j) => {
    if (!isChecked(el)) return;
    const runs = runsOf(own.map((s) => s.els[j].shown && s.els[j].held && s.els[j].fontSize < TEXT_FLOOR_PX * k - EPSILON))
      .map(([a, b]) => ({ shown: covered(own, a, b, duration), px: Math.min(...own.slice(a, b + 1).map((s) => s.els[j].fontSize)) }));
    const long = runs.find((r) => r.shown >= TEXT_FLOOR_SECONDS - EPSILON);
    const run = long ?? runs[0];
    if (!run) return;
    const message = `${el.type} "${el.id}" is ${Math.round(run.px / k)}px (below ${TEXT_FLOOR_PX}px at ${REFERENCE_SIDE}); shown ${seconds(run.shown)}`;
    (long ? found.problems : found.warnings).push({ path, message });
  });
  return found;
}

// ---- dead stretch -------------------------------------------------------------------------------------------------

const signatureOf = (step) => `${step.els.map((m) => m.sig).join('|')}#${step.captions ?? ''}`;

/**
 * The stretches longer than DEAD_STRETCH_SECONDS in which nothing on screen changes: no element's look (position,
 * opacity, scale, rotation, drawing, reveal, value, typed text, video frame), no caption and no scene. -> [{ from, to }]
 * in video seconds. `steps` is the whole video's AUDIT_STEP grid in order; a stretch runs from the first step of the
 * still state to the last step that still shows it (to the cut when a scene change ends it, to the video's end when it
 * runs out). The last `tailExempt` seconds of the video are never part of a stretch. With `ignoreHold` a stretch in which
 * only `hold` elements are on screen is skipped; pass { tailExempt: 0, ignoreHold: false } to see every one.
 */
export function stillStretches(spec, steps, { tailExempt = TAIL_EXEMPT_SECONDS, ignoreHold = true } = {}) {
  const total = spec.scenes.reduce((n, scene) => n + scene.duration, 0);
  const sigs = steps.map(signatureOf);
  const found = [];
  let first = 0;
  for (let next = 1; next <= steps.length; next++) {
    if (next < steps.length && steps[next].scene === steps[next - 1].scene && sigs[next] === sigs[next - 1]) continue;
    const run = steps.slice(first, next);
    const cut = next < steps.length && steps[next].scene !== steps[next - 1].scene;
    const from = steps[first].t;
    const to = Math.min(next === steps.length ? total : cut ? steps[next].t : steps[next - 1].t, total - tailExempt);
    const shown = run.flatMap((s) => s.els.filter((m) => m.shown));
    const onlyHeld = ignoreHold && shown.some((m) => m.hold) && shown.every((m) => m.hold);
    if (to - from > DEAD_STRETCH_SECONDS + EPSILON && !onlyHeld) found.push({ from, to });
    first = next;
  }
  return found;
}

/** The dead stretches of the default call (final 3 s and `hold` elements exempt), as problems on the scene they sit in. */
export function deadStretchProblems(spec, steps) {
  const starts = spec.scenes.map((_, i) => spec.scenes.slice(0, i).reduce((n, scene) => n + scene.duration, 0));
  return stillStretches(spec, steps).map(({ from, to }) => {
    const scene = starts.findLastIndex((start) => start <= from + EPSILON);
    return { path: `scenes[${scene}]`, message: `nothing changes from ${seconds(from)} to ${seconds(to)} (${(to - from).toFixed(1)}s); add motion or mark the elements "hold": true` };
  });
}

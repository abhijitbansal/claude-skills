// The four audits check.mjs adds to its geometry rules, as pure functions over what the page measured (no browser import
// but `backdropColors`, which is handed its page):
//   contrast       WCAG AA (4.5:1, or 3:1 for large text) of a text's colour, as drawn (its alpha and opacity blended over
//                  the backdrop), against the worst cell of the pixels behind it
//   reading floor  a text stays on screen long enough to read (0.75 x (0.5 + 0.3 x words) s, short by no more than a step);
//                  a last line under 2 s that clears that is only info
//   dead stretch   more than 3 s in which nothing on screen changes (not in the final 3 s, not for `hold` elements)
//   text floor     rendered text under 28 px at 1080 on the short side, on screen for 0.5 s or more
// Severity follows HyperFrames: a contrast or text-floor finding at a single sampled moment is a warning, a held one a
// problem; reading floor and dead stretch are always problems.
//
// Two sample sets feed them. `samples` are the sheet moments of one scene ({ t, els, back }, `back[j]` the backdrop cells
// (#rrggbb each) behind text j, taken with the screenshot). `steps` are the AUDIT_STEP grid of the whole video, in order
// ({ t, scene, local, els, captions }): `t` video seconds, `local` scene seconds. Both carry, per element j of the scene's
// item list, what check.mjs's `measure` read (`opacity`, `ownOpacity` without the scene's fade, `box`, `fontSize` rendered
// px, `weight`, `color` #rrggbb, `alpha`, `sig` a string that changes when the element looks different) plus `shown`
// (visible and on the canvas) and, in steps, `hold` (the element or a group around it says "hold": true) and `held` (its
// size is not being tweened).
import { contrastRatio, mixHex } from '../../shared/contrast.mjs';
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
export const READING_SCALE = 0.75;
export const READING_BASE_SECONDS = 0.5;
export const READING_WORD_SECONDS = 0.3;
export const LAST_LINE_SECONDS = 2; // the last line of the video reads best on screen at least this long (info, not an error)
export const TEXT_FLOOR_PX = 28; // at 1080 on the short side
export const TEXT_FLOOR_SECONDS = 0.5;
const REFERENCE_SIDE = 1080;
const EPSILON = 1e-6;
const BISECT_SECONDS = 0.002; // how closely the reading floor places an edge of a span it has to measure; its midpoint is the estimate
const CELL_COLUMNS = 4; // a text box is split into up to this many columns x CELL_ROWS rows for the contrast audit
const CELL_ROWS = 2;
const MIN_CELL_PX = 24; // ... and no cell is narrower or shorter than this, so a small box has fewer
const MAX_NAMED = 4; // elements a dead-stretch message names before 'and N more'
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

// Holds: an element is in motion at scene-local `t` when `t` lies strictly inside the span between two consecutive
// keyframes that set the same prop of a rule's set (`chain`: the groups around an element, then the element), and in a
// hold otherwise. check.mjs's safe-area and overlap rules use the same spans.
export const tweenSpans = (chain, props) => chain.flatMap((el) => props.flatMap((p) => {
  const times = (el.keyframes ?? []).filter((kf) => kf[p] !== undefined).map((kf) => kf.t);
  return times.slice(1).map((to, k) => [times[k], to]);
}));
export const inTween = (spans, t) => spans.some(([from, to]) => t > from + EPSILON && t < to - EPSILON);

// ---- contrast -----------------------------------------------------------------------------------------------------

/** The ratio a text needs: 3 when large (`fontPx` >= 24 x k, or >= 18.67 x k at weight 700+; k = short side / 1080), else 4.5. */
export function contrastNeed(fontPx, weight, k) {
  const large = fontPx >= LARGE_TEXT_PX * k - EPSILON || (weight >= BOLD_WEIGHT && fontPx >= LARGE_BOLD_TEXT_PX * k - EPSILON);
  return large ? CONTRAST_LARGE : CONTRAST_NORMAL;
}

// Suggested colours, first match wins: the text tokens, then the accent, then the rest of COLOR_TOKENS in their order.
const TOKEN_ORDER = Object.freeze(['text', 'text2', 'text3', 'accent', ...COLOR_TOKENS.filter((t) => !['text', 'text2', 'text3', 'accent'].includes(t))]);

/**
 * The first theme token (TOKEN_ORDER, resolved in `colors`) that reaches `need` against every one of `cells` (a backdrop
 * colour, or several) when drawn at `opacity`, or null when none does.
 */
export function nearestToken(cells, need, colors, opacity = 1) {
  const backdrops = [].concat(cells);
  return TOKEN_ORDER.find((token) => HEX.test(colors[token] ?? '')
    && backdrops.every((cell) => contrastRatio(mixHex(colors[token], cell, opacity), cell) >= need)) ?? null;
}

/** The advice when no theme colour passes over every cell of a backdrop. */
export const NO_PASSING_COLOUR = 'no single colour passes over this background; add a backing card (fill "surface") or move the text';

// A ratio as shown: cut, never rounded up, so a failing 4.46 never reads "4.5:1; needs 4.5:1".
const ratioText = (ratio) => `${(Math.floor(ratio * 10 + EPSILON) / 10).toFixed(1)}:1`;

/**
 * Contrast findings for one scene: `items` are its non-group elements (sceneItems), `samples` its sheet moments with the
 * backdrop cells behind each text (`back`, null where they were not read), `colors` the active theme's colour tokens.
 * A text is judged where it is shown and not inside an opacity tween of its own or of a group around it. Its colour is
 * blended over each backdrop cell at its alpha times the element's opacity before the ratio is taken, and the worst cell
 * is the one reported. Once per element: a problem when two or more consecutive samples fail (reported at the first),
 * else a warning for the first single failing sample. -> { problems, warnings }, each { path, message }.
 */
export function contrastFindings(items, samples, colors, size) {
  const k = unitOf(size);
  const found = { problems: [], warnings: [] };
  items.forEach(({ el, path, chain }, j) => {
    if (!isChecked(el)) return;
    const fading = tweenSpans(chain ?? [], ['opacity']);
    const fails = samples.map(({ t, els, back }) => {
      const m = els[j];
      const cells = back?.[j];
      if (!cells?.length || !m.shown || inTween(fading, t)) return null;
      const opacity = m.ownOpacity ?? m.opacity;
      const need = contrastNeed(m.fontSize, m.weight, k);
      const worst = Math.min(...cells.map((cell) => contrastRatio(mixHex(m.color, cell, (m.alpha ?? 1) * opacity), cell)));
      return worst < need ? { t, worst, need, cells, opacity } : null;
    });
    const runs = runsOf(fails.map(Boolean));
    const run = runs.find(([a, b]) => b > a) ?? runs[0];
    if (!run) return;
    const { t, worst, need, cells, opacity } = fails[run[0]];
    const token = nearestToken(cells, need, colors, opacity);
    const fix = token ? `nearest passing token: ${token}` : NO_PASSING_COLOUR;
    const message = `${el.type} "${el.id}" has ${ratioText(worst)} contrast against its backdrop at ${seconds(t)}; needs ${need}:1; ${fix}`;
    (run[1] > run[0] ? found.problems : found.warnings).push({ path, message });
  });
  return found;
}

/**
 * The backdrop behind each of `boxes` (canvas pixels): the box split into a grid of up to CELL_COLUMNS x CELL_ROWS cells
 * (fewer for a small box), each as its mean colour #rrggbb, in a page with every `.el.<type>` of `types` made transparent.
 * One PNG screenshot, decoded in the page. The text goes transparent instead of hidden so the soft plate a text on an art
 * background carries (it is part of what the viewer reads against) stays. -> string[][], null for a box wholly off the canvas.
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
  return page.evaluate(async ([base64, rects, grid]) => {
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
      const columns = Math.max(1, Math.min(grid.columns, Math.floor((x1 - x0) / grid.cell)));
      const rows = Math.max(1, Math.min(grid.rows, Math.floor((y1 - y0) / grid.cell)));
      const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0);
      const width = x1 - x0;
      const cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const sum = [0, 0, 0];
          let n = 0;
          for (let y = Math.floor(((y1 - y0) * r) / rows); y < Math.floor(((y1 - y0) * (r + 1)) / rows); y++) {
            for (let x = Math.floor((width * c) / columns); x < Math.floor((width * (c + 1)) / columns); x++) {
              for (let ch = 0; ch < 3; ch++) sum[ch] += data[(y * width + x) * 4 + ch];
              n++;
            }
          }
          cells.push(`#${sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`);
        }
      }
      return cells;
    });
  }, [png.toString('base64'), boxes, { columns: CELL_COLUMNS, rows: CELL_ROWS, cell: MIN_CELL_PX }]);
}

// ---- reading floor ------------------------------------------------------------------------------------------------

const wordCount = (text) => String(text).split(/\s+/).filter(Boolean).length;

/** Seconds a text of `words` words must stay on screen: 0.75 x (0.5 + 0.3 x words). */
export const readingSeconds = (words) => READING_SCALE * (READING_BASE_SECONDS + READING_WORD_SECONDS * words);

// The reading time as shown: rounded up, so a need of 1.725 s reads "1.73s" and the span beside it is never "short" by a
// rounding.
const needText = (need) => seconds(Math.ceil(need * 100 - EPSILON) / 100);

// The scene second where a text changes state between `known` (it is in `state` there) and `other` (it is not): narrowed
// by bisection with extra page measurements until BISECT_SECONDS wide.
async function edgeBetween(known, other, isShown, state) {
  let [inside, outside] = [known, other];
  while (Math.abs(outside - inside) > BISECT_SECONDS) {
    const mid = (inside + outside) / 2;
    if ((await isShown(mid)) === state) inside = mid;
    else outside = mid;
  }
  return (inside + outside) / 2;
}

// One visible span of a text on the grid: the steps first..last of the scene's `own` steps. The text is certainly shown
// from own[first] to own[last] and certainly hidden at the steps either side, so the span is between `lower` and `upper`
// seconds; `sampled` is the span counting each step until the next.
function spanOf(own, first, last, duration) {
  const end = own[last + 1]?.local ?? duration;
  return {
    first, last, end, sampled: end - own[first].local, lower: own[last].local - own[first].local, upper: end - (own[first - 1]?.local ?? 0),
    reachesEnd: last === own.length - 1,
  };
}

// Is the span at least `threshold` seconds? { seconds, ok }. Settled from the grid when it can be; otherwise the two
// edges are measured with `isShown(localSecond)` (each to within BISECT_SECONDS, so the measure is good to a few
// thousandths of a second and the threshold stays exactly as given). Without it a span the grid cannot place is ok.
async function judgeSpan(span, own, duration, threshold, isShown) {
  if (span.upper < threshold) return { seconds: span.sampled, ok: false };
  if (span.lower >= threshold || !isShown) return { seconds: span.sampled, ok: true };
  span.exact ??= await measuredSeconds(span, own, duration, isShown);
  return { seconds: span.exact, ok: span.exact >= threshold };
}

async function measuredSeconds(span, own, duration, isShown) {
  const left = span.first === 0 ? 0 : await edgeBetween(own[span.first].local, own[span.first - 1].local, isShown, true);
  const atEnd = span.last === own.length - 1 && await isShown(duration - 0.001); // shown to the scene's last instant
  const right = atEnd ? duration : await edgeBetween(own[span.last].local, span.end, isShown, true);
  return right - left;
}

/**
 * Every `text` (not counters, not captions) must keep one contiguous visible span of at least readingSeconds(words) less
 * one AUDIT_STEP; the longest of its spans counts, the last line of the video included. The grid places a span's edges
 * only to a step, so a text the grid cannot settle is measured: `probe(sceneIndex, itemIndex, sceneSecond) -> shown?`
 * (extra page measurements, bisecting each edge). Without a probe such a text is given the benefit of the doubt. The
 * message gives the span as measured, or as sampled (each visible step stands for the time until the next) when the grid
 * settled it. A last line (a text still shown at the final step of the final scene) that clears the rule but shows for
 * more than a step under LAST_LINE_SECONDS gets an info finding instead: nothing fails, the line just reads best longer.
 * `itemsOf[i]` are scene i's items, `steps` the whole video's AUDIT_STEP grid. -> Promise<{ problems, info }>, each { path, message }.
 */
export async function readingFloorFindings(spec, itemsOf, steps, probe = null) {
  const found = { problems: [], info: [] };
  for (const [i, scene] of spec.scenes.entries()) {
    const own = stepsOfScene(steps, i);
    if (!own.length) continue;
    const isFinalScene = i === spec.scenes.length - 1;
    for (const [j, { el, path }] of itemsOf[i].entries()) {
      if (el.type !== 'text') continue;
      const spans = runsOf(own.map((s) => s.els[j].shown)).map(([first, last]) => spanOf(own, first, last, scene.duration));
      if (!spans.length) continue;
      const isShown = probe && ((local) => probe(i, j, local));
      const words = wordCount(el.text);
      const need = readingSeconds(words);
      const phrase = (span) => `text "${el.id}" (${words} word${words === 1 ? '' : 's'}) shows for ${seconds(span)}`;
      const verdicts = [];
      for (const span of spans) verdicts.push(await judgeSpan(span, own, scene.duration, need - AUDIT_STEP, isShown));
      if (!verdicts.some((v) => v.ok)) {
        found.problems.push({ path, message: `${phrase(Math.max(...verdicts.map((v) => v.seconds)))}; needs ${needText(need)}` });
        continue;
      }
      const lastSpan = spans.at(-1);
      if (!isFinalScene || !lastSpan.reachesEnd) continue;
      const last = await judgeSpan(lastSpan, own, scene.duration, LAST_LINE_SECONDS - AUDIT_STEP, isShown); // the same step of slack: 1.99 s is not news
      if (!last.ok) found.info.push({ path, message: `${phrase(last.seconds)}; a last line reads best at ${LAST_LINE_SECONDS} s or more` });
    }
  }
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

// What a step looks like: each shown element's `sig`, '-' for one that is not shown (invisible, off the canvas, undrawn),
// so an element nobody can see never counts as change, and one that appears does.
const signatureOf = (step) => `${step.els.map((m) => (m.shown ? m.sig : '-')).join('|')}#${step.captions ?? ''}`;

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

// What to call an item in advice about `hold`: `shape "id"` reads as its kind (rect, ellipse, line), the rest as their
// type; a part of a block is its block (`hold` goes on the block, not on a part), named by `blockIds`, the ids of the
// scene's blocks as written.
function labelOf({ el, chain }, blockIds) {
  const block = blockIds?.has(chain?.[0]?.id) ? chain[0] : null;
  if (block) return `block "${block.id}"`;
  return `${el.type === 'shape' ? el.shape ?? 'shape' : el.type} "${el.id}"`;
}

/**
 * The dead stretches of the default call (final 3 s and `hold` elements exempt), as problems on the scene they sit in.
 * `itemsOf[i]` are scene i's items: the message names the shown elements of the stretch that lack `hold`, a block once
 * rather than its parts (`blocksOf[i]`: the ids of the blocks written in scene i).
 */
export function deadStretchProblems(spec, steps, itemsOf = [], blocksOf = []) {
  const starts = spec.scenes.map((_, i) => spec.scenes.slice(0, i).reduce((n, scene) => n + scene.duration, 0));
  return stillStretches(spec, steps).map(({ from, to }) => {
    const scene = starts.findLastIndex((start) => start <= from + EPSILON);
    const inside = steps.filter((s) => s.scene === scene && s.t >= from - EPSILON && s.t <= to + EPSILON);
    const lacking = [...new Set(inside.flatMap((s) => s.els.flatMap((m, j) => (m.shown && !m.hold && itemsOf[scene]?.[j] ? [j] : []))))].sort((a, b) => a - b);
    const labels = [...new Set(lacking.map((j) => labelOf(itemsOf[scene][j], blocksOf[scene])))];
    const named = labels.slice(0, MAX_NAMED).join(', ') + (labels.length > MAX_NAMED ? `, and ${labels.length - MAX_NAMED} more` : '');
    const advice = labels.length ? `add motion, or set "hold": true on ${named} if ${labels.length === 1 ? 'it is' : 'they are'} meant to sit still` : 'add motion';
    return { path: `scenes[${scene}]`, message: `nothing changes from ${seconds(from)} to ${seconds(to)} (${(to - from).toFixed(1)}s); ${advice}` };
  });
}

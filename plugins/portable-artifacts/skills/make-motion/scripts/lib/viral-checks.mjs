// Viral mode's check.mjs warnings (template/viral.mjs sets the mode up). Every one is a warning, never a problem: the
// numbers are tunable defaults from platform ad specs and creator guidance, not platform rules. Spec-wide ones sit at
// the path `viral` (`warning: viral: format 16:9; …`); one about an element sits at that element's path, its message
// starting `viral: ` (`warning: scenes[0].elements[1]: viral: text "cta" …`), so every line says `viral:` once.
//   format     a canvas that is not 9:16
//   captions   audio with no captions track
//   hook       frame 0 shows no text, or its largest text is not 3-7 words
//   band       (check.mjs) a held text or counter inside the 60 px safe area but under a platform band
//   still      nothing changes for more than 3 s where the dead-stretch audit looks away (the final 3 s, `hold`)
//   loop       with `viral.loop`, the last frame differs from the first by more than LOOP_DIFF_MAX
// Without a page (no browser) the still rule falls back to changeGaps, read from the spec and its captions files.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stillStretches, TAIL_EXEMPT_SECONDS } from './audits.mjs';
import { resolveAsset } from './paths.mjs';
import { parseCaptions, trackGroups } from '../../template/captions.mjs';
import { trackStart } from '../../template/audio.mjs';
import { FORMATS } from '../../template/formats.mjs';
import { changeGaps, HOOK_WORDS, VIRAL_FORMAT, VIRAL_CHANGE_SECONDS } from '../../template/viral.mjs';

export const LOOP_DIFF_MAX = 0.12; // mean absolute per-channel difference over 255 between the first and last frames
const OVERLAP_SECONDS = 0.25; // a still stretch overlapping a dead-stretch problem by this much is that problem
const EPSILON = 1e-6;
const SPEC = 'viral';
const seconds = (n) => `${n.toFixed(2)}s`;
const wordCount = (text) => String(text).split(/\s+/).filter(Boolean).length;
const stretch = ({ from, to }) => `nothing changes from ${seconds(from)} to ${seconds(to)} (${(to - from).toFixed(1)}s)`;
const EVERY = `cut, reveal or move something at least every ${VIRAL_CHANGE_SECONDS} s`;

/** A viral warning at `where`: spec-wide (`viral`) as it is, an element's prefixed `viral: `. */
export const viralWarning = (where, message) => ({ path: where, message: where === SPEC ? message : `viral: ${message}` });

/** The warnings read from a withDefaults spec alone: a canvas that is not 9:16, and audio without captions. */
export function specWarnings(spec) {
  const out = [];
  const [w, h] = spec.size;
  const [vw, vh] = FORMATS[VIRAL_FORMAT].size;
  const platforms = `Reels, TikTok and Shorts are ${VIRAL_FORMAT}`;
  if (spec.format !== undefined && spec.format !== VIRAL_FORMAT) out.push(viralWarning(SPEC, `format ${spec.format}; ${platforms}`));
  else if (spec.format === undefined && w * vh !== h * vw) out.push(viralWarning(SPEC, `size ${w}x${h}; ${platforms}`));
  if (spec.audio.length && !spec.captions.length) {
    out.push(viralWarning(SPEC, 'no captions; Reels, TikTok and Shorts are watched muted; add a captions track (the voice sidecar or an SRT)'));
  }
  return out;
}

/**
 * The hook at frame 0. `texts` are the first scene's `text` elements shown at t 0, each { el, path, fontSize } with the
 * size as drawn; the largest (the first of equals) is the hook, and must have HOOK_WORDS words.
 */
export function hookWarnings(texts) {
  const range = `${HOOK_WORDS.min}–${HOOK_WORDS.max}`;
  if (!texts.length) return [viralWarning(SPEC, `no hook text at frame 0; show ${range} words from the first frame`)];
  const hook = texts.reduce((a, b) => (b.fontSize > a.fontSize ? b : a));
  const n = wordCount(hook.el.text);
  if (n >= HOOK_WORDS.min && n <= HOOK_WORDS.max) return [];
  return [viralWarning(hook.path, `hook ${JSON.stringify(hook.el.text)} has ${n} word${n === 1 ? '' : 's'}; use ${range}`)];
}

/**
 * Still stretches the dead-stretch audit does not report: every stretch of stillStretches with no tail exemption and
 * `hold` counted, less any that overlaps one of the default call's (a dead-stretch problem already) by OVERLAP_SECONDS
 * or more, so a stretch is reported once. `steps` is the whole video's AUDIT_STEP grid.
 */
export function stillWarnings(spec, steps) {
  const total = spec.scenes.reduce((n, scene) => n + scene.duration, 0);
  const reported = stillStretches(spec, steps);
  const overlaps = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from) >= OVERLAP_SECONDS - EPSILON;
  return stillStretches(spec, steps, { tailExempt: 0, ignoreHold: false })
    .filter((s) => !reported.some((r) => overlaps(s, r)))
    .map((s) => viralWarning(SPEC, s.to > total - TAIL_EXEMPT_SECONDS + EPSILON
      ? `${stretch(s)}, the final seconds too; move the CTA or loop back to the hook`
      : `${stretch(s)} while only "hold" elements show; ${EVERY}`));
}

/**
 * Video seconds where a caption group of `spec` (withDefaults) appears or goes, read from its captions files next to the
 * spec (`dir`). A file that cannot be read or parsed adds none: the validator has already reported it.
 */
export function captionTimes(spec, dir) {
  return spec.captions.flatMap((track) => {
    try {
      const words = parseCaptions(readFileSync(resolveAsset(dir, track.src).file, 'utf8'), path.extname(track.src).slice(1).toLowerCase());
      return trackGroups(words, trackStart(track, spec)).flatMap((g) => [g.start, g.end]);
    } catch {
      return [];
    }
  });
}

/** The still rule without a page: changeGaps of the spec, its caption changes counted (`dir`: the spec's folder). */
export const gapWarnings = (spec, dir) => changeGaps(spec, captionTimes(spec, dir)).map((gap) => viralWarning(SPEC, `${stretch(gap)} by the spec's keyframes and captions; ${EVERY}`));

/** The loop warning for a first-to-last frame difference `diff` (0-1), or none when it is within LOOP_DIFF_MAX. */
export const loopWarnings = (diff) => (diff > LOOP_DIFF_MAX
  ? [viralWarning(SPEC, `the last frame does not match the first (difference ${diff.toFixed(2)}); end on the hook again so the clip loops`)]
  : []);

/**
 * The mean absolute per-channel (RGB) difference, over 255, between the page's frames at video seconds `a` and `b`:
 * one PNG screenshot each, decoded in the page (no image library in Node).
 */
export async function frameDifference(page, a, b) {
  const shot = async (sec) => {
    await page.evaluate((s) => window.__motion.seek(s), sec);
    return (await page.screenshot({ type: 'png' })).toString('base64');
  };
  const first = await shot(a);
  const last = await shot(b);
  return page.evaluate(async ([x, y]) => {
    const pixels = async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const p = await pixels(x);
    const q = await pixels(y);
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
    return sum / ((p.length / 4) * 3 * 255);
  }, [first, last]);
}

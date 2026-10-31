// Task 11: contrast, reading floor, dead stretch and text floor audits in check.mjs, and the `hold` field.
// The pure functions of scripts/lib/audits.mjs run on made-up samples; the fixtures run the whole check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, BROWSER_ONLY } from './helpers/render.mjs';
import * as checkModule from '../scripts/check.mjs';
import { readFileSync } from 'node:fs';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { contrastRatio } from '../shared/contrast.mjs';
import { loadTheme } from '../shared/theme.mjs';
import {
  AUDIT_STEP, auditTimes, contrastNeed, nearestToken, contrastFindings, readingSeconds, readingFloorFindings, textFloorFindings,
  stillStretches, deadStretchProblems,
} from '../scripts/lib/audits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const FIXTURES = path.join(root, 'test/fixtures');
const { atBlockParts } = checkModule;
const check = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: process.env });
const lines = (stdout) => stdout.trim().split('\n');
const dusk = loadTheme('dusk').dark;

// A spec in a temp folder (plus extra files); returns its path.
function writeSpec(spec, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-audits-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify({ size: [1920, 1080], fps: 30, ...spec }));
  return file;
}

// ---- pure functions on made-up samples ------------------------------------------------------------------------------

// One element as check.mjs measures and annotates it.
const measured = (over = {}) => ({
  opacity: 1, ownOpacity: 1, alpha: 1, box: { left: 0, top: 0, right: 100, bottom: 50 }, undrawn: false, sig: 'still', fontSize: 48, weight: 600, color: '#ffffff',
  shown: true, hold: false, held: true, ...over,
});
const item = (type, id, over = {}) => ({ el: { type, id, ...over }, path: `scenes[0].elements[${id}]`, chain: [], hold: false });
// The AUDIT_STEP grid of a one-scene video of `duration` s; `els(t)` gives the elements measured at scene second t.
const grid = (duration, els, scene = 0, start = 0) => auditTimes(duration).map((local) => ({ t: start + local, scene, local, els: els(local), captions: '' }));

test('auditTimes: every 0.25 s from 0 up to (not including) the scene end; a scene shorter than a step has one', () => {
  assert.equal(AUDIT_STEP, 0.25);
  assert.deepEqual(auditTimes(1), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(auditTimes(0.3), [0, 0.25]);
  assert.deepEqual(auditTimes(0.2), [0]);
  assert.equal(auditTimes(12).length, 48);
});

test('contrastNeed: 4.5 for small text, 3 from 24 px (18.67 px at weight 700), both scaled by the short side / 1080', () => {
  assert.equal(contrastNeed(23.9, 400, 1), 4.5);
  assert.equal(contrastNeed(24, 400, 1), 3);
  assert.equal(contrastNeed(18.67, 700, 1), 3);
  assert.equal(contrastNeed(18.66, 700, 1), 4.5);
  assert.equal(contrastNeed(18.67, 600, 1), 4.5);
  assert.equal(contrastNeed(47, 400, 2), 4.5, 'at 2160 on the short side 24 px becomes 48 px');
  assert.equal(contrastNeed(48, 400, 2), 3);
});

test('nearestToken: prefers text, text2, text3, accent, then the rest, and the token must pass every cell', () => {
  assert.equal(nearestToken('#555555', 3, dusk), 'text', 'bad (3.002) and accent (3.004) pass too, but a text token comes first');
  assert.equal(nearestToken(['#555555'], 4.5, dusk), 'text', 'text2 passes at 4.69 as well; text is first');
  assert.equal(nearestToken(['#555555'], 6.5, dusk), null);
  assert.equal(nearestToken('#f0f0f0', 4.5, dusk), 'surface', 'no text token or accent passes on a light backdrop: the first of the others');
  assert.equal(nearestToken(['#ffffff', '#000000'], 3, dusk), null, 'nothing is readable on both halves of a split');
  assert.equal(nearestToken(['#555555', '#666666'], 3, dusk), 'text');
  assert.equal(nearestToken('#555555', 3, { text: 'not a colour' }), null);
  assert.equal(nearestToken('#17102a', 4.5, dusk, 0.05), null, 'the opacity the element is drawn at counts');
});

test('contrastFindings: 2.8:1 small text needs 4.5:1 and names a passing token; large text needs only 3:1', () => {
  const text = '#a0a0a0';
  const cells = ['#555555'];
  assert.ok(contrastRatio(text, cells[0]) > 2.8 && contrastRatio(text, cells[0]) < 3, 'the premise: about 2.8:1');
  const sample = (t, fontSize) => ({ t, els: [measured({ color: text, fontSize })], back: [cells] });
  const small = contrastFindings([item('text', 'sub')], [sample(1, 20), sample(2, 20)], dusk, [1920, 1080]);
  assert.deepEqual(small.problems, [{ path: 'scenes[0].elements[sub]', message: 'text "sub" has 2.8:1 contrast against its backdrop at 1.00s; needs 4.5:1; nearest passing token: text' }]);
  assert.deepEqual(small.warnings, []);
  const large = contrastFindings([item('text', 'sub')], [sample(1, 40), sample(2, 40)], dusk, [1920, 1080]);
  assert.match(large.problems[0].message, /needs 3:1; nearest passing token: /);
});

test('contrastFindings: nothing passes over a split backdrop, and the message says to add a backing card or move the text', () => {
  const sample = (t) => ({ t, els: [measured({ color: '#ffffff', fontSize: 120 })], back: [['#ffffff', '#ffffff', '#000000', '#000000']] });
  const found = contrastFindings([item('text', 'split')], [sample(1), sample(2)], dusk, [1920, 1080]);
  assert.deepEqual(found.problems, [{
    path: 'scenes[0].elements[split]',
    message: 'text "split" has 1.0:1 contrast against its backdrop at 1.00s; needs 3:1; no single colour passes over this background; add a backing card (fill "surface") or move the text',
  }]);
});

test('contrastFindings: a text is judged on its worst cell: one bright cell fails it, all-dark cells pass it', () => {
  const run = (cells) => contrastFindings([item('text', 'sub')], [1, 2].map((t) => ({ t, els: [measured({ color: '#f7ebe0', fontSize: 96 })], back: [cells] })), dusk, [1920, 1080]);
  assert.equal(run(['#17102a', '#17102a', '#17102a', '#17102a', '#17102a', '#17102a', '#17102a', '#ffffff']).problems.length, 1);
  assert.match(run(['#17102a', '#17102a', '#ffffff']).problems[0].message, /has 1\.1:1 contrast/, 'the worst ratio is the one reported');
  assert.deepEqual(run(['#17102a', '#241a38', '#17102a']), { problems: [], warnings: [] });
});

test('contrastFindings: the colour is blended at its alpha and the element opacity before the ratio is taken', () => {
  const page = '#17102a';
  const run = (over) => contrastFindings([item('text', 'faint')], [1, 2].map((t) => ({ t, els: [measured({ color: '#ffffff', fontSize: 96, ...over })], back: [[page]] })), dusk, [1920, 1080]);
  assert.equal(run({}).problems.length, 0, 'white on the page passes');
  assert.equal(run({ alpha: 0.15 }).problems.length, 1, 'rgba(255,255,255,0.15) is nearly the page colour');
  assert.match(run({ alpha: 0.15 }).problems[0].message, /^text "faint" has 1\.\d:1 contrast/);
  assert.equal(run({ ownOpacity: 0.15 }).problems.length, 1, 'so is a white text at opacity 0.15');
  assert.equal(run({ alpha: 0.5, ownOpacity: 0.5 }).problems.length, 1, 'the two multiply');
  assert.equal(run({ alpha: 0.8 }).problems.length, 0);
});

test('contrastFindings: samples inside an opacity tween of the text, or of a group around it, are not judged', () => {
  const bad = (t) => ({ t, els: [measured({ color: '#f7ebe0' })], back: [['#ffffff']] });
  const tweened = { ...item('text', 'sub'), chain: [{ keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] }] };
  assert.deepEqual(contrastFindings([tweened], [bad(0.25), bad(0.5)], dusk, [1920, 1080]), { problems: [], warnings: [] });
  const after = contrastFindings([tweened], [bad(1), bad(1.5)], dusk, [1920, 1080]);
  assert.equal(after.problems.length, 1, 'once the tween has landed the text is judged');
  const inGroup = { ...item('text', 'sub'), chain: [{ keyframes: [{ t: 0, opacity: 0.2 }, { t: 2, opacity: 1 }] }, { keyframes: [] }] };
  assert.deepEqual(contrastFindings([inGroup], [bad(0.5), bad(1)], dusk, [1920, 1080]), { problems: [], warnings: [] });
});

test('contrastFindings: one failing sample is a warning, two consecutive a problem, two apart a warning; hidden text is not judged', () => {
  const bad = (t, over = {}) => ({ t, els: [measured({ color: '#f7ebe0', ...over })], back: [['#ffffff']] });
  const good = (t) => ({ t, els: [measured({ color: '#f7ebe0' })], back: [['#17102a']] });
  const run = (samples) => contrastFindings([item('text', 'sub')], samples, dusk, [1920, 1080]);
  const single = run([good(0.1), bad(0.9), good(1.0)]);
  assert.deepEqual([single.problems.length, single.warnings.length], [0, 1]);
  assert.match(single.warnings[0].message, /^text "sub" has 1\.1:1 contrast against its backdrop at 0\.90s; needs 3:1/);
  const held = run([good(0.1), bad(0.9), bad(1.0), good(1.1)]);
  assert.deepEqual([held.problems.length, held.warnings.length], [1, 0]);
  assert.match(held.problems[0].message, /at 0\.90s/);
  const apart = run([bad(0.9), good(1.0), bad(1.1)]);
  assert.deepEqual([apart.problems.length, apart.warnings.length], [0, 1], 'a pass in between breaks the run');
  assert.deepEqual(run([bad(0.1, { shown: false }), bad(0.2, { shown: false })]).problems, []);
  const shape = contrastFindings([item('shape', 'box')], [bad(0.1), bad(0.2)], dusk, [1920, 1080]);
  assert.deepEqual(shape, { problems: [], warnings: [] }, 'only text and counters have a text colour');
});

test('readingSeconds: 0.75 x (0.5 + 0.3 x words), so 7 words need 1.95 s (controller ruling R11)', () => {
  assert.ok(Math.abs(readingSeconds(7) - 1.95) < 1e-9);
  assert.ok(Math.abs(readingSeconds(1) - 0.6) < 1e-9);
  assert.ok(Math.abs(readingSeconds(0) - 0.375) < 1e-9);
});

// The reading floor with a probe that answers from the same function that made the grid: the exact edges are known.
const reading = (spec, items, els, duration = 6) => readingFloorFindings(spec, items, grid(duration, els), async (_scene, j, local) => els(local)[j].shown);
const sixWords = [[item('text', 'sub', { text: 'one two three four five six' })]];
const oneScene = { scenes: [{ id: 's', duration: 6 }] };

test('readingFloorFindings: a text must stay on screen for its reading time; the exact message; one word is singular', async () => {
  const items = [[item('text', 'sub', { text: 'one two three four five six seven' }), item('text', 'one', { text: 'Hi' }), item('text', 'end', { text: 'The end' }), item('counter', 'n')]];
  const seen = (local) => [local >= 1 && local < 2.25, local >= 2 && local < 2.25, local >= 3, true].map((shown) => measured({ shown }));
  const { problems, info } = await reading(oneScene, items, seen);
  assert.deepEqual(problems, [
    { path: 'scenes[0].elements[sub]', message: 'text "sub" (7 words) shows for 1.25s; needs 1.95s' },
    { path: 'scenes[0].elements[one]', message: 'text "one" (1 word) shows for 0.25s; needs 0.60s' },
  ]);
  assert.deepEqual(info, [], 'the last line "end" shows for 3 s');
});

test('readingFloorFindings: reported when the true shown time falls short of the need by more than one 0.25 s step', async () => {
  const items = [[item('text', 'sub', { text: 'one two three four five six seven' })]]; // needs 1.95 s, so 1.70 s is the line
  const run = async (from, to) => (await reading(oneScene, items, (t) => [measured({ shown: t >= from && t < to })])).problems.length;
  assert.equal(await run(1, 3), 0, 'shown 2.0 s');
  assert.equal(await run(1, 2.5), 1, 'shown 1.5 s: more than a step short');
  assert.equal(await run(1, 2.75), 0, 'shown 1.75 s: within the step');
  assert.equal(await run(1, 2.25), 1, 'the case of bad-reading-floor: shown 1.25 s');
});

test('readingFloorFindings: edges at 0.999/2.251 and at 1.0/2.249 get the same verdict, and the need is printed rounded up', async () => {
  // Six words need 1.725 s; both spans are about 1.25 s, which is 0.475 s short.
  const flagged = async (from, to) => (await reading(oneScene, sixWords, (t) => [measured({ shown: t >= from && t < to })])).problems;
  const [a, b] = [await flagged(0.999, 2.251), await flagged(1, 2.249)];
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  for (const { message } of [a[0], b[0]]) assert.match(message, /^text "sub" \(6 words\) shows for 1\.2\ds; needs 1\.73s$/);
  assert.equal((await flagged(1, 2.5)).length, 0, 'shown 1.5 s is within a step of 1.725');
  assert.equal((await flagged(1, 2.45)).length, 1, 'shown 1.45 s is not');
});

test('readingFloorFindings: the formula is the error rule for the last line too; a last line under 2 s that clears it is info', async () => {
  const long = [[item('text', 'last', { text: Array.from({ length: 20 }, (_, n) => `w${n}`).join(' ') })]]; // 4.875 s
  const lastFrom = (items, from) => reading(oneScene, items, (t) => [measured({ shown: t >= from })]);
  assert.deepEqual((await lastFrom(long, 1)).problems, [], '5 s of a 20-word last line meets the formula');
  assert.deepEqual((await lastFrom(long, 4)).problems, [
    { path: 'scenes[0].elements[last]', message: 'text "last" (20 words) shows for 2.00s; needs 4.88s' },
  ], 'the formula stands for the last line: 20 words need 4.88 s');
  const short = [[item('text', 'last', { text: 'Bye' })]];
  const lastLine = (seconds) => `text "last" (1 word) shows for ${seconds}s; a last line reads best at 2 s or more`;
  assert.deepEqual(await lastFrom(short, 4.5), { problems: [], info: [{ path: 'scenes[0].elements[last]', message: lastLine('1.50') }] });
  assert.deepEqual((await lastFrom(short, 4.25)).info, [], '1.75 s is within a step of 2 s: not news');
  assert.deepEqual(await lastFrom(short, 4), { problems: [], info: [] });
  const earlier = { scenes: [{ id: 'a', duration: 6 }, { id: 'b', duration: 6 }] };
  const quick = await reading(earlier, [[item('text', 'x', { text: 'Bye' })], []], (t) => [measured({ shown: t >= 4.5 })]);
  assert.deepEqual(quick.info, [], 'a line that is not in the final scene is not a last line');
  const two = [[item('text', 'blink', { text: 'Hi there' }), item('text', 'last', { text: 'Bye' })]];
  const blinking = await reading(oneScene, two, (t) => [measured({ shown: t < 0.5 || (t >= 2 && t < 3.5) }), measured({ shown: t >= 3 })]);
  assert.deepEqual(blinking, { problems: [], info: [] }, 'a 0.5 s blink and a 1.5 s span: the longest span counts, and it is enough (need 0.825 s)');
});

test('readingFloorFindings: without a probe a text that the grid cannot place is given the benefit of the doubt', async () => {
  const els = (t) => [measured({ shown: t >= 1 && t < 2.5 })];
  assert.deepEqual((await readingFloorFindings(oneScene, sixWords, grid(6, els))).problems, []);
});

test('textFloorFindings: under 28 px at 1080 for 0.5 s is a problem, a single step a warning; counters count; sizes scale with the canvas; tweened size is not judged', () => {
  const run = (shownAt, fontSize, { size = [1920, 1080], type = 'text', held = () => true } = {}) => textFloorFindings(
    [item(type, 'fine-print')], grid(3, (t) => [measured({ fontSize, shown: shownAt(t), held: held(t) })]), 3, size,
  );
  assert.deepEqual(run(() => true, 22).problems, [{ path: 'scenes[0].elements[fine-print]', message: 'text "fine-print" is 22px (below 28px at 1080); shown 3.00s' }]);
  assert.match(run((t) => t >= 0.5 && t < 2, 22).problems[0].message, /; shown 1\.50s$/);
  assert.match(run((t) => t >= 0.5 && t < 1, 22).problems[0].message, /; shown 0\.50s$/);
  const single = run((t) => t === 1, 22);
  assert.deepEqual([single.problems.length, single.warnings.length], [0, 1]);
  assert.match(single.warnings[0].message, /; shown 0\.25s$/);
  assert.deepEqual(run(() => true, 28), { problems: [], warnings: [] }, '28 px is the floor, not below it');
  assert.match(run(() => true, 44, { size: [3840, 2160] }).problems[0].message, /is 22px \(below 28px at 1080\)/, '44 px at 2160 is 22 px at 1080');
  assert.deepEqual(run(() => true, 56, { size: [3840, 2160] }), { problems: [], warnings: [] });
  assert.match(run(() => true, 20, { type: 'counter' }).problems[0].message, /^counter "fine-print" is 20px/);
  assert.deepEqual(run(() => true, 20, { held: () => false }), { problems: [], warnings: [] });
  assert.deepEqual(run(() => false, 20), { problems: [], warnings: [] });
});

// The elements for stillStretches tests: one element whose signature at scene second t is `sig(t)`.
const stills = (duration, sig, over = {}) => grid(duration, (t) => [measured({ sig: sig(t), ...over })]);

test('stillStretches: the stretch from the first step of a still state to the last step that shows it', () => {
  const spec = { scenes: [{ id: 's', duration: 12 }] };
  const steps = stills(12, (t) => (t < 4 ? `a${t}` : t <= 7.5 ? 'b' : `c${t}`));
  assert.deepEqual(stillStretches(spec, steps), [{ from: 4, to: 7.5 }]);
  assert.deepEqual(deadStretchProblems(spec, steps, [[item('text', 'a')]]), [{
    path: 'scenes[0]',
    message: 'nothing changes from 4.00s to 7.50s (3.5s); add motion, or set "hold": true on text "a" if it is meant to sit still',
  }]);
});

test('deadStretchProblems: the message names the shown elements that lack hold, by shape kind for shapes; a held one is left out', () => {
  const spec = { scenes: [{ id: 's', duration: 12 }] };
  const items = [[item('text', 'a'), item('shape', 'panel', { shape: 'rect' }), item('text', 'kept'), item('text', 'gone')]];
  const steps = grid(12, (t) => [measured({ sig: t < 4 ? `m${t}` : 'a' }), measured({ sig: 'p' }), measured({ sig: 'k', hold: true }), measured({ sig: t < 5 ? 'x' : 'y', shown: false })]);
  const [problem] = deadStretchProblems(spec, steps, items);
  assert.equal(problem.message, 'nothing changes from 4.00s to 9.00s (5.0s); add motion, or set "hold": true on text "a", rect "panel" if they are meant to sit still');
});

test('stillStretches: only shown elements count: an invisible or off-canvas element that changes does not mask a stretch, and showing one is a change', () => {
  const spec = { scenes: [{ id: 's', duration: 12 }] };
  const masked = grid(12, (t) => [measured({ sig: 'title' }), measured({ sig: `drift${t}`, shown: false })]);
  assert.deepEqual(stillStretches(spec, masked), [{ from: 0, to: 9 }]);
  const appears = grid(12, (t) => [measured({ sig: 'title' }), measured({ sig: t >= 5 ? 'late' : `drift${t}`, shown: t >= 5 })]);
  assert.deepEqual(stillStretches(spec, appears), [{ from: 0, to: 4.75 }, { from: 5, to: 9 }], 'the first stretch ends where the second element is first shown');
});

test('stillStretches: only longer than 3 s counts; a caption change or a scene cut ends a stretch', () => {
  const spec = { scenes: [{ id: 's', duration: 12 }] };
  assert.deepEqual(stillStretches(spec, stills(12, (t) => (t <= 3 ? 'b' : `c${t}`))), [], '0.00s to 3.00s is exactly 3 s: not longer');
  assert.deepEqual(stillStretches(spec, stills(12, (t) => (t <= 3.25 ? 'b' : `c${t}`))), [{ from: 0, to: 3.25 }]);
  const captioned = stills(12, () => 'b').map((s) => ({ ...s, captions: `true:${Math.floor(s.t / 2)}` }));
  assert.deepEqual(stillStretches(spec, captioned), [], 'a caption every 2 s is a change every 2 s');
  const cut = { scenes: [{ id: 'a', duration: 4 }, { id: 'b', duration: 4 }] };
  const two = [...stills(4, () => 'b'), ...grid(4, () => [measured({ sig: 'b' })], 1, 4)];
  assert.deepEqual(stillStretches(cut, two), [{ from: 0, to: 4 }], 'the same signature across the cut is two stretches; the second lies in the last 3 s');
});

test('stillStretches: the final 3 s are exempt by default and tailExempt moves that; hold elements are skipped unless ignoreHold is false', () => {
  const spec = { scenes: [{ id: 's', duration: 12 }] };
  const steps = stills(12, (t) => (t < 4 ? `a${t}` : 'b'));
  assert.deepEqual(stillStretches(spec, steps), [{ from: 4, to: 9 }], 'it runs to the end of the video, cut at 12 - 3');
  assert.deepEqual(stillStretches(spec, steps, { tailExempt: 0 }), [{ from: 4, to: 12 }]);
  assert.deepEqual(stillStretches(spec, steps, { tailExempt: 8.5 }), [], 'only 3.5 s left, 4 to 3.5 is nothing');
  const held = stills(12, (t) => (t < 4 ? `a${t}` : 'b'), { hold: true });
  assert.deepEqual(stillStretches(spec, held), []);
  assert.deepEqual(stillStretches(spec, held, { ignoreHold: false }), [{ from: 4, to: 9 }]);
  const mixed = grid(12, (t) => [measured({ sig: t < 4 ? `a${t}` : 'b', hold: true }), measured({ sig: 'free' })]);
  assert.deepEqual(stillStretches(spec, mixed), [{ from: 4, to: 9 }], 'a hold element beside one that is not exempts nothing');
  const empty = stills(12, (t) => (t < 4 ? `a${t}` : 'b'), { shown: false });
  assert.deepEqual(stillStretches(spec, empty), [{ from: 0, to: 9 }], 'an empty screen is not a held one (nothing on it changes)');
});

// ---- the whole check on fixtures --------------------------------------------------------------------------------------

async function skipUnlessBrowser(t) {
  return !(await requireRender(t, BROWSER_ONLY));
}

test('bad-contrast: text on a darker panel below 3:1 is a problem naming the nearest passing token', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-contrast.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(contrastRatio('#8a8a8a', '#555555') < 3);
  assert.deepEqual(lines(r.stdout), [
    'scenes[0].elements[1]: text "sub" has 2.1:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text',
    'check: 1 problem',
  ]);
});

test('bad-reading-floor: a 7-word line shown for 1.25 s needs 1.95 s', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-reading-floor.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "sub" (7 words) shows for 1.25s; needs 1.95s', 'check: 1 problem']);
});

test('bad-dead-stretch: nothing changes from 4.00 s to 7.50 s', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-dead-stretch.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0]: nothing changes from 4.00s to 7.50s (3.5s); add motion, or set "hold": true on text "drift" if it is meant to sit still', 'check: 1 problem']);
});

test('bad-text-floor: a 22 px text shown for 1.5 s', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = check([path.join(FIXTURES, 'bad-text-floor.json')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[1]: text "fine-print" is 22px (below 28px at 1080); shown 1.50s', 'check: 1 problem']);
});

test('ok-hold: a 10 s static title with "hold": true passes; the same title without it is a dead stretch up to the last 3 s', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const ok = check([path.join(FIXTURES, 'ok-hold.json')]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^check: ok \(1 scene, \d+ moments\)\n$/);
  const { loadSpec } = await import('../scripts/lib/spec.mjs');
  const { spec } = loadSpec(path.join(FIXTURES, 'ok-hold.json'));
  delete spec.scenes[0].elements[0].hold;
  const bad = check([writeSpec(spec)]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  // The rise preset has settled to within a tenth of a pixel by the 0.75 s step.
  assert.match(lines(bad.stdout)[0], /^scenes\[0\]: nothing changes from 0\.\d\ds to 7\.00s \(\d\.\ds\); add motion, or set "hold": true on text "headline" if it is meant to sit still$/);
  assert.equal(lines(bad.stdout)[1], 'check: 1 problem');
});

test('hold on a group covers its children; a hold element beside a static one that is not held is still reported', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const child = (id, y, text) => ({ id, type: 'text', text, x: 0, y, fontSize: 64 });
  const group = (hold) => ({ id: 'card', type: 'group', x: 960, y: 540, ...(hold ? { hold: true } : {}), children: [child('a', -100, 'First line'), child('b', 100, 'Second line')] });
  const scenes = (elements) => ({ scenes: [{ id: 's', duration: 8, elements }] });
  const held = check([writeSpec(scenes([group(true)]))]);
  assert.equal(held.status, 0, held.stdout + held.stderr);
  const loose = check([writeSpec(scenes([group(false)]))]);
  assert.equal(loose.status, 1, loose.stdout + loose.stderr);
  assert.deepEqual(lines(loose.stdout), ['scenes[0]: nothing changes from 0.00s to 5.00s (5.0s); add motion, or set "hold": true on text "a", text "b" if they are meant to sit still', 'check: 1 problem']);
  const beside = check([writeSpec(scenes([{ ...child('title', 300, 'Held title'), x: 960, hold: true }, { ...child('note', 700, 'Static note'), x: 960 }]))]);
  assert.equal(beside.status, 1, beside.stdout + beside.stderr);
  assert.match(beside.stdout, /^scenes\[0\]: nothing changes from 0\.00s to 5\.00s \(5\.0s\); add motion, or set "hold": true on text "note" if it is meant to sit still$/m);
});

test('a last line shown for 1.5 s is info on stderr, not a failure; --json lists it under info', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = writeSpec({
    scenes: [{
      id: 's', duration: 4,
      elements: [
        { id: 'first', type: 'text', text: 'Hello world', x: 960, y: 400, fontSize: 64 },
        { id: 'bye', type: 'text', text: 'Goodbye', x: 960, y: 700, fontSize: 64, keyframes: [{ t: 2.49, opacity: 0 }, { t: 2.5, opacity: 1 }] },
      ],
    }],
  });
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(1 scene, \d+ moments\)\n$/);
  // Measured, not sampled: the text is visible from just before its 2.5 s keyframe.
  assert.match(r.stderr, /^info: scenes\[0\]\.elements\[1\]: text "bye" \(1 word\) shows for 1\.5\ds; a last line reads best at 2 s or more\n$/);
  const json = JSON.parse(check([file, '--json']).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.info.length, 1);
  assert.equal(json.info[0].path, 'scenes[0].elements[1]');
  assert.match(json.info[0].message, /^text "bye" \(1 word\) shows for 1\.5\ds; a last line reads best at 2 s or more$/);
});

test('contrast: a text crossing a bright flash for a single sampled moment is a warning, not a failure', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = writeSpec({
    scenes: [{
      id: 's', duration: 3,
      elements: [
        { id: 'flash', type: 'shape', shape: 'rect', x: 960, y: 540, width: 1920, height: 1080, fill: '#ffffff', opacity: 0,
          keyframes: [{ t: 0.8, opacity: 0 }, { t: 0.9, opacity: 1 }, { t: 1, opacity: 0 }] },
        { id: 'sub', type: 'text', text: 'Quarterly review', x: 960, y: 540, fontSize: 64 },
      ],
    }],
  });
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^warning: scenes\[0\]\.elements\[1\]: text "sub" has 1\.1:1 contrast against its backdrop at 0\.90s; needs 3:1; nearest passing token: \w+\n$/);
  const json = JSON.parse(check([file, '--json']).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.warnings.length, 1);
});

test('dead stretch: a static title beside an invisible drifting rect, or one drifting off the canvas, is still a dead stretch', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const title = { id: 'title', type: 'text', text: 'Hello world', x: 960, y: 400, fontSize: 96 };
  const stretch = 'scenes[0]: nothing changes from 0.00s to 5.00s (5.0s); add motion, or set "hold": true on text "title" if it is meant to sit still';
  const ghost = { id: 'ghost', type: 'shape', shape: 'rect', x: 100, y: 800, width: 100, height: 100, opacity: 0, keyframes: [{ t: 0, x: 100 }, { t: 7.5, x: 1500 }] };
  const invisible = check([writeSpec({ scenes: [{ id: 's', duration: 8, elements: [title, ghost] }] })]);
  assert.equal(invisible.status, 1, invisible.stdout + invisible.stderr);
  assert.deepEqual(lines(invisible.stdout), [stretch, 'check: 1 problem']);
  const away = { ...ghost, id: 'away', opacity: 1, x: -400, keyframes: [{ t: 0, x: -400 }, { t: 7.5, x: -300 }] };
  const offCanvas = check([writeSpec({ scenes: [{ id: 's', duration: 8, elements: [title, away] }] })]);
  assert.equal(offCanvas.status, 1, offCanvas.stdout + offCanvas.stderr);
  assert.deepEqual(lines(offCanvas.stdout), [stretch, 'check: 1 problem']);
});

test('dead stretch: one in the second scene is reported on that scene, from the cut', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const moving = { id: 'mover', type: 'text', text: 'Moving along', x: 300, y: 540, fontSize: 64, keyframes: [{ t: 0, x: 300 }, { t: 2.9, x: 900 }] };
  const still = { id: 'second', type: 'text', text: 'Hello world', x: 960, y: 540, fontSize: 64 };
  const r = check([writeSpec({ scenes: [{ id: 'a', duration: 3, elements: [moving] }, { id: 'b', duration: 9, elements: [still] }] })]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[1]: nothing changes from 3.00s to 9.00s (6.0s); add motion, or set "hold": true on text "second" if it is meant to sit still', 'check: 1 problem']);
});

test('contrast: rgba(255,255,255,0.15) on the dusk page fails; the colour is judged at its alpha', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = writeSpec({ scenes: [{ id: 's', duration: 3, elements: [{ id: 'faint', type: 'text', text: 'Faint text', x: 960, y: 540, fontSize: 96, color: 'rgba(255,255,255,0.15)' }] }] });
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(lines(r.stdout)[0], /^scenes\[0\]\.elements\[0\]: text "faint" has 1\.\d:1 contrast against its backdrop at 0\.10s; needs 3:1; nearest passing token: text$/);
});

test('contrast: a white 120 px text over a half-white, half-black split fails and says no single colour passes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const half = (id, x, fill) => ({ id, type: 'shape', shape: 'rect', x, y: 540, width: 960, height: 1080, fill });
  const file = writeSpec({ scenes: [{ id: 's', duration: 3, elements: [half('left', 480, '#ffffff'), half('right', 1440, '#000000'), { id: 'split', type: 'text', text: 'Split view', x: 960, y: 540, fontSize: 120, color: '#ffffff' }] }] });
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), [
    'scenes[0].elements[2]: text "split" has 1.0:1 contrast against its backdrop at 0.10s; needs 3:1; no single colour passes over this background; add a backing card (fill "surface") or move the text',
    'check: 1 problem',
  ]);
});

test('contrast: text on an art background passes (the plate under it is part of the backdrop)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = writeSpec({ scenes: [{ id: 's', duration: 4, background: 'art', elements: [{ id: 'title', type: 'text', text: 'Hello there', x: 960, y: 540, fontSize: 96 }] }] });
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('check.mjs exports the steps builder Task 11a needs, and decides what is text from CHECKED_TYPES alone', () => {
  assert.equal(typeof checkModule.sampleSteps, 'function');
  assert.equal(typeof checkModule.sceneItems, 'function');
  const source = readFileSync(CHECK, 'utf8');
  assert.doesNotMatch(source, /classList\.contains\('text'\)|classList\.contains\('counter'\)/, 'one edit to CHECKED_TYPES adds a type');
});

test('captions are not elements: a nine-word caption shown for 1 s trips neither the reading floor nor the text floor', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const srt = '1\n00:00:01,000 --> 00:00:02,000\nthis caption has nine words and it is brief\n\n';
  const file = writeSpec({
    captions: [{ src: 'c.srt' }],
    scenes: [{ id: 's', duration: 4, elements: [{ id: 'title', type: 'text', text: 'Hello world', x: 960, y: 400, fontSize: 96 }] }],
  }, { 'c.srt': srt });
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('the dead-stretch audit counts captions as change: a static title under changing captions is not still', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const cues = [[0, 2], [2.2, 4.2], [4.4, 6.4], [6.6, 8.6]].map(([a, b], n) => {
    const stamp = (s) => `00:00:${String(Math.floor(s)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
    return `${n + 1}\n${stamp(a)} --> ${stamp(b)}\ncaption number ${n + 1}\n`;
  }).join('\n');
  const spec = (captions) => ({
    ...(captions ? { captions: [{ src: 'c.srt' }] } : {}),
    scenes: [{ id: 's', duration: 10, elements: [{ id: 'title', type: 'text', text: 'Hello world', x: 960, y: 400, fontSize: 96 }] }],
  });
  const quiet = check([writeSpec(spec(true), { 'c.srt': cues })]);
  assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
  const bare = check([writeSpec(spec(false))]);
  assert.equal(bare.status, 1, bare.stdout + bare.stderr);
});

// ---- the field and the block hints ------------------------------------------------------------------------------------

test('hold is a boolean on every element type; a block passes it to the group it expands to', () => {
  const scene = (el) => ({ scenes: [{ id: 's', duration: 4, elements: [el] }] });
  assert.equal(validateSpec(scene({ id: 'a', type: 'text', text: 'Hi', x: 1, y: 1, hold: true })).ok, true);
  assert.equal(validateSpec(scene({ id: 'g', type: 'group', x: 1, y: 1, hold: true, children: [{ id: 'a', type: 'text', text: 'Hi', x: 0, y: 0 }] })).ok, true);
  const block = { id: 'b', type: 'block', block: 'title-card', x: 960, y: 540, hold: true, params: { title: 'Hello' } };
  assert.equal(validateSpec(scene(block)).ok, true);
  assert.equal(withDefaults(scene(block)).scenes[0].elements[0].hold, true);
  const wrong = validateSpec(scene({ id: 'a', type: 'text', text: 'Hi', x: 1, y: 1, hold: 'yes' }));
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.errors.map((e) => `${e.path}: ${e.message}`), ['scenes[0].elements[0].hold: must be boolean']);
});

test('a finding inside a block names the block, the part and what to change, matched to the kind of finding', () => {
  const written = { scenes: [{ id: 's', duration: 4, elements: [{ id: 'lt', type: 'block', block: 'lower-third', x: 100, y: 818, params: { name: 'Ada Lovelace' } }] }] };
  const spec = withDefaults(written);
  const index = spec.scenes[0].elements[0].children.findIndex((c) => c.id === 'lt/name');
  const where = `scenes[0].elements[0].children[${index}]`;
  const hint = (message) => atBlockParts(written, spec, [{ path: where, message }])[0];
  assert.deepEqual(hint('text "lt/name" has 2.0:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text'), {
    path: 'scenes[0].elements[0]',
    message: 'text "lt/name" has 2.0:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text (block "lower-third", part "name"); blocks use theme colours; change "theme" or the scene background',
  });
  assert.equal(hint('text "lt/name" is 20px (below 28px at 1080); shown 1.00s').message, 'text "lt/name" is 20px (below 28px at 1080); shown 1.00s (block "lower-third", part "name"); raise the block\'s "scale" or use a larger format');
  assert.equal(hint('text "lt/name" (2 words) shows for 0.50s; needs 1.05s').message, 'text "lt/name" (2 words) shows for 0.50s; needs 1.05s (block "lower-third", part "name"); lengthen the scene or shorten params.name');
  const card = atBlockParts(written, spec, [{ path: 'scenes[0].elements[0].children[0]', message: 'text "lt/card" has 2.0:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text' }])[0];
  assert.match(card.message, /; blocks use theme colours; change "theme" or the scene background$/, 'the lever is the same for a part that no param sets');
});

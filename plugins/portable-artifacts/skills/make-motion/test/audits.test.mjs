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
import { atBlockParts } from '../scripts/check.mjs';
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
  opacity: 1, box: { left: 0, top: 0, right: 100, bottom: 50 }, undrawn: false, sig: 'still', fontSize: 48, weight: 600, color: '#ffffff',
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

test('nearestToken: the theme colour with the smallest contrast that still passes; null when none does', () => {
  const backdrop = '#555555';
  assert.equal(nearestToken(backdrop, 4.5, dusk), 'text2', 'text2 is 4.69:1, good 4.98, warn 4.85, text 6.36');
  assert.equal(nearestToken('#808080', 4.5, dusk), null);
  assert.equal(nearestToken(backdrop, 4.5, { text: 'not a colour' }), null);
});

test('contrastFindings: 2.9:1 small text needs 4.5:1 and names the nearest passing token; large text needs only 3:1', () => {
  const text = '#a0a0a0';
  const backdrop = '#555555';
  assert.ok(contrastRatio(text, backdrop) > 2.8 && contrastRatio(text, backdrop) < 3, 'the premise: about 2.9:1');
  const sample = (t, fontSize) => ({ t, els: [measured({ color: text, fontSize })], back: [backdrop] });
  const small = contrastFindings([item('text', 'sub')], [sample(1, 20), sample(2, 20)], dusk, [1920, 1080]);
  assert.deepEqual(small.problems, [{ path: 'scenes[0].elements[sub]', message: 'text "sub" has 2.8:1 contrast against its backdrop at 1.00s; needs 4.5:1; nearest passing token: text2' }]);
  assert.deepEqual(small.warnings, []);
  const large = contrastFindings([item('text', 'sub')], [sample(1, 40), sample(2, 40)], dusk, [1920, 1080]);
  assert.match(large.problems[0].message, /needs 3:1; nearest passing token: /);
  const faint = (t) => ({ t, els: [measured({ color: '#ffffff', fontSize: 20 })], back: ['#808080'] });
  const none = contrastFindings([item('text', 'sub')], [faint(0.5), faint(0.75)], { text: '#ffffff' }, [1920, 1080]);
  assert.match(none.problems[0].message, /; no theme token passes; change the background$/);
});

test('contrastFindings: one failing sample is a warning, two consecutive a problem, two apart a warning; faint or hidden text is not judged', () => {
  const bad = (t, over = {}) => ({ t, els: [measured({ color: '#f7ebe0', ...over })], back: ['#ffffff'] });
  const good = (t) => ({ t, els: [measured({ color: '#f7ebe0' })], back: ['#17102a'] });
  const run = (samples) => contrastFindings([item('text', 'sub')], samples, dusk, [1920, 1080]);
  const single = run([good(0.1), bad(0.9), good(1.0)]);
  assert.deepEqual([single.problems.length, single.warnings.length], [0, 1]);
  assert.match(single.warnings[0].message, /^text "sub" has 1\.1:1 contrast against its backdrop at 0\.90s; needs 3:1/);
  const held = run([good(0.1), bad(0.9), bad(1.0), good(1.1)]);
  assert.deepEqual([held.problems.length, held.warnings.length], [1, 0]);
  assert.match(held.problems[0].message, /at 0\.90s/);
  assert.deepEqual([run([bad(0.9), good(1.0), bad(1.1)]).problems.length, run([bad(0.9), good(1.0), bad(1.1)]).warnings.length], [0, 1], 'a pass in between breaks the run');
  const faint = run([bad(0.1, { opacity: 0.4 }), bad(0.2, { opacity: 0.4 })]);
  assert.deepEqual([faint.problems.length, faint.warnings.length], [0, 0]);
  assert.deepEqual(run([bad(0.1, { shown: false }), bad(0.2, { shown: false })]).problems, []);
  const shape = contrastFindings([item('shape', 'box')], [bad(0.1), bad(0.2)], dusk, [1920, 1080]);
  assert.deepEqual(shape, { problems: [], warnings: [] }, 'only text and counters have a text colour');
});

test('readingSeconds: 0.75 x (0.5 + 0.3 x words), so 7 words need 1.95 s (controller ruling R11)', () => {
  assert.ok(Math.abs(readingSeconds(7) - 1.95) < 1e-9);
  assert.ok(Math.abs(readingSeconds(1) - 0.6) < 1e-9);
  assert.ok(Math.abs(readingSeconds(0) - 0.375) < 1e-9);
});

const reading = (spec, items, steps) => readingFloorFindings(spec, items, steps);

test('readingFloorFindings: a text must stay on screen for its reading time; the exact message; one word is singular', () => {
  const spec = { scenes: [{ id: 's', duration: 6 }] };
  const items = [[item('text', 'sub', { text: 'one two three four five six seven' }), item('text', 'one', { text: 'Hi' }), item('text', 'end', { text: 'The end' }), item('counter', 'n')]];
  const seen = (local) => [local >= 1 && local < 2.25, local >= 2 && local < 2.25, local >= 3, true].map((shown) => measured({ shown }));
  const { problems, info } = reading(spec, items, grid(6, seen));
  assert.deepEqual(problems, [
    { path: 'scenes[0].elements[sub]', message: 'text "sub" (7 words) shows for 1.25s; needs 1.95s' },
    { path: 'scenes[0].elements[one]', message: 'text "one" (1 word) shows for 0.25s; needs 0.60s' },
  ]);
  assert.deepEqual(info, [], 'the last line "end" shows for 3 s');
});

test('readingFloorFindings: a text is reported only when no placement of its edges within one step could make it long enough', () => {
  const items = [[item('text', 'sub', { text: 'one two three four five six seven' })]];
  const spec = { scenes: [{ id: 's', duration: 6 }] };
  const run = (from, to) => reading(spec, items, grid(6, (t) => [measured({ shown: t >= from && t < to })])).problems;
  assert.equal(run(1, 3).length, 0, 'sampled 2.0 s');
  assert.equal(run(1, 2.5).length, 1, 'sampled 1.5 s; at most 1.75 s with both edges stretched a step');
  assert.equal(run(1, 2.75).length, 0, 'sampled 1.75 s; could be 2.25 s');
  assert.equal(run(1, 2.25).length, 1, 'the case of bad-reading-floor: 1.25 s sampled, 1.5 s at most');
});

test('readingFloorFindings: the formula is the error rule for the last line too; a last line under 2 s that clears it is info', () => {
  const longLine = Array.from({ length: 20 }, (_, n) => `w${n}`).join(' ');
  const spec = { scenes: [{ id: 's', duration: 6 }] };
  const long = [[item('text', 'last', { text: longLine })]];
  const lastFrom = (items, from) => reading(spec, items, grid(6, (t) => [measured({ shown: t >= from })]));
  assert.deepEqual(lastFrom(long, 1).problems, [], '5 s of a 20-word last line meets the formula (4.88 s)');
  assert.deepEqual(lastFrom(long, 4).problems, [
    { path: 'scenes[0].elements[last]', message: 'text "last" (20 words) shows for 2.00s; needs 4.88s' },
  ], 'the formula stands for the last line: 20 words need 4.88 s');
  const short = [[item('text', 'last', { text: 'Bye' })]];
  assert.deepEqual(lastFrom(short, 4.5), {
    problems: [],
    info: [{ path: 'scenes[0].elements[last]', message: 'text "last" (1 word) shows for 1.50s; a last line reads best at 2 s or more' }],
  });
  assert.deepEqual(lastFrom(short, 4.25), { problems: [], info: [] }, '1.75 s as sampled, but it could be 2.0 s: the 0.25 s grid cannot tell');
  assert.deepEqual(lastFrom(short, 4), { problems: [], info: [] });
  const earlier = [{ id: 'a', duration: 6 }, { id: 'b', duration: 6 }];
  const quick = reading({ scenes: earlier }, [[item('text', 'x', { text: 'Bye' })], []], grid(6, (t) => [measured({ shown: t >= 4.5 })]));
  assert.deepEqual(quick.info, [], 'a line that is not in the final scene is not a last line');
  const two = [[item('text', 'blink', { text: 'Hi there' }), item('text', 'last', { text: 'Bye' })]];
  const blinking = reading(spec, two, grid(6, (t) => [measured({ shown: t < 0.5 || (t >= 2 && t < 3.5) }), measured({ shown: t >= 3 })]));
  assert.deepEqual(blinking, { problems: [], info: [] }, 'a 0.5 s blink and a 1.5 s span: the longest span counts, and it is enough (need 0.825 s)');
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
  assert.deepEqual(deadStretchProblems(spec, steps), [{ path: 'scenes[0]', message: 'nothing changes from 4.00s to 7.50s (3.5s); add motion or mark the elements "hold": true' }]);
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
  assert.deepEqual(stillStretches(spec, empty), [{ from: 4, to: 9 }], 'an empty screen is not a held one');
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
    'scenes[0].elements[1]: text "sub" has 2.1:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: bad',
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
  assert.deepEqual(lines(r.stdout), ['scenes[0]: nothing changes from 4.00s to 7.50s (3.5s); add motion or mark the elements "hold": true', 'check: 1 problem']);
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
  assert.match(lines(bad.stdout)[0], /^scenes\[0\]: nothing changes from 0\.\d\ds to 7\.00s \(\d\.\ds\); add motion or mark the elements "hold": true$/);
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
  assert.deepEqual(lines(loose.stdout), ['scenes[0]: nothing changes from 0.00s to 5.00s (5.0s); add motion or mark the elements "hold": true', 'check: 1 problem']);
  const beside = check([writeSpec(scenes([{ ...child('title', 300, 'Held title'), x: 960, hold: true }, { ...child('note', 700, 'Static note'), x: 960 }]))]);
  assert.equal(beside.status, 1, beside.stdout + beside.stderr);
  assert.match(beside.stdout, /^scenes\[0\]: nothing changes from 0\.00s to 5\.00s/);
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
  assert.equal(r.stderr, 'info: scenes[0].elements[1]: text "bye" (1 word) shows for 1.50s; a last line reads best at 2 s or more\n');
  const json = JSON.parse(check([file, '--json']).stdout);
  assert.equal(json.ok, true);
  assert.deepEqual(json.info, [{ path: 'scenes[0].elements[1]', message: 'text "bye" (1 word) shows for 1.50s; a last line reads best at 2 s or more' }]);
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
    message: 'text "lt/name" has 2.0:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text (block "lower-third", part "name"); change params.name colour or the theme token',
  });
  assert.equal(hint('text "lt/name" is 20px (below 28px at 1080); shown 1.00s').message, 'text "lt/name" is 20px (below 28px at 1080); shown 1.00s (block "lower-third", part "name"); raise the font size');
  assert.equal(hint('text "lt/name" (2 words) shows for 0.50s; needs 1.05s').message, 'text "lt/name" (2 words) shows for 0.50s; needs 1.05s (block "lower-third", part "name"); lengthen the scene or shorten params.name');
  const card = atBlockParts(written, spec, [{ path: 'scenes[0].elements[0].children[0]', message: 'text "lt/card" has 2.0:1 contrast against its backdrop at 0.10s; needs 3:1; nearest passing token: text' }])[0];
  assert.match(card.message, /; change the theme token or the backdrop behind the block$/, 'a part that no param sets');
});

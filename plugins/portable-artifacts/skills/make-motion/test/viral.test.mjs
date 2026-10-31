// Task 11a: `"mode": "viral"` — 9:16 defaults, the platform safe zone, the hook entrance, auto cues, change gaps, the
// viral check warnings and the loudness report line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { presetKeyframes, exitKeyframes } from '../template/defaults.mjs';
import { DEAD_STRETCH_SECONDS } from '../scripts/lib/audits.mjs';
import { expandBlocks } from '../template/blocks/index.mjs';
import { safeInsets, captionZone, VIRAL_SAFE_ZONE, VIRAL_CAPTION_TOP, FORMATS } from '../template/formats.mjs';
import { applyViral, autoCues, changeGaps, viralInsets, hookKeyframes, HOOK_ENTRANCE, AUTO_CUE_GAP, VIRAL_CHANGE_SECONDS } from '../template/viral.mjs';
import { BLOCKS, BLOCK_NAMES } from '../template/blocks/index.mjs';
import { MAX_CUES } from '../template/audio.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { waitReady } from '../scripts/check.mjs';
import { requireRender, renderHash, assertRendersIdentically, BROWSER_ONLY } from './helpers/render.mjs';
import { writeWav } from './helpers/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const RENDER = path.join(root, 'scripts/render.mjs');
const EXAMPLE = path.join(root, 'references/examples/viral-hook.json');
const PHONE = [1080, 1920];
const SMALL = ['--fps', '10', '--size', '180x320'];

const hookText = (extra = {}) => ({ id: 'hook', type: 'text', text: 'Watch this one trick', x: 502, y: 600, fontSize: 72, fontWeight: 700, ...extra });
const viral = (scenes, extra = {}) => ({ mode: 'viral', fps: 30, ...extra, scenes });
const scene = (id, duration, elements, extra = {}) => ({ id, duration, elements, ...extra });

// A temp folder holding motion.json and `files` (name -> contents, or a function given the absolute path).
function specFile(motion, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'viral-'));
  for (const [name, body] of Object.entries(files)) {
    if (typeof body === 'function') body(path.join(dir, name));
    else writeFileSync(path.join(dir, name), body);
  }
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify(motion));
  return file;
}
const run = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const errs = (motion) => validateSpec(motion).errors.map((e) => `${e.path}: ${e.message}`);
const warningLines = (stderr) => stderr.split('\n').filter((l) => l.startsWith('warning: '));

// ---- defaults, zones and the hook ------------------------------------------------------------------------------

test('withDefaults under mode viral: size [1080,1920], loudness {-14,-1}, safeZone the union; an explicit format 1:1 and a written loudness are kept', () => {
  const out = withDefaults(viral([scene('s', 2, [])]));
  assert.deepEqual(out.size, PHONE);
  assert.equal(out.format, '9:16');
  assert.deepEqual(out.loudness, { integrated: -14, truePeak: -1 });
  assert.deepEqual(out.viral.safeZone, { top: 290, bottom: 675, left: 120, right: 195 });
  assert.deepEqual(VIRAL_SAFE_ZONE, { top: 290, bottom: 675, left: 120, right: 195 });

  const square = withDefaults(viral([scene('s', 2, [])], { format: '1:1', loudness: { integrated: -16, truePeak: -2 } }));
  assert.equal(square.format, '1:1');
  assert.deepEqual(square.size, [1080, 1080]);
  assert.deepEqual(square.loudness, { integrated: -16, truePeak: -2 });
  const sized = withDefaults(viral([scene('s', 2, [])], { size: [720, 1280] }));
  assert.deepEqual(sized.size, [720, 1280], 'a written size is kept, and no format is added beside it');
  assert.equal(sized.format, undefined);

  const zone = { top: 100, bottom: 200, left: 30, right: 40 };
  assert.deepEqual(withDefaults(viral([scene('s', 2, [])], { viral: { safeZone: zone, loop: true } })).viral, { safeZone: zone, loop: true });

  const plain = withDefaults({ scenes: [scene('s', 2, [])] });
  assert.equal(plain.loudness, undefined, 'no mode: no loudness target');
  assert.equal(plain.viral, undefined);
  assert.deepEqual(plain.size, [1920, 1080]);
});

test('applyViral is pure and leaves a spec without mode untouched', () => {
  const written = viral([scene('s', 2, [hookText({ role: 'title' })])]);
  const copy = structuredClone(written);
  applyViral(written);
  assert.deepEqual(written, copy);
  const plain = { scenes: [scene('s', 2, [hookText({ role: 'title' })])] };
  assert.equal(applyViral(plain), plain);
});

test('safeInsets([1080,1920], VIRAL_SAFE_ZONE) is {290,195,675,120}; at [540,960] every value halves; a 10 px zone never goes below safeMargin', () => {
  assert.deepEqual(safeInsets(PHONE, VIRAL_SAFE_ZONE), { top: 290, right: 195, bottom: 675, left: 120 });
  assert.deepEqual(safeInsets([540, 960], VIRAL_SAFE_ZONE), { top: 145, right: 97.5, bottom: 337.5, left: 60 });
  assert.deepEqual(safeInsets(PHONE, { top: 10, bottom: 10, left: 10, right: 10 }), { top: 60, right: 60, bottom: 60, left: 60 });
  assert.deepEqual(safeInsets(PHONE), { top: 60, right: 60, bottom: 60, left: 60 }, 'no zone: the plain 60 px margin');
});

test('captionZone([1080,1920], "9:16", insets) is {120, 998, 885, 1245}; without insets it is Task 6\'s {60, 1382, 1020, 1860}', () => {
  assert.equal(VIRAL_CAPTION_TOP, 0.52);
  assert.deepEqual(captionZone(PHONE, '9:16', safeInsets(PHONE, VIRAL_SAFE_ZONE)), { left: 120, top: 998, right: 885, bottom: 1245 });
  assert.deepEqual(captionZone(PHONE, '9:16'), { left: 60, top: 1382, right: 1020, bottom: 1860 });
  assert.deepEqual(viralInsets(withDefaults(viral([scene('s', 2, [])]))), { top: 290, right: 195, bottom: 675, left: 120 });
  assert.equal(viralInsets(withDefaults({ scenes: [scene('s', 2, [])] })), null);
});

test('a scene-0 title with no keyframes starts at opacity 1 and scale 1.08 under viral; without mode it keeps the theme entrance, which renders the same bytes as that entrance written out', async (t) => {
  assert.deepEqual(HOOK_ENTRANCE, { scale: 1.08, seconds: 0.4, ease: 'enter' });
  const title = hookText({ role: 'title' });
  const later = { ...hookText({ id: 'later', role: 'title' }) };
  const motion = viral([scene('a', 2, [title]), scene('b', 2, [later])]);
  const out = withDefaults(motion);
  assert.deepEqual(out.scenes[0].elements[0].keyframes, [{ t: 0, opacity: 1, scale: 1.08 }, { t: 0.4, scale: 1, ease: 'enter' }]);
  assert.deepEqual(out.scenes[1].elements[0].keyframes, presetKeyframes('rise', later, 2, 30), 'scenes 1+ keep the theme entrance');
  assert.deepEqual(validateSpec(motion).errors, []);
  // A 0.2 s first scene: the hook settles a frame before the scene ends, so the validator accepts it.
  const short = withDefaults(viral([scene('a', 0.2, [title])]));
  assert.deepEqual(short.scenes[0].elements[0].keyframes.at(-1), { t: 0.1666, scale: 1, ease: 'enter' });
  assert.deepEqual(validateSpec(viral([scene('a', 0.2, [title])])).errors, []);

  const plainMotion = { format: '9:16', fps: 30, scenes: [scene('a', 2, [title])] };
  const entrance = presetKeyframes('rise', title, 2, 30);
  assert.deepEqual(withDefaults(plainMotion).scenes[0].elements[0].keyframes, entrance);
  if (!(await requireRender(t))) return;
  // The theme entrance, written out by hand, renders the same bytes as the spec that leaves it to the theme.
  const plain = await renderHash(specFile(plainMotion), SMALL);
  const spelled = await renderHash(specFile({ ...plainMotion, scenes: [scene('a', 2, [{ ...title, keyframes: entrance }])] }), SMALL);
  assert.equal(plain.sha256, spelled.sha256);
});

test('a hook title with "exit": true keeps the theme exit after the hook entrance; a hook in a group hidden at t 0 keeps the theme entrance', () => {
  const title = hookText({ role: 'title', exit: true });
  const out = withDefaults(viral([scene('a', 3, [title]), scene('b', 2, [])]));
  const hook = hookKeyframes(title, 3, 30);
  assert.deepEqual(out.scenes[0].elements[0].keyframes, [...hook, ...exitKeyframes('rise', title, 3, 30, hook)]);
  assert.equal(out.scenes[0].elements[0].exitPreset, true, 'check.mjs knows it leaves on purpose');
  assert.equal(withDefaults({ scenes: [scene('a', 3, [title]), scene('b', 2, [])] }).scenes[0].elements[0].exitPreset, true, 'as without mode');

  const inner = hookText({ role: 'title', x: 0, y: 0 });
  const group = (keyframes) => ({ id: 'g', type: 'group', x: 502, y: 600, children: [inner], ...(keyframes ? { keyframes } : {}) });
  const fading = withDefaults(viral([scene('a', 3, [group([{ t: 0, opacity: 0 }, { t: 0.5, opacity: 1 }])])]));
  assert.deepEqual(fading.scenes[0].elements[0].children[0].keyframes, presetKeyframes('rise', inner, 3, 30), 'hidden at frame 0 anyway: the theme entrance');
  const shown = withDefaults(viral([scene('a', 3, [group([{ t: 0, x: 480 }, { t: 1, x: 502 }])])]));
  assert.deepEqual(shown.scenes[0].elements[0].children[0].keyframes, hookKeyframes(inner, 3, 30), 'a group on screen at t 0 passes the hook on');
  // A theme without a title preset still gets the hook.
  assert.deepEqual(withDefaults(viral([scene('a', 3, [title])], { theme: 'paper' })).scenes[0].elements[0].keyframes, hookKeyframes(title, 3, 30));
});

test('a block opening a viral spec puts only its hook parts on at frame 0: the quote-card quote and card, never its quotation mark', () => {
  const quote = { id: 'q', type: 'block', block: 'quote-card', x: 502, y: 644, params: { quote: 'Lead with the payoff first', attribution: 'An editor' } };
  const parts = withDefaults(viral([scene('s', 4, [quote])])).scenes[0].elements[0].children;
  const first = (id) => parts.find((p) => p.id === `q/${id}`).keyframes[0];
  assert.equal(first('quote').opacity, 1);
  assert.equal(first('card').opacity, 1);
  assert.equal(first('mark').opacity, 0, 'the glyph still enters after the words');
  assert.equal(first('attribution').opacity, 0);
  // The same block opening the video and in scene 2 (same layout, no hook): only the hook parts differ.
  for (const name of BLOCK_NAMES) {
    const at = (id) => ({ id, type: 'block', block: name, x: 500, y: 500, params: BLOCKS[name].example });
    const out = expandBlocks(viral([scene('s', 4, [at('a')]), scene('t', 4, [at('b')])]));
    const later = out.scenes[1].elements[0].children;
    const changed = out.scenes[0].elements[0].children.filter((p, i) => JSON.stringify(p.keyframes) !== JSON.stringify(later[i].keyframes)).map((p) => p.id.slice(2));
    assert.deepEqual(changed, BLOCKS[name].hook ?? [], name);
  }
});

// ---- change gaps and auto cues -----------------------------------------------------------------------------------

test('changeGaps: a 10 s scene with one keyframe at 2 s gives [{from: 2, to: 10}]; a counter tween from 2 s to 9 s gives []', () => {
  assert.equal(VIRAL_CHANGE_SECONDS, 3);
  assert.equal(VIRAL_CHANGE_SECONDS, DEAD_STRETCH_SECONDS, 'the no-browser path and the page path use one threshold');
  const once = { id: 'x', type: 'text', text: 'Hi there', x: 500, y: 500, keyframes: [{ t: 2, opacity: 1 }] };
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 10, [once])] })), [{ from: 2, to: 10 }]);
  const counter = { id: 'n', type: 'counter', to: 5, x: 500, y: 500, keyframes: [{ t: 2, value: 0 }, { t: 9, value: 5 }] };
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 10, [counter])] })), []);
  // A typing text types continuously; a counter without value keyframes counts for min(2 s, 80 %) from the start.
  const typing = { id: 'ty', type: 'text', typing: true, text: 'x'.repeat(100), x: 500, y: 500 };
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 6, [typing])] })), [], '100 characters type for 3.5 s');
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 8, [{ id: 'n', type: 'counter', to: 5, x: 1, y: 1 }])] })), [{ from: 2, to: 8 }]);
  // Scene starts are change moments too, and a still first scene counts from 0.
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('a', 4, []), scene('b', 2, [])] })), [{ from: 0, to: 4 }]);
  // Any tween is change (a slow pan), and so is a caption appearing or going.
  const pan = { ...once, keyframes: [{ t: 0, x: 400 }, { t: 8, x: 600 }] };
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 10, [pan])] })), []);
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 10, [once])] }), [4, 6, 8]), []);
  assert.deepEqual(changeGaps(withDefaults({ scenes: [scene('s', 10, [once])] }), [6]), [{ from: 2, to: 6 }, { from: 6, to: 10 }], 'a caption change splits a gap, and each side still counts');
});

test('autoCues: three scenes, an entering title, a counter landing at 2.5 s and a reveal at 2.7 s give swoosh at scenes 2 and 3, ding at 2.5 and no pop at 2.7; 40 entrances cap at 30; "cues": [] gives none; a written cue list wins', () => {
  assert.equal(AUTO_CUE_GAP, 0.4);
  const counter = { id: 'n', type: 'counter', from: 0, to: 3, x: 500, y: 900, keyframes: [{ t: 0.5, value: 0 }, { t: 2.5, value: 3, ease: 'outCubic' }] };
  const reveal = { id: 'line', type: 'shape', shape: 'line', x: 500, y: 1000, width: 400, keyframes: [{ t: 2.7, draw: 0 }, { t: 3.5, draw: 1 }] };
  const entering = { id: 'late', type: 'text', text: 'And then', x: 500, y: 700, keyframes: [{ t: 1, opacity: 0 }, { t: 1.4, opacity: 1 }] };
  const motion = viral([
    scene('one', 4, [hookText({ role: 'title' }), counter, reveal]),
    scene('two', 3, [hookText({ id: 'title2', role: 'title' })]), // the theme entrance starts at opacity 0 on the cut
    scene('three', 3, [entering]),
  ]);
  assert.deepEqual(withDefaults(motion).cues, [
    { cue: 'ding', scene: 'one', at: 2.5, volume: 0.5 },
    { cue: 'swoosh', scene: 'two', at: 0, volume: 0.6 },
    { cue: 'swoosh', scene: 'three', at: 0, volume: 0.6 },
    { cue: 'pop', scene: 'three', at: 1, volume: 0.35 },
  ]);
  assert.deepEqual(withDefaults(motion).cues, autoCues(withDefaults({ ...motion, cues: undefined })), 'deterministic, and the same function');

  const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, type: 'text', text: 'x', x: 500, y: 500, keyframes: [{ t: i * 0.5, opacity: 0 }, { t: i * 0.5 + 0.2, opacity: 1 }] }));
  assert.equal(withDefaults(viral([scene('s', 30, many)])).cues.length, MAX_CUES);
  assert.deepEqual(withDefaults(viral([scene('s', 30, many)], { cues: [] })).cues, []);
  const written = [{ cue: 'chime', at: 1 }];
  assert.deepEqual(withDefaults(viral([scene('s', 30, many)], { cues: written })).cues, written);
  assert.equal(withDefaults({ scenes: [scene('s', 30, many)] }).cues, undefined, 'no mode: no auto cues');
  // An entrance on the scene's last frame is dropped.
  const last = { id: 'z', type: 'text', text: 'x', x: 1, y: 1, keyframes: [{ t: 1.98, opacity: 0 }, { t: 2, opacity: 1 }] };
  assert.deepEqual(withDefaults(viral([scene('s', 2, [last])])).cues, []);
});

// ---- schema -------------------------------------------------------------------------------------------------------

test('schema: viral without mode, safeZone.top 900 and loudness.integrated -2 give the exact messages', () => {
  const s = [scene('s', 2, [])];
  assert.deepEqual(errs({ viral: { loop: true }, scenes: s }), ['viral: needs "mode": "viral"']);
  assert.deepEqual(errs(viral(s, { viral: { safeZone: { top: 900, bottom: 675, left: 120, right: 195 } } })), ['viral.safeZone.top: must be <= 800']);
  assert.deepEqual(errs({ loudness: { integrated: -2, truePeak: -1 }, scenes: s }), ['loudness.integrated: must be <= -5']);
  assert.deepEqual(errs(viral(s, { viral: { safeZone: VIRAL_SAFE_ZONE, loop: false }, loudness: { integrated: -14, truePeak: -1 } })), []);
  assert.deepEqual(errs({ mode: 'virall', scenes: s }), ['mode: must be one of "viral"; did you mean "viral"?']);
  for (const key of ['__proto__', 'constructor', 'toString']) assert.deepEqual(errs({ mode: key, scenes: s }), ['mode: must be one of "viral"']);
});

test('schema: a safe zone whose bands overlap or crowd out the content or the captions is refused, naming the limit', () => {
  const s = [scene('s', 2, [])];
  const zone = (z) => errs(viral(s, { viral: { safeZone: { ...VIRAL_SAFE_ZONE, ...z } } }));
  assert.deepEqual(zone({ top: 800, bottom: 800, left: 600, right: 600 }), [
    'viral.safeZone: left 600 + right 600 leave 0 px of the 1080 px width; keep left + right at most 720',
    'viral.safeZone.top: 800 leaves 198 px above the captions (they start at y 998); keep top at most 758',
    'viral.safeZone.bottom: 800 leaves the captions 122 px (y 998 to 1120); keep bottom at most 762',
  ]);
  assert.deepEqual(zone({ left: 400, right: 320 }), [], 'exactly 360 px across is enough');
  assert.deepEqual(zone({ left: 400, right: 321 }), ['viral.safeZone: left 400 + right 321 leave 359 px of the 1080 px width; keep left + right at most 720']);
  assert.deepEqual(zone({ top: 758, bottom: 762 }), [], 'the limits themselves are fine');
});

// ---- blocks under viral ---------------------------------------------------------------------------------------------

test('every block at its viral place() keeps every part inside the platform safe zone and above the lifted caption zone at 9:16', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const insets = safeInsets(PHONE, VIRAL_SAFE_ZONE);
  const zone = captionZone(PHONE, '9:16', insets);
  const srt = '1\n00:00:00,200 --> 00:00:05,800\nCaptions stay on screen the whole time\n';
  const browser = await launchBrowser({ quiet: true });
  try {
    for (const name of BLOCK_NAMES) {
      const def = BLOCKS[name];
      const { x, y } = def.place(PHONE, '9:16', def.example.side, insets);
      const params = { ...def.example, ...(def.assets ?? []).reduce((a, key) => ({ ...a, [key]: 'logo.svg' }), {}) };
      const motion = viral([scene('s', 6, [{ id: 'b', type: 'block', block: name, x, y, params }])], { captions: [{ src: 'c.srt' }] });
      const file = specFile(motion, { 'c.srt': srt, 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#f2a65a"/></svg>' });
      assert.deepEqual(validateSpec(motion, { dir: path.dirname(file) }).errors, [], name);
      const srv = await startServer({ specPath: file, mode: 'render' });
      const page = await browser.newPage({ viewport: { width: PHONE[0], height: PHONE[1] }, deviceScaleFactor: 1 });
      try {
        await page.goto(srv.url);
        await waitReady(page);
        await page.evaluate((s) => window.__motion.seek(s), 5.5);
        const boxes = await page.evaluate(() => {
          const stage = document.getElementById('stage').getBoundingClientRect();
          const k = window.__motion.size[0] / stage.width;
          return [...document.querySelectorAll('#stage .scene .el:not(.group)')].map((n) => {
            const r = n.getBoundingClientRect();
            return { id: n.dataset.id, left: (r.left - stage.left) * k, top: (r.top - stage.top) * k, right: (r.right - stage.left) * k, bottom: (r.bottom - stage.top) * k };
          });
        });
        for (const b of boxes) {
          const where = `${name}: "${b.id}" ${JSON.stringify(b)}`;
          assert.ok(b.left >= insets.left - 0.5 && b.right <= PHONE[0] - insets.right + 0.5, `${where} crosses a side band (${insets.left}..${PHONE[0] - insets.right})`);
          assert.ok(b.top >= insets.top - 0.5 && b.bottom <= zone.top + 0.5, `${where} leaves ${insets.top}..${zone.top}`);
        }
      } finally { await page.close(); await srv.close(); }
    }
  } finally { await browser.close(); }
});

test('place() without insets is unchanged, and blocks.mjs show prints the viral place', () => {
  assert.deepEqual(BLOCKS['title-card'].place(PHONE, '9:16'), { x: 540, y: 960 });
  assert.deepEqual(BLOCKS['title-card'].place(PHONE, '9:16', undefined, safeInsets(PHONE, VIRAL_SAFE_ZONE)), { x: 502.5, y: 644 });
  assert.deepEqual(BLOCKS['lower-third'].place(PHONE, '9:16', 'right', safeInsets(PHONE, VIRAL_SAFE_ZONE)), { x: 845, y: 974 });
  const show = run(path.join(root, 'scripts/blocks.mjs'), ['show', 'title-card']);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /^place \(x, y\): 16:9 x 960 y 540; 9:16 x 540 y 960; 1:1 x 540 y 540; 4:5 x 540 y 675; viral 9:16 x 503 y 644$/m);
});

// ---- check.mjs ------------------------------------------------------------------------------------------------------

test('check.mjs viral warnings, exact lines: an 8-word hook; a text at y 1700 (inside 60 px, under the bottom band); a 4 s still ending reported once as the viral warning and not as a dead stretch; audio without captions; format 16:9; loop true with differing frames; exit 0 for all of them', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const cases = [
    ['8-word hook', viral([scene('s', 2, [hookText({ text: 'one two three four five six seven eight', fontSize: 56, maxWidth: 700 })])]),
      ['warning: scenes[0].elements[0]: viral: hook "one two three four five six seven eight" has 8 words; use 3–7']],
    ['under the bottom band', viral([scene('s', 2, [hookText(), { id: 'cta', type: 'text', text: 'Follow', x: 502, y: 1700, fontSize: 48 }])]),
      ['warning: scenes[0].elements[1]: viral: text "cta" sits under the platform UI (bottom 675 px) at 0.10s']],
    ['still ending', viral([scene('s', 4, [hookText()])]),
      ['warning: viral: nothing changes from 0.00s to 4.00s (4.0s), the final seconds too; move the CTA or loop back to the hook']],
    ['audio, no captions', viral([scene('s', 2, [hookText()])], { audio: [{ src: 'tone.wav' }] }),
      ['warning: viral: no captions; Reels, TikTok and Shorts are watched muted; add a captions track (the voice sidecar or an SRT)']],
    ['format 16:9', viral([scene('s', 2, [hookText({ x: 960, y: 540 })])], { format: '16:9' }),
      ['warning: viral: format 16:9; Reels, TikTok and Shorts are 9:16']],
    ['no hook', viral([scene('s', 2, [{ id: 'box', type: 'shape', shape: 'rect', x: 502, y: 600, width: 300, height: 300, fill: 'accent' }])]),
      ['warning: viral: no hook text at frame 0; show 3–7 words from the first frame']],
    ['typing hook: nothing typed at frame 0', viral([scene('s', 2, [hookText({ role: 'title', typing: true })])]), [
      'warning: scenes[0]: scene "s" shows nothing at 0.00s: the first frame, the video\'s thumbnail, is blank; "hook" starts empty (a typing text types from no characters). Show something at t = 0, or accept a blank thumbnail',
      'warning: viral: no hook text at frame 0; show 3–7 words from the first frame',
    ]],
  ];
  for (const [label, motion, expected] of cases) {
    const r = run(CHECK, [specFile(motion, { 'tone.wav': (f) => writeWav(f, { seconds: 2 }) })]);
    assert.equal(r.status, 0, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^check: ok /, label);
    assert.deepEqual(warningLines(r.stderr), expected, label);
  }
  // Loop: the last frame (a light scene) differs from the first (the dark hook).
  const loop = viral([scene('a', 1.5, [hookText()]), scene('b', 2, [hookText({ id: 'end', text: 'Follow for more', color: '#111111' })], { background: '#eeeeee' })], { viral: { loop: true } });
  const r = run(CHECK, [specFile(loop)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [line, ...rest] = warningLines(r.stderr);
  assert.match(line, /^warning: viral: the last frame does not match the first \(difference 0\.\d\d\); end on the hook again so the clip loops$/);
  assert.ok(Number(/difference (0\.\d\d)/.exec(line)[1]) > 0.12, line);
  assert.deepEqual(rest, []);
  // The same clip that ends on its hook loops: no warning.
  const looped = viral([scene('a', 1.5, [hookText()]), scene('b', 2, [hookText({ id: 'again' })])], { viral: { loop: true } });
  assert.deepEqual(warningLines(run(CHECK, [specFile(looped)]).stderr), []);
});

test('check.mjs under viral: a still stretch in the middle stays one dead-stretch problem, not also a viral warning; a held one is a viral warning', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const still = viral([scene('a', 5, [hookText()]), scene('b', 4, [hookText({ id: 'mover', keyframes: [{ t: 0, x: 480 }, { t: 3.9, x: 520 }] })])]);
  const r = run(CHECK, [specFile(still)]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^scenes\[0\]: nothing changes from 0\.00s to 5\.00s \(5\.0s\); add motion/m);
  assert.deepEqual(warningLines(r.stderr), []);
  const held = viral([scene('a', 5, [hookText({ hold: true })]), scene('b', 4, [hookText({ id: 'mover', keyframes: [{ t: 0, x: 480 }, { t: 3.9, x: 520 }] })])]);
  const h = run(CHECK, [specFile(held)]);
  assert.equal(h.status, 0, h.stdout + h.stderr);
  assert.deepEqual(warningLines(h.stderr), ['warning: viral: nothing changes from 0.00s to 5.00s (5.0s) while only "hold" elements show; cut, reveal or move something at least every 3 s']);
});

test('check.mjs under viral: a title-card block in scene 0 shows its title at frame 0, so there is no blank-thumbnail warning', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const { x, y } = BLOCKS['title-card'].place(PHONE, '9:16', undefined, safeInsets(PHONE, VIRAL_SAFE_ZONE));
  const motion = viral([scene('s', 3, [{ id: 'tc', type: 'block', block: 'title-card', x, y, params: { title: 'Hook them in three seconds' } }])]);
  const r = run(CHECK, [specFile(motion)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('check.mjs under viral: a quote-card opener is judged by its quote, never its quotation mark', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const { x, y } = BLOCKS['quote-card'].place(PHONE, '9:16', undefined, safeInsets(PHONE, VIRAL_SAFE_ZONE));
  const opener = (quote) => viral([scene('s', 4, [{ id: 'q', type: 'block', block: 'quote-card', x, y, params: { quote, attribution: 'An editor' } }])]);
  const short = run(CHECK, [specFile(opener('Lead with the payoff first'))]);
  assert.equal(short.status, 0, short.stdout + short.stderr);
  assert.equal(short.stderr, '');
  const long = run(CHECK, [specFile(opener('Always lead with the payoff and never with the setup'))]);
  assert.equal(long.status, 0, long.stdout + long.stderr);
  assert.deepEqual(warningLines(long.stderr), ['warning: scenes[0].elements[0]: viral: hook "Always lead with the payoff and never with the setup" has 10 words; use 3–7 (block "quote-card", part "quote"); shorten params.quote or move the block']);
});

test('a viral.safeZone override moves the band warning and the caption layer', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const low = { id: 'cta', type: 'text', text: 'Follow', x: 502, y: 1500, fontSize: 48 };
  const wide = { safeZone: { top: 290, bottom: 300, left: 120, right: 195 } };
  const byDefault = run(CHECK, [specFile(viral([scene('s', 2, [hookText(), low])]))]);
  assert.deepEqual(warningLines(byDefault.stderr), ['warning: scenes[0].elements[1]: viral: text "cta" sits under the platform UI (bottom 675 px) at 0.10s']);
  const overridden = run(CHECK, [specFile(viral([scene('s', 2, [hookText(), low])], { viral: wide }))]);
  assert.equal(overridden.status, 0, overridden.stdout + overridden.stderr);
  assert.deepEqual(warningLines(overridden.stderr), [], 'y 1500 is above a 300 px bottom band');
  // The captions layer is centred in the lifted zone: y 998 to 1920 - bottom.
  const srt = '1\n00:00:00,100 --> 00:00:01,900\nHook them in three seconds\n';
  const browser = await launchBrowser({ quiet: true });
  try {
    for (const [zone, centre] of [[undefined, (998 + 1245) / 2], [wide, (998 + 1620) / 2]]) {
      const file = specFile(viral([scene('s', 2, [hookText()])], { captions: [{ src: 'c.srt' }], ...(zone ? { viral: zone } : {}) }), { 'c.srt': srt });
      const srv = await startServer({ specPath: file, mode: 'render' });
      const page = await browser.newPage({ viewport: { width: PHONE[0], height: PHONE[1] }, deviceScaleFactor: 1 });
      try {
        await page.goto(srv.url);
        await waitReady(page);
        assert.equal(await page.evaluate(() => document.querySelector('#stage > .captions').style.top), `${centre}px`);
      } finally { await page.close(); await srv.close(); }
    }
  } finally { await browser.close(); }
});

test('check.mjs without a browser still prints the spec-level viral warnings, change gaps from the spec included', () => {
  const motion = viral([scene('s', 8, [hookText({ keyframes: [{ t: 1, x: 500 }] })])], { format: '16:9' });
  const r = run(CHECK, [specFile(motion)], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: skipped/);
  assert.deepEqual(warningLines(r.stderr), [
    'warning: viral: format 16:9; Reels, TikTok and Shorts are 9:16',
    'warning: viral: nothing changes from 1.00s to 8.00s (7.0s) by the spec\'s keyframes and captions; cut, reveal or move something at least every 3 s',
  ]);
  const plain = run(CHECK, [specFile({ scenes: [scene('s', 8, [hookText()])] })], { PA_NO_BROWSER: '1' });
  assert.equal(plain.stderr, '', 'no mode: nothing extra');
  // Captions changing every 2 s count as change, so the same still clip with them gets no gap warning.
  const srt = '1\n00:00:00,500 --> 00:00:02,500\nHook them in three seconds\n\n2\n00:00:03,000 --> 00:00:05,000\nThat is the whole game\n\n3\n00:00:05,500 --> 00:00:07,800\nSave this for later\n';
  const captioned = viral([scene('s', 8, [hookText({ keyframes: [{ t: 1, x: 500 }] })])], { captions: [{ src: 'c.srt' }] });
  assert.deepEqual(warningLines(run(CHECK, [specFile(captioned, { 'c.srt': srt })], { PA_NO_BROWSER: '1' }).stderr), []);
});

// ---- render ---------------------------------------------------------------------------------------------------------

test('render prints the loudness report line reading "off target" for a -6 dBFS tone spec with mode viral', async (t) => {
  if (!(await requireRender(t))) return;
  const motion = viral([scene('s', 2, [hookText()])], { audio: [{ src: 'tone.wav' }], cues: [] });
  const { stdout } = await renderHash(specFile(motion, { 'tone.wav': (f) => writeWav(f, { seconds: 2 }) }), SMALL);
  const audio = /^audio: (-?\d+\.\d) LUFS integrated, true peak (-?\d+\.\d) dBTP$/m.exec(stdout);
  assert.ok(audio, stdout);
  const lines = stdout.split('\n');
  const at = lines.indexOf(audio[0]);
  assert.equal(lines[at + 1], `loudness: target -14 LUFS / -1 dBTP; measured ${audio[1]} LUFS / ${audio[2]} dBTP (off target)`);
  // No `loudness` and no mode: the line is not printed.
  const plain = await renderHash(specFile({ audio: [{ src: 'tone.wav' }], scenes: [scene('s', 2, [hookText()])] }, { 'tone.wav': (f) => writeWav(f, { seconds: 2 }) }), SMALL);
  assert.doesNotMatch(plain.stdout, /^loudness:/m);
  // A written `loudness` on a spec that is not viral is reported the same way.
  const target = await renderHash(specFile({ loudness: { integrated: -16, truePeak: -2 }, audio: [{ src: 'tone.wav' }], scenes: [scene('s', 2, [hookText()])] }, { 'tone.wav': (f) => writeWav(f, { seconds: 2 }) }), SMALL);
  assert.match(target.stdout, /^loudness: target -16 LUFS \/ -2 dBTP; measured -?\d+\.\d LUFS \/ -?\d+\.\d dBTP \(off target\)$/m);
});

test('viral-hook example passes check with no stderr and renders byte-identical twice', async (t) => {
  const written = JSON.parse((await import('node:fs')).readFileSync(EXAMPLE, 'utf8'));
  assert.equal(written.mode, 'viral');
  assert.equal(written.cues, undefined, 'the auto cues apply');
  assert.equal(written.audio, undefined);
  assert.deepEqual(validateSpec(written, { dir: path.dirname(EXAMPLE) }).errors, []);
  const out = withDefaults(written);
  assert.equal(out.scenes.reduce((a, s) => a + s.duration, 0), 12);
  assert.deepEqual(out.size, PHONE);
  assert.ok(out.cues.length > 0, 'auto cues placed');
  assert.deepEqual(changeGaps(out), []);
  if (!(await requireRender(t))) return;
  const r = run(CHECK, [EXAMPLE]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  await assertRendersIdentically(t, EXAMPLE, SMALL);
  const shown = run(RENDER, [EXAMPLE, '--out', path.join(mkdtempSync(path.join(tmpdir(), 'viral-out-')), 'v.mp4'), ...SMALL], { SOURCE_DATE_EPOCH: '1793318400' });
  assert.match(shown.stdout, /^loudness: target -14 LUFS \/ -1 dBTP; measured -?\d+\.\d LUFS \/ -?\d+\.\d dBTP \((on|off) target\)$/m);
});

// Keep the FORMATS import honest: the viral default is the 9:16 preset's size.
test('the viral default size is the 9:16 preset', () => {
  assert.deepEqual(FORMATS['9:16'].size, PHONE);
});

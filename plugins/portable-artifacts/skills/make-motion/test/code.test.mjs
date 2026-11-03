// Task 14: the `code` element (shiki, JavaScript regex engine, theme-token colours) and the code-typing, code-diff and
// terminal-run blocks. The block table in blocks.test.mjs covers each block's example, golden and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, typingErrors, frameRateErrors } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { contrastFindings } from '../scripts/lib/audits.mjs';
import { CODE_LANGS, codeTheme } from '../template/code-theme.mjs';
import { BLOCKS, expandBlocks } from '../template/blocks/index.mjs';
import { lineDiff } from '../template/blocks/code-diff.mjs';
import { flattenElements } from '../template/groups.mjs';
import { withDefaults } from '../template/defaults.mjs';
import { probed } from './render-probe.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.join(root, 'references/examples/code-highlight.json');
const errs = (motion) => validateSpec(motion, { dir: root }).errors.map((e) => `${e.path}: ${e.message}`);
const code = (extra = {}) => ({ id: 'c', type: 'code', x: 960, y: 540, code: 'const a = 1;', lang: 'javascript', width: 800, ...extra });
const oneScene = (elements, extra = {}, duration = 4) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 540, block: name, params, ...extra });
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const LANG_LIST = CODE_LANGS.join(', ');

// ---- the element -------------------------------------------------------------------------------------------------------

test('CODE_LANGS is the fourteen languages, text first', () => {
  assert.deepEqual(CODE_LANGS, ['text', 'javascript', 'typescript', 'json', 'bash', 'python', 'diff', 'go', 'rust', 'swift', 'yaml', 'html', 'css', 'markdown']);
});

test('a code element with code, lang and width is valid; each is required', () => {
  assert.deepEqual(errs(oneScene([code()])), []);
  assert.deepEqual(errs(oneScene([code({ fontSize: 32, height: 300, highlight: [1], diff: false, typing: true, opacity: 0.9 })])), []);
  const { code: _c, lang: _l, width: _w, ...bare } = code();
  assert.deepEqual(errs(oneScene([bare])), ['scenes[0].elements[0].code: required for type code', 'scenes[0].elements[0].lang: required for type code', 'scenes[0].elements[0].width: required for type code']);
  assert.match(errs(oneScene([code({ text: 'no' })]))[0], /^scenes\[0\]\.elements\[0\]\.text: not valid on code; allowed: .*code, lang, width, height, fontSize, highlight, diff, typing/);
});

test('an unknown lang names the closest language (aliases included) and lists them all', () => {
  assert.deepEqual(errs(oneScene([code({ lang: 'js' })])), [`scenes[0].elements[0].lang: unknown lang "js"; did you mean "javascript"? (langs: ${LANG_LIST})`]);
  assert.deepEqual(errs(oneScene([code({ lang: 'pyton' })])), [`scenes[0].elements[0].lang: unknown lang "pyton"; did you mean "python"? (langs: ${LANG_LIST})`]);
  assert.deepEqual(errs(oneScene([code({ lang: 'cobolxx' })])), [`scenes[0].elements[0].lang: unknown lang "cobolxx" (langs: ${LANG_LIST})`]);
});

test('a lang named like an Object.prototype key is an unknown lang, never a crash', () => {
  for (const lang of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    let found;
    assert.doesNotThrow(() => { found = errs(oneScene([code({ lang })])); }, lang);
    assert.equal(found.length, 1, `${lang}: ${found.join(' | ')}`);
    assert.match(found[0], new RegExp(`^scenes\\[0\\]\\.elements\\[0\\]\\.lang: unknown lang ${JSON.stringify(lang)}(; did you mean "[a-z]+"\\?)? \\(langs: `), lang);
  }
});

test('highlight names lines that exist; a line past the end is an error naming the count', () => {
  assert.deepEqual(errs(oneScene([code({ code: 'a\nb\nc', highlight: [1, 3] })])), []);
  assert.deepEqual(errs(oneScene([code({ code: 'a\nb\nc', highlight: [2, 5] })])), ['scenes[0].elements[0].highlight[1]: line 5 is past the end; the code has 3 lines']);
  assert.match(errs(oneScene([code({ highlight: [0] })]))[0], /^scenes\[0\]\.elements\[0\]\.highlight\/0|^scenes\[0\]\.elements\[0\]\.highlight\[0\]: must be >= 1/);
});

test('a typing code element must finish a frame before its scene ends (the text rule, on the code)', () => {
  const long = 'x'.repeat(100);
  assert.deepEqual(errs(oneScene([code({ code: long, typing: true })], {}, 1)), ['scenes[0].elements[0].code: typing 100 characters takes 3.50s but scene "s" lasts 1s (it must finish a frame before the scene ends at 30 fps); shorten the code or lengthen the scene to at least 3.54s']);
  assert.deepEqual(errs(oneScene([code({ code: long, typing: true })], {}, 3.54)), []);
  assert.deepEqual(errs(oneScene([code({ code: long, typing: true, keyframes: [{ t: 0, value: 0 }, { t: 0.9, value: 100 }] })], {}, 1)), [], 'value keyframes set their own pace');
  assert.deepEqual(errs(oneScene([code({ keyframes: [{ t: 0, value: 0 }] })])), ['scenes[0].elements[0].keyframes[0].value: not animatable on code; animatable: opacity, x, y, scale, rotate (value needs "typing": true)']);
});

test('withDefaults fills a code element like any other (value 0, pose defaults)', () => {
  const el = withDefaults(oneScene([code({ typing: true })])).scenes[0].elements[0];
  assert.deepEqual([el.opacity, el.scale, el.rotate, el.value, el.keyframes], [1, 1, 0, 0, []]);
});

// ---- the theme ---------------------------------------------------------------------------------------------------------

test('codeTheme maps the scopes to theme tokens: keyword accent, string good, comment text3, number warn, function cat1, type cat2, default text', () => {
  const colors = { text: '#000001', accent: '#000002', good: '#000003', text3: '#000004', warn: '#000005', cat1: '#000006', cat2: '#000007', bad: '#000008' };
  const theme = codeTheme(colors);
  const of = (scope) => theme.settings.find((s) => [].concat(s.scope ?? []).includes(scope))?.settings.foreground;
  assert.equal(theme.settings[0].settings.foreground, colors.text);
  assert.equal(theme.fg, colors.text);
  assert.deepEqual(['keyword', 'string', 'comment', 'constant.numeric', 'entity.name.function', 'entity.name.type'].map(of), [colors.accent, colors.good, colors.text3, colors.warn, colors.cat1, colors.cat2]);
  assert.equal(theme.bg, 'transparent');
});

// ---- the blocks --------------------------------------------------------------------------------------------------------

test('lineDiff: a two-line change is -old then +new, in order, between the unchanged lines', () => {
  assert.deepEqual(lineDiff('keep\nold\nend', 'keep\nnew\nend'), [' keep', '-old', '+new', ' end']);
  assert.deepEqual(lineDiff('a\nb', 'a\nb\nc'), [' a', ' b', '+c']);
  assert.deepEqual(lineDiff('a\nb\nc', 'c'), ['-a', '-b', ' c']);
});

// Fix round 1 (M2): this test used to assert lineDiff('', 'x') = ['-', '+x'], an empty removed row; an empty side is no lines.
test('lineDiff: an empty before or after is no lines, so a new file is all + rows and a deleted one all - rows', () => {
  assert.deepEqual(lineDiff('', 'x\ny'), ['+x', '+y']);
  assert.deepEqual(lineDiff('x\ny', ''), ['-x', '-y']);
  assert.deepEqual(lineDiff('', ''), []);
  const spec = expandBlocks(oneScene([block('code-diff', { before: '', after: 'print(1)', lang: 'python' })]));
  assert.equal(partsOf(spec).find((el) => el.type === 'code').code, '+print(1)');
  assert.deepEqual(errs(oneScene([block('code-diff', { before: '', after: '', lang: 'text' })])), []);
});

test('code-diff expands to one diff code element holding the line diff', () => {
  const spec = expandBlocks(oneScene([block('code-diff', { before: 'const a = 1;\nold();', after: 'const a = 1;\nnew();', lang: 'javascript' })]));
  const diff = partsOf(spec).find((el) => el.type === 'code');
  assert.equal(diff.diff, true);
  assert.equal(diff.lang, 'javascript');
  assert.deepEqual(diff.code.split('\n'), [' const a = 1;', '-old();', '+new();']);
});

test('code-typing and terminal-run type with typing: true; terminal-run shows its output lines 0.15 s apart after the command', () => {
  const typed = partsOf(expandBlocks(oneScene([block('code-typing', BLOCKS['code-typing'].example)], {}, 12))).find((el) => el.type === 'code');
  assert.equal(typed.typing, true);
  const run = { command: 'npm test', output: ['one', 'two', 'three'] };
  const term = partsOf(expandBlocks(oneScene([block('terminal-run', run)], {}, 6))).find((el) => el.type === 'code');
  assert.equal(term.typing, true);
  assert.equal(term.code, '$ npm test\none\ntwo\nthree');
  const lineStarts = term.keyframes.filter((kf) => kf.value !== undefined).map((kf) => kf.t);
  const shown = (n) => lineStarts[term.keyframes.filter((kf) => kf.value !== undefined).findIndex((kf) => kf.value === n)];
  const after = ['$ npm test\none', '$ npm test\none\ntwo', '$ npm test\none\ntwo\nthree'].map((s) => shown(s.length));
  assert.ok(after.every((t) => t !== undefined), JSON.stringify(term.keyframes));
  assert.ok(Math.abs(after[1] - after[0] - 0.15) < 1e-6 && Math.abs(after[2] - after[1] - 0.15) < 1e-6, `lines at ${after}`);
});

test('a block whose typing overruns its scene is one error at the block param, with the cut-off text', () => {
  const longCode = 'x'.repeat(100);
  assert.deepEqual(errs(oneScene([block('code-typing', { code: longCode, lang: 'text' })], {}, 2)), ['scenes[0].elements[0].params.code: typing 100 characters takes 3.50s but the scene lasts 2s (it must finish a frame before the scene ends at 30 fps); shorten the code or lengthen the scene to at least 3.54s']);
  assert.deepEqual(errs(oneScene([block('code-typing', { code: longCode, lang: 'text' })], {}, 3.54)), []);
  const run = errs(oneScene([block('terminal-run', { command: 'x'.repeat(60), output: ['done'] })], {}, 2));
  assert.equal(run.length, 1, run.join(' | '));
  assert.match(run[0], /^scenes\[0\]\.elements\[0\]\.params\.command: typing the command \(60 characters\) and showing 1 output line takes \d+\.\d\ds; the scene must last at least \d+\.\d\ds$/);
});

test('render --fps: a block that types to the frame at the spec fps is cut off at a lower --fps, at the block param (typing is checked on the expanded spec)', () => {
  const motion = oneScene([block('code-typing', { code: 'x'.repeat(100), lang: 'text' })], { fps: 30 }, 3.54);
  assert.deepEqual(errs(motion), []);
  const slow = typingErrors(motion, 10).map((e) => `${e.path}: ${e.message}`);
  assert.equal(slow.length, 1, slow.join(' | '));
  assert.match(slow[0], /^scenes\[0\]\.elements\[0\]\.params\.code: typing 100 characters takes 3\.50s but scene "s" lasts 3\.54s \(it must finish a frame before the scene ends at 10 fps\); shorten the code or lengthen the scene to at least 3\.61s$/);
  // a plain typing text keeps its own path and message
  const text = oneScene([{ id: 't', type: 'text', text: 'x'.repeat(27), typing: true, x: 1, y: 1 }], { fps: 30 }, 1);
  assert.match(typingErrors(text, 10).map((e) => `${e.path}: ${e.message}`)[0], /^scenes\[0\]\.elements\[0\]\.text: typing 27 characters .*shorten the text/);
});

const RENDER = path.join(root, 'scripts/render.mjs');

// Fix round 1 (M1): a block schedule with `value` keyframes (terminal-run) is re-checked at --fps, as a typing text is.
test('render --fps: a terminal-run that fits its scene at the spec fps is refused at a lower --fps, at params.command, before anything renders', () => {
  const run = { command: 'npm test', output: ['one', 'two', 'three'] };
  const motion = oneScene([block('terminal-run', run)], { fps: 30, size: [320, 180] }, BLOCKS['terminal-run'].minDuration(run));
  assert.deepEqual(errs(motion), []);
  const expected = 'scenes[0].elements[0].params.command: typing the command (8 characters) and showing 3 output lines takes 1.54s; the scene must last at least 1.65s';
  assert.deepEqual(frameRateErrors(motion, 10).map((e) => `${e.path}: ${e.message}`), [expected]);
  assert.deepEqual(frameRateErrors(motion, 30), []);
  const dir = mkdtempSync(path.join(tmpdir(), 'code-fps-'));
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(motion));
  const slow = spawnSync(process.execPath, [RENDER, path.join(dir, 'm.json'), '--out', path.join(dir, 'o.mp4'), '--fps', '10'], { encoding: 'utf8' });
  assert.equal(slow.status, 1, slow.stdout + slow.stderr);
  assert.ok((slow.stdout + slow.stderr).includes(expected), slow.stdout + slow.stderr);
  assert.deepEqual(readdirSync(dir), ['m.json'], 'nothing was written');
});

test('render --fps: a code-typing block cut off at --fps is one error, not one from its schedule and one from its typing part', () => {
  const motion = oneScene([block('code-typing', { code: 'x'.repeat(100), lang: 'text' })], { fps: 30 }, 3.54);
  const found = frameRateErrors(motion, 10);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].path, 'scenes[0].elements[0].params.code');
});

// Fix round 2 (N2, N4): plain words instead of the regex, and a carriage return counts as a line break too.
test('terminal-run command, prompt and output lines are one line each (no line feed or carriage return); a code lang is never empty', () => {
  const one = (params) => errs(oneScene([block('terminal-run', params)], {}, 6));
  const command = 'scenes[0].elements[0].params.command: must be one line (no line breaks)';
  assert.deepEqual(one({ command: 'a\nb', output: ['ok'] }), [command]);
  assert.deepEqual(one({ command: 'a\rb', output: ['ok'] }), [command]);
  assert.deepEqual(one({ command: 'ls', output: ['ok', 'a\nb'] }), ['scenes[0].elements[0].params.output[1]: must be one line (no line breaks); put each output line in its own item']);
  assert.deepEqual(one({ command: 'ls', output: ['a\r\nb', 'ok'] }), ['scenes[0].elements[0].params.output[0]: must be one line (no line breaks); put each output line in its own item']);
  assert.deepEqual(one({ command: 'ls', output: ['ok'], prompt: '>\r' }), ['scenes[0].elements[0].params.prompt: must be one line (no line breaks)']);
  assert.deepEqual(errs(oneScene([code({ lang: '' })])), ['scenes[0].elements[0].lang: must NOT have fewer than 1 characters']);
});

// ---- fix round 2 (N1): cut-offs are judged at the last frame the render really draws ----------------------------------

const atLeast = (message) => Number(/at least (\d+(?:\.\d+)?)s/.exec(message)?.[1]);

test('N1: a code-typing whose last character lands between the last frame and the scene end is refused, naming a length that passes', () => {
  // 18 characters end at 0.63 s; 0.68 s at 24 fps is 16 frames, the last at 0.625 s (it showed 17 of 18).
  const motion = oneScene([block('code-typing', { code: 'x'.repeat(18), lang: 'text' })], { fps: 24 }, 0.68);
  const found = validateSpec(motion, { dir: root }).errors;
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].path, 'scenes[0].elements[0].params.code');
  const fix = atLeast(found[0].message);
  assert.ok(fix > 0.68, found[0].message);
  assert.deepEqual(errs(oneScene([block('code-typing', { code: 'x'.repeat(18), lang: 'text' })], { fps: 24 }, fix)), []);
});

test('N1: a terminal-run whose last line lands after the last frame is refused, naming a length that passes', () => {
  const run = { command: 'xxx', output: ['ok'] }; // the last line is out at 1.057 s; 1.1 s at 24 fps ends its frames at 1.042 s
  const found = validateSpec(oneScene([block('terminal-run', run)], { fps: 24 }, 1.1), { dir: root }).errors;
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].path, 'scenes[0].elements[0].params.command');
  assert.deepEqual(errs(oneScene([block('terminal-run', run)], { fps: 24 }, atLeast(found[0].message))), []);
});

test('N1: a typing text and a typing code element follow the same last-frame rule', () => {
  for (const el of [{ id: 't', type: 'text', text: 'x'.repeat(18), typing: true, x: 1, y: 1 }, code({ code: 'x'.repeat(18), typing: true })]) {
    const found = validateSpec(oneScene([el], { fps: 24 }, 0.68), { dir: root }).errors;
    assert.equal(found.length, 1, `${el.type}: ${JSON.stringify(found)}`);
    assert.equal(found[0].path, `scenes[0].elements[0].${el.type === 'code' ? 'code' : 'text'}`);
    assert.deepEqual(errs(oneScene([el], { fps: 24 }, atLeast(found[0].message))), [], el.type);
  }
});

// N3: every block with a schedule is re-checked at --fps, story-beats and listicle included.
test('N3: listicle and story-beats are refused at an --fps whose last frame comes before their last entrance', () => {
  const list = { ...BLOCKS.listicle.example, itemSeconds: 1 }; // the minimum scene is 3.8 s; the last row is in at 3.4 s
  const listSpec = oneScene([block('listicle', list)], { fps: 30 }, 3.8);
  assert.deepEqual(errs(listSpec), []);
  assert.deepEqual(frameRateErrors(listSpec, 1).map((e) => e.path), ['scenes[0].elements[0].params.itemSeconds']);
  const beats = { ...BLOCKS['story-beats'].example, beatSeconds: 1.5 }; // the CTA is in at 6.3 s of a 7.5 s scene
  const story = { fps: 30, scenes: [{ id: 'intro', duration: 0.8, elements: [{ id: 't', type: 'text', text: 'Hi', x: 960, y: 540 }] }, { id: 'story', duration: 7.5, elements: [block('story-beats', beats)] }] };
  assert.deepEqual(errs(story), []);
  assert.deepEqual(frameRateErrors(story, 1).map((e) => e.path), ['scenes[1].elements[0].params.beatSeconds']);
  assert.deepEqual(frameRateErrors(story, 30), []);
});

// L3: a raw code element is capped at 10,000 characters; the largest code-diff expansion stays under it.
test('L3: code over 10,000 characters is refused; the largest code-diff expansion still validates', () => {
  assert.deepEqual(errs(oneScene([code({ code: 'x'.repeat(10001) })])), ['scenes[0].elements[0].code: must NOT have more than 10000 characters']);
  assert.deepEqual(errs(oneScene([code({ code: 'x'.repeat(10000) })])), []);
  const worst = { before: '\n'.repeat(2000), after: 'a\n'.repeat(1000), lang: 'text' };
  const diff = partsOf(expandBlocks(oneScene([block('code-diff', worst)]))).find((el) => el.type === 'code');
  assert.ok(diff.code.length > 6000 && diff.code.length < 10000, `${diff.code.length} characters`);
  assert.deepEqual(errs(oneScene([block('code-diff', worst)])), []);
});

// The sweep: across scene lengths and frame rates, at the length the error recommends, the render's last frame of each
// scene shows the whole code or the terminal's last line.
test('N1 sweep: at the recommended minimum, the last frame of every scene shows every character (code-typing and terminal-run, 24, 25, 30, 60 fps)', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const sizes = [1, 2, 5, 9, 13, 18, 22, 27, 31, 40];
  const browser = await launchBrowser({ quiet: true });
  try {
    for (const fps of [24, 25, 30, 60]) {
      const elements = [
        ...sizes.map((n) => block('code-typing', { code: 'x'.repeat(n), lang: 'text' })),
        ...sizes.slice(0, 6).map((n) => block('terminal-run', { command: 'y'.repeat(n), output: ['ok', 'z'.repeat(n % 4)] })),
      ];
      const motion = { fps, size: [320, 180], scenes: elements.map((el, i) => ({ id: `s${i}`, duration: 0.2, elements: [{ ...el, id: `b${i}`, x: 160, y: 90 }] })) };
      // Scene by scene, in order, take the length the error names (a later scene never moves an earlier one's frames).
      for (let i = 0; i < motion.scenes.length; i++) {
        const mine = validateSpec(motion, { dir: root }).errors.filter((e) => e.path.startsWith(`scenes[${i}].`));
        if (mine.length) motion.scenes[i].duration = atLeast(mine[0].message);
      }
      assert.deepEqual(errs(motion), [], `${fps} fps`);
      const dir = mkdtempSync(path.join(tmpdir(), 'code-sweep-'));
      const specPath = path.join(dir, 'm.json');
      writeFileSync(specPath, JSON.stringify(motion));
      const srv = await startServer({ specPath, mode: 'render' });
      try {
        const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
        await page.goto(srv.url);
        await page.waitForFunction(() => window.__motion);
        await page.evaluate(() => window.__motion.ready);
        // The last frame of each scene as render.mjs draws them, worked out here on its own: Math.round(total x fps) frames at i / fps.
        const starts = [];
        let cursor = 0;
        for (const sc of motion.scenes) { starts.push(cursor); cursor += sc.duration; }
        const frames = Math.round(cursor * fps);
        const lastOf = new Map();
        for (let f = 0; f < frames; f++) lastOf.set(starts.findLastIndex((st) => f / fps >= st - 1e-9), f);
        const cut = [];
        for (const [si, f] of lastOf) {
          const el = motion.scenes[si].elements[0];
          const id = el.block === 'code-typing' ? `b${si}/code` : `b${si}/terminal`;
          const total = el.block === 'code-typing' ? el.params.code.length : `$ ${el.params.command}\n${el.params.output.join('\n')}`.length;
          const typed = await page.evaluate(([sec, which]) => window.__motion.seek(sec).then(() => document.querySelector(`.el.code[data-id="${which}"]`).dataset.typed), [f / fps, id]);
          if (Number(typed) !== total) cut.push(`${fps} fps scene ${si} (${motion.scenes[si].duration}s, ${el.block}): ${typed} of ${total}`);
        }
        assert.equal(lastOf.size, motion.scenes.length, 'every scene got a frame');
        assert.deepEqual(cut, []);
        await page.close();
      } finally { await srv.close(); }
    }
  } finally { await browser.close(); }
});

// ---- contrast: every token colour, not just the box colour ------------------------------------------------------------

test('contrastFindings judges a code element by its worst token colour (inks), not only its box colour', () => {
  const item = { el: { id: 'c', type: 'code' }, path: 'scenes[0].elements[0]', chain: [{ id: 'c', type: 'code' }] };
  const sample = (inks) => ({ t: 1, els: [{ shown: true, opacity: 1, fontSize: 28, weight: 400, color: '#ffffff', alpha: 1, inks }], back: [['#000000']] });
  const colors = { text: '#ffffff', text2: '#eeeeee', text3: '#dddddd', accent: '#ff8800' };
  assert.deepEqual(contrastFindings([item], [sample(['#ffffff']), sample(['#ffffff'])], colors, [1920, 1080]).problems, []);
  const dim = contrastFindings([item], [sample(['#ffffff', '#222222']), sample(['#ffffff', '#222222'])], colors, [1920, 1080]);
  assert.equal(dim.problems.length, 1);
  assert.match(dim.problems[0].message, /^code "c" has 1\.\d:1 contrast/);
});

// ---- the server ------------------------------------------------------------------------------------------------------

function get(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function withServer(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'code-srv-'));
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(oneScene([code()])));
  const srv = await startServer({ specPath, mode: 'preview' });
  try { await fn(srv); } finally { await srv.close(); }
}

const importmap = () => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(readFileSync(path.join(root, 'template/index.html'), 'utf8'))[1]).imports;

test('every importmap entry is served 200 as JavaScript, with nosniff and a default-src none policy', () => withServer(async (srv) => {
  const entries = Object.entries(importmap());
  for (const lang of CODE_LANGS.filter((l) => l !== 'text')) assert.ok(entries.some(([name]) => name === `@shikijs/langs/${lang}`), `importmap maps @shikijs/langs/${lang}`);
  assert.ok(entries.some(([name]) => name === 'shiki/core') && entries.some(([name]) => name === 'shiki/engine/javascript'));
  for (const [name, url] of entries) {
    const r = await get(srv.url, url);
    assert.equal(r.status, 200, `${name} -> ${url}`);
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8', url);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', url);
    assert.equal(r.headers['content-security-policy'], "default-src 'none'", url);
  }
}));

test('scoped vendor routes stay inside their package folder: traversal, encoded traversal, prototype keys and unknown packages are 404', () => withServer(async (srv) => {
  assert.equal((await get(srv.url, '/vendor/@shikijs/core/index.mjs')).status, 200);
  for (const p of ['/vendor/@shikijs/core/../../package.json', '/vendor/@shikijs/core/..%2f..%2fpackage.json', '/vendor/@shikijs/core/%2e%2e/%2e%2e/types/dist/index.mjs',
    '/vendor/@shikijs/langs/..%2f..%2fthemes/dist/nord.mjs', '/vendor/@shikijs/themes/index.mjs', '/vendor/@shikijs/engine-oniguruma/index.mjs',
    '/vendor/@shikijs/index.mjs', '/vendor/@shikijs/__proto__/x.js', '/vendor/constructor/x.js', '/vendor/__proto__/x.js', '/vendor/toString/x.js',
    '/vendor/shiki/onig.wasm', '/vendor/shiki/../package.json', '/vendor/hast-util-to-html/.npmignore']) {
    const r = await get(srv.url, p);
    assert.equal(r.status, 404, `${p} -> ${r.status}`);
  }
}));

// ---- the page ------------------------------------------------------------------------------------------------------------

const SAMPLES = {
  text: 'plain words 42', javascript: 'const n = 42; // c\nfunction f() { return "s"; }', typescript: 'type T = { id: number };\nconst s: string = "x"; // c',
  json: '{ "a": 1, "b": "two" }', bash: 'echo "hi" # c\nnpm install 42', python: 'def f(a):\n    return "s"  # c', diff: '-old\n+new',
  go: 'func main() { x := 42 } // c', rust: 'fn main() { let x = "s"; } // c', swift: 'func f() -> String { return "s" } // c',
  yaml: 'name: "app" # c\nn: 3', html: '<div class="a">hi</div><!-- c -->', css: '.a { width: 10px; } /* c */', markdown: '# Title\n\nSome `code` here',
};

test('every CODE_LANGS entry highlights offline: no blocked request, every request answered, more than one colour per language but text', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const elements = CODE_LANGS.map((lang, i) => code({ id: `c-${lang}`, lang, code: SAMPLES[lang], x: 480 + 960 * (i % 2), y: 60 + 140 * Math.floor(i / 2), width: 900, fontSize: 20 }));
  const dir = mkdtempSync(path.join(tmpdir(), 'code-langs-'));
  const specPath = path.join(dir, 'm.json');
  writeFileSync(specPath, JSON.stringify(oneScene(elements, { size: [1920, 1080] })));
  assert.deepEqual(errs(JSON.parse(readFileSync(specPath, 'utf8'))), []);
  const srv = await startServer({ specPath, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const blocked = [];
    const failed = [];
    const vendor = [];
    const problems = [];
    await guardNetwork(page, new URL(srv.url).origin, (url) => blocked.push(url));
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('response', (r) => { if (r.url().includes('/vendor/')) vendor.push([r.url(), r.status()]); });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    await page.evaluate(() => window.__motion.ready);
    const colours = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.el.code')].map((n) => [n.dataset.id, [...new Set([...n.querySelectorAll('[data-ink]')].map((s) => s.style.color))].length])));
    assert.deepEqual(problems, []);
    assert.deepEqual(blocked, [], 'guardNetwork blocked nothing');
    assert.deepEqual(failed, [], 'no request failed');
    assert.ok(vendor.length > 0 && vendor.every(([, status]) => status === 200), JSON.stringify(vendor.filter(([, s]) => s !== 200)));
    assert.ok(!vendor.some(([url]) => url.endsWith('.wasm')), 'no wasm fetch');
    for (const lang of CODE_LANGS) {
      if (lang === 'text') assert.equal(colours[`c-${lang}`], 1, 'text is one colour');
      else assert.ok(colours[`c-${lang}`] > 1, `${lang} has ${colours[`c-${lang}`]} colour(s)`);
    }
  } finally { await browser.close(); await srv.close(); }
});

test('code is drawn as text: <script> and </span><img onerror> in the code add no elements', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const hostile = '<script>window.__pwned = 1</script>\n</span><img src=x onerror="window.__pwned = 2">';
  for (const lang of ['html', 'javascript', 'text']) {
    const found = await probed(oneScene([code({ code: hostile, lang })], { size: [1920, 1080] }), () => ({
      text: [...document.querySelectorAll('.el.code .line')].map((l) => l.textContent).join('\n'),
      scripts: document.querySelectorAll('#stage script').length,
      imgs: document.querySelectorAll('#stage img').length,
      tags: [...new Set([...document.querySelector('.el.code').querySelectorAll('*')].map((n) => n.tagName))].sort(),
      pwned: window.__pwned ?? null,
    }));
    assert.equal(found.text, hostile, lang);
    assert.deepEqual([found.scripts, found.imgs, found.pwned], [0, 0, null], lang);
    assert.deepEqual(found.tags.filter((tag) => !['DIV', 'SPAN'].includes(tag)), [], `${lang}: only div and span inside the code`);
  }
});

test('highlight rows get the surface colour; diff rows tint + good and - bad; typing reveals characters with a caret', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const motion = oneScene([
    code({ id: 'hl', code: 'a\nb\nc', lang: 'text', highlight: [2], y: 200 }),
    code({ id: 'df', code: ' same\n-old\n+new', lang: 'text', diff: true, y: 500 }),
    code({ id: 'ty', code: 'abcdef\nghij', lang: 'text', typing: true, y: 800 }),
  ], { size: [1920, 1080] }, 2);
  const found = await probed(motion, async () => {
    const rows = (id) => [...document.querySelectorAll(`.el.code[data-id="${id}"] .line`)];
    const bg = (n) => getComputedStyle(n).backgroundColor;
    const shown = (id) => [...document.querySelectorAll(`.el.code[data-id="${id}"] .typed`)].map((s) => s.textContent).join('');
    const caret = () => document.querySelector('.el.code[data-id="ty"] .caret') !== null;
    await window.__motion.seek(0);
    const at0 = shown('ty');
    await window.__motion.seek(0.035 * 3 + 0.001);
    const at3 = shown('ty');
    await window.__motion.seek(1.9);
    return { hl: rows('hl').map(bg), df: rows('df').map(bg), at0, at3, all: shown('ty'), caret: caret(), typed: document.querySelector('.el.code[data-id="ty"]').dataset.typed };
  });
  assert.equal(found.hl[0], 'rgba(0, 0, 0, 0)');
  assert.notEqual(found.hl[1], 'rgba(0, 0, 0, 0)');
  assert.equal(found.df[0], 'rgba(0, 0, 0, 0)');
  assert.notEqual(found.df[1], found.df[2]);
  assert.ok(found.df.slice(1).every((c) => c !== 'rgba(0, 0, 0, 0)'), found.df.join(' | '));
  assert.deepEqual([found.at0, found.at3, found.all], ['', 'abc', 'abcdefghij']);
  assert.equal(found.caret, true);
  assert.equal(found.typed, '11');
});

test('references/examples/code-highlight.json renders byte-identical twice', async (t) => {
  if (!(await requireRender(t))) return;
  await assertRendersIdentically(t, EXAMPLE, ['--fps', '10', '--size', '320x180']);
});

// ---- the dependency ------------------------------------------------------------------------------------------------------

test('shiki is pinned to an exact version and npm audit --omit=dev reports 0 vulnerabilities (skipped when the registry is unreachable)', (t) => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.dependencies.shiki, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.overrides['fast-uri'], '3.1.9');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['audit', '--json', '--omit=dev'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let report;
  try { report = JSON.parse(r.stdout); } catch { report = null; }
  if (!report?.metadata?.vulnerabilities) {
    t.skip(`npm audit gave no report (offline?): ${String(r.stderr || r.error?.message || '').split('\n')[0]}`);
    return;
  }
  assert.equal(report.metadata.vulnerabilities.total, 0, JSON.stringify(report.metadata.vulnerabilities));
});

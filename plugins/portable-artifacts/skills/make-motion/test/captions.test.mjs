// Task 8: captions from SRT, VTT, Whisper JSON or the voice sidecar, six styles, and the caption-zone check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCaptions, groupWords, captionState, CaptionError, CAPTION_STYLES, MAX_CAPTION_TRACKS } from '../template/captions.mjs';
import { captionZone } from '../template/formats.mjs';
import { graphemes } from '../template/defaults.mjs';
import { validateSpec, withDefaults, loadSpec } from '../scripts/lib/spec.mjs';
import { captionBoxProblem, main as checkMain } from '../scripts/check.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser } from '../scripts/lib/browser.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLE = path.join(root, 'references/examples/captioned-clip.json');
const EVAL_SRT = path.resolve(root, '../../eval/fixtures/data/captions.srt');
const EVAL_VTT = path.resolve(root, '../../eval/fixtures/data/captions.vtt');
const check = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: process.env });
const lines = (stdout) => stdout.trim().split('\n');

const w = (text, start, end) => ({ text, start, end });
const texts = (groups) => groups.map((g) => g.words.map((x) => x.text).join(' '));
const chars = (g) => graphemes(g.words.map((x) => x.text).join(' ')).length;
// Contiguous words from `at`, `each` seconds apiece.
const run = (words, at, each = 0.3) => words.split(' ').map((text, i) => w(text, +(at + i * each).toFixed(3), +(at + (i + 1) * each).toFixed(3)));

const NO_CAPTIONS = 'no captions found; expected SRT or WebVTT cues (a "00:00:01,000 --> 00:00:02,500" line, then the text), or JSON with Whisper "segments" or "words", or the voice sidecar\'s "sentences"';
const srt = (cues) => cues.map(([from, to, text], i) => `${i + 1}\n${from} --> ${to}\n${text}\n`).join('\n');

// A spec folder holding `files` (name -> text) and motion.json.
function specDir(spec, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'motion-captions-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  const file = path.join(dir, 'motion.json');
  writeFileSync(file, JSON.stringify(spec));
  return { dir, file };
}

// ---- word timing --------------------------------------------------------------------------------

test('a 4 s cue "Hello there big world" (weights 6, 6, 4, 5 of 21) gets starts 0 / 1.143 / 2.286 / 3.048 and ends 1.143 / 2.286 / 3.048 / 4 (shares 1.143 / 1.143 / 0.762 / 0.952 s, summing to 4)', () => {
  const words = parseCaptions(srt([['00:00:00,000', '00:00:04,000', 'Hello there big world']]), 'srt');
  assert.deepEqual(words, [
    w('Hello', 0, 1.143), w('there', 1.143, 2.286), w('big', 2.286, 3.048), w('world', 3.048, 4),
  ]);
  const shares = words.map((x) => +(x.end - x.start).toFixed(3));
  assert.deepEqual(shares, [1.143, 1.143, 0.762, 0.952]);
  assert.equal(+shares.reduce((a, b) => a + b, 0).toFixed(3), 4);
  // The same cue as WebVTT (dot milliseconds, a header, a cue setting) gives the same words.
  const vtt = 'WEBVTT\n\nNOTE a comment block\n\nintro\n00:00.000 --> 00:04.000 align:center\n<v Ana>Hello <i>there</i> big world\n';
  assert.deepEqual(parseCaptions(vtt, 'vtt'), words);
});

test('the eval fixtures parse to 24 words in 6 cues, SRT and VTT alike', () => {
  const fromSrt = parseCaptions(readFileSync(EVAL_SRT, 'utf8'), 'srt');
  assert.equal(fromSrt.length, 24);
  assert.deepEqual(parseCaptions(readFileSync(EVAL_VTT, 'utf8'), 'vtt'), fromSrt);
  assert.deepEqual(fromSrt.at(-1), w('today', fromSrt.at(-1).start, 11.8));
});

// ---- grouping -----------------------------------------------------------------------------------

test('6 words then a 7th starts a new group; a sentence end breaks; a 0.15 s gap breaks; 0.149 s does not', () => {
  assert.deepEqual(texts(groupWords(run('one two three four five six seven eight.', 0.2))), ['one two three four five six', 'seven eight.']);
  assert.deepEqual(texts(groupWords(run('We ship. Then we rest', 0.2))), ['We ship.', 'Then we rest']);
  // "beta" ends at 0.8.
  assert.deepEqual(texts(groupWords([...run('alpha beta', 0.2), ...run('gamma delta', 0.95)])), ['alpha beta', 'gamma delta'], 'a 0.15 s gap breaks');
  assert.deepEqual(texts(groupWords([...run('alpha beta', 0.2), ...run('gamma delta', 0.949)])), ['alpha beta gamma delta'], 'a 0.149 s gap does not');
  // Past 42 characters: three 10-letter words are 32 characters, a fourth would make 43.
  assert.deepEqual(texts(groupWords(run('abcdefghij klmnopqrst uvwxyzabcd efghijklmn opqrstuvwx', 0.2))), ['abcdefghij klmnopqrst uvwxyzabcd', 'efghijklmn opqrstuvwx']);
  // A sentence end inside closing quotes or brackets still ends the sentence.
  assert.deepEqual(texts(groupWords(run('She said "go." We went', 0.2))), ['She said "go."', 'We went']);
});

test('a trailing single word joins the previous group (gap <= 0.5 s); a one-word track stays one group', () => {
  assert.deepEqual(texts(groupWords([...run('We ship it today.', 0.2), w('Thanks', 1.6, 2)])), ['We ship it today. Thanks'], 'gap 0.2 s');
  assert.deepEqual(texts(groupWords([...run('We ship it today.', 0.2), w('Thanks', 1.9, 2.3)])), ['We ship it today. Thanks'], 'gap 0.5 s exactly');
  assert.deepEqual(texts(groupWords([...run('We ship it today.', 0.2), w('Thanks', 1.91, 2.3)])), ['We ship it today.', 'Thanks'], 'gap 0.51 s: isolated');
  const lone = groupWords([w('Hello', 0.5, 1)]);
  assert.deepEqual(lone, [{ start: 0.5, end: 1, words: [w('Hello', 0.5, 1)] }]);
  // Seven words in a row with no break: a 6 + 1 split would leave one word beside its neighbour, so the sixth moves over.
  assert.deepEqual(texts(groupWords(run('one two three four five six seven', 0.2))), ['one two three four five', 'six seven']);
});

test('a mid-track one-word sentence ("Yes." then "Then we ship it today.", gap 0.1 s) merges into the next group; with a 1 s gap it stays alone; a merge never makes 7 words or 43 characters', () => {
  const ask = run('Did it pass?', 0.2); // ends at 1.1
  const yes = w('Yes.', 2.1, 2.5);
  assert.deepEqual(texts(groupWords([...ask, yes, ...run('Then we ship it today.', 2.6)])), ['Did it pass?', 'Yes. Then we ship it today.']);
  assert.deepEqual(texts(groupWords([...ask, yes, ...run('Then we ship it today.', 3.5)])), ['Did it pass?', 'Yes.', 'Then we ship it today.'], '1 s on both sides');
  // The next group already holds 6 words (a merge would make 7) and the previous one is 1 s away: "Yes." takes the
  // next group's first word instead, so both groups keep 2 to 6 words.
  const six = groupWords([...ask, yes, ...run('Then we all ship it today.', 2.6)]);
  assert.deepEqual(texts(six), ['Did it pass?', 'Yes. Then', 'we all ship it today.']);
  // 4 + 1 + 37 = 42 characters merge; 4 + 1 + 38 = 43 do not.
  const fits = groupWords([...ask, yes, ...run('Absolutely everyone deploys it today.', 2.6)]);
  assert.deepEqual(texts(fits), ['Did it pass?', 'Yes. Absolutely everyone deploys it today.']);
  assert.equal(chars(fits[1]), 42);
  const over = groupWords([...ask, yes, ...run('Absolutely everyone deploys new today.', 2.6)]);
  assert.deepEqual(texts(over), ['Did it pass?', 'Yes. Absolutely', 'everyone deploys new today.']);
  for (const g of [...six, ...fits, ...over]) assert.ok(g.words.length <= 6 && chars(g) <= 42, texts([g])[0]);
});

test('the first group never starts before 0.1 s; groups never overlap', () => {
  const groups = groupWords(parseCaptions(readFileSync(EVAL_SRT, 'utf8'), 'srt'));
  assert.equal(groups[0].start, 0.1, 'the first cue starts at 0');
  assert.deepEqual(groups.map((g) => [g.start, g.end]), [[0.1, 1.8], [2, 3.8], [4, 5.8], [6, 7.8], [8, 9.8], [10, 11.8]]);
  // Overlapping cues: the earlier one is cut at the later one's start, so one group is on screen at a time.
  const overlapping = groupWords(parseCaptions(srt([['00:00:00,500', '00:00:02,000', 'One two three.'], ['00:00:01,500', '00:00:03,000', 'Four five six.']]), 'srt'));
  assert.deepEqual(overlapping.map((g) => [g.start, g.end]), [[0.5, 1.5], [1.5, 3]]);
  for (const [i, g] of overlapping.entries()) assert.ok(i === 0 || overlapping[i - 1].end <= g.start);
  // A first word that ends before 0.1 s is never shown, so it never makes a zero-length group.
  assert.deepEqual(texts(groupWords([w('Hi', 0, 0.05), ...run('then the rest', 1)])), ['then the rest']);
});

test('out-of-order cue, empty cue, 200-word cue, emoji and CJK words: no empty or zero-length group, error names the cue line', () => {
  const backwards = srt([['00:00:00,000', '00:00:01,000', 'one'], ['00:00:02,000', '00:00:03,000', 'two'], ['00:00:01,000', '00:00:01,500', 'three']]);
  assert.throws(() => parseCaptions(backwards, 'srt'), (e) => e instanceof CaptionError && e.line === 9
    && e.message === 'cue 3 (line 9): start 00:00:01,000 is not after the previous cue\'s start 00:00:02,000; sort the cues by time');
  const inverted = srt([['00:00:00,000', '00:00:01,000', 'one'], ['00:00:01,000', '00:00:02,000', 'two'], ['00:00:05,000', '00:00:04,000', 'three']]);
  assert.throws(() => parseCaptions(inverted, 'srt'), { message: 'cue 3 (line 9): end 00:00:04,000 is before start' });
  assert.throws(() => parseCaptions('1\n00:00:01,000 --> 00:00:01,000\nflat\n', 'srt'), { message: 'cue 1 (line 1): end 00:00:01,000 is not after start 00:00:01,000; make the cue last at least 1 ms' });
  assert.throws(() => parseCaptions('1\n00:00:01,000 -> 00:00:02,000\nno arrow\n', 'srt'), { message: 'cue 1 (line 1): no timing line such as "00:00:01,000 --> 00:00:02,500"' });
  assert.throws(() => parseCaptions('1\n00:00:01 --> 00:00:02,000\nbad stamp\n', 'srt'), { message: 'cue 1 (line 1): "00:00:01" is not a time such as 00:00:01,000' });
  assert.throws(() => parseCaptions('1\n00:00:01,000 --> 00:00:02,000\n\n', 'srt'), { message: NO_CAPTIONS });
  assert.throws(() => parseCaptions('', 'vtt'), { message: NO_CAPTIONS });
  assert.throws(() => parseCaptions('{}', 'json'), { message: NO_CAPTIONS });
  assert.throws(() => parseCaptions('hello', 'txt'), { message: 'unsupported captions format ".txt"; use srt, vtt or json' });

  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const mixed = srt([
    ['00:00:00,000', '00:00:01,000', ''], // a cue with no words is skipped
    ['00:00:01,000', '00:00:02,000', '  '],
    ['00:00:02,000', '00:01:02,000', long],
    ['00:01:02,500', '00:01:04,000', '🚀🚀 launch day 🎉 👩‍👩‍👧 family'],
    ['00:01:05,000', '00:01:06,500', '今天我们发布新版本'],
    ['00:01:07,500', '00:01:10,000', '全'.repeat(50)],
  ]);
  const words = parseCaptions(mixed, 'srt');
  assert.equal(words.length, 200 + 6 + 1 + 1);
  const groups = groupWords(words);
  assert.equal(groups.flatMap((g) => g.words).length, words.length, 'every word is in a group');
  for (const [i, g] of groups.entries()) {
    const label = texts([g])[0];
    assert.ok(g.words.length >= 1 && g.words.length <= 6, `2 to 6 words: ${label}`);
    assert.ok(g.end > g.start, `not zero-length: ${label}`);
    assert.ok(g.words.length === 1 || chars(g) <= 42, `42 characters at most: ${label}`);
    if (i > 0) assert.ok(groups[i - 1].end <= g.start, 'one group at a time');
    if (g.words.length === 1) {
      const gaps = [groups[i - 1] && g.start - groups[i - 1].words.at(-1).end, groups[i + 1] && groups[i + 1].start - g.words[0].end].filter((x) => x !== undefined);
      const alone = gaps.every((gap) => gap > 0.5) || chars(g) > 42 - 2;
      assert.ok(alone, `a one-word group sits beside no neighbour within 0.5 s: ${label}`);
    }
  }
  const emoji = groups.find((g) => g.words[0].text === '🚀🚀');
  assert.equal(chars(emoji), graphemes('🚀🚀 launch day 🎉 👩‍👩‍👧 family').length);
  assert.equal(chars(emoji), 24, 'an emoji (even a ZWJ family) counts as one character');
  assert.deepEqual(texts(groups.slice(-2)), ['今天我们发布新版本', '全'.repeat(50)], 'a CJK run is one word, never split, even past 42 characters');
});

test('voice sidecar and whisper JSON both parse to the same word list for the same text', () => {
  const sidecar = { sampleRate: 24000, voice: 'af_heart', sentences: [{ text: 'Hello there big world.', start: 0, end: 4 }, { text: 'We ship', start: 4, end: 5.2 }] };
  const fromSidecar = parseCaptions(JSON.stringify(sidecar), 'json');
  assert.deepEqual(fromSidecar.map((x) => x.text), ['Hello', 'there', 'big', 'world.', 'We', 'ship']);
  const whisper = { text: 'Hello there big world. We ship', segments: [
    { start: 0, end: 4, text: ' Hello there big world.', words: fromSidecar.slice(0, 4).map(({ text, start, end }) => ({ word: ` ${text}`, start, end })) },
    { start: 4, end: 5.2, text: ' We ship', words: fromSidecar.slice(4).map(({ text, start, end }) => ({ text, start, end })) },
  ] };
  assert.deepEqual(parseCaptions(JSON.stringify(whisper), 'json'), fromSidecar);
  assert.deepEqual(parseCaptions(JSON.stringify({ words: fromSidecar.map(({ text, start, end }) => ({ word: text, start, end })) }), 'json'), fromSidecar);
  // Whisper without word timestamps: each segment is weighted like a cue.
  assert.deepEqual(parseCaptions(JSON.stringify({ segments: sidecar.sentences }), 'json'), fromSidecar);
  // A sidecar chunk edge (a long sentence cut at 300 characters) is not a sentence end; the punctuation decides.
  const chunked = { sentences: [{ text: 'a long sentence cut', start: 0, end: 1 }, { text: 'here and ends.', start: 1, end: 2 }] };
  assert.deepEqual(texts(groupWords(parseCaptions(JSON.stringify(chunked), 'json'))), ['a long sentence cut here', 'and ends.']);
  assert.throws(() => parseCaptions('{"words":[{"word":"a","start":2,"end":1}]}', 'json'), { message: 'words[0]: end 1 is before start 2' });
  assert.throws(() => parseCaptions('{"sentences":[{"text":"a","start":"x","end":1}]}', 'json'), { message: 'sentences[0]: start and end must be numbers of seconds' });
  assert.throws(() => parseCaptions('{"words":[{"word":"a","start":2,"end":3},{"word":"b","start":1,"end":2}]}', 'json'), { message: 'words[1]: start 1 is before the start of the one before it; sort them by time' });
  assert.throws(() => parseCaptions('{nope', 'json'), (e) => e instanceof CaptionError && /^not valid JSON: /.test(e.message));
});

test('captionState: karaoke word index at t, kinetic popScale 1.15 at word start and 1 after 0.15 s, typewriter chars at 0.035 s each', () => {
  const groups = groupWords([...run('one two three', 1, 0.5), ...run('four five', 3, 0.5)]);
  assert.deepEqual(captionState(groups, 'karaoke', 0.5), { group: null, wordIndex: -1, chars: 0, popScale: 1 });
  assert.equal(captionState(groups, 'karaoke', 1).group, groups[0]);
  assert.deepEqual([1, 1.49, 1.5, 2.2].map((t) => captionState(groups, 'karaoke', t).wordIndex), [0, 0, 1, 2]);
  assert.equal(captionState(groups, 'karaoke', 3.6).wordIndex, 1);
  assert.equal(captionState(groups, 'plain', 1.5).wordIndex, -1, 'plain marks no word');
  assert.equal(captionState(groups, 'plain', 1.5).chars, 'one two three'.length);
  const pop = (t) => captionState(groups, 'kinetic', t);
  assert.equal(pop(1.5).wordIndex, 1);
  assert.equal(pop(1.5).popScale, 1.15);
  assert.equal(pop(1.65).popScale, 1);
  assert.equal(pop(1.9).popScale, 1);
  assert.ok(pop(1.55).popScale < 1.15 && pop(1.55).popScale > 1, 'in between');
  const typed = (t) => captionState(groups, 'typewriter', t).chars;
  assert.deepEqual([1, 1.034, 1.035, 1.07, 1.35, 2.4].map(typed), [0, 0, 1, 2, 10, 13], 'capped at the 13 characters of "one two three"');
});

// ---- spec ---------------------------------------------------------------------------------------

test('captions validate: styles, track limit, defaults, and every error at captions[i] with the fix', () => {
  assert.deepEqual(CAPTION_STYLES, ['plain', 'pill', 'karaoke', 'kinetic', 'boxed', 'typewriter']);
  assert.equal(MAX_CAPTION_TRACKS, 20);
  const scenes = [{ id: 'one', duration: 3, elements: [] }, { id: 'two', duration: 3, elements: [] }];
  const files = {
    'ok.srt': srt([['00:00:00,500', '00:00:02,000', 'Hello there']]),
    'bad.srt': srt([['00:00:00,000', '00:00:01,000', 'one'], ['00:00:01,000', '00:00:02,000', 'two'], ['00:00:05,000', '00:00:04,000', 'three']]),
    'notes.txt': 'hello',
  };
  const errs = (captions) => {
    const { dir } = specDir({ scenes }, files);
    return validateSpec({ scenes, captions }, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
  };
  assert.deepEqual(errs([{ src: 'ok.srt' }, { src: 'ok.srt', style: 'karaoke', scene: 'two', at: 0.5 }]), []);
  assert.deepEqual(errs([{ src: 'bad.srt' }]), ['captions[0].src: cue 3 (line 9): end 00:00:04,000 is before start']);
  assert.deepEqual(errs([{ src: 'notes.txt' }]), ['captions[0].src: unsupported captions format ".txt"; use srt, vtt or json']);
  assert.deepEqual(errs([{ src: 'missing.srt' }]), ['captions[0].src: file not found: missing.srt']);
  assert.deepEqual(errs([{ src: 'ok.srt', scene: 'three' }]), ['captions[0].scene: scene "three" not found; scenes: one, two']);
  assert.deepEqual(errs([{ src: 'ok.srt', scene: 'two', at: 4 }]), ['captions[0].at: starts at 7s (scene "two" + 4s), but the video ends at 6s']);
  const style = errs([{ src: 'ok.srt', style: 'karoke' }]);
  assert.equal(style.length, 1);
  assert.match(style[0], /^captions\[0\]\.style: .*did you mean "karaoke"/);
  assert.equal(errs(Array.from({ length: 21 }, () => ({ src: 'ok.srt' }))).length, 1, 'more than 20 tracks');
  assert.deepEqual(withDefaults({ scenes, captions: [{ src: 'ok.srt' }] }).captions, [{ at: 0, style: 'plain', src: 'ok.srt' }]);
  assert.deepEqual(withDefaults({ scenes }).captions, []);
});

test('the example: valid, beside its SRT (never a .json side-file in references/examples), and karaoke', () => {
  const { spec, dir } = loadSpec(EXAMPLE);
  assert.deepEqual(validateSpec(spec, { dir }).errors, []);
  assert.deepEqual(spec.captions, [{ src: 'captioned-clip.srt', style: 'karaoke' }]);
});

// ---- the page -----------------------------------------------------------------------------------

// Opens `file` in render mode and returns every captions box (in canvas px) seen at `times`.
async function captionBoxes(file, size, times) {
  const server = await startServer({ specPath: file, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__motion, null, { timeout: 0 });
    await page.evaluate(() => window.__motion.ready);
    const seen = [];
    for (const t of times) {
      seen.push(...await page.evaluate(async (sec) => {
        await window.__motion.seek(sec);
        const stage = document.getElementById('stage');
        const s = stage.getBoundingClientRect();
        const k = window.__motion.size[0] / s.width;
        return [...stage.querySelectorAll(':scope > .captions')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => {
          const rects = [n, ...n.querySelectorAll('.word')].map((x) => x.getBoundingClientRect());
          const r = { left: Math.min(...rects.map((x) => x.left)), top: Math.min(...rects.map((x) => x.top)), right: Math.max(...rects.map((x) => x.right)), bottom: Math.max(...rects.map((x) => x.bottom)) };
          return { t: sec, text: n.textContent, lineHeight: parseFloat(getComputedStyle(n).lineHeight), height: n.offsetHeight, box: { left: (r.left - s.left) * k, top: (r.top - s.top) * k, right: (r.right - s.left) * k, bottom: (r.bottom - s.top) * k } };
        });
      }, t));
    }
    assert.deepEqual(errors, []);
    return seen;
  } finally {
    await browser.close();
    await server.close();
  }
}

const inside = (box, zone) => box.left >= zone.left - 0.5 && box.right <= zone.right + 0.5 && box.top >= zone.top - 0.5 && box.bottom <= zone.bottom + 0.5;
const every = (total, step = 0.1) => Array.from({ length: Math.round(total / step) }, (_, i) => +(i * step).toFixed(2));

test('6 words of 20 letters at 1080x1920 (9:16) and a 30-character CJK word wrap inside captionZone: the in-page .captions box is within the zone', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const longWords = Array.from({ length: 6 }, (_, i) => String.fromCharCode(97 + i).repeat(20)).join(' ');
  const files = { 'c.srt': srt([['00:00:00,000', '00:00:03,000', longWords], ['00:00:03,200', '00:00:05,000', '漢'.repeat(30)]]) };
  for (const style of ['boxed', 'kinetic']) {
    const { file } = specDir({ format: '9:16', size: [1080, 1920], captions: [{ src: 'c.srt', style }], scenes: [{ id: 's', duration: 5, elements: [] }] }, files);
    const zone = captionZone([1080, 1920], '9:16');
    const seen = await captionBoxes(file, [1080, 1920], every(5));
    assert.ok(seen.length >= 40, `${style}: captions on screen most of the time (${seen.length})`);
    for (const { t: at, box, text } of seen) assert.ok(inside(box, zone), `${style} at ${at}s: ${JSON.stringify(box)} outside ${JSON.stringify(zone)} (${text})`);
    const cjk = seen.find((s) => s.text.includes('漢'));
    assert.ok(cjk.height > 1.5 * cjk.lineHeight, `${style}: the 30-character word wraps (${cjk.height} px tall)`);
  }
  // A 16:9 zone is 178 px tall: 90 CJK characters need more lines than fit, so the layer shrinks to fit.
  const { file } = specDir({ size: [1920, 1080], captions: [{ src: 'c.srt', style: 'pill' }], scenes: [{ id: 's', duration: 3, elements: [] }] }, { 'c.srt': srt([['00:00:00,000', '00:00:03,000', '漢'.repeat(90)]]) });
  const zone = captionZone([1920, 1080]);
  const seen = await captionBoxes(file, [1920, 1080], [0.5, 1.5, 2.5]);
  assert.equal(seen.length, 3);
  for (const { box } of seen) assert.ok(inside(box, zone), `${JSON.stringify(box)} outside ${JSON.stringify(zone)}`);
});

test('captionBoxProblem: a box 1 px past the zone right edge returns the exact message; a box inside returns null', () => {
  const zone = captionZone([1920, 1080]);
  assert.equal(captionBoxProblem({ left: 400, top: 900, right: 1861, bottom: 960 }, zone, 1), 'captions leave the caption zone (right) at 1.00s');
  assert.equal(captionBoxProblem({ left: 59, top: 830, right: 1000, bottom: 1021 }, zone, 2.5), 'captions leave the caption zone (top, bottom, left) at 2.50s');
  assert.equal(captionBoxProblem({ left: 400, top: 900, right: 1860, bottom: 960 }, zone, 1), null);
  assert.equal(captionBoxProblem({ left: 59.6, top: 841.6, right: 1860.4, bottom: 1020.4 }, zone, 1), null, 'half a pixel is on the line');
});

for (const style of CAPTION_STYLES) {
  test(`captioned-clip renders byte-identical twice, in every style: ${style}`, async (t) => {
    if (!(await requireRender(t))) return;
    const { spec } = loadSpec(EXAMPLE);
    const { file, dir } = specDir({ ...spec, captions: [{ ...spec.captions[0], style }] });
    copyFileSync(path.join(path.dirname(EXAMPLE), 'captioned-clip.srt'), path.join(dir, 'captioned-clip.srt'));
    await assertRendersIdentically(t, file, ['--fps', '10', '--size', '640x360']);
  });
}

test('check.mjs: a body text at y 900 on 1920x1080 with captions is a caption-zone problem; the same spec without captions passes', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const scenes = [{ id: 's', duration: 2, elements: [{ id: 'sub', type: 'text', text: 'Fine print', x: 960, y: 900, fontSize: 40 }] }];
  const files = { 'c.srt': srt([['00:00:00,000', '00:00:02,000', 'Short and sweet.']]) };
  const withCaptions = specDir({ size: [1920, 1080], captions: [{ src: 'c.srt' }], scenes }, files);
  const r = check([withCaptions.file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(lines(r.stdout), ['scenes[0].elements[0]: text "sub" sits in the caption zone (y >= 842) at 0.10s; move it above y 842 or end the captions before it', 'check: 1 problem']);
  const without = specDir({ size: [1920, 1080], scenes }, files);
  const ok = check([without.file]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^check: ok/);
});

test('check.mjs runs captionBoxProblem on every captions layer: a layer pushed past the zone is reported at captions[i]', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const scenes = [{ id: 's', duration: 2, elements: [{ id: 'title', type: 'text', text: 'Up top', x: 960, y: 300 }] }];
  // Two tracks one after the other (two on screen at once is a validation error): 0.1-0.8 s and 1.0-1.8 s.
  const files = { 'c.srt': srt([['00:00:00,000', '00:00:00,800', 'Short and sweet.']]) };
  const { file } = specDir({ size: [1920, 1080], captions: [{ src: 'c.srt' }, { src: 'c.srt', style: 'pill', at: 1 }], scenes }, files);
  // check.mjs's test seam: move the second layer's centre to x 1800, so it runs past the zone's right edge (1860).
  const prepare = (page) => page.evaluate(() => { document.querySelectorAll('#stage > .captions')[1].style.left = '1800px'; });
  const out = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => (typeof chunk === 'string' ? (out.push(chunk), true) : realWrite.call(process.stdout, chunk, ...rest));
  let code;
  try {
    code = await checkMain([file, '--json'], { prepare });
  } finally {
    process.stdout.write = realWrite;
  }
  assert.equal(code, 1, out.join(''));
  assert.deepEqual(JSON.parse(out.join('')).errors, [{ path: 'captions[1]', message: 'captions leave the caption zone (right) at 1.40s' }]);
});

// ---- fix round 1 --------------------------------------------------------------------------------

test('SRT: a timing line inside a block starts a new cue (a missing blank line), and its errors name its own line', () => {
  const glued = '1\n00:00:00,000 --> 00:00:01,000\nHello there\n2\n00:00:01,500 --> 00:00:02,500\nGeneral Kenobi\n';
  const words = parseCaptions(glued, 'srt');
  assert.deepEqual(words.map((x) => x.text), ['Hello', 'there', 'General', 'Kenobi'], 'the "2" index line is not a word');
  assert.deepEqual([words[1].end, words[2].start, words[3].end], [1, 1.5, 2.5]);
  const bare = '00:00:00,000 --> 00:00:01,000\nHello\n00:00:01,500 --> 00:00:02,500\nWorld\n';
  assert.deepEqual(parseCaptions(bare, 'srt'), [w('Hello', 0, 1), w('World', 1.5, 2.5)]);
  const broken = '1\n00:00:00,000 --> 00:00:01,000\nHello\n2\n00:00:03,000 --> 00:00:02,000\nWorld\n';
  assert.throws(() => parseCaptions(broken, 'srt'), { message: 'cue 2 (line 4): end 00:00:02,000 is before start' });
});

test('JSON with a UTF-8 BOM parses like JSON without one: Whisper words, Whisper segments and the voice sidecar', () => {
  const shapes = {
    words: { words: [{ word: ' Hi', start: 0, end: 0.5 }, { word: ' there', start: 0.5, end: 1 }] },
    segments: { segments: [{ text: ' Hi there', start: 0, end: 1 }] },
    sentences: { sentences: [{ text: 'Hi there', start: 0, end: 1 }] },
  };
  for (const [name, data] of Object.entries(shapes)) {
    const plain = parseCaptions(JSON.stringify(data), 'json');
    assert.deepEqual(plain.map((x) => x.text), ['Hi', 'there'], name);
    assert.deepEqual(parseCaptions(`﻿${JSON.stringify(data)}`, 'json'), plain, `${name} with a BOM`);
  }
});

test('markup: only tag-shaped markup is dropped, "a<b and c>d" survives, and numeric entities decode', () => {
  const words = (text) => parseCaptions(srt([['00:00:00,000', '00:00:04,000', text]]), 'srt').map((x) => x.text);
  assert.deepEqual(words('a<b and c>d'), ['a<b', 'and', 'c>d']);
  assert.deepEqual(words('<i>one</i> <c.yellow>two</c> <00:00:01.000>three <font color="red">four</font> <v Ana>five</v>'), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(words('&#65;&#x42; &amp; &lt;3 &#9999999; &bogus;'), ['AB', '&', '<3', '&#9999999;', '&bogus;']);
});

test('VTT: a cue whose id starts with NOTE keeps its cue; a NOTE block is still skipped', () => {
  const vtt = 'WEBVTT\n\nNOTE this is a comment\n\nNOTE-1\n00:00.000 --> 00:01.000\nKept here\n\nNOTE\nanother comment\n';
  assert.deepEqual(parseCaptions(vtt, 'vtt').map((x) => x.text), ['Kept', 'here']);
});

test('the first-group 0.1 s clamp applies after a dropped group: no shown group starts before 0.1 s', () => {
  const groups = groupWords([w('Hi.', 0, 0.03), w('x'.repeat(40), 0.05, 0.5), w('end.', 0.5, 0.8)]);
  assert.deepEqual(groups.map((g) => [texts([g])[0].slice(0, 4), g.start, g.end]), [['xxxx', 0.1, 0.5], ['end.', 0.5, 0.8]]);
});

test('the borrow step never moves a word that ends a sentence', () => {
  assert.deepEqual(texts(groupWords(run('one two three four five six. seven', 0.2))), ['one two three four five six.', 'seven']);
});

test('a Whisper word with no text, and a track that would show nothing, are errors that name the fix', () => {
  assert.throws(() => parseCaptions('{"words":[{"start":0,"end":1}]}', 'json'), { message: 'words[0]: no "word" or "text"; give every word its text' });
  assert.throws(() => parseCaptions('{"segments":[{"start":0,"end":1,"words":[{"start":0,"end":1}]}]}', 'json'), { message: 'segments[0].words[0]: no "word" or "text"; give every word its text' });
  const scenes = [{ id: 'one', duration: 3, elements: [] }];
  const { dir } = specDir({ scenes }, { 'early.srt': srt([['00:00:00,000', '00:00:00,050', 'Hi']]) });
  assert.deepEqual(validateSpec({ scenes, captions: [{ src: 'early.srt' }] }, { dir }).errors.map((e) => `${e.path}: ${e.message}`),
    ['captions[0].src: nothing would show: every word ends by 0.1 s into the video; start the track later with at, or fix the times in the file']);
  assert.deepEqual(validateSpec({ scenes, captions: [{ src: 'early.srt', at: 0.5 }] }, { dir }).errors, []);
});

test('validate: two captions tracks on screen at once is an error naming both and the time', () => {
  const scenes = [{ id: 'one', duration: 6, elements: [] }];
  const { dir } = specDir({ scenes }, { 'ok.srt': srt([['00:00:00,500', '00:00:02,000', 'Hello there']]) });
  const errs = (captions) => validateSpec({ scenes, captions }, { dir }).errors.map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(errs([{ src: 'ok.srt' }, { src: 'ok.srt', style: 'pill', at: 1 }]),
    ['captions[1]: on screen at 1.50s together with captions[0]; only one captions track can show at a time: move one with at or scene, or merge the files']);
  assert.deepEqual(errs([{ src: 'ok.srt' }, { src: 'ok.srt', at: 2 }]), [], 'back to back is fine');
});

test('kinetic: the pop is capped so a long word at 9:16 never leaves the zone; a short word still pops', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const files = { 'c.srt': srt([['00:00:01,000', '00:00:03,000', 'W'.repeat(40)], ['00:00:03,500', '00:00:05,000', 'Go now']]) };
  const { file } = specDir({ format: '9:16', size: [1080, 1920], captions: [{ src: 'c.srt', style: 'kinetic' }], scenes: [{ id: 's', duration: 5, elements: [] }] }, files);
  const zone = captionZone([1080, 1920], '9:16');
  const seen = await captionBoxes(file, [1080, 1920], [1, 1.03, 1.08, 1.2, 3.5, 3.7]);
  assert.equal(seen.length, 6);
  for (const { t: at, box } of seen) assert.ok(inside(box, zone), `at ${at}s: ${JSON.stringify(box)} outside ${JSON.stringify(zone)}`);
  const width = (b) => b.right - b.left;
  assert.ok(width(seen.find((s) => s.t === 3.5).box) > width(seen.find((s) => s.t === 3.7).box), 'the short group still pops');
  const r = check([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('check.mjs: lower-band text with no caption on screen passes; the same text while a caption shows is a problem', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const low = (id) => ({ id, type: 'text', text: 'Fine print', x: 960, y: 900, fontSize: 40 });
  const scenes = [{ id: 'quiet', duration: 2, elements: [low('low1')] }, { id: 'talk', duration: 2, elements: [low('low2')] }];
  const files = { 'c.srt': srt([['00:00:02,500', '00:00:04,000', 'Now it shows.']]) };
  const { file } = specDir({ size: [1920, 1080], captions: [{ src: 'c.srt' }], scenes }, files);
  const r = check([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = lines(r.stdout);
  assert.equal(out.length, 2, r.stdout);
  assert.match(out[0], /^scenes\[1\]\.elements\[0\]: text "low2" sits in the caption zone \(y >= 842\) at \d\.\d\ds; move it above y 842 or end the captions before it$/);
  assert.equal(out[1], 'check: 1 problem');
});

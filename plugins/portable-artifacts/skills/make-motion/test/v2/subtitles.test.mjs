// --subtitles srt|vtt (scripts/v2/subtitles.mjs): a caption file beside the MP4, one cue per sentence (split past
// MAX_CUE_WORDS), timed by when each word is heard: measured with a voice, the word-count estimate without one (and a
// VTT then says so in a NOTE; SRT has no comment line, so an estimated SRT is refused). No browser for the unit tests.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import { MAX_CUE_WORDS, subtitleCues, subtitleText, ESTIMATE_NOTE } from '../../scripts/v2/subtitles.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const word = (text, soundStart, soundEnd) => ({ text, soundStart, soundEnd, start: soundStart, end: soundEnd });
const TIMELINE = { timed: 'measured', shots: [
  { id: 'a', start: 0, end: 2, words: [word('Hello', 0.1, 0.4), word('world.', 0.45, 0.9), word('Again.', 1.2, 1.6)], sentences: [{ first: 0, last: 1 }, { first: 2, last: 2 }] },
  { id: 'b', start: 2, end: 4, words: [], sentences: [] },
  { id: 'c', start: 4, end: 6, words: [word('Last', 0.2, 0.5), word('one.', 0.55, 1)], sentences: [{ first: 0, last: 1 }] },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-subtitles-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('one cue per sentence, at film time, from the first word heard to the last', () => {
  assert.deepEqual(subtitleCues(TIMELINE), [
    { start: 0.1, end: 0.9, text: 'Hello world.' },
    { start: 1.2, end: 1.6, text: 'Again.' },
    { start: 4.2, end: 5, text: 'Last one.' },
  ]);
});

test('a sentence longer than MAX_CUE_WORDS is split into cues of at most that many words', () => {
  const words = Array.from({ length: MAX_CUE_WORDS + 3 }, (_, i) => word(`w${i}`, i * 0.3, i * 0.3 + 0.2));
  const cues = subtitleCues({ timed: 'measured', shots: [{ id: 'a', start: 0, end: 9, words, sentences: [{ first: 0, last: words.length - 1 }] }] });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text.split(' ').length, MAX_CUE_WORDS);
  assert.equal(cues[1].start, MAX_CUE_WORDS * 0.3);
});

test('SRT: numbered cues with comma milliseconds; VTT: the header, dot milliseconds', () => {
  const srt = subtitleText(TIMELINE, 'srt');
  assert.match(srt, /^1\n00:00:00,100 --> 00:00:00,900\nHello world\.\n\n2\n00:00:01,200 --> 00:00:01,600\nAgain\.\n\n3\n00:00:04,200 --> 00:00:05,000\nLast one\.\n$/);
  const vtt = subtitleText(TIMELINE, 'vtt');
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.100 --> 00:00:00\.900\nHello world\.\n\n/);
  assert.ok(!vtt.includes('NOTE'), 'measured times need no note');
});

test('estimated times: the VTT says so in a NOTE; an SRT is refused because it has no comment line', () => {
  const estimated = { ...TIMELINE, timed: 'estimated' };
  assert.match(subtitleText(estimated, 'vtt'), new RegExp(`^WEBVTT\\n\\nNOTE ${ESTIMATE_NOTE}\\n\\n`));
  assert.throws(() => subtitleText(estimated, 'srt'), /SRT has no comment line.*--subtitles vtt/);
});

test('a cue holds no markup the player would read: < and & are written as text', () => {
  const t = { timed: 'measured', shots: [{ id: 'a', start: 0, end: 2, words: [word('<b>x</b>', 0, 0.5), word('&', 0.6, 0.8)], sentences: [{ first: 0, last: 1 }] }] };
  assert.match(subtitleText(t, 'vtt'), /&lt;b&gt;x&lt;\/b&gt; &amp;/);
});

test('make.mjs --subtitles vtt on a silent film writes the file beside the MP4 path with the estimate note', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = path.join(dir, 'film.json');
  writeFileSync(film, JSON.stringify({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Every row has a source.' }] }));
  const run = spawnSync(process.execPath, [MAKE, film, '--subtitles', 'vtt', '--no-render', '--json'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  const file = path.join(dir, 'out', 'film.vtt');
  assert.deepEqual(report.subtitles, { file, format: 'vtt', timed: 'estimated' });
  assert.match(readFileSync(file, 'utf8'), /NOTE /);
  const srt = spawnSync(process.execPath, [MAKE, film, '--subtitles', 'srt', '--no-render'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(srt.status, 2);
  assert.equal(existsSync(path.join(dir, 'out', 'film.srt')), false);
  return undefined;
});

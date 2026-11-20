// make.mjs --phonemes: how each word of a film's narration will be read, from the phonemizer the voice uses (no audio,
// no model). scripts/v2/voice/reading.mjs builds it with the synthesis's own call preparation, so a pronunciation hint
// and emphasis show as they will be spoken. The real-phonemizer test skips without the optional voice package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import { OPTIONAL_VOICE, readingOf, readingLines } from '../../scripts/v2/voice/reading.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
// A fake phonemizer: every word becomes "p" + the word in lower case (only vocab letters), one word per space.
const fakePhonemize = async (text) => [text.toLowerCase().split(/\s+/).filter(Boolean).map((w) => `p${w.replace(/[^a-z]/g, '')}`).join(' ')];

test('one entry per narrated shot, one per word, in order; a shot with no say is left out', async () => {
  const film = { shots: [
    { id: 'hook', show: 'statement', say: 'Every row counts.' },
    { id: 'quiet', show: 'free', hold: 2 },
    { id: 'end', show: 'statement', say: 'Done now.' },
  ] };
  const reading = await readingOf(film, { phonemize: fakePhonemize });
  assert.deepEqual(reading.map((s) => s.shot), ['hook', 'end']);
  assert.deepEqual(reading[0].words.map((w) => w.text), ['Every', 'row', 'counts.']);
  assert.ok(reading[0].words.every((w) => w.phonemes.length > 0));
});

test('a pronunciation hint is read as written, not as the phonemizer would say it', async () => {
  const film = { shots: [{ id: 'a', show: 'statement', say: 'Say [Kokoro](/kˈOkəɹO/) twice.' }] };
  const [{ words }] = await readingOf(film, { phonemize: fakePhonemize });
  assert.equal(words.find((w) => w.text === 'Kokoro').phonemes, 'kˈOkəɹO');
});

test('an emphasised word gets primary stress, as synthesis gives it', async () => {
  const plain = await readingOf({ shots: [{ id: 'a', show: 'statement', say: 'one more' }] }, { phonemize: fakePhonemize });
  const stressed = await readingOf({ shots: [{ id: 'a', show: 'statement', say: 'one *more*' }] }, { phonemize: fakePhonemize });
  assert.ok(!plain[0].words[1].phonemes.includes('ˈ'));
  assert.ok(stressed[0].words[1].phonemes.includes('ˈ'), stressed[0].words[1].phonemes);
});

test('the text form: the shot id, then one word per line with its phonemes', () => {
  const lines = readingLines([{ shot: 'hook', words: [{ text: 'Every', phonemes: 'ˈɛvɹi' }, { text: 'row', phonemes: 'ɹˈO' }] }]);
  assert.deepEqual(lines, ['hook', '  Every  /ˈɛvɹi/', '  row  /ɹˈO/']);
});

test('make.mjs --phonemes with the real phonemizer prints how a word is read, and makes no audio', (t) => {
  if (!existsSync(path.join(OPTIONAL_VOICE, 'node_modules'))) return t.skip('the optional voice package is not installed');
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-reading-'));
  try {
    const film = path.join(dir, 'film.json');
    writeFileSync(film, JSON.stringify({ version: 2, voice: { name: 'af_heart' }, shots: [{ id: 'hook', show: 'statement', say: 'Hello world.' }] }));
    const run = spawnSync(process.execPath, [MAKE, film, '--phonemes', '--json'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.deepEqual(report.reading[0].words.map((w) => w.text), ['Hello', 'world.']);
    assert.match(report.reading[0].words[0].phonemes, /h.*l/);
    assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing is written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return undefined;
});

test('--phonemes does not go with --outline, --out or --no-render', () => {
  for (const extra of [['--outline'], ['--out', 'x.mp4'], ['--no-render']]) {
    const run = spawnSync(process.execPath, [MAKE, 'film.json', '--phonemes', ...extra], { encoding: 'utf8' });
    assert.equal(run.status, 2, extra.join(' '));
    assert.match(run.stderr, /--phonemes/);
  }
});

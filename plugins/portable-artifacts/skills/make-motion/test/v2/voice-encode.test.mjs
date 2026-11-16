// The master's AAC encode against the mode's loudness (scripts/v2/voice/master.mjs encodeMaster and judgeLevel, and
// scripts/v2/voice/remaster.mjs encodeToTarget): a shortfall the last-stage hold caused is noted, one that predates it
// is refused (branch review A, I5); an encode short at the ceiling is mastered again with headroom for the raise, a
// bounded number of times, before the refusal applies (branch review A, I1). Fake runners only: no ffmpeg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { encodeMaster, judgeLevel, masterTrack, HELD_NOTE } from '../../scripts/v2/voice/master.mjs';
import { encodeToTarget, REMASTER_ROUNDS, REMASTER_HEADROOM_MAX_DB } from '../../scripts/v2/voice/remaster.mjs';

const VIRAL = registries.modes.get('viral'); // -14 LUFS, ceiling -1 dBTP, so ceilingFor = -1.5
const ENCODE = Object.freeze({ master: '/w/m.wav', out: '/w/m.m4a', duration: 4 });

// A run that answers each measurement with the next of `levels` ([lufs, truePeak], the last repeated) and records the gain
// of each encode (0 when it has none).
function encodeRun(levels) {
  const gains = [];
  let k = 0;
  const run = async (args) => {
    if (args.includes('null')) {
      const [lufs, peak] = levels[Math.min(k++, levels.length - 1)];
      return { code: 0, stderr: `  I:         ${lufs} LUFS\n  True peak:\n    Peak:      ${peak} dBFS\n` };
    }
    const af = args.indexOf('-af');
    gains.push(af < 0 ? 0 : Number(/volume=(-?[\d.]+)dB/.exec(args[af + 1])[1]));
    return { code: 0, stderr: '' };
  };
  return { run, gains };
}

// ---- I5: the held note covers only what the hold took ----

test('encodeMaster names the level the hold lowered from (heldFrom), and null when no hold ran', async () => {
  const held = await encodeMaster({ run: encodeRun([[-14.1, 0.3], [-14.6, -1.5]]).run, ...ENCODE, loudness: VIRAL.loudness });
  assert.equal(held.held, true);
  assert.deepEqual([held.heldFrom.lufs, held.heldFrom.truePeakDb], [-14.1, 0.3]);
  const clean = await encodeMaster({ run: encodeRun([[-14.1, -2]]).run, ...ENCODE, loudness: VIRAL.loudness });
  assert.equal(clean.heldFrom, null);
});

test('judgeLevel: the held note excuses a shortfall the hold caused; one that predates the hold is refused (branch review A, I5)', () => {
  const after = { lufs: -15.9, truePeakDb: -1.5, note: null };
  const onTarget = { lufs: -14.1, truePeakDb: 0.3, note: null };
  assert.deepEqual(judgeLevel(after, VIRAL.loudness, undefined, { heldFrom: onTarget }), { ...after, note: HELD_NOTE }, 'on target before the hold: the hold caused it');
  const alreadyShort = { lufs: -16.5, truePeakDb: 0.3, note: null };
  assert.throws(() => judgeLevel({ ...after, lufs: -18 }, VIRAL.loudness, undefined, { heldFrom: alreadyShort }), (err) => /-18 LUFS, more than 1 LU under/.test(err.message) && /loudest moments/.test(err.hint),
    'short before the hold (the limiter rounds exhausted): refused as before');
  assert.throws(() => judgeLevel(after, VIRAL.loudness, undefined, { held: true }), /more than 1 LU under/, 'a bare held flag carries no cause and excuses nothing');
});

test('encodeMaster then judgeLevel: a master short before an over-ceiling encode is refused, not waved through by the hold', async () => {
  const encoded = await encodeMaster({ run: encodeRun([[-16.5, 0.3], [-18, -1.5]]).run, ...ENCODE, loudness: VIRAL.loudness });
  assert.equal(encoded.held, true);
  assert.throws(() => judgeLevel(encoded.level, VIRAL.loudness, 'the mastered narration', { heldFrom: encoded.heldFrom }), /-18 LUFS, more than 1 LU under/);
});

// ---- I1: short at the ceiling is mastered again with headroom, a bounded number of times ----

// A master callback that records the headroom each call asked for and resolves the master's path.
function masters() {
  const headrooms = [];
  return { headrooms, master: async (headroomDb) => { headrooms.push(headroomDb); return ENCODE.master; } };
}

test('an encode short of the target at the ceiling is mastered again with the shortfall as headroom, then raised into it (branch review A, I1)', async () => {
  // the reviewer's case: the master 0.4 LU short with its peak at ceilingFor, the encode losing 1.5 LU more
  const { run, gains } = encodeRun([[-15.9, -1.5], [-15.9, -3.4], [-14, -1.5]]);
  const m = masters();
  const encoded = await encodeToTarget({ run, ...ENCODE, master: m.master, loudness: VIRAL.loudness, noVoice: false });
  assert.deepEqual(m.headrooms, [0, 1.9], 'mastered once as always, then again with 1.9 dB of room under the ceiling');
  assert.deepEqual(gains, [0, 0, 1.9], 'the second master\'s encode is raised into that room');
  assert.equal(encoded.level.lufs, -14);
  assert.deepEqual(judgeLevel(encoded.level, VIRAL.loudness, undefined, { heldFrom: encoded.heldFrom }), encoded.level);
});

test('an encode a few tenths under ceilingFor, whose room cannot bring it within tolerance, is mastered again too', async () => {
  // real readings step 0.1 dB: a peak at -1.7 or -1.6 leaves a raise of 0.2 or 0.1, nowhere near the 2 LU it lacks
  const { run } = encodeRun([[-16.3, -1.7], [-16.1, -1.6], [-16.0, -1.6]]);
  const m = masters();
  await encodeToTarget({ run, ...ENCODE, master: m.master, loudness: VIRAL.loudness, noVoice: false });
  assert.deepEqual(m.headrooms.slice(0, 2), [0, 2]);
});

test('masterTrack with headroomDb masters to the same target under a ceiling that much lower', async () => {
  const pro = registries.modes.get('pro').loudness; // -16 LUFS, ceiling -1.5 dBTP, so ceilingFor = -2
  const written = async (peak, headroomDb) => {
    const calls = [];
    const { run } = encodeRun([[-20, peak]]);
    await masterTrack({ run: (args) => { calls.push(args); return run(args); }, cues: { file: '/w/cues.wav' }, timeline: { duration: 4 }, loudness: pro, workDir: '/w', headroomDb });
    const graph = calls.at(-1)[calls.at(-1).indexOf('-filter_complex') + 1];
    return Number(/volume=(-?[\d.]+)dB\[out\]$/.exec(graph)[1]);
  };
  assert.equal(await written(-5, 0), 3, 'capped at ceilingFor -2: +3 dB');
  assert.equal(await written(-5, 2), 1, 'with 2 dB of headroom, capped at -4: +1 dB');
  assert.equal(await written(-30, 2), 4, 'a quiet peak: the full 4 dB to the same -16 LUFS target');
});

test('the re-master runs at most REMASTER_ROUNDS times, its headroom capped; what is still short is then refused as before', async () => {
  assert.equal(REMASTER_ROUNDS, 2);
  assert.equal(REMASTER_HEADROOM_MAX_DB, 3);
  const { run } = encodeRun([[-16, -1.5]]); // every encode 2 LU short, its peak at ceilingFor: no raise ever has room
  const m = masters();
  const encoded = await encodeToTarget({ run, ...ENCODE, master: m.master, loudness: VIRAL.loudness, noVoice: false });
  assert.deepEqual(m.headrooms, [0, 2, 3], 'one master, then two more, the headroom growing by the shortfall to its cap');
  assert.throws(() => judgeLevel(encoded.level, VIRAL.loudness, 'the mastered narration', { heldFrom: encoded.heldFrom }), (err) => /more than 1 LU under/.test(err.message) && /loudest moments/.test(err.hint));
  const small = masters();
  await encodeToTarget({ run: encodeRun([[-15.1, -1.5]]).run, ...ENCODE, master: small.master, loudness: VIRAL.loudness, noVoice: false });
  assert.deepEqual(small.headrooms, [0, 1.1, 2.2], 'under the cap, the rounds alone stop it: three masters at most');
});

test('judgeLevel: a film with no narration whose encode was also held keeps both notes', () => {
  const after = { lufs: -15.9, truePeakDb: -1.5, note: null };
  const { note } = judgeLevel(after, VIRAL.loudness, undefined, { noVoice: true, heldFrom: { lufs: -14.1, truePeakDb: 0.3, note: null } });
  assert.ok(note.includes('no narration') && note.includes(HELD_NOTE), note);
});

test('no re-master when the encode is within tolerance, unmeasured, excused, not peak-capped, or there is no master', async () => {
  const once = async (levels, noVoice = false) => {
    const m = masters();
    await encodeToTarget({ run: encodeRun(levels).run, ...ENCODE, master: m.master, loudness: VIRAL.loudness, noVoice });
    return m.headrooms;
  };
  assert.deepEqual(await once([[-14.8, -1.5]]), [0], 'within 1 LU');
  assert.deepEqual(await once([[-70, -50]]), [0], 'too short to measure');
  assert.deepEqual(await once([[-16, -1.5]], true), [0], 'no narration: cues and music are noted, not limited harder');
  assert.deepEqual(await once([[-14.1, 0.3], [-15.6, -1.5]]), [0], 'short only through the hold: the held note covers it');
  assert.deepEqual(await once([[-17, -10], [-16, -9], [-15.5, -8]]), [0], 'the raise still had room: the encode rounds, not the peak, stopped it');
  const none = await encodeToTarget({ run: async () => assert.fail('nothing to encode'), ...ENCODE, master: async () => null, loudness: VIRAL.loudness, noVoice: false });
  assert.equal(none, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, renderHash, assertRendersIdentically, BROWSER_ONLY } from './helpers/render.mjs';
import { resolveBeats, BeatRefError } from '../scripts/lib/beat-refs.mjs';
import { resolveSpecBeats, MAX_BEATS } from '../scripts/lib/beats-file.mjs';
import { validateSpec, withDefaults } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { autoCues } from '../template/viral.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDER = path.join(root, 'scripts/render.mjs');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLE = path.join(root, 'references/examples/on-the-beat.json');
const SMALL = ['--fps', '10', '--size', '320x180'];
const GRID = Array.from({ length: 16 }, (_, i) => i * 0.5); // 120 BPM: beat n at n / 2 seconds

const tmp = () => mkdtempSync(path.join(tmpdir(), 'beat-refs-'));
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };
const thrown = (fn) => { try { fn(); } catch (e) { return e; } return null; };

// Two scenes, `one` (0 to 4 s) and `two` (4 to 5.5 s), with a beat-anchored keyframe, cue, audio track and camera.
const spec = (extra = {}) => ({
  size: [320, 180],
  fps: 30,
  beats: 'data/grid.beats.json',
  scenes: [
    { id: 'one', duration: 4, elements: [{ id: 'a', type: 'text', text: 'A', x: 160, y: 90, keyframes: [{ t: 'beat:1', opacity: 0 }, { t: 'beat:2', opacity: 1 }] }] },
    {
      id: 'two', duration: 1.5,
      camera: { keyframes: [{ t: 'beat:8', zoom: 1 }, { t: 'beat:10', zoom: 1.2 }] },
      elements: [{ id: 'g', type: 'group', x: 0, y: 0, children: [{ id: 'b', type: 'text', text: 'B', x: 160, y: 90, keyframes: [{ t: 'beat:9', opacity: 0 }, { t: 'beat:10', opacity: 1 }] }] }],
    },
  ],
  audio: [{ src: 'data/grid.wav', at: 'beat:2' }],
  cues: [{ cue: 'pop', at: 'beat:3' }, { cue: 'click', scene: 'two', at: 'beat:9' }],
  ...extra,
});

// A spec folder: motion.json, data/grid.beats.json (`grid`, a file's text or an object) and a stand-in audio file.
function folder(motion = spec(), grid = { bpm: 120, confidence: 0.9, beats: GRID }) {
  const dir = tmp();
  mkdirSync(path.join(dir, 'data'));
  writeFileSync(path.join(dir, 'data/grid.beats.json'), typeof grid === 'string' ? grid : JSON.stringify(grid));
  writeFileSync(path.join(dir, 'data/grid.wav'), 'x');
  writeFileSync(path.join(dir, 'motion.json'), JSON.stringify(motion));
  return dir;
}

test('resolveBeats turns each beat keyframe into scene time, and each cue and audio at into video or scene time', () => {
  const out = resolveBeats(deepFreeze(spec()), GRID);
  assert.deepEqual(out.scenes[0].elements[0].keyframes.map((k) => k.t), [0.5, 1]);
  assert.deepEqual(out.scenes[1].camera.keyframes.map((k) => k.t), [0, 1]); // beat 8 is 4 s: scene two's start
  assert.deepEqual(out.scenes[1].elements[0].children[0].keyframes.map((k) => k.t), [0.5, 1]); // inside a group
  assert.equal(out.audio[0].at, 1);
  assert.equal(out.cues[0].at, 1.5); // absolute: no scene
  assert.equal(out.cues[1].at, 0.5); // beat 9 is 4.5 s: 0.5 s into scene two
  assert.equal(out.beats, 'data/grid.beats.json'); // the root field stays: server.mjs watches it, batch.mjs guards it
});

test('resolveBeats is pure and idempotent, and a spec with no beat reference comes back as the same object', () => {
  const input = deepFreeze(spec());
  const once = resolveBeats(input, GRID);
  assert.notEqual(once, input);
  assert.deepEqual(resolveBeats(once, GRID), once);
  assert.equal(input.cues[0].at, 'beat:3');
  const plain = deepFreeze({ scenes: [{ id: 's', duration: 2, elements: [] }], cues: [{ cue: 'pop', at: 1 }] });
  assert.equal(resolveBeats(plain, GRID), plain);
  assert.equal(resolveBeats(plain, undefined), plain);
});

test('resolveBeats leaves everything that is not a beat reference alone, so the schema still says what is wrong with it', () => {
  const odd = { scenes: [{ id: 's', duration: 2, elements: [{ id: 'a', type: 'text', text: 'A', x: 1, y: 1, keyframes: [{ t: '1s', opacity: 0 }, { t: 'later' }] }] }] };
  assert.deepEqual(resolveBeats(deepFreeze(odd), GRID), odd);
  assert.equal(resolveBeats('not a spec', GRID), 'not a spec');
  assert.deepEqual(resolveBeats({ scenes: 7, cues: 'x' }, GRID), { scenes: 7, cues: 'x' });
});

test('resolveBeats: a beat outside its scene names the beat, its time and the scene', () => {
  const input = { scenes: [{ id: 'one', duration: 4, elements: [] }, { id: 'two', duration: 1.5, elements: [{ id: 'a', type: 'text', text: 'A', x: 1, y: 1, keyframes: [{ t: 'beat:12' }] }] }] };
  const e = thrown(() => resolveBeats(input, GRID));
  assert.ok(e instanceof BeatRefError);
  assert.deepEqual(e.errors, [{ path: 'scenes[1].elements[0].keyframes[0].t', message: 'beat:12 is at 6.0s, outside scene "two" (4s to 5.5s)' }]);
  assert.equal(e.message, e.errors[0].message);
});

test('resolveBeats: a beat before the scene, or a cue in a scene it is not in, is outside that scene too', () => {
  const early = { scenes: [{ id: 'one', duration: 4, elements: [] }, { id: 'two', duration: 2, elements: [] }], cues: [{ cue: 'pop', scene: 'two', at: 'beat:3' }] };
  assert.deepEqual(thrown(() => resolveBeats(early, GRID)).errors, [{ path: 'cues[0].at', message: 'beat:3 is at 1.5s, outside scene "two" (4s to 6s)' }]);
});

test('resolveBeats: an index past the end says how many beats the file has', () => {
  const input = { scenes: [{ id: 'one', duration: 4, elements: [] }], cues: [{ cue: 'pop', at: 'beat:40' }] };
  assert.equal(thrown(() => resolveBeats(input, GRID)).message, 'beat:40 does not exist; the file has 16 beats');
  assert.equal(thrown(() => resolveBeats(input, [0.5])).message, 'beat:40 does not exist; the file has 1 beat');
});

test('resolveBeats: a beat reference without a beats file says to add one', () => {
  const input = { scenes: [{ id: 'one', duration: 4, elements: [] }], cues: [{ cue: 'pop', at: 'beat:3' }] };
  const e = thrown(() => resolveBeats(input, undefined));
  assert.deepEqual(e.errors, [{ path: 'cues[0].at', message: '"beat:3" needs a root "beats" file' }]);
});

test('resolveBeats: a malformed reference or an unknown scene is named, and every problem is reported together', () => {
  const input = {
    scenes: [{ id: 'one', duration: 4, elements: [{ id: 'a', type: 'text', text: 'A', x: 1, y: 1, keyframes: [{ t: 'beat:two' }, { t: 'beat:-1' }, { t: 'beat: 3' }] }] }],
    cues: [{ cue: 'pop', scene: 'nope', at: 'beat:1' }, { cue: 'pop', at: 'beat:99' }],
  };
  const { errors } = thrown(() => resolveBeats(input, GRID));
  assert.equal(errors.length, 5);
  assert.match(errors[0].message, /^"beat:two" is not a beat reference; write "beat:<n>"/);
  assert.equal(errors[0].path, 'scenes[0].elements[0].keyframes[0].t');
  assert.deepEqual(errors[3], { path: 'cues[0].scene', message: 'scene "nope" not found; scenes: one' });
  assert.equal(errors[4].message, 'beat:99 does not exist; the file has 16 beats');
});

test('resolveBeats: a near miss such as " beat:1", "Beat:1" or "BEAT:1" gets the beat hint, not a bare "must be number"', () => {
  for (const text of [' beat:1', 'Beat:1', 'BEAT:1', 'beat: 1']) {
    const input = { scenes: [{ id: 'one', duration: 4, elements: [] }], cues: [{ cue: 'pop', at: text }] };
    const e = thrown(() => resolveBeats(input, GRID));
    assert.ok(e instanceof BeatRefError, JSON.stringify(text));
    assert.match(e.message, /is not a beat reference; write "beat:<n>"/, JSON.stringify(text));
  }
});

test('a beats file resolves relative to the spec and the resolved spec validates', () => {
  const dir = folder();
  const motion = JSON.parse(readFileSync(path.join(dir, 'motion.json'), 'utf8'));
  const { spec: resolved, errors } = resolveSpecBeats(motion, dir);
  assert.equal(errors, undefined);
  assert.equal(resolved.cues[0].at, 1.5);
  assert.deepEqual(validateSpec(motion, { dir }), { ok: true, errors: [] });
  assert.deepEqual(validateSpec(resolved, { dir }), { ok: true, errors: [] }); // the resolved spec is accepted again, unchanged
});

test('a spec with no beats field and no beat reference is the very same object', () => {
  const plain = { scenes: [{ id: 's', duration: 2, elements: [] }] };
  assert.equal(resolveSpecBeats(plain, tmp()).spec, plain);
});

test('a beat reference with no root beats field fails validation with the fix', () => {
  const dir = folder(spec({ beats: undefined }));
  const result = validateSpec(JSON.parse(readFileSync(path.join(dir, 'motion.json'), 'utf8')), { dir });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === 'audio[0].at' && e.message === '"beat:2" needs a root "beats" file'), JSON.stringify(result.errors));
});

test('the beats path follows the same containment as every asset', () => {
  const outside = tmp();
  writeFileSync(path.join(outside, 'secret.json'), JSON.stringify({ beats: GRID }));
  const dir = folder();
  symlinkSync(path.join(outside, 'secret.json'), path.join(dir, 'data/link.beats.json'));
  const cases = {
    '../secret.json': /must stay inside the spec folder/,
    [path.join(outside, 'secret.json')]: /must be a path relative to the spec file/,
    'https://example.com/grid.json': /must be a path relative to the spec file/,
    'data/link.beats.json': /must stay inside the spec folder/, // a symlink out of the folder
    'data/.hidden.json': /hidden files are not allowed/,
    'data/missing.beats.json': /file not found/,
    data: /not a regular file/,
    'data/grid.wav': /must be a \.json file/,
    '': /must be a path to a beats file/,
  };
  for (const [src, message] of Object.entries(cases)) {
    const { errors } = resolveSpecBeats(spec({ beats: src }), dir);
    assert.equal(errors?.length, 1, `${JSON.stringify(src)}: ${JSON.stringify(errors)}`);
    assert.equal(errors[0].path, 'beats');
    assert.match(errors[0].message, message, src);
  }
  assert.match(resolveSpecBeats(spec({ beats: 7 }), dir).errors[0].message, /must be a path to a beats file/);
});

const MALFORMED = [
  ['not JSON', '{"beats": [0, 0.5', /data\/grid\.beats\.json is not valid JSON/],
  ['an array', '[0, 0.5]', /data\/grid\.beats\.json: must be an object like/],
  ['null', 'null', /data\/grid\.beats\.json: must be an object like/],
  ['no beats list', '{"bpm": 120}', /data\/grid\.beats\.json: "beats" must be an array of seconds/],
  ['beats not an array', '{"beats": "0,0.5"}', /"beats" must be an array of seconds/],
  ['an empty list', '{"beats": []}', /"beats" has no beats; list at least one/],
  ['a string beat', '{"beats": [0, "0.5"]}', /data\/grid\.beats\.json: beats\[1\] is "0\.5"; every beat is a number of seconds, 0 or more/],
  ['a negative beat', '{"beats": [-0.5, 0]}', /beats\[0\] is -0\.5; every beat is a number of seconds, 0 or more/],
  ['an infinite beat', '{"beats": [0, 1e999]}', /beats\[1\] is Infinity; every beat is a number of seconds, 0 or more/],
  ['a null beat', '{"beats": [0, null]}', /beats\[1\] is null/],
  ['beats out of order', '{"beats": [0, 1, 0.5]}', /beats\[2\] \(0\.5\) comes before beats\[1\] \(1\); list the beats in ascending order/],
  ['a string bpm', '{"bpm": "120", "beats": [0, 0.5]}', /"bpm" must be a number above 0/],
  ['a zero bpm', '{"bpm": 0, "beats": [0, 0.5]}', /"bpm" must be a number above 0/],
  ['a confidence over 1', '{"confidence": 2, "beats": [0, 0.5]}', /"confidence" must be a number from 0 to 1/],
  ['a string confidence', '{"confidence": "high", "beats": [0, 0.5]}', /"confidence" must be a number from 0 to 1/],
];

test('a malformed beats file is an error that names the file and the problem', () => {
  for (const [what, text, message] of MALFORMED) {
    const dir = folder(spec(), text);
    const { errors } = resolveSpecBeats(spec(), dir);
    assert.equal(errors?.length, 1, `${what}: ${JSON.stringify(errors)}`);
    assert.equal(errors[0].path, 'beats', what);
    assert.match(errors[0].message, message, what);
    assert.match(errors[0].message, /data\/grid\.beats\.json/, `${what} names the file`);
  }
});

test('a beats file has a length cap and a size cap', () => {
  const many = { beats: Array.from({ length: MAX_BEATS + 1 }, (_, i) => i) };
  assert.match(resolveSpecBeats(spec(), folder(spec(), many)).errors[0].message, new RegExp(`lists ${MAX_BEATS + 1} beats; at most ${MAX_BEATS}`));
  const exactly = { beats: Array.from({ length: MAX_BEATS }, (_, i) => i * 0.5) };
  assert.equal(resolveSpecBeats(spec({ cues: [] }), folder(spec({ cues: [] }), exactly)).errors, undefined);
  const huge = `{"beats":[0],"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`;
  assert.match(resolveSpecBeats(spec(), folder(spec(), huge)).errors[0].message, /data\/grid\.beats\.json is \d+ bytes; a beats file is at most \d+ bytes/);
});

test('a hostile key in a beats file is data: it neither pollutes anything nor reaches the spec', () => {
  const dir = folder(spec(), '{"__proto__": {"beats": [99]}, "constructor": 1, "beats": [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]}');
  const { spec: resolved, errors } = resolveSpecBeats(spec(), dir);
  assert.equal(errors, undefined);
  assert.equal(resolved.cues[0].at, 1.5);
  assert.equal({}.beats, undefined);
  assert.equal(Object.hasOwn(resolved, '__proto__'), false);
});

test('validateSpec reports a beats problem at its path, in the same shape as every other error', () => {
  const dir = folder(spec({ cues: [{ cue: 'pop', at: 'beat:40' }] }));
  const result = validateSpec(spec({ cues: [{ cue: 'pop', at: 'beat:40' }] }), { dir });
  assert.deepEqual(result, { ok: false, errors: [{ path: 'cues[0].at', message: 'beat:40 does not exist; the file has 16 beats' }] });
  const bad = validateSpec(spec(), { dir: folder(spec(), '{"beats": []}') });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, 'beats');
});

test('a var feeds a beat index: vars first, then beats; a row value that leaves the file is an error', () => {
  const motion = spec({ vars: { n: { type: 'number', default: 4 } }, cues: [{ cue: 'pop', at: 'beat:{{n}}' }] });
  const dir = folder(motion);
  assert.deepEqual(validateSpec(motion, { dir }), { ok: true, errors: [] });
  const row = validateSpec(motion, { dir, values: { n: 40 } });
  assert.deepEqual(row, { ok: false, errors: [{ path: 'cues[0].at', message: 'beat:40 does not exist; the file has 16 beats' }] });
});

test('a var may name the beats file, and the substituted path is contained like any other', () => {
  const motion = spec({ vars: { grid: { type: 'string', default: 'data/grid.beats.json' } }, beats: '{{grid}}' });
  const dir = folder(motion);
  assert.deepEqual(validateSpec(motion, { dir }), { ok: true, errors: [] });
  const escaped = validateSpec(motion, { dir, values: { grid: '../outside.json' } });
  assert.equal(escaped.ok, false);
  assert.deepEqual(escaped.errors, [{ path: 'beats', message: 'must stay inside the spec folder' }]);
});

test('the resolved spec feeds withDefaults: times are numbers, and the page needs no beat knowledge', () => {
  const dir = folder();
  const { spec: resolved } = resolveSpecBeats(spec(), dir);
  const full = withDefaults(resolved);
  assert.equal(JSON.stringify(full).includes('beat:'), false);
  assert.deepEqual(full.scenes[0].elements[0].keyframes.map((k) => k.t), [0.5, 1]);
});

test('viral mode never adds cues beside a beat-anchored user cue: a written cues list wins whole', () => {
  const viral = { mode: 'viral', beats: 'data/grid.beats.json', scenes: [
    { id: 'one', duration: 3, elements: [{ id: 'hook', type: 'text', role: 'title', text: 'Three word hook', x: 540, y: 500, keyframes: [{ t: 'beat:1', opacity: 0 }, { t: 'beat:2', opacity: 1 }] }] },
    { id: 'two', duration: 3, elements: [] },
  ], cues: [{ cue: 'pop', at: 'beat:2' }] };
  const dir = folder(viral);
  const { spec: resolved } = resolveSpecBeats(viral, dir);
  assert.deepEqual(withDefaults(resolved).cues, [{ cue: 'pop', at: 1 }]);
  const withoutCues = { ...viral, cues: undefined };
  const auto = withDefaults(resolveSpecBeats(withoutCues, dir).spec);
  assert.ok(auto.cues.length > 0, 'viral mode still derives its own cues when none are written');
  assert.deepEqual(auto.cues, autoCues(auto));
});

test('the preview server serves a spec that names a beats file resolved, and a spec without one byte for byte', async () => {
  const dir = folder();
  const server = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'preview' });
  try {
    const served = await (await fetch(`${server.url}spec.json`)).json();
    assert.equal(JSON.stringify(served).includes('beat:'), false);
    assert.equal(served.cues[0].at, 1.5);
    assert.equal(served.scenes[1].camera.keyframes[1].t, 1);
  } finally {
    await server.close();
  }
  const plainText = JSON.stringify({ scenes: [{ id: 's', duration: 2, elements: [] }], vars: { a: { type: 'string', default: 'x' } } });
  const plainDir = tmp();
  writeFileSync(path.join(plainDir, 'motion.json'), plainText);
  const plain = await startServer({ specPath: path.join(plainDir, 'motion.json'), mode: 'preview' });
  try {
    assert.equal(await (await fetch(`${plain.url}spec.json`)).text(), plainText);
  } finally {
    await plain.close();
  }
});

test('the preview server serves a beats-substituted spec: a var feeds the beat index there too', async () => {
  const motion = spec({ vars: { n: { type: 'number', default: 5 } }, cues: [{ cue: 'pop', at: 'beat:{{n}}' }] });
  const dir = folder(motion);
  const server = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'preview' });
  try {
    const served = await (await fetch(`${server.url}spec.json`)).json();
    assert.equal(served.cues[0].at, 2.5);
    assert.equal(Object.hasOwn(served, 'vars'), false);
  } finally {
    await server.close();
  }
});

test('the beats file is a file the server watches and serves, so an edit reloads the preview', async () => {
  const dir = folder();
  const server = await startServer({ specPath: path.join(dir, 'motion.json'), mode: 'preview' });
  try {
    const response = await fetch(`${server.url}assets/data/grid.beats.json`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).beats, GRID);
  } finally {
    await server.close();
  }
});

test('render --batch checks every row: a row whose var picks a beat that does not exist fails before anything renders', () => {
  const motion = spec({ vars: { n: { type: 'number', default: 4 } }, cues: [{ cue: 'pop', at: 'beat:{{n}}' }] });
  const dir = folder(motion);
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ n: 3 }, { n: 40 }]));
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), '--batch', path.join(dir, 'rows.json'), '--out', path.join(dir, 'out/{index}.mp4')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^row 1: cues\[0\]\.at: beat:40 does not exist; the file has 16 beats$/m);
  assert.doesNotMatch(r.stdout, /^row 0: /m);
  assert.match(r.stdout, /1 error; nothing rendered/);
  assert.equal(existsSync(path.join(dir, 'out')), false);
});

test('render --batch resolves each row after substitution: two rows with different beat indexes give different videos', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const motion = {
    size: [320, 180], fps: 30, beats: 'data/grid.beats.json', vars: { n: { type: 'number', default: 2 } },
    scenes: [{ id: 's', duration: 3, elements: [{ id: 'a', type: 'text', text: 'Hit', x: 160, y: 90, keyframes: [{ t: 0, opacity: 0 }, { t: 'beat:{{n}}', opacity: 1 }] }] }],
  };
  const dir = folder(motion);
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify([{ n: 1 }, { n: 5 }]));
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), '--batch', path.join(dir, 'rows.json'), '--out', path.join(dir, 'out/{index}.mp4'), ...SMALL], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1793318400' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'out/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rows.map((row) => row.status), ['ok', 'ok']);
  assert.notEqual(manifest.rows[0].sha256, manifest.rows[1].sha256, 'beat 1 and beat 5 are different moments');
});

test('check.mjs reads a spec through its beats: an out-of-scene beat is an error before any page opens', () => {
  const motion = spec({ audio: undefined, cues: [] });
  motion.scenes[1].elements[0].children[0].keyframes[1].t = 'beat:14'; // 7.0 s, scene two ends at 5.5 s
  const dir = folder(motion);
  const r = spawnSync(process.execPath, [CHECK, path.join(dir, 'motion.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /scenes\[1\]\.elements\[0\]\.children\[0\]\.keyframes\[1\]\.t: beat:14 is at 7\.0s, outside scene "two" \(4s to 5\.5s\)/);
});

test('check.mjs passes the example, whose beat-anchored times it reads resolved', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const r = spawnSync(process.execPath, [CHECK, EXAMPLE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
});

test('the example on-the-beat.json is anchored to its beats file and renders byte-identically twice', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  assert.equal(example.beats, 'data/on-the-beat.beats.json');
  assert.ok(JSON.stringify(example).includes('"beat:'), 'the example uses beat references');
  const beats = JSON.parse(readFileSync(path.join(root, 'references/examples', example.beats), 'utf8'));
  assert.ok(Math.abs(beats.bpm - 120) <= 1 && beats.beats.length >= 15);
  assert.deepEqual(validateSpec(example, { dir: path.dirname(EXAMPLE) }), { ok: true, errors: [] });
  await assertRendersIdentically(t, EXAMPLE, SMALL);
});

test('render --contact-sheet draws the example with its beats resolved', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const out = tmp();
  const r = spawnSync(process.execPath, [RENDER, EXAMPLE, '--contact-sheet', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(readdirSync(path.join(out, 'contact')).length >= 2);
});

test('render never overwrites the beats file it reads', async (t) => {
  const tools = await requireRender(t);
  if (!tools) return;
  const dir = folder();
  const grid = path.join(dir, 'data/grid.beats.json');
  const before = readFileSync(grid);
  const r = spawnSync(process.execPath, [RENDER, path.join(dir, 'motion.json'), '--out', grid], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--out: grid\.beats\.json is a file this render reads \(data\/grid\.beats\.json\)/);
  assert.deepEqual(readFileSync(grid), before);
});

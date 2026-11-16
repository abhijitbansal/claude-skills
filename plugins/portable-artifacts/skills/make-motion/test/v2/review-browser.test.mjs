// The review rules against the designed kinds: every example `--list kinds` prints, in both looks and both of 16:9 and
// 9:16, reviewed at the sheet moments, must come back with no finding at all. A kind that trips its own look's rules is
// a bug in the rule or in the kind. Also the number kind's stacked count and the "landed" rule. Run with
// --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listEntries } from '../../scripts/v2/list.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const COMBOS = Object.freeze([
  { mode: 'pro', look: 'desk', format: '16:9' },
  { mode: 'pro', look: 'desk', format: '9:16' },
  { mode: 'viral', look: 'pop', format: '16:9' },
  { mode: 'viral', look: 'pop', format: '9:16' },
  { mode: 'pro', look: 'cosmos', format: '16:9' },
  { mode: 'viral', look: 'cosmos', format: '9:16' },
]);

// A striped PNG, built by hand so a browser can decode it: a stand-in screenshot.
function stripedPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(Math.floor(y / 10) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-review-browser-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(640, 400));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

// The example shot with a device the look has (desk circles, pop underlines).
const exampleFor = (entry, look) => ({
  ...entry.example,
  ...(entry.example.on ? { on: entry.example.on.map((item) => ({ ...item, do: look === 'pop' ? 'underline' : item.do })) } : {}),
});

for (const { mode, look, format } of COMBOS) {
  for (const entry of listEntries('kinds')) {
    test(`the ${entry.name} example in ${look} at ${format} has no review finding`, async (t) => {
      const film = { version: 2, mode, look, format, fps: FPS, seed: 3, shots: [exampleFor(entry, look)] };
      const session = await open(t, film); if (!session) return;
      const findings = await reviewFilm({ session });
      // a kind that left out a secondary line to keep the look's minimum size says so (rule 'dropped', a look with a
      // secondary floor only): that is the kind working as designed, not a defect
      const kept = findings.filter((f) => !(f.rule === 'dropped' && look === 'cosmos'));
      assert.deepEqual(kept.map((f) => `${f.kind}: ${f.message}`), []);
      assert.deepEqual(session.errors, []);
    });
  }
}

// ---- the stacked count and "landed" ----

const keys = (...pairs) => ({ keys: pairs.map(([t, v]) => ({ t, v })) });
// Three words, the first two shown until 0.5 s and the last from then on: a count, as the number kind stacks it.
const countText = (x) => ({
  type: 'text', id: 'count',
  props: { x, y: 400, text: 'Alpha Bravo Omega', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 3000, fill: '#ffffff' },
  wordTracks: [
    { opacity: keys([0, 1], [0.5, 1], [0.51, 0]) },
    { opacity: keys([0, 1], [0.5, 1], [0.51, 0]) },
    { opacity: keys([0, 0], [0.5, 0], [0.51, 1]) },
  ],
});
const countFilm = (x) => ({ version: 2, fps: FPS, shots: [{ id: 'count', show: 'free', hold: 2, background: '#101820', nodes: [countText(x)] }] });

// node id -> the indices of its words at opacity 0 in a snapshot
function hiddenWordsIn(tree) {
  const hidden = new Map();
  const walk = (n) => {
    if (n.type === 'text' && Array.isArray(n.words)) hidden.set(n.id, new Set(n.words.flatMap((w, i) => (w.opacity === 0 ? [i] : []))));
    (n.children ?? []).forEach(walk);
  };
  tree.forEach(walk);
  return hidden;
}

// ---- final wave I1 and I2: the reviewer's free shots ----

const freeText = (props, wordTracks) => ({ type: 'text', id: 'edge', props: { y: 400, font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 3000, fill: '#ffffff', ...props }, ...(wordTracks ? { wordTracks } : {}) });
const freeFilm = (node) => ({ version: 2, fps: FPS, shots: [{ id: 'f', show: 'free', hold: 3, background: '#101820', nodes: [node] }] });

test('I2: a word shown for two seconds and gone at the end of its shot is judged while it shows: off the safe area, a finding', async (t) => {
  // "Inside Outside": the second word runs past the right safe edge, at opacity 1 at 0 s and 0 at 2 s of a 3 s shot
  const node = freeText({ x: 1500, text: 'Inside Outside' }, [{}, { opacity: keys([0, 1], [2, 0]) }]);
  const session = await open(t, freeFilm(node)); if (!session) return;
  const found = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.deepEqual(found.map((f) => [f.rule, f.node]), [['safe-area', 'edge']]);
});

test('I3: a text in the colour of its shot background is a contrast finding naming both colours; the page reports the background', async (t) => {
  const session = await open(t, freeFilm(freeText({ x: 300, text: 'Hidden', fill: '#152030' }))); if (!session) return;
  assert.deepEqual(session.info.backgrounds, ['#101820']);
  const found = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.deepEqual(found.map((f) => [f.rule, f.node]), [['contrast', 'edge']]);
  assert.match(found[0].message, /#152030 on #101820/);
});

test('I1: a text that never reaches full opacity, off the safe area, is reported as never settling', async (t) => {
  const session = await open(t, freeFilm(freeText({ x: -400, text: 'Faded', opacity: 0.9 }))); if (!session) return;
  const found = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.deepEqual(found.map((f) => [f.rule, f.node]), [['unsettled', 'edge']]);
  assert.match(found[0].message, /never settles within the shot/);
});

test('a stacked count is judged by the steps on screen: early steps off the safe area are a finding while they show, not after', async (t) => {
  // x = 10: "Alpha Bravo" are on screen, fully, until 0.5 s with "Alpha" outside the safe area (final wave I2: a word
  // visible on a sampled frame is judged there); from 0.51 s only "Omega", inside it, is shown
  const session = await open(t, countFilm(10)); if (!session) return;
  const found = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.deepEqual(found.map((f) => [f.rule, f.node, f.t]), [['safe-area', 'count', 0]], 'once, at the first frame the early steps show');
});

test('a stacked count whose final value is outside the safe area is a mechanical finding', async (t) => {
  const session = await open(t, countFilm(1500)); if (!session) return;
  const mechanical = (await reviewFilm({ session })).filter((f) => f.kind === 'mechanical');
  assert.equal(mechanical.length, 1);
  assert.equal(mechanical[0].rule, 'safe-area');
  assert.equal(mechanical[0].node, 'count');
});

test('the number kind keeps one word per digit of its value on screen at the end of the shot and hides every earlier step', async (t) => {
  const number = listEntries('kinds').find((e) => e.name === 'number').example;
  const session = await open(t, { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: FPS, seed: 3, shots: [number] }); if (!session) return;
  const last = await session.page.evaluate((i) => window.__snapshot(i), session.timeline.frameCount - 1);
  const hidden = hiddenWordsIn(last).get('rows.value.digits');
  const words = (function find(nodes) { return nodes.flatMap((n) => (n.id === 'rows.value.digits' ? [n] : find(n.children))); })(last)[0].words;
  const shown = words.flatMap((w, i) => (w.opacity === 1 ? [i] : []));
  assert.equal(shown.length, 3, '459 is three digits');
  assert.deepEqual([...hidden].sort((a, b) => a - b), words.map((_, i) => i).filter((i) => !shown.includes(i)), 'every other step is hidden');
  assert.ok(hidden.size >= 1);
});

// ---- the cut window ----

test('inside a cut window __snapshot has both shots and __snapshotShot only the incoming one', async (t) => {
  const box = (id, x) => ({ type: 'path', id, props: { d: 'M0 0H100V100H0Z', fill: '#fff', x, y: 100 } });
  const session = await open(t, { version: 2, fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2, nodes: [box('from', 100)] },
    { id: 'b', show: 'free', hold: 2, cut: 'slide', nodes: [box('into', 100)] },
  ] }); if (!session) return;
  const ids = (nodes) => nodes.map((n) => n.id).sort();
  const mixed = await session.page.evaluate((i) => window.__snapshot(i), 66); // 0.2 s into the 0.4 s slide
  const alone = await session.page.evaluate((i) => window.__snapshotShot(1, i), 66);
  // the default look does not smear (look data, smear): one copy of each shot
  assert.deepEqual(ids(mixed), ['from', 'into']);
  assert.deepEqual(ids(alone), ['into']);
  assert.deepEqual(alone[0].bbox, [100, 100, 100, 100], 'where the shot puts it, not slid across the frame');
});

test('a text of the incoming shot outside the safe area is found although it only ever shows inside the cut window of its shot', async (t) => {
  const text = (id, x) => ({ type: 'text', id, props: { x, y: 400, text: 'Edge', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 900, fill: '#ffffff' } });
  const session = await open(t, { version: 2, fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2, nodes: [text('fine', 300)] },
    { id: 'b', show: 'free', hold: 1, cut: 'slide', nodes: [text('edge', 10)] },
  ] }); if (!session) return;
  const found = await reviewFilm({ session });
  assert.deepEqual(found.filter((f) => f.kind === 'mechanical').map((f) => [f.shot, f.node, f.path]), [['b', 'edge', 'shots[1]']]);
});

// look gate fix pass, review-rev2 I3: a punch's frames are audited as drawn, so a pinned overlay under the picture shows
test('a pop clipping with a kicker tag arriving on a punch keeps the tag over the picture on every audited frame of the cut', async (t) => {
  const film = { version: 2, mode: 'viral', look: 'pop', format: '9:16', fps: FPS, seed: 7, shots: [
    { id: 'hook', show: 'statement', say: 'Your charts are *hiding* something.' },
    { id: 'proof', show: 'clipping', cut: 'punch', src: 'assets/screenshot.png', kicker: 'The proof', caption: 'See it.', hold: 3 },
  ] };
  const session = await open(t, film); if (!session) return;
  const found = await reviewFilm({ session });
  assert.deepEqual(found.filter((f) => f.rule === 'covered' || f.rule === 'empty-first-frame').map((f) => `${f.rule}: ${f.message}`), []);
});

test('a pinned text over a picture that is whole when a punch arrives stays over it through the cut, and the audit would see it under the picture', async (t) => {
  // a picture at full size from frame 0 and a text pinned to the frame (props.fixed) drawn over it
  const pinnedOver = { id: 'b', show: 'free', cut: 'punch', hold: 2, srcs: ['assets/screenshot.png'], nodes: [
    { type: 'image', id: 'pic', props: { src: 'assets/screenshot.png', x: 160, y: 140, w: 1600, h: 800 } },
    { type: 'text', id: 'pinned', props: { x: 400, y: 500, text: 'Pinned', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 900, fill: '#ffffff', fixed: true } },
  ] };
  const film = { version: 2, fps: FPS, shots: [{ id: 'a', show: 'free', hold: 1, nodes: [{ type: 'path', id: 'box', props: { d: 'M0 0H100V100H0Z', fill: '#fff', x: 100, y: 100 } }] }, pinnedOver] };
  const session = await open(t, film); if (!session) return;
  const found = await reviewFilm({ session });
  assert.deepEqual(found.filter((f) => f.rule === 'covered').map((f) => f.message), []);
  // the same text drawn first is under the picture on the cut's frames and is found
  const under = { ...pinnedOver, nodes: [pinnedOver.nodes[1], pinnedOver.nodes[0]] };
  const bad = await open(t, { ...film, shots: [film.shots[0], under] }); if (!bad) return;
  const covered = (await reviewFilm({ session: bad })).filter((f) => f.rule === 'covered');
  assert.equal(covered.length, 1, JSON.stringify(covered));
  assert.equal(covered[0].node, 'pinned|pic');
});

// ---- the director's round 1 ----

test('a region event that comes before the whole picture has been shown is a creative finding at shots[i].on[j], and the event is moved', async (t) => {
  const clip = (at) => ({ id: 'c', show: 'clipping', src: 'assets/screenshot.png', say: 'This one shows the query behind every chart on the page today.', regions: { r: [0.1, 0.1, 0.3, 0.3] }, on: [{ at, do: 'circle', target: 'region:r' }] });
  const session = await open(t, { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: FPS, seed: 3, shots: [clip('word:query')] }); if (!session) return;
  const early = (await reviewFilm({ session })).filter((f) => f.rule === 'kind');
  assert.equal(early.length, 1);
  assert.deepEqual([early[0].kind, early[0].shot, early[0].path], ['creative', 'c', 'shots[0].on[0]']);
  assert.match(early[0].message, /too early to show the whole picture first/);
  const ok = await open(t, { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: FPS, seed: 3, shots: [clip(2.5)] }); if (!ok) return;
  assert.deepEqual((await reviewFilm({ session: ok })).filter((f) => f.rule === 'kind'), []);
});

test('every frame of a pop statement pulse and entrance has no word meeting its neighbour, in the page as it is drawn', async (t) => {
  const film = { version: 2, mode: 'viral', look: 'pop', format: '9:16', fps: FPS, seed: 7, shots: [
    { id: 'hook', show: 'statement', say: 'Your charts are *hiding* something.' },
    { id: 'local', show: 'statement', cut: 'punch', say: 'No cloud. No account. *No upload*.' },
  ] };
  const session = await open(t, film); if (!session) return;
  const found = await reviewFilm({ session });
  assert.deepEqual(found.filter((f) => f.rule === 'word-overlap' || f.rule === 'hook' || f.rule === 'overflow'), []);
  // every frame, not only the sampled ones
  const worst = await session.page.evaluate((count) => {
    let worstOverlap = -Infinity;
    for (let i = 0; i < count; i++) {
      const walk = (n) => {
        if (n.type === 'text' && n.layout) {
          for (const line of n.layout.lines) {
            const spans = line.words.filter((w) => (n.words?.[w.index]?.opacity ?? 1) > 0).map((w) => {
              const tr = n.words?.[w.index] ?? { x: 0, scale: 1 };
              const half = (w.width * Math.abs(tr.scale)) / 2, centre = line.x + w.x + w.width / 2 + tr.x;
              return [centre - half, centre + half];
            }).sort((a, b) => a[0] - b[0]);
            spans.slice(1).forEach((s, k) => { worstOverlap = Math.max(worstOverlap, spans[k][1] - s[0]); });
          }
        }
        (n.children ?? []).forEach(walk);
      };
      window.__snapshot(i).forEach(walk);
    }
    return worstOverlap;
  }, session.timeline.frameCount);
  assert.ok(worst <= 0.5, `the closest two words come within ${worst} px of each other`);
});

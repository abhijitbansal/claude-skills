// The poster gate's 9:16 viral film (gate-poster-tall, render 1): its three findings, as node tests. (1) A six-word viral
// hook wraps by words (look.stack.hookWrap) so the row that holds the emphasis is as short as the sense allows and takes
// the large size; (2) the frame review measures a quarter-turned text's ink along its true axes (a turned list item's
// glyph overhang along the line is not read as across it, and a turned line past the safe edge along its length is
// reported); (3) a feed whose narration has more sentences than messages lands each message on the spoken word that
// begins it, so a two-message thread does not hold one message for the whole narration. The real-glyph checks of (1) and
// (2) are in poster-viral-gate-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { feedTimes } from '../../engine/kinds/feed-layout.mjs';
import { latestLanding } from '../../engine/kinds/arrivals.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { snapshotOf } from './helpers/bar.mjs';
import { filmOf, filmFor, all, FPS } from './helpers/kinds.mjs';

const LOOK = 'poster';
const HOOK = Object.freeze({ id: 'hook', show: 'statement', say: 'Write the *script*. Get the film.' });
const SAMPLE_AT = 0.5;

// ---- (1) the long viral hook ----

function hookLines(shot) {
  const built = filmFor([shot], LOOK, '9:16', { mode: 'viral' });
  return all(snapshotOf(built.sampleShot(0, SAMPLE_AT))).filter((n) => n.type === 'text' && n.props.stack === `${shot.id}.text`);
}
const rowText = (n) => n.props.layout.lines[0].words.map((w) => w.text).join(' ');

test('poster: a six-word viral hook wraps by words, the emphasis on a row of its own that takes the large size', () => {
  const lines = hookLines(HOOK);
  const rows = lines.map(rowText);
  assert.ok(lines.length >= 3, `rows: ${rows.join(' / ')}`);
  assert.ok(lines.every((n) => (n.rotate ?? 0) === 0), 'upright (the lead ruling: the hook never turns)');
  const lead = rows.findIndex((r) => r.includes('SCRIPT'));
  assert.equal(rows[lead], 'THE SCRIPT.', `the emphasised row holds only what its sense needs: ${rows.join(' / ')}`);
  const sizes = lines.map((n) => n.props.font.size);
  sizes.forEach((s, k) => k !== lead && assert.ok(sizes[lead] > s, `sizes ${sizes.map((v) => v.toFixed(1))}: the emphasised row is the largest`));
});

test('poster: the wrapped hook keeps its words in order and ends no row on a weak word', () => {
  const rows = hookLines(HOOK).map(rowText);
  assert.equal(rows.join(' '), 'WRITE THE SCRIPT. GET THE FILM.');
  for (const row of rows.slice(0, -1)) assert.notEqual(row.split(' ').at(-1), 'THE', `row "${row}" ends on an article`);
});

test('pop (no stack.hookWrap): a six-word viral hook keeps its own two rows', () => {
  assert.equal(registries.looks.get('pop').stack.hookWrap, undefined);
  const built = filmFor([HOOK], 'pop', '9:16', { mode: 'viral' });
  const rows = all(snapshotOf(built.sampleShot(0, SAMPLE_AT))).filter((n) => n.type === 'text' && n.props.stack === 'hook.text');
  assert.equal(rows.length, 2);
});

// ---- (2) the ink of a quarter-turned text ----

const CANVAS = { w: 1080, h: 1920 };
const viralCtx = () => {
  const look = registries.looks.get(LOOK);
  return { look, canvas: CANVAS, mode: 'viral', shotId: 'how', shotIndex: 1, t: 6, safe: safeRectFor(CANVAS, look, registries.modes.get('viral')) };
};
// A turned line as annotate() reports it (the numbers of render 1's "MP4", measured in the browser): the layout 553.1 x
// 382 at 351.3 px, its ascent box 300 px over the baseline, turned -90 degrees about its top-left corner at (x, y); its
// glyphs reach 245.9 px over the baseline and end 3.5 px past the advance (the 4's overhang).
const ADVANCE = 553.1, THICK = 382, ASCENT = 300, SIZE = 351.3;
function turnedLine({ x = 502, y = 1497.6 } = {}) {
  return {
    type: 'text', id: 'how.item2.text.line1', depth: 0, props: { role: 'hero' }, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: -90, opacity: 1, visible: true, children: [],
    words: [{ opacity: 1, x: 0, y: 0, scale: 1 }],
    layout: { size: SIZE, width: ADVANCE, height: THICK, overflow: false, lines: [{ x: 0, y: ASCENT, width: ADVANCE, words: [{ text: 'MP4', index: 0, x: 0, width: ADVANCE }] }] },
    lineInk: [{ ascent: 245.9, descent: 0, words: [{ left: 14.2, right: 556.6 }] }],
    bbox: [x, y - ADVANCE, THICK, ADVANCE], spread: 0,
  };
}
const safeFindings = (n) => auditFrame([n], viralCtx()).filter((f) => f.rule === 'safe-area');

test('review: a turned line whose ink lies inside the safe area is not reported, though its glyphs overhang the advance', () => {
  const ctx = viralCtx();
  const n = turnedLine();
  assert.ok(n.bbox[0] + n.bbox[2] <= ctx.safe.right && n.bbox[1] + n.bbox[3] <= ctx.safe.bottom + 1e-9, 'the layout box is inside');
  assert.deepEqual(safeFindings(n), []);
});

test('review: a turned line past the safe right edge is reported', () => {
  assert.equal(safeFindings(turnedLine({ x: 602 })).length, 1);
});

test('review: a turned line past the safe bottom along its length is reported', () => {
  // the line moved 30 px down: its ink (from 14.2 px along the line) ends about 16 px under the safe bottom; its glyphs
  // end inside the advance here, so no overhang across the frame can report it instead
  const n = turnedLine({ y: 1527.6 });
  assert.equal(safeFindings({ ...n, lineInk: [{ ...n.lineInk[0], words: [{ left: 14.2, right: 540 }] }] }).length, 1);
});

test('review: an upright text is measured as before (the turn changes nothing at rotate 0)', () => {
  const upright = { ...turnedLine(), rotate: 0, x: 120, y: 600, bbox: [120, 600, ADVANCE, THICK] };
  assert.deepEqual(safeFindings(upright), []);
  assert.equal(safeFindings({ ...upright, x: 400, bbox: [400, 600, ADVANCE, THICK] }).length, 1);
});

// ---- (3) a feed with more sentences than messages ----

const CHAT = Object.freeze({
  id: 'chat', show: 'feed', title: 'Studio',
  items: [{ from: 'them', text: 'Is the film ready?' }, { from: 'me', text: 'One command. It is rendering.' }],
  say: 'Is the film ready? One command. It is rendering.',
});
const FIRST = Object.freeze({ id: 'first', show: 'statement', say: 'Write the script.' });
const chatTiming = () => buildTimeline(filmOf([FIRST, CHAT], LOOK, '9:16', { mode: 'viral' }), { fps: FPS }).shots[1];

test('feed: with more sentences than messages, each message lands on the spoken word that begins it', () => {
  const timing = chatTiming();
  assert.equal(timing.sentences.length, 3);
  const one = timing.words.find((w) => w.text === 'One');
  assert.deepEqual(registries.kinds.get('feed').arrivals(CHAT, timing), [0, one.start]);
});

test('feed: the message cue sounds when the message lands (one timing for picture and sound)', () => {
  const timing = chatTiming();
  const one = timing.words.find((w) => w.text === 'One');
  assert.deepEqual(registries.kinds.get('feed').events(CHAT, timing), [{ kind: 'device', device: 'message', t: one.start }]);
});

test('feed: a message whose first word is never spoken keeps the even spacing', () => {
  const timing = chatTiming();
  const end = Math.min(latestLanding(timing), timing.words.at(-1).end);
  assert.deepEqual(feedTimes(2, timing, latestLanding(timing), ['Is the film ready?', 'Unsaid words here.']), [0, end]);
});

test('feed: one message per sentence is unchanged (the counts match)', () => {
  const timing = { duration: 6, sentences: [{ start: 0 }, { start: 2.4 }, { start: 4.2 }], words: [{ text: 'a', start: 0, end: 5 }] };
  assert.deepEqual(feedTimes(3, timing, 6.4, ['x', 'y', 'z']), [0, 2.4, 4.2]);
});

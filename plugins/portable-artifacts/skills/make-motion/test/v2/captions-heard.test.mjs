// Caption word highlights on heard time (branch review A, I2): a word is lit when it is heard (soundStart, soundEnd),
// in every caption style, including the first word of a shot, which the timeline shows from the shot's first frame
// (start 0) while its sound comes after the voice's lead-in or an opening pause.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/captions/index.mjs';
import { groupTimes, heardStart, heardEnd, fitGroup } from '../../engine/captions/groups.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sample } from '../../engine/time/track.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { FPS, measure, canvasOf, viralOf, filmOf, IMAGES, centredPop } from './helpers/kinds.mjs';

const LEAD = 1; // seconds of opening pause before the first word is heard
// A shot's words as the timeline gives them after a lead-in: the first shown from 0, every one heard LEAD later.
const heardWords = (line, emphasised = []) => line.split(' ').map((text, i) => {
  const soundStart = LEAD + 0.3 * i, soundEnd = soundStart + 0.25;
  return { text, start: i === 0 ? 0 : soundStart, end: soundEnd, soundStart, soundEnd, emphasis: emphasised.includes(i), aside: false };
});
const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children)]);

function composeWith(style, look, format, words) {
  const film = filmOf([{ id: 'm', show: 'clipping', src: 'shot.png', say: words.map((w) => w.text).join(' ') }], look, format, { captions: true, mode: look === 'pop' ? 'viral' : 'pro' });
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  return registries.captions.get(style).compose(words, { ...ctx, captionId: 'm.captions', hero: null, filmStart: 0, avoid: [], marks: [] });
}

// The fill track of the first word of the first caption text.
const firstFill = (nodes) => allNodes(nodes).find((n) => n.type === 'text' && n.props.caption).wordTracks[0].fill;

test('heardStart and heardEnd read the sound times, and fall back to the shown times for words that have none', () => {
  const [first] = heardWords('Every chart.');
  assert.deepEqual([heardStart(first), heardEnd(first)], [LEAD, LEAD + 0.25]);
  assert.deepEqual([heardStart({ start: 2, end: 3 }), heardEnd({ start: 2, end: 3 })], [2, 3]);
});

for (const [style, look, format] of [['pill', 'cosmos', '16:9'], ['stack', 'pop', '9:16']]) {
  test(`${style}: the shot's first word is lit when it is heard, not on the shot's first frame`, () => {
    const words = heardWords('Every chart shows its query.');
    const fill = firstFill(composeWith(style, look, format, words));
    const { ink, accent } = registries.looks.get(look).palette;
    assert.equal(sample(fill, LEAD / 2), ink, 'in ink through the opening pause');
    assert.equal(sample(fill, LEAD + 0.05), accent, 'in the accent once heard');
    assert.equal(sample(fill, LEAD + 0.4), ink, 'back to ink once the next word is heard');
  });
}

test('lower: a highlighter band on the shot\'s first word starts drawing when the word is heard', () => {
  const words = heardWords('It shows the query.', [0]);
  const group = allNodes(composeWith('lower', 'desk', '16:9', words)).find((n) => n.id === 'm.captions.0');
  const band = group.children.find((n) => n.type === 'path');
  assert.equal(sample(band.tracks.reveal, LEAD / 2, band.step), 0, 'not drawn through the opening pause');
  assert.ok(sample(band.tracks.reveal, LEAD + 0.15, band.step) > 0, 'drawing once heard');
});

test('lower in a look that recolours: the emphasised first word turns accent when heard', () => {
  const look = registries.looks.get('desk');
  if (!registries.looks.has('desk-recolor-test')) registries.looks.add('desk-recolor-test', { ...look, name: 'desk-recolor-test', emphasis: 'recolor' });
  const words = heardWords('It shows the query.', [0]);
  const fill = firstFill(composeWith('lower', 'desk-recolor-test', '16:9', words));
  assert.equal(sample(fill, LEAD / 2), look.palette.ink);
  assert.equal(sample(fill, LEAD + 0.05), look.palette.accent);
});

test('stack in a look whose emphasis scales: an emphasised first word pops when it is heard, not on the shot\'s first frame', () => {
  const look = centredPop();
  const words = heardWords('Everything stays here.', [0]);
  const scale = allNodes(composeWith('stack', look, '9:16', words)).find((n) => n.type === 'text' && n.props.caption).wordTracks[0].scale;
  assert.equal(sample(scale, LEAD / 2), 1, 'at rest through the opening pause');
  assert.ok(Math.max(...[0.05, 0.1, 0.15, 0.2].map((d) => sample(scale, LEAD + d))) > 1.05, 'popping once heard');
});

// Group visibility stays on shown time: the first group is on screen from the shot's first frame (the reviewer's "showing
// the group from frame 0 is fine"), and a group leaves when the next one comes on, so the two never overlap. Past a shot's
// first word, shown and heard times are the same.
test('groupTimes: a group shows from its first shown word and leaves when the next group shows, or by its last word\'s end', () => {
  const words = heardWords('One two three four.');
  const groups = [{ words: words.slice(0, 2) }, { words: words.slice(2) }];
  const times = groupTimes(groups, { duration: 5, fps: FPS });
  assert.equal(times[0].at, 0, 'the first group is on screen from the shot\'s first frame');
  assert.equal(times[0].until, heardStart(words[2]));
  assert.equal(times[1].end, heardEnd(words[3]));
});

// The groups' fit (branch review A, Minor 14): a size of 0 or less would lay out thousands of times before it underflowed.
test('fitGroup refuses a size or a minimum that is not a positive number of px, before any layout', () => {
  const setAt = () => assert.fail('no layout may run');
  for (const [size, min] of [[0, 10], [40, -1], [Number.NaN, 10], [40, Infinity]]) {
    assert.throws(() => fitGroup(setAt, () => false, size, min), /fitGroup: size and min must be positive numbers of px/, `${size}, ${min}`);
  }
});

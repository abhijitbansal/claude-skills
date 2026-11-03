// Task 26 (second half): chat-thread, timeline, testimonial and the three lower thirds. The table-driven suite in
// blocks.test.mjs covers every block; this file holds what only these six say: where a lower third goes, what a ticker's
// speed means, how a thread orders its dots, when a timeline turns into a column, what an avatar must be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, BLOCK_NAMES, expandBlocks, blockAssetFiles } from '../template/blocks/index.mjs';
import { LAST_MOTION_SHARE } from '../template/blocks/layout.mjs';
import { safeMargin, captionZone, FORMATS, FORMAT_NAMES } from '../template/formats.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(root, 'references/examples/blocks');
const EPSILON = 1e-9;
const PROSE = 'Every release ships faster when the builds stay local and the checks run before review starts';
const prose = (n) => PROSE.repeat(Math.ceil(n / PROSE.length) + 1).slice(0, n).trimEnd();

const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 540, block: name, params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const errs = (motion) => validateSpec(motion, { dir: EXAMPLES }).errors.map((e) => `${e.path}: ${e.message}`);
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');
const part = (spec, id) => partsOf(spec).find((el) => el.id === `b/${id}`);

test('the six blocks are registered, after race, in the order the plan lists them', () => {
  const six = ['chat-thread', 'timeline', 'testimonial', 'lower-third-tag', 'lower-third-social', 'lower-third-ticker'];
  assert.deepEqual(BLOCK_NAMES.filter((name) => six.includes(name)), six);
});

// ---- the lower thirds ----------------------------------------------------------------------------------------------------

const bounds = (spec, x, y) => partsOf(spec).filter((el) => el.type === 'shape')
  .map((el) => ({ id: el.id, top: y + el.y - el.height / 2, bottom: y + el.y + el.height / 2, left: x + el.x - el.width / 2, right: x + el.x + el.width / 2 }));

test('lower-third-tag and lower-third-social at their place() keep every card and chip above the caption zone and inside the safe area, at every format, with 80-character strings', () => {
  const longest = { 'lower-third-tag': { name: prose(80), tag: prose(80) }, 'lower-third-social': { handle: prose(80), platform: 'instagram' } };
  for (const [name, params] of Object.entries(longest)) {
    for (const format of FORMAT_NAMES) {
      const size = FORMATS[format].size;
      const zone = captionZone(size, format);
      const m = safeMargin(size);
      const { x, y } = BLOCKS[name].place(size, format);
      for (const box of bounds(expandBlocks(oneScene([block(name, params, { x, y })], { format })), x, y)) {
        const where = `${name} ${format} ${box.id}`;
        assert.ok(box.bottom <= zone.top, `${where}: bottom ${box.bottom} reaches the caption zone at ${zone.top}`);
        assert.ok(box.top >= m && box.left >= m && box.right <= size[0] - m, `${where}: ${JSON.stringify(box)} leaves the safe area`);
      }
    }
  }
});

test('lower-third-tag puts the chip on the card\'s top edge and lower-third-social names the platform in plain text, never a logo', () => {
  const tag = expandBlocks(oneScene([block('lower-third-tag', { name: 'Ada', tag: 'LIVE' })]));
  const card = part(tag, 'card');
  const chip = part(tag, 'chip');
  assert.equal(chip.y + chip.height / 2, card.y - card.height / 2, 'the chip sits on the card');
  assert.equal(part(tag, 'tag').text, 'LIVE');
  const labels = { x: 'X', github: 'GitHub', linkedin: 'LinkedIn', youtube: 'YouTube', instagram: 'Instagram' };
  for (const [platform, label] of Object.entries(labels)) {
    const social = expandBlocks(oneScene([block('lower-third-social', { handle: '@ada', platform })]));
    assert.equal(part(social, 'platform').text, label);
    assert.equal(part(social, 'handle').text, '@ada');
    assert.ok(partsOf(social).every((el) => el.type !== 'image'), `${platform}: no logo image`);
  }
  assert.deepEqual(errs(oneScene([block('lower-third-social', { handle: '@ada', platform: 'mastodon' })])), ['scenes[0].elements[0].params.platform: must be one of "x", "github", "linkedin", "youtube", "instagram"']);
});

// ---- the ticker ----------------------------------------------------------------------------------------------------------

const crawlSpeed = (el) => {
  const xs = el.keyframes.filter((kf) => kf.x !== undefined);
  return (xs[0].x - xs.at(-1).x) / (xs.at(-1).t - xs[0].t);
};

test('lower-third-ticker crawls every item left by `speed` px per second (80 by default) on a linear x track', () => {
  const items = ['One thing', 'Another thing', 'A third thing'];
  const defaults = partsOf(expandBlocks(oneScene([block('lower-third-ticker', { items })], {}, 8)));
  for (const el of defaults.filter((p) => /\/(item|sep)-/.test(p.id))) {
    assert.ok(Math.abs(crawlSpeed(el) - 80) < 0.5, `${el.id} crawls at ${crawlSpeed(el)} px/s`);
    const track = el.keyframes.filter((kf) => kf.x !== undefined);
    assert.equal(track.length, 2, `${el.id}: one straight run`);
    assert.equal(track[1].ease, undefined, `${el.id}: linear`);
  }
  const fast = partsOf(expandBlocks(oneScene([block('lower-third-ticker', { items, speed: 200 })], {}, 8)));
  assert.ok(Math.abs(crawlSpeed(fast.find((p) => p.id === 'b/item-1')) - 200) < 0.5);
  assert.deepEqual(errs(oneScene([block('lower-third-ticker', { items, speed: 5 })])), ['scenes[0].elements[0].params.speed: must be >= 10']);
});

test('lower-third-ticker spans the frame whatever its x, and its items end faded out by 85 % of the scene, so no text rests outside the safe area (the band stays)', () => {
  for (const x of [100, 960, 1700]) {
    const spec = expandBlocks(oneScene([block('lower-third-ticker', { items: ['A', 'B'] }, { x })], {}, 5));
    const band = part(spec, 'band');
    assert.ok(x + band.x - band.width / 2 <= 0.5 && x + band.x + band.width / 2 >= 1919.5, `x ${x}: the band covers 0..1920`);
    for (const el of partsOf(spec)) {
      const last = el.keyframes.at(-1);
      assert.ok(last.t <= LAST_MOTION_SHARE * 5 + EPSILON, `${el.id} is still moving at ${last.t} s`);
      assert.equal(last.opacity, /\/(band|rule)$/.test(el.id) ? 1 : 0, `${el.id} ends ${/\/(band|rule)$/.test(el.id) ? 'visible' : 'invisible'}`);
    }
  }
});

// ---- the chat thread -----------------------------------------------------------------------------------------------------

const THREAD = [{ from: 'them', text: 'Ready?' }, { from: 'me', text: 'Ready.' }, { from: 'them', text: 'Go.' }];

test('chat-thread puts "me" on the right in accent and "them" on the left in surface', () => {
  const spec = expandBlocks(oneScene([block('chat-thread', { messages: THREAD })]));
  assert.ok(part(spec, 'bubble-1').x < 0 && part(spec, 'bubble-2').x > 0 && part(spec, 'bubble-3').x < 0);
  assert.deepEqual([1, 2, 3].map((k) => part(spec, `bubble-${k}`).fill), ['surface', 'accent', 'surface']);
  assert.deepEqual([1, 2, 3].map((k) => part(spec, `text-${k}`).color), ['text', 'surface', 'text']);
});

test('chat-thread draws typing dots only with typingDots, only before "them" messages, and they are gone before the message starts to come in', () => {
  const ids = (params) => partsOf(expandBlocks(oneScene([block('chat-thread', params)], {}, 10))).map((el) => el.id.slice(2));
  assert.deepEqual(ids({ messages: THREAD }).filter((id) => id.startsWith('typing')), []);
  assert.deepEqual(ids({ messages: THREAD, typingDots: false }).filter((id) => id.startsWith('typing')), []);
  const typing = ids({ messages: THREAD, typingDots: true }).filter((id) => id.startsWith('typing'));
  assert.deepEqual([...new Set(typing.map((id) => id.split('-')[1]))], ['1', '3'], 'before messages 1 and 3 (them), not 2 (me)');
  const spec = expandBlocks(oneScene([block('chat-thread', { messages: THREAD, typingDots: true })], {}, 10));
  for (const k of ['1', '3']) {
    const goneAt = part(spec, `typing-${k}`).keyframes.at(-1).t;
    const cameAt = part(spec, `bubble-${k}`).keyframes.find((kf) => kf.opacity === 0).t;
    assert.ok(goneAt <= cameAt + EPSILON, `message ${k}: dots gone at ${goneAt} s, message starts at ${cameAt} s`);
  }
});

test('chat-thread: eight 160-character messages grow upward from the band floor, never past it, at every format', () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ from: i % 2 ? 'me' : 'them', text: prose(160) }));
  for (const format of FORMAT_NAMES) {
    const size = FORMATS[format].size;
    const { x, y } = BLOCKS['chat-thread'].place(size, format);
    const floor = captionZone(size, format).top;
    const spec = expandBlocks(oneScene([block('chat-thread', { messages }, { x, y })], { format, captions: [{ src: 'c.srt' }] }));
    const lowest = Math.max(...bounds(spec, x, y).map((box) => box.bottom));
    assert.ok(lowest <= floor, `${format}: lowest bubble edge ${lowest} is below the caption zone at ${floor}`);
  }
});

// ---- the timeline --------------------------------------------------------------------------------------------------------

const EVENTS = [{ when: '2023', what: 'Prototype' }, { when: '2024', what: 'Beta' }, { when: '2025', what: 'Launch' }];
const dots = (spec, n) => Array.from({ length: n }, (_, i) => part(spec, `dot-${i + 1}`));

test('timeline is a row on a wide canvas and a column on a tall one, and `direction` overrides either', () => {
  const row = dots(expandBlocks(oneScene([block('timeline', { events: EVENTS })])), 3);
  assert.ok(row.every((d) => d.y === row[0].y) && row[0].x < row[1].x, 'dots in a row on 16:9');
  const column = dots(expandBlocks(oneScene([block('timeline', { events: EVENTS }, { x: 540, y: 960 })], { format: '9:16' })), 3);
  assert.ok(column.every((d) => d.x === column[0].x) && column[0].y < column[1].y, 'dots in a column on 9:16');
  const forced = dots(expandBlocks(oneScene([block('timeline', { events: EVENTS, direction: 'column' })])), 3);
  assert.ok(forced.every((d) => d.x === forced[0].x), 'column forced on 16:9');
  const wide = dots(expandBlocks(oneScene([block('timeline', { events: EVENTS, direction: 'row' }, { x: 540, y: 960 })], { format: '9:16' })), 3);
  assert.ok(wide.every((d) => d.y === wide[0].y), 'row forced on 9:16 (three short events fit 1080)');
});

test('timeline falls back to a column when a word cannot fit its slice of a row, as step-flow does', () => {
  const events = Array.from({ length: 8 }, (_, i) => ({ when: `Phase ${i + 1}`, what: 'Internationalisation' }));
  const spec = dots(expandBlocks(oneScene([block('timeline', { events, direction: 'row' })])), 8);
  assert.ok(spec.every((d) => d.x === spec[0].x), 'a column');
});

// ---- the testimonial -----------------------------------------------------------------------------------------------------

test('testimonial shows its avatar as a square cover image only when given one, and checks the file like an image src', () => {
  const params = { quote: 'It works.', name: 'Priya Raman', role: 'Lead' };
  assert.ok(!partsOf(expandBlocks(oneScene([block('testimonial', params)]))).some((el) => el.type === 'image'), 'no avatar, no image');
  const withAvatar = expandBlocks(oneScene([block('testimonial', { ...params, avatar: 'avatar.svg' })]));
  const image = part(withAvatar, 'avatar');
  assert.deepEqual([image.type, image.src, image.fit, image.width === image.height], ['image', 'avatar.svg', 'cover', true]);
  assert.deepEqual(blockAssetFiles(block('testimonial', { ...params, avatar: 'avatar.svg' })), [{ at: 'avatar', src: 'avatar.svg' }]);
  assert.deepEqual(blockAssetFiles(block('testimonial', params)), []);
  assert.deepEqual(errs(oneScene([block('testimonial', { ...params, avatar: 'nope.png' })])), ['scenes[0].elements[0].params.avatar: file not found: nope.png']);
  assert.deepEqual(errs(oneScene([block('testimonial', { ...params, avatar: '../x.png' })])), ['scenes[0].elements[0].params.avatar: must stay inside the spec folder']);
  assert.deepEqual(errs(oneScene([block('testimonial', { ...params, avatar: 'avatar.svg' })])), []);
});

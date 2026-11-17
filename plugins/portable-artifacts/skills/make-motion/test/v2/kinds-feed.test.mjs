// The `feed` kind (plan 2026-11-16-pa2-shot-kinds-b, Task 9): a chat thread or notifications, two to six items, one text
// size, one item per sentence, typing dots before a `them` reply, scroll-off keeping the newest whole inside the room,
// the newest notification on top, the 90-character limit, and the bar in both looks and formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { roomOf } from '../../engine/kinds/arrivals.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';
import { assertBar } from './helpers/bar.mjs';

const feed = registries.kinds.get('feed');
const look = (name) => registries.looks.get(name);
const expand = (shot, lookName = 'desk', format = '16:9') => expandIn(filmOf([shot], lookName, format));
const errorsOf = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir: '.' }).errors;
const find = (out, id) => all(out.nodes).find((n) => n.id === id);
const opacity = (n, t) => (n.tracks.opacity ? sample(n.tracks.opacity, t) : 1);
const CHAT = (items, extra = {}) => ({ id: 'f', show: 'feed', items, ...extra });
const FOUR = [{ from: 'them', text: 'Ready?' }, { from: 'me', text: 'Almost.' }, { from: 'them', text: 'Send it.' }, { from: 'me', text: 'Sent.' }];
const LONG = 'This message is ninety characters long, which is the most a feed item may carry in a shot.';
const NOTES = [{ app: 'Mail', text: 'Your invoice is ready' }, { app: 'Calendar', text: 'Standup in ten minutes' }, { app: 'Mail', text: 'Two new replies' }];

// ---- timing ----

test('timing: one item per sentence when the counts match; evenly otherwise; evenly with hold; the first at 0', () => {
  const s = CHAT(FOUR, { say: 'Ready? Almost. Send it. Sent.' });
  const so = expand(s);
  assert.deepEqual(feed.arrivals(s, so.timing), so.timing.sentences.map((x, k) => (k === 0 ? 0 : x.start)));
  const h = CHAT(FOUR, { hold: 4 });
  const th = feed.arrivals(h, expand(h).timing);
  th.forEach((t, k) => assert.ok(Math.abs(t - (k * 3.4) / 3) < 1e-6, `held ${k}: ${t}`));
  assert.deepEqual(feed.events(s, so.timing), feed.arrivals(s, so.timing).slice(1).map((t) => ({ kind: 'device', device: 'message', t })));
});

test('typing dots lead each later `them` message for 0.4 s, never on frame 0 and never over the message before', () => {
  const shot = CHAT(FOUR, { hold: 4 });
  const out = expand(shot);
  const t = feed.arrivals(shot, out.timing);
  const dots = find(out, 'f.item2.dots');
  assert.equal(opacity(dots, t[2] - 0.2), 1);
  assert.equal(opacity(dots, t[2] - 0.45), 0);
  assert.equal(opacity(dots, t[2]), 0, 'gone when the message lands');
  assert.equal(find(out, 'f.item0.dots'), undefined, 'none on frame 0');
  assert.equal(find(out, 'f.item1.dots'), undefined, 'none before a `me` message');
});

// ---- composition ----

test('sides and colours by sender: `me` right in the look\'s me fill, `them` left in its them fill; one text size', () => {
  for (const name of ['desk', 'pop']) {
    const out = expand(CHAT(FOUR, { hold: 4, title: 'Launch' }), name, '9:16');
    const room = roomOf(out.ctx);
    const plate = (k) => find(out, `f.item${k}.plate`);
    const nums = (n) => n.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = (k) => nums(plate(k)).filter((_, i) => i % 2 === 0);
    assert.ok(Math.abs(Math.max(...xs(1)) - (room.x + room.w)) < 1, `${name}: me flush right`);
    assert.ok(Math.abs(Math.min(...xs(0)) - room.x) < 1, `${name}: them flush left`);
    const colour = (key) => (key.startsWith('#') ? key : look(name).palette[key]);
    assert.equal(plate(1).props.fill, colour(look(name).kinds.feed.me.fill));
    assert.equal(plate(0).props.fill, colour(look(name).kinds.feed.them.fill));
    const sizes = new Set(all(out.nodes).filter((n) => n.type === 'text').map((n) => n.props.layout.size));
    assert.equal(sizes.size, 1, `${name}: one size`);
  }
});

// (that a 90-character message holds in maxLines at the reading floor is measured with the real faces: kinds-feed-browser)
test('a 91-character message is a schema error at items[i].text', () => {
  assert.equal(LONG.length, 90);
  assert.ok(errorsOf(CHAT([{ from: 'them', text: `${LONG}!` }, { from: 'me', text: 'x' }], { hold: 2 })).some((e) => e.path === 'shots[0].items[0].text'));
});

test('scroll-off: six long messages on a tall frame keep the newest whole inside the room; older ones leave it, never cross its top', () => {
  const items = Array.from({ length: 6 }, (_, k) => ({ from: k % 2 ? 'me' : 'them', text: LONG }));
  for (const name of ['desk', 'pop']) {
    const out = expand(CHAT(items, { hold: 6 }), name, '9:16');
    const room = roomOf(out.ctx);
    const end = out.timing.duration;
    const sampled = sampleGraph(out.nodes, end);
    const flat = []; const walk = (n, y, o) => { const yy = y + (n.y ?? 0); const oo = o * (n.opacity ?? 1); flat.push({ n, y: yy, o: oo }); (n.children ?? []).forEach((c) => walk(c, yy, oo)); };
    sampled.forEach((n) => walk(n, 0, 1));
    const plates = flat.filter((f) => /^f\.item\d\.plate$/.test(f.n.id) && f.o > 0);
    const box = (f) => { const v = f.n.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number); const ys = v.filter((_, i) => i % 2); return [Math.min(...ys) + f.y - (f.n.y ?? 0), Math.max(...ys) + f.y - (f.n.y ?? 0)]; };
    assert.ok(plates.some((f) => f.n.id === 'f.item5.plate'), `${name}: the newest is on screen`);
    for (const f of plates) {
      const [top, bottom] = box(f);
      assert.ok(top >= room.y - 1 && bottom <= room.y + room.h + 1, `${name}: ${f.n.id} ${Math.round(top)}..${Math.round(bottom)} outside ${Math.round(room.y)}..${Math.round(room.y + room.h)}`);
    }
    // desk holds six long messages at its floor; pop's taller type does not, so its oldest scroll off
    if (name === 'pop') assert.ok(plates.length < 6, `${name}: some scrolled off`);
    else assert.equal(plates.length, 6, `${name}: all six held`);
  }
});

test('notifications: the newest on top, older ones below it; the app is named in bold at the text size with its disc', () => {
  const shot = { id: 'f', show: 'feed', style: 'notifications', items: NOTES, hold: 4 };
  const out = expand(shot, 'pop', '9:16');
  const tops = [0, 1, 2].map((k) => out.boxes[`item:${k}`][1]);
  assert.ok(tops[2] < tops[1] && tops[1] < tops[0], `newest on top at the end: ${tops.map(Math.round)}`);
  const app = find(out, 'f.item1.app');
  assert.equal(app.props.font.weight, look('pop').kinds.feed.bold);
  assert.equal(app.props.layout.size, find(out, 'f.item1.text').props.layout.size);
  assert.ok(find(out, 'f.item0.disc') && find(out, 'f.item0.initial'));
  assert.equal(find(out, 'f.item0.disc').props.fill, find(out, 'f.item2.disc').props.fill, 'one app, one colour');
});

test('notifications: older cards have made room when a newer one arrives, so it never lands on them (desk\'s settle is 0.6 s)', () => {
  const shot = { id: 'f', show: 'feed', style: 'notifications', items: NOTES, hold: 4 };
  for (const name of ['desk', 'pop']) {
    const out = expand(shot, name, '9:16');
    const t = feed.arrivals(shot, out.timing);
    const y = (k, at) => sample(find(out, `f.item${k}`).tracks.y, at);
    const moved = y(0, out.timing.duration);
    assert.ok(moved > 0, `${name}: the first card moves down`);
    const atSecond = y(0, t[1]), atThird = y(0, t[2]);
    assert.ok(atSecond > 0 && Math.abs(atThird - moved) < 0.5, `${name}: settled by each arrival (${atSecond}, ${atThird} of ${moved})`);
    assert.ok(Math.abs(y(1, t[2]) - y(1, out.timing.duration)) < 0.5, `${name}: item 1 settled when item 2 arrives`);
  }
});

test('notifications: the app\'s disc holds its initial and stays above the message text (the contrast rule caught lime under white)', () => {
  const shot = { id: 'f', show: 'feed', style: 'notifications', items: NOTES, hold: 4 };
  for (const name of ['desk', 'pop']) {
    for (const format of ['16:9', '9:16']) {
      const out = expand(shot, name, format);
      const ys = (n) => n.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2);
      const disc = find(out, 'f.item0.disc'), text = find(out, 'f.item0.text'), initial = find(out, 'f.item0.initial');
      assert.ok(Math.max(...ys(disc)) <= text.props.y + 1e-6, `${name} ${format}: disc bottom ${Math.max(...ys(disc))} under text top ${text.props.y}`);
      assert.ok(initial.props.layout.height <= Math.max(...ys(disc)) - Math.min(...ys(disc)) + 1e-6, `${name} ${format}: the initial fits the disc`);
    }
  }
});

// ---- validation ----

test('validation: chat items need from, notifications need app, each refuses the other; 2 to 6 items', () => {
  const at = (shot) => errorsOf(shot).map((e) => `${e.path}: ${e.message}`);
  assert.ok(at(CHAT([{ text: 'a' }, { from: 'me', text: 'b' }], { hold: 2 })).includes('shots[0].items[0]: a chat item needs from'));
  assert.ok(at({ id: 'f', show: 'feed', style: 'notifications', items: [{ app: 'Mail', text: 'a' }, { from: 'me', text: 'b' }], hold: 2 }).includes('shots[0].items[1].from: belongs to the chat style; this feed\'s style is "notifications"'));
  assert.ok(errorsOf(CHAT(FOUR.slice(0, 1), { hold: 2 })).some((e) => e.path === 'shots[0].items'));
  assert.deepEqual(errorsOf(CHAT(FOUR, { hold: 2, title: 'Launch' })), []);
});

// ---- the bar ----

const full = () => ({ ...feed.example, title: 'Launch day' });
const notifications = () => ({ id: 'n', show: 'feed', style: 'notifications', title: 'This morning', items: NOTES, say: 'An invoice came in. Then a reminder. Then two replies.' });
for (const name of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`feed bar: the example in ${name} at ${format}`, () => assertBar('feed', feed.example, { look: name, format }));
    test(`feed bar: the full fixture in ${name} at ${format}`, () => assertBar('feed', full(), { look: name, format }));
    test(`feed bar: notifications in ${name} at ${format}`, () => assertBar('feed', notifications(), { look: name, format }));
  }
}

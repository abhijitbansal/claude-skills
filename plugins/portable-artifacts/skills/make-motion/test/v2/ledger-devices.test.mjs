// The `ledger` look's device styles (looks-four plan, Task 3): a ruled tag (accent plate, paper text, a rule running
// right from the plate's mid height), a label whose ink2 hairline leader ends in a dot on its target, ruled marks
// (straight, 3 units, ink, no wobble, no stepping), a plain card (white, a 1-unit rule edge, no shadow), highlight
// declined, the `weight-color` emphasis (an emphasised word steps to 800 and turns the accent without moving any word
// box), and the plain caption strip. desk, pop and cosmos are proven unchanged by the frozen fixtures (kinds-frozen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { STRETCH_KEYWORDS } from '../../engine/fonts/index.mjs';
import { EMPHASIS, emphasisOf } from '../../engine/kinds/emphasis.mjs';
import { measure as kindsMeasure, filmOf, filmFor, canvasOf, expandIn, FPS } from './helpers/kinds.mjs';

const look = () => registries.looks.get('ledger');
const device = (name) => registries.devices.get(name);
const UNIT = 1;
const BASE = (id, box) => ({ id, box, at: 1, look: look(), unit: UNIT, seed: 7 });
const EPS = 1e-6;

// every node under `nodes`, depth first
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
const byId = (nodes, suffix) => flat(nodes).find((n) => n.id.endsWith(suffix));

test('a ruled tag: an accent plate with paper text, and a rule that starts at the plate\'s right edge on its mid height', () => {
  const { nodes, boxes } = device('tag').build({ ...BASE('t', [100, 200, 1200, 40]), text: 'Orders', measure: kindsMeasure });
  const [x, y, w, h] = boxes.tag;
  const plate = byId(nodes, '.plate'), rule = byId(nodes, '.rule');
  assert.equal(plate.props.fill, look().palette.accent);
  assert.equal(byId(nodes, '.text').props.fill, look().palette.paper);
  assert.ok(rule, 'the ruled tag draws a rule');
  // the group sits at the plate's centre; the rule's points are group-local
  const [cx, cy] = [x + w / 2, y + h / 2];
  const points = pathPoints(rule.props.d).map(([px, py]) => [px + cx, py + cy]);
  assert.ok(Math.abs(points[0][0] - (x + w)) < EPS, `starts at the plate's right edge: ${points[0][0]} vs ${x + w}`);
  assert.ok(points.every(([, py]) => Math.abs(py - (y + h / 2)) < EPS), 'on the plate\'s mid height');
  assert.ok(points.at(-1)[0] > points[0][0], 'runs right');
  assert.equal(rule.props.strokeWidth, 2 * UNIT, 'two units');
});

test('a tag in a look without the ruled style draws no rule (desk, pop, cosmos)', () => {
  for (const name of ['desk', 'pop', 'cosmos']) {
    const { nodes } = device('tag').build({ ...BASE('t', [100, 200, 1200, 40]), look: registries.looks.get(name), text: 'Orders', measure: kindsMeasure });
    assert.equal(byId(nodes, '.rule'), undefined, name);
  }
});

test('a label\'s ink2 hairline leader ends inside its target\'s box, on a dot', () => {
  const target = [600, 400, 120, 80];
  const anchor = [target[0] + target[2] / 2, target[1] + target[3] / 2];
  const { nodes } = device('label').build({ ...BASE('l', [0, 0, 1920, 1080]), text: 'North', anchor, size: 46, measure: kindsMeasure });
  const leader = byId(nodes, '.leader'), dot = byId(nodes, '.dot');
  const end = pathPoints(leader.props.d).at(-1);
  const inside = ([px, py], [bx, by, bw, bh]) => px >= bx && px <= bx + bw && py >= by && py <= by + bh;
  assert.ok(inside(end, target), `the leader ends inside the target: ${end}`);
  assert.equal(leader.props.stroke, look().palette.ink2);
  assert.ok(dot, 'a dot at the end');
  const dotPoints = pathPoints(dot.props.d);
  const xs = dotPoints.map((p) => p[0]), ys = dotPoints.map((p) => p[1]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - end[0]) < 0.5 && Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - end[1]) < 0.5, 'centred on the leader\'s end');
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 6 * UNIT) < 0.5, 'six units across');
  assert.equal(byId(nodes, '.text').props.fill, look().palette.ink);
});

test('a label in desk draws no dot', () => {
  const { nodes } = device('label').build({ ...BASE('l', [0, 0, 1920, 1080]), look: registries.looks.get('desk'), text: 'North', anchor: [660, 440], size: 46, measure: kindsMeasure });
  assert.equal(byId(nodes, '.dot'), undefined);
});

test('ruled marks: ink, 3 units, straight, no wobble and no step', () => {
  const box = [400, 300, 300, 80];
  for (const name of ['underline', 'circle', 'bracket']) {
    const [mark] = device(name).build(BASE(name, box)).nodes;
    assert.equal(mark.props.stroke, look().palette.ink, name);
    assert.equal(mark.props.strokeWidth, 3 * UNIT, name);
    assert.equal(mark.step, undefined, `${name}: no stepping`);
    assert.deepEqual(device(name).build({ ...BASE(name, box), seed: 99 }).nodes[0].props.d, mark.props.d, `${name}: no wobble (the seed draws the same mark)`);
  }
  const [line] = device('underline').build(BASE('u', box)).nodes;
  const ys = pathPoints(line.props.d).map((p) => p[1]);
  assert.ok(ys.every((y) => Math.abs(y - ys[0]) < EPS), 'the underline is one straight line');
  const [arrow] = device('arrow').build({ ...BASE('a', box), from: [100, 100] }).nodes;
  assert.equal(arrow.props.stroke, look().palette.ink);
  assert.equal(arrow.props.d.includes('C'), false, 'a straight shaft');
});

test('a plain card: white, a 1-unit rule edge, no shadow and no tape', () => {
  const [group] = device('card').build(BASE('c', [100, 100, 600, 400])).nodes;
  const ids = group.children.map((n) => n.id);
  assert.equal(ids.some((id) => id.endsWith('.shadow')), false, 'no shadow');
  assert.equal(group.children.some((n) => n.props.tape), false, 'no tape');
  assert.equal(byId([group], '.paper').props.fill, '#ffffff');
  const edge = byId([group], '.edge');
  assert.equal(edge.props.stroke, look().palette.rule);
  assert.equal(edge.props.strokeWidth, 1 * UNIT);
  assert.equal(group.props.rotate ?? 0, 0, 'square');
});

test('highlight is declined: the look does not support it', () => {
  assert.equal(device('highlight').supports(look()), false);
});

test('weight-color is an emphasis entry with a reserve at 800; emphasisOf returns it for ledger', () => {
  assert.equal(emphasisOf(look()), EMPHASIS['weight-color']);
  assert.deepEqual(EMPHASIS['weight-color'].reserve(look()), { weight: 800 });
  for (const name of ['highlight', 'recolor-scale', 'recolor', 'glow']) assert.equal(EMPHASIS[name].reserve, undefined, `${name} reserves nothing`);
});

// A measure whose advance follows the weight and the width (a variable face's does), with the kinds helper's ink.
const STRETCH = new Map(STRETCH_KEYWORDS.map(([percent, keyword]) => [keyword, percent / 100]));
const weighted = (text, font) => {
  const m = kindsMeasure(text, font);
  const k = ((font.weight ?? 400) / 400) * (STRETCH.get(font.width ?? 'normal') ?? 1);
  return { ...m, width: m.width * k, inkRight: m.width * k - 0.02 * font.size };
};

function statementIn(say) {
  const film = filmOf([{ id: 's', show: 'statement', say }], 'ledger', '16:9');
  const timeline = buildTimeline(film, { fps: FPS });
  const ctx = shotContext({ film, index: 0, timeline, canvas: canvasOf('16:9'), measure: weighted });
  return { out: registries.kinds.get('statement').expand(film.shots[0], ctx), timing: timeline.shots[0] };
}

test('weight-color steps the emphasised word to 800 and the accent, and no word box moves', () => {
  const { out, timing } = statementIn('The North leads with *182* orders.');
  const text = flat(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.deepEqual(text.props.layout.reserve, { weight: 800 }, 'the layout is measured at the reserved weight');
  const words = text.props.layout.lines.flatMap((l) => l.words);
  const hot = words.find((w) => w.text === '182');
  const before = sampleGraph([text], 0.01)[0].words, after = sampleGraph([text], timing.duration - 0.01)[0].words;
  assert.notEqual(before[hot.index].weight, 800, 'not heavy before it is spoken');
  assert.equal(after[hot.index].weight, 800, 'heavy once spoken');
  assert.equal(after[hot.index].fill, look().palette.accent, 'in the accent once spoken');
  assert.ok(words.filter((w) => w !== hot).every((w) => after[w.index].weight === undefined || after[w.index].weight === look().fonts.display.weight), 'the other words keep the display weight');
  // the boxes are the layout's, which never changes over the shot: each word's room is its advance at 800, so a word
  // drawn at 700 or 800 sits in the same room and nothing re-flows (draw.mjs centres the lighter ink in it)
  const { font } = text.props;
  for (const w of words) {
    const room = weighted(w.text, { ...font, weight: 800 }).width + font.tracking * font.size * [...w.text].length;
    assert.ok(Math.abs(w.width - room) < 1e-6, `"${w.text}" is measured at 800`);
  }
});

test('without an emphasised word a ledger statement still reserves its room (one rule, no reflow between shots)', () => {
  const { out } = statementIn('The North leads with orders.');
  const text = flat(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.deepEqual(text.props.layout.reserve, { weight: 800 });
});

test('a desk statement carries no reserve (the frozen layouts)', () => {
  const { nodes } = expandIn(filmOf([{ id: 's', show: 'statement', say: 'The North leads with *182* orders.' }], 'desk', '16:9'));
  const text = flat(nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
  assert.equal('reserve' in text.props.layout, false);
});

// every sampled node with its id
const sampledAll = (nodes) => nodes.flatMap((n) => [n, ...sampledAll(n.children)]);

test('the plain caption: the text face on a white strip with a top hairline, the spoken word ink at 600, the rest ink2', () => {
  const shot = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.' };
  const built = filmFor([shot], 'ledger', '16:9', { captions: true });
  const words = buildTimeline(filmOf([shot], 'ledger', '16:9', { captions: true }), { fps: FPS }).shots[0].words;
  const query = words.find((w) => /query/.test(w.text));
  const nodes = sampledAll(built.sampleShot(0, query.start + 0.05));
  const strip = nodes.find((n) => n.id.endsWith('.strip')), hairline = nodes.find((n) => n.id.endsWith('.hairline'));
  assert.ok(strip && hairline, 'a strip and its top hairline');
  assert.equal(strip.props.fill, '#ffffff');
  assert.equal(hairline.props.stroke, look().palette.rule);
  const textsOf = (n) => n.props.layout.lines.flatMap((l) => l.words).sort((a, b) => a.index - b.index).map((w) => w.text);
  const shown = nodes.filter((n) => n.type === 'text' && n.props.role === 'caption' && textsOf(n).some((w) => /query/.test(w)));
  assert.equal(shown.length, 1, 'the group holding the spoken word');
  const [text] = shown;
  assert.equal(text.props.font.family, look().fonts.text.family, 'the text face');
  assert.deepEqual(text.props.layout.reserve, { weight: 600 }, 'measured at the spoken weight');
  const at = textsOf(text).findIndex((w) => /query/.test(w));
  assert.equal(text.words[at].fill, look().palette.ink, 'the spoken word in ink');
  assert.equal(text.words[at].weight, 600, 'at 600');
  assert.ok(text.words.filter((w, i) => i !== at).every((w) => w.fill === look().palette.ink2), 'the rest in ink2');
});

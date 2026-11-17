// The `poster` devices and emphasis (looks-four plan, Task 6): the cut card (a flat rectangle turned, no shadow, one
// misregistered copy in the other flat colour), the cover cut whose sheet is the incoming shot's ground (the bar that
// wipes is the cut paper), and the `scale` emphasis: the emphasised line of a stack takes the large size and the others
// the small one, two sizes and no recolour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { groundKeys, shotLook, GROUND_ID } from '../../engine/looks/grounds.mjs';
import { emphasisOf } from '../../engine/kinds/emphasis.mjs';
import { filmFor, all } from './helpers/kinds.mjs';
import { pathBox } from './helpers/boxes.mjs';

const NAME = 'poster';
const look = () => registries.looks.get(NAME);
const MISREGISTER = 3; // units

test('a cut card has no shadow and carries one misregistered copy offset past its paper, in another flat colour', () => {
  const l = shotLook(look(), 0, 1);
  const out = registries.devices.get('card').build({ id: 'c', box: [100, 100, 400, 300], at: 0, look: l, unit: 1, seed: 1 });
  const group = out.nodes[0];
  const parts = group.children;
  assert.ok(!parts.some((n) => n.id.endsWith('.shadow')), 'no shadow');
  const copies = parts.filter((n) => n.id.endsWith('.misregister'));
  assert.equal(copies.length, 1, 'one misregistered copy');
  const paper = parts.find((n) => n.id === 'c.paper');
  assert.notEqual(copies[0].props.fill, paper.props.fill, 'the copy is another colour');
  assert.ok(parts.indexOf(copies[0]) < parts.indexOf(paper), 'the copy lies under the paper');
  assert.deepEqual([copies[0].props.x, copies[0].props.y], [MISREGISTER, MISREGISTER], 'offset 3 units');
  const [, , w, h] = pathBox(paper.props.d);
  assert.deepEqual([w, h], [400, 300], 'the paper is the box, square');
  assert.ok(Math.abs(group.props.rotate) > 0, 'the card is turned');
});

test('the cover sheet takes the incoming shot\'s ground colour', () => {
  const shots = [
    { id: 'a', show: 'statement', text: 'First sheet here', hold: 1.5 },
    { id: 'b', show: 'statement', text: 'Second sheet here', hold: 1.5, cut: { type: 'cover', direction: 'left' } },
  ];
  const film = filmFor(shots, NAME, '16:9');
  const keys = groundKeys(look(), 2, 1);
  const incoming = look().palette[keys[1]], outgoing = look().palette[keys[0]];
  const start = 1.5; // the second shot starts as the first ends
  const frame = film.frameAt(start + 0.15);
  const sheets = all(frame.sampled).filter((n) => n.type === 'path' && n.id.startsWith(GROUND_ID));
  const fills = sheets.map((n) => n.props.fill);
  assert.ok(fills.includes(outgoing), 'the outgoing ground stays under');
  const moving = sheets.find((n) => n.props.fill === incoming);
  assert.ok(moving, `a sheet in the incoming ground ${incoming}: ${fills.join(', ')}`);
  assert.ok(moving.x !== 0, 'the incoming sheet is travelling');
  const fields = all(frame.sampled).filter((n) => n.type === 'field').map((n) => n.props.palette.paper);
  assert.deepEqual(fields, [outgoing, incoming], 'each shot keeps its own field: the outgoing one still, the incoming one on the sheet');
});

const emphasisFilm = (format) => filmFor([{ id: 'e', show: 'statement', say: 'Rents climbed *fast* in every single city this year.' }], NAME, format);
// a beat's knockout copy (props.beatOf, gate-poster-2 ruling 3) stands in for a line and is not one of the stack's lines
const lineSizes = (nodes, hero) => all(nodes).filter((n) => n.type === 'text' && n.props.stack === hero && n.props.beatOf === undefined).map((n) => ({ size: n.props.font.size, text: n.props.layout.lines[0].words.map((w) => w.text).join(' '), node: n }));

test('scale emphasis: the stack sets exactly two sizes, the emphasised line the large one, and recolours nothing', () => {
  for (const format of ['16:9', '9:16']) {
    const film = emphasisFilm(format);
    const lines = lineSizes(film.sampleShot(0, 2), 'e.text');
    const sizes = [...new Set(lines.map((l) => Math.round(l.size * 100) / 100))];
    assert.equal(sizes.length, 2, `${format}: two sizes, got ${sizes.join(', ')} for ${lines.map((l) => l.text).join(' / ')}`);
    const lead = lines.find((l) => /FAST/.test(l.text));
    assert.equal(Math.round(lead.size * 100) / 100, Math.max(...sizes), `${format}: the emphasised line is the large one`);
    const fills = new Set(lines.flatMap((l) => [l.node.props.fill, ...(l.node.words ?? []).map((w) => w.fill).filter(Boolean)]));
    assert.equal(fills.size, 1, `${format}: one colour, nothing recoloured`);
  }
  assert.equal(emphasisOf(look()).leads, true);
});

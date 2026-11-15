// Graphic devices: highlight, circle, underline, arrow, bracket, cutout, card, tag, punch. Pure scene-graph
// builders, so everything runs in Node with a fake text measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/devices/index.mjs';
import { node, isNode, NODE_TYPES } from '../../engine/graph/node.mjs';
import { sample } from '../../engine/time/track.mjs';

const desk = registries.looks.get('desk');
const pop = registries.looks.get('pop');
const BOX = [100, 100, 400, 80];
const HAND_STEP = 12;
const measure = (text, font) => ({ width: text.length * font.size * 0.55, ascent: font.size * 0.8, descent: font.size * 0.2 });
const image = node('image', 'photo', { src: 'assets/photo.png', w: 300, h: 200 });
const EXTRAS = {
  arrow: { from: [700, 400] },
  tag: { text: 'Source', measure },
  cutout: { image },
};
const NAMES = ['highlight', 'circle', 'underline', 'arrow', 'bracket', 'cutout', 'card', 'tag', 'punch'];
const MARKS = ['highlight', 'circle', 'underline', 'arrow', 'bracket'];

const build = (name, look, over = {}) => registries.devices.get(name).build({
  id: 'd', box: BOX, at: 1, look, unit: 1, seed: 1, ...EXTRAS[name], ...over,
});
// A track keeps its ease as a function, which deepEqual compares by identity: compare a serialised form that
// replaces each function with what it returns.
const plain = (v) => JSON.stringify(v, (_, x) => (typeof x === 'function' ? `fn:${x(0.37)}` : x));
const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children)]);
const pairs = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i], n[2 * i + 1]]);
};
const bbox = (d) => {
  const p = pairs(d);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const byPart = (nodes, part) => all(nodes).find((n) => n.id === `d.${part}`);

test('every device is registered and answers supports and build', () => {
  for (const name of NAMES) {
    const d = registries.devices.get(name);
    assert.equal(typeof d.supports, 'function', name);
    assert.equal(typeof d.build, 'function', name);
  }
});

test('a device lands on its anchor and never starts before 0', () => {
  for (const name of NAMES.filter((n) => n !== 'punch')) {
    for (const look of [desk, pop]) {
      const { nodes } = build(name, look, { at: 1.0 });
      const tracks = all(nodes).flatMap((n) => Object.entries(n.tracks));
      assert.ok(tracks.length > 0, `${name}/${look.name} has a track`);
      for (const [tn, tr] of tracks) {
        const pts = tr.points;
        assert.equal(pts.at(-1).t, 1.0, `${name}/${look.name}.${tn} ends at at`);
        assert.ok(pts[0].t >= 0, `${name}/${look.name}.${tn} starts at or after 0`);
        if (['reveal', 'draw', 'opacity'].includes(tn)) assert.equal(pts.at(-1).v, 1, `${name}.${tn} final value`);
      }
    }
  }
  const { nodes: [h] } = build('highlight', desk, { at: 1.0 });
  assert.equal(h.tracks.reveal.points.at(-1).t, 1.0);
  assert.equal(h.tracks.reveal.points.at(-1).v, 1);
  const { nodes: [early] } = build('highlight', desk, { at: 0.1 });
  assert.equal(early.tracks.reveal.points[0].t, 0);
  assert.equal(early.tracks.reveal.points.at(-1).t, 0.1);
});

test('early at shortens the duration for every device', () => {
  for (const name of NAMES.filter((n) => n !== 'punch')) {
    for (const look of [desk, pop]) {
      for (const [, tr] of all(build(name, look, { at: 0.05 }).nodes).flatMap((n) => Object.entries(n.tracks))) {
        assert.ok(tr.points[0].t >= 0 && tr.points.at(-1).t === 0.05);
      }
    }
  }
});

test('a stepped mark shows its final value on the frame it lands, even when at is off the 12 fps grid', () => {
  for (const name of MARKS) {
    const at = 1.05; // between frames 12 (1.0) and 13 (1.0833)
    const { nodes } = build(name, desk, { at });
    const n = nodes[0];
    const tr = n.tracks.draw ?? n.tracks.reveal;
    assert.equal(tr.points.at(-1).t, at, name);
    assert.equal(sample(tr, at, n.step), 1, `${name} complete at at`);
    assert.ok(sample(tr, at - 0.5, n.step) < 1, `${name} not complete well before at`);
  }
});

test('desk marks are stepped at 12 fps, pop marks are not', () => {
  for (const name of MARKS) {
    assert.equal(build(name, desk).nodes[0].step, HAND_STEP, `${name} desk`);
    assert.equal(build(name, pop).nodes[0].step, undefined, `${name} pop`);
  }
  const u = (l) => build('underline', l, { box: [0, 0, 300, 60], at: 1 }).nodes[0];
  assert.equal(u(desk).step, 12);
  assert.equal(u(pop).step, undefined);
});

test('the same seed draws the same wobble, and the build is repeatable', () => {
  for (const name of NAMES) {
    for (const look of [desk, pop]) {
      assert.equal(plain(build(name, look, { seed: 5 })), plain(build(name, look, { seed: 5 })), `${name}/${look.name}`);
    }
  }
  const circle = (seed) => build('circle', desk, { box: [0, 0, 300, 100], seed }).nodes[0].props.d;
  assert.equal(circle(5), circle(5));
});

test('a different seed changes a desk mark and leaves a pop mark alone', () => {
  for (const name of MARKS) {
    const d = (look, seed) => build(name, look, { seed }).nodes[0].props.d;
    assert.notEqual(d(desk, 1), d(desk, 2), `${name} desk`);
    assert.equal(d(pop, 1), d(pop, 2), `${name} pop`);
  }
});

test('a different id changes a desk mark', () => {
  const d = (id) => build('circle', desk, { id }).nodes[0].props.d;
  assert.notEqual(d('a'), d('b'));
});

test('supports follows the look\'s device entries, punch follows cuts or a spring emphasis', () => {
  const get = (n) => registries.devices.get(n);
  for (const n of ['highlight', 'circle', 'underline', 'arrow', 'bracket', 'cutout', 'card', 'tag']) assert.equal(get(n).supports(desk), true, `desk ${n}`);
  for (const n of ['arrow', 'tag', 'cutout', 'underline', 'card']) assert.equal(get(n).supports(pop), true, `pop ${n}`);
  for (const n of ['highlight', 'circle', 'bracket']) assert.equal(get(n).supports(pop), false, `pop ${n}`);
  // the one rule: a styled device is supported exactly when the look has an entry for it
  for (const look of [desk, pop]) {
    for (const n of NAMES.filter((x) => x !== 'punch')) assert.equal(get(n).supports(look), Object.hasOwn(look.devices, n), `${look.name} ${n}`);
  }
  assert.equal(get('punch').supports(pop), true);
  assert.equal(get('punch').supports(desk), false);
  const springy = { ...desk, moves: { ...desk.moves, emphasize: { ease: 'spring(300,12)', dur: 0.2 } } };
  assert.equal(get('punch').supports(springy), true);
});

test('highlight: a 1.18x band under the text, exact in pop, uneven in desk', () => {
  const [x, y, w, h] = BOX;
  const top = y - 0.09 * h, band = 1.18 * h;
  const p = build('highlight', pop).nodes[0];
  assert.equal(p.props.under, true);
  assert.equal(p.props.fill, pop.palette.accent);
  assert.deepEqual(bbox(p.props.d), [x, top, w, band]);
  assert.equal(pairs(p.props.d).length, 4, 'a plain rectangle');
  const d = build('highlight', desk).nodes[0];
  assert.equal(d.props.under, true);
  assert.equal(d.props.fill, desk.palette.accent);
  assert.equal(d.props.blend, 'multiply');
  assert.ok(/Q/.test(d.props.d), 'long edges are curves');
  const [bx, by, bw, bh] = bbox(d.props.d);
  assert.ok(bw >= w - 6 && bw <= w + 40 && bh >= band - 8 && bh <= band + 16, 'band stays near box size');
  assert.ok(bx <= x + 3 && by <= top + 7);
});

test('every length scales with unit', () => {
  const stroke = (unit) => build('underline', desk, { unit, box: [0, 0, 300 * unit, 60 * unit] }).nodes[0].props.strokeWidth;
  assert.equal(stroke(2), 2 * stroke(1));
  const u1 = build('cutout', desk, { unit: 1 }), u2 = build('cutout', desk, { unit: 2 });
  assert.equal(byPart(u2.nodes, 'shadow').props.x, 2 * byPart(u1.nodes, 'shadow').props.x);
});

test('underline: width and colour from the look, 6 units as the default, waves in desk and a square-ended bar in pop', () => {
  assert.equal(build('underline', desk).nodes[0].props.strokeWidth, desk.devices.underline.width);
  const bar = build('underline', pop).nodes[0];
  assert.equal(bar.props.strokeWidth, 10);
  assert.equal(bar.props.stroke, pop.palette.accent2);
  assert.equal(bar.props.lineCap, 'butt');
  assert.equal(build('underline', { ...pop, devices: {} }).nodes[0].props.strokeWidth, 6);
  const ys = (look) => pairs(build('underline', look).nodes[0].props.d).map((q) => q[1]);
  assert.equal(new Set(ys(pop)).size, 1, 'straight');
  assert.ok(new Set(ys(desk)).size > 3, 'desk wobbles');
  const [x, , w] = BOX;
  const xs = pairs(build('underline', desk).nodes[0].props.d).map((q) => q[0]);
  assert.ok(Math.min(...xs) < x && Math.max(...xs) > x + w, 'overshoots both ends');
});

test('circle: an open stroke 1.25x the box whose end overlaps its start', () => {
  const d = build('circle', desk, { box: [0, 0, 300, 100] }).nodes[0];
  assert.ok(!/z/i.test(d.props.d), 'one open stroke');
  assert.equal(d.props.fill, undefined);
  const p = pairs(d.props.d);
  const gap = Math.hypot(p.at(-1)[0] - p[0][0], p.at(-1)[1] - p[0][1]);
  assert.ok(gap > 2 && gap < 40, `end ${gap.toFixed(1)}px from start`);
  // the stroke runs on past its start: the end is ahead of the start along the pen's first direction by about 12
  const heading = [p[1][0] - p[0][0], p[1][1] - p[0][1]], norm = Math.hypot(...heading);
  const ahead = ((p.at(-1)[0] - p[0][0]) * heading[0] + (p.at(-1)[1] - p[0][1]) * heading[1]) / norm;
  assert.ok(ahead > 8 && ahead < 16, `overlap ${ahead.toFixed(1)} units`);
  const [bx, by, bw, bh] = bbox(d.props.d);
  assert.ok(bw > 330 && bw < 430 && bh > 100 && bh < 170, `size ${bw}x${bh}`);
  assert.ok(Math.abs(bx + bw / 2 - 150) < 30 && Math.abs(by + bh / 2 - 50) < 20, 'centred on the box');
  const c = build('circle', pop, { box: [0, 0, 300, 100] }).nodes[0].props.d;
  assert.ok(/z/i.test(c), 'pop ellipse is exact and closed');
  const [, , cw, ch] = bbox(c);
  assert.ok(Math.abs(cw - 375) < 1 && Math.abs(ch - 125) < 1);
});

test('arrow: the head points at the box from every side', () => {
  const [x, y, w, h] = BOX;
  const cx = x + w / 2, cy = y + h / 2;
  const sides = { left: [x - 300, cy - 40], right: [x + w + 300, cy + 30], above: [cx + 60, y - 260], below: [cx - 50, y + h + 240] };
  for (const [side, from] of Object.entries(sides)) {
    for (const look of [desk, pop]) {
      const { nodes: [a] } = build('arrow', look, { from });
      const p = pairs(a.props.d);
      assert.deepEqual(p[0], from.map((v) => Math.round(v * 100) / 100), `${side} starts at from`);
      // d ends: ... before tip, tip, barb, tip, barb
      const tip = p.at(-4), before = p.at(-5);
      const tangent = [tip[0] - before[0], tip[1] - before[1]];
      const toBox = [cx - tip[0], cy - tip[1]];
      assert.ok(tangent[0] * toBox[0] + tangent[1] * toBox[1] > 0, `${side}/${look.name} heads toward the box`);
      const outside = tip[0] < x || tip[0] > x + w || tip[1] < y || tip[1] > y + h;
      const dx = Math.max(x - tip[0], 0, tip[0] - (x + w)), dy = Math.max(y - tip[1], 0, tip[1] - (y + h));
      assert.ok(outside && Math.hypot(dx, dy) < 30, `${side}/${look.name} stops just outside the box`);
      assert.equal(p.length >= 5, true);
    }
  }
});

test('arrow: a pop arrow is straight and bold, a desk arrow bows', () => {
  const from = [700, 400];
  const straight = pairs(build('arrow', pop, { from }).nodes[0].props.d);
  assert.ok(!/C/.test(build('arrow', pop, { from }).nodes[0].props.d));
  assert.equal(straight.length, 5);
  assert.equal(build('arrow', pop, { from }).nodes[0].props.strokeWidth, pop.devices.arrow.width);
  assert.ok(/C/.test(build('arrow', desk, { from }).nodes[0].props.d));
});

test('bracket: sits on the left of the box and spans its height', () => {
  const [x, y, , h] = BOX;
  for (const look of [desk, pop]) {
    const [bx, by, bw, bh] = bbox(build('bracket', look).nodes[0].props.d);
    assert.ok(bx + bw <= x + 4, `${look.name} left of the box`);
    assert.ok(by <= y + 2 && by + bh >= y + h - 2, `${look.name} spans the box height`);
  }
  const p = pairs(build('bracket', pop).nodes[0].props.d);
  assert.equal(p[1][0], p[2][0], 'pop spine is vertical');
});

test('cutout keeps the image src and size and puts a keyline and a shadow behind it', () => {
  for (const look of [desk, pop]) {
    const { nodes } = build('cutout', look);
    const img = all(nodes).find((n) => n.type === 'image');
    assert.equal(img.props.src, 'assets/photo.png');
    assert.equal(img.props.w, 300);
    assert.equal(img.props.h, 200);
    const order = all(nodes).map((n) => n.id);
    assert.ok(order.indexOf('d.shadow') < order.indexOf('d.keyline') && order.indexOf('d.keyline') < order.indexOf('d.image'));
    const [, , kw, kh] = bbox(byPart(nodes, 'keyline').props.d);
    assert.equal(kw, 300 + 2 * look.keyline, `${look.name} keyline width`);
    assert.equal(kh, 200 + 2 * look.keyline);
    assert.equal(byPart(nodes, 'keyline').props.fill, '#ffffff');
    const sh = byPart(nodes, 'shadow');
    assert.equal(sh.props.x, look.shadow.dx);
    assert.equal(sh.props.y, look.shadow.dy);
    assert.equal(sh.props.fill, look.shadow.color);
    assert.equal(sh.props.opacity, look.shadow.alpha);
  }
  assert.ok(byPart(build('cutout', desk).nodes, 'shadow').props.blur > 0);
  assert.equal(byPart(build('cutout', pop).nodes, 'shadow').props.blur, undefined, 'pop shadow is hard');
  assert.equal(byPart(build('cutout', pop).nodes, 'shadow').props.fill, pop.palette.accent2);
});

test('a cutout of an image with transparency is refused until the draw layer can dilate alpha', () => {
  assert.throws(() => build('cutout', desk, { alpha: true }), /cutout: images with transparency are not supported yet/);
  assert.doesNotThrow(() => build('cutout', desk, { alpha: false }));
});

test('card: desk is paper with tape or a torn edge, pop is a white sheet with square corners, both cast a shadow', () => {
  const taped = build('card', desk).nodes;
  assert.equal(all(taped).filter((n) => n.props.tape === true).length, 2);
  assert.ok(byPart(taped, 'shadow'));
  const paper = byPart(taped, 'paper');
  assert.equal(paper.props.fill, desk.devices.card.fill);
  const torn = { ...desk, devices: { ...desk.devices, card: { ...desk.devices.card, edge: 'torn' } } };
  const tornNodes = build('card', torn).nodes;
  assert.equal(all(tornNodes).filter((n) => n.props.tape === true).length, 0);
  assert.ok(pairs(byPart(tornNodes, 'paper').props.d).length > 12, 'torn edge has teeth');
  assert.notEqual(byPart(build('card', torn, { seed: 2 }).nodes, 'paper').props.d, byPart(tornNodes, 'paper').props.d);
  const plain = build('card', pop).nodes;
  assert.equal(all(plain).filter((n) => n.props.tape === true).length, 0);
  assert.equal(pairs(byPart(plain, 'paper').props.d).length, 4);
  assert.equal(byPart(plain, 'paper').props.fill, pop.palette.ink, 'a white sheet');
  assert.equal(byPart(plain, 'paper').props.fill, '#ffffff');
  assert.equal(byPart(plain, 'shadow').props.fill, pop.shadow.color);
  assert.equal(byPart(plain, 'shadow').props.blur, undefined, 'a hard shadow');
});

test('tag: a padded box that contains its text, in the label font, in caps', () => {
  for (const look of [desk, pop]) {
    for (const unit of [1, 2]) {
      const res = build('tag', look, { unit, text: 'Source', box: [50 * unit, 60 * unit, 10, 10] });
      const textNode = all(res.nodes).find((n) => n.type === 'text');
      const { layout, font } = textNode.props;
      const [tx, ty, tw, th] = res.boxes.tag;
      assert.equal(font.family, look.fonts.label.family);
      assert.equal(font.size, look.scale[1] * unit);
      assert.equal(font.tracking, look.tracking(look.scale[1], 'label'));
      assert.equal(layout.lines[0].words[0].text, look.caps.label ? 'SOURCE' : 'Source');
      assert.equal(tw, layout.width + 2 * 18 * unit);
      assert.equal(th, layout.height + 2 * 10 * unit);
      assert.deepEqual([tx, ty], [50 * unit, 60 * unit]);
      const plate = all(res.nodes).find((n) => n.id === 'd.plate');
      assert.equal(plate.props.fill, look.palette[look.devices.tag.fill]);
      assert.equal(textNode.props.fill, look.palette[look.devices.tag.text]);
      const group = res.nodes[0];
      const left = group.props.x + textNode.props.x; // the text node sits about the group's centre
      assert.ok(left >= tx + 18 * unit - 1e-9 && left + layout.width <= tx + tw - 18 * unit + 1e-9, 'text inside the padding');
    }
  }
});

test('a tag never puts text on accent2 or sets text in it; an unstyled look gets ink with paper text', () => {
  const unstyled = { ...desk, devices: {} };
  const res = build('tag', unstyled);
  assert.equal(all(res.nodes).find((n) => n.id === 'd.plate').props.fill, desk.palette.ink);
  assert.equal(all(res.nodes).find((n) => n.type === 'text').props.fill, desk.palette.paper);
  for (const look of [desk, pop, unstyled]) {
    const nodes = all(build('tag', look).nodes);
    const plate = nodes.find((n) => n.id === 'd.plate'), label = nodes.find((n) => n.type === 'text');
    assert.notEqual(plate.props.fill, look.palette.accent2, `${look.name} plate`);
    assert.notEqual(label.props.fill, look.palette.accent2, `${look.name} text`);
  }
});

test('every registered device is styled by at least one look, or is punch', () => {
  for (const name of registries.devices.names()) {
    if (name === 'punch') continue;
    const styled = registries.looks.names().some((l) => Object.hasOwn(registries.looks.get(l).devices, name));
    assert.ok(styled, `no look has a devices entry for "${name}"`);
  }
});

test('punch returns three camera keys that jump, and no nodes; the look\'s zoom wins, 1.12 when absent', () => {
  const res = build('punch', pop, { at: 2 });
  assert.deepEqual(res.nodes, []);
  assert.equal(pop.devices.punch.scale, 1.08);
  assert.deepEqual(res.camera, [
    { t: 1.999, zoom: 1 },
    { t: 2, zoom: 1.08, ease: 'linear' },
    { t: 2.12, zoom: 1.0, ease: 'outExpo' },
  ]);
  const plain = { ...pop, devices: {} };
  assert.equal(build('punch', plain, { at: 2 }).camera[1].zoom, 1.12);
  assert.equal(build('punch', pop, { at: 0.1 }).camera[0].t, 0.099);
  assert.equal(build('punch', pop, { at: 0 }).camera[0].t, 0, 'never before 0');
});

test('every returned node is a frozen node() with a valid type', () => {
  for (const name of NAMES) {
    for (const look of [desk, pop]) {
      for (const n of all(build(name, look).nodes)) {
        assert.ok(isNode(n), `${name}/${look.name}/${n.id}`);
        assert.ok(Object.isFrozen(n) && Object.isFrozen(n.props));
        assert.ok(NODE_TYPES.includes(n.type));
      }
    }
  }
});

test('node ids are the device id, or the device id and a part', () => {
  for (const name of NAMES.filter((n) => n !== 'punch')) {
    const ids = all(build(name, desk).nodes).map((n) => n.id);
    assert.ok(ids.every((id) => id === 'd' || id.startsWith('d.') || id === 'photo'), `${name}: ${ids}`);
    assert.equal(new Set(ids).size, ids.length, `${name} ids are unique`);
  }
});

test('unknown extra params are rejected with the accepted names listed', () => {
  assert.throws(() => build('highlight', desk, { colour: 'red' }), /unknown param "colour" for device "highlight"; accepted: id, box, at, look, unit, seed, measure/);
  assert.throws(() => build('arrow', desk, { frm: [1, 2] }), /unknown param "frm".*from/);
  assert.throws(() => build('tag', desk, { txt: 'x' }), /unknown param "txt".*text/);
  assert.throws(() => build('cutout', desk, { img: image }), /unknown param "img".*image/);
});

test('bad input fails fast with a clear message', () => {
  assert.throws(() => build('highlight', desk, { box: [1, 2, 3] }), /box/);
  assert.throws(() => build('highlight', desk, { box: [0, 0, 0, 10] }), /box/);
  assert.throws(() => build('highlight', desk, { at: -1 }), /at/);
  assert.throws(() => build('highlight', desk, { unit: 0 }), /unit/);
  assert.throws(() => build('highlight', desk, { seed: 1.5 }), /seed/);
  assert.throws(() => build('highlight', desk, { id: '' }), /id/);
  assert.throws(() => build('highlight', { name: 'x' }), /look/);
  assert.throws(() => build('tag', desk, { measure: undefined }), /measure/);
  assert.throws(() => build('tag', desk, { text: '' }), /text/);
  assert.throws(() => build('arrow', desk, { from: [150, 120] }), /outside/);
  assert.throws(() => build('arrow', desk, { from: [1] }), /from/);
  assert.throws(() => build('cutout', desk, { image: undefined }), /image/);
  assert.throws(() => build('cutout', desk, { image: node('group', 'g') }), /image/);
});

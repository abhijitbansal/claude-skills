// The cosmos sun (engine/devices/sun.mjs): one light drawn the same way everywhere it appears (a hot near-white core,
// a gold limb, a bloom falling to nothing), anchored to one place per format for the statement, number and end kinds
// (frame-left on a wide frame, high and centred on a tall one), the number's orbit round it, and the compare's large
// disc the same sun, gold from its first frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sunNodes, sunAnchor } from '../../engine/devices/sun.mjs';
import { toOklab } from '../../engine/color/oklab.mjs';
import { editorialSpan } from '../../engine/kinds/editorial.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';

const look = registries.looks.get('cosmos');
const RAD = Math.PI / 180;
const wide = (shot) => expandIn(filmOf([shot], 'cosmos', '16:9', { mode: 'pro' }));
const tall = (shot) => expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
const byId = (nodes, id) => all(nodes).find((n) => n.id === id);

// Where a node's origin lands in the frame: its own (x, y) through every ancestor's translate, rotate (degrees) and
// scale, in that order.
function worldOf(nodes, id) {
  const walk = (list, chain) => {
    for (const n of list) {
      if (n.id === id) return [...chain, n];
      const found = walk(n.children ?? [], [...chain, n]);
      if (found) return found;
    }
    return null;
  };
  const chain = walk(nodes, []);
  assert.ok(chain, `no node ${id}`);
  let [px, py] = [chain.at(-1).props.x ?? 0, chain.at(-1).props.y ?? 0];
  for (const g of chain.slice(0, -1).reverse()) {
    const sx = g.props.scaleX ?? g.props.scale ?? 1, sy = g.props.scaleY ?? g.props.scale ?? 1;
    const t = (g.props.rotate ?? 0) * RAD;
    const [x1, y1] = [px * sx, py * sy];
    [px, py] = [(g.props.x ?? 0) + x1 * Math.cos(t) - y1 * Math.sin(t), (g.props.y ?? 0) + x1 * Math.sin(t) + y1 * Math.cos(t)];
  }
  return { x: px, y: py };
}

const lightness = (hex) => toOklab(hex)[0];
const LIGHT = { id: 's', show: 'statement', say: 'The sunlight on your face is *eight minutes* old.' };
const COUNT = { id: 'n', show: 'number', say: 'One hundred fifty million kilometres.', value: 150, suffix: 'M km', label: 'from the Sun to Earth' };
const CLOSE = { id: 'e', show: 'end', title: 'Scale changes everything.', ask: 'Look up tonight.', mark: 'cosmos', say: 'Scale changes everything.' };
const SUN_OF = { s: 's.sun', n: 'n.sun', e: 'e.sun' };

test('sun: one light, a hot near-white core, a gold limb at the disc edge, a bloom falling to nothing', () => {
  const [sun] = sunNodes('x', look, { cx: 0, cy: 0, r: 200 });
  const stops = sun.props.radial.stops;
  const [at0, alpha0, core] = stops[0];
  assert.equal(at0, 0);
  assert.equal(alpha0, 1, 'a core at full strength: never a coreless smudge');
  assert.ok(lightness(core) > lightness(look.sun.color) + 0.05, 'the core hotter (lighter) than the gold');
  const limb = stops.find(([at]) => Math.abs(at - look.sun.disc) < 1e-9);
  assert.ok(limb && limb[1] === 1 && limb[2] === look.sun.limb, 'the gold limb at full strength at the disc edge');
  assert.equal(stops.at(-1)[1], 0, 'the bloom falls to nothing');
  const outside = stops.filter(([at]) => at >= look.sun.disc);
  assert.ok(outside.every(([, a], i) => i === 0 || a <= outside[i - 1][1]), 'and only falls');
  assert.ok(outside[1][1] < 1, 'a soft bloom past the limb, not a slab');
});

test('sun: anchored frame-left on a wide frame and high and centred on the safe zone on a tall one, its disc inside the frame', () => {
  for (const [expand, check] of [[wide, (a, c) => a.cx < 0.15 * c.w], [tall, (a, c, span) => a.cy < 0.2 * c.h && Math.abs(a.cx - (span.x + span.w / 2)) < 1]]) {
    const { ctx } = expand(LIGHT);
    const a = sunAnchor(look, ctx);
    assert.ok(check(a, ctx.canvas, editorialSpan(ctx, 1, look.grid.columns)), JSON.stringify(a));
    const disc = look.sun.disc * a.r;
    assert.ok(a.cx - disc >= 0 && a.cy - disc >= 0 && a.cx + disc <= ctx.canvas.w, 'the disc is not cropped');
  }
});

test('sun: the statement, number and end kinds put their sun on the format anchor', () => {
  for (const expand of [wide, tall]) {
    for (const shot of [LIGHT, COUNT, CLOSE]) {
      const out = expand(shot);
      const a = sunAnchor(look, out.ctx);
      const at = worldOf(out.nodes, SUN_OF[shot.id]);
      assert.ok(Math.abs(at.x - a.cx) < 1 && Math.abs(at.y - a.cy) < 1, `${shot.show} ${out.ctx.canvas.w}: ${JSON.stringify(at)} vs ${JSON.stringify(a)}`);
      assert.equal(byId(out.nodes, SUN_OF[shot.id]).props.radial.stops[0][2], look.sun.core, 'drawn as the one sun');
    }
  }
});

// gate round 3: the number's orbit (the sun on its rim) gave way to a line from the sun to Earth: its tests are in
// cosmos-gate3.test.mjs

test('number: a count never opens on a bare zero with its unit (review C I11: nor on any step short of the final digit count)', () => {
  for (const expand of [wide, tall]) {
    const out = expand(COUNT);
    const digits = byId(out.nodes, 'n.value.digits');
    assert.notEqual(digits.props.steps[0].text, '0');
    assert.equal(digits.props.steps[0].text.replace(/\D/g, '').length, digits.props.steps.at(-1).text.replace(/\D/g, '').length, 'its first step has the final digit count');
  }
});

// ---- compare at scale: the Sun's disc is the sun ----

const SIZES = {
  id: 'z', show: 'compare', say: 'Earth is twelve thousand kilometres across. The Sun is one point four million.',
  left: { title: 'Earth', value: '12,742', points: ['kilometres across'] }, right: { title: 'The Sun', value: '1,392,700', points: ['kilometres across'] },
};
const boxOf = (n) => {
  const l = n.props.layout, f = n.props.font.size;
  return [n.props.x + Math.min(...l.lines.map((x) => x.x)), n.props.y + l.lines[0].y - 0.72 * f, l.width, l.lines.at(-1).y - l.lines[0].y + 0.84 * f];
};
const groupBox = (nodes, side) => {
  const bs = ['title', 'value', 'points'].map((p) => byId(nodes, `z.${side}.${p}`)).filter(Boolean).map(boxOf);
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
  return [x0, y0, Math.max(...bs.map((b) => b[0] + b[2])) - x0, Math.max(...bs.map((b) => b[1] + b[3])) - y0];
};

// gate round 3: the sun grows in at the turn (its `rise` group moves; the body itself has no placeholder state), Earth
// is the Earth mark; the reveal and the axis are tested in cosmos-gate3.test.mjs
test('sizes: the large disc is the same sun, gold whenever it is on screen, with a bloom; Earth a dot with a ring', () => {
  for (const expand of [wide, tall]) {
    const out = expand(SIZES);
    const body = byId(out.nodes, 'z.right.sun');
    assert.ok(body, 'the Sun drawn as the sun');
    assert.equal(body.props.radial.stops[0][2], look.sun.core, 'a soft inner gradient toward the core colour');
    assert.equal(body.props.radial.stops.at(-1)[2], look.sun.limb, 'the gold limb at its edge');
    assert.deepEqual(body.tracks ?? {}, {}, 'no placeholder state: gold whenever it shows');
    assert.ok(byId(out.nodes, 'z.right.sun.bloom'), 'a bloom past the limb');
    const dot = byId(out.nodes, 'z.left.earth.dot'), ring = byId(out.nodes, 'z.left.earth.ring');
    assert.ok(dot && ring && ring.props.stroke, 'Earth: a dot with a ring round it');
  }
});

test('sizes: one headline naming the Sun, groups number over unit (the Sun\'s name in the headline), in three styles', () => {
  for (const expand of [wide, tall]) {
    const out = expand({ ...SIZES, ratioLabel: '× wider' });
    const head = byId(out.nodes, 'z.ratio');
    assert.equal(head.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' '), 'The Sun is 109× wider');
    const floor = look.secondary.min * out.ctx.unit;
    assert.ok(head.props.font.size >= 3 * floor, 'the hero over the floor');
    const [name, value, unitText] = ['title', 'value', 'points'].map((p) => byId(out.nodes, `z.left.${p}`));
    assert.ok(name.props.y < value.props.y && value.props.y < unitText.props.y, 'Earth: name, number, unit');
    assert.equal(new Set([name.props.font.weight, value.props.font.weight, unitText.props.font.weight]).size, 3, 'three weights');
    assert.ok(name.props.font.size >= floor - 1e-9 && unitText.props.font.size >= floor - 1e-9, 'secondary at the floor');
    assert.equal(byId(out.nodes, 'z.right.title'), undefined, 'the headline names the Sun');
    const [sun, earth] = [groupBox(out.nodes, 'right'), groupBox(out.nodes, 'left')];
    const hb = boxOf(head);
    const apart = (a, b) => Math.max(a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3]));
    assert.ok(apart(sun, hb) >= 0.25 * head.props.font.size && apart(earth, hb) >= 0.25 * head.props.font.size, 'the groups clear of the headline');
  }
});

test('sizes: clear space of at least a number cap height between every text and the Sun disc edge', () => {
  for (const expand of [wide, tall]) {
    const out = expand(SIZES);
    const body = byId(out.nodes, 'z.right.sun');
    const { x: cx, y: cy } = body.props, r = body.props.radial.r;
    const clear = 0.72 * byId(out.nodes, 'z.right.value').props.font.size;
    for (const n of all(out.nodes).filter((m) => m.type === 'text')) {
      const [x, y, w, h] = boxOf(n);
      // the nearest point of the text box to the disc centre stays r + clear away
      const nx = Math.max(x, Math.min(cx, x + w)), ny = Math.max(y, Math.min(cy, y + h));
      assert.ok(Math.hypot(nx - cx, ny - cy) >= r + clear - 1, `${n.id} is ${Math.round(Math.hypot(nx - cx, ny - cy) - r)} from the disc`);
    }
  }
});

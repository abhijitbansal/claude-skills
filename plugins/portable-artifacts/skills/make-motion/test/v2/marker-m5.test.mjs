// The `marker` look, fifth pass (m5, revision round 2 of the gate, gate-marker-2.md). Every test here samples what the
// reviewer saw: the real gate films (references/examples/v2/gate-marker*.json, read only), frame by frame through every cut
// window, with the fake text measure. Rulings: the erase is an eraser's soft passes that end on the board's own tone with the
// frame line intact and the next board written only after the area is clear; the pan has one hand and writing starts after it
// lands; the brand box is drawn by the pen, last; a diagram draws box, then the arrow into it, then the label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { handPlan, handPose } from '../../engine/hand/index.mjs';
import { handOutline } from '../../engine/hand/shape.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';
import { filmOf, filmFor, expandIn, canvasOf, all, FPS } from './helpers/kinds.mjs';

const look = registries.looks.get('marker');
const GATES = [['gate-marker.json', '16:9'], ['gate-marker-tall.json', '9:16']];
const SUB = 2; // samples per frame in a cut window

const specOf = (file) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${file}`, import.meta.url), 'utf8'));
// the gate film's shots with its picture swapped for the fake measure's (the test assets hold shot.png)
const shotsOf = (spec) => spec.shots.map((s) => (s.src ? { ...s, src: 'shot.png' } : s));
const gateFilm = (file, format) => filmOf(shotsOf(specOf(file)), 'marker', format, { seed: specOf(file).seed });

const isHandNode = (n) => n.props?.role === 'hand';
const inked = (n) => n.opacity > 0 && n.visible !== false && ((n.type === 'text' && n.props.layout && n.reveal > 0) || (n.type === 'path' && !isHandNode(n) && n.props.stroke !== undefined && n.draw > 0));
const inkIds = (nodes) => new Set(all(nodes).filter((n) => n.type !== 'field' && !isHandNode(n) && n.id !== 'hand' && n.id !== undefined).map((n) => n.id));
const bbox = (d) => {
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// Every frame of every cut window of a gate film: { shot, cut, t, p, frame, incoming, outgoing, canvas }.
function windows(file, format) {
  const film = gateFilm(file, format);
  const timeline = buildTimeline(film, { fps: FPS });
  const built = filmFor(film.shots, 'marker', format, { seed: film.seed });
  const canvas = canvasOf(format);
  const out = [];
  for (let i = 1; i < film.shots.length; i++) {
    const cut = resolveShotCut(film, i, { look });
    const timing = timeline.shots[i];
    const dur = Math.min(cut.dur, timing.duration);
    const incoming = inkIds(built.sampleShot(i, timing.duration));
    const outgoing = inkIds(built.sampleShot(i - 1, timeline.shots[i - 1].duration));
    const steps = Math.round(dur * FPS * SUB);
    for (let k = 1; k < steps; k++) {
      const local = k / (FPS * SUB);
      out.push({ shot: film.shots[i].id, cut, local, p: local / dur, frame: built.sampleAt(timing.start + local), incoming, outgoing, canvas, built, index: i, timing });
    }
  }
  return out;
}

for (const [file, format] of GATES) {
  const wins = windows(file, format);
  const byCut = (name) => wins.filter((w) => w.cut.name === name);

  test(`${format}: the cut windows of the gate film hold both an erase and a pan (the frames sampled below)`, () => {
    assert.ok(byCut('erase').length > 0 && byCut('slide').length > 0, `cuts: ${[...new Set(wins.map((w) => w.cut.name))].join(', ')}`);
  });

  test(`${format}: at every frame of every cut there is at most one hand`, () => {
    for (const w of wins) {
      const hands = w.frame.filter((n) => n.id === 'hand' && n.type === 'group');
      assert.ok(hands.length <= 1, `${w.shot} (${w.cut.name}) at ${w.local.toFixed(3)} s: ${hands.length} hands`);
    }
  });

  test(`${format}: nothing of the incoming board is written before its cut ends`, () => {
    for (const w of wins) {
      const early = all(w.frame).filter((n) => inked(n) && w.incoming.has(n.id)).map((n) => n.id);
      assert.deepEqual(early, [], `${w.shot} (${w.cut.name}) at ${w.local.toFixed(3)} s shows incoming ink`);
    }
  });

  test(`${format}: no frame of an erase paints paper over the board (the field and its frame line stay), and the old ink is gone by the end`, () => {
    const paper = look.palette.paper.toLowerCase();
    for (const w of byCut('erase')) {
      assert.ok(w.frame.some((n) => n.type === 'field'), `${w.shot}: the board's field is in the frame`);
      const painted = all(w.frame).filter((n) => n.type === 'path' && !isHandNode(n) && typeof n.props.fill === 'string' && n.props.fill.toLowerCase() === paper && n.props.blend === undefined);
      const big = painted.filter((n) => { const [x0, y0, x1, y1] = bbox(n.props.d); return (x1 - x0) * (y1 - y0) > 0.05 * w.canvas.w * w.canvas.h; });
      assert.deepEqual(big.map((n) => n.id), [], `${w.shot} at ${w.local.toFixed(3)} s: a paper-coloured rectangle covers the board`);
    }
    // the old ink is taken off by masks (destination-out): by the end of the passes every row of the board is under a full-strength one
    for (const last of wins.filter((w) => w.cut.name === 'erase' && w.p > 0.9 && w.p < 1)) {
      const masks = all(last.frame).filter((n) => n.props.blend === 'destination-out' && n.opacity === 1).map((n) => bbox(n.props.d));
      for (let y = 1; y < last.canvas.h; y += 12) {
        const row = masks.filter(([, y0, , y1]) => y >= y0 && y <= y1);
        assert.ok(row.some(([x0, , x1]) => x0 <= 0 && x1 >= last.canvas.w), `${last.shot}: the board at y ${y} is not wiped clean at ${last.local.toFixed(3)} s`);
      }
    }
  });

  test(`${format}: an erase is done by a felt eraser held by the hand (the one tool in the frame, marker or eraser)`, () => {
    const eraseFrames = byCut('erase');
    const withEraser = eraseFrames.filter((w) => all(w.frame).some((n) => n.id === 'hand.eraser'));
    assert.ok(withEraser.length >= eraseFrames.length * 0.5, `the eraser is in ${withEraser.length} of ${eraseFrames.length} sampled erase frames`);
    for (const w of eraseFrames) {
      const tools = ['hand.eraser', 'hand.nib'].filter((id) => all(w.frame).some((n) => n.id === id));
      assert.ok(tools.length <= 1, `${w.shot} at ${w.local.toFixed(3)} s holds ${tools.join(' and ')}`);
    }
  });

  test(`${format}: the hand never jumps at a cut (no step over a fifth of the board per frame) and lands where the next board's first stroke is`, () => {
    for (const cutShot of new Set(wins.map((w) => w.index))) {
      const mine = wins.filter((w) => w.index === cutShot);
      const handOf = (w) => w.frame.find((n) => n.id === 'hand');
      const seen = mine.map(handOf);
      for (let k = 1; k < seen.length; k++) {
        if (!seen[k] || !seen[k - 1]) continue;
        // a hand out of frame on the right (its tip beyond the edge, its body further out) is not seen: the tool swap there is no jump
        if (seen[k].x > mine[0].canvas.w && seen[k - 1].x > mine[0].canvas.w) continue;
        const step = Math.hypot(seen[k].x - seen[k - 1].x, seen[k].y - seen[k - 1].y);
        assert.ok(step < 0.2 * mine[0].canvas.w, `${mine[0].shot}: the hand steps ${Math.round(step)} px at ${mine[k].local.toFixed(3)} s`);
      }
      const after = mine[0].built.sampleAt(mine[0].timing.start + Math.min(mine[0].cut.dur, mine[0].timing.duration)).find((n) => n.id === 'hand');
      const lastSeen = seen.findLast(Boolean);
      assert.ok(after && lastSeen && Math.hypot(after.x - lastSeen.x, after.y - lastSeen.y) < 0.12 * mine[0].canvas.w, `${mine[0].shot}: the hand lands where the writing starts`);
    }
  });
}

// ---- ruling 3: the brand box is drawn by the pen, last on the close, after the headline finishes ----

for (const [file, format] of GATES) {
  test(`${format} close: the brand box is drawn stroke by stroke by the pen, after the headline and the ask`, () => {
    const film = gateFilm(file, format);
    const index = film.shots.findIndex((s) => s.id === 'close');
    const { nodes, timing, ctx } = expandIn(film, index);
    const { plan } = handPlan(nodes, timing, ctx);
    const markStrokes = plan.filter((s) => s.node.startsWith('close.mark'));
    assert.ok(markStrokes.length >= 2, 'the badge is drawn: its outline and its words are strokes of the plan');
    const before = plan.filter((s) => !s.node.startsWith('close.mark'));
    assert.ok(Math.min(...markStrokes.map((s) => s.start)) >= Math.max(...before.map((s) => s.end)) - 1e-6, 'the badge starts after the headline and the ask are finished');
    assert.ok(markStrokes.every((s) => s.end > 0 && !s.put), 'none is set on frame 0');
  });
}

// ---- nothing is on the board without the pen: a run that does not fit its sentence is a finding, never a stroke set at once ----

test('a list after a cut with little time sets nothing at once: every step figure is a stroke of the plan (noSet)', () => {
  for (const format of ['16:9', '9:16']) {
    const quick = { id: 'learned', show: 'list', title: 'What we learned', say: 'Hi.', items: Array.from({ length: 8 }, (_, i) => `Item number ${i} is long enough to write`) };
    const film = filmOf([{ id: 'open', show: 'statement', say: 'Hi.' }, quick], 'marker', format);
    const { nodes, timing, ctx } = expandIn(film, 1);
    assert.ok(ctx.lead > 1, `the erase leads the shot (${ctx.lead} s)`);
    const { plan, set } = handPlan(nodes, timing, ctx);
    // the scenario bites: without noSet the same shot sets its figures at once
    const loose = handPlan(nodes, timing, { ...ctx, look: { ...ctx.look, hand: { ...ctx.look.hand, noSet: false } } });
    assert.ok(loose.set.length > 0, `${format}: with noSet off this shot would set ${loose.set.length} strokes at once`);
    assert.deepEqual(set, [], `${format}: nothing is set at once`);
    assert.ok(plan.filter((s) => /\.figure\d/.test(s.node)).length === 8, `${format}: the eight figures are drawn`);
  }
});

// ---- ruling 4: inside a diagram, each box before its label, the arrow only after both boxes (and ahead of the target's label) ----

for (const [file, format] of GATES) {
  test(`${format} flow: the box, then the arrow into it, then its label; no arrow before its target box, no label before its box`, () => {
    const film = gateFilm(file, format);
    const index = film.shots.findIndex((s) => s.id === 'flow');
    const { nodes, timing, ctx } = expandIn(film, index);
    const { plan } = handPlan(nodes, timing, ctx);
    const span = (prefix) => {
      const mine = plan.filter((s) => s.node.startsWith(prefix));
      assert.ok(mine.length > 0, `${prefix} is drawn`);
      return { start: Math.min(...mine.map((s) => s.start)), end: Math.max(...mine.map((s) => s.end)) };
    };
    for (let k = 0; k < 4; k++) {
      const box = span(`flow.node${k}.card`), label = span(`flow.node${k}.label`);
      assert.ok(label.start >= box.end - 1e-6, `label ${k} is written after its own box is drawn`);
      if (k === 0) continue;
      const arrow = span(`flow.edge${k - 1}.`);
      assert.ok(arrow.start >= span(`flow.node${k - 1}.card`).end - 1e-6 && arrow.start >= box.end - 1e-6, `arrow ${k - 1} starts after both of its boxes exist`);
      assert.ok(arrow.end <= label.start + 1e-6, `arrow ${k - 1} is finished before the target's label is written (the hand never rests over a finished label)`);
    }
  });
}

// ---- ruling 6: hierarchy and wording on the boards ----

const GAP = { id: 'gap', show: 'compare', say: 'The North bought about three times as many as the West.',
  left: { title: 'North', value: '182', points: ['orders'] }, right: { title: 'West', value: '59', points: ['orders'] } };
const byIdIn = (nodes, id) => all(nodes).find((n) => n.id === id);

for (const format of ['16:9', '9:16']) {
  test(`${format} compare: the vs is written in the look's own face, and each label is one line ("North orders"), the bar's caption`, () => {
    const { nodes } = expandIn(filmOf([GAP], 'marker', format), 0);
    const vs = byIdIn(nodes, 'gap.vs');
    assert.ok(vs && vs.type === 'text', 'the vs is a text, not drawn strokes of its own');
    assert.equal(vs.props.font.family, look.fonts.display.family, 'in the handwriting face');
    for (const side of ['left', 'right']) {
      const title = byIdIn(nodes, `gap.${side}.title`);
      assert.equal(title.props.layout.lines.length, 1, `${side}: one line`);
      assert.match(title.props.layout.lines[0].words.map((w) => w.text).join(' '), /orders$/, `${side}: the label names what the bar counts`);
      assert.ok(byIdIn(nodes, `gap.${side}.bar`), `${side}: the bar under its label`);
    }
  });
}

test('9:16 open: the lines of the question are set at most 1.7 times their size apart (1.75 before m5; the ban 2 fill of 65 percent in marker-tall.test.mjs stops it going tighter)', () => {
  const { nodes } = expandIn(filmOf([{ id: 'open', show: 'statement', kicker: 'Ridgeline Prints', say: 'Where does one *order* go?' }], 'marker', '9:16'), 0);
  const text = byIdIn(nodes, 'open.text');
  const [a, b] = text.props.layout.lines;
  assert.ok((b.y - a.y) / text.props.font.size <= 1.7 + 1e-6, `leading ${((b.y - a.y) / text.props.font.size).toFixed(2)}`);
});

// ---- ruling 5: the hand at rest is never over finished writing (the last frame of a shot is the cut's first), never cropped ----

const inBox = ([px, py], [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;
const textBoxes = (nodes) => nodes.filter((n) => n.type === 'text' && n.props.layout && n.props.font).flatMap((n) => n.props.layout.lines.map((line) => {
  const size = n.props.font.size;
  return { id: n.id, box: [n.props.x + line.x, n.props.y + line.y - 0.74 * size, line.width, 0.96 * size] };
}));

for (const [file, format] of GATES) {
  test(`${format}: on the last frame of every shot the hand is at rest, clear of every finished line, and no frame crops it at the bottom`, () => {
    const film = gateFilm(file, format);
    film.shots.forEach((shot, index) => {
      const { nodes, timing, ctx } = expandIn(structuredClone(film), index);
      const { nodes: flat, plan, rest } = handPlan(nodes, timing, ctx);
      const outline = handOutline(ctx.look, ctx.unit);
      const polyAt = (t) => {
        const pose = handPose(plan, t, ctx.look, { canvas: ctx.canvas, unit: ctx.unit, rest });
        const r = (pose.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        return { pose, poly: outline.map(([x, y]) => [pose.x + x * c - y * s, pose.y + x * s + y * c]) };
      };
      const end = polyAt(timing.duration);
      assert.equal(end.pose.resting, true, `${shot.id}: the hand is at rest on the last frame`);
      const over = textBoxes(flat).filter((t) => end.poly.some((p) => inBox(p, t.box))).map((t) => t.id);
      assert.deepEqual(over, [], `${shot.id}: the resting hand is over finished writing`);
      for (let f = 0; f <= Math.ceil(timing.duration * FPS); f++) {
        const t = Math.min(timing.duration, f / FPS);
        const low = Math.max(...polyAt(t).poly.map(([, y]) => y));
        assert.ok(low <= ctx.canvas.h, `${shot.id} at ${t.toFixed(2)} s: the hand is ${Math.round(low - ctx.canvas.h)} px below the frame`);
      }
    });
  });
}

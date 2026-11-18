// The `marker` look, sixth pass (m6), with real glyphs in the page: what the node tests cannot judge because the fake text measure
// sets Caveat wider than the page does and reports no real ink (a final "?" or full stop reaches past its advance edge). The
// gate films (references/examples/v2/gate-marker*.json, read only) are opened in the page and sampled frame by frame. Needs a
// browser (skips without one); run with --test-concurrency=1.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { handOutline } from '../../engine/hand/shape.mjs';
import { unitOf } from '../../engine/units.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const look = registries.looks.get('marker');
const EXAMPLES = fileURLToPath(new URL('../../references/examples/v2/', import.meta.url));
const GATES = [['gate-marker.json', '16:9'], ['gate-marker-tall.json', '9:16']];
const REST_EPS = 0.5; // px: a hand that has not moved is at rest
const CLEAR = 4; // px the resting pen keeps from the real ink of finished writing, at the least
const flat = (nodes) => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

const sessions = new Map();
async function open([file, format]) {
  if (sessions.has(file)) return sessions.get(file);
  const film = { fps: FPS, ...JSON.parse(readFileSync(path.join(EXAMPLES, file), 'utf8')) };
  const session = await sessionOrNull(film, { specDir: EXAMPLES });
  const opened = session ? { film, session, timeline: buildTimeline(film, { fps: FPS }), canvas: format === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 } } : null;
  sessions.set(file, opened);
  return opened;
}
after(async () => { for (const s of sessions.values()) await s?.session.close(); });

// The frames of shot `index`, each as { t, tree } (the shot's own frames: the cut that opens it is over by then, the next not begun).
const frameRange = (timeline, index) => {
  const { start, duration } = timeline.shots[index];
  return { first: Math.round(start * FPS), last: Math.round((start + duration) * FPS) - 1 };
};
const treeAt = async (session, frame) => flat(await session.page.evaluate((i) => window.__snapshot(i), frame));

const polyOf = (hand, unit) => {
  const r = ((hand.rotate ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return handOutline(look, unit).map(([x, y]) => [hand.x + x * c - y * s, hand.y + x * s + y * c]);
};
const inBox = ([px, py], [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;
function inPolygon([px, py], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const grown = ([x, y, w, h], by) => [x - by, y - by, w + 2 * by, h + 2 * by];
const touches = (poly, box) => poly.some((p) => inBox(p, box)) || [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]].some((c) => inPolygon(c, poly));

// The real ink boxes of the finished lines of a snapshot: each line from its first word's ink to its last, ascent to descent.
const inkBoxes = (tree) => tree.filter((n) => n.type === 'text' && n.layout && n.lineInk && n.reveal === 1 && n.opacity > 0 && n.layout.lines.length > 0).flatMap((n) => n.layout.lines.map((line, k) => {
  const ink = n.lineInk[k];
  if (!ink?.words?.length || !line.words?.length) return { id: n.id, box: [n.x + line.x, n.y + line.y - ink?.ascent, line.width, 0] };
  const left = n.x + line.x + line.words[0].x + ink.words[0].left, right = n.x + line.x + line.words.at(-1).x + ink.words.at(-1).right;
  return { id: n.id, box: [left, n.y + line.y - ink.ascent, right - left, ink.ascent + ink.descent] };
}));

for (const gate of GATES) {
  const [file, format] = gate;
  test(`${format}: the pen at rest never touches finished writing, on any frame of any shot (real glyphs)`, async (t) => {
    const opened = await open(gate);
    if (!opened) return t.skip('no browser');
    const { session, timeline, film } = opened;
    const unit = unitOf(opened.canvas);
    for (let index = 0; index < film.shots.length; index++) {
      const { first, last } = frameRange(timeline, index);
      const end = await treeAt(session, last);
      const endHand = end.find((n) => n.id === 'hand' && n.type === 'group');
      assert.ok(endHand, `${film.shots[index].id}: a hand on the last frame`);
      for (let frame = first; frame <= last; frame += 2) {
        const tree = frame === last ? end : await treeAt(session, frame);
        const hand = tree.find((n) => n.id === 'hand' && n.type === 'group');
        const resting = hand && Math.hypot(hand.x - endHand.x, hand.y - endHand.y) < REST_EPS && frame >= first + 0.5 * (last - first);
        if (!resting) continue;
        const poly = polyOf(hand, unit);
        assert.ok(Math.max(...poly.map(([, y]) => y)) <= opened.canvas.h, `${film.shots[index].id} at frame ${frame}: the resting hand is cropped by the bottom edge`);
        const hit = inkBoxes(tree).filter(({ box }) => touches(poly, grown(box, CLEAR)));
        assert.deepEqual(hit.map((h) => h.id), [], `${film.shots[index].id} at frame ${frame}: the resting pen touches finished work`);
      }
    }
  });

  test(`${format}: the end card's url and stamp are at the look's secondary floor in the page (${look.secondary.min})`, async (t) => {
    const opened = await open(gate);
    if (!opened) return t.skip('no browser');
    const { session, timeline, film } = opened;
    const tree = await treeAt(session, frameRange(timeline, film.shots.findIndex((s) => s.id === 'close')).last);
    const size = (id) => tree.find((n) => n.id === id)?.props.font.size;
    assert.ok(size('close.ask') >= look.secondary.min, `the url is ${size('close.ask')}`);
    assert.ok(size('close.mark.text') >= look.secondary.min, `the stamp is ${size('close.mark.text')}`);
  });

  test(`${format}: in the list and the end card the hand keeps its writing pose on every frame (real glyphs)`, async (t) => {
    const opened = await open(gate);
    if (!opened) return t.skip('no browser');
    const { session, timeline, film, canvas } = opened;
    const unit = unitOf(canvas);
    for (const id of ['learned', 'close']) {
      const { first, last } = frameRange(timeline, film.shots.findIndex((s) => s.id === id));
      for (let frame = first; frame <= last; frame += 2) {
        const tree = await treeAt(session, frame);
        const hand = tree.find((n) => n.id === 'hand' && n.type === 'group');
        // out of frame (the cut's swap of tools) and holding the eraser (turned by look.hand.eraserAngle) are not the writing hand
        if (!hand || hand.x > canvas.w || tree.some((n) => n.id === 'hand.eraser')) continue;
        assert.ok(hand.rotate >= look.hand.angle - 1e-6, `${id} at frame ${frame}: the hand is turned to ${hand.rotate.toFixed(1)}`);
      }
    }
  });
}

// The `marker` look, sixth pass (m6, gate-marker-3: ship after fixes, then listed). The medium items of that gate, each judged on
// the real gate films (references/examples/v2/gate-marker*.json, read only) with the Node fake measure: the pinned picture's
// crop keeps its subject whole, the end card's second sizes keep the look's floor, the hand keeps its writing pose, finished
// boards are held, the eraser lifts a pinned picture off before it erases the ink. What only real glyphs can judge is in
// marker-m6-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { handPlan, handPose } from '../../engine/hand/index.mjs';
import { handOutline, handNodes } from '../../engine/hand/shape.mjs';
import { unitOf } from '../../engine/units.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';
import { filmOf, filmFor, expandIn, all, IMAGES, FPS, canvasOf, viralOf, measure as fakeMeasure } from './helpers/kinds.mjs';

const look = registries.looks.get('marker');
const FORMATS = ['16:9', '9:16'];
const GATES = [['gate-marker.json', '16:9'], ['gate-marker-tall.json', '9:16']];

const specOf = (file) => JSON.parse(readFileSync(new URL(`../../references/examples/v2/${file}`, import.meta.url), 'utf8'));
const gateFilm = (file, format) => { const spec = specOf(file); return filmOf(spec.shots, 'marker', format, { seed: spec.seed }); };
const shotIndex = (film, id) => film.shots.findIndex((s) => s.id === id);

// the example photo (references/examples/v2/photo.png, 960 x 540): its sun is a disc centred at 0.70 of the width, 0.50 of the height
IMAGES.set('photo.png', { width: 960, height: 540 });
const SUN = Object.freeze({ cx: 0.7, cy: 0.5, r: 0.036 }); // r as a share of the picture's width, a little more than the disc

const PRINT = { id: 'print', show: 'media', src: 'photo.png', caption: 'Dawn Ridge', say: 'This print is Dawn Ridge.' };

// A measure with Caveat's proportions: about 0.34 em a character (the page's canvas set 19 characters at 215 in 1412 px), where the
// fake measure sets 0.55 and so lays the gate films out in more lines than the page does.
const CAVEAT_EM = 0.34;
const caveat = (text, font) => {
  const width = [...text].length * font.size * CAVEAT_EM;
  return { ...fakeMeasure(text, font), width, inkRight: width - 0.02 * font.size };
};
function expandWith(film, index, measure) {
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas) });
  return { ...registries.kinds.get(film.shots[index].show).expand(film.shots[index], ctx), timing: timeline.shots[index], ctx, canvas };
}
const fontOf = (nodes, id) => all(nodes).find((n) => n.id === id)?.props.font;

// ---- the tall picture crop keeps its subject whole ----

test('9:16 print: the crop of the photo holds the whole sun, not a window that ends on it', () => {
  const { nodes } = expandIn(filmOf([PRINT], 'marker', '9:16'), 0);
  const [sx, sy, sw, sh] = all(nodes).find((n) => n.type === 'image').props.clip;
  const pic = IMAGES.get('photo.png');
  const [x0, x1] = [(SUN.cx - SUN.r) * pic.width, (SUN.cx + SUN.r) * pic.width];
  const [y0, y1] = [SUN.cy * pic.height - SUN.r * pic.width, SUN.cy * pic.height + SUN.r * pic.width];
  assert.ok(sx <= x0 && sx + sw >= x1, `the window x ${Math.round(sx)} to ${Math.round(sx + sw)} holds the sun (${Math.round(x0)} to ${Math.round(x1)})`);
  assert.ok(sy <= y0 && sy + sh >= y1, `the window y ${Math.round(sy)} to ${Math.round(sy + sh)} holds the sun (${Math.round(y0)} to ${Math.round(y1)})`);
});

test('9:16 print: the picture and its caption are one block, centred on the board', () => {
  const { boxes } = expandIn(filmOf([PRINT], 'marker', '9:16'), 0);
  const [, top] = boxes.picture, [, captionTop, , captionHeight] = boxes.caption;
  const above = top, below = 1920 - (captionTop + captionHeight);
  assert.ok(Math.abs(above - below) < 0.06 * 1920, `space above ${Math.round(above)} and below ${Math.round(below)}`);
});

// ---- the end card's ask and mark keep the look's secondary floor ----

for (const [file, format] of GATES) {
  const film = gateFilm(file, format);
  const index = shotIndex(film, 'close');
  // A guard, not a fix: with Caveat's proportions (the page's) the gate films' closing line is 196 or more, so the url (a third of it)
  // and the stamp (as large as the url) are already at the look's minimum. The fake measure sets Caveat wider, the closing line 150
  // on 9:16 and the url 50, so it cannot judge this; marker-m6-browser.test.mjs measures the page itself.
  test(`${format} close (Caveat measure): the url and the stamp are set at the look's secondary floor (${look.secondary.min}) at the least`, () => {
    const { nodes, ctx } = expandWith(film, index, caveat);
    const floor = look.secondary.min * ctx.unit;
    const ask = fontOf(nodes, 'close.ask').size, mark = fontOf(nodes, 'close.mark.text').size;
    assert.ok(ask >= floor - 1e-6, `the url is ${ask}`);
    assert.ok(mark >= floor - 1e-6, `the stamp is ${mark}`);
  });
  test(`${format} close (Caveat measure): the closing line is held at three times the floor, so the url stays a third of it`, () => {
    const { nodes } = expandWith(film, index, caveat);
    const title = fontOf(nodes, 'close.title').size, ask = fontOf(nodes, 'close.ask').size;
    assert.ok(title >= 3 * look.secondary.min, `the closing line is ${title}`);
    assert.ok(title >= 3 * ask - 1e-6, `${title} over ${ask}`);
  });
}

for (const [file, format] of GATES) {
  test(`${format} close (Caveat measure): the stamp is as large as the url, never larger`, () => {
    const film = gateFilm(file, format);
    const { nodes } = expandWith(film, shotIndex(film, 'close'), caveat);
    const ask = fontOf(nodes, 'close.ask').size, mark = fontOf(nodes, 'close.mark.text').size;
    assert.ok(Math.abs(mark - ask) < 1e-6, `stamp ${mark}, url ${ask}`);
  });
}

// ---- the hand keeps its writing pose in the list and end shots: it never turns flat (the bottom edge may crop it while it writes a low line; at rest it is whole) ----

const lowestOf = (poly) => Math.max(...poly.map(([, y]) => y));
function handFrames(film, index, measure) {
  const { nodes, timing, ctx } = expandWith(film, index, measure);
  const { plan, rest } = handPlan(nodes, timing, ctx);
  const outline = handOutline(ctx.look, ctx.unit);
  const frames = [];
  for (let f = 0; f <= Math.ceil(timing.duration * FPS); f++) {
    const t = Math.min(timing.duration, f / FPS);
    const pose = handPose(plan, t, ctx.look, { canvas: ctx.canvas, unit: ctx.unit, rest });
    const r = (pose.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    frames.push({ t, pose, low: lowestOf(outline.map(([x, y]) => [pose.x + x * c - y * s, pose.y + x * s + y * c])) });
  }
  return { frames, canvas: ctx.canvas, rest, plan };
}

for (const [file, format] of GATES) {
  const film = gateFilm(file, format);
  for (const id of ['learned', 'close']) {
    for (const [name, measure] of [['fake measure', fakeMeasure], ['Caveat measure', caveat]]) {
      test(`${format} ${id} (${name}): the hand keeps its writing pose (${look.hand.angle} degrees) on every frame, and is never cropped at rest`, () => {
        const { frames, canvas } = handFrames(film, shotIndex(film, id), measure);
        const flat = frames.filter((f) => f.pose.angle < look.hand.angle - 1e-6);
        assert.deepEqual(flat.slice(0, 1).map((f) => `${f.pose.angle.toFixed(1)} degrees at ${f.t.toFixed(2)} s, tip y ${Math.round(f.pose.y)}`), [], `${flat.length} frames turn the hand flat`);
        // at rest on every shot; and on the end card on every frame: its stamp, drawn last, is kept above the hand's reach (bottomRoom)
        const cropped = frames.filter((f) => (f.pose.resting || id === 'close') && f.low > canvas.h);
        assert.deepEqual(cropped.slice(0, 1).map((f) => `${Math.round(f.low - canvas.h)} px below the frame at ${f.t.toFixed(2)} s`), []);
      });
    }
  }
}

// ---- a finished board is held at least 1.2 s before the erase or the pan that leaves it starts ----

const HOLD = 1.2;
for (const [file, format] of GATES) {
  const film = gateFilm(file, format);
  for (const [name, measure] of [['fake measure', fakeMeasure], ['Caveat measure', caveat]]) {
    test(`${format} (${name}): every shot's last stroke ends at least ${HOLD} s before the shot does, so the cut that leaves it starts on a board held that long`, () => {
      const held = film.shots.map((shot, index) => {
        const { nodes, timing, ctx } = expandWith(film, index, measure);
        const { plan } = handPlan(nodes, timing, ctx);
        return { id: shot.id, hold: timing.duration - Math.max(...plan.map((s) => s.end)) };
      });
      assert.deepEqual(held.filter((h) => h.hold < HOLD - 1e-6).map((h) => `${h.id} ${h.hold.toFixed(2)} s`), []);
    });
  }
}

// ---- the hand holding the eraser is the same size as the hand holding the marker ----

const extent = (d) => {
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
for (const format of FORMATS) {
  test(`${format}: every part of the eraser hand (body, thumb, index, creases) is drawn at the marker hand's size`, () => {
    const unit = unitOf(canvasOf(format));
    const marker = handNodes(look, unit), eraser = handNodes(look, unit, { tool: 'eraser', size: [600, 300] });
    for (const part of ['body', 'pocket', 'thumb', 'index']) {
      const [mw, mh] = extent(marker.find((n) => n.id === `hand.${part}`).props.d);
      const [ew, eh] = extent(eraser.find((n) => n.id === `hand.${part}`).props.d);
      assert.ok(Math.abs(ew - mw) < 0.5 && Math.abs(eh - mh) < 0.5, `${part}: ${ew.toFixed(1)} x ${eh.toFixed(1)} against ${mw.toFixed(1)} x ${mh.toFixed(1)}`);
    }
  });
}

// ---- the eraser never wipes a pinned picture as ink: the hand lifts it off first, then erases the ink ----

const pictureOf = (nodes) => nodes.find((n) => n.id !== 'erase.old' && all([n]).some((x) => x.type === 'image'));
const imageIn = (node) => all([node]).find((x) => x.type === 'image');
const handOf = (nodes) => nodes.find((n) => n.id === 'hand' && n.type === 'group');

// Every frame (two samples a frame) of the cut that opens `shotId`, with the outgoing board's resting picture.
function cutFrames(file, format, shotId) {
  const film = gateFilm(file, format);
  const index = shotIndex(film, shotId);
  const timeline = buildTimeline(film, { fps: FPS });
  const built = filmFor(film.shots, 'marker', format, { seed: film.seed });
  const cut = resolveShotCut(film, index, { look });
  const { start, duration } = timeline.shots[index];
  const dur = Math.min(cut.dur, duration);
  const rest = pictureOf(built.sampleShot(index - 1, timeline.shots[index - 1].duration));
  const frames = [];
  for (let k = 1; k < Math.round(dur * FPS * 2); k++) frames.push({ p: k / (FPS * 2 * dur), nodes: built.sampleAt(start + k / (FPS * 2)) });
  return { cut, frames, rest, canvas: canvasOf(format) };
}

for (const [file, format] of GATES) {
  test(`${format} print to gap: the erase takes the picture off the board first; no frame of the wipe cuts through it, and it is off the board before the eraser comes in`, () => {
    const { cut, frames, rest } = cutFrames(file, format, 'gap');
    assert.equal(cut.name, 'erase', 'the shot after the print is opened by the erase');
    assert.ok(rest && imageIn(rest), 'the print shot ends with a pinned picture on the board');
    const wiped = frames.filter((f) => all(f.nodes.filter((n) => n.id === 'erase.old')).some((x) => x.type === 'image'));
    assert.deepEqual(wiped.slice(0, 1).map((f) => `the picture is in the wiped layer at p ${f.p.toFixed(2)}`), []);
    const withEraser = frames.filter((f) => all(f.nodes).some((n) => n.id === 'hand.eraser'));
    assert.ok(withEraser.length > 0, 'the eraser comes in');
    const stillThere = withEraser.filter((f) => { const pic = pictureOf(f.nodes); if (!pic) return false; const image = imageIn(pic); return pic.y + (image.props.h * pic.scale) / 2 > 0; });
    assert.deepEqual(stillThere.slice(0, 1).map((f) => `a picture is still on the board at p ${f.p.toFixed(2)}`), []);
  });

  test(`${format} print to gap: the hand that lifts the picture is on it while it moves, and there is one hand in every frame`, () => {
    const { frames, rest } = cutFrames(file, format, 'gap');
    const image = imageIn(rest), half = [(image.props.w * rest.scale) / 2, (image.props.h * rest.scale) / 2];
    // the frames in which the picture is on the board (not yet off the top of the frame) and has left where it was pinned
    const moving = frames.filter((f) => { const pic = pictureOf(f.nodes); return pic && pic.y + half[1] > 0 && (Math.abs(pic.y - rest.y) > 1 || Math.abs(pic.x - rest.x) > 1); });
    assert.ok(moving.length >= 4, `the picture moves over ${moving.length} sampled frames`);
    for (const f of moving) {
      const pic = pictureOf(f.nodes), hand = handOf(f.nodes);
      assert.ok(hand, `p ${f.p.toFixed(2)}: the hand holds the picture`);
      const inside = Math.abs(hand.x - pic.x) <= half[0] + 80 && hand.y >= pic.y - half[1] - 80 && hand.y <= pic.y + half[1] + 80;
      assert.ok(inside, `p ${f.p.toFixed(2)}: the hand (${Math.round(hand.x)}, ${Math.round(hand.y)}) is on the picture (${Math.round(pic.x)}, ${Math.round(pic.y)})`);
    }
    for (const f of frames) assert.ok(f.nodes.filter((n) => n.id === 'hand' && n.type === 'group').length <= 1, `p ${f.p.toFixed(2)}: at most one hand`);
  });
}

// ---- end of tests ----

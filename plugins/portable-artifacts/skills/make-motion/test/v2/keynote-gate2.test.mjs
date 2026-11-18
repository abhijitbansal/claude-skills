// The keynote gate's revision 2 rulings (gate-keynote-2.md, the lead's n4 rulings), on the gate films' own shots
// (references/examples/v2 gate-keynote.json and gate-keynote-tall.json; a screen's picture swapped for the test picture
// of the same shape): the screens lift their region as a card at least 80 percent wide at 16:9 and hide the screen
// under it (ruling 4), the timeline runs the full width with large events (ruling 2), the close shows the product
// (ruling 3), and no layout repeats more than twice in a film (ruling 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registries } from '../../engine/registry.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { filmFor, filmOf } from './helpers/kinds.mjs';
import { drawnLeaves } from './helpers/bar.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';

const EXAMPLES = new URL('../../references/examples/v2/', import.meta.url);
const gate = (file) => JSON.parse(readFileSync(new URL(file, EXAMPLES), 'utf8'));
const WIDE = gate('gate-keynote.json');
const TALL = gate('gate-keynote-tall.json');
const withTestPicture = (shot) => (shot.src === undefined ? shot : { ...shot, src: 'shot.png' });
const shotOf = (film, id) => withTestPicture(film.shots.find((s) => s.id === id));
const CANVAS = Object.freeze({ '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 } });
const FPS = 30;
const framesOf = (duration) => Array.from({ length: Math.floor(duration * FPS) + 1 }, (_, i) => i / FPS);
const look = () => registries.looks.get('keynote');
const built = (shot, format) => filmFor([shot], 'keynote', format, { mode: 'pro' });
const union = (boxes) => {
  const [x0, y0] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  return [x0, y0, Math.max(...boxes.map((b) => b[0] + b[2])) - x0, Math.max(...boxes.map((b) => b[1] + b[3])) - y0];
};
const insideBox = (b, r, slack = 1) => b[0] >= r[0] - slack && b[1] >= r[1] - slack && b[0] + b[2] <= r[0] + r[2] + slack && b[1] + b[3] <= r[1] + r[3] + slack;
const safeBox = (format) => {
  const s = safeRectFor(CANVAS[format], look());
  return [s.left, s.top, s.right - s.left, s.bottom - s.top];
};
const LIFT_SHARE = 0.8; // ruling 4: the 16:9 card lands at least this share of the frame's width

// the region card's leaves (its paper, picture and ring; not its shadow) at t
const cardLeaves = (film, id, t) => drawnLeaves(film.sampleShot(0, t)).filter((l) => l.node.id.startsWith(`${id}.region`) && !l.node.id.includes('.shadow') && l.opacity > 0);
const screenLeaves = (film, id, t) => drawnLeaves(film.sampleShot(0, t)).filter((l) => l.node.id.startsWith(`${id}.screen`) || l.node.id.startsWith(`${id}.frame`));

// ---- ruling 4: the screens ----

for (const id of ['dash', 'month']) {
  test(`gate 16:9 ${id}: the region lands as a card at least 80 percent of the frame wide, inside the title-safe box`, () => {
    const film = built(shotOf(WIDE, id), '16:9');
    const end = cardLeaves(film, id, film.duration);
    assert.ok(end.some((l) => l.node.id === `${id}.region.image`), 'a region card with the picture');
    const card = union(end.map((l) => l.box));
    assert.ok(card[2] >= LIFT_SHARE * CANVAS['16:9'].w, `the card is ${Math.round(card[2])} px of ${CANVAS['16:9'].w}`);
    const safe = safeBox('16:9');
    for (const t of framesOf(film.duration)) {
      const parts = cardLeaves(film, id, t);
      if (parts.length === 0) continue;
      assert.ok(insideBox(union(parts.filter((l) => !l.node.id.includes('.ring')).map((l) => l.box)), safe), `at ${t.toFixed(2)} s the card ${union(parts.map((l) => l.box)).map(Math.round)} leaves the title-safe box`);
    }
  });
}

for (const [film, format, id] of [[WIDE, '16:9', 'dash'], [WIDE, '16:9', 'month'], [TALL, '9:16', 'dash']]) {
  test(`gate ${format} ${id}: the screen under the lifted card is hidden, never left dimmed under a veil`, () => {
    const b = built(shotOf(film, id), format);
    const frames = framesOf(b.duration);
    // from the first frame the card has grown past its first size (the region's own place on the screen), nothing of the
    // screen shows beside it
    const imageAt = (t) => drawnLeaves(b.sampleShot(0, t)).find((l) => l.node.id === `${id}.region.image`);
    const firstOn = frames.find((t) => imageAt(t) !== undefined);
    assert.ok(firstOn !== undefined, 'the region card');
    const landed = frames.find((t) => imageAt(t) !== undefined && imageAt(t).box[2] > imageAt(firstOn).box[2] + 1);
    assert.ok(landed !== undefined, 'the region card grows');
    for (const t of frames.filter((x) => x >= landed)) {
      const shown = screenLeaves(b, id, t).filter((l) => l.opacity > 0);
      assert.equal(shown.length, 0, `at ${t.toFixed(2)} s the screen still shows beside the card: ${shown.map((l) => l.node.id).slice(0, 3)}`);
    }
    for (const t of frames) {
      const veil = drawnLeaves(b.sampleShot(0, t)).filter((l) => l.node.id.startsWith(`${id}.focus`) && l.opacity > 0);
      assert.equal(veil.length, 0, `at ${t.toFixed(2)} s a veil dims the screenshot`);
    }
  });
}

test('gate 9:16 dash: the ring is exactly as wide as the card it rings', () => {
  const b = built(shotOf(TALL, 'dash'), '9:16');
  const end = drawnLeaves(b.sampleShot(0, b.duration));
  const card = end.find((l) => l.node.id === 'dash.region.image').box;
  const ring = union(end.filter((l) => l.node.id.startsWith('dash.ring')).map((l) => l.box));
  assert.ok(Math.abs(ring[2] - card[2]) <= 2 * 4 + 1, `ring ${Math.round(ring[2])} px round a card ${Math.round(card[2])} px`);
});

test('gate 16:9 dash: the chrome title and url are gone before the region card is on', () => {
  const b = built(shotOf(WIDE, 'dash'), '16:9');
  for (const t of framesOf(b.duration)) {
    const leaves = drawnLeaves(b.sampleShot(0, t));
    if (!leaves.some((l) => l.node.id.startsWith('dash.region'))) continue;
    const chrome = leaves.filter((l) => (l.node.id === 'dash.title' || l.node.id === 'dash.url') && l.opacity > 0);
    assert.equal(chrome.length, 0, 'at ' + t.toFixed(2) + ' s the chrome text is still on under the card');
  }
});

// ---- the whole films ----

// a gate film built whole (screens on the test picture): { b, index(id), duration(id), canvas }
function wholeFilm(film) {
  const shots = film.shots.map(withTestPicture);
  const spec = filmOf(shots, 'keynote', film.format, { mode: 'pro' });
  const timeline = buildTimeline(spec, { fps: FPS });
  const b = filmFor(shots, 'keynote', film.format, { mode: 'pro' });
  const index = (id) => shots.findIndex((s) => s.id === id);
  return { b, shots, index, duration: (id) => timeline.shots[index(id)].duration, canvas: CANVAS[film.format] };
}
const textsOf = (leaves) => leaves.filter((l) => l.node.type === 'text' && l.opacity > 0.5);
const sizeOf = (l) => l.node.props.font.size * l.scale;

// ---- ruling 2: the 16:9 timeline ----

const TODAY_EVENT = 52; // px: the event text before n4 (.scratch/n4/probe-text.mjs on the year shot, measured)
test('gate 16:9 year: the events at least twice their old size, the spoken one larger than the title, across the full width', () => {
  const w = wholeFilm(WIDE);
  const i = w.index('year');
  const shown = new Set();
  for (const t of framesOf(w.duration('year'))) {
    const texts = textsOf(drawnLeaves(w.b.sampleShot(i, t)));
    const events = texts.filter((l) => /^year\.(when|what)\d+$/.test(l.node.id));
    const title = texts.find((l) => l.node.id === 'year.title');
    for (const e of events) {
      assert.ok(sizeOf(e) >= 2 * TODAY_EVENT - 0.5, `at ${t.toFixed(2)} s ${e.node.id} is ${sizeOf(e).toFixed(1)} px`);
      if (/what/.test(e.node.id)) shown.add(e.node.id);
    }
    const spoken = events.filter((l) => /what/.test(l.node.id));
    if (title && spoken.length > 0) assert.ok(sizeOf(title) < Math.max(...spoken.map(sizeOf)), `at ${t.toFixed(2)} s the title ${sizeOf(title)} is not smaller than the spoken event`);
  }
  assert.equal(shown.size, 4, `every event's words are shown in turn (${[...shown]})`);
  const end = drawnLeaves(w.b.sampleShot(i, w.duration('year') - 0.1)).filter((l) => /^year\.(when|what|line|tick)/.test(l.node.id));
  const span = union(end.map((l) => l.box));
  const room = w.canvas.w - 2 * look().grid.margin;
  assert.ok(span[2] >= 0.9 * room, `the timeline spans ${Math.round(span[2])} of ${room} px`);
});

// ---- ruling 3: the close ----

for (const film of [WIDE, TALL]) {
  test(`gate ${film.format} close: the product on a card, the closing line, the tag and the ask aligned to the hero, the frame filled`, () => {
    const w = wholeFilm(film);
    const i = w.index('close');
    const leaves = drawnLeaves(w.b.sampleShot(i, w.duration('close') - 0.05));
    const product = leaves.find((l) => l.node.type === 'image' && l.node.props.src === 'shot.png');
    assert.ok(product, 'the product picture on the end card');
    const hero = leaves.find((l) => l.node.id === 'close.title');
    const ask = leaves.find((l) => l.node.id === 'close.ask');
    const mark = leaves.find((l) => l.node.id.startsWith('close.mark') && l.node.type === 'text');
    assert.ok(hero && ask && mark, 'the title, the ask and the mark');
    const tag = union(leaves.filter((l) => l.node.id.startsWith('close.mark') && !l.node.id.includes('.text')).map((l) => l.box));
    for (const [name, x] of [['ask', ask.box[0]], ['tag', tag[0]]]) assert.ok(Math.abs(x - hero.box[0]) <= 24, `the ${name} starts at ${Math.round(x)}, the hero at ${Math.round(hero.box[0])}`);
    const content = union([hero.box, ask.box, tag, product.box]);
    if (film.format === '16:9') {
      assert.ok(product.box[0] >= w.canvas.w / 2 - 1 && product.box[2] >= 0.3 * w.canvas.w, `the product ${product.box.map(Math.round)} fills the right half`);
      assert.ok(content[2] >= 0.8 * w.canvas.w, `the content spans ${Math.round(content[2])} px`);
    } else {
      assert.ok(product.box[2] >= 0.8 * w.canvas.w && product.box[1] >= hero.box[1] + hero.box[3], `the product ${product.box.map(Math.round)} under the line, the width of the frame`);
      assert.ok(content[3] >= 0.65 * w.canvas.h, `the content spans ${Math.round(content[3])} px of the height`);
    }
  });
}

// ---- ruling 1: layout variety ----

// A shot's layout signature from its built geometry at its last frame: whether it shows a picture, the hero's size as a
// share of the frame's short side (in tenths; 0 with no text), whether its hero starts at the left margin, and whether
// ink reaches the frame's right quarter
function signature(w, id) {
  const leaves = drawnLeaves(w.b.sampleShot(w.index(id), w.duration(id) - 0.05)).filter((l) => l.opacity > 0.5);
  const texts = textsOf(leaves);
  const hero = texts.length === 0 ? null : texts.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a));
  const picture = leaves.some((l) => l.node.type === 'image');
  const reach = Math.max(...leaves.filter((l) => l.box[2] * l.box[3] < 0.5 * w.canvas.w * w.canvas.h).map((l) => l.box[0] + l.box[2]));
  const size = hero === null ? 0 : Math.round((10 * sizeOf(hero)) / Math.min(w.canvas.w, w.canvas.h));
  return { key: [picture, size, hero !== null && hero.box[0] < w.canvas.w / 4, reach >= 0.75 * w.canvas.w].join('/'), reach };
}
const TYPE_KINDS = new Set(['statement', 'list', 'timeline', 'end']);
for (const film of [WIDE, TALL]) {
  test(`gate ${film.format}: no layout is shared by more than two shots, and no type shot leaves the right of the frame empty`, () => {
    const w = wholeFilm(film);
    const sigs = w.shots.map((s) => ({ id: s.id, show: s.show, ...signature(w, s.id) }));
    const counts = sigs.reduce((m, s) => m.set(s.key, [...(m.get(s.key) ?? []), s.id]), new Map());
    for (const [key, ids] of counts) assert.ok(ids.length <= 2, `${ids.join(', ')} share one layout (${key})`);
    if (film.format !== '16:9') return;
    for (const s of sigs.filter((x) => TYPE_KINDS.has(x.show))) assert.ok(s.reach >= 0.75 * w.canvas.w, `${s.id} leaves the right of the frame empty (ink to ${Math.round(s.reach)} px)`);
  });
}

// ---- ruling 5: the band of light crosses only the ground ----

const overlapping = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const isContent = (l) => l.node.type === 'text' || l.node.type === 'image' || /\.mark\.\d+$/.test(l.node.id);
const SWEEP_STEP = 1 / 15; // s between the frames checked
for (const film of [WIDE, TALL]) {
  test(`gate ${film.format}: the band of light is drawn under every text, picture and mark it crosses`, () => {
    const w = wholeFilm(film);
    let seen = 0;
    for (const shot of w.shots) {
      for (let t = 0; t <= w.duration(shot.id); t += SWEEP_STEP) {
        const leaves = drawnLeaves(w.b.sampleShot(w.index(shot.id), t));
        const band = leaves.map((l, k) => ({ l, k })).filter(({ l }) => l.node.id.includes('.sweep') && l.opacity > 0);
        if (band.length === 0) continue;
        seen += 1;
        const box = union(band.map(({ l }) => l.box)), last = Math.max(...band.map(({ k }) => k));
        const over = leaves.filter((l, k) => k < last && isContent(l) && overlapping(l.box, box));
        assert.equal(over.length, 0, `at ${shot.id} ${t.toFixed(2)} s the band is drawn over ${over.map((l) => l.node.id).slice(0, 3)}`);
      }
    }
    assert.ok(seen > 0, 'a band of light somewhere in the film');
  });
}

// ---- ruling 6: the 9:16 flow ----

// px two left edges on one inset may differ by: a display headline is set optically (its first glyph's side bearing
// pulled into the margin, about 0.06 em at 264), other text is not
const OPTICAL = 20;
const papersOf = (leaves) => leaves.filter((l) => /^flow\.node\d+\.card\.paper$/.test(l.node.id));
test('gate 9:16 flow: the cards on the headline\'s left edge, set on frame 0, every connector drawn whole, the last 1.2 s before the cut', () => {
  const w = wholeFilm(TALL);
  const i = w.index('flow'), d = w.duration('flow');
  const first = drawnLeaves(w.b.sampleShot(i, 0));
  const title = first.find((l) => l.node.id === 'flow.title');
  const papers = papersOf(first);
  assert.equal(papers.length, 4, `every card on frame 0 (${papers.length})`);
  for (const p of papers) assert.ok(Math.abs(p.box[0] - title.box[0]) <= OPTICAL, `${p.node.id} starts at ${Math.round(p.box[0])}, the headline at ${Math.round(title.box[0])}`);
  for (const t of framesOf(d)) {
    const edges = drawnLeaves(w.b.sampleShot(i, t)).filter((l) => /^flow\.edge\d+\.line$/.test(l.node.id));
    for (const e of edges) assert.ok((e.node.draw ?? 1) === 1, `at ${t.toFixed(2)} s ${e.node.id} is drawn ${e.node.draw}`);
    if (t <= d - 1.2) continue;
    assert.equal(papersOf(drawnLeaves(w.b.sampleShot(i, t))).filter((l) => l.opacity === 1).length, 4, 'every card on 1.2 s before the cut');
  }
});

// ---- ruling 7: the 9:16 list's inset ----

test('gate 9:16 inside: the list starts on the same left inset as the other shots', () => {
  const w = wholeFilm(TALL);
  const heroX = (id) => {
    const texts = textsOf(drawnLeaves(w.b.sampleShot(w.index(id), w.duration(id) - 0.05)));
    return texts.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a)).box[0];
  };
  const open = heroX('open');
  const items = textsOf(drawnLeaves(w.b.sampleShot(w.index('inside'), w.duration('inside') - 0.05))).filter((l) => sizeOf(l) >= 84);
  assert.ok(items.length >= 3, 'the items');
  for (const l of items) assert.ok(Math.abs(l.box[0] - open) <= OPTICAL, `${l.node.id} starts at ${Math.round(l.box[0])}, the open's hero at ${Math.round(open)}`);
});

// ---- ruling 8: soft cuts never lay one headline over another ----

const CLEAR_CUTS = new Set(['fade', 'wipe']); // a dip through the ground, a mask reveal: never both pictures at once
const HEADLINE = 84; // px at these canvases (unit 1): the look's scale step 3, the smallest headline size
for (const film of [WIDE, TALL]) {
  test(`gate ${film.format}: a cut between two type shots dips or wipes, and no three cuts in a row alike`, () => {
    const spec = filmOf(film.shots.map(withTestPicture), 'keynote', film.format, { mode: 'pro' });
    const names = film.shots.slice(1).map((_, k) => resolveShotCut(spec, k + 1, { look: look() })?.name ?? 'cut');
    // a type cut: both sides draw headline-size text (step 3 or more) at the cut, judged from the built frames, not kinds
    // (a 9:16 screen sets its title as a headline)
    const w = wholeFilm(film);
    const headline = (id, t) => textsOf(drawnLeaves(w.b.sampleShot(w.index(id), t))).some((l) => sizeOf(l) >= HEADLINE);
    names.forEach((name, k) => {
      const [a, b] = [film.shots[k].id, film.shots[k + 1].id];
      if (headline(a, w.duration(a) - 0.05) && headline(b, 0)) assert.ok(CLEAR_CUTS.has(name), `${a} to ${b} is a ${name}, over two headlines`);
      assert.ok(name !== 'cut', `${film.shots[k].id} to ${film.shots[k + 1].id} is a hard cut`);
    });
    assert.ok(names.every((n, k) => k < 2 || !(n === names[k - 1] && n === names[k - 2])), `three alike in a row: ${names.join(', ')}`);
  });
}

// ---- ruling 9: the highlighted column's note clears its top ----

test('gate 9:16 regions: the "182" note clears the North column by the values\' gap, with no tick', () => {
  const b = built(shotOf(TALL, 'regions'), '9:16');
  const end = drawnLeaves(b.sampleShot(0, b.duration));
  const mark = end.find((l) => l.node.id === 'regions.mark.0').box;
  const note = end.find((l) => l.node.id === 'regions.annotation.text').box;
  const value = end.find((l) => l.node.id === 'regions.value.1').box;
  const other = end.find((l) => l.node.id === 'regions.mark.1').box;
  const valueGap = other[1] - (value[1] + value[3]);
  assert.ok(mark[1] - (note[1] + note[3]) >= valueGap - 1, `the note clears its column by ${Math.round(mark[1] - (note[1] + note[3]))} px (the values by ${Math.round(valueGap)})`);
  assert.ok(!end.some((l) => l.node.id === 'regions.annotation.leader'), 'no leader tick on the column');
});

// The open concerns of poster's Task 7 (round three ruling 3), each a behaviour of a kind in poster: media at 9:16 as a
// cut-out with the caption under it in the ground's ink (look.kinds.media.fitTall); and the others below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { snapshotOf, drawnLeaves } from './helpers/bar.mjs';
import { filmFor, filmOf, all } from './helpers/kinds.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';

const CLIP_STEP = 0.25; // s between the frames the clipping caption check samples

const MEDIA = Object.freeze({ id: 'catch', show: 'media', src: 'shot.png', say: 'Every morning the boats bring in the catch.', caption: 'The morning catch' });
const nodesAt = (shots, look, format, mode, t, index = 0) => all(snapshotOf(filmFor(shots, look, format, { mode }).sampleShot(index, t)));
const isCutout = (nodes, id) => nodes.some((n) => n.id === `${id}.picture.cutout` || n.id.startsWith(`${id}.picture.cutout.`));

for (const mode of ['pro', 'viral']) {
  test(`poster media at 9:16 in ${mode}: a cut-out with the caption under it in the ground's ink`, () => {
    const nodes = nodesAt([MEDIA], 'poster', '9:16', mode, 3);
    assert.ok(isCutout(nodes, 'catch'), 'the picture is a cut-out');
    const caption = nodes.find((n) => n.id === 'catch.caption');
    const picture = nodes.find((n) => n.id === 'catch.picture');
    assert.ok(caption.bbox[1] >= picture.bbox[1] + picture.bbox[3] - 1, `caption ${caption.bbox.map(Math.round)} under picture ${picture.bbox.map(Math.round)}`);
    assert.equal(caption.props.fill, lookOfShot(filmOf([MEDIA], 'poster', '9:16', { mode }), 0).palette.ink);
  });
}

test('poster media at 16:9 stays full bleed, and a shot\'s own fit wins at 9:16', () => {
  assert.equal(isCutout(nodesAt([MEDIA], 'poster', '16:9', 'pro', 3), 'catch'), false);
  assert.equal(isCutout(nodesAt([{ ...MEDIA, fit: 'bleed' }], 'poster', '9:16', 'pro', 3), 'catch'), false);
});

// free: a shot written by hand keeps its own background (the ground sheet hid it)
test('poster free: a hand-written shot keeps its own background, with no ground sheet over it', () => {
  const FREE = { id: 'bar', show: 'free', hold: 2, background: '#ffcc00', nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H780V580H300Z', fill: '#141414' } }] };
  const built = filmFor([FREE], 'poster', '16:9', { mode: 'pro' });
  const first = built.sampleShot(0, 1)[0];
  assert.equal(first.id, 'bar', `first node ${first.id}`);
  assert.equal(built.backgrounds[0], '#ffcc00');
});

// quote: the opening mark set on frame 0 in a look that opens set (it landed over the enter move: 2 frames late)
for (const format of ['16:9', '9:16']) {
  test(`poster quote at ${format}: the opening mark is whole on frame 0`, () => {
    const QUOTE = { id: 'voice', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' };
    const mark = all(filmFor([{ id: 'f', show: 'statement', say: 'Hi' }, QUOTE], 'poster', format, { mode: 'pro' }).sampleShot(1, 0)).find((n) => n.id === 'voice.mark');
    assert.equal(mark.opacity, 1);
  });
}

// feed, code, screen: no text under step 3 on a display-only pair (ink on red, red on paper): a plate's text is the
// plate ground's own ink (palette `plateText`), not the ground's ink (feed's ink on red at text size)
const DISPLAY_FROM = 3;
const SAMPLES = Object.freeze([1, 2.5]);
const GROUND_SHOTS = 12; // a film this long at seed 1 stands a shot on each of the four grounds (asserted)
function groundUnder(sampled, text) {
  const leaves = all(sampled);
  const at = leaves.indexOf(text);
  const [cx, cy] = [text.bbox[0] + text.bbox[2] / 2, text.bbox[1] + text.bbox[3] / 2];
  const holds = (b) => b && cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3];
  const under = leaves.slice(0, at).filter((n) => n.type === 'path' && /^#[0-9a-f]{6}$/i.test(n.props.fill ?? '') && n.opacity >= 1 && holds(n.bbox));
  return under.at(-1)?.props.fill ?? null;
}
const WALKED = Object.freeze(registries.kinds.names().filter((k) => !['free', 'number'].includes(k))); // number: parked
for (const kind of WALKED) {
  for (const format of ['16:9', '9:16']) {
    test(`poster ${kind} at ${format}: no text under step 3 on a display-only pair, on every ground`, () => {
      const look = registries.looks.get('poster');
      const p = look.palette;
      const banned = [[p.ink, p.accent], [p.accent, p.paper]].map((pair) => pair.join('/').toLowerCase());
      const ex = registries.kinds.get(kind).example;
      const shots = Array.from({ length: GROUND_SHOTS },(_, i) => ({ ...ex, id: `${kind}${i}`, ...(ex.src === undefined ? {} : { src: 'shot.png' }) }));
      const film = filmOf(shots, 'poster', format, { mode: 'pro' });
      const prepared = ['code', 'map'].includes(kind) ? prepareFilm(film, { filmDir: '.' }).prepared : {};
      const built = filmFor(shots, 'poster', format, { mode: 'pro' }, { prepared });
      const floor = look.scale[DISPLAY_FROM - 1] * (format === '16:9' ? 1 : 1);
      const grounds = new Set(shots.map((_, i) => lookOfShot(film, i).ground));
      assert.equal(grounds.size, 4, `the films cover every ground (${[...grounds]})`);
      const bad = shots.flatMap((_, i) => SAMPLES.flatMap((t) => {
        const sampled = snapshotOf(built.sampleShot(i, t));
        return all(sampled).filter((n) => n.type === 'text' && n.opacity > 0 && n.props.font.size < floor).flatMap((text) => {
          const pair = `${text.props.fill}/${groundUnder(sampled, text)}`.toLowerCase();
          return banned.includes(pair) ? [`${text.id} at ${t} s: ${pair} at ${text.props.font.size}px`] : [];
        });
      }));
      assert.deepEqual([...new Set(bad)], []);
    });
  }
}

// clipping: the caption sits under the whole close-up (its context window), never over the zoomed picture (at 9:16
// the example marks its region on the establishing picture: no close-up)
for (const format of ['16:9']) {
  test(`poster clipping at ${format}: the caption never lies on a close-up's picture`, () => {
    const ex = listEntries('kinds').find((e) => e.name === 'clipping').example;
    const shot = { ...ex, src: 'shot.png' };
    const built = filmFor([shot], 'poster', format, { mode: 'pro' });
    const meets = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const bad = [];
    let seen = 0;
    for (let t = 0; t <= built.duration; t += CLIP_STEP) {
      const leaves = drawnLeaves(built.sampleShot(0, t));
      const photos = leaves.filter((l) => l.node.type === 'image' && /\.close\d+\..*image$/.test(l.node.id));
      const captions = leaves.filter((l) => l.node.type === 'text' && /caption/.test(l.node.id));
      if (photos.length > 0 && captions.length > 0) seen += 1;
      for (const c of captions) for (const p of photos) if (meets(c.box, p.box)) bad.push(`at ${t.toFixed(2)} s: ${c.node.id} ${c.box.map(Math.round)} on ${p.node.id} ${p.box.map(Math.round)}`);
    }
    assert.ok(seen > 0, 'a close-up and the caption share a frame');
    assert.deepEqual(bad, []);
  });
}

// end's ask plate and feed's bubbles: no filled mark on a banned pair with what lies under it (red on blue, blue on red,
// ink on blue, blue on ink); the plate is red on the blue ground, so neither uses it
for (const kind of ['end', 'feed']) {
  test(`poster ${kind}: no plate on a banned pair with its ground, on every ground`, () => {
    const p = registries.looks.get('poster').palette;
    const banned = [[p.accent, p.accent2], [p.accent2, p.accent], [p.ink, p.accent2], [p.accent2, p.ink]].map((pair) => pair.join('/').toLowerCase());
    const ex = registries.kinds.get(kind).example;
    const shots = Array.from({ length: GROUND_SHOTS }, (_, i) => ({ ...ex, id: `${kind}${i}` }));
    const built = filmFor(shots, 'poster', '16:9', { mode: 'pro' });
    const bad = shots.flatMap((_, i) => {
      const sampled = snapshotOf(built.sampleShot(i, SAMPLES[1]));
      return all(sampled).filter((n) => n.type === 'path' && n.id !== 'ground' && /^#[0-9a-f]{6}$/i.test(n.props.fill ?? '') && n.opacity > 0).flatMap((mark) => {
        const pair = `${mark.props.fill}/${groundUnder(sampled, mark)}`.toLowerCase();
        return banned.includes(pair) ? [`${mark.id}: ${pair}`] : [];
      });
    });
    assert.deepEqual([...new Set(bad)], []);
  });
}

// map: at 9:16 the whole land inside the frame (the tall crop cut the Americas off at its edge, ban 10)
for (const mode of ['pro', 'viral']) {
  test(`poster map at 9:16 in ${mode}: the land lies inside the frame`, () => {
    const ex = registries.kinds.get('map').example;
    const film = filmOf([ex], 'poster', '9:16', { mode });
    const built = filmFor([ex], 'poster', '9:16', { mode }, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
    const land = drawnLeaves(built.sampleShot(0, 2)).find((l) => /\.land$/.test(l.node.id));
    assert.ok(land.box[0] >= 0 && land.box[0] + land.box[2] <= 1080, `land ${land.box.map(Math.round)}`);
  });
}

// screen at 9:16: the route to the region panel draws only once the panel is there (a stray tick under the frame), and a
// panel crop near the picture's width takes the whole width (words were cut at its left edge)
const screenTall = () => {
  const ex = listEntries('kinds').find((e) => e.name === 'screen').example;
  return { shot: { ...ex, src: 'shot.png' }, built: filmFor([{ ...ex, src: 'shot.png' }], 'poster', '9:16', { mode: 'pro' }) };
};
test('poster screen at 9:16: the route to the region panel is never drawn while the panel is not on screen', () => {
  const { built } = screenTall();
  const bad = [];
  for (let t = 0; t <= built.duration; t += 1 / 30) {
    const nodes = all(built.sampleShot(0, t));
    const panel = nodes.find((n) => /\.panel$/.test(n.id));
    const route = nodes.filter((n) => /\.link/.test(n.id) && n.type === 'path' && (n.draw ?? 1) > 0 && (n.opacity ?? 1) > 0);
    if (panel && (panel.opacity ?? 1) <= 0 && route.length > 0) bad.push(t.toFixed(2));
  }
  assert.deepEqual(bad, []);
});
test('poster screen at 9:16: a region panel near the picture width shows the whole width', () => {
  const { built } = screenTall();
  const image = all(built.sampleShot(0, built.duration)).find((n) => /\.panel\.image$/.test(n.id) || (/\.panel\./.test(n.id) && n.type === 'image'));
  assert.ok(image, 'a panel image');
  assert.deepEqual([image.props.clip[0], image.props.clip[2]], [0, 1600]);
});

// captions (the plan's caption width step): in poster the spoken word steps one width keyword wider, in room reserved at
// that width, and nothing is recoloured (red caption words on paper were a display-only pair at text size)
test('poster captions: the spoken word steps one width wider and keeps its colour', () => {
  const CLIP = { id: 'c', show: 'clipping', src: 'shot.png', say: 'This one shows the query behind every chart.' };
  const extra = { mode: 'viral', captions: true };
  const built = filmFor([CLIP], 'poster', '9:16', extra);
  const query = buildTimeline(filmOf([CLIP], 'poster', '9:16', extra), { fps: 30 }).shots[0].words.find((w) => /query/.test(w.text));
  const caption = all(built.sampleShot(0, query.start + 0.05)).find((n) => n.type === 'text' && n.props.role === 'caption' && (n.opacity ?? 1) > 0
    && n.props.layout.lines.some((l) => l.words.some((w) => /QUERY/.test(w.text))));
  assert.ok(caption, 'the caption with the spoken word');
  assert.equal(caption.props.layout.reserve?.width, 'condensed', 'room reserved at the wider keyword');
  const words = caption.props.layout.lines.flatMap((l) => l.words);
  const spoken = words.find((w) => /QUERY/.test(w.text)).index;
  const base = registries.looks.get('poster').fonts.display.width;
  words.forEach(({ index }) => {
    const state = caption.words[index];
    assert.equal(state.fill ?? caption.props.fill, caption.props.fill, `word ${index}: no recolour`);
    assert.equal(state.width, index === spoken ? 'condensed' : base, `word ${index}: width`);
  });
});

test('pop (no fitTall data) keeps media full bleed at 9:16', () => {
  assert.equal(registries.looks.get('pop').kinds.media.fitTall, undefined);
  assert.equal(isCutout(nodesAt([MEDIA], 'pop', '9:16', 'viral', 3), 'catch'), false);
});

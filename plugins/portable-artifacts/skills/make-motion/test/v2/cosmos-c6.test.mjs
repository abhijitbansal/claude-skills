// The look-review items of gate-cosmos-b-1 (.superpowers/sdd/2026-11-16-pa2-run2/gate-cosmos-b-1.md) that c6 fixes in
// cosmos's data and the small engine options they need. Each test names the item it holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { kindContext } from '../../engine/captions/index.mjs';
import { sample } from '../../engine/time/track.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { all, measure, canvasOf, viralOf, filmOf, expandIn, IMAGES, FPS } from './helpers/kinds.mjs';

const exampleFilm = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../references/examples/v2/${name}.json`, import.meta.url)), 'utf8'));

// Shot `id` of `film` expanded as buildFilm does, captions' room included (the narration's estimated words).
function expandCaptioned(film, id) {
  const index = film.shots.findIndex((s) => s.id === id);
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index, timeline, canvas, measure, assets: IMAGES, viralInsets: viralOf(canvas), prepared: {} });
  const kind = registries.kinds.get(film.shots[index].show);
  return { ...kind.expand(film.shots[index], kindContext(film, kind, ctx)), ctx };
}

// review c6, tall print: "the 9:16 crop drops the sun". The media shot's `focus` keeps a marked subject inside the cover crop
// (a guard: this held already; the review's film named no focus, so the centre crop cut the sun at 0.7 of the width away).
test('a tall bleed picture crops around the shot\'s focus: the marked subject is inside the window', () => {
  const shot = { id: 'print', show: 'media', src: 'shot.png', focus: [0.7, 0.5], caption: 'Dawn Ridge sells best', say: 'Dawn Ridge sells best.' };
  const out = expandIn(filmOf([shot], 'cosmos', '9:16', { mode: 'viral' }));
  const image = all(out.nodes).find((n) => n.type === 'image');
  const [sx, , sw] = image.props.clip;
  assert.ok(sx <= 0.7 * 1600 && 0.7 * 1600 <= sx + sw, `window ${Math.round(sx)} to ${Math.round(sx + sw)} holds x = 1120`);
});

// review c6, close (tall): "no URL or brand sign-off", the first frame "A" alone then "A ridge for / the" half faded.
// (tall: a line long enough that the fake measure needs four lines at the hero floor, as the real glyphs did for the
// shorter one on the review's film)
const CLOSE = { id: 'close', show: 'end', ask: 'ridgelineprints.shop', mark: 'Ridgeline' };
const closeFilm = (format) => filmOf([{ ...CLOSE, say: format === '9:16' ? 'A ridge for the whole North.' : 'A ridge for the North.' }], 'cosmos', format, { mode: format === '9:16' ? 'viral' : 'pro' });
for (const format of ['16:9', '9:16']) {
  test(`cosmos close at ${format}: the line, the URL and the mark are all kept (the title fits its band at the hero floor)`, () => {
    const out = expandCaptioned(closeFilm(format), 'close');
    const nodes = all(out.nodes);
    assert.equal(nodes.find((n) => n.id === 'close.title').props.dropped, undefined, 'nothing left out');
    assert.ok(nodes.find((n) => n.id === 'close.ask'), 'the URL is drawn');
    assert.ok(nodes.find((n) => n.id === 'close.mark.text'), 'the mark is drawn');
  });

  test(`cosmos close at ${format}: it opens with its full line set (every word, the URL and the mark opaque on frame 0)`, () => {
    const out = expandCaptioned(closeFilm(format), 'close');
    const parts = all(out.nodes).filter((n) => ['close.title', 'close.ask', 'close.mark.text'].includes(n.id));
    assert.equal(parts.length, 3);
    for (const part of parts) {
      for (const tracks of [part.tracks, ...(part.wordTracks ?? [])]) {
        if (tracks.opacity !== undefined) assert.equal(sample(tracks.opacity, 0), 1, `${part.id} opaque on frame 0`);
      }
    }
  });
}

// Item 2 (the viral gate film's giants shot dropped its source line): the claim at its 168 maximum takes three lines of a
// tall frame, the source at the secondary floor wraps to two, and the bars need a row each; with the captions' room taken
// off the band's foot (at 0.75 of the height) the plot was a few units short of its rows, so the source went.
test('cosmos viral gate film: the giants chart keeps its source line (the tall band leaves room for the rows and the source)', () => {
  const film = exampleFilm('gate-cosmos-viral');
  const out = expandCaptioned(film, 'giants');
  const nodes = all(out.nodes);
  assert.ok(nodes.find((n) => n.id === 'giants.source'), 'the source line is drawn');
  assert.equal(nodes.find((n) => n.id === 'giants.title').props.dropped, undefined, 'the title records nothing left out');
});

// ---- the cosmos motif: the active item lit as a glowing disc or ring (review: "the style's motifs appear only in hook
// and close ... never the disc or glow to mark the active item") ----
const FLOW = { id: 'flow', show: 'diagram', nodes: [{ id: 'order', label: 'Order' }, { id: 'print', label: 'Print' }, { id: 'pack', label: 'Pack' }, { id: 'ship', label: 'Ship' }], edges: [{ from: 'order', to: 'print' }, { from: 'print', to: 'pack' }, { from: 'pack', to: 'ship' }], say: 'Order. Print. Pack. Ship.' };
const STEP = 0.05;
const timesTo = (duration) => Array.from({ length: Math.floor(duration / STEP) + 1 }, (_, i) => i * STEP);
const opacityOf = (n, t) => (n.tracks.opacity === undefined ? 1 : sample(n.tracks.opacity, t));
const litWindows = (nodes, idOf, count, duration) => Array.from({ length: count }, (_, k) => {
  const n = nodes.find((m) => m.id === idOf(k));
  assert.ok(n, `${idOf(k)} is drawn`);
  return timesTo(duration).filter((t) => opacityOf(n, t) > 0.99);
});

const YEAR = { id: 'year', show: 'timeline', events: [{ when: 'Mar', what: 'First print sold' }, { when: 'Jun', what: 'Shop online' }, { when: 'Dec', what: 'Orders dashboard' }], say: 'March: first print sold. June: shop online. December: a dashboard.' };
for (const format of ['16:9', '9:16']) {
  test(`cosmos timeline at ${format}: each event sits on a disc node, the spoken event's disc glows in the accent, one at a time`, () => {
    const out = expandCaptioned(filmOf([YEAR], 'cosmos', format, { mode: format === '9:16' ? 'viral' : 'pro' }), 'year');
    const nodes = all(out.nodes);
    const duration = out.ctx.timing.duration;
    for (let k = 0; k < 3; k++) assert.ok(nodes.find((n) => n.id === `year.disc${k}`), `event ${k} has a disc`);
    const windows = litWindows(nodes, (k) => `year.disc${k}.halo`, 3, duration);
    windows.forEach((w, k) => assert.ok(w.length > 0, `event ${k}'s disc glows at some time`));
    for (const t of timesTo(duration)) assert.ok(windows.filter((w) => w.includes(t)).length <= 1, `at ${t.toFixed(2)} s more than one disc glows`);
  });
}

// review c6, map and code: "the card shows a lighter lower half with a visible horizontal tone step": the sheen over the
// top of every rounded card is the step; cosmos's cards are one tone (their edge and the ground glow keep the depth).
test('cosmos cards are one tone: no sheen over the top of the map sheet or the code panel', () => {
  const MAP = { id: 'reach', show: 'map', region: 'world', title: 'Where prints go', places: [{ name: 'Denver', at: [-104.99, 39.74] }], say: 'Printed in Denver.' };
  const CODE = { id: 'count', show: 'code', lang: 'js', title: 'By region', code: 'const n = {}\nlog(n)', say: 'Count them.' };
  for (const shot of [MAP, CODE]) {
    const film = filmOf([shot], 'cosmos', '16:9', { mode: 'pro' });
    const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
    const out = expandIn(film, 0, { prepared });
    const cards = all(out.nodes).filter((n) => /\.paper$/.test(n.id));
    assert.ok(cards.length > 0, `${shot.show}: a card is drawn`);
    assert.equal(all(out.nodes).filter((n) => /\.sheen$/.test(n.id)).length, 0, `${shot.show}: no sheen group`);
  }
});

// review c6, year: "the captions are illegible at phone size ... 'Mar' and 'Jun' sit so close the captions nearly collide"
for (const format of ['16:9', '9:16']) {
  test(`cosmos timeline at ${format}: the captions are at least the secondary minimum and no two events' words touch`, () => {
    const out = expandCaptioned(filmOf([YEAR], 'cosmos', format, { mode: format === '9:16' ? 'viral' : 'pro' }), 'year');
    const nodes = all(out.nodes);
    const floor = registries.looks.get('cosmos').secondary.min * out.ctx.unit;
    const whats = [0, 1, 2].map((k) => nodes.find((n) => n.id === `year.what${k}`));
    for (const w of whats) assert.ok(w.props.font.size >= floor - 1e-6, `${w.id} at ${w.props.font.size} against ${floor}`);
    const box = (n) => [n.props.x, n.props.y, n.props.layout.width, n.props.layout.height];
    const events = [0, 1, 2].map((k) => [nodes.find((n) => n.id === `year.when${k}`), whats[k]].map(box));
    const gap = out.ctx.unit * 8;
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      for (const [ba, bb] of events[a].flatMap((p) => events[b].map((q) => [p, q]))) {
        const apartX = ba[0] + ba[2] + gap <= bb[0] || bb[0] + bb[2] + gap <= ba[0], apartY = ba[1] + ba[3] + gap <= bb[1] || bb[1] + bb[3] + gap <= ba[1];
        assert.ok(apartX || apartY, `events ${a} and ${b} come within ${gap} px`);
      }
    }
  });
}

for (const format of ['16:9', '9:16']) {
  test(`cosmos diagram at ${format}: the step being spoken is ringed in the accent with a glow, one step at a time`, () => {
    const out = expandCaptioned(filmOf([FLOW], 'cosmos', format, { mode: format === '9:16' ? 'viral' : 'pro' }), 'flow');
    const nodes = all(out.nodes);
    const duration = out.ctx.timing.duration;
    const windows = litWindows(nodes, (k) => `flow.node${k}.lit.ring`, 4, duration);
    windows.forEach((w, k) => assert.ok(w.length > 0, `step ${k} is lit at some time`));
    for (const t of timesTo(duration)) assert.ok(windows.filter((w) => w.includes(t)).length <= 1, `at ${t.toFixed(2)} s more than one step is lit`);
    for (let k = 0; k < 4; k++) assert.ok(nodes.find((n) => n.id === `flow.node${k}.lit.halo`), `step ${k} has a halo`);
    const ring = nodes.find((n) => n.id === 'flow.node0.lit.ring');
    assert.equal(ring.props.stroke, registries.looks.get('cosmos').palette.accent, 'the ring is gold');
  });
}

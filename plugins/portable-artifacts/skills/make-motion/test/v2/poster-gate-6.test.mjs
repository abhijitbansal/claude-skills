// The poster gate's final review (gate-poster-3, MED fix items), on the two gate films: the chart hero at poster scale
// with its labels in the condensed caps, and compare with no empty quadrant beside its list. Node frames, the stand-in
// measure (the sheets judge real glyphs).
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { FPS, filmFor, expandIn } from './helpers/kinds.mjs';
import { snapshotOf, drawnLeaves } from './helpers/bar.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';
import { CAP_HEIGHT } from '../../engine/kinds/shared.mjs';

const LOOK = 'poster';
const GATE_DIR = new URL('../../references/examples/v2/', import.meta.url);
const WIDE = 'gate-poster.json', TALL = 'gate-poster-tall.json';
const HERO_RATIO = 3;
const TOL = 1e-6;

const cache = new Map();
function gate(name) {
  if (cache.has(name)) return cache.get(name);
  const film = { ...JSON.parse(readFileSync(new URL(name, GATE_DIR), 'utf8')), fps: FPS };
  const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
  const out = {
    film,
    prepared,
    built: filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed, music: film.music }, { prepared }),
    durations: buildTimeline({ ...film, version: 2 }, { fps: FPS }).shots.map((s) => s.duration),
  };
  cache.set(name, out);
  return out;
}
const indexIn = (b, id) => b.film.shots.findIndex((s) => s.id === id);
const textsAt = (b, i, t) => drawnLeaves(snapshotOf(b.built.sampleShot(i, t))).filter((l) => l.node.type === 'text' && l.opacity > 0);
const wordsOf = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
const areaOf = (b, i) => stackArea(expandIn({ ...b.film, look: LOOK }, i, { prepared: b.prepared }).ctx);

// ---- the chart: hero at poster scale, labels in the condensed caps ----

const CHART_SMALL = /\.(label\.\d+|value\.\d+|source)$/;
const DISPLAY = { width: 'extra-condensed', weight: 900 };

for (const name of [WIDE, TALL]) {
  test(`poster ${name} tests chart: the category labels, values and source are set in the display face's condensed caps`, () => {
    const b = gate(name);
    const i = indexIn(b, 'tests');
    const small = textsAt(b, i, b.durations[i] - 0.05).filter((l) => CHART_SMALL.test(l.node.id));
    assert.ok(small.length >= 5, `labels on screen: ${small.map((l) => l.node.id).join(', ')}`);
    const off = small.filter((l) => l.node.props.font.width !== DISPLAY.width || l.node.props.font.weight !== DISPLAY.weight || wordsOf(l.node) !== wordsOf(l.node).toUpperCase());
    assert.deepEqual(off.map((l) => `${l.node.id} ${l.node.props.font.width}/${l.node.props.font.weight} "${wordsOf(l.node)}"`), []);
  });

  test(`poster ${name} tests chart: the hero is at least three times every label, value and source`, () => {
    const b = gate(name);
    const i = indexIn(b, 'tests');
    const texts = textsAt(b, i, b.durations[i] - 0.05);
    const hero = texts.find((l) => /\.numeral(\.strike\.text)?$/.test(l.node.id));
    assert.ok(hero, 'the hero numeral on screen');
    const under = texts.filter((l) => CHART_SMALL.test(l.node.id)).filter((l) => hero.node.props.font.size < HERO_RATIO * l.node.props.font.size - TOL);
    assert.deepEqual(under.map((l) => `${l.node.id} ${l.node.props.font.size.toFixed(1)} of hero ${hero.node.props.font.size.toFixed(1)}`), []);
  });
}

// ---- compare: hierarchy and the quadrant beside the list ----

const SWAP_SMALL = /\.(points|kicker\.text)$/;
for (const name of [WIDE, TALL]) {
  test(`poster ${name} swap: each side's title is at least three times its points and tag, before and after the turn`, () => {
    const b = gate(name);
    const i = indexIn(b, 'swap');
    const under = [0.1, b.durations[i] - 0.05].flatMap((t) => {
      const texts = textsAt(b, i, t);
      return ['left', 'right'].flatMap((side) => {
        const own = texts.filter((l) => l.node.id.startsWith(`swap.${side}.`));
        const titles = own.filter((l) => /\.title\./.test(l.node.id));
        if (titles.length === 0) return [];
        const hero = Math.max(...titles.map((l) => l.node.props.font.size));
        return own.filter((l) => SWAP_SMALL.test(l.node.id) && hero < HERO_RATIO * l.node.props.font.size - TOL).map((l) => `@${t.toFixed(2)} ${l.node.id} ${l.node.props.font.size.toFixed(1)} of ${hero.toFixed(1)}`);
      });
    });
    assert.deepEqual(under, []);
  });
}

// gate-poster-3 (16:9 swap BEFORE): the quadrant beside the list (right of Durations / Positions / Easing, about 45
// percent wide and 40 percent tall) stood empty cream. The room right of the points, from their top to their foot, is
// at least half covered by what is drawn there (gate-5's fill test measures a union box, so it stayed green).
const QUADRANT_COVER = 0.5;
const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
test('poster 16:9 swap: the room beside each side\'s list is filled, not left an empty quadrant', () => {
  const b = gate(WIDE);
  const i = indexIn(b, 'swap');
  const area = areaOf(b, i);
  const empty = [0.1, b.durations[i] - 0.05].flatMap((t) => {
    const leaves = drawnLeaves(snapshotOf(b.built.sampleShot(i, t))).filter((l) => l.opacity > 0 && l.box && l.node.id !== 'ground' && !/field/.test(l.node.type));
    const points = leaves.find((l) => /\.points$/.test(l.node.id));
    if (points === undefined) return [`@${t.toFixed(2)} no points`];
    const room = [points.box[0] + points.box[2], points.box[1], area.left + area.w - (points.box[0] + points.box[2]), points.box[3]];
    const covered = leaves.filter((l) => l !== points).reduce((sum, l) => sum + overlap(room, l.box), 0);
    const share = covered / Math.max(1, room[2] * room[3]);
    return room[2] < 0.25 * area.w || share >= QUADRANT_COVER ? [] : [`@${t.toFixed(2)} ${points.node.id}: the room beside it ${(room[2] / area.w).toFixed(2)} x ${(room[3] / area.h).toFixed(2)} of the area, ${(share * 100).toFixed(0)} percent covered`];
  });
  assert.deepEqual(empty, []);
});

// gate-poster-3 (16:9 tests): the hero about 2.7 times the bar labels and visually smaller than the bars, the left column
// empty between the claim and the source; at poster scale the hero's ink spans most of its column and stands taller than
// the bars' labels by the hero rule
const COLUMN_FILL = 0.6;
test('poster 16:9 tests chart: the hero numeral fills its column (its ink at least 60 percent of the column\'s width)', () => {
  const b = gate(WIDE);
  const i = indexIn(b, 'tests');
  const area = areaOf(b, i);
  const column = area.w * registries.looks.get(LOOK).kinds.chart.heroColumn;
  const hero = textsAt(b, i, b.durations[i] - 0.05).find((l) => /\.numeral(\.strike\.text)?$/.test(l.node.id));
  assert.ok(hero.box[2] >= COLUMN_FILL * column, `hero ${hero.box[2].toFixed(0)} px wide in a ${column.toFixed(0)} px column (${(hero.box[2] / column).toFixed(2)})`);
  assert.ok(CAP_HEIGHT * hero.node.props.font.size > 0);
});

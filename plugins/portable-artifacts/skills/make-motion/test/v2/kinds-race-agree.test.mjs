// The race's value labels, bars, ranking and period label agree on every frame (lead ruling f4-1; gate-kinds-b-2
// "lead": at Q2 the numbers still showed Q1 and a lower value ranked above a higher one). Sampled frame by frame through
// every period's move, in both looks and formats, for a fixture with overtakes and for the two kinds-b films' own race.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sample } from '../../engine/time/track.mjs';
import { raceTimes } from '../../engine/kinds/chart-race.mjs';
import { expandIn, filmOf, all, FPS } from './helpers/kinds.mjs';

const FRAME = 1 / FPS;
const EXAMPLES = fileURLToPath(new URL('../../references/examples/v2/', import.meta.url));
const textOf = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join('');
const numberOf = (n) => Number(textOf(n).replace(/[^\d.-]/g, ''));
const RACE = {
  id: 'lead', show: 'chart', type: 'race', title: 'The North pulls ahead', highlight: 'North', valueLabel: 'orders to date',
  data: { periods: ['Q1', 'Q2', 'Q3', 'Q4'], rows: [
    { name: 'North', values: [1, 14, 66, 182] }, { name: 'South', values: [3, 18, 56, 121] },
    { name: 'East', values: [2, 13, 40, 97] }, { name: 'West', values: [0, 7, 20, 59] }] },
  say: 'In the first quarter the North came third. Quarter by quarter it pulled ahead, to one hundred and eighty two orders.',
};
// falling rows, a row that leaves the top 3 (Cy) and one that enters it (Di)
const FALLS = { ...RACE, id: 'f', top: 3, highlight: 'Ada', data: { periods: ['a', 'b', 'c'], rows: [
  { name: 'Ada', values: [10, 20, 40] }, { name: 'Bo', values: [30, 25, 20] }, { name: 'Cy', values: [20, 30, 10] }, { name: 'Di', values: [5, 10, 30] }] } };

function filmRace(name) {
  const film = JSON.parse(readFileSync(`${EXAMPLES}${name}.json`, 'utf8'));
  return { film: { ...film, fps: FPS }, index: film.shots.findIndex((s) => s.type === 'race') };
}

// Every frame of the shot: the period label up, each shown row's one value, its bar's length in values, and its y.
function frames(out, shot) {
  const nodes = all(out.nodes);
  const byId = (id) => nodes.find((n) => n.id === id);
  const rows = shot.data.rows;
  const max = Math.max(...rows.flatMap((r) => r.values));
  return Array.from({ length: Math.floor(out.timing.duration / FRAME) + 1 }, (_, f) => {
    const t = f * FRAME;
    const periods = shot.data.periods.map((_, p) => p).filter((p) => sample(byId(`${shot.id}.period.${p}`).tracks.opacity, t) > 0);
    const shown = rows.map((_, k) => k).filter((k) => sample(byId(`${shot.id}.row.${k}`).tracks.opacity, t) > 0).map((k) => {
      const row = byId(`${shot.id}.row.${k}`);
      const values = row.children.filter((c) => c.id.startsWith(`${shot.id}.value.${k}.`) && sample(c.tracks.opacity, t) > 0);
      const bar = byId(`${shot.id}.mark.${k}`);
      return { k, values: values.map(numberOf), length: sample(bar.tracks.scaleX, t) * max, y: sample(row.tracks.y, t) };
    });
    return { t, periods, shown };
  });
}

function assertAgree(out, shot, label) {
  const times = raceTimes(shot, out.timing);
  const settle = out.ctx.look.moves.settle.dur;
  const rows = shot.data.rows;
  for (const { t, periods, shown } of frames(out, shot)) {
    const at = `${label} at ${t.toFixed(3)} s`;
    assert.equal(periods.length, 1, `${at}: ${periods.length} period labels up`);
    const p = periods[0];
    const moving = p > 0 && t < times[p] + settle;
    for (const row of shown) {
      const name = rows[row.k].name;
      assert.equal(row.values.length, 1, `${at}: ${name} shows ${row.values.length} values`);
      const [v] = row.values;
      const now = rows[row.k].values[p];
      if (!moving) assert.equal(v, now, `${at}: ${name} shows ${v} under ${shot.data.periods[p]} (its value there is ${now})`);
      else {
        const before = rows[row.k].values[p - 1];
        assert.ok(v >= Math.min(before, now) && v <= Math.max(before, now), `${at}: ${name} shows ${v}, not between ${before} and ${now}`);
        assert.ok(v !== before || before === now, `${at}: ${name} still shows ${shot.data.periods[p - 1]}'s ${before} under ${shot.data.periods[p]}`);
      }
      assert.ok(Math.abs(row.length - v) < 1e-6, `${at}: ${name}'s bar is ${row.length.toFixed(2)} long but its label says ${v}`);
    }
    const byY = [...shown].sort((a, b) => a.y - b.y);
    byY.slice(1).forEach((row, i) => {
      const above = byY[i];
      assert.ok(row.y > above.y + 1e-6, `${at}: ${rows[above.k].name} and ${rows[row.k].name} share a place`);
      assert.ok(above.values[0] >= row.values[0], `${at}: ${rows[above.k].name} (${above.values[0]}) ranks above ${rows[row.k].name} (${row.values[0]})`);
    });
  }
}

for (const look of ['desk', 'pop']) {
  for (const format of ['16:9', '9:16']) {
    test(`race ${look} ${format}: on every frame each label shows its period's value (or counts toward it), its bar is that long, and the order follows the values`, () => {
      assertAgree(expandIn(filmOf([RACE], look, format)), RACE, `${look} ${format}`);
    });
    test(`race ${look} ${format}: the same with falling rows, a row leaving the top and one entering it`, () => {
      assertAgree(expandIn(filmOf([FALLS], look, format)), FALLS, `${look} ${format} falls`);
    });
  }
}

for (const name of ['kinds-b-desk', 'kinds-b-pop']) {
  test(`${name}: the film's own race agrees on every frame`, () => {
    const { film, index } = filmRace(name);
    assertAgree(expandIn(film, index), film.shots[index], name);
  });
}

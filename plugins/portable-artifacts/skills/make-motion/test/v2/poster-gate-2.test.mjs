// poster gate revision 1 (gate-poster-1.md, the lead's rulings 1 to 7): the chart made a poster (ruling 2), grounds
// flat (ruling 7). Node-only, under the fake measure (helpers/kinds.mjs); the real glyphs are checked on the gate
// renders and in poster-gate-2-browser.test.mjs.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { lookOfShot } from '../../engine/graph/film.mjs';
import { contrastRatio } from '../../shared/contrast.mjs';
import { snapshotOf, drawnLeaves } from './helpers/bar.mjs';
import { filmOf, filmFor, all, canvasOf, FPS } from './helpers/kinds.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { resolveShotCut } from '../../engine/cuts/resolve.mjs';

const LOOK = 'poster';
const look = () => registries.looks.get(LOOK);
const ACCENT = '#d92b1c'; // the look's own red, not a ground's remapped accent
// the gate films' chart (references/examples/v2/gate-poster*.json, the lead's)
const CHART = Object.freeze({
  id: 'tests', show: 'chart', type: 'column', title: 'Tests after each stage',
  say: 'Each stage added tests. Shots took it past sixteen hundred.',
  data: [{ label: 'Picture', value: 844 }, { label: 'Voice', value: 1240 }, { label: 'Sound', value: 1507 }, { label: 'Shots', value: 1636 }],
  highlight: 'Shots', source: 'make-motion test suite, running total',
});
const OPENER = Object.freeze({ id: 'open', show: 'statement', say: 'Write the *script*. Get the film.' });
const FORMATS = Object.freeze([['16:9', 'pro'], ['9:16', 'viral'], ['9:16', 'pro']]);
const SEEDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 31, 37]);

// a film of [opener, chart] in `format`/`mode` at `seed`
const chartFilm = (format, mode, seed) => filmOf([OPENER, CHART], LOOK, format, { mode, seed });
const sampled = (format, mode, seed, t) => {
  const built = filmFor([OPENER, CHART], LOOK, format, { mode, seed });
  return snapshotOf(built.sampleShot(1, t));
};
const leavesAt = (format, mode, seed, t) => drawnLeaves(snapshotOf(filmFor([OPENER, CHART], LOOK, format, { mode, seed }).sampleShot(1, t)));
const durationOf = (format, mode, seed) => buildTimeline(chartFilm(format, mode, seed), { fps: FPS }).shots[1].duration;
const markOf = (leaves, k) => leaves.find((l) => l.node.id === `tests.mark.${k}`);

test('poster charts stand only on the grounds where the accent reads (paper, ink), never two neighbours alike', () => {
  for (const seed of SEEDS) {
    const shots = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? { ...OPENER, id: `s${i}` } : { ...CHART, id: `c${i}` }));
    const film = filmOf(shots, LOOK, '16:9', { mode: 'pro', seed });
    const grounds = shots.map((_, i) => lookOfShot(film, i).ground);
    shots.forEach((s, i) => {
      if (s.show === 'chart') assert.ok(['paper', 'ink'].includes(grounds[i]), `seed ${seed} shot ${i}: chart on ${grounds[i]}`);
      if (i > 0) assert.notEqual(grounds[i], grounds[i - 1], `seed ${seed}: neighbours ${i - 1} and ${i}`);
    });
  }
});

for (const [format, mode] of FORMATS) {
  test(`poster chart at ${format} ${mode}: the claimed bar is the red accent, the others read at 3:1 on the ground`, () => {
    const seen = new Set();
    for (const seed of SEEDS) {
      const film = chartFilm(format, mode, seed);
      seen.add(lookOfShot(film, 1).ground);
      const ground = lookOfShot(film, 1).palette.paper;
      const end = leavesAt(format, mode, seed, durationOf(format, mode, seed) - 0.05);
      const claimed = end.filter((l) => l.node.id.startsWith('tests.mark.3')).at(-1);
      assert.equal(claimed.node.props.fill.toLowerCase(), ACCENT, `seed ${seed}: the Shots bar`);
      for (const k of [0, 1, 2]) {
        const top = end.filter((l) => l.node.id.startsWith(`tests.mark.${k}`)).at(-1);
        const ratio = contrastRatio(top.node.props.fill, ground);
        assert.ok(ratio >= 3, `seed ${seed}: bar ${k} ${top.node.props.fill} on ${ground} at ${ratio.toFixed(2)}:1`);
        assert.ok(top.opacity >= 1, `seed ${seed}: bar ${k} opaque (no dim by opacity)`);
      }
    }
    assert.deepEqual([...seen].sort(), ['ink', 'paper'], 'both grounds a chart stands on are sampled');
  });

  test(`poster chart at ${format} ${mode}: while the bars grow, every frame keeps them in the data's order and proportion`, () => {
    const d = durationOf(format, mode, 31);
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const heights = [0, 1, 2, 3].map((k) => markOf(leavesAt(format, mode, 31, t), k).box[3]);
      const values = CHART.data.map((x) => x.value);
      heights.forEach((h, k) => assert.ok(Math.abs(h / heights[3] - values[k] / values[3]) < 0.01, `at ${t} s of ${d.toFixed(2)}: bar ${k} ${h.toFixed(1)} vs ${heights[3].toFixed(1)}`));
    }
  });

  test(`poster chart at ${format} ${mode}: the bars fill the plot, the tallest at least 30 percent of the frame`, () => {
    const canvas = canvasOf(format);
    const end = leavesAt(format, mode, 31, durationOf(format, mode, 31) - 0.05);
    const tallest = markOf(end, 3).box[3];
    assert.ok(tallest >= 0.3 * canvas.h, `tallest bar ${tallest.toFixed(0)} of ${canvas.h}`);
  });

  test(`poster chart at ${format} ${mode}: the highlighted value is the hero, above the title, three times its size`, () => {
    const end = all(sampled(format, mode, 31, durationOf(format, mode, 31) - 0.05));
    const numeral = end.find((n) => n.id === 'tests.numeral');
    const title = end.find((n) => n.id === 'tests.title.text');
    assert.ok(numeral && title, 'numeral and title present');
    assert.ok(numeral.bbox[1] + numeral.bbox[3] <= title.bbox[1] + 1, `numeral bottom ${numeral.bbox[1] + numeral.bbox[3]} above title top ${title.bbox[1]}`);
    assert.ok(numeral.props.font.size >= 3 * title.props.font.size, `numeral ${numeral.props.font.size} vs title ${title.props.font.size}`);
    assert.equal(title.props.font.width, look().fonts.display.width, 'the title in the condensed display face');
    assert.equal(title.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' '), CHART.title.toUpperCase(), 'the title in capitals');
  });

  test(`poster chart at ${format} ${mode}: labels and source at the secondary floor, the source fits`, () => {
    const end = all(sampled(format, mode, 31, durationOf(format, mode, 31) - 0.05));
    const min = look().secondary.min;
    const texts = end.filter((n) => n.type === 'text' && n.id.startsWith('tests.') && n.id !== 'tests.numeral');
    for (const text of texts) assert.ok(text.props.font.size >= min - 0.01, `${text.id} at ${text.props.font.size}`);
    const source = end.find((n) => n.id === 'tests.source');
    assert.notEqual(source.props.layout.overflow, true, 'the source fits its width');
  });

  test(`poster chart at ${format} ${mode}: frame 0 holds the title, the numeral, the baseline and every bar base, all opaque`, () => {
    const first = leavesAt(format, mode, 31, 0);
    for (const id of ['tests.title.text', 'tests.numeral', 'tests.axis']) {
      const leaf = first.find((l) => l.node.id === id);
      assert.ok(leaf, `${id} on frame 0`);
      assert.ok(leaf.opacity >= 1, `${id} at opacity ${leaf.opacity}`);
    }
    for (const k of [0, 1, 2, 3]) assert.ok(markOf(first, k)?.box[3] > 0, `bar ${k} base on frame 0`);
  });

  test(`poster chart at ${format} ${mode}: values and the accent land at least 1.2 s before the cut`, () => {
    const t = durationOf(format, mode, 31) - 1.2;
    const at = leavesAt(format, mode, 31, t);
    const end = leavesAt(format, mode, 31, durationOf(format, mode, 31) - 0.02);
    for (const k of [0, 1, 2, 3]) assert.ok(Math.abs(markOf(at, k).box[3] - markOf(end, k).box[3]) < 0.5, `bar ${k} grown by ${t.toFixed(2)} s`);
    const label = (leaves) => leaves.filter((l) => l.node.type === 'text' && /tests\.value/.test(l.node.id)).map((l) => `${l.node.id}:${l.opacity}`);
    assert.deepEqual(label(at), label(end), 'value labels settled');
  });
}

// ruling 4: the viral hook stops the scroll (gate film gate-poster-tall.json's first shot)
const HOOK = Object.freeze({ id: 'hook', show: 'statement', say: 'Write the *script*. Get the film.' });
const hookLeaves = (t) => drawnLeaves(snapshotOf(filmFor([HOOK, CHART], LOOK, '9:16', { mode: 'viral', seed: 37 }).sampleShot(0, t)));
const hookRows = (leaves) => leaves.filter((l) => l.node.type === 'text' && l.node.id.startsWith('hook.'));

test('poster viral hook: upright, every word at full opacity on frame 0, the starred word alone on the largest row', () => {
  const rows = hookRows(hookLeaves(0));
  assert.ok(rows.length >= 3, `${rows.length} rows`);
  for (const r of rows) {
    assert.equal(r.node.rotate ?? 0, 0, `${r.node.id} upright`);
    assert.ok(r.opacity >= 1, `${r.node.id} at ${r.opacity}`);
    const words = r.node.props.layout.lines.flatMap((l) => l.words);
    for (const [i] of words.entries()) {
      const tr = r.node.wordTracks?.[i]?.opacity;
      assert.ok(tr === undefined || tr.points[0].v >= 1, `${r.node.id} word ${i} opaque on frame 0`);
    }
  }
  const text = (r) => r.node.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ');
  const starred = rows.find((r) => /SCRIPT/.test(text(r)));
  assert.equal(text(starred), 'SCRIPT.', 'the starred word has its own row');
  assert.ok(rows.every((r) => r === starred || r.node.props.font.size < starred.node.props.font.size), 'its row is the largest');
});

// the lead's ruling on option A, tested both ways: the weak row end is allowed only in a hook, only right before a row
// that is the starred word alone
const rowsOfShot = (shots, index, format = '9:16', mode = 'viral') => all(snapshotOf(filmFor(shots, LOOK, format, { mode, seed: 37 }).sampleShot(index, 0.5)))
  .filter((n) => n.type === 'text' && n.props.stack === `${shots[index].id}.text`).map((n) => n.props.layout.lines[0].words.map((w) => w.text).join(' '));
const endsWeak = (row) => ['THE', 'A', 'AN', 'OF', 'TO'].includes(row.split(' ').at(-1));
test('poster hook exception: a weak row end only right before the starred word alone', () => {
  const rows = rowsOfShot([HOOK], 0);
  rows.slice(0, -1).forEach((row, k) => { if (endsWeak(row)) assert.equal(rows[k + 1], 'SCRIPT.', rows.join(' / ')); });
  assert.ok(rows.slice(0, -1).some(endsWeak), `the exception fires for the starred hook: ${rows.join(' / ')}`);
});
test('poster hook exception: never for a hook without a star, nor for a statement that is not the hook', () => {
  const plain = { ...HOOK, say: 'Write the script. Get the film.' };
  const noStar = rowsOfShot([plain], 0);
  assert.ok(!noStar.slice(0, -1).some(endsWeak), `no star: ${noStar.join(' / ')}`);
  // an upright statement that is not a viral film's first shot (a tall non-hook statement turns, and p3's turned stack
  // sets a word a line, a different path)
  for (const [format, mode] of [['16:9', 'pro']]) {
    const later = rowsOfShot([OPENER, { ...HOOK, id: 'later' }], 1, format, mode);
    assert.ok(!later.slice(0, -1).some(endsWeak), `not the hook at ${format} ${mode}: ${later.join(' / ')}`);
  }
});

// under the fake measure (0.55 em a letter, wider than Archivo's condensed caps) the block was 306 units before ruling 4
// (measured on this tree before the change); the real-glyph fill is poster-viral-gate-browser.test.mjs's
const HOOK_BLOCK_BEFORE = 306;
test('poster viral hook: the block is at least 1.8 times its height before (fake measure) and spans the safe width', () => {
  const rows = hookRows(hookLeaves(0.5));
  const top = Math.min(...rows.map((r) => r.box[1])), bottom = Math.max(...rows.map((r) => r.box[1] + r.box[3]));
  assert.ok(bottom - top >= 1.8 * HOOK_BLOCK_BEFORE, `block ${Math.round(bottom - top)}`);
  assert.ok(Math.max(...rows.map((r) => r.box[2])) >= 0.85 * 765, 'the widest row spans the safe width');
});

// ruling 1: the 16:9 code shot as a poster (gate-poster.json's shot "shot")
const CODE = Object.freeze({
  id: 'shot', show: 'code', lang: 'json', title: 'One shot', highlight: [3],
  code: '{\n  "id": "hook",\n  "show": "statement",\n  "say": "Numbers need sources."\n}',
  say: 'A shot is a few lines of JSON. What it says sets its timing.',
});
const codeBuilt = () => {
  const shots = [OPENER, CODE];
  const film = filmOf(shots, LOOK, '16:9', { mode: 'pro', seed: 31 });
  return filmFor(shots, LOOK, '16:9', { mode: 'pro', seed: 31 }, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
};
const codeRuns = (leaves) => leaves.filter((l) => /^shot\.l\d+\.c\d+$/.test(l.node.id));

test('poster code at 16:9: the title is the hero in condensed capitals, at least three times the code', () => {
  const end = all(snapshotOf(codeBuilt().sampleShot(1, 2)));
  const hero = end.find((n) => n.id === 'shot.hero');
  assert.ok(hero, 'a hero title on the wide frame');
  assert.equal(hero.props.font.width, look().fonts.display.width);
  assert.equal(hero.props.layout.lines[0].words.map((w) => w.text).join(' '), 'ONE SHOT');
  const code = end.find((n) => /^shot\.l1\.c\d+$/.test(n.id));
  assert.ok(hero.props.font.size >= 3 * code.props.font.size, `hero ${hero.props.font.size} vs code ${code.props.font.size}`);
});

test('poster code at 16:9: the code fills the frame, its longest line at least 75 percent of the width', () => {
  const end = drawnLeaves(snapshotOf(codeBuilt().sampleShot(1, 2)));
  const runs = codeRuns(end);
  const left = Math.min(...runs.map((l) => l.box[0])), right = Math.max(...runs.map((l) => l.box[0] + l.box[2]));
  assert.ok(right - left >= 0.75 * canvasOf('16:9').w, `code ${Math.round(right - left)} wide`);
});

test('poster code at 16:9: the shot opens set, the title and every line of code on frame 0 at full opacity', () => {
  const built = codeBuilt();
  const first = drawnLeaves(snapshotOf(built.sampleShot(1, 0)));
  const later = drawnLeaves(snapshotOf(built.sampleShot(1, 3)));
  assert.ok(first.find((l) => l.node.id === 'shot.hero')?.opacity >= 1, 'the hero on frame 0');
  assert.equal(codeRuns(first).filter((l) => l.opacity >= 1).length, codeRuns(later).length, 'every run of code on frame 0');
});

test('poster code at 16:9: a long shot (the kind\'s ten-line example) keeps its title row and every line, no wide hero', () => {
  const ex = { ...registries.kinds.get('code').example };
  const film = filmOf([OPENER, ex], LOOK, '16:9', { mode: 'pro', seed: 31 });
  const built = filmFor([OPENER, ex], LOOK, '16:9', { mode: 'pro', seed: 31 }, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
  const nodes = all(snapshotOf(built.sampleShot(1, 3)));
  assert.equal(nodes.find((n) => n.id === `${ex.id}.hero`), undefined, 'no hero');
  const lines = new Set(nodes.filter((n) => new RegExp(`^${ex.id}\\.l\\d+\\.c\\d+$`).test(n.id)).map((n) => n.id.split('.')[1]));
  assert.equal(lines.size, ex.code.split('\n').filter((l) => l.trim() !== '').length, 'every non-blank line drawn');
});

// ruling 3: the close's ask is on screen at least 1.5 s before the cut, in both gate films
for (const name of ['gate-poster.json', 'gate-poster-tall.json']) {
  test(`poster ${name}: the close's ask is on at full opacity 1.5 s before the cut`, () => {
    const film = { ...gateFilm(name), fps: FPS };
    const i = film.shots.findIndex((s) => s.show === 'end');
    const built = filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed }, { prepared: prepareFilm(film, { filmDir: '.' }).prepared });
    const d = buildTimeline({ ...film, version: 2 }, { fps: FPS }).shots[i].duration;
    const ask = drawnLeaves(snapshotOf(built.sampleShot(i, d - 1.5))).find((l) => l.node.id === 'close.ask.text');
    assert.ok(ask && ask.opacity >= 0.999, `ask at ${ask?.opacity} at ${(d - 1.5).toFixed(2)} s of ${d.toFixed(2)}`);
  });
}

// rulings 3 and 7: every shot of both gate films opens set: on its first two frames nothing drawn is half there (a
// chip fading in, a part entering), measured at the shot's own times (no cut windows: the timeline of the film alone)
const GATE_DIR = new URL('../../references/examples/v2/', import.meta.url);
const gateFilm = (name) => JSON.parse(readFileSync(new URL(name, GATE_DIR), 'utf8'));
for (const name of ['gate-poster.json', 'gate-poster-tall.json']) {
  test(`poster ${name}: no drawn part is half there on any shot's first two frames`, () => {
    const film = { ...gateFilm(name), fps: FPS };
    const prepared = prepareFilm(film, { filmDir: '.' }).prepared;
    const built = filmFor(film.shots, LOOK, film.format, { mode: film.mode, seed: film.seed, music: film.music }, { prepared });
    const bad = film.shots.flatMap((shot, i) => [0, 1 / FPS].flatMap((t) => drawnLeaves(snapshotOf(built.sampleShot(i, t)))
      .filter((l) => l.opacity > 0.001 && l.opacity < 0.999)
      .map((l) => `${shot.id} ${t.toFixed(3)}s ${l.node.id} at ${l.opacity.toFixed(2)}`)));
    assert.deepEqual(bad, []);
    // every chip (a kicker tag) a shot shows at 0.5 s is already on at full opacity on its first frame
    const chips = (i, t) => drawnLeaves(snapshotOf(built.sampleShot(i, t))).filter((l) => /\.kicker\.text$/.test(l.node.id) && l.opacity >= 0.999).map((l) => l.node.id);
    const late = film.shots.flatMap((shot, i) => chips(i, 0.5).filter((id) => !chips(i, 0).includes(id)).map((id) => `${shot.id}: ${id}`));
    assert.deepEqual(late, []);
  });
}

// ruling 6: poster's own cut-paper wipe (a cover: the next shot's ground sheet slides over the last), chosen by the
// engine at least once in each gate film when the film names no cut
for (const name of ['gate-poster.json', 'gate-poster-tall.json']) {
  test(`poster ${name}: the engine opens at least one shot on the cut-paper cover, the rest on hard cuts`, () => {
    const film = gateFilm(name);
    const names = film.shots.map((_, i) => resolveShotCut(film, i)?.name ?? null);
    assert.ok(names.filter((n) => n === 'cover').length >= 1, names.join(' '));
    assert.ok(names.slice(1).every((n) => ['cover', 'cut'].includes(n)), names.join(' '));
    assert.ok(names.every((n, i) => i < 2 || !(n === names[i - 1] && n === names[i - 2] && n === 'cover')), 'no three covers in a row');
  });
}

test('a cut a film names wins over the look\'s pick; a look without cutPick keeps hard cuts', () => {
  const film = gateFilm('gate-poster.json');
  assert.equal(resolveShotCut({ ...film, cut: 'slide' }, 3).name, 'slide');
  assert.equal(resolveShotCut({ ...film, shots: film.shots.map((s, i) => (i === 3 ? { ...s, cut: 'iris' } : s)) }, 3).name, 'iris');
  assert.equal(resolveShotCut({ ...film, look: 'desk' }, 3).name, 'cut');
});

test('poster grounds are flat: the field draws no column hairlines', () => {
  assert.equal(look().field.params.alpha, 0);
});
